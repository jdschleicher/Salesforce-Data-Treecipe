import * as fs from 'fs';
import * as path from 'path';
import { CONNECTED_ORG_USERNAMES, FAILED_PING_MESSAGES_BY_USERNAME } from '../../../SalesforceOrgService/tests/OrgConnectionPings';

/*
    The two modules a journey fakes (#577): vscode, and @salesforce/core. Every function here is a plain
    function rather than a jest.fn, because restoreMocks wipes a jest.fn's implementation before each test
    and a journey is opened once for every test of its suite. Each one hands its call to the journey that
    is open, so the journey can record it and, for a prompt, wait for the reader's answer.

    A journey file wires them with:
        jest.mock('vscode', () => require('./RecipeCockpitJourneyFakes').journeyVscodeModule, { virtual: true });
        jest.mock('@salesforce/core', () => require('./RecipeCockpitJourneyFakes').journeySalesforceCoreModule);
*/

export type NotificationKind = 'information' | 'warning' | 'error';

export interface IRecordedNotification {
    kind: NotificationKind;
    text: string;
    detail?: string;
    isModal: boolean;
    buttons: string[];
    // A NOTIFICATION WITH BUTTONS WAITS FOR clickNotificationButton; ONE WITHOUT IS ANSWERED AT ONCE
    isWaiting: boolean;
}

export type PromptKind = 'quickPick' | 'inputBox';

export interface IRecordedPrompt {
    kind: PromptKind;
    title?: string;
    placeholder?: string;
    prompt?: string;
    value?: string;
    offeredLabels: string[];
    isWaiting: boolean;
}

export interface IRecordedOrgCall {
    username: string;
    call: string;
    args: unknown[];
}

export interface IFakeWebviewPanel {
    webview: { html: string; postMessage(hostMessage: unknown): Promise<boolean>; onDidReceiveMessage(handler: (panelMessage: unknown) => unknown): { dispose(): void } };
    visible: boolean;
    reveal(): void;
    dispose(): void;
    onDidDispose(handler: () => void): { dispose(): void };
    onDidChangeViewState(handler: (viewStateEvent: unknown) => void): { dispose(): void };
}

// WHAT THE OPEN JOURNEY ANSWERS FOR; ONLY ONE JOURNEY IS OPEN AT A TIME, SINCE THE COCKPIT IS ONE PANEL PER WINDOW
export interface IJourneyHost {
    workspaceRoot: string;
    createWebviewPanel(): IFakeWebviewPanel;
    showNotification(kind: NotificationKind, text: string, options: { modal?: boolean; detail?: string } | undefined, buttons: string[]): Promise<string | undefined>;
    showPrompt(prompt: IRecordedPrompt): Promise<string | undefined>;
    showQuickPickControl(quickPick: FakeQuickPick): void;
    recordCall(call: string, args: unknown[]): void;
    settings: Map<string, unknown>;
}

let openJourneyHost: IJourneyHost | undefined;

export function setOpenJourneyHost(journeyHost: IJourneyHost | undefined) {
    openJourneyHost = journeyHost;
}

function journeyHost(): IJourneyHost {
    if ( !openJourneyHost ) {
        throw new Error('A vscode or @salesforce/core call was made with no journey open: call journey.open(fixture) first.');
    }
    return openJourneyHost;
}

const disposable = () => ({ dispose: () => undefined });

// A QUICK PICK ITEM HAS A label, A NOTIFICATION'S MessageItem A title, AND EITHER MAY BE A PLAIN STRING
const labelOf = (item: string | { label?: string; title?: string }): string => typeof item === 'string' ? item : String(item.label ?? item.title);

// showInformationMessage(message, [options], ...buttons): A BUTTON IS A STRING OR A MessageItem
function splitNotificationArguments(notificationArguments: unknown[]) {
    const [firstArgument, ...restArguments] = notificationArguments;
    const hasOptions = firstArgument !== undefined && typeof firstArgument === 'object' && firstArgument !== null && !('title' in firstArgument);
    const options = hasOptions ? firstArgument as { modal?: boolean; detail?: string } : undefined;
    const buttonItems = hasOptions ? restArguments : notificationArguments;
    return { options, buttonItems };
}

function showNotification(kind: NotificationKind) {
    return async (text: string, ...notificationArguments: unknown[]) => {
        const { options, buttonItems } = splitNotificationArguments(notificationArguments);
        const chosenLabel = await journeyHost().showNotification(kind, String(text), options, buttonItems.map(labelOf));
        return buttonItems.find(buttonItem => labelOf(buttonItem) === chosenLabel);
    };
}

