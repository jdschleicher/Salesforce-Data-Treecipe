import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as path from 'path';

import { RecipeCockpitRecipeWriter, RecipeFilterResult, IRecipeFilterLookup } from '../RecipeCockpitRecipeWriter';
import { RecipeCockpitFixedValueStore, IFixedValueEntry } from '../RecipeCockpitFixedValueStore';
import { SalesforceApiName } from '../../RecipeService/SalesforceApiName';

jest.mock('vscode', () => ({ window: {}, workspace: {}, Uri: {} }), { virtual: true });

/*
    The writer's half of #467: a setting kept for ONE occurrence of an object -- the self-lookup
    iteration, a friend added under it, a record type block -- reaches only that occurrence. The
    filtered copy takes an occurrence key ("<Object>\n<Nickname>") beside an object's, and an
    occurrence takes its own key's entry over its object's; a pin given a nickname writes, and its
    Clear puts back, that one occurrence only.
*/

const FIXTURE_TEXT = fs.readFileSync(path.join(__dirname, 'mocks', 'recipeWriter', 'recipe-fakerjs-selfLookupFriends--RelationshipTree_1.yml'), 'utf8');
const ITERATION_NICKNAME = 'Account_child_NickName';
const ITERATION_KEY = RecipeCockpitRecipeWriter.buildOccurrenceKey('Account', ITERATION_NICKNAME);
const LOOKUPS = new Map<string, IRecipeFilterLookup[]>([
    ['Account', [{ fieldApiName: 'ParentId', parentObjectApiName: 'Account' }]],
    ['Contact', [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }]]
]);

const expectFiltered = (result: RecipeFilterResult) => {
    if ( 'refusal' in result ) {
        throw new Error(result.refusal.message);
    }
    return result;
};

// EACH OCCURRENCE OF Account IN THE COPY, BY NICKNAME: ITS FIELDS AND ITS COUNT
const readAccounts = (recipeText: string) => {
    const { lines } = RecipeCockpitRecipeWriter.splitRecipeLines(recipeText);
    return RecipeCockpitRecipeWriter.scanRecipeObjects(lines)
        .filter(scannedObject => scannedObject.objectApiName === 'Account')
        .map(scannedObject => ({
            nickname: scannedObject.nicknames[0],
            count: RecipeCockpitRecipeWriter.readObjectCount(lines, scannedObject),
            fields: scannedObject.fields.map(scannedField => lines[scannedField.startIndex].trim())
        }));
};

