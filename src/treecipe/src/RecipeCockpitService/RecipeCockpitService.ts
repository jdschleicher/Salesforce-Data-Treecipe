import * as crypto from 'crypto';
import * as vscode from 'vscode';

// SHARED WITH THE TESTS SO THE PANEL'S VIEW TYPE CANNOT DRIFT FROM WHAT IS ASSERTED
export const RECIPE_COCKPIT_VIEW_TYPE = 'treecipe.recipeCockpit';

export const RECIPE_COCKPIT_PANEL_TITLE = 'Recipe Cockpit';

/*
    What the host answers "ready" with.

    It is worded as a statement about the CONNECTION rather than about the cockpit's contents,
    because that is all this slice establishes: the panel's document loaded, its script ran, and a
    message it sent reached the extension host and came back. A later slice replaces the line with
    the recipe it traversed; until then the reader is told exactly what was proven and no more.
*/
export const RECIPE_COCKPIT_READY_ACKNOWLEDGEMENT = 'Connected to the Treecipe extension host.';

// WHAT THE PANEL SHOWS BEFORE THE HANDSHAKE COMPLETES, SO A FAILED ONE IS VISIBLE RATHER THAN BLANK
export const RECIPE_COCKPIT_PENDING_ACKNOWLEDGEMENT = 'Connecting to the Treecipe extension host…';

/*
    Everything the cockpit webview can post back.

    One shape with every field optional, matching the explorer: a handler states which fields its
    command needs and the compiler holds it to them. Nothing arriving here is trusted -- this slice
    routes on the command name alone and carries no path, no identifier and no user data, which is
    what makes the router safe to be a stub.

    The first command that carries a payload ends that. A posted value is then MATCHED against an
    allow-list built from the model the host itself rendered -- never validated as a path, and never
    resolved by the host on the panel's say-so. All-optional is why the compiler cannot enforce that
    on its own: a later handler writing panelMessage.recipeFilePath! type checks against a value
    that may be absent or chosen by whatever sent the message.
*/
export interface IRecipeCockpitPanelMessage {
    command?: string;
}

export interface IRecipeCockpitAcknowledgementMessage {
    command: 'ack';
    message: string;
}

export type RecipeCockpitHostMessage = IRecipeCockpitAcknowledgementMessage;

export class RecipeCockpitService {

    /*
        One cockpit for the whole window, reused across invocations.

        Creating a panel per run stacks a duplicate tab each time, and every one of them holds its
        own document alive. The reference is cleared in onDidDispose so a closed panel is not
        revealed after the fact.
    */
    private static recipeCockpitPanel: vscode.WebviewPanel | undefined;

    /*
        The message listener registered for the panel. One per panel rather than one per load: the
        router it delegates to is stateless, so there is nothing about a reload for the subscription
        to be rebuilt to reflect. Disposed before it is replaced, and again when the panel closes,
        so a reopened cockpit never has two listeners answering the same handshake.
    */
    private static recipeCockpitMessageSubscription: vscode.Disposable | undefined;

    /*
        Opens the cockpit, or reveals the one this window already has.

        The shell is static and carries no data of any kind, so it is assigned on every invocation
        rather than only on creation: re-running the command puts the panel back in its opening
        state, which is the whole of its state in this slice.
    */
    static openRecipeCockpitPanel(): vscode.WebviewPanel {

        const existingCockpitPanel = this.recipeCockpitPanel;

        const cockpitPanel = existingCockpitPanel
            ?? vscode.window.createWebviewPanel(
                RECIPE_COCKPIT_VIEW_TYPE,
                RECIPE_COCKPIT_PANEL_TITLE,
                vscode.ViewColumn.One,
                /*
                    localResourceRoots is set EMPTY rather than omitted. Omitting it does not deny
                    the grant -- VS Code then defaults to the extension directory plus every open
                    workspace folder. The cockpit loads no file of any kind: its shell is inline and
                    everything it will ever render arrives over postMessage, so enableScripts is
                    what the nonced inline script needs rather than a resource grant.
                */
                { enableScripts: true, localResourceRoots: [] }
            );

        this.recipeCockpitPanel = cockpitPanel;

        if ( !existingCockpitPanel ) {

            cockpitPanel.onDidDispose(() => {
                this.recipeCockpitMessageSubscription?.dispose();
                this.recipeCockpitMessageSubscription = undefined;
                this.recipeCockpitPanel = undefined;
            });

        }

        /*
            A fresh nonce per load. The document is rebuilt whenever this runs, so a nonce reused
            across loads would outlive the one document it authorizes for no benefit.
        */
        cockpitPanel.webview.html = this.buildWebviewShellHtml(this.buildNonce());

        this.registerPanelMessageSubscription(cockpitPanel);

        cockpitPanel.reveal(vscode.ViewColumn.One);

        return cockpitPanel;

    }

    private static registerPanelMessageSubscription(cockpitPanel: vscode.WebviewPanel) {

        this.recipeCockpitMessageSubscription?.dispose();

        this.recipeCockpitMessageSubscription = cockpitPanel.webview.onDidReceiveMessage((panelMessage: IRecipeCockpitPanelMessage) => {

            const hostMessage = this.routePanelMessage(panelMessage);

            if ( !hostMessage ) {
                return;
            }

            /*
                Whether the panel this message came from is still the panel the window has.

                onDidDispose clears the reference, so a tab closed between the post and this line
                stops matching. Posting to a disposed webview throws, and that throw would surface
                to the user as an extension error for the ordinary act of closing a tab.
            */
            if ( this.recipeCockpitPanel !== cockpitPanel ) {
                return;
            }

            cockpitPanel.webview.postMessage(hostMessage);

        });

    }

