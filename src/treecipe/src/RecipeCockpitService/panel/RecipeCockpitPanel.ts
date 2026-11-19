import { startRecipeCockpitPanel } from './RecipeCockpitPanelHost';

/*
    The Recipe Cockpit's panel (#565, #657): esbuild.panel.js bundles this entry into
    RecipeCockpitPanelBundle.generated.ts, and that bundle is the whole of the shell's script.
    Every other function is reached from this one call.
*/
startRecipeCockpitPanel();
