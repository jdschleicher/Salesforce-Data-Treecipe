import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

jest.mock('vscode', () => ({
    window: { createWebviewPanel: jest.fn(), withProgress: jest.fn(), showWarningMessage: jest.fn(), showInputBox: jest.fn() },
    commands: { executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    ProgressLocation: { Notification: 15 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }) }
}), { virtual: true });

import {
    RecipeCockpitService,
    IRecipeCockpitObjectViewModel,
    IRecipeCockpitPanelState,
    IRecipeCockpitRecipeViewModel,
    IRecipeCockpitTreeViewModel,
    RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY,
    RECIPE_COCKPIT_OBJECT_SELECTION_VERSION,
    RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_COUNTS,
    RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_FIELDS,
    RECIPE_COCKPIT_RESET_SELECTION_CONFIRM_LABEL,
    RECIPE_COCKPIT_RUN_FAKER_COMMAND,
    RECIPE_COCKPIT_UNGROUPED_TREE_TITLE
} from '../RecipeCockpitService';
import { RecipeCockpitRecipeWriter, RecipeFilterResult, RecipeWriterRefusalReason } from '../RecipeCockpitRecipeWriter';
import { FakerJSRecipeProcessor } from '../../FakerRecipeProcessor/FakerJSRecipeProcessor/FakerJSRecipeProcessor';
import { PythonTestHarness } from '../../RecipeFakerService.ts/RecipeYamlScalar/tests/mocks/PythonTestHarness';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';

/*
    #255: a count box right of each object's name sets how many records the generate button and the whole-tree
    insert generate, kept by tree folder beside the excluded objects and unticked fields. The recipe
    file is never written: the count rides on the filtered copy.
*/

const recipeWriterMocksPath = path.join(__dirname, 'mocks', 'recipeWriter');
const NESTED_FIXTURE = 'recipe-fakerjs-nested--RelationshipTree_1.yml';
const SNOWFAKERY_FIXTURE = 'recipe-snowfakery--RelationshipTree_1.yml';
const SELF_LOOKUP_FRIENDS_FIXTURE = 'recipe-fakerjs-selfLookupFriends--RelationshipTree_1.yml';

const HISTORY_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'historyWorkspace');
const HISTORY_GENERATED_RECIPES_PATH = path.join(HISTORY_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes');
const CURRENT_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const LEAD_TREE_KEY = 'Lead-ONLY';
const ACCOUNT_RECIPE_FILE_PATH = path.join(HISTORY_GENERATED_RECIPES_PATH, CURRENT_RUN_FOLDER_NAME, ACCOUNT_TREE_KEY, `recipe--${ACCOUNT_TREE_KEY}-2026-09-20T10-00-00.yml`);

function readFixture(fileName: string): string {
    return fs.readFileSync(path.join(recipeWriterMocksPath, fileName), 'utf8');
}

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

// EVERY OCCURRENCE AS THE SCANNER READS IT BACK: NAME, PARENT, DEPTH AND ITS ONE COUNT
function readOccurrences(recipeText: string) {
    const { lines } = RecipeCockpitRecipeWriter.splitRecipeLines(recipeText);
    const scannedObjects = RecipeCockpitRecipeWriter.scanRecipeObjects(lines);
    const byHeaderIndex = new Map(scannedObjects.map(scannedObject => [scannedObject.headerIndex, scannedObject]));
    return scannedObjects.map(scannedObject => ({
        objectApiName: scannedObject.objectApiName,
        nickname: scannedObject.nicknames[0],
        parentObjectApiName: scannedObject.parentHeaderIndex === undefined ? undefined : byHeaderIndex.get(scannedObject.parentHeaderIndex)?.objectApiName,
        objectIndent: scannedObject.objectIndent,
        count: RecipeCockpitRecipeWriter.readObjectCount(lines, scannedObject),
        countLine: scannedObject.propertyLineIndexes.count.length === 1 ? lines[scannedObject.propertyLineIndexes.count[0]] : undefined,
        fieldApiNames: scannedObject.fields.map(scannedField => scannedField.fieldApiName)
    }));
}

const filterWithCounts = (recipeText: string, objectCountsByObject: Map<string, number>, excludedObjectApiNames: string[] = [], excludedFieldApiNamesByObject?: Map<string, string[]>) => RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, {
    excludedObjectApiNames: excludedObjectApiNames,
    parentLookupsByObjectApiName: new Map([
        ['Contact', [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }]],
        ['Opportunity', [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }]],
        ['Order__c', [{ fieldApiName: 'Account__c', parentObjectApiName: 'Account' }]],
        ['MasterDetailMadness__c', [
            { fieldApiName: 'LU_Contact__c', parentObjectApiName: 'Contact' },
            { fieldApiName: 'MD_MegaMapMadness__c', parentObjectApiName: 'MegaMapMadness__c' }
        ]],
        ['Order_Item__c', [{ fieldApiName: 'Order__c', parentObjectApiName: 'Order__c' }, { fieldApiName: 'Product__c', parentObjectApiName: 'Product__c' }]],
        ['Product__c', [{ fieldApiName: 'Product_Family__c', parentObjectApiName: 'Product_Family__c' }]],
        ['Case', [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }, { fieldApiName: 'ContactId', parentObjectApiName: 'Contact' }]]
    ]),
    ...( excludedFieldApiNamesByObject ? { excludedFieldApiNamesByObject: excludedFieldApiNamesByObject } : {} ),
    objectCountsByObject: objectCountsByObject
});

function writeTemporaryRecipe(recipeText: string): string {
    const directoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-counts-test-'));
    const recipeFilePath = path.join(directoryPath, 'filteredRecipe.yml');
    fs.writeFileSync(recipeFilePath, recipeText);
    return recipeFilePath;
}

const loadRecipeRun = () => RecipeCockpitService.loadRecipeRunByRuns(
    RecipeCockpitService.findGeneratedRecipeRuns(HISTORY_GENERATED_RECIPES_PATH),
    HISTORY_WORKSPACE_ROOT,
    CURRENT_RUN_FOLDER_NAME
);

const loadRecipe = (): IRecipeCockpitRecipeViewModel => loadRecipeRun().recipeViewModel;

const buildWorkspaceState = (initialValues: Record<string, unknown> = {}) => {
    const storedValues = new Map<string, unknown>(Object.entries(initialValues));
    return {
        storedValues,
        get: jest.fn((key: string) => storedValues.get(key)) as jest.Mock,
        update: jest.fn((key: string, value: unknown) => {
            if ( value === undefined ) { storedValues.delete(key); } else { storedValues.set(key, JSON.parse(JSON.stringify(value))); }
            return Promise.resolve();
        }) as jest.Mock
    };
};

