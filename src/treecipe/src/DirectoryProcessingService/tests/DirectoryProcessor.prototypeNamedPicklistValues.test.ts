import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';

/*
    #160. Picklist values are metadata text, and some ordinary words are also the names of
    Object.prototype members. A value keyed into a plain {} map as "constructor" or "toString" reads
    back the inherited function, and "__proto__" assigned into one replaces the prototype rather than
    adding a key -- so generation threw, or dropped the value without a word.

    The fixture runs through the real pipeline with each backend: a controlling picklist, a dependent
    picklist and a global-value-set-backed dependent picklist (the XmlFileProcessor path), a
    multi-select and a record type, every one carrying constructor, toString, valueOf, hasOwnProperty
    and __proto__ beside one ordinary value. OnlyPrototype__c is the unhappy path: each picklist
    carries a prototype name and nothing else.

    vscode is replaced by a read-only stand-in over the real file system, as in
    DirectoryProcessor.hostilePicklistValues.test.ts.
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
import { GlobalValueSetSingleton } from '../../GlobalValueSetSingleton/GlobalValueSetSingleton';
import { RelationshipService, RecipeFileOutput } from '../../RelationshipService/RelationshipService';
import { IRecipeFakerService } from '../../RecipeFakerService.ts/IRecipeFakerService';
import { FakerJSRecipeFakerService } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { FakerJSRecipeProcessor } from '../../FakerRecipeProcessor/FakerJSRecipeProcessor/FakerJSRecipeProcessor';
import { PicklistDependencyTestService, IPicklistDependencyCollectionResult } from '../../PicklistDependencyTestService/PicklistDependencyTestService';
import { PicklistDependencyManifestService } from '../../PicklistDependencyManifestService/PicklistDependencyManifestService';
import { PythonTestHarness } from '../../RecipeFakerService.ts/RecipeYamlScalar/tests/mocks/PythonTestHarness';

const PROTOTYPE_METADATA_PATH = path.join(__dirname, 'mocks', 'PrototypeNamedSalesforceMetadataDirectory');
const PROTOTYPE_OBJECTS_PATH = path.join(PROTOTYPE_METADATA_PATH, 'objects');

const PROTOTYPE_MEMBER_NAMES = ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'];
const ORDINARY_VALUE = 'Ordinary';
const FIXTURE_PICKLIST_VALUES = [...PROTOTYPE_MEMBER_NAMES, ORDINARY_VALUE];

const DECLARED_FIELD_API_NAMES_BY_OBJECT: Record<string, string[]> = {
    PrototypeNamed__c: ['Controlling__c', 'Dependent__c', 'GlobalDependent__c', 'Multi__c', 'RecordTypeId'],
    OnlyPrototype__c: ['Controlling__c', 'Dependent__c']
};

type LoadedRecipeEntry = { object?: string, fields?: Record<string, unknown> };

async function generateRecipeFiles(createFakerService: () => IRecipeFakerService): Promise<RecipeFileOutput[]> {

    jest.spyOn(ConfigurationService, 'getFakerImplementationByExtensionConfigSelection').mockImplementation(createFakerService);
    jest.spyOn(ConfigurationService, 'getCustomRelationshipMappings').mockReturnValue({});
    jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue([]);

    await GlobalValueSetSingleton.getInstance().initialize(PROTOTYPE_METADATA_PATH);
    const objectInfoWrapper = await new DirectoryProcessor().processAllObjectsAndRelationships(vscode.Uri.file(PROTOTYPE_OBJECTS_PATH));

    return new RelationshipService().generateSeparateRecipeFiles(objectInfoWrapper);

}

function getLoadedObjectEntry(recipeFiles: RecipeFileOutput[], objectApiName: string): LoadedRecipeEntry {

    const matchingEntries = recipeFiles
        .flatMap(recipeFile => yaml.load(recipeFile.content) as LoadedRecipeEntry[])
        .filter(recipeEntry => recipeEntry.object === objectApiName);

    expect(matchingEntries).toHaveLength(1);
    return matchingEntries[0];

}

function getRecipeFieldLines(recipeFiles: RecipeFileOutput[], objectApiName: string, fieldApiName: string): string[] {

    const recipeLines = recipeFiles.find(recipeFile => recipeFile.content.includes(`- object: ${objectApiName}\n`)).content.split('\n');
    const objectLineIndex = recipeLines.indexOf(`- object: ${objectApiName}`);
    const fieldLineIndex = recipeLines.findIndex((recipeLine, lineIndex) => lineIndex > objectLineIndex && recipeLine.startsWith(`    ${fieldApiName}:`));
    const nextFieldLineOffset = recipeLines.slice(fieldLineIndex + 1).findIndex(recipeLine => /^ {0,4}\S/.test(recipeLine));

    return recipeLines.slice(fieldLineIndex, nextFieldLineOffset === -1 ? undefined : fieldLineIndex + 1 + nextFieldLineOffset);

}

describe('the prototype-named metadata fixture', () => {

    test('decodes to exactly the prototype names and one ordinary value, so the tests below are about them', async () => {

        await GlobalValueSetSingleton.getInstance().initialize(PROTOTYPE_METADATA_PATH);

        expect(GlobalValueSetSingleton.getInstance().getPicklistValueMaps()['PrototypeGlobal']).toEqual(FIXTURE_PICKLIST_VALUES);

    });

});

const testRequiringPyYaml = PythonTestHarness.testRequiringModules('yaml');

/*
    A choice or condition is found by the value's own quoted spelling rather than by parsing each
    backend's expression grammar: both backends quote a picklist value in its when: condition, and
    every one of these values is plain and safe, so a quoted occurrence is the value and nothing else.
*/
describe.each([
    ['faker-js', () => new FakerJSRecipeFakerService()],
    ['snowfakery', () => new SnowfakeryRecipeFakerService()]
] as const)('Generate Treecipe with the %s backend, over prototype-named picklist values', (unusedBackend, createFakerService) => {

    let recipeFiles: RecipeFileOutput[];

    beforeAll(async () => {
        recipeFiles = await generateRecipeFiles(createFakerService);
    });

    test.each(Object.keys(DECLARED_FIELD_API_NAMES_BY_OBJECT))('writes %s with exactly its declared fields, and it loads with js-yaml', (objectApiName) => {

        const objectEntry = getLoadedObjectEntry(recipeFiles, objectApiName);

        expect(Object.keys(objectEntry.fields).sort()).toEqual(DECLARED_FIELD_API_NAMES_BY_OBJECT[objectApiName]);

    });

    testRequiringPyYaml('every recipe file loads with PyYAML exactly as js-yaml loads it', () => {

        const recipeTexts = recipeFiles.map(recipeFile => recipeFile.content);

        expect(PythonTestHarness.loadWithPyYaml(recipeTexts)).toEqual(recipeTexts.map(recipeText => yaml.load(recipeText)));

    });

    test.each(FIXTURE_PICKLIST_VALUES)('the controlling default expression and the multi-select carry %s', (picklistValue) => {

        [
            getRecipeFieldLines(recipeFiles, 'PrototypeNamed__c', 'Controlling__c')[0],
            getRecipeFieldLines(recipeFiles, 'PrototypeNamed__c', 'Multi__c')[0]
        ].forEach(defaultExpressionLine => {
            expect(defaultExpressionLine).toMatch(new RegExp(`[\`'"]${picklistValue}[\`'"]`));
        });

    });

    test.each(['Dependent__c', 'GlobalDependent__c'])('%s has one when: per controlling value, each offering exactly what that value unlocks', (dependentFieldApiName) => {

        const dependentFieldLines = getRecipeFieldLines(recipeFiles, 'PrototypeNamed__c', dependentFieldApiName);
        const whenLineIndexes = dependentFieldLines
            .map((recipeLine, lineIndex) => (/^\s+(- )?when: /.test(recipeLine) ? lineIndex : -1))
            .filter(lineIndex => lineIndex !== -1);

        const unlockedValuesByControllingValue = Object.fromEntries(whenLineIndexes.map((whenLineIndex, whenIndex) => {

            const controllingValue = FIXTURE_PICKLIST_VALUES.find(fixtureValue => dependentFieldLines[whenLineIndex].includes(`'${fixtureValue}'`));
            // THE CHOICES THE VALUE SETTINGS UNLOCK END WHERE A RECORD TYPE'S OWN SECTION OF THE SAME LIST BEGINS
            const choiceLines = dependentFieldLines.slice(whenLineIndex + 1, whenLineIndexes[whenIndex + 1])
                .join('\n').split('### TODO: -- RecordType Options --')[0].split('\n');
            const unlockedValues = FIXTURE_PICKLIST_VALUES.filter(fixtureValue => choiceLines.some(choiceLine => new RegExp(`(^|[\\s\`'"-])${fixtureValue}([\`'"]|$)`).test(choiceLine.trim())));

            return [controllingValue, unlockedValues.sort()];

        }));

        const expectedUnlockedValuesByControllingValue = Object.fromEntries([
            ...PROTOTYPE_MEMBER_NAMES.map(prototypeMemberName => [prototypeMemberName, [prototypeMemberName, ORDINARY_VALUE].sort()]),
            [ORDINARY_VALUE, [...FIXTURE_PICKLIST_VALUES].sort()]
        ]);

        expect(whenLineIndexes).toHaveLength(FIXTURE_PICKLIST_VALUES.length);
        expect(unlockedValuesByControllingValue).toEqual(expectedUnlockedValuesByControllingValue);

    });

    test('a picklist carrying ONLY a prototype name still generates a condition and a choice for it', () => {

        const controllingLines = getRecipeFieldLines(recipeFiles, 'OnlyPrototype__c', 'Controlling__c');
        const dependentText = getRecipeFieldLines(recipeFiles, 'OnlyPrototype__c', 'Dependent__c').join('\n');

        expect(controllingLines[0]).toMatch(/[`'"]__proto__[`'"]/);
        expect(dependentText).toContain(`'__proto__'`);
        expect(dependentText).toMatch(/(^|[\s`'"-])constructor([`'"]|$)/m);

    });

});

describe('Run Faker by Recipe with faker-js over the prototype-named recipe', () => {

    let recipeDirectoryPath: string;
    let recipeFiles: RecipeFileOutput[];

    beforeAll(async () => {
        recipeFiles = await generateRecipeFiles(() => new FakerJSRecipeFakerService());
        recipeDirectoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-prototype-'));
    });

    afterAll(() => {
        fs.rmSync(recipeDirectoryPath, { recursive: true, force: true });
    });

    test('every prototype name is generated as a value, and a dependent value is always one its controlling value unlocks', async () => {

        const prototypeRecipeFile = recipeFiles.find(recipeFile => recipeFile.content.includes('- object: PrototypeNamed__c'));
        const recipeFilePath = path.join(recipeDirectoryPath, prototypeRecipeFile.fileName);
        const runnableRecipeText = prototypeRecipeFile.content
            .replace(/^(- object: PrototypeNamed__c\n(?: {2}\S.*\n)*?) {2}count: 1\n/m, '$1  count: 300\n')
            .replace(/^( {4}RecordTypeId: ).*$/m, '$1EveryValue');
        expect(runnableRecipeText).toContain('  count: 300\n');
        fs.writeFileSync(recipeFilePath, runnableRecipeText);

        const generatedRecords = JSON.parse(await new FakerJSRecipeProcessor().generateFakeDataBySelectedRecipeFile(recipeFilePath)) as Array<{ object: string, fields: Record<string, string> }>;
        const prototypeRecords = generatedRecords.filter(generatedRecord => generatedRecord.object === 'PrototypeNamed__c');

        expect(prototypeRecords).toHaveLength(300);
        prototypeRecords.forEach(prototypeRecord => {
            const controllingValue = prototypeRecord.fields['Controlling__c'];
            const allowedDependentValues = controllingValue === ORDINARY_VALUE ? FIXTURE_PICKLIST_VALUES : [controllingValue, ORDINARY_VALUE];
            expect(FIXTURE_PICKLIST_VALUES).toContain(controllingValue);
            // Dependent__c's list also carries the EveryValue record type's section, which assigns every value
            expect(FIXTURE_PICKLIST_VALUES).toContain(prototypeRecord.fields['Dependent__c']);
            expect(allowedDependentValues).toContain(prototypeRecord.fields['GlobalDependent__c']);
        });
        ['Controlling__c', 'Dependent__c', 'GlobalDependent__c'].forEach(fieldApiName => {
            expect(new Set(prototypeRecords.map(prototypeRecord => prototypeRecord.fields[fieldApiName]))).toEqual(new Set(FIXTURE_PICKLIST_VALUES));
        });

    });

});

describe('Generate Picklist Dependency Tests over prototype-named picklist values', () => {

    let collectionResult: IPicklistDependencyCollectionResult;

    beforeAll(async () => {
        await GlobalValueSetSingleton.getInstance().initialize(PROTOTYPE_METADATA_PATH);
        collectionResult = await PicklistDependencyTestService.collectSpecDetailsByObjectsDirectory(vscode.Uri.file(PROTOTYPE_OBJECTS_PATH));
    });

    test.each(['Dependent__c', 'GlobalDependent__c'])('emits an expectation for every prototype-named controlling value of %s', (dependentFieldApiName) => {

        const specDetail = collectionResult.specDetails.find(candidateSpecDetail =>
            candidateSpecDetail.objectApiName === 'PrototypeNamed__c' && candidateSpecDetail.fieldApiName === dependentFieldApiName);

        const dependentValuesByControllingValue = Object.fromEntries(
            specDetail.expectations.map(expectation => [expectation.controllingValue, [...expectation.dependentValues].sort()])
        );

        expect(Object.keys(dependentValuesByControllingValue).sort()).toEqual([...FIXTURE_PICKLIST_VALUES].sort());
        PROTOTYPE_MEMBER_NAMES.forEach(prototypeMemberName => {
            expect(dependentValuesByControllingValue[prototypeMemberName]).toEqual([prototypeMemberName, ORDINARY_VALUE].sort());
        });
        expect(dependentValuesByControllingValue[ORDINARY_VALUE]).toEqual([...FIXTURE_PICKLIST_VALUES].sort());

    });

    test('the unhappy path, a controlling picklist of only __proto__, emits its one expectation', () => {

        const specDetail = collectionResult.specDetails.find(candidateSpecDetail => candidateSpecDetail.objectApiName === 'OnlyPrototype__c');

        expect(specDetail.expectations.map(expectation => [expectation.controllingValue, expectation.dependentValues])).toEqual([['__proto__', ['constructor']]]);

    });

    test('the emitted Apex names every prototype-named value, and parses back to the same specs', () => {

        const prototypeSpecDetails = collectionResult.specDetails.filter(specDetail => specDetail.objectApiName === 'PrototypeNamed__c');
        const apexClassBody = PicklistDependencyTestService.buildPerObjectSpecsApexClassBody(
            'PrototypeNamed__c',
            PicklistDependencyTestService.buildPerObjectSpecsClassName('PrototypeNamed__c'),
            prototypeSpecDetails,
            []
        );

        PROTOTYPE_MEMBER_NAMES.forEach(prototypeMemberName => {
            expect(apexClassBody).toContain(`'${prototypeMemberName}'`);
        });
        expect(PicklistDependencyTestService.parseSpecDetailsByApexClassBody(apexClassBody, 'PrototypeNamed__c').map(specDetail => specDetail.expectations))
            .toEqual(prototypeSpecDetails.map(specDetail => specDetail.expectations.map(({ forbiddenValues, ...expectation }) =>
                // AN EMPTY COMPLEMENT EMITS NO expectNotAllowed CALL, SO IT PARSES BACK ABSENT
                (forbiddenValues.length === 0 ? expectation : { ...expectation, forbiddenValues })
            )));

    });

    test('the manifest round-trips every prototype-named expectation through its serialized text', () => {

        const manifest = PicklistDependencyManifestService.buildManifest(
            collectionResult,
            PROTOTYPE_OBJECTS_PATH,
            path.join('/workspace', 'force-app', 'main', 'default', 'classes'),
            '3.29.4',
            '2026-09-30T12:00:00Z',
            'fingerprint'
        );

        const manifestLoad = PicklistDependencyManifestService.buildManifestLoadByParsedContent(
            JSON.parse(PicklistDependencyManifestService.serializeManifest(manifest)),
            '/workspace/treecipe/PicklistDependencySpecs/manifest.json'
        );
        const roundTrippedSpecDetails = PicklistDependencyManifestService.buildSpecDetailsByManifest(manifestLoad.manifest);

        expect(manifestLoad.state).toBe('loaded');
        expect(roundTrippedSpecDetails.specDetails.map(({ objectApiName, fieldApiName, expectations }) => ({ objectApiName, fieldApiName, expectations })))
            .toEqual(collectionResult.specDetails.map(({ objectApiName, fieldApiName, expectations }) => ({ objectApiName, fieldApiName, expectations })));

    });

});
