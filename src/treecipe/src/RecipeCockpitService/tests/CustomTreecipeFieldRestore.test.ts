import { IHostCascade, IRemovalState, IRestorableObject, restoreFieldWithPath } from '../panel/treecipe/customTreecipe/CustomTreecipeFieldRestore';

/*
    What one field's ↺ in the Customize modal undoes (#715): the field, its object, and the path from
    it up to an object that is still kept.
*/

// Account → Contact (AccountId, ReportsToId → Contact itself) → Case (ContactId, AccountId)
const TREE: IRestorableObject[] = [
    { objectApiName: 'Account', parentLookups: [], fieldApiNames: ['Name', 'Industry', 'RecordTypeId'] },
    { objectApiName: 'Contact', parentLookups: [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }, { fieldApiName: 'ReportsToId', parentObjectApiName: 'Contact' }], fieldApiNames: ['LastName', 'Email', 'AccountId', 'ReportsToId'] },
    { objectApiName: 'Case', parentLookups: [{ fieldApiName: 'ContactId', parentObjectApiName: 'Contact' }, { fieldApiName: 'AccountId', parentObjectApiName: 'Account' }], fieldApiNames: ['Subject', 'ContactId', 'AccountId'] }
];

const NO_LOCKS = new Map<string, Map<string, string>>();

const everyFieldRemoved = (): IRemovalState => ({
    removedObjects: new Set(),
    removedFields: new Map(TREE.map(treeObject => [treeObject.objectApiName, new Set(treeObject.fieldApiNames)]))
});

const cascadeOf = (removalKindByObject: Record<string, string>, lockedFieldsByObject: Map<string, Map<string, string>> = NO_LOCKS): IHostCascade => ({
    removalKindByObject: new Map(Object.entries(removalKindByObject)),
    lockedFieldsByObject: lockedFieldsByObject
});

const removedFieldsOf = (removalState: IRemovalState) => Object.fromEntries([...removalState.removedFields.entries()].map(([objectApiName, fieldApiNames]) => [objectApiName, [...fieldApiNames]]));

