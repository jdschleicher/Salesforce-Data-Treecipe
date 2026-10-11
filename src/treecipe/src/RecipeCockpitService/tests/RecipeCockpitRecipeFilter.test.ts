import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';

import { RecipeCockpitRecipeWriter, RecipeFilterResult, IRecipeFilterLookup, RecipeWriterRefusalReason, IScannedObject } from '../RecipeCockpitRecipeWriter';
import { FakerJSRecipeProcessor } from '../../FakerRecipeProcessor/FakerJSRecipeProcessor/FakerJSRecipeProcessor';
import { SnowfakeryRecipeProcessor } from '../../FakerRecipeProcessor/SnowfakeryRecipeProcessor/SnowfakeryRecipeProcessor';
import { PythonTestHarness } from '../../RecipeFakerService.ts/RecipeYamlScalar/tests/mocks/PythonTestHarness';

import * as childProcess from 'child_process';

jest.mock('vscode', () => ({ window: {}, workspace: {}, Uri: {} }), { virtual: true });
jest.mock('child_process', () => ({ ...jest.requireActual('child_process'), execFile: jest.fn() }));

const recipeWriterMocksPath = path.join(__dirname, 'mocks', 'recipeWriter');

function readFixture(fileName: string): string {
    return fs.readFileSync(path.join(recipeWriterMocksPath, fileName), 'utf8');
}

const NESTED_FIXTURE = 'recipe-fakerjs-nested--RelationshipTree_1.yml';
const SNOWFAKERY_FIXTURE = 'recipe-snowfakery--RelationshipTree_1.yml';
const SELF_LOOKUP_FRIENDS_FIXTURE = 'recipe-fakerjs-selfLookupFriends--RelationshipTree_1.yml';

// THE LOOKUPS Generate Treecipe RECORDS FOR THE FIXTURE TREE, AS THE COCKPIT READS THEM FROM THE WRAPPER
const FIXTURE_LOOKUPS = new Map<string, IRecipeFilterLookup[]>([
    ['Contact', [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }]],
    ['Example_Everything__c', [
        { fieldApiName: 'AccountLookup__c', parentObjectApiName: 'Account' },
        { fieldApiName: 'Example_Everything_Lookup__c', parentObjectApiName: 'Example_Everything__c' }
    ]],
    ['Opportunity', [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }]],
    ['Order__c', [{ fieldApiName: 'Account__c', parentObjectApiName: 'Account' }]],
    ['Product__c', [{ fieldApiName: 'Product_Family__c', parentObjectApiName: 'Product_Family__c' }]],
    ['MasterDetailMadness__c', [
        { fieldApiName: 'LU_Contact__c', parentObjectApiName: 'Contact' },
        { fieldApiName: 'MD_MegaMapMadness__c', parentObjectApiName: 'MegaMapMadness__c' }
    ]],
    ['Order_Item__c', [
        { fieldApiName: 'Order__c', parentObjectApiName: 'Order__c' },
        { fieldApiName: 'Product__c', parentObjectApiName: 'Product__c' }
    ]]
]);

function expectFiltered(result: RecipeFilterResult): Extract<RecipeFilterResult, { isFiltered: true }> {
    if ( 'refusal' in result ) {
        throw new Error(`expected a filtered copy, got a refusal: ${result.refusal.message}`);
    }
    return result;
}

function expectRefused(result: RecipeFilterResult, reason: RecipeWriterRefusalReason): void {
    if ( !('refusal' in result) ) {
        throw new Error('expected a refusal, got a filtered copy');
    }
    expect(result.refusal.reason).toBe(reason);
    expect(result.refusal.message).toBeString();
}

function scanOccurrences(recipeText: string) {
    const scannedObjects = RecipeCockpitRecipeWriter.scanRecipeObjects(RecipeCockpitRecipeWriter.splitRecipeLines(recipeText).lines);
    const byHeaderIndex = new Map(scannedObjects.map(scannedObject => [scannedObject.headerIndex, scannedObject]));
    return scannedObjects.map(scannedObject => ({
        objectApiName: scannedObject.objectApiName,
        nickname: scannedObject.nicknames[0],
        parentObjectApiName: scannedObject.parentHeaderIndex === undefined ? undefined : byHeaderIndex.get(scannedObject.parentHeaderIndex)?.objectApiName,
        objectIndent: scannedObject.objectIndent,
        fieldApiNames: scannedObject.fields.map(scannedField => scannedField.fieldApiName)
    }));
}

function writeTemporaryRecipe(recipeText: string): string {
    const directoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-filter-test-'));
    const recipeFilePath = path.join(directoryPath, 'filteredRecipe.yml');
    fs.writeFileSync(recipeFilePath, recipeText);
    return recipeFilePath;
}

