import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { faker } from '@faker-js/faker';
import type { ExtensionContext } from 'vscode';
import { activate } from '../../../../../extension';
import {
    RecipeCockpitService,
    IRecipeCockpitWorkspaceState,
    RECIPE_COCKPIT_RUN_PICKER_LABEL,
    RECIPE_COCKPIT_TREECIPE_PICKER_LABEL
} from '../../RecipeCockpitService';
import { runPanelScript } from '../RecipeCockpitPanelHarness';
import {
    SalesforceOrgService,
    LEGACY_TARGET_DEV_HUB_ENVIRONMENT_VARIABLE,
    LEGACY_TARGET_ORG_ENVIRONMENT_VARIABLE,
    TARGET_DEV_HUB_ENVIRONMENT_VARIABLE,
    TARGET_ORG_ENVIRONMENT_VARIABLE
} from '../../../SalesforceOrgService/SalesforceOrgService';
import { PicklistDependencyCheckService } from '../../../PicklistDependencyCheckService/PicklistDependencyCheckService';
import {
    FakeOrgConnections,
    FakeSalesforceCli,
    FakeQuickPick,
    IFakeWebviewPanel,
    IJourneyHost,
    IRecordedNotification,
    IRecordedPrompt,
    NotificationKind,
    PromptAnswer,
    setOpenJourneyHost,
    setOpenOrgConnections
} from './RecipeCockpitJourneyFakes';
import { IPageElement, IScreenNode, RecipeCockpitScreen } from './RecipeCockpitScreen';

/*
    Drives the Recipe Cockpit the way a reader does (#577) and records what it does, so a refactor can
    prove the UX did not change.

    The host is the real RecipeCockpitService, opened through openRecipeCockpitPanel on a fresh copy of
    a fixture workspace in a temp folder; only vscode and @salesforce/core are fakes. Panel -> host
    messages go through the real routePanelMessage and executor; host -> panel messages go to the real
    panel script in RecipeCockpitPanelHarness's fake page. After every action both sides run until idle.

    Every action is a named STEP: a failure says which step, and in the reader's words what was on
    screen instead. Nothing here finds an element by class or id (AcceptanceSelectorScan.test.ts):
    every element is found by its role and name on screen().
*/

export const JOURNEY_FIXTURES_ROOT = path.join(__dirname, '..', 'mocks');

// THE ORG DROPDOWN AT THE TOP OF A CARD'S TREECIPE TAB, BY THE NAME IT GIVES ITSELF
export const JOURNEY_ORG_PICKER_NAME = 'Salesforce org the generated data goes to';

const RECIPE_COCKPIT_FLAG_SETTING = 'salesforce-data-treecipe.recipeCockpitEnabled';

/*
    The org listing reads the CLI's default org from these variables and from os.homedir()'s
    .sf/config.json, so a journey runs with none of them set and a home folder of its own: the orgs it
    offers are the fixture's, on every machine. os.homedir() asks the operating system, not Jest's copy
    of process.env, so setting HOME would not reach it; each step spies it instead (see step).
*/
const MACHINE_ENVIRONMENT_VARIABLES = [TARGET_ORG_ENVIRONMENT_VARIABLE, LEGACY_TARGET_ORG_ENVIRONMENT_VARIABLE,
    TARGET_DEV_HUB_ENVIRONMENT_VARIABLE, LEGACY_TARGET_DEV_HUB_ENVIRONMENT_VARIABLE];

/*
    How long a host handler may run with nothing delivered and no reader asked before a step fails as
    "did not go idle". Wall-clock, not rounds: a round costs a screen build while a handler is in
    flight, so a round cap grows with the screen and ran into Jest's own 5 s timeout first (#596).
*/
const DEFAULT_SETTLE_STALL_LIMIT_MS = 2000;

/*
    What the host keeps for the whole VS Code window, outside the panel a close disposes. A journey is a
    fresh window, so each is emptied before it opens; left, a second journey in a file reads the first's
    connection check and lists, and records no org call of its own.
*/
const WINDOW_CACHES: ReadonlyArray<{ name: string; clear: () => void }> = [
    { name: 'connected org status', clear: () => SalesforceOrgService.clearConnectedOrgStatusCache() },
    { name: 'org describes', clear: () => SalesforceOrgService.clearDescribeCache() },
    { name: 'Troubleshooting summaries', clear: () => RecipeCockpitService.clearTroubleshootingSummaries() },
    { name: 'Validation Rules lists', clear: () => RecipeCockpitService.clearTreeValidationRuleLists() },
    { name: 'Query tab lists', clear: () => RecipeCockpitService.clearTreeQueryLists() }
];
/*
    faker-js draws every generated value from one seeded stream, so a journey that generates a data set
    writes the same values on every run and a step can check a file by its content (#578).
*/
export const JOURNEY_FAKER_SEED = 578;

