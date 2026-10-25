import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

jest.mock('vscode', () => {

    class TreeItem {
        iconPath?: unknown;
        tooltip?: string;
        command?: { command: string, title: string, arguments?: unknown[] };
        constructor(readonly label: string, readonly collapsibleState: number) {}
    }

    class ThemeIcon {
        constructor(readonly id: string) {}
    }

    class EventEmitter {
        private listeners: Array<(value: unknown) => void> = [];
        readonly event = (listener: (value: unknown) => void) => {
            this.listeners.push(listener);
            return { dispose: jest.fn() };
        };
        fire(value: unknown) {
            this.listeners.forEach(listener => listener(value));
        }
        dispose = jest.fn();
    }

    return {
        TreeItem,
        ThemeIcon,
        EventEmitter,
        TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
        workspace: {
            workspaceFolders: undefined,
            getConfiguration: jest.fn().mockReturnValue({ get: jest.fn(), update: jest.fn(), inspect: jest.fn() }),
            onDidChangeWorkspaceFolders: jest.fn().mockReturnValue({ dispose: jest.fn() }),
            onDidChangeConfiguration: jest.fn().mockReturnValue({ dispose: jest.fn() })
        },
        window: {
            registerTreeDataProvider: jest.fn().mockReturnValue({ dispose: jest.fn() }),
            showErrorMessage: jest.fn(),
            showWarningMessage: jest.fn()
        },
        commands: { executeCommand: jest.fn() }
    };

}, { virtual: true });

import { ConfigurationService } from '../../ConfigurationService/ConfigurationService';
import {
    TREECIPE_SIDE_BAR_GROUPS,
    TREECIPE_SIDE_BAR_VIEW_ID,
    TREECIPE_WORKSPACE_CONTEXT_KEY,
    TreecipeSideBarNode,
    TreecipeSideBarProvider,
    TreecipeSideBarService
} from '../TreecipeSideBarService';

const repositoryRoot = path.resolve(__dirname, '../../../../..');
const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf-8'));