const storedSelections = (objectCountsByFolderName: Record<string, unknown>, excludedObjectApiNamesByFolderName: Record<string, unknown> = {}, excludedFieldApiNamesByFolderName: Record<string, unknown> = {}) => ({
    version: RECIPE_COCKPIT_OBJECT_SELECTION_VERSION,
    excludedObjectApiNamesByFolderName: excludedObjectApiNamesByFolderName,
    excludedFieldApiNamesByFolderName: excludedFieldApiNamesByFolderName,
    objectCountsByFolderName: objectCountsByFolderName,
    validationRulesOffByFolderName: {}
});

const treeOf = (recipe: IRecipeCockpitRecipeViewModel, treeKey: string) => recipe.trees.find(tree => tree.treeKey === treeKey) as IRecipeCockpitTreeViewModel;
const objectOf = (recipe: IRecipeCockpitRecipeViewModel, objectApiName: string) => recipe.objects.find(objectViewModel => objectViewModel.objectApiName === objectApiName) as IRecipeCockpitObjectViewModel;

const applyCounts = (recipe: IRecipeCockpitRecipeViewModel, countsByFolderName: Record<string, Record<string, number>>, excludedObjectApiNamesByFolderName: Record<string, string[]> = {}) => RecipeCockpitService.applyObjectSelections(
    recipe,
    new Map(Object.entries(excludedObjectApiNamesByFolderName).map(([folderName, objectApiNames]) => [folderName, new Set(objectApiNames)])),
    new Map(),
    undefined,
    new Map(Object.entries(countsByFolderName).map(([folderName, countsByObject]) => [folderName, new Map(Object.entries(countsByObject))]))
);

