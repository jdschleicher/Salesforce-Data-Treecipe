/*
    The Target Org Manager's look, shared by every cockpit (#524): the org dropdown, its type chip, the
    listing spinner, the refresh button, and the pinned section that holds them while cards scroll
    under it. The picker's VIEW and its index protocol are extracted with the second cockpit that uses
    them (#525); what an org can be listed, selected or written to stays SalesforceOrgService's.
*/
export const COCKPIT_SPINNER_ROTATION_MILLISECONDS = 800;

// HOW FAR BELOW THE TOP A ROW SCROLLED INTO VIEW STOPS, SO THE PINNED ORG SECTION NEVER COVERS IT (#364)
export const COCKPIT_PINNED_ORG_SECTION_SCROLL_PADDING = '10rem';

export const COCKPIT_KIT_ORG_PICKER_REFRESH_STYLES = `    .dataOrgRefresh { display: inline-flex; align-items: center; gap: 0.35rem; line-height: 1; }
    .dataOrgRefreshIcon { font-size: 1.5em; line-height: 1; }`;

export const COCKPIT_KIT_ORG_PICKER_STYLES = `    .dataOrgControls { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
    .dataOrgSelect {
        padding: 0.3rem;
        color: var(--sdt-text);
        background-color: var(--sdt-surface);
        border: 1px solid var(--sdt-border);
        border-radius: 4px;
    }
    .dataOrgType {
        font-size: 0.85em;
        padding: 0 0.4rem;
        color: var(--sdt-chip-text);
        background-color: var(--sdt-chip-bg);
        border-radius: 0.6rem;
    }
    @keyframes sdtSpin { to { transform: rotate(360deg); } }
    /* A RING, NOT A GLYPH: ITS COLOURS ARE THE PALETTE'S, AND REDUCED MOTION LEAVES IT DRAWN BUT STILL */
    .dataOrgSpinner {
        display: inline-block;
        width: 0.9rem;
        height: 0.9rem;
        border: 2px solid var(--sdt-border);
        border-top-color: var(--sdt-accent);
        border-radius: 50%;
        animation: sdtSpin ${COCKPIT_SPINNER_ROTATION_MILLISECONDS}ms linear infinite;
    }
    .dataOrgStatus { margin: 0.4rem 0; }
    .dataOrgStatus.failed { color: var(--sdt-removed); }`;

// THE COCKPIT'S SECTIONS, AND THE ORG SECTION PINNED AT THE TOP: CSS ONLY, SO NO ANCESTOR MAY SET AN overflow OTHER THAN visible
export const COCKPIT_KIT_PINNED_SECTION_STYLES = `    .cockpitSection { margin: 0.6rem 0; }
    .cockpitSectionHeader { display: flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0; cursor: default; border-bottom: 2px solid var(--sdt-header); }
    #cockpitOrgSection { position: sticky; top: 0; z-index: 10; margin: 0; padding: 0.6rem; background-color: var(--sdt-org-section); border-bottom: 1px solid var(--sdt-border); }
    html:has(#cockpitOrgSection) { scroll-padding-top: ${COCKPIT_PINNED_ORG_SECTION_SCROLL_PADDING}; }
    .cockpitSectionTitle { font-weight: 600; font-size: 1.1em; color: var(--sdt-header); }
    #cockpitOrgSectionBody { padding: 0.5rem 0.6rem; margin-top: 0.4rem; background-color: var(--sdt-surface); border: 1px solid var(--sdt-border); border-radius: 8px; }`;

export class CockpitOrgPicker {

    static buildStyles(): string {

        return [
            COCKPIT_KIT_ORG_PICKER_REFRESH_STYLES,
            COCKPIT_KIT_ORG_PICKER_STYLES,
            COCKPIT_KIT_PINNED_SECTION_STYLES
        ].join('\n');

    }

}
