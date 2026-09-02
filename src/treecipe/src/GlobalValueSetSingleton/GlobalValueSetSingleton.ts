
import * as vscode from 'vscode';
import * as fs from 'fs';
import { XmlFileProcessor } from "../XMLProcessingService/XmlFileProcessor";

import * as xml2js from 'xml2js';

export class GlobalValueSetSingleton {

    private static instance: GlobalValueSetSingleton | null = null;
    private globalValueSets: Record<string, string[]>;

    private constructor() {}

    /*
        isMissingDirectoryWarningShown lets a caller that does not NEED global value sets initialize
        them anyway without telling the user off for not having any. Recipe generation warns, because
        a missing directory there silently empties a picklist's options. Picklist dependency
        generation does not: a field that actually needed a set is named individually in its own skip
        warning, so the directory-level notice is noise on every project without one.
    */
    async initialize(salesforceMetadataParentPath: string,
                        isGlobalValuesInitializedOnExtensionStartUp: boolean,
                        isMissingDirectoryWarningShown: boolean = true): Promise<void> {

        if ( !(isGlobalValuesInitializedOnExtensionStartUp) ) {
            return;
        }

        const globalValueSetDirectoryPath = '/globalValueSets/';
        const expectedGlobalValueSetDirectoriesPath = salesforceMetadataParentPath + globalValueSetDirectoryPath;
         
        // IF THERE IS NO "globalValueSets" directory, stop processing
        if (!fs.existsSync(expectedGlobalValueSetDirectoriesPath)) {
            this.globalValueSets = null;
            if ( isMissingDirectoryWarningShown ) {
                vscode.window.showWarningMessage('No GlobalValueSets found in directory: ' + expectedGlobalValueSetDirectoriesPath);
            }
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

                    this.addGlobalValueSetUnderEveryNameItIsReferencedBy(fileName, fileXML, picklistValuesFromGlobalValueSet);

                }
                
            }

        }

    }

    private static globalValueSetMetadataSuffix = '.globalvalueset-meta.xml';

    /*
        A field points at a global value set by its FULL NAME -- "<valueSetName>Territory_Values</valueSetName>"
        -- which in source format is the file name, while the only name inside the file is <masterLabel>,
        an admin-editable display label. The two agree often enough that keying by masterLabel alone
        worked for the fixtures, and not at all for a set whose label was ever renamed or simply carries
        the spaces a label is allowed to have.

        Both names are registered rather than one being chosen, so a lookup by either resolves. They
        collapse to a single entry wherever they agree, which is why this reads as no change at all for
        a set that never diverged.
    */
    addGlobalValueSetUnderEveryNameItIsReferencedBy(globalValueSetFileName: string, fileXML: any, picklistValuesFromGlobalValueSet: string[]) {

        const globalValueSetFullName = GlobalValueSetSingleton.getGlobalValueSetFullNameByFileName(globalValueSetFileName);
        const globalValueSetMasterLabel = fileXML?.GlobalValueSet?.masterLabel?.[0];

        [globalValueSetFullName, globalValueSetMasterLabel].forEach(globalValueSetName => {

            if ( typeof globalValueSetName !== 'string' || globalValueSetName.trim() === '' ) {
                return;
            }

            this.globalValueSets[globalValueSetName] = picklistValuesFromGlobalValueSet;

        });

    }

    /*
        "Territory_Values.globalValueSet-meta.xml" is the full name plus the source format suffix. A
        file not carrying that suffix still yields a usable name from everything before its first dot,
        which is what the Metadata API would have called it.
    */
    static getGlobalValueSetFullNameByFileName(globalValueSetFileName: string): string {

        if ( !globalValueSetFileName ) {
            return '';
        }

        const normalizedFileName = globalValueSetFileName.toLowerCase();

        if ( normalizedFileName.endsWith(this.globalValueSetMetadataSuffix) ) {
            return globalValueSetFileName.slice(0, globalValueSetFileName.length - this.globalValueSetMetadataSuffix.length);
        }

        return globalValueSetFileName.split('.')[0];

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