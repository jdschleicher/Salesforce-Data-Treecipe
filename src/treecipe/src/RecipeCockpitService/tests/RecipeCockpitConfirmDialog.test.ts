import * as matchers from 'jest-extended';
expect.extend(matchers);
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

jest.mock('vscode', () => ({
    window: { createWebviewPanel: jest.fn(), withProgress: jest.fn(), showWarningMessage: jest.fn(), showInputBox: jest.fn() },
    commands: { executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    ProgressLocation: { Notification: 15 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }) }
}), { virtual: true });

import {
    RecipeCockpitService,
    IRecipeCockpitPanelState,
    RECIPE_COCKPIT_BUTTON_KINDS,
    RECIPE_COCKPIT_CHANGE_ORG_BUSY_REFUSAL,
    RECIPE_COCKPIT_CHANGE_ORG_PLACEHOLDER,
    RECIPE_COCKPIT_CHANGE_ORG_REFUSAL_PREFIX,
    RECIPE_COCKPIT_CHANGE_ORG_SANDBOX_ONLY_REASON,
    RECIPE_COCKPIT_CONFIRM_CHANGE_ORG_LABEL,
    RECIPE_COCKPIT_CONFIRM_HIDDEN_REFUSAL,
    RECIPE_COCKPIT_CONFIRM_WARNINGS_LABEL,
    RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY,
    RECIPE_COCKPIT_RESET_SELECTION_CONFIRM_LABEL
} from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { ErrorHandlingService } from '../../ErrorHandlingService/ErrorHandlingService';

/*
    #349: the cockpit's confirmations are asked INSIDE the panel, in its own style, with a body that
    scrolls, in place of VS Code's gray modal. The host writes every string and keeps the decision
    behind a one-use id; the panel draws the lines with textContent and answers with the index of a
    button it was given. A reload, a new model, a failure to draw or a closed panel is Cancel.
*/

const HISTORY_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'historyWorkspace');
const CURRENT_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const LEAD_TREE_KEY = 'Lead-ONLY';
const SERVICE_SOURCE_PATH = path.join(__dirname, '..', 'RecipeCockpitService.ts');
const EXTENSION_COMMAND_SERVICE_SOURCE_PATH = path.join(__dirname, '..', '..', 'ExtensionCommandService', 'ExtensionCommandService.ts');

const flushMicrotasks = () => new Promise(resolve => setImmediate(resolve));

const buildWorkspaceState = () => {
    const storedValues = new Map<string, unknown>();
    return {
        storedValues,
        get: jest.fn((key: string) => storedValues.get(key)) as jest.Mock,
        update: jest.fn((key: string, value: unknown) => {
            if ( value === undefined ) { storedValues.delete(key); } else { storedValues.set(key, JSON.parse(JSON.stringify(value))); }
            return Promise.resolve();
        }) as jest.Mock
    };
};