// QUIET ROUNDS OF THE EVENT LOOP BEFORE A JOURNEY CALLS IDLE
const QUIET_ROUNDS_WHEN_IDLE = 3;
const QUIET_ROUNDS_WHEN_WAITING_ON_READER = 50;

export type MessageDirection = 'panel → host' | 'host → panel';

export interface IRecordedMessage {
    direction: MessageDirection;
    command: string;
    message: unknown;
    step: string;
}

export interface IRecordedFileChange {
    change: 'written' | 'removed';
    // RELATIVE TO THE WORKSPACE ROOT, WITH / SEPARATORS
    relativePath: string;
    step: string;
}

export interface IRecordedHostCall {
    call: string;
    args: unknown[];
    step: string;
}

// A PART OF THE SCREEN BY ITS ROLE AND NAME, SUCH AS { role: 'group', name: 'Lead · Base Query' }
export interface IScreenRegion {
    role: string;
    name: string | RegExp;
}

interface IWaitingAnswer<TRecord> {
    record: TRecord;
    answer(chosen: PromptAnswer): void;
}

type PanelPage = ReturnType<typeof runPanelScript>;

export class RecipeCockpitJourney implements IJourneyHost {

    workspaceRoot = '';
    private journeyRoot = '';
    private readonly machineEnvironment = new Map<string, string | undefined>();
    // THE HOME FOLDER os.homedir() ANSWERS DURING EVERY STEP; EMPTY UNTIL open
    homePath = '';
    settleStallLimitMs = DEFAULT_SETTLE_STALL_LIMIT_MS;
    readonly settings = new Map<string, unknown>([[RECIPE_COCKPIT_FLAG_SETTING, true]]);
    readonly org = new FakeOrgConnections();
    readonly cli = new FakeSalesforceCli();

    readonly steps: string[] = [];
    readonly notifications: IRecordedNotification[] = [];
    readonly prompts: IRecordedPrompt[] = [];
    readonly fileChanges: IRecordedFileChange[] = [];
    readonly messages: IRecordedMessage[] = [];
    readonly hostCalls: IRecordedHostCall[] = [];
    readonly registeredCommands = new Map<string, (...commandArguments: unknown[]) => unknown>();
    private readonly extensionSubscriptions: Array<{ dispose(): unknown }> = [];
    readonly workspaceStateValues = new Map<string, unknown>();

    private readonly stepStack: string[] = [];
    private failedStepPath: string | undefined;
    private page: PanelPage | undefined;
    private panelMessageHandler: ((panelMessage: unknown) => unknown) | undefined;
    private readonly disposeHandlers: Array<() => void> = [];
    private hostToPanelQueue: unknown[] = [];
    private deliveredPanelMessageCount = 0;
    private inFlightHostHandlerCount = 0;
    private readonly hostHandlerErrors: unknown[] = [];
    private readonly waitingNotifications: Array<IWaitingAnswer<IRecordedNotification>> = [];
    private readonly waitingPrompts: Array<IWaitingAnswer<IRecordedPrompt>> = [];
    private readonly shownQuickPicks: Array<{ quickPick: FakeQuickPick; record: IRecordedPrompt }> = [];

    readonly workspaceState: IRecipeCockpitWorkspaceState = {
        get: <T>(key: string) => this.workspaceStateValues.get(key) as T | undefined,
        update: (key: string, value: unknown) => {
            if ( value === undefined ) { this.workspaceStateValues.delete(key); } else { this.workspaceStateValues.set(key, JSON.parse(JSON.stringify(value))); }
            return Promise.resolve();
        }
    };

    // ---- opening and closing ----

