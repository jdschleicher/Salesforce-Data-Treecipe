import { RecipeCockpitQuery } from './RecipeCockpitQuery';
import { SalesforceApiName } from '../SalesforceApiName/SalesforceApiName';
import { RECIPE_COCKPIT_UPDATER_WHERE_MAX_LENGTH } from './RecipeCockpitAdapterConstants';

// THE PANEL HOLDS A WHERE TO THE SAME LIMIT, SO IT LIVES IN AN IMPORT-FREE FILE (#657)
export { RECIPE_COCKPIT_UPDATER_WHERE_MAX_LENGTH };

// A WHERE THE READER STARTED WITH THE KEYWORD ITSELF; THE QUERY ADDS IT
const LEADING_WHERE_KEYWORD_PATTERN = /^where\s+/i;

// FOR VIEW AND FOR REFERENCE STAMP THE RECORDS AS VIEWED, AND FOR UPDATE LOCKS THEM: A LOAD ONLY READS
const RECORD_TOUCHING_CLAUSE_PATTERN = /\bfor\s+(view|reference|update)\b/i;

// A QUOTED VALUE, SO A CLAUSE NAMED INSIDE ONE IS NOT TAKEN FOR THE CLAUSE ITSELF
const QUOTED_VALUE_PATTERN = /'(?:[^'\\]|\\.)*'/g;

/*
    How many parent Ids one child query names (#444): 150 Ids are about 3,300 characters, under
    the 4,000 a WHERE clause was once held to, so a large load is many short queries rather than
    one the org refuses.
*/
export const RECIPE_COCKPIT_UPDATER_PARENT_ID_CHUNK_SIZE = 150;

/*
    How long one load query may be once it is URL-encoded (#720). The connection sends SOQL in the
    address of a GET, and an org refuses an address past about 16,000 characters with an HTTP error
    that names no cause. Reading every recipe field makes a long SELECT likely, so a child's Ids go
    in smaller parts to fit, and a SELECT too long even with one Id is that object's failure, said
    in words.
*/
export const RECIPE_COCKPIT_UPDATER_QUERY_ENCODED_MAX_LENGTH = 14000;

const SALESFORCE_RECORD_ID_PATTERN = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;

// A WELL-FORMED Id THE QUERY IS CHECKED WITH BEFORE ANY RECORD IS READ, SO A WHERE THE ORG WOULD NEVER SEE IS REFUSED UP FRONT
const PLACEHOLDER_RECORD_ID = '000000000000000AAA';

export interface IRecipeCockpitUpdaterTreeLookup {
    fieldApiName: string;
    parentObjectApiName: string;
}

/*
    One object of a card as the Treecipe Adapter reads it (#416): the fields the model lists for it
    and the lookups to parents in the SAME tree, which a later slice relates records by.
*/
export interface IRecipeCockpitUpdaterTreeObject {
    objectApiName: string;
    fieldApiNames: readonly string[];
    // THE LOOKUPS TO PARENTS IN THE TREE, THEN THE OBJECT'S OTHER LOOKUP FIELDS (#720): THE COLUMNS AFTER Id
    lookupFieldApiNames: readonly string[];
    // THE TREE'S LOOKUPS WITH THE PARENT EACH NAMES, A SELF-LOOKUP INCLUDED (#444)
    treeLookups: readonly IRecipeCockpitUpdaterTreeLookup[];
}

// ONE OBJECT THE PANEL ASKED TO LOAD, ONCE CHECKED AGAINST THE CARD ON SCREEN; ITS FIELDS ARE THE TREE'S, NEVER THE PANEL'S (#720)
export interface IRecipeCockpitUpdaterObjectRequest {
    objectApiName: string;
    fieldApiNames: string[];
    whereClause: string;
    // EVERY OBJECT BELOW THE PARENT (#444): ITS LOOKUP TO THE LEVEL ABOVE, WHOSE LOADED Ids ITS RECORDS ARE NARROWED TO
    narrowingLookup?: IRecipeCockpitUpdaterTreeLookup;
}

