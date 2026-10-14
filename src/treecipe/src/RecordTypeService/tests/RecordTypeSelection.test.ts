import { RecordTypeSelection } from '../RecordTypeSelection';
import { RecordTypeWrapper } from '../RecordTypesWrapper';

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

    describe('resolveForObject', () => {

        const writableRecordTypes = { Customer: buildRecordTypeWrapper('Customer'), Partner: buildRecordTypeWrapper('Partner') };

        test('given no selection, or none for the object, selects nothing and ignores nothing', () => {

            expect(RecordTypeSelection.resolveForObject(undefined, 'Account', writableRecordTypes)).toEqual({ ignoredNames: [] });
            expect(RecordTypeSelection.resolveForObject(new RecordTypeSelection([['Contact', ['Customer']]]), 'Account', writableRecordTypes)).toEqual({ ignoredNames: [] });

        });

        test('selects the first writable name, and ignores names the object does not have and every later writable name', () => {

            const recordTypeSelection = new RecordTypeSelection([['Account', ['Gone', 'Partner', 'Customer']]]);

            expect(RecordTypeSelection.resolveForObject(recordTypeSelection, 'Account', writableRecordTypes)).toEqual({
                selectedRecordTypeApiName: 'Partner',
                ignoredNames: [
                    { developerName: 'Gone', reason: 'notAWritableRecordType' },
                    { developerName: 'Customer', reason: 'onlyOneRecordTypePerObject' }
                ]
            });

        });

        test('never selects a name the map holds only through its prototype', () => {

            const recordTypeSelection = new RecordTypeSelection([['Account', ['constructor', 'toString']]]);

            expect(RecordTypeSelection.resolveForObject(recordTypeSelection, 'Account', writableRecordTypes)).toEqual({
                ignoredNames: [
                    { developerName: 'constructor', reason: 'notAWritableRecordType' },
                    { developerName: 'toString', reason: 'notAWritableRecordType' }
                ]
            });

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