    /*
        Copies the fixture to a temp folder of its own, so a write in one journey never reaches another,
        and opens the cockpit on the copy. overlays are copied over it in order, as the cockpit's unit
        suites copy metadataDeployWorkspace over treeWorkspace (#579): a workspace no single fixture holds.
    */
    async open(fixtureName: string, openOptions: { overlays?: string[] } = {}): Promise<this> {

        const fixturePaths = [fixtureName, ...( openOptions.overlays ?? [] )].map(name => {
            const fixturePath = path.join(JOURNEY_FIXTURES_ROOT, name);
            if ( !fs.existsSync(fixturePath) ) {
                throw new Error(`No fixture workspace "${name}" in ${JOURNEY_FIXTURES_ROOT}.`);
            }
            return fixturePath;
        });

        this.journeyRoot = fs.mkdtempSync(path.join(os.tmpdir(), `treecipe-journey-${fixtureName}-`));
        this.workspaceRoot = path.join(this.journeyRoot, 'workspace');
        fixturePaths.forEach(fixturePath => fs.cpSync(fixturePath, this.workspaceRoot, { recursive: true }));

        this.homePath = path.join(this.journeyRoot, 'home');
        fs.mkdirSync(this.homePath);
        MACHINE_ENVIRONMENT_VARIABLES.forEach(variableName => {
            this.machineEnvironment.set(variableName, process.env[variableName]);
            delete process.env[variableName];
        });

        setOpenJourneyHost(this);
        setOpenOrgConnections(this.org);
        WINDOW_CACHES.forEach(windowCache => windowCache.clear());
        faker.seed(JOURNEY_FAKER_SEED);

        // A JOURNEY THAT FAILS TO OPEN IS NEVER HANDED TO ITS SUITE TO CLOSE, SO IT CLOSES ITSELF
        try {
            await this.step(`open the cockpit on ${fixtureName}`, async () => {
                await this.activateExtension();
                await RecipeCockpitService.openRecipeCockpitPanel(this.workspaceRoot, this.workspaceState);
                await this.settle();
            });
        } catch (openError) {
            await this.close();
            throw openError;
        }

        return this;

    }

    /*
        The real activate(), so executeCommand runs the handlers extension.ts registers (#578). What the
        window does as it starts is not a step of the reader's, so the calls it makes are not kept.
    */
    private async activateExtension(): Promise<void> {
        const hostCallCountBefore = this.hostCalls.length;
        await activate({ subscriptions: this.extensionSubscriptions, workspaceState: this.workspaceState } as unknown as ExtensionContext);
        this.hostCalls.splice(hostCallCountBefore);
    }

    /*
        The reader closes the cockpit's tab and opens it again from the palette (#579): the panel is
        disposed, and the real treecipe.openRecipeCockpit command activate() registered builds a new
        one. What the cockpit keeps across that is what it saved in the window's workspaceState.
    */
    async reopen(): Promise<void> {

        await this.step('close the cockpit and open it again', async () => {
            this.disposeHandlers.splice(0).forEach(disposeHandler => disposeHandler());
            this.page = undefined;
            const openCommand = this.registeredCommands.get('treecipe.openRecipeCockpit');
            if ( !openCommand ) { throw new Error('the extension registered no treecipe.openRecipeCockpit command to open the cockpit with.'); }
            await openCommand();
            await this.settle();
        });

    }

    // CLOSES THE PANEL AS A READER CLOSING THE TAB WOULD, AND REMOVES THE WORKSPACE COPY
    async close(): Promise<void> {

        this.disposeHandlers.splice(0).forEach(disposeHandler => disposeHandler());
        this.extensionSubscriptions.splice(0).forEach(subscription => subscription.dispose());
        // ONE TURN FOR WHAT THE CLOSE STARTS, AND NO WAIT FOR IDLE: CLOSING MUST CLEAN UP AFTER A HOST THAT HUNG TOO
        await new Promise(resolveTurn => setImmediate(resolveTurn));
        setOpenJourneyHost(undefined);
        setOpenOrgConnections(undefined);
        this.machineEnvironment.forEach((variableValue, variableName) => {
            if ( variableValue === undefined ) { delete process.env[variableName]; } else { process.env[variableName] = variableValue; }
        });
        this.machineEnvironment.clear();
        this.homePath = '';
        if ( this.journeyRoot ) {
            fs.rmSync(this.journeyRoot, { recursive: true, force: true });
        }

    }

    // ---- steps ----

