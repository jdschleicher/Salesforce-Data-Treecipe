import { RecipeCockpitQuery } from './RecipeCockpitQuery';
import { SalesforceApiName } from '../RecipeService/SalesforceApiName';

// HOW LONG A WHERE CLAUSE THE READER TYPES FOR ONE OBJECT MAY BE
export const RECIPE_COCKPIT_UPDATER_WHERE_MAX_LENGTH = 4000;

// A WHERE THE READER STARTED WITH THE KEYWORD ITSELF; THE QUERY ADDS IT
const LEADING_WHERE_KEYWORD_PATTERN = /^where\s+/i;

// FOR VIEW AND FOR REFERENCE STAMP THE RECORDS AS VIEWED, AND FOR UPDATE LOCKS THEM: A LOAD ONLY READS
const RECORD_TOUCHING_CLAUSE_PATTERN = /\bfor\s+(view|reference|update)\b/i;

// A QUOTED VALUE, SO A CLAUSE NAMED INSIDE ONE IS NOT TAKEN FOR THE CLAUSE ITSELF
const QUOTED_VALUE_PATTERN = /'(?:[^'\\]|\\.)*'/g;

/*
    One object of a card as the Treecipe Updater reads it (#416): the fields the model lists for it
    and the lookups to parents in the SAME tree, which a later slice relates records by.
*/
export interface IRecipeCockpitUpdaterTreeObject {
    objectApiName: string;
    fieldApiNames: readonly string[];
    lookupFieldApiNames: readonly string[];
}

// WHAT THE PANEL ASKED TO LOAD FOR ONE OBJECT, ONCE CHECKED AGAINST THE CARD ON SCREEN
export interface IRecipeCockpitUpdaterObjectRequest {
    objectApiName: string;
    fieldApiNames: string[];
    whereClause: string;
}

export interface IRecipeCockpitUpdaterObjectQuery {
    objectApiName: string;
    query: string;
}

export type RecipeCockpitUpdaterRequestRead = { requests: IRecipeCockpitUpdaterObjectRequest[] } | { refusal: string };

export type RecipeCockpitUpdaterQueryBuild = { objectQuery: IRecipeCockpitUpdaterObjectQuery } | { refusal: string };

/*
    The Treecipe Updater's load (#416): one SELECT per tree object, built from the TREE -- the
    record Id, the lookups to parents in the tree and the fields the reader chose -- never from the
    SOQL templates. Everything the panel posts is matched against the card the host drew; the WHERE
    clause is the reader's own text and is held to the Query tab's one-SELECT rule once the query is
    whole. Imports no vscode.
*/
export class RecipeCockpitTreeUpdaterQuery {

    /*
        Each object of a card once (an iteration is the same object), in the card's order, with the
        fields its model lists and its lookups to parents the card also lists.
    */
    static listTreeObjects(treeObjects: readonly { objectApiName: string; parentLookups: readonly { fieldApiName: string; parentObjectApiName: string }[]; iterationNickname?: string }[],
                            fieldApiNamesByObjectApiName: ReadonlyMap<string, readonly string[]>): IRecipeCockpitUpdaterTreeObject[] {

        const treeObjectApiNames = new Set(treeObjects.map(treeObject => treeObject.objectApiName));
        const listedObjectApiNames = new Set<string>();
        const updaterTreeObjects: IRecipeCockpitUpdaterTreeObject[] = [];

        treeObjects.forEach(treeObject => {

            const fieldApiNames = fieldApiNamesByObjectApiName.get(treeObject.objectApiName);

            if ( treeObject.iterationNickname !== undefined || listedObjectApiNames.has(treeObject.objectApiName) || !fieldApiNames ) {
                return;
            }

            listedObjectApiNames.add(treeObject.objectApiName);
            updaterTreeObjects.push({
                objectApiName: treeObject.objectApiName,
                fieldApiNames: fieldApiNames,
                lookupFieldApiNames: treeObject.parentLookups
                    .filter(parentLookup => treeObjectApiNames.has(parentLookup.parentObjectApiName))
                    .map(parentLookup => parentLookup.fieldApiName)
            });

        });

        return updaterTreeObjects;

    }

