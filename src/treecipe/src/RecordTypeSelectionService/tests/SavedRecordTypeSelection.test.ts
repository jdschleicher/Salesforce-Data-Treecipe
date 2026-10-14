import {
    ISavedRecordTypeSelectionReport,
    SAVED_RECORD_TYPE_SELECTION_MAXIMUM_NAMED_ENTRIES,
    SavedRecordTypeSelection
} from '../SavedRecordTypeSelection';
import { RecordTypeSelection } from '../../RecordTypeService/RecordTypeSelection';
import { RecordTypeWrapper } from '../../RecordTypeService/RecordTypesWrapper';

const writableMapOf = (...developerNames: string[]): Record<string, RecordTypeWrapper> =>
    Object.fromEntries(developerNames.map(developerName => [developerName, new RecordTypeWrapper()]));

const EMPTY_REPORT: ISavedRecordTypeSelectionReport = { droppedEntries: [], missingObjectApiNames: [], newRecordTypes: [] };

describe('SavedRecordTypeSelection (#196)', () => {

    describe('fromConfigurationValues', () => {

        it('reads every usable entry, in order, with the record types each object had when it was saved', () => {

            const { savedSelection, invalidEntryDescriptions } = SavedRecordTypeSelection.fromConfigurationValues(
                { Account: ['Partner', 'Customer'], Contact: ['Vendor'] },
                { Account: ['Customer', 'Partner'], Contact: ['Vendor', 'Employee'] }
            );

            expect(invalidEntryDescriptions).toEqual([]);
            expect(savedSelection).toBeInstanceOf(RecordTypeSelection);
            expect(savedSelection?.getDeveloperNames('Account')).toEqual(['Partner', 'Customer']);
            expect(savedSelection?.getDeveloperNames('Contact')).toEqual(['Vendor']);

        });

        it('is no selection and no warning when nothing is saved, or an empty object is', () => {

            expect(SavedRecordTypeSelection.fromConfigurationValues(undefined, undefined)).toEqual({ invalidEntryDescriptions: [] });
            expect(SavedRecordTypeSelection.fromConfigurationValues({}, undefined)).toEqual({ invalidEntryDescriptions: [] });

        });

        it.each([
            ['a string', 'Account.Partner'],
            ['a list', [['Account', ['Partner']]]],
            ['null', null],
            ['a number', 7]
        ])('ignores recordTypeSelections given %s, with a warning, and never throws', (unusedDescription, savedSelections) => {

            const { savedSelection, invalidEntryDescriptions } = SavedRecordTypeSelection.fromConfigurationValues(savedSelections, undefined);

            expect(savedSelection).toBeUndefined();
            expect(invalidEntryDescriptions).toEqual(['"recordTypeSelections" is not an object of object api names to lists of record type developer names']);

        });

        it.each([
            ['a string in place of a list', { Account: 'Partner' }],
            ['an empty list', { Account: [] }],
            ['a name that is not a string', { Account: [7] }],
            ['a developer name that is not an api name', { Account: ['Partner\n- object: Evil'] }],
            ['an object key that is not an api name', { 'Account Name': ['Partner'] }]
        ])('ignores an entry given %s, keeping the rest', (unusedDescription, invalidEntry) => {

            const { savedSelection, invalidEntryDescriptions } = SavedRecordTypeSelection.fromConfigurationValues({ ...invalidEntry, Contact: ['Vendor'] }, undefined);

            expect(savedSelection?.getDeveloperNames('Contact')).toEqual(['Vendor']);
            expect(savedSelection?.getDeveloperNames(Object.keys(invalidEntry)[0])).toBeUndefined();
            expect(invalidEntryDescriptions).toHaveLength(1);

        });

        it('escapes an entry name for the notification it is named in', () => {

            const { invalidEntryDescriptions } = SavedRecordTypeSelection.fromConfigurationValues({ '[x](command:workbench.action.terminal.new)': ['Partner'] }, undefined);

            expect(invalidEntryDescriptions[0]).not.toContain('[x](command:');

        });

        it('keeps a repeated developer name once', () => {

            const { savedSelection } = SavedRecordTypeSelection.fromConfigurationValues({ Account: ['Partner', 'Partner', 'Customer'] }, undefined);

            expect(savedSelection?.getDeveloperNames('Account')).toEqual(['Partner', 'Customer']);

        });

        it('ignores an unusable record-types-when-saved entry with a warning, allows an empty list there, and keeps the selection', () => {

            const { savedSelection, invalidEntryDescriptions } = SavedRecordTypeSelection.fromConfigurationValues(
                { Account: ['Partner'], Contact: ['Vendor'] },
                { Account: 'Partner', Contact: [] }
            );

            expect(savedSelection?.getDeveloperNames('Account')).toEqual(['Partner']);
            expect(invalidEntryDescriptions).toEqual(['"recordTypesWhenSelectionSaved" entry "Account"']);

        });

        it('warns once about record-types-when-saved that is not an object', () => {

            const { invalidEntryDescriptions } = SavedRecordTypeSelection.fromConfigurationValues({ Account: ['Partner'] }, ['Partner']);

            expect(invalidEntryDescriptions).toEqual(['"recordTypesWhenSelectionSaved" is not an object of object api names to lists of record type developer names']);

        });

    });

    describe('buildInvalidEntriesWarning', () => {

        it('names nothing when everything was usable', () => {

            expect(SavedRecordTypeSelection.buildInvalidEntriesWarning([])).toBeUndefined();

        });

        it('names each ignored entry, and how many more past the limit', () => {

            const descriptions = Array.from({ length: SAVED_RECORD_TYPE_SELECTION_MAXIMUM_NAMED_ENTRIES + 2 }, (unusedValue, index) => `entry ${index}`);
            const warning = SavedRecordTypeSelection.buildInvalidEntriesWarning(descriptions) as string;

            expect(warning).toContain('entry 0');
            expect(warning).not.toContain(`entry ${SAVED_RECORD_TYPE_SELECTION_MAXIMUM_NAMED_ENTRIES}`);
            expect(warning).toContain('and 2 more');

        });

    });

    describe('resolve, and the report the walk leaves', () => {

        it('resolves a saved entry that still matches like any selection', () => {

            const savedSelection = new SavedRecordTypeSelection([['Account', ['Partner', 'Customer']]], [['Account', ['Customer', 'Partner']]]);

            expect(RecordTypeSelection.resolveForObject(savedSelection, 'Account', writableMapOf('Customer', 'Partner')))
                .toEqual({ selectedRecordTypeApiNames: ['Partner', 'Customer'], ignoredDeveloperNames: [] });
            expect(savedSelection.buildReport()).toEqual(EMPTY_REPORT);

        });

        it('drops the whole entry of an object naming a record type it no longer has, with nothing ignored to write', () => {

            const savedSelection = new SavedRecordTypeSelection([['Account', ['Partner', 'Gone']]]);

            expect(RecordTypeSelection.resolveForObject(savedSelection, 'Account', writableMapOf('Customer', 'Partner')))
                .toEqual({ selectedRecordTypeApiNames: [], ignoredDeveloperNames: [] });
            expect(savedSelection.buildReport().droppedEntries).toEqual([{ objectApiName: 'Account', missingDeveloperNames: ['Gone'] }]);

        });

        it('does not read a record type named like an Object.prototype member as present', () => {

            const savedSelection = new SavedRecordTypeSelection([['Account', ['constructor']]]);

            expect(savedSelection.resolve('Account', writableMapOf('Customer')).selectedRecordTypeApiNames).toEqual([]);
            expect(savedSelection.buildReport().droppedEntries).toEqual([{ objectApiName: 'Account', missingDeveloperNames: ['constructor'] }]);

        });

        it('reports a saved object the walk never reached as no longer in the metadata', () => {

            const savedSelection = new SavedRecordTypeSelection([['Account', ['Partner']], ['Gadget__c', ['Big']]]);
            savedSelection.resolve('Account', writableMapOf('Partner'));

            expect(savedSelection.buildReport().missingObjectApiNames).toEqual(['Gadget__c']);

        });

        it('reports a record type added since the selection was saved, only for an object with a saved entry', () => {

            const savedSelection = new SavedRecordTypeSelection([['Account', ['Partner']]], [['Account', ['Partner', 'Customer']]]);

            savedSelection.resolve('Account', writableMapOf('Customer', 'Partner', 'Vendor'));
            savedSelection.resolve('Contact', writableMapOf('Employee'));

            expect(savedSelection.buildReport().newRecordTypes).toEqual([{ objectApiName: 'Account', developerNames: ['Vendor'] }]);

        });

        it('notices no new record type for an entry saved by hand, with no record types recorded', () => {

            const savedSelection = new SavedRecordTypeSelection([['Account', ['Partner']]]);
            savedSelection.resolve('Account', writableMapOf('Customer', 'Partner', 'Vendor'));

            expect(savedSelection.buildReport()).toEqual(EMPTY_REPORT);

        });

        it('reports an object walked twice once', () => {

            const savedSelection = new SavedRecordTypeSelection([['Account', ['Gone']]], [['Account', []]]);
            savedSelection.resolve('Account', writableMapOf('Partner'));
            savedSelection.resolve('Account', writableMapOf('Partner'));

            const report = savedSelection.buildReport();
            expect(report.droppedEntries).toHaveLength(1);
            expect(report.newRecordTypes).toHaveLength(1);

        });

        it('resolves an object it has no entry for as no selection', () => {

            const savedSelection = new SavedRecordTypeSelection([['Account', ['Partner']]]);

            expect(savedSelection.resolve('Contact', writableMapOf('Employee'))).toEqual({ selectedRecordTypeApiNames: [], ignoredDeveloperNames: [] });

        });

    });

    describe('buildReportWarning and findObjectToReview', () => {

        it('says nothing when the saved selection still matches', () => {

            expect(SavedRecordTypeSelection.buildReportWarning(EMPTY_REPORT)).toBeUndefined();
            expect(SavedRecordTypeSelection.findObjectToReview(EMPTY_REPORT)).toBeUndefined();

        });

        it('names every dropped entry, missing object and new record type in one warning', () => {

            const warning = SavedRecordTypeSelection.buildReportWarning({
                droppedEntries: [{ objectApiName: 'Account', missingDeveloperNames: ['Gone'] }],
                missingObjectApiNames: ['Gadget__c'],
                newRecordTypes: [{ objectApiName: 'Contact', developerNames: ['Vendor', 'Employee'] }]
            }) as string;

            expect(warning).toContain('"Account" (no "Gone")');
            expect(warning).toContain('default record type');
            expect(warning).toContain('"Gadget__c"');
            expect(warning).toContain('"Contact" ("Vendor", "Employee")');
            expect(warning).toContain('Remember this selection');

        });

        it('escapes every name, since a notification renders link syntax as a command link', () => {

            const warning = SavedRecordTypeSelection.buildReportWarning({
                droppedEntries: [{ objectApiName: '[a](command:x)', missingDeveloperNames: ['[b](command:y)'] }],
                missingObjectApiNames: ['[c](command:z)'],
                newRecordTypes: [{ objectApiName: '[d](command:w)', developerNames: ['[e](command:v)'] }]
            }) as string;

            expect(warning).not.toMatch(/\]\(command:/);

        });

        it('opens the tab on an object with a new record type first, else on a dropped entry\'s object', () => {

            expect(SavedRecordTypeSelection.findObjectToReview({
                droppedEntries: [{ objectApiName: 'Account', missingDeveloperNames: ['Gone'] }],
                missingObjectApiNames: [],
                newRecordTypes: [{ objectApiName: 'Contact', developerNames: ['Vendor'] }]
            })).toBe('Contact');
            expect(SavedRecordTypeSelection.findObjectToReview({
                droppedEntries: [{ objectApiName: 'Account', missingDeveloperNames: ['Gone'] }],
                missingObjectApiNames: ['Gadget__c'],
                newRecordTypes: []
            })).toBe('Account');
            expect(SavedRecordTypeSelection.findObjectToReview({ ...EMPTY_REPORT, missingObjectApiNames: ['Gadget__c'] })).toBeUndefined();

        });

    });

});
