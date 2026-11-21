import { RecordTypeSelection } from '../RecordTypeSelection';
import { RecordTypeWrapper } from '../../ObjectInfoWrapper/RecordTypesWrapper';

const buildRecordTypeWrapper = (developerName: string, picklistSections: Record<string, string[]> = {}): RecordTypeWrapper => ({
    DeveloperName: developerName,
    RecordTypeId: '',
    PicklistFieldSectionsToPicklistDetail: picklistSections
});

describe('RecordTypeSelection', () => {

    describe('constructor and getDeveloperNames', () => {

        test('keeps each object\'s names in the order given, without duplicates', () => {

            const recordTypeSelection = new RecordTypeSelection([['Account', ['Partner', 'Customer', 'Partner']]]);

            expect(recordTypeSelection.getDeveloperNames('Account')).toEqual(['Partner', 'Customer']);
            expect(recordTypeSelection.getDeveloperNames('Contact')).toBeUndefined();

        });

        test('given nothing, selects nothing', () => {

            expect(new RecordTypeSelection().getDeveloperNames('Account')).toBeUndefined();

        });

    });

    describe('fromUnknown', () => {

        test.each([undefined, null, 'Account', 7, ['Account']])('given %p, answers undefined', (value) => {

            expect(RecordTypeSelection.fromUnknown(value)).toBeUndefined();

        });

        test('keeps every entry that is an array of strings and drops every other one', () => {

            const recordTypeSelection = RecordTypeSelection.fromUnknown({
                Account: ['Customer'],
                Contact: 'Partner',
                Case: ['Support', 7],
                Lead: null,
                Opportunity: []
            });

            expect(recordTypeSelection.getDeveloperNames('Account')).toEqual(['Customer']);
            expect(recordTypeSelection.getDeveloperNames('Contact')).toBeUndefined();
            expect(recordTypeSelection.getDeveloperNames('Case')).toBeUndefined();
            expect(recordTypeSelection.getDeveloperNames('Lead')).toBeUndefined();
            expect(recordTypeSelection.getDeveloperNames('Opportunity')).toEqual([]);

        });

        test('reads a parsed "__proto__" key as an object name, not as the prototype', () => {

            const recordTypeSelection = RecordTypeSelection.fromUnknown(JSON.parse('{"__proto__": ["Customer"], "Account": ["Partner"]}'));

            expect(recordTypeSelection.getDeveloperNames('__proto__')).toEqual(['Customer']);
            expect(recordTypeSelection.getDeveloperNames('Account')).toEqual(['Partner']);

        });

    });

    describe('isChildTreeCopiedPerRecordTypeBlock (#622)', () => {

        test('is off unless asked for', () => {

            expect(new RecordTypeSelection().isChildTreeCopiedPerRecordTypeBlock).toBeFalse();
            expect(new RecordTypeSelection([['Account', ['Partner']]]).isChildTreeCopiedPerRecordTypeBlock).toBeFalse();
            expect(RecordTypeSelection.fromUnknown({ Account: ['Partner'] }).isChildTreeCopiedPerRecordTypeBlock).toBeFalse();

        });

        test('is on when the constructor is handed true', () => {

            expect(new RecordTypeSelection([['Account', ['Partner']]], true).isChildTreeCopiedPerRecordTypeBlock).toBeTrue();

        });

        test('fromUnknown turns it on for true', () => {

            expect(RecordTypeSelection.fromUnknown({ Account: ['Partner'] }, true).isChildTreeCopiedPerRecordTypeBlock).toBeTrue();

        });

        test.each(['true', 1, {}, null, undefined, false])('fromUnknown leaves it off for %p, which is not exactly true', (option) => {

            expect(RecordTypeSelection.fromUnknown({ Account: ['Partner'] }, option).isChildTreeCopiedPerRecordTypeBlock).toBeFalse();

        });

    });

    describe('resolveForObject', () => {

        const writableRecordTypes = { Customer: buildRecordTypeWrapper('Customer'), Partner: buildRecordTypeWrapper('Partner') };

        test('given no selection, or none for the object, selects nothing and ignores nothing', () => {

            const nothingSelected = { selectedRecordTypeApiNames: [], ignoredDeveloperNames: [] };
            expect(RecordTypeSelection.resolveForObject(undefined, 'Account', writableRecordTypes)).toEqual(nothingSelected);
            expect(RecordTypeSelection.resolveForObject(new RecordTypeSelection([['Contact', ['Customer']]]), 'Account', writableRecordTypes)).toEqual(nothingSelected);

        });

        test('selects every writable name in the order chosen, and ignores names the object does not have', () => {

            const recordTypeSelection = new RecordTypeSelection([['Account', ['Gone', 'Partner', 'Customer']]]);

            expect(RecordTypeSelection.resolveForObject(recordTypeSelection, 'Account', writableRecordTypes)).toEqual({
                selectedRecordTypeApiNames: ['Partner', 'Customer'],
                ignoredDeveloperNames: ['Gone']
            });

        });

        test('never selects a name the map holds only through its prototype', () => {

            const recordTypeSelection = new RecordTypeSelection([['Account', ['constructor', 'toString']]]);

            expect(RecordTypeSelection.resolveForObject(recordTypeSelection, 'Account', writableRecordTypes)).toEqual({
                selectedRecordTypeApiNames: [],
                ignoredDeveloperNames: ['constructor', 'toString']
            });

        });

    });

    describe('listRecordTypeCombinations (#624)', () => {

        const names = (plan: ReturnType<typeof RecordTypeSelection.listRecordTypeCombinations>) =>
            plan.combinations.map(combination => combination.map(entry => `${entry.objectApiName} · ${entry.developerName}`).join('; '));

        it('makes one set per record type of a single object, in the order ticked', () => {
            const plan = RecordTypeSelection.listRecordTypeCombinations({ Account: ['Partner', 'Business'] }, ['Account', 'Contact'], 10);
            expect(plan.setCount).toBe(2);
            expect(plan.recordTypeCountsByObject).toEqual([{ objectApiName: 'Account', recordTypeCount: 2 }]);
            expect(names(plan)).toEqual(['Account · Partner', 'Account · Business']);
        });

        it('makes every combination of two objects, in the tree\'s order, the first object changing slowest', () => {
            const plan = RecordTypeSelection.listRecordTypeCombinations({ Opportunity: ['New', 'Renewal'], Account: ['Business', 'Partner'] }, ['Account', 'Contact', 'Opportunity'], 10);
            expect(plan.setCount).toBe(4);
            expect(names(plan)).toEqual([
                'Account · Business; Opportunity · New', 'Account · Business; Opportunity · Renewal',
                'Account · Partner; Opportunity · New', 'Account · Partner; Opportunity · Renewal'
            ]);
        });

        it('makes 2 sets for Account {Business, Partner} × Opportunity {New}', () => {
            const plan = RecordTypeSelection.listRecordTypeCombinations({ Account: ['Business', 'Partner'], Opportunity: ['New'] }, ['Account', 'Opportunity'], 10);
            expect(names(plan)).toEqual(['Account · Business; Opportunity · New', 'Account · Partner; Opportunity · New']);
        });

        it('lists the sets at exactly the cap, and only counts them above it', () => {
            const atCap = RecordTypeSelection.listRecordTypeCombinations({ Account: ['A', 'B', 'C', 'D', 'E'], Opportunity: ['X', 'Y'] }, ['Account', 'Opportunity'], 10);
            expect(atCap.setCount).toBe(10);
            expect(atCap.combinations).toHaveLength(10);
            const aboveCap = RecordTypeSelection.listRecordTypeCombinations({ Account: ['A', 'B', 'C'], Opportunity: ['W', 'X', 'Y', 'Z'] }, ['Account', 'Opportunity'], 10);
            expect(aboveCap.setCount).toBe(12);
            expect(aboveCap.combinations).toEqual([]);
            expect(aboveCap.recordTypeCountsByObject).toEqual([{ objectApiName: 'Account', recordTypeCount: 3 }, { objectApiName: 'Opportunity', recordTypeCount: 4 }]);
        });

        it('leaves out an object with no names, one the tree does not list, a repeated name, and an inherited key', () => {
            const selection = Object.assign(Object.create({ Contact: ['Inherited'] }), { Account: ['Business', 'Business'], Case: [], Lead: ['Web'] });
            const plan = RecordTypeSelection.listRecordTypeCombinations(selection, ['Account', 'Account', 'Case', 'Contact'], 10);
            expect(plan.setCount).toBe(1);
            expect(names(plan)).toEqual(['Account · Business']);
        });

        it('makes no set from an empty selection', () => {
            expect(RecordTypeSelection.listRecordTypeCombinations({}, ['Account'], 10)).toEqual({ setCount: 0, recordTypeCountsByObject: [], combinations: [] });
        });

    });

    describe('buildRecordTypeBlocks (#194)', () => {

        test('given nothing selected, is one default block under the usual nickname, carrying the ignored names', () => {

            expect(RecordTypeSelection.buildRecordTypeBlocks('Account', { selectedRecordTypeApiNames: [], ignoredDeveloperNames: ['Gone'] })).toEqual([
                { nickname: 'Account_NickName', ignoredDeveloperNames: ['Gone'] }
            ]);

        });

        test('given one record type, is one block under the usual nickname, as #193 wrote it', () => {

            expect(RecordTypeSelection.buildRecordTypeBlocks('Account', { selectedRecordTypeApiNames: ['Partner'], ignoredDeveloperNames: [] })).toEqual([
                { recordTypeApiName: 'Partner', nickname: 'Account_NickName', ignoredDeveloperNames: [] }
            ]);

        });

        test('given several, is one block per record type in selection order, each nicknamed after it, with the ignored names in the first only', () => {

            expect(RecordTypeSelection.buildRecordTypeBlocks('Account', { selectedRecordTypeApiNames: ['Partner', 'Customer'], ignoredDeveloperNames: ['Gone'] })).toEqual([
                { recordTypeApiName: 'Partner', nickname: 'Account_Partner_NickName', ignoredDeveloperNames: ['Gone'] },
                { recordTypeApiName: 'Customer', nickname: 'Account_Customer_NickName', ignoredDeveloperNames: [] }
            ]);

        });

        test('given a record type whose nickname is reserved, as the self-lookup iteration\'s is for "child", gives it a suffix', () => {

            const recordTypeBlocks = RecordTypeSelection.buildRecordTypeBlocks(
                'Account',
                { selectedRecordTypeApiNames: ['child', 'Partner'], ignoredDeveloperNames: [] },
                ['Account_child_NickName']
            );

            expect(recordTypeBlocks.map(recordTypeBlock => recordTypeBlock.nickname)).toEqual(['Account_child_RecordType_NickName', 'Account_Partner_NickName']);

        });

    });

    describe('buildRecordTypeBlocks nickname suffixes (#194 review)', () => {

        test('a suffixed nickname never takes another selected record type\'s nickname', () => {

            const recordTypeBlocks = RecordTypeSelection.buildRecordTypeBlocks(
                'Account',
                { selectedRecordTypeApiNames: ['child', 'child_RecordType'], ignoredDeveloperNames: [] },
                ['Account_child_NickName']
            );
            const nicknames = recordTypeBlocks.map(recordTypeBlock => recordTypeBlock.nickname);

            expect(nicknames).toEqual(['Account_child_RecordType_RecordType_NickName', 'Account_child_RecordType_NickName']);
            expect(new Set(nicknames).size).toBe(2);

        });

    });

    describe('getRecordTypePicklistValues', () => {

        test('answers the record type\'s values for a field it lists, and undefined for one it does not', () => {

            const recordTypeWrapper = buildRecordTypeWrapper('Customer', { Industry: ['Banking', 'Energy'] });

            expect(RecordTypeSelection.getRecordTypePicklistValues(recordTypeWrapper, 'Industry')).toEqual(['Banking', 'Energy']);
            expect(RecordTypeSelection.getRecordTypePicklistValues(recordTypeWrapper, 'Rating')).toBeUndefined();
            expect(RecordTypeSelection.getRecordTypePicklistValues(recordTypeWrapper, 'constructor')).toBeUndefined();

        });

        test('given a wrapper with no sections, answers undefined', () => {

            expect(RecordTypeSelection.getRecordTypePicklistValues({ DeveloperName: 'Customer' } as RecordTypeWrapper, 'Industry')).toBeUndefined();

        });

        test('given no wrapper, a section that is not an array, or one holding non-strings, answers only the strings', () => {

            const malformedWrapper = buildRecordTypeWrapper('Customer', { Industry: 'Banking' as unknown as string[], Rating: ['Hot', 7 as unknown as string] });

            expect(RecordTypeSelection.getRecordTypePicklistValues(undefined, 'Industry')).toBeUndefined();
            expect(RecordTypeSelection.getRecordTypePicklistValues(malformedWrapper, 'Industry')).toBeUndefined();
            expect(RecordTypeSelection.getRecordTypePicklistValues(malformedWrapper, 'Rating')).toEqual(['Hot']);

        });

    });

    describe('narrowControllingValueToPicklistOptions', () => {

        const controllingValueToPicklistOptions = { cle: ['tree', 'weed', 'mulch'], eastlake: ['tree', 'weed'], madison: ['plant'] };

        test('drops a controlling value the record type does not allow, keeps only the dependent values it allows, and drops a choice left empty', () => {

            const recordTypeWrapper = buildRecordTypeWrapper('Two', { Picklist__c: ['cle', 'madison'], Dependent__c: ['mulch', 'tree', 'rocks'] });

            const narrowedOptions = RecordTypeSelection.narrowControllingValueToPicklistOptions(controllingValueToPicklistOptions, recordTypeWrapper, 'Picklist__c', 'Dependent__c');

            expect({ ...narrowedOptions }).toEqual({ cle: ['tree', 'mulch'] });
            expect(Object.getPrototypeOf(narrowedOptions)).toBeNull();

        });

        test('given a record type that lists neither field, keeps every choice as it was', () => {

            const narrowedOptions = RecordTypeSelection.narrowControllingValueToPicklistOptions(controllingValueToPicklistOptions, buildRecordTypeWrapper('Two'), 'Checkbox__c', 'Dependent__c');

            expect({ ...narrowedOptions }).toEqual(controllingValueToPicklistOptions);
            expect(narrowedOptions.cle).not.toBe(controllingValueToPicklistOptions.cle);

        });

        test('keeps the order of the controlling values and of their options', () => {

            const recordTypeWrapper = buildRecordTypeWrapper('Two', { Dependent__c: ['weed', 'tree'] });

            const narrowedOptions = RecordTypeSelection.narrowControllingValueToPicklistOptions(controllingValueToPicklistOptions, recordTypeWrapper, 'Picklist__c', 'Dependent__c');

            expect(Object.entries(narrowedOptions)).toEqual([['cle', ['tree', 'weed']], ['eastlake', ['tree', 'weed']]]);

        });

        test('given a controlling value named after a prototype member, keeps it as an own key', () => {

            const recordTypeWrapper = buildRecordTypeWrapper('Two', { Picklist__c: ['__proto__'] });

            const narrowedOptions = RecordTypeSelection.narrowControllingValueToPicklistOptions({ ['__proto__']: ['tree'] } as Record<string, string[]>, recordTypeWrapper, 'Picklist__c', 'Dependent__c');

            expect(Object.keys(narrowedOptions)).toEqual(['__proto__']);

        });

    });

});