describe('RecipeCockpitRecipeWriter, a setting for one occurrence (#467)', () => {

    describe('occurrence keys', () => {

        it('builds and reads "<Object>\\n<Nickname>", and the bare object api name without one', () => {

            expect(ITERATION_KEY).toBe(`Account\n${ITERATION_NICKNAME}`);
            expect(RecipeCockpitRecipeWriter.buildOccurrenceKey('Account')).toBe('Account');
            expect(RecipeCockpitRecipeWriter.parseOccurrenceKey(ITERATION_KEY)).toEqual({ objectApiName: 'Account', nickname: ITERATION_NICKNAME });
            expect(RecipeCockpitRecipeWriter.parseOccurrenceKey('Account')).toEqual({ objectApiName: 'Account' });

        });

        it.each([
            ['Account', true],
            [ITERATION_KEY, true],
            ['Account\nnot a name', false],
            ['Account\nA\nB', false],
            ['Account Contact', false],
            ['', false]
        ])('holds %j to an api name and at most one api-name nickname: %s', (candidate, isKey) => {
            expect(RecipeCockpitRecipeWriter.isOccurrenceKey(candidate)).toBe(isKey);
        });

    });

    describe('buildFilteredRecipe', () => {

        it('leaves an unticked field out of the iteration only, and names the occurrence in its header', () => {

            const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(FIXTURE_TEXT, {
                excludedObjectApiNames: [],
                parentLookupsByObjectApiName: LOOKUPS,
                excludedFieldApiNamesByObject: new Map([[ITERATION_KEY, ['Name']]])
            }));

            expect(readAccounts(filtered.recipeText)).toEqual([
                { nickname: 'Account_NickName', count: 2, fields: ['Name: ${{ faker.company.name() }}', 'ParentId: ### TODO -- REFERENCE ID REQUIRED -- Account'] },
                { nickname: ITERATION_NICKNAME, count: 2, fields: [`ParentId: Account_NickName`] }
            ]);
            expect(filtered.droppedFields).toEqual([{ objectApiName: 'Account', nickname: ITERATION_NICKNAME, fieldApiName: 'Name' }]);
            expect(filtered.recipeText.split('\n')[0]).toBe(`# Recipe Cockpit -- a filtered copy of this tree's recipe, leaving out: fields Account (${ITERATION_NICKNAME}).Name`);

        });

        it('takes an occurrence\'s own entry over its object\'s, and the object\'s for every other occurrence', () => {

            const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(FIXTURE_TEXT, {
                excludedObjectApiNames: [],
                parentLookupsByObjectApiName: LOOKUPS,
                excludedFieldApiNamesByObject: new Map([['Account', ['Name']], [ITERATION_KEY, ['ParentId']]])
            }));

            expect(readAccounts(filtered.recipeText).map(account => account.fields)).toEqual([
                ['ParentId: ### TODO -- REFERENCE ID REQUIRED -- Account'],
                ['Name: ${{ faker.company.name() }}']
            ]);
            expect(filtered.droppedFields).toEqual([
                { objectApiName: 'Account', fieldApiName: 'Name' },
                { objectApiName: 'Account', nickname: ITERATION_NICKNAME, fieldApiName: 'ParentId' }
            ]);

        });

        it('writes an occurrence\'s count on that occurrence alone, over its object\'s count on the first', () => {

            const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(FIXTURE_TEXT, {
                excludedObjectApiNames: [],
                parentLookupsByObjectApiName: LOOKUPS,
                objectCountsByObject: new Map([['Account', 5], [ITERATION_KEY, 7]])
            }));

            expect(readAccounts(filtered.recipeText).map(account => [account.nickname, account.count])).toEqual([['Account_NickName', 5], [ITERATION_NICKNAME, 7]]);
            expect(filtered.appliedCounts).toEqual([{ objectApiName: 'Account', count: 5 }, { objectApiName: 'Account', nickname: ITERATION_NICKNAME, count: 7 }]);

        });

        it('writes a fixed value on the iteration alone', () => {

            const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(FIXTURE_TEXT, {
                excludedObjectApiNames: [],
                parentLookupsByObjectApiName: LOOKUPS,
                fixedValuesByObject: new Map([[ITERATION_KEY, new Map([['Name', { value: 'Child Co', kind: 'text' as const }]])]])
            }));

            expect(readAccounts(filtered.recipeText).map(account => account.fields[0])).toEqual(['Name: ${{ faker.company.name() }}', 'Name: "Child Co"']);
            expect(filtered.appliedFixedValues).toEqual([{ objectApiName: 'Account', nickname: ITERATION_NICKNAME, fieldApiName: 'Name', value: 'Child Co', kind: 'text' }]);

        });

        it('ignores a key for a nickname no occurrence holds, which changes nothing', () => {

            const result = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(FIXTURE_TEXT, {
                excludedObjectApiNames: [],
                parentLookupsByObjectApiName: LOOKUPS,
                objectCountsByObject: new Map([[RecipeCockpitRecipeWriter.buildOccurrenceKey('Account', 'Gone_NickName'), 9]])
            }));

            expect(result.recipeText).toBe(FIXTURE_TEXT);

        });

        it('refuses a key whose nickname is not an api name', () => {

            const result = RecipeCockpitRecipeWriter.buildFilteredRecipe(FIXTURE_TEXT, {
                excludedObjectApiNames: [],
                parentLookupsByObjectApiName: LOOKUPS,
                excludedFieldApiNamesByObject: new Map([['Account\n# injected', ['Name']]])
            });

            expect('refusal' in result && result.refusal.reason).toBe('invalid-object-api-name');

        });

    });

    describe('pinField and restorePinnedField with a nickname', () => {

        it('pins the iteration alone, and its Clear puts back exactly that occurrence', () => {

            const pinResult = RecipeCockpitRecipeWriter.pinField(FIXTURE_TEXT, 'Account', 'Name', { value: 'Child Co', kind: 'text' }, ITERATION_NICKNAME);
            if ( !pinResult.isPinned ) {
                throw new Error('expected a pin');
            }

            expect(readAccounts(pinResult.recipeText).map(account => account.fields[0])).toEqual(['Name: ${{ faker.company.name() }}', 'Name: "Child Co"']);
            expect(pinResult.occurrences.map(occurrence => [occurrence.occurrenceIndex, occurrence.nickname])).toEqual([[1, ITERATION_NICKNAME]]);

            const restoreResult = RecipeCockpitRecipeWriter.restorePinnedField(pinResult.recipeText, 'Account', 'Name', pinResult.occurrences, true);

            expect(restoreResult).toEqual({ isRestored: true, recipeText: FIXTURE_TEXT });

        });

        it('leaves another occurrence holding the same line alone on a scoped Clear', () => {

            const firstPin = RecipeCockpitRecipeWriter.pinField(FIXTURE_TEXT, 'Account', 'Name', { value: 'Same Co', kind: 'text' }, 'Account_NickName');
            if ( !firstPin.isPinned ) {
                throw new Error('expected a pin');
            }
            const secondPin = RecipeCockpitRecipeWriter.pinField(firstPin.recipeText, 'Account', 'Name', { value: 'Same Co', kind: 'text' }, ITERATION_NICKNAME);
            if ( !secondPin.isPinned ) {
                throw new Error('expected a pin');
            }

            const restoreResult = RecipeCockpitRecipeWriter.restorePinnedField(secondPin.recipeText, 'Account', 'Name', secondPin.occurrences, true);

            expect(restoreResult).toEqual({ isRestored: true, recipeText: firstPin.recipeText });

        });

        it('still puts back a copy holding the pinned line when the Clear is not scoped, as before', () => {

            const pinResult = RecipeCockpitRecipeWriter.pinField(FIXTURE_TEXT, 'Account', 'Name', { value: 'Same Co', kind: 'text' });
            if ( !pinResult.isPinned ) {
                throw new Error('expected a pin');
            }

            expect(pinResult.occurrences.map(occurrence => occurrence.nickname)).toEqual(['Account_NickName', ITERATION_NICKNAME]);
            expect(RecipeCockpitRecipeWriter.restorePinnedField(pinResult.recipeText, 'Account', 'Name', pinResult.occurrences.slice(0, 1))).toEqual({ isRestored: true, recipeText: FIXTURE_TEXT });

        });

        it('refuses a nickname no occurrence of the object holds, writing nothing', () => {

            const pinResult = RecipeCockpitRecipeWriter.pinField(FIXTURE_TEXT, 'Account', 'Name', { value: 'Child Co', kind: 'text' }, 'Contact_NickName');

            expect('refusal' in pinResult && pinResult.refusal.reason).toBe('object-not-found');

        });

    });

    describe('SalesforceApiName.isOccurrenceKey, the rule Run Faker holds a filtered copy\'s keys to', () => {

        it.each([
            ['Account', true],
            [ITERATION_KEY, true],
            ['Account\n', false],
            ['Account\nA\nB', false],
            [7, false],
            [undefined, false]
        ])('%j is %s', (candidate, isKey) => {
            expect(SalesforceApiName.isOccurrenceKey(candidate)).toBe(isKey);
        });

    });

    describe('RecipeCockpitFixedValueStore, a pin of one occurrence', () => {

        const occurrence = (occurrenceIndex: number, nickname: string, writtenLine: string, originalText?: string) => ({
            occurrenceIndex: occurrenceIndex, nickname: nickname, writtenLine: writtenLine, ...( originalText !== undefined ? { originalText: originalText } : {} )
        });
        const widerPin: IFixedValueEntry = {
            objectApiName: 'Account', fieldApiName: 'Name', value: 'Same Co',
            occurrences: [occurrence(0, 'Account_NickName', '    Name: "Same Co"', '    Name: ${{ faker.company.name() }}'), occurrence(1, ITERATION_NICKNAME, '        Name: "Same Co"', '        Name: ${{ faker.company.name() }}')]
        };
        const scopedPin = (value: string, originalText?: string): IFixedValueEntry => ({
            objectApiName: 'Account', scopeNickname: ITERATION_NICKNAME, fieldApiName: 'Name', value: value,
            occurrences: [occurrence(1, ITERATION_NICKNAME, `        Name: "${value}"`, originalText)]
        });

        it('writes and reads its scope, and keeps it apart from a pin of every occurrence of the same field', () => {

            const fileText = RecipeCockpitFixedValueStore.serialize([scopedPin('Child Co', '        Name: x'), widerPin]);
            const parsed = RecipeCockpitFixedValueStore.parse(fileText);

            expect(parsed.isUnreadable).toBe(false);
            expect(parsed.entries.map(entry => entry.scopeNickname)).toEqual([undefined, ITERATION_NICKNAME]);
            expect(JSON.parse(fileText).fields[1]).toMatchObject({ objectApiName: 'Account', scopeNickname: ITERATION_NICKNAME, fieldApiName: 'Name' });

        });

        it.each([
            ['a scope that is not an api name', { scopeNickname: 'not a name' }],
            ['a scope its one occurrence does not hold', { scopeNickname: 'Other_NickName' }],
            ['a scope over two occurrences', { scopeNickname: ITERATION_NICKNAME, occurrences: widerPin.occurrences }]
        ])('drops an entry with %s', (_label, change: { scopeNickname: string; occurrences?: unknown[] }) => {

            const fileText = RecipeCockpitFixedValueStore.serialize([scopedPin('Child Co')]).replace(`"scopeNickname": "${ITERATION_NICKNAME}"`, `"scopeNickname": ${JSON.stringify(change.scopeNickname)}`);
            const changedText = change.occurrences
                ? JSON.stringify({ ...JSON.parse(fileText), fields: [{ ...JSON.parse(fileText).fields[0], occurrences: change.occurrences }] })
                : fileText;

            expect(RecipeCockpitFixedValueStore.parse(changedText).entries).toEqual([]);

        });

        it('carves the occurrence out of a wider pin, original and all, and drops a wider pin left with none', () => {

            const carved = RecipeCockpitFixedValueStore.upsertEntry([widerPin], scopedPin('Child Co', '        Name: "Same Co"'));

            expect(carved).toEqual([
                { ...widerPin, occurrences: [widerPin.occurrences[0]] },
                scopedPin('Child Co', '        Name: ${{ faker.company.name() }}')
            ]);

            const onlyIteration: IFixedValueEntry = { ...widerPin, occurrences: [widerPin.occurrences[1]] };
            expect(RecipeCockpitFixedValueStore.upsertEntry([onlyIteration], scopedPin('Child Co', '        Name: "Same Co"')))
                .toEqual([scopedPin('Child Co', '        Name: ${{ faker.company.name() }}')]);

        });

        it('takes the pins of one occurrence into a pin of every occurrence of the same field, originals and all', () => {

            const absorbed = RecipeCockpitFixedValueStore.upsertEntry([scopedPin('Child Co', '        Name: ${{ faker.company.name() }}')], {
                objectApiName: 'Account', fieldApiName: 'Name', value: 'All Co',
                occurrences: [occurrence(0, 'Account_NickName', '    Name: "All Co"', '    Name: ${{ faker.company.name() }}'), occurrence(1, ITERATION_NICKNAME, '        Name: "All Co"', '        Name: "Child Co"')]
            });

            expect(absorbed).toEqual([{
                objectApiName: 'Account', fieldApiName: 'Name', value: 'All Co',
                occurrences: [occurrence(0, 'Account_NickName', '    Name: "All Co"', '    Name: ${{ faker.company.name() }}'), occurrence(1, ITERATION_NICKNAME, '        Name: "All Co"', '        Name: ${{ faker.company.name() }}')]
            }]);

        });

        it('finds a pin of one occurrence for an object written once since, when no wider pin holds the field', () => {
            expect(RecipeCockpitFixedValueStore.findHoldingEntry([scopedPin('Child Co')], 'Account', 'Name')).toEqual(scopedPin('Child Co'));
        });

        it('finds the entry a row holds: its own scoped pin first, else a wider one that recorded it, and removes by scope', () => {

            const entries = [widerPin, scopedPin('Child Co')];

            expect(RecipeCockpitFixedValueStore.findHoldingEntry(entries, 'Account', 'Name', ITERATION_NICKNAME)).toBe(entries[1]);
            expect(RecipeCockpitFixedValueStore.findHoldingEntry(entries, 'Account', 'Name', 'Account_NickName')).toBe(entries[0]);
            expect(RecipeCockpitFixedValueStore.findHoldingEntry(entries, 'Account', 'Name')).toBe(entries[0]);
            expect(RecipeCockpitFixedValueStore.findHoldingEntry(entries, 'Account', 'Name', 'Gone_NickName')).toBeUndefined();
            expect(RecipeCockpitFixedValueStore.removeEntry(entries, 'Account', 'Name', ITERATION_NICKNAME)).toEqual([widerPin]);

        });

        it('lists a scoped pin under its occurrence key, over a wider pin of the same occurrence, and under its object for an object written once since', () => {

            expect(RecipeCockpitFixedValueStore.listValuesByObject([scopedPin('Child Co'), widerPin])).toEqual(new Map([
                ['Account', new Map([['Name', 'Child Co']])],
                ['Account\nAccount_NickName', new Map([['Name', 'Same Co']])],
                [ITERATION_KEY, new Map([['Name', 'Child Co']])]
            ]));

        });

    });

});
