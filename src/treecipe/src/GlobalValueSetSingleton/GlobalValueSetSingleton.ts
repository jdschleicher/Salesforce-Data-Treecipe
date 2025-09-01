
import * as vscode from 'vscode';
import * as fs from 'fs';
import { XmlFileProcessor } from "../XMLProcessingService/XmlFileProcessor";

import * as xml2js from 'xml2js';


export class GlobalValueSetSingleton {

    private static instance: GlobalValueSetSingleton | null = null;
    private globalValueSets: Record<string, string[]>;
    private isInitialized: any;

    private constructor() {}

    async initialize(salesforceMetadataParentPath: string): Promise<void> {

        if ( this.isInitialized ) {
            return;
        }

        const globalValueSetDirectoryPath = '/globalValueSets/';
        const expectedGlobalValueSetDirectoriesPath = salesforceMetadataParentPath + globalValueSetDirectoryPath;
         
        // IF THERE IS NO "globalValueSets" directory, stop processing
        if (!fs.existsSync(expectedGlobalValueSetDirectoriesPath)) {
            this.isInitialized = true;
            this.globalValueSets = null;
            vscode.window.showWarningMessage('No GlobalValueSets found in directory: ' + expectedGlobalValueSetDirectoriesPath);
            return;
        }
        
        const globalValueSetsTargetUri = vscode.Uri.file(expectedGlobalValueSetDirectoriesPath);
        const globalValueSetFileEntryTuples = await vscode.workspace.fs.readDirectory(globalValueSetsTargetUri);

        this.globalValueSets = {};
        for (const [fileName, fileTypeEnum] of globalValueSetFileEntryTuples) {

            if ( XmlFileProcessor.isXMLFileType(fileName, fileTypeEnum) ) {

                const gvsApiName = fileName.split(".globalValueSet-meta.xml")[0];
                const picklistValues =  await this.getPicklistValuesFromGlobalValueSetXML(globalValueSetsTargetUri, gvsApiName);
                
                if ( picklistValues ) {
                    this.globalValueSets[gvsApiName] = picklistValues;
                }
                
            }

        }
            
        this.isInitialized = true;

    }

    async getPicklistValuesFromGlobalValueSetXML(globalValueSetsTargetUri, globalValueSetFileName ) {

        const fieldUri = vscode.Uri.joinPath(globalValueSetsTargetUri, globalValueSetFileName);
        const fieldXmlContentUriData = await vscode.workspace.fs.readFile(fieldUri);
        const fieldXmlContent = Buffer.from(fieldXmlContentUriData).toString('utf8');
        const picklistValuesFromGlobalValueSet = this.extractGlobalValueSetPicklistValuesFromXMLFileContent(fieldXmlContent);

        return picklistValuesFromGlobalValueSet;

    }

    extractGlobalValueSetPicklistValuesFromXMLFileContent(xmlFileContent: string):string[] {

        let picklistValuesFinal:string[] = [];

        let fieldXML: any;
        let parseString = xml2js.parseString;
        parseString(xmlFileContent, function (error, result) {

            if (error) { 
                throw new Error(`Error processing xmlContent ${xmlFileContent}:` + error);
            }
    
            fieldXML = result;

        });

        if ( !(fieldXML?.GlobalValueSet) ) {
            /* 
                IF THERE ARE FILES IN THE GLOBAL VALUE SET DIRECTORY THAT ARE NOT ACTUAL GLOBAL
                VALUE SET FILES THEY WILL NOT HAVE THE EXPECTED GLOBALVALUESET OPENING XML TAG
                OF "GlobalValueSet"
            */
            return;
        }

        let globalValueSet = fieldXML.GlobalValueSet;
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