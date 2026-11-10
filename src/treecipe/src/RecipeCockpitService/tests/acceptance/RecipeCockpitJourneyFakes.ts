import * as fs from 'fs';
import * as path from 'path';
import { CONNECTED_ORG_USERNAMES, FAILED_PING_MESSAGES_BY_USERNAME } from '../../../SalesforceOrgService/tests/OrgConnectionPings';
import { ISalesforceCliInvocationResult, SalesforceCli } from '../../../SalesforceCli/SalesforceCli';

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
    // SET ONLY ON A MULTI-SELECT QUICK PICK (canPickMany, #579): IT IS ANSWERED WITH answerQuickPickMany, AND THESE START TICKED
    canPickMany?: true;
    pickedLabels?: string[];
}

// WHAT A PROMPT IS ANSWERED WITH: A LABEL OR TEXT, THE LABELS TICKED IN A MULTI-SELECT, OR NOTHING FOR A DISMISSED ONE
export type PromptAnswer = string | string[] | undefined;

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
    showPrompt(prompt: IRecordedPrompt): Promise<PromptAnswer>;
    showQuickPickControl(quickPick: FakeQuickPick): void;
    recordCall(call: string, args: unknown[]): void;
    settings: Map<string, unknown>;
    // WHAT activate() REGISTERED, BY COMMAND ID: executeCommand RUNS THESE, AS VS CODE DOES
    registeredCommands: Map<string, (...commandArguments: unknown[]) => unknown>;
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
// WHAT activate() BUILDS THE ACTIVITY BAR VIEW WITH (#456); NOTHING IN A JOURNEY LISTENS TO IT
class FakeEventEmitter { event = () => disposable(); fire() { return undefined; } dispose() { return undefined; } }
class FakeTreeItem { constructor(public label: string, public collapsibleState?: number) {} }
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
        showQuickPick: async (items: unknown, options: { title?: string; placeHolder?: string; canPickMany?: boolean } = {}) => {
            const offeredItems = await Promise.resolve(items) as unknown[];
            const multiSelect = options.canPickMany === true
                ? { canPickMany: true as const, pickedLabels: offeredItems.filter(item => typeof item === 'object' && item !== null && (item as { picked?: unknown }).picked === true).map(labelOf) }
                : {};
            const chosen = await journeyHost().showPrompt({ kind: 'quickPick', title: options.title, placeholder: options.placeHolder, offeredLabels: offeredItems.map(labelOf), isWaiting: true, ...multiSelect });
            if ( chosen === undefined ) { return undefined; }
            // VS CODE ANSWERS A MULTI-SELECT WITH THE ITEMS TICKED, AND ANY OTHER QUICK PICK WITH THE ONE ITEM CHOSEN
            if ( options.canPickMany === true ) {
                const chosenLabels = Array.isArray(chosen) ? chosen : [chosen];
                return offeredItems.filter(item => chosenLabels.includes(labelOf(item)));
            }
            return offeredItems.find(item => labelOf(item) === chosen);
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
        onDidChangeWorkspaceFolders: () => disposable(),
        createFileSystemWatcher: () => ({ onDidCreate: () => disposable(), onDidChange: () => disposable(), onDidDelete: () => disposable(), dispose: () => undefined }),
        openTextDocument: async (documentUri: { fsPath: string }) => { journeyHost().recordCall('workspace.openTextDocument', [documentUri.fsPath]); return { uri: documentUri, lineCount: 0 }; },
        fs: {
            readDirectory: async (directoryUri: { fsPath: string }) => (await fs.promises.readdir(directoryUri.fsPath, { withFileTypes: true }))
                .map(entry => [entry.name, entry.isDirectory() ? 2 : entry.isSymbolicLink() ? 64 : 1]),
            readFile: async (fileUriToRead: { fsPath: string }) => fs.promises.readFile(fileUriToRead.fsPath),
            stat: async (statUri: { fsPath: string }) => {
                const fileStat = await fs.promises.stat(statUri.fsPath);
                return { type: fileStat.isDirectory() ? 2 : 1, ctime: fileStat.ctimeMs, mtime: fileStat.mtimeMs, size: fileStat.size };
            }
        }
    },
    /*
        A command the extension registered runs its real handler, so the cockpit's Generate and Run Faker
        write what they write for a user (#578); any other id is VS Code's own and is only recorded.
    */
    commands: {
        executeCommand: async (commandId: string, ...commandArguments: unknown[]) => {
            journeyHost().recordCall('commands.executeCommand', [commandId, ...commandArguments]);
            return journeyHost().registeredCommands.get(commandId)?.(...commandArguments);
        },
        registerCommand: (commandId?: string, commandHandler?: (...commandArguments: unknown[]) => unknown) => {
            if ( typeof commandId === 'string' && commandHandler ) {
                const registeredCommands = journeyHost().registeredCommands;
                registeredCommands.set(commandId, commandHandler);
                return { dispose: () => { if ( registeredCommands.get(commandId) === commandHandler ) { registeredCommands.delete(commandId); } } };
            }
            return disposable();
        }
    },
    env: {
        openExternal: async (externalUri: unknown) => { journeyHost().recordCall('env.openExternal', [String(externalUri)]); return true; },
        clipboard: { writeText: async (clipboardText: string) => { journeyHost().recordCall('env.clipboard.writeText', [clipboardText]); } }
    },
    Uri: {
        file: fileUri,
        joinPath: (baseUri: { fsPath: string }, ...pathSegments: string[]) => fileUri(path.join(baseUri.fsPath, ...pathSegments)),
        // A PLAIN PATH OR file:// IS A FILE, AS VS CODE PARSES IT (RecordTypeService PARSES ITS FOLDER'S PATH); ANY OTHER SCHEME IS KEPT AS GIVEN
        parse: (uriValue: string) => /^(file:\/\/|\/)/.test(uriValue)
            ? fileUri(uriValue.replace(/^file:\/\//, ''))
            : { scheme: uriValue.split(':')[0], toString: () => uriValue }
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
    EventEmitter: FakeEventEmitter,
    TreeItem: FakeTreeItem,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
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

    A Collections API insert (#578) is recorded with its object and records, and answered as Salesforce
    answers one that landed, unless the journey scripts insertAnswer. An org the shared fixture lacks,
    such as a production org, is added to one journey with addAuthorization.
*/
const ORG_AUTHORIZATIONS: Array<Record<string, unknown>> = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'SalesforceOrgService', 'tests', 'mocks', 'orgAuthorizations.json'), 'utf-8'));

export type OrgQueryAnswer = (username: string, soql: string) => { totalSize: number; done: boolean; records: unknown[] } | undefined;

// ONE RESULT PER RECORD, IN THE ORDER SENT, AS sobject(x).insert ANSWERS: { success, id } OR { success: false, errors }
export interface IFakeInsertResult {
    success: boolean;
    id?: string;
    errors?: Array<{ statusCode: string; message: string; fields: string[] }>;
}
// WHAT connection.describe(objectApiName) ANSWERS: { name, fields: [{ name, type, createable, … }] }, OR undefined FOR NO ANSWER
export type OrgDescribeAnswer = (username: string, objectApiName: string) => { name: string; fields: Array<Record<string, unknown>> } | undefined;
/*
    What a Metadata API call (#579) or a GET on the org answers, by the call's name as it is recorded --
    'connection.metadata.deploy', 'connection.metadata.checkDeployStatus', 'connection.requestGet' -- or
    undefined for no answer, when the call throws as every other unanswered one does.
*/
export type OrgCallAnswer = (username: string, call: string, args: unknown[]) => unknown;
export const SCRIPTED_METADATA_CALLS = ['deploy', 'checkDeployStatus', 'cancelDeploy', 'list', 'retrieve', 'checkRetrieveStatus'] as const;
export type OrgInsertAnswer = (username: string, objectApiName: string, records: Array<Record<string, unknown>>) => IFakeInsertResult[] | undefined;

// AN ID SALESFORCE COULD HAVE GIVEN: THE OBJECT'S NAME LEADS, SO A FAILURE READS "Contact0000…" RATHER THAN A MEANINGLESS NUMBER
function buildFakeRecordId(objectApiName: string, recordNumber: number): string {
    return (objectApiName.replace(/[^A-Za-z0-9]/g, '').slice(0, 6) + String(recordNumber).padStart(12, '0')).slice(0, 18);
}

export class FakeOrgConnections {

    readonly calls: IRecordedOrgCall[] = [];
    queryAnswer: OrgQueryAnswer = () => undefined;
    insertAnswer: OrgInsertAnswer = () => undefined;
    // THE TREECIPE ADAPTER'S PATCH composite/sobjects (#580): ONE RESULT PER RECORD SENT, OR undefined FOR EVERY RECORD UPDATED
    updateAnswer: OrgInsertAnswer = () => undefined;
    describeAnswer: OrgDescribeAnswer = () => undefined;
    callAnswer: OrgCallAnswer = () => undefined;
    private insertedRecordCount = 0;

    // A COPY PER JOURNEY, SO addAuthorization NEVER REACHES ANOTHER JOURNEY OR THE FIXTURE
    readonly authorizations: Array<Record<string, unknown>> = ORG_AUTHORIZATIONS.map(authorization => ({ ...authorization }));
    private readonly addedConnectedUsernames = new Set<string>();

    // AN ORG FOR THIS JOURNEY ONLY; IT ANSWERS A PING, AND ITS Organization ROW SAYS IsSandbox FROM authorization.isSandbox
    addAuthorization(authorization: { username: string; aliases?: string[]; orgId: string; instanceUrl: string; isSandbox?: boolean }) {
        if ( this.authorizationOf(authorization.username) ) {
            throw new Error(`The journey's fake org already has an authorization for ${authorization.username}.`);
        }
        this.authorizations.push({ isScratchOrg: false, isDevHub: false, ...authorization });
        this.addedConnectedUsernames.add(authorization.username);
    }

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
        const answerInsert = (objectApiName: string, insertCall: 'insert' | 'create', records: Array<Record<string, unknown>>, insertOptions: unknown) => {
            this.record(username, `connection.sobject(${objectApiName}).${insertCall}`, [records, insertOptions]);
            return this.insertAnswer(username, objectApiName, records)
                ?? records.map(() => ({ success: true, id: buildFakeRecordId(objectApiName, ++this.insertedRecordCount), errors: [] }));
        };
        // NOT async: AN UNSCRIPTED CALL THROWS AS IT IS CALLED; A SCRIPTED ONE IS RECORDED AND ANSWERS AS A PROMISE
        const scripted = (call: string) => (...args: unknown[]) => {
            const scriptedAnswer = this.callAnswer(username, call, args);
            if ( scriptedAnswer === undefined ) { return unanswered(call)(...args); }
            this.record(username, call, args);
            return Promise.resolve(scriptedAnswer);
        };
        const connection: Record<string, unknown> = {
            instanceUrl: authorization?.instanceUrl,
            version: '62.0',
            getUsername: () => username,
            getApiVersion: () => '62.0',
            query: async (soql: string) => answerQuery(soql),
            queryMore: unanswered('connection.queryMore'),
            // NOT async: AN UNSCRIPTED DESCRIBE THROWS AS IT IS CALLED, AS EVERY OTHER UNANSWERED CALL DOES
            describe: (...describeArguments: unknown[]) => {
                const scriptedDescribe = typeof describeArguments[0] === 'string' ? this.describeAnswer(username, describeArguments[0]) : undefined;
                if ( !scriptedDescribe ) { return unanswered('connection.describe')(...describeArguments); }
                this.record(username, 'connection.describe', describeArguments);
                return Promise.resolve(scriptedDescribe);
            },
            describeGlobal: unanswered('connection.describeGlobal'),
            request: unanswered('connection.request'),
            requestGet: scripted('connection.requestGet'),
            requestPost: unanswered('connection.requestPost'),
            // create IS jsforce'S OTHER NAME FOR insert (THE PERMISSION SET ASSIGNMENT USES IT, #579); EACH IS RECORDED UNDER ITS OWN NAME
            sobject: (objectApiName: string) => ({
                insert: async (records: Array<Record<string, unknown>>, insertOptions?: unknown) => answerInsert(objectApiName, 'insert', records, insertOptions),
                create: async (records: Array<Record<string, unknown>>, insertOptions?: unknown) => answerInsert(objectApiName, 'create', records, insertOptions),
                update: async (records: Array<Record<string, unknown>>, updateOptions?: unknown) => {
                    this.record(username, `connection.sobject(${objectApiName}).update`, [records, updateOptions]);
                    return this.updateAnswer(username, objectApiName, records)
                        ?? records.map(record => ({ success: true, id: record.Id, errors: [] }));
                },
                describe: unanswered(`connection.sobject(${objectApiName}).describe`)
            }),
            tooling: { query: async (soql: string) => { this.record(username, 'connection.tooling.query', [soql]); return answerToolingQuery(soql); } },
            metadata: Object.fromEntries(SCRIPTED_METADATA_CALLS.map(metadataCall => [metadataCall, scripted(`connection.metadata.${metadataCall}`)]))
        };
        return connection;
    }

    async listAllAuthorizations() {
        return this.authorizations.map(authorization => ({ ...authorization }));
    }

    // THE ORG THE READER LOGS IN TO WHEN "Authorize org" OPENS THE BROWSER (#630); UNSET, THE LOGIN FAILS AS AN UNSCRIPTED CALL DOES
    browserLoginAuthorization: { username: string; orgId: string; instanceUrl: string; isSandbox?: boolean } | undefined;

    async createWebOAuthServer(loginUrl: string) {
        this.record('', 'WebOAuthServer.create', [loginUrl]);
        return {
            start: async () => undefined,
            getAuthorizationUrl: () => `${loginUrl}/services/oauth2/authorize?client_id=PlatformCLI`,
            authorizeAndSave: async () => {
                const authorization = this.browserLoginAuthorization;
                if ( !authorization ) {
                    throw new Error('The journey\'s fake browser has no login to complete. Script it on journey.org.browserLoginAuthorization.');
                }
                this.addAuthorization(authorization);
                return { getUsername: () => authorization.username };
            },
            webServer: { close: () => undefined }
        };
    }

    async setAlias(alias: string, username: string) {
        this.record(username, 'aliases.setAndSave', [alias, username]);
        this.authorizations.forEach(authorization => {
            if ( Array.isArray(authorization.aliases) ) {
                authorization.aliases = authorization.aliases.filter(heldAlias => heldAlias !== alias);
            }
        });
        const authorization = this.authorizationOf(username);
        if ( authorization ) {
            authorization.aliases = [alias];
        }
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
                if ( !CONNECTED_ORG_USERNAMES.includes(username) && !this.addedConnectedUsernames.has(username) ) {
                    throw new Error(FAILED_PING_MESSAGES_BY_USERNAME[username] ?? 'expired access/refresh token');
                }
            },
            getConnection: () => this.buildConnection(username)
        };
    }

}

