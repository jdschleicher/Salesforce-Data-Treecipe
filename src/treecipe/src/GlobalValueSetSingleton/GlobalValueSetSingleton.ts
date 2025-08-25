
import * as vscode from 'vscode';
import * as fs from 'fs';
import { XmlFileProcessor } from "../XMLProcessingService/XmlFileProcessor";

import * as xml2js from 'xml2js';


export class GlobalValueSetSingleton {

    private static instance: GlobalValueSetSingleton | null = null;
    private globalValueSets: Record<string, string[]>;
    private isInitialized: any;

    private constructor() {}

    async initialize(salesforceMetadataParentPath): Promise<void> {

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
        const globalValueSetDirectoryEntryTuples = await vscode.workspace.fs.readDirectory(globalValueSetsTargetUri);

        for (const [fileName, directoryItemTypeEnum] of globalValueSetDirectoryEntryTuples) {
    
            if ( XmlFileProcessor.isXMLFileType(fileName, directoryItemTypeEnum) ) {
        
                const fieldUri = vscode.Uri.joinPath(globalValueSetsTargetUri, fileName);
                const fieldXmlContentUriData = await vscode.workspace.fs.readFile(fieldUri);
                const fieldXmlContent = Buffer.from(fieldXmlContentUriData).toString('utf8');
        
                const picklistValues = this.extractGlobalValueSetPicklistValuesFromXMLFileContent(fieldXmlContent);
                if ( picklistValues ) {
                    this.globalValueSets[fileName] = picklistValues;

                }
                
            }

        }

            
        this.isInitialized = true;

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
    

//     // '<?xml version="1.0" encoding="UTF-8"?>
// <GlobalValueSet xmlns="http://soap.sforce.com/2006/04/metadata">
//     <customValue>
//         <fullName>guardians</fullName>
//         <default>false</default>
//         <label>guardians</label>
//     </customValue>
//     <customValue>
//         <fullName>cavs</fullName>
//         <default>false</default>
//         <label>cavs</label>
//     </customValue>
//     <customValue>
//         <fullName>browns</fullName>
//         <default>false</default>
//         <label>browns</label>
//     </customValue>
//     <customValue>
//         <fullName>monsters</fullName>
//         <default>false</default>
//         <label>monsters</label>
//     </customValue>
//     <customValue>
//         <fullName>crunch</fullName>
//         <default>false</default>
//         <label>crunch</label>
//     </customValue>
//     <masterLabel>CLEGlobal</masterLabel>
//     <sorted>false</sorted>
// </GlobalValueSet>
// // 


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