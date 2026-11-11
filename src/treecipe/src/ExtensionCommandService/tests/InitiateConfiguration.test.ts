import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

jest.mock('vscode', () => ({
    workspace: {
        workspaceFolders: undefined,
        getConfiguration: jest.fn()
    },
    Uri: { file: (filePath: string) => ({ fsPath: filePath }) },
    window: {
        createQuickPick: jest.fn(),
        showQuickPick: jest.fn(),
        showErrorMessage: jest.fn(),
        showWarningMessage: jest.fn(),
        showInformationMessage: jest.fn(),
        createOutputChannel: jest.fn(),
        withProgress: jest.fn()
    },
    commands: { executeCommand: jest.fn() },
    ProgressLocation: { Notification: 15, Window: 10 },
    ConfigurationTarget: { Workspace: 2 },
    QuickPickItemKind: { Separator: -1, Default: 0 },
    ThemeIcon: jest.fn().mockImplementation((iconName: string) => ({ id: iconName }))
}), { virtual: true });

import { ExtensionCommandService } from '../ExtensionCommandService';
import { ConfigurationService } from '../../ConfigurationService/ConfigurationService';
import { RecipeYamlScalar } from '../../RecipeYamlScalar/RecipeYamlScalar';

/*
    Pins what a user sees around treecipe.config.json at the vscode API, with no service spied on,
    so a move of code between ConfigurationService, VSCodeWorkspaceService and the command (#575)
    can show the prompts, their order, the file written and the notices did not change.
*/

const OBJECTS_DIRECTORY_LABEL = './force-app/main/default/objects/';
const OBJECTS_DIRECTORY_PROMPT = 'Select directory that contains the Salesforce objects';
const FAKER_SERVICE_PROMPT = 'Select Data Faker Service';
const MISSING_CONFIGURATION_MESSAGE = 'Expected treecipe and config file missing';
const RUN_INITIATION_SETUP_BUTTON = 'Run Treecipe Initiation Setup';
const REPORT_ISSUE_BUTTON = 'Report Issue to GitHub with Stack Trace';

