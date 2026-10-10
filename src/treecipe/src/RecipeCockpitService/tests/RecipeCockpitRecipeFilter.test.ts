import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';

import { RecipeCockpitRecipeWriter, RecipeFilterResult, IRecipeFilterLookup, RecipeWriterRefusalReason } from '../RecipeCockpitRecipeWriter';
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
            ['two "friends:" lines', '  nickname: Contract_NickName\n  friends:\n  friends:\n']
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
