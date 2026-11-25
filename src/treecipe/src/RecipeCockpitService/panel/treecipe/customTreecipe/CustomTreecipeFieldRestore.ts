/*
    What one field's ↺ in the Customize modal undoes (#715), as a rule over the modal's removal state.
    Imports nothing, so it is tested on its own; the modal posts the result as previewCustomTreecipe and
    the host's cascade still decides what is kept.

    A field comes back with its object, and with the path from that object up to an object that is
    already kept: on each removed object of the path, the lookup to an EARLIER object in insert order
    (a lookup to the same or a later object closes a cycle, which never makes a parent, #677). A lookup
    whose parent is already kept is chosen first, so the fewest objects come back; otherwise the first
    by `<`, the lookup the host names in removedLookupFieldApiName.

    An object the reader removed -- by its own ✕, or by removing every field it can -- comes back with only
    what the path needs and its locked fields: the reader is building it up field by field. An object
    only the cascade took keeps its own fields as they were. The top of the path keeps at least one
    field, its first in recipe order, because the host removes an object with no field and every object
    under it with it.
*/

export interface IRestorableLookup {
    fieldApiName: string;
    parentObjectApiName: string;
}

// AN OBJECT OF THE MODAL, IN THE TREE'S INSERT ORDER, ITS FIELDS IN RECIPE ORDER
export interface IRestorableObject {
    objectApiName: string;
    parentLookups: readonly IRestorableLookup[];
    fieldApiNames: readonly string[];
}

// WHAT THE READER REMOVED: CHANGED IN PLACE
export interface IRemovalState {
    removedObjects: Set<string>;
    removedFields: Map<string, Set<string>>;
}