/*
    window.createQuickPick: the org picker shows one, fills it once the listing answers, and resolves on
    accept or hide. The journey records it when shown and answers it with answerQuickPick.
*/
export class FakeQuickPick {
    title?: string;
    placeholder?: string;
    value = '';
    busy = false;
    enabled = true;
    ignoreFocusOut = false;
    canSelectMany = false;
    matchOnDescription = false;
    matchOnDetail = false;
    items: readonly unknown[] = [];
    selectedItems: readonly unknown[] = [];
    activeItems: readonly unknown[] = [];
    isShown = false;
    private readonly acceptListeners: Array<() => void> = [];
    private readonly hideListeners: Array<() => void> = [];
    private readonly valueListeners: Array<(value: string) => void> = [];

    onDidAccept(listener: () => void) { this.acceptListeners.push(listener); return disposable(); }
    onDidHide(listener: () => void) { this.hideListeners.push(listener); return disposable(); }
    onDidChangeValue(listener: (value: string) => void) { this.valueListeners.push(listener); return disposable(); }
    onDidChangeSelection() { return disposable(); }
    onDidChangeActive() { return disposable(); }
    onDidTriggerButton() { return disposable(); }
    onDidTriggerItemButton() { return disposable(); }

    show() {
        this.isShown = true;
        journeyHost().showQuickPickControl(this);
    }

    hide() {
        if ( !this.isShown ) { return; }
        this.isShown = false;
        this.hideListeners.forEach(listener => listener());
    }

    dispose() { this.hide(); }

    offeredLabels(): string[] {
        return this.items.map(labelOf);
    }

    accept(label: string) {
        const chosenItem = this.items.find(item => labelOf(item) === label);
        if ( !chosenItem ) {
            throw new Error(`The quick pick "${this.title ?? this.placeholder}" offers no "${label}". It offers: ${this.offeredLabels().map(offered => `"${offered}"`).join(', ') || 'nothing'}.`);
        }
        this.selectedItems = [chosenItem];
        this.acceptListeners.forEach(listener => listener());
    }

    typeValue(value: string) {
        this.value = value;
        this.valueListeners.forEach(listener => listener(value));
    }
}

class FakeThemeIcon { constructor(readonly id: string) {} }
class FakePosition { constructor(readonly line: number, readonly character: number) {} }
class FakeRange { constructor(readonly start: FakePosition, readonly end: FakePosition) {} }
class FakeSelection extends FakeRange { constructor(anchor: FakePosition, active: FakePosition) { super(anchor, active); } }
class FakeDisposable {
    static from(...disposables: Array<{ dispose(): unknown }>) { return new FakeDisposable(() => disposables.forEach(item => item.dispose())); }
    constructor(private readonly onDispose: () => unknown = () => undefined) {}
    dispose() { this.onDispose(); }
}

const fileUri = (filePath: string) => ({ scheme: 'file', fsPath: filePath, path: filePath, toString: () => 'file://' + filePath });

