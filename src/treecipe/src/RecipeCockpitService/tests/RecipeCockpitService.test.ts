import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

jest.mock('vscode', () => ({
    window: { createWebviewPanel: jest.fn(), withProgress: jest.fn() },
    ViewColumn: { One: 1 },
    ProgressLocation: { Notification: 15 }
}), { virtual: true });

import {
    RecipeCockpitService,
    IRecipeCockpitPanelState,
    IRecipeCockpitRecipeViewModel,
    RECIPE_COCKPIT_VIEW_TYPE,
    RECIPE_COCKPIT_PANEL_TITLE,
    RECIPE_COCKPIT_PENDING_ACKNOWLEDGEMENT,
    RECIPE_COCKPIT_ISSUES_URL,
    RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL,
    RECIPE_COCKPIT_NO_RUN_MESSAGE,
    RECIPE_COCKPIT_LOAD_PHASES,
    RECIPE_COCKPIT_AUTO_EXPAND_OBJECT_LIMIT,
    RECIPE_COCKPIT_AUTO_EXPAND_ROW_BUDGET,
    RECIPE_COCKPIT_DESCRIBE_ACTION_LABEL,
    RECIPE_COCKPIT_ORG_PICKER_PLACEHOLDER
} from '../RecipeCockpitService';
import { SalesforceOrgService, ORG_DESCRIBE_CANCELLED_MESSAGE } from '../../SalesforceOrgService/SalesforceOrgService';
import { SfdxProjectService } from '../../SfdxProjectService/SfdxProjectService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { ErrorHandlingService } from '../../ErrorHandlingService/ErrorHandlingService';

