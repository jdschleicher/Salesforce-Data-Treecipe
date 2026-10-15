import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';

/*
    #324. Generate Treecipe's real pipeline over an object with validation rules: what the walk
    reads, what the objects wrapper records, and -- run with each backend -- that every generated
    value satisfies the rules generation applied. vscode is a read-only stand-in over the real file
    system, as in DirectoryProcessor.generatedRecipeYaml.test.ts, that also counts what it lists.
*/
jest.mock('vscode', () => {
    const realFs = jest.requireActual('fs');
    const realPath = jest.requireActual('path');
    const toUri = (fsPath: string) => ({ fsPath: fsPath, path: fsPath });
    return {
        workspace: {
            workspaceFolders: undefined,
            fs: {
                readDirectory: async (directoryUri: { fsPath: string }) => {
                    mockDirectoryListing.listedPaths.push(directoryUri.fsPath);
                    try {
                        const directoryEntries = realFs.readdirSync(directoryUri.fsPath, { withFileTypes: true })
                            .map((entry: { name: string; isDirectory: () => boolean }) => [entry.name, entry.isDirectory() ? 2 : 1]);
                        return mockDirectoryListing.arrange(directoryUri.fsPath, directoryEntries);
                    } catch {
                        return [];
                    }
                },
                readFile: async (fileUri: { fsPath: string }) => {
                    if ( mockDirectoryListing.unreadableFileName !== undefined && fileUri.fsPath.endsWith(mockDirectoryListing.unreadableFileName) ) {
                        throw new Error('EACCES');
                    }
                    return realFs.readFileSync(fileUri.fsPath);
                }
            }
        },
        Uri: {
            file: toUri,
            parse: (uriText: string) => toUri(uriText.replace(/^file:\/\//, '')),
            joinPath: (baseUri: { fsPath: string }, ...segments: string[]) => toUri(realPath.join(baseUri.fsPath, ...segments))
        },
        window: { showWarningMessage: jest.fn(), showInformationMessage: jest.fn(), showErrorMessage: jest.fn() },
        FileType: { Directory: 2, File: 1, SymbolicLink: 64 },
        ThemeIcon: jest.fn()
    };
}, { virtual: true });

type DirectoryEntry = [string, number];

const mockDirectoryListing = {
    listedPaths: [] as string[],
    unreadableFileName: undefined as string | undefined,
    arrange: (unusedDirectoryPath: string, directoryEntries: DirectoryEntry[]): DirectoryEntry[] => directoryEntries
};

import * as vscode from 'vscode';
import { ConfigurationService } from '../../ConfigurationService/ConfigurationService';
import { DirectoryProcessor } from '../DirectoryProcessor';
import { ObjectInfoWrapper } from '../../ObjectInfoWrapper/ObjectInfoWrapper';
import { FieldInfo } from '../../ObjectInfoWrapper/FieldInfo';
import { IRecipeFakerService } from '../../RecipeFakerService.ts/IRecipeFakerService';
import { FakerJSRecipeFakerService } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { FakerJSRecipeProcessor } from '../../FakerRecipeProcessor/FakerJSRecipeProcessor/FakerJSRecipeProcessor';
import { PythonTestHarness } from '../../RecipeFakerService.ts/RecipeYamlScalar/tests/mocks/PythonTestHarness';

const VALIDATION_RULE_METADATA_PATH = path.join(__dirname, 'mocks', 'ValidationRuleSalesforceMetadataDirectory');
const VALIDATION_RULE_OBJECTS_PATH = path.join(VALIDATION_RULE_METADATA_PATH, 'objects');

const RECORD_COUNT = 300;

async function processObjects(createFakerService: () => IRecipeFakerService, objectsPath = VALIDATION_RULE_OBJECTS_PATH): Promise<ObjectInfoWrapper> {

    jest.spyOn(ConfigurationService, 'getFakerImplementationByExtensionConfigSelection').mockImplementation(createFakerService);
    jest.spyOn(ConfigurationService, 'getCustomRelationshipMappings').mockReturnValue({});
    jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue([]);

    return new DirectoryProcessor().processAllObjectsAndRelationships(vscode.Uri.file(objectsPath));

}

const fieldOf = (objectInfoWrapper: ObjectInfoWrapper, objectName: string, fieldName: string): FieldInfo =>
    objectInfoWrapper.ObjectToObjectInfoMap[objectName].Fields.find(fieldInfo => fieldInfo.fieldName === fieldName) as FieldInfo;

const appliedRuleNames = (fieldInfo: FieldInfo): string[] => ( fieldInfo.validationRuleConstraints ?? [] ).filter(record => record.applied).map(record => record.ruleName);

const todayUtc = () => new Date().toISOString().slice(0, 10);

/*
    Why one generated Gadget__c breaks a rule generation applied, or undefined. The regex rules are
    applied by faker-js only (snowfakery has no regex generator), so they are checked only when asked.
*/
function findBrokenRules(gadget: Record<string, unknown>, isRegexApplied: boolean, startedOn: string): string[] {

    const brokenRules: string[] = [];
    const expect_ = (isSatisfied: boolean, rule: string) => {
        if ( !isSatisfied ) {
            brokenRules.push(`${rule}: ${JSON.stringify(gadget)}`);
        }
    };
    const amount = String(gadget.Amount__c);
    const quantity = String(gadget.Quantity__c);
    const notes = gadget.Notes__c;

    expect_(/^\d+(\.\d{1,2})?$/.test(amount) && Number(amount) >= 100 && Number(amount) < 50000, 'Require_Amount_Minimum / Require_Amount_Maximum');
    expect_(/^\d+$/.test(quantity) && Number(quantity) > 0 && Number(quantity) <= 500, 'Quantity_Positive / Quantity_Cap');
    expect_(typeof notes === 'string' && notes.length >= 10 && notes.length <= 200, 'Notes_Min_Length / Notes_Max_Length');
    expect_(typeof gadget.Description__c === 'string' && gadget.Description__c.trim() !== '', 'Require_Description');
    expect_(String(gadget.Ship_Date__c) >= startedOn, 'Ship_Date_Future');
    expect_(String(gadget.Launch_Date__c) >= '2024-01-01' && String(gadget.Launch_Date__c) < '2030-01-01', 'Launch_After_2024 / Launch_Before_2030');
    expect_(['Open', 'Won'].includes(String(gadget.Stage__c)), 'Restrict_Lost_Stage');
    if ( gadget.Town__c !== undefined && gadget.Town__c !== null ) {
        expect_(gadget.Town__c !== 'Portland', 'Restrict_Portland');
    }
    if ( isRegexApplied ) {
        expect_(/^[A-Z]{3}-\d{4}$/.test(String(gadget.Code__c)), 'Code_Format');
        expect_(/^\(\d{3}\) \d{3}-\d{4}$/.test(String(gadget.Contact_Phone__c)), 'Phone_Format');
    }

    return brokenRules;

}

describe.each([
    ['faker-js', () => new FakerJSRecipeFakerService(), true],
    ['snowfakery', () => new SnowfakeryRecipeFakerService(), false]
] as const)('Generate Treecipe with the %s backend, over an object with validation rules (#324)', (unusedBackend, createFakerService, isRegexApplied) => {

    let objectInfoWrapper: ObjectInfoWrapper;

    beforeAll(async () => {
        mockDirectoryListing.listedPaths = [];
        objectInfoWrapper = await processObjects(createFakerService);
    });

    test('reads each object\'s validationRules folder once, from the listing the walk already has', () => {

        const validationRulesListings = mockDirectoryListing.listedPaths.filter(listedPath => path.basename(listedPath) === 'validationRules');

        expect(validationRulesListings).toEqual([path.join(VALIDATION_RULE_OBJECTS_PATH, 'Gadget__c', 'validationRules')]);
        expect(mockDirectoryListing.listedPaths.filter(listedPath => listedPath.includes(`${path.sep}validationRules${path.sep}`))).toEqual([]);

    });

    test('records every rule on the field it names, applied or not, with the value it generated before', () => {

        const amount = fieldOf(objectInfoWrapper, 'Gadget__c', 'Amount__c');
        expect(amount.validationRuleConstraints).toEqual([
            { ruleName: 'Require_Amount_Maximum', type: 'numericMax', value: '50000', isExclusive: true, applied: true },
            { ruleName: 'Require_Amount_Minimum', type: 'numericMin', value: '100', applied: true }
        ]);
        expect(amount.unconstrainedRecipeValue).toBe(createFakerService().buildCurrencyRecipeValueWithPrecisionAndScale(10, 2));
        expect(amount.recipeValue).toContain('### Driven by ValidationRule "Require_Amount_Maximum", "Require_Amount_Minimum"');

        expect(appliedRuleNames(fieldOf(objectInfoWrapper, 'Gadget__c', 'Stage__c'))).toEqual(['Restrict_Lost_Stage']);
        expect(appliedRuleNames(fieldOf(objectInfoWrapper, 'Gadget__c', 'Town__c'))).toEqual(['Restrict_Portland']);
        expect(appliedRuleNames(fieldOf(objectInfoWrapper, 'Gadget__c', 'Description__c'))).toEqual(['Require_Description']);
        expect(fieldOf(objectInfoWrapper, 'Gadget__c', 'Score__c').validationRuleConstraints?.map(record => record.applied)).toEqual([false, false]);
        expect(appliedRuleNames(fieldOf(objectInfoWrapper, 'Gadget__c', 'Code__c'))).toEqual(isRegexApplied ? ['Code_Format'] : []);

    });

    test('a field no rule names carries neither record, so it serializes as before', () => {

        const regionJson = JSON.parse(JSON.stringify(fieldOf(objectInfoWrapper, 'Gadget__c', 'Region__c')));
        const weightJson = JSON.parse(JSON.stringify(fieldOf(objectInfoWrapper, 'Widget__c', 'Weight__c')));

        [regionJson, weightJson].forEach(fieldJson => {
            expect(fieldJson).not.toHaveProperty('validationRuleConstraints');
            expect(fieldJson).not.toHaveProperty('unconstrainedRecipeValue');
        });
        expect(objectInfoWrapper.ObjectToObjectInfoMap['Widget__c']).not.toHaveProperty('ValidationRulesNotApplied');

    });

    test('a rule matching no shape, or naming no field the walk read, is recorded on the object; an inactive rule nowhere', () => {

        expect(objectInfoWrapper.ObjectToObjectInfoMap['Gadget__c'].ValidationRulesNotApplied).toEqual([
            { ruleName: 'Complex_Formula', reason: 'its formula is not one of the single-field shapes Treecipe applies' },
            { ruleName: 'Missing_Field', reason: "Nonexistent__c is not a field Treecipe read from this object's fields folder" }
        ]);
        expect(JSON.stringify(objectInfoWrapper)).not.toContain('Inactive_Rule');

    });

    test('every rule not applied is one TODO line in the object\'s recipe, in rule file order', () => {

        const gadgetRecipe = objectInfoWrapper.ObjectToObjectInfoMap['Gadget__c'].FullRecipe;
        const notAppliedRuleNames = [...gadgetRecipe.matchAll(/^ {4}### TODO -- VALIDATION RULE NOT APPLIED -- "(\w+)" -- /gm)].map(([, ruleName]) => ruleName);

        expect(notAppliedRuleNames).toEqual([
            ...( isRegexApplied ? [] : ['Code_Format'] ),
            'Complex_Formula',
            'Missing_Field',
            ...( isRegexApplied ? [] : ['Phone_Format'] ),
            'Score_High',
            'Score_Low'
        ]);

    });

    test('every recipe file loads with js-yaml, Gadget__c with exactly its declared fields', () => {

        const loadedEntries = objectInfoWrapper.RecipeFiles
            .flatMap(recipeFile => yaml.load(recipeFile.content) as Array<{ object: string, fields: Record<string, unknown>, friends?: unknown[] }>);
        const gadget = loadedEntries.find(loadedEntry => loadedEntry.object === 'Gadget__c');

        expect(Object.keys(gadget?.fields ?? {}).sort()).toEqual(objectInfoWrapper.ObjectToObjectInfoMap['Gadget__c'].Fields.map(fieldInfo => fieldInfo.fieldName).sort());

    });

});

describe('Generate Treecipe over a workspace with no validationRules folder (#324)', () => {

    let workspacePath: string;

    beforeAll(() => {
        workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-no-rules-'));
        fs.cpSync(VALIDATION_RULE_OBJECTS_PATH, workspacePath, { recursive: true });
        fs.rmSync(path.join(workspacePath, 'Gadget__c', 'validationRules'), { recursive: true, force: true });
    });

    afterAll(() => {
        fs.rmSync(workspacePath, { recursive: true, force: true });
    });

    test.each([
        ['faker-js', () => new FakerJSRecipeFakerService()],
        ['snowfakery', () => new SnowfakeryRecipeFakerService()]
    ] as const)('with %s, generates every field as it generated before any rule was applied, and records nothing', async (unusedBackend, createFakerService) => {

        const withRules = await processObjects(createFakerService);
        const withoutRules = await processObjects(createFakerService, workspacePath);

        withoutRules.ObjectToObjectInfoMap['Gadget__c'].Fields.forEach(fieldInfo => {
            const ruledField = fieldOf(withRules, 'Gadget__c', fieldInfo.fieldName);
            expect(fieldInfo.recipeValue).toBe(ruledField.unconstrainedRecipeValue ?? ruledField.recipeValue);
        });
        expect(withoutRules.ObjectToObjectInfoMap['Widget__c'].FullRecipe).toBe(withRules.ObjectToObjectInfoMap['Widget__c'].FullRecipe);

        const wrapperJson = JSON.stringify(withoutRules);
        ['validationRuleConstraints', 'unconstrainedRecipeValue', 'ValidationRulesNotApplied', 'Driven by ValidationRule', 'VALIDATION RULE NOT APPLIED'].forEach(ruleText => {
            expect(wrapperJson).not.toContain(ruleText);
        });

    });

});

describe('DirectoryProcessor.readValidationRuleAnalyses', () => {

    const gadgetUri = vscode.Uri.file(path.join(VALIDATION_RULE_OBJECTS_PATH, 'Gadget__c'));

    beforeEach(() => {
        jest.spyOn(ConfigurationService, 'getFakerImplementationByExtensionConfigSelection').mockImplementation(() => new FakerJSRecipeFakerService());
    });

    afterEach(() => {
        mockDirectoryListing.arrange = (unusedDirectoryPath, directoryEntries) => directoryEntries;
        mockDirectoryListing.unreadableFileName = undefined;
    });

    test('reads rule files in name order whatever order the file system lists them', async () => {

        mockDirectoryListing.arrange = (directoryPath, directoryEntries) => ( directoryPath.endsWith('validationRules') ? [...directoryEntries].reverse() : directoryEntries );
        const analyses = await new DirectoryProcessor().readValidationRuleAnalyses(gadgetUri, [['validationRules', vscode.FileType.Directory]]);
        const ruleNames = analyses.map(analysis => analysis.ruleName);

        expect(ruleNames).toEqual([...ruleNames].sort((first, second) => ( first < second ? -1 : 1 )));
        expect(ruleNames).toHaveLength(18);

    });

    test('lists nothing for an object with no validationRules folder, or one that is a file', async () => {

        const directoryProcessor = new DirectoryProcessor();
        mockDirectoryListing.listedPaths = [];

        expect(await directoryProcessor.readValidationRuleAnalyses(gadgetUri, [['fields', vscode.FileType.Directory]])).toEqual([]);
        expect(await directoryProcessor.readValidationRuleAnalyses(gadgetUri, [['validationRules', vscode.FileType.File]])).toEqual([]);
        expect(mockDirectoryListing.listedPaths).toEqual([]);

    });

    test('skips a file that is not a rule, and records one it cannot read as not applied', async () => {

        mockDirectoryListing.arrange = (directoryPath, directoryEntries) => ( directoryPath.endsWith('validationRules')
            ? [...directoryEntries, ['README.md', 1], ['nested.validationRule-meta.xml', 2]]
            : directoryEntries );
        mockDirectoryListing.unreadableFileName = 'Code_Format.validationRule-meta.xml';

        const analyses = await new DirectoryProcessor().readValidationRuleAnalyses(gadgetUri, [['validationRules', vscode.FileType.Directory]]);

        expect(analyses.find(analysis => analysis.ruleName === 'Code_Format.validationRule-meta.xml')).toEqual({ ruleName: 'Code_Format.validationRule-meta.xml', notAppliedReason: 'the file could not be read' });
        expect(analyses.map(analysis => analysis.ruleName)).not.toContain('README.md');
        expect(analyses).toHaveLength(18);

    });

});

describe('every generated value satisfies the rules generation applied (#324)', () => {

    const runnableRecipe = (recipeText: string): string => {
        const countedRecipe = recipeText.replace(/^(- object: Gadget__c\n(?: {2}\S.*\n)*?) {2}count: 1\n/m, `$1  count: ${RECORD_COUNT}\n`);
        expect(countedRecipe).toContain(`  count: ${RECORD_COUNT}\n`);
        return countedRecipe;
    };

    test('faker-js, through the real recipe processor', async () => {

        const objectInfoWrapper = await processObjects(() => new FakerJSRecipeFakerService());
        const temporaryFolderPath = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-validation-rules-'));

        try {

            const recipeFilePath = path.join(temporaryFolderPath, 'recipe.yml');
            fs.writeFileSync(recipeFilePath, runnableRecipe(objectInfoWrapper.RecipeFiles[0].content));

            const startedOn = todayUtc();
            const generatedRecords = JSON.parse(await new FakerJSRecipeProcessor().generateFakeDataBySelectedRecipeFile(recipeFilePath)) as Array<{ object: string, fields: Record<string, unknown> }>;
            const gadgets = generatedRecords.filter(generatedRecord => generatedRecord.object === 'Gadget__c');

            expect(gadgets).toHaveLength(RECORD_COUNT);
            expect(gadgets.flatMap(gadget => findBrokenRules(gadget.fields, true, startedOn)).slice(0, 5)).toEqual([]);

        } finally {
            fs.rmSync(temporaryFolderPath, { recursive: true, force: true });
        }

    });

    PythonTestHarness.testRequiringModules('yaml', 'jinja2', 'faker')('snowfakery, read with PyYAML and rendered with Jinja and Faker', async () => {

        const objectInfoWrapper = await processObjects(() => new SnowfakeryRecipeFakerService());

        const startedOn = todayUtc();
        // A DEPENDENT PICKLIST'S if: IS SNOWFAKERY'S OWN STRUCTURE, NOT A TEMPLATE, SO ONLY THE STRING FIELDS ARE RENDERED HERE
        const gadgets = PythonTestHarness.runPython([
            'import datetime, json, random, sys, yaml, jinja2',
            'from faker import Faker',
            'environment = jinja2.Environment(block_start_string="${%", block_end_string="%}", variable_start_string="${{", variable_end_string="}}")',
            'environment.globals.update(fake=Faker(), date=datetime.date.fromisoformat, datetime=datetime.datetime.fromisoformat, random_choice=lambda *options: random.choice(options))',
            'request = json.load(sys.stdin)',
            'recipe = [entry for entry in yaml.safe_load(request["recipeText"]) if entry.get("object") == "Gadget__c"][0]',
            'templates = {name: environment.from_string(value) for name, value in recipe["fields"].items() if isinstance(value, str)}',
            'print(json.dumps([{name: template.render() for name, template in templates.items()} for _ in range(recipe["count"])]))'
        ].join('\n'), { recipeText: runnableRecipe(objectInfoWrapper.RecipeFiles[0].content) }) as Array<Record<string, unknown>>;

        expect(gadgets).toHaveLength(RECORD_COUNT);
        expect(gadgets.flatMap(gadget => findBrokenRules(gadget, false, startedOn)).slice(0, 5)).toEqual([]);

    });

});
