import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    FakeOrgConnections,
    FakeQuickPick,
    IJourneyHost,
    IRecordedPrompt,
    journeySalesforceCoreModule,
    journeyVscodeModule,
    setOpenJourneyHost,
    setOpenOrgConnections
} from './RecipeCockpitJourneyFakes';

/*
    The fakes a journey runs on (#577), held to what VS Code and @salesforce/core answer, so a later
    journey that reaches one the first journey never did finds it working, or naming what it lacks.
*/
describe('the journey fakes (#577)', () => {

    let workspaceRoot: string;
    let recordedCalls: Array<{ call: string; args: unknown[] }>;
    let shownQuickPicks: FakeQuickPick[];
    let journeyHost: IJourneyHost;

    beforeEach(() => {
        workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-journey-fakes-'));
        recordedCalls = [];
        shownQuickPicks = [];
        journeyHost = {
            workspaceRoot,
            settings: new Map<string, unknown>([['salesforce-data-treecipe.fakerService', 'faker-js']]),
            createWebviewPanel: () => { throw new Error('no panel in this suite'); },
            showNotification: async (_kind, _text, _options, buttons) => buttons[0],
            // THE SECOND ITEM OF A QUICK PICK, 'typed' IN AN INPUT BOX, AND NOTHING FOR A PROMPT TITLED Dismiss
            showPrompt: async (prompt: IRecordedPrompt) => prompt.title === 'Dismiss' ? undefined : prompt.offeredLabels[1] ?? 'typed',
            showQuickPickControl: (quickPick: FakeQuickPick) => { shownQuickPicks.push(quickPick); },
            recordCall: (call: string, args: unknown[]) => { recordedCalls.push({ call, args }); }
        };
        setOpenJourneyHost(journeyHost);
    });

    afterEach(() => {
        setOpenJourneyHost(undefined);
        setOpenOrgConnections(undefined);
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
    });

    test('a call with no journey open says to open one', () => {

        setOpenJourneyHost(undefined);

        expect(() => journeyVscodeModule.window.createWebviewPanel()).toThrow('A vscode or @salesforce/core call was made with no journey open: call journey.open(fixture) first.');
        expect(journeyVscodeModule.workspace.workspaceFolders).toBeUndefined();
        expect(() => journeySalesforceCoreModule.Org.create({ aliasOrUsername: 'qa' })).toThrow('An @salesforce/core call was made with no journey open: call journey.open(fixture) first.');

    });

    test('a notification answers with the button item chosen, whether a label or a MessageItem', async () => {

        await expect(journeyVscodeModule.window.showWarningMessage('Sure?', { modal: true, detail: 'It writes.' }, 'Yes', 'No')).resolves.toBe('Yes');
        await expect(journeyVscodeModule.window.showErrorMessage('Failed', { title: 'Report' })).resolves.toEqual({ title: 'Report' });
        await expect(journeyVscodeModule.window.showInformationMessage('Done')).resolves.toBeUndefined();

    });

    test('showQuickPick waits for its items, then answers with the item chosen; showInputBox with the text', async () => {

        await expect(journeyVscodeModule.window.showQuickPick(Promise.resolve([{ label: 'First' }, { label: 'Second' }]))).resolves.toEqual({ label: 'Second' });
        await expect(journeyVscodeModule.window.showInputBox()).resolves.toBe('typed');
        await expect(journeyVscodeModule.window.showQuickPick(['Only'], { title: 'Dismiss' })).resolves.toBeUndefined();

    });

    test('createQuickPick shows, accepts a label it offers, refuses one it does not, and hides once', () => {

        const quickPick = journeyVscodeModule.window.createQuickPick();
        const accepted: unknown[] = [];
        let hiddenCount = 0;
        let typedValue = '';
        quickPick.onDidAccept(() => accepted.push(quickPick.selectedItems[0]));
        quickPick.onDidHide(() => hiddenCount++);
        quickPick.onDidChangeValue((value: string) => { typedValue = value; });
        [quickPick.onDidChangeSelection(), quickPick.onDidChangeActive(), quickPick.onDidTriggerButton(), quickPick.onDidTriggerItemButton()]
            .forEach(subscription => expect(subscription.dispose()).toBeUndefined());
        quickPick.title = 'Org';
        quickPick.items = [{ label: 'qa' }, 'activeScratch'];

        quickPick.show();
        expect(shownQuickPicks).toEqual([quickPick]);
        expect(() => quickPick.accept('uat')).toThrow('The quick pick "Org" offers no "uat". It offers: "qa", "activeScratch".');
        quickPick.accept('qa');
        quickPick.typeValue('q');
        quickPick.dispose();
        quickPick.hide();
        quickPick.title = undefined;
        quickPick.placeholder = 'Choose an org';
        quickPick.items = [];
        expect(() => quickPick.accept('qa')).toThrow('The quick pick "Choose an org" offers no "qa". It offers: nothing.');

        expect(accepted).toEqual([{ label: 'qa' }]);
        expect(typedValue).toBe('q');
        expect(hiddenCount).toBe(1);

    });

    test('withProgress runs its task with a token never cancelled, and records the title', async () => {

        const answer = await journeyVscodeModule.window.withProgress({ title: 'Loading' }, async (progress: any, cancellationToken: any) => {
            progress.report({ message: 'half' });
            expect(cancellationToken.isCancellationRequested).toBeFalse();
            expect(cancellationToken.onCancellationRequested(() => undefined).dispose()).toBeUndefined();
            return 'done';
        });

        expect(answer).toBe('done');
        expect(recordedCalls).toEqual([{ call: 'window.withProgress', args: ['Loading'] }]);

    });

    test('the status bar item, output channel and providers do nothing but can be called', () => {

        const statusBarItem = journeyVscodeModule.window.createStatusBarItem();
        const outputChannel = journeyVscodeModule.window.createOutputChannel('Treecipe');

        expect([statusBarItem.show(), statusBarItem.hide(), statusBarItem.dispose()]).toEqual([undefined, undefined, undefined]);
        expect(outputChannel.name).toBe('Treecipe');
        expect([outputChannel.append(), outputChannel.appendLine(), outputChannel.clear(), outputChannel.show(), outputChannel.dispose()]).toEqual([undefined, undefined, undefined, undefined, undefined]);
        expect(journeyVscodeModule.window.registerWebviewViewProvider().dispose()).toBeUndefined();
        expect(journeyVscodeModule.window.registerTreeDataProvider().dispose()).toBeUndefined();
        expect(journeyVscodeModule.commands.registerCommand().dispose()).toBeUndefined();
        expect(journeyVscodeModule.workspace.onDidChangeConfiguration().dispose()).toBeUndefined();

    });

    test('the workspace is the journey\'s copy, and a configuration reads and writes the journey\'s settings', async () => {

        expect(journeyVscodeModule.workspace.workspaceFolders).toEqual([expect.objectContaining({ uri: expect.objectContaining({ fsPath: workspaceRoot }), index: 0 })]);

        const configuration = journeyVscodeModule.workspace.getConfiguration('salesforce-data-treecipe');
        expect(configuration.get('fakerService')).toBe('faker-js');
        expect(configuration.get('missing', 'fallback')).toBe('fallback');
        expect(configuration.has('fakerService')).toBeTrue();
        await configuration.update('recipeCockpitEnabled', true);
        expect(configuration.inspect('recipeCockpitEnabled')).toEqual({ key: 'salesforce-data-treecipe.recipeCockpitEnabled', workspaceValue: true });
        expect(journeyVscodeModule.workspace.getConfiguration().get('salesforce-data-treecipe.recipeCockpitEnabled')).toBeTrue();
        expect(recordedCalls).toEqual([{ call: 'workspace.getConfiguration().update', args: ['salesforce-data-treecipe.recipeCockpitEnabled', true] }]);

    });

    test('workspace.fs reads the journey\'s copy; opening and showing a document, commands and links are recorded', async () => {

        fs.mkdirSync(path.join(workspaceRoot, 'objects'));
        fs.writeFileSync(path.join(workspaceRoot, 'recipe.yml'), 'Account:');
        fs.symlinkSync(path.join(workspaceRoot, 'objects'), path.join(workspaceRoot, 'linkedObjects'));

        expect(await journeyVscodeModule.workspace.fs.readDirectory(journeyVscodeModule.Uri.file(workspaceRoot))).toEqual(expect.arrayContaining([['objects', 2], ['recipe.yml', 1], ['linkedObjects', 64]]));
        expect(String(await journeyVscodeModule.workspace.fs.readFile(journeyVscodeModule.Uri.file(path.join(workspaceRoot, 'recipe.yml'))))).toBe('Account:');

        const recipeUri = journeyVscodeModule.Uri.file(path.join(workspaceRoot, 'recipe.yml'));
        const document = await journeyVscodeModule.workspace.openTextDocument(recipeUri);
        const editor = await journeyVscodeModule.window.showTextDocument(document);
        await journeyVscodeModule.commands.executeCommand('vscode.open', 'x');
        await journeyVscodeModule.env.openExternal(journeyVscodeModule.Uri.parse('https://example.com/issues'));
        await journeyVscodeModule.env.clipboard.writeText('copied');

        expect(editor.revealRange()).toBeUndefined();
        expect(recipeUri.toString()).toBe('file://' + path.join(workspaceRoot, 'recipe.yml'));
        expect(recordedCalls.map(recordedCall => recordedCall.call)).toEqual(['workspace.openTextDocument', 'window.showTextDocument', 'commands.executeCommand', 'env.openExternal', 'env.clipboard.writeText']);
        expect(recordedCalls[3].args).toEqual(['https://example.com/issues']);

    });

    test('the classes and enums are what the cockpit constructs and compares', () => {

        const start = new journeyVscodeModule.Position(1, 2);
        const selection = new journeyVscodeModule.Selection(start, new journeyVscodeModule.Position(3, 4));
        let disposedCount = 0;

        expect(new journeyVscodeModule.ThemeIcon('folder').id).toBe('folder');
        expect(selection.start).toBe(start);
        journeyVscodeModule.Disposable.from({ dispose: () => disposedCount++ }, { dispose: () => disposedCount++ }).dispose();
        new journeyVscodeModule.Disposable().dispose();
        expect(disposedCount).toBe(2);
        expect(journeyVscodeModule.QuickPickItemKind.Separator).toBe(-1);

    });

    describe('the fake org', () => {

        let orgConnections: FakeOrgConnections;

        beforeEach(() => {
            orgConnections = new FakeOrgConnections();
            setOpenOrgConnections(orgConnections);
        });

        test('lists the fixture\'s authorizations, and a ping answers only for a connected org', async () => {

            expect((await journeySalesforceCoreModule.AuthInfo.listAllAuthorizations()).map(authorization => authorization.username)).toEqual(
                ['qa@example.com.qa', 'uat@example.com.uat', 'stale@example.com.dev', 'test-expired@example.com', 'test-deleted@example.com', 'test-active@example.com']);

            const qaOrg = await journeySalesforceCoreModule.Org.create({ aliasOrUsername: 'qa' });
            const uatOrg = await journeySalesforceCoreModule.Org.create({ aliasOrUsername: 'uat' });
            const unknownOrg = await journeySalesforceCoreModule.Org.create({ aliasOrUsername: 'nobody@example.com' });

            expect(qaOrg.getUsername()).toBe('qa@example.com.qa');
            expect(qaOrg.getOrgId()).toBe('00D000000000001AAA');
            await expect(qaOrg.refreshAuth()).resolves.toBeUndefined();
            await expect(uatOrg.refreshAuth()).rejects.toThrow('Error authenticating with the refresh token due to: expired access/refresh token');
            await expect(unknownOrg.refreshAuth()).rejects.toThrow('expired access/refresh token');

        });

        test('AuthInfo.create reads an authorization\'s fields, and refuses a username it does not have', async () => {

            const authInfo = await journeySalesforceCoreModule.AuthInfo.create({ username: 'test-active@example.com' });

            expect(authInfo.getUsername()).toBe('test-active@example.com');
            expect(authInfo.getFields()).toMatchObject({ isScratchOrg: true, orgId: '00D000000000006AAA' });
            await expect(journeySalesforceCoreModule.AuthInfo.create({ username: 'nobody@example.com' })).rejects.toThrow('No authorization found for nobody@example.com');

        });

        test('a connection answers the Organization row from the authorization, a scripted query, and no records otherwise', async () => {

            const connection: any = (await journeySalesforceCoreModule.Org.create({ aliasOrUsername: 'activeScratch' })).getConnection();
            orgConnections.queryAnswer = (_username, soql) => soql.includes('FROM Lead') ? { totalSize: 1, done: true, records: [{ Id: '00Q000000000001AAA' }] } : undefined;

            expect(connection.getUsername()).toBe('test-active@example.com');
            expect(connection.getApiVersion()).toBe('62.0');
            expect((await connection.query('SELECT IsSandbox FROM Organization')).records[0]).toMatchObject({ IsSandbox: false, TrialExpirationDate: '2026-12-31' });
            expect((await connection.query('SELECT Id FROM Lead')).records).toEqual([{ Id: '00Q000000000001AAA' }]);
            expect((await connection.query('SELECT Id FROM Account')).records).toEqual([]);
            expect((await connection.tooling.query('SELECT Id FROM ApexClass')).records).toEqual([]);

            // AN ORG THE FIXTURE DOES NOT AUTHORIZE ANSWERS AS NO SANDBOX, WITH NO ID
            const unknownOrg = await journeySalesforceCoreModule.Org.create({ aliasOrUsername: 'nobody@example.com' });
            const unknownConnection: any = unknownOrg.getConnection();
            expect(unknownOrg.getOrgId()).toBeUndefined();
            expect(unknownConnection.instanceUrl).toBeUndefined();
            expect((await unknownConnection.query('SELECT IsSandbox FROM Organization')).records[0]).toMatchObject({ Id: undefined, IsSandbox: false, TrialExpirationDate: null });

            expect(orgConnections.calls.filter(orgCall => orgCall.call !== 'Org.create').map(orgCall => orgCall.call)).toEqual(['connection.query', 'connection.query', 'connection.query', 'connection.tooling.query', 'connection.query']);

        });

        test('a connection call the fake has no answer for throws, naming the call and the org', () => {

            const connectionPromise = journeySalesforceCoreModule.Org.create({ aliasOrUsername: 'qa' }).then(org => org.getConnection() as any);

            return connectionPromise.then(connection => {
                expect(() => connection.describe()).toThrow('The journey\'s fake org has no answer for connection.describe on qa@example.com.qa: script it on journey.org.');
                expect(() => connection.sobject('Account').create({ Name: 'Acme' })).toThrow('no answer for connection.sobject(Account).create on qa@example.com.qa');
                expect(() => connection.metadata.deploy()).toThrow('no answer for connection.metadata.deploy');
                expect(orgConnections.calls.slice(-3)).toEqual([
                    { username: 'qa@example.com.qa', call: 'connection.describe', args: [] },
                    { username: 'qa@example.com.qa', call: 'connection.sobject(Account).create', args: [{ Name: 'Acme' }] },
                    { username: 'qa@example.com.qa', call: 'connection.metadata.deploy', args: [] }
                ]);
            });

        });

        test('the rest of @salesforce/core a cockpit module imports is there, and creates no scratch org', async () => {

            expect(journeySalesforceCoreModule.StateAggregator.clearInstance()).toBeUndefined();
            expect(journeySalesforceCoreModule.Lifecycle.getInstance().on()).toBeUndefined();
            expect(journeySalesforceCoreModule.Lifecycle.getInstance().removeAllListeners()).toBeUndefined();
            await expect(journeySalesforceCoreModule.scratchOrgCreate()).rejects.toThrow('The journey\'s fake org does not create scratch orgs.');

        });

    });

});