// ONE OBJECT OF A LOAD'S PLAN (#444): HOW FAR BELOW THE PARENT, AND THE LOOKUP ITS RECORDS ARE NARROWED BY
export interface IRecipeCockpitUpdaterLoadStep {
    objectApiName: string;
    depth: number;
    narrowingLookup?: IRecipeCockpitUpdaterTreeLookup;
}

export type RecipeCockpitUpdaterNarrowedQueriesBuild = { queries: string[] } | { refusal: string };

export interface IRecipeCockpitUpdaterObjectQuery {
    objectApiName: string;
    query: string;
}

export type RecipeCockpitUpdaterRequestRead = { requests: IRecipeCockpitUpdaterObjectRequest[] } | { refusal: string };

export type RecipeCockpitUpdaterQueryBuild = { objectQuery: IRecipeCockpitUpdaterObjectQuery } | { refusal: string };

/*
    The Treecipe Adapter's load (#416): one SELECT per tree object, built from the TREE -- the
    record Id, its lookups and every field its recipe lists (#720) -- never from the SOQL
    templates. Everything the panel posts is matched against the card the host drew; the WHERE
    clause is the reader's own text and is held to the Query tab's one-SELECT rule once the query is
    whole. Imports no vscode.
*/
export class RecipeCockpitTreeUpdaterQuery {

    /*
        Each object of a card once (an iteration is the same object), in the card's order, with the
        fields its model lists, its lookups to parents the card also lists and, after those, the
        other fields of it that are lookups.
    */
    static listTreeObjects(treeObjects: readonly { objectApiName: string; parentLookups: readonly { fieldApiName: string; parentObjectApiName: string }[]; iterationNickname?: string }[],
                            fieldApiNamesByObjectApiName: ReadonlyMap<string, readonly string[]>,
                            otherLookupFieldApiNamesByObjectApiName?: ReadonlyMap<string, readonly string[]>): IRecipeCockpitUpdaterTreeObject[] {

        const treeObjectApiNames = new Set(treeObjects.map(treeObject => treeObject.objectApiName));
        const listedObjectApiNames = new Set<string>();
        const updaterTreeObjects: IRecipeCockpitUpdaterTreeObject[] = [];

        treeObjects.forEach(treeObject => {

            const fieldApiNames = fieldApiNamesByObjectApiName.get(treeObject.objectApiName);

            if ( treeObject.iterationNickname !== undefined || listedObjectApiNames.has(treeObject.objectApiName) || !fieldApiNames ) {
                return;
            }

            listedObjectApiNames.add(treeObject.objectApiName);
            const treeLookups = treeObject.parentLookups
                .filter(parentLookup => treeObjectApiNames.has(parentLookup.parentObjectApiName))
                .map(parentLookup => ({ fieldApiName: parentLookup.fieldApiName, parentObjectApiName: parentLookup.parentObjectApiName }));
            updaterTreeObjects.push({
                objectApiName: treeObject.objectApiName,
                fieldApiNames: fieldApiNames,
                lookupFieldApiNames: [...new Set([
                    ...treeLookups.map(treeLookup => treeLookup.fieldApiName),
                    ...( otherLookupFieldApiNamesByObjectApiName?.get(treeObject.objectApiName) ?? [] )
                ])],
                treeLookups: treeLookups
            });

        });

        return updaterTreeObjects;

    }