    /*
        Runs one step of the journey under its name. A journey wraps its own expectations in a step too,
        so a failure always says which step it was, and what was on screen.
    */
    async step<TResult>(stepName: string, stepAction: () => Promise<TResult> | TResult): Promise<TResult> {

        // A STEP INSIDE A STEP IS PART OF IT: THE OUTERMOST ONE NAMES A FAILURE AND OWNS THE FILES WRITTEN
        const isOutermostStep = this.stepStack.length === 0;
        // A FAILURE AN EARLIER STEP TOLERATED NAMES NOTHING NOW
        if ( isOutermostStep ) { this.failedStepPath = undefined; }
        this.stepStack.push(stepName);
        this.steps.push(this.stepStack.join(' › '));
        const filesBefore = isOutermostStep ? this.snapshotFiles() : undefined;
        // AGAIN AT EVERY STEP: restoreMocks REMOVES THE SPY BEFORE EACH TEST OF A SUITE THAT OPENED ITS JOURNEY ONCE
        if ( this.homePath ) { jest.spyOn(os, 'homedir').mockReturnValue(this.homePath); }
        // NO sf PROCESS EVER STARTS IN A JOURNEY: EVERY CALL GOES TO journey.cli, RE-SPIED FOR THE SAME REASON
        jest.spyOn(PicklistDependencyCheckService, 'runSalesforceCli')
            .mockImplementation((cliArguments, _registerCancellation, _timeoutMilliseconds, projectOptions) => this.cli.run(cliArguments, projectOptions));

        try {
            return await stepAction();
        } catch (stepError) {
            // THE DEEPEST STEP THAT FAILED IS THE ONE NAMED, WITH THE STEPS IT WAS PART OF
            this.failedStepPath = this.failedStepPath ?? this.stepStack.join(' › ');
            if ( !isOutermostStep ) { throw stepError; }
            const failedStepPath = this.failedStepPath;
            this.failedStepPath = undefined;
            const reason = stepError instanceof Error ? stepError.message : String(stepError);
            throw new Error(`Step "${failedStepPath}" failed: ${reason}`, { cause: stepError });
        } finally {
            if ( filesBefore ) { this.recordFileChanges(filesBefore); }
            this.stepStack.pop();
        }

    }

    private currentStepName(): string {
        return this.stepStack.join(' › ') || '(between steps)';
    }

    // ---- what the reader does in the panel ----

    async chooseRun(runLabel: string): Promise<void> {

        await this.step(`choose the run "${runLabel}"`, async () => {
            const modelsBefore = this.countHostMessages('recipeData');
            await this.chooseOptionIn(RECIPE_COCKPIT_RUN_PICKER_LABEL, runLabel);
            const shownRun = this.screen().get('combobox', RECIPE_COCKPIT_RUN_PICKER_LABEL).value;
            if ( this.countHostMessages('recipeData') === modelsBefore || shownRun !== runLabel ) {
                throw new Error(`the "${RECIPE_COCKPIT_RUN_PICKER_LABEL}" dropdown was set to "${runLabel}", but the cockpit drew no run for it`
                    + ` (it shows "${shownRun}").`);
            }
        });

    }

    async chooseTree(treeName: string): Promise<void> {

        await this.step(`choose the treecipe "${treeName}"`, async () => {
            const optionLabel = this.optionLabelsOf(RECIPE_COCKPIT_TREECIPE_PICKER_LABEL).find(label => label === treeName || label === '★ ' + treeName) ?? treeName;
            await this.chooseOptionIn(RECIPE_COCKPIT_TREECIPE_PICKER_LABEL, optionLabel);
            const shownTreeName = this.shownTreeName();
            if ( shownTreeName !== treeName ) {
                throw new Error(`the "${RECIPE_COCKPIT_TREECIPE_PICKER_LABEL}" dropdown was set to "${treeName}", but the card shown is still "${shownTreeName}".`);
            }
        });

    }

    async openTab(tabName: string): Promise<void> {

        await this.step(`open the "${tabName}" tab`, async () => {
            const screen = this.screen();
            await this.clickNode(screen, screen.get('tab', tabName));
            const tab = this.screen().get('tab', tabName);
            if ( !tab.states.includes('selected') ) {
                throw new Error(`the "${tabName}" tab was clicked but is not selected.`);
            }
            this.screen().get('tabpanel', tabName);
        });

    }

    // within NAMES THE REGION TO LOOK IN WHEN THE SAME NAME IS ON SCREEN MORE THAN ONCE, AS A READER WOULD SAY "THE Run… OF THE Lead QUERY"
    async click(role: string, name: string | RegExp, within?: IScreenRegion): Promise<void> {

        await this.step(`click the ${role} "${name}"${within ? ` in the ${within.role} "${within.name}"` : ''}`, async () => {
            const screen = this.screen();
            await this.clickNode(screen, screen.get(role, name, within ? screen.get(within.role, within.name) : undefined));
        });

    }

    // AN OPTION CHOSEN IN A DROPDOWN, WITH NO CHECK OF WHAT FOLLOWS: FOR A CHOICE THE COCKPIT ANSWERS WITH A CONFIRMATION
    async chooseOption(comboboxName: string, optionLabel: string): Promise<void> {

        await this.step(`choose "${optionLabel}" in "${comboboxName}"`, () => this.chooseOptionIn(comboboxName, optionLabel));

    }

    async type(label: string, text: string): Promise<void> {

        await this.step(`type "${text}" in "${label}"`, async () => {
            const screen = this.screen();
            const textBoxElement = screen.elementOf(this.onlyTextBox(screen, label));
            textBoxElement.value = text;
            textBoxElement.dispatch('input');
            textBoxElement.dispatch('change');
            await this.settle();
        });

    }

