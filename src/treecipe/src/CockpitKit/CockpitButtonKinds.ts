/*
    The button kinds every Treecipe cockpit draws (#363, shared by #524). A button is made ONLY by the
    panel script's createButton, and styled ONLY by its kind's rules, so a new button cannot come out
    as a browser default by missing a selector list. compact is a size, not a kind.

    The rules are kept as the pieces the Recipe Cockpit's stylesheet has always interleaved with its
    own rules, so its document stays byte for byte what it was; a cockpit with no such rules between
    them takes buildStyles(), the same pieces in the same order.
*/
export type CockpitButtonKind = 'primary' | 'secondary' | 'icon' | 'check' | 'link' | 'card';
export const COCKPIT_BUTTON_KINDS: readonly CockpitButtonKind[] = Object.freeze(['primary', 'secondary', 'icon', 'check', 'link', 'card'] as CockpitButtonKind[]);

// ONE SIZE FOR EVERY STANDALONE ACTION CARD (#381), SO A GRID OF THEM LINES UP
export const COCKPIT_ACTION_CARD_HEIGHT = '10.5rem';

export const COCKPIT_KIT_BUTTON_KIND_BASE_STYLES = `    /*
        THE BUTTON KINDS (#363): every button the panel makes carries sdtButton and exactly one
        sdtButton-<kind>, and these rules are the only place a button's colours, border and states
        are set. A button's own class adds size and layout only, so a new button is styled by its
        kind or fails the button-kind test; it is never a browser default.
    */
    .sdtButton-primary, .sdtButton-secondary {
        min-height: 2.25rem;
        min-width: 2.25rem;
        padding: 0.4rem 0.8rem;
        font: inherit;
        font-size: 1.1em;
        color: var(--sdt-accent);
        background-color: var(--sdt-surface);
        border: 1px solid var(--sdt-border);
        border-radius: 6px;
        cursor: pointer;
    }
    .sdtButton-secondary:hover:not(:disabled) {
        border-color: var(--sdt-accent);
    }`;

export const COCKPIT_KIT_BUTTON_KIND_PRIMARY_STYLES = `    .sdtButton-primary {
        color: var(--sdt-on-action);
        background-color: var(--sdt-action);
        border-color: var(--sdt-action);
        font-weight: 600;
    }
    .sdtButton-primary:hover:not(:disabled) { filter: brightness(0.92); }
    .sdtButton-primary:active:not(:disabled) { filter: brightness(0.84); }`;

export const COCKPIT_KIT_BUTTON_KIND_STATE_STYLES = `    .sdtButton-primary:disabled, .sdtButton-secondary:disabled {
        color: var(--sdt-disabled-text);
        background-color: var(--sdt-disabled-bg);
        border-color: var(--sdt-border);
        cursor: not-allowed;
        opacity: 1;
    }
    .sdtButton-compact { min-height: 0; min-width: 0; padding: 0.15rem 0.6rem; font-size: inherit; }
    .sdtButton-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        color: var(--sdt-text);
        background-color: transparent;
        border: 1px solid transparent;
        border-radius: 4px;
        cursor: pointer;
    }
    .sdtButton-icon:hover:not(:disabled) { background-color: var(--sdt-row-hover); border-color: var(--sdt-border); }
    .sdtButton-icon:disabled { cursor: not-allowed; }
    .sdtButton-link {
        background: none;
        border: none;
        padding: 0;
        font: inherit;
        color: var(--sdt-accent);
        text-align: left;
        cursor: pointer;
    }
    .sdtButton-link:focus-visible { outline-offset: -1px; }
    .sdtButton-card {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        justify-content: flex-start;
        gap: 0.3rem;
        width: 100%;
        height: ${COCKPIT_ACTION_CARD_HEIGHT};
        overflow: hidden;
        padding: 0.6rem 0.75rem;
        font: inherit;
        text-align: left;
        color: var(--sdt-text);
        background-color: var(--sdt-surface);
        border: 1px solid var(--sdt-border);
        border-radius: 8px;
        cursor: pointer;
    }
    .sdtButton-card:hover:not(:disabled) { border-color: var(--sdt-accent); background-color: var(--sdt-row-hover); }
    .sdtButton-card:disabled { color: var(--sdt-disabled-text); background-color: var(--sdt-disabled-bg); border-color: var(--sdt-border); cursor: not-allowed; }
    .sdtButton-card:disabled .actionCardTitle, .sdtButton-card:disabled .actionCardDetail { color: var(--sdt-disabled-text); }
    .sdtButton-link:hover { text-decoration: underline; }`;

export const COCKPIT_KIT_BUTTON_KIND_CHECK_STYLES = `    .sdtButton-check {
        position: relative;
        z-index: 2;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.25em;
        height: 1.25em;
        padding: 0;
        font: inherit;
        font-weight: 700;
        line-height: 1;
        color: var(--sdt-on-action);
        background-color: var(--sdt-action);
        border: 1px solid var(--sdt-action-edge);
        border-radius: 3px;
        cursor: pointer;
    }
    .sdtButton-check[aria-checked="false"] { background-color: var(--sdt-surface); border-color: var(--sdt-muted); }
    .sdtButton-check:disabled { color: var(--sdt-disabled-text); background-color: var(--sdt-disabled-bg); border-color: var(--sdt-border); cursor: not-allowed; }`;

// PANEL SCRIPT: THE KINDS createButton CHECKS AGAINST
export const COCKPIT_KIT_BUTTON_KINDS_SCRIPT = `    const BUTTON_KINDS = ${JSON.stringify(COCKPIT_BUTTON_KINDS)};`;

// PANEL SCRIPT: THE ONLY createElement('button', …) A COCKPIT MAKES; IT NEEDS createElement AND BUTTON_KINDS DECLARED BESIDE IT
export const COCKPIT_KIT_CREATE_BUTTON_SCRIPT = `    // THE ONLY WAY THE PANEL MAKES A BUTTON (#363): ITS KIND STYLES IT, ITS OWN CLASS ONLY SIZES AND PLACES IT
    function createButton(kind, className, textContent, size) {

        if (BUTTON_KINDS.indexOf(kind) === -1) { throw new Error('Unknown button kind: ' + kind); }
        const buttonClassName = 'sdtButton sdtButton-' + kind + (size === 'compact' ? ' sdtButton-compact' : '') + (className ? ' ' + className : '');
        return createElement('button', buttonClassName, textContent);

    }`;

export class CockpitButtonKinds {

    static buildStyles(): string {

        return [
            COCKPIT_KIT_BUTTON_KIND_BASE_STYLES,
            COCKPIT_KIT_BUTTON_KIND_PRIMARY_STYLES,
            COCKPIT_KIT_BUTTON_KIND_STATE_STYLES,
            COCKPIT_KIT_BUTTON_KIND_CHECK_STYLES
        ].join('\n');

    }

}