export const journeyVscodeModule = {
    window: {
        createWebviewPanel: () => journeyHost().createWebviewPanel(),
        showInformationMessage: showNotification('information'),
        showWarningMessage: showNotification('warning'),
        showErrorMessage: showNotification('error'),
        showQuickPick: async (items: unknown, options: { title?: string; placeHolder?: string } = {}) => {
            const offeredItems = await Promise.resolve(items) as unknown[];
            const chosenLabel = await journeyHost().showPrompt({ kind: 'quickPick', title: options.title, placeholder: options.placeHolder, offeredLabels: offeredItems.map(labelOf), isWaiting: true });
            return chosenLabel === undefined ? undefined : offeredItems.find(item => labelOf(item) === chosenLabel);
        },
        createQuickPick: () => new FakeQuickPick(),
        showInputBox: async (options: { title?: string; prompt?: string; placeHolder?: string; value?: string } = {}) =>
            journeyHost().showPrompt({ kind: 'inputBox', title: options.title, prompt: options.prompt, placeholder: options.placeHolder, value: options.value, offeredLabels: [], isWaiting: true }),
        withProgress: async (options: { title?: string }, progressTask: (progress: unknown, cancellationToken: unknown) => unknown) => {
            journeyHost().recordCall('window.withProgress', [options.title]);
            return progressTask({ report: () => undefined }, { isCancellationRequested: false, onCancellationRequested: () => disposable() });
        },
        createStatusBarItem: () => ({ text: '', tooltip: '', command: undefined, show: () => undefined, hide: () => undefined, dispose: () => undefined }),
        createOutputChannel: (channelName: string) => ({
            name: channelName,
            append: () => undefined,
            appendLine: () => undefined,
            clear: () => undefined,
            show: () => undefined,
            dispose: () => undefined
        }),
        showTextDocument: async (document: unknown) => { journeyHost().recordCall('window.showTextDocument', [document]); return { selection: undefined, revealRange: () => undefined }; },
        registerWebviewViewProvider: () => disposable(),
        registerTreeDataProvider: () => disposable()
    },
    workspace: {
        get workspaceFolders() { return openJourneyHost ? [{ uri: fileUri(openJourneyHost.workspaceRoot), name: path.basename(openJourneyHost.workspaceRoot), index: 0 }] : undefined; },
        getConfiguration: (section?: string) => {
            // A SETTING IS KEPT BY ITS FULL NAME, AS getConfiguration().get('salesforce-data-treecipe.x') READS IT
            const settingKeyOf = (key: string) => section ? `${section}.${key}` : key;
            return {
                get: (key: string, defaultValue?: unknown) => journeyHost().settings.has(settingKeyOf(key)) ? journeyHost().settings.get(settingKeyOf(key)) : defaultValue,
                update: async (key: string, value: unknown) => {
                    journeyHost().recordCall('workspace.getConfiguration().update', [settingKeyOf(key), value]);
                    journeyHost().settings.set(settingKeyOf(key), value);
                },
                inspect: (key: string) => ({ key: settingKeyOf(key), workspaceValue: journeyHost().settings.get(settingKeyOf(key)) }),
                has: (key: string) => journeyHost().settings.has(settingKeyOf(key))
            };
        },
        onDidChangeConfiguration: () => disposable(),
        openTextDocument: async (documentUri: { fsPath: string }) => { journeyHost().recordCall('workspace.openTextDocument', [documentUri.fsPath]); return { uri: documentUri, lineCount: 0 }; },
        fs: {
            readDirectory: async (directoryUri: { fsPath: string }) => (await fs.promises.readdir(directoryUri.fsPath, { withFileTypes: true }))
                .map(entry => [entry.name, entry.isDirectory() ? 2 : entry.isSymbolicLink() ? 64 : 1]),
            readFile: async (fileUriToRead: { fsPath: string }) => fs.promises.readFile(fileUriToRead.fsPath)
        }
    },
    commands: {
        executeCommand: async (commandId: string, ...commandArguments: unknown[]) => { journeyHost().recordCall('commands.executeCommand', [commandId, ...commandArguments]); return undefined; },
        registerCommand: () => disposable()
    },
    env: {
        openExternal: async (externalUri: unknown) => { journeyHost().recordCall('env.openExternal', [String(externalUri)]); return true; },
        clipboard: { writeText: async (clipboardText: string) => { journeyHost().recordCall('env.clipboard.writeText', [clipboardText]); } }
    },
    Uri: {
        file: fileUri,
        parse: (uriValue: string) => ({ scheme: uriValue.split(':')[0], toString: () => uriValue })
    },
    ViewColumn: { One: 1, Two: 2, Active: -1, Beside: -2 },
    ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
    QuickPickItemKind: { Separator: -1, Default: 0 },
    InputBoxValidationSeverity: { Info: 1, Warning: 2, Error: 3 },
    TextEditorRevealType: { Default: 0, InCenter: 1 },
    ThemeIcon: FakeThemeIcon,
    Position: FakePosition,
    Range: FakeRange,
    Selection: FakeSelection,
    Disposable: FakeDisposable
};

/*
    The fake org (#577), built on the SalesforceOrgService fixtures: the authorizations
    orgAuthorizations.json lists, answering pings as OrgConnectionPings.ts says. Every call on an org or
    its connection is recorded. A query is answered with no records unless the journey scripts it, and
    the Organization row says IsSandbox from the authorization; any other connection call throws, naming
    itself, so a journey that reaches one says which answer it is missing.
*/
const ORG_AUTHORIZATIONS: Array<Record<string, unknown>> = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'SalesforceOrgService', 'tests', 'mocks', 'orgAuthorizations.json'), 'utf-8'));

export type OrgQueryAnswer = (username: string, soql: string) => { totalSize: number; done: boolean; records: unknown[] } | undefined;

export class FakeOrgConnections {

    readonly calls: IRecordedOrgCall[] = [];
    queryAnswer: OrgQueryAnswer = () => undefined;

    readonly authorizations = ORG_AUTHORIZATIONS;

    private authorizationOf(username: string) {
        return this.authorizations.find(authorization => authorization.username === username
            || (Array.isArray(authorization.aliases) && authorization.aliases.includes(username)));
    }