/*
    The Salesforce CLI (#579), faked where every sf process starts: SalesforceCli.runSalesforceCli.
    Each call is recorded as the argv the cockpit built and the folder it runs in, and answered by
    the journey's answer for that argv. One with no answer comes back as a CLI that could not be
    started, its message naming the argv, so a journey that reaches it reads which answer is missing.
*/
export interface IFakeCliAnswer {
    stdout: string;
    stderr?: string;
    exitCode: number;
}
export interface IRecordedCliCall {
    argv: string[];
    workingDirectoryPath?: string;
}
export class FakeSalesforceCli {

    readonly calls: IRecordedCliCall[] = [];
    answer: (argv: string[]) => IFakeCliAnswer | undefined = () => undefined;

    async run(argv: string[], projectOptions?: { workingDirectoryPath?: string }): Promise<ISalesforceCliInvocationResult> {
        this.calls.push({ argv: [...argv], ...( projectOptions?.workingDirectoryPath ? { workingDirectoryPath: projectOptions.workingDirectoryPath } : {} ) });
        const scriptedAnswer = this.answer(argv);
        if ( !scriptedAnswer ) {
            const spawnError: NodeJS.ErrnoException = Object.assign(new Error(`The journey's fake sf CLI has no answer for: sf ${argv.join(' ')}. Script it on journey.cli.answer.`), { code: 'ENOENT' });
            return { stdout: '', stderr: '', exitCode: null, spawnError: spawnError };
        }
        return { stdout: scriptedAnswer.stdout, stderr: scriptedAnswer.stderr ?? '', exitCode: scriptedAnswer.exitCode };
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
    StateAggregator: {
        clearInstance: () => undefined,
        getInstance: async () => ({ aliases: { setAndSave: (alias: string, username: string) => orgConnections().setAlias(alias, username) } })
    },
    WebOAuthServer: { create: ({ oauthConfig }: { oauthConfig: { loginUrl: string } }) => orgConnections().createWebOAuthServer(oauthConfig.loginUrl) },
    Lifecycle: { getInstance: () => ({ on: () => undefined, removeAllListeners: () => undefined }) },
    ScratchOrgCache: {},
    scratchOrgLifecycleEventName: 'scratchOrgLifecycleEvent',
    scratchOrgCreate: async () => { throw new Error('The journey\'s fake org does not create scratch orgs.'); }
};
