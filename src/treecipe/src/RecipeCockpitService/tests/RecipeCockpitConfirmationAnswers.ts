import * as vscode from 'vscode';
import { IRecipeCockpitConfirmOptions, RecipeCockpitService } from '../RecipeCockpitService';

/*
    The cockpit asks its confirmations inside the panel (#349), through RecipeCockpitService.confirmInPanel,
    which has showWarningMessage's shape: a message, its options, the button labels, and the label
    chosen or undefined. The suites that drive an executor end to end scripted VS Code's modal
    through the mocked vscode.window.showWarningMessage, so this hands each confirmation to that
    same mock: a suite keeps scripting the answer and asserting the title, detail and labels it
    always has. The options arrive as confirmInPanel received them plus inPanel: true, never with
    modal: true, so a suite tells a confirmation from a notification the mock also answers.

    The broker itself (the request posted, the one-use id, Cancel on ready, a new model, a failure to
    draw or a closed panel) and the dialog the panel draws are tested in RecipeCockpitConfirmDialog.test.ts.

    Call it at the top level of a suite: the spy is made in a beforeEach, since restoreMocks removes it after every test.
*/
export function answerInPanelConfirmationsThroughWarningMock(): void {

    beforeEach(() => {
        jest.spyOn(RecipeCockpitService, 'confirmInPanel').mockImplementation((message: string, confirmOptions: IRecipeCockpitConfirmOptions, ...buttonLabels: string[]) =>
            Promise.resolve((vscode.window.showWarningMessage as unknown as jest.Mock)(message, { ...confirmOptions, inPanel: true }, ...buttonLabels)));
    });

}
