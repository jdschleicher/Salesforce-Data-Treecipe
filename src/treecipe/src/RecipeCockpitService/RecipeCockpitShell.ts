import * as crypto from 'crypto';
import {
    COCKPIT_PALETTE,
    CockpitPalette
} from '../CockpitKit/CockpitPalette';
import {
    COCKPIT_ACTION_CARD_HEIGHT,
    COCKPIT_BUTTON_KINDS
} from '../CockpitKit/CockpitButtonKinds';
import {
    COCKPIT_PINNED_ORG_SECTION_SCROLL_PADDING,
    COCKPIT_SPINNER_ROTATION_MILLISECONDS
} from '../CockpitKit/CockpitOrgPicker';
import { COCKPIT_KIT_CONFIRM_DIALOG_HOST_MARKUP } from '../CockpitKit/CockpitConfirmDialog';
import { COCKPIT_MOTION_CONCEAL_MILLISECONDS, COCKPIT_MOTION_REVEAL_MILLISECONDS } from '../CockpitKit/CockpitMotion';
import { CockpitKitStylesheet } from '../CockpitKit/CockpitKitStylesheet';
import { RECIPE_COCKPIT_ACTION_VERB_EMOJI } from './RecipeCockpitPanelConstants';
import type { RecipeCockpitActionVerb } from './RecipeCockpitPanelConstants';
import { RECIPE_COCKPIT_PANEL_BUNDLE_SCRIPT } from './RecipeCockpitPanelBundle.generated';
import { RECIPE_COCKPIT_PANEL_STYLESHEET } from './RecipeCockpitPanelStylesheet.generated';
import type {
    RecipeCockpitPaletteToken,
    RecipeCockpitVerbButtonClassName
} from './RecipeCockpitViewModel';

/*
    The Recipe Cockpit's document (#671): the shell the panel's script and stylesheet are written
    into, its CSP and nonce, and the values written into its :root. The hub sets it as the webview's
    html and loads nothing else of it.
*/

export const RECIPE_COCKPIT_PANEL_TITLE = 'Recipe Cockpit';

// WHAT THE PANEL SHOWS BEFORE THE HOST HAS ANSWERED, SO A HANDSHAKE THAT NEVER COMPLETES IS VISIBLE RATHER THAN BLANK
export const RECIPE_COCKPIT_PENDING_ACKNOWLEDGEMENT = 'Connecting to the Treecipe extension host…';
export const RECIPE_COCKPIT_PALETTE = COCKPIT_PALETTE;
export const RECIPE_COCKPIT_BUTTON_KINDS = COCKPIT_BUTTON_KINDS;

/*
    Motion (#227). The ▸ is ONE path that CSS turns a quarter on aria-expanded, so it rotates rather
    than swapping. A body the reader opens fades in once it is built; one the reader closes carries
    "hidden" at once -- aria-hidden and inert while it fades out -- so what is hidden is hidden from
    assistive technology for the whole animation. Only a reader's click animates: a restore, a
    focusTree and a search stay instant. prefers-reduced-motion turns every transition and
    animation off, in the stylesheet and in the script. The reveal and conceal timings are the kit's
    (CockpitKit/CockpitMotion.ts), since setShownWithMotion is a kit panel module (#638).
*/
export const RECIPE_COCKPIT_MOTION_REVEAL_MILLISECONDS = COCKPIT_MOTION_REVEAL_MILLISECONDS;
export const RECIPE_COCKPIT_MOTION_CONCEAL_MILLISECONDS = COCKPIT_MOTION_CONCEAL_MILLISECONDS;
export const RECIPE_COCKPIT_MOTION_HOVER_MILLISECONDS = 120;

