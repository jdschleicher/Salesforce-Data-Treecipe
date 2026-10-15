import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';

/*
    #324. Validation rules are workspace text, so every hostile picklist value is run through every
    formula shape -- as an ISPICKVAL value, a REGEX pattern, a number, a length, a date, a field
    reference, and as the rule's NAME -- in a workspace written for the test (line breaks as XML
    character references, so only xml2js turns them into breaks). With each backend, every recipe
    file must load in js-yaml and PyYAML with no field the metadata did not declare, and generating
    from it must evaluate nothing a rule carries.
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

import * as vscode from 'vscode';
import { ConfigurationService } from '../../ConfigurationService/ConfigurationService';
import { DirectoryProcessor } from '../DirectoryProcessor';
import { ObjectInfoWrapper } from '../../ObjectInfoWrapper/ObjectInfoWrapper';
import { IRecipeFakerService } from '../../RecipeFakerService.ts/IRecipeFakerService';
import { FakerJSRecipeFakerService } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { FakerJSRecipeProcessor } from '../../FakerRecipeProcessor/FakerJSRecipeProcessor/FakerJSRecipeProcessor';
import { PythonTestHarness } from '../../RecipeFakerService.ts/RecipeYamlScalar/tests/mocks/PythonTestHarness';
import { HOSTILE_PICKLIST_VALUES, INJECTED_FIELD_API_NAME, INJECTION_MARKER } from '../../RecipeFakerService.ts/RecipeYamlScalar/tests/mocks/HostilePicklistValues';

const PAYLOADS = HOSTILE_PICKLIST_VALUES.map(([, payload]) => payload);
const SAFE_STAGE = 'Safe';
const RECORD_COUNT = 200;

// A PATTERN THE ANALYZER ACCEPTS IS LITERAL CHARACTERS, CLASSES AND QUANTIFIERS -- WHICH A JS RegExp READS THE SAME
const isPureNumber = (payload: string) => /^[+-]?\d+(\.\d+)?$/.test(payload);
const isPureLength = (payload: string) => /^\d{1,7}$/.test(payload);

const xmlText = (value: string): string => value.replace(/[&<>"']|[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, (character: string) => `&#x${character.charCodeAt(0).toString(16)};`);
const formulaString = (value: string): string => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const codeFieldName = (index: number) => `Code_${index}__c`;

const DECLARED_FIELD_API_NAMES = ['Amount__c', 'Notes__c', 'Ship_Date__c', 'Stage__c', ...PAYLOADS.map((unusedPayload, index) => codeFieldName(index))].sort();

function writeHostileWorkspace(objectsPath: string): void {

    const objectPath = path.join(objectsPath, 'Gadget__c');
    const fieldsPath = path.join(objectPath, 'fields');
    const rulesPath = path.join(objectPath, 'validationRules');
    fs.mkdirSync(fieldsPath, { recursive: true });
    fs.mkdirSync(rulesPath, { recursive: true });

    const writeField = (fieldName: string, body: string) => fs.writeFileSync(path.join(fieldsPath, `${fieldName}.field-meta.xml`),
        `<?xml version="1.0" encoding="UTF-8"?>\n<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">\n    <fullName>${fieldName}</fullName>\n    <label>${fieldName}</label>\n${body}\n</CustomField>\n`);
    const writeRule = (fileName: string, ruleName: string, formula: string) => fs.writeFileSync(path.join(rulesPath, `${fileName}.validationRule-meta.xml`),
        `<?xml version="1.0" encoding="UTF-8"?>\n<ValidationRule xmlns="http://soap.sforce.com/2006/04/metadata">\n    <fullName>${xmlText(ruleName)}</fullName>\n    <active>true</active>\n    <errorConditionFormula>${xmlText(formula)}</errorConditionFormula>\n    <errorMessage>${xmlText(ruleName)}</errorMessage>\n</ValidationRule>\n`);

    writeField('Amount__c', '    <precision>10</precision>\n    <scale>2</scale>\n    <type>Currency</type>');
    writeField('Notes__c', '    <length>1000</length>\n    <type>LongTextArea</type>');
    writeField('Ship_Date__c', '    <type>Date</type>');
    writeField('Stage__c', `    <type>Picklist</type>\n    <valueSet>\n        <valueSetDefinition>\n${[...PAYLOADS, SAFE_STAGE].map(value => `            <value>\n                <fullName>${xmlText(value)}</fullName>\n                <default>false</default>\n                <label>x</label>\n            </value>`).join('\n')}\n        </valueSetDefinition>\n    </valueSet>`);

    PAYLOADS.forEach((payload, index) => {
        writeField(codeFieldName(index), '    <length>255</length>\n    <type>Text</type>');
        writeRule(`Pickval_${index}`, `Pickval_${index}`, `ISPICKVAL(Stage__c, ${formulaString(payload)})`);
        writeRule(`Regex_${index}`, `Regex_${index}`, `NOT(REGEX(${codeFieldName(index)}, ${formulaString(payload)}))`);
        writeRule(`Number_${index}`, `Number_${index}`, `Amount__c < ${payload}`);
        writeRule(`Length_${index}`, `Length_${index}`, `LEN(Notes__c) > ${payload}`);
        writeRule(`Date_${index}`, `Date_${index}`, `Ship_Date__c < ${payload}`);
        writeRule(`Blank_${index}`, `Blank_${index}`, `ISBLANK(${payload})`);
        writeRule(`Named_${index}`, payload, 'Amount__c > 900000');
        writeRule(`NamedMissing_${index}`, payload, 'ISBLANK(Gone__c)');
    });

}

let workspacePath: string;
let objectsPath: string;

beforeAll(() => {
    workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-hostile-rules-'));
    objectsPath = path.join(workspacePath, 'objects');
    writeHostileWorkspace(objectsPath);
});

afterAll(() => {
    fs.rmSync(workspacePath, { recursive: true, force: true });
});

afterEach(() => {
    delete (globalThis as Record<string, unknown>)[INJECTION_MARKER];
});

async function processHostileRules(createFakerService: () => IRecipeFakerService): Promise<ObjectInfoWrapper> {

    jest.spyOn(ConfigurationService, 'getFakerImplementationByExtensionConfigSelection').mockImplementation(createFakerService);
    jest.spyOn(ConfigurationService, 'getCustomRelationshipMappings').mockReturnValue({});
    jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue([]);
    return new DirectoryProcessor().processAllObjectsAndRelationships(vscode.Uri.file(objectsPath));

}

const testRequiringPyYaml = PythonTestHarness.testRequiringModules('yaml');

describe.each([
    ['faker-js', () => new FakerJSRecipeFakerService()],
    ['snowfakery', () => new SnowfakeryRecipeFakerService()]
] as const)('Generate Treecipe with the %s backend, over hostile validation rules', (unusedBackend, createFakerService) => {

    let objectInfoWrapper: ObjectInfoWrapper;
    let recipeTexts: string[];

    beforeAll(async () => {
        objectInfoWrapper = await processHostileRules(createFakerService);
        recipeTexts = objectInfoWrapper.RecipeFiles.map(recipeFile => recipeFile.content);
    });

    const ruleRecord = (fieldName: string, ruleName: string) => objectInfoWrapper.ObjectToObjectInfoMap['Gadget__c'].Fields
        .find(fieldInfo => fieldInfo.fieldName === fieldName)?.validationRuleConstraints?.find(record => record.ruleName === ruleName);

    test('reads every rule, so the checks below are about them', () => {

        const gadget = objectInfoWrapper.ObjectToObjectInfoMap['Gadget__c'];

        expect(gadget.Fields.map(fieldInfo => fieldInfo.fieldName).sort()).toEqual(DECLARED_FIELD_API_NAMES);
        PAYLOADS.forEach((unusedPayload, index) => {
            expect(ruleRecord('Stage__c', `Pickval_${index}`)?.applied).toBe(true);
            expect(ruleRecord(codeFieldName(index), `Regex_${index}`)).toBeDefined();
        });
        expect(gadget.ValidationRulesNotApplied?.length).toBeGreaterThanOrEqual(PAYLOADS.length * 2);

    });

    test('a number or length shape applies only to a payload that IS one; no date and no field reference does', () => {

        PAYLOADS.forEach((payload, index) => {
            expect([payload, ruleRecord('Amount__c', `Number_${index}`)?.applied ?? false]).toEqual([payload, isPureNumber(payload)]);
            expect([payload, ruleRecord('Notes__c', `Length_${index}`)?.applied ?? false]).toEqual([payload, isPureLength(payload)]);
            expect([payload, ruleRecord('Ship_Date__c', `Date_${index}`)?.applied ?? false]).toEqual([payload, false]);
        });
        const notAppliedRuleNames = objectInfoWrapper.ObjectToObjectInfoMap['Gadget__c'].ValidationRulesNotApplied?.map(notApplied => notApplied.ruleName);
        PAYLOADS.forEach((unusedPayload, index) => {
            expect(notAppliedRuleNames).toContain(`Blank_${index}`);
        });

    });

    test('every recipe file loads with js-yaml with exactly the declared fields, and names no injected field on any line', () => {

        recipeTexts.forEach(recipeText => {
            const gadget = ( yaml.load(recipeText) as Array<{ object: string, fields: Record<string, unknown> }> ).find(entry => entry.object === 'Gadget__c');
            expect(Object.keys(gadget?.fields ?? {}).sort()).toEqual(DECLARED_FIELD_API_NAMES);
            recipeText.split(/\r\n|\r|\n|\u0085|\u2028|\u2029/).forEach(recipeLine => {
                expect(recipeLine).not.toMatch(new RegExp(`^\\s*${INJECTED_FIELD_API_NAME}:`));
            });
        });

    });

    testRequiringPyYaml('every recipe file loads with PyYAML exactly as js-yaml loads it', () => {

        expect(PythonTestHarness.loadWithPyYaml(recipeTexts)).toEqual(recipeTexts.map(recipeText => yaml.load(recipeText)));

    });

});

describe('Run Faker by Recipe over the hostile validation rules', () => {

    test('faker-js evaluates nothing a rule carries, leaves out every excluded value, and matches every applied regex', async () => {

        const objectInfoWrapper = await processHostileRules(() => new FakerJSRecipeFakerService());
        const recipeFilePath = path.join(workspacePath, 'recipe.yml');
        fs.writeFileSync(recipeFilePath, objectInfoWrapper.RecipeFiles[0].content.replace(/^( {2}count: )1$/m, `$1${RECORD_COUNT}`));

        const records = ( JSON.parse(await new FakerJSRecipeProcessor().generateFakeDataBySelectedRecipeFile(recipeFilePath)) as Array<{ fields: Record<string, unknown> }> )
            .map(record => record.fields);
        const appliedRegexIndexes = PAYLOADS
            .map((unusedPayload, index) => index)
            .filter(index => objectInfoWrapper.ObjectToObjectInfoMap['Gadget__c'].Fields
                .find(fieldInfo => fieldInfo.fieldName === codeFieldName(index))?.validationRuleConstraints?.[0].applied);

        expect(globalThis).not.toHaveProperty(INJECTION_MARKER);
        expect(records).toHaveLength(RECORD_COUNT);
        expect(appliedRegexIndexes.length).toBeGreaterThan(0);
        records.forEach(record => {
            expect(Object.keys(record).sort()).toEqual(DECLARED_FIELD_API_NAMES);
            expect(record.Stage__c).toBe(SAFE_STAGE);
            appliedRegexIndexes.forEach(index => {
                expect([PAYLOADS[index], new RegExp(`^(?:${PAYLOADS[index]})$`).test(String(record[codeFieldName(index)]))]).toEqual([PAYLOADS[index], true]);
            });
        });

    });

    PythonTestHarness.testRequiringModules('jinja2')('snowfakery renders the narrowed picklist to exactly the one value left', async () => {

        const objectInfoWrapper = await processHostileRules(() => new SnowfakeryRecipeFakerService());
        const gadget = ( yaml.load(objectInfoWrapper.RecipeFiles[0].content) as Array<{ object: string, fields: Record<string, string> }> )
            .find(entry => entry.object === 'Gadget__c');

        expect(PythonTestHarness.renderWithSnowfakeryJinja([{ template: gadget?.fields.Stage__c as string }])).toEqual([{ rendered: SAFE_STAGE }]);

    });

});