describe('restoreFieldWithPath (#715)', () => {

    it('restores only the field on an object that is still kept, as ↺ always did', () => {

        const removalState: IRemovalState = { removedObjects: new Set(), removedFields: new Map([['Contact', new Set(['Email', 'LastName'])]]) };

        const restoredAlong = restoreFieldWithPath(TREE, removalState, cascadeOf({}), 'Contact', 'Email');

        expect(restoredAlong).toEqual([]);
        expect(removedFieldsOf(removalState)).toEqual({ Contact: ['LastName'] });

    });

    it('after every field is removed, brings back the field, the lookups up the path and the root\'s first field', () => {

        const removalState = everyFieldRemoved();

        const restoredAlong = restoreFieldWithPath(TREE, removalState, cascadeOf({ Account: 'noFieldsSelected', Contact: 'noFieldsSelected', Case: 'noFieldsSelected' }), 'Contact', 'Email');

        expect(restoredAlong).toEqual([
            { objectApiName: 'Contact', fieldApiName: 'AccountId', reason: 'pathLookup' },
            { objectApiName: 'Account', fieldApiName: 'Name', reason: 'keepsTopObject' }
        ]);
        expect(removedFieldsOf(removalState)).toEqual({
            Account: ['Industry', 'RecordTypeId'],
            Contact: ['LastName', 'ReportsToId'],
            Case: ['Subject', 'ContactId', 'AccountId']
        });

    });

    it('chooses a lookup whose parent is still kept before the first by name, so the fewest objects come back', () => {

        const removalState: IRemovalState = { removedObjects: new Set(), removedFields: new Map([['Case', new Set(['Subject', 'ContactId', 'AccountId'])], ['Contact', new Set(['LastName', 'Email', 'AccountId', 'ReportsToId'])]]) };

        const restoredAlong = restoreFieldWithPath(TREE, removalState, cascadeOf({ Contact: 'noFieldsSelected', Case: 'noFieldsSelected' }), 'Case', 'Subject');

        expect(restoredAlong).toEqual([{ objectApiName: 'Case', fieldApiName: 'AccountId', reason: 'pathLookup' }]);
        expect(removedFieldsOf(removalState)).toEqual({ Case: ['ContactId'], Contact: ['LastName', 'Email', 'AccountId', 'ReportsToId'] });

    });

    it('takes the first lookup by name when no parent is kept, and never follows a lookup to itself or a later object', () => {

        const removalState = everyFieldRemoved();

        restoreFieldWithPath(TREE, removalState, cascadeOf({ Account: 'noFieldsSelected', Contact: 'noFieldsSelected', Case: 'noFieldsSelected' }), 'Case', 'Subject');

        expect(removedFieldsOf(removalState)).toEqual({
            Account: ['Industry', 'RecordTypeId'],
            Contact: ['LastName', 'Email', 'AccountId', 'ReportsToId'],
            Case: ['ContactId']
        });

    });

    it('brings back an object removed by its own ✕ with only the restored field, its path lookup and its locked fields', () => {

        const removalState: IRemovalState = { removedObjects: new Set(['Contact']), removedFields: new Map() };
        const lockedFields = new Map([['Contact', new Map([['LastName', 'a required field']])]]);

        const restoredAlong = restoreFieldWithPath(TREE, removalState, cascadeOf({ Contact: 'excluded', Case: 'autoExcluded' }, lockedFields), 'Contact', 'Email');

        expect(removalState.removedObjects.size).toBe(0);
        expect(removedFieldsOf(removalState)).toEqual({ Contact: ['ReportsToId'] });
        expect(restoredAlong).toEqual([{ objectApiName: 'Contact', fieldApiName: 'AccountId', reason: 'pathLookup' }]);

    });

    it('restores the root removed by its own ✕, keeping its first field so the host keeps the tree', () => {

        const removalState: IRemovalState = { removedObjects: new Set(['Account']), removedFields: new Map() };

        const restoredAlong = restoreFieldWithPath(TREE, removalState, cascadeOf({ Account: 'excluded', Contact: 'autoExcluded', Case: 'autoExcluded' }), 'Contact', 'Email');

        expect(removalState.removedObjects.size).toBe(0);
        expect(removedFieldsOf(removalState)).toEqual({ Account: ['Industry', 'RecordTypeId'] });
        expect(restoredAlong).toEqual([{ objectApiName: 'Account', fieldApiName: 'Name', reason: 'keepsTopObject' }]);

    });

    it('leaves the fields of an object only the cascade took as they were, and walks on to the parent that took it', () => {

        const removalState: IRemovalState = { removedObjects: new Set(['Account']), removedFields: new Map([['Contact', new Set(['LastName'])]]) };

        restoreFieldWithPath(TREE, removalState, cascadeOf({ Account: 'excluded', Contact: 'autoExcluded', Case: 'autoExcluded' }), 'Case', 'Subject');

        expect(removalState.removedObjects.size).toBe(0);
        expect(removedFieldsOf(removalState)).toEqual({ Contact: ['LastName'], Account: ['Industry', 'RecordTypeId'] });

    });

    it('never lists a locked field as removed, and keeps no other field when a lock already keeps the top object', () => {

        const removalState = everyFieldRemoved();
        removalState.removedFields.get('Account')?.delete('RecordTypeId');
        const lockedFields = new Map([['Account', new Map([['RecordTypeId', 'a record type field']])]]);

        const restoredAlong = restoreFieldWithPath(TREE, removalState, cascadeOf({ Account: 'noFieldsSelected', Contact: 'noFieldsSelected' }, lockedFields), 'Contact', 'Email');

        expect(removedFieldsOf(removalState).Account).toEqual(['Name', 'Industry']);
        expect(restoredAlong).toEqual([{ objectApiName: 'Contact', fieldApiName: 'AccountId', reason: 'pathLookup' }]);

    });

    it('follows no lookup to an object outside the tree or later in insert order, and lists nothing removed when every field is kept', () => {

        const tree: IRestorableObject[] = [
            { objectApiName: 'Account', parentLookups: [{ fieldApiName: 'PrimaryContact__c', parentObjectApiName: 'Contact' }, { fieldApiName: 'OwnerId', parentObjectApiName: 'User' }], fieldApiNames: ['Name', 'PrimaryContact__c', 'OwnerId'] },
            { objectApiName: 'Contact', parentLookups: [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }], fieldApiNames: ['AccountId'] },
            { objectApiName: 'Note__c', parentLookups: [], fieldApiNames: [] }
        ];
        const removalState: IRemovalState = { removedObjects: new Set(['Account', 'Contact']), removedFields: new Map([['Note__c', new Set(['Body__c'])]]) };

        const restoredAlong = restoreFieldWithPath(tree, removalState, cascadeOf({ Account: 'excluded', Contact: 'excluded' }), 'Contact', 'AccountId');

        expect(removalState.removedObjects.size).toBe(0);
        expect(removedFieldsOf(removalState)).toEqual({ Note__c: ['Body__c'], Account: ['PrimaryContact__c', 'OwnerId'] });
        expect(restoredAlong).toEqual([
            { objectApiName: 'Contact', fieldApiName: 'AccountId', reason: 'pathLookup' },
            { objectApiName: 'Account', fieldApiName: 'Name', reason: 'keepsTopObject' }
        ]);
        expect(restoreFieldWithPath(tree, removalState, cascadeOf({ Note__c: 'noFieldsSelected' }), 'Note__c', 'Body__c')).toEqual([]);

    });

    it('restores nothing for an object the modal does not hold', () => {

        const removalState = everyFieldRemoved();

        expect(restoreFieldWithPath(TREE, removalState, cascadeOf({}), 'Opportunity', 'Name')).toEqual([]);
        expect(removedFieldsOf(removalState)).toEqual(removedFieldsOf(everyFieldRemoved()));

    });

});