    // A KEY PRESSED IN A TEXT BOX, AS ENTER COMMITS A RECORD COUNT (#578)
    async press(label: string, key: string): Promise<void> {

        await this.step(`press ${key} in "${label}"`, async () => {
            const screen = this.screen();
            const textBoxElement = screen.elementOf(this.onlyTextBox(screen, label));
            textBoxElement.dispatch('keydown', { key: key, preventDefault: () => undefined });
            textBoxElement.dispatch('keyup', { key: key, preventDefault: () => undefined });
            await this.settle();
        });

    }

    private onlyTextBox(screen: RecipeCockpitScreen, label: string): IScreenNode {
        const textBoxes = [...screen.findAll('textbox', label), ...screen.findAll('searchbox', label)];
        if ( textBoxes.length !== 1 ) {
            throw new Error(`${textBoxes.length === 0 ? 'no' : textBoxes.length} text boxes named "${label}" are on screen.`
                + ` The text boxes on screen: ${[...screen.findAll('textbox'), ...screen.findAll('searchbox')].map(node => `"${node.name}"`).join(', ') || 'none'}.`);
        }
        return textBoxes[0];
    }

    // THE IN-PANEL CONFIRMATION (#349) ANSWERED BY ITS BUTTON
    async answerConfirmation(buttonLabel: string): Promise<void> {

        await this.step(`answer the confirmation with "${buttonLabel}"`, async () => {
            const screen = this.screen();
            await this.clickNode(screen, screen.get('button', buttonLabel, this.shownDialog(screen)));
        });

    }

    async pickOrg(orgLabel: string): Promise<void> {

        await this.step(`pick the org "${orgLabel}"`, async () => {
            await this.chooseOptionIn(JOURNEY_ORG_PICKER_NAME, orgLabel);
        });

    }

    /*
        A message the panel's own controls would not send, posted as if the panel sent it: what a
        compromised or stale page could send, which the host's allow-lists must refuse (#578).
    */
    async forgePanelMessage(panelMessage: { command: string; [key: string]: unknown }): Promise<void> {

        await this.step(`forge the panel message "${panelMessage.command}"`, async () => {
            this.requirePage().postedHostMessages.push(panelMessage);
            await this.settle();
        });

    }

    // ---- what the reader answers in VS Code ----

    async answerQuickPick(label: string): Promise<void> {

        await this.step(`answer the quick pick with "${label}"`, async () => {
            const shownQuickPick = [...this.shownQuickPicks].reverse().find(entry => entry.quickPick.isShown);
            if ( shownQuickPick ) {
                shownQuickPick.record.offeredLabels = shownQuickPick.quickPick.offeredLabels();
                shownQuickPick.quickPick.accept(label);
                shownQuickPick.record.isWaiting = false;
            } else {
                const waitingQuickPick = this.takeWaiting(this.waitingPrompts, entry => entry.record.kind === 'quickPick', 'No quick pick is open.');
                if ( !waitingQuickPick.record.offeredLabels.includes(label) ) {
                    this.waitingPrompts.push(waitingQuickPick);
                    throw new Error(`the quick pick offers no "${label}". It offers: ${waitingQuickPick.record.offeredLabels.map(offered => `"${offered}"`).join(', ') || 'nothing'}.`);
                }
                waitingQuickPick.answer(label);
            }
            await this.settle();
        });

    }

    // A MULTI-SELECT QUICK PICK (#579) ANSWERED WITH EXACTLY THESE LABELS TICKED, WHATEVER STARTED TICKED
    async answerQuickPickMany(labels: string[]): Promise<void> {

        await this.step(`answer the multi-select with ${labels.map(label => `"${label}"`).join(', ') || 'nothing ticked'}`, async () => {
            const waitingQuickPick = this.takeWaiting(this.waitingPrompts, entry => entry.record.kind === 'quickPick' && entry.record.canPickMany === true, 'No multi-select quick pick is open.');
            const notOffered = labels.filter(label => !waitingQuickPick.record.offeredLabels.includes(label));
            if ( notOffered.length > 0 ) {
                this.waitingPrompts.push(waitingQuickPick);
                throw new Error(`the multi-select offers no ${notOffered.map(label => `"${label}"`).join(', ')}. It offers: ${waitingQuickPick.record.offeredLabels.map(offered => `"${offered}"`).join(', ') || 'nothing'}.`);
            }
            waitingQuickPick.answer(labels);
            await this.settle();
        });

    }

