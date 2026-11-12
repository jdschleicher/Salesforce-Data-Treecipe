/*
    What the Recipe Cockpit's panel modules draw with (#638): glyph paths and the action cards' words.
    Imports nothing, so a panel module can import it and the bundle pulls in no host code.
    RecipeCockpitService.ts re-exports every name.
*/

/*
    The cockpit's first SVG glyphs (#219, #257): a chain link, one path per state, drawn by the panel
    script with createElementNS and coloured only from the --sdt-* palette by CSS. Joined is included;
    broken -- the links pulled apart, a spark either side of the gap -- is excluded, and a dashed broken
    link is excluded because a parent is. The SHAPE says the state, never the colour alone. Both are
    stroked in a 24x24 box and turned 45 degrees clockwise, so the link runs from the bottom right to
    the top left (#295). They fetch nothing, so the CSP, the nonce-only shell builder and
    localResourceRoots: [] are unchanged.
*/
export const RECIPE_COCKPIT_TREE_GLYPH_VIEW_BOX = '0 0 24 24';
export const RECIPE_COCKPIT_TREE_GLYPH_TRANSFORM = 'rotate(45 12 12)';
export const RECIPE_COCKPIT_TREE_LINKED_GLYPH_PATH = 'M6 8 H10 A4 4 0 0 1 10 16 H6 A4 4 0 0 1 6 8 Z M14 8 H18 A4 4 0 0 1 18 16 H14 A4 4 0 0 1 14 8 Z';
export const RECIPE_COCKPIT_TREE_BROKEN_GLYPH_PATH = 'M4.5 8 H6.5 A4 4 0 0 1 6.5 16 H4.5 A4 4 0 0 1 4.5 8 Z M17.5 8 H19.5 A4 4 0 0 1 19.5 16 H17.5 A4 4 0 0 1 17.5 8 Z M12 3.5 V6 M12 18 V20.5';
/*
    IMPACTED (#449): the object is still included, but a lookup of it points at an excluded parent, so
    that lookup is left out of what is generated. One link stays where the joined glyph has it, the
    other is pulled away with one spark at the gap -- half joined, half broken -- stroked in
    --sdt-changed, and the row's label, title and aria-label name the parent.
*/
export const RECIPE_COCKPIT_TREE_IMPACTED_GLYPH_PATH = 'M6 8 H10 A4 4 0 0 1 10 16 H6 A4 4 0 0 1 6 8 Z M17.5 8 H19.5 A4 4 0 0 1 19.5 16 H17.5 A4 4 0 0 1 17.5 8 Z M14.75 3.5 V6';

/*
    A field's edit button (#356, the pin of #262 and the ✎ of #323 in one), built the same way as the
    chain link: one path -- a pencil -- stroked from the palette by CSS, and filled while the field
    holds an edit, so the shape, aria-pressed, the title and the row's badge ("edited" for an
    expression, "fixed" for a literal) all say it, never the colour alone.
*/
export const RECIPE_COCKPIT_FIXED_VALUE_GLYPH_PATH = 'M4 20 L5 15 L15.5 4.5 L19.5 8.5 L9 19 Z M13.5 6.5 L17.5 10.5';

/*
    The ▸/▾ of a tree card, a Treecipe object and a picklist field (#277), drawn like the chain link: a
    font's triangle sits on the text baseline, so no button rule could centre it. An open chevron (#307)
    whose box is centred on (12, 12) in the same 24x24 view box, stroked from the palette by CSS. Every
    toggle carries chevronToggle, one 1.6rem box holding a 1.2rem glyph (#392), which lifts the
    secondary kind's 2.25rem minimum; the stroke is in view box units, so it thins with the glyph.
*/
export const RECIPE_COCKPIT_TOGGLE_COLLAPSED_GLYPH_PATH = 'M8.5 5 L15.5 12 L8.5 19';
// The magnifier inside every search box (#373): a lens and a handle in the same 24x24 view box, stroked from the palette.
export const RECIPE_COCKPIT_SEARCH_GLYPH_PATH = 'M10.5 4 A6.5 6.5 0 1 1 10.5 17 A6.5 6.5 0 1 1 10.5 4 Z M15.2 15.2 L20 20';

/*
    Every standalone action is a card (#381, #384): the verb's emoji and the action's title, a line on
    when it is needed, and a live detail line. The emoji is the VERB's, from one map, so every
    deploy shares 🚀 and a later retrieve gets 📥 without choosing. A primary button that keeps its
    place (the tree's insert, + New scratch org in the pinned org row) carries its verb's emoji too,
    drawn before its label from the same map.
*/
export type RecipeCockpitActionVerb = 'deploy' | 'retrieve' | 'assign' | 'generate' | 'run' | 'export' | 'create' | 'generateData' | 'update' | 'authorize';