    /*
        The panel's request, untrusted: a list of objects the card lists, each at most once, each
        with a WHERE clause of bounded text. Anything else refuses the WHOLE request rather than
        loading part of what was asked for. The fields read are every field the tree lists for the
        object (#720): a field list the panel posts is not read.
    */
    static readRequest(candidateObjects: unknown, treeObjects: readonly IRecipeCockpitUpdaterTreeObject[], candidateParentObjectApiName: unknown): RecipeCockpitUpdaterRequestRead {

        const loadPlan = typeof candidateParentObjectApiName === 'string' ? this.planLoad(treeObjects, candidateParentObjectApiName) : undefined;

        if ( !loadPlan ) {
            return { refusal: 'The parent object is not an object of this treecipe.' };
        }

        if ( !Array.isArray(candidateObjects) || candidateObjects.length !== loadPlan.length ) {
            return { refusal: 'The objects to load are not the parent and the objects under it.' };
        }

        const treeObjectsByApiName = new Map(treeObjects.map(treeObject => [treeObject.objectApiName, treeObject] as const));
        const requestedObjectApiNames = new Set<string>();
        const requests: IRecipeCockpitUpdaterObjectRequest[] = [];

        for ( const candidateObject of candidateObjects ) {

            if ( !candidateObject || typeof candidateObject !== 'object' || Array.isArray(candidateObject) ) {
                return { refusal: 'The objects to load are not the objects of this treecipe.' };
            }

            const { objectApiName, whereClause } = candidateObject as Record<string, unknown>;
            const treeObject = typeof objectApiName === 'string' ? treeObjectsByApiName.get(objectApiName) : undefined;

            if ( !treeObject || requestedObjectApiNames.has(treeObject.objectApiName) || !loadPlan.some(loadStep => loadStep.objectApiName === treeObject.objectApiName) ) {
                return { refusal: 'The objects to load are not the parent and the objects under it.' };
            }

            if ( whereClause !== undefined && ( typeof whereClause !== 'string' || whereClause.length > RECIPE_COCKPIT_UPDATER_WHERE_MAX_LENGTH ) ) {
                return { refusal: `The WHERE clause for ${treeObject.objectApiName} is longer than ${RECIPE_COCKPIT_UPDATER_WHERE_MAX_LENGTH} characters.` };
            }

            requestedObjectApiNames.add(treeObject.objectApiName);
            requests.push({
                objectApiName: treeObject.objectApiName,
                fieldApiNames: [...treeObject.fieldApiNames],
                whereClause: typeof whereClause === 'string' ? whereClause : ''
            });

        }

        // IN THE PLAN'S ORDER, A LEVEL AT A TIME, SO EVERY OBJECT IS READ AFTER THE LEVEL IT IS NARROWED TO
        return {
            requests: loadPlan.map(loadStep => {
                const request = requests.find(candidateRequest => candidateRequest.objectApiName === loadStep.objectApiName) as IRecipeCockpitUpdaterObjectRequest;
                return loadStep.narrowingLookup ? { ...request, narrowingLookup: loadStep.narrowingLookup } : request;
            })
        };

    }

    /*
        The parent and every object whose lookups lead up to it (#444): the same objects the
        Adapter's step 2 draws, found breadth-first, a self-lookup never followed. Each is then
        placed once every parent it has among them is placed, and narrowed by its lookup to the
        DEEPEST of those parents (the first it lists on a tie), so its records are only those under
        the closest records already loaded, as generation nests an object under its closest parent
        (#46). An object in a lookup cycle is placed under the deepest parent already placed.
        Undefined for a parent the card does not list.
    */
    static planLoad(treeObjects: readonly IRecipeCockpitUpdaterTreeObject[], parentObjectApiName: string): IRecipeCockpitUpdaterLoadStep[] | undefined {

        if ( !treeObjects.some(treeObject => treeObject.objectApiName === parentObjectApiName) ) {
            return undefined;
        }

        const parentLookupsOf = (treeObject: IRecipeCockpitUpdaterTreeObject) => treeObject.treeLookups.filter(treeLookup => treeLookup.parentObjectApiName !== treeObject.objectApiName);

        const subtreeObjectApiNames = new Set<string>([parentObjectApiName]);
        for ( let isGrowing = true; isGrowing; ) {
            isGrowing = false;
            treeObjects.forEach(treeObject => {
                if ( !subtreeObjectApiNames.has(treeObject.objectApiName)
                        && parentLookupsOf(treeObject).some(treeLookup => subtreeObjectApiNames.has(treeLookup.parentObjectApiName)) ) {
                    subtreeObjectApiNames.add(treeObject.objectApiName);
                    isGrowing = true;
                }
            });
        }

        const depthByObjectApiName = new Map<string, number>([[parentObjectApiName, 0]]);
        const loadPlan: IRecipeCockpitUpdaterLoadStep[] = [{ objectApiName: parentObjectApiName, depth: 0 }];
        const unplacedObjects = treeObjects.filter(treeObject => treeObject.objectApiName !== parentObjectApiName && subtreeObjectApiNames.has(treeObject.objectApiName));

        const placeUnderDeepestPlacedParent = (treeObject: IRecipeCockpitUpdaterTreeObject) => {
            const placedLookups = parentLookupsOf(treeObject).filter(treeLookup => depthByObjectApiName.has(treeLookup.parentObjectApiName));
            const narrowingLookup = placedLookups.reduce((deepestLookup, treeLookup) =>
                depthByObjectApiName.get(treeLookup.parentObjectApiName) > depthByObjectApiName.get(deepestLookup.parentObjectApiName) ? treeLookup : deepestLookup);
            const depth = depthByObjectApiName.get(narrowingLookup.parentObjectApiName) + 1;
            depthByObjectApiName.set(treeObject.objectApiName, depth);
            loadPlan.push({ objectApiName: treeObject.objectApiName, depth: depth, narrowingLookup: { ...narrowingLookup } });
            unplacedObjects.splice(unplacedObjects.indexOf(treeObject), 1);
        };

        while ( unplacedObjects.length > 0 ) {

            const readyObject = unplacedObjects.find(treeObject => parentLookupsOf(treeObject).every(treeLookup =>
                !subtreeObjectApiNames.has(treeLookup.parentObjectApiName) || depthByObjectApiName.has(treeLookup.parentObjectApiName)));

            // A CYCLE: NO OBJECT HAS EVERY PARENT PLACED, SO THE FIRST WITH ANY PLACED PARENT GOES NEXT
            placeUnderDeepestPlacedParent(readyObject
                ?? unplacedObjects.find(treeObject => parentLookupsOf(treeObject).some(treeLookup => depthByObjectApiName.has(treeLookup.parentObjectApiName))));

        }

        return loadPlan;
    }