    // ESCAPE ON THE QUICK PICK THAT IS OPEN: IT CLOSES WITH NOTHING CHOSEN (#578)
    async dismissQuickPick(): Promise<void> {

        await this.step('dismiss the quick pick', async () => {
            const shownQuickPick = [...this.shownQuickPicks].reverse().find(entry => entry.quickPick.isShown);
            if ( shownQuickPick ) {
                shownQuickPick.record.offeredLabels = shownQuickPick.quickPick.offeredLabels();
                shownQuickPick.quickPick.hide();
                shownQuickPick.record.isWaiting = false;
            } else {
                this.takeWaiting(this.waitingPrompts, entry => entry.record.kind === 'quickPick', 'No quick pick is open.').answer(undefined);
            }
            await this.settle();
        });

    }

    async answerInputBox(text: string | undefined): Promise<void> {

        await this.step(text === undefined ? 'dismiss the input box' : `answer the input box with "${text}"`, async () => {
            this.takeWaiting(this.waitingPrompts, entry => entry.record.kind === 'inputBox', 'No input box is open.').answer(text);
            await this.settle();
        });

    }

    async clickNotificationButton(buttonLabel: string): Promise<void> {

        await this.step(`click "${buttonLabel}" on the notification`, async () => {
            const waitingNotification = this.takeWaiting(this.waitingNotifications, entry => entry.record.buttons.includes(buttonLabel),
                `No notification on screen has a "${buttonLabel}" button. Waiting: ${this.waitingNotifications.map(entry => `"${entry.record.text}" [${entry.record.buttons.join(', ')}]`).join('; ') || 'none'}.`);
            waitingNotification.answer(buttonLabel);
            await this.settle();
        });

    }

    // ---- what the reader sees ----

    screen(): RecipeCockpitScreen {
        const page = this.requirePage();
        return new RecipeCockpitScreen(
            [page.cockpitMetaElement, page.loadStatusElement, page.cockpitBodyElement, page.cockpitDialogHostElement] as IPageElement[],
            element => page.isDisplayed(element)
        );
    }

    optionLabelsOf(comboboxName: string): string[] {
        const screen = this.screen();
        return screen.findAll('option', undefined, screen.get('combobox', comboboxName)).map(option => option.name);
    }

    /*
        The card on screen, by the name its header gives its rename button -- the first "Rename …" in
        reading order, since a data set row's comes below it. Never the dropdown's value: that is what
        the reader just set, whether or not the card followed it.
    */
    shownTreeName(): string {
        const renameButton = this.screen().findAll('button', /^Rename .+$/)[0];
        if ( !renameButton ) { throw new Error('No treecipe card is shown.'); }
        return renameButton.name.replace(/^Rename /, '');
    }

    waitingNotificationTexts(): string[] {
        return this.waitingNotifications.map(entry => entry.record.text);
    }

    private shownDialog(screen: RecipeCockpitScreen): IScreenNode {
        const dialogs = [...screen.findAll('dialog'), ...screen.findAll('alertdialog')];
        if ( dialogs.length !== 1 ) {
            throw new Error(dialogs.length === 0 ? 'No confirmation is on screen.' : `${dialogs.length} confirmations are on screen.`);
        }
        return dialogs[0];
    }

    // ---- the host side of the fakes (IJourneyHost) ----

    createWebviewPanel(): IFakeWebviewPanel {

        const startPage = (assignedShellHtml: string) => this.startPage(assignedShellHtml);
        let shellHtml = '';
        const fakePanel: IFakeWebviewPanel = {
            visible: true,
            reveal: () => undefined,
            dispose: () => { this.disposeHandlers.splice(0).forEach(disposeHandler => disposeHandler()); },
            onDidDispose: (disposeHandler: () => void) => { this.disposeHandlers.push(disposeHandler); return { dispose: () => undefined }; },
            onDidChangeViewState: () => ({ dispose: () => undefined }),
            webview: {
                get html() { return shellHtml; },
                // A NEW DOCUMENT IS A NEW RUN OF THE PANEL SCRIPT; THE OLD ONE IS GONE, AND WHAT WAS POSTED TO IT WITH IT
                set html(nextShellHtml: string) { shellHtml = nextShellHtml; startPage(nextShellHtml); },
                postMessage: (hostMessage: unknown) => {
                    this.hostToPanelQueue.push(hostMessage);
                    this.logMessage('host → panel', hostMessage);
                    return Promise.resolve(true);
                },
                onDidReceiveMessage: (messageHandler: (panelMessage: unknown) => unknown) => {
                    this.panelMessageHandler = messageHandler;
                    return { dispose: () => { if ( this.panelMessageHandler === messageHandler ) { this.panelMessageHandler = undefined; } } };
                }
            }
        };
        return fakePanel;

    }

