/*
    What the Query tab's panel module draws with (#640). It imports nothing, so the panel bundle can
    import it; RecipeCockpitService.ts re-exports every name. The query length limit stays in
    RecipeCockpitQuery.ts, beside the check that holds a query to it, and the shell passes it to the
    panel script.
*/

export const RECIPE_COCKPIT_QUERY_INTRO = 'The SOQL Generate Treecipe wrote for this tree. Edit a query, run it against the org chosen in Target Org Manager (with none chosen, it asks), then export what it returned as JSON or CSV. A query only reads.';