describe('RecipeCockpitRecipeWriter -- record counts (#255)', () => {

    describe('isRecordCount', () => {

        it.each([1, 2, 200, Number.MAX_SAFE_INTEGER])('accepts %p', (candidate) => {
            expect(RecipeCockpitRecipeWriter.isRecordCount(candidate)).toBeTrue();
        });

        it.each([0, -1, 2.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '5', ' 5 ', '1e2', null, undefined, [3], { count: 3 }])('refuses %p', (candidate) => {
            expect(RecipeCockpitRecipeWriter.isRecordCount(candidate)).toBeFalse();
        });

    });

    describe('readObjectCount', () => {

        const countOf = (recipeText: string, objectApiName = 'Lead') => {
            const { lines } = RecipeCockpitRecipeWriter.splitRecipeLines(recipeText);
            const scannedObject = RecipeCockpitRecipeWriter.scanRecipeObjects(lines).find(candidate => candidate.objectApiName === objectApiName);
            return RecipeCockpitRecipeWriter.readObjectCount(lines, scannedObject!);
        };

        it('reads a plain whole number, at the top level and nested', () => {
            expect(countOf('- object: Lead\n  count: 7\n  fields:\n    LastName: x\n')).toBe(7);
            expect(countOf(readFixture(SELF_LOOKUP_FRIENDS_FIXTURE), 'Contact')).toBe(2);
            expect(countOf(readFixture(SELF_LOOKUP_FRIENDS_FIXTURE), 'Account')).toBe(2);
        });

        it.each([
            ['no count line', '- object: Lead\n  fields:\n    LastName: x\n'],
            ['two count lines', '- object: Lead\n  count: 2\n  count: 3\n  fields:\n    LastName: x\n'],
            ['a template', '- object: Lead\n  count: ${{ 2 + 1 }}\n  fields:\n    LastName: x\n'],
            ['a fraction', '- object: Lead\n  count: 2.5\n  fields:\n    LastName: x\n'],
            ['a count past what a number holds exactly', '- object: Lead\n  count: 9007199254740993\n  fields:\n    LastName: x\n']
        ])('answers undefined for %s', (_caseName, recipeText) => {
            expect(countOf(recipeText)).toBeUndefined();
        });

    });

    describe('countRecipeRecordsByObject', () => {

        it('multiplies a nested friend\'s count by its parent\'s records, and sums every occurrence', () => {

            // Account: 2 top + 2 per top Account in its iteration; Contact 2 per Account; Case 1 per Contact
            expect(RecipeCockpitRecipeWriter.countRecipeRecordsByObject(readFixture(SELF_LOOKUP_FRIENDS_FIXTURE))).toEqual(new Map([
                ['Account', 6],
                ['Contact', 4],
                ['Case', 4],
                ['Opportunity', 2],
                ['Lead', 1]
            ]));

        });

        it('counts a flat recipe object by object, and one with no count line as one', () => {

            const recordTotals = RecipeCockpitRecipeWriter.countRecipeRecordsByObject('- object: Lead\n  count: 3\n  fields:\n    LastName: x\n\n- object: Task\n  fields:\n    Subject: x\n');

            expect(recordTotals).toEqual(new Map([['Lead', 3], ['Task', 1]]));
            expect([...RecipeCockpitRecipeWriter.countRecipeRecordsByObject(readFixture(SNOWFAKERY_FIXTURE)).values()].every(recordTotal => recordTotal === 1)).toBeTrue();

        });

    });

    describe('buildFilteredRecipe with objectCountsByObject', () => {

        it('writes a nested friend\'s count at its own friends: depth, changes no other line and reads it back', () => {

            const recipeText = readFixture(NESTED_FIXTURE);
            const recipeLines = recipeText.split('\n');

            const filtered = expectFiltered(filterWithCounts(recipeText, new Map([['Contact', 4], ['MasterDetailMadness__c', 5], ['Account', 3]])));

            const [headerComment, ...filteredLines] = filtered.recipeText.split('\n');
            expect(headerComment).toBe('# Recipe Cockpit -- a filtered copy of this tree\'s recipe, with counts: Contact 4, MasterDetailMadness__c 5, Account 3');
            expect(filtered.appliedCounts).toEqual([
                { objectApiName: 'Contact', count: 4 },
                { objectApiName: 'MasterDetailMadness__c', count: 5 },
                { objectApiName: 'Account', count: 3 }
            ]);
            expect(filtered.droppedObjectApiNames).toEqual([]);
            expect(filtered.droppedFields).toEqual([]);

            expect(filteredLines).toHaveLength(recipeLines.length);
            const changedLineIndexes = recipeLines.map((recipeLine, lineIndex) => recipeLine === filteredLines[lineIndex] ? -1 : lineIndex).filter(lineIndex => lineIndex >= 0);
            expect(changedLineIndexes.map(lineIndex => filteredLines[lineIndex])).toEqual(['  count: 3', '      count: 4', '          count: 5']);
            changedLineIndexes.forEach(lineIndex => expect(recipeLines[lineIndex].trim()).toBe('count: 1'));

            const occurrences = readOccurrences(filtered.recipeText);
            expect(occurrences.find(occurrence => occurrence.objectApiName === 'Contact')).toMatchObject({ count: 4, parentObjectApiName: 'Account', objectIndent: 4 });
            expect(occurrences.find(occurrence => occurrence.objectApiName === 'MasterDetailMadness__c')).toMatchObject({ count: 5, parentObjectApiName: 'Contact', objectIndent: 8 });
            expect(occurrences.find(occurrence => occurrence.objectApiName === 'Account')).toMatchObject({ count: 3, objectIndent: 0 });

        });

        it('writes a count on the FIRST occurrence only, and leaves a self-lookup\'s iteration its own', () => {

            const filtered = expectFiltered(filterWithCounts(readFixture(NESTED_FIXTURE), new Map([['Example_Everything__c', 6]])));
            const everythingOccurrences = readOccurrences(filtered.recipeText).filter(occurrence => occurrence.objectApiName === 'Example_Everything__c');

            expect(everythingOccurrences.map(occurrence => [occurrence.nickname, occurrence.count])).toEqual([
                ['Example_Everything__c_NickName', 6],
                ['Example_Everything__c_child_NickName', 1]
            ]);

        });

        it('writes a flat snowfakery count at the top-level property column', () => {

            const recipeText = readFixture(SNOWFAKERY_FIXTURE);
            const filtered = expectFiltered(filterWithCounts(recipeText, new Map([['Contact', 5]])));

            expect(filtered.appliedCounts).toEqual([{ objectApiName: 'Contact', count: 5 }]);
            expect(readOccurrences(filtered.recipeText).find(occurrence => occurrence.objectApiName === 'Contact')).toMatchObject({ count: 5, countLine: '  count: 5', objectIndent: 0 });
            expect(readOccurrences(filtered.recipeText).filter(occurrence => occurrence.objectApiName !== 'Contact').every(occurrence => occurrence.count === 1)).toBeTrue();
            expect(filtered.recipeText.split('\n').slice(1).filter(filteredLine => !recipeText.split('\n').includes(filteredLine))).toEqual(['  count: 5']);
            expect(filtered.recipeText.split('\n')).toHaveLength(recipeText.split('\n').length + 1);

        });

        it('changes nothing for a count equal to the recipe\'s own, returning the recipe text byte for byte', () => {

            const recipeText = readFixture(SELF_LOOKUP_FRIENDS_FIXTURE);

            const filtered = expectFiltered(filterWithCounts(recipeText, new Map([['Account', 2], ['Contact', 2], ['Lead', 1]])));

            expect(filtered.recipeText).toBe(recipeText);
            expect(filtered.appliedCounts).toEqual([]);

        });

        it('returns the recipe byte for byte with no count and nothing excluded', () => {

            const recipeText = readFixture(NESTED_FIXTURE);
            const filtered = expectFiltered(filterWithCounts(recipeText, new Map()));

            expect(filtered.recipeText).toBe(recipeText);
            expect(filtered.appliedCounts).toEqual([]);

        });

        it('applies only the counts that differ when some equal the recipe\'s own', () => {

            const filtered = expectFiltered(filterWithCounts(readFixture(SELF_LOOKUP_FRIENDS_FIXTURE), new Map([['Account', 2], ['Contact', 3]])));

            expect(filtered.appliedCounts).toEqual([{ objectApiName: 'Contact', count: 3 }]);
            expect(filtered.recipeText.split('\n')[0]).toBe('# Recipe Cockpit -- a filtered copy of this tree\'s recipe, with counts: Contact 3');

        });

        it('ignores a count for an object the recipe does not carry', () => {

            const recipeText = readFixture(SELF_LOOKUP_FRIENDS_FIXTURE);
            const filtered = expectFiltered(filterWithCounts(recipeText, new Map([['Task', 9]])));

            expect(filtered.recipeText).toBe(recipeText);
            expect(filtered.appliedCounts).toEqual([]);

        });

        it.each([
            ['zero', 0],
            ['a negative count', -1],
            ['a fraction', 2.5],
            ['NaN', NaN],
            ['a count past MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER + 1],
            ['a string', '5' as unknown as number]
        ])('refuses %s', (_caseName, invalidCount) => {

            expectRefused(filterWithCounts(readFixture(SELF_LOOKUP_FRIENDS_FIXTURE), new Map([['Contact', invalidCount]])), 'invalid-value');

        });

        it.each([
            ['a name with a space', 'Bad Name'],
            ['a name that is a line of YAML', 'Contact\n- object: Evil'],
            ['an empty name', '']
        ])('refuses %s', (_caseName, invalidName) => {

            expectRefused(filterWithCounts(readFixture(SELF_LOOKUP_FRIENDS_FIXTURE), new Map([[invalidName, 3]])), 'invalid-object-api-name');

        });

        it('refuses a count for an object with no "count:" line, or with two', () => {

            const withoutCount = '- object: Lead\n  nickname: Lead_NickName\n  fields:\n    LastName: x\n';
            const withTwoCounts = '- object: Lead\n  nickname: Lead_NickName\n  count: 1\n  count: 2\n  fields:\n    LastName: x\n';

            expectRefused(filterWithCounts(withoutCount, new Map([['Lead', 3]])), 'unsupported-filter-layout');
            expectRefused(filterWithCounts(withTwoCounts, new Map([['Lead', 3]])), 'unsupported-filter-layout');

        });

        it('combines with excluded objects and unticked fields, and skips the count of an excluded object', () => {

            const filtered = expectFiltered(filterWithCounts(
                readFixture(NESTED_FIXTURE),
                new Map([['Contact', 3], ['Opportunity', 7]]),
                ['Opportunity'],
                new Map([['Contact', ['Email']]])
            ));
            const occurrences = readOccurrences(filtered.recipeText);

            expect(filtered.recipeText.split('\n')[0]).toBe('# Recipe Cockpit -- a filtered copy of this tree\'s recipe, leaving out: Opportunity; fields Contact.Email; with counts: Contact 3');
            expect(filtered.appliedCounts).toEqual([{ objectApiName: 'Contact', count: 3 }]);
            expect(occurrences.map(occurrence => occurrence.objectApiName)).not.toContain('Opportunity');
            expect(occurrences.find(occurrence => occurrence.objectApiName === 'Contact')).toMatchObject({ count: 3, objectIndent: 4 });
            expect(occurrences.find(occurrence => occurrence.objectApiName === 'Contact')?.fieldApiNames).not.toContain('Email');

        });

        it('writes the count of a friend moved under a new parent at its NEW depth', () => {

            const filtered = expectFiltered(filterWithCounts(readFixture(NESTED_FIXTURE), new Map([['MasterDetailMadness__c', 4]]), ['Contact']));
            const moved = readOccurrences(filtered.recipeText).find(occurrence => occurrence.objectApiName === 'MasterDetailMadness__c');

            expect(filtered.movedObjects).toContainEqual({ objectApiName: 'MasterDetailMadness__c', newParentObjectApiName: 'MegaMapMadness__c' });
            expect(moved).toMatchObject({ parentObjectApiName: 'MegaMapMadness__c', objectIndent: 4, count: 4, countLine: '      count: 4' });

        });

        it('totals a nested copy by multiplying through the parents it is generated under', () => {

            const filtered = expectFiltered(filterWithCounts(readFixture(SELF_LOOKUP_FRIENDS_FIXTURE), new Map([['Contact', 3]])));
            const recordTotals = RecipeCockpitRecipeWriter.countRecipeRecordsByObject(filtered.recipeText);

            expect(recordTotals.get('Contact')).toBe(6);
            expect(recordTotals.get('Case')).toBe(6);
            expect(recordTotals.get('Account')).toBe(6);

        });

        it('generates 2 Accounts x 3 Contacts = 6 Contacts through the faker-js processor, each naming one of the 2 Accounts', async () => {

            const filtered = expectFiltered(filterWithCounts(readFixture(SELF_LOOKUP_FRIENDS_FIXTURE), new Map([['Account', 2], ['Contact', 3]])));
            const recipeFilePath = writeTemporaryRecipe(filtered.recipeText);

            try {

                const generatedRecords = JSON.parse(await new FakerJSRecipeProcessor().generateFakeDataBySelectedRecipeFile(recipeFilePath) as string) as Array<{ object: string; nickname: string; fields: Record<string, unknown> }>;
                const topAccountNicknames = generatedRecords
                    .filter(record => record.object === 'Account' && !record.fields['ParentId'])
                    .map(record => record.nickname);
                const contacts = generatedRecords.filter(record => record.object === 'Contact');

                expect(topAccountNicknames).toHaveLength(2);
                expect(new Set(topAccountNicknames).size).toBe(2);
                expect(contacts).toHaveLength(6);
                contacts.forEach(contact => expect(topAccountNicknames).toContain(contact.fields['AccountId']));
                topAccountNicknames.forEach(accountNickname => expect(contacts.filter(contact => contact.fields['AccountId'] === accountNickname)).toHaveLength(3));
                expect(generatedRecords.filter(record => record.object === 'Case')).toHaveLength(6);
                expect(generatedRecords.filter(record => record.object === 'Opportunity')).toHaveLength(2);

            } finally {
                fs.rmSync(path.dirname(recipeFilePath), { recursive: true, force: true });
            }

        });

        PythonTestHarness.testRequiringModules('yaml')('loads a snowfakery copy in PyYAML, snowfakery\'s parser, with the count set', () => {

            const filtered = expectFiltered(filterWithCounts(readFixture(SNOWFAKERY_FIXTURE), new Map([['Contact', 5], ['Account', 12]])));

            const [loadedRecipe] = PythonTestHarness.loadWithPyYaml([filtered.recipeText]) as Array<Array<{ object: string; count?: unknown }>>;

            expect(loadedRecipe.find(entry => entry.object === 'Contact')?.count).toBe(5);
            expect(loadedRecipe.find(entry => entry.object === 'Account')?.count).toBe(12);
            expect(loadedRecipe.filter(entry => !['Contact', 'Account'].includes(entry.object)).every(entry => entry.count === 1)).toBeTrue();

        });

    });

});

describe('RecipeCockpitService -- record counts (#255)', () => {

    describe('readTreeSelections and writeTreeSelections', () => {

        it('writes the current version with a folder and an object named __proto__ as keys, and reads back every api name', async () => {

            const workspaceState = buildWorkspaceState();
            const treeSelections = {
                excludedObjectApiNamesByFolderName: new Map<string, Set<string>>(),
                excludedFieldApiNamesByFolderName: new Map<string, Map<string, Set<string>>>(),
                objectCountsByFolderName: new Map([
                    [ACCOUNT_TREE_KEY, new Map([['Contact', 4], ['__proto__', 9]])],
                    ['__proto__', new Map([['Lead', 3]])]
                ]),
                fixedValuesByFolderName: new Map(),
                validationRulesOffByFolderName: new Map()
            };

            await expect(RecipeCockpitService.writeTreeSelections(workspaceState, treeSelections)).resolves.toBeTrue();

            const stored = workspaceState.storedValues.get(RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY) as any;
            expect(stored.version).toBe(RECIPE_COCKPIT_OBJECT_SELECTION_VERSION);
            expect(RECIPE_COCKPIT_OBJECT_SELECTION_VERSION).toBe(7);
            expect(Object.keys(stored.objectCountsByFolderName)).toEqual([ACCOUNT_TREE_KEY, '__proto__']);
            expect(Object.keys(stored.objectCountsByFolderName[ACCOUNT_TREE_KEY])).toEqual(['Contact', '__proto__']);

            // __proto__ IS NO OBJECT API NAME, SO READING IT BACK DROPS IT -- AS A KEY, NEVER AS A PROTOTYPE
            const readBack = RecipeCockpitService.readTreeSelections(workspaceState);
            expect(readBack.objectCountsByFolderName).toEqual(new Map([
                [ACCOUNT_TREE_KEY, new Map([['Contact', 4]])],
                ['__proto__', new Map([['Lead', 3]])]
            ]));

        });

        it('drops every count that is not a whole number of one or more, and every name that is not an api name', () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({
                [ACCOUNT_TREE_KEY]: {
                    Account: 0, Contact: '5', Lead: 2.5, Task: -1, Event: 1e300, Case: Number.MAX_SAFE_INTEGER + 1, Opportunity: null,
                    'Bad Name': 4, 'Smuggled\n- object: X': 4, OtherChildObject__c: 3
                },
                [LEAD_TREE_KEY]: [3],
                '': { Lead: 3 },
                'Empty-Folder': { Lead: 0 }
            }) });

            expect(RecipeCockpitService.readTreeSelections(workspaceState).objectCountsByFolderName)
                .toEqual(new Map([[ACCOUNT_TREE_KEY, new Map([['OtherChildObject__c', 3]])]]));

        });

        it.each([
            ['version 2', RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_COUNTS],
            ['version 1', RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_FIELDS]
        ])('reads a %s entry as no counts, keeping its objects', (_caseName, version) => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: {
                version: version,
                excludedObjectApiNamesByFolderName: { [ACCOUNT_TREE_KEY]: ['Contact'] },
                excludedFieldApiNamesByFolderName: {},
                objectCountsByFolderName: { [ACCOUNT_TREE_KEY]: { Account: 4 } }
            } });

            const treeSelections = RecipeCockpitService.readTreeSelections(workspaceState);

            expect(treeSelections.objectCountsByFolderName.size).toBe(0);
            expect(treeSelections.excludedObjectApiNamesByFolderName).toEqual(new Map([[ACCOUNT_TREE_KEY, new Set(['Contact'])]]));

        });

        it('keeps the stored counts when #219\'s writeObjectSelections writes the objects', async () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({ [ACCOUNT_TREE_KEY]: { Contact: 4 } }) });

            await RecipeCockpitService.writeObjectSelections(workspaceState, new Map([[ACCOUNT_TREE_KEY, new Set(['OtherChildObject__c'])]]));

            expect(workspaceState.storedValues.get(RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY))
                .toEqual(storedSelections({ [ACCOUNT_TREE_KEY]: { Contact: 4 } }, { [ACCOUNT_TREE_KEY]: ['OtherChildObject__c'] }));

        });

    });

    describe('loading the recipe', () => {

        it('carries each object\'s own count, and the parent a nested friend\'s count is per', () => {

            const recipeEntries = RecipeCockpitService.parseRecipeSource(readFixture(SELF_LOOKUP_FRIENDS_FIXTURE));

            expect(recipeEntries.get('Account')).toMatchObject({ recordCount: 2 });
            expect(recipeEntries.get('Account')?.countParentObjectApiName).toBeUndefined();
            expect(recipeEntries.get('Contact')).toMatchObject({ recordCount: 2, countParentObjectApiName: 'Account' });
            expect(recipeEntries.get('Case')).toMatchObject({ recordCount: 1, countParentObjectApiName: 'Contact' });
            expect(recipeEntries.get('Lead')).toMatchObject({ recordCount: 1 });

        });

        it('puts recordCount on the object view model of a flat recipe, with no parent', () => {

            const recipe = loadRecipe();

            expect(['Account', 'Contact', 'OtherChildObject__c', 'Lead'].map(objectApiName => objectOf(recipe, objectApiName).recordCount)).toEqual([1, 1, 1, 1]);
            expect(recipe.objects.every(objectViewModel => objectViewModel.countParentObjectApiName === undefined)).toBeTrue();

        });

    });

    describe('buildTreeObjectCounts and applyObjectSelections', () => {

        it('sets tree.objectCounts only for a stored count that differs from the recipe\'s own, on the card of its folder', () => {

            const recipe = loadRecipe();
            applyCounts(recipe, {
                [ACCOUNT_TREE_KEY]: { Account: 4, Contact: 1, NotInTree__c: 9, Lead: 3 },
                [LEAD_TREE_KEY]: { Lead: 1 }
            });

            expect(treeOf(recipe, ACCOUNT_TREE_KEY).objectCounts).toEqual([{ objectApiName: 'Account', count: 4 }]);
            expect(treeOf(recipe, LEAD_TREE_KEY)).not.toHaveProperty('objectCounts');

        });

        it('posts the same tree model as before when no count differs from the recipe\'s own', () => {

            const untouched = loadRecipe();
            const applied = loadRecipe();
            RecipeCockpitService.applyObjectSelections(untouched, new Map(), new Map());
            applyCounts(applied, { [ACCOUNT_TREE_KEY]: { Account: 1, Contact: 1, OtherChildObject__c: 1 }, [LEAD_TREE_KEY]: { Lead: 1 } });

            applied.trees.forEach(tree => expect(tree).not.toHaveProperty('objectCounts'));
            expect(JSON.stringify(applied.trees)).toBe(JSON.stringify(untouched.trees));

        });

        it('drops a count it set before once the store no longer differs', () => {

            const recipe = loadRecipe();
            applyCounts(recipe, { [ACCOUNT_TREE_KEY]: { Contact: 5 } });
            expect(treeOf(recipe, ACCOUNT_TREE_KEY).objectCounts).toEqual([{ objectApiName: 'Contact', count: 5 }]);

            applyCounts(recipe, {});
            expect(treeOf(recipe, ACCOUNT_TREE_KEY)).not.toHaveProperty('objectCounts');

        });

        it('sets no count on a card with no folder, or for an object with no readable count', () => {

            const recipe = loadRecipe();
            recipe.trees.push({ treeKey: '', title: RECIPE_COCKPIT_UNGROUPED_TREE_TITLE, folderName: '', objects: [{ objectApiName: 'Lead', parentLookups: [] }], fieldCount: 2 });
            delete objectOf(recipe, 'Contact').recordCount;

            applyCounts(recipe, { '': { Lead: 5 }, [ACCOUNT_TREE_KEY]: { Contact: 5 } });

            expect(treeOf(recipe, '')).not.toHaveProperty('objectCounts');
            expect(treeOf(recipe, ACCOUNT_TREE_KEY)).not.toHaveProperty('objectCounts');

        });

        it('keeps an excluded object\'s stored count on the card, and leaves it out of what is generated', () => {

            const recipe = loadRecipe();
            applyCounts(recipe, { [ACCOUNT_TREE_KEY]: { Contact: 5, Account: 2 } }, { [ACCOUNT_TREE_KEY]: ['Contact'] });
            const accountTree = treeOf(recipe, ACCOUNT_TREE_KEY);

            expect(accountTree.objectCounts).toEqual([{ objectApiName: 'Account', count: 2 }, { objectApiName: 'Contact', count: 5 }]);
            expect(RecipeCockpitService.listObjectCountsByObject(accountTree)).toEqual(new Map([['Account', 2]]));

            // RE-INCLUDED, ITS COUNT COMES BACK
            applyCounts(recipe, { [ACCOUNT_TREE_KEY]: { Contact: 5, Account: 2 } });
            expect(RecipeCockpitService.listObjectCountsByObject(treeOf(recipe, ACCOUNT_TREE_KEY))).toEqual(new Map([['Account', 2], ['Contact', 5]]));
            expect(RecipeCockpitService.listObjectCountsByObject(undefined)).toEqual(new Map());

        });

        it('builds the Run Faker copy with the counts that differ, and names them for the data set', () => {

            const recipe = loadRecipe();
            applyCounts(recipe, { [ACCOUNT_TREE_KEY]: { Contact: 5 } });

            const filteredRecipe = RecipeCockpitService.buildRunFakerFilteredRecipe(fs.readFileSync(ACCOUNT_RECIPE_FILE_PATH, 'utf8'), treeOf(recipe, ACCOUNT_TREE_KEY), undefined, recipe);

            if ( 'refusalMessage' in filteredRecipe ) {
                throw new Error(filteredRecipe.refusalMessage);
            }
            expect(filteredRecipe.objectCountsByObject).toEqual({ Contact: 5 });
            expect(filteredRecipe.excludedObjectApiNames).toEqual([]);
            expect(filteredRecipe).not.toHaveProperty('excludedFieldApiNamesByObject');
            expect(readOccurrences(filteredRecipe.recipeText).find(occurrence => occurrence.objectApiName === 'Contact')?.count).toBe(5);

        });

    });

    describe('routePanelMessage setObjectCount', () => {

        const buildDrawnPanelState = (recipeChanges: (recipe: IRecipeCockpitRecipeViewModel) => void = () => undefined): IRecipeCockpitPanelState => {
            const panelState = RecipeCockpitService.buildInitialPanelState(HISTORY_WORKSPACE_ROOT);
            const recipe = loadRecipe();
            recipe.trees.push({ treeKey: '', title: RECIPE_COCKPIT_UNGROUPED_TREE_TITLE, folderName: '', objects: [{ objectApiName: 'Lead', parentLookups: [] }], fieldCount: 2 });
            recipeChanges(recipe);
            panelState.recipeDataMessage = { command: 'recipeData', recipe: recipe, renderSequence: 4 };
            panelState.treeHistoryAllowLists = RecipeCockpitService.collectTreeHistoryAllowLists(recipe);
            return panelState;
        };

        const route = (payload: Record<string, unknown>, panelState = buildDrawnPanelState()) => RecipeCockpitService.routePanelMessage({ command: 'setObjectCount', ...payload } as any, panelState);

        it('routes a drawn object\'s count to its folder', () => {

            expect(route({ treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', count: 6 }))
                .toEqual({ kind: 'setObjectCount', treeKey: ACCOUNT_TREE_KEY, folderName: ACCOUNT_TREE_KEY, objectApiName: 'Contact', count: 6 });
            expect(route({ treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', count: Number.MAX_SAFE_INTEGER }))
                .toEqual({ kind: 'setObjectCount', treeKey: LEAD_TREE_KEY, folderName: LEAD_TREE_KEY, objectApiName: 'Lead', count: Number.MAX_SAFE_INTEGER });

        });

        it('routes a count back to the recipe\'s own, which the executor clears', () => {

            expect(route({ treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', count: 1 })).toMatchObject({ kind: 'setObjectCount', count: 1 });

        });

        it('accepts the nickname the object is drawn with', () => {

            const panelState = buildDrawnPanelState(recipe => { objectOf(recipe, 'Account').nickname = 'Account_NickName'; });

            expect(route({ treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', nickname: 'Account_NickName', count: 3 }, panelState)).toMatchObject({ kind: 'setObjectCount', objectApiName: 'Account', count: 3 });
            expect(route({ treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', nickname: 'Other_NickName', count: 3 }, panelState)).toBeUndefined();

        });

        it.each([
            ['a count string', { count: '5' }],
            ['a padded count string', { count: ' 5 ' }],
            ['an exponent string', { count: '1e2' }],
            ['zero', { count: 0 }],
            ['a negative count', { count: -1 }],
            ['a fraction', { count: 2.5 }],
            ['NaN', { count: NaN }],
            ['a count past MAX_SAFE_INTEGER', { count: Number.MAX_SAFE_INTEGER + 1 }],
            ['no count', {}],
            ['an object of another card', { treeKey: LEAD_TREE_KEY, objectApiName: 'Contact', count: 3 }],
            ['an object no card draws', { objectApiName: 'Task', count: 3 }],
            ['a key that is not a string', { treeKey: 7, count: 3 }],
            ['an object name that is a line of YAML', { objectApiName: 'Contact\n- object: Evil', count: 3 }],
            ['a nickname the object is not drawn with', { nickname: 'Contact_NickName', count: 3 }],
            ['a nickname that is not a string', { nickname: 7, count: 3 }],
            ['the ungrouped card, which has no folder', { treeKey: '', objectApiName: 'Lead', count: 3 }]
        ])('does nothing for %s', (_caseName, payload) => {

            expect(route({ treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', ...payload })).toBeUndefined();

        });

        it('does nothing for an object drawn with no count box', () => {

            const panelState = buildDrawnPanelState(recipe => { delete objectOf(recipe, 'Contact').recordCount; });

            expect(route({ treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', count: 3 }, panelState)).toBeUndefined();

        });

        it('does nothing for an excluded or auto-excluded object', () => {

            const panelState = buildDrawnPanelState(recipe => applyCounts(recipe, {}, { [ACCOUNT_TREE_KEY]: ['Contact'] }));

            expect(route({ treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', count: 3 }, panelState)).toBeUndefined();
            expect(route({ treeKey: ACCOUNT_TREE_KEY, objectApiName: 'OtherChildObject__c', count: 3 }, panelState)).toBeUndefined();
            expect(route({ treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', count: 3 }, panelState)).toMatchObject({ kind: 'setObjectCount' });

        });

        it('does nothing before "rendered", after "ready" or a failure to draw, or with no model', () => {

            const undrawnPanelState = buildDrawnPanelState();
            undrawnPanelState.treeHistoryAllowLists = RecipeCockpitService.buildEmptyTreeHistoryAllowLists();
            const modelLessPanelState = buildDrawnPanelState();
            modelLessPanelState.recipeDataMessage = undefined;

            expect(route({ treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', count: 3 }, undrawnPanelState)).toBeUndefined();
            expect(route({ treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', count: 3 }, modelLessPanelState)).toBeUndefined();

        });

    });

    describe('openRecipeCockpitPanel', () => {

        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let disposeHandler: (() => void) | undefined;
        let postedPanelMessages: any[];

        const lastPosted = (command: string) => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === command);
        const executeCommand = vscode.commands.executeCommand as jest.Mock;
        const showWarningMessage = vscode.window.showWarningMessage as jest.Mock;

        const buildWebviewPanel = () => ({
            reveal: jest.fn(),
            dispose: jest.fn(),
            onDidDispose: jest.fn().mockImplementation((handler: () => void) => { disposeHandler = handler; return { dispose: jest.fn() }; }),
            webview: {
                html: '',
                postMessage: jest.fn().mockImplementation((hostMessage: any) => { postedPanelMessages.push(hostMessage); return Promise.resolve(true); }),
                onDidReceiveMessage: jest.fn().mockImplementation((messageHandler: (panelMessage: any) => Promise<void>) => {
                    receivedMessageHandler = messageHandler;
                    return { dispose: jest.fn() };
                })
            }
        });

        const openAndDraw = async (workspaceState: ReturnType<typeof buildWorkspaceState>) => {
            await RecipeCockpitService.openRecipeCockpitPanel(HISTORY_WORKSPACE_ROOT, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            const recipeDataMessage = lastPosted('recipeData');
            await receivedMessageHandler({ command: 'rendered', renderSequence: recipeDataMessage.renderSequence });
            return recipeDataMessage;
        };

        const storedOf = (workspaceState: ReturnType<typeof buildWorkspaceState>) => workspaceState.storedValues.get(RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY);

        beforeEach(() => {
            postedPanelMessages = [];
            executeCommand.mockReset();
            showWarningMessage.mockReset();
            (vscode.window.createWebviewPanel as jest.Mock).mockImplementation(() => buildWebviewPanel());
            jest.spyOn(VSCodeWorkspaceService, 'createStatusBarPhaseItem').mockImplementation((initialMessage: string) => ({ text: initialMessage, dispose: jest.fn() }) as any);
        });

        afterEach(() => {
            disposeHandler?.();
            disposeHandler = undefined;
        });

        it('stores a count, posts it back in place, and clears it once set back to the recipe\'s own; the recipe file never changes', async () => {

            const recipeBefore = fs.readFileSync(ACCOUNT_RECIPE_FILE_PATH, 'utf8');
            const workspaceState = buildWorkspaceState();
            const recipeDataMessage = await openAndDraw(workspaceState);

            await receivedMessageHandler({ command: 'setObjectCount', treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', count: 4 });

            expect(storedOf(workspaceState)).toEqual(storedSelections({ [LEAD_TREE_KEY]: { Lead: 4 } }));
            expect(lastPosted('objectSelection')).toEqual({
                command: 'objectSelection',
                renderSequence: recipeDataMessage.renderSequence,
                treeKey: LEAD_TREE_KEY,
                objectCounts: [{ objectApiName: 'Lead', count: 4 }]
            });

            // A REVEAL REPLAYS THE STORED MODEL, WHICH CARRIES THE COUNT
            postedPanelMessages = [];
            await receivedMessageHandler({ command: 'ready' });
            expect(treeOf(lastPosted('recipeData').recipe, LEAD_TREE_KEY).objectCounts).toEqual([{ objectApiName: 'Lead', count: 4 }]);
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastPosted('recipeData').renderSequence });

            await receivedMessageHandler({ command: 'setObjectCount', treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', count: 1 });

            expect(storedOf(workspaceState)).toEqual(storedSelections({}));
            expect(lastPosted('objectSelection')).toEqual({ command: 'objectSelection', renderSequence: expect.any(Number), treeKey: LEAD_TREE_KEY });
            expect(fs.readFileSync(ACCOUNT_RECIPE_FILE_PATH, 'utf8')).toBe(recipeBefore);

        });

        it('writes nothing for a forged key or count', async () => {

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);
            workspaceState.update.mockClear();

            await receivedMessageHandler({ command: 'setObjectCount', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', count: '5' });
            await receivedMessageHandler({ command: 'setObjectCount', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', count: 0 });
            await receivedMessageHandler({ command: 'setObjectCount', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Task', count: 5 });
            await receivedMessageHandler({ command: 'setObjectCount', treeKey: 'Forged-Folder', objectApiName: 'Contact', count: 5 });

            expect(workspaceState.update).not.toHaveBeenCalled();
            expect(lastPosted('objectSelection')).toBeUndefined();

        });

        it('runs a card with a count on a filtered copy that carries it, and never writes the recipe', async () => {

            const recipeBefore = fs.readFileSync(ACCOUNT_RECIPE_FILE_PATH, 'utf8');
            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);
            await receivedMessageHandler({ command: 'setObjectCount', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', count: 4 });

            await receivedMessageHandler({ command: 'generateTree', treeKey: ACCOUNT_TREE_KEY });

            const runFakerCall = executeCommand.mock.calls.find(call => call[0] === RECIPE_COCKPIT_RUN_FAKER_COMMAND);
            expect(runFakerCall).toHaveLength(3);
            expect(runFakerCall?.[1]).toBe(ACCOUNT_RECIPE_FILE_PATH);
            expect(runFakerCall?.[2]).toMatchObject({ excludedObjectApiNames: [], objectCountsByObject: { Contact: 4 } });
            expect(readOccurrences(runFakerCall?.[2].recipeText).map(occurrence => [occurrence.objectApiName, occurrence.count])).toEqual([['Account', 1], ['Contact', 4], ['OtherChildObject__c', 1]]);
            expect(fs.readFileSync(ACCOUNT_RECIPE_FILE_PATH, 'utf8')).toBe(recipeBefore);

        });

        it('runs a card with no stored count on its recipe exactly as before, with no filtered copy', async () => {

            const recipeDataMessage = await openAndDraw(buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({ [ACCOUNT_TREE_KEY]: { Contact: 1 } }) }));

            recipeDataMessage.recipe.trees.forEach((tree: IRecipeCockpitTreeViewModel) => expect(tree).not.toHaveProperty('objectCounts'));

            await receivedMessageHandler({ command: 'generateTree', treeKey: ACCOUNT_TREE_KEY });

            expect(executeCommand.mock.calls.find(call => call[0] === RECIPE_COCKPIT_RUN_FAKER_COMMAND)).toEqual([RECIPE_COCKPIT_RUN_FAKER_COMMAND, ACCOUNT_RECIPE_FILE_PATH]);

        });

        it('Reset clears the folder\'s counts after a modal that says so, and leaves the other folder\'s', async () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({ [ACCOUNT_TREE_KEY]: { Contact: 4 }, [LEAD_TREE_KEY]: { Lead: 3 } }) });
            await openAndDraw(workspaceState);

            showWarningMessage.mockResolvedValueOnce(RECIPE_COCKPIT_RESET_SELECTION_CONFIRM_LABEL);
            await receivedMessageHandler({ command: 'resetTreeSelection', treeKey: ACCOUNT_TREE_KEY });

            expect(showWarningMessage).toHaveBeenCalledTimes(1);
            expect(showWarningMessage.mock.calls[0][1]).toMatchObject({ modal: true });
            expect(showWarningMessage.mock.calls[0][1].detail).toBe('Every object is included, every field is ticked, every record count goes back to the recipe\'s own again and every validation rule is applied again. The recipe file is not changed, so an edit written into it stays: clear it with its field\'s edit button.');
            expect(storedOf(workspaceState)).toEqual(storedSelections({ [LEAD_TREE_KEY]: { Lead: 3 } }));
            expect(lastPosted('objectSelection').treeKey).toBe(ACCOUNT_TREE_KEY);
            expect(lastPosted('objectSelection')).not.toHaveProperty('objectCounts');

        });

    });

    describe('the panel script', () => {

        const drawRecipe = (recipeChanges: (recipe: IRecipeCockpitRecipeViewModel) => void = () => undefined) => {
            const panel = runPanelScript();
            const recipe = loadRecipe();
            recipe.trees.push({ treeKey: '', title: RECIPE_COCKPIT_UNGROUPED_TREE_TITLE, folderName: '', objects: [{ objectApiName: 'Lead', parentLookups: [] }], fieldCount: 2 });
            recipeChanges(recipe);
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 3 });
            panel.postToPanel({ command: 'loadPhase', message: '' });
            panel.expandAllTrees();
            return panel;
        };

        type Panel = ReturnType<typeof runPanelScript>;
        const objectsNamed = (panel: Panel, objectApiName: string) => panel.objectElements().filter(objectElement => panel.objectNameOf(objectElement) === objectApiName);
        const objectNamed = (panel: Panel, objectApiName: string) => objectsNamed(panel, objectApiName)[0];
        const headerOf = (objectElement: any) => objectElement.children[0];
        const countBoxOf = (panel: Panel, objectElement: any) => panel.findAll(headerOf(objectElement), 'treeRecordCountInput')[0];
        const countLabelOf = (panel: Panel, objectElement: any) => panel.findAll(headerOf(objectElement), 'treeRecordCountLabel')[0];
        const countErrorOf = (panel: Panel, objectElement: any) => panel.findAll(headerOf(objectElement), 'treeRecordCountError')[0];
        const typeCount = (countBoxElement: any, countText: string) => { countBoxElement.value = countText; countBoxElement.dispatch('change'); };
        const postedCounts = (panel: Panel) => panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'setObjectCount');

        it('draws a count box right of the object name, starting at the recipe\'s own count', () => {

            const panel = drawRecipe();
            const contact = objectNamed(panel, 'Contact');
            const headerChildren = headerOf(contact).children;
            const nameIndex = headerChildren.findIndex((childElement: any) => panel.findAll(childElement, 'treeObjectName').length > 0);
            const countBox = countBoxOf(panel, contact);

            expect(nameIndex).toBeGreaterThanOrEqual(0);
            expect(headerChildren[nameIndex + 1].classList.contains('treeRecordCount')).toBeTrue();
            expect(countBox.tagName).toBe('input');
            expect(countBox.attributes.type).toBe('text');
            expect(countBox.attributes.inputmode).toBe('numeric');
            expect(countBox.value).toBe('1');
            expect(countBox.disabled).toBeFalse();
            expect(panel.isHidden(countErrorOf(panel, contact))).toBeTrue();

        });

        it('labels a nested friend\'s count "per <Parent>", and a root\'s as records', () => {

            const panel = drawRecipe(recipe => { objectOf(recipe, 'Contact').countParentObjectApiName = 'Account'; });

            expect(countLabelOf(panel, objectNamed(panel, 'Contact')).textContent).toBe('per Account');
            expect(countBoxOf(panel, objectNamed(panel, 'Contact')).attributes['aria-label']).toBe('Contact records per Account record');
            expect(countLabelOf(panel, objectNamed(panel, 'Account')).textContent).toBe('records');
            expect(countLabelOf(panel, objectNamed(panel, 'Account')).textContent).not.toContain('per');

        });

        it.each([
            ['zero', '0'],
            ['a negative count', '-1'],
            ['a fraction', '2.5'],
            ['an exponent', '1e2'],
            ['nothing', ''],
            ['a padded count', ' 5 '],
            ['a count past MAX_SAFE_INTEGER', '9007199254740993'],
            ['a leading zero', '05']
        ])('refuses %s with the reason on the row, and posts nothing', (_caseName, countText) => {

            const panel = drawRecipe();
            const contact = objectNamed(panel, 'Contact');

            typeCount(countBoxOf(panel, contact), countText);

            expect(postedCounts(panel)).toEqual([]);
            expect(countErrorOf(panel, contact).textContent).toBe('Enter a whole number of 1 or more.');
            expect(panel.isHidden(countErrorOf(panel, contact))).toBeFalse();

        });

        it('posts a valid count as names and a number, clearing an earlier refusal', () => {

            const panel = drawRecipe();
            const contact = objectNamed(panel, 'Contact');

            typeCount(countBoxOf(panel, contact), '0');
            typeCount(countBoxOf(panel, contact), '25');

            expect(postedCounts(panel)).toEqual([{ command: 'setObjectCount', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', count: 25 }]);
            expect(panel.isHidden(countErrorOf(panel, contact))).toBeTrue();

        });

        it('carries the nickname of an object drawn with one, and posts nothing for its current count', () => {

            const panel = drawRecipe(recipe => { objectOf(recipe, 'Account').nickname = 'Account_NickName'; });
            const account = objectNamed(panel, 'Account');

            typeCount(countBoxOf(panel, account), '1');
            typeCount(countBoxOf(panel, account), '3');

            expect(postedCounts(panel)).toEqual([{ command: 'setObjectCount', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', nickname: 'Account_NickName', count: 3 }]);

        });

        it('draws no count box on the ungrouped card, for an object written twice with no nickname, an iteration, or an object with no readable count', () => {

            const panel = drawRecipe(recipe => {
                objectOf(recipe, 'Contact').hasIndistinctOccurrences = true;
                delete objectOf(recipe, 'OtherChildObject__c').recordCount;
                const account = objectOf(recipe, 'Account');
                account.nickname = 'Account_NickName';
                account.iterations = [{ nickname: 'Account_child_NickName', lineNumber: 40, parentObjectApiName: 'Account', parentNickname: 'Account_NickName', fields: [] }];
                treeOf(recipe, ACCOUNT_TREE_KEY).objects.push({ objectApiName: 'Account', parentLookups: [], iterationNickname: 'Account_child_NickName' });
            });

            const accounts = objectsNamed(panel, 'Account');
            expect(accounts).toHaveLength(2);
            expect(countBoxOf(panel, accounts[0])).toBeDefined();
            expect(countBoxOf(panel, accounts[1])).toBeUndefined();
            expect(countBoxOf(panel, objectNamed(panel, 'Contact'))).toBeUndefined();
            expect(countBoxOf(panel, objectNamed(panel, 'OtherChildObject__c'))).toBeUndefined();

            const leads = objectsNamed(panel, 'Lead');
            expect(leads).toHaveLength(2);
            expect(leads.map(leadElement => countBoxOf(panel, leadElement) === undefined).sort()).toEqual([false, true]);

        });

        it('disables the box of an excluded object, and shows its stored count again once re-included', () => {

            const panel = drawRecipe(recipe => applyCounts(recipe, { [ACCOUNT_TREE_KEY]: { Contact: 5 } }, { [ACCOUNT_TREE_KEY]: ['Contact'] }));
            panel.postToPanel({ command: 'rendered' });
            const contact = objectNamed(panel, 'Contact');

            expect(countBoxOf(panel, contact).disabled).toBeTrue();
            expect(countBoxOf(panel, objectNamed(panel, 'OtherChildObject__c')).disabled).toBeTrue();
            expect(countBoxOf(panel, objectNamed(panel, 'Account')).disabled).toBeFalse();
            expect(countBoxOf(panel, contact).value).toBe('5');

            panel.postToPanel({ command: 'objectSelection', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3, objectCounts: [{ objectApiName: 'Contact', count: 5 }] });

            expect(countBoxOf(panel, contact).disabled).toBeFalse();
            expect(countBoxOf(panel, contact).value).toBe('5');

        });

        it('follows tree.objectCounts from an objectSelection message for the model on screen, and shows Reset while a count differs', () => {

            const panel = drawRecipe();
            panel.postToPanel({ command: 'rendered' });
            const contact = objectNamed(panel, 'Contact');
            const resetElement = panel.findAll(panel.treeCards()[0], 'treeResetSelection')[0];
            expect(panel.isHidden(resetElement)).toBeTrue();

            panel.postToPanel({ command: 'objectSelection', treeKey: ACCOUNT_TREE_KEY, renderSequence: 99, objectCounts: [{ objectApiName: 'Contact', count: 7 }] });
            expect(countBoxOf(panel, contact).value).toBe('1');

            panel.postToPanel({ command: 'objectSelection', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3, objectCounts: [{ objectApiName: 'Contact', count: 7 }] });
            expect(countBoxOf(panel, contact).value).toBe('7');
            expect(panel.isHidden(resetElement)).toBeFalse();

            // AN UNCHANGED COUNT POSTS NOTHING; THE HOST'S STORE IS WHAT THE BOX SHOWS
            typeCount(countBoxOf(panel, contact), '7');
            expect(postedCounts(panel)).toEqual([]);

            panel.postToPanel({ command: 'objectSelection', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3 });
            expect(countBoxOf(panel, contact).value).toBe('1');
            expect(panel.isHidden(resetElement)).toBeTrue();

        });

    });

});
