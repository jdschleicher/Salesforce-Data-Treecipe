import { Config, Connection, Org } from "@salesforce/core";
import { ConfigurationService } from "../ConfigurationService/ConfigurationService";
import { VSCodeWorkspaceService } from "../VSCodeWorkspace/VSCodeWorkspaceService";

import * as vscode from 'vscode';
import * as fs from 'fs';
import path = require('path');

export class CollectionsApiService {

    static async promptForDataSetObjectsPathVSCodeQuickItems(): Promise<vscode.QuickPickItem> | undefined {

        const expectedFakeDataSetsPath = ConfigurationService.getFakeDataSetsFolderPath();
        const workspaceRoot = VSCodeWorkspaceService.getWorkspaceRoot();
        const generatedFakeDataSetsPath = `${workspaceRoot}/${expectedFakeDataSetsPath}`;

        let fakeDataSetDirectoryVSCodeQuickPickItems: vscode.QuickPickItem[] = [];

        while (true) {
            
            fakeDataSetDirectoryVSCodeQuickPickItems = await VSCodeWorkspaceService.getDataSetDirectoryQuickPickItemsByStartingDirectoryPath(generatedFakeDataSetsPath, fakeDataSetDirectoryVSCodeQuickPickItems);

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
                return selection;
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

    static async insertUpsertDataSetToSelectedOrg(datasetChildFoldersToFilesMap: Record<string, string[]>, 
                                                    recordTypeDetailFromTargetOrg: any,
                                                    aliasAuthenticationConnection: Connection) {

        const collectionsApiFilesDirectoryFolderName = ConfigurationService.getDatasetCollectionApiFilesFolderName();
        const collectionApiFiles = datasetChildFoldersToFilesMap[collectionsApiFilesDirectoryFolderName];

        for ( const collectionsApiFilePath of collectionApiFiles ) {

            const objectNameForFile = 'collectionsApi-Example_Everything__c.json';

            let collectionsApiJson = await VSCodeWorkspaceService.getFileContentByPath(collectionsApiFilePath);
            collectionsApiJson = this.updateCollectionApiDetailWithOrgRecordTypeIds(collectionsApiJson, recordTypeDetailFromTargetOrg);
            const collectionApiDataDetail = JSON.parse(collectionsApiJson);

            const result = await aliasAuthenticationConnection.sobject(objectNameForFile).create(
                            collectionApiDataDetail.records,
                            { allOrNone: true }
                        );
   

        }


   
        // get collectionsApiDiectroy

    }

    static async getDataSetChildDirectoriesNameToFilesMap(datasetDirectoryName: string): Promise<Record<string, string[]>> {

        const baseArtficactFilesDirectoryName = ConfigurationService.getBaseArtifactsFolderName();
        const datasetCollectionsApiFilesDirectoryName = ConfigurationService.getDatasetCollectionApiFilesFolderName();
        const childFoldersToRetrieveFilesFrom = [baseArtficactFilesDirectoryName, datasetCollectionsApiFilesDirectoryName];

        const childFolderToFilesMap = await this.getFilesFromChildDirectoriesBySharedParentDirectory(datasetDirectoryName, childFoldersToRetrieveFilesFrom);
        
        return childFolderToFilesMap;

    }


    static async getFilesFromChildDirectoriesBySharedParentDirectory(datasetParentDirectory: string, datasetChildDirectoriesToGetFilesFrom: string[]): Promise<Record<string, string[]>> {

        const filesByDirectory: Record<string, string[]> = {};
        for ( const childFolderName of datasetChildDirectoriesToGetFilesFrom ) {

            const fullPath = `${datasetParentDirectory}/${childFolderName}`;
            const files = await this.getFilesInDirectory(fullPath);
            filesByDirectory[childFolderName] = files;

        }
    
        return filesByDirectory;
        
    }

    static async getFilesInDirectory(directoryToGetFilesFrom: string): Promise<string[]> {

        const entries = await fs.promises.readdir(directoryToGetFilesFrom, { withFileTypes: true });
       
        const filesFromDirectory: string[] = [];
        for (const entry of entries) {
            const fullPath = path.join(directoryToGetFilesFrom, entry.name);
            if (entry.isFile()) {
                filesFromDirectory.push(fullPath);
            }
        }

        return filesFromDirectory;

    }

    static async getTreecipeObjectsWrapperDetailByDataSetDirectoriesToFilesMap(datasetChildFoldersToFilesMap: Record<string, string[]>) {
        
        const expectedObjectsInfoWrapperNamePrefix = 'originalTreecipeWrapper';
        const baseArtifactFilesDirectory = ConfigurationService.getBaseArtifactsFolderName();

        const originalTreecipeWrapperFilePath = datasetChildFoldersToFilesMap[baseArtifactFilesDirectory].filter(
            fileName => fileName.includes(expectedObjectsInfoWrapperNamePrefix)
        );

        const treecipeObjectInfoWrapperJson = await VSCodeWorkspaceService.getFileContentByPath(originalTreecipeWrapperFilePath[0]);
        const treecipeObjectInfoWrapperDetail = JSON.parse(treecipeObjectInfoWrapperJson);

        return treecipeObjectInfoWrapperDetail;

    }

    static updateCollectionApiDetailWithOrgRecordTypeIds(collectionsApiJson: string, recordTypeDetailFromTargetOrg: any): any {
    
        for ( const recordTypeInfo of recordTypeDetailFromTargetOrg.records ) {

            const objectName = recordTypeInfo.SObjectType;
            const recordTypeDeveloperName = recordTypeInfo.DeveloperName;
            const recordTypeIdForOrg = recordTypeInfo.Id;

            const recordTypeIdentifierToReplace = `${objectName}.${recordTypeDeveloperName}`;
            collectionsApiJson.replace(recordTypeIdentifierToReplace, recordTypeIdForOrg);

        }

        return collectionsApiJson;
    
    }




}