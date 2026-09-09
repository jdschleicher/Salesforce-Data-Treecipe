import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as vscode from 'vscode';

jest.mock('vscode', () => ({
    window: { createWebviewPanel: jest.fn() },
    ViewColumn: { One: 1 }
}), { virtual: true });

import {
    RecipeCockpitService,
    RECIPE_COCKPIT_VIEW_TYPE,
    RECIPE_COCKPIT_PANEL_TITLE,
    RECIPE_COCKPIT_READY_ACKNOWLEDGEMENT,
    RECIPE_COCKPIT_PENDING_ACKNOWLEDGEMENT
} from '../RecipeCockpitService';

describe('RecipeCockpitService', () => {

    describe('buildContentSecurityPolicy', () => {

        it('allows only the nonced inline style and script and no remote content at all', () => {

            const actualContentSecurityPolicy = RecipeCockpitService.buildContentSecurityPolicy('testNonce');

            expect(actualContentSecurityPolicy).toContain(`default-src 'none'`);
            expect(actualContentSecurityPolicy).toContain(`style-src 'nonce-testNonce'`);
            expect(actualContentSecurityPolicy).toContain(`script-src 'nonce-testNonce'`);
            // NEITHER FALLS BACK TO default-src, SO BOTH ARE NAMED EXPLICITLY
            expect(actualContentSecurityPolicy).toContain(`form-action 'none'`);
            expect(actualContentSecurityPolicy).toContain(`base-uri 'none'`);
            expect(actualContentSecurityPolicy).not.toContain('http');

        });

    });

    describe('buildNonce', () => {

        it('builds a distinct alphanumeric nonce on each call', () => {

            const firstNonce = RecipeCockpitService.buildNonce();
            const secondNonce = RecipeCockpitService.buildNonce();

            expect(firstNonce).toMatch(/^[A-Za-z0-9]{32}$/);
            expect(firstNonce).not.toBe(secondNonce);

        });

    });

    describe('buildWebviewShellHtml', () => {

        it('carries the content security policy meta and nonces every inline block it emits', () => {

            const actualShellHtml = RecipeCockpitService.buildWebviewShellHtml('testNonce');

            expect(actualShellHtml).toContain(
                `<meta http-equiv="Content-Security-Policy" content="${RecipeCockpitService.buildContentSecurityPolicy('testNonce')}">`
            );
            expect(actualShellHtml).toContain('<style nonce="testNonce">');
            expect(actualShellHtml).toContain('<script nonce="testNonce">');

        });

        /*
            An un-nonced inline block is exactly what the CSP denies, so one emitted by this builder
            would be a silently dead style or script rather than a loud failure. Counted rather than
            spot checked so a block added later cannot be the one that is missed.
        */
        it('emits no inline style or script block without a nonce', () => {

            const actualShellHtml = RecipeCockpitService.buildWebviewShellHtml('testNonce');

            const inlineBlockOpenings = actualShellHtml.match(/<(style|script)\b[^>]*>/g) ?? [];

            expect(inlineBlockOpenings).not.toBeEmpty();
            inlineBlockOpenings.forEach(inlineBlockOpening => {
                expect(inlineBlockOpening).toContain('nonce="testNonce"');
            });

        });

        // default-src 'none' DENIES EVERY FETCH, SO A REFERENCED ASSET WOULD BE A BLOCKED REQUEST RATHER THAN A SLOW ONE
        it('references no external asset of any kind', () => {

            const actualShellHtml = RecipeCockpitService.buildWebviewShellHtml('testNonce');

            expect(actualShellHtml).not.toMatch(/\ssrc="/);
            expect(actualShellHtml).not.toMatch(/<link\b/);
            // THE ONE "http" THE DOCUMENT MAY CARRY IS THE CSP'S OWN http-equiv ATTRIBUTE
            expect(actualShellHtml).not.toMatch(/https?:\/\//);

        });

        it('renders the placeholder content and the pending handshake line the panel opens with', () => {

            const actualShellHtml = RecipeCockpitService.buildWebviewShellHtml('testNonce');

            expect(actualShellHtml).toContain(`<title>${RECIPE_COCKPIT_PANEL_TITLE}</title>`);
            expect(actualShellHtml).toContain(`<h1>${RECIPE_COCKPIT_PANEL_TITLE}</h1>`);
            expect(actualShellHtml).toContain(RECIPE_COCKPIT_PENDING_ACKNOWLEDGEMENT);

        });

        /*
            Pins the markup the fake DOM in runPanelScript below stands in for.

            That harness hard codes the id it answers getElementById with and the classes its
            element starts out carrying. Without this, renaming the id here leaves every test in
            this file green while the real panel throws on the ack and never updates its status
            line -- and dropping "pending" leaves a panel that opens looking connected before any
            handshake, with the test that asserts the class is removed still passing.
        */
        it('declares the handshake element the panel script addresses, with the classes it opens carrying', () => {

            const actualShellHtml = RecipeCockpitService.buildWebviewShellHtml('testNonce');

            expect(actualShellHtml).toContain('<div id="handshakeStatus" class="handshakeStatus pending">');

        });

    });

    describe('routePanelMessage', () => {

        it('given the panel announcing itself ready, answers with the acknowledgement', () => {

            const actualHostMessage = RecipeCockpitService.routePanelMessage({ command: 'ready' });

            expect(actualHostMessage).toEqual({ command: 'ack', message: RECIPE_COCKPIT_READY_ACKNOWLEDGEMENT });

        });

        /*
            The panel and the host ship in one .vsix, so an unrecognized command did not come from
            the panel. Answering nothing is what keeps that true of the reply as well.
        */
        it.each([
            ['an unrecognized command', { command: 'traverseRecipe' }],
            ['a message with no command at all', {}],
            ['nothing at all', undefined]
        ])('given %s, answers with nothing', (unusedDescription, panelMessage) => {

            expect(RecipeCockpitService.routePanelMessage(panelMessage)).toBeUndefined();

        });

    });

    /*
        Runs the panel's ACTUAL script against a fake DOM.

        Asserting on the shell as a string says a listener is present; it says nothing about what it
        does with what it receives. The script uses four DOM globals, so standing one up costs less
        than a jsdom dependency this project does not otherwise have.
    */
    function runPanelScript() {

        const postedHostMessages: any[] = [];
        const windowListenersByType: Record<string, Function> = {};

        /*
            The element starts with the classes the SHELL MARKUP declares for it rather than blank.
            "pending" is what the opening state is expressed as, so a fake that started classless
            would report an un-acknowledged panel as connected -- and the test asserting the class
            is removed would pass against a script that never set it.

            The id and the classes below are the shell's, and the test above pins them: a fake
            mirroring markup nothing asserts is a fake that keeps passing after the markup moves.
        */
        const carriedClassNames = new Set<string>(['handshakeStatus', 'pending']);

        const handshakeStatusElement = {
            textContent: RECIPE_COCKPIT_PENDING_ACKNOWLEDGEMENT,
            classList: {
                add(className: string) { carriedClassNames.add(className); },
                remove(className: string) { carriedClassNames.delete(className); },
                contains(className: string) { return carriedClassNames.has(className); }
            }
        };

        const fakeDocument = { getElementById: (elementId: string) => (elementId === 'handshakeStatus' ? handshakeStatusElement : undefined) };

        const fakeWindow = {
            addEventListener: (eventType: string, listener: Function) => { windowListenersByType[eventType] = listener; }
        };

        const acquireVsCodeApi = () => ({ postMessage: (hostMessage: any) => { postedHostMessages.push(hostMessage); } });

        const shellHtml = RecipeCockpitService.buildWebviewShellHtml('testNonce');
        const panelScript = shellHtml.substring(
            shellHtml.indexOf('<script nonce="testNonce">') + '<script nonce="testNonce">'.length,
            shellHtml.lastIndexOf('</script>')
        );

        // RUNNING THE REAL PANEL SCRIPT IS THE POINT OF THIS HARNESS
        new Function('document', 'window', 'acquireVsCodeApi', panelScript)(fakeDocument, fakeWindow, acquireVsCodeApi);

        return {
            postedHostMessages,
            handshakeStatusElement,
            postToPanel: (hostMessage: any) => windowListenersByType['message']({ data: hostMessage })
        };

    }

    describe('the panel script, executed', () => {

        it('announces itself ready on load', () => {

            const panel = runPanelScript();

            expect(panel.postedHostMessages).toEqual([{ command: 'ready' }]);

        });

        it('given the acknowledgement the router answers with, reports the round trip completed', () => {

            const panel = runPanelScript();

            panel.postToPanel(RecipeCockpitService.routePanelMessage({ command: 'ready' }));

            expect(panel.handshakeStatusElement.textContent).toBe(RECIPE_COCKPIT_READY_ACKNOWLEDGEMENT);
            expect(panel.handshakeStatusElement.classList.contains('pending')).toBe(false);

        });

        it.each([
            ['an unrecognized command', { command: 'renderRecipe' }],
            ['nothing at all', undefined]
        ])('given %s, leaves the handshake line reporting what it last knew', (unusedDescription, hostMessage) => {

            const panel = runPanelScript();

            panel.postToPanel(hostMessage);

            expect(panel.handshakeStatusElement.textContent).toBe(RECIPE_COCKPIT_PENDING_ACKNOWLEDGEMENT);
            expect(panel.handshakeStatusElement.classList.contains('pending')).toBe(true);

        });

    });

    describe('openRecipeCockpitPanel', () => {

        let createdWebviewPanel: any;
        let registeredDisposeHandler: () => void;
        let receivedMessageHandler: (panelMessage: any) => void;
        const registeredMessageSubscriptions: { dispose: jest.Mock }[] = [];
        const postedPanelMessages: any[] = [];

        function buildFakeWebviewPanel() {

            return {
                reveal: jest.fn(),
                dispose: jest.fn(),
                onDidDispose: jest.fn().mockImplementation((disposeHandler: () => void) => {
                    registeredDisposeHandler = disposeHandler;
                    return { dispose: jest.fn() };
                }),
                webview: {
                    html: '',
                    postMessage: jest.fn().mockImplementation((hostMessage: any) => {
                        postedPanelMessages.push(hostMessage);
                        return Promise.resolve(true);
                    }),
                    onDidReceiveMessage: jest.fn().mockImplementation((messageHandler: (panelMessage: any) => void) => {
                        receivedMessageHandler = messageHandler;
                        const messageSubscription = { dispose: jest.fn() };
                        registeredMessageSubscriptions.push(messageSubscription);
                        return messageSubscription;
                    })
                }
            };

        }

        beforeEach(() => {

            postedPanelMessages.length = 0;
            registeredMessageSubscriptions.length = 0;

            createdWebviewPanel = buildFakeWebviewPanel();

            /*
                These live on the module factory rather than on a spy, so restoreMocks does not
                reach them and their call history would otherwise carry between tests.
            */
            (vscode.window.createWebviewPanel as jest.Mock).mockClear();
            (vscode.window.createWebviewPanel as jest.Mock).mockImplementation(() => createdWebviewPanel);

            /*
                The panel is held on the class so it can be reused across invocations, which means
                it also survives between tests unless it is cleared.
            */
            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;

        });

        it('opens a scripted panel that is granted no local resource root at all', () => {

            RecipeCockpitService.openRecipeCockpitPanel();

            expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);

            const [actualViewType, actualPanelTitle, actualViewColumn, actualPanelOptions] =
                (vscode.window.createWebviewPanel as jest.Mock).mock.calls[0];

            expect(actualViewType).toBe(RECIPE_COCKPIT_VIEW_TYPE);
            expect(actualPanelTitle).toBe(RECIPE_COCKPIT_PANEL_TITLE);
            expect(actualViewColumn).toBe(vscode.ViewColumn.One);
            expect(actualPanelOptions).toEqual({ enableScripts: true, localResourceRoots: [] });

            expect(createdWebviewPanel.reveal).toHaveBeenCalled();
            expect(createdWebviewPanel.webview.html).toContain(`<h1>${RECIPE_COCKPIT_PANEL_TITLE}</h1>`);

        });

        it('given the command is run again, reveals the panel the window already has rather than opening a duplicate', () => {

            const firstCockpitPanel = RecipeCockpitService.openRecipeCockpitPanel();
            const secondCockpitPanel = RecipeCockpitService.openRecipeCockpitPanel();

            expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
            expect(secondCockpitPanel).toBe(firstCockpitPanel);
            expect(createdWebviewPanel.reveal).toHaveBeenCalledTimes(2);

        });

        /*
            The reveal reassigns the document, so the second load must be authorized by its own
            nonce -- one held over would outlive the single document it was minted for.
        */
        it('given the command is run again, builds the reused panel a document with a fresh nonce', () => {

            RecipeCockpitService.openRecipeCockpitPanel();
            const firstShellHtml = createdWebviewPanel.webview.html;

            RecipeCockpitService.openRecipeCockpitPanel();
            const secondShellHtml = createdWebviewPanel.webview.html;

            const readNonce = (shellHtml: string) => shellHtml.match(/<script nonce="([A-Za-z0-9]{32})">/)?.[1];

            expect(readNonce(firstShellHtml)).toMatch(/^[A-Za-z0-9]{32}$/);
            expect(readNonce(secondShellHtml)).not.toBe(readNonce(firstShellHtml));

        });

        /*
            One listener per panel. A reveal that left the previous subscription in place would have
            two handlers answering one "ready", which is one acknowledgement the panel never asked
            for -- and the shape that grows into duplicated work as commands are added.
        */
        it('given the command is run again, disposes the subscription it is replacing', () => {

            RecipeCockpitService.openRecipeCockpitPanel();
            RecipeCockpitService.openRecipeCockpitPanel();

            expect(registeredMessageSubscriptions).toHaveLength(2);
            expect(registeredMessageSubscriptions[0].dispose).toHaveBeenCalled();
            expect(registeredMessageSubscriptions[1].dispose).not.toHaveBeenCalled();

        });

        it('given the panel announces itself ready, answers it with the acknowledgement', () => {

            RecipeCockpitService.openRecipeCockpitPanel();

            receivedMessageHandler({ command: 'ready' });

            expect(postedPanelMessages).toEqual([{ command: 'ack', message: RECIPE_COCKPIT_READY_ACKNOWLEDGEMENT }]);

        });

        it('given an unrecognized command, posts nothing back', () => {

            RecipeCockpitService.openRecipeCockpitPanel();

            receivedMessageHandler({ command: 'traverseRecipe' });

            expect(postedPanelMessages).toBeEmpty();

        });

        /*
            Posting to a disposed webview throws, and that throw would reach the user as an
            extension error for the ordinary act of closing a tab.
        */
        it('given the panel was closed before its message was handled, posts nothing back', () => {

            RecipeCockpitService.openRecipeCockpitPanel();

            registeredDisposeHandler();
            receivedMessageHandler({ command: 'ready' });

            expect(postedPanelMessages).toBeEmpty();

        });

        it('given the panel was closed, opens a new one the next time the command is run', () => {

            RecipeCockpitService.openRecipeCockpitPanel();
            registeredDisposeHandler();

            expect(registeredMessageSubscriptions[0].dispose).toHaveBeenCalled();

            createdWebviewPanel = buildFakeWebviewPanel();
            RecipeCockpitService.openRecipeCockpitPanel();

            expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(2);

        });

    });

});