    async showNotification(kind: NotificationKind, text: string, options: { modal?: boolean; detail?: string } | undefined, buttons: string[]): Promise<string | undefined> {

        const notification: IRecordedNotification = { kind, text, detail: options?.detail, isModal: options?.modal === true, buttons, isWaiting: buttons.length > 0 };
        this.notifications.push(notification);
        if ( buttons.length === 0 ) { return undefined; }
        return new Promise(resolveAnswer => this.waitingNotifications.push({
            record: notification,
            // A NOTIFICATION IS ANSWERED BY ONE BUTTON'S LABEL, NEVER BY A LIST
            answer: chosen => { notification.isWaiting = false; resolveAnswer(typeof chosen === 'string' ? chosen : undefined); }
        }));

    }

    async showPrompt(prompt: IRecordedPrompt): Promise<PromptAnswer> {

        this.prompts.push(prompt);
        return new Promise(resolveAnswer => this.waitingPrompts.push({
            record: prompt,
            answer: chosen => { prompt.isWaiting = false; resolveAnswer(chosen); }
        }));

    }

    showQuickPickControl(quickPick: FakeQuickPick): void {

        const record: IRecordedPrompt = { kind: 'quickPick', title: quickPick.title, placeholder: quickPick.placeholder, offeredLabels: quickPick.offeredLabels(), isWaiting: true };
        this.prompts.push(record);
        this.shownQuickPicks.push({ quickPick, record });

    }

    recordCall(call: string, args: unknown[]): void {
        this.hostCalls.push({ call, args, step: this.currentStepName() });
    }

    // ---- the message pump ----

    // THE DOCUMENT THE HOST ASSIGNED IS THE ONE THAT RUNS, SO A HOST THAT ASSIGNS THE WRONG ONE FAILS A JOURNEY
    private startPage(assignedShellHtml: string) {
        this.page = runPanelScript({ shellHtml: assignedShellHtml });
        this.hostToPanelQueue = [];
        this.deliveredPanelMessageCount = 0;
    }

    private requirePage(): PanelPage {
        if ( !this.page ) { throw new Error('The cockpit has no panel open.'); }
        return this.page;
    }

    private logMessage(direction: MessageDirection, message: unknown) {
        const command = String((message as { command: unknown }).command);
        this.messages.push({ direction, command, message, step: this.currentStepName() });
    }

    countHostMessages(command: string): number {
        return this.messages.filter(entry => entry.direction === 'host → panel' && entry.command === command).length;
    }

    private deliverQueuedMessages(): boolean {

        let isAnythingDelivered = false;
        const page = this.requirePage();

        while ( this.hostToPanelQueue.length > 0 && this.page === page ) {
            isAnythingDelivered = true;
            page.postToPanel(this.hostToPanelQueue.shift());
        }

        while ( this.page === page && this.deliveredPanelMessageCount < page.postedHostMessages.length ) {
            isAnythingDelivered = true;
            const panelMessage = page.postedHostMessages[this.deliveredPanelMessageCount++];
            this.logMessage('panel → host', panelMessage);
            const messageHandler = this.panelMessageHandler;
            if ( !messageHandler ) { continue; }
            this.inFlightHostHandlerCount++;
            Promise.resolve()
                .then(() => messageHandler(panelMessage))
                .catch(handlerError => { this.hostHandlerErrors.push(handlerError); })
                .finally(() => { this.inFlightHostHandlerCount--; });
        }

        return isAnythingDelivered;

    }

    // A PROMPT OR NOTIFICATION WITH BUTTONS IN VS CODE, OR A CONFIRMATION ON SCREEN IN THE PANEL (#349)
    private isWaitingOnReader(): boolean {
        if ( this.waitingNotifications.length > 0 || this.waitingPrompts.length > 0 || this.shownQuickPicks.some(entry => entry.quickPick.isShown) ) {
            return true;
        }
        const screen = this.screen();
        return screen.findAll('dialog').length + screen.findAll('alertdialog').length > 0;
    }