    private record(username: string, call: string, args: unknown[]) {
        this.calls.push({ username, call, args });
    }

    private buildConnection(username: string): unknown {
        const authorization = this.authorizationOf(username);
        const answerQuery = (soql: string) => {
            this.record(username, 'connection.query', [soql]);
            const scripted = this.queryAnswer(username, soql);
            if ( scripted ) { return scripted; }
            if ( /\bFROM\s+Organization\b/i.test(soql) ) {
                return { totalSize: 1, done: true, records: [{ attributes: { type: 'Organization' }, Id: authorization?.orgId, IsSandbox: authorization?.isSandbox === true, OrganizationType: 'Developer Edition', TrialExpirationDate: authorization?.isScratchOrg ? '2026-12-31' : null }] };
            }
            return { totalSize: 0, done: true, records: [] };
        };
        const answerToolingQuery = (soql: string) => this.queryAnswer(username, soql) ?? { totalSize: 0, done: true, records: [] };
        const unanswered = (call: string) => (...args: unknown[]) => {
            this.record(username, call, args);
            throw new Error(`The journey's fake org has no answer for ${call} on ${username}: script it on journey.org.`);
        };
        const connection: Record<string, unknown> = {
            instanceUrl: authorization?.instanceUrl,
            version: '62.0',
            getUsername: () => username,
            getApiVersion: () => '62.0',
            query: async (soql: string) => answerQuery(soql),
            queryMore: unanswered('connection.queryMore'),
            describe: unanswered('connection.describe'),
            describeGlobal: unanswered('connection.describeGlobal'),
            request: unanswered('connection.request'),
            requestPost: unanswered('connection.requestPost'),
            sobject: (objectApiName: string) => ({
                create: unanswered(`connection.sobject(${objectApiName}).create`),
                update: unanswered(`connection.sobject(${objectApiName}).update`),
                describe: unanswered(`connection.sobject(${objectApiName}).describe`)
            }),
            tooling: { query: async (soql: string) => { this.record(username, 'connection.tooling.query', [soql]); return answerToolingQuery(soql); } },
            metadata: { retrieve: unanswered('connection.metadata.retrieve'), deploy: unanswered('connection.metadata.deploy'), list: unanswered('connection.metadata.list') }
        };
        return connection;
    }

    async listAllAuthorizations() {
        return this.authorizations.map(authorization => ({ ...authorization }));
    }

    async createAuthInfo(username: string) {
        const authorization = this.authorizationOf(username);
        if ( !authorization ) { throw new Error(`No authorization found for ${username}`); }
        return { getUsername: () => authorization.username, getFields: () => ({ ...authorization }) };
    }

    async createOrg(aliasOrUsername: string) {
        const username = String(this.authorizationOf(aliasOrUsername)?.username ?? aliasOrUsername);
        this.record(username, 'Org.create', [aliasOrUsername]);
        return {
            getUsername: () => username,
            getOrgId: () => this.authorizationOf(username)?.orgId,
            refreshAuth: async () => {
                this.record(username, 'org.refreshAuth', []);
                if ( !CONNECTED_ORG_USERNAMES.includes(username) ) {
                    throw new Error(FAILED_PING_MESSAGES_BY_USERNAME[username] ?? 'expired access/refresh token');
                }
            },
            getConnection: () => this.buildConnection(username)
        };
    }

}

let openOrgConnections: FakeOrgConnections | undefined;

export function setOpenOrgConnections(orgConnections: FakeOrgConnections | undefined) {
    openOrgConnections = orgConnections;
}

function orgConnections(): FakeOrgConnections {
    if ( !openOrgConnections ) {
        throw new Error('An @salesforce/core call was made with no journey open: call journey.open(fixture) first.');
    }
    return openOrgConnections;
}

export const journeySalesforceCoreModule = {
    AuthInfo: {
        listAllAuthorizations: () => orgConnections().listAllAuthorizations(),
        create: ({ username }: { username: string }) => orgConnections().createAuthInfo(username)
    },
    Org: { create: ({ aliasOrUsername }: { aliasOrUsername: string }) => orgConnections().createOrg(aliasOrUsername) },
    StateAggregator: { clearInstance: () => undefined },
    Lifecycle: { getInstance: () => ({ on: () => undefined, removeAllListeners: () => undefined }) },
    ScratchOrgCache: {},
    scratchOrgLifecycleEventName: 'scratchOrgLifecycleEvent',
    scratchOrgCreate: async () => { throw new Error('The journey\'s fake org does not create scratch orgs.'); }
};