export const RECIPE_COCKPIT_NESTING_INDENT_REM = 1.25;
// AN OBJECT HEADER IS ITS PADDING, THE CHAIN LINK, ONE GAP, THEN THE ▸ (#494): THE FIELD CHECKBOXES START WHERE THE ▸ DOES
export const RECIPE_COCKPIT_TREE_OBJECT_HEADER_PADDING_REM = 0.6;
export const RECIPE_COCKPIT_TREE_OBJECT_INCLUDE_WIDTH_REM = 2.6;
export const RECIPE_COCKPIT_TREE_HEADER_GAP_REM = 0.5;
export const RECIPE_COCKPIT_TREE_OBJECT_TOGGLE_OFFSET_REM = RECIPE_COCKPIT_TREE_OBJECT_HEADER_PADDING_REM + RECIPE_COCKPIT_TREE_OBJECT_INCLUDE_WIDTH_REM + RECIPE_COCKPIT_TREE_HEADER_GAP_REM;
// AN OBJECT'S CONTROLS ROW AND ITS FIELDS ARE EACH A BORDERED BOX (#494), PADDED INSIDE, WITH A ROW'S OWN INSET INSIDE THAT
export const RECIPE_COCKPIT_TREE_FIELD_BOX_PADDING_REM = 0.25;
export const RECIPE_COCKPIT_TREE_FIELD_ROW_INSET_REM = 0.25;
export const RECIPE_COCKPIT_TREE_FIELD_BOX_MARGIN_LEFT = `calc(${Math.round(( RECIPE_COCKPIT_TREE_OBJECT_TOGGLE_OFFSET_REM - RECIPE_COCKPIT_TREE_FIELD_BOX_PADDING_REM - RECIPE_COCKPIT_TREE_FIELD_ROW_INSET_REM ) * 100) / 100}rem - 1px)`;

// THE PINNED ORG SECTION (#364) COVERS THE TOP OF THE PANEL, SO A ROW SCROLLED INTO VIEW STOPS BELOW IT
export const RECIPE_COCKPIT_PINNED_ORG_SECTION_SCROLL_PADDING = COCKPIT_PINNED_ORG_SECTION_SCROLL_PADDING;

// ONE TURN OF THE ORG CHECK'S SPINNER (#305): A LOOP RATHER THAN A TRANSITION, SO IT IS NOT HELD TO THE 120-180 MS OF MOTION (#227)
export const RECIPE_COCKPIT_SPINNER_ROTATION_MILLISECONDS = COCKPIT_SPINNER_ROTATION_MILLISECONDS;

// EVERY STANDALONE ACTION IS A CARD (#381, #384): ITS VERBS, EMOJI AND WORDS ARE IN RecipeCockpitPanelConstants.ts, WHICH THE PANEL IMPORTS (#638)
export const RECIPE_COCKPIT_ACTION_CARD_WIDTH = '18rem';
export const RECIPE_COCKPIT_ACTION_CARD_HEIGHT = COCKPIT_ACTION_CARD_HEIGHT;
export const RECIPE_COCKPIT_VERB_BUTTON_VERBS: Readonly<Record<RecipeCockpitVerbButtonClassName, RecipeCockpitActionVerb>> = Object.freeze({
    treeInsert: 'generateData',
    dataOrgNewScratch: 'create',
    dataOrgAuthorize: 'authorize'
});

