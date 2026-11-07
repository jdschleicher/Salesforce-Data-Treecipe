
import * as vscode from 'vscode';
import * as fs from 'fs';
import { XmlFileProcessor } from "../XMLProcessingService/XmlFileProcessor";

import * as xml2js from 'xml2js';

interface ILoadedGlobalValueSet {
    fileName: string;
    fileXML: any;
    picklistValues: string[];
}

export class GlobalValueSetSingleton {

    private static instance: GlobalValueSetSingleton | null = null;
    private globalValueSets: Record<string, string[]>;

    private constructor() {}

    /*
        This used to take a leading boolean that gated whether it did any work at all, returning
        immediately when false. It is gone rather than renamed, because the guard protected a case
        that never existed -- nothing initializes these sets at extension startup, so there was never
        an "already initialized" run to skip -- while its name,
        isGlobalValuesInitializedOnExtensionStartUp, described a STATE where the guard read it as a
        COMMAND. Three of the four callers reasoned from the name and passed the value that silently
        disabled the call: recipe generation, and both picklist dependency paths. A parameter that no
        caller wants and that most callers get backwards is not a parameter worth keeping.

        isMissingDirectoryWarningShown stays: it lets a caller that does not NEED global value sets
        load them anyway without telling the user off for not having any. Recipe generation warns,
        because a missing directory there silently empties a picklist's options. Picklist dependency
        generation does not: a field that actually needed a set is named individually in its own skip
        warning, so the directory-level notice is noise on every project without one.
    */
    async initialize(salesforceMetadataParentPath: string,
                        isMissingDirectoryWarningShown: boolean = true): Promise<void> {

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

        /*
            Reading the sets must never take the CALLER down with it. This used to be unreachable --
            the picklist dependency callers passed the flag that returns early, and recipe generation
            does not await -- so a directory that could not be listed, or one malformed file, threw
            into nothing. Awaited from a command body it would abort the whole run over metadata that
            is supplementary: a field that actually needed a set is named individually in its own
            skip warning, which is a far better outcome than losing every other object's specs.
        */
        let globalValueSetFileEntryTuples: [string, vscode.FileType][];

        try {
            globalValueSetFileEntryTuples = await vscode.workspace.fs.readDirectory(globalValueSetsTargetUri);
        } catch {
            this.globalValueSets = null;
            return;
        }

        if ( !Array.isArray(globalValueSetFileEntryTuples) ) {
            this.globalValueSets = null;
            return;
        }

        /*
            A set's name comes from a file name or an admin-editable <masterLabel>, so it is
            untrusted text used as an object key. A plain object literal would let a set called
            "__proto__" reassign the map's prototype; a null-prototype map has no prototype to
            reassign and no inherited keys to shadow a real lookup.
        */
        this.globalValueSets = Object.create(null);

        // NAME ORDER (WITH "<"), NOT THE FILE SYSTEM'S, SO TWO SETS THAT CLAIM ONE LABEL RESOLVE THE SAME WAY ON EVERY MACHINE (#592); ONE FOLDER NEVER LISTS A NAME TWICE
        const globalValueSetFileEntriesInNameOrder = [...globalValueSetFileEntryTuples]
            .sort(([firstFileName], [secondFileName]) => ( firstFileName < secondFileName ? -1 : 1 ));
        const loadedGlobalValueSets: ILoadedGlobalValueSet[] = [];

        for (const [fileName, fileTypeEnum] of globalValueSetFileEntriesInNameOrder) {

            if ( XmlFileProcessor.isXMLFileType(fileName, fileTypeEnum) ) {

                // ONE UNREADABLE OR MALFORMED SET COSTS THAT SET, NOT EVERY OTHER SET AND NOT THE CALLING COMMAND
                try {

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

                    loadedGlobalValueSets.push({ fileName, fileXML, picklistValues: picklistValuesFromGlobalValueSet });

                }

                } catch {
                    continue;
                }

            }

        }

        this.addGlobalValueSetsUnderEveryNameTheyAreReferencedBy(loadedGlobalValueSets);

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

        Every full name is registered before any masterLabel, so a set always owns its own full name:
        when one set's label equals another's file name, the label yields whichever file is read first
        (#592). Two labels that collide go to the set whose file name sorts first.
    */
    addGlobalValueSetsUnderEveryNameTheyAreReferencedBy(loadedGlobalValueSets: ILoadedGlobalValueSet[]) {

        loadedGlobalValueSets.forEach(({ fileName, picklistValues }) => {
            this.addGlobalValueSetUnlessNameIsTaken(GlobalValueSetSingleton.getGlobalValueSetFullNameByFileName(fileName), picklistValues);
        });

        loadedGlobalValueSets.forEach(({ fileXML, picklistValues }) => {
            this.addGlobalValueSetUnlessNameIsTaken(fileXML?.GlobalValueSet?.masterLabel?.[0], picklistValues);
        });

    }

    private addGlobalValueSetUnlessNameIsTaken(globalValueSetName: unknown, picklistValues: string[]) {

        if ( typeof globalValueSetName !== 'string' || globalValueSetName.trim() === '' || globalValueSetName in this.globalValueSets ) {
            return;
        }

        this.globalValueSets[globalValueSetName] = picklistValues;

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

        /*
            A GlobalValueSet file with no <customValue> children parses to an object with no
            customValue key. Unguarded this threw a TypeError out of initialize -- which the
            fire-and-forget recipe call swallowed, but the awaited picklist dependency calls would
            surface as an aborted command over one malformed file.
        */
        if ( !Array.isArray(globalValueSet.customValue) ) {
            return picklistValuesFinal;
        }

        globalValueSet.customValue.forEach(customValueDefinitionElement => {

            /*
                An INACTIVE value cannot be selected in any org, so it is not part of the set's
                usable universe. Left in, it reaches picklist dependency generation as a declared
                value and a controlling value that unlocks nothing becomes expectNone -- against an
                org whose describe never returns it, which reports UNKNOWN_CONTROLLING_VALUE. That
                is a generated spec that must fail against correct metadata. Absent markup means
                active, which is how Salesforce reads it.
            */
            const isActiveMarkupValue = customValueDefinitionElement?.isActive?.[0];
            const isPicklistValueActive = !( isActiveMarkupValue === 'false' || isActiveMarkupValue === false );
            if ( !isPicklistValueActive ) {
                return;
            }

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