describe('RecipeCockpitService, confirmations inside the panel (#349)', () => {

    describe('the host', () => {

        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let disposeHandler: (() => void) | undefined;
        let viewStateHandler: ((viewStateEvent: any) => void) | undefined;
        let createdPanel: any;
        let postedPanelMessages: any[];

        const lastPosted = (command: string) => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === command);
        const postedOf = (command: string) => postedPanelMessages.filter(hostMessage => hostMessage.command === command);
        const panelState = () => ( RecipeCockpitService as any ).recipeCockpitPanelState as IRecipeCockpitPanelState;

        const buildWebviewPanel = () => ( createdPanel = {
            visible: true,
            reveal: jest.fn(),
            dispose: jest.fn(),
            onDidChangeViewState: jest.fn().mockImplementation((handler: (viewStateEvent: any) => void) => { viewStateHandler = handler; return { dispose: jest.fn() }; }),
            onDidDispose: jest.fn().mockImplementation((handler: () => void) => { disposeHandler = handler; return { dispose: jest.fn() }; }),
            webview: {
                html: '',
                postMessage: jest.fn().mockImplementation((hostMessage: any) => { postedPanelMessages.push(hostMessage); return Promise.resolve(true); }),
                onDidReceiveMessage: jest.fn().mockImplementation((messageHandler: (panelMessage: any) => Promise<void>) => {
                    receivedMessageHandler = messageHandler;
                    return { dispose: jest.fn() };
                })
            }
        } );

        const openAndDraw = async (workspaceState = buildWorkspaceState()) => {
            await RecipeCockpitService.openRecipeCockpitPanel(HISTORY_WORKSPACE_ROOT, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            const recipeDataMessage = lastPosted('recipeData');
            await receivedMessageHandler({ command: 'rendered', renderSequence: recipeDataMessage.renderSequence });
            return recipeDataMessage;
        };

        // RESET SELECTION ASKS ONLY WHILE THE CARD LEAVES SOMETHING OUT, SO ONE FIELD IS UNTICKED FIRST
        const startReset = async (workspaceState: ReturnType<typeof buildWorkspaceState>) => {
            await receivedMessageHandler({ command: 'setFieldIncluded', treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', fieldApiName: 'Company', included: false });
            expect(workspaceState.storedValues.get(RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY)).toBeDefined();
            const resetDone = receivedMessageHandler({ command: 'resetTreeSelection', treeKey: LEAD_TREE_KEY });
            await flushMicrotasks();
            // WRAPPED: AN async FUNCTION RETURNING THE PROMISE ITSELF WOULD WAIT FOR THE RESET, WHICH WAITS FOR THE ANSWER
            return { resetDone: resetDone };
        };

        const isReset = (workspaceState: ReturnType<typeof buildWorkspaceState>) => {
            const storedSelection: any = workspaceState.storedValues.get(RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY);
            return !storedSelection?.excludedFieldApiNamesByFolderName?.[LEAD_TREE_KEY];
        };

        beforeEach(() => {
            postedPanelMessages = [];
            (vscode.window.showWarningMessage as jest.Mock).mockReset();
            (vscode.window.createWebviewPanel as jest.Mock).mockImplementation(() => buildWebviewPanel());
            jest.spyOn(VSCodeWorkspaceService, 'createStatusBarPhaseItem').mockImplementation((initialMessage: string) => ({ text: initialMessage, dispose: jest.fn() }) as any);
        });

        afterEach(() => {
            disposeHandler?.();
            disposeHandler = undefined;
        });

        it('posts the confirmation to the panel under a one-use id, never opens VS Code\'s modal, and does what the chosen button says', async () => {

            const workspaceState = buildWorkspaceState();
            const recipeDataMessage = await openAndDraw(workspaceState);
            const { resetDone } = await startReset(workspaceState);

            const confirmRequest = lastPosted('confirmRequest');
            expect(confirmRequest).toEqual({
                command: 'confirmRequest',
                confirmationId: expect.stringMatching(/^[0-9a-f]{32}$/),
                renderSequence: recipeDataMessage.renderSequence,
                title: 'Reset the selection of Lead-ONLY?',
                summary: [expect.stringContaining('Every object is included')],
                warnings: [],
                sections: [{ title: 'What stays', lines: [expect.stringContaining('The recipe file is not changed')] }],
                buttons: [RECIPE_COCKPIT_RESET_SELECTION_CONFIRM_LABEL],
                isDestructive: false
            });
            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
            expect(isReset(workspaceState)).toBeFalse();

            await receivedMessageHandler({ command: 'confirmResponse', confirmationId: confirmRequest.confirmationId, choice: 0 });
            await resetDone;

            expect(isReset(workspaceState)).toBeTrue();

        });

        it.each([
            ['Cancel (null)', null],
            ['an index past the buttons it offered', 1],
            ['a negative index', -1],
            ['a fractional index', 0.5],
            ['a string', '0']
        ])('reads %s as Cancel, and does nothing', async (_description, choice) => {

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);
            const { resetDone } = await startReset(workspaceState);

            await receivedMessageHandler({ command: 'confirmResponse', confirmationId: lastPosted('confirmRequest').confirmationId, choice: choice });
            await resetDone;

            expect(isReset(workspaceState)).toBeFalse();

        });

        it('spends an id once: a repeated answer, or one under another id, routes to nothing', async () => {

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);
            const { resetDone } = await startReset(workspaceState);
            const confirmationId = lastPosted('confirmRequest').confirmationId;

            expect(RecipeCockpitService.routePanelMessage({ command: 'confirmResponse', confirmationId: 'f'.repeat(32), choice: 0 }, panelState())).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'confirmResponse', confirmationId: confirmationId, choice: 0 }, panelState()))
                .toEqual({ kind: 'answerConfirmation', confirmationId: confirmationId, choice: 0, isChangeOrg: false });

            await receivedMessageHandler({ command: 'confirmResponse', confirmationId: confirmationId, choice: null });
            await resetDone;

            expect(RecipeCockpitService.routePanelMessage({ command: 'confirmResponse', confirmationId: confirmationId, choice: 0 }, panelState())).toBeUndefined();
            expect(isReset(workspaceState)).toBeFalse();

        });

        it('routes a forged answer to nothing when no confirmation is pending', async () => {

            await openAndDraw();

            expect(RecipeCockpitService.routePanelMessage({ command: 'confirmResponse', confirmationId: 'a'.repeat(32), choice: 0 }, panelState())).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'confirmResponse', choice: 0 }, panelState())).toBeUndefined();

        });

        it('cancels on "ready" -- a reveal reloads the document -- and never replays the confirmation', async () => {

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);
            const { resetDone } = await startReset(workspaceState);
            const confirmationId = lastPosted('confirmRequest').confirmationId;
            postedPanelMessages = [];

            await receivedMessageHandler({ command: 'ready' });
            await resetDone;

            expect(isReset(workspaceState)).toBeFalse();
            expect(postedOf('confirmRequest')).toEqual([]);
            expect(RecipeCockpitService.routePanelMessage({ command: 'confirmResponse', confirmationId: confirmationId, choice: 0 }, panelState())).toBeUndefined();

        });

        it('cancels when a new model is posted', async () => {

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);
            const { resetDone } = await startReset(workspaceState);
            const firstRecipeData = lastPosted('recipeData');

            await receivedMessageHandler({ command: 'selectRun', runFolderName: CURRENT_RUN_FOLDER_NAME });
            await resetDone;

            expect(lastPosted('recipeData')).not.toBe(firstRecipeData);
            expect(isReset(workspaceState)).toBeFalse();

        });

        it('cancels on a failure to draw, but not on a throw after a successful draw', async () => {

            // A FAILURE IS REPORTED THROUGH THE SHARED HANDLER, WHICH THIS SUITE DOES NOT DRAW
            const handleCapturedErrorSpy = jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);
            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);

            const { resetDone: firstResetDone } = await startReset(workspaceState);
            await receivedMessageHandler({ command: 'renderFailed', phase: 'runtime', message: 'a keystroke threw' });
            expect(RecipeCockpitService.routePanelMessage({ command: 'confirmResponse', confirmationId: lastPosted('confirmRequest').confirmationId, choice: null }, panelState())).toBeDefined();
            await receivedMessageHandler({ command: 'confirmResponse', confirmationId: lastPosted('confirmRequest').confirmationId, choice: null });
            await firstResetDone;

            const secondResetDone = receivedMessageHandler({ command: 'resetTreeSelection', treeKey: LEAD_TREE_KEY });
            await flushMicrotasks();
            await receivedMessageHandler({ command: 'renderFailed', phase: 'render', message: 'the draw threw' });
            await secondResetDone;

            expect(isReset(workspaceState)).toBeFalse();
            expect(handleCapturedErrorSpy).toHaveBeenCalledTimes(2);

        });

        it('cancels when the panel closes', async () => {

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);
            const { resetDone } = await startReset(workspaceState);

            disposeHandler?.();
            disposeHandler = undefined;
            await resetDone;

            expect(isReset(workspaceState)).toBeFalse();

        });

        it('answers a newer request in place of an open one, which is Cancel', async () => {

            await openAndDraw();

            const firstAnswer = RecipeCockpitService.confirmInPanel('First?', { summary: ['one'] }, 'Go');
            const firstId = lastPosted('confirmRequest').confirmationId;
            const secondAnswer = RecipeCockpitService.confirmInPanel('Second?', { summary: ['two', '', '  three'], isDestructive: true }, 'Do it', 'Other');
            const secondRequest = lastPosted('confirmRequest');

            await expect(firstAnswer).resolves.toBeUndefined();
            expect(secondRequest.confirmationId).not.toBe(firstId);
            expect(secondRequest).toMatchObject({ title: 'Second?', summary: ['two', '', '  three'], warnings: [], sections: [], buttons: ['Do it', 'Other'], isDestructive: true });

            await receivedMessageHandler({ command: 'confirmResponse', confirmationId: firstId, choice: 0 });
            await receivedMessageHandler({ command: 'confirmResponse', confirmationId: secondRequest.confirmationId, choice: 1 });

            await expect(secondAnswer).resolves.toBe('Other');

        });

        it('asks nothing in a hidden cockpit, whose document is gone: shows it, says so, and is Cancel at once', async () => {

            await openAndDraw();
            const warningSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);
            createdPanel.visible = false;
            createdPanel.reveal.mockClear();

            await expect(RecipeCockpitService.confirmInPanel('Hidden?', { summary: ['x'] }, 'Go')).resolves.toBeUndefined();

            expect(postedOf('confirmRequest')).toEqual([]);
            expect(createdPanel.reveal).toHaveBeenCalledTimes(1);
            expect(warningSpy).toHaveBeenCalledWith(RECIPE_COCKPIT_CONFIRM_HIDDEN_REFUSAL);

        });

        it('is Cancel the moment the cockpit is hidden with a confirmation open, not on the next reveal', async () => {

            await openAndDraw();
            const answer = RecipeCockpitService.confirmInPanel('Open?', { summary: ['x'] }, 'Go');
            const confirmationId = lastPosted('confirmRequest').confirmationId;

            viewStateHandler?.({ webviewPanel: { visible: true } });
            expect(RecipeCockpitService.routePanelMessage({ command: 'confirmResponse', confirmationId: confirmationId, choice: 0 }, panelState())).toBeDefined();

            viewStateHandler?.({ webviewPanel: { visible: false } });

            await expect(answer).resolves.toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'confirmResponse', confirmationId: confirmationId, choice: 0 }, panelState())).toBeUndefined();

        });

        // THE ROUTER FILTERS A STALE ID FIRST; THE SETTLE CHECKS AGAIN, SO AN ACTION BUILT ANY OTHER WAY CANNOT ANSWER IT
        it('settles only under the pending id, even past the router', async () => {

            await openAndDraw();
            const answer = RecipeCockpitService.confirmInPanel('Open?', { summary: ['x'] }, 'Go');
            const confirmationId = lastPosted('confirmRequest').confirmationId;

            ( RecipeCockpitService as any ).settlePendingConfirmation('0'.repeat(32), 0);
            expect(RecipeCockpitService.routePanelMessage({ command: 'confirmResponse', confirmationId: confirmationId, choice: 0 }, panelState())).toBeDefined();

            ( RecipeCockpitService as any ).settlePendingConfirmation(confirmationId, 0);
            await expect(answer).resolves.toBe('Go');

        });

        describe('"Change org…" (#480)', () => {

            const QA_ORG = { alias: 'qa', username: 'qa@example.com' };
            const RESTART = { restartMessage: { command: 'resetTreeSelection', treeKey: LEAD_TREE_KEY }, isSandboxOnly: true };

            /*
                Runs one routed panel action whose executor asks a confirmation offering "Change org…",
                the way a retrieve, deploy, assignment or insert does, and records when it ENDS, so a
                test can tell the restart came after the action released everything it held.
            */
            const startActionAskingWithChangeOrg = async (events: string[]) => {

                let answer: Promise<string | undefined> | undefined;
                jest.spyOn(RecipeCockpitService as any, 'executePanelAction').mockImplementationOnce(async () => {
                    answer = RecipeCockpitService.confirmInPanel('Deploy?', { summary: ['Deploy 2 components.'], org: QA_ORG, badge: 'Sandbox', changeOrg: RESTART }, 'Deploy');
                    events.push(`answered ${String(await answer)}`);
                    events.push('action ended');
                });

                const actionDone = receivedMessageHandler({ command: 'resetTreeSelection', treeKey: LEAD_TREE_KEY });
                await flushMicrotasks();
                return { actionDone: actionDone, answer: () => answer };

            };

            it('posts the org as its own part, and offers the button only inside a panel action whose confirmation names what to start again', async () => {

                await openAndDraw();

                // OUTSIDE A PANEL ACTION NOTHING CAN START IT AGAIN, SO NO BUTTON
                const outsideAnswer = RecipeCockpitService.confirmInPanel('Deploy?', { summary: ['x'], org: QA_ORG, changeOrg: RESTART }, 'Deploy');
                expect(lastPosted('confirmRequest')).toMatchObject({ org: QA_ORG });
                expect(lastPosted('confirmRequest').canChangeOrg).toBeUndefined();
                ( RecipeCockpitService as any ).settlePendingConfirmation(lastPosted('confirmRequest').confirmationId, null, undefined, true);
                await expect(outsideAnswer).resolves.toBeUndefined();

                // NO ORG, NO BUTTON
                const restartSpy = jest.spyOn(RecipeCockpitService as any, 'changeOrgAndRestart').mockResolvedValue(undefined);
                jest.spyOn(RecipeCockpitService as any, 'executePanelAction').mockImplementationOnce(async () => {
                    await RecipeCockpitService.confirmInPanel('Deploy?', { summary: ['x'], changeOrg: RESTART }, 'Deploy');
                });
                const actionDone = receivedMessageHandler({ command: 'resetTreeSelection', treeKey: LEAD_TREE_KEY });
                await flushMicrotasks();
                expect(lastPosted('confirmRequest').canChangeOrg).toBeUndefined();
                expect(lastPosted('confirmRequest').org).toBeUndefined();
                await receivedMessageHandler({ command: 'confirmResponse', confirmationId: lastPosted('confirmRequest').confirmationId, choice: null, changeOrg: true });
                await actionDone;
                expect(restartSpy).not.toHaveBeenCalled();

            });

            it('is Cancel to the action that asked, and starts it again only once that action has ended', async () => {

                await openAndDraw();
                const events: string[] = [];
                const restartSpy = jest.spyOn(RecipeCockpitService as any, 'changeOrgAndRestart').mockImplementation(async (_panel: unknown, orgChange: unknown) => {
                    events.push('restart');
                    expect(orgChange).toEqual(RESTART);
                });

                const { actionDone } = await startActionAskingWithChangeOrg(events);
                const confirmRequest = lastPosted('confirmRequest');
                expect(confirmRequest).toMatchObject({ org: QA_ORG, badge: 'Sandbox', canChangeOrg: true, buttons: ['Deploy'] });

                expect(RecipeCockpitService.routePanelMessage({ command: 'confirmResponse', confirmationId: confirmRequest.confirmationId, choice: null, changeOrg: true }, panelState()))
                    .toEqual({ kind: 'answerConfirmation', confirmationId: confirmRequest.confirmationId, choice: null, isChecked: undefined, isChangeOrg: true });

                await receivedMessageHandler({ command: 'confirmResponse', confirmationId: confirmRequest.confirmationId, choice: null, changeOrg: true });
                await actionDone;

                expect(events).toEqual(['answered undefined', 'action ended', 'restart']);
                expect(restartSpy).toHaveBeenCalledTimes(1);

            });

            it('starts nothing again for a button\'s answer, Cancel, or a "Change org…" answer under another id', async () => {

                await openAndDraw();
                const restartSpy = jest.spyOn(RecipeCockpitService as any, 'changeOrgAndRestart').mockResolvedValue(undefined);

                for ( const response of [{ choice: 0 }, { choice: null }] ) {
                    const events: string[] = [];
                    const { actionDone } = await startActionAskingWithChangeOrg(events);
                    await receivedMessageHandler({ command: 'confirmResponse', confirmationId: lastPosted('confirmRequest').confirmationId, ...response });
                    await actionDone;
                    expect(events[0]).toBe(response.choice === 0 ? 'answered Deploy' : 'answered undefined');
                }

                const events: string[] = [];
                const { actionDone } = await startActionAskingWithChangeOrg(events);
                await receivedMessageHandler({ command: 'confirmResponse', confirmationId: 'f'.repeat(32), choice: null, changeOrg: true });
                await receivedMessageHandler({ command: 'confirmResponse', confirmationId: lastPosted('confirmRequest').confirmationId, choice: null });
                await actionDone;

                expect(restartSpy).not.toHaveBeenCalled();

            });

            describe('choosing the org and starting the action again', () => {

                const SELECTED_ORG = { targetOrgIdentifier: 'dev', alias: 'dev', username: 'dev@example.com' };
                let promptSpy: jest.SpyInstance;
                let routeSpy: jest.SpyInstance;
                let runSpy: jest.SpyInstance;

                beforeEach(() => {
                    promptSpy = jest.spyOn(RecipeCockpitService as any, 'promptAndSelectDataOrg').mockImplementation(async (...promptArguments: any[]) => {
                        const promptPanelState = promptArguments[1] as IRecipeCockpitPanelState;
                        expect(promptPanelState.isOrgPromptOpen).toBeTrue();
                        promptPanelState.dataOrgSelection = { orgIndex: 3, orgDetail: SELECTED_ORG } as any;
                        return true;
                    });
                    routeSpy = jest.spyOn(RecipeCockpitService, 'routePanelMessage');
                    runSpy = jest.spyOn(RecipeCockpitService as any, 'runPanelAction');
                    jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);
                });

                // ONLY WHAT THE RESTART ROUTES: THE OPEN'S OWN ready AND rendered ARE ROUTED TOO
                const changeOrg = (orgChange: unknown) => ( RecipeCockpitService as any ).changeOrgAndRestart(createdPanel, orgChange);
                const openAndDrawThenWatch = async () => { await openAndDraw(); routeSpy.mockClear(); };

                it('asks over the Target Org Manager listing, holding the selection, and for a write only accepts a sandbox', async () => {

                    await openAndDrawThenWatch();
                    const selectionBefore = { orgIndex: 0, orgDetail: { username: 'old@example.com' } } as any;
                    panelState().dataOrgSelection = selectionBefore;
                    routeSpy.mockReturnValueOnce(undefined);

                    await changeOrg(RESTART);

                    expect(promptSpy).toHaveBeenCalledTimes(1);
                    const promptArguments = promptSpy.mock.calls[0];
                    expect(promptArguments.slice(4)).toEqual([RECIPE_COCKPIT_CHANGE_ORG_PLACEHOLDER, RECIPE_COCKPIT_CHANGE_ORG_REFUSAL_PREFIX, RECIPE_COCKPIT_CHANGE_ORG_SANDBOX_ONLY_REASON, selectionBefore]);
                    expect(panelState().isOrgPromptOpen).toBeFalse();

                    await changeOrg({ ...RESTART, isSandboxOnly: false });
                    expect(promptSpy.mock.calls[1][6]).toBeUndefined();

                });

                it('routes the action\'s message again, with the new selection\'s index for an action that posts one', async () => {

                    await openAndDrawThenWatch();
                    routeSpy.mockReturnValue(undefined);

                    await changeOrg({ restartMessage: { command: 'deployTreeFields', treeKey: LEAD_TREE_KEY, orgIndex: null }, isSandboxOnly: true });
                    await changeOrg({ restartMessage: { command: 'retrieveTreeFields', treeKey: LEAD_TREE_KEY }, isSandboxOnly: false });

                    expect(routeSpy.mock.calls.map(call => call[0])).toEqual([
                        { command: 'deployTreeFields', treeKey: LEAD_TREE_KEY, orgIndex: 3 },
                        { command: 'retrieveTreeFields', treeKey: LEAD_TREE_KEY }
                    ]);

                    routeSpy.mockReturnValueOnce({ kind: 'activateDatasetActions' });
                    runSpy.mockResolvedValueOnce(undefined);
                    await changeOrg(RESTART);
                    expect(runSpy).toHaveBeenCalledWith(createdPanel, { kind: 'activateDatasetActions' });

                });

                it('starts nothing again on a dismissed or refused pick, a new model, or while another run holds the selection', async () => {

                    await openAndDrawThenWatch();

                    promptSpy.mockResolvedValueOnce(false);
                    await changeOrg(RESTART);
                    expect(routeSpy).not.toHaveBeenCalled();

                    promptSpy.mockImplementationOnce(async () => { panelState().recipeDataMessage = { ...panelState().recipeDataMessage } as any; return true; });
                    await changeOrg(RESTART);
                    expect(routeSpy).not.toHaveBeenCalled();

                    panelState().insertStateMessage = { command: 'insertState', isRunning: true, treeKey: LEAD_TREE_KEY } as any;
                    promptSpy.mockClear();
                    await changeOrg(RESTART);
                    expect(promptSpy).not.toHaveBeenCalled();
                    expect(VSCodeWorkspaceService.showWarningMessage).toHaveBeenCalledWith(RECIPE_COCKPIT_CHANGE_ORG_BUSY_REFUSAL);
                    expect(routeSpy).not.toHaveBeenCalled();

                });

            });

        });

        it('asks with a checkbox only when told to, and answers whether it was ticked under the button chosen (#402)', async () => {

            await openAndDraw();

            const plainAnswer = RecipeCockpitService.confirmInPanel('Plain?', { summary: ['x'] }, 'Go');
            expect(lastPosted('confirmRequest')).not.toHaveProperty('checkboxLabel');
            await receivedMessageHandler({ command: 'confirmResponse', confirmationId: lastPosted('confirmRequest').confirmationId, choice: 0, isChecked: true });
            await expect(plainAnswer).resolves.toBe('Go');

            const tickedAnswer = RecipeCockpitService.confirmInPanelWithCheckbox('Boxed?', { summary: ['x'], isDestructive: true, checkboxLabel: 'Also this' }, 'Go');
            expect(lastPosted('confirmRequest')).toMatchObject({ title: 'Boxed?', buttons: ['Go'], isDestructive: true, checkboxLabel: 'Also this' });
            await receivedMessageHandler({ command: 'confirmResponse', confirmationId: lastPosted('confirmRequest').confirmationId, choice: 0, isChecked: true });
            await expect(tickedAnswer).resolves.toEqual({ chosenLabel: 'Go', isChecked: true });

            const untickedAnswer = RecipeCockpitService.confirmInPanelWithCheckbox('Boxed?', { summary: ['x'], checkboxLabel: 'Also this' }, 'Go');
            await receivedMessageHandler({ command: 'confirmResponse', confirmationId: lastPosted('confirmRequest').confirmationId, choice: 0 });
            await expect(untickedAnswer).resolves.toEqual({ chosenLabel: 'Go', isChecked: false });

            // A TICKED BOX UNDER CANCEL IS NOTHING
            const cancelledAnswer = RecipeCockpitService.confirmInPanelWithCheckbox('Boxed?', { summary: ['x'], checkboxLabel: 'Also this' }, 'Go');
            await receivedMessageHandler({ command: 'confirmResponse', confirmationId: lastPosted('confirmRequest').confirmationId, choice: null, isChecked: true });
            await expect(cancelledAnswer).resolves.toEqual({ chosenLabel: undefined, isChecked: false });

        });

        it.each([
            ['a string', 'true'],
            ['a number', 1],
            ['null', null],
            ['an object', { isChecked: true }]
        ])('reads an isChecked that is %s as Cancel, with or without a checkbox', async (_description, isChecked) => {

            await openAndDraw();

            const boxedAnswer = RecipeCockpitService.confirmInPanelWithCheckbox('Boxed?', { summary: ['x'], checkboxLabel: 'Also this' }, 'Go');
            await receivedMessageHandler({ command: 'confirmResponse', confirmationId: lastPosted('confirmRequest').confirmationId, choice: 0, isChecked: isChecked });
            await expect(boxedAnswer).resolves.toEqual({ chosenLabel: undefined, isChecked: false });

            const plainAnswer = RecipeCockpitService.confirmInPanel('Plain?', { summary: ['x'] }, 'Go');
            await receivedMessageHandler({ command: 'confirmResponse', confirmationId: lastPosted('confirmRequest').confirmationId, choice: 0, isChecked: isChecked });
            await expect(plainAnswer).resolves.toBeUndefined();

        });

        it('is Cancel, unticked, for a checkbox confirmation when nothing is drawn', async () => {

            await expect(RecipeCockpitService.confirmInPanelWithCheckbox('Nothing open?', { summary: [], checkboxLabel: 'x' }, 'Go')).resolves.toEqual({ chosenLabel: undefined, isChecked: false });

        });

        it('is Cancel at once, posting nothing, when no model is drawn or no panel is open', async () => {

            await expect(RecipeCockpitService.confirmInPanel('Nothing open?', { summary: [] }, 'Go')).resolves.toBeUndefined();

            await RecipeCockpitService.openRecipeCockpitPanel(HISTORY_WORKSPACE_ROOT, buildWorkspaceState());
            await receivedMessageHandler({ command: 'ready' });

            await expect(RecipeCockpitService.confirmInPanel('Not drawn yet?', { summary: [] }, 'Go')).resolves.toBeUndefined();
            expect(postedOf('confirmRequest')).toEqual([]);

        });

    });

    describe('the parts a confirmation posts (#457)', () => {

        it('splits a line break into lines, drops the gaps at either end of a part, and leaves out an empty section or a blank warning', () => {

            expect(RecipeCockpitService.buildConfirmRequestContent({
                summary: ['', 'One\nTwo', ''],
                badge: 'Sandbox',
                warnings: ['', 'Careful\r\nTwice', '  '],
                sections: [
                    { title: 'Empty', lines: [] },
                    { title: 'Gaps only', lines: ['', ''] },
                    { title: 'Kept', count: 2, lines: ['', 'a', '', 'b', ''] },
                    { title: 'Bad count', count: -1, lines: ['c'] }
                ]
            })).toEqual({
                summary: ['One', 'Two'],
                badge: 'Sandbox',
                warnings: ['Careful', 'Twice'],
                sections: [{ title: 'Kept', count: 2, lines: ['a', '', 'b'] }, { title: 'Bad count', lines: ['c'] }]
            });

        });

        it('posts the org as one line each of alias and username, leaving out an empty alias and an org with no username (#480)', () => {

            expect(RecipeCockpitService.buildConfirmRequestContent({ summary: ['s'], org: { alias: 'qa\nTwo', username: ' qa@example.com\r\n' } }).org).toEqual({ alias: 'qa Two', username: 'qa@example.com' });
            expect(RecipeCockpitService.buildConfirmRequestContent({ summary: ['s'], org: { alias: '', username: 'qa@example.com' } }).org).toEqual({ username: 'qa@example.com' });
            expect(RecipeCockpitService.buildConfirmRequestContent({ summary: ['s'], org: { alias: 'qa', username: '' } })).not.toHaveProperty('org');

        });

        it('posts every part even when the host gave only a summary, and no badge when it gave none', () => {

            expect(RecipeCockpitService.buildConfirmRequestContent({ summary: ['Only this'] })).toEqual({ summary: ['Only this'], warnings: [], sections: [] });

        });

        it('flattens the parts into one text in the order the dialog draws them, for the suites that read one detail string', () => {

            expect(RecipeCockpitService.flattenConfirmContent({
                summary: ['Summary'],
                badge: 'Sandbox',
                warnings: ['Warning'],
                sections: [{ title: 'Records', count: 2, lines: ['a', 'b'] }, { title: 'Next', lines: ['c'] }]
            })).toBe('Summary\nWarning\n\nRecords · 2\na\nb\n\nNext\nc');

            expect(RecipeCockpitService.flattenConfirmContent({ summary: ['Summary'], org: { alias: 'qa', username: 'qa@example.com' }, warnings: ['Warning'] })).toBe('Summary\nOrg: qa · qa@example.com\nWarning');
            expect(RecipeCockpitService.flattenConfirmContent({ summary: ['Summary'], org: { username: 'qa@example.com' } })).toBe('Summary\nOrg: qa@example.com');

        });

    });

    describe('the source', () => {

        it('asks no cockpit confirmation in VS Code\'s modal', () => {

            const serviceSource = fs.readFileSync(SERVICE_SOURCE_PATH, 'utf8');

            expect(serviceSource).not.toMatch(/modal:\s*true/);
            expect(serviceSource.match(/this\.confirmInPanel\(/g) ?? []).toHaveLength(21);
            expect(serviceSource.match(/this\.confirmInPanelWithCheckbox\(/g) ?? []).toHaveLength(1);

        });

        it('leaves the palette commands on VS Code\'s modal', () => {

            const commandSource = fs.readFileSync(EXTENSION_COMMAND_SERVICE_SOURCE_PATH, 'utf8');

            expect((commandSource.match(/modal:\s*true/g) ?? []).length).toBeGreaterThanOrEqual(1);
            expect(commandSource).not.toContain('confirmInPanel');

        });

    });

    describe('the panel', () => {

        const drawnPanel = () => {
            const panel = runPanelScript({ prefersReducedMotion: false });
            panel.postToPanel({ command: 'recipeData', recipe: { runs: [], selectedRunFolderName: '', objects: [], trees: [], notices: [], emptyStateMessage: 'No run.' }, renderSequence: 4 });
            return panel;
        };

        const confirmRequest = (overrides: Record<string, unknown> = {}) => ({
            command: 'confirmRequest',
            confirmationId: 'c'.repeat(32),
            renderSequence: 4,
            title: 'Generate <b>Tree</b> and insert it?',
            summary: ['Generate 1800 records and insert them into qa · qa@example.com.'],
            badge: 'Sandbox',
            warnings: ['Cancel on the progress notification deletes every record this insert saved.'],
            sections: [
                { title: 'Records, inserted parents first', count: 2, lines: ['  Account: 300', '  Contact: 1500'] },
                { title: 'Components <b>', lines: ['Org: qa · qa@example.com', '', ...Array.from({ length: 60 }, (_unused, lineIndex) => `- line ${lineIndex}`)] }
            ],
            buttons: ['Generate and insert', 'Generate only'],
            isDestructive: true,
            ...overrides
        });

        const dialogOf = (panel: ReturnType<typeof runPanelScript>) => panel.findAll(panel.cockpitDialogHostElement, 'confirmDialog')[0];
        const responses = (panel: ReturnType<typeof runPanelScript>) => panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'confirmResponse');

        it('draws a modal dialog over the cockpit: title, a scrolling body, the host\'s buttons then Cancel, the rest inert', () => {

            const panel = drawnPanel();
            panel.postToPanel(confirmRequest());

            const dialogElement = dialogOf(panel);
            const bodyElement = panel.findAll(dialogElement, 'confirmBody')[0];
            expect(dialogElement.attributes).toMatchObject({ 'role': 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'confirmTitle', 'aria-describedby': 'confirmBody' });
            expect(panel.findAll(dialogElement, 'confirmTitle')[0]).toMatchObject({ tagName: 'h2', textContent: 'Generate <b>Tree</b> and insert it?' });
            expect(bodyElement.attributes).toMatchObject({ id: 'confirmBody', tabindex: '0' });
            expect(panel.findAll(panel.findAll(dialogElement, 'confirmActions')[0], 'sdtButton').map((buttonElement: any) => buttonElement.textContent)).toEqual(['Generate and insert', 'Generate only', 'Cancel']);
            panel.findAll(dialogElement, 'sdtButton').forEach((buttonElement: any) => {
                expect(RECIPE_COCKPIT_BUTTON_KINDS.filter(buttonKind => buttonElement.classList.contains(`sdtButton-${buttonKind}`))).toHaveLength(1);
            });
            expect(panel.findAll(dialogElement, 'confirmChoice')[0].classList.contains('sdtButton-primary')).toBeTrue();
            [panel.cockpitBodyElement, panel.cockpitMetaElement, panel.loadStatusElement].forEach(backgroundElement => expect(backgroundElement.attributes.inert).toBe(''));

        });

        /*
            #457: the summary and the warnings are always on screen; every section is folded under
            a toggle that names it and its count, and its lines are built only when it first opens.
        */
        it('draws the summary with the org type badge, then the warnings in one callout, then each section folded (#457)', () => {

            const panel = drawnPanel();
            panel.postToPanel(confirmRequest());

            const bodyElement = panel.findAll(dialogOf(panel), 'confirmBody')[0];
            expect(bodyElement.children.map((childElement: any) => childElement.className.split(' ')[0])).toEqual(['confirmSummary', 'confirmWarnings', 'confirmSection', 'confirmSection']);

            const [summaryElement] = panel.findAll(bodyElement, 'confirmSummary');
            expect(panel.findAll(summaryElement, 'confirmLine').map((lineElement: any) => lineElement.textContent)).toEqual(['Generate 1800 records and insert them into qa · qa@example.com.']);
            expect(panel.findAll(summaryElement, 'confirmBadge')[0].textContent).toBe('Sandbox');

            const [warningsElement] = panel.findAll(bodyElement, 'confirmWarnings');
            expect(warningsElement.attributes).toMatchObject({ 'role': 'note', 'aria-label': RECIPE_COCKPIT_CONFIRM_WARNINGS_LABEL });
            expect(panel.findAll(warningsElement, 'confirmWarningsHeading')[0].textContent).toBe(RECIPE_COCKPIT_CONFIRM_WARNINGS_LABEL);
            expect(panel.findAll(warningsElement, 'confirmLine').map((lineElement: any) => lineElement.textContent)).toEqual(['Cancel on the progress notification deletes every record this insert saved.']);

            const toggleElements = panel.findAll(bodyElement, 'confirmSectionToggle');
            expect(toggleElements.map((toggleElement: any) => panel.findAll(toggleElement, 'confirmSectionTitle')[0].textContent)).toEqual(['Records, inserted parents first', 'Components <b>']);
            expect(toggleElements.map((toggleElement: any) => panel.findAll(toggleElement, 'confirmSectionCount').map((countElement: any) => countElement.textContent))).toEqual([['2'], []]);
            toggleElements.forEach((toggleElement: any, toggleIndex: number) => {
                expect(toggleElement.classList.contains('sdtButton-secondary')).toBeTrue();
                expect(toggleElement.attributes).toMatchObject({ 'aria-expanded': 'false', 'aria-controls': `confirmSection${toggleIndex}` });
            });

            // NOTHING OF A FOLDED SECTION IS BUILT
            const sectionBodies = panel.findAll(bodyElement, 'confirmSectionBody');
            sectionBodies.forEach((sectionBody: any) => {
                expect(sectionBody.classList.contains('hidden')).toBeTrue();
                expect(sectionBody.children).toEqual([]);
            });

        });

        it('builds a section\'s lines the first time it opens, folds it again on a second click, and never builds it twice (#457)', () => {

            const panel = drawnPanel();
            panel.postToPanel(confirmRequest());

            const bodyElement = panel.findAll(dialogOf(panel), 'confirmBody')[0];
            const componentsToggle = panel.findAll(bodyElement, 'confirmSectionToggle')[1];
            const componentsBody = panel.findAll(bodyElement, 'confirmSectionBody')[1];

            componentsToggle.dispatch('click');
            expect(componentsToggle.attributes['aria-expanded']).toBe('true');
            expect(componentsBody.classList.contains('hidden')).toBeFalse();
            expect(componentsBody.attributes.id).toBe('confirmSection1');
            expect(panel.findAll(componentsBody, 'confirmLine')).toHaveLength(61);
            expect(panel.findAll(componentsBody, 'confirmGap')).toHaveLength(1);
            // #457 BULLETS: EVERY LINE IS ITS OWN BULLET, A WRITTEN "- " MARKER GIVING WAY TO IT, AND THE BLANK LINE STARTS A NEW LIST
            expect(panel.findAll(componentsBody, 'confirmBullet').map((lineElement: any) => lineElement.textContent)).toContain('line 0');
            expect(panel.findAll(componentsBody, 'confirmBullets')).toHaveLength(2);

            componentsToggle.dispatch('click');
            expect(componentsToggle.attributes['aria-expanded']).toBe('false');
            expect(componentsBody.classList.contains('hidden')).toBeTrue();

            componentsToggle.dispatch('click');
            expect(panel.findAll(componentsBody, 'confirmLine')).toHaveLength(61);

            // OPENING ONE SECTION LEAVES THE OTHER FOLDED
            expect(panel.findAll(bodyElement, 'confirmSectionBody')[0].children).toEqual([]);

        });

        /*
            #457 bullets: each statement is its own bullet, so separate thoughts never run together. A
            line ending with ":" leads in the indented lines under it as a nested list; an indented line
            loses only its two-space step, so a recipe line keeps its own indentation and its "- ".
        */
        it('draws every warning and section line as its own bullet, nesting the indented lines a lead-in introduces (#457)', () => {

            const panel = drawnPanel();
            panel.postToPanel(confirmRequest({
                warnings: ['Cancel deletes every record this insert saved.', 'Lookups set to existing org records:', '  Contact.ReportsToId → 003A', '  Contact.AccountId → 001B', 'This run will take time.'],
                sections: [{ title: 'Puts back', lines: ['It puts back:', '  Rating__c:', '    - Hot', 'No lead-in:'] }]
            }));

            const bodyElement = panel.findAll(dialogOf(panel), 'confirmBody')[0];
            const [warningsElement] = panel.findAll(bodyElement, 'confirmWarnings');
            const [warningList] = panel.findAll(warningsElement, 'confirmBullets');
            expect(warningList.tagName).toBe('ul');
            expect(warningList.children.map((itemElement: any) => itemElement.ownTextContent)).toEqual(['Cancel deletes every record this insert saved.', 'Lookups set to existing org records:', 'This run will take time.']);
            const [nestedList] = panel.findAll(warningList.children[1], 'confirmSubBullets');
            expect(nestedList.children.map((itemElement: any) => itemElement.textContent)).toEqual(['Contact.ReportsToId → 003A', 'Contact.AccountId → 001B']);

            panel.findAll(bodyElement, 'confirmSectionToggle')[0].dispatch('click');
            const sectionBody = panel.findAll(bodyElement, 'confirmSectionBody')[0];
            expect(panel.findAll(sectionBody, 'confirmSubBullet').map((itemElement: any) => itemElement.textContent)).toEqual(['Rating__c:', '  - Hot']);
            // A LEAD-IN WITH NOTHING UNDER IT KEEPS NO EMPTY LIST
            expect(panel.findAll(sectionBody, 'confirmSubBullets')).toHaveLength(1);

        });

        it('draws a one-statement summary as plain text and a summary of several statements as bullets (#457)', () => {

            const onePanel = drawnPanel();
            onePanel.postToPanel(confirmRequest());
            const [oneSummary] = onePanel.findAll(dialogOf(onePanel), 'confirmSummary');
            expect(onePanel.findAll(oneSummary, 'confirmBullet')).toEqual([]);
            expect(onePanel.findAll(oneSummary, 'confirmLine')).toHaveLength(1);

            const severalPanel = drawnPanel();
            severalPanel.postToPanel(confirmRequest({ summary: ['Dev Hub: devhub', 'Alias: feature', '  Admin email: author@example.com'] }));
            const [severalSummary] = severalPanel.findAll(dialogOf(severalPanel), 'confirmSummary');
            expect(severalPanel.findAll(severalSummary, 'confirmBullet').map((itemElement: any) => itemElement.textContent)).toEqual(['Dev Hub: devhub', 'Alias: feature', 'Admin email: author@example.com']);

        });

        it('draws no callout without warnings, no badge without one, and no section with nothing to show (#457)', () => {

            const panel = drawnPanel();
            panel.postToPanel(confirmRequest({
                badge: '',
                warnings: ['', '   '],
                sections: [{ title: 'Empty', lines: [] }, { title: 'Blank', lines: ['', '  '] }, { title: 'Kept', lines: ['one'] }]
            }));

            const bodyElement = panel.findAll(dialogOf(panel), 'confirmBody')[0];
            expect(panel.findAll(bodyElement, 'confirmWarnings')).toEqual([]);
            expect(panel.findAll(bodyElement, 'confirmBadge')).toEqual([]);
            expect(panel.findAll(bodyElement, 'confirmSectionTitle').map((titleElement: any) => titleElement.textContent)).toEqual(['Kept']);

        });

        it('starts a destructive dialog on Cancel and any other on its first button', () => {

            const destructivePanel = drawnPanel();
            destructivePanel.postToPanel(confirmRequest());
            expect(destructivePanel.activeElement()).toBe(destructivePanel.findAll(dialogOf(destructivePanel), 'confirmCancel')[0]);

            const plainPanel = drawnPanel();
            plainPanel.postToPanel(confirmRequest({ isDestructive: false }));
            expect(dialogOf(plainPanel).attributes.role).toBe('dialog');
            expect(plainPanel.activeElement()).toBe(plainPanel.findAll(dialogOf(plainPanel), 'confirmChoice')[0]);

        });

        it('answers with the index of the button chosen, closes, and gives focus back to what opened it', () => {

            const panel = drawnPanel();
            const openerElement = panel.findAll(panel.cockpitMetaElement, 'helpToggle')[0];
            openerElement.focus();
            panel.postToPanel(confirmRequest());

            panel.findAll(dialogOf(panel), 'confirmChoice')[1].dispatch('click');

            expect(responses(panel)).toEqual([{ command: 'confirmResponse', confirmationId: 'c'.repeat(32), choice: 1 }]);
            expect(dialogOf(panel)).toBeUndefined();
            expect(panel.activeElement()).toBe(openerElement);
            expect(panel.cockpitBodyElement.attributes).not.toHaveProperty('inert');

        });

        it('is Cancel on Escape and on its Cancel button', () => {

            const escapePanel = drawnPanel();
            escapePanel.postToPanel(confirmRequest());
            dialogOf(escapePanel).dispatch('keydown', { key: 'Escape' });
            expect(responses(escapePanel)).toEqual([{ command: 'confirmResponse', confirmationId: 'c'.repeat(32), choice: null }]);
            expect(dialogOf(escapePanel)).toBeUndefined();

            const cancelPanel = drawnPanel();
            cancelPanel.postToPanel(confirmRequest());
            cancelPanel.findAll(dialogOf(cancelPanel), 'confirmCancel')[0].dispatch('click');
            expect(responses(cancelPanel)).toEqual([{ command: 'confirmResponse', confirmationId: 'c'.repeat(32), choice: null }]);

        });

        it('keeps Tab inside the dialog, through the scrolling body and every button', () => {

            const panel = drawnPanel();
            panel.postToPanel(confirmRequest({ isDestructive: false }));
            const dialogElement = dialogOf(panel);
            const [bodyElement] = panel.findAll(dialogElement, 'confirmBody');
            const [insertElement, generateOnlyElement] = panel.findAll(dialogElement, 'confirmChoice');
            const [cancelElement] = panel.findAll(dialogElement, 'confirmCancel');

            const focusedAfterTabs = [1, 2, 3].map(() => { dialogElement.dispatch('keydown', { key: 'Tab' }); return panel.activeElement(); });
            expect(focusedAfterTabs).toEqual([generateOnlyElement, cancelElement, bodyElement]);

            dialogElement.dispatch('keydown', { key: 'Tab', shiftKey: true });
            expect(panel.activeElement()).toBe(cancelElement);
            expect(insertElement).toBeDefined();

            // A PRESS ON THE BACKDROP KEEPS FOCUS WHERE IT IS; ONE INSIDE THE DIALOG IS LEFT ALONE
            const overlayElement = panel.findAll(panel.cockpitDialogHostElement, 'confirmOverlay')[0];
            const backdropPreventDefault = jest.fn();
            overlayElement.dispatch('mousedown', { preventDefault: backdropPreventDefault });
            expect(backdropPreventDefault).toHaveBeenCalledTimes(1);
            const insidePreventDefault = jest.fn();
            insertElement.dispatch('mousedown', { preventDefault: insidePreventDefault });
            expect(insidePreventDefault).not.toHaveBeenCalled();

        });

        it('puts every section toggle in the Tab cycle, in order, between the body and the buttons (#457)', () => {

            const panel = drawnPanel();
            panel.postToPanel(confirmRequest());
            const dialogElement = dialogOf(panel);
            const [bodyElement] = panel.findAll(dialogElement, 'confirmBody');
            const [recordsToggle, componentsToggle] = panel.findAll(dialogElement, 'confirmSectionToggle');
            const [insertElement] = panel.findAll(dialogElement, 'confirmChoice');

            // A DESTRUCTIVE DIALOG STILL STARTS ON CANCEL
            expect(panel.activeElement()).toBe(panel.findAll(dialogElement, 'confirmCancel')[0]);

            bodyElement.focus();
            const focusedAfterTabs = [1, 2, 3].map(() => { dialogElement.dispatch('keydown', { key: 'Tab' }); return panel.activeElement(); });
            expect(focusedAfterTabs).toEqual([recordsToggle, componentsToggle, insertElement]);

            // ESCAPE ON AN OPEN SECTION IS STILL CANCEL
            componentsToggle.dispatch('click');
            dialogElement.dispatch('keydown', { key: 'Escape' });
            expect(responses(panel)).toEqual([{ command: 'confirmResponse', confirmationId: 'c'.repeat(32), choice: null }]);

        });

        it('draws the org on its own line, alias and username apart from the text, with the badge and, when offered, "Change org…" (#480)', () => {

            const panel = drawnPanel();
            panel.postToPanel(confirmRequest({ org: { alias: 'qa', username: 'qa@example.com' }, canChangeOrg: true }));

            const dialogElement = dialogOf(panel);
            const [bodyElement] = panel.findAll(dialogElement, 'confirmBody');
            expect(bodyElement.children.map((childElement: any) => childElement.className.split(' ')[0])).toEqual(['confirmSummary', 'confirmOrg', 'confirmWarnings', 'confirmSection', 'confirmSection']);

            const [orgElement] = panel.findAll(bodyElement, 'confirmOrg');
            expect(orgElement.children.map((childElement: any) => [childElement.className.split(' ').filter((className: string) => className.startsWith('confirm')).join(' '), childElement.textContent]))
                .toEqual([['confirmOrgLabel', 'Org'], ['confirmOrgAlias', 'qa'], ['confirmOrgSeparator', '·'], ['confirmOrgUsername', 'qa@example.com'], ['confirmBadge', 'Sandbox'], ['confirmChangeOrg', RECIPE_COCKPIT_CONFIRM_CHANGE_ORG_LABEL]]);
            expect(panel.findAll(bodyElement, 'confirmOrgSeparator')[0].attributes['aria-hidden']).toBe('true');
            expect(panel.findAll(panel.findAll(bodyElement, 'confirmSummary')[0], 'confirmBadge')).toEqual([]);

            const [changeOrgElement] = panel.findAll(orgElement, 'confirmChangeOrg');
            expect(changeOrgElement.classList.contains('sdtButton-secondary')).toBeTrue();

            // IN THE TAB CYCLE, BETWEEN THE BODY AND THE SECTION TOGGLES
            bodyElement.focus();
            dialogElement.dispatch('keydown', { key: 'Tab' });
            expect(panel.activeElement()).toBe(changeOrgElement);
            dialogElement.dispatch('keydown', { key: 'Tab' });
            expect(panel.activeElement()).toBe(panel.findAll(dialogElement, 'confirmSectionToggle')[0]);

            changeOrgElement.dispatch('click');
            expect(responses(panel)).toEqual([{ command: 'confirmResponse', confirmationId: 'c'.repeat(32), choice: null, changeOrg: true }]);
            expect(dialogOf(panel)).toBeUndefined();

        });

        it('draws no alias or separator for an org without an alias, no button unless offered, and the badge in the summary with no org (#480)', () => {

            const panel = drawnPanel();
            panel.postToPanel(confirmRequest({ org: { username: 'qa@example.com' } }));
            const [orgElement] = panel.findAll(dialogOf(panel), 'confirmOrg');
            expect(panel.findAll(orgElement, 'confirmOrgAlias')).toEqual([]);
            expect(panel.findAll(orgElement, 'confirmOrgSeparator')).toEqual([]);
            expect(panel.findAll(orgElement, 'confirmOrgUsername')[0].textContent).toBe('qa@example.com');
            expect(panel.findAll(orgElement, 'confirmChangeOrg')).toEqual([]);

            panel.postToPanel(confirmRequest({ confirmationId: 'd'.repeat(32), canChangeOrg: true }));
            expect(panel.findAll(dialogOf(panel), 'confirmOrg')).toEqual([]);
            expect(panel.findAll(dialogOf(panel), 'confirmChangeOrg')).toEqual([]);
            expect(panel.findAll(panel.findAll(dialogOf(panel), 'confirmSummary')[0], 'confirmBadge')[0].textContent).toBe('Sandbox');

        });

        it.each([
            ['an org with no username', { alias: 'qa' }],
            ['an org with an empty username', { username: '' }],
            ['an alias that is not text', { alias: 7, username: 'qa@example.com' }],
            ['an org that is not an object', 'qa@example.com']
        ])('answers Cancel without drawing %s (#480)', (_description, org) => {

            const panel = drawnPanel();
            panel.postToPanel(confirmRequest({ org: org }));
            expect(dialogOf(panel)).toBeUndefined();
            expect(responses(panel)).toEqual([{ command: 'confirmResponse', confirmationId: 'c'.repeat(32), choice: null }]);

        });

        it('answers Cancel without drawing a request for a model that is not the one on screen, or one it cannot read', () => {

            const panel = drawnPanel();

            panel.postToPanel(confirmRequest({ renderSequence: 3 }));
            panel.postToPanel(confirmRequest({ confirmationId: 'd'.repeat(32), buttons: [] }));
            panel.postToPanel(confirmRequest({ confirmationId: 'e'.repeat(32), summary: 'not a list' }));
            // #457: ANY PART OUT OF SHAPE IS CANCEL, NEVER A DIALOG DRAWN WITH THE PART LEFT OUT
            const malformedParts: Record<string, unknown>[] = [
                { summary: ['ok', 7] },
                { warnings: undefined },
                { warnings: [null] },
                { sections: 'not a list' },
                { sections: [{ title: '', lines: ['x'] }] },
                { sections: [{ title: 'No lines' }] },
                { sections: [{ title: 'Bad line', lines: ['x', 1] }] },
                { sections: [{ title: 'Bad count', lines: ['x'], count: -1 }] },
                { sections: [{ title: 'Bad count', lines: ['x'], count: 1.5 }] },
                { sections: [null] },
                { badge: 3 }
            ];
            malformedParts.forEach((malformedPart, partIndex) => panel.postToPanel(confirmRequest({ confirmationId: String(partIndex).padStart(32, '0'), ...malformedPart })));

            expect(dialogOf(panel)).toBeUndefined();
            expect(responses(panel).map(response => [response.confirmationId, response.choice])).toEqual([
                ['c'.repeat(32), null], ['d'.repeat(32), null], ['e'.repeat(32), null],
                ...malformedParts.map((_unused, partIndex) => [String(partIndex).padStart(32, '0'), null])
            ]);

        });

        it('closes an open dialog without answering when a new model is drawn, since the host answered it Cancel', () => {

            const panel = drawnPanel();
            panel.postToPanel(confirmRequest());

            panel.postToPanel({ command: 'recipeData', recipe: { runs: [], selectedRunFolderName: '', objects: [], trees: [], notices: [], emptyStateMessage: 'No run.' }, renderSequence: 5 });

            expect(dialogOf(panel)).toBeUndefined();
            expect(responses(panel)).toEqual([]);
            expect(panel.cockpitBodyElement.attributes).not.toHaveProperty('inert');

        });

        it('draws one unticked check box under the body when asked for one, ticks it from the box or its label, and answers its state (#402)', () => {

            const panel = drawnPanel();
            panel.postToPanel(confirmRequest({ checkboxLabel: 'Also deploy <the rest>' }));

            const dialogElement = dialogOf(panel);
            const [checkElement] = panel.findAll(dialogElement, 'confirmCheck');
            const [labelElement] = panel.findAll(dialogElement, 'confirmCheckLabel');
            expect(checkElement.classList.contains('sdtButton-check')).toBeTrue();
            expect(checkElement.attributes).toMatchObject({ 'role': 'checkbox', 'aria-checked': 'false', 'aria-label': 'Also deploy <the rest>' });
            expect(labelElement.textContent).toBe('Also deploy <the rest>');
            expect(dialogElement.children.map((childElement: any) => childElement.className.split(' ')[0])).toEqual(['confirmTitle', 'confirmBody', 'confirmCheckRow', 'confirmActions']);

            checkElement.dispatch('click');
            expect(checkElement.attributes['aria-checked']).toBe('true');
            labelElement.dispatch('click');
            expect(checkElement.attributes['aria-checked']).toBe('false');
            labelElement.dispatch('click');

            panel.findAll(dialogElement, 'confirmChoice')[0].dispatch('click');
            expect(responses(panel)).toEqual([{ command: 'confirmResponse', confirmationId: 'c'.repeat(32), choice: 0, isChecked: true }]);

        });

        it('answers a ticked box under Cancel as unticked, starts every request unticked, and keeps the box in the Tab cycle', () => {

            const panel = drawnPanel();
            panel.postToPanel(confirmRequest({ checkboxLabel: 'Also this', isDestructive: false }));
            panel.findAll(dialogOf(panel), 'confirmCheck')[0].dispatch('click');
            dialogOf(panel).dispatch('keydown', { key: 'Escape' });
            expect(responses(panel)).toEqual([{ command: 'confirmResponse', confirmationId: 'c'.repeat(32), choice: null, isChecked: false }]);

            panel.postToPanel(confirmRequest({ confirmationId: 'f'.repeat(32), checkboxLabel: 'Also this', isDestructive: false }));
            const dialogElement = dialogOf(panel);
            const [checkElement] = panel.findAll(dialogElement, 'confirmCheck');
            expect(checkElement.attributes['aria-checked']).toBe('false');

            // THE BOX COMES AFTER THE BODY AND ITS TWO SECTION TOGGLES (#457), BEFORE THE BUTTONS
            const [bodyElement] = panel.findAll(dialogElement, 'confirmBody');
            bodyElement.focus();
            [1, 2, 3].forEach(() => dialogElement.dispatch('keydown', { key: 'Tab' }));
            expect(panel.activeElement()).toBe(checkElement);

            // A REQUEST WITHOUT ONE DRAWS NO BOX AND ANSWERS NO isChecked
            panel.postToPanel(confirmRequest({ confirmationId: 'a'.repeat(32), checkboxLabel: '' }));
            expect(panel.findAll(dialogOf(panel), 'confirmCheck')).toEqual([]);

        });

        it('replaces an open dialog with a newer request, keeping the control that opened the first', () => {

            const panel = drawnPanel();
            const openerElement = panel.findAll(panel.cockpitMetaElement, 'helpToggle')[0];
            openerElement.focus();
            panel.postToPanel(confirmRequest());
            panel.postToPanel(confirmRequest({ confirmationId: 'f'.repeat(32), title: 'Second?' }));

            expect(panel.findAll(panel.cockpitDialogHostElement, 'confirmDialog')).toHaveLength(1);
            expect(panel.findAll(dialogOf(panel), 'confirmTitle')[0].textContent).toBe('Second?');

            panel.findAll(dialogOf(panel), 'confirmCancel')[0].dispatch('click');
            expect(responses(panel)).toEqual([{ command: 'confirmResponse', confirmationId: 'f'.repeat(32), choice: null }]);
            expect(panel.activeElement()).toBe(openerElement);

        });

    });

    describe('the stylesheet', () => {

        const shellHtml = () => RecipeCockpitService.buildWebviewShellHtml('testNonce');
        const ruleFor = (selector: string) => new RegExp(`\\n\\s*${selector} \\{([^}]*)\\}`).exec(shellHtml())?.[1] ?? '';

        it('dims the cockpit behind a centred dialog whose body scrolls and whose buttons stay below it', () => {

            expect(ruleFor('\\.confirmOverlay')).toContain('position: fixed;');
            expect(ruleFor('\\.confirmOverlay')).toContain('background-color: var(--sdt-dialog-backdrop);');
            expect(ruleFor('\\.confirmDialog')).toContain('max-height: calc(100vh - 32px);');
            expect(ruleFor('\\.confirmDialog')).toContain('background-color: var(--sdt-surface);');
            expect(ruleFor('\\.confirmBody')).toContain('overflow-y: auto;');
            expect(ruleFor('\\.confirmBody')).toContain('max-height: 60vh;');
            expect(ruleFor('\\.confirmActions')).toContain('flex: none;');
            expect(shellHtml()).toMatch(/\.confirmLine \{[^}]*white-space: pre-wrap;/);

        });

        // #457: ONLY PAIRS THE CONTRAST TEST ALREADY HOLDS: chipText ON chipBg, text AND changed ON surface, accent ON surface
        it('draws the badge, the callout and the section toggles from token pairs the contrast test already holds (#457)', () => {

            expect(ruleFor('\\.confirmBadge')).toContain('color: var(--sdt-chip-text);');
            expect(ruleFor('\\.confirmBadge')).toContain('background-color: var(--sdt-chip-bg);');
            expect(ruleFor('\\.confirmWarnings')).toContain('color: var(--sdt-text);');
            expect(ruleFor('\\.confirmWarnings')).toContain('background-color: var(--sdt-surface);');
            expect(ruleFor('\\.confirmWarnings')).toContain('border-left: 4px solid var(--sdt-changed);');
            expect(ruleFor('\\.confirmWarningsHeading')).toContain('color: var(--sdt-changed);');
            expect(ruleFor('\\.confirmSectionCount')).toContain('color: var(--sdt-chip-text);');
            expect(ruleFor('\\.confirmSectionToggle')).not.toContain('color');

        });

        // #480: accent ON surface AND muted ON surface, PAIRS THE CONTRAST TEST ALREADY HOLDS
        it('draws the alias bold in the accent and the username in a monospace muted font, apart from the summary text (#480)', () => {

            expect(ruleFor('\\.confirmOrgAlias')).toContain('font-weight: 700;');
            expect(ruleFor('\\.confirmOrgAlias')).toContain('color: var(--sdt-accent);');
            expect(ruleFor('\\.confirmOrgUsername')).toContain('font-family: var(--vscode-editor-font-family), monospace;');
            expect(ruleFor('\\.confirmOrgUsername')).toContain('color: var(--sdt-muted);');
            expect(ruleFor('\\.confirmSummary')).not.toContain('color');
            expect(ruleFor('\\.confirmOrg')).toContain('border: 1px solid var(--sdt-border);');

        });

        it('draws the dialog host outside the body every render replaces', () => {

            expect(shellHtml()).toContain('<div id="cockpitBody"></div>\n<div id="cockpitDialogHost"></div>');

        });

    });

});
