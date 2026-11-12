import * as crypto from 'crypto';

/*
    The in-panel confirmation every cockpit asks with (#349, #402, #457, #480; shared by #524). The
    HOST keeps the decision: it posts a request under a random id, the panel draws it with
    textContent only and answers with the INDEX of a button it was given, and readAnswer turns that
    back into a label or Cancel. Which panel is asked, whether it is visible and what an answer
    starts again stay with the cockpit that asks. The panel half is panel/CockpitConfirmDialogPanel.ts,
    bundled into the cockpit's script (#637).

    A request can also offer record type set modes (#623): one radio each, the first chosen. The
    answer names the chosen mode, and readRecordTypeSetMode gives it back only when it is one the
    request offered.
*/
export { COCKPIT_CONFIRM_CHANGE_ORG_LABEL, COCKPIT_CONFIRM_WARNINGS_LABEL } from './CockpitConfirmLabels';
export type { ICockpitConfirmAnswer, ICockpitConfirmRecordTypeSetMode } from './CockpitConfirmLabels';
import { ICockpitConfirmAnswer } from './CockpitConfirmLabels';

/*
    The names the dialog's panel module (panel/CockpitConfirmDialogPanel.ts, #637) takes from the
    cockpit script it is bundled into: its declare block, less confirmDialog, which the kit's state
    script declares. A cockpit that includes the bundle declares each of these in the same scope: a
    name it misses throws while a request is drawn, before any answer is posted, and the host's
    confirmInPanel would wait on it. A test holds this list to the module's declare block.
*/
export const COCKPIT_KIT_CONFIRM_DIALOG_SCRIPT_REQUIRES: readonly string[] = Object.freeze([
    'vscodeApi', 'renderedSequence', 'focusElement', 'TREE_GLYPH_VIEW_BOX', 'TOGGLE_COLLAPSED_GLYPH_PATH',
    'cockpitDialogHostElement', 'cockpitBodyElement', 'cockpitMetaElement', 'loadStatusElement'
]);

/*
    The classes the dialog draws with that COCKPIT_KIT_CONFIRM_DIALOG_STYLES does not style: the
    section chevron and the reveal it names itself, and those its required helpers set (a folded
    section is hidden by setShownWithMotion, its chevron held still by drawToggle). A cockpit that
    includes the dialog styles these too, or a folded section draws open.
*/
export const COCKPIT_KIT_CONFIRM_DIALOG_STYLE_REQUIRES: readonly string[] = Object.freeze([
    'toggleGlyph', 'motionReveal', 'hidden', 'motionConceal', 'noMotion'
]);