describe('RecipeCockpitRecipeWriter.buildFilteredRecipe (#219)', () => {

    describe('nothing excluded', () => {

        test.each([NESTED_FIXTURE, SNOWFAKERY_FIXTURE])('returns %s byte for byte', (fileName) => {

            const recipeText = readFixture(fileName);

            const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, { excludedObjectApiNames: [], parentLookupsByObjectApiName: FIXTURE_LOOKUPS }));

            expect(filtered.recipeText).toBe(recipeText);
            expect(filtered.droppedObjectApiNames).toEqual([]);

        });

    });

    describe('faker-js, nested under friends:', () => {

        test('drops an excluded leaf and keeps every other line byte for byte', () => {

            const recipeText = readFixture(NESTED_FIXTURE);
            const recipeLines = recipeText.split('\n');

            const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, { excludedObjectApiNames: ['Opportunity'], parentLookupsByObjectApiName: FIXTURE_LOOKUPS }));

            const [headerComment, ...filteredLines] = filtered.recipeText.split('\n');
            expect(headerComment).toBe('# Recipe Cockpit -- a filtered copy of this tree\'s recipe, leaving out: Opportunity');

            const opportunityCommentIndex = recipeLines.findIndex(recipeLine => recipeLine.startsWith('    # Opportunity'));
            const orderCommentIndex = recipeLines.findIndex(recipeLine => recipeLine.startsWith('    # Order__c'));
            // THE BLANK LINE BEFORE THE OPPORTUNITY COMMENT STAYS, THE ONE AFTER ITS BLOCK GOES WITH IT
            expect(filteredLines).toEqual([...recipeLines.slice(0, opportunityCommentIndex), ...recipeLines.slice(orderCommentIndex)]);
            expect(scanOccurrences(filtered.recipeText).map(occurrence => occurrence.objectApiName)).not.toContain('Opportunity');
            expect(filtered.movedObjects).toEqual([]);

        });

        test('moves a kept friend whose parent was excluded under its closest remaining parent, and drops its lookup to the excluded one', () => {

            const recipeText = readFixture(NESTED_FIXTURE);

            const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, { excludedObjectApiNames: ['Contact', 'Order__c'], parentLookupsByObjectApiName: FIXTURE_LOOKUPS }));
            const occurrences = scanOccurrences(filtered.recipeText);

            expect(filtered.droppedObjectApiNames).toEqual(['Contact', 'Order__c']);
            expect(filtered.movedObjects).toEqual([
                { objectApiName: 'MasterDetailMadness__c', newParentObjectApiName: 'MegaMapMadness__c' },
                { objectApiName: 'Order_Item__c', newParentObjectApiName: 'Product__c' }
            ]);
            expect(occurrences.find(occurrence => occurrence.objectApiName === 'MasterDetailMadness__c')).toMatchObject({ parentObjectApiName: 'MegaMapMadness__c', objectIndent: 4 });
            expect(occurrences.find(occurrence => occurrence.objectApiName === 'Order_Item__c')).toMatchObject({ parentObjectApiName: 'Product__c', objectIndent: 8 });
            expect(occurrences.find(occurrence => occurrence.objectApiName === 'MasterDetailMadness__c')?.fieldApiNames).not.toContain('LU_Contact__c');
            expect(occurrences.find(occurrence => occurrence.objectApiName === 'Order_Item__c')?.fieldApiNames).not.toContain('Order__c');
            expect(filtered.recipeText).toContain('\n        MD_MegaMapMadness__c: MegaMapMadness__c_NickName\n');
            expect(filtered.recipeText).toContain('\n            Product__c: Product__c_NickName\n');
            expect(filtered.droppedLookups).toEqual([
                { fieldApiName: 'LU_Contact__c', parentObjectApiName: 'Contact' },
                { fieldApiName: 'Order__c', parentObjectApiName: 'Order__c' }
            ]);

        });

        test('wires a moved friend\'s lookup to its new parent as that parent\'s nickname, so count is still per parent record', () => {

            const recipeText = [
                '- object: Account',
                '  nickname: Account_NickName',
                '  count: 2',
                '  fields:',
                '    Name: ${{faker.company.name()}}',
                '  friends:',
                '    - object: Opportunity',
                '      nickname: Opportunity_NickName',
                '      count: 1',
                '      fields:',
                '        AccountId: Account_NickName',
                '      friends:',
                '        # Quote (Parents: Opportunity, Contract)',
                '        - object: Quote',
                '          nickname: Quote_NickName',
                '          count: 3',
                '          fields:',
                '            OpportunityId: Opportunity_NickName',
                '            ContractId: ### TODO -- REFERENCE ID REQUIRED -- Contract',
                '- object: Contract',
                '  nickname: Contract_NickName',
                '  count: 1',
                '  fields:',
                '    Status: Draft',
                ''
            ].join('\n');
            const lookups = new Map<string, IRecipeFilterLookup[]>([
                ['Opportunity', [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }]],
                ['Quote', [{ fieldApiName: 'OpportunityId', parentObjectApiName: 'Opportunity' }, { fieldApiName: 'ContractId', parentObjectApiName: 'Contract' }]]
            ]);

            const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, {
                excludedObjectApiNames: ['Opportunity'],
                parentLookupsByObjectApiName: lookups,
                levelsByObjectApiName: new Map([['Account', 0], ['Contract', 0], ['Opportunity', 1], ['Quote', 2]])
            }));

            expect(filtered.recipeText).toBe([
                '# Recipe Cockpit -- a filtered copy of this tree\'s recipe, leaving out: Opportunity',
                '- object: Account',
                '  nickname: Account_NickName',
                '  count: 2',
                '  fields:',
                '    Name: ${{faker.company.name()}}',
                '- object: Contract',
                '  nickname: Contract_NickName',
                '  count: 1',
                '  fields:',
                '    Status: Draft',
                '  friends:',
                '    # Quote (Parents: Opportunity, Contract)',
                '    - object: Quote',
                '      nickname: Quote_NickName',
                '      count: 3',
                '      fields:',
                '        ContractId: Contract_NickName',
                ''
            ].join('\n'));

        });

        test('picks the deepest remaining parent, ties broken with "<", and only one at a strictly lower level', () => {

            const recipeText = [
                '- object: Top',
                '  nickname: Top_NickName',
                '  fields:',
                '    Name: x',
                '  friends:',
                '    - object: Middle',
                '      nickname: Middle_NickName',
                '      fields:',
                '        Top__c: Top_NickName',
                '      friends:',
                '        - object: Leaf',
                '          nickname: Leaf_NickName',
                '          fields:',
                '            Middle__c: Middle_NickName',
                '            Zeta__c: ### TODO -- REFERENCE ID REQUIRED -- Zeta',
                '            Alpha__c: ### TODO -- REFERENCE ID REQUIRED -- Alpha',
                '            Deep__c: ### TODO -- REFERENCE ID REQUIRED -- Deep',
                '            Same__c: ### TODO -- REFERENCE ID REQUIRED -- Same',
                '- object: Zeta',
                '  nickname: Zeta_NickName',
                '  fields:',
                '    Name: z',
                '- object: Alpha',
                '  nickname: Alpha_NickName',
                '  fields:',
                '    Name: a',
                '- object: Same',
                '  nickname: Same_NickName',
                '  fields:',
                '    Name: s',
                ''
            ].join('\n');
            const lookups = new Map<string, IRecipeFilterLookup[]>([
                ['Leaf', [
                    { fieldApiName: 'Middle__c', parentObjectApiName: 'Middle' },
                    { fieldApiName: 'Zeta__c', parentObjectApiName: 'Zeta' },
                    { fieldApiName: 'Alpha__c', parentObjectApiName: 'Alpha' },
                    { fieldApiName: 'Deep__c', parentObjectApiName: 'Deep' },
                    { fieldApiName: 'Same__c', parentObjectApiName: 'Same' }
                ]]
            ]);

            const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, {
                excludedObjectApiNames: ['Middle'],
                parentLookupsByObjectApiName: lookups,
                // Deep HAS NO RECIPE, Same IS AT THE LEAF'S OWN LEVEL; Alpha AND Zeta TIE AT 1
                levelsByObjectApiName: new Map([['Top', 0], ['Middle', 1], ['Zeta', 1], ['Alpha', 1], ['Deep', 1], ['Same', 2], ['Leaf', 2]])
            }));

            expect(filtered.movedObjects).toEqual([{ objectApiName: 'Leaf', newParentObjectApiName: 'Alpha' }]);
            expect(filtered.recipeText).toContain('    - object: Leaf\n');
            expect(filtered.recipeText).toContain('        Alpha__c: Alpha_NickName\n');
            expect(filtered.recipeText).toContain('        Zeta__c: ### TODO -- REFERENCE ID REQUIRED -- Zeta\n');

        });

        test('moves a friend with no remaining parent to the top level, keeping its own friends under it', () => {

            const recipeText = readFixture(SELF_LOOKUP_FRIENDS_FIXTURE);
            const lookups = new Map<string, IRecipeFilterLookup[]>([
                ['Contact', [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }, { fieldApiName: 'ReportsToId', parentObjectApiName: 'Contact' }]],
                ['Case', [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }, { fieldApiName: 'ContactId', parentObjectApiName: 'Contact' }]],
                ['Opportunity', [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }]],
                ['Account', [{ fieldApiName: 'ParentId', parentObjectApiName: 'Account' }]]
            ]);

            const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, { excludedObjectApiNames: ['Account', 'Opportunity'], parentLookupsByObjectApiName: lookups }));
            const occurrences = scanOccurrences(filtered.recipeText);

            expect(filtered.movedObjects).toEqual([{ objectApiName: 'Contact' }]);
            expect(occurrences.map(occurrence => [occurrence.objectApiName, occurrence.parentObjectApiName, occurrence.objectIndent])).toEqual([
                ['Lead', undefined, 0],
                ['Contact', undefined, 0],
                ['Case', 'Contact', 4]
            ]);
            expect(occurrences.find(occurrence => occurrence.objectApiName === 'Case')?.fieldApiNames).not.toContain('AccountId');
            expect(filtered.recipeText).toContain('        ContactId: Contact_NickName\n');

        });

        test('drops a self-lookup object\'s child iteration with it, and every copy nested under that iteration', () => {

            const recipeText = readFixture(SELF_LOOKUP_FRIENDS_FIXTURE);
            const withCopyUnderIteration = expectInserted(RecipeCockpitRecipeWriter.insertFriend(recipeText, 'Account', 'Account_child_NickName', 'Opportunity'));

            const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(withCopyUnderIteration, {
                excludedObjectApiNames: ['Account', 'Contact', 'Case', 'Opportunity'],
                parentLookupsByObjectApiName: new Map()
            }));

            expect(scanOccurrences(filtered.recipeText).map(occurrence => occurrence.objectApiName)).toEqual(['Lead']);
            expect(filtered.recipeText).not.toContain('Account_child_NickName');

        });

        test('keeps the self-lookup iteration when only a friend is excluded', () => {

            const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(readFixture(SELF_LOOKUP_FRIENDS_FIXTURE), {
                excludedObjectApiNames: ['Opportunity'],
                parentLookupsByObjectApiName: new Map()
            }));

            expect(scanOccurrences(filtered.recipeText).filter(occurrence => occurrence.objectApiName === 'Account').map(occurrence => occurrence.nickname)).toEqual(['Account_NickName', 'Account_child_NickName']);

        });

        test('given no lookups at all, still drops a field whose value is an excluded object\'s nickname', () => {

            const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(readFixture(NESTED_FIXTURE), {
                excludedObjectApiNames: ['Contact'],
                parentLookupsByObjectApiName: new Map()
            }));

            expect(filtered.droppedLookups).toEqual([{ fieldApiName: 'LU_Contact__c', parentObjectApiName: 'Contact' }]);
            // WITH NO LOOKUPS THERE IS NO PARENT TO NEST UNDER, SO THE ORPHAN MOVES TO THE TOP
            expect(filtered.movedObjects).toEqual([{ objectApiName: 'MasterDetailMadness__c' }]);

        });

        test('given excluded objects the recipe does not carry, returns it byte for byte', () => {

            const recipeText = readFixture(SNOWFAKERY_FIXTURE);

            const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, { excludedObjectApiNames: ['User'], parentLookupsByObjectApiName: new Map() }));

            expect(filtered.recipeText).toBe(recipeText);
            expect(filtered.droppedObjectApiNames).toEqual([]);

        });

        test('drops a friends: block that is left with no friend', () => {

            const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(readFixture(NESTED_FIXTURE), {
                excludedObjectApiNames: ['Product__c', 'Order_Item__c'],
                parentLookupsByObjectApiName: FIXTURE_LOOKUPS
            }));
            const productFamilyBlock = filtered.recipeText.slice(filtered.recipeText.indexOf('- object: Product_Family__c'), filtered.recipeText.indexOf('- object: MegaMapMadness__c'));

            expect(productFamilyBlock).not.toContain('friends:');
            expect((yaml.load(filtered.recipeText) as Array<{ object: string; friends?: unknown }>).find(entry => entry.object === 'Product_Family__c')).not.toHaveProperty('friends');

        });

        test('generates through the faker-js processor with no record of, or reference to, an excluded object', async () => {

            // Example_Everything__c's dependent picklist names a controlling field the fixture does not carry, so it is left out too
            const excludedObjectApiNames = ['Contact', 'Order__c', 'MasterDetailMadness__c', 'Example_Everything__c'];
            const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(readFixture(NESTED_FIXTURE), { excludedObjectApiNames: excludedObjectApiNames, parentLookupsByObjectApiName: FIXTURE_LOOKUPS }));
            const recipeFilePath = writeTemporaryRecipe(filtered.recipeText);

            const fakerJsProcessor = new FakerJSRecipeProcessor();
            const generatedJson = await fakerJsProcessor.generateFakeDataBySelectedRecipeFile(recipeFilePath) as string;
            const collectionsBySObject = fakerJsProcessor.transformFakerJsonDataToCollectionApiFormattedFilesBySObject(generatedJson);
            const serializedRecords = JSON.stringify([...collectionsBySObject.values()]);

            expect([...collectionsBySObject.keys()].sort()).toEqual(['Account', 'MegaMapMadness__c', 'Opportunity', 'Order_Item__c', 'Product_Family__c', 'Product__c']);
            excludedObjectApiNames.forEach(excludedObjectApiName => expect(serializedRecords).not.toContain(`${excludedObjectApiName}_NickName`));
            // THE MOVED Order_Item__c STILL POINTS AT THE Product__c IT IS NOW GENERATED UNDER
            const generatedRecords = JSON.parse(generatedJson) as Array<{ object: string; nickname: string; fields: Record<string, unknown> }>;
            const productNicknames = generatedRecords.filter(record => record.object === 'Product__c').map(record => record.nickname);
            const orderItems = generatedRecords.filter(record => record.object === 'Order_Item__c');
            expect(orderItems).not.toBeEmpty();
            orderItems.forEach(orderItem => expect(productNicknames).toContain(orderItem.fields['Product__c']));

            fs.rmSync(path.dirname(recipeFilePath), { recursive: true, force: true });

        });

    });

    describe('snowfakery, flat', () => {

        test('drops excluded blocks and every lookup that points at an excluded object, and nothing else', () => {

            const recipeText = readFixture(SNOWFAKERY_FIXTURE);
            const recipeLines = recipeText.split('\n');

            const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, { excludedObjectApiNames: ['Account'], parentLookupsByObjectApiName: FIXTURE_LOOKUPS }));
            const occurrences = scanOccurrences(filtered.recipeText);

            expect(occurrences.map(occurrence => occurrence.objectApiName)).not.toContain('Account');
            expect(occurrences.every(occurrence => occurrence.objectIndent === 0)).toBeTrue();
            expect(filtered.movedObjects).toEqual([]);
            expect(occurrences.find(occurrence => occurrence.objectApiName === 'Contact')?.fieldApiNames).not.toContain('AccountId');
            expect(occurrences.find(occurrence => occurrence.objectApiName === 'Contact')?.fieldApiNames).toContain('ReportsToId');
            expect(occurrences.find(occurrence => occurrence.objectApiName === 'Order__c')?.fieldApiNames).not.toContain('Account__c');
            expect(filtered.droppedLookups.map(lookup => lookup.fieldApiName).sort()).toEqual(['AccountId', 'AccountId', 'AccountLookup__c', 'Account__c']);

            // EVERY LINE OF THE COPY IS A LINE OF THE SOURCE, IN ORDER
            const [, ...filteredLines] = filtered.recipeText.split('\n');
            let sourceIndex = 0;
            filteredLines.forEach(filteredLine => {
                while ( sourceIndex < recipeLines.length && recipeLines[sourceIndex] !== filteredLine ) {
                    sourceIndex++;
                }
                expect(sourceIndex).toBeLessThan(recipeLines.length);
                sourceIndex++;
            });

        });

        test('runs through the snowfakery processor as the filtered file, never the recipe', async () => {

            const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(readFixture(SNOWFAKERY_FIXTURE), { excludedObjectApiNames: ['Opportunity'], parentLookupsByObjectApiName: FIXTURE_LOOKUPS }));
            const recipeFilePath = writeTemporaryRecipe(filtered.recipeText);
            const execFileMock = childProcess.execFile as unknown as jest.Mock;
            const snowfakeryJson = JSON.stringify([{ _table: 'Account', id: 1, Name: 'Acme' }]);
            execFileMock.mockImplementation((_command: string, _argv: string[], _options: unknown, callback: (error: null, stdout: string) => void) => callback(null, snowfakeryJson));

            const generatedJson = await new SnowfakeryRecipeProcessor().generateFakeDataBySelectedRecipeFile(recipeFilePath);

            expect(execFileMock).toHaveBeenCalledTimes(1);
            expect(execFileMock.mock.calls[0][1][0]).toBe(recipeFilePath);
            expect(generatedJson).toBe(snowfakeryJson);
            expect(fs.readFileSync(recipeFilePath, 'utf8')).not.toContain('- object: Opportunity');

            fs.rmSync(path.dirname(recipeFilePath), { recursive: true, force: true });

        });

        PythonTestHarness.testRequiringModules('yaml')('loads in PyYAML, snowfakery\'s parser, with no excluded object and no lookup to one', () => {

            const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(readFixture(SNOWFAKERY_FIXTURE), { excludedObjectApiNames: ['Account', 'Contact'], parentLookupsByObjectApiName: FIXTURE_LOOKUPS }));

            const [loadedRecipe] = PythonTestHarness.loadWithPyYaml([filtered.recipeText]) as Array<Array<{ object: string; fields?: Record<string, unknown> }>>;

            expect(loadedRecipe.map(entry => entry.object)).not.toIncludeAnyMembers(['Account', 'Contact']);
            loadedRecipe.forEach(entry => {
                ( FIXTURE_LOOKUPS.get(entry.object) ?? [] )
                    .filter(lookup => ['Account', 'Contact'].includes(lookup.parentObjectApiName))
                    .forEach(lookup => expect(entry.fields ?? {}).not.toHaveProperty(lookup.fieldApiName));
            });

        });

    });

    describe('line endings', () => {

        test('keeps CRLF and a missing final newline', () => {

            const recipeText = readFixture(NESTED_FIXTURE).replace(/\n+$/, '').replace(/\n/g, '\r\n');

            const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, { excludedObjectApiNames: ['Contact', 'Order__c'], parentLookupsByObjectApiName: FIXTURE_LOOKUPS }));

            expect(filtered.recipeText).not.toMatch(/[^\r]\n/);
            expect(filtered.recipeText).not.toMatch(/\r?\n$/);
            expect(filtered.recipeText.replace(/\r\n/g, '\n')).toBe(expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(readFixture(NESTED_FIXTURE).replace(/\n+$/, ''), {
                excludedObjectApiNames: ['Contact', 'Order__c'],
                parentLookupsByObjectApiName: FIXTURE_LOOKUPS
            })).recipeText);

        });

    });

    describe('refusals', () => {

        test('refuses a nesting that would close a loop, which only a hand-edited wrapper\'s levels allow', () => {

            const recipeText = [
                '- object: Root',
                '  nickname: Root_NickName',
                '  fields:',
                '    Name: r',
                '  friends:',
                '    - object: Alpha',
                '      nickname: Alpha_NickName',
                '      fields:',
                '        Gamma__c: ### TODO',
                '    - object: Beta',
                '      nickname: Beta_NickName',
                '      fields:',
                '        Alpha__c: ### TODO',
                '      friends:',
                '        - object: Gamma',
                '          nickname: Gamma_NickName',
                '          fields:',
                '            Beta__c: Beta_NickName',
                ''
            ].join('\n');

            // Gamma IS NESTED UNDER Beta, YET CLAIMS A LOWER LEVEL: Alpha MOVES UNDER Gamma, Beta UNDER Alpha, AND Gamma IS UNDER Beta
            expectRefused(RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, {
                excludedObjectApiNames: ['Root'],
                parentLookupsByObjectApiName: new Map([
                    ['Alpha', [{ fieldApiName: 'Gamma__c', parentObjectApiName: 'Gamma' }]],
                    ['Beta', [{ fieldApiName: 'Alpha__c', parentObjectApiName: 'Alpha' }]],
                    ['Gamma', [{ fieldApiName: 'Beta__c', parentObjectApiName: 'Beta' }]]
                ]),
                levelsByObjectApiName: new Map([['Root', 0], ['Gamma', 1], ['Alpha', 2], ['Beta', 3]])
            }), 'unsupported-filter-layout');

        });

        test.each([
            ['no "nickname:" line', ''],
            ['two "nickname:" lines', '  nickname: Contract_NickName\n  nickname: Contract_Other_NickName\n'],
            ['two "friends:" lines', '  nickname: Contract_NickName\n  friends:\n  friends:\n'],
            ['a nickname that is not a name', '  nickname: "Contract NickName"\n']
        ])('refuses to move a friend under a parent with %s', (_caseName, contractProperties) => {

            const recipeText = '- object: Opportunity\n  nickname: Opportunity_NickName\n  fields:\n    Name: o\n  friends:\n    - object: Quote\n      nickname: Quote_NickName\n      fields:\n        ContractId: ### TODO\n'
                + `- object: Contract\n${contractProperties}  fields:\n    Status: Draft\n`;

            expectRefused(RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, {
                excludedObjectApiNames: ['Opportunity'],
                parentLookupsByObjectApiName: new Map([['Quote', [{ fieldApiName: 'ContractId', parentObjectApiName: 'Contract' }]]]),
                levelsByObjectApiName: new Map([['Opportunity', 0], ['Contract', 0], ['Quote', 1]])
            }), 'unsupported-filter-layout');

        });

        test('refuses a recipe with no objects even with nothing excluded', () => {
            expectRefused(RecipeCockpitRecipeWriter.buildFilteredRecipe('', { excludedObjectApiNames: [], parentLookupsByObjectApiName: new Map() }), 'object-not-found');
        });

        test('refuses a name that is not an object api name', () => {
            expectRefused(RecipeCockpitRecipeWriter.buildFilteredRecipe(readFixture(NESTED_FIXTURE), { excludedObjectApiNames: ['Bad\nName'], parentLookupsByObjectApiName: FIXTURE_LOOKUPS }), 'invalid-object-api-name');
        });

        test('refuses a recipe with no objects', () => {
            expectRefused(RecipeCockpitRecipeWriter.buildFilteredRecipe('# nothing here\n', { excludedObjectApiNames: ['Account'], parentLookupsByObjectApiName: FIXTURE_LOOKUPS }), 'object-not-found');
        });

        test('refuses when every object is excluded', () => {
            expectRefused(RecipeCockpitRecipeWriter.buildFilteredRecipe(readFixture(SELF_LOOKUP_FRIENDS_FIXTURE), {
                excludedObjectApiNames: ['Account', 'Contact', 'Case', 'Opportunity', 'Lead'],
                parentLookupsByObjectApiName: new Map()
            }), 'all-objects-excluded');
        });

        test('refuses a moved block with a line break the JS split does not see, rather than leaving text at its old column', () => {

            const recipeText = readFixture(NESTED_FIXTURE).replace('        LastName: ${{faker.person.lastName()}}', '        LastName: ${{faker.person.lastName()}}     Smuggled: x');

            expectRefused(RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, { excludedObjectApiNames: ['Account'], parentLookupsByObjectApiName: FIXTURE_LOOKUPS }), 'unsupported-filter-layout');

        });

        test('never moves an object under one of its own friends, whatever the levels say', () => {

            const recipeText = [
                '- object: Root',
                '  nickname: Root_NickName',
                '  fields:',
                '    Name: r',
                '  friends:',
                '    - object: Left',
                '      nickname: Left_NickName',
                '      fields:',
                '        Right__c: ### TODO -- REFERENCE ID REQUIRED -- Right',
                '      friends:',
                '        - object: Right',
                '          nickname: Right_NickName',
                '          fields:',
                '            Left__c: Left_NickName',
                ''
            ].join('\n');

            const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, {
                excludedObjectApiNames: ['Root'],
                parentLookupsByObjectApiName: new Map([
                    ['Left', [{ fieldApiName: 'Right__c', parentObjectApiName: 'Right' }]],
                    ['Right', [{ fieldApiName: 'Left__c', parentObjectApiName: 'Left' }]]
                ]),
                // A HAND-EDITED WRAPPER CLAIMING THE FRIEND IS ABOVE ITS PARENT
                levelsByObjectApiName: new Map([['Root', 0], ['Left', 2], ['Right', 1]])
            }));

            expect(filtered.movedObjects).toEqual([{ objectApiName: 'Left' }]);
            expect(scanOccurrences(filtered.recipeText).map(occurrence => [occurrence.objectApiName, occurrence.parentObjectApiName])).toEqual([['Left', undefined], ['Right', 'Left']]);

        });

    });

});