    /*
        The whole host side of the protocol, as a pure function.

        It is separated from the subscription above so the routing can be asserted without a live
        webview -- and so the later slices that add commands add them to something already under
        test rather than to a closure inside an event handler.

        An unrecognized command is answered with nothing rather than with an error: the panel and
        the host are versioned together in one .vsix, so the only way one arrives is a message from
        somewhere else, and replying to it would tell it something.
    */
    static routePanelMessage(panelMessage: IRecipeCockpitPanelMessage | undefined): RecipeCockpitHostMessage | undefined {

        if ( panelMessage?.command === 'ready' ) {
            return this.buildAcknowledgementMessage();
        }

        return undefined;

    }

    static buildAcknowledgementMessage(): IRecipeCockpitAcknowledgementMessage {

        return { command: 'ack', message: RECIPE_COCKPIT_READY_ACKNOWLEDGEMENT };

    }

    static buildContentSecurityPolicy(nonce: string): string {

        return `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; form-action 'none'; base-uri 'none';`;

    }

    /*
        From the crypto RNG rather than Math.random. The nonce is what lets the CSP deny every
        script but this extension's own, so it should not depend on there being no injection
        primitive to spend a predicted value on -- that is the property the CSP exists to provide
        independently.
    */
    static buildNonce(): string {

        /*
            48 bytes rather than 24: base64 yields "+", "/" and "=" which are stripped so the value
            is safe unquoted in the CSP header, and 24 bytes can fall short of 32 characters once
            they are removed.
        */
        return crypto.randomBytes(48).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 32);

    }

    /*
        The cockpit's document, as a string carrying NO value this extension does not author.

        That is the invariant rather than "only the nonce": the template does interpolate the panel
        title and the pending line, which are compile-time constants in this file. What none of the
        three is, is metadata -- recipes and org describes come from a source this extension does
        not control, so none of it is interpolated into html. It arrives over postMessage and is
        written through textContent, which is why this builder needs no escaping rather than having
        escaping that could be forgotten.

        Keeping the SIGNATURE to the nonce is what holds that line in place, because a value from
        outside this file can only reach the template through a parameter. Widening it to take a
        model would quietly re-open the markup context the guarantee rests on.
    */
    static buildWebviewShellHtml(nonce: string): string {

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${this.buildContentSecurityPolicy(nonce)}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${RECIPE_COCKPIT_PANEL_TITLE}</title>
<style nonce="${nonce}">
    body {
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--vscode-foreground);
        background-color: var(--vscode-editor-background);
        padding: 0 1rem 2rem 1rem;
    }
    h1 { font-size: 1.3rem; margin-bottom: 0.25rem; }
    .muted { color: var(--vscode-descriptionForeground); }
    .handshakeStatus {
        border-left: 3px solid var(--vscode-panel-border);
        padding: 0.4rem 0.6rem;
        margin: 0.75rem 0;
    }
    .handshakeStatus.pending { color: var(--vscode-descriptionForeground); }
    .placeholder {
        border: 1px dashed var(--vscode-panel-border);
        padding: 0.6rem 0.8rem;
    }
    .placeholder ul { margin: 0.4rem 0 0 1rem; padding: 0; }
</style>
</head>
<body>
<h1>${RECIPE_COCKPIT_PANEL_TITLE}</h1>
<div class="muted">A view over your local recipes and the org metadata behind them.</div>
<div id="handshakeStatus" class="handshakeStatus pending">${RECIPE_COCKPIT_PENDING_ACKNOWLEDGEMENT}</div>
<div class="placeholder">
    <div>Nothing is loaded yet. This panel is the surface the following will render into:</div>
    <ul>
        <li>Traverse a generated recipe -- objects, fields and the faker expression behind each one.</li>
        <li>Diff that recipe against a live org describe.</li>
    </ul>
</div>
<script nonce="${nonce}">
(function () {

    const vscodeApi = acquireVsCodeApi();
    const handshakeStatusElement = document.getElementById('handshakeStatus');

    window.addEventListener('message', function (hostMessageEvent) {

        const hostMessage = hostMessageEvent && hostMessageEvent.data;

        if (!hostMessage || hostMessage.command !== 'ack') { return; }

        /*
            textContent rather than innerHTML, on a value that reaches this panel from the host.
            Nothing in this slice's message carries metadata, but the rule is what the later
            slices' rows are written under, and a panel with one innerHTML in it is a panel where
            the next value written the same way is the one that carries a picklist label.
        */
        handshakeStatusElement.textContent = hostMessage.message;
        handshakeStatusElement.classList.remove('pending');

    });

    /*
        Posted on every load of this document, not only the first. A reveal after the panel was
        hidden reloads it from scratch, so the handshake is what re-establishes the panel's state
        rather than something that happened once when the tab was created.
    */
    vscodeApi.postMessage({ command: 'ready' });

}());
</script>
</body>
</html>
`;

    }

}