export const COCKPIT_KIT_CONFIRM_DIALOG_STYLES = `    .confirmOverlay {
        position: fixed;
        inset: 0;
        z-index: 50;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        background-color: var(--sdt-dialog-backdrop);
    }
    .confirmDialog {
        display: flex;
        flex-direction: column;
        width: min(42rem, 100%);
        max-height: calc(100vh - 32px);
        color: var(--sdt-text);
        background-color: var(--sdt-surface);
        border: 1px solid var(--sdt-border);
        border-radius: 8px;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06), 0 8px 24px rgba(15, 23, 42, 0.08);
    }
    .confirmTitle { margin: 0; padding: 0.9rem 1rem 0.5rem 1rem; font-size: 1.05rem; font-weight: 600; overflow-wrap: anywhere; }
    .confirmBody {
        flex: 1 1 auto;
        min-height: 0;
        max-height: 60vh;
        overflow-y: auto;
        padding: 0.25rem 1rem 0.75rem 1rem;
        border-top: 1px solid var(--sdt-border);
        border-bottom: 1px solid var(--sdt-border);
    }
    .confirmLine { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0.15rem 0; }
    .confirmBullets { margin: 0.15rem 0; padding-left: 1.25rem; }
    .confirmBullets .confirmBullet { margin: 0.2rem 0; }
    .confirmBullet::marker { color: var(--sdt-muted); }
    .confirmSubBullets { margin: 0.1rem 0 0.25rem 0; list-style-type: circle; }
    .confirmWarnings .confirmBullet::marker { color: var(--sdt-changed); }
    .confirmGap { height: 0.6rem; }
    .confirmSummary { margin: 0.5rem 0; font-size: 1.02rem; }
    .confirmOrg { display: flex; flex-wrap: wrap; align-items: center; gap: 0.2rem 0.45rem; margin: 0.5rem 0; padding: 0.4rem 0.6rem; border: 1px solid var(--sdt-border); border-radius: 6px; }
    .confirmOrgLabel { color: var(--sdt-muted); font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.04em; }
    .confirmOrgAlias { font-weight: 700; color: var(--sdt-accent); overflow-wrap: anywhere; }
    .confirmOrgSeparator { color: var(--sdt-muted); }
    .confirmOrgUsername { font-family: var(--vscode-editor-font-family), monospace; color: var(--sdt-muted); overflow-wrap: anywhere; }
    .confirmOrg .confirmBadge { margin-top: 0; }
    .confirmChangeOrg { margin-left: auto; }
    .confirmBadge { display: inline-block; margin-top: 0.3rem; padding: 0.1rem 0.55rem; border-radius: 999px; font-size: 0.85rem; font-weight: 600; color: var(--sdt-chip-text); background-color: var(--sdt-chip-bg); }
    .confirmWarnings { margin: 0.6rem 0; padding: 0.45rem 0.7rem; color: var(--sdt-text); background-color: var(--sdt-surface); border: 1px solid var(--sdt-border); border-left: 4px solid var(--sdt-changed); border-radius: 6px; }
    .confirmWarningsHeading { margin-bottom: 0.15rem; font-weight: 600; color: var(--sdt-changed); }
    .confirmSection { margin: 0.35rem 0; }
    .confirmSectionToggle { display: flex; align-items: center; gap: 0.4rem; width: 100%; padding: 0.35rem 0.5rem; text-align: left; line-height: 1.3; }
    .confirmSectionTitle { flex: 1 1 auto; font-weight: 600; overflow-wrap: anywhere; }
    .confirmSectionCount { flex: none; padding: 0 0.45rem; border-radius: 999px; font-size: 0.85rem; color: var(--sdt-chip-text); background-color: var(--sdt-chip-bg); }
    .confirmSectionBody { padding: 0.2rem 0.5rem 0.2rem 2rem; }
    .confirmCheckRow { flex: none; display: flex; align-items: center; gap: 0.4rem; padding: 0.75rem 1rem 0 1rem; }
    .confirmCheckLabel { cursor: pointer; overflow-wrap: anywhere; }
    .confirmModeGroup { flex: none; padding: 0.75rem 1rem 0 1rem; }
    .confirmModeLegend { margin-bottom: 0.3rem; font-weight: 600; overflow-wrap: anywhere; }
    .confirmModeRow { display: flex; align-items: center; gap: 0.4rem; margin: 0.2rem 0; }
    .confirmModeRadio { border-radius: 999px; }
    .confirmModeLabel { cursor: pointer; overflow-wrap: anywhere; }
    .confirmActions { flex: none; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.5rem; padding: 0.75rem 1rem; }`;

// MARKUP: A STATIC SIBLING AFTER THE BODY, SO THE SHELL BUILDER STILL TAKES ONLY A NONCE
export const COCKPIT_KIT_CONFIRM_DIALOG_HOST_MARKUP = `<div id="cockpitDialogHost"></div>`;

// PANEL SCRIPT, DECLARED WITH THE PANEL'S OTHER STATE; THE PANEL MODULE AND THE OBJECT REFRESH DIALOG BOTH READ IT
export const COCKPIT_KIT_CONFIRM_DIALOG_STATE_SCRIPT = `    // THE ONE IN-PANEL CONFIRMATION ON SCREEN (#349), OR null
    let confirmDialog = null;`;

export class CockpitConfirmDialog {

    static buildConfirmationId(): string {
        return crypto.randomBytes(16).toString('hex');
    }

    /*
        SPENT ONCE by the caller. An index the host did not offer is Cancel, and so is an isChecked
        that is neither absent nor a boolean; a box only counts when one was drawn.
    */
    static readAnswer(buttonLabels: readonly string[], hasCheckbox: boolean, choice: unknown, isChecked?: unknown): ICockpitConfirmAnswer {

        const isOfferedChoice = typeof choice === 'number' && Number.isInteger(choice) && choice >= 0 && choice < buttonLabels.length;
        const isReadableCheck = isChecked === undefined || typeof isChecked === 'boolean';

        return isOfferedChoice && isReadableCheck
            ? { chosenLabel: buttonLabels[choice], isChecked: hasCheckbox && isChecked === true }
            : { chosenLabel: undefined, isChecked: false };

    }

    // THE MODE AN ANSWER NAMES (#623), ONLY WHEN IT IS ONE THE REQUEST OFFERED; ANY OTHER VALUE IS NO MODE, WHICH THE CALLER READS AS CANCEL
    static readRecordTypeSetMode<ModeName extends string>(offeredModeNames: readonly ModeName[], postedModeName: unknown): ModeName | undefined {

        return offeredModeNames.find(offeredModeName => offeredModeName === postedModeName);

    }

}