function expectInserted(result: ReturnType<typeof RecipeCockpitRecipeWriter.insertFriend>): string {
    if ( 'refusal' in result ) {
        throw new Error(result.refusal.message);
    }
    return result.recipeText;
}

// THE SOURCE'S LINES WITHOUT THE NAMED FIELDS' OWN LINES AND CONTINUATION LINES, IN EVERY OCCURRENCE OF THEIR OBJECT
function linesWithoutFields(recipeText: string, excludedFieldApiNamesByObject: Map<string, string[]>): string[] {
    const recipeLines = RecipeCockpitRecipeWriter.splitRecipeLines(recipeText).lines;
    const removedLineIndexes = new Set<number>();
    RecipeCockpitRecipeWriter.scanRecipeObjects(recipeLines).forEach(scannedObject => scannedObject.fields
        .filter(scannedField => excludedFieldApiNamesByObject.get(scannedObject.objectApiName)?.includes(scannedField.fieldApiName))
        .forEach(scannedField => {
            for ( let lineIndex = scannedField.startIndex; lineIndex < scannedField.endIndex; lineIndex++ ) {
                removedLineIndexes.add(lineIndex);
            }
        }));
    return recipeLines.filter((_recipeLine, lineIndex) => !removedLineIndexes.has(lineIndex));
}

