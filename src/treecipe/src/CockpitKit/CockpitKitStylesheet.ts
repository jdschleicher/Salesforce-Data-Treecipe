import { COCKPIT_ACTION_CARD_HEIGHT } from './CockpitButtonKinds';
import { COCKPIT_MOTION_CONCEAL_MILLISECONDS, COCKPIT_MOTION_REVEAL_MILLISECONDS } from './CockpitMotion';
import { COCKPIT_PINNED_ORG_SECTION_SCROLL_PADDING, COCKPIT_SPINNER_ROTATION_MILLISECONDS } from './CockpitOrgPicker';

/*
    The kit's stylesheet is .css files under panel/ (#644): a cockpit's own .css includes each one
    with an include line, where its rules belong in the cascade, and esbuild.panel.js inlines them
    into the cockpit's one nonced <style>. A value the TypeScript reads too -- a motion timing the
    panel's setShownWithMotion waits for, a size a test pins -- is never written in a .css file: it
    is a var(--sdt-…) the cockpit's shell writes into :root from the constant here, beside the palette.
*/
// IN CASCADE ORDER: WHERE THE RECIPE COCKPIT INCLUDES THEM, AND WHERE A COCKPIT WITH NO RULES OF ITS OWN BETWEEN THEM PUTS THEM
export const COCKPIT_KIT_STYLESHEET_FILES: readonly string[] = Object.freeze([
    'CockpitButtonKinds.base.css',
    'CockpitOrgPicker.refresh.css',
    'CockpitButtonKinds.primary.css',
    'CockpitButtonKinds.state.css',
    'CockpitButtonKinds.check.css',
    'CockpitOrgPicker.css',
    'CockpitOrgPicker.pinnedSection.css',
    'CockpitConfirmDialog.css'
]);

export const COCKPIT_KIT_CUSTOM_PROPERTIES: Readonly<Record<string, string>> = Object.freeze({
    '--sdt-motion-reveal': `${COCKPIT_MOTION_REVEAL_MILLISECONDS}ms`,
    '--sdt-motion-conceal': `${COCKPIT_MOTION_CONCEAL_MILLISECONDS}ms`,
    '--sdt-spinner-rotation': `${COCKPIT_SPINNER_ROTATION_MILLISECONDS}ms`,
    '--sdt-pinned-org-section-scroll-padding': COCKPIT_PINNED_ORG_SECTION_SCROLL_PADDING,
    '--sdt-action-card-height': COCKPIT_ACTION_CARD_HEIGHT
});

export class CockpitKitStylesheet {

    // ONE DECLARATION PER LINE, INDENTED AS CockpitPalette.buildCustomProperties WRITES THE COLOURS INSIDE :root
    static buildCustomProperties(customProperties: Readonly<Record<string, string>> = COCKPIT_KIT_CUSTOM_PROPERTIES): string {

        return Object.keys(customProperties)
            .map(propertyName => `        ${propertyName}: ${customProperties[propertyName]};`)
            .join('\n');

    }

}
