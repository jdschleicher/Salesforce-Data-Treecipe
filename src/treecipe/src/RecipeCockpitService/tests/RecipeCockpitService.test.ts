import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

jest.mock('vscode', () => ({
    window: { createWebviewPanel: jest.fn() },
    ViewColumn: { One: 1 }
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
    RECIPE_COCKPIT_AUTO_EXPAND_OBJECT_LIMIT
} from '../RecipeCockpitService';
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
            // USER IS A KEY THE WRAPPER HOLDS FOR A LOOKUP -- NO RECIPE WAS WRITTEN FOR IT
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

                // Contact IS IN A RECIPE FILE, SO IT IS LISTED EVEN WITH NO FIELDS; Lead IS IN NEITHER
                expect(actualRecipe.objects.map(objectViewModel => [objectViewModel.objectApiName, objectViewModel.fields.length])).toEqual([
                    ['Contact', 0],
                    ['Account', 1]
                ]);
                expect(actualRecipe.notices).toEqual(['3 field entries in the objects wrapper had no field api name and are not shown.']);

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
            panelState.recipeDataMessage = { command: 'recipeData', recipe: buildRecipeViewModel() };
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

            it('given a model was sent, activates the actions it offers', () => {

                withRenderedRecipe();

                expect(RecipeCockpitService.routePanelMessage({ command: 'rendered' }, panelState)).toEqual({ kind: 'activateActions' });

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

        it.each([
            ['an unrecognized command', { command: 'traverseRecipe' }],
            ['a message with no command at all', {}],
            ['nothing at all', undefined]
        ])('given %s, answers with nothing', (unusedDescription, panelMessage) => {

            expect(RecipeCockpitService.routePanelMessage(panelMessage, panelState)).toBeUndefined();

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
            panel.postToPanel({ command: 'recipeData', recipe: RecipeCockpitService.buildRecipeViewModel(MOCK_WORKSPACE_ROOT) });
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
            expect(panel.postedHostMessages).toContainEqual({ command: 'rendered' });
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

        it('given the filter is cleared, shows every field and collapses the objects again', () => {

            const panel = renderFixtureRecipe();
            const [accountElement] = panel.objectElements();

            panel.typeIntoFilter('industry');
            panel.typeIntoFilter('');

            expect(panel.isHidden(panel.objectBodyOf(accountElement))).toBe(true);
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
            expect(panel.postedHostMessages).not.toContainEqual({ command: 'rendered' });
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

    describe('openRecipeCockpitPanel', () => {

        let createdWebviewPanel: any;
        let registeredDisposeHandler: () => void;
        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let registeredMessageSubscriptions: { dispose: jest.Mock }[];
        let postedPanelMessages: any[];
        let createdStatusBarItems: { text: string; dispose: jest.Mock }[];

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

            expect(postedPanelMessages).toEqual([{ command: 'recipeData', recipe: RecipeCockpitService.buildRecipeViewModel(MOCK_WORKSPACE_ROOT) }]);

        });

        it('given a ready panel, posts each phase of a later load as it happens', async () => {

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered' });
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

            await receivedMessageHandler({ command: 'rendered' });
            await receivedMessageHandler({ command: 'openSource', filePath: LATEST_RECIPE_FILE_PATH, lineNumber: 12 });

            expect(openFileInEditorSpy).toHaveBeenCalledWith(LATEST_RECIPE_FILE_PATH, 12);

        });

        // EVERY RELOAD OF THE DOCUMENT PUTS THE PANEL BACK TO "NOTHING DRAWN" UNTIL THE REPLAY IS
        it('given the panel reloads, refuses actions until the replayed recipe is drawn again', async () => {

            const openFileInEditorSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered' });
            await receivedMessageHandler({ command: 'ready' });

            await receivedMessageHandler({ command: 'openSource', filePath: LATEST_RECIPE_FILE_PATH, lineNumber: 12 });

            expect(openFileInEditorSpy).not.toHaveBeenCalled();

        });

        it('given a failure to draw, empties the allow-lists and reports it once', async () => {

            const openFileInEditorSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);
            const handleCapturedErrorSpy = jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered' });
            await receivedMessageHandler({ command: 'renderFailed', phase: 'render', message: 'boom' });
            await receivedMessageHandler({ command: 'renderFailed', phase: 'render', message: 'boom' });
            await receivedMessageHandler({ command: 'openSource', filePath: LATEST_RECIPE_FILE_PATH, lineNumber: 12 });

            expect(handleCapturedErrorSpy).toHaveBeenCalledTimes(1);
            expect(handleCapturedErrorSpy.mock.calls[0][0].message).toContain('boom');
            expect(handleCapturedErrorSpy.mock.calls[0][1]).toBe('openRecipeCockpit');
            expect(openFileInEditorSpy).not.toHaveBeenCalled();

        });

        it('given the recipe file was deleted since the render, warns instead of opening it', async () => {

            const openFileInEditorSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);
            const showWarningMessageSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);
            jest.spyOn(fs, 'existsSync').mockReturnValue(false);

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered' });
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
            await receivedMessageHandler({ command: 'rendered' });

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
            await receivedMessageHandler({ command: 'rendered' });
            postedPanelMessages.length = 0;

            const firstSelection = receivedMessageHandler({ command: 'selectRun', runFolderName: FAKER_JS_RUN_FOLDER_NAME });
            const secondSelection = receivedMessageHandler({ command: 'selectRun', runFolderName: LATEST_RUN_FOLDER_NAME });
            await Promise.all([firstSelection, secondSelection]);

            const renderedRunFolderNames = postedPanelMessages
                .filter(hostMessage => hostMessage.command === 'recipeData')
                .map(hostMessage => hostMessage.recipe.selectedRunFolderName);

            expect(renderedRunFolderNames).toEqual([LATEST_RUN_FOLDER_NAME]);

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
