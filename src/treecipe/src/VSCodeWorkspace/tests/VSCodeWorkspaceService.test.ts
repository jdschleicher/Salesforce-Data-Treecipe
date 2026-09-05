import { ConfigurationService } from "../../ConfigurationService/ConfigurationService";
import { MockDirectoryService } from "../../DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory/MockDirectoryService";
import { VSCodeWorkspaceService } from "../VSCodeWorkspaceService";
import { MockVSCodeWorkspaceService } from "./mocks/MockVSCodeWorkspaceService";
import { SfdxProjectService } from "../../SfdxProjectService/SfdxProjectService";

import * as fs from 'fs';
import * as vscode from 'vscode';
import * as path from 'path';

jest.mock('vscode', () => ({
    workspace: {
        workspaceFolders: undefined,
        fs: {
            readFile: jest.fn()
        },
        openTextDocument: jest.fn()
    },
    Uri: {
        file: (path: string) => ({ fsPath: path })
    },
    window: {
        showErrorMessage: jest.fn(),
        showWarningMessage: jest.fn(),
        showInformationMessage: jest.fn(),
        showQuickPick: jest.fn(),
        showInputBox: jest.fn(),
        createOutputChannel: jest.fn(),
        showTextDocument: jest.fn(),
        createQuickPick: jest.fn(),
        withProgress: jest.fn(),
        createStatusBarItem: jest.fn()
    },
    ProgressLocation: { Notification: 15, Window: 10 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    env: {
        clipboard: {
            writeText: jest.fn()
        }
    },
    Position: jest.fn().mockImplementation((line: number, character: number) => ({ line, character })),
    Selection: jest.fn().mockImplementation((anchor: unknown, active: unknown) => ({ anchor, active })),
    Range: jest.fn().mockImplementation((start: unknown, end: unknown) => ({ start, end })),
    TextEditorRevealType: { InCenter: 2 },
    commands: {
        executeCommand: jest.fn()
    },
    ThemeIcon: jest.fn().mockImplementation(
        (name) => ({ id: name })
    )

}), { virtual: true });


/*
    Best effort removal of a directory a test created under the os temp directory. Never throws:
    losing a temp directory is a housekeeping problem, and failing an otherwise green test over it
    reports a defect that does not exist.
*/
function removeTemporaryDirectoryQuietly(temporaryDirectoryPath: string) {

    try {
        fs.rmSync(temporaryDirectoryPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
    } catch {
        // INTENTIONALLY IGNORED -- SEE ABOVE
    }

}

describe('Shared VSCodeWorkspaceService unit tests', () => {

    /*
        The explorer panel links into a generated class and a run report at a specific method, so the
        editor has to land on the line rather than at the top of the file. A line of 0 is what the
        panel's line finders return for "this file does not declare it" -- opening at the top is then
        the right answer, and moving the cursor to a line that merely happens to be first is not.
    */
    describe('openFileInEditor', () => {

        let revealedTextEditor: { selection: unknown; revealRange: jest.Mock };

        beforeEach(() => {

            revealedTextEditor = { selection: undefined, revealRange: jest.fn() };

            (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue({});
            (vscode.window.showTextDocument as jest.Mock).mockResolvedValue(revealedTextEditor);

        });

        test('given a one based line number, selects and reveals that line', async () => {

            await VSCodeWorkspaceService.openFileInEditor('/workspace/classes/SDTSpecs.cls', 7);

            expect(vscode.Position).toHaveBeenCalledWith(6, 0);
            expect(revealedTextEditor.revealRange).toHaveBeenCalled();

        });

        test('given no line number, opens the file and moves nothing', async () => {

            await VSCodeWorkspaceService.openFileInEditor('/workspace/classes/SDTSpecs.cls');

            expect(revealedTextEditor.revealRange).not.toHaveBeenCalled();

        });

        test('given a line number of 0, opens at the top rather than at the first line', async () => {

            await VSCodeWorkspaceService.openFileInEditor('/workspace/classes/SDTSpecs.cls', 0);

            expect(revealedTextEditor.revealRange).not.toHaveBeenCalled();

        });

    });

    describe('copyTextToClipboard', () => {

        test('given a combination reference, writes exactly that text to the clipboard', async () => {

            await VSCodeWorkspaceService.copyTextToClipboard('Chain_Example__c.State__c @ USA');

            expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith('Chain_Example__c.State__c @ USA');

        });

    });


    describe('showDiffForProposedContent', () => {

        test('given content that has not been written, opens vscode.diff with the file on disk on the left', async () => {

            const existingFilePath = '/workspace/force-app/main/default/classes/SDTPLDAccountSpecs.cls';
            const proposedContent = '// WHAT REGENERATION WOULD WRITE';

            const diffOpened = await VSCodeWorkspaceService.showDiffForProposedContent(
                existingFilePath, proposedContent, 'SDTPLDAccountSpecs.cls'
            );

            expect(diffOpened).toBe(true);

            const [diffCommand, leftUri, rightUri, diffTitle] = (vscode.commands.executeCommand as jest.Mock).mock.calls[0];

            expect(diffCommand).toBe('vscode.diff');
            expect(leftUri.fsPath).toBe(existingFilePath);
            expect(diffTitle).toBe('SDTPLDAccountSpecs.cls');

            /*
                The right hand side is a real file so the diff editor has a document to render, and
                it keeps the generated class name so the tab does not read as a random temp path.
            */
            expect(path.basename(rightUri.fsPath)).toBe('SDTPLDAccountSpecs.cls');
            expect(rightUri.fsPath).not.toBe(existingFilePath);
            expect(fs.readFileSync(rightUri.fsPath, 'utf-8')).toBe(proposedContent);

            /*
                Cleanup is housekeeping, not an assertion, so a filesystem that refuses the rmdir
                must not fail a test whose assertions have all already passed. Some filesystems --
                overlayfs in a container among them -- return ENOTEMPTY for a recursive remove of a
                directory whose entries were only just unlinked, and retries do not settle it.
            */
            removeTemporaryDirectoryQuietly(path.dirname(rightUri.fsPath));

        });

        test('given a diff that cannot be opened, reports it and does not throw', async () => {

            (vscode.commands.executeCommand as jest.Mock).mockRejectedValueOnce(new Error('no diff editor'));

            const diffOpened = await VSCodeWorkspaceService.showDiffForProposedContent('/workspace/some.cls', 'content', 'some.cls');

            /*
                A diff is a convenience on the way to a decision the user still gets to make from
                the report, so failing to open one must not abort generation.
            */
            expect(diffOpened).toBe(false);
            expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('/workspace/some.cls'));

        });

    });

    describe('buildAuthenticatedOrgQuickPickItems', () => {

        test('given an alias, the alias labels the item and the username still describes it', () => {

            const quickPickItems = VSCodeWorkspaceService.buildAuthenticatedOrgQuickPickItems([
                { targetOrgIdentifier: 'devhub', username: 'jd@example.com', alias: 'devhub' }
            ] as any);

            expect(quickPickItems[0].label).toBe('devhub');
            // THE USERNAME IS WHAT KEEPS TWO ALIASES ON ONE ORG TELLABLE APART
            expect(quickPickItems[0].description).toBe('jd@example.com');
            expect(quickPickItems[0].detail).toBe('devhub');

        });

        test('given no alias, the username labels the item', () => {

            const quickPickItems = VSCodeWorkspaceService.buildAuthenticatedOrgQuickPickItems([
                { targetOrgIdentifier: 'jd@example.com', username: 'jd@example.com', alias: undefined }
            ] as any);

            expect(quickPickItems[0].label).toBe('jd@example.com');
            expect(quickPickItems[0].detail).toBe('jd@example.com');

        });

        test('given no authenticated orgs, produces an empty list rather than throwing', () => {
            expect(VSCodeWorkspaceService.buildAuthenticatedOrgQuickPickItems([])).toEqual([]);
        });

    });

    describe('promptForAuthenticatedTargetOrg', () => {

        test('given a selection, returns the target org identifier carried on detail', async () => {

            jest.spyOn(vscode.window, 'showQuickPick').mockResolvedValue({
                label: 'devhub',
                description: 'jd@example.com',
                detail: 'devhub'
            } as never);

            const selectedTargetOrg = await VSCodeWorkspaceService.promptForAuthenticatedTargetOrg([
                { targetOrgIdentifier: 'devhub', username: 'jd@example.com', alias: 'devhub' }
            ] as any);

            expect(selectedTargetOrg).toBe('devhub');

        });

        test('given the quick pick is dismissed, returns undefined', async () => {

            jest.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(undefined as never);

            const selectedTargetOrg = await VSCodeWorkspaceService.promptForAuthenticatedTargetOrg([
                { targetOrgIdentifier: 'devhub', username: 'jd@example.com', alias: 'devhub' }
            ] as any);

            expect(selectedTargetOrg).toBeUndefined();

        });

        /*
            A selection returns `detail`, so an org reaching the quick pick with an empty
            targetOrgIdentifier would be indistinguishable from a dismissal and the command would
            silently do nothing. That cannot happen because buildAuthenticatedOrgDetails drops an
            unusable identifier before it ever gets here -- this pins the property the safety of
            `?.detail` actually rests on.
        */
        test('every quick pick item carries a non-empty detail to select by', () => {

            const quickPickItems = VSCodeWorkspaceService.buildAuthenticatedOrgQuickPickItems([
                { targetOrgIdentifier: 'devhub', username: 'jd@example.com', alias: 'devhub' },
                { targetOrgIdentifier: 'jd@example.com', username: 'jd@example.com', alias: undefined }
            ] as any);

            quickPickItems.forEach(quickPickItem => {
                expect(quickPickItem.detail).toBeTruthy();
            });

        });

    });

    describe('picklist dependency check output channel', () => {

        function buildMockOutputChannel() {
            return { clear: jest.fn(), appendLine: jest.fn(), show: jest.fn(), dispose: jest.fn() };
        }

        beforeEach(() => {
            // THE CHANNEL IS CACHED ON THE CLASS, SO IT HAS TO BE CLEARED BETWEEN CASES
            (VSCodeWorkspaceService as any).picklistDependencyCheckOutputChannel = undefined;
            (VSCodeWorkspaceService as any).extensionSubscriptions = undefined;
        });

        test('creates the channel lazily and reuses the same one across calls', () => {

            const mockOutputChannel = buildMockOutputChannel();
            const createOutputChannelSpy = jest.spyOn(vscode.window, 'createOutputChannel')
                .mockReturnValue(mockOutputChannel as never);

            const firstChannel = VSCodeWorkspaceService.getPicklistDependencyCheckOutputChannel();
            const secondChannel = VSCodeWorkspaceService.getPicklistDependencyCheckOutputChannel();

            expect(createOutputChannelSpy).toHaveBeenCalledTimes(1);
            expect(firstChannel).toBe(secondChannel);

        });

        test('registers the channel for disposal when the extension supplied subscriptions', () => {

            jest.spyOn(vscode.window, 'createOutputChannel').mockReturnValue(buildMockOutputChannel() as never);

            const subscriptions: any[] = [];
            VSCodeWorkspaceService.registerExtensionSubscriptions(subscriptions);

            VSCodeWorkspaceService.getPicklistDependencyCheckOutputChannel();

            expect(subscriptions.length).toBe(1);

        });

        // NOTHING REGISTERS SUBSCRIPTIONS IN A JEST RUN, AND THAT MUST NOT THROW
        test('creates the channel without throwing when no subscriptions were registered', () => {

            jest.spyOn(vscode.window, 'createOutputChannel').mockReturnValue(buildMockOutputChannel() as never);

            expect(() => VSCodeWorkspaceService.getPicklistDependencyCheckOutputChannel()).not.toThrow();

        });

        /*
            Clearing before appending is what makes the visible output belong to the run that just
            finished. Appending without it silently accumulates every previous run's report.
        */
        test('clears the channel before writing the report, then reveals it', () => {

            const mockOutputChannel = buildMockOutputChannel();
            jest.spyOn(vscode.window, 'createOutputChannel').mockReturnValue(mockOutputChannel as never);

            VSCodeWorkspaceService.showPicklistDependencyCheckReport('report body');

            expect(mockOutputChannel.clear).toHaveBeenCalled();
            expect(mockOutputChannel.appendLine).toHaveBeenCalledWith('report body');
            expect(mockOutputChannel.show).toHaveBeenCalledWith(true);

            const clearCallOrder = mockOutputChannel.clear.mock.invocationCallOrder[0];
            const appendCallOrder = mockOutputChannel.appendLine.mock.invocationCallOrder[0];
            expect(clearCallOrder).toBeLessThan(appendCallOrder);

        });

    });

    describe('promptForObjectsPath', () => {

        /*
            The picker is opened BEFORE the scan and filled as it runs, so a double has to model
            the ordering rather than a single showQuickPick call: onScanComplete fires the moment
            the service clears busy, which is the only point at which a real user could have
            accepted anything.
        */
        const buildFakeQuickPick = () => {

            const acceptHandlers: Array<() => void> = [];
            const hideHandlers: Array<() => void> = [];
            let busyValue = false;

            const fakeQuickPick: any = {
                items: [],
                selectedItems: [],
                activeItems: [],
                itemsAssignmentCount: 0,
                placeholder: undefined,
                ignoreFocusOut: false,
                onScanComplete: undefined,
                show: jest.fn(),
                hide: jest.fn(() => hideHandlers.forEach(hideHandler => hideHandler())),
                dispose: jest.fn(),
                onDidAccept: jest.fn((handler: () => void) => acceptHandlers.push(handler)),
                onDidHide: jest.fn((handler: () => void) => hideHandlers.push(handler)),
                acceptItem: (item: any) => {
                    fakeQuickPick.selectedItems = item ? [item] : [];
                    acceptHandlers.forEach(acceptHandler => acceptHandler());
                }
            };

            let itemsValue: any[] = [];
            Object.defineProperty(fakeQuickPick, 'items', {
                get: () => itemsValue,
                set: (updatedItems: any[]) => {
                    itemsValue = updatedItems;
                    fakeQuickPick.itemsAssignmentCount++;
                },
                configurable: true
            });

            Object.defineProperty(fakeQuickPick, 'busy', {
                get: () => busyValue,
                set: (updatedBusyValue: boolean) => {
                    busyValue = updatedBusyValue;
                    if ( updatedBusyValue === false ) {
                        fakeQuickPick.onScanComplete?.();
                    }
                },
                configurable: true
            });

            (vscode.window.createQuickPick as jest.Mock).mockReturnValue(fakeQuickPick);

            return fakeQuickPick;

        };

        const mockWithProgress = (isCancellationRequested: boolean = false) => {

            const reportedMessages: string[] = [];

            (vscode.window.withProgress as jest.Mock).mockImplementation(
                async (_progressOptions: any, runTask: any) => await runTask(
                    { report: ({ message }: { message: string }) => reportedMessages.push(message) },
                    { isCancellationRequested }
                )
            );

            return reportedMessages;

        };

        test('given no sfdx-project.json, scans the workspace root and returns undefined when the picker is dismissed', async () => {

            const fakeWorkspaceRoot = '/fake/workspace';
            const fakeQuickPick = buildFakeQuickPick();
            mockWithProgress();

            jest.spyOn(SfdxProjectService, 'resolvePackageDirectoryPaths').mockReturnValue({ packageDirectoryPaths: [] });
            const collectSpy = jest.spyOn(VSCodeWorkspaceService, 'collectObjectDirectoryQuickPickItems').mockResolvedValue([]);

            fakeQuickPick.onScanComplete = () => fakeQuickPick.hide();

            const result = await VSCodeWorkspaceService.promptForObjectsPath(fakeWorkspaceRoot);

            expect(collectSpy).toHaveBeenCalledWith([fakeWorkspaceRoot], fakeWorkspaceRoot, expect.any(Function), expect.any(Object));
            expect(result).toBeUndefined();

        });

        test('opens the picker before the scan begins, marks it busy, and clears busy when the scan completes', async () => {

            const fakeWorkspaceRoot = '/fake/workspace';
            const fakeQuickPick = buildFakeQuickPick();

            jest.spyOn(SfdxProjectService, 'resolvePackageDirectoryPaths').mockReturnValue({ packageDirectoryPaths: [] });

            let wasShownBeforeScan = false;
            let wasBusyDuringScan = false;
            (vscode.window.withProgress as jest.Mock).mockImplementation(async (_progressOptions: any, runTask: any) => {
                wasShownBeforeScan = (fakeQuickPick.show as jest.Mock).mock.calls.length > 0;
                wasBusyDuringScan = fakeQuickPick.busy;
                return await runTask({ report: jest.fn() }, { isCancellationRequested: false });
            });

            jest.spyOn(VSCodeWorkspaceService, 'collectObjectDirectoryQuickPickItems').mockResolvedValue([]);

            fakeQuickPick.onScanComplete = () => fakeQuickPick.hide();

            await VSCodeWorkspaceService.promptForObjectsPath(fakeWorkspaceRoot);

            expect(wasShownBeforeScan).toBe(true);
            expect(wasBusyDuringScan).toBe(true);
            expect(fakeQuickPick.busy).toBe(false);
            expect(fakeQuickPick.ignoreFocusOut).toBe(true);

        });

        test('makes every discovered directory available in the picker without waiting on the user', async () => {

            const fakeWorkspaceRoot = '/fake/workspace';
            const fakeQuickPick = buildFakeQuickPick();
            mockWithProgress();

            jest.spyOn(SfdxProjectService, 'resolvePackageDirectoryPaths').mockReturnValue({ packageDirectoryPaths: [] });

            jest.spyOn(VSCodeWorkspaceService, 'collectObjectDirectoryQuickPickItems').mockImplementation(
                async (_scanRootPaths, _workspaceRoot, onItemDiscovered) => {
                    onItemDiscovered?.({ label: './force-app/' });
                    onItemDiscovered?.({ label: './force-app/main/' });
                    return [];
                }
            );

            fakeQuickPick.onScanComplete = () => fakeQuickPick.hide();

            await VSCodeWorkspaceService.promptForObjectsPath(fakeWorkspaceRoot);

            expect(fakeQuickPick.items.map((item: any) => item.label)).toEqual(['./force-app/', './force-app/main/']);

        });

        test('returns the accepted item label', async () => {

            const fakeWorkspaceRoot = '/fake/workspace';
            const fakeQuickPick = buildFakeQuickPick();
            mockWithProgress();

            jest.spyOn(SfdxProjectService, 'resolvePackageDirectoryPaths').mockReturnValue({ packageDirectoryPaths: [] });
            jest.spyOn(VSCodeWorkspaceService, 'collectObjectDirectoryQuickPickItems').mockImplementation(
                async (_scanRootPaths, _workspaceRoot, onItemDiscovered) => {
                    onItemDiscovered?.({ label: './force-app/main/default/objects/' });
                    return [];
                }
            );

            fakeQuickPick.onScanComplete = () => fakeQuickPick.acceptItem(fakeQuickPick.items[0]);

            const result = await VSCodeWorkspaceService.promptForObjectsPath(fakeWorkspaceRoot);

            expect(result).toBe('./force-app/main/default/objects/');
            expect(fakeQuickPick.dispose).toHaveBeenCalled();

        });

        test('given a cancelled scan, hides the picker and returns undefined', async () => {

            const fakeWorkspaceRoot = '/fake/workspace';
            const fakeQuickPick = buildFakeQuickPick();
            mockWithProgress(true);

            jest.spyOn(SfdxProjectService, 'resolvePackageDirectoryPaths').mockReturnValue({ packageDirectoryPaths: [] });
            jest.spyOn(VSCodeWorkspaceService, 'collectObjectDirectoryQuickPickItems').mockResolvedValue([]);

            const result = await VSCodeWorkspaceService.promptForObjectsPath(fakeWorkspaceRoot);

            expect(result).toBeUndefined();
            expect(fakeQuickPick.hide).toHaveBeenCalled();
            expect(fakeQuickPick.dispose).toHaveBeenCalled();

        });

        test('given usable packageDirectories, seeds the scan from them and says so in the placeholder', async () => {

            const fakeWorkspaceRoot = '/fake/workspace';
            const fakeQuickPick = buildFakeQuickPick();
            mockWithProgress();

            jest.spyOn(SfdxProjectService, 'resolvePackageDirectoryPaths').mockReturnValue({
                packageDirectoryPaths: ['/fake/workspace/force-app', '/fake/workspace/utilities']
            });
            const collectSpy = jest.spyOn(VSCodeWorkspaceService, 'collectObjectDirectoryQuickPickItems').mockResolvedValue([]);

            fakeQuickPick.onScanComplete = () => fakeQuickPick.hide();

            await VSCodeWorkspaceService.promptForObjectsPath(fakeWorkspaceRoot);

            expect(collectSpy).toHaveBeenCalledWith(
                ['/fake/workspace/force-app', '/fake/workspace/utilities'],
                fakeWorkspaceRoot,
                expect.any(Function),
                expect.any(Object)
            );
            expect(fakeQuickPick.placeholder).toContain('packageDirectories in sfdx-project.json');

        });

        test('given usable packageDirectories, offers a browse-all item that re-scans the whole workspace', async () => {

            const fakeWorkspaceRoot = '/fake/workspace';
            const fakeQuickPick = buildFakeQuickPick();
            mockWithProgress();

            jest.spyOn(SfdxProjectService, 'resolvePackageDirectoryPaths').mockReturnValue({
                packageDirectoryPaths: ['/fake/workspace/force-app']
            });
            const collectSpy = jest.spyOn(VSCodeWorkspaceService, 'collectObjectDirectoryQuickPickItems').mockResolvedValue([]);

            let scanCompleteCount = 0;
            let seededPickerItems: any[] = [];
            fakeQuickPick.onScanComplete = () => {
                scanCompleteCount++;
                if ( scanCompleteCount === 1 ) {
                    // CAPTURED HERE BECAUSE THE SECOND PICKER REPLACES items WITH ITS OWN
                    seededPickerItems = [...fakeQuickPick.items];
                    fakeQuickPick.acceptItem(fakeQuickPick.items[0]);
                } else {
                    fakeQuickPick.hide();
                }
            };

            const result = await VSCodeWorkspaceService.promptForObjectsPath(fakeWorkspaceRoot);

            expect(seededPickerItems[0].label).toBe(VSCodeWorkspaceService.browseAllWorkspaceDirectoriesLabel);
            expect(collectSpy).toHaveBeenNthCalledWith(1, ['/fake/workspace/force-app'], fakeWorkspaceRoot, expect.any(Function), expect.any(Object));
            expect(collectSpy).toHaveBeenNthCalledWith(2, [fakeWorkspaceRoot], fakeWorkspaceRoot, expect.any(Function), expect.any(Object));
            expect(result).toBeUndefined();

        });

        test('given no packageDirectories seeding, offers no browse-all item', async () => {

            const fakeWorkspaceRoot = '/fake/workspace';
            const fakeQuickPick = buildFakeQuickPick();
            mockWithProgress();

            jest.spyOn(SfdxProjectService, 'resolvePackageDirectoryPaths').mockReturnValue({ packageDirectoryPaths: [] });
            jest.spyOn(VSCodeWorkspaceService, 'collectObjectDirectoryQuickPickItems').mockResolvedValue([]);

            fakeQuickPick.onScanComplete = () => fakeQuickPick.hide();

            await VSCodeWorkspaceService.promptForObjectsPath(fakeWorkspaceRoot);

            expect(fakeQuickPick.items).toEqual([]);
            expect(fakeQuickPick.placeholder).toBe('Select directory that contains the Salesforce objects');

        });

        test('reports each discovered directory through the progress port', async () => {

            const fakeWorkspaceRoot = '/fake/workspace';
            const fakeQuickPick = buildFakeQuickPick();
            const reportedMessages = mockWithProgress();

            jest.spyOn(SfdxProjectService, 'resolvePackageDirectoryPaths').mockReturnValue({ packageDirectoryPaths: [] });

            const objectsDirent = Object.assign(new fs.Dirent(), { name: 'objects', isDirectory: () => true });
            jest.spyOn(fs.promises, 'readdir')
                .mockResolvedValueOnce([objectsDirent] as unknown as fs.Dirent[])
                .mockResolvedValueOnce([] as unknown as fs.Dirent[]);
            jest.spyOn(vscode, "ThemeIcon").mockReturnValue(new vscode.ThemeIcon('folder'));

            fakeQuickPick.onScanComplete = () => fakeQuickPick.hide();

            await VSCodeWorkspaceService.promptForObjectsPath(fakeWorkspaceRoot);

            expect(reportedMessages[0]).toBe('Scanning workspace directories...');
            expect(reportedMessages).toContain('Found 1 directories - ./objects/');
            expect(fakeQuickPick.items.map((item: any) => item.label)).toEqual(['./objects/']);

        });

        /*
            The defect this replaced: the selection was awaited only AFTER the scan, so accepting an
            item early closed the picker and then blocked on the rest of the walk. Every other
            accept test here fires from onScanComplete, so none of them could ever have caught it.
        */
        test('given an accept part way through, returns without waiting for the scan to finish', async () => {

            const fakeWorkspaceRoot = '/fake/workspace';
            const fakeQuickPick = buildFakeQuickPick();
            mockWithProgress();

            jest.spyOn(SfdxProjectService, 'resolvePackageDirectoryPaths').mockReturnValue({ packageDirectoryPaths: [] });

            let scanRanToCompletion = false;
            jest.spyOn(VSCodeWorkspaceService, 'collectObjectDirectoryQuickPickItems').mockImplementation(
                async (_scanRootPaths, _workspaceRoot, onItemDiscovered) => {
                    const earlyItem = { label: './force-app/main/default/objects/' };
                    onItemDiscovered?.(earlyItem);
                    fakeQuickPick.acceptItem(earlyItem);
                    await new Promise(resolveAfterRemainingWalk => setTimeout(resolveAfterRemainingWalk, 60));
                    scanRanToCompletion = true;
                    return [];
                }
            );

            const result = await VSCodeWorkspaceService.promptForObjectsPath(fakeWorkspaceRoot);

            expect(result).toBe('./force-app/main/default/objects/');
            expect(scanRanToCompletion).toBe(false);

        });

        test('given an accept part way through, tells the walk to stop', async () => {

            const fakeWorkspaceRoot = '/fake/workspace';
            const fakeQuickPick = buildFakeQuickPick();
            mockWithProgress();

            jest.spyOn(SfdxProjectService, 'resolvePackageDirectoryPaths').mockReturnValue({ packageDirectoryPaths: [] });

            let cancellationAfterAccept: boolean | undefined;
            jest.spyOn(VSCodeWorkspaceService, 'collectObjectDirectoryQuickPickItems').mockImplementation(
                async (_scanRootPaths, _workspaceRoot, onItemDiscovered, directoryScanProgress) => {
                    const earlyItem = { label: './objects/' };
                    onItemDiscovered?.(earlyItem);
                    fakeQuickPick.acceptItem(earlyItem);
                    cancellationAfterAccept = directoryScanProgress?.isCancellationRequested();
                    return [];
                }
            );

            await VSCodeWorkspaceService.promptForObjectsPath(fakeWorkspaceRoot);

            expect(cancellationAfterAccept).toBe(true);

        });

        /*
            A cancel arriving after the user already chose must not throw their choice away -- the
            earlier shape returned undefined here and wrote no configuration file at all.
        */
        test('given a scan cancellation after an accept, still returns the accepted label', async () => {

            const fakeWorkspaceRoot = '/fake/workspace';
            const fakeQuickPick = buildFakeQuickPick();
            mockWithProgress(true);

            jest.spyOn(SfdxProjectService, 'resolvePackageDirectoryPaths').mockReturnValue({ packageDirectoryPaths: [] });
            jest.spyOn(VSCodeWorkspaceService, 'collectObjectDirectoryQuickPickItems').mockImplementation(
                async (_scanRootPaths, _workspaceRoot, onItemDiscovered) => {
                    const earlyItem = { label: './objects/' };
                    onItemDiscovered?.(earlyItem);
                    fakeQuickPick.acceptItem(earlyItem);
                    return [];
                }
            );

            const result = await VSCodeWorkspaceService.promptForObjectsPath(fakeWorkspaceRoot);

            expect(result).toBe('./objects/');

        });

        test('batches item assignments rather than one round trip per discovered directory', async () => {

            const fakeWorkspaceRoot = '/fake/workspace';
            const fakeQuickPick = buildFakeQuickPick();
            mockWithProgress();

            jest.spyOn(SfdxProjectService, 'resolvePackageDirectoryPaths').mockReturnValue({ packageDirectoryPaths: [] });

            const discoveredDirectoryCount = 1000;
            jest.spyOn(VSCodeWorkspaceService, 'collectObjectDirectoryQuickPickItems').mockImplementation(
                async (_scanRootPaths, _workspaceRoot, onItemDiscovered) => {
                    for ( let directoryIndex = 0; directoryIndex < discoveredDirectoryCount; directoryIndex++ ) {
                        onItemDiscovered?.({ label: `./directory-${directoryIndex}/` });
                    }
                    return [];
                }
            );

            fakeQuickPick.onScanComplete = () => fakeQuickPick.hide();

            await VSCodeWorkspaceService.promptForObjectsPath(fakeWorkspaceRoot);

            expect(fakeQuickPick.items).toHaveLength(discoveredDirectoryCount);
            // ONE PER ITEM WOULD BE 1000+; THE BATCH BOUND IS discoveredDirectoryCount / 200 PLUS THE INITIAL AND FINAL FLUSHES
            expect(fakeQuickPick.itemsAssignmentCount).toBeLessThanOrEqual(10);

        });

        test('restores the highlighted item across a batch flush so the selection does not snap away', async () => {

            const fakeWorkspaceRoot = '/fake/workspace';
            const fakeQuickPick = buildFakeQuickPick();
            mockWithProgress();

            jest.spyOn(SfdxProjectService, 'resolvePackageDirectoryPaths').mockReturnValue({ packageDirectoryPaths: [] });

            const highlightedItem = { label: './the-one-the-user-is-on/' };
            jest.spyOn(VSCodeWorkspaceService, 'collectObjectDirectoryQuickPickItems').mockImplementation(
                async (_scanRootPaths, _workspaceRoot, onItemDiscovered) => {
                    onItemDiscovered?.(highlightedItem);
                    fakeQuickPick.activeItems = [highlightedItem];
                    for ( let directoryIndex = 0; directoryIndex < 250; directoryIndex++ ) {
                        onItemDiscovered?.({ label: `./later-${directoryIndex}/` });
                    }
                    return [];
                }
            );

            fakeQuickPick.onScanComplete = () => fakeQuickPick.hide();

            await VSCodeWorkspaceService.promptForObjectsPath(fakeWorkspaceRoot);

            expect(fakeQuickPick.activeItems).toEqual([highlightedItem]);

        });

        test('given a scan that rejects, disposes the picker rather than leaving it busy on screen', async () => {

            const fakeWorkspaceRoot = '/fake/workspace';
            const fakeQuickPick = buildFakeQuickPick();
            mockWithProgress();

            jest.spyOn(SfdxProjectService, 'resolvePackageDirectoryPaths').mockReturnValue({ packageDirectoryPaths: [] });
            jest.spyOn(VSCodeWorkspaceService, 'collectObjectDirectoryQuickPickItems').mockRejectedValue(new Error('EACCES'));

            await expect(VSCodeWorkspaceService.promptForObjectsPath(fakeWorkspaceRoot)).rejects.toThrow('EACCES');
            expect(fakeQuickPick.dispose).toHaveBeenCalled();

        });

        test('runs the scan under a cancellable notification progress', async () => {

            const fakeWorkspaceRoot = '/fake/workspace';
            const fakeQuickPick = buildFakeQuickPick();
            mockWithProgress();

            jest.spyOn(SfdxProjectService, 'resolvePackageDirectoryPaths').mockReturnValue({ packageDirectoryPaths: [] });
            jest.spyOn(VSCodeWorkspaceService, 'collectObjectDirectoryQuickPickItems').mockResolvedValue([]);

            fakeQuickPick.onScanComplete = () => fakeQuickPick.hide();

            await VSCodeWorkspaceService.promptForObjectsPath(fakeWorkspaceRoot);

            expect(vscode.window.withProgress).toHaveBeenCalledWith(
                expect.objectContaining({
                    location: vscode.ProgressLocation.Notification,
                    cancellable: true
                }),
                expect.any(Function)
            );

        });

    });

    describe('resolveObjectsDirectoryScanRoots', () => {

        test('given an unreadable sfdx-project.json, warns and falls back to the workspace root', () => {

            const fakeWorkspaceRoot = '/fake/workspace';
            const warnSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);

            jest.spyOn(SfdxProjectService, 'resolvePackageDirectoryPaths').mockReturnValue({
                packageDirectoryPaths: [],
                unreadableProjectFileMessage: 'Could not parse "/fake/workspace/sfdx-project.json" as JSON: bad.'
            });

            const scanRoots = VSCodeWorkspaceService.resolveObjectsDirectoryScanRoots(fakeWorkspaceRoot);

            expect(scanRoots).toEqual({ scanRootPaths: [fakeWorkspaceRoot], isSeededFromSfdxProject: false });
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Could not parse'));

        });

        test('given usable packageDirectories, seeds from every one of them', () => {

            jest.spyOn(SfdxProjectService, 'resolvePackageDirectoryPaths').mockReturnValue({
                packageDirectoryPaths: ['/fake/workspace/force-app', '/fake/workspace/utilities']
            });

            const scanRoots = VSCodeWorkspaceService.resolveObjectsDirectoryScanRoots('/fake/workspace');

            expect(scanRoots).toEqual({
                scanRootPaths: ['/fake/workspace/force-app', '/fake/workspace/utilities'],
                isSeededFromSfdxProject: true
            });

        });

    });

    describe('getDirectoryQuickPickItemsByStartingDirectoryPath cancellation', () => {

        test('given cancellation already requested, does not read the directory at all', async () => {

            const readdirSpy = jest.spyOn(fs.promises, 'readdir');

            const collectedItems = await VSCodeWorkspaceService.getDirectoryQuickPickItemsByStartingDirectoryPath(
                '/mockWorkspace/force-app',
                [],
                undefined,
                { report: jest.fn(), isCancellationRequested: () => true },
                '/mockWorkspace'
            );

            expect(collectedItems).toEqual([]);
            expect(readdirSpy).not.toHaveBeenCalled();

        });

        test('given cancellation requested part way through, stops before the remaining entries', async () => {

            const firstDirent = Object.assign(new fs.Dirent(), { name: 'first', isDirectory: () => true });
            const secondDirent = Object.assign(new fs.Dirent(), { name: 'second', isDirectory: () => true });

            jest.spyOn(fs.promises, 'readdir').mockResolvedValue([firstDirent, secondDirent] as unknown as fs.Dirent[]);
            jest.spyOn(vscode, "ThemeIcon").mockReturnValue(new vscode.ThemeIcon('folder'));

            // CANCELLED THE MOMENT THE FIRST ENTRY HAS BEEN REPORTED
            let cancellationRequested = false;
            const cancelAfterFirstReport = {
                report: () => { cancellationRequested = true; },
                isCancellationRequested: () => cancellationRequested
            };

            const collectedItems = await VSCodeWorkspaceService.getDirectoryQuickPickItemsByStartingDirectoryPath(
                '/mockWorkspace/force-app',
                [],
                undefined,
                cancelAfterFirstReport,
                '/mockWorkspace'
            );

            expect(collectedItems.map(item => item.label)).toEqual(['./force-app/first/']);

        });

    });

    describe('collectObjectDirectoryQuickPickItems', () => {

        test('offers each non-root scan root itself alongside the directories beneath it', async () => {

            const mockWorkspaceRoot = '/mockWorkspace';
            const packageDirectoryPath = `${mockWorkspaceRoot}/force-app`;

            const objectsDirent = Object.assign(new fs.Dirent(), { name: 'objects', isDirectory: () => true });

            jest.spyOn(fs.promises, 'readdir')
                .mockResolvedValueOnce([objectsDirent] as unknown as fs.Dirent[])
                .mockResolvedValueOnce([] as unknown as fs.Dirent[]);
            jest.spyOn(vscode, "ThemeIcon").mockReturnValue(new vscode.ThemeIcon('folder'));

            const collectedItems = await VSCodeWorkspaceService.collectObjectDirectoryQuickPickItems(
                [packageDirectoryPath],
                mockWorkspaceRoot
            );

            expect(collectedItems.map(item => item.label)).toEqual(['./force-app/', './force-app/objects/']);

        });

        test('does not offer the workspace root itself as a selectable directory', async () => {

            const mockWorkspaceRoot = '/mockWorkspace';

            jest.spyOn(fs.promises, 'readdir').mockResolvedValue([] as unknown as fs.Dirent[]);

            const collectedItems = await VSCodeWorkspaceService.collectObjectDirectoryQuickPickItems(
                [mockWorkspaceRoot],
                mockWorkspaceRoot
            );

            expect(collectedItems).toEqual([]);

        });

        test('stops before scanning a further root once cancellation is requested', async () => {

            const mockWorkspaceRoot = '/mockWorkspace';
            const readdirSpy = jest.spyOn(fs.promises, 'readdir').mockResolvedValue([] as unknown as fs.Dirent[]);

            const cancelledScanProgress = {
                report: jest.fn(),
                isCancellationRequested: () => true
            };

            const collectedItems = await VSCodeWorkspaceService.collectObjectDirectoryQuickPickItems(
                [`${mockWorkspaceRoot}/force-app`, `${mockWorkspaceRoot}/utilities`],
                mockWorkspaceRoot,
                undefined,
                cancelledScanProgress
            );

            expect(collectedItems).toEqual([]);
            expect(readdirSpy).not.toHaveBeenCalled();

        });

    });

    describe('promptForFakerServiceImplementation', () => {

        test('should call vscode.window.showQuickPick with correct parameters', async () => {

            const showQuickPickSpy = jest.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(undefined);

            await VSCodeWorkspaceService.promptForFakerServiceImplementation();

            expect(showQuickPickSpy).toHaveBeenCalledWith(
                [
                    {
                        label: 'snowfakery',
                        description: 'CumulusCI Python port of Faker - https://snowfakery.readthedocs.io/en/latest/',
                        iconPath: expect.any(Object)
                    },
                    {
                        label: 'faker-js',
                        description: 'Javascript port of Faker - https://fakerjs.dev/',
                        iconPath: expect.any(Object)
                    }
                ],
                {
                    placeHolder: 'Select Data Faker Service',
                    ignoreFocusOut: true
                }
            );
        });
        
    });

    describe('getDirectoryQuickPickItemsByStartingDirectoryPath', () => {
        let mockItems;

        beforeEach(() => {
            jest.restoreAllMocks();
            mockItems = [];
        });

        test('should traverse directories and add items to the list', async () => {
            const mockDirPath = '/mockDir';
            const mockWorkspaceRoot = '/mockWorkspace';
        
            const mockDirents = Promise.resolve([
                Object.assign(new fs.Dirent(), { name: 'file1.txt', isFile: () => true }),
                Object.assign(new fs.Dirent(), { name: 'folder1', isDirectory: () => false }),
                Object.assign(new fs.Dirent(), { name: 'symlink1', isSymbolicLink: () => true })
            ]);
            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue(mockWorkspaceRoot);
            jest.spyOn(fs.promises, 'readdir').mockReturnValue(mockDirents);

            const result = await VSCodeWorkspaceService.getPotentialTreecipeObjectDirectoryPathsQuickPickItems(mockDirPath);

            // TEST IS SETUP TO AVOID RECURSIVE
            expect(result.length).toEqual(0);

        });

        test('given a directory entry, builds a relative-path label from the traversed directoryPath rather than the deprecated Dirent.path', async () => {

            const mockWorkspaceRoot = '/mockWorkspace';
            const startingDirectoryPath = `${mockWorkspaceRoot}/force-app/main/default`;

            // Dirent intentionally has no path/parentPath to mirror the DEP0178 runtime where
            // fs.Dirent.path is undefined; the label must still resolve from directoryPath
            const objectsDirent = Object.assign(new fs.Dirent(), {
                name: 'objects',
                isDirectory: () => true
            });

            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue(mockWorkspaceRoot);
            jest.spyOn(fs.promises, 'readdir')
                .mockResolvedValueOnce([objectsDirent] as unknown as fs.Dirent[])
                .mockResolvedValueOnce([] as unknown as fs.Dirent[]);
            const mockIcon = new vscode.ThemeIcon('folder');
            jest.spyOn(vscode, "ThemeIcon").mockReturnValue(mockIcon);

            const result = await VSCodeWorkspaceService.getPotentialTreecipeObjectDirectoryPathsQuickPickItems(startingDirectoryPath);

            expect(result.length).toEqual(1);
            expect(result[0].label).toBe('./force-app/main/default/objects/');
            expect(result[0].label).not.toContain('undefined');
            expect(result[0].detail).toBe(`${startingDirectoryPath}/objects`);

        });

    });

    describe('isPossibleTreecipeUsableDirectory', () => {

        test('given expected invalid directory name returns false', () => {

            const mockDirent: fs.Dirent = {
                name: '.git',
                isBlockDevice: () => false,
                isCharacterDevice: () => false,
                isDirectory: () => true,
                isFIFO: () => false,
                isFile: () => false,
                isSocket: () => false,
                isSymbolicLink: () => false,
                parentPath: '/',
                path: '.git'
            };
            
            const isPossibleTreecipeDirectory = VSCodeWorkspaceService.isPossibleTreecipeUsableDirectory(mockDirent);
            
            expect(isPossibleTreecipeDirectory).toBeFalsy();

        });

        test('given expected valid directory name returns true', () => {

            const mockDirent: fs.Dirent = {
                name: 'objects',
                isBlockDevice: () => false,
                isCharacterDevice: () => false,
                isDirectory: () => true,
                isFIFO: () => false,
                isFile: () => false,
                isSocket: () => false,
                isSymbolicLink: () => false,
                parentPath: 'force-app/main/default/',
                path: 'force-app/main/default/objects'
            };
            
            const isPossibleTreecipeDirectory = VSCodeWorkspaceService.isPossibleTreecipeUsableDirectory(mockDirent);
            expect(isPossibleTreecipeDirectory).toBeTruthy();

        });

        test('given expected file Dirent returns invalid treecipe directory', () => {

            const mockDirent: fs.Dirent = {
                name: 'validfoldername',
                isBlockDevice: () => false,
                isCharacterDevice: () => false,
                isDirectory: () => false,
                isFIFO: () => false,
                isFile: () => false,
                isSocket: () => false,
                isSymbolicLink: () => false,
                parentPath: 'force-app/main/default/',
                path: 'force-app/main/default/validfoldername'
            };
            
            const isPossibleTreecipeDirectory = VSCodeWorkspaceService.isPossibleTreecipeUsableDirectory(mockDirent);
            expect(isPossibleTreecipeDirectory).toBeFalsy();

        });

    });

    describe('promptForDirectoryToGenerateQuickItemsForFileSelection', () => {

        test('should return undefined if no showQuickPick selection is mocked to undefined', async () => {
            
            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue('/mock/workspace');
            jest.spyOn(ConfigurationService, 'getGeneratedRecipesFolderPath').mockReturnValue('generated-recipes');
            jest.spyOn(VSCodeWorkspaceService, 'getAvailableRecipeFileQuickPickItemsByDirectory').mockResolvedValue([]);
            jest.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(undefined);

            const fakeDirectoryPath = 'treecipe/';
            const fakeQuickPickItemLabel = 'Select the thing';
            const result = await VSCodeWorkspaceService.promptForDirectoryToGenerateQuickItemsForFileSelection(fakeDirectoryPath, fakeQuickPickItemLabel);
            expect(result).toBeUndefined();

        });

        test('should return the expected mock selected recipe file passed into mocked showQuickPick', async () => {

            const expectedMockQuickPickItem = { label: 'recipe1.json', description: 'File', iconPath: expect.any(Object), detail: '/mock/workspace/generated-recipes/recipe1.json' };
            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue('/mock/workspace');
            jest.spyOn(ConfigurationService, 'getGeneratedRecipesFolderPath').mockReturnValue('generated-recipes');
            jest.spyOn(VSCodeWorkspaceService, 'getAvailableRecipeFileQuickPickItemsByDirectory').mockResolvedValue([]);
            jest.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(expectedMockQuickPickItem);

            const fakeDirectoryPath = 'treecipe/';
            const fakeQuickPickItemLabel = 'Select the thing';
            const actualQuickPickSelectedRecipeFileToProcess = await VSCodeWorkspaceService.promptForDirectoryToGenerateQuickItemsForFileSelection(fakeDirectoryPath, fakeQuickPickItemLabel);
            expect(actualQuickPickSelectedRecipeFileToProcess).toEqual(expectedMockQuickPickItem);

        });

        afterEach(() => {        
            jest.restoreAllMocks();
        });

    });

    describe('getAvailableRecipeFileQuickPickItemsByDirectory', () => {
       
        const mockedDirents = [
            // Top-level files
            MockDirectoryService.createMockedDirent('recipe1.yaml', '/parent-path-mock/GeneratedRecipes', 'file'),
            MockDirectoryService.createMockedDirent('recipe2.yaml', '/parent-path-mock/GeneratedRecipes', 'file'),
          
            // First Top-level fakerjs directory
            MockDirectoryService.createMockedDirent('recipe-fakerjs-datetimestuff', '/parent-path-mock/GeneratedRecipes', 'dir'),
          
            // Nested files in First Top-Level expected fakerjs folder
            MockDirectoryService.createMockedDirent('recipe-fakerjs-test.yaml', '/parent-path-mock/GeneratedRecipes/recipe-fakerjs-datetimestuff', 'file'),
            MockDirectoryService.createMockedDirent('recipe-fakerjs-nested-recipe.yaml', '/parent-path-mock/GeneratedRecipes/recipe-fakerjs-datetimestuff', 'file'),
            MockDirectoryService.createMockedDirent('nested-recipe.yaml', '/parent-path-mock/GeneratedRecipes/recipe-fakerjs-datetimestuff', 'file'),
          
            //  nested folder that doesn't match faker-js indicator and would match for snowfakery
            MockDirectoryService.createMockedDirent('recipe-snowfakery-timestampfolder', '/parent-path-mock/GeneratedRecipes', 'dir'),
          
            // Nested files for snowfakery 
            MockDirectoryService.createMockedDirent('recipe-fakerjs-shouldntmatchsecond-test.yaml', '/parent-path-mock/GeneratedRecipes/rrecipe-snowfakery-timestampfolder', 'file'),
            MockDirectoryService.createMockedDirent('recipe-snowmatch-1.yaml', '/parent-path-mock/GeneratedRecipes/recipe-snowfakery-timestampfolder', 'file'),
            MockDirectoryService.createMockedDirent('recipe-snowmatch-2.yaml', '/parent-path-mock/GeneratedRecipes/recipe-snowfakery-timestampfolder', 'file'),
            MockDirectoryService.createMockedDirent('recipe-snowfakery-3.yaml', '/parent-path-mock/GeneratedRecipes/recipe-snowfakery-timestampfolder', 'file'),

            // Second Top-level fakerjs directory
            MockDirectoryService.createMockedDirent('recipe-fakerjs-second', '/parent-path-mock/GeneratedRecipes', 'dir'),
    
            // Nested files in Second Top-Level expected fakerjs folder
            MockDirectoryService.createMockedDirent('recipe-fakerjs-second-test.yaml', '/parent-path-mock/GeneratedRecipes/recipe-fakerjs-second', 'file'),
            MockDirectoryService.createMockedDirent('recipe-fakerjs-second-nested-recipe.yaml', '/parent-path-mock/GeneratedRecipes/recipe-fakerjs-second', 'file'),
            MockDirectoryService.createMockedDirent('nested-no-matchrecipe.yaml', '/parent-path-mock/GeneratedRecipes/recipe-fakerjs-second', 'file')
    
        ];

        test('should return an empty array if no files are found', async () => {

            const expectedEmptyQuickPickItems = [];
            jest.spyOn(fs.promises, 'readdir').mockResolvedValue(expectedEmptyQuickPickItems);
            // this mock below doesn't drive behavior but the test will fail as the getExtensionConfigValue tries to pull value from users local settings which do not exist as part of stand alone unit tests
            jest.spyOn(ConfigurationService, 'getExtensionConfigValue').mockReturnValue('snowfakery');
            
            let emptyQuickPickItems: vscode.QuickPickItem[] = [];
            const actualQuickPickItems = await VSCodeWorkspaceService.getAvailableRecipeFileQuickPickItemsByDirectory(emptyQuickPickItems, '/mock/generated-recipes');
            expect(actualQuickPickItems).toEqual(emptyQuickPickItems);

        });

        test('should return an array of QuickPickItems for each file found', async () => {
            
            const mockDirents = [
                Object.assign(new fs.Dirent(), { 
                    name: 'recipe1.yaml', 
                    isFile: () => true, 
                    path: '/mock/generated-recipes'
                }),
                Object.assign(new fs.Dirent(), { 
                    name: 'recipe2.yaml', 
                    isFile: () => true, 
                    path: '/mock/generated-recipes'
                }),
            ];

            jest.spyOn(fs.promises, 'readdir').mockResolvedValue(mockDirents);
            // this mock below doesn't drive behavior but the test will fail as the getExtensionConfigValue tries to pull value from users local settings which do not exist as part of stand alone unit tests
            jest.spyOn(ConfigurationService, 'getExtensionConfigValue').mockReturnValue('snowfakery');
            
            const expectedQuickPickItems:vscode.QuickPickItem[] = [
                {
                    label: 'recipe1.yaml',
                    description: 'File',
                    iconPath:  new vscode.ThemeIcon('file'),
                    detail: '/mock/generated-recipes/recipe1.yaml'
                },
                {
                    label: 'recipe2.yaml',
                    description: 'File',
                    iconPath:  new vscode.ThemeIcon('file'),
                    detail: '/mock/generated-recipes/recipe2.yaml'
                }
            ];   

            let emptyQuickPickItems: vscode.QuickPickItem[] = [];
            const actualQuickPickItems = await VSCodeWorkspaceService.getAvailableRecipeFileQuickPickItemsByDirectory(emptyQuickPickItems, '/mock/generated-recipes');

            console.log('Actual Keys:', Object.keys(actualQuickPickItems));
            console.log('Expected Keys:', Object.keys(expectedQuickPickItems));

            expect(actualQuickPickItems).toEqual(expectedQuickPickItems);

        });

        test('given file Dirents whose deprecated path property is undefined, builds detail from folderPathToParse without throwing', async () => {

            const folderPathToParse = '/mock/generated-recipes';

            // path/parentPath intentionally omitted to mirror the DEP0178 runtime where
            // fs.Dirent.path is undefined; path.join(undefined, name) would otherwise throw
            const mockDirents = [
                Object.assign(new fs.Dirent(), {
                    name: 'recipe1.yaml',
                    isFile: () => true
                }),
            ];

            jest.spyOn(fs.promises, 'readdir').mockResolvedValue(mockDirents);
            jest.spyOn(ConfigurationService, 'getExtensionConfigValue').mockReturnValue('snowfakery');

            let emptyQuickPickItems: vscode.QuickPickItem[] = [];
            const actualQuickPickItems = await VSCodeWorkspaceService.getAvailableRecipeFileQuickPickItemsByDirectory(emptyQuickPickItems, folderPathToParse);

            expect(actualQuickPickItems).toHaveLength(1);
            expect(actualQuickPickItems[0].detail).toBe('/mock/generated-recipes/recipe1.yaml');
            expect(actualQuickPickItems[0].detail).not.toContain('undefined');

        });


        test('given faker-js as selected faker service and directories with both fakerjs recipes and snowfakery, should return expected QuickPickItems for each file found', async () => {
                          
            const readdirMockFunctionImplementation = MockDirectoryService.getReaddirMockImplBySetOfMockedDirents(mockedDirents);

            jest.spyOn(fs.promises, 'readdir').mockImplementation(readdirMockFunctionImplementation);

            // this mock below doesn't drive behavior but the test will fail as the getExtensionConfigValue tries to pull value from users local settings which do not exist as part of stand alone unit tests
            jest.spyOn(ConfigurationService, 'getExtensionConfigValue').mockReturnValue('faker-js');
            
            const expectedFakerJSOnlyQuickPickItems:vscode.QuickPickItem[] = [
                {
                    label: 'recipe-fakerjs-test.yaml',
                    description: 'File',
                    iconPath:  new vscode.ThemeIcon('file'),
                    detail: '/parent-path-mock/GeneratedRecipes/recipe-fakerjs-datetimestuff/recipe-fakerjs-test.yaml'
                },
                {
                    label: 'recipe-fakerjs-nested-recipe.yaml',
                    description: 'File',
                    iconPath:  new vscode.ThemeIcon('file'),
                    detail: '/parent-path-mock/GeneratedRecipes/recipe-fakerjs-datetimestuff/recipe-fakerjs-nested-recipe.yaml'
                },
                {
                    label: 'recipe-fakerjs-second-test.yaml',
                    description: 'File',
                    iconPath:  new vscode.ThemeIcon('file'),
                    detail: '/parent-path-mock/GeneratedRecipes/recipe-fakerjs-second/recipe-fakerjs-second-test.yaml'
                },
                {
                    label: 'recipe-fakerjs-second-nested-recipe.yaml',
                    description: 'File',
                    iconPath:  new vscode.ThemeIcon('file'),
                    detail: '/parent-path-mock/GeneratedRecipes/recipe-fakerjs-second/recipe-fakerjs-second-nested-recipe.yaml'
                }
            ];   

            let emptyQuickPickItems: vscode.QuickPickItem[] = [];
            const actualQuickPickItems = await VSCodeWorkspaceService.getAvailableRecipeFileQuickPickItemsByDirectory(emptyQuickPickItems, '/parent-path-mock/GeneratedRecipes');

            console.log('Actual Keys:', Object.keys(actualQuickPickItems));
            console.log('Expected Keys:', Object.keys(expectedFakerJSOnlyQuickPickItems));

            expect(actualQuickPickItems).toEqual(expectedFakerJSOnlyQuickPickItems);

        });

        test('given snowfakery as selected faker service and directories with both fakerjs recipes and snowfakery, should return expected QuickPickItems for each file found', async () => {
     
            const readdirMockFunctionImplementation = MockDirectoryService.getReaddirMockImplBySetOfMockedDirents(mockedDirents);

            jest.spyOn(fs.promises, 'readdir').mockImplementation(readdirMockFunctionImplementation);

            // this mock below doesn't drive behavior but the test will fail as the getExtensionConfigValue tries to pull value from users local settings which do not exist as part of stand alone unit tests
            jest.spyOn(ConfigurationService, 'getExtensionConfigValue').mockReturnValue('snowfakery');
            
            const expectedSnowfakeryOnlyQuickPickItems:vscode.QuickPickItem[] = [
                {
                    label: 'recipe1.yaml',
                    description: 'File',
                    iconPath:  new vscode.ThemeIcon('file'),
                    detail: '/parent-path-mock/GeneratedRecipes/recipe1.yaml'
                },
                {
                    label: 'recipe2.yaml',
                    description: 'File',
                    iconPath:  new vscode.ThemeIcon('file'),
                    detail: '/parent-path-mock/GeneratedRecipes/recipe2.yaml'
                },
                {
                    label: 'recipe-snowmatch-1.yaml',
                    description: 'File',
                    iconPath:  new vscode.ThemeIcon('file'),
                    detail: '/parent-path-mock/GeneratedRecipes/recipe-snowfakery-timestampfolder/recipe-snowmatch-1.yaml'
                },
                {
                    label: 'recipe-snowmatch-2.yaml',
                    description: 'File',
                    iconPath:  new vscode.ThemeIcon('file'),
                    detail: '/parent-path-mock/GeneratedRecipes/recipe-snowfakery-timestampfolder/recipe-snowmatch-2.yaml'
                },
                {
                    label: 'recipe-snowfakery-3.yaml',
                    description: 'File',
                    iconPath:  new vscode.ThemeIcon('file'),
                    detail: '/parent-path-mock/GeneratedRecipes/recipe-snowfakery-timestampfolder/recipe-snowfakery-3.yaml'
                }
            ];   

            let emptyQuickPickItems: vscode.QuickPickItem[] = [];
            const actualQuickPickItems = await VSCodeWorkspaceService.getAvailableRecipeFileQuickPickItemsByDirectory(emptyQuickPickItems, '/parent-path-mock/GeneratedRecipes');

            console.log('Actual Keys:', Object.keys(actualQuickPickItems));
            console.log('Expected Keys:', Object.keys(expectedSnowfakeryOnlyQuickPickItems));

            expect(actualQuickPickItems).toEqual(expectedSnowfakeryOnlyQuickPickItems);

        });

    });

    describe('promptForUserInput', () => {

        test('should return user input when showInputBox is called', async () => {

            const expectedMockedResponse = 'test input';
            const expectedPlaceholderArgument = 'Please enter a value:';
            (vscode.window.showInputBox as jest.Mock).mockResolvedValue(expectedMockedResponse);

            const actualResponse = await VSCodeWorkspaceService.promptForUserInput(expectedPlaceholderArgument);

            expect(actualResponse).toBe(expectedMockedResponse);
            expect(vscode.window.showInputBox).toHaveBeenCalledWith({
                placeHolder: expectedPlaceholderArgument
            });

        });

        test('should return undefined if the user cancels the input', async () => {

            (vscode.window.showInputBox as jest.Mock).mockResolvedValue(undefined);

            const result = await VSCodeWorkspaceService.promptForUserInput('Please enter a value:');

            expect(result).toBeUndefined();

        });

    });

    describe('getFileContentByPath', () => {

        test('given expected file content to be returned from readFile, should return file content when readFile is successful', async () => {
            
            const filePath = '/path/to/file.txt';
            const fileContent = 'File content here';
            (vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(Buffer.from(fileContent));

            const result = await VSCodeWorkspaceService.getFileContentByPath(filePath);

            expect(result).toBe(fileContent);
            expect(vscode.workspace.fs.readFile).toHaveBeenCalledWith(vscode.Uri.file(filePath));
        
        });

    });

    describe('getNowIsoDateTimestamp', () => {
        test('given expected value for datetime, should return the correctly formatted ISO date timestamp', () => {

            const expectedDateTimeToBeFormatted = new Date('2024-11-25T16:24:15.000Z');
            jest.spyOn(global, 'Date').mockImplementationOnce(() => expectedDateTimeToBeFormatted as any);

            const actualIsoDateTimeResult = VSCodeWorkspaceService.getNowIsoDateTimestamp();

            expect(actualIsoDateTimeResult).toBe('2024-11-25T16-24-15');

        });

    });

    describe('buildDirectoryVSCodeQuickPickItemByDirectoryEntry', () => {
        
        test('given expected arguments and mocked out modules, should build the correct quickPickItem', () => {

            const fakeWorkspaceRoot = '/mock/workspace/root';
            const fakeDirectoryName = 'fakeDirectory';
            const pathToFakeDirectory = 'mock/path/to/entry';
            const parentDirectoryPath = `${fakeWorkspaceRoot}/${pathToFakeDirectory}`;

            const mockDirent = {
                name: fakeDirectoryName,
            } as fs.Dirent;


            const mockIcon = new vscode.ThemeIcon('folder');
            jest.spyOn(vscode, "ThemeIcon").mockReturnValue(mockIcon);

            const actualQuickPickItemEntry = VSCodeWorkspaceService.buildDirectoryVSCodeQuickPickItemByDirectoryEntry(mockDirent, fakeWorkspaceRoot, parentDirectoryPath);

            const fullFakePath = `${fakeWorkspaceRoot}/${pathToFakeDirectory}/${fakeDirectoryName}`;
            const fakeRelativePath = `./${pathToFakeDirectory}/${fakeDirectoryName}/`;
            expect(actualQuickPickItemEntry).toEqual({
                label: fakeRelativePath,
                description: 'Directory',
                iconPath: mockIcon,
                detail: fullFakePath,
            });

        });

        test('given a Dirent whose deprecated path property is undefined, should still build a defined label from the caller-supplied parent path', () => {

            const fakeWorkspaceRoot = '/mock/workspace/root';
            const fakeDirectoryName = 'objects';
            const parentDirectoryPath = `${fakeWorkspaceRoot}/force-app/main/default`;

            const mockDirent = {
                path: undefined,
                name: fakeDirectoryName,
            } as unknown as fs.Dirent;

            const mockIcon = new vscode.ThemeIcon('folder');
            jest.spyOn(vscode, "ThemeIcon").mockReturnValue(mockIcon);

            const actualQuickPickItemEntry = VSCodeWorkspaceService.buildDirectoryVSCodeQuickPickItemByDirectoryEntry(mockDirent, fakeWorkspaceRoot, parentDirectoryPath);

            expect(actualQuickPickItemEntry.label).toBe('./force-app/main/default/objects/');
            expect(actualQuickPickItemEntry.label).not.toContain('undefined');

        });

    });

    describe('getDataSetDirectoryQuickPickItemsByStartingDirectoryPath', () => {

        test('given snowfakery mocked as faker service and expected "dataset-" and "dataset-fakerjs" named folders, should return quick pick items for directories containing "dataset-" only and no "dataset-fakerjs"', async () => {

            const mockDirectoriesWithDataSetFolders = MockDirectoryService.getMockedDirectoriesWithDatSetItemsIncluded();
            jest.spyOn(fs.promises, "readdir").mockReturnValue(Promise.resolve(mockDirectoriesWithDataSetFolders));
    
            const mockWorkspaceRoot = 'theworkspaceroot'; // "theworkspaceroot" is found in the "path" property of the expected mocked directories. The matching workspaceroot is needed to build out quickpickitems correctly
            jest.spyOn(VSCodeWorkspaceService, "getWorkspaceRoot").mockReturnValue(mockWorkspaceRoot);

            const mockIcon = new vscode.ThemeIcon('folder');
            jest.spyOn(vscode, "ThemeIcon").mockReturnValue(mockIcon);
       
            const quickPickItems: vscode.QuickPickItem[] = [];
            // the directory being read is the shared parent of every entry; it lives under the
            // workspace root so the derived relative-path label resolves correctly
            const directoryPath = 'theworkspaceroot/andotherthings';

            jest.spyOn(ConfigurationService, "getSelectedDataFakerServiceConfig").mockReturnValue("snowfakery");

            const actualDataSetQuickPickItems = await VSCodeWorkspaceService.getDataSetDirectoryQuickPickItemsByStartingDirectoryPath(directoryPath, quickPickItems);

            expect(fs.promises.readdir).toHaveBeenCalledWith(directoryPath, { withFileTypes: true });
            expect(VSCodeWorkspaceService.getWorkspaceRoot).toHaveBeenCalled();

            const expectedQuickPickItems = [
                {
                    "label": "./andotherthings/dataset-foldernameone/rest-ofdirectoryname/",
                    "description": "Directory",
                    "iconPath": {
                    "id": "folder"
                    },
                    "detail": "theworkspaceroot/andotherthings/dataset-foldernameone/rest-ofdirectoryname"
                },
                {
                    "label": "./andotherthings/dataset-abc/anotherone-rest-ofdirectoryname/",
                    "description": "Directory",
                    "iconPath": {
                    "id": "folder"
                    },
                    "detail": "theworkspaceroot/andotherthings/dataset-abc/anotherone-rest-ofdirectoryname"
                },
                {
                    "label": "./andotherthings/dataset--fff-fakerjs/anotherone-rest-ofdirectoryname/",
                    "description": "Directory",
                    "iconPath": {
                    "id": "folder"
                    },
                    "detail": "theworkspaceroot/andotherthings/dataset--fff-fakerjs/anotherone-rest-ofdirectoryname"
                }
            ];

            expect(actualDataSetQuickPickItems).toEqual(expectedQuickPickItems);

        });

        test('given faker-js mocked as faker service and expected "dataset-" and "dataset-fakerjs" named folders, should return quick pick items for directories containing "dataset-fakerjs" only and no "dataset-"', async () => {

            const mockDirectoriesWithDataSetFolders = MockDirectoryService.getMockedDirectoriesWithDatSetItemsIncluded();
            jest.spyOn(fs.promises, "readdir").mockReturnValue(Promise.resolve(mockDirectoriesWithDataSetFolders));
    
            const mockWorkspaceRoot = 'theworkspaceroot'; // "theworkspaceroot" is found in the "path" property of the expected mocked directories. The matching workspaceroot is needed to build out quickpickitems correctly
            jest.spyOn(VSCodeWorkspaceService, "getWorkspaceRoot").mockReturnValue(mockWorkspaceRoot);

            const mockIcon = new vscode.ThemeIcon('folder');
            jest.spyOn(vscode, "ThemeIcon").mockReturnValue(mockIcon);
       
            const quickPickItems: vscode.QuickPickItem[] = [];
            // the directory being read is the shared parent of every entry; it lives under the
            // workspace root so the derived relative-path label resolves correctly
            const directoryPath = 'theworkspaceroot/andotherthings';

            jest.spyOn(ConfigurationService, "getSelectedDataFakerServiceConfig").mockReturnValue("faker-js");

            const actualDataSetQuickPickItems = await VSCodeWorkspaceService.getDataSetDirectoryQuickPickItemsByStartingDirectoryPath(directoryPath, quickPickItems);

            expect(fs.promises.readdir).toHaveBeenCalledWith(directoryPath, { withFileTypes: true });
            expect(VSCodeWorkspaceService.getWorkspaceRoot).toHaveBeenCalled();
            
            const expectedQuickPickItems = [
                {
                    "label": "./andotherthings/dataset-fakerjs-test/anotherone-rest-ofdirectoryname/",
                    "description": "Directory",
                    "iconPath": {
                    "id": "folder"
                    },
                    "detail": "theworkspaceroot/andotherthings/dataset-fakerjs-test/anotherone-rest-ofdirectoryname"
                },
                {
                    "label": "./andotherthings/dataset-fakerjs-testtwo/anotherone-rest-ofdirectoryname/",
                    "description": "Directory",
                    "iconPath": {
                    "id": "folder"
                    },
                    "detail": "theworkspaceroot/andotherthings/dataset-fakerjs-testtwo/anotherone-rest-ofdirectoryname"
                }
            ];

            expect(actualDataSetQuickPickItems).toEqual(expectedQuickPickItems);

        });
    
        test('given no directories with dataset substring, should not return non-dataset directories', async () => {

            const mockReaddir = jest.fn().mockResolvedValue([
                { name: 'other1', isDirectory: () => true },
                { name: 'other2', isDirectory: () => true }
            ]);
            fs.promises.readdir = mockReaddir;
    
            const quickPickItems: vscode.QuickPickItem[] = [];
            const directoryPath = '/mock/directory/path';

            //mocking faker service to avoid test run time failure
            jest.spyOn(ConfigurationService, "getSelectedDataFakerServiceConfig").mockReturnValue("faker-js");

            const result = await VSCodeWorkspaceService.getDataSetDirectoryQuickPickItemsByStartingDirectoryPath(directoryPath, quickPickItems);
    
            expect(result).toEqual([]); 
        
        });

    });

    describe('createUniqueTimeStampedFakeDataSetsFolderName', () => {
        
        test('should create a unique timestamped folder for fake data sets', () => {

            const uniqueTimeStampedFakeDataSetsFolderName = '2024-11-25T16-24-15';
            const mockWorkspaceRoot = '/mock/workspace';
            const mockFakeDataSetsFolderPath = 'treecipe/FakeDataSets';
            const mockExpectedFolderPath = `${mockWorkspaceRoot}/${mockFakeDataSetsFolderPath}`;
            const mockUniqueFolderName = `dataset-${uniqueTimeStampedFakeDataSetsFolderName}`;
            const mockFullPathToUniqueFolder = `${mockExpectedFolderPath}/${mockUniqueFolderName}`;

            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue(mockWorkspaceRoot);
            jest.spyOn(VSCodeWorkspaceService, 'createFakeDatasetsTimeStampedFolderName').mockReturnValue(mockUniqueFolderName);

            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'mkdirSync').mockImplementation();

            const result = VSCodeWorkspaceService.createUniqueTimeStampedFakeDataSetsFolderName(mockUniqueFolderName);

            expect(fs.existsSync).toHaveBeenCalledWith(mockExpectedFolderPath);
            expect(fs.mkdirSync).toHaveBeenCalledWith(mockFullPathToUniqueFolder);
            expect(result).toBe(mockFullPathToUniqueFolder);
        
        });

    });

    describe('createFakeDatasetsTimeStampedFolderName', () => {

        test('given snowfakery selected as faker service, should create a unique timestamped folder name', () => {

            const fakeTimestamp = '2024-11-25T16-24-15';
            const mockDate = new Date('2024-11-25T16:24:15Z');
            jest.spyOn(global, 'Date').mockReturnValue(mockDate);

            jest.spyOn(global, 'Date').mockImplementation();
            jest.spyOn(mockDate, 'toISOString').mockReturnValue('2024-11-25T16:24:15.000Z');

            const expectedFolderName = `dataset-${fakeTimestamp}`;

            jest.spyOn(ConfigurationService, 'getSelectedDataFakerServiceConfig').mockReturnValue('snowfakery');

            const actualFolderName = VSCodeWorkspaceService.createFakeDatasetsTimeStampedFolderName(fakeTimestamp);
            expect(actualFolderName).toBe(expectedFolderName);

        });

        test('given fakerjs selected as faker service, should create a unique timestamped folder name with fakerjs included', () => {

            const fakeTimestamp = '2024-11-25T16-24-15';
            const mockDate = new Date('2024-11-25T16:24:15Z');
            jest.spyOn(global, 'Date').mockReturnValue(mockDate);

            jest.spyOn(global, 'Date').mockImplementation();
            jest.spyOn(mockDate, 'toISOString').mockReturnValue('2024-11-25T16:24:15.000Z');

            const expectedFolderName = `dataset-fakerjs-${fakeTimestamp}`;

            jest.spyOn(ConfigurationService, 'getSelectedDataFakerServiceConfig').mockReturnValue('faker-js');

            const actualFolderName = VSCodeWorkspaceService.createFakeDatasetsTimeStampedFolderName(fakeTimestamp);
            expect(actualFolderName).toBe(expectedFolderName);

        });

    });

});

describe('createStatusBarPhaseItem', () => {

    it('creates a left aligned status bar item, shows it, and hands it back for the caller to dispose', () => {

        const statusBarItem = { text: '', show: jest.fn(), dispose: jest.fn() };
        (vscode.window.createStatusBarItem as jest.Mock).mockReturnValue(statusBarItem);

        const actualStatusBarItem = VSCodeWorkspaceService.createStatusBarPhaseItem('Reading the manifest…');

        expect(vscode.window.createStatusBarItem).toHaveBeenCalledWith(vscode.StatusBarAlignment.Left);
        expect(actualStatusBarItem.text).toBe('Reading the manifest…');
        expect(statusBarItem.show).toHaveBeenCalled();

        /*
            Deliberately NOT disposed here. The item describes work that outlives this call, and an
            item left showing after that work ends reads as a command still running -- so ownership
            passing to the caller is the contract being asserted.
        */
        expect(statusBarItem.dispose).not.toHaveBeenCalled();
        expect(actualStatusBarItem).toBe(statusBarItem);

    });

});