const setWorkspaceFolder = (folderPath: string | undefined) => {
    (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = folderPath
        ? [{ uri: { fsPath: folderPath } }]
        : undefined;
};

const listCommandRows = (provider: TreecipeSideBarProvider) =>
    provider.getChildren().flatMap(groupNode => provider.getChildren(groupNode));

describe('TreecipeSideBarService (#456)', () => {

    let temporaryWorkspace: string;

    beforeEach(() => {

        temporaryWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-side-bar-'));
        setWorkspaceFolder(undefined);

        // MODULE-FACTORY jest.fn()s, WHICH restoreMocks DOES NOT RESET
        (vscode.commands.executeCommand as jest.Mock).mockClear();
        (vscode.window.registerTreeDataProvider as jest.Mock).mockClear();
        jest.spyOn(ConfigurationService, 'getWorkspaceScopedExtensionConfigValue').mockReturnValue(undefined);

    });

    afterEach(() => {
        fs.rmSync(temporaryWorkspace, { recursive: true, force: true });
    });

    const writeDefaultConfiguration = () => {
        fs.mkdirSync(path.join(temporaryWorkspace, 'treecipe'));
        fs.writeFileSync(path.join(temporaryWorkspace, 'treecipe', 'treecipe.config.json'), '{}');
    };

    describe('the rows', () => {

        const declaredCommandIds = new Set<string>(packageJson.contributes.commands.map((declared: { command: string }) => declared.command));

        it('lists every declared command but Initiate Configuration, in two groups and a fixed order', () => {

            expect(TREECIPE_SIDE_BAR_GROUPS.map(group => group.label)).toEqual(['Recipes', 'Picklist Dependencies']);

            const listedCommandIds = TREECIPE_SIDE_BAR_GROUPS.flatMap(group => group.commands.map(row => row.commandId));
            expect(listedCommandIds).toEqual([
                'treecipe.openRecipeCockpit',
                'treecipe.generateTreecipe',
                'treecipe.runFakerByRecipe',
                'treecipe.insertDataSetBySelectedDirectory',
                'treecipe.changeFakerImplementationService',
                'treecipe.generatePicklistDependencyTests',
                'treecipe.runPicklistDependencyCheck',
                'treecipe.openPicklistDependencyExplorer',
                'treecipe.updatePicklistDependencyMetadata'
            ]);

            expect([...declaredCommandIds].filter(commandId => !listedCommandIds.includes(commandId))).toEqual(['treecipe.initiateConfiguration']);

        });

        // A RENAMED COMMAND FAILS HERE RATHER THAN LEAVING A ROW THAT RUNS NOTHING
        it('names only commands package.json declares, each under the palette title', () => {

            const declaredTitles = new Map<string, string>(packageJson.contributes.commands.map((declared: { command: string, title: string }) => [declared.command, declared.title]));

            TREECIPE_SIDE_BAR_GROUPS.flatMap(group => group.commands).forEach(row => {
                expect(declaredCommandIds.has(row.commandId)).toBe(true);
                expect(row.title).toBe(declaredTitles.get(row.commandId));
            });

        });

        it('makes each row run its command with NO arguments, under a codicon', () => {

            const provider = new TreecipeSideBarProvider();
            provider.setTreecipeWorkspace(true);

            const rows = listCommandRows(provider).map(node => provider.getTreeItem(node));

            expect(rows).toHaveLength(9);
            rows.forEach(row => {
                expect(row.command).toEqual({ command: expect.any(String), title: row.label });
                expect(row.command).not.toHaveProperty('arguments');
                expect(row.iconPath).toBeInstanceOf(vscode.ThemeIcon);
                expect(row.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
            });

        });

        it('draws the groups expanded and running nothing', () => {

            const provider = new TreecipeSideBarProvider();
            provider.setTreecipeWorkspace(true);

            const groups = provider.getChildren().map(node => provider.getTreeItem(node));

            expect(groups.map(group => group.label)).toEqual(['Recipes', 'Picklist Dependencies']);
            groups.forEach(group => {
                expect(group.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Expanded);
                expect(group.command).toBeUndefined();
            });

        });

        // AN EMPTY TREE IS WHAT LETS VS CODE DRAW THE VIEW'S WELCOME CONTENT
        it('lists nothing until the workspace is a Treecipe workspace, and a command row has no children', () => {

            const provider = new TreecipeSideBarProvider();
            expect(provider.getChildren()).toEqual([]);

            provider.setTreecipeWorkspace(true);
            const commandNode: TreecipeSideBarNode = { kind: 'command', sideBarCommand: TREECIPE_SIDE_BAR_GROUPS[0].commands[0] };
            expect(provider.getChildren(commandNode)).toEqual([]);

            const changes: unknown[] = [];
            provider.onDidChangeTreeData(change => changes.push(change));
            provider.setTreecipeWorkspace(false);
            expect(changes).toEqual([undefined]);
            expect(provider.getChildren()).toEqual([]);

        });

    });

    describe('isTreecipeConfigurationPresent', () => {

        it('given no folder, is false without reading a setting', () => {

            expect(TreecipeSideBarService.isTreecipeConfigurationPresent(undefined)).toBe(false);
            expect(ConfigurationService.getWorkspaceScopedExtensionConfigValue).not.toHaveBeenCalled();

        });

        it('given the default treecipe/treecipe.config.json, is true; given none, false', () => {

            expect(TreecipeSideBarService.isTreecipeConfigurationPresent(temporaryWorkspace)).toBe(false);

            writeDefaultConfiguration();

            expect(TreecipeSideBarService.isTreecipeConfigurationPresent(temporaryWorkspace)).toBe(true);

        });

        it('given a default path that is a folder, is false', () => {

            fs.mkdirSync(path.join(temporaryWorkspace, 'treecipe', 'treecipe.config.json'), { recursive: true });

            expect(TreecipeSideBarService.isTreecipeConfigurationPresent(temporaryWorkspace)).toBe(false);

        });

        it('given a stored path to a file inside the workspace, is true with no default config', () => {

            fs.mkdirSync(path.join(temporaryWorkspace, 'config'));
            fs.writeFileSync(path.join(temporaryWorkspace, 'config', 'custom.json'), '{}');
            jest.spyOn(ConfigurationService, 'getWorkspaceScopedExtensionConfigValue').mockReturnValue('config/custom.json' as never);

            expect(TreecipeSideBarService.isTreecipeConfigurationPresent(temporaryWorkspace)).toBe(true);

        });

        it('given a stored path outside the workspace, ignores it even when the file exists', () => {

            const outsideFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-side-bar-outside-'));
            const outsideConfiguration = path.join(outsideFolder, 'treecipe.config.json');
            fs.writeFileSync(outsideConfiguration, '{}');
            jest.spyOn(ConfigurationService, 'getWorkspaceScopedExtensionConfigValue').mockReturnValue(outsideConfiguration as never);

            try {
                expect(TreecipeSideBarService.isTreecipeConfigurationPresent(temporaryWorkspace)).toBe(false);
                writeDefaultConfiguration();
                expect(TreecipeSideBarService.isTreecipeConfigurationPresent(temporaryWorkspace)).toBe(true);
            } finally {
                fs.rmSync(outsideFolder, { recursive: true, force: true });
            }

        });

        // THE RESOLVER COMMANDS USE CAN REWRITE THE SETTING AND WARN; DRAWING A VIEW MUST DO NEITHER
        it('given a stale stored path, writes no setting and shows nothing', () => {

            jest.spyOn(ConfigurationService, 'getWorkspaceScopedExtensionConfigValue').mockReturnValue('/nowhere/treecipe.config.json' as never);
            const setExtensionConfigValueSpy = jest.spyOn(ConfigurationService, 'setExtensionConfigValue');
            const resolverSpy = jest.spyOn(ConfigurationService, 'resolveTreecipeConfigurationFilePath');
            writeDefaultConfiguration();

            expect(TreecipeSideBarService.isTreecipeConfigurationPresent(temporaryWorkspace)).toBe(true);

            expect(setExtensionConfigValueSpy).not.toHaveBeenCalled();
            expect(resolverSpy).not.toHaveBeenCalled();
            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
            expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();

        });

    });

    describe('register and refresh', () => {

        const registeredProvider = () => (vscode.window.registerTreeDataProvider as jest.Mock).mock.calls[0][1] as TreecipeSideBarProvider;

        it('registers the provider under the view package.json declares, and keeps every disposable', () => {

            const subscriptions: vscode.Disposable[] = [];

            TreecipeSideBarService.register(subscriptions);

            expect(vscode.window.registerTreeDataProvider).toHaveBeenCalledWith(TREECIPE_SIDE_BAR_VIEW_ID, expect.any(TreecipeSideBarProvider));
            expect(subscriptions).toHaveLength(4);
            expect(packageJson.contributes.views.treecipe.map((view: { id: string }) => view.id)).toEqual([TREECIPE_SIDE_BAR_VIEW_ID]);

        });

        it('sets the context key and the rows from the workspace, and again on refresh', () => {

            setWorkspaceFolder(temporaryWorkspace);

            TreecipeSideBarService.register([]);

            expect(vscode.commands.executeCommand).toHaveBeenCalledWith('setContext', TREECIPE_WORKSPACE_CONTEXT_KEY, false);
            expect(registeredProvider().getChildren()).toEqual([]);

            writeDefaultConfiguration();
            TreecipeSideBarService.refresh();

            expect(vscode.commands.executeCommand).toHaveBeenLastCalledWith('setContext', TREECIPE_WORKSPACE_CONTEXT_KEY, true);
            expect(registeredProvider().getChildren()).toHaveLength(2);

        });

        // THE VIEW IS A DOOR: DRAWING IT RUNS NO COMMAND BUT setContext AND WRITES NO SETTING
        it('runs nothing but setContext and writes no setting while registering and drawing every row', () => {

            setWorkspaceFolder(temporaryWorkspace);
            writeDefaultConfiguration();
            const setExtensionConfigValueSpy = jest.spyOn(ConfigurationService, 'setExtensionConfigValue');

            TreecipeSideBarService.register([]);
            const provider = registeredProvider();
            listCommandRows(provider).forEach(node => provider.getTreeItem(node));

            expect((vscode.commands.executeCommand as jest.Mock).mock.calls.map(call => call[0])).toEqual(['setContext']);
            expect(setExtensionConfigValueSpy).not.toHaveBeenCalled();

        });

        it('refreshes when the workspace folders change or the config path setting does, and only then', () => {

            TreecipeSideBarService.register([]);
            const refreshSpy = jest.spyOn(TreecipeSideBarService, 'refresh');

            const onFoldersChanged = (vscode.workspace.onDidChangeWorkspaceFolders as jest.Mock).mock.calls.at(-1)[0];
            const onConfigurationChanged = (vscode.workspace.onDidChangeConfiguration as jest.Mock).mock.calls.at(-1)[0];

            onFoldersChanged();
            onConfigurationChanged({ affectsConfiguration: (section: string) => section === 'salesforce-data-treecipe.showRecipeCockpitStatusBarItem' });
            onConfigurationChanged({ affectsConfiguration: (section: string) => section === 'salesforce-data-treecipe.treecipeConfigurationPath' });

            expect(refreshSpy).toHaveBeenCalledTimes(2);

        });

    });

    describe('package.json and the Activity Bar icon', () => {

        it('declares the Treecipe container, its SVG icon and the two welcome states', () => {

            expect(packageJson.contributes.viewsContainers.activitybar).toEqual([
                { id: 'treecipe', title: 'Treecipe', icon: 'images/treecipe-activity-bar.svg' }
            ]);
            expect(packageJson.icon).toBe('images/datatreecipe.png');

            const welcomeStates = packageJson.contributes.viewsWelcome.map((welcome: { view: string, contents: string, when: string }) => welcome);
            welcomeStates.forEach((welcome: { view: string }) => expect(welcome.view).toBe(TREECIPE_SIDE_BAR_VIEW_ID));

            const noFolder = welcomeStates.find((welcome: { when: string }) => welcome.when === 'workbenchState == empty');
            expect(noFolder.contents).not.toContain('command:');

            const noConfiguration = welcomeStates.find((welcome: { when: string }) => welcome.when === `workbenchState != empty && !${TREECIPE_WORKSPACE_CONTEXT_KEY}`);
            expect(noConfiguration.contents).toContain('[Initiate Configuration](command:treecipe.initiateConfiguration)');

        });

        // VS CODE DRAWS AN ACTIVITY BAR ICON AS A MASK: A ONE-COLOUR SVG THAT FETCHES NOTHING
        it('ships a 24x24 SVG drawn in currentColor that references nothing outside itself', () => {

            const svg = fs.readFileSync(path.join(repositoryRoot, 'images', 'treecipe-activity-bar.svg'), 'utf-8');

            expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="24" height="24" viewBox="0 0 24 24"/);
            expect(svg).toContain('stroke="currentColor"');
            expect(svg).not.toMatch(/href|url\(|<image|<script|<style|<foreignObject/i);
            expect(svg.match(/https?:\/\/[^"]+/g)).toEqual(['http://www.w3.org/2000/svg']);

        });

    });

});
