/*
    The palette every Treecipe cockpit draws with (#524, epic #523). The Recipe Cockpit was the first
    to own it; a second cockpit draws from the same tokens so the two look like one product and the
    contrast test that holds every pair to WCAG 4.5:1 covers both. Imports nothing, so it reaches no
    vscode and no workspace text.
*/
export type CockpitPaletteToken =
    | 'page' | 'surface' | 'border' | 'header' | 'onHeader' | 'onHeaderMuted'
    | 'text' | 'muted' | 'accent'
    | 'action' | 'onAction' | 'actionEdge'
    | 'rowHover' | 'chipBg' | 'chipText'
    | 'added' | 'removed' | 'changed'
    | 'disabledBg' | 'disabledText'
    | 'orgSection'
    | 'excludedOverlay'
    | 'dialogBackdrop';

/*
    The cockpit's ONE palette, and the only source of a colour in its stylesheet. The cockpit used
    to read every colour from the VS Code theme, which under a dark theme drew a flat black page
    with no hierarchy; it now looks the same whatever theme the editor uses. Every text/background
    pair the stylesheet draws is held to WCAG 4.5:1 by a test, so a value changed here is measured
    rather than eyeballed.

    Each colour has one job (#434): navy is the header background and every accent TEXT (links,
    outlined buttons, object names, the focus ring); teal is ONLY a fill or an edge (filled buttons,
    the selected tab, ticked boxes). Teal is never text: it is 1.9:1 on white, and white on teal is
    the same, so what is drawn on teal is navy.
*/
export const COCKPIT_PALETTE: Readonly<Record<CockpitPaletteToken, string>> = Object.freeze({
    page: '#F4F7F6',
    surface: '#FFFFFF',
    border: '#D5DDDB',
    header: '#1D3557',
    onHeader: '#F4F7F6',
    onHeaderMuted: '#C9D3E0',
    text: '#333333',
    muted: '#5C6470',
    accent: '#1D3557',
    action: '#06D6A0',
    onAction: '#1D3557',
    // A DARKER TEAL FOR AN EDGE: THE SELECTED TAB'S OUTLINE AND ITS PANEL'S BORDER, HELD TO 3:1 ON --sdt-surface AND --sdt-row-hover
    actionEdge: '#049C74',
    rowHover: '#E8F8F2',
    chipBg: '#E3F7EF',
    chipText: '#1D3557',
    added: '#15803D',
    removed: '#B91C1C',
    changed: '#B45309',
    disabledBg: '#E4E9E8',
    disabledText: '#4F5654',
    // THE PINNED TARGET ORG MANAGER SECTION'S OWN LIGHT TINT (#433), A TOKEN OF ITS OWN SO A RETUNED header NEVER RECOLOURS IT; IT MUST STAY OPAQUE, SINCE CARDS SCROLL UNDER IT
    orgSection: '#EEF3FB',
    // SLATE GRAY AT 40%, LAID OVER AN OBJECT THE STRUCTURE TAB EXCLUDES (#219); --sdt-text UNDER IT HOLDS 4.5:1, A TEST COMPOSITES IT
    excludedOverlay: 'rgba(148, 163, 184, 0.40)',
    // --sdt-text AT 55%, BEHIND AN IN-PANEL CONFIRMATION (#349); A TEST COMPOSITES IT AND HOLDS THE DIALOG'S EDGE TO 3:1 AGAINST IT
    dialogBackdrop: 'rgba(51, 51, 51, 0.55)'
});

export class CockpitPalette {

    static buildCustomPropertyName(paletteToken: CockpitPaletteToken): string {

        return '--sdt-' + paletteToken.replace(/[A-Z]/g, upperCaseLetter => '-' + upperCaseLetter.toLowerCase());

    }

    static buildCustomProperties(): string {

        return (Object.keys(COCKPIT_PALETTE) as CockpitPaletteToken[])
            .map(paletteToken => `        ${this.buildCustomPropertyName(paletteToken)}: ${COCKPIT_PALETTE[paletteToken]};`)
            .join('\n');

    }

}
