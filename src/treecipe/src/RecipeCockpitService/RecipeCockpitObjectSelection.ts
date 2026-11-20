/*
    Which objects of one relationship tree the Recipe Cockpit leaves out of generation (#219).

    This file imports NOTHING, like RecipeCockpitRecordCreation and RecipeCockpitRecipeWriter: the
    cascade is computed on the HOST from what the reader excluded directly, and posted to the panel,
    so the panel never decides what is generated.

    The reader excludes objects directly. Every other object is included unless the exclusion cuts
    it off: an object stays included when it is not a descendant of an excluded object at all, when
    it has no parent in the tree (a root), or when at least one of its parents in the tree is still
    included. A self-lookup is never "another parent" -- the object cannot keep itself. What is
    left is AUTO-excluded, and it is never stored: including the parent again brings back exactly
    what it cut off, while what the reader excluded stays excluded.

    An object whose every field is unticked (#611) is cut off the same way, as noFieldsSelected:
    no record is generated for it, so it is no parent. A chain-link exclusion outranks it.

    A lookup field the reader removed (#677) is no edge: its object keeps only the parents its other
    lookups name. An object that had a parent in the tree and kept none is cut off with its subtree --
    it is no root -- and its label names the removed field, since no parent of it was excluded. For
    this rule only a lookup to an object EARLIER in treeObjects (insert order) is a parent: a lookup
    to the same or a later object closes a cycle, which RelationshipService leaves a TODO (#104), so
    removing it, or the lookup it pairs with, never cuts off the tree's root.
*/

export interface IObjectSelectionLookup {
    fieldApiName: string;
    parentObjectApiName: string;
}

export interface IObjectSelectionTreeObject {
    objectApiName: string;
    parentLookups: readonly IObjectSelectionLookup[];
}

export interface IObjectSelectionRemovedLookup {
    objectApiName: string;
    fieldApiName: string;
}

export type ObjectSelectionExclusionKind = 'excluded' | 'noFieldsSelected' | 'autoExcluded';

/*
    excludedParentObjectApiName is set on an auto-excluded object: the parent its label names,
    preferring one the reader excluded directly, then the first by "<". An object cut off only by a
    removed lookup names that field in removedLookupFieldApiName instead, the first by "<".
*/
export interface IObjectSelectionExclusion {
    objectApiName: string;
    kind: ObjectSelectionExclusionKind;
    excludedParentObjectApiName?: string;
    removedLookupFieldApiName?: string;
}

// A LOOKUP OF AN INCLUDED OBJECT TO AN EXCLUDED PARENT: SHOWN DISABLED, AND LEFT OUT OF WHAT IS GENERATED
export interface IObjectSelectionDisabledLookup {
    objectApiName: string;
    fieldApiName: string;
    parentObjectApiName: string;
}

export interface IObjectSelection {
    exclusions: IObjectSelectionExclusion[];
    disabledLookups: IObjectSelectionDisabledLookup[];
    includedObjectCount: number;
    objectCount: number;
}

export class RecipeCockpitObjectSelection {

