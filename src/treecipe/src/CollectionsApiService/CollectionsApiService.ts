import { Org } from "@salesforce/core";
import { ConfigurationService } from "../ConfigurationService/ConfigurationService";
import { VSCodeWorkspaceService } from "../VSCodeWorkspace/VSCodeWorkspaceService";

import * as vscode from 'vscode';

export class CollectionsApiService {

    static async promptForDataSetObjectsPathVSCodeQuickItems(): Promise<string | undefined> {

        const expectedFakeDataSetsPath = ConfigurationService.getFakeDataSetsFolderPath();
        const workspaceRoot = VSCodeWorkspaceService.getWorkspaceRoot();
        const generatedFakeDataSetsPath = `${workspaceRoot}/${expectedFakeDataSetsPath}`;

        let fakeDataSetDirectoryVSCodeQuickPickItems: vscode.QuickPickItem[] = [];

        while (true) {
            
            fakeDataSetDirectoryVSCodeQuickPickItems = await VSCodeWorkspaceService.getDirectoryQuickPickItemsByStartingDirectoryPath(generatedFakeDataSetsPath, fakeDataSetDirectoryVSCodeQuickPickItems);

            const selection = await vscode.window.showQuickPick(
                fakeDataSetDirectoryVSCodeQuickPickItems,
                {
                    placeHolder: 'Select Data Set directory that contains the expected CollectionsApi JSON files',
                    ignoreFocusOut: true
                }
            );

            if (!selection) {
                // IF NO SELECTION THE USER DIDN'T SELECT OR MOVED AWAY FROM SCREEN
                return undefined; 
            } else {
                return selection.label;
            }

        }
    
    }

    static getExpectedSalesforceOrgToInsertAgainst() {

        const userPromptForInputMessage = 'What Salesforce alias will the data set be inserted against? -- DO NOT USE PRODUCTION ORG';
        const salesforceOrgToInsertAgainst = VSCodeWorkspaceService.promptForUserInput(userPromptForInputMessage);
        return salesforceOrgToInsertAgainst;

    }

     static async promptForAllOrNoneInsertDecision(): Promise<string | undefined> {
            
        let items: vscode.QuickPickItem[] = [
            {
                label: 'AllOrNone: TRUE',
                description: 'If true, any insert failure will reset any successful inserts previously made',
                iconPath: new vscode.ThemeIcon('getting-started-item-checked')
            },
            {
                label: 'AllOrNone: FALSE',
                description: 'If false, all Collection Api calls will be processed and any inserts will be kept',
                iconPath: new vscode.ThemeIcon('getting-started-item-unchecked')
            }
        ];

        // while (true) {
            
            const allOrNoneSelection = await vscode.window.showQuickPick(
                items,
                {
                    placeHolder: 'Select AllOrNone preference:',
                    ignoreFocusOut: true
                }
            );

            if (!allOrNoneSelection) {
                // IF NO SELECTION THE USER DIDN'T SELECT OR MOVED AWAY FROM SCREEN
                return undefined; 
            } else {
                return allOrNoneSelection.label;
            }

        // }

    }

    static async getConnectionFromAlias(orgAlias: string) {

        const localOrgDetail = await Org.create({ aliasOrUsername: orgAlias });
        const connection = localOrgDetail.getConnection();
        
        return connection;
    }

}