    /*
        The queries that read one object below the parent (#444): its SELECT with WHERE
        (<reader's WHERE>) AND <lookup> IN (<Ids loaded a level above>), the Ids in chunks of
        RECIPE_COCKPIT_UPDATER_PARENT_ID_CHUNK_SIZE, each Id held to the Salesforce Id pattern before
        it is quoted and each query to buildObjectQuery's checks. No Ids is no query. The reader's
        WHERE must balance its parentheses outside quoted values, or it could close the group and
        undo the narrowing.
    */
    static buildNarrowedQueries(treeObject: IRecipeCockpitUpdaterTreeObject,
                                request: IRecipeCockpitUpdaterObjectRequest,
                                parentRecordIds: readonly string[]): RecipeCockpitUpdaterNarrowedQueriesBuild {

        const narrowingLookup = request.narrowingLookup;

        if ( !narrowingLookup || !treeObject.treeLookups.some(treeLookup => treeLookup.fieldApiName === narrowingLookup.fieldApiName) ) {
            return { refusal: `${treeObject.objectApiName} has no lookup to the records above it.` };
        }

        if ( !SalesforceApiName.isApiName(narrowingLookup.fieldApiName) ) {
            return { refusal: `${treeObject.objectApiName}.${narrowingLookup.fieldApiName} is not a field api name.` };
        }

        if ( parentRecordIds.some(parentRecordId => !SALESFORCE_RECORD_ID_PATTERN.test(parentRecordId)) ) {
            return { refusal: `One of the ${narrowingLookup.parentObjectApiName} record Ids the org answered with is not a record Id.` };
        }

        const readerWhereClause = request.whereClause.trim().replace(LEADING_WHERE_KEYWORD_PATTERN, '').trim();

        if ( !this.isParenthesesBalanced(readerWhereClause) ) {
            return { refusal: `The WHERE for ${treeObject.objectApiName} does not close every parenthesis it opens.` };
        }

        const uniqueParentRecordIds = [...new Set(parentRecordIds)];
        const queries: string[] = [];
        const idChunkSize = this.fitParentIdChunkSize(treeObject, request, readerWhereClause, narrowingLookup.fieldApiName, uniqueParentRecordIds[0]);

        for ( let chunkStart = 0; chunkStart < uniqueParentRecordIds.length; chunkStart += idChunkSize ) {

            const idList = uniqueParentRecordIds.slice(chunkStart, chunkStart + idChunkSize).map(parentRecordId => `'${parentRecordId}'`).join(', ');
            const narrowingClause = `${narrowingLookup.fieldApiName} IN (${idList})`;
            const queryBuild = this.buildObjectQuery(treeObject, {
                objectApiName: request.objectApiName,
                fieldApiNames: request.fieldApiNames,
                whereClause: readerWhereClause ? `(${readerWhereClause}) AND ${narrowingClause}` : narrowingClause
            });

            if ( 'refusal' in queryBuild ) {
                return queryBuild;
            }

            queries.push(queryBuild.objectQuery.query);

        }

        return { queries: queries };

    }

