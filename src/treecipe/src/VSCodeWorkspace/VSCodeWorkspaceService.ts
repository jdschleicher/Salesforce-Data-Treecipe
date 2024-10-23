import * as vscode from 'vscode';


export class VSCodeWorkspaceService {

    static async getWorkspaceRoot() {
        const workspaceRoot:string = vscode.workspace.workspaceFolders
                                    ? vscode.workspace.workspaceFolders[0].uri.fsPath
                                    : undefined;

        return workspaceRoot;
    }

}