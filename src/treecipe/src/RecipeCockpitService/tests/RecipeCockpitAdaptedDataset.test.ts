import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as vscode from 'vscode';

// vscode.workspace.fs READS THE REAL FILE SYSTEM: THE GENERATE TREECIPE PIPELINE READS THE MOCK METADATA THROUGH IT
jest.mock('vscode', () => {
    const realFs = jest.requireActual('fs');
    const realPath = jest.requireActual('path');
    const toUri = (fsPath: string) => ({ scheme: 'file', fsPath: fsPath, path: fsPath });
    return {
        workspace: {
            workspaceFolders: undefined,
            getConfiguration: jest.fn().mockReturnValue({ get: jest.fn(), update: jest.fn(), inspect: jest.fn() }),
            fs: {
                readDirectory: async (directoryUri: { fsPath: string }) => {
                    try {
                        return realFs.readdirSync(directoryUri.fsPath, { withFileTypes: true })
                            .map((entry: { name: string; isDirectory: () => boolean }) => [entry.name, entry.isDirectory() ? 2 : 1]);
                    } catch {
                        return [];
                    }
                },
                readFile: async (fileUri: { fsPath: string }) => realFs.readFileSync(fileUri.fsPath)
            }
        },
        env: { openExternal: jest.fn() },
        window: {
            createWebviewPanel: jest.fn(),
            createQuickPick: jest.fn(),
            withProgress: jest.fn(),
            showWarningMessage: jest.fn(),
            showInformationMessage: jest.fn(),
            showErrorMessage: jest.fn(),
            showQuickPick: jest.fn(),
            showTextDocument: jest.fn(),
            createOutputChannel: jest.fn(),
            createStatusBarItem: jest.fn().mockImplementation(() => ({ text: '', show: jest.fn(), dispose: jest.fn() }))
        },
        commands: { registerCommand: jest.fn(), executeCommand: jest.fn() },
        ViewColumn: { One: 1 },
        StatusBarAlignment: { Left: 1, Right: 2 },
        ProgressLocation: { Notification: 15, Window: 10 },
        ConfigurationTarget: { Workspace: 2 },
        FileType: { Directory: 2, File: 1, SymbolicLink: 64 },
        ThemeIcon: jest.fn(),
        Uri: {
            file: toUri,
            parse: (uriText: string) => toUri(uriText.replace(/^file:\/\//, '')),
            joinPath: (baseUri: { fsPath: string }, ...segments: string[]) => toUri(realPath.join(baseUri.fsPath, ...segments))
        }
    };
}, { virtual: true });

jest.mock('@salesforce/core', () => ({
    AuthInfo: { listAllAuthorizations: jest.fn() },
    StateAggregator: { clearInstance: jest.fn() },
    Org: { create: jest.fn() },
    SfError: class SfError extends Error {}
}));

import { ConfigurationService } from '../../ConfigurationService/ConfigurationService';
import { DatasetSourceService, IDatasetSourceAdaptation } from '../../DatasetSourceService/DatasetSourceService';
import { DirectoryProcessor } from '../../DirectoryProcessingService/DirectoryProcessor';
import { FakerJSRecipeProcessor } from '../../FakerRecipeProcessor/FakerJSRecipeProcessor/FakerJSRecipeProcessor';
import { IRecipeFakerService } from '../../RecipeFakerService.ts/IRecipeFakerService';
import { FakerJSRecipeFakerService } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { PythonTestHarness } from '../../RecipeFakerService.ts/RecipeYamlScalar/tests/mocks/PythonTestHarness';
import { IAdaptedRunRequest, RecipeCockpitAdaptedDataset } from '../RecipeCockpitAdaptedDataset';
import { IAdaptedRecipeField, RecipeCockpitRecipeWriter } from '../RecipeCockpitRecipeWriter';
import { IRecipeCockpitRecipeViewModel, RecipeCockpitService, RECIPE_COCKPIT_DATASET_ADAPTED_LABEL } from '../RecipeCockpitService';
import { RecipeCockpitTreeHistory } from '../RecipeCockpitTreeHistory';
import { runPanelScript } from './RecipeCockpitPanelHarness';

const MOCK_OBJECTS_PATH = path.join(__dirname, '..', '..', 'DirectoryProcessingService', 'tests', 'mocks', 'MockSalesforceMetadataDirectory', 'objects');
const NESTED_RECIPE_PATH = path.join(__dirname, 'mocks', 'recipeWriter', 'recipe-fakerjs-nested--RelationshipTree_1.yml');
const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const HISTORY_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'historyWorkspace');
const TREE_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';

const ADAPTED_COMMENT = '# ADAPTED 2026-10-25 -- qa';
const ADAPTED_AT = new Date(Date.UTC(2026, 9, 25, 14, 30, 5));

async function generateRecipeTexts(createFakerService: () => IRecipeFakerService): Promise<string[]> {

    jest.spyOn(ConfigurationService, 'getFakerImplementationByExtensionConfigSelection').mockImplementation(createFakerService);
    jest.spyOn(ConfigurationService, 'getCustomRelationshipMappings').mockReturnValue({});
    jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue([]);

    const objectInfoWrapper = await new DirectoryProcessor().processAllObjectsAndRelationships(vscode.Uri.file(MOCK_OBJECTS_PATH));
    return objectInfoWrapper.RecipeFiles.map(recipeFile => recipeFile.content);

}

// EVERY DISTINCT object.field THE FILE WRITES, AS THE ADAPTER WOULD LIST IT HAD IT UPDATED EVERY ONE WITH THE RECIPE'S OWN VALUE
function listRecipeValueFields(recipeText: string): IAdaptedRecipeField[] {
    const seen = new Set<string>();
    return RecipeCockpitRecipeWriter.scanRecipeObjects(RecipeCockpitRecipeWriter.splitRecipeLines(recipeText).lines)
        .flatMap(scannedObject => scannedObject.fields.map(scannedField => ({ objectApiName: scannedObject.objectApiName, fieldApiName: scannedField.fieldApiName })))
        .filter(({ objectApiName, fieldApiName }) => {
            const fieldKey = `${objectApiName}.${fieldApiName}`;
            return seen.has(fieldKey) ? false : ( seen.add(fieldKey), true );
        })
        .map(({ objectApiName, fieldApiName }) => ({ objectApiName, fieldApiName, valueText: '"replaced"', isRecipeValue: true as const }));
}

type LoadedObject = { object: string; fields: Record<string, unknown> | null; friends?: LoadedObject[] };
const flattenLoaded = (loadedObjects: LoadedObject[]): LoadedObject[] => loadedObjects.flatMap(loadedObject => [loadedObject, ...flattenLoaded(loadedObject.friends ?? [])]);

const buildAdapted = (recipeText: string, adaptedFields: IAdaptedRecipeField[]) => {
    const adaptedRecipe = RecipeCockpitRecipeWriter.buildAdaptedRecipe(recipeText, adaptedFields, ADAPTED_COMMENT);
    if ( 'refusal' in adaptedRecipe ) {
        throw new Error(adaptedRecipe.refusal.message);
    }
    return adaptedRecipe;
};

const ONE_OBJECT_RECIPE = [
    '- object: Account',
    '  nickname: Account_NickName',
    '  count: 2',
    '  fields:',
    '    Name: ${{ faker.company.name() }}',
    '    Description: |',
    '                    ${{ faker.lorem.paragraph() }}',
    '    Site: "${{ faker.lorem.word() }}',
    '        }}"',
    '    Phone: ${{ faker.phone.number() }} # TODO keep',
    ''
].join('\n');

describe('the Treecipe Adapter\'s adapted data set and recipe (#448)', () => {

    describe('RecipeCockpitRecipeWriter.buildAdaptedRecipe', () => {

        it('marks the recipe\'s own value at the end of its field line and writes any other value as one line, every other line byte for byte', () => {

            const adaptedRecipe = buildAdapted(ONE_OBJECT_RECIPE, [
                { objectApiName: 'Account', fieldApiName: 'Name', valueText: '"${{ faker.company.name() }}"', isRecipeValue: true },
                { objectApiName: 'Account', fieldApiName: 'Phone', valueText: '"555 # 1234"' }
            ]);

            expect(adaptedRecipe.markedLineCount).toBe(2);
            expect(adaptedRecipe.recipeText.split('\n')).toEqual([
                '- object: Account',
                '  nickname: Account_NickName',
                '  count: 2',
                '  fields:',
                `    Name: \${{ faker.company.name() }} ${ADAPTED_COMMENT}`,
                '    Description: |',
                '                    ${{ faker.lorem.paragraph() }}',
                '    Site: "${{ faker.lorem.word() }}',
                '        }}"',
                `    Phone: "555 # 1234" ${ADAPTED_COMMENT}`,
                ''
            ]);

        });

        it('keeps a "#" in a value as text: the mark sits after a separating space, outside the quoted scalar', () => {

            const adaptedRecipe = buildAdapted(ONE_OBJECT_RECIPE, [{ objectApiName: 'Account', fieldApiName: 'Name', valueText: '"Acme # 1 \\"best\\""' }]);
            const [loadedAccount] = yaml.load(adaptedRecipe.recipeText) as LoadedObject[];

            expect(adaptedRecipe.recipeText).toContain(`    Name: "Acme # 1 \\"best\\"" ${ADAPTED_COMMENT}\n`);
            expect(loadedAccount.fields?.Name).toBe('Acme # 1 "best"');

        });

        it('puts the mark of a block scalar on its field line, where YAML takes a comment, and the value loads as before', () => {

            const adaptedRecipe = buildAdapted(ONE_OBJECT_RECIPE, [{ objectApiName: 'Account', fieldApiName: 'Description', valueText: '"${{ faker.lorem.paragraph() }}"', isRecipeValue: true }]);

            expect(adaptedRecipe.recipeText).toContain(`    Description: | ${ADAPTED_COMMENT}\n                    \${{ faker.lorem.paragraph() }}\n`);
            expect((yaml.load(adaptedRecipe.recipeText) as LoadedObject[])[0].fields?.Description).toBe((yaml.load(ONE_OBJECT_RECIPE) as LoadedObject[])[0].fields?.Description);

        });

        it('writes the recipe\'s own value as one line when its quoted scalar runs past the field line, where a mark would be text', () => {

            const adaptedRecipe = buildAdapted(ONE_OBJECT_RECIPE, [{ objectApiName: 'Account', fieldApiName: 'Site', valueText: '"${{ faker.lorem.word() }}"', isRecipeValue: true }]);

            expect(adaptedRecipe.recipeText).toContain(`    Site: "\${{ faker.lorem.word() }}" ${ADAPTED_COMMENT}\n    Phone:`);
            expect((yaml.load(adaptedRecipe.recipeText) as LoadedObject[])[0].fields?.Site).toBe('${{ faker.lorem.word() }}');

        });

        it('inserts an org-only field, marked, at the end of every occurrence\'s fields at its own depth', () => {

            const nestedRecipe = fs.readFileSync(NESTED_RECIPE_PATH, 'utf8');
            const contactOccurrences = RecipeCockpitRecipeWriter.scanRecipeObjects(RecipeCockpitRecipeWriter.splitRecipeLines(nestedRecipe).lines).filter(scannedObject => scannedObject.objectApiName === 'Contact');
            expect(contactOccurrences.length).toBeGreaterThan(0);

            const adaptedRecipe = buildAdapted(nestedRecipe, [{ objectApiName: 'Contact', fieldApiName: 'Loyalty_Tier__c', valueText: '"Gold"', isOrgOnly: true }]);
            const insertedLines = adaptedRecipe.recipeText.split('\n').filter(recipeLine => recipeLine.includes('Loyalty_Tier__c'));

            expect(insertedLines).toHaveLength(contactOccurrences.length);
            insertedLines.forEach(insertedLine => expect(insertedLine).toMatch(new RegExp(`^( {4})+Loyalty_Tier__c: "Gold" ${ADAPTED_COMMENT}$`)));
            flattenLoaded(yaml.load(adaptedRecipe.recipeText) as LoadedObject[])
                .filter(loadedObject => loadedObject.object === 'Contact')
                .forEach(loadedContact => expect(loadedContact.fields?.Loyalty_Tier__c).toBe('Gold'));
            // NOTHING BUT THE INSERTED LINES
            expect(adaptedRecipe.recipeText.split('\n').filter(recipeLine => !recipeLine.includes('Loyalty_Tier__c')).join('\n')).toBe(nestedRecipe);

        });

        it('keeps CRLF endings and a missing final newline, inserting two org-only fields in the order given', () => {

            const crlfRecipe = '- object: Account\r\n  nickname: Account_NickName\r\n  fields:\r\n    Name: ${{ faker.company.name() }}';
            const adaptedRecipe = buildAdapted(crlfRecipe, [
                { objectApiName: 'Account', fieldApiName: 'First__c', valueText: '1', isOrgOnly: true },
                { objectApiName: 'Account', fieldApiName: 'Second__c', valueText: 'true', isOrgOnly: true }
            ]);

            expect(adaptedRecipe.recipeText).toBe(`- object: Account\r\n  nickname: Account_NickName\r\n  fields:\r\n    Name: \${{ faker.company.name() }}\r\n    First__c: 1 ${ADAPTED_COMMENT}\r\n    Second__c: true ${ADAPTED_COMMENT}`);

        });

        it.each([
            ['a comment that is not the mark', [{ objectApiName: 'Account', fieldApiName: 'Name', valueText: '"x"' }], '# ADAPTED today', 'invalid-adapted-comment'],
            ['no field', [], ADAPTED_COMMENT, 'no-adapted-fields'],
            ['a field the recipe lacks', [{ objectApiName: 'Account', fieldApiName: 'Gone__c', valueText: '"x"' }], ADAPTED_COMMENT, 'field-not-found'],
            ['an org-only field the recipe has', [{ objectApiName: 'Account', fieldApiName: 'Name', valueText: '"x"', isOrgOnly: true as const }], ADAPTED_COMMENT, 'field-already-exists'],
            ['a value on two lines', [{ objectApiName: 'Account', fieldApiName: 'Name', valueText: '"x"\n    Evil: 1' }], ADAPTED_COMMENT, 'invalid-value'],
            ['a value with a line break only PyYAML sees', [{ objectApiName: 'Account', fieldApiName: 'Name', valueText: '"x - object: Evil"' }], ADAPTED_COMMENT, 'invalid-value'],
            ['a field listed twice', [{ objectApiName: 'Account', fieldApiName: 'Name', valueText: '"x"' }, { objectApiName: 'Account', fieldApiName: 'Name', valueText: '"y"' }], ADAPTED_COMMENT, 'duplicate-field'],
            ['a name that is not an api name', [{ objectApiName: 'Account', fieldApiName: 'Na me', valueText: '"x"' }], ADAPTED_COMMENT, 'invalid-field-api-name']
        ])('refuses %s', (_description, adaptedFields, adaptedComment, expectedReason) => {

            const adaptedRecipe = RecipeCockpitRecipeWriter.buildAdaptedRecipe(ONE_OBJECT_RECIPE, adaptedFields as IAdaptedRecipeField[], adaptedComment);
            expect('refusal' in adaptedRecipe && adaptedRecipe.refusal.reason).toBe(expectedReason);

        });

        it('builds the mark from a date and an org label held to characters no parser or template reads', () => {

            expect(RecipeCockpitRecipeWriter.buildAdaptedComment('2026-10-25', 'qa-sandbox.1@example.com')).toBe('# ADAPTED 2026-10-25 -- qa-sandbox.1@example.com');
            expect(RecipeCockpitRecipeWriter.buildAdaptedComment('2026-10-25', 'my "org" ${{x}}\n- object: Evil')).toBe('# ADAPTED 2026-10-25 -- my__org_____x___-_object__Evil');
            expect(RecipeCockpitRecipeWriter.buildAdaptedComment('2026-10-25', '')).toBe('# ADAPTED 2026-10-25 -- _');

        });

    });

    describe.each([
        ['faker-js', () => new FakerJSRecipeFakerService()],
        ['snowfakery', () => new SnowfakeryRecipeFakerService()]
    ] as const)('every field Generate Treecipe writes with the %s backend', (_backend, createFakerService) => {

        it('marks every field\'s line, the file still loads with the same values, and nothing else changes', async () => {

            const recipeTexts = await generateRecipeTexts(createFakerService);
            expect(recipeTexts.length).toBeGreaterThan(0);

            recipeTexts.forEach(recipeText => {

                const adaptedFields = listRecipeValueFields(recipeText);
                const adaptedRecipe = buildAdapted(recipeText, adaptedFields);
                const adaptedFieldKeys = new Set(adaptedFields.map(adaptedField => `${adaptedField.objectApiName}.${adaptedField.fieldApiName}`));

                RecipeCockpitRecipeWriter.scanRecipeObjects(RecipeCockpitRecipeWriter.splitRecipeLines(adaptedRecipe.recipeText).lines).forEach(scannedObject => {
                    scannedObject.fields
                        .filter(scannedField => adaptedFieldKeys.has(`${scannedObject.objectApiName}.${scannedField.fieldApiName}`))
                        .forEach(scannedField => expect(adaptedRecipe.recipeText.split('\n')[scannedField.startIndex]).toEndWith(` ${ADAPTED_COMMENT}`));
                });

                // A FIELD WHOSE OWN LINES COULD NOT CARRY THE MARK IS WRITTEN AS THE ONE LINE OF ITS VALUE; EVERY OTHER LOADS AS IT DID
                const loadedBefore = flattenLoaded(yaml.load(recipeText) as LoadedObject[]);
                const loadedAfter = flattenLoaded(yaml.load(adaptedRecipe.recipeText) as LoadedObject[]);
                expect(loadedAfter.map(loadedObject => loadedObject.object)).toEqual(loadedBefore.map(loadedObject => loadedObject.object));
                loadedAfter.forEach((loadedObject, objectIndex) => {
                    Object.entries(loadedObject.fields ?? {}).forEach(([fieldApiName, fieldValue]) => {
                        expect([loadedBefore[objectIndex].fields?.[fieldApiName], 'replaced']).toContainEqual(fieldValue);
                    });
                });

            });

        });

    });

    describe('the adapted recipe generates', () => {

        const FAKER_JS_RECIPE = [
            '- object: Account',
            '  nickname: Account_NickName',
            '  count: 3',
            '  fields:',
            '    Name: ${{ faker.company.name() }}',
            '    Description: |',
            '                    ${{ faker.string.alpha({ length: 4, casing: "upper" }) }}',
            ''
        ].join('\n');

        const adaptFields = (recipeText: string, expression: string) => buildAdapted(recipeText, [
            { objectApiName: 'Account', fieldApiName: 'Name', valueText: '"Acme # 1"' },
            { objectApiName: 'Account', fieldApiName: 'Description', valueText: `"${expression}"`, isRecipeValue: true },
            { objectApiName: 'Account', fieldApiName: 'Region__c', valueText: '"West"', isOrgOnly: true }
        ]).recipeText;

        it('with faker-js, through the real recipe processor, every adapted line marked', async () => {

            const adaptedRecipeText = adaptFields(FAKER_JS_RECIPE, '${{ faker.string.alpha({ length: 4, casing: "upper" }) }}');
            expect(adaptedRecipeText.split('\n').filter(recipeLine => recipeLine.endsWith(ADAPTED_COMMENT))).toHaveLength(3);
            const temporaryFolderPath = fs.mkdtempSync(path.join(os.tmpdir(), 'adapted-recipe-'));

            try {
                const recipeFilePath = path.join(temporaryFolderPath, 'recipe-adapted-20261025-143005.yml');
                fs.writeFileSync(recipeFilePath, adaptedRecipeText);
                const records = JSON.parse(await new FakerJSRecipeProcessor().generateFakeDataBySelectedRecipeFile(recipeFilePath)) as Array<{ fields: Record<string, unknown> }>;

                expect(records).toHaveLength(3);
                records.forEach(record => {
                    expect(record.fields.Name).toBe('Acme # 1');
                    expect(String(record.fields.Description).trim()).toMatch(/^[A-Z]{4}$/);
                    expect(record.fields.Region__c).toBe('West');
                });
            } finally {
                fs.rmSync(temporaryFolderPath, { recursive: true, force: true });
            }

        });

        PythonTestHarness.testRequiringModules('yaml', 'jinja2', 'faker')('with snowfakery, read with PyYAML and rendered with Jinja and Faker', () => {

            const snowfakeryRecipe = FAKER_JS_RECIPE.replace('faker.company.name()', 'fake.company').replace('faker.string.alpha({ length: 4, casing: "upper" })', 'fake.pystr(min_chars=4, max_chars=4)');
            const adaptedRecipeText = adaptFields(snowfakeryRecipe, '${{ fake.pystr(min_chars=4, max_chars=4) }}');

            const values = PythonTestHarness.runPython([
                'import json, sys, yaml, jinja2',
                'from faker import Faker',
                'environment = jinja2.Environment(block_start_string="${%", block_end_string="%}", variable_start_string="${{", variable_end_string="}}")',
                'environment.globals.update(fake=Faker())',
                'request = json.load(sys.stdin)',
                'recipe = yaml.safe_load(request["recipeText"])[0]',
                'rendered = [{ name: environment.from_string(str(value)).render() for name, value in recipe["fields"].items() } for _ in range(recipe["count"])]',
                'print(json.dumps(rendered))'
            ].join('\n'), { recipeText: adaptedRecipeText }) as Array<Record<string, string>>;

            expect(values).toHaveLength(3);
            values.forEach(value => {
                expect(value.Name).toBe('Acme # 1');
                expect(value.Description.trim()).toMatch(/^[A-Za-z]{4}$/);
                expect(value.Region__c).toBe('West');
            });

        });

    });

    describe('RecipeCockpitAdaptedDataset.writeAdaptedRun', () => {

        let temporaryRoot: string;
        let workspaceRoot: string;

        const recipeFolderPath = () => path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes', TREE_RUN_FOLDER_NAME, ACCOUNT_TREE_KEY);
        const recipeFilePath = () => path.join(recipeFolderPath(), `recipe--${ACCOUNT_TREE_KEY}-2026-09-20T10-00-00.yml`);
        const fakeDataSetsPath = () => path.join(workspaceRoot, 'treecipe', 'FakeDataSets');

        const ADAPTATION: Omit<IDatasetSourceAdaptation, 'adaptedRecipeFileName'> = {
            parentObjectApiName: 'Account',
            whereText: "Name LIKE 'A%'",
            orgUsername: 'qa@example.com.qa',
            updatedFieldsByObject: { Account: [{ fieldApiName: 'Legacy_Code__c' }, { fieldApiName: 'Region__c', isOrgOnly: true }] },
            addedObjectApiNames: [],
            insertedRecordIdsByObject: {}
        };

        const buildRequest = (requestChanges: Partial<IAdaptedRunRequest> = {}): IAdaptedRunRequest => ({
            workspaceRoot: workspaceRoot,
            fakeDataSetsFolderPath: fakeDataSetsPath(),
            generatedRecipesFolderPath: path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes'),
            recipeFilePath: recipeFilePath(),
            treeFolderName: ACCOUNT_TREE_KEY,
            fakerService: 'snowfakery',
            date: ADAPTED_AT,
            objects: [
                { objectApiName: 'Account', records: [
                    { attributes: { type: 'Account', url: '/x' }, Id: '001000000000000AAA', Legacy_Code__c: 'NEW-0', Region__c: 'West' },
                    { Id: 'not an id', Legacy_Code__c: 'dropped' }
                ] },
                { objectApiName: 'Contact', records: [{ Id: '003000000000000AAA', LastName: 'Kept', AccountId: '001000000000000AAA' }] }
            ],
            adaptedFields: [
                { objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', valueText: '"${{fake.Word}}"', isRecipeValue: true },
                { objectApiName: 'Account', fieldApiName: 'Region__c', valueText: '"West"', isOrgOnly: true }
            ],
            adaptation: ADAPTATION,
            orgLabel: 'qa',
            ...requestChanges
        });

        const write = (requestChanges: Partial<IAdaptedRunRequest> = {}) => {
            const adaptedRun = RecipeCockpitAdaptedDataset.writeAdaptedRun(buildRequest(requestChanges));
            if ( 'refusal' in adaptedRun ) {
                throw new Error(adaptedRun.refusal);
            }
            return adaptedRun;
        };

        beforeEach(() => {
            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-adapted-run-'));
            workspaceRoot = path.join(temporaryRoot, 'workspace');
            fs.cpSync(TREE_WORKSPACE_ROOT, workspaceRoot, { recursive: true });
        });

        afterEach(() => {
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        it('imports no vscode', () => {

            const source = fs.readFileSync(path.join(__dirname, '..', 'RecipeCockpitAdaptedDataset.ts'), 'utf8');
            expect(source).not.toMatch(/from 'vscode'/);

        });

        it('writes the data set, its source and the adapted recipe, keyed by Id, and never writes the recipe', () => {

            const recipeBefore = fs.readFileSync(recipeFilePath(), 'utf8');
            const adaptedRun = write();

            expect(path.basename(adaptedRun.datasetFolderPath)).toBe(`${ACCOUNT_TREE_KEY}-adapted-20261025-143005`);
            expect(path.basename(adaptedRun.adaptedRecipeFilePath!)).toBe(`recipe--${ACCOUNT_TREE_KEY}-2026-09-20T10-00-00-adapted-20261025-143005.yml`);
            expect(adaptedRun.recipeRefusal).toBeUndefined();
            expect(fs.readFileSync(recipeFilePath(), 'utf8')).toBe(recipeBefore);

            const accountFile = JSON.parse(fs.readFileSync(path.join(adaptedRun.datasetFolderPath, 'DatasetFilesForCollectionsApi', 'collectionsApi-Account.json'), 'utf8'));
            expect(accountFile).toEqual({ allOrNone: true, records: [{ attributes: { type: 'Account', referenceId: 'Account_Reference_1__001000000000000AAA' }, Legacy_Code__c: 'NEW-0', Region__c: 'West' }] });

            const adaptedRecipe = fs.readFileSync(adaptedRun.adaptedRecipeFilePath!, 'utf8');
            expect(adaptedRecipe).toContain(`    Legacy_Code__c: \${{fake.Word}} ${ADAPTED_COMMENT}\n`);
            expect(adaptedRecipe).toContain(`    Region__c: "West" ${ADAPTED_COMMENT}\n`);

            const datasetSourceRead = DatasetSourceService.readDatasetSource(adaptedRun.datasetFolderPath, DatasetSourceService.findKnownRecipeRuns(path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes')));
            expect(datasetSourceRead.status).toBe('linked');
            expect(datasetSourceRead.datasetSource).toMatchObject({
                origin: 'adapt',
                recordCountsByObject: { Account: 1, Contact: 1 },
                generatedAt: ADAPTED_AT.toISOString(),
                adaptation: { ...ADAPTATION, adaptedRecipeFileName: path.basename(adaptedRun.adaptedRecipeFilePath!) }
            });

        });

        it('lets an insert of the copy point a lookup at the new Id of a record in it, as a nickname is', () => {

            const adaptedRun = write();
            const contactFile = fs.readFileSync(path.join(adaptedRun.datasetFolderPath, 'DatasetFilesForCollectionsApi', 'collectionsApi-Contact.json'), 'utf8');

            const { CollectionsApiService } = jest.requireActual('../../CollectionsApiService/CollectionsApiService');
            const swapped = JSON.parse(CollectionsApiService.updateLookupReferencesInCollectionApiJson(contactFile, { Account_Reference_1__001000000000000AAA: '001NEW000000000AAA' }));
            expect(swapped.records[0].AccountId).toBe('001NEW000000000AAA');

        });

        it('takes "-2" for a second run in the same second, for the data set and the recipe beside the first', () => {

            const firstRun = write();
            const secondRun = write();

            expect(path.basename(secondRun.datasetFolderPath)).toBe(`${path.basename(firstRun.datasetFolderPath)}-2`);
            expect(path.basename(secondRun.adaptedRecipeFilePath!)).toBe(`recipe--${ACCOUNT_TREE_KEY}-2026-09-20T10-00-00-adapted-20261025-143005-2.yml`);
            expect(DatasetSourceService.parseDatasetFolderName(path.basename(secondRun.datasetFolderPath))).toMatchObject({ collisionSuffix: 2 });

        });

        it('still writes the data set when the recipe cannot be adapted, and says why', () => {

            const adaptedRun = write({ adaptedFields: [{ objectApiName: 'Account', fieldApiName: 'Gone__c', valueText: '"x"' }] });

            expect(adaptedRun.adaptedRecipeFilePath).toBeUndefined();
            expect(adaptedRun.recipeRefusal).toBe('Account has no Gone__c line.');
            expect(JSON.parse(fs.readFileSync(path.join(adaptedRun.datasetFolderPath, 'BaseArtifactFiles', 'datasetSource.json'), 'utf8')).adaptation.adaptedRecipeFileName).toBeNull();

        });

        it('refuses a FakeDataSets folder outside the workspace or reached through a link, writing nothing', () => {

            const outsideFolderPath = path.join(temporaryRoot, 'outside');
            fs.mkdirSync(outsideFolderPath);

            expect(RecipeCockpitAdaptedDataset.writeAdaptedRun(buildRequest({ fakeDataSetsFolderPath: outsideFolderPath }))).toEqual({
                isWritten: false,
                refusal: 'the FakeDataSets folder is outside the workspace or reached through a link.'
            });

            fs.symlinkSync(outsideFolderPath, fakeDataSetsPath(), 'dir');
            expect(RecipeCockpitAdaptedDataset.writeAdaptedRun(buildRequest())).toMatchObject({ isWritten: false });

            // A LINK INSIDE THE WORKSPACE IS REFUSED TOO
            fs.rmSync(fakeDataSetsPath());
            fs.mkdirSync(path.join(workspaceRoot, 'elsewhere'));
            fs.symlinkSync(path.join(workspaceRoot, 'elsewhere'), fakeDataSetsPath(), 'dir');
            expect(RecipeCockpitAdaptedDataset.writeAdaptedRun(buildRequest())).toMatchObject({ isWritten: false });

            expect(fs.readdirSync(outsideFolderPath)).toEqual([]);
            expect(fs.readdirSync(path.join(workspaceRoot, 'elsewhere'))).toEqual([]);

        });

        it('refuses a recipe reached through a link, and never writes an adapted recipe over a file or link already there', () => {

            const linkedRecipePath = path.join(recipeFolderPath(), 'linked.yml');
            fs.symlinkSync(recipeFilePath(), linkedRecipePath);
            expect(RecipeCockpitAdaptedDataset.writeAdaptedRun(buildRequest({ recipeFilePath: linkedRecipePath }))).toMatchObject({ isWritten: false, refusal: 'the card\'s recipe is outside the workspace or reached through a link.' });
            fs.rmSync(linkedRecipePath);

            const plantedTargetPath = path.join(temporaryRoot, 'planted.yml');
            fs.writeFileSync(plantedTargetPath, 'planted');
            fs.symlinkSync(plantedTargetPath, path.join(recipeFolderPath(), `recipe--${ACCOUNT_TREE_KEY}-2026-09-20T10-00-00-adapted-20261025-143005.yml`));

            const adaptedRun = write();
            expect(adaptedRun.adaptedRecipeFilePath).toBeUndefined();
            expect(adaptedRun.recipeRefusal).toMatch(/could not be written beside the recipe; a copy is in the data set\.$/);
            expect(fs.readFileSync(plantedTargetPath, 'utf8')).toBe('planted');

        });

        it('refuses a recipe outside GeneratedRecipes, a recipe that cannot be read, and a FakeDataSets path that is a file', () => {

            expect(RecipeCockpitAdaptedDataset.writeAdaptedRun(buildRequest({ recipeFilePath: path.join(workspaceRoot, 'recipe.yml') }))).toEqual({ isWritten: false, refusal: 'the card\'s recipe is not in a GeneratedRecipes run folder.' });
            expect(RecipeCockpitAdaptedDataset.writeAdaptedRun(buildRequest({ recipeFilePath: path.join(recipeFolderPath(), 'gone.yml') }))).toEqual({ isWritten: false, refusal: 'the card\'s recipe could not be read.' });

            fs.writeFileSync(fakeDataSetsPath(), 'a file');
            expect(RecipeCockpitAdaptedDataset.writeAdaptedRun(buildRequest())).toMatchObject({ isWritten: false, refusal: 'the FakeDataSets folder is outside the workspace or reached through a link.' });

        });

        it('refuses when the data set folder cannot be made for another reason than a clash, or its files cannot all be written', () => {

            const realMkdirSync = fs.mkdirSync;
            const mkdirSpy = jest.spyOn(fs, 'mkdirSync').mockImplementation(((folderPath: fs.PathLike, options?: fs.MakeDirectoryOptions) => {
                if ( path.basename(String(folderPath)).includes('-adapted-') ) {
                    throw Object.assign(new Error('denied'), { code: 'EACCES' });
                }
                return realMkdirSync(folderPath, options);
            }) as typeof fs.mkdirSync);
            expect(RecipeCockpitAdaptedDataset.writeAdaptedRun(buildRequest())).toEqual({ isWritten: false, refusal: 'the data set folder could not be made inside the workspace.' });
            mkdirSpy.mockRestore();

            const realWriteFileSync = fs.writeFileSync;
            jest.spyOn(fs, 'writeFileSync').mockImplementation(((filePath: fs.PathOrFileDescriptor, ...rest: any[]) => {
                if ( String(filePath).endsWith('collectionsApi-Contact.json') ) {
                    throw new Error('disk full');
                }
                return (realWriteFileSync as any)(filePath, ...rest);
            }) as typeof fs.writeFileSync);
            expect(RecipeCockpitAdaptedDataset.writeAdaptedRun(buildRequest())).toEqual({ isWritten: false, refusal: `the files of ${ACCOUNT_TREE_KEY}-adapted-20261025-143005 could not all be written.` });

        });

        it('writes no adapted recipe for a recipe whose name an adapted name cannot be built from', () => {

            const textRecipePath = path.join(recipeFolderPath(), 'recipe.txt');
            fs.copyFileSync(recipeFilePath(), textRecipePath);

            const adaptedRun = write({ recipeFilePath: textRecipePath });
            expect(adaptedRun.adaptedRecipeFilePath).toBeUndefined();
            expect(adaptedRun.recipeRefusal).toBe('the adapted recipe\'s file name could not be built from the recipe\'s.');

        });

        it('refuses a tree folder name that is not a plain name, and an object name that is not an api name', () => {

            expect(RecipeCockpitAdaptedDataset.writeAdaptedRun(buildRequest({ treeFolderName: '../escape' }))).toMatchObject({ isWritten: false });
            expect(RecipeCockpitAdaptedDataset.writeAdaptedRun(buildRequest({ objects: [{ objectApiName: '../Account', records: [] }] }))).toMatchObject({ isWritten: false });
            expect(fs.existsSync(fakeDataSetsPath())).toBe(false);

        });

    });

    describe('reading an adapted data set back', () => {

        let temporaryRoot: string;

        const validAdaptSource = () => ({
            ...DatasetSourceService.buildAdaptDatasetSource({ recipeRunFolderName: TREE_RUN_FOLDER_NAME, recipeTreeFolderName: ACCOUNT_TREE_KEY, recipeFileName: 'recipe.yml' }, 'faker-js', ADAPTED_AT.toISOString(), { Account: 1 }, {
                parentObjectApiName: 'Account',
                whereText: '',
                orgUsername: 'qa@example.com.qa',
                updatedFieldsByObject: { Account: [{ fieldApiName: 'Name' }] },
                addedObjectApiNames: ['Case'],
                insertedRecordIdsByObject: { Case: ['500000000000000AAA'] },
                adaptedRecipeFileName: null
            })
        });

        const readSource = (datasetSource: unknown) => {
            const datasetFolderPath = path.join(temporaryRoot, 'Tree-adapted-20261025-143005');
            fs.mkdirSync(path.join(datasetFolderPath, 'BaseArtifactFiles'), { recursive: true });
            fs.writeFileSync(path.join(datasetFolderPath, 'BaseArtifactFiles', 'datasetSource.json'), JSON.stringify(datasetSource));
            return DatasetSourceService.readDatasetSource(datasetFolderPath, [{ runFolderName: TREE_RUN_FOLDER_NAME, treeFolderNames: [ACCOUNT_TREE_KEY] }]);
        };

        beforeEach(() => {
            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-adapted-source-'));
        });

        afterEach(() => {
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        it('reads origin "adapt" with every adaptation field, its name-keyed maps without a prototype', () => {

            const datasetSourceRead = readSource(validAdaptSource());

            expect(datasetSourceRead.status).toBe('linked');
            expect(datasetSourceRead.datasetSource?.origin).toBe('adapt');
            expect(datasetSourceRead.datasetSource?.adaptation).toEqual(validAdaptSource().adaptation);
            expect(Object.getPrototypeOf(datasetSourceRead.datasetSource?.adaptation?.updatedFieldsByObject)).toBeNull();

        });

        it.each([
            ['no adaptation', (source: any) => { delete source.adaptation; }],
            ['an adaptation that is a list', (source: any) => { source.adaptation = []; }],
            ['a WHERE that is not text', (source: any) => { source.adaptation.whereText = 1; }],
            ['an updated field that is a bare name', (source: any) => { source.adaptation.updatedFieldsByObject.Account = ['Name']; }],
            ['an org-only mark that is not true', (source: any) => { source.adaptation.updatedFieldsByObject.Account[0].isOrgOnly = 'yes'; }],
            ['inserted Ids that are not a list of text', (source: any) => { source.adaptation.insertedRecordIdsByObject.Case = '500'; }],
            ['added objects that are not a list', (source: any) => { source.adaptation.addedObjectApiNames = 'Case'; }],
            ['an adapted recipe name that is a number', (source: any) => { source.adaptation.adaptedRecipeFileName = 3; }],
            ['no org username', (source: any) => { delete source.adaptation.orgUsername; }],
            ['an adaptation on a runFaker file', (source: any) => { source.origin = 'runFaker'; }]
        ])('reads %s as unreadable, never throwing', (_description, breakSource) => {

            const brokenSource = JSON.parse(JSON.stringify(validAdaptSource()));
            breakSource(brokenSource);

            expect(readSource(brokenSource).status).toBe('unreadable');

        });

        it.each([
            ['Tree-adapted-20261025-143005', { fakerService: null, timestamp: '2026-10-25T14-30-05', collisionSuffix: null, adaptedFromName: 'Tree' }],
            ['Account-thru-Case-adapted-20261025-143005-2', { fakerService: null, timestamp: '2026-10-25T14-30-05', collisionSuffix: 2, adaptedFromName: 'Account-thru-Case' }],
            ['dataset-fakerjs-2026-09-02T10-00-00-adapted-20261025-143005', { fakerService: null, timestamp: '2026-10-25T14-30-05', collisionSuffix: null, adaptedFromName: 'dataset-fakerjs-2026-09-02T10-00-00' }]
        ])('parses "%s"', (datasetFolderName, expectedDetail) => {

            expect(DatasetSourceService.parseDatasetFolderName(datasetFolderName)).toEqual(expectedDetail);

        });

        it.each(['-adapted-20261025-143005', 'Tree-adapted-20261399-143005', 'Tree-adapted-20261025-250000', 'Tree-adapted-20261025-143005-1', 'Tree-adapted-2026-10-25'])('does not parse "%s"', datasetFolderName => {

            expect(DatasetSourceService.parseDatasetFolderName(datasetFolderName)).toBeUndefined();

        });

        it('builds the folder name in UTC from a plain source name only', () => {

            expect(DatasetSourceService.buildAdaptedDatasetFolderName('Tree', ADAPTED_AT)).toBe('Tree-adapted-20261025-143005');
            expect(DatasetSourceService.buildAdaptedDatasetFolderName('a/b', ADAPTED_AT)).toBeUndefined();
            expect(DatasetSourceService.buildAdaptedDatasetFolderName('..', ADAPTED_AT)).toBeUndefined();

        });

    });

    describe('the tree history', () => {

        it('lists an adapted data set under its tree, newest first among the others, labelled adapted, its backend from its source', () => {

            const knownRecipeRuns = [{ runFolderName: TREE_RUN_FOLDER_NAME, treeFolderNames: [ACCOUNT_TREE_KEY] }];
            const adaptedSource = DatasetSourceService.buildAdaptDatasetSource({ recipeRunFolderName: TREE_RUN_FOLDER_NAME, recipeTreeFolderName: ACCOUNT_TREE_KEY, recipeFileName: 'recipe.yml' }, 'faker-js', ADAPTED_AT.toISOString(), { Account: 2 }, {
                parentObjectApiName: 'Account', whereText: '', orgUsername: 'qa', updatedFieldsByObject: {}, addedObjectApiNames: [], insertedRecordIdsByObject: {}, adaptedRecipeFileName: null
            });
            const linked = (datasetFolderName: string, datasetSource: any) => ({
                datasetFolderName: datasetFolderName,
                datasetFolderPath: datasetFolderName,
                folderNameDetail: DatasetSourceService.parseDatasetFolderName(datasetFolderName)!,
                source: { status: 'linked' as const, basis: 'recorded' as const, recipeRunFolderName: TREE_RUN_FOLDER_NAME, recipeTreeFolderName: ACCOUNT_TREE_KEY, datasetSource: datasetSource, reason: '' }
            });

            const { historiesByTreeKey } = RecipeCockpitTreeHistory.groupTreeHistories(knownRecipeRuns, [
                linked('dataset-2026-10-26T00-00-00', undefined),
                linked(`${ACCOUNT_TREE_KEY}-adapted-20261025-143005`, adaptedSource),
                linked('dataset-2026-10-01T00-00-00', undefined)
            ], [{ treeKey: ACCOUNT_TREE_KEY, folderName: ACCOUNT_TREE_KEY }], TREE_RUN_FOLDER_NAME);

            const datasets = historiesByTreeKey.get(ACCOUNT_TREE_KEY)!.datasets;
            expect(datasets.map(dataset => dataset.datasetFolderName)).toEqual(['dataset-2026-10-26T00-00-00', `${ACCOUNT_TREE_KEY}-adapted-20261025-143005`, 'dataset-2026-10-01T00-00-00']);
            expect(datasets[1]).toEqual({
                datasetFolderName: `${ACCOUNT_TREE_KEY}-adapted-20261025-143005`,
                generatedAtLabel: '2026-10-25 14:30:05 UTC',
                fakerService: 'faker-js',
                runFolderName: TREE_RUN_FOLDER_NAME,
                recordCounts: [{ objectApiName: 'Account', recordCount: 2 }],
                isAdapted: true
            });
            expect(datasets[0]).not.toHaveProperty('isAdapted');

        });

        it('never takes an adapted recipe for the tree\'s recipe', () => {

            const temporaryFolderPath = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-adapted-tree-'));
            try {
                fs.writeFileSync(path.join(temporaryFolderPath, 'recipe--Tree.yml'), '');
                fs.writeFileSync(path.join(temporaryFolderPath, 'recipe--Tree-adapted-20261025-143005.yml'), '');
                fs.writeFileSync(path.join(temporaryFolderPath, 'recipe--Tree-adapted-20261025-143005-2.yml'), '');
                expect(RecipeCockpitTreeHistory.findTreeRecipeFilePath(temporaryFolderPath)).toBe(path.join(temporaryFolderPath, 'recipe--Tree.yml'));
                expect(RecipeCockpitService.collectRecipeFilePaths(temporaryFolderPath)).toEqual([path.join(temporaryFolderPath, 'recipe--Tree.yml')]);
            } finally {
                fs.rmSync(temporaryFolderPath, { recursive: true, force: true });
            }

            expect(RecipeCockpitAdaptedDataset.isAdaptedRecipeFileName('recipe--my-adapted-tree.yml')).toBe(false);
            expect(RecipeCockpitAdaptedDataset.isAdaptedRecipeFileName('recipe--Tree-adapted-20261025-143005.yaml')).toBe(true);

        });

    });

    describe('the panel script', () => {

        it('labels an adapted data set\'s row "adapted" in text, and no other row', () => {

            const recipe: IRecipeCockpitRecipeViewModel = RecipeCockpitService.loadRecipeRunByRuns(
                RecipeCockpitService.findGeneratedRecipeRuns(path.join(HISTORY_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes')),
                HISTORY_WORKSPACE_ROOT,
                TREE_RUN_FOLDER_NAME
            ).recipeViewModel;
            recipe.trees[1].history!.datasets[0].isAdapted = true;

            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 3 });
            const leadCard = panel.treeCards()[1];
            panel.chooseTreeCard(leadCard);
            panel.openTab(leadCard, 'Previously Used Data Sets');
            const rows = panel.findAll(panel.tabPanelOf(leadCard, 'treeDatasets'), 'treeDataset');

            expect(panel.findAll(rows[0], 'treeDatasetAdapted').map((labelElement: any) => labelElement.textContent)).toEqual([RECIPE_COCKPIT_DATASET_ADAPTED_LABEL]);
            rows.slice(1).forEach((rowElement: any) => expect(panel.findAll(rowElement, 'treeDatasetAdapted')).toEqual([]));

        });

    });

});