    /*
        The panel's request, untrusted: a list of objects the card lists, each at most once, each
        naming only fields its model lists, each field once, and a WHERE clause of bounded text.
        Anything else refuses the WHOLE request rather than loading part of what was asked for.
    */
    static readRequest(candidateObjects: unknown, treeObjects: readonly IRecipeCockpitUpdaterTreeObject[]): RecipeCockpitUpdaterRequestRead {

        if ( !Array.isArray(candidateObjects) || candidateObjects.length === 0 || candidateObjects.length > treeObjects.length ) {
            return { refusal: 'The objects to load are not the objects of this treecipe.' };
        }

        const treeObjectsByApiName = new Map(treeObjects.map(treeObject => [treeObject.objectApiName, treeObject] as const));
        const requestedObjectApiNames = new Set<string>();
        const requests: IRecipeCockpitUpdaterObjectRequest[] = [];

        for ( const candidateObject of candidateObjects ) {

            if ( !candidateObject || typeof candidateObject !== 'object' || Array.isArray(candidateObject) ) {
                return { refusal: 'The objects to load are not the objects of this treecipe.' };
            }

            const { objectApiName, fieldApiNames, whereClause } = candidateObject as Record<string, unknown>;
            const treeObject = typeof objectApiName === 'string' ? treeObjectsByApiName.get(objectApiName) : undefined;

            if ( !treeObject || requestedObjectApiNames.has(treeObject.objectApiName) ) {
                return { refusal: 'The objects to load are not the objects of this treecipe.' };
            }

            if ( !Array.isArray(fieldApiNames)
                    || fieldApiNames.some(fieldApiName => typeof fieldApiName !== 'string' || !treeObject.fieldApiNames.includes(fieldApiName))
                    || new Set(fieldApiNames).size !== fieldApiNames.length ) {
                return { refusal: `The fields chosen on ${treeObject.objectApiName} are not fields of it.` };
            }

            if ( whereClause !== undefined && ( typeof whereClause !== 'string' || whereClause.length > RECIPE_COCKPIT_UPDATER_WHERE_MAX_LENGTH ) ) {
                return { refusal: `The WHERE clause for ${treeObject.objectApiName} is longer than ${RECIPE_COCKPIT_UPDATER_WHERE_MAX_LENGTH} characters.` };
            }

            requestedObjectApiNames.add(treeObject.objectApiName);
            requests.push({
                objectApiName: treeObject.objectApiName,
                fieldApiNames: fieldApiNames as string[],
                whereClause: typeof whereClause === 'string' ? whereClause : ''
            });

        }

        return { requests: requests };

    }

    /*
        SELECT Id, <lookups to parents in the tree>, <chosen fields> FROM <Object> [WHERE …]. Every
        name is held to SalesforceApiName (one that fails refuses the object, since a name reaching
        the query unchecked is how text other than a field gets into it), a field is selected once
        whatever its case, and the whole query must pass the Query tab's checkQueryText.
    */
    static buildObjectQuery(treeObject: IRecipeCockpitUpdaterTreeObject, request: IRecipeCockpitUpdaterObjectRequest): RecipeCockpitUpdaterQueryBuild {

        if ( !SalesforceApiName.isApiName(treeObject.objectApiName) ) {
            return { refusal: `${treeObject.objectApiName} is not an object api name.` };
        }

        const selectedFieldApiNames: string[] = [];
        const selectedLowerCaseNames = new Set<string>();

        for ( const fieldApiName of ['Id', ...treeObject.lookupFieldApiNames, ...request.fieldApiNames] ) {

            if ( !SalesforceApiName.isApiName(fieldApiName) ) {
                return { refusal: `${treeObject.objectApiName}.${fieldApiName} is not a field api name.` };
            }

            if ( !selectedLowerCaseNames.has(fieldApiName.toLowerCase()) ) {
                selectedLowerCaseNames.add(fieldApiName.toLowerCase());
                selectedFieldApiNames.push(fieldApiName);
            }

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
