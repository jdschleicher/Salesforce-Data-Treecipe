import * as vscode from 'vscode';
import { IRecipeCockpitConfirmAnswer, IRecipeCockpitConfirmOptions, IRecipeCockpitConfirmWithCheckboxOptions, RecipeCockpitService } from '../RecipeCockpitService';

/*
    The cockpit asks its confirmations inside the panel (#349), through RecipeCockpitService.confirmInPanel,
    which has showWarningMessage's shape: a message, its options, the button labels, and the label
    chosen or undefined. The suites that drive an executor end to end scripted VS Code's modal
    through the mocked vscode.window.showWarningMessage, so this hands each confirmation to that
    same mock: a suite keeps scripting the answer and asserting the title, detail and labels it
    always has. The options arrive as confirmInPanel received them plus inPanel: true, never with
    modal: true, so a suite tells a confirmation from a notification the mock also answers. Since
    #457 a confirmation is a summary, warnings and folded sections; the mock is handed them as one
    detail text (RecipeCockpitService.flattenConfirmContent), so a suite still matches the words shown.

    The broker itself (the request posted, the one-use id, Cancel on ready, a new model, a failure to
    draw or a closed panel) and the dialog the panel draws are tested in RecipeCockpitConfirmDialog.test.ts.

    A confirmation with a checkbox (#402) goes to the same mock with its checkboxLabel among the
    options: a label answers with the box unticked, and { chosenLabel, isChecked } ticks it.

    Call it at the top level of a suite: the spy is made in a beforeEach, since restoreMocks removes it after every test.
*/
// THE OPTIONS A MODAL TOOK: THE PARTS AS ONE detail, AND isDestructive AND checkboxLabel ONLY WHEN THE CONFIRMATION SET THEM
function toModalOptions(confirmOptions: IRecipeCockpitConfirmOptions & { checkboxLabel?: string }) {
    return {
        detail: RecipeCockpitService.flattenConfirmContent(confirmOptions),
        ...( confirmOptions.isDestructive !== undefined ? { isDestructive: confirmOptions.isDestructive } : {} ),
        ...( confirmOptions.checkboxLabel !== undefined ? { checkboxLabel: confirmOptions.checkboxLabel } : {} ),
        inPanel: true
    };
}

export function answerInPanelConfirmationsThroughWarningMock(): void {

    beforeEach(() => {
        jest.spyOn(RecipeCockpitService, 'confirmInPanel').mockImplementation((message: string, confirmOptions: IRecipeCockpitConfirmOptions, ...buttonLabels: string[]) =>
            Promise.resolve((vscode.window.showWarningMessage as unknown as jest.Mock)(message, toModalOptions(confirmOptions), ...buttonLabels)));
        jest.spyOn(RecipeCockpitService, 'confirmInPanelWithCheckbox').mockImplementation((message: string, confirmOptions: IRecipeCockpitConfirmWithCheckboxOptions, ...buttonLabels: string[]) =>
            Promise.resolve((vscode.window.showWarningMessage as unknown as jest.Mock)(message, toModalOptions(confirmOptions), ...buttonLabels))
                .then((answer: unknown): IRecipeCockpitConfirmAnswer => answer !== null && typeof answer === 'object'
                    ? answer as IRecipeCockpitConfirmAnswer
                    : { chosenLabel: typeof answer === 'string' ? answer : undefined, isChecked: false }));
    });

}