describe('RecipeCockpitRecipeWriter.buildFilteredRecipe -- unticked fields (#220)', () => {

    test('an empty field map is the recipe itself, byte for byte', () => {

        const recipeText = readFixture(SNOWFAKERY_FIXTURE);

        const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, {
            excludedObjectApiNames: [],
            parentLookupsByObjectApiName: FIXTURE_LOOKUPS,
            excludedFieldApiNamesByObject: new Map([['Account', []]])
        }));

        expect(filtered.recipeText).toBe(recipeText);
        expect(filtered.droppedFields).toEqual([]);

    });

    test('a field the recipe does not carry leaves the recipe as it is', () => {

        const recipeText = readFixture(SNOWFAKERY_FIXTURE);

        const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, {
            excludedObjectApiNames: [],
            parentLookupsByObjectApiName: FIXTURE_LOOKUPS,
            excludedFieldApiNamesByObject: new Map([['Account', ['NotInTheRecipe__c']]])
        }));

        expect(filtered.recipeText).toBe(recipeText);

    });

    test('snowfakery: drops each unticked field and its continuation lines, and every other line is byte for byte', () => {

        const recipeText = readFixture(SNOWFAKERY_FIXTURE);
        const excludedFieldApiNamesByObject = new Map([['Account', ['Description', 'Phone']], ['Example_Everything__c', ['DependentPicklist__c']]]);

        const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, {
            excludedObjectApiNames: [],
            parentLookupsByObjectApiName: FIXTURE_LOOKUPS,
            excludedFieldApiNamesByObject: excludedFieldApiNamesByObject
        }));

        const [headerComment, ...filteredLines] = filtered.recipeText.split('\n');
        expect(headerComment).toBe('# Recipe Cockpit -- a filtered copy of this tree\'s recipe, leaving out: fields Account.Description, Account.Phone, Example_Everything__c.DependentPicklist__c');
        expect(filteredLines).toEqual(linesWithoutFields(recipeText, excludedFieldApiNamesByObject));
        expect(filtered.droppedFields).toEqual([
            { objectApiName: 'Account', fieldApiName: 'Description' },
            { objectApiName: 'Account', fieldApiName: 'Phone' },
            { objectApiName: 'Example_Everything__c', fieldApiName: 'DependentPicklist__c' }
        ]);
        expect(filtered.droppedObjectApiNames).toEqual([]);
        expect(filtered.droppedLookups).toEqual([]);

        const occurrences = scanOccurrences(filtered.recipeText);
        expect(occurrences.find(occurrence => occurrence.objectApiName === 'Account')?.fieldApiNames).not.toIncludeAnyMembers(['Description', 'Phone']);
        expect(occurrences.find(occurrence => occurrence.objectApiName === 'Account')?.fieldApiNames).toContain('Name');

    });

    test('faker-js: drops unticked fields at every friends: depth, and every other line is byte for byte', () => {

        const recipeText = readFixture(NESTED_FIXTURE);
        const excludedFieldApiNamesByObject = new Map([
            ['Account', ['Site']],
            ['Contact', ['Phone', 'Email']],
            ['Product__c', ['MSRP__c']],
            ['Order_Item__c', ['Qty_M__c']]
        ]);

        const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, {
            excludedObjectApiNames: [],
            parentLookupsByObjectApiName: FIXTURE_LOOKUPS,
            excludedFieldApiNamesByObject: excludedFieldApiNamesByObject
        }));

        const [, ...filteredLines] = filtered.recipeText.split('\n');
        expect(filteredLines).toEqual(linesWithoutFields(recipeText, excludedFieldApiNamesByObject));
        expect(scanOccurrences(filtered.recipeText).map(occurrence => [occurrence.objectApiName, occurrence.parentObjectApiName]))
            .toEqual(scanOccurrences(recipeText).map(occurrence => [occurrence.objectApiName, occurrence.parentObjectApiName]));
        scanOccurrences(filtered.recipeText).forEach(occurrence => {
            expect(occurrence.fieldApiNames).not.toIncludeAnyMembers(excludedFieldApiNamesByObject.get(occurrence.objectApiName) ?? []);
        });

    });

    test('drops the field from every occurrence of its object, a self-lookup iteration included', () => {

        const recipeText = readFixture(NESTED_FIXTURE);

        const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, {
            excludedObjectApiNames: [],
            parentLookupsByObjectApiName: FIXTURE_LOOKUPS,
            excludedFieldApiNamesByObject: new Map([['Example_Everything__c', ['Checkbox__c']]])
        }));

        const everythingOccurrences = scanOccurrences(filtered.recipeText).filter(occurrence => occurrence.objectApiName === 'Example_Everything__c');
        expect(everythingOccurrences).toHaveLength(2);
        everythingOccurrences.forEach(occurrence => expect(occurrence.fieldApiNames).not.toContain('Checkbox__c'));
        expect(filtered.droppedFields).toEqual([{ objectApiName: 'Example_Everything__c', fieldApiName: 'Checkbox__c' }]);

    });

    test('names both what it left out when objects and fields are excluded together', () => {

        const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(readFixture(NESTED_FIXTURE), {
            excludedObjectApiNames: ['Opportunity'],
            parentLookupsByObjectApiName: FIXTURE_LOOKUPS,
            excludedFieldApiNamesByObject: new Map([['Account', ['Site']]])
        }));

        expect(filtered.recipeText.split('\n')[0]).toBe('# Recipe Cockpit -- a filtered copy of this tree\'s recipe, leaving out: Opportunity; fields Account.Site');
        expect(scanOccurrences(filtered.recipeText).map(occurrence => occurrence.objectApiName)).not.toContain('Opportunity');

    });

    test('an unticked lookup of a moved friend is dropped rather than re-wired to its new parent', () => {

        const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(readFixture(NESTED_FIXTURE), {
            excludedObjectApiNames: ['Contact', 'Order__c'],
            parentLookupsByObjectApiName: FIXTURE_LOOKUPS,
            excludedFieldApiNamesByObject: new Map([['Order_Item__c', ['Product__c']]])
        }));

        const orderItem = scanOccurrences(filtered.recipeText).find(occurrence => occurrence.objectApiName === 'Order_Item__c');
        expect(orderItem).toMatchObject({ parentObjectApiName: 'Product__c' });
        expect(orderItem?.fieldApiNames).not.toContain('Product__c');
        expect(filtered.recipeText).not.toContain('Product__c: Product__c_NickName');

    });

    test('unticking every field keeps the object, with no "fields:" line left to load as null', () => {

        const recipeText = readFixture(NESTED_FIXTURE);
        const productFamilyFields = scanOccurrences(recipeText).find(occurrence => occurrence.objectApiName === 'Product_Family__c')?.fieldApiNames ?? [];

        const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, {
            excludedObjectApiNames: [],
            parentLookupsByObjectApiName: FIXTURE_LOOKUPS,
            excludedFieldApiNamesByObject: new Map([['Product_Family__c', productFamilyFields]])
        }));

        const productFamily = (yaml.load(filtered.recipeText) as Array<{ object: string; fields?: unknown; friends?: unknown[] }>).find(entry => entry.object === 'Product_Family__c');
        expect(productFamily).toBeDefined();
        expect(productFamily).not.toHaveProperty('fields');
        expect(productFamily?.friends).toHaveLength(1);

    });

    test('keeps CRLF line endings', () => {

        const recipeText = readFixture(SNOWFAKERY_FIXTURE).replace(/\n/g, '\r\n');

        const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, {
            excludedObjectApiNames: [],
            parentLookupsByObjectApiName: FIXTURE_LOOKUPS,
            excludedFieldApiNamesByObject: new Map([['Account', ['Description']]])
        }));

        expect(filtered.recipeText).not.toMatch(/[^\r]\n/);
        expect(scanOccurrences(filtered.recipeText).find(occurrence => occurrence.objectApiName === 'Account')?.fieldApiNames).not.toContain('Description');

    });

    test.each([
        ['a field name with a line break', new Map([['Account', ['Name\n- object: Evil']]]), 'invalid-field-api-name'],
        ['a field name with a space', new Map([['Account', ['Bad Name']]]), 'invalid-field-api-name'],
        ['an object name that is not an api name', new Map([['Bad Object', ['Name']]]), 'invalid-object-api-name']
    ] as Array<[string, Map<string, string[]>, RecipeWriterRefusalReason]>)('refuses %s before writing anything', (_caseName, excludedFieldApiNamesByObject, reason) => {
        expectRefused(RecipeCockpitRecipeWriter.buildFilteredRecipe(readFixture(SNOWFAKERY_FIXTURE), {
            excludedObjectApiNames: [],
            parentLookupsByObjectApiName: FIXTURE_LOOKUPS,
            excludedFieldApiNamesByObject: excludedFieldApiNamesByObject
        }), reason);
    });

    test('generates through the faker-js processor with exactly the unticked fields missing', async () => {

        // Example_Everything__c's dependent picklist names a controlling field the fixture does not carry, so it is left out
        const excludedFieldApiNamesByObject = new Map([['Account', ['Phone', 'Site']], ['Contact', ['Email', 'Title']], ['Product__c', ['MSRP__c']]]);
        const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(readFixture(NESTED_FIXTURE), {
            excludedObjectApiNames: ['Example_Everything__c'],
            parentLookupsByObjectApiName: FIXTURE_LOOKUPS,
            excludedFieldApiNamesByObject: excludedFieldApiNamesByObject
        }));
        const unfiltered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(readFixture(NESTED_FIXTURE), {
            excludedObjectApiNames: ['Example_Everything__c'],
            parentLookupsByObjectApiName: FIXTURE_LOOKUPS
        }));
        const filteredFilePath = writeTemporaryRecipe(filtered.recipeText);
        const unfilteredFilePath = writeTemporaryRecipe(unfiltered.recipeText);

        const fakerJsProcessor = new FakerJSRecipeProcessor();
        const generatedRecords = JSON.parse(await fakerJsProcessor.generateFakeDataBySelectedRecipeFile(filteredFilePath) as string) as Array<{ object: string; fields: Record<string, unknown> }>;
        const unfilteredRecords = JSON.parse(await fakerJsProcessor.generateFakeDataBySelectedRecipeFile(unfilteredFilePath) as string) as Array<{ object: string; fields: Record<string, unknown> }>;

        const fieldNamesByObject = (records: Array<{ object: string; fields: Record<string, unknown> }>) => {
            const namesByObject = new Map<string, Set<string>>();
            records.forEach(record => namesByObject.set(record.object, new Set([...( namesByObject.get(record.object) ?? [] ), ...Object.keys(record.fields ?? {})])));
            return namesByObject;
        };
        const filteredNames = fieldNamesByObject(generatedRecords);
        const unfilteredNames = fieldNamesByObject(unfilteredRecords);

        expect([...filteredNames.keys()].sort()).toEqual([...unfilteredNames.keys()].sort());
        unfilteredNames.forEach((fieldApiNames, objectApiName) => {
            const excludedFieldApiNames = excludedFieldApiNamesByObject.get(objectApiName) ?? [];
            expect([...( filteredNames.get(objectApiName) ?? [] )].sort()).toEqual([...fieldApiNames].filter(fieldApiName => !excludedFieldApiNames.includes(fieldApiName)).sort());
        });

        fs.rmSync(path.dirname(filteredFilePath), { recursive: true, force: true });
        fs.rmSync(path.dirname(unfilteredFilePath), { recursive: true, force: true });

    });

    test('generates records with no fields set for an object whose every field is unticked, through the faker-js processor', async () => {

        const recipeText = readFixture(NESTED_FIXTURE);
        const productFamilyFields = scanOccurrences(recipeText).find(occurrence => occurrence.objectApiName === 'Product_Family__c')?.fieldApiNames ?? [];
        const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, {
            excludedObjectApiNames: ['Example_Everything__c'],
            parentLookupsByObjectApiName: FIXTURE_LOOKUPS,
            excludedFieldApiNamesByObject: new Map([['Product_Family__c', productFamilyFields]])
        }));
        const recipeFilePath = writeTemporaryRecipe(filtered.recipeText);

        const generatedRecords = JSON.parse(await new FakerJSRecipeProcessor().generateFakeDataBySelectedRecipeFile(recipeFilePath) as string) as Array<{ object: string; fields?: Record<string, unknown> }>;
        const productFamilies = generatedRecords.filter(record => record.object === 'Product_Family__c');

        expect(productFamilies).not.toBeEmpty();
        productFamilies.forEach(productFamily => expect(Object.keys(productFamily.fields ?? {})).toEqual([]));
        expect(generatedRecords.some(record => record.object === 'Product__c')).toBeTrue();

        fs.rmSync(path.dirname(recipeFilePath), { recursive: true, force: true });

    });

    test('runs through the snowfakery processor as the filtered file, which lacks exactly the unticked fields', async () => {

        const excludedFieldApiNamesByObject = new Map([['Account', ['Phone', 'Description']], ['Contact', ['Email']]]);
        const recipeText = readFixture(SNOWFAKERY_FIXTURE);
        const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, {
            excludedObjectApiNames: [],
            parentLookupsByObjectApiName: FIXTURE_LOOKUPS,
            excludedFieldApiNamesByObject: excludedFieldApiNamesByObject
        }));
        const recipeFilePath = writeTemporaryRecipe(filtered.recipeText);
        const execFileMock = childProcess.execFile as unknown as jest.Mock;
        execFileMock.mockClear();
        execFileMock.mockImplementation((_command: string, _argv: string[], _options: unknown, callback: (error: null, stdout: string) => void) => callback(null, '[]'));

        await new SnowfakeryRecipeProcessor().generateFakeDataBySelectedRecipeFile(recipeFilePath);

        expect(execFileMock.mock.calls[0][1][0]).toBe(recipeFilePath);
        const ranRecipe = yaml.load(fs.readFileSync(recipeFilePath, 'utf8')) as Array<{ object: string; fields?: Record<string, unknown> }>;
        const sourceRecipe = yaml.load(recipeText) as Array<{ object: string; fields?: Record<string, unknown> }>;
        expect(ranRecipe.map(entry => entry.object)).toEqual(sourceRecipe.map(entry => entry.object));
        ranRecipe.forEach((entry, index) => {
            const excludedFieldApiNames = excludedFieldApiNamesByObject.get(entry.object) ?? [];
            expect(Object.keys(entry.fields ?? {})).toEqual(Object.keys(sourceRecipe[index].fields ?? {}).filter(fieldApiName => !excludedFieldApiNames.includes(fieldApiName)));
        });

        fs.rmSync(path.dirname(recipeFilePath), { recursive: true, force: true });

    });

    PythonTestHarness.testRequiringModules('yaml')('loads in PyYAML, snowfakery\'s parser, without the unticked fields and with no null fields block', () => {

        const recipeText = readFixture(SNOWFAKERY_FIXTURE);
        const accountFields = scanOccurrences(recipeText).find(occurrence => occurrence.objectApiName === 'Account')?.fieldApiNames ?? [];
        const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, {
            excludedObjectApiNames: [],
            parentLookupsByObjectApiName: FIXTURE_LOOKUPS,
            excludedFieldApiNamesByObject: new Map([['Account', accountFields], ['Contact', ['Email']]])
        }));

        const [loadedRecipe] = PythonTestHarness.loadWithPyYaml([filtered.recipeText]) as Array<Array<{ object: string; fields?: Record<string, unknown> }>>;

        expect(loadedRecipe.find(entry => entry.object === 'Account')).not.toHaveProperty('fields');
        loadedRecipe.filter(entry => entry.object === 'Contact').forEach(entry => expect(entry.fields ?? {}).not.toHaveProperty('Email'));

    });

});