    // HOW MANY PARENT Ids A CHILD QUERY NAMES: THE USUAL CHUNK, OR FEWER WHEN ITS SELECT IS LONG, SO THE ENCODED QUERY STAYS WITHIN WHAT AN ORG ACCEPTS
    private static fitParentIdChunkSize(treeObject: IRecipeCockpitUpdaterTreeObject, request: IRecipeCockpitUpdaterObjectRequest,
                                        readerWhereClause: string, narrowingFieldApiName: string, sampleParentRecordId: string | undefined): number {

        if ( sampleParentRecordId === undefined ) {
            return RECIPE_COCKPIT_UPDATER_PARENT_ID_CHUNK_SIZE;
        }

        const selectText = `SELECT ${this.listSelectedFieldApiNames(treeObject, request.fieldApiNames).join(', ')} FROM ${treeObject.objectApiName} WHERE (${readerWhereClause}) AND ${narrowingFieldApiName} IN ()`;
        const encodedLengthLeft = RECIPE_COCKPIT_UPDATER_QUERY_ENCODED_MAX_LENGTH - encodeURIComponent(selectText).length;
        const encodedLengthPerId = encodeURIComponent(`'${sampleParentRecordId}', `).length;

        return Math.max(1, Math.min(RECIPE_COCKPIT_UPDATER_PARENT_ID_CHUNK_SIZE, Math.floor(encodedLengthLeft / encodedLengthPerId)));

    }

    // WHY AN OBJECT'S QUERIES CANNOT BE SENT AS THEY ARE, OR undefined: ONE OF THEM IS LONGER, ENCODED, THAN AN ORG ACCEPTS IN ONE REQUEST
    static findTooLongQueryReason(treeObject: IRecipeCockpitUpdaterTreeObject, request: IRecipeCockpitUpdaterObjectRequest, queries: readonly string[]): string | undefined {

        const longestEncodedLength = Math.max(0, ...queries.map(query => encodeURIComponent(query).length));

        if ( longestEncodedLength <= RECIPE_COCKPIT_UPDATER_QUERY_ENCODED_MAX_LENGTH ) {
            return undefined;
        }

        const fieldCount = this.listSelectedFieldApiNames(treeObject, request.fieldApiNames).length;
        return `its query names ${fieldCount} fields and is ${longestEncodedLength} characters once sent, more than the ${RECIPE_COCKPIT_UPDATER_QUERY_ENCODED_MAX_LENGTH} an org accepts in one request. On the Treecipe tab, use Customize and create new recipe to make a treecipe without the ${treeObject.objectApiName} fields you do not need, and load from that.`;

    }

    // WHETHER A REQUEST'S QUERIES CAN BE BUILT, CHECKED WITH ONE PLACEHOLDER Id BEFORE ANY RECORD IS READ
    static checkRequestQuery(treeObject: IRecipeCockpitUpdaterTreeObject, request: IRecipeCockpitUpdaterObjectRequest): { refusal: string } | undefined {

        const queryBuild = request.narrowingLookup
            ? this.buildNarrowedQueries(treeObject, request, [PLACEHOLDER_RECORD_ID])
            : this.buildObjectQuery(treeObject, request);

        return 'refusal' in queryBuild ? queryBuild : undefined;

    }

    private static isParenthesesBalanced(whereClause: string): boolean {

        let depth = 0;

        for ( const character of whereClause.replace(QUOTED_VALUE_PATTERN, "''") ) {
            if ( character === '(' ) { depth++; }
            if ( character === ')' && --depth < 0 ) { return false; }
        }

        return depth === 0;

    }