    /*
        Delivers messages both ways until neither side has anything left to do: both queues empty, and
        every host message handler finished -- or waiting on a reader's answer to a prompt, a notification
        or a confirmation, which only the journey's next step can give. Work the host starts outside a
        handler (a notification button's follow-up) is not counted; it is waited for only by the quiet rounds.
    */
    private async settle(): Promise<void> {

        let quietRounds = 0;
        let lastDeliveryAt = Date.now();

        for (;;) {

            const isAnythingDelivered = this.deliverQueuedMessages();
            await new Promise(resolveRound => setImmediate(resolveRound));

            if ( isAnythingDelivered ) {
                quietRounds = 0;
                lastDeliveryAt = Date.now();
            } else if ( this.inFlightHostHandlerCount === 0 ) {
                if ( ++quietRounds >= QUIET_ROUNDS_WHEN_IDLE ) { break; }
            } else if ( this.isWaitingOnReader() ) {
                if ( ++quietRounds >= QUIET_ROUNDS_WHEN_WAITING_ON_READER ) { break; }
            } else if ( Date.now() - lastDeliveryAt > this.settleStallLimitMs ) {
                throw new Error(`the cockpit did not go idle: ${this.inFlightHostHandlerCount} host handler(s) were still running after ${this.settleStallLimitMs} ms with nothing delivered and nothing asked of the reader.`);
            }

        }

        // THE ORG PICKER CHANGES ITS PLACEHOLDER AND ITEMS ONCE THE LISTING ANSWERS
        this.shownQuickPicks.forEach(entry => {
            entry.record.title = entry.quickPick.title;
            entry.record.placeholder = entry.quickPick.placeholder;
            entry.record.offeredLabels = entry.quickPick.offeredLabels();
        });

        const handlerErrors = this.hostHandlerErrors.splice(0);
        if ( handlerErrors.length > 0 ) {
            throw new Error(`the host threw while handling a panel message: ${handlerErrors.map(handlerError => handlerError instanceof Error ? handlerError.message : String(handlerError)).join('; ')}`);
        }

    }

    // ---- panel actions on screen nodes ----

    // THE NODE IS CLICKED ON THE SCREEN IT WAS FOUND ON: NO SECOND LOOKUP BY NAME THAT COULD FIND ANOTHER
    private async clickNode(screen: RecipeCockpitScreen, node: IScreenNode): Promise<void> {
        if ( node.states.includes('disabled') ) {
            throw new Error(`the ${node.role} "${node.name}" is disabled.`);
        }
        screen.elementOf(node).dispatch('click');
        await this.settle();
    }

    private async chooseOptionIn(comboboxName: string, optionLabel: string): Promise<void> {

        const screen = this.screen();
        const combobox = screen.get('combobox', comboboxName);
        if ( combobox.states.includes('disabled') ) {
            throw new Error(`the "${comboboxName}" dropdown is disabled.`);
        }
        const options = screen.findAll('option', undefined, combobox);
        const chosenOption = options.find(option => option.name === optionLabel);
        if ( !chosenOption ) {
            throw new Error(`the "${comboboxName}" dropdown offers no "${optionLabel}". It offers: ${options.map(option => `"${option.name}"`).join(', ') || 'nothing'}.`);
        }
        const comboboxElement = screen.elementOf(combobox);
        comboboxElement.value = screen.elementOf(chosenOption).value;
        comboboxElement.dispatch('change');
        await this.settle();

    }

    private takeWaiting<TRecord>(waitingAnswers: Array<IWaitingAnswer<TRecord>>, isWanted: (entry: IWaitingAnswer<TRecord>) => boolean, missingMessage: string): IWaitingAnswer<TRecord> {
        for (let index = waitingAnswers.length - 1; index >= 0; index--) {
            if ( isWanted(waitingAnswers[index]) ) {
                return waitingAnswers.splice(index, 1)[0];
            }
        }
        throw new Error(missingMessage);
    }

    // ---- files written or removed under the workspace ----

    private snapshotFiles(): Map<string, string> {
        const fileHashes = new Map<string, string>();
        if ( !this.workspaceRoot || !fs.existsSync(this.workspaceRoot) ) { return fileHashes; }
        const visit = (directoryPath: string) => {
            fs.readdirSync(directoryPath, { withFileTypes: true }).forEach(entry => {
                const entryPath = path.join(directoryPath, entry.name);
                if ( entry.isDirectory() ) {
                    visit(entryPath);
                } else if ( entry.isFile() ) {
                    fileHashes.set(path.relative(this.workspaceRoot, entryPath).split(path.sep).join('/'),
                        crypto.createHash('sha256').update(fs.readFileSync(entryPath)).digest('hex'));
                }
            });
        };
        visit(this.workspaceRoot);
        return fileHashes;
    }

    private recordFileChanges(filesBefore: Map<string, string>) {
        const filesAfter = this.snapshotFiles();
        const stepName = this.currentStepName();
        filesAfter.forEach((fileHash, relativePath) => {
            if ( filesBefore.get(relativePath) !== fileHash ) { this.fileChanges.push({ change: 'written', relativePath, step: stepName }); }
        });
        filesBefore.forEach((_fileHash, relativePath) => {
            if ( !filesAfter.has(relativePath) ) { this.fileChanges.push({ change: 'removed', relativePath, step: stepName }); }
        });
    }

}