describe('RecipeCockpitRecipeWriter -- the Create cut honours unticked fields (#220)', () => {

    test('extractObjectBlock leaves an unticked field and its continuation lines out of the cut', () => {

        const extraction = RecipeCockpitRecipeWriter.extractObjectBlock(readFixture(NESTED_FIXTURE), 'Contact', 3, undefined, ['Phone', 'Email']);
        if ( 'refusal' in extraction ) {
            throw new Error(extraction.refusal.message);
        }

        const [cutObject] = scanOccurrences(extraction.recipeText);
        expect(cutObject.fieldApiNames).not.toIncludeAnyMembers(['Phone', 'Email']);
        expect(cutObject.fieldApiNames).toContain('MobilePhone');
        expect(extraction.recipeText).not.toContain('${{faker.internet.email()}}');

    });

    test('listCreateBlockFieldApiNames and its one-scan batch leave the unticked fields out alike', () => {

        const recipeText = readFixture(NESTED_FIXTURE);

        const single = RecipeCockpitRecipeWriter.listCreateBlockFieldApiNames(recipeText, 'Contact', undefined, ['Phone']);
        const [batched] = RecipeCockpitRecipeWriter.listCreateBlockFieldApiNamesForObjects(recipeText, [{ objectApiName: 'Contact', excludedFieldApiNames: ['Phone'] }]);

        expect(single).toEqual(batched);
        expect(single.isListed && single.fieldApiNames).not.toContain('Phone');
        expect(single.isListed && single.fieldApiNames).toContain('LastName');

    });

});