const MOCK_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'workspace');
const MOCK_GENERATED_RECIPES_PATH = path.join(MOCK_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes');
const LATEST_RUN_FOLDER_NAME = 'recipe-2026-09-04T11-22-07';
const FAKER_JS_RUN_FOLDER_NAME = 'recipe-fakerjs-2026-09-01T08-00-00';
const LATEST_RECIPE_FILE_PATH = path.join(
    MOCK_GENERATED_RECIPES_PATH,
    LATEST_RUN_FOLDER_NAME,
    'Account-thru-Contact',
    'recipe--Account-thru-Contact-2026-09-04T11-22-07.yml'
);

function buildRecipeViewModel(overrides: Partial<IRecipeCockpitRecipeViewModel> = {}): IRecipeCockpitRecipeViewModel {

    return {
        runs: [{ runFolderName: LATEST_RUN_FOLDER_NAME, label: 'latest run' }],
        selectedRunFolderName: LATEST_RUN_FOLDER_NAME,
        objects: [],
        notices: [],
        emptyStateMessage: '',
        ...overrides
    };

}

describe('RecipeCockpitService', () => {

    describe('buildContentSecurityPolicy', () => {

        it('allows only the nonced inline style and script and no remote content at all', () => {

            const actualContentSecurityPolicy = RecipeCockpitService.buildContentSecurityPolicy('testNonce');

            expect(actualContentSecurityPolicy).toContain(`default-src 'none'`);
            expect(actualContentSecurityPolicy).toContain(`style-src 'nonce-testNonce'`);
            expect(actualContentSecurityPolicy).toContain(`script-src 'nonce-testNonce'`);
            // NEITHER FALLS BACK TO default-src, SO BOTH ARE NAMED EXPLICITLY
            expect(actualContentSecurityPolicy).toContain(`form-action 'none'`);
            expect(actualContentSecurityPolicy).toContain(`base-uri 'none'`);
            expect(actualContentSecurityPolicy).not.toContain('http');

        });

    });

    describe('buildNonce', () => {

        it('builds a distinct alphanumeric nonce on each call', () => {

            const firstNonce = RecipeCockpitService.buildNonce();
            const secondNonce = RecipeCockpitService.buildNonce();

            expect(firstNonce).toMatch(/^[A-Za-z0-9]{32}$/);
            expect(firstNonce).not.toBe(secondNonce);

        });

    });

    describe('buildWebviewShellHtml', () => {

        it('carries the content security policy meta and nonces every inline block it emits', () => {

            const actualShellHtml = RecipeCockpitService.buildWebviewShellHtml('testNonce');

            expect(actualShellHtml).toContain(
                `<meta http-equiv="Content-Security-Policy" content="${RecipeCockpitService.buildContentSecurityPolicy('testNonce')}">`
            );
            expect(actualShellHtml).toContain('<style nonce="testNonce">');
            expect(actualShellHtml).toContain('<script nonce="testNonce">');

        });

        // AN UN-NONCED INLINE BLOCK IS SILENTLY DEAD UNDER THE CSP, SO EVERY ONE IS COUNTED RATHER THAN SPOT CHECKED
        it('emits no inline style or script block without a nonce', () => {

            const actualShellHtml = RecipeCockpitService.buildWebviewShellHtml('testNonce');

            const inlineBlockOpenings = actualShellHtml.match(/<(style|script)\b[^>]*>/g) ?? [];

            expect(inlineBlockOpenings).not.toBeEmpty();
            inlineBlockOpenings.forEach(inlineBlockOpening => {
                expect(inlineBlockOpening).toContain('nonce="testNonce"');
            });

        });

        it('references no external asset of any kind', () => {

            const actualShellHtml = RecipeCockpitService.buildWebviewShellHtml('testNonce');

            expect(actualShellHtml).not.toMatch(/\ssrc="/);
            expect(actualShellHtml).not.toMatch(/<link\b/);
            expect(actualShellHtml).not.toMatch(/https?:\/\//);

        });

        /*
            The builder takes a nonce and nothing else, and that signature is the guarantee: a
            recipe value can only reach the template through a parameter.
        */
        it('takes the nonce as its only parameter', () => {

            expect(RecipeCockpitService.buildWebviewShellHtml.length).toBe(1);

        });

        // WRITING THROUGH innerHTML ANYWHERE IS WHAT WOULD RE-OPEN A MARKUP CONTEXT FOR A RECIPE VALUE
        it('writes nothing through innerHTML or outerHTML', () => {

            const actualShellHtml = RecipeCockpitService.buildWebviewShellHtml('testNonce');

            expect(actualShellHtml).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);

        });

        // PINS THE MARKUP THE FAKE DOM BELOW ANSWERS getElementById WITH
        it('declares the status line and the body the panel script addresses', () => {

            const actualShellHtml = RecipeCockpitService.buildWebviewShellHtml('testNonce');

            expect(actualShellHtml).toContain(`<title>${RECIPE_COCKPIT_PANEL_TITLE}</title>`);
            expect(actualShellHtml).toContain(`<div id="loadStatus" class="loadStatus">${RECIPE_COCKPIT_PENDING_ACKNOWLEDGEMENT}</div>`);
            expect(actualShellHtml).toContain('<div id="cockpitBody"></div>');

        });

    });

    describe('findGeneratedRecipeRuns', () => {

        /*
            A faker-js run is prefixed "recipe-fakerjs-" and a snowfakery run "recipe-", so sorting
            the folder names would rank the older faker-js run first. The fixture is shaped to
            catch exactly that: the newer run is the snowfakery one.
        */
        it('lists every run carrying an objects wrapper, newest first by its timestamp rather than its name', () => {

            const actualRuns = RecipeCockpitService.findGeneratedRecipeRuns(MOCK_GENERATED_RECIPES_PATH);

            expect(actualRuns.map(run => run.runFolderName)).toEqual([LATEST_RUN_FOLDER_NAME, FAKER_JS_RUN_FOLDER_NAME]);
            expect(actualRuns[0].generatedAtTimestamp).toBe('2026-09-04T11:22:07Z');
            expect(actualRuns[0].objectsWrapperFilePath).toBe(
                path.join(MOCK_GENERATED_RECIPES_PATH, LATEST_RUN_FOLDER_NAME, 'treecipeObjectsWrapper-2026-09-04T11-22-07.json')
            );

        });

        // THE 2026-09-10 FOLDER IS THE NEWEST ON DISK AND HAS NO WRAPPER; "notARun" HAS NO TIMESTAMP
        it('skips a folder with no objects wrapper and a folder that is not a run', () => {

            const actualRunFolderNames = RecipeCockpitService.findGeneratedRecipeRuns(MOCK_GENERATED_RECIPES_PATH).map(run => run.runFolderName);

            expect(actualRunFolderNames).not.toContain('recipe-2026-09-10T00-00-00');
            expect(actualRunFolderNames).not.toContain('notARun');

        });

        it('given no GeneratedRecipes folder, lists no runs', () => {

            expect(RecipeCockpitService.findGeneratedRecipeRuns(path.join(MOCK_WORKSPACE_ROOT, 'doesNotExist'))).toEqual([]);

        });

    });

    describe('buildRunLabel', () => {

        it('names when the run was generated, in UTC, and which faker backend wrote it', () => {

            const [latestRun, fakerJsRun] = RecipeCockpitService.findGeneratedRecipeRuns(MOCK_GENERATED_RECIPES_PATH);

            expect(RecipeCockpitService.buildRunLabel(latestRun, true)).toBe('2026-09-04 11:22:07 UTC · snowfakery · latest');
            expect(RecipeCockpitService.buildRunLabel(fakerJsRun, false)).toBe('2026-09-01 08:00:00 UTC · faker-js');

        });

    });

    describe('buildRecipeViewModel', () => {

        it('given a generated run exists, loads the latest one and lists its objects in recipe order', () => {

            const actualRecipe = RecipeCockpitService.buildRecipeViewModel(MOCK_WORKSPACE_ROOT);

            expect(actualRecipe.selectedRunFolderName).toBe(LATEST_RUN_FOLDER_NAME);
            expect(actualRecipe.runs.map(run => run.runFolderName)).toEqual([LATEST_RUN_FOLDER_NAME, FAKER_JS_RUN_FOLDER_NAME]);
            /*
                User is a key the wrapper holds for a lookup, and RelationshipService lists it in the
                tree's RecipeFiles objects -- the fixture is that shape -- but no recipe was written
                for it, so it is not a recipe object.
            */
            expect(actualRecipe.objects.map(objectViewModel => objectViewModel.objectApiName)).toEqual(['Account', 'Contact']);
            expect(actualRecipe.emptyStateMessage).toBe('');

        });

        it('gives each object the recipe file and line it is written at', () => {

            const [accountObject, contactObject] = RecipeCockpitService.buildRecipeViewModel(MOCK_WORKSPACE_ROOT).objects;

            expect(accountObject.recipeFilePath).toBe(LATEST_RECIPE_FILE_PATH);
            expect(accountObject.recipeFileName).toBe('recipe--Account-thru-Contact-2026-09-04T11-22-07.yml');
            expect(accountObject.lineNumber).toBe(7);
            expect(contactObject.lineNumber).toBe(24);

        });

        /*
            Name is a standard-field mapping written straight into the recipe, so it never becomes a
            FieldInfo in the wrapper. Legacy_Code__c is in the wrapper but not in the file.
        */
        it('orders fields as the file does, adds the ones only the file carries, and keeps the unlocated ones last', () => {

            const [accountObject] = RecipeCockpitService.buildRecipeViewModel(MOCK_WORKSPACE_ROOT).objects;

            expect(accountObject.fields.map(field => [field.fieldApiName, field.lineNumber])).toEqual([
                ['Name', 11],
                ['Industry', 12],
                ['Industry_Group__c', 13],
                ['Number_of_Contacts__c', 18],
                ['Legacy_Code__c', undefined]
            ]);

            const nameField = accountObject.fields[0];
            expect(nameField.isOnlyInRecipeFile).toBe(true);
            expect(nameField.recipeValue).toBe('${{fake.Company}}');
            expect(nameField.fieldType).toBe('');

        });

        it('carries each wrapper field\'s type, label, controlling field and faker expression', () => {

            const [accountObject] = RecipeCockpitService.buildRecipeViewModel(MOCK_WORKSPACE_ROOT).objects;
            const industryGroupField = accountObject.fields.find(field => field.fieldApiName === 'Industry_Group__c');
            const numberOfContactsField = accountObject.fields.find(field => field.fieldApiName === 'Number_of_Contacts__c');

            expect(industryGroupField).toEqual({
                fieldApiName: 'Industry_Group__c',
                fieldLabel: 'Industry Group',
                fieldType: 'Picklist',
                recipeValue: "if:\n    - choice:\n        when: ${{ Industry == 'Agriculture' }}\n        pick: Ag Co-op",
                controllingField: 'Industry',
                isOnlyInRecipeFile: false,
                lineNumber: 13
            });
            // THE BLOCK SCALAR INDICATOR AND ITS FILE INDENTATION ARE NOT PART OF THE EXPRESSION
            expect(numberOfContactsField.recipeValue).toBe('${{ random_number(min=0, max=999999) }}');

        });

        it('counts a wrapper field entry with no api name in a notice rather than rendering it', () => {

            const actualRecipe = RecipeCockpitService.buildRecipeViewModel(MOCK_WORKSPACE_ROOT);
            const contactObject = actualRecipe.objects[1];

            expect(contactObject.fields.map(field => field.fieldApiName)).toEqual(['LastName', 'AccountId']);
            expect(actualRecipe.notices).toEqual(['1 field entry in the objects wrapper had no field api name and is not shown.']);

        });

        it('given a run is requested, loads that run instead of the latest', () => {

            const actualRecipe = RecipeCockpitService.buildRecipeViewModel(MOCK_WORKSPACE_ROOT, FAKER_JS_RUN_FOLDER_NAME);

            expect(actualRecipe.selectedRunFolderName).toBe(FAKER_JS_RUN_FOLDER_NAME);
            expect(actualRecipe.objects.map(objectViewModel => objectViewModel.objectApiName)).toEqual(['Lead']);
            expect(actualRecipe.objects[0].fields[0]).toMatchObject({ fieldApiName: 'Company', lineNumber: 11 });

        });

        // A RUN DELETED BETWEEN THE RENDER AND THE CHOICE IS NOT A REASON TO SHOW NOTHING
        it('given a requested run is no longer on disk, loads the latest', () => {

            const actualRecipe = RecipeCockpitService.buildRecipeViewModel(MOCK_WORKSPACE_ROOT, 'recipe-1999-01-01T00-00-00');

            expect(actualRecipe.selectedRunFolderName).toBe(LATEST_RUN_FOLDER_NAME);
            expect(actualRecipe.notices[0]).toBe('The run "recipe-1999-01-01T00-00-00" is no longer on disk, so the latest run is shown instead.');

        });

        it('given no generated run exists, answers with the empty state that names Generate Treecipe', () => {

            const actualRecipe = RecipeCockpitService.buildRecipeViewModel(path.join(MOCK_WORKSPACE_ROOT, 'doesNotExist'));

            expect(actualRecipe).toEqual({ runs: [], selectedRunFolderName: '', objects: [], notices: [], emptyStateMessage: RECIPE_COCKPIT_NO_RUN_MESSAGE });
            expect(RECIPE_COCKPIT_NO_RUN_MESSAGE).toContain('Generate Treecipe');

        });

        describe('given a run whose files are damaged', () => {

            let temporaryWorkspaceRoot: string;
            let runFolderPath: string;

            beforeEach(() => {
                temporaryWorkspaceRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'recipeCockpit-')));
                runFolderPath = path.join(temporaryWorkspaceRoot, 'treecipe', 'GeneratedRecipes', 'recipe-2026-01-01T00-00-00');
                fs.mkdirSync(runFolderPath, { recursive: true });
            });

            afterEach(() => {
                fs.rmSync(temporaryWorkspaceRoot, { recursive: true, force: true });
            });

            const writeObjectsWrapper = (objectsWrapperContent: string) => {
                fs.writeFileSync(path.join(runFolderPath, 'treecipeObjectsWrapper-2026-01-01T00-00-00.json'), objectsWrapperContent);
            };

            it('given a wrapper that is not json, keeps the run selector and says the wrapper could not be read', () => {

                writeObjectsWrapper('{ not json');

                const actualRecipe = RecipeCockpitService.buildRecipeViewModel(temporaryWorkspaceRoot);

                expect(actualRecipe.runs).toHaveLength(1);
                expect(actualRecipe.objects).toEqual([]);
                expect(actualRecipe.emptyStateMessage).toContain('could not be read');

            });

            it('given json that is not an objects wrapper, says so', () => {

                writeObjectsWrapper('[1, 2, 3]');

                expect(RecipeCockpitService.buildRecipeViewModel(temporaryWorkspaceRoot).emptyStateMessage).toContain('is not a Treecipe objects wrapper');

            });

            it('given a wrapper listing no objects, says so', () => {

                writeObjectsWrapper('{ "ObjectToObjectInfoMap": {} }');

                expect(RecipeCockpitService.buildRecipeViewModel(temporaryWorkspaceRoot).emptyStateMessage).toContain('lists no objects');

            });

            // A WRAPPER IS ON DISK AND A HAND EDIT CONTROLS IT, SO NO VALUE IS RENDERED WITHOUT ITS TYPE BEING CHECKED
            it('given values of the wrong type, renders them as empty rather than as whatever they were', () => {

                writeObjectsWrapper(JSON.stringify({
                    ObjectToObjectInfoMap: {
                        Account: { Fields: [{ fieldName: 'Industry', type: { nested: true }, recipeValue: 42, controllingField: ['Region'] }] }
                    }
                }));

                const [accountObject] = RecipeCockpitService.buildRecipeViewModel(temporaryWorkspaceRoot).objects;

                expect(accountObject.fields[0]).toMatchObject({ fieldApiName: 'Industry', fieldType: '', recipeValue: '', controllingField: '' });

            });

            it('given damaged RecipeFiles and object entries, reads what it can and counts every unreadable field', () => {

                writeObjectsWrapper(JSON.stringify({
                    ObjectToObjectInfoMap: {
                        Account: { Fields: [null, 'Industry', { fieldName: '' }, { fieldName: 'Industry' }] },
                        Contact: null,
                        Lead: 'not an object'
                    },
                    RecipeFiles: [null, { objects: 'Account' }, { objects: [42, 'Contact', 'Account', 'Account'] }]
                }));

                const actualRecipe = RecipeCockpitService.buildRecipeViewModel(temporaryWorkspaceRoot);

                // Contact HAS NO Fields AND NO RECIPE FILE CARRIES IT, SO IT IS A LOOKUP TARGET; Lead IS IN NEITHER LIST
                expect(actualRecipe.objects.map(objectViewModel => [objectViewModel.objectApiName, objectViewModel.fields.length])).toEqual([
                    ['Account', 1]
                ]);
                expect(actualRecipe.notices).toEqual(['3 field entries in the objects wrapper had no field api name and are not shown.']);

            });

            it('given an object with no Fields that a recipe file does carry, lists it with the fields the file has', () => {

                fs.writeFileSync(path.join(runFolderPath, 'recipe.yml'), '- object: Contact\n  fields:\n    LastName: x\n');
                writeObjectsWrapper(JSON.stringify({ ObjectToObjectInfoMap: { Contact: {} }, RecipeFiles: [{ objects: ['Contact'] }] }));

                const actualRecipe = RecipeCockpitService.buildRecipeViewModel(temporaryWorkspaceRoot);

                expect(actualRecipe.objects.map(objectViewModel => objectViewModel.objectApiName)).toEqual(['Contact']);
                expect(actualRecipe.objects[0].fields[0]).toMatchObject({ fieldApiName: 'LastName', isOnlyInRecipeFile: true });

            });

            it('given a wrapper not named for its run\'s timestamp, still reads it', () => {

                fs.writeFileSync(path.join(runFolderPath, 'treecipeObjectsWrapper-renamed.json'), JSON.stringify({
                    ObjectToObjectInfoMap: { Account: { Fields: [{ fieldName: 'Industry' }] } }
                }));

                const [actualRun] = RecipeCockpitService.findGeneratedRecipeRuns(path.join(temporaryWorkspaceRoot, 'treecipe', 'GeneratedRecipes'));

                expect(path.basename(actualRun.objectsWrapperFilePath)).toBe('treecipeObjectsWrapper-renamed.json');

            });

            // A FAKER-JS AND A SNOWFAKERY RUN IN THE SAME SECOND STILL COME BACK IN ONE ORDER, EVERY TIME
            it('given two runs with the same timestamp, orders them by folder name', () => {

                const fakerJsRunFolderPath = path.join(temporaryWorkspaceRoot, 'treecipe', 'GeneratedRecipes', 'recipe-fakerjs-2026-01-01T00-00-00');
                fs.mkdirSync(fakerJsRunFolderPath);
                fs.writeFileSync(path.join(fakerJsRunFolderPath, 'treecipeObjectsWrapper-2026-01-01T00-00-00.json'), '{}');
                writeObjectsWrapper('{}');

                const actualRunFolderNames = RecipeCockpitService.findGeneratedRecipeRuns(path.join(temporaryWorkspaceRoot, 'treecipe', 'GeneratedRecipes'))
                    .map(run => run.runFolderName);

                expect(actualRunFolderNames).toEqual(['recipe-2026-01-01T00-00-00', 'recipe-fakerjs-2026-01-01T00-00-00']);

            });

            it('given a recipe file written directly in the run folder, locates its objects too', () => {

                fs.writeFileSync(path.join(runFolderPath, 'recipe.yml'), '- object: Account\n  fields:\n    Industry: x\n');
                writeObjectsWrapper(JSON.stringify({ ObjectToObjectInfoMap: { Account: { Fields: [{ fieldName: 'Industry' }] } } }));

                const [accountObject] = RecipeCockpitService.buildRecipeViewModel(temporaryWorkspaceRoot).objects;

                expect(accountObject.recipeFilePath).toBe(path.join(runFolderPath, 'recipe.yml'));
                expect(accountObject.fields[0].lineNumber).toBe(3);

            });

            // ONE UNREADABLE FILE COSTS THAT FILE'S SOURCE LINKS AND A NOTICE, NOT THE PANEL
            it('given a recipe file that cannot be read, lists its objects with a notice and nothing to open', () => {

                const recipeFilePath = path.join(runFolderPath, 'recipe.yml');
                fs.writeFileSync(recipeFilePath, '- object: Account\n');
                writeObjectsWrapper(JSON.stringify({ ObjectToObjectInfoMap: { Account: { Fields: [] } } }));

                // NOT AN Error, SO THE NOTICE HAS TO SAY WHAT IT WAS WITHOUT A .message TO READ
                const nonErrorThrowable: unknown = 'EACCES';
                const readFileSync = fs.readFileSync;
                jest.spyOn(fs, 'readFileSync').mockImplementation(((filePath: fs.PathOrFileDescriptor, options?: any) => {
                    if ( filePath === recipeFilePath ) {
                        throw nonErrorThrowable;
                    }
                    return readFileSync(filePath, options);
                }) as typeof fs.readFileSync);

                const actualRecipe = RecipeCockpitService.buildRecipeViewModel(temporaryWorkspaceRoot);

                expect(actualRecipe.objects[0].recipeFilePath).toBe('');
                expect(actualRecipe.notices).toEqual(['The recipe file "recipe.yml" could not be read (EACCES), so its objects and fields cannot be opened from here.']);

            });

            /*
                Every recipe path the model carries is something the host can be asked to open, so
                one that resolves outside the workspace is not offered: the object is listed, with
                nothing to open. The treecipe folder itself is the link here, because a symlinked
                FILE or subfolder is already skipped by the Dirent checks and would not reach the
                containment check at all.
            */
            it('given a treecipe folder that links outside the workspace, lists the objects without a file to open', () => {

                const outsideDirectoryPath = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'recipeCockpitOutside-')));
                const linkedWorkspaceRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'recipeCockpitLinked-')));

                try {

                    const outsideRunFolderPath = path.join(outsideDirectoryPath, 'GeneratedRecipes', 'recipe-2026-01-01T00-00-00');
                    fs.mkdirSync(path.join(outsideRunFolderPath, 'Account-ONLY'), { recursive: true });
                    fs.writeFileSync(path.join(outsideRunFolderPath, 'Account-ONLY', 'recipe--Account-ONLY.yml'), '- object: Account\n  fields:\n    Industry: x\n');
                    fs.writeFileSync(
                        path.join(outsideRunFolderPath, 'treecipeObjectsWrapper-2026-01-01T00-00-00.json'),
                        JSON.stringify({ ObjectToObjectInfoMap: { Account: { Fields: [{ fieldName: 'Industry' }] } } })
                    );
                    fs.symlinkSync(outsideDirectoryPath, path.join(linkedWorkspaceRoot, 'treecipe'));

                    const actualRecipe = RecipeCockpitService.buildRecipeViewModel(linkedWorkspaceRoot);

                    expect(actualRecipe.objects.map(objectViewModel => objectViewModel.objectApiName)).toEqual(['Account']);
                    expect(actualRecipe.objects[0].recipeFilePath).toBe('');
                    expect(RecipeCockpitService.collectOpenableSourceKeys(actualRecipe)).toEqual([]);

                } finally {
                    fs.rmSync(linkedWorkspaceRoot, { recursive: true, force: true });
                    fs.rmSync(outsideDirectoryPath, { recursive: true, force: true });
                }

            });

        });

    });

    describe('normalizeObjectsWrapper, recipe picklist values for the metadata diff', () => {

        const wrapperWithPicklists = {
            ObjectToObjectInfoMap: {
                Account: {
                    Fields: [
                        {
                            fieldName: 'Industry',
                            type: 'Picklist',
                            picklistValues: [
                                { picklistOptionApiName: 'Agriculture', label: 'Agriculture' },
                                { picklistOptionApiName: 'Banking', label: 'Banking', isActive: false },
                                { picklistOptionApiName: 'Retail', label: 'Retail', isActive: true },
                                { label: 'No api name' },
                                'not a record'
                            ]
                        },
                        { fieldName: 'Status__c', type: 'Picklist', picklistValues: [] },
                        {
                            fieldName: 'Sub_Industry__c',
                            type: 'Picklist',
                            controllingField: 'Industry',
                            picklistValues: [ { picklistOptionApiName: 'Dairy', label: 'Dairy', isActive: true } ]
                        },
                        { fieldName: 'Legacy_Code__c', type: 'Text' }
                    ]
                }
            },
            RecipeFiles: [ { objects: ['Account'] } ]
        };

        it('records each picklist field\'s active values, keyed by object and field', () => {

            const normalizedWrapper = RecipeCockpitService.normalizeObjectsWrapper(wrapperWithPicklists);

            expect(normalizedWrapper.picklistValuesByObjectApiName).toEqual(new Map([
                ['Account', new Map([['Industry', ['Agriculture', 'Retail']], ['Status__c', []]])]
            ]));

        });

        it('records nothing for a dependent picklist, whose values may be only the ones its valueSettings name', () => {

            const normalizedWrapper = RecipeCockpitService.normalizeObjectsWrapper(wrapperWithPicklists);

            expect(normalizedWrapper.picklistValuesByObjectApiName.get('Account')?.has('Sub_Industry__c')).toBe(false);
            expect(normalizedWrapper.objects[0].fields.map(fieldViewModel => fieldViewModel.fieldApiName)).toContain('Sub_Industry__c');

        });

        it('records nothing for a field whose wrapper entry carries no picklist values', () => {

            const normalizedWrapper = RecipeCockpitService.normalizeObjectsWrapper(wrapperWithPicklists);

            expect(normalizedWrapper.picklistValuesByObjectApiName.get('Account')?.has('Legacy_Code__c')).toBe(false);

        });

        it('keeps the values off the field view model, so the posted payload does not grow', () => {

            const normalizedWrapper = RecipeCockpitService.normalizeObjectsWrapper(wrapperWithPicklists);

            normalizedWrapper.objects.forEach(objectViewModel => objectViewModel.fields.forEach(fieldViewModel => {
                expect(Object.keys(fieldViewModel)).not.toContain('picklistValues');
            }));

        });

        it('records nothing when the file is not an objects wrapper', () => {

            expect(RecipeCockpitService.normalizeObjectsWrapper({ unrelated: true }).picklistValuesByObjectApiName.size).toBe(0);

        });

    });

    describe('parseRecipeSource', () => {

        it('locates each object header and each field line, and collects a field\'s continuation lines', () => {

            const actualEntries = RecipeCockpitService.parseRecipeSource(fs.readFileSync(LATEST_RECIPE_FILE_PATH, 'utf-8'));

            expect(Array.from(actualEntries.keys())).toEqual(['Account', 'Contact']);

            const accountEntry = actualEntries.get('Account');
            expect(accountEntry.lineNumber).toBe(7);
            expect(Array.from(accountEntry.fieldEntries.keys())).toEqual(['Name', 'Industry', 'Industry_Group__c', 'Number_of_Contacts__c']);
            expect(accountEntry.fieldEntries.get('Industry_Group__c').valueText).toBe("if:\n    - choice:\n        when: ${{ Industry == 'Agriculture' }}\n        pick: Ag Co-op");

            // nickname AND count SIT AT TWO SPACES, OUTSIDE THE FIELDS BLOCK
            expect(accountEntry.fieldEntries.has('nickname')).toBe(false);

        });

        // A COMMENT AT COLUMN ZERO BETWEEN TWO OBJECTS IS NOT PART OF THE FIELD ABOVE IT
        it('ends an object at a column-zero line that is not an object header', () => {

            const recipeContent = [
                '- object: Account',
                '  fields:',
                '    Industry: x',
                '# Level 1 - Contact',
                '    Stray: y'
            ].join('\n');

            const accountEntry = RecipeCockpitService.parseRecipeSource(recipeContent).get('Account');

            expect(Array.from(accountEntry.fieldEntries.keys())).toEqual(['Industry']);
            expect(accountEntry.fieldEntries.get('Industry').valueText).toBe('x');

        });

        it('keeps the first occurrence of an object and of a field, and reads CRLF files', () => {

            const recipeContent = [
                '- object: Account',
                '  fields:',
                '    Industry: first',
                '    Industry: second',
                '        continuation of the ignored duplicate',
                '- object: Account',
                '  fields:',
                '    Rating: ignored'
            ].join('\r\n');

            const actualEntries = RecipeCockpitService.parseRecipeSource(recipeContent);
            const accountEntry = actualEntries.get('Account');

            expect(accountEntry.lineNumber).toBe(1);
            expect(accountEntry.fieldEntries.get('Industry')).toEqual({ lineNumber: 3, valueText: 'first' });
            expect(accountEntry.fieldEntries.has('Rating')).toBe(false);

        });

    });

    describe('buildDisplayExpression', () => {

        it.each([
            ['a single line', ['${{ x }}'], '${{ x }}'],
            ['a literal block scalar', ['|', '        ${{ x }}'], '${{ x }}'],
            ['a folded block scalar with a chomping indicator', [' >-', '   a', '', '   b'], 'a\nb'],
            ['nothing at all', [''], ''],
            // THE RELATIVE INDENTATION IS WHICH "pick" BELONGS TO WHICH "when"
            ['a nested block', ['', '        if:', '            - choice:', '                pick: a'], 'if:\n    - choice:\n        pick: a'],
            ['a value longer than the engine\'s argument limit', ['|', ...Array.from({ length: 200000 }, () => '    x')], Array.from({ length: 200000 }, () => 'x').join('\n')],
            ['a leading value with continuation lines', [' ### TODO: pick one', '                    Account.Retail', '                    Account.Bank'], '### TODO: pick one\nAccount.Retail\nAccount.Bank']
        ])('given %s, keeps only the structure a reader needs', (unusedDescription, expressionLines, expectedExpression) => {

            expect(RecipeCockpitService.buildDisplayExpression(expressionLines)).toBe(expectedExpression);

        });

    });

    describe('collectOpenableSourceKeys', () => {

        it('names every object and field line the model offers to open, and nothing it does not', () => {

            const recipe = RecipeCockpitService.buildRecipeViewModel(MOCK_WORKSPACE_ROOT);

            const actualKeys = RecipeCockpitService.collectOpenableSourceKeys(recipe);

            expect(actualKeys).toContain(RecipeCockpitService.buildOpenSourceKey(LATEST_RECIPE_FILE_PATH, 7));
            expect(actualKeys).toContain(RecipeCockpitService.buildOpenSourceKey(LATEST_RECIPE_FILE_PATH, 11));
            // Account (1 + 4 LOCATED FIELDS) AND Contact (1 + 2) -- Legacy_Code__c HAS NO LINE
            expect(actualKeys).toHaveLength(8);

        });

    });

    describe('routePanelMessage', () => {

        let panelState: IRecipeCockpitPanelState;

        beforeEach(() => {
            panelState = RecipeCockpitService.buildInitialPanelState(MOCK_WORKSPACE_ROOT);
        });

        const withRenderedRecipe = () => {
            panelState.recipeDataMessage = { command: 'recipeData', recipe: buildRecipeViewModel(), renderSequence: 7 };
            panelState.openableSourceKeys = new Set([RecipeCockpitService.buildOpenSourceKey('/workspace/recipe.yml', 12)]);
            panelState.selectableRunFolderNames = new Set([LATEST_RUN_FOLDER_NAME]);
        };

        describe('ready', () => {

            it('given nothing loaded yet, replays the phase the load is in', () => {

                panelState.loadPhaseMessage = RECIPE_COCKPIT_LOAD_PHASES.findingRuns;

                expect(RecipeCockpitService.routePanelMessage({ command: 'ready' }, panelState)).toEqual({
                    kind: 'replay',
                    hostMessages: [{ command: 'loadPhase', message: RECIPE_COCKPIT_LOAD_PHASES.findingRuns }]
                });

            });

            it('given a rendered model, replays the model', () => {

                withRenderedRecipe();

                expect(RecipeCockpitService.routePanelMessage({ command: 'ready' }, panelState)).toEqual({
                    kind: 'replay',
                    hostMessages: [panelState.recipeDataMessage]
                });

            });

            // THE STRUCTURE STAYS WORTH SHOWING, AND THE READER STILL HAS TO BE TOLD THE LOAD BEHIND IT DIED
            // THE DESCRIBE IS DRAWN OVER THE MODEL IT DESCRIBED, SO IT CAN ONLY FOLLOW IT
            it('given a model and an org describe of it, replays the describe after the model and before a failure', () => {

                withRenderedRecipe();
                panelState.orgDescribeMessage = RecipeCockpitService.buildOrgConnectionFailureMessage('devhub', new Error('expired'), 7);
                panelState.loadFailedMessage = { command: 'loadFailed', message: 'it broke' };

                expect(RecipeCockpitService.routePanelMessage({ command: 'ready' }, panelState)).toEqual({
                    kind: 'replay',
                    hostMessages: [panelState.recipeDataMessage, panelState.orgDescribeMessage, panelState.loadFailedMessage]
                });

            });

            it('given a model and then a failed load, replays both, the failure last', () => {

                withRenderedRecipe();
                panelState.loadFailedMessage = { command: 'loadFailed', message: 'it broke' };

                expect(RecipeCockpitService.routePanelMessage({ command: 'ready' }, panelState)).toEqual({
                    kind: 'replay',
                    hostMessages: [panelState.recipeDataMessage, panelState.loadFailedMessage]
                });

            });

        });

        describe('rendered', () => {

            it('given the model that was sent, activates the actions it offers', () => {

                withRenderedRecipe();

                expect(RecipeCockpitService.routePanelMessage({ command: 'rendered', renderSequence: 7 }, panelState)).toEqual({ kind: 'activateActions' });

            });

            /*
                A replayed model's ack can land after a newer load has posted. Promoting the newer
                model's targets on it would honour rows that are not on screen yet, and refuse the
                ones that are.
            */
            it.each([
                ['an earlier model', 6],
                ['no model at all', undefined]
            ])('given the acknowledgement of %s, activates nothing', (unusedDescription, renderSequence) => {

                withRenderedRecipe();

                expect(RecipeCockpitService.routePanelMessage({ command: 'rendered', renderSequence }, panelState)).toBeUndefined();

            });

            it('given no model was ever sent, is ignored', () => {

                expect(RecipeCockpitService.routePanelMessage({ command: 'rendered' }, panelState)).toBeUndefined();

            });

        });

        describe('renderFailed', () => {

            it('given a failure to draw, reports it and invalidates the panel', () => {

                withRenderedRecipe();

                expect(RecipeCockpitService.routePanelMessage(
                    { command: 'renderFailed', phase: 'render', message: 'boom', stack: 'at renderPanel' },
                    panelState
                )).toEqual({ kind: 'reportRenderFailure', failureDescription: 'boom', failureStack: 'at renderPanel', invalidatesPanel: true });

            });

            // A HANDLER THAT THREW ON A KEYSTROKE LEAVES THE ROWS ON SCREEN AND READABLE
            it('given a runtime throw after a successful draw, reports it without invalidating the panel', () => {

                withRenderedRecipe();

                const actualAction = RecipeCockpitService.routePanelMessage({ command: 'renderFailed', phase: 'runtime', message: 'boom' }, panelState);

                expect(actualAction).toMatchObject({ kind: 'reportRenderFailure', invalidatesPanel: false, failureStack: '' });

            });

            it('given a failure with no description, reports it as an unknown error', () => {

                withRenderedRecipe();

                expect(RecipeCockpitService.routePanelMessage({ command: 'renderFailed', message: { not: 'a string' } }, panelState))
                    .toMatchObject({ kind: 'reportRenderFailure', failureDescription: 'unknown error' });

            });

            it('given a failure already reported, is not reported again', () => {

                withRenderedRecipe();
                panelState.reportedFailureDescriptions.add('boom');

                expect(RecipeCockpitService.routePanelMessage({ command: 'renderFailed', message: 'boom' }, panelState)).toBeUndefined();

            });

            it('given no model was ever sent, is ignored', () => {

                expect(RecipeCockpitService.routePanelMessage({ command: 'renderFailed', message: 'boom' }, panelState)).toBeUndefined();

            });

        });

        describe('openSource', () => {

            it('given a file and line the rendered model named, opens it', () => {

                withRenderedRecipe();

                expect(RecipeCockpitService.routePanelMessage(
                    { command: 'openSource', filePath: '/workspace/recipe.yml', lineNumber: 12 },
                    panelState
                )).toEqual({ kind: 'openSource', filePath: '/workspace/recipe.yml', lineNumber: 12 });

            });

            /*
                The allow-list is MATCHED, never used to validate a path. A file the model named at a
                line it did not, a file it never named, and a value of the wrong type are all refused
                the same way.
            */
            it.each([
                ['a line the model did not name', { filePath: '/workspace/recipe.yml', lineNumber: 13 }],
                ['a file the model did not name', { filePath: '/etc/passwd', lineNumber: 12 }],
                ['a line number posted as a string', { filePath: '/workspace/recipe.yml', lineNumber: '12' }],
                ['a fractional line number', { filePath: '/workspace/recipe.yml', lineNumber: 12.5 }],
                ['a file path that is not a string', { filePath: ['/workspace/recipe.yml'], lineNumber: 12 }]
            ])('given %s, opens nothing', (unusedDescription, openSourcePayload) => {

                withRenderedRecipe();

                expect(RecipeCockpitService.routePanelMessage({ command: 'openSource', ...openSourcePayload }, panelState)).toBeUndefined();

            });

            it('given the panel has not confirmed drawing anything, opens nothing', () => {

                panelState.pendingOpenableSourceKeys = new Set([RecipeCockpitService.buildOpenSourceKey('/workspace/recipe.yml', 12)]);

                expect(RecipeCockpitService.routePanelMessage(
                    { command: 'openSource', filePath: '/workspace/recipe.yml', lineNumber: 12 },
                    panelState
                )).toBeUndefined();

            });

        });

        describe('selectRun', () => {

            it('given a run the rendered selector offered, loads it', () => {

                withRenderedRecipe();

                expect(RecipeCockpitService.routePanelMessage({ command: 'selectRun', runFolderName: LATEST_RUN_FOLDER_NAME }, panelState))
                    .toEqual({ kind: 'selectRun', runFolderName: LATEST_RUN_FOLDER_NAME });

            });

            it.each([
                ['a run the selector did not offer', '../../elsewhere'],
                ['a run name that is not a string', 42]
            ])('given %s, loads nothing', (unusedDescription, runFolderName) => {

                withRenderedRecipe();

                expect(RecipeCockpitService.routePanelMessage({ command: 'selectRun', runFolderName }, panelState)).toBeUndefined();

            });

        });

        describe('selectOrg', () => {

            it('given a rendered model with objects, asks the host to describe them', () => {

                withRenderedRecipe();
                panelState.describableObjectApiNames = new Set(['Account']);

                expect(RecipeCockpitService.routePanelMessage({ command: 'selectOrg' }, panelState)).toEqual({ kind: 'selectOrg' });

            });

            // WHICH OBJECTS ARE DESCRIBED IS THE HOST'S MODEL, SO NOTHING THE PANEL POSTS ALONGSIDE CAN WIDEN IT
            it('ignores any payload posted with it', () => {

                withRenderedRecipe();
                panelState.describableObjectApiNames = new Set(['Account']);

                expect(RecipeCockpitService.routePanelMessage({ command: 'selectOrg', objectApiNames: ['User'] } as any, panelState)).toEqual({ kind: 'selectOrg' });

            });

            it('given the panel has not confirmed drawing the model, describes nothing', () => {

                withRenderedRecipe();
                panelState.pendingDescribableObjectApiNames = new Set(['Account']);

                expect(RecipeCockpitService.routePanelMessage({ command: 'selectOrg' }, panelState)).toBeUndefined();

            });

            it('given a describe is already picking or running, starts no second one', () => {

                withRenderedRecipe();
                panelState.describableObjectApiNames = new Set(['Account']);
                panelState.isOrgDescribeInFlight = true;

                expect(RecipeCockpitService.routePanelMessage({ command: 'selectOrg' }, panelState)).toBeUndefined();

            });

        });

        it.each([
            ['an unrecognized command', { command: 'traverseRecipe' }],
            ['a message with no command at all', {}],
            ['nothing at all', undefined]
        ])('given %s, answers with nothing', (unusedDescription, panelMessage) => {

            expect(RecipeCockpitService.routePanelMessage(panelMessage, panelState)).toBeUndefined();

        });

    });

    describe('buildOrgLabel', () => {

        it('names the alias with the username it points at, or the username alone', () => {

            expect(RecipeCockpitService.buildOrgLabel({ targetOrgIdentifier: 'devhub', username: 'jd@example.com', alias: 'devhub' })).toBe('devhub (jd@example.com)');
            expect(RecipeCockpitService.buildOrgLabel({ targetOrgIdentifier: 'jd@example.com', username: 'jd@example.com' })).toBe('jd@example.com');

        });

    });

    describe('buildOrgDescribeMessage', () => {

        const accountDescribe = { objectApiName: 'Account', objectLabel: 'Account', fields: [] as any[] };

        it('given every object described, counts them and each one\'s fields', () => {

            const orgDescribeMessage = RecipeCockpitService.buildOrgDescribeMessage('devhub', {
                outcomes: [{ objectApiName: 'Account', describe: { ...accountDescribe, fields: [{}, {}, {}] as any[] }, wasCached: false }],
                wasCancelled: false
            }, 3);

            expect(orgDescribeMessage).toEqual({
                command: 'orgDescribe',
                orgLabel: 'devhub',
                summary: 'Described in devhub: 1 of 1 object described.',
                isFailure: false,
                isCancelled: false,
                objects: [{ objectApiName: 'Account', isDescribed: true, describedFieldCount: 3, failureMessage: '' }],
                renderSequence: 3
            });

        });

        it('given some objects failed, says how many and carries each failure on its object', () => {

            const orgDescribeMessage = RecipeCockpitService.buildOrgDescribeMessage('devhub', {
                outcomes: [
                    { objectApiName: 'Account', describe: accountDescribe, wasCached: true },
                    { objectApiName: 'Widget__c', failureMessage: 'NOT_FOUND: The requested resource does not exist', wasCached: false },
                    { objectApiName: 'Gadget__c', wasCached: false }
                ],
                wasCancelled: false
            }, 3);

            expect(orgDescribeMessage.summary).toBe('Described in devhub: 1 of 3 objects described (1 from this session\'s cache). 2 could not be described.');
            expect(orgDescribeMessage.objects.map(objectSummary => objectSummary.failureMessage)).toEqual([
                '',
                'NOT_FOUND: The requested resource does not exist',
                'unknown error'
            ]);

        });

        it('given the describe was cancelled, says so rather than reporting the rest as failures', () => {

            const orgDescribeMessage = RecipeCockpitService.buildOrgDescribeMessage('devhub', {
                outcomes: [
                    { objectApiName: 'Account', describe: accountDescribe, wasCached: false },
                    { objectApiName: 'Contact', failureMessage: ORG_DESCRIBE_CANCELLED_MESSAGE, wasCached: false }
                ],
                wasCancelled: true
            }, 3);

            expect(orgDescribeMessage.summary).toBe('The describe in devhub was cancelled: 1 of 2 objects described.');
            expect(orgDescribeMessage.isCancelled).toBe(true);

        });

    });

    describe('buildOrgConnectionFailureMessage', () => {

        it('says the org could not be reached, why, and how to fix it', () => {

            expect(RecipeCockpitService.buildOrgConnectionFailureMessage('devhub', new Error('No authorization information found for devhub.'), 4)).toEqual({
                command: 'orgDescribe',
                orgLabel: 'devhub',
                summary: 'Could not connect to devhub: No authorization information found for devhub.. Re-authorize the org with "sf org login web" and try again.',
                isFailure: true,
                isCancelled: false,
                objects: [],
                renderSequence: 4
            });

        });

        it('given something thrown that is not an Error, still says what it was', () => {

            expect(RecipeCockpitService.buildOrgConnectionFailureMessage('devhub', 'ECONNRESET', 4).summary).toContain('Could not connect to devhub: ECONNRESET.');

        });

    });

    /*
        Runs the panel's ACTUAL script against a fake DOM.

        Asserting on the shell as a string says a listener is present; it says nothing about what
        it does with what it receives. The fake answers classList.contains from the classes an
        element actually CARRIES -- including those set through className -- because the panel
        collapses an object body by creating it with the "hidden" class.
    */
    function runPanelScript() {

        const postedHostMessages: any[] = [];
        const windowListenersByType: Record<string, Function> = {};

        const buildFakeElement = (tagName: string, initialClassName = ''): any => {

            const carriedClassNames = new Set<string>();
            const applyClassName = (nextClassName: string) => {
                carriedClassNames.clear();
                String(nextClassName || '').split(' ').filter(className => !!className).forEach(className => carriedClassNames.add(className));
            };
            applyClassName(initialClassName);

            const listenersByEventType: Record<string, Function[]> = {};

            return {
                tagName: tagName,
                attributes: {} as Record<string, string>,
                value: '',
                selected: false,
                children: [] as any[],
                ownTextContent: '',
                get className() { return Array.from(carriedClassNames).join(' '); },
                set className(nextClassName: string) { applyClassName(nextClassName); },
                // ASSIGNING '' IS HOW THE PANEL CLEARS A CONTAINER, SO IT HAS TO DROP THE CHILDREN TOO
                get textContent() { return this.ownTextContent; },
                set textContent(nextTextContent: string) {
                    this.ownTextContent = nextTextContent;
                    this.children.length = 0;
                },
                classList: {
                    add(className: string) { carriedClassNames.add(className); },
                    remove(className: string) { carriedClassNames.delete(className); },
                    contains(className: string) { return carriedClassNames.has(className); }
                },
                setAttribute(attributeName: string, attributeValue: string) { this.attributes[attributeName] = String(attributeValue); },
                appendChild(childElement: any) { this.children.push(childElement); return childElement; },
                addEventListener(eventType: string, listener: Function) {
                    (listenersByEventType[eventType] = listenersByEventType[eventType] || []).push(listener);
                },
                dispatch(eventType: string) { (listenersByEventType[eventType] || []).forEach(listener => listener({})); }
            };

        };

        const loadStatusElement = buildFakeElement('div', 'loadStatus');
        loadStatusElement.textContent = RECIPE_COCKPIT_PENDING_ACKNOWLEDGEMENT;
        const cockpitBodyElement = buildFakeElement('div');

        const fakeDocument = {
            getElementById: (elementId: string) => ({ loadStatus: loadStatusElement, cockpitBody: cockpitBodyElement } as any)[elementId],
            createElement: (tagName: string) => buildFakeElement(tagName)
        };

        const fakeWindow = {
            addEventListener: (eventType: string, listener: Function) => { windowListenersByType[eventType] = listener; }
        };

        const acquireVsCodeApi = () => ({ postMessage: (hostMessage: any) => { postedHostMessages.push(hostMessage); } });

        const shellHtml = RecipeCockpitService.buildWebviewShellHtml('testNonce');
        const panelScript = shellHtml.substring(
            shellHtml.indexOf('<script nonce="testNonce">') + '<script nonce="testNonce">'.length,
            shellHtml.lastIndexOf('</script>')
        );

        // RUNNING THE REAL PANEL SCRIPT IS THE POINT OF THIS HARNESS
        new Function('document', 'window', 'acquireVsCodeApi', panelScript)(fakeDocument, fakeWindow, acquireVsCodeApi);

        const findAll = (rootElement: any, className: string): any[] => {
            const matchingElements: any[] = [];
            const visit = (element: any) => {
                if (element.classList.contains(className)) { matchingElements.push(element); }
                element.children.forEach(visit);
            };
            visit(rootElement);
            return matchingElements;
        };

        const isHidden = (element: any) => element.classList.contains('hidden');

        const objectElements = () => findAll(cockpitBodyElement, 'object');
        const objectHeaderOf = (objectElement: any) => objectElement.children[0];
        const objectBodyOf = (objectElement: any) => objectElement.children[1];

        return {
            postedHostMessages,
            loadStatusElement,
            cockpitBodyElement,
            findAll,
            isHidden,
            objectElements,
            objectBodyOf,
            objectNameOf: (objectElement: any) => findAll(objectHeaderOf(objectElement), 'objectName')[0].textContent,
            objectCountOf: (objectElement: any) => findAll(objectHeaderOf(objectElement), 'objectCount')[0].textContent,
            visibleFieldNamesOf: (objectElement: any) => findAll(objectBodyOf(objectElement), 'field')
                .filter(fieldElement => !isHidden(fieldElement))
                .map(fieldElement => findAll(fieldElement, 'fieldName')[0].textContent),
            typeIntoFilter: (filterText: string) => {
                const filterInputElement = findAll(cockpitBodyElement, 'filterInput')[0];
                filterInputElement.value = filterText;
                filterInputElement.dispatch('input');
            },
            postToPanel: (hostMessage: any) => windowListenersByType['message']({ data: hostMessage }),
            raiseWindowError: (errorEvent: any) => windowListenersByType['error'](errorEvent)
        };

    }

    describe('the panel script, executed', () => {

        const renderFixtureRecipe = () => {
            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: RecipeCockpitService.buildRecipeViewModel(MOCK_WORKSPACE_ROOT), renderSequence: 1 });
            return panel;
        };

        it('announces itself ready on load, and shows it is still connecting until the host answers', () => {

            const panel = runPanelScript();

            expect(panel.postedHostMessages).toEqual([{ command: 'ready' }]);
            expect(panel.loadStatusElement.textContent).toBe(RECIPE_COCKPIT_PENDING_ACKNOWLEDGEMENT);

        });

        it('reports each load phase the host sends in its status line', () => {

            const panel = runPanelScript();

            panel.postToPanel({ command: 'loadPhase', message: RECIPE_COCKPIT_LOAD_PHASES.readingRun });

            expect(panel.loadStatusElement.textContent).toBe(RECIPE_COCKPIT_LOAD_PHASES.readingRun);
            expect(panel.isHidden(panel.loadStatusElement)).toBe(false);

        });

        it('given the recipe, draws the find box first, lists every object collapsed, and acknowledges the draw', () => {

            const panel = renderFixtureRecipe();

            expect(panel.cockpitBodyElement.children[0].classList.contains('toolbar')).toBe(true);
            expect(panel.findAll(panel.cockpitBodyElement.children[0], 'filterInput')).toHaveLength(1);

            expect(panel.objectElements().map(panel.objectNameOf)).toEqual(['Account', 'Contact']);
            expect(panel.objectElements().map(panel.objectCountOf)).toEqual(['5 fields', '2 fields']);
            expect(panel.findAll(panel.cockpitBodyElement, 'matchCount')[0].textContent).toBe('7 fields · 2 objects');

            // ROWS ARE BUILT ON FIRST EXPAND, SO A COLLAPSED OBJECT HAS NONE
            expect(panel.objectElements().every(objectElement => panel.isHidden(panel.objectBodyOf(objectElement)))).toBe(true);
            expect(panel.findAll(panel.cockpitBodyElement, 'field')).toEqual([]);

            expect(panel.findAll(panel.cockpitBodyElement, 'notice').map(notice => notice.textContent)).toEqual([
                '1 field entry in the objects wrapper had no field api name and is not shown.'
            ]);
            expect(panel.postedHostMessages).toContainEqual({ command: 'rendered', renderSequence: 1 });
            expect(panel.isHidden(panel.loadStatusElement)).toBe(true);

        });

        it('given an object is expanded, builds its rows with each field\'s type, controlling field and faker expression', () => {

            const panel = renderFixtureRecipe();
            const [accountElement] = panel.objectElements();

            panel.findAll(accountElement, 'toggle')[0].dispatch('click');

            expect(panel.isHidden(panel.objectBodyOf(accountElement))).toBe(false);
            expect(panel.visibleFieldNamesOf(accountElement)).toEqual(['Name', 'Industry', 'Industry_Group__c', 'Number_of_Contacts__c', 'Legacy_Code__c']);

            const industryGroupRow = panel.findAll(accountElement, 'field')[2];
            expect(panel.findAll(industryGroupRow, 'fieldType')[0].textContent).toBe('Picklist');
            expect(panel.findAll(industryGroupRow, 'controllingField')[0].textContent).toBe('← controlled by Industry');
            expect(panel.findAll(industryGroupRow, 'expression')[0].textContent).toContain("when: ${{ Industry == 'Agriculture' }}");

            const nameRow = panel.findAll(accountElement, 'field')[0];
            expect(panel.findAll(nameRow, 'recipeFileOnly')).toHaveLength(1);

        });

        /*
            An object with no match stays on screen, collapsed and labelled: hiding it would make a
            filter look like a truncation.
        */
        it('given a filter, narrows fields live and labels an object with no match rather than hiding it', () => {

            const panel = renderFixtureRecipe();
            const [accountElement, contactElement] = panel.objectElements();

            panel.typeIntoFilter('industry');

            expect(panel.isHidden(panel.objectBodyOf(accountElement))).toBe(false);
            expect(panel.visibleFieldNamesOf(accountElement)).toEqual(['Industry', 'Industry_Group__c']);
            expect(panel.objectCountOf(accountElement)).toBe('2 of 5 fields');

            expect(panel.isHidden(contactElement)).toBe(false);
            expect(panel.isHidden(panel.objectBodyOf(contactElement))).toBe(true);
            expect(panel.objectCountOf(contactElement)).toBe('no matching fields');

            expect(panel.findAll(panel.cockpitBodyElement, 'matchCount')[0].textContent).toBe('2 of 7 fields · 1 of 2 objects');

        });

        it('given a filter naming an object, shows all of that object\'s fields', () => {

            const panel = renderFixtureRecipe();
            const [, contactElement] = panel.objectElements();

            panel.typeIntoFilter('  CONTACT ');

            expect(panel.visibleFieldNamesOf(contactElement)).toEqual(['LastName', 'AccountId']);
            expect(panel.objectCountOf(contactElement)).toBe('2 fields');

        });

        it('matches a field by its faker expression', () => {

            const panel = renderFixtureRecipe();
            const [accountElement] = panel.objectElements();

            panel.typeIntoFilter('random_number');

            expect(panel.visibleFieldNamesOf(accountElement)).toEqual(['Number_of_Contacts__c']);

        });

        it('given the filter is cleared, shows every field and puts back the objects the reader had open', () => {

            const panel = renderFixtureRecipe();
            const [accountElement, contactElement] = panel.objectElements();

            panel.findAll(contactElement, 'toggle')[0].dispatch('click');
            panel.typeIntoFilter('industry');
            expect(panel.isHidden(panel.objectBodyOf(contactElement))).toBe(true);

            panel.typeIntoFilter('');

            expect(panel.isHidden(panel.objectBodyOf(accountElement))).toBe(true);
            expect(panel.isHidden(panel.objectBodyOf(contactElement))).toBe(false);
            expect(panel.objectCountOf(accountElement)).toBe('5 fields');
            expect(panel.findAll(accountElement, 'field').every(fieldElement => !panel.isHidden(fieldElement))).toBe(true);

        });

        // WHAT A KEYSTROKE COSTS IS BOUNDED BY WHAT IT EXPANDS, NOT BY WHAT IT MATCHES
        it('expands at most the auto-expand limit of matching objects, and leaves the rest collapsed with their counts', () => {

            const manyObjects = Array.from({ length: RECIPE_COCKPIT_AUTO_EXPAND_OBJECT_LIMIT + 5 }, (unusedValue, objectIndex) => ({
                objectApiName: `Object${objectIndex}__c`,
                recipeFilePath: '',
                recipeFileName: '',
                fields: [{ fieldApiName: 'Shared__c', fieldLabel: '', fieldType: 'Text', recipeValue: '', controllingField: '', isOnlyInRecipeFile: false }]
            }));

            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: buildRecipeViewModel({ objects: manyObjects }) });

            panel.typeIntoFilter('shared');

            const expandedObjectElements = panel.objectElements().filter(objectElement => !panel.isHidden(panel.objectBodyOf(objectElement)));
            expect(expandedObjectElements).toHaveLength(RECIPE_COCKPIT_AUTO_EXPAND_OBJECT_LIMIT);
            expect(panel.objectCountOf(panel.objectElements()[RECIPE_COCKPIT_AUTO_EXPAND_OBJECT_LIMIT])).toBe('1 of 1 field');

        });

        /*
            An expand builds every row of the object, so the object limit alone lets 25 wide objects
            build 20,000 rows on one keystroke. The first match always opens, however wide.
        */
        it('stops opening objects once the next would pass the row budget, and always opens the first', () => {

            const buildWideObject = (objectApiName: string, fieldCount: number) => ({
                objectApiName: objectApiName,
                recipeFilePath: '',
                recipeFileName: '',
                fields: Array.from({ length: fieldCount }, (unusedValue, fieldIndex) => ({
                    fieldApiName: `Shared_${fieldIndex}__c`, fieldLabel: '', fieldType: 'Text', recipeValue: '', controllingField: '', isOnlyInRecipeFile: false
                }))
            });

            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', renderSequence: 1, recipe: buildRecipeViewModel({ objects: [
                buildWideObject('Widest__c', RECIPE_COCKPIT_AUTO_EXPAND_ROW_BUDGET + 1),
                buildWideObject('Narrow__c', 1),
                buildWideObject('AlsoNarrow__c', 1)
            ] }) });

            panel.typeIntoFilter('shared');

            expect(panel.objectElements().map(objectElement => !panel.isHidden(panel.objectBodyOf(objectElement)))).toEqual([true, false, false]);
            expect(panel.objectCountOf(panel.objectElements()[1])).toBe('1 of 1 field');

        });

        it('given a field or object name is clicked, asks the host to open that line of the recipe file', () => {

            const panel = renderFixtureRecipe();
            const [accountElement] = panel.objectElements();

            panel.findAll(accountElement, 'objectName')[0].dispatch('click');
            panel.findAll(accountElement, 'toggle')[0].dispatch('click');
            panel.findAll(accountElement, 'fieldName')[1].dispatch('click');

            expect(panel.postedHostMessages).toContainEqual({ command: 'openSource', filePath: LATEST_RECIPE_FILE_PATH, lineNumber: 7 });
            expect(panel.postedHostMessages).toContainEqual({ command: 'openSource', filePath: LATEST_RECIPE_FILE_PATH, lineNumber: 12 });

        });

        it('offers nothing to click for a field the recipe file does not carry', () => {

            const panel = renderFixtureRecipe();
            const [accountElement] = panel.objectElements();

            panel.findAll(accountElement, 'toggle')[0].dispatch('click');
            const legacyCodeRow = panel.findAll(accountElement, 'field')[4];

            expect(panel.findAll(legacyCodeRow, 'fieldName')[0].tagName).toBe('span');
            expect(panel.findAll(legacyCodeRow, 'sourceLink')).toEqual([]);

        });

        it('offers every run in a selector, the loaded one selected, and asks the host for the one chosen', () => {

            const panel = renderFixtureRecipe();
            const runSelectElement = panel.findAll(panel.cockpitBodyElement, 'runSelect')[0];

            expect(runSelectElement.children.map((runOption: any) => [runOption.value, runOption.selected])).toEqual([
                [LATEST_RUN_FOLDER_NAME, true],
                [FAKER_JS_RUN_FOLDER_NAME, false]
            ]);

            runSelectElement.value = FAKER_JS_RUN_FOLDER_NAME;
            runSelectElement.dispatch('change');

            expect(panel.postedHostMessages).toContainEqual({ command: 'selectRun', runFolderName: FAKER_JS_RUN_FOLDER_NAME });

        });

        it('given no generated run, shows the empty state naming Generate Treecipe and no find box', () => {

            const panel = runPanelScript();

            panel.postToPanel({ command: 'recipeData', recipe: RecipeCockpitService.buildRecipeViewModel(path.join(MOCK_WORKSPACE_ROOT, 'doesNotExist')) });

            expect(panel.findAll(panel.cockpitBodyElement, 'emptyState')[0].textContent).toBe(RECIPE_COCKPIT_NO_RUN_MESSAGE);
            expect(panel.findAll(panel.cockpitBodyElement, 'filterInput')).toEqual([]);
            expect(panel.findAll(panel.cockpitBodyElement, 'runSelect')).toEqual([]);

        });

        it('given a run that could not be read, keeps the run selector so another run can be chosen', () => {

            const panel = runPanelScript();

            panel.postToPanel({ command: 'recipeData', recipe: buildRecipeViewModel({ emptyStateMessage: 'could not be read' }) });

            expect(panel.findAll(panel.cockpitBodyElement, 'runSelect')).toHaveLength(1);
            expect(panel.findAll(panel.cockpitBodyElement, 'emptyState')[0].textContent).toBe('could not be read');

        });

        // A PARTIAL PAGE IS AN ARBITRARY PREFIX OF THE MODEL, NOT A SMALLER CORRECT ANSWER
        it('given a model it cannot draw, replaces the body with a failure notice and reports the failure', () => {

            const panel = runPanelScript();

            panel.postToPanel({ command: 'recipeData', recipe: buildRecipeViewModel({ objects: [{ objectApiName: 'Account' } as any] }) });

            expect(panel.findAll(panel.cockpitBodyElement, 'object')).toEqual([]);
            expect(panel.findAll(panel.cockpitBodyElement, 'emptyState')[0].textContent).toContain('could not draw');
            expect(panel.postedHostMessages.map(hostMessage => hostMessage.command)).not.toContain('rendered');
            expect(panel.postedHostMessages).toContainEqual(expect.objectContaining({ command: 'renderFailed', phase: 'render' }));
            // THE STATUS LINE IS LEFT ALONE -- CLEARING IT WOULD READ AS A FINISHED LOAD
            expect(panel.isHidden(panel.loadStatusElement)).toBe(false);

        });

        it('given a throw outside the render, reports it as a runtime failure', () => {

            const panel = runPanelScript();

            panel.raiseWindowError({ message: 'lazy expand broke', type: 'error', error: { stack: 'at ensureObjectBodyBuilt' } });

            expect(panel.postedHostMessages).toContainEqual({
                command: 'renderFailed',
                phase: 'runtime',
                message: 'lazy expand broke',
                stack: 'at ensureObjectBodyBuilt'
            });

        });

        it('given a run fails to load, puts the selector back on the run whose rows are still on screen', () => {

            const panel = renderFixtureRecipe();
            const runSelectElement = panel.findAll(panel.cockpitBodyElement, 'runSelect')[0];

            runSelectElement.value = FAKER_JS_RUN_FOLDER_NAME;
            runSelectElement.dispatch('change');
            panel.postToPanel({ command: 'loadFailed', message: 'The Recipe Cockpit could not finish loading: EIO' });

            expect(runSelectElement.value).toBe(LATEST_RUN_FOLDER_NAME);

        });

        it('given the load failed, says so in the status line', () => {

            const panel = runPanelScript();

            panel.postToPanel({ command: 'loadFailed', message: 'The Recipe Cockpit could not finish loading: disk' });

            expect(panel.loadStatusElement.textContent).toBe('The Recipe Cockpit could not finish loading: disk');
            expect(panel.loadStatusElement.classList.contains('failed')).toBe(true);

        });

        it('given an unrecognized message or nothing at all, changes nothing', () => {

            const panel = runPanelScript();

            panel.postToPanel({ command: 'renderModel' });
            panel.postToPanel(undefined);

            expect(panel.loadStatusElement.textContent).toBe(RECIPE_COCKPIT_PENDING_ACKNOWLEDGEMENT);
            expect(panel.cockpitBodyElement.children).toEqual([]);

        });

    });

    describe('the panel script, describing in an org', () => {

        const renderFixtureRecipe = (renderSequence = 1) => {
            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: RecipeCockpitService.buildRecipeViewModel(MOCK_WORKSPACE_ROOT), renderSequence });
            return panel;
        };

        const describedFixture = (renderSequence: number) => RecipeCockpitService.buildOrgDescribeMessage('devhub (jd@example.com)', {
            outcomes: [
                { objectApiName: 'Account', describe: { objectApiName: 'Account', objectLabel: 'Account', fields: [{}, {}, {}] as any[] }, wasCached: false },
                { objectApiName: 'Contact', failureMessage: 'NOT_FOUND: The requested resource does not exist', wasCached: false }
            ],
            wasCancelled: false
        }, renderSequence);

        const orgDescribeStatusOf = (panel: any, objectElement: any) => panel.findAll(objectElement.children[0], 'orgDescribeStatus')[0];

        it('offers the describe beside the filter, and asks the host for it with no payload', () => {

            const panel = renderFixtureRecipe();
            const describeButtons = panel.findAll(panel.cockpitBodyElement.children[0], 'describeInOrg');

            expect(describeButtons).toHaveLength(1);
            expect(describeButtons[0].textContent).toBe(RECIPE_COCKPIT_DESCRIBE_ACTION_LABEL);

            describeButtons[0].dispatch('click');

            expect(panel.postedHostMessages[panel.postedHostMessages.length - 1]).toEqual({ command: 'selectOrg' });

        });

        it('given a run with no objects, offers nothing to describe', () => {

            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: buildRecipeViewModel({ emptyStateMessage: 'nothing here' }), renderSequence: 1 });

            expect(panel.findAll(panel.cockpitBodyElement, 'describeInOrg')).toEqual([]);

        });

        it('shows nothing about an org until one has been described', () => {

            const panel = renderFixtureRecipe();

            expect(panel.isHidden(panel.findAll(panel.cockpitBodyElement, 'orgStatus')[0])).toBe(true);
            expect(panel.objectElements().every((objectElement: any) => panel.isHidden(orgDescribeStatusOf(panel, objectElement)))).toBe(true);

        });

        it('given a describe of the rows on screen, draws its summary, each failure, and each object\'s answer on its header', () => {

            const panel = renderFixtureRecipe(4);
            panel.postToPanel(describedFixture(4));

            const orgStatusElement = panel.findAll(panel.cockpitBodyElement, 'orgStatus')[0];

            expect(panel.isHidden(orgStatusElement)).toBe(false);
            expect(orgStatusElement.classList.contains('failed')).toBe(false);
            expect(panel.findAll(orgStatusElement, 'orgDescribeSummary')[0].textContent)
                .toBe('Described in devhub (jd@example.com): 1 of 2 objects described. 1 could not be described.');
            expect(panel.findAll(orgStatusElement, 'orgDescribeFailure').map((failureElement: any) => failureElement.textContent))
                .toEqual(['Contact: NOT_FOUND: The requested resource does not exist']);

            expect(panel.objectElements().map((objectElement: any) => orgDescribeStatusOf(panel, objectElement).textContent))
                .toEqual(['org: 3 fields', 'not described in the org']);
            expect(panel.objectElements().every((objectElement: any) => !panel.isHidden(orgDescribeStatusOf(panel, objectElement)))).toBe(true);

        });

        it('given a connection failure, marks the summary as one', () => {

            const panel = renderFixtureRecipe(4);
            panel.postToPanel(RecipeCockpitService.buildOrgConnectionFailureMessage('devhub', new Error('expired'), 4));

            const orgStatusElement = panel.findAll(panel.cockpitBodyElement, 'orgStatus')[0];

            expect(orgStatusElement.classList.contains('failed')).toBe(true);
            expect(panel.objectElements().every((objectElement: any) => panel.isHidden(orgDescribeStatusOf(panel, objectElement)))).toBe(true);

        });

        // A DESCRIBE OF AN EARLIER RUN'S OBJECTS SAYS NOTHING ABOUT THESE ROWS
        it('given a describe of a model that is not the one on screen, draws nothing', () => {

            const panel = renderFixtureRecipe(5);
            panel.postToPanel(describedFixture(4));

            expect(panel.isHidden(panel.findAll(panel.cockpitBodyElement, 'orgStatus')[0])).toBe(true);
            expect(panel.objectElements().every((objectElement: any) => panel.isHidden(orgDescribeStatusOf(panel, objectElement)))).toBe(true);

        });

        it('given a describe before any model was drawn, draws nothing and does not throw', () => {

            const panel = runPanelScript();

            expect(() => panel.postToPanel(describedFixture(1))).not.toThrow();
            expect(panel.findAll(panel.cockpitBodyElement, 'orgStatus')).toEqual([]);

        });

    });

    describe('openRecipeCockpitPanel', () => {

        let createdWebviewPanel: any;
        let registeredDisposeHandler: () => void;
        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let registeredMessageSubscriptions: { dispose: jest.Mock }[];
        let postedPanelMessages: any[];
        let createdStatusBarItems: { text: string; dispose: jest.Mock }[];

        // WHAT THE REAL PANEL ECHOES: THE SEQUENCE OF THE LAST MODEL IT WAS POSTED
        const lastRenderSequence = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.renderSequence;

        function buildFakeWebviewPanel() {

            return {
                reveal: jest.fn(),
                dispose: jest.fn(),
                onDidDispose: jest.fn().mockImplementation((disposeHandler: () => void) => {
                    registeredDisposeHandler = disposeHandler;
                    return { dispose: jest.fn() };
                }),
                webview: {
                    html: '',
                    postMessage: jest.fn().mockImplementation((hostMessage: any) => {
                        postedPanelMessages.push(hostMessage);
                        return Promise.resolve(true);
                    }),
                    onDidReceiveMessage: jest.fn().mockImplementation((messageHandler: (panelMessage: any) => Promise<void>) => {
                        receivedMessageHandler = messageHandler;
                        const messageSubscription = { dispose: jest.fn() };
                        registeredMessageSubscriptions.push(messageSubscription);
                        return messageSubscription;
                    })
                }
            };

        }

        beforeEach(() => {

            postedPanelMessages = [];
            registeredMessageSubscriptions = [];
            createdStatusBarItems = [];

            createdWebviewPanel = buildFakeWebviewPanel();

            // THESE LIVE ON THE MODULE FACTORY RATHER THAN ON A SPY, SO restoreMocks DOES NOT REACH THEM
            (vscode.window.createWebviewPanel as jest.Mock).mockClear();
            (vscode.window.createWebviewPanel as jest.Mock).mockImplementation(() => createdWebviewPanel);

            jest.spyOn(VSCodeWorkspaceService, 'createStatusBarPhaseItem').mockImplementation((initialMessage: string) => {
                const statusBarItem = { text: initialMessage, dispose: jest.fn() };
                createdStatusBarItems.push(statusBarItem);
                return statusBarItem as any;
            });

            // THE PANEL IS HELD ON THE CLASS SO IT CAN BE REUSED ACROSS INVOCATIONS, SO IT SURVIVES BETWEEN TESTS UNLESS CLEARED
            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;

        });

        it('opens a scripted panel that is granted no local resource root at all', async () => {

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);

            expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);

            const [actualViewType, actualPanelTitle, actualViewColumn, actualPanelOptions] =
                (vscode.window.createWebviewPanel as jest.Mock).mock.calls[0];

            expect(actualViewType).toBe(RECIPE_COCKPIT_VIEW_TYPE);
            expect(actualPanelTitle).toBe(RECIPE_COCKPIT_PANEL_TITLE);
            expect(actualViewColumn).toBe(vscode.ViewColumn.One);
            expect(actualPanelOptions).toEqual({ enableScripts: true, localResourceRoots: [] });
            expect(createdWebviewPanel.reveal).toHaveBeenCalled();

        });

        it('reports each phase in the status bar and clears it when the load ends', async () => {

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);

            expect(createdStatusBarItems).toHaveLength(1);
            expect(createdStatusBarItems[0].text).toContain(RECIPE_COCKPIT_LOAD_PHASES.readingRun);
            expect(createdStatusBarItems[0].dispose).toHaveBeenCalled();

        });

        // A WEBVIEW THAT HAS NOT FINISHED LOADING DROPS WHAT IS POSTED TO IT, AND POSTING TWICE WOULD RENDER TWICE
        it('posts nothing before the panel is ready, then replays the loaded recipe once it is', async () => {

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);

            expect(postedPanelMessages).toEqual([]);

            await receivedMessageHandler({ command: 'ready' });

            expect(postedPanelMessages).toEqual([{
                command: 'recipeData',
                recipe: RecipeCockpitService.buildRecipeViewModel(MOCK_WORKSPACE_ROOT),
                renderSequence: expect.any(Number)
            }]);

        });

        it('given a ready panel, posts each phase of a later load as it happens', async () => {

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            postedPanelMessages.length = 0;

            await receivedMessageHandler({ command: 'selectRun', runFolderName: FAKER_JS_RUN_FOLDER_NAME });

            expect(postedPanelMessages.map(hostMessage => hostMessage.command)).toEqual(['loadPhase', 'loadPhase', 'recipeData']);
            expect(postedPanelMessages[2].recipe.selectedRunFolderName).toBe(FAKER_JS_RUN_FOLDER_NAME);

        });

        /*
            The allow-lists are built when the model is posted but honoured only once the panel says
            it drew it -- a post succeeding says the message left the host, not that a row is on
            screen for the click to have come from.
        */
        it('opens a recipe line only after the panel has confirmed drawing the row it came from', async () => {

            const openFileInEditorSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            await receivedMessageHandler({ command: 'ready' });

            await receivedMessageHandler({ command: 'openSource', filePath: LATEST_RECIPE_FILE_PATH, lineNumber: 12 });
            expect(openFileInEditorSpy).not.toHaveBeenCalled();

            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            await receivedMessageHandler({ command: 'openSource', filePath: LATEST_RECIPE_FILE_PATH, lineNumber: 12 });

            expect(openFileInEditorSpy).toHaveBeenCalledWith(LATEST_RECIPE_FILE_PATH, 12);

        });

        // EVERY RELOAD OF THE DOCUMENT PUTS THE PANEL BACK TO "NOTHING DRAWN" UNTIL THE REPLAY IS
        it('given the panel reloads, refuses actions until the replayed recipe is drawn again', async () => {

            const openFileInEditorSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            await receivedMessageHandler({ command: 'ready' });

            await receivedMessageHandler({ command: 'openSource', filePath: LATEST_RECIPE_FILE_PATH, lineNumber: 12 });

            expect(openFileInEditorSpy).not.toHaveBeenCalled();

        });

        it('given a failure to draw, empties the allow-lists and reports it once', async () => {

            const openFileInEditorSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);
            const handleCapturedErrorSpy = jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            await receivedMessageHandler({ command: 'renderFailed', phase: 'render', message: 'boom' });
            await receivedMessageHandler({ command: 'renderFailed', phase: 'render', message: 'boom' });
            await receivedMessageHandler({ command: 'openSource', filePath: LATEST_RECIPE_FILE_PATH, lineNumber: 12 });

            expect(handleCapturedErrorSpy).toHaveBeenCalledTimes(1);
            expect(handleCapturedErrorSpy.mock.calls[0][0].message).toContain('boom');
            expect(handleCapturedErrorSpy.mock.calls[0][1]).toBe('openRecipeCockpit');
            expect(openFileInEditorSpy).not.toHaveBeenCalled();

        });

        it('given the recipe file now resolves outside the workspace, warns instead of opening it', async () => {

            const openFileInEditorSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);
            const showWarningMessageSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });

            // A SYMLINK SWAPPED IN AFTER THE MODEL WAS BUILT
            jest.spyOn(SfdxProjectService, 'isPathContainedInWorkspace').mockReturnValue(false);
            await receivedMessageHandler({ command: 'openSource', filePath: LATEST_RECIPE_FILE_PATH, lineNumber: 12 });

            expect(openFileInEditorSpy).not.toHaveBeenCalled();
            expect(String(showWarningMessageSpy.mock.calls[0][0])).toContain('outside this workspace');

        });

        it('given the recipe file was deleted since the render, warns instead of opening it', async () => {

            const openFileInEditorSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);
            const showWarningMessageSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);
            jest.spyOn(fs, 'existsSync').mockReturnValue(false);

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            await receivedMessageHandler({ command: 'openSource', filePath: LATEST_RECIPE_FILE_PATH, lineNumber: 12 });

            expect(openFileInEditorSpy).not.toHaveBeenCalled();
            expect(showWarningMessageSpy).toHaveBeenCalledTimes(1);

        });

        /*
            A load that throws puts the failure in the panel and still reaches the command's error
            handler, which is the one that reports it.
        */
        it('given the load throws, shows the failure in the panel and rethrows it to the command', async () => {

            jest.spyOn(RecipeCockpitService, 'findGeneratedRecipeRuns').mockImplementation(() => {
                throw new Error('EACCES');
            });

            await expect(RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT)).rejects.toThrow('EACCES');

            await receivedMessageHandler({ command: 'ready' });

            expect(postedPanelMessages).toEqual([{ command: 'loadFailed', message: 'The Recipe Cockpit could not finish loading: EACCES' }]);
            expect(createdStatusBarItems[0].dispose).toHaveBeenCalled();

        });

        it('given a run chosen from the panel fails to load, routes the error through ErrorHandlingService', async () => {

            const handleCapturedErrorSpy = jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });

            jest.spyOn(RecipeCockpitService, 'buildRecipeViewModelByRuns').mockImplementation(() => {
                throw new Error('EIO');
            });
            await receivedMessageHandler({ command: 'selectRun', runFolderName: FAKER_JS_RUN_FOLDER_NAME });

            expect(handleCapturedErrorSpy).toHaveBeenCalledTimes(1);
            expect(handleCapturedErrorSpy.mock.calls[0][1]).toBe('openRecipeCockpit');
            expect(postedPanelMessages).toContainEqual({ command: 'loadFailed', message: 'The Recipe Cockpit could not finish loading: EIO' });

        });

        /*
            A run chosen while another is still loading supersedes it. The superseded load must not
            render over the one the reader asked for last, whichever finishes first.
        */
        it('given a second run is chosen before the first finishes loading, renders only the second', async () => {

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            postedPanelMessages.length = 0;

            const firstSelection = receivedMessageHandler({ command: 'selectRun', runFolderName: FAKER_JS_RUN_FOLDER_NAME });
            const secondSelection = receivedMessageHandler({ command: 'selectRun', runFolderName: LATEST_RUN_FOLDER_NAME });
            await Promise.all([firstSelection, secondSelection]);

            const renderedRunFolderNames = postedPanelMessages
                .filter(hostMessage => hostMessage.command === 'recipeData')
                .map(hostMessage => hostMessage.recipe.selectedRunFolderName);

            expect(renderedRunFolderNames).toEqual([LATEST_RUN_FOLDER_NAME]);

        });

        it('given a superseded load throws, neither shows nor reports its failure', async () => {

            const handleCapturedErrorSpy = jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            postedPanelMessages.length = 0;

            const buildRecipeViewModelByRuns = RecipeCockpitService.buildRecipeViewModelByRuns.bind(RecipeCockpitService);
            jest.spyOn(RecipeCockpitService, 'buildRecipeViewModelByRuns').mockImplementation((recipeRuns, workspaceRoot, requestedRunFolderName) => {
                if ( requestedRunFolderName === FAKER_JS_RUN_FOLDER_NAME ) {
                    throw new Error('EIO');
                }
                return buildRecipeViewModelByRuns(recipeRuns, workspaceRoot, requestedRunFolderName);
            });

            /*
                The first load is let through its first phase so it is inside the reading phase --
                past every isCurrentLoad check -- when the second supersedes it. Started together,
                the first would bail out at a check and never reach the throw this is about.
            */
            const firstSelection = receivedMessageHandler({ command: 'selectRun', runFolderName: FAKER_JS_RUN_FOLDER_NAME });
            await new Promise(resolveTick => setImmediate(resolveTick));
            const secondSelection = receivedMessageHandler({ command: 'selectRun', runFolderName: LATEST_RUN_FOLDER_NAME });
            await Promise.all([firstSelection, secondSelection]);

            expect(RecipeCockpitService.buildRecipeViewModelByRuns).toHaveBeenCalledWith(expect.anything(), MOCK_WORKSPACE_ROOT, FAKER_JS_RUN_FOLDER_NAME);
            expect(handleCapturedErrorSpy).not.toHaveBeenCalled();
            expect(postedPanelMessages.map(hostMessage => hostMessage.command)).not.toContain('loadFailed');

        });

        it('given the panel is closed while it loads, renders nothing into it', async () => {

            const openingLoad = RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            registeredDisposeHandler();
            await openingLoad;

            expect(postedPanelMessages).toBeEmpty();
            expect(createdStatusBarItems[0].dispose).toHaveBeenCalled();

        });

        it('given the load throws something that is not an Error, still says what it was', async () => {

            const nonErrorThrowable: unknown = 'EACCES';
            jest.spyOn(RecipeCockpitService, 'findGeneratedRecipeRuns').mockImplementation(() => {
                throw nonErrorThrowable;
            });

            await expect(RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT)).rejects.toBe('EACCES');
            await receivedMessageHandler({ command: 'ready' });

            expect(postedPanelMessages).toEqual([{ command: 'loadFailed', message: 'The Recipe Cockpit could not finish loading: EACCES' }]);

        });

        it('given the command is run again, reveals the panel the window already has rather than opening a duplicate', async () => {

            const firstCockpitPanel = await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            const secondCockpitPanel = await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);

            expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
            expect(secondCockpitPanel).toBe(firstCockpitPanel);
            expect(createdWebviewPanel.reveal).toHaveBeenCalledTimes(2);

        });

        it('given the command is run again, builds the reused panel a document with a fresh nonce', async () => {

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            const firstShellHtml = createdWebviewPanel.webview.html;

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            const secondShellHtml = createdWebviewPanel.webview.html;

            const readNonce = (shellHtml: string) => shellHtml.match(/<script nonce="([A-Za-z0-9]{32})">/)?.[1];

            expect(readNonce(firstShellHtml)).toMatch(/^[A-Za-z0-9]{32}$/);
            expect(readNonce(secondShellHtml)).not.toBe(readNonce(firstShellHtml));

        });

        // TWO LISTENERS ANSWERING ONE "ready" WOULD REPLAY THE MODEL TWICE
        it('given the command is run again, disposes the subscription it is replacing', async () => {

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);

            expect(registeredMessageSubscriptions).toHaveLength(2);
            expect(registeredMessageSubscriptions[0].dispose).toHaveBeenCalled();
            expect(registeredMessageSubscriptions[1].dispose).not.toHaveBeenCalled();

        });

        it('given an unrecognized command, posts nothing back', async () => {

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);

            await receivedMessageHandler({ command: 'traverseRecipe' });

            expect(postedPanelMessages).toBeEmpty();

        });

        // POSTING TO A DISPOSED WEBVIEW THROWS, AND THAT WOULD REACH THE USER AS AN ERROR FOR CLOSING A TAB
        it('given the panel was closed before its message was handled, posts nothing back', async () => {

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);

            registeredDisposeHandler();
            await receivedMessageHandler({ command: 'ready' });

            expect(postedPanelMessages).toBeEmpty();

        });

        it('given the panel was closed, opens a new one the next time the command is run', async () => {

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            registeredDisposeHandler();

            expect(registeredMessageSubscriptions[0].dispose).toHaveBeenCalled();

            createdWebviewPanel = buildFakeWebviewPanel();
            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);

            expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(2);

        });

        describe('describing the recipe in an org', () => {

            const ORG_DETAIL = { targetOrgIdentifier: 'devhub', username: 'jd@example.com', alias: 'devhub' };

            let describeSource: { describe: jest.Mock };
            let promptForAuthorizedOrgSpy: jest.SpyInstance;
            let getConnectionSpy: jest.SpyInstance;
            let showWarningMessageSpy: jest.SpyInstance;

            const postedOrgDescribes = () => postedPanelMessages.filter(hostMessage => hostMessage.command === 'orgDescribe');

            const openRenderedCockpit = async () => {
                await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
                await receivedMessageHandler({ command: 'ready' });
                await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            };

            beforeEach(() => {

                SalesforceOrgService.clearDescribeCache();

                describeSource = {
                    describe: jest.fn().mockImplementation(async (objectApiName: string) => {
                        if ( objectApiName === 'Contact' ) {
                            throw Object.assign(new Error('The requested resource does not exist'), { errorCode: 'NOT_FOUND' });
                        }
                        return { name: objectApiName, label: objectApiName, fields: [{ name: 'Id', type: 'id' }, { name: 'Name', type: 'string' }] };
                    })
                };

                promptForAuthorizedOrgSpy = jest.spyOn(SalesforceOrgService, 'promptForAuthorizedOrg').mockResolvedValue(ORG_DETAIL);
                getConnectionSpy = jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(describeSource as any);
                showWarningMessageSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);

                // ON THE MODULE FACTORY RATHER THAN A SPY, SO restoreMocks DOES NOT RESET IT BETWEEN TESTS
                (vscode.window.withProgress as jest.Mock).mockReset();
                (vscode.window.withProgress as jest.Mock).mockImplementation(async (progressOptions: any, progressTask: Function) => (
                    progressTask({ report: jest.fn() }, { isCancellationRequested: false })
                ));

            });

            it('describes every object of the rendered recipe in the chosen org, under a cancellable progress notification', async () => {

                await openRenderedCockpit();

                await receivedMessageHandler({ command: 'selectOrg' });

                expect(promptForAuthorizedOrgSpy).toHaveBeenCalledWith(RECIPE_COCKPIT_ORG_PICKER_PLACEHOLDER);
                // BY USERNAME, THE IDENTITY THE CACHE IS KEYED BY, NOT BY AN ALIAS THAT CAN BE RE-POINTED
                expect(getConnectionSpy).toHaveBeenCalledWith('jd@example.com');
                expect(describeSource.describe.mock.calls.map(([objectApiName]) => objectApiName).sort()).toEqual(['Account', 'Contact']);
                expect(vscode.window.withProgress).toHaveBeenCalledWith(
                    expect.objectContaining({ location: vscode.ProgressLocation.Notification, cancellable: true }),
                    expect.any(Function)
                );

                expect(postedOrgDescribes()).toEqual([{
                    command: 'orgDescribe',
                    orgLabel: 'devhub (jd@example.com)',
                    summary: 'Described in devhub (jd@example.com): 1 of 2 objects described. 1 could not be described.',
                    isFailure: false,
                    isCancelled: false,
                    objects: [
                        { objectApiName: 'Account', isDescribed: true, describedFieldCount: 2, failureMessage: '' },
                        { objectApiName: 'Contact', isDescribed: false, describedFieldCount: 0, failureMessage: 'NOT_FOUND: The requested resource does not exist' }
                    ],
                    renderSequence: lastRenderSequence()
                }]);

            });

            it('given an object the org could not describe, tells the reader outside the panel too', async () => {

                await openRenderedCockpit();

                await receivedMessageHandler({ command: 'selectOrg' });

                expect(showWarningMessageSpy).toHaveBeenCalledWith(postedOrgDescribes()[0].summary);

            });

            it('given every object described, raises no warning', async () => {

                describeSource.describe.mockImplementation(async (objectApiName: string) => ({ name: objectApiName, fields: [] }));
                await openRenderedCockpit();

                await receivedMessageHandler({ command: 'selectOrg' });

                expect(showWarningMessageSpy).not.toHaveBeenCalled();
                expect(postedOrgDescribes()[0].summary).toBe('Described in devhub (jd@example.com): 2 of 2 objects described.');

            });

            it('answers a repeat request from the session cache, without connecting or describing again', async () => {

                describeSource.describe.mockImplementation(async (objectApiName: string) => ({ name: objectApiName, fields: [] }));
                await openRenderedCockpit();

                await receivedMessageHandler({ command: 'selectOrg' });
                await receivedMessageHandler({ command: 'selectOrg' });

                expect(getConnectionSpy).toHaveBeenCalledTimes(1);
                expect(describeSource.describe).toHaveBeenCalledTimes(2);
                expect(postedOrgDescribes()[1].summary).toBe('Described in devhub (jd@example.com): 2 of 2 objects described (2 from this session\'s cache).');

            });

            it('given the panel has not confirmed drawing the recipe, does not even offer the picker', async () => {

                await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
                await receivedMessageHandler({ command: 'ready' });

                await receivedMessageHandler({ command: 'selectOrg' });

                expect(promptForAuthorizedOrgSpy).not.toHaveBeenCalled();

            });

            it('given the picker is dismissed, connects to nothing and posts nothing', async () => {

                promptForAuthorizedOrgSpy.mockResolvedValue(undefined);
                await openRenderedCockpit();

                await receivedMessageHandler({ command: 'selectOrg' });

                expect(getConnectionSpy).not.toHaveBeenCalled();
                expect(postedOrgDescribes()).toEqual([]);

            });

            it('given the org cannot be connected to, says so in the panel and outside it, and the panel stays usable', async () => {

                getConnectionSpy.mockRejectedValue(new Error('No authorization information found for devhub.'));
                await openRenderedCockpit();

                await receivedMessageHandler({ command: 'selectOrg' });

                expect(postedOrgDescribes()).toEqual([expect.objectContaining({ isFailure: true, objects: [] })]);
                expect(postedOrgDescribes()[0].summary).toContain('No authorization information found for devhub.');
                expect(showWarningMessageSpy).toHaveBeenCalledWith(postedOrgDescribes()[0].summary);

                getConnectionSpy.mockResolvedValue(describeSource as any);
                await receivedMessageHandler({ command: 'selectOrg' });

                expect(postedOrgDescribes()).toHaveLength(2);
                expect(postedOrgDescribes()[1].isFailure).toBe(false);

            });

            it('given a second request while the picker is still open, starts no second describe', async () => {

                let resolvePicker: (orgDetail: typeof ORG_DETAIL) => void = () => undefined;
                promptForAuthorizedOrgSpy.mockImplementation(() => new Promise(resolvePromise => { resolvePicker = resolvePromise; }));
                await openRenderedCockpit();

                const firstRequest = receivedMessageHandler({ command: 'selectOrg' });
                await receivedMessageHandler({ command: 'selectOrg' });
                resolvePicker(ORG_DETAIL);
                await firstRequest;

                expect(promptForAuthorizedOrgSpy).toHaveBeenCalledTimes(1);
                expect(postedOrgDescribes()).toHaveLength(1);

            });

            // EVERY REVEAL RELOADS THE DOCUMENT, AND THE DESCRIBE IS PART OF WHAT WAS ON SCREEN
            it('replays the describe after the recipe when the panel reloads', async () => {

                await openRenderedCockpit();
                await receivedMessageHandler({ command: 'selectOrg' });
                postedPanelMessages.length = 0;

                await receivedMessageHandler({ command: 'ready' });

                expect(postedPanelMessages.map(hostMessage => hostMessage.command)).toEqual(['recipeData', 'orgDescribe']);

            });

            it('given another run is loaded, drops the describe of the previous one', async () => {

                await openRenderedCockpit();
                await receivedMessageHandler({ command: 'selectOrg' });

                await receivedMessageHandler({ command: 'selectRun', runFolderName: FAKER_JS_RUN_FOLDER_NAME });
                postedPanelMessages.length = 0;
                await receivedMessageHandler({ command: 'ready' });

                expect(postedPanelMessages.map(hostMessage => hostMessage.command)).toEqual(['recipeData']);

            });

            // THE READER ASKED ABOUT THE RECIPE THAT WAS ON SCREEN, AND IT IS NOT ON SCREEN ANY MORE
            it('given the run is switched while the picker is open, describes the recipe it was asked about and draws nothing over the new one', async () => {

                await openRenderedCockpit();

                promptForAuthorizedOrgSpy.mockImplementation(async () => {
                    await receivedMessageHandler({ command: 'selectRun', runFolderName: FAKER_JS_RUN_FOLDER_NAME });
                    return ORG_DETAIL;
                });

                await receivedMessageHandler({ command: 'selectOrg' });

                expect(describeSource.describe.mock.calls.map(([objectApiName]) => objectApiName).sort()).toEqual(['Account', 'Contact']);
                expect(postedOrgDescribes()).toEqual([]);

                postedPanelMessages.length = 0;
                await receivedMessageHandler({ command: 'ready' });

                expect(postedPanelMessages.map(hostMessage => hostMessage.command)).toEqual(['recipeData']);

            });

            /*
                A new run's model is posted before the panel acks drawing it. A click in that gap must
                not describe the PREVIOUS run's objects and tag the answer with the new model -- the
                panel would draw it over rows it says nothing about.
            */
            it('given another run was posted but not yet drawn, describes nothing until it is', async () => {

                await openRenderedCockpit();

                await receivedMessageHandler({ command: 'selectRun', runFolderName: FAKER_JS_RUN_FOLDER_NAME });
                await receivedMessageHandler({ command: 'selectOrg' });

                expect(promptForAuthorizedOrgSpy).not.toHaveBeenCalled();

                await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
                await receivedMessageHandler({ command: 'selectOrg' });

                const newRunObjectApiNames = postedPanelMessages.filter(hostMessage => hostMessage.command === 'recipeData').pop()
                    .recipe.objects.map((objectViewModel: any) => objectViewModel.objectApiName).sort();

                expect(promptForAuthorizedOrgSpy).toHaveBeenCalledTimes(1);
                expect(describeSource.describe.mock.calls.map(([objectApiName]) => objectApiName).sort()).toEqual(newRunObjectApiNames);
                expect(newRunObjectApiNames).not.toEqual(['Account', 'Contact']);

            });

            it('given the reader cancels the describe, draws what it got without a warning they did not need', async () => {

                (vscode.window.withProgress as jest.Mock).mockImplementation(async (progressOptions: any, progressTask: Function) => (
                    progressTask({ report: jest.fn() }, { isCancellationRequested: true })
                ));
                await openRenderedCockpit();

                await receivedMessageHandler({ command: 'selectOrg' });

                expect(postedOrgDescribes()[0]).toEqual(expect.objectContaining({ isCancelled: true }));
                expect(showWarningMessageSpy).not.toHaveBeenCalled();

            });

            it('given the answer arrives for a run no longer on screen, raises no warning about it', async () => {

                await openRenderedCockpit();

                promptForAuthorizedOrgSpy.mockImplementation(async () => {
                    await receivedMessageHandler({ command: 'selectRun', runFolderName: FAKER_JS_RUN_FOLDER_NAME });
                    return ORG_DETAIL;
                });

                await receivedMessageHandler({ command: 'selectOrg' });

                expect(showWarningMessageSpy).not.toHaveBeenCalled();

            });

            it('given the panel is closed while the describe runs, posts nothing into it', async () => {

                await openRenderedCockpit();

                promptForAuthorizedOrgSpy.mockImplementation(async () => {
                    registeredDisposeHandler();
                    return ORG_DETAIL;
                });

                await receivedMessageHandler({ command: 'selectOrg' });

                expect(postedOrgDescribes()).toEqual([]);

            });

        });

    });

    describe('the preview warning the feature flag is accepted through', () => {

        // A LABEL QUERY RATHER THAN ISSUE NUMBERS, WHICH GO STALE AS SLICES SPLIT
        it('points at every issue carrying the recipe-cockpit label in this repository', () => {

            expect(RECIPE_COCKPIT_ISSUES_URL).toStartWith('https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues');
            expect(RECIPE_COCKPIT_ISSUES_URL).toContain('label%3Arecipe-cockpit');

        });

        // A MODAL RENDERS ITS DETAIL AS PLAIN TEXT, SO THE BUTTON IS THE LINK AND THIS LINE IS WHAT A READER CAN COPY
        it('names the url, the setting it writes and the scope it writes it at', () => {

            expect(RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL).toContain(RECIPE_COCKPIT_ISSUES_URL);
            expect(RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL).toContain('salesforce-data-treecipe.recipeCockpitEnabled');
            expect(RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL).toContain('THIS WORKSPACE');

        });

        it('is not reachable from the panel document, which loads and links nothing', () => {

            const actualShellHtml = RecipeCockpitService.buildWebviewShellHtml('testNonce');

            expect(actualShellHtml).not.toContain(RECIPE_COCKPIT_ISSUES_URL);
            expect(actualShellHtml).not.toContain('github.com');

        });

    });

});
