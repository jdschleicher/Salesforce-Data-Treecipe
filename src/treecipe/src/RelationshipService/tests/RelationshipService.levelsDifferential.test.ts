import { RelationshipService } from '../RelationshipService';
import { RelationshipDetail } from '../../ObjectInfoWrapper/RelationshipTypes';
import { ObjectInfo } from '../../ObjectInfoWrapper/ObjectInfo';
import { ObjectInfoWrapper } from '../../ObjectInfoWrapper/ObjectInfoWrapper';

/*
    #104 replaced a walk that re-visited an object once per PATH reaching it with one that visits
    it once. For a graph with no cycle the two must agree on every level, because those levels
    decide which Treecipe file an object lands in and in what insert order. The walk below is the
    one #104 replaced, kept here only as the reference for acyclic graphs; it is exponential, so
    the graphs are small.
*/
class PathByPathLevelReference {

    static calculateLevels(objectInfoWrapper: ObjectInfoWrapper): void {

        const objectInfos = Object.entries(objectInfoWrapper.ObjectToObjectInfoMap);

        for (const [objectName, objectInfo] of objectInfos) {
            const parentObjectNames = Object.keys(objectInfo.RelationshipDetail.parentObjectToFieldReferences);
            const isRoot = parentObjectNames.every(parentObjectName => parentObjectName === objectName);
            if (!objectInfo.RelationshipDetail.isProcessed && isRoot) {
                this.walkEveryPath(objectInfoWrapper, objectName, 0, new Set<string>());
            }
        }

        for (const [objectName, objectInfo] of objectInfos) {
            if (!objectInfo.RelationshipDetail.isProcessed) {
                this.walkEveryPath(objectInfoWrapper, objectName, 0, new Set<string>());
            }
        }

    }

    private static walkEveryPath(objectInfoWrapper: ObjectInfoWrapper, objectName: string, proposedLevel: number, objectNamesOnPath: Set<string>): void {

        const relationshipDetail = objectInfoWrapper.ObjectToObjectInfoMap[objectName]?.RelationshipDetail;
        if (!relationshipDetail || objectNamesOnPath.has(objectName)) {
            return;
        }

        relationshipDetail.level = Math.max(relationshipDetail.level, proposedLevel);
        relationshipDetail.isProcessed = true;

        objectNamesOnPath.add(objectName);
        for (const childObjectName of Object.keys(relationshipDetail.childObjectToFieldReferences)) {
            if (childObjectName !== objectName) {
                this.walkEveryPath(objectInfoWrapper, childObjectName, relationshipDetail.level + 1, objectNamesOnPath);
            }
        }
        objectNamesOnPath.delete(objectName);

    }

}

type Lookup = { childObjectName: string; parentObjectName: string };

function buildObjectInfoWrapper(objectNames: string[], lookups: Lookup[]): ObjectInfoWrapper {

    const objectInfoWrapper = new ObjectInfoWrapper();
    objectNames.forEach(objectName => {
        const objectInfo = new ObjectInfo(objectName);
        objectInfo.RelationshipDetail = new RelationshipService().buildNewRelationshipDetail(objectName);
        objectInfoWrapper.ObjectToObjectInfoMap[objectName] = objectInfo;
    });

    lookups.forEach(({ childObjectName, parentObjectName }) => {
        objectInfoWrapper.ObjectToObjectInfoMap[parentObjectName].RelationshipDetail.childObjectToFieldReferences[childObjectName] = [`${parentObjectName}__c`];
        objectInfoWrapper.ObjectToObjectInfoMap[childObjectName].RelationshipDetail.parentObjectToFieldReferences[parentObjectName] = [`${parentObjectName}__c`];
    });

    return objectInfoWrapper;

}

function levelsOf(objectInfoWrapper: ObjectInfoWrapper): Record<string, number> {
    return Object.fromEntries(
        Object.entries(objectInfoWrapper.ObjectToObjectInfoMap).map(([objectName, objectInfo]) => [objectName, (objectInfo.RelationshipDetail as RelationshipDetail).level])
    );
}

// mulberry32: a seeded generator, so a failing graph is the same graph on every run
function seededRandom(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state + 0x6D2B79F5) | 0;
        let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

/*
    A random acyclic graph: objects are given a hidden rank, and a lookup only ever points from a
    higher rank to a lower one. Names are shuffled against the rank, and the map is filled in
    shuffled order, so neither name order nor map order lines up with the hierarchy.
*/
function buildRandomAcyclicGraph(random: () => number): { objectNames: string[]; lookups: Lookup[] } {

    const objectCount = 2 + Math.floor(random() * 11);
    const lookupChance = 0.1 + random() * 0.4;
    const shuffle = <T>(items: T[]): T[] => {
        for (let index = items.length - 1; index > 0; index--) {
            const swapIndex = Math.floor(random() * (index + 1));
            [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
        }
        return items;
    };

    const objectNamesInRankOrder = shuffle(Array.from({ length: objectCount }, (_, index) => `Object_${index}__c`));
    const lookups: Lookup[] = [];
    for (let childRank = 1; childRank < objectCount; childRank++) {
        for (let parentRank = 0; parentRank < childRank; parentRank++) {
            if (random() < lookupChance) {
                lookups.push({ childObjectName: objectNamesInRankOrder[childRank], parentObjectName: objectNamesInRankOrder[parentRank] });
            }
        }
    }

    return { objectNames: shuffle([...objectNamesInRankOrder]), lookups: shuffle(lookups) };

}

describe('relationship levels of an acyclic graph are the ones the path-by-path walk gave (#104)', () => {

    test('600 seeded random acyclic graphs: every object keeps its level', () => {

        const random = seededRandom(104);

        for (let graphIndex = 0; graphIndex < 600; graphIndex++) {

            const { objectNames, lookups } = buildRandomAcyclicGraph(random);

            const referenceWrapper = buildObjectInfoWrapper(objectNames, lookups);
            PathByPathLevelReference.calculateLevels(referenceWrapper);

            const objectInfoWrapper = buildObjectInfoWrapper(objectNames, lookups);
            (new RelationshipService() as any).calculateRelationshipLevels(objectInfoWrapper, new Set(objectNames));

            expect({ graphIndex, levels: levelsOf(objectInfoWrapper) }).toEqual({ graphIndex, levels: levelsOf(referenceWrapper) });

        }

    });

});