describe('RecipeCockpitRecipeWriter.hasRecordTypeSections (#220)', () => {

    test('is true for an object whose other fields carry a record-type section, and false otherwise', () => {

        const recipeLines = RecipeCockpitRecipeWriter.splitRecipeLines(readFixture(NESTED_FIXTURE)).lines;
        const scannedObjects = RecipeCockpitRecipeWriter.scanRecipeObjects(recipeLines);

        expect(RecipeCockpitRecipeWriter.hasRecordTypeSections(recipeLines, scannedObjects.find(scannedObject => scannedObject.objectApiName === 'Example_Everything__c') as IScannedObject)).toBeTrue();
        expect(RecipeCockpitRecipeWriter.hasRecordTypeSections(recipeLines, scannedObjects.find(scannedObject => scannedObject.objectApiName === 'Account') as IScannedObject)).toBeFalse();

    });

    test('does not count RecordTypeId\'s own "RecordType Options" line', () => {

        const recipeLines = [
            '- object: Thing__c',
            '  fields:',
            '    RecordTypeId: Thing__c.One',
            '                        ### TODO: -- RecordType Options -- From below, choose the expected Record Type Developer Name',
            '                        # Thing__c.Two',
            '    Name: x',
            ''
        ];

        expect(RecipeCockpitRecipeWriter.hasRecordTypeSections(recipeLines, RecipeCockpitRecipeWriter.scanRecipeObjects(recipeLines)[0])).toBeFalse();

    });

});