    static computeObjectSelection(treeObjects: readonly IObjectSelectionTreeObject[],
                                    directlyExcludedObjectApiNames: Iterable<string>,
                                    noFieldsSelectedObjectApiNames: Iterable<string> = [],
                                    removedLookups: Iterable<IObjectSelectionRemovedLookup> = []): IObjectSelection {

        // EVERY STEP BELOW IS LINEAR IN THE TREE: A WIDE ROOT WITH THOUSANDS OF CHILDREN IS WHAT A GENERATED TREE CAN BE
        const lookupsByObjectApiName = new Map<string, IObjectSelectionLookup[]>();
        const lookupKeys = new Set<string>();
        treeObjects.forEach(treeObject => {
            const lookups = lookupsByObjectApiName.get(treeObject.objectApiName) ?? [];
            treeObject.parentLookups.forEach(lookup => {
                const lookupKey = `${treeObject.objectApiName}\n${lookup.fieldApiName}\n${lookup.parentObjectApiName}`;
                if ( !lookupKeys.has(lookupKey) ) {
                    lookupKeys.add(lookupKey);
                    lookups.push(lookup);
                }
            });
            lookupsByObjectApiName.set(treeObject.objectApiName, lookups);
        });

        const objectApiNames = [...lookupsByObjectApiName.keys()];
        const isTreeParentOf = (objectApiName: string, lookup: IObjectSelectionLookup) => lookup.parentObjectApiName !== objectApiName && lookupsByObjectApiName.has(lookup.parentObjectApiName);
        const removedLookupKeys = new Set([...removedLookups].map(removedLookup => `${removedLookup.objectApiName}\n${removedLookup.fieldApiName}`));
        const isRemoved = (objectApiName: string, lookup: IObjectSelectionLookup) => removedLookupKeys.has(`${objectApiName}\n${lookup.fieldApiName}`);
        const hasTreeParent = new Set(objectApiNames.filter(objectApiName => ( lookupsByObjectApiName.get(objectApiName) ?? [] ).some(lookup => isTreeParentOf(objectApiName, lookup))));
        const insertPositionByObjectApiName = new Map(objectApiNames.map((objectApiName, insertPosition) => [objectApiName, insertPosition]));
        const isInsertOrderParentOf = (objectApiName: string, lookup: IObjectSelectionLookup) => isTreeParentOf(objectApiName, lookup)
            && ( insertPositionByObjectApiName.get(lookup.parentObjectApiName) as number ) < ( insertPositionByObjectApiName.get(objectApiName) as number );
        const hasInsertOrderParent = new Set(objectApiNames.filter(objectApiName => ( lookupsByObjectApiName.get(objectApiName) ?? [] ).some(lookup => isInsertOrderParentOf(objectApiName, lookup))));
        const removedTreeLookupFieldsByObject = new Map(objectApiNames
            .map(objectApiName => [objectApiName, ( lookupsByObjectApiName.get(objectApiName) ?? [] )
                .filter(lookup => isInsertOrderParentOf(objectApiName, lookup) && isRemoved(objectApiName, lookup))
                .map(lookup => lookup.fieldApiName)
                .sort((left, right) => ( left < right ? -1 : left > right ? 1 : 0 ))] as [string, string[]])
            .filter(([, fieldApiNames]) => fieldApiNames.length > 0));
        const excludedByChainLink = new Set([...directlyExcludedObjectApiNames].filter(objectApiName => lookupsByObjectApiName.has(objectApiName)));
        const noFieldsSelected = new Set([...noFieldsSelectedObjectApiNames].filter(objectApiName => lookupsByObjectApiName.has(objectApiName) && !excludedByChainLink.has(objectApiName)));
        const directlyExcluded = new Set([...excludedByChainLink, ...noFieldsSelected]);

        const parentsByObjectApiName = new Map(objectApiNames.map(objectApiName => [objectApiName, [...new Set(( lookupsByObjectApiName.get(objectApiName) ?? [] )
            .filter(lookup => isTreeParentOf(objectApiName, lookup) && !isRemoved(objectApiName, lookup))
            .map(lookup => lookup.parentObjectApiName))]]));
        const parentsOf = (objectApiName: string) => parentsByObjectApiName.get(objectApiName) ?? [];

        const childrenByParent = new Map<string, string[]>();
        objectApiNames.forEach(objectApiName => parentsOf(objectApiName).forEach(parentObjectApiName => {
            const children = childrenByParent.get(parentObjectApiName);
            if ( children ) {
                children.push(objectApiName);
            } else {
                childrenByParent.set(parentObjectApiName, [objectApiName]);
            }
        }));

        const collectDescendants = (seedObjectApiNames: Iterable<string>, isFollowed: (childObjectApiName: string, parentObjectApiName: string) => boolean) => {
            const descendants = new Set<string>();
            const pending = [...seedObjectApiNames];
            while ( pending.length > 0 ) {
                const parentObjectApiName = pending.pop() as string;
                ( childrenByParent.get(parentObjectApiName) ?? [] ).forEach(childObjectApiName => {
                    if ( !descendants.has(childObjectApiName) && isFollowed(childObjectApiName, parentObjectApiName) ) {
                        descendants.add(childObjectApiName);
                        pending.push(childObjectApiName);
                    }
                });
            }
            return descendants;
        };
        const descendantsOfExcluded = collectDescendants(directlyExcluded, () => true);
        // AN OBJECT A REMOVED LOOKUP TOUCHES IS CUT OFF, DOWN INSERT ORDER ONLY, UNTIL AN INCLUDED PARENT IT KEPT REACHES IT
        const cutByRemovedLookup = collectDescendants(removedTreeLookupFieldsByObject.keys(), (childObjectApiName, parentObjectApiName) => (
            ( insertPositionByObjectApiName.get(parentObjectApiName) as number ) < ( insertPositionByObjectApiName.get(childObjectApiName) as number )
        ));
        [...removedTreeLookupFieldsByObject.keys()].forEach(objectApiName => cutByRemovedLookup.add(objectApiName));

        // THE LEAST SET REACHABLE FROM WHAT THE EXCLUSION DOES NOT TOUCH: TWO OBJECTS CUT OFF TOGETHER DO NOT KEEP EACH OTHER
        const included = new Set(objectApiNames.filter(objectApiName => !directlyExcluded.has(objectApiName)
                                                                        && ( !descendantsOfExcluded.has(objectApiName) || !hasTreeParent.has(objectApiName) )
                                                                        && ( !cutByRemovedLookup.has(objectApiName) || !hasInsertOrderParent.has(objectApiName) )));
        // AN OBJECT WITH ONE INCLUDED PARENT IS INCLUDED: SPREAD FROM WHAT IS INCLUDED, EACH OBJECT ENTERED ONCE
        const pendingIncluded = [...included];
        while ( pendingIncluded.length > 0 ) {
            ( childrenByParent.get(pendingIncluded.pop() as string) ?? [] ).forEach(childObjectApiName => {
                if ( !included.has(childObjectApiName) && !directlyExcluded.has(childObjectApiName) ) {
                    included.add(childObjectApiName);
                    pendingIncluded.push(childObjectApiName);
                }
            });
        }

        const exclusions: IObjectSelectionExclusion[] = objectApiNames
            .filter(objectApiName => !included.has(objectApiName))
            .map(objectApiName => {
                if ( directlyExcluded.has(objectApiName) ) {
                    return { objectApiName: objectApiName, kind: noFieldsSelected.has(objectApiName) ? 'noFieldsSelected' : 'excluded' };
                }
                const [removedLookupFieldApiName] = removedTreeLookupFieldsByObject.get(objectApiName) ?? [];
                if ( parentsOf(objectApiName).length === 0 && removedLookupFieldApiName !== undefined ) {
                    return { objectApiName: objectApiName, kind: 'autoExcluded', removedLookupFieldApiName: removedLookupFieldApiName };
                }
                const [excludedParentObjectApiName] = parentsOf(objectApiName).slice().sort((left, right) => (
                    Number(directlyExcluded.has(right)) - Number(directlyExcluded.has(left)) || ( left < right ? -1 : left > right ? 1 : 0 )
                ));
                return { objectApiName: objectApiName, kind: 'autoExcluded', excludedParentObjectApiName: excludedParentObjectApiName };
            });

        const disabledLookups: IObjectSelectionDisabledLookup[] = objectApiNames
            .filter(objectApiName => included.has(objectApiName))
            .flatMap(objectApiName => ( lookupsByObjectApiName.get(objectApiName) ?? [] )
                .filter(lookup => isTreeParentOf(objectApiName, lookup) && !isRemoved(objectApiName, lookup) && !included.has(lookup.parentObjectApiName))
                .map(lookup => ({ objectApiName: objectApiName, fieldApiName: lookup.fieldApiName, parentObjectApiName: lookup.parentObjectApiName })));

        return {
            exclusions: exclusions,
            disabledLookups: disabledLookups,
            includedObjectCount: included.size,
            objectCount: objectApiNames.length
        };

    }

}