    // WHAT A LOAD SELECTS, WHICH IS ALSO ITS TABLE'S COLUMNS (#720): Id, THE LOOKUPS, THEN THE OTHER FIELDS IN RECIPE ORDER, EACH ONCE WHATEVER ITS CASE
    static listSelectedFieldApiNames(treeObject: IRecipeCockpitUpdaterTreeObject, fieldApiNames: readonly string[]): string[] {

        const selectedLowerCaseNames = new Set<string>();

        return ['Id', ...treeObject.lookupFieldApiNames, ...fieldApiNames].filter(fieldApiName => {
            const isFirstOfItsName = !selectedLowerCaseNames.has(fieldApiName.toLowerCase());
            selectedLowerCaseNames.add(fieldApiName.toLowerCase());
            return isFirstOfItsName;
        });

    }

    /*
        A field the org does not describe to this user -- one it lacks, or one the user may not
        read -- fails the WHOLE query, so it is left out and named (#720). The tree's own lookups
        stay in treeLookups: a narrowing lookup the org lacks is that object's failure, as before.
    */
    static leaveOutUnreadFields(treeObject: IRecipeCockpitUpdaterTreeObject,
                                request: IRecipeCockpitUpdaterObjectRequest,
                                describedFieldApiNames: readonly string[]): { treeObject: IRecipeCockpitUpdaterTreeObject; request: IRecipeCockpitUpdaterObjectRequest; unreadFieldApiNames: string[] } {

        const describedLowerCaseNames = new Set(describedFieldApiNames.map(fieldApiName => fieldApiName.toLowerCase()));
        const isDescribed = (fieldApiName: string) => describedLowerCaseNames.has(fieldApiName.toLowerCase());

        return {
            treeObject: { ...treeObject, lookupFieldApiNames: treeObject.lookupFieldApiNames.filter(isDescribed) },
            request: { ...request, fieldApiNames: request.fieldApiNames.filter(isDescribed) },
            unreadFieldApiNames: this.listSelectedFieldApiNames(treeObject, request.fieldApiNames).filter(fieldApiName => fieldApiName !== 'Id' && !isDescribed(fieldApiName))
        };

    }

    /*
        SELECT Id, <lookups>, <every other recipe field> FROM <Object> [WHERE …]. Every name is
        held to SalesforceApiName (one that fails refuses the object, since a name reaching the
        query unchecked is how text other than a field gets into it), a field is selected once
        whatever its case, and the whole query must pass the Query tab's checkQueryText.
    */
    static buildObjectQuery(treeObject: IRecipeCockpitUpdaterTreeObject, request: IRecipeCockpitUpdaterObjectRequest): RecipeCockpitUpdaterQueryBuild {

        if ( !SalesforceApiName.isApiName(treeObject.objectApiName) ) {
            return { refusal: `${treeObject.objectApiName} is not an object api name.` };
        }

        const selectedFieldApiNames = this.listSelectedFieldApiNames(treeObject, request.fieldApiNames);
        const unusableFieldApiName = selectedFieldApiNames.find(fieldApiName => !SalesforceApiName.isApiName(fieldApiName));

        if ( unusableFieldApiName !== undefined ) {
            return { refusal: `${treeObject.objectApiName}.${unusableFieldApiName} is not a field api name.` };
        }

        const whereClause = request.whereClause.trim().replace(LEADING_WHERE_KEYWORD_PATTERN, '').trim();

        if ( RECORD_TOUCHING_CLAUSE_PATTERN.test(whereClause.replace(QUOTED_VALUE_PATTERN, "''")) ) {
            return { refusal: `The WHERE for ${treeObject.objectApiName} holds FOR VIEW, FOR REFERENCE or FOR UPDATE, which change or lock records, and a load only reads.` };
        }

        const queryText = `SELECT ${selectedFieldApiNames.join(', ')} FROM ${treeObject.objectApiName}${whereClause ? ` WHERE ${whereClause}` : ''}`;
        const queryCheck = RecipeCockpitQuery.checkQueryText(queryText);

        if ( 'refusal' in queryCheck ) {
            return { refusal: `The query for ${treeObject.objectApiName} was not sent: ${queryCheck.refusal}` };
        }

        return { objectQuery: { objectApiName: treeObject.objectApiName, query: queryCheck.query } };

    }

}
