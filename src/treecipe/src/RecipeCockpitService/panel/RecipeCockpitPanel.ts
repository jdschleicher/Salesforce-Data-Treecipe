/*
    The Recipe Cockpit's panel modules (#565): esbuild.panel.js bundles this entry into
    RecipeCockpitPanelBundle.generated.ts, and the shell inlines that inside its script. What this
    exports is what the rest of the panel script calls by name.
*/
export { closeConfirmDialog, renderConfirmRequest } from '../../CockpitKit/panel/CockpitConfirmDialogPanel';
