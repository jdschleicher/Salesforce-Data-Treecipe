/*
    The TODO a lookup with no parent in the recipe gets in place of a reference (#46). Imports
    nothing, so the Recipe Cockpit's panel can find the TODO with the same text (#657);
    RelationshipService.referenceIdRequiredTodo is this value.
*/
export const REFERENCE_ID_REQUIRED_TODO = '### TODO -- REFERENCE ID REQUIRED';
