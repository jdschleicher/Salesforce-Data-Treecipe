/*
    The styles of "Get latest detail" (#612): the row's button and the dialog the host drives
    through objectRefreshState. The dialog itself is the panel module
    panel/treecipe/objectRefresh/ObjectRefreshDialog.ts (#657); its styles stay a string here,
    interpolated into the shell's stylesheet, until the stylesheet moves into a file (#644).
    Imports nothing.
*/

export const RECIPE_COCKPIT_OBJECT_REFRESH_DIALOG_STYLES = `    .treeObjectRefresh { margin-left: auto; display: inline-flex; align-items: center; gap: 0.35rem; }
    .objectRefreshGlyph { width: 1rem; height: 1rem; flex: none; }
    .objectRefreshGlyph path { fill: none; stroke: var(--sdt-removed); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
    .objectRefreshOrg { margin: 0.5rem 0; }
    .objectRefreshKinds { display: flex; flex-direction: column; gap: 0.35rem; margin: 0.5rem 0; }
    .objectRefreshKind { display: flex; align-items: center; gap: 0.45rem; }
    .objectRefreshKindLabel { cursor: pointer; }
    .objectRefreshProgress { margin: 0.75rem 0; }
    .objectRefreshGroupNote { margin: 0.2rem 0; }
    .objectRefreshGroupActions { display: flex; gap: 0.5rem; margin: 0.2rem 0 0.4rem 0; }
    .objectRefreshStatus { display: inline-block; padding: 0 0.45rem; border-radius: 999px; font-size: 0.85rem; color: var(--sdt-chip-text); background-color: var(--sdt-chip-bg); }
    .objectRefreshDifference { display: block; }`;
