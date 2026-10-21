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
    RECIPE_COCKPIT_CONFIRM_HIDDEN_REFUSAL,
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
                lines: [expect.stringContaining('Every object is included')],
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
                .toEqual({ kind: 'answerConfirmation', confirmationId: confirmationId, choice: 0 });

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

            const firstAnswer = RecipeCockpitService.confirmInPanel('First?', { detail: 'one' }, 'Go');
            const firstId = lastPosted('confirmRequest').confirmationId;
            const secondAnswer = RecipeCockpitService.confirmInPanel('Second?', { detail: 'two\n\n  three', isDestructive: true }, 'Do it', 'Other');
            const secondRequest = lastPosted('confirmRequest');

            await expect(firstAnswer).resolves.toBeUndefined();
            expect(secondRequest.confirmationId).not.toBe(firstId);
            expect(secondRequest).toMatchObject({ title: 'Second?', lines: ['two', '', '  three'], buttons: ['Do it', 'Other'], isDestructive: true });

            await receivedMessageHandler({ command: 'confirmResponse', confirmationId: firstId, choice: 0 });
            await receivedMessageHandler({ command: 'confirmResponse', confirmationId: secondRequest.confirmationId, choice: 1 });

            await expect(secondAnswer).resolves.toBe('Other');

        });

        it('asks nothing in a hidden cockpit, whose document is gone: shows it, says so, and is Cancel at once', async () => {

            await openAndDraw();
            const warningSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);
            createdPanel.visible = false;
            createdPanel.reveal.mockClear();

            await expect(RecipeCockpitService.confirmInPanel('Hidden?', { detail: 'x' }, 'Go')).resolves.toBeUndefined();

            expect(postedOf('confirmRequest')).toEqual([]);
            expect(createdPanel.reveal).toHaveBeenCalledTimes(1);
            expect(warningSpy).toHaveBeenCalledWith(RECIPE_COCKPIT_CONFIRM_HIDDEN_REFUSAL);

        });

        it('is Cancel the moment the cockpit is hidden with a confirmation open, not on the next reveal', async () => {

            await openAndDraw();
            const answer = RecipeCockpitService.confirmInPanel('Open?', { detail: 'x' }, 'Go');
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
            const answer = RecipeCockpitService.confirmInPanel('Open?', { detail: 'x' }, 'Go');
            const confirmationId = lastPosted('confirmRequest').confirmationId;

            ( RecipeCockpitService as any ).settlePendingConfirmation('0'.repeat(32), 0);
            expect(RecipeCockpitService.routePanelMessage({ command: 'confirmResponse', confirmationId: confirmationId, choice: 0 }, panelState())).toBeDefined();

            ( RecipeCockpitService as any ).settlePendingConfirmation(confirmationId, 0);
            await expect(answer).resolves.toBe('Go');

        });

        it('is Cancel at once, posting nothing, when no model is drawn or no panel is open', async () => {

            await expect(RecipeCockpitService.confirmInPanel('Nothing open?', { detail: '' }, 'Go')).resolves.toBeUndefined();

            await RecipeCockpitService.openRecipeCockpitPanel(HISTORY_WORKSPACE_ROOT, buildWorkspaceState());
            await receivedMessageHandler({ command: 'ready' });

            await expect(RecipeCockpitService.confirmInPanel('Not drawn yet?', { detail: '' }, 'Go')).resolves.toBeUndefined();
            expect(postedOf('confirmRequest')).toEqual([]);

        });

    });

    describe('the source', () => {

        it('asks no cockpit confirmation in VS Code\'s modal', () => {

            const serviceSource = fs.readFileSync(SERVICE_SOURCE_PATH, 'utf8');

            expect(serviceSource).not.toMatch(/modal:\s*true/);
            expect(serviceSource.match(/this\.confirmInPanel\(/g) ?? []).toHaveLength(14);

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
            lines: ['Org: qa · qa@example.com', '', 'Records, inserted parents first:', '  Account: 300', '  Contact: 1500', ...Array.from({ length: 60 }, (_unused, lineIndex) => `- line ${lineIndex}`)],
            buttons: ['Generate and insert', 'Generate only'],
            isDestructive: true,
            ...overrides
        });

        const dialogOf = (panel: ReturnType<typeof runPanelScript>) => panel.findAll(panel.cockpitDialogHostElement, 'confirmDialog')[0];
        const responses = (panel: ReturnType<typeof runPanelScript>) => panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'confirmResponse');

        it('draws a modal dialog over the cockpit: title, a scrolling body of lines, the host\'s buttons then Cancel, the rest inert', () => {

            const panel = drawnPanel();
            panel.postToPanel(confirmRequest());

            const dialogElement = dialogOf(panel);
            const bodyElement = panel.findAll(dialogElement, 'confirmBody')[0];
            expect(dialogElement.attributes).toMatchObject({ 'role': 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'confirmTitle', 'aria-describedby': 'confirmBody' });
            expect(panel.findAll(dialogElement, 'confirmTitle')[0]).toMatchObject({ tagName: 'h2', textContent: 'Generate <b>Tree</b> and insert it?' });
            expect(bodyElement.attributes).toMatchObject({ id: 'confirmBody', tabindex: '0' });
            expect(panel.findAll(bodyElement, 'confirmLine').map((lineElement: any) => lineElement.textContent)).toEqual(confirmRequest().lines.filter(line => line !== ''));
            expect(panel.findAll(bodyElement, 'confirmGap')).toHaveLength(1);
            expect(panel.findAll(bodyElement, 'confirmListItem').map((lineElement: any) => lineElement.textContent)).toContain('- line 0');
            expect(panel.findAll(dialogElement, 'sdtButton').map((buttonElement: any) => buttonElement.textContent)).toEqual(['Generate and insert', 'Generate only', 'Cancel']);
            panel.findAll(dialogElement, 'sdtButton').forEach((buttonElement: any) => {
                expect(RECIPE_COCKPIT_BUTTON_KINDS.filter(buttonKind => buttonElement.classList.contains(`sdtButton-${buttonKind}`))).toHaveLength(1);
            });
            expect(panel.findAll(dialogElement, 'confirmChoice')[0].classList.contains('sdtButton-primary')).toBeTrue();
            [panel.cockpitBodyElement, panel.cockpitMetaElement, panel.loadStatusElement].forEach(backgroundElement => expect(backgroundElement.attributes.inert).toBe(''));

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

        it('answers Cancel without drawing a request for a model that is not the one on screen, or one it cannot read', () => {

            const panel = drawnPanel();

            panel.postToPanel(confirmRequest({ renderSequence: 3 }));
            panel.postToPanel(confirmRequest({ confirmationId: 'd'.repeat(32), buttons: [] }));
            panel.postToPanel(confirmRequest({ confirmationId: 'e'.repeat(32), lines: 'not a list' }));

            expect(dialogOf(panel)).toBeUndefined();
            expect(responses(panel).map(response => [response.confirmationId, response.choice])).toEqual([['c'.repeat(32), null], ['d'.repeat(32), null], ['e'.repeat(32), null]]);

        });

        it('closes an open dialog without answering when a new model is drawn, since the host answered it Cancel', () => {

            const panel = drawnPanel();
            panel.postToPanel(confirmRequest());

            panel.postToPanel({ command: 'recipeData', recipe: { runs: [], selectedRunFolderName: '', objects: [], trees: [], notices: [], emptyStateMessage: 'No run.' }, renderSequence: 5 });

            expect(dialogOf(panel)).toBeUndefined();
            expect(responses(panel)).toEqual([]);
            expect(panel.cockpitBodyElement.attributes).not.toHaveProperty('inert');

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

        it('draws the dialog host outside the body every render replaces', () => {

            expect(shellHtml()).toContain('<div id="cockpitBody"></div>\n<div id="cockpitDialogHost"></div>');

        });

    });

});
