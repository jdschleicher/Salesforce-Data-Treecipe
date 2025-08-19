import { FieldInfo, IPicklistValue } from "../ObjectInfoWrapper/FieldInfo";

import * as vscode from 'vscode';
import * as fs from 'fs';
import { DirectoryProcessor } from "../DirectoryProcessingService/DirectoryProcessor";
import { XMLFieldDetail } from "../XMLProcessingService/XMLFieldDetail";
import { XmlFileProcessor } from "../XMLProcessingService/XmlFileProcessor";

export class GlobalValueSetSingleton {

    private static instance: GlobalValueSetSingleton | null = null;
    private globalValueSets: Record<string, IPicklistValue[]>;
    private isInitialized: any;

    private constructor() {}

    async initialize(directoryProcessor, salesforceMetadataParentPath): Promise<void> {

        if ( this.isInitialized ) {
            return;
        }

        // this.globalValueSets = await this.getPicklistValueMapsFromLocalProjectGlobalValueSetDirectory();  // get the stuff
        const expectedGlobalValueSetDirectoryPath = '/globalValueSets/';
        const expectedGlobalValueSetDirectoriesPath = salesforceMetadataParentPath + expectedGlobalValueSetDirectoryPath;
         
        // IF THERE IS NO "globalValueSets" directory, stop processing
        if (!fs.existsSync(expectedGlobalValueSetDirectoriesPath)) {
            this.isInitialized = true;
            this.globalValueSets = null;
            vscode.window.showWarningMessage('No GlobalValueSets found in directory: ' + expectedGlobalValueSetDirectoriesPath);
            return;
        }
        
        const globalValueSetsTargetUri = vscode.Uri.file(expectedGlobalValueSetDirectoriesPath);
        const globalValueSetDirectoryEntries = await vscode.workspace.fs.readDirectory(globalValueSetsTargetUri);


        //    for (const [entryName, entryType] of globalValueSetDirectoryEntries) {
        
                // const fullPath = vscode.Uri.joinPath(globalValueSetsTargetUri, entryName);
                const notNeededObjectName = 'null';
                let fieldsInfo: FieldInfo[] = await directoryProcessor.processFieldsDirectory(globalValueSetsTargetUri, 
                                                                                        notNeededObjectName, 
                                                                                        null,
                                                                                        null
                                                                                    );

                this.globalValueSets["test"] = fieldsInfo[0].picklistValues;
        
        //    }

            
        this.isInitialized = true;

    }

    static addItemToRecordMap(recordMap: Record<string, any[]>, key: string, item: any) {
    
        if (key in recordMap) {
            recordMap[key].push(item);
        } else {
            recordMap[key] = [item];
        }

        return recordMap;

    }

    static getInstance(): GlobalValueSetSingleton {
        
        if (!GlobalValueSetSingleton.instance) {
            GlobalValueSetSingleton.instance = new GlobalValueSetSingleton();
        }

        return GlobalValueSetSingleton.instance;

    }

    private async getPicklistValueMapsFromLocalProjectGlobalValueSetDirectory():Promise<Record<string, IPicklistValue[]>> {

        const picklistApiNamesByPicklistValues: Record<string, IPicklistValue[]> = {};
        return await picklistApiNamesByPicklistValues;

    }

    getPicklistValueMaps() {
        return this.globalValueSets;
    }


}