/*
    The cockpit's own values its stylesheet reads (#644), written into :root by the shell beside the
    palette and the kit's: panel/RecipeCockpitPanel.css holds var(--sdt-…) for each, never the number,
    so a value the TypeScript or a test also reads keeps one source.
*/
export const RECIPE_COCKPIT_CUSTOM_PROPERTIES: Readonly<Record<string, string>> = Object.freeze({
    '--sdt-motion-hover': `${RECIPE_COCKPIT_MOTION_HOVER_MILLISECONDS}ms`,
    '--sdt-tree-header-gap': `${RECIPE_COCKPIT_TREE_HEADER_GAP_REM}rem`,
    '--sdt-tree-object-header-padding': `${RECIPE_COCKPIT_TREE_OBJECT_HEADER_PADDING_REM}rem`,
    '--sdt-tree-object-include-width': `${RECIPE_COCKPIT_TREE_OBJECT_INCLUDE_WIDTH_REM}rem`,
    '--sdt-tree-field-box-padding': `${RECIPE_COCKPIT_TREE_FIELD_BOX_PADDING_REM}rem`,
    '--sdt-tree-field-row-inset': `${RECIPE_COCKPIT_TREE_FIELD_ROW_INSET_REM}rem`,
    '--sdt-tree-field-box-margin-left': RECIPE_COCKPIT_TREE_FIELD_BOX_MARGIN_LEFT,
    // ONE INDENT PER friends: LEVEL; THE STYLESHEET WRITES ONE RULE PER LEVEL UP TO RECIPE_COCKPIT_MAX_DRAWN_NESTING_DEPTH
    '--sdt-nesting-indent': `${RECIPE_COCKPIT_NESTING_INDENT_REM}rem`,
    '--sdt-action-card-width': RECIPE_COCKPIT_ACTION_CARD_WIDTH,
    // A VERB BUTTON'S EMOJI (#384), AS A CSS STRING THE STYLESHEET'S ::before content READS
    ...Object.fromEntries(Object.values(RECIPE_COCKPIT_VERB_BUTTON_VERBS).map(verb => [`--sdt-verb-emoji-${verb}`, `'${RECIPE_COCKPIT_ACTION_VERB_EMOJI[verb]}'`]))
});

export class RecipeCockpitShell {

    static buildContentSecurityPolicy(nonce: string): string {

        return `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; form-action 'none'; base-uri 'none';`;

    }

    /*
        From the crypto RNG rather than Math.random. The nonce is what lets the CSP deny every
        script but this extension's own, so it should not depend on there being no injection
        primitive to spend a predicted value on -- that is the property the CSP exists to provide
        independently.
    */
    static buildNonce(): string {

        /*
            48 bytes rather than 24: base64 yields "+", "/" and "=" which are stripped so the value
            is safe unquoted in the CSP header, and 24 bytes can fall short of 32 characters once
            they are removed.
        */
        return crypto.randomBytes(48).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 32);

    }

    static buildPaletteCustomPropertyName(paletteToken: RecipeCockpitPaletteToken): string {

        return CockpitPalette.buildCustomPropertyName(paletteToken);

    }

    static buildPaletteCustomProperties(): string {

        return CockpitPalette.buildCustomProperties();

    }

    /*
        The cockpit's document, as a string carrying NO value this extension does not author.

        The template interpolates the nonce and compile-time constants in this file, and nothing
        else. Recipes -- object and field names, faker expressions, file paths -- come from files
        this extension does not control, so none of it is interpolated into html: it arrives over
        postMessage and is written through textContent, which is why this builder needs no escaping
        rather than having escaping that could be forgotten.

        Keeping the SIGNATURE to the nonce is what holds that line in place, because a value from
        outside this file can only reach the template through a parameter. Widening it to take a
        model would quietly re-open the markup context the guarantee rests on.
    */
    static buildWebviewShellHtml(nonce: string): string {

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${this.buildContentSecurityPolicy(nonce)}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${RECIPE_COCKPIT_PANEL_TITLE}</title>
<style nonce="${nonce}">
    :root {
${this.buildPaletteCustomProperties()}
${CockpitKitStylesheet.buildCustomProperties()}
${CockpitKitStylesheet.buildCustomProperties(RECIPE_COCKPIT_CUSTOM_PROPERTIES)}
        color-scheme: light;
    }
${RECIPE_COCKPIT_PANEL_STYLESHEET}</style>
</head>
<body>
<div class="cockpitHeader">
<h1>${RECIPE_COCKPIT_PANEL_TITLE}</h1>
<div id="cockpitMeta" class="cockpitMeta"></div>
</div>
<div id="loadStatus" class="loadStatus">${RECIPE_COCKPIT_PENDING_ACKNOWLEDGEMENT}</div>
<div id="cockpitBody"></div>
${COCKPIT_KIT_CONFIRM_DIALOG_HOST_MARKUP}
<script nonce="${nonce}">
${RECIPE_COCKPIT_PANEL_BUNDLE_SCRIPT}</script>
</body>
</html>
`;

    }

}
