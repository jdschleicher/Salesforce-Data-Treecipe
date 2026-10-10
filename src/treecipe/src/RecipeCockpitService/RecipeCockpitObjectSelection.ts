/*
    Which objects of one relationship tree the Recipe Cockpit leaves out of generation (#219).

    This file imports NOTHING, like RecipeCockpitMetadataDiff and RecipeCockpitRecipeWriter: the
    cascade is computed on the HOST from what the reader excluded directly, and posted to the panel,
    so the panel never decides what is generated.

    The reader excludes objects directly. Every other object is included unless the exclusion cuts
    it off: an object stays included when it is not a descendant of an excluded object at all, when
    it has no parent in the tree (a root), or when at least one of its parents in the tree is still
    included. A self-lookup is never "another parent" -- the object cannot keep itself. What is
    left is AUTO-excluded, and it is never stored: including the parent again brings back exactly
    what it cut off, while what the reader excluded stays excluded.
*/

export interface IObjectSelectionLookup {
    fieldApiName: string;
    parentObjectApiName: string;
}

export interface IObjectSelectionTreeObject {
    objectApiName: string;
    parentLookups: readonly IObjectSelectionLookup[];
}

export type ObjectSelectionExclusionKind = 'excluded' | 'autoExcluded';

/*
    excludedParentObjectApiName is set on an auto-excluded object: the parent its label names,
    preferring one the reader excluded directly, then the first by "<".
*/
export interface IObjectSelectionExclusion {
    objectApiName: string;
    kind: ObjectSelectionExclusionKind;
    excludedParentObjectApiName?: string;
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

    static computeObjectSelection(treeObjects: readonly IObjectSelectionTreeObject[], directlyExcludedObjectApiNames: Iterable<string>): IObjectSelection {

        const lookupsByObjectApiName = new Map<string, IObjectSelectionLookup[]>();
        treeObjects.forEach(treeObject => {
            const lookups = lookupsByObjectApiName.get(treeObject.objectApiName) ?? [];
            treeObject.parentLookups.forEach(lookup => {
                if ( !lookups.some(known => known.fieldApiName === lookup.fieldApiName && known.parentObjectApiName === lookup.parentObjectApiName) ) {
                    lookups.push(lookup);
                }
            });
            lookupsByObjectApiName.set(treeObject.objectApiName, lookups);
        });

        const objectApiNames = [...lookupsByObjectApiName.keys()];
        const directlyExcluded = new Set([...directlyExcludedObjectApiNames].filter(objectApiName => lookupsByObjectApiName.has(objectApiName)));

        const parentsOf = (objectApiName: string) => [...new Set(( lookupsByObjectApiName.get(objectApiName) ?? [] )
            .map(lookup => lookup.parentObjectApiName)
            .filter(parentObjectApiName => parentObjectApiName !== objectApiName && lookupsByObjectApiName.has(parentObjectApiName)))];

        const childrenByParent = new Map<string, string[]>();
        objectApiNames.forEach(objectApiName => parentsOf(objectApiName).forEach(parentObjectApiName => {
            childrenByParent.set(parentObjectApiName, [...( childrenByParent.get(parentObjectApiName) ?? [] ), objectApiName]);
        }));

        const descendantsOfExcluded = new Set<string>();
        const pending = [...directlyExcluded];
        while ( pending.length > 0 ) {
            ( childrenByParent.get(pending.pop() as string) ?? [] ).forEach(childObjectApiName => {
                if ( !descendantsOfExcluded.has(childObjectApiName) ) {
                    descendantsOfExcluded.add(childObjectApiName);
                    pending.push(childObjectApiName);
                }
            });
        }

        // THE LEAST SET REACHABLE FROM WHAT THE EXCLUSION DOES NOT TOUCH: TWO OBJECTS CUT OFF TOGETHER DO NOT KEEP EACH OTHER
        const included = new Set(objectApiNames.filter(objectApiName => !directlyExcluded.has(objectApiName)
                                                                        && ( !descendantsOfExcluded.has(objectApiName) || parentsOf(objectApiName).length === 0 )));
        let hasGrown = true;
        while ( hasGrown ) {
            hasGrown = false;
            objectApiNames.forEach(objectApiName => {
                if ( !included.has(objectApiName) && !directlyExcluded.has(objectApiName) && parentsOf(objectApiName).some(parentObjectApiName => included.has(parentObjectApiName)) ) {
                    included.add(objectApiName);
                    hasGrown = true;
                }
            });
        }

        const exclusions: IObjectSelectionExclusion[] = objectApiNames
            .filter(objectApiName => !included.has(objectApiName))
            .map(objectApiName => {
                if ( directlyExcluded.has(objectApiName) ) {
                    return { objectApiName: objectApiName, kind: 'excluded' };
                }
                const [excludedParentObjectApiName] = parentsOf(objectApiName).sort((left, right) => (
                    Number(directlyExcluded.has(right)) - Number(directlyExcluded.has(left)) || ( left < right ? -1 : left > right ? 1 : 0 )
                ));
                return { objectApiName: objectApiName, kind: 'autoExcluded', excludedParentObjectApiName: excludedParentObjectApiName };
            });

        const disabledLookups: IObjectSelectionDisabledLookup[] = objectApiNames
            .filter(objectApiName => included.has(objectApiName))
            .flatMap(objectApiName => ( lookupsByObjectApiName.get(objectApiName) ?? [] )
                .filter(lookup => lookup.parentObjectApiName !== objectApiName && lookupsByObjectApiName.has(lookup.parentObjectApiName) && !included.has(lookup.parentObjectApiName))
                .map(lookup => ({ objectApiName: objectApiName, fieldApiName: lookup.fieldApiName, parentObjectApiName: lookup.parentObjectApiName })));

        return {
            exclusions: exclusions,
            disabledLookups: disabledLookups,
            includedObjectCount: included.size,
            objectCount: objectApiNames.length
        };

    }

}
