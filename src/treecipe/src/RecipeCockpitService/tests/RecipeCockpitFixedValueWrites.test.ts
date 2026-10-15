import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

/*
    #342: a pin is written into the recipe FILE, and Clear puts back exactly the lines it replaced.
    The round trip is checked on every field of the recipes Generate Treecipe's real pipeline writes
    for each backend -- every field type the mock metadata has, record type variants, a custom
    compound Address and a Geolocation, standard fields the wrapper never lists, nested friends --
    and on the validation rule run, whose fields carry a "### Driven by ValidationRule" line.

    vscode is replaced by a read-only stand-in over the real file system: the pipeline reads the
    metadata through vscode.workspace.fs, and nothing here writes through it.
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
import { DirectoryProcessor } from '../../DirectoryProcessingService/DirectoryProcessor';
import { IRecipeFakerService } from '../../RecipeFakerService.ts/IRecipeFakerService';
import { FakerJSRecipeFakerService } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { IPinnedFieldRestoreRequest, IRecipeFixedValue, RecipeCockpitRecipeWriter } from '../RecipeCockpitRecipeWriter';
import { IFixedValueEntry, RecipeCockpitFixedValueStore, RECIPE_COCKPIT_FIXED_VALUE_FILE_VERSION } from '../RecipeCockpitFixedValueStore';

const MOCK_OBJECTS_PATH = path.join(__dirname, '..', '..', 'DirectoryProcessingService', 'tests', 'mocks', 'MockSalesforceMetadataDirectory', 'objects');
const VALIDATION_RULE_RUNS_PATH = path.join(__dirname, 'mocks', 'validationRuleWorkspace', 'treecipe', 'GeneratedRecipes');
const RECIPE_WRITER_MOCKS_PATH = path.join(__dirname, 'mocks', 'recipeWriter');
// A CONFIGURED COMPOUND ADDRESS: Text__c EXPANDS TO Text__Street__s, Text__City__s, ... AS A TYPELESS ADDRESS FIELD WOULD
const CUSTOM_COMPOUND_ADDRESS_FIELD = 'Example_Everything__c.Text__c';

const PINNED: IRecipeFixedValue = { value: 'Pinned by test', kind: 'text' };

async function generateRecipeTexts(createFakerService: () => IRecipeFakerService): Promise<string[]> {

    jest.spyOn(ConfigurationService, 'getFakerImplementationByExtensionConfigSelection').mockImplementation(createFakerService);
    jest.spyOn(ConfigurationService, 'getCustomRelationshipMappings').mockReturnValue({});
    jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue([CUSTOM_COMPOUND_ADDRESS_FIELD]);

    const objectInfoWrapper = await new DirectoryProcessor().processAllObjectsAndRelationships(vscode.Uri.file(MOCK_OBJECTS_PATH));
    return objectInfoWrapper.RecipeFiles.map(recipeFile => recipeFile.content);

}

function listValidationRuleRecipeTexts(): string[] {
    return fs.readdirSync(VALIDATION_RULE_RUNS_PATH).flatMap(runFolderName => {
        const runFolderPath = path.join(VALIDATION_RULE_RUNS_PATH, runFolderName);
        return fs.readdirSync(runFolderPath, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .flatMap(treeFolder => fs.readdirSync(path.join(runFolderPath, treeFolder.name))
                .filter(fileName => fileName.endsWith('.yml'))
                .map(fileName => fs.readFileSync(path.join(runFolderPath, treeFolder.name, fileName), 'utf8')));
    });
}

// EVERY DISTINCT object.field THE FILE WRITES, IN FILE ORDER
function listObjectFields(recipeText: string): { objectApiName: string; fieldApiName: string }[] {
    const seen = new Set<string>();
    return RecipeCockpitRecipeWriter.scanRecipeObjects(RecipeCockpitRecipeWriter.splitRecipeLines(recipeText).lines)
        .flatMap(scannedObject => scannedObject.fields.map(scannedField => ({ objectApiName: scannedObject.objectApiName, fieldApiName: scannedField.fieldApiName })))
        .filter(({ objectApiName, fieldApiName }) => {
            const key = `${objectApiName}.${fieldApiName}`;
            return seen.has(key) ? false : ( seen.add(key), true );
        });
}

const toRestoreRequests = (occurrences: IFixedValueEntry['occurrences']): IPinnedFieldRestoreRequest[] => occurrences.map(occurrence => ({ ...occurrence }));

type LoadedObject = { object: string; fields: Record<string, unknown> | null; friends?: LoadedObject[] };
const flattenLoaded = (loadedObjects: LoadedObject[]): LoadedObject[] => loadedObjects.flatMap(loadedObject => [loadedObject, ...flattenLoaded(loadedObject.friends ?? [])]);

function expectRoundTrip(recipeText: string, objectApiName: string, fieldApiName: string): string[] {

    const pinResult = RecipeCockpitRecipeWriter.pinField(recipeText, objectApiName, fieldApiName, PINNED);
    if ( 'refusal' in pinResult ) {
        throw new Error(`${objectApiName}.${fieldApiName} could not be pinned: ${pinResult.refusal.message}`);
    }

    // EVERY OCCURRENCE OF THE OBJECT THAT HAS THE FIELD LOADS WITH THE VALUE, IN A FILE THAT STILL LOADS
    const pinnedObjects = flattenLoaded(yaml.load(pinResult.recipeText) as LoadedObject[]).filter(loadedObject => loadedObject.object === objectApiName && loadedObject.fields && fieldApiName in loadedObject.fields);
    expect(pinnedObjects.length).toBe(pinResult.occurrences.length);
    pinnedObjects.forEach(pinnedObject => expect(pinnedObject.fields?.[fieldApiName]).toBe(PINNED.value));

    const restoreResult = RecipeCockpitRecipeWriter.restorePinnedField(pinResult.recipeText, objectApiName, fieldApiName, toRestoreRequests(pinResult.occurrences));
    if ( 'refusal' in restoreResult ) {
        throw new Error(`${objectApiName}.${fieldApiName} could not be put back: ${restoreResult.refusal.message}`);
    }
    expect(restoreResult.recipeText).toBe(recipeText);

    return pinResult.occurrences.map(occurrence => occurrence.originalText);

}

describe.each([
    ['faker-js', () => new FakerJSRecipeFakerService()],
    ['snowfakery', () => new SnowfakeryRecipeFakerService()]
] as const)('pinning and clearing every field Generate Treecipe writes with the %s backend (#342)', (unusedBackend, createFakerService) => {

    let recipeTexts: string[];

    beforeAll(async () => {
        recipeTexts = await generateRecipeTexts(createFakerService);
    });

    it('puts back every field byte for byte, and every pinned occurrence loads with the value', () => {

        const originalTexts: string[] = [];
        let pinnedFieldCount = 0;

        recipeTexts.forEach(recipeText => {
            listObjectFields(recipeText).forEach(({ objectApiName, fieldApiName }) => {
                originalTexts.push(...expectRoundTrip(recipeText, objectApiName, fieldApiName));
                pinnedFieldCount += 1;
            });
        });

        expect(pinnedFieldCount).toBeGreaterThan(100);
        const joinedOriginals = originalTexts.join('\n');
        // THE SPECIAL SHAPES THE ISSUE NAMES ARE AMONG WHAT WAS ROUND-TRIPPED
        expect(joinedOriginals).toContain('### TODO: -- RecordType Options --');
        expect(joinedOriginals).toMatch(/Geolocation__Latitude__s: /);
        expect(joinedOriginals).toMatch(/Text__Street__s: /);
        expect(joinedOriginals).toMatch(/^ *BillingStreet: /m);
        expect(joinedOriginals).toMatch(/^ *Name: /m);
        expect(joinedOriginals).toMatch(/^ *DependentPicklist__c: \n/m);

    });

    it('puts back a CRLF recipe, and one with no final newline, byte for byte', () => {

        const recipeText = recipeTexts.find(candidate => candidate.includes('Example_Everything__c')) as string;
        const crlfText = recipeText.replace(/\n/g, '\r\n');
        const unterminatedText = recipeText.replace(/\n+$/, '');

        listObjectFields(recipeText).filter(({ objectApiName }) => objectApiName === 'Example_Everything__c').forEach(({ objectApiName, fieldApiName }) => {
            expectRoundTrip(crlfText, objectApiName, fieldApiName);
            expectRoundTrip(unterminatedText, objectApiName, fieldApiName);
        });

    });

});

describe('pinning and clearing a field its validation rules drive (#324, #342)', () => {

    it('puts back the rules\' value and its "### Driven by ValidationRule" line, with both backends', () => {

        const recipeTexts = listValidationRuleRecipeTexts();
        expect(recipeTexts).toHaveLength(2);
        expect(recipeTexts.join('\n')).toContain('### Driven by ValidationRule');

        recipeTexts.forEach(recipeText => {
            listObjectFields(recipeText).forEach(({ objectApiName, fieldApiName }) => expectRoundTrip(recipeText, objectApiName, fieldApiName));
        });

    });

});

describe('RecipeCockpitRecipeWriter.pinField (#342)', () => {

    const nestedRecipe = fs.readFileSync(path.join(RECIPE_WRITER_MOCKS_PATH, 'recipe-fakerjs-nested--RelationshipTree_1.yml'), 'utf8');

    it('writes one line at each occurrence\'s own depth and answers what each held, its first nickname and its place among the object\'s occurrences', () => {

        const pinResult = RecipeCockpitRecipeWriter.pinField(nestedRecipe, 'Contact', 'LastName', { value: 'Smith', kind: 'text' });
        if ( 'refusal' in pinResult ) {
            throw new Error(pinResult.refusal.message);
        }

        expect(pinResult.occurrences.length).toBeGreaterThan(0);
        pinResult.occurrences.forEach((occurrence, occurrenceIndex) => {
            expect(occurrence.occurrenceIndex).toBe(occurrenceIndex);
            expect(occurrence.writtenLine).toMatch(/^( {4})+LastName: "Smith"$/);
            expect(occurrence.originalText).toMatch(/^( {4})+LastName: /);
            expect(pinResult.recipeText.split('\n')).toContain(occurrence.writtenLine);
        });
        expect(pinResult.occurrences[0].nickname).toBeString();

    });

    it('writes a number and a boolean plain, and text double-quoted', () => {

        const numberPin = RecipeCockpitRecipeWriter.pinField(nestedRecipe, 'Contact', 'LastName', { value: '42', kind: 'number' });
        const booleanPin = RecipeCockpitRecipeWriter.pinField(nestedRecipe, 'Contact', 'LastName', { value: 'true', kind: 'boolean' });
        const textPin = RecipeCockpitRecipeWriter.pinField(nestedRecipe, 'Contact', 'LastName', { value: 'Say "hi"', kind: 'text' });

        expect('occurrences' in numberPin && numberPin.occurrences[0].writtenLine).toMatch(/LastName: 42$/);
        expect('occurrences' in booleanPin && booleanPin.occurrences[0].writtenLine).toMatch(/LastName: true$/);
        expect('occurrences' in textPin && textPin.occurrences[0].writtenLine).toMatch(/LastName: "Say \\"hi\\""$/);

    });

    it.each([
        ['a template opener', { value: '${{ 7*7 }}', kind: 'text' as const }, 'invalid-value'],
        ['a line break', { value: 'a\nb', kind: 'text' as const }, 'invalid-value'],
        ['a U+2028', { value: 'a\u2028b', kind: 'text' as const }, 'invalid-value'],
        ['a number that is not one', { value: '4x', kind: 'number' as const }, 'invalid-value']
    ])('refuses %s, and changes nothing', (unusedCase, fixedValue, reason) => {
        const pinResult = RecipeCockpitRecipeWriter.pinField(nestedRecipe, 'Contact', 'LastName', fixedValue);
        expect('refusal' in pinResult && pinResult.refusal.reason).toBe(reason);
    });

    it('refuses a value that is a nickname of the recipe, an object or field the recipe does not write, and a name that is not an api name', () => {

        const nickname = RecipeCockpitRecipeWriter.scanRecipeObjects(nestedRecipe.split('\n')).flatMap(scannedObject => scannedObject.nicknames)[0];
        const refusalOf = (result: ReturnType<typeof RecipeCockpitRecipeWriter.pinField>) => ( 'refusal' in result ? result.refusal.reason : undefined );

        expect(refusalOf(RecipeCockpitRecipeWriter.pinField(nestedRecipe, 'Contact', 'LastName', { value: nickname, kind: 'text' }))).toBe('invalid-value');
        expect(refusalOf(RecipeCockpitRecipeWriter.pinField(nestedRecipe, 'Nope__c', 'LastName', PINNED))).toBe('object-not-found');
        expect(refusalOf(RecipeCockpitRecipeWriter.pinField(nestedRecipe, 'Contact', 'Nope__c', PINNED))).toBe('field-not-found');
        expect(refusalOf(RecipeCockpitRecipeWriter.pinField(nestedRecipe, 'Contact\n- object: Evil', 'LastName', PINNED))).toBe('invalid-object-api-name');
        expect(refusalOf(RecipeCockpitRecipeWriter.pinField(nestedRecipe, 'Contact', 'Last Name', PINNED))).toBe('invalid-field-api-name');

    });

    it('refuses an occurrence with two fields: blocks, and a pin that would not read back, and changes nothing', () => {

        const twoBlocksRecipe = '- object: Account\n  nickname: Account_NickName\n  fields:\n    Name: one\n  fields:\n    Phone: two\n';
        expect(RecipeCockpitRecipeWriter.pinField(twoBlocksRecipe, 'Account', 'Name', PINNED)).toMatchObject({ isPinned: false, refusal: { reason: 'duplicate-fields-block' } });

        jest.spyOn(RecipeCockpitRecipeWriter as any, 'isFieldSpanReadBack').mockReturnValue(false);
        expect(RecipeCockpitRecipeWriter.pinField(nestedRecipe, 'Contact', 'LastName', PINNED)).toMatchObject({ isPinned: false, refusal: { reason: 'unsupported-field-layout' } });

    });

    it('refuses a field written twice in one occurrence rather than guessing which', () => {
        const doubledRecipe = '- object: Account\n  nickname: Account_NickName\n  fields:\n    Name: one\n    Name: two\n';
        const pinResult = RecipeCockpitRecipeWriter.pinField(doubledRecipe, 'Account', 'Name', PINNED);
        expect('refusal' in pinResult && pinResult.refusal.reason).toBe('duplicate-field');
    });

});

describe('RecipeCockpitRecipeWriter.restorePinnedField (#342)', () => {

    const flatRecipe = [
        '- object: Account',
        '  nickname: Account_NickName',
        '  count: 2',
        '  fields:',
        '    Name: ${{faker.company.name()}}',
        '    Industry: ${{faker.helpers.arrayElement([\'A\', \'B\'])}}',
        '                    ### TODO: -- RecordType Options -- One -- Below is the faker recipe for the record type One for the field Industry',
        '                    # ${{faker.helpers.arrayElement([\'A\'])}}',
        '    Phone: ${{faker.phone.number()}}',
        ''
    ].join('\n');

    const pinIndustry = () => {
        const pinResult = RecipeCockpitRecipeWriter.pinField(flatRecipe, 'Account', 'Industry', PINNED);
        if ( 'refusal' in pinResult ) {
            throw new Error(pinResult.refusal.message);
        }
        return pinResult;
    };

    it('refuses a name that is not an api name before reading anything', () => {
        const pinResult = pinIndustry();
        expect(RecipeCockpitRecipeWriter.restorePinnedField(pinResult.recipeText, 'Account\n- object: Evil', 'Industry', toRestoreRequests(pinResult.occurrences))).toMatchObject({ isRestored: false, refusal: { reason: 'invalid-object-api-name' } });
        expect(RecipeCockpitRecipeWriter.restorePinnedField(pinResult.recipeText, 'Account', 'Indus try', toRestoreRequests(pinResult.occurrences))).toMatchObject({ isRestored: false, refusal: { reason: 'invalid-field-api-name' } });
    });

    it('refuses, and changes nothing, once the pinned line was edited by hand', () => {

        const pinResult = pinIndustry();
        const editedText = pinResult.recipeText.replace('Industry: "Pinned by test"', 'Industry: "Edited"');
        const restoreResult = RecipeCockpitRecipeWriter.restorePinnedField(editedText, 'Account', 'Industry', toRestoreRequests(pinResult.occurrences));

        expect('refusal' in restoreResult && restoreResult.refusal.reason).toBe('pinned-field-changed');

    });

    it('refuses an occurrence whose nickname or place no longer matches', () => {

        const pinResult = pinIndustry();
        const wrongNickname = toRestoreRequests(pinResult.occurrences).map(request => ({ ...request, nickname: 'Other_NickName' }));
        const wrongIndex = toRestoreRequests(pinResult.occurrences).map(request => ({ ...request, occurrenceIndex: 3 }));

        expect(RecipeCockpitRecipeWriter.restorePinnedField(pinResult.recipeText, 'Account', 'Industry', wrongNickname)).toMatchObject({ isRestored: false, refusal: { reason: 'pinned-field-changed' } });
        expect(RecipeCockpitRecipeWriter.restorePinnedField(pinResult.recipeText, 'Account', 'Industry', wrongIndex)).toMatchObject({ isRestored: false, refusal: { reason: 'pinned-field-changed' } });
        expect(RecipeCockpitRecipeWriter.restorePinnedField(pinResult.recipeText, 'Account', 'Industry', [])).toMatchObject({ isRestored: false, refusal: { reason: 'field-not-found' } });

    });

    it.each([
        ['adds a field', '    Industry: x\n    Evil__c: injected'],
        ['adds an object', '    Industry: x\n- object: Evil'],
        ['is another field\'s line', '    Phone: x'],
        ['is no field line at all', 'Industry: x'],
        ['carries a bare CR', '    Industry: x\r    Evil__c: y'],
        ['carries a U+2028', '    Industry: x\u2028    Evil__c: y']
    ])('refuses recorded lines that %s, and changes nothing', (unusedCase, originalText) => {

        const pinResult = pinIndustry();
        const restoreResult = RecipeCockpitRecipeWriter.restorePinnedField(pinResult.recipeText, 'Account', 'Industry', toRestoreRequests(pinResult.occurrences).map(request => ({ ...request, originalText: originalText })));

        expect('refusal' in restoreResult && restoreResult.refusal.reason).toBe('invalid-value');

    });

    it('refuses an occurrence that has neither recorded lines nor a value to re-derive', () => {
        const pinResult = pinIndustry();
        const bareRequests = pinResult.occurrences.map(({ originalText: _unused, ...occurrence }) => occurrence);
        expect(RecipeCockpitRecipeWriter.restorePinnedField(pinResult.recipeText, 'Account', 'Industry', bareRequests)).toMatchObject({ isRestored: false, refusal: { reason: 'invalid-value' } });
    });

    it('pins and puts back an object with no nickname, and re-derives a multi-line value on the last line of a file with no final newline', () => {

        const unnamedRecipe = '- object: Account\n  count: 1\n  fields:\n    Name: ${{faker.company.name()}}\n    Phone: ${{faker.phone.number()}}';
        const pinResult = RecipeCockpitRecipeWriter.pinField(unnamedRecipe, 'Account', 'Phone', PINNED);
        if ( 'refusal' in pinResult ) {
            throw new Error(pinResult.refusal.message);
        }
        expect(pinResult.occurrences).toEqual([{ occurrenceIndex: 0, writtenLine: '    Phone: "Pinned by test"', originalText: '    Phone: ${{faker.phone.number()}}' }]);
        expect(pinResult.recipeText).toEndWith('    Phone: "Pinned by test"');

        const restoreResult = RecipeCockpitRecipeWriter.restorePinnedField(pinResult.recipeText, 'Account', 'Phone', [{ occurrenceIndex: 0, writtenLine: '    Phone: "Pinned by test"', valueText: '|\n        ${{faker.phone.number()}}' }]);
        expect(restoreResult).toEqual({ isRestored: true, recipeText: '- object: Account\n  count: 1\n  fields:\n    Name: ${{faker.company.name()}}\n    Phone: |\n        ${{faker.phone.number()}}' });

    });

    it('re-derives an occurrence with no recorded lines from a value written as for a top-level object, moved to the occurrence\'s depth', () => {

        const nestedRecipe = fs.readFileSync(path.join(RECIPE_WRITER_MOCKS_PATH, 'recipe-fakerjs-nested--RelationshipTree_1.yml'), 'utf8');
        const pinResult = RecipeCockpitRecipeWriter.pinField(nestedRecipe, 'Contact', 'LastName', PINNED);
        if ( 'refusal' in pinResult ) {
            throw new Error(pinResult.refusal.message);
        }

        const valueText = '|\n        ${{faker.person.lastName()}}';
        const restoreResult = RecipeCockpitRecipeWriter.restorePinnedField(pinResult.recipeText, 'Contact', 'LastName', pinResult.occurrences.map(occurrence => ({
            occurrenceIndex: occurrence.occurrenceIndex,
            ...( occurrence.nickname !== undefined ? { nickname: occurrence.nickname } : {} ),
            writtenLine: occurrence.writtenLine,
            valueText: valueText
        })));
        if ( 'refusal' in restoreResult ) {
            throw new Error(restoreResult.refusal.message);
        }

        flattenLoaded(yaml.load(restoreResult.recipeText) as LoadedObject[])
            .filter(loadedObject => loadedObject.object === 'Contact' && loadedObject.fields && 'LastName' in loadedObject.fields)
            .forEach(loadedObject => expect(loadedObject.fields?.LastName).toBe('${{faker.person.lastName()}}\n'));

    });

});

describe('RecipeCockpitFixedValueStore (#342)', () => {

    const entry = (objectApiName: string, fieldApiName: string, value: string, occurrences: IFixedValueEntry['occurrences']): IFixedValueEntry => ({ objectApiName, fieldApiName, value, occurrences });
    const occurrence = (occurrenceIndex: number, writtenLine: string, originalText?: string, nickname?: string) => ({
        occurrenceIndex,
        ...( nickname !== undefined ? { nickname } : {} ),
        writtenLine,
        ...( originalText !== undefined ? { originalText } : {} )
    });

    it('builds the file name beside the recipe', () => {
        expect(RecipeCockpitFixedValueStore.buildFilePath(path.join('runs', 'tree', 'recipe--tree-2026.yml'))).toBe(path.join('runs', 'tree', 'recipe--tree-2026.fixedValues.json'));
    });

    it('reads back what it writes, sorted with < so the same pins write the same bytes', () => {

        const entries = [
            entry('Contact', 'LastName', 'Smith', [occurrence(1, '        LastName: "Smith"', '        LastName: ${{x}}', 'Contact_2'), occurrence(0, '    LastName: "Smith"', '    LastName: ${{x}}\r\n        # more', 'Contact_1')]),
            entry('Account', 'Name', 'Acme', [occurrence(0, '    Name: "Acme"', '    Name: ${{y}}')])
        ];
        const fileText = RecipeCockpitFixedValueStore.serialize(entries);

        expect(fileText).toEndWith('\n');
        expect(RecipeCockpitFixedValueStore.serialize([...entries].reverse())).toBe(fileText);
        expect(RecipeCockpitFixedValueStore.parse(fileText)).toEqual({
            isUnreadable: false,
            entries: [
                entry('Account', 'Name', 'Acme', [occurrence(0, '    Name: "Acme"', '    Name: ${{y}}')]),
                entry('Contact', 'LastName', 'Smith', [occurrence(0, '    LastName: "Smith"', '    LastName: ${{x}}\r\n        # more', 'Contact_1'), occurrence(1, '        LastName: "Smith"', '        LastName: ${{x}}', 'Contact_2')])
            ]
        });

    });

    it('reads no file as no entries, and text that is not this version\'s file as unreadable', () => {

        expect(RecipeCockpitFixedValueStore.parse(undefined)).toEqual({ entries: [], isUnreadable: false });
        expect(RecipeCockpitFixedValueStore.parse('{ not json')).toEqual({ entries: [], isUnreadable: true });
        expect(RecipeCockpitFixedValueStore.parse('[]')).toEqual({ entries: [], isUnreadable: true });
        expect(RecipeCockpitFixedValueStore.parse(JSON.stringify({ version: RECIPE_COCKPIT_FIXED_VALUE_FILE_VERSION + 1, fields: [] }))).toEqual({ entries: [], isUnreadable: true });

    });

    it('drops every entry and occurrence it cannot trust, and keeps an occurrence without lines it cannot put back', () => {

        const fileText = JSON.stringify({
            version: RECIPE_COCKPIT_FIXED_VALUE_FILE_VERSION,
            fields: [
                { objectApiName: '__proto__', fieldApiName: 'Name', value: 'x', occurrences: [occurrence(0, '    Name: x')] },
                { objectApiName: 'Account', fieldApiName: 'Na me', value: 'x', occurrences: [occurrence(0, '    Na me: x')] },
                { objectApiName: 'Account', fieldApiName: 'Phone', value: '', occurrences: [occurrence(0, '    Phone: x')] },
                { objectApiName: 'Account', fieldApiName: 'Fax', value: 7, occurrences: [occurrence(0, '    Fax: 7')] },
                { objectApiName: 'Account', fieldApiName: 'Site', value: 'x', occurrences: 'none' },
                { objectApiName: 'Account', fieldApiName: 'Industry', value: 'x', occurrences: [
                    occurrence(-1, '    Industry: x'),
                    { occurrenceIndex: 1.5, writtenLine: '    Industry: x' },
                    occurrence(2, '    Phone: x'),
                    occurrence(3, '    Industry: x\n    Evil__c: y'),
                    { occurrenceIndex: 4, nickname: 7, writtenLine: '    Industry: x' },
                    occurrence(5, '    Industry: x', '    Industry: ok'),
                    occurrence(5, '    Industry: x', '    Industry: twice'),
                    occurrence(6, '    Industry: x', '    Phone: not this field'),
                    occurrence(7, '    Industry: x', '    Industry: a\r    Evil__c: b'),
                    occurrence(8, '    Industry: x', '    Industry: a\u2029b')
                ] },
                { objectApiName: 'Account', fieldApiName: 'Industry', value: 'second', occurrences: [occurrence(0, '    Industry: second')] },
                'not an entry'
            ]
        });

        expect(RecipeCockpitFixedValueStore.parse(fileText)).toEqual({
            isUnreadable: false,
            entries: [
                entry('Account', 'Industry', 'x', [
                    occurrence(5, '    Industry: x', '    Industry: ok'),
                    occurrence(6, '    Industry: x'),
                    occurrence(7, '    Industry: x'),
                    occurrence(8, '    Industry: x')
                ])
            ]
        });

    });

    it('keeps no lines when the earlier pin had none to keep, and lists two fields of one object together', () => {

        const firstPin = [entry('Account', 'Name', 'Acme', [occurrence(0, '    Name: "Acme"')])];
        expect(RecipeCockpitFixedValueStore.upsertEntry(firstPin, entry('Account', 'Name', 'Initech', [occurrence(0, '    Name: "Initech"', '    Name: "Acme"')])))
            .toEqual([entry('Account', 'Name', 'Initech', [occurrence(0, '    Name: "Initech"')])]);

        const twoFields = [entry('Account', 'Phone', '1', [occurrence(0, '    Phone: 1')]), entry('Account', 'Name', 'Acme', [occurrence(0, '    Name: "Acme"')])];
        expect(RecipeCockpitFixedValueStore.listValuesByObject(twoFields)).toEqual(new Map([['Account', new Map([['Phone', '1'], ['Name', 'Acme']])]]));
        expect(JSON.parse(RecipeCockpitFixedValueStore.serialize(twoFields)).fields.map((stored: IFixedValueEntry) => stored.fieldApiName)).toEqual(['Name', 'Phone']);

    });

    it('keeps the lines from before the FIRST pin when a pinned field is pinned again, and replaces them once the field changed in between', () => {

        const firstPin = [entry('Account', 'Name', 'Acme', [occurrence(0, '    Name: "Acme"', '    Name: ${{generated}}', 'Account_1')])];

        const repinned = RecipeCockpitFixedValueStore.upsertEntry(firstPin, entry('Account', 'Name', 'Initech', [occurrence(0, '    Name: "Initech"', '    Name: "Acme"', 'Account_1')]));
        expect(repinned).toEqual([entry('Account', 'Name', 'Initech', [occurrence(0, '    Name: "Initech"', '    Name: ${{generated}}', 'Account_1')])]);

        const pinnedOverHandEdit = RecipeCockpitFixedValueStore.upsertEntry(firstPin, entry('Account', 'Name', 'Initech', [occurrence(0, '    Name: "Initech"', '    Name: hand edited', 'Account_1')]));
        expect(pinnedOverHandEdit).toEqual([entry('Account', 'Name', 'Initech', [occurrence(0, '    Name: "Initech"', '    Name: hand edited', 'Account_1')])]);

        expect(RecipeCockpitFixedValueStore.removeEntry(repinned, 'Account', 'Name')).toEqual([]);
        expect(RecipeCockpitFixedValueStore.listValuesByObject(repinned)).toEqual(new Map([['Account', new Map([['Name', 'Initech']])]]));

    });

});
