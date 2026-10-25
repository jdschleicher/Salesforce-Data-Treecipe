import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigurationService } from '../ConfigurationService/ConfigurationService';

export const TREECIPE_SIDE_BAR_VIEW_ID = 'treecipe.commands';
export const TREECIPE_WORKSPACE_CONTEXT_KEY = 'salesforce-data-treecipe.isTreecipeWorkspace';

export interface ITreecipeSideBarCommand {
    commandId: string;
    title: string;
    codicon: string;
}

export interface ITreecipeSideBarGroup {
    label: string;
    commands: ITreecipeSideBarCommand[];
}

export const TREECIPE_SIDE_BAR_GROUPS: ITreecipeSideBarGroup[] = [
    {
        label: 'Recipes',
        commands: [
            { commandId: 'treecipe.openRecipeCockpit', title: 'Open Recipe Cockpit', codicon: 'list-tree' },
            { commandId: 'treecipe.generateTreecipe', title: 'Generate Treecipe', codicon: 'sparkle' },
            { commandId: 'treecipe.runFakerByRecipe', title: 'Run Faker by Recipe', codicon: 'play' },
            { commandId: 'treecipe.insertDataSetBySelectedDirectory', title: 'Insert Data Set by Directory', codicon: 'cloud-upload' },
            { commandId: 'treecipe.changeFakerImplementationService', title: 'Select Faker Implementation', codicon: 'settings-gear' }
        ]
    },
    {
        label: 'Picklist Dependencies',
        commands: [
            { commandId: 'treecipe.generatePicklistDependencyTests', title: 'Generate Picklist Dependency Tests', codicon: 'beaker' },
            { commandId: 'treecipe.runPicklistDependencyCheck', title: 'Run Picklist Dependency Check', codicon: 'check-all' },
            { commandId: 'treecipe.openPicklistDependencyExplorer', title: 'Open Picklist Dependency Explorer', codicon: 'type-hierarchy' },
            { commandId: 'treecipe.updatePicklistDependencyMetadata', title: 'Update Picklist Dependency Metadata from Specs', codicon: 'sync' }
        ]
    }
];

// A GROUP OR A COMMAND ROW. PLAIN DATA, SO IMPORTING THIS SERVICE NEEDS NOTHING OF vscode BUT ITS TYPES
export type TreecipeSideBarNode =
    | { kind: 'group', group: ITreecipeSideBarGroup }
    | { kind: 'command', sideBarCommand: ITreecipeSideBarCommand };

/*
    The view is a door to the commands, never a second code path: showing it reads one setting and
    stats one file, and runs nothing. An empty answer is what lets VS Code draw the view's welcome
    content -- the Initiate Configuration button, or the no-folder note.
*/
export class TreecipeSideBarProvider implements vscode.TreeDataProvider<TreecipeSideBarNode> {

    private readonly changeEmitter = new vscode.EventEmitter<TreecipeSideBarNode | undefined>();

    readonly onDidChangeTreeData = this.changeEmitter.event;

    private isTreecipeWorkspace = false;

    setTreecipeWorkspace(isTreecipeWorkspace: boolean) {

        this.isTreecipeWorkspace = isTreecipeWorkspace;
        this.changeEmitter.fire(undefined);

    }

    getTreeItem(node: TreecipeSideBarNode): vscode.TreeItem {

        if ( node.kind === 'group' ) {
            return new vscode.TreeItem(node.group.label, vscode.TreeItemCollapsibleState.Expanded);
        }

        const { sideBarCommand } = node;
        const treeItem = new vscode.TreeItem(sideBarCommand.title, vscode.TreeItemCollapsibleState.None);
        treeItem.iconPath = new vscode.ThemeIcon(sideBarCommand.codicon);
        treeItem.tooltip = sideBarCommand.title;
        // NO ARGUMENTS: A ROW IS THE PALETTE'S DOOR TO THE COMMAND, SO EVERY GUARD IT HAS STILL APPLIES
        treeItem.command = { command: sideBarCommand.commandId, title: sideBarCommand.title };
        return treeItem;

    }

    getChildren(node?: TreecipeSideBarNode): TreecipeSideBarNode[] {

        if ( !this.isTreecipeWorkspace ) {
            return [];
        }

        if ( !node ) {
            return TREECIPE_SIDE_BAR_GROUPS.map(group => ({ kind: 'group', group }));
        }

        return node.kind === 'group'
            ? node.group.commands.map(sideBarCommand => ({ kind: 'command', sideBarCommand }))
            : [];

    }

    dispose() {

        this.changeEmitter.dispose();

    }

}

export class TreecipeSideBarService {

    private static provider: TreecipeSideBarProvider | undefined;

    static register(subscriptions: { push(disposable: vscode.Disposable): void }) {

        const provider = new TreecipeSideBarProvider();
        this.provider = provider;

        subscriptions.push(provider);
        subscriptions.push(vscode.window.registerTreeDataProvider(TREECIPE_SIDE_BAR_VIEW_ID, provider));
        subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh()));
        subscriptions.push(vscode.workspace.onDidChangeConfiguration(configurationChange => {
            if ( configurationChange.affectsConfiguration('salesforce-data-treecipe.treecipeConfigurationPath') ) {
                this.refresh();
            }
        }));

        this.refresh();

    }

    static refresh() {

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const isTreecipeWorkspace = this.isTreecipeConfigurationPresent(workspaceRoot);

        void vscode.commands.executeCommand('setContext', TREECIPE_WORKSPACE_CONTEXT_KEY, isTreecipeWorkspace);
        this.provider?.setTreecipeWorkspace(isTreecipeWorkspace);

    }

    /*
        Read-only on purpose: ConfigurationService.resolveTreecipeConfigurationFilePath can rewrite the
        stored setting and warn, which a view drawing itself must never do. A stored path counts only
        under the same rule that resolver applies -- inside the workspace and a file.
    */
    static isTreecipeConfigurationPresent(workspaceRoot: string | undefined): boolean {

        if ( !workspaceRoot ) {
            return false;
        }

        const storedConfigurationPath = ConfigurationService.getWorkspaceScopedExtensionConfigValue('treecipeConfigurationPath');

        if ( typeof storedConfigurationPath === 'string' && storedConfigurationPath.trim() !== '' ) {
            const resolvedStoredConfigurationPath = path.resolve(workspaceRoot, storedConfigurationPath);
            if ( !ConfigurationService.getStaleTreecipeConfigurationPathReason(resolvedStoredConfigurationPath, workspaceRoot) ) {
                return true;
            }
        }

        const defaultConfigurationPath = ConfigurationService.buildDefaultTreecipeConfigurationFilePath(workspaceRoot);
        return fs.existsSync(defaultConfigurationPath) && fs.statSync(defaultConfigurationPath).isFile();

    }

}
