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
    The classes the dialog draws with that panel/CockpitConfirmDialog.css does not style: the
    section chevron and the reveal it names itself, and those its required helpers set (a folded
    section is hidden by setShownWithMotion, its chevron held still by drawToggle). A cockpit that
    includes the dialog styles these too, or a folded section draws open.
*/
export const COCKPIT_KIT_CONFIRM_DIALOG_STYLE_REQUIRES: readonly string[] = Object.freeze([
    'toggleGlyph', 'motionReveal', 'hidden', 'motionConceal', 'noMotion'
]);

// MARKUP: A STATIC SIBLING AFTER THE BODY, SO THE SHELL BUILDER STILL TAKES ONLY A NONCE
export const COCKPIT_KIT_CONFIRM_DIALOG_HOST_MARKUP = `<div id="cockpitDialogHost"></div>`;

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
