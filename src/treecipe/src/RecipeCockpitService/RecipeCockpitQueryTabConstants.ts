/*
    What the Query tab's panel module draws with (#640). It imports nothing, so the panel bundle can
    import it; RecipeCockpitService.ts re-exports every name, and RecipeCockpitQuery.ts re-exports the
    query length limit its check holds a query to.
*/

export const RECIPE_COCKPIT_QUERY_INTRO = 'The SOQL Generate Treecipe wrote for this tree. Edit a query, run it against the org chosen in Target Org Manager (with none chosen, it asks), then export what it returned as JSON or CSV. A query only reads.';

// SOQL'S OWN LIMIT: A WIDE OBJECT'S GENERATED BASE QUERY PASSES 10,000 CHARACTERS AT ABOUT 400 FIELDS
export const RECIPE_COCKPIT_QUERY_MAX_LENGTH = 100000;