export const RECIPE_COCKPIT_ACTION_VERB_EMOJI: Readonly<Record<RecipeCockpitActionVerb, string>> = Object.freeze({
    deploy: '🚀',
    retrieve: '📥',
    assign: '👤',
    generate: '🛠️',
    run: '▶️',
    export: '💾',
    create: '➕',
    generateData: '🌱',
    update: '✍️',
    authorize: '🔑'
});

/*
    The TODO's and Validation Rules lists draw each object group as a card (#383) on the action
    cards' surface: one emoji per kind of group, never a verb's.
*/
export type RecipeCockpitTroubleshootingGroupKind = 'todos' | 'validationRules';
export const RECIPE_COCKPIT_TROUBLESHOOTING_GROUP_EMOJI: Readonly<Record<RecipeCockpitTroubleshootingGroupKind, string>> = Object.freeze({
    todos: '📝',
    validationRules: '📏'
});

export type RecipeCockpitTroubleshootingAction = 'assignPermissionSets' | 'generatePermissionSet' | 'deployPermissionSet' | 'deployFields' | 'retrieveFields' | 'retrieveValidationRules' | 'deployRecordTypes' | 'retrieveRecordTypes' | 'deployGlobalValueSets' | 'retrieveGlobalValueSets';
export interface IRecipeCockpitActionCard {
    verb: RecipeCockpitActionVerb;
    why: string;
}
export const RECIPE_COCKPIT_TROUBLESHOOTING_ACTION_CARDS: Readonly<Record<RecipeCockpitTroubleshootingAction, IRecipeCockpitActionCard>> = Object.freeze({
    assignPermissionSets: { verb: 'assign', why: 'Insert refused for access? Assign permission sets the org already holds for these objects.' },
    generatePermissionSet: { verb: 'generate', why: 'No permission set grants these objects? Write a create/read one into the project. Deploys nothing.' },
    deployPermissionSet: { verb: 'deploy', why: 'Push the tree\'s permission sets to the sandbox or scratch org before assigning them.' },
    deployFields: { verb: 'deploy', why: 'Insert failed with INVALID_FIELD? The org is missing custom fields or objects this tree writes, or the pages they open.' },
    retrieveFields: { verb: 'retrieve', why: 'Project behind the org? Pull this tree\'s custom fields so Generate Treecipe writes what the org holds.' },
    retrieveValidationRules: { verb: 'retrieve', why: 'Pull the org\'s validation rules so Generate Treecipe can respect them.' },
    retrieveRecordTypes: { verb: 'retrieve', why: 'Pull the org\'s record types for these objects so Generate Treecipe can choose among them.' },
    retrieveGlobalValueSets: { verb: 'retrieve', why: 'Pull the value sets these fields name so picklists generate the org\'s values.' },
    deployRecordTypes: { verb: 'deploy', why: 'Insert failed on RecordTypeId? The org is missing record types this recipe sets.' },
    deployGlobalValueSets: { verb: 'deploy', why: 'Restricted picklist rejected a value? The org is missing value sets these fields use.' }
});
// THE STANDALONE ACTIONS OUTSIDE THE TROUBLESHOOTING TAB THAT ARE CARDS (#384); THE PR'S INVENTORY SAYS WHY EVERY OTHER BUTTON IS NOT
export type RecipeCockpitStandaloneAction = 'generateTreecipe' | 'runQuery' | 'exportQueryJson' | 'exportQueryCsv' | 'loadUpdaterRecords' | 'generateUpdaterValues' | 'updateUpdaterRecords';
export const RECIPE_COCKPIT_STANDALONE_ACTION_CARDS: Readonly<Record<RecipeCockpitStandaloneAction, IRecipeCockpitActionCard>> = Object.freeze({
    generateTreecipe: { verb: 'generate', why: 'No recipe run yet? Read this project\'s object metadata and write a Treecipe run to open here.' },
    runQuery: { verb: 'run', why: 'Read what this query returns from the org chosen in Target Org Manager. It only reads.' },
    exportQueryJson: { verb: 'export', why: 'Write every record the last run returned to RunArtifacts in the tree folder as JSON.' },
    exportQueryCsv: { verb: 'export', why: 'Write every record the last run returned to RunArtifacts in the tree folder as CSV.' },
    loadUpdaterRecords: { verb: 'retrieve', why: 'Read this tree\'s records, with the chosen fields, from the selected sandbox. It only reads.' },
    generateUpdaterValues: { verb: 'generateData', why: 'Make a new value for each chosen field of every loaded record. Nothing is written yet.' },
    updateUpdaterRecords: { verb: 'update', why: 'Write the new values to the loaded records by Id. Their old values are saved first.' }
});