describe('treecipe.config.json prompts and notices, at the vscode API (#575)', () => {

    let workspaceRoot: string;
    let promptsInOrder: string[];
    let storedConfigurationPath: string | undefined;
    const updateSettingMock = jest.fn();

    // ACCEPTS THE ITEM LABELLED acceptLabel ONCE IT IS OFFERED, ON A LATER TURN AS A PERSON WOULD; undefined DISMISSES THE PICKER WHEN THE SCAN ENDS
    function answerObjectsDirectoryQuickPick(acceptLabel: string | undefined) {

        (vscode.window.createQuickPick as jest.Mock).mockImplementation(() => {

            const acceptHandlers: (() => void)[] = [];
            const hideHandlers: (() => void)[] = [];
            let offeredItems: vscode.QuickPickItem[] = [];
            let isBusy = false;
            let isAnswered = false;

            const fakeQuickPick: Record<string, unknown> = {
                selectedItems: [],
                activeItems: [],
                show: jest.fn(() => promptsInOrder.push(String(fakeQuickPick.placeholder))),
                dispose: jest.fn(),
                hide: jest.fn(() => hideHandlers.forEach(hideHandler => hideHandler())),
                onDidAccept: jest.fn((acceptHandler: () => void) => acceptHandlers.push(acceptHandler)),
                onDidHide: jest.fn((hideHandler: () => void) => hideHandlers.push(hideHandler))
            };

            Object.defineProperty(fakeQuickPick, 'items', {
                get: () => offeredItems,
                set: (updatedItems: vscode.QuickPickItem[]) => {
                    offeredItems = updatedItems;
                    const acceptedItem = updatedItems.find(offeredItem => offeredItem.label === acceptLabel);
                    if ( acceptedItem && !isAnswered ) {
                        isAnswered = true;
                        setImmediate(() => {
                            fakeQuickPick.selectedItems = [acceptedItem];
                            acceptHandlers.forEach(acceptHandler => acceptHandler());
                        });
                    }
                }
            });

            Object.defineProperty(fakeQuickPick, 'busy', {
                get: () => isBusy,
                set: (busyValue: boolean) => {
                    const hasScanEnded = isBusy && !busyValue;
                    isBusy = busyValue;
                    if ( hasScanEnded && !isAnswered ) {
                        isAnswered = true;
                        setImmediate(() => (fakeQuickPick.hide as () => void)());
                    }
                }
            });

            return fakeQuickPick;

        });

    }

    function answerFakerServiceQuickPick(fakerServiceLabel: string | undefined) {

        (vscode.window.showQuickPick as jest.Mock).mockImplementation(async (items: vscode.QuickPickItem[], options: vscode.QuickPickOptions) => {
            promptsInOrder.push(options.placeHolder);
            return items.find(item => item.label === fakerServiceLabel);
        });

    }

    function listWorkspaceEntries(): string[] {
        return fs.readdirSync(workspaceRoot).sort();
    }

    beforeEach(() => {

        workspaceRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-initiate-configuration-')));
        fs.mkdirSync(path.join(workspaceRoot, 'force-app', 'main', 'default', 'objects'), { recursive: true });

        promptsInOrder = [];
        storedConfigurationPath = undefined;
        updateSettingMock.mockReset().mockResolvedValue(undefined);

        (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [{ uri: { fsPath: workspaceRoot } }];
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
            get: jest.fn(),
            update: updateSettingMock,
            inspect: jest.fn(() => ({ workspaceValue: storedConfigurationPath }))
        });
        (vscode.window.withProgress as jest.Mock).mockImplementation((_progressOptions, runTask) => runTask(
            { report: jest.fn() },
            { isCancellationRequested: false, onCancellationRequested: jest.fn() }
        ));
        // jest.fn()s FROM THE vscode MOCK FACTORY ARE NOT SPIES, SO restoreMocks LEAVES THEIR CALLS IN PLACE
        (vscode.window.showQuickPick as jest.Mock).mockReset();
        (vscode.window.showWarningMessage as jest.Mock).mockReset();
        (vscode.window.showInformationMessage as jest.Mock).mockReset().mockResolvedValue(undefined);
        (vscode.window.showErrorMessage as jest.Mock).mockReset().mockResolvedValue(undefined);

    });

    afterEach(() => {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
    });

    describe('Initiate Configuration File', () => {

        test('asks for the objects directory, then the faker implementation, and writes treecipe.config.json from the two answers', async () => {

            answerObjectsDirectoryQuickPick(OBJECTS_DIRECTORY_LABEL);
            answerFakerServiceQuickPick('faker-js');

            const configurationFilePath = await new ExtensionCommandService().initiateTreecipeConfigurationSetup();

            expect(promptsInOrder).toEqual([OBJECTS_DIRECTORY_PROMPT, FAKER_SERVICE_PROMPT]);

            expect(path.normalize(configurationFilePath)).toBe(path.join(workspaceRoot, 'treecipe', 'treecipe.config.json'));
            expect(fs.readFileSync(configurationFilePath, 'utf8')).toBe(
                '{\n'
                + '    "salesforceObjectsPath": "./force-app/main/default/objects/",\n'
                + '    "dataFakerService": "faker-js"\n'
                + '}'
            );

            expect(updateSettingMock).toHaveBeenCalledWith('selectedFakerService', 'faker-js', vscode.ConfigurationTarget.Workspace);
            expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();

        });

        test('offers both faker implementations, snowfakery first', async () => {

            answerObjectsDirectoryQuickPick(OBJECTS_DIRECTORY_LABEL);
            answerFakerServiceQuickPick('snowfakery');

            const configurationFilePath = await new ExtensionCommandService().initiateTreecipeConfigurationSetup();

            const offeredFakerServices = (vscode.window.showQuickPick as jest.Mock).mock.calls[0][0].map((item: vscode.QuickPickItem) => item.label);
            expect(offeredFakerServices).toEqual(['snowfakery', 'faker-js']);
            expect(JSON.parse(fs.readFileSync(configurationFilePath, 'utf8')).dataFakerService).toBe('snowfakery');

        });

        test('a dismissed objects directory picker asks nothing more and writes nothing', async () => {

            answerObjectsDirectoryQuickPick(undefined);
            answerFakerServiceQuickPick('faker-js');

            await expect(new ExtensionCommandService().initiateTreecipeConfigurationSetup()).resolves.toBeUndefined();

            expect(promptsInOrder).toEqual([OBJECTS_DIRECTORY_PROMPT]);
            expect(listWorkspaceEntries()).toEqual(['force-app']);
            expect(updateSettingMock).not.toHaveBeenCalledWith('selectedFakerService', expect.anything(), expect.anything());

        });

        test('a dismissed faker implementation picker writes nothing', async () => {

            answerObjectsDirectoryQuickPick(OBJECTS_DIRECTORY_LABEL);
            answerFakerServiceQuickPick(undefined);

            await expect(new ExtensionCommandService().initiateTreecipeConfigurationSetup()).resolves.toBeUndefined();

            expect(promptsInOrder).toEqual([OBJECTS_DIRECTORY_PROMPT, FAKER_SERVICE_PROMPT]);
            expect(listWorkspaceEntries()).toEqual(['force-app']);
            expect(updateSettingMock).not.toHaveBeenCalledWith('selectedFakerService', expect.anything(), expect.anything());

        });

    });

    describe('a command run without a usable treecipe.config.json', () => {

        test('a missing config is one error notification offering Run Treecipe Initiation Setup', async () => {

            await new ExtensionCommandService().generateRecipeFromConfigurationDetail();

            expect((vscode.window.showErrorMessage as jest.Mock).mock.calls).toEqual([
                [MISSING_CONFIGURATION_MESSAGE, RUN_INITIATION_SETUP_BUTTON, REPORT_ISSUE_BUTTON]
            ]);
            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();

        });

        test('a treecipeConfigurationPath setting naming a file that is gone, with no default config, says so in the same notification', async () => {

            storedConfigurationPath = path.join(workspaceRoot, 'moved', 'treecipe.config.json');

            await new ExtensionCommandService().generateRecipeFromConfigurationDetail();

            const escapedStoredConfigurationPath = RecipeYamlScalar.escapeForNotification(storedConfigurationPath);
            expect((vscode.window.showErrorMessage as jest.Mock).mock.calls).toEqual([
                [
                    `${MISSING_CONFIGURATION_MESSAGE}. The "salesforce-data-treecipe.treecipeConfigurationPath" setting names "${escapedStoredConfigurationPath}", which does not exist.`,
                    RUN_INITIATION_SETUP_BUTTON,
                    REPORT_ISSUE_BUTTON
                ]
            ]);
            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();

        });

        test('a stale setting beside a default config that exists is one warning, and the setting is rewritten to the default', () => {

            storedConfigurationPath = path.join(workspaceRoot, 'renamed', 'treecipe.config.json');
            const defaultConfigurationPath = path.join(workspaceRoot, 'treecipe', 'treecipe.config.json');
            fs.mkdirSync(path.dirname(defaultConfigurationPath));
            fs.writeFileSync(defaultConfigurationPath, '{ "salesforceObjectsPath": "./force-app/main/default/objects/", "dataFakerService": "faker-js" }');

            expect(ConfigurationService.getObjectsPathFromTreecipeJSONConfiguration()).toBe('./force-app/main/default/objects/');
            expect(ConfigurationService.getObjectsPathFromTreecipeJSONConfiguration()).toBe('./force-app/main/default/objects/');

            const escapedStoredConfigurationPath = RecipeYamlScalar.escapeForNotification(storedConfigurationPath);
            const escapedDefaultConfigurationPath = RecipeYamlScalar.escapeForNotification(defaultConfigurationPath);
            expect((vscode.window.showWarningMessage as jest.Mock).mock.calls).toEqual([
                [`The "salesforce-data-treecipe.treecipeConfigurationPath" setting names "${escapedStoredConfigurationPath}", which does not exist. Using "${escapedDefaultConfigurationPath}" instead and updating this workspace's setting.`]
            ]);
            expect(updateSettingMock.mock.calls).toEqual([
                ['treecipeConfigurationPath', defaultConfigurationPath, vscode.ConfigurationTarget.Workspace]
            ]);
            expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();

        });

    });

});
