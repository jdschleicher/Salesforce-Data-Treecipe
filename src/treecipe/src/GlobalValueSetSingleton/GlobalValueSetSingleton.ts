
import * as vscode from 'vscode';
import * as fs from 'fs';
import { XmlFileProcessor } from "../XMLProcessingService/XmlFileProcessor";

import * as xml2js from 'xml2js';

export class GlobalValueSetSingleton {

    private static instance: GlobalValueSetSingleton | null = null;
    private globalValueSets: Record<string, string[]>;

    private constructor() {}

    async initialize(salesforceMetadataParentPath: string, isGlobalValuesInitializedOnExtensionStartUp: boolean): Promise<void> {

        if ( !(isGlobalValuesInitializedOnExtensionStartUp) ) {
            return;
        }

        const globalValueSetDirectoryPath = '/globalValueSets/';
        const expectedGlobalValueSetDirectoriesPath = salesforceMetadataParentPath + globalValueSetDirectoryPath;
         
        // IF THERE IS NO "globalValueSets" directory, stop processing
        if (!fs.existsSync(expectedGlobalValueSetDirectoriesPath)) {
            this.globalValueSets = null;
            vscode.window.showWarningMessage('No GlobalValueSets found in directory: ' + expectedGlobalValueSetDirectoriesPath);
            return;
        }
        
        const globalValueSetsTargetUri = vscode.Uri.file(expectedGlobalValueSetDirectoriesPath);
        const globalValueSetFileEntryTuples = await vscode.workspace.fs.readDirectory(globalValueSetsTargetUri);

        this.globalValueSets = {};

        for (const [fileName, fileTypeEnum] of globalValueSetFileEntryTuples) {

            if ( XmlFileProcessor.isXMLFileType(fileName, fileTypeEnum) ) {

                const globalValueSetXMLFileContent =  await this.getGlobalValueSetPicklistXMLFileContent(globalValueSetsTargetUri, fileName);
                
                let fileXML: any;
                let parseString = xml2js.parseString;
                parseString(globalValueSetXMLFileContent, function (error, result) {

                    if (error) { 
                        throw new Error(`Error processing xmlContent ${globalValueSetXMLFileContent}:` + error);
                    }
            
                    fileXML = result;

                });
                
                const picklistValuesFromGlobalValueSet = this.extractGlobalValueSetPicklistValuesFromXMLFileContent(fileXML);

                if ( picklistValuesFromGlobalValueSet ) {

                    const gvsApiName = fileXML.GlobalValueSet.masterLabel;

                    this.globalValueSets[gvsApiName] = picklistValuesFromGlobalValueSet;
                }
                
            }

        }

    }

    async getGlobalValueSetPicklistXMLFileContent(globalValueSetsTargetUri, globalValueSetFileName ) {

        const globalValueSetFileUri = vscode.Uri.joinPath(globalValueSetsTargetUri, globalValueSetFileName);
        const globalValueSetXmlContentUriData = await vscode.workspace.fs.readFile(globalValueSetFileUri);
        const globalValueSetXmlContent = Buffer.from(globalValueSetXmlContentUriData).toString('utf8');

        return globalValueSetXmlContent;

    }

    extractGlobalValueSetPicklistValuesFromXMLFileContent(fileXML):string[] {

        let picklistValuesFinal:string[] = [];

        if ( !(fileXML?.GlobalValueSet) ) {
            /* 
                IF THERE ARE FILES IN THE GLOBAL VALUE SET DIRECTORY THAT ARE NOT ACTUAL GLOBAL
                VALUE SET FILES THEY WILL NOT HAVE THE EXPECTED GLOBALVALUESET OPENING XML TAG
                OF "GlobalValueSet"
            */
            return;
        }

        let globalValueSet = fileXML.GlobalValueSet;
        globalValueSet.customValue.forEach(customValueDefinitionElement => {
            
            const picklistOptionApiName:string = customValueDefinitionElement.fullName[0];
            picklistValuesFinal.push(picklistOptionApiName);
            
        });

        return picklistValuesFinal;
    
    }

    addItemToRecordMap(recordMap: Record<string, any[]>, key: string, item: any) {
    
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

    getPicklistValueMaps() {
        return this.globalValueSets;
    }


}