// WHAT THE HOST'S LAST PREVIEW SAID: THE KIND OF EACH OBJECT IT REMOVED, AND EACH OBJECT'S LOCKED FIELDS
export interface IHostCascade {
    removalKindByObject: ReadonlyMap<string, string>;
    lockedFieldsByObject: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

export type RestoredAlongReason = 'pathLookup' | 'keepsTopObject';

// A FIELD THAT CAME BACK WITH THE ONE THE READER RESTORED, AND WHY
export interface IRestoredAlongField {
    objectApiName: string;
    fieldApiName: string;
    reason: RestoredAlongReason;
}

export function restoreFieldWithPath(objects: readonly IRestorableObject[], removalState: IRemovalState, hostCascade: IHostCascade,
                                     objectApiName: string, fieldApiName: string): IRestoredAlongField[] {

    const insertPositionByObject = new Map(objects.map(function (restorableObject, insertPosition) { return [restorableObject.objectApiName, insertPosition] as [string, number]; }));
    const objectByName = new Map(objects.map(function (restorableObject) { return [restorableObject.objectApiName, restorableObject] as [string, IRestorableObject]; }));
    const isRemoved = function (candidateObjectApiName: string) {
        return removalState.removedObjects.has(candidateObjectApiName) || hostCascade.removalKindByObject.has(candidateObjectApiName);
    };

    const restoredAlong: IRestoredAlongField[] = [];
    const walkedObjects = new Set<string>();
    let pathObjectApiName: string | undefined = objectApiName;
    let fieldsToKeep = [fieldApiName];

    while (pathObjectApiName !== undefined && !walkedObjects.has(pathObjectApiName)) {

        const pathObject = objectByName.get(pathObjectApiName);
        if (!pathObject) { return restoredAlong; }
        walkedObjects.add(pathObjectApiName);

        if (!isRemoved(pathObjectApiName)) {
            keepFields(removalState, pathObjectApiName, fieldsToKeep);
            return restoredAlong;
        }

        const pathLookup = choosePathLookup(pathObject, insertPositionByObject, isRemoved);
        const keptFieldApiNames = pathLookup ? fieldsToKeep.concat([pathLookup.fieldApiName]) : fieldsToKeep;
        const lockedFields = hostCascade.lockedFieldsByObject.get(pathObjectApiName);
        const wasRemovedByReader = removalState.removedObjects.has(pathObjectApiName) || isEveryFieldRemoved(removalState, pathObject, lockedFields);
        const removedFieldsBefore = removalState.removedFields.get(pathObjectApiName);
        const wasPathLookupGone = !!pathLookup && (removalState.removedObjects.has(pathObjectApiName) || (!!removedFieldsBefore && removedFieldsBefore.has(pathLookup.fieldApiName)));

        if (wasRemovedByReader) {
            removalState.removedObjects.delete(pathObjectApiName);
            keepOnlyFields(removalState, pathObject, keptFieldApiNames, lockedFields);
        } else {
            keepFields(removalState, pathObjectApiName, keptFieldApiNames);
        }
        if (pathLookup && wasPathLookupGone) { restoredAlong.push({ objectApiName: pathObjectApiName, fieldApiName: pathLookup.fieldApiName, reason: 'pathLookup' }); }

        const firstKeptField = keepFirstFieldWhenNoneIsKept(removalState, pathObject);
        if (firstKeptField !== undefined) { restoredAlong.push({ objectApiName: pathObjectApiName, fieldApiName: firstKeptField, reason: 'keepsTopObject' }); }

        pathObjectApiName = pathLookup ? pathLookup.parentObjectApiName : undefined;
        fieldsToKeep = [];

    }

    return restoredAlong;

}

// READ FROM THE REMOVAL AS IT IS NOW, NEVER THE LAST PREVIEW: A SECOND ↺ BEFORE THE HOST ANSWERS WOULD OTHERWISE EMPTY THE OBJECT AGAIN
function isEveryFieldRemoved(removalState: IRemovalState, restorableObject: IRestorableObject, lockedFields: ReadonlyMap<string, string> | undefined): boolean {
    const removedFields = removalState.removedFields.get(restorableObject.objectApiName);
    return !!removedFields && removedFields.size > 0 && restorableObject.fieldApiNames.every(function (fieldApiName) {
        return removedFields.has(fieldApiName) || !!(lockedFields && lockedFields.has(fieldApiName));
    });
}

function choosePathLookup(pathObject: IRestorableObject, insertPositionByObject: ReadonlyMap<string, number>, isRemoved: (objectApiName: string) => boolean): IRestorableLookup | undefined {

    const ownPosition = insertPositionByObject.get(pathObject.objectApiName) as number;
    const parentLookups = pathObject.parentLookups
        .filter(function (lookup) {
            const parentPosition = insertPositionByObject.get(lookup.parentObjectApiName);
            return lookup.parentObjectApiName !== pathObject.objectApiName && parentPosition !== undefined && parentPosition < ownPosition;
        })
        .slice()
        .sort(function (left, right) { return left.fieldApiName < right.fieldApiName ? -1 : left.fieldApiName > right.fieldApiName ? 1 : 0; });

    return parentLookups.find(function (lookup) { return !isRemoved(lookup.parentObjectApiName); }) || parentLookups[0];

}

function keepFields(removalState: IRemovalState, objectApiName: string, fieldApiNames: readonly string[]): void {
    const removedFields = removalState.removedFields.get(objectApiName);
    if (!removedFields) { return; }
    fieldApiNames.forEach(function (fieldApiName) { removedFields.delete(fieldApiName); });
    if (removedFields.size === 0) { removalState.removedFields.delete(objectApiName); }
}

// A LOCKED FIELD IS NEVER LISTED AS REMOVED: THE HOST KEEPS IT ANYWAY
function keepOnlyFields(removalState: IRemovalState, restorableObject: IRestorableObject, keptFieldApiNames: readonly string[], lockedFields: ReadonlyMap<string, string> | undefined): void {
    const removedFields = new Set(restorableObject.fieldApiNames.filter(function (fieldApiName) {
        return keptFieldApiNames.indexOf(fieldApiName) === -1 && !(lockedFields && lockedFields.has(fieldApiName));
    }));
    if (removedFields.size === 0) { removalState.removedFields.delete(restorableObject.objectApiName); } else { removalState.removedFields.set(restorableObject.objectApiName, removedFields); }
}

function keepFirstFieldWhenNoneIsKept(removalState: IRemovalState, restorableObject: IRestorableObject): string | undefined {
    const removedFields = removalState.removedFields.get(restorableObject.objectApiName);
    if (!removedFields || restorableObject.fieldApiNames.some(function (fieldApiName) { return !removedFields.has(fieldApiName); })) { return undefined; }
    const firstFieldApiName = restorableObject.fieldApiNames[0];
    if (firstFieldApiName === undefined) { return undefined; }
    keepFields(removalState, restorableObject.objectApiName, [firstFieldApiName]);
    return firstFieldApiName;
}
