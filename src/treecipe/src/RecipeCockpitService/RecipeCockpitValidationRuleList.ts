import * as fs from 'fs';
import * as path from 'path';
import * as xml2js from 'xml2js';

import { SalesforceApiName } from '../SalesforceApiName/SalesforceApiName';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';
import { VALIDATION_RULE_FILE_SUFFIX, VALIDATION_RULES_DIRECTORY_NAME, ValidationRuleAnalyzerService } from '../ValidationRuleAnalyzerService/ValidationRuleAnalyzerService';

/*
    The Troubleshooting tab's Validation Rules list (#327): per tree object, each validation rule the
    project holds and what Generate Treecipe did with it. What a rule IS (active, error message,
    formula) is read from its file under the configured objects path when the list is asked for; what
    generation DID with it (the fields it constrains, applied or why not) is #324's record in the
    run's objects wrapper. Both are workspace files, so every value is type-checked and bounded, and
    the panel writes each one with textContent. No link is followed. It imports no vscode.
*/

// HOW DEEP UNDER THE OBJECTS PATH AN OBJECT FOLDER IS LOOKED FOR, AS "Generate permission set…" LOOKS
export const VALIDATION_RULE_LIST_OBJECT_SEARCH_DEPTH = 8;

// SALESFORCE ALLOWS 500 RULES AN OBJECT; A FOLDER HOLDING MORE CAME FROM NO ORG, AND THE REST ARE COUNTED, NOT READ
export const VALIDATION_RULE_LIST_MAX_RULES_PER_OBJECT = 500;

// A RULE FILE IS A FEW HUNDRED BYTES; ONE PAST THIS IS NOT READ AT ALL
export const VALIDATION_RULE_LIST_MAX_FILE_BYTES = 256 * 1024;

// SALESFORCE'S OWN LIMITS: 255 FOR <errorMessage>, 3,900 FOR <errorConditionFormula>; ONE LONGER IS CUT AND SAYS SO
export const VALIDATION_RULE_LIST_MAX_ERROR_MESSAGE_LENGTH = 255;
export const VALIDATION_RULE_LIST_MAX_FORMULA_LENGTH = 3900;
export const VALIDATION_RULE_LIST_MAX_NAME_LENGTH = 255;
export const VALIDATION_RULE_LIST_MAX_REASON_LENGTH = 1000;

export const VALIDATION_RULE_LIST_TRUNCATION_MARK = '…';

// THE READ GIVES THE EXTENSION HOST BACK EVERY THIS MANY FILES, AS THE TROUBLESHOOTING SUMMARY DOES
export const VALIDATION_RULE_LIST_YIELD_EVERY_FILES = 200;

/*
    applied: generation wrote a value inside the rule. notApplied: the rule is active and generation
    did not apply it (reasons say why). inactive: the file says <active>false</active>, so generation
    skipped it. notInRun: the file is active and the run records nothing for it -- it was added or
    activated after Generate Treecipe ran. unreadable: the file could not be read as a rule.
*/
export type ValidationRuleListStatus = 'applied' | 'notApplied' | 'inactive' | 'notInRun' | 'unreadable';

export interface IValidationRuleListEntry {
    ruleName: string;
    status: ValidationRuleListStatus;
    // FROM THE FILE: ABSENT WHEN THE FILE IS GONE OR UNREADABLE, OR DOES NOT SAY
    isActive?: boolean;
    errorMessage?: string;
    formula?: string;
    // FROM THE RUN: THE FIELDS WHOSE RECORD NAMES THE RULE, IN THE WRAPPER'S ORDER
    fieldApiNames: string[];
    reasons: string[];
    // THE RUN RECORDS THE RULE AND THE PROJECT NO LONGER HOLDS ITS FILE
    isFileMissing?: boolean;
}

export interface IValidationRuleListObject {
    objectApiName: string;
    rules: IValidationRuleListEntry[];
    // RULE FILES PAST VALIDATION_RULE_LIST_MAX_RULES_PER_OBJECT, NOT READ
    unreadRuleCount?: number;
}

export interface IValidationRuleListLocalRule {
    ruleName: string;
    // THE NAME GENERATION RECORDED THE RULE UNDER (<fullName>, ELSE THE FILE'S), UNCUT: WHAT A RUN RECORD IS MATCHED BY
    recordedName: string;
    // WHERE THE RULE'S FILE IS AND WHAT IT IS NAMED (#560), SO THE LIST'S LINKS NEED NO SECOND READ
    fileName?: string;
    filePath?: string;
    // THE FILE'S TEXT WAS READ, PARSED OR NOT: ONLY SUCH A FILE IS LINKED, SINCE THE CLICK READS IT AGAIN
    isTextRead?: boolean;
    isReadable: boolean;
    isActive?: boolean;
    errorMessage?: string;
    formula?: string;
}

// A RULE FILE AN OBJECT FOLDER LISTS (#560): ITS NAME AND WHERE IT IS
export interface IValidationRuleSourceFile {
    fileName: string;
    filePath: string;
}

export interface IValidationRuleListLocalRules {
    rules: IValidationRuleListLocalRule[];
    unreadRuleCount: number;
}

// COUNTS THE FILES ONE TREE'S READ HAS READ, SO IT CAN YIELD ACROSS OBJECTS
export interface IValidationRuleListReadProgress {
    readFileCount: number;
}

export interface IValidationRuleListRunRecord {
    fieldApiNames: string[];
    isApplied: boolean;
    reasons: string[];
}

export class RecipeCockpitValidationRuleList {

    /*
        Each wanted object's folder under the objects path: a folder named exactly as the object that
        holds a "fields" or "validationRules" folder, as Generate Treecipe's walk reads one. Folders
        are visited in name order (with "<"), so the first match is the same on every machine, and
        never through a link: a Dirent of a link is not a directory.
    */
    static findObjectDirectoryPaths(objectsDirectoryPath: string, objectApiNames: readonly string[]): Map<string, string> {

        const wantedObjectApiNames = new Set(objectApiNames);
        const objectDirectoryPaths = new Map<string, string>();

        const walk = (folderPath: string, depth: number) => {

            if ( objectDirectoryPaths.size === wantedObjectApiNames.size ) {
                return;
            }

            let folderEntries: fs.Dirent[];
            try {
                folderEntries = fs.readdirSync(folderPath, { withFileTypes: true });
            } catch {
                return;
            }

            const folderName = path.basename(folderPath);
            // AN OBJECT FOLDER HOLDS NO OTHER OBJECT, SO ITS CHILDREN ARE NEVER WALKED, WANTED OR NOT
            if ( folderEntries.some(folderEntry => folderEntry.isDirectory() && ( folderEntry.name === 'fields' || folderEntry.name === VALIDATION_RULES_DIRECTORY_NAME )) ) {
                if ( wantedObjectApiNames.has(folderName) && !objectDirectoryPaths.has(folderName) ) {
                    objectDirectoryPaths.set(folderName, folderPath);
                }
                return;
            }

            if ( depth >= VALIDATION_RULE_LIST_OBJECT_SEARCH_DEPTH ) {
                return;
            }

            folderEntries
                .filter(folderEntry => folderEntry.isDirectory() && !folderEntry.name.startsWith('.') && folderEntry.name !== 'node_modules')
                .map(folderEntry => folderEntry.name)
                .sort()
                .forEach(childName => walk(path.join(folderPath, childName), depth + 1));

        };

        walk(path.resolve(objectsDirectoryPath), 0);

        return objectDirectoryPaths;

    }

    // AN OBJECT FOLDER'S RULE FILES, IN FILE-NAME ORDER AS GENERATION READS THEM; NONE WHEN IT HAS NO validationRules FOLDER
    static async readLocalValidationRules(objectDirectoryPath: string, readProgress: IValidationRuleListReadProgress = { readFileCount: 0 }): Promise<IValidationRuleListLocalRules> {

        const rulesDirectoryPath = path.join(objectDirectoryPath, VALIDATION_RULES_DIRECTORY_NAME);
        let ruleFileNames: string[];

        try {
            // A validationRules LINK IS NOT FOLLOWED, LIKE EVERY OTHER FOLDER HERE
            if ( !fs.lstatSync(rulesDirectoryPath).isDirectory() ) {
                return { rules: [], unreadRuleCount: 0 };
            }
            ruleFileNames = fs.readdirSync(rulesDirectoryPath, { withFileTypes: true })
                .filter(ruleEntry => ruleEntry.isFile() && ValidationRuleAnalyzerService.isValidationRuleFileName(ruleEntry.name))
                .map(ruleEntry => ruleEntry.name)
                .sort();
        } catch {
            return { rules: [], unreadRuleCount: 0 };
        }

        const readFileNames = ruleFileNames.slice(0, VALIDATION_RULE_LIST_MAX_RULES_PER_OBJECT);
        const rules: IValidationRuleListLocalRule[] = [];

        for ( const ruleFileName of readFileNames ) {
            const ruleFilePath = path.join(rulesDirectoryPath, ruleFileName);
            rules.push({ ...await this.readLocalValidationRule(ruleFilePath, ruleFileName), fileName: ruleFileName, filePath: ruleFilePath });
            // xml2js SETTLES SYNCHRONOUSLY, SO ONLY A MACROTASK GIVES THE HOST BACK
            readProgress.readFileCount++;
            if ( readProgress.readFileCount % VALIDATION_RULE_LIST_YIELD_EVERY_FILES === 0 ) {
                await new Promise<void>(resolve => setImmediate(resolve));
            }
        }

        return { rules: rules, unreadRuleCount: ruleFileNames.length - readFileNames.length };

    }

    static async readLocalValidationRule(ruleFilePath: string, ruleFileName: string): Promise<IValidationRuleListLocalRule> {

        const fileRuleName = ruleFileName.slice(0, -VALIDATION_RULE_FILE_SUFFIX.length);
        const unreadable: IValidationRuleListLocalRule = { ruleName: this.boundText(fileRuleName, VALIDATION_RULE_LIST_MAX_NAME_LENGTH), recordedName: fileRuleName, isReadable: false };

        let ruleXml: string;
        try {
            if ( fs.statSync(ruleFilePath).size > VALIDATION_RULE_LIST_MAX_FILE_BYTES ) {
                return unreadable;
            }
            ruleXml = fs.readFileSync(ruleFilePath, 'utf-8');
        } catch {
            return unreadable;
        }

        return { ...await this.readValidationRuleXml(ruleXml, fileRuleName), isTextRead: true };

    }

    static async readValidationRuleXml(ruleXml: string, fileRuleName: string): Promise<IValidationRuleListLocalRule> {

        const unreadable: IValidationRuleListLocalRule = { ruleName: this.boundText(fileRuleName, VALIDATION_RULE_LIST_MAX_NAME_LENGTH), recordedName: fileRuleName, isReadable: false };

        let parsedXml: unknown;
        try {
            parsedXml = await xml2js.parseStringPromise(ruleXml);
        } catch {
            return unreadable;
        }

        const validationRule = this.asRecord(this.asRecord(parsedXml)?.ValidationRule);
        if ( !validationRule ) {
            return unreadable;
        }

        const readText = (elementName: string): string | undefined => {
            const element = validationRule[elementName];
            return Array.isArray(element) && element.length === 1 && typeof element[0] === 'string' ? element[0] : undefined;
        };

        // ValidationRuleAnalyzerService's OWN RULE, AN EMPTY <fullName> INCLUDED, SO EVERY RUN RECORD FINDS ITS FILE
        const recordedName = readText('fullName') ?? fileRuleName;
        const activeText = readText('active');
        const errorMessage = readText('errorMessage');
        const formula = readText('errorConditionFormula');

        return {
            ruleName: this.boundText(recordedName !== '' ? recordedName : fileRuleName, VALIDATION_RULE_LIST_MAX_NAME_LENGTH),
            recordedName: recordedName,
            isReadable: true,
            ...( activeText === 'true' || activeText === 'false' ? { isActive: activeText === 'true' } : {} ),
            ...( errorMessage !== undefined ? { errorMessage: this.boundText(errorMessage, VALIDATION_RULE_LIST_MAX_ERROR_MESSAGE_LENGTH) } : {} ),
            ...( formula !== undefined ? { formula: this.boundText(formula, VALIDATION_RULE_LIST_MAX_FORMULA_LENGTH) } : {} )
        };

    }

    /*
        What the run's objects wrapper records about each rule of one object: every field whose
        validationRuleConstraints name it, whether any of those records was applied, and every reason
        one was not -- the object's ValidationRulesNotApplied included. A Map, so a rule named
        __proto__ is a key like any other; a record that is not the shape #324 writes is skipped.
    */
    static readRunValidationRules(objectInfo: unknown): Map<string, IValidationRuleListRunRecord> {

        const runRecords = new Map<string, IValidationRuleListRunRecord>();
        // A FILE GENERATION COULD NOT READ IS RECORDED UNDER ITS FILE NAME; IT IS THE RULE THE FILE NAMES
        const recordOf = (recordedRuleName: string) => {
            const ruleName = recordedRuleName.endsWith(VALIDATION_RULE_FILE_SUFFIX) ? recordedRuleName.slice(0, -VALIDATION_RULE_FILE_SUFFIX.length) : recordedRuleName;
            let runRecord = runRecords.get(ruleName);
            if ( !runRecord ) {
                runRecord = { fieldApiNames: [], isApplied: false, reasons: [] };
                runRecords.set(ruleName, runRecord);
            }
            return runRecord;
        };
        const addReason = (runRecord: IValidationRuleListRunRecord, reason: unknown) => {
            const boundReason = typeof reason === 'string' && reason !== '' ? this.boundText(reason, VALIDATION_RULE_LIST_MAX_REASON_LENGTH) : undefined;
            if ( boundReason !== undefined && !runRecord.reasons.includes(boundReason) ) {
                runRecord.reasons.push(boundReason);
            }
        };

        const objectRecord = this.asRecord(objectInfo);
        const fields = Array.isArray(objectRecord?.Fields) ? objectRecord?.Fields as unknown[] : [];

        fields.forEach(field => {

            const fieldRecord = this.asRecord(field);
            const fieldApiName = fieldRecord?.fieldName;
            const constraintRecords = fieldRecord?.validationRuleConstraints;
            if ( !SalesforceApiName.isApiName(fieldApiName) || !Array.isArray(constraintRecords) ) {
                return;
            }

            constraintRecords.forEach(constraintRecord => {
                const ruleRecord = this.asRecord(constraintRecord);
                if ( !ruleRecord || !this.isRuleName(ruleRecord.ruleName) || typeof ruleRecord.applied !== 'boolean' ) {
                    return;
                }
                const runRecord = recordOf(ruleRecord.ruleName);
                if ( !runRecord.fieldApiNames.includes(fieldApiName) ) {
                    runRecord.fieldApiNames.push(fieldApiName);
                }
                if ( ruleRecord.applied ) {
                    runRecord.isApplied = true;
                } else {
                    addReason(runRecord, typeof ruleRecord.reason === 'string' ? `${fieldApiName}: ${ruleRecord.reason}` : undefined);
                }
            });

        });

        const objectNotApplied = objectRecord?.ValidationRulesNotApplied;
        ( Array.isArray(objectNotApplied) ? objectNotApplied : [] ).forEach(notApplied => {
            const notAppliedRecord = this.asRecord(notApplied);
            if ( notAppliedRecord && this.isRuleName(notAppliedRecord.ruleName) ) {
                addReason(recordOf(notAppliedRecord.ruleName), notAppliedRecord.reason);
            }
        });

        return runRecords;

    }

    /*
        One object's list: every rule file the project holds, in file order, then every rule the run
        records whose file is gone. A rule's status comes from the file first (inactive, unreadable)
        and the run second, so a rule deactivated since the run reads as inactive.
    */
    static buildObjectValidationRules(objectApiName: string,
                                        localRules: IValidationRuleListLocalRules,
                                        runRecords: ReadonlyMap<string, IValidationRuleListRunRecord>): IValidationRuleListObject {

        const listedRuleNames = new Set<string>();
        const rules: IValidationRuleListEntry[] = [];

        const describeRun = (runRecord: IValidationRuleListRunRecord | undefined): Pick<IValidationRuleListEntry, 'status' | 'reasons'> => {
            if ( !runRecord ) {
                return { status: 'notInRun', reasons: [] };
            }
            if ( runRecord.isApplied ) {
                return { status: 'applied', reasons: [] };
            }
            return { status: 'notApplied', reasons: runRecord.reasons.length > 0 ? [...runRecord.reasons] : ['it was not applied'] };
        };

        localRules.rules.forEach(localRule => {

            listedRuleNames.add(localRule.recordedName);
            const runRecord = runRecords.get(localRule.recordedName);
            const fileFields = {
                ...( localRule.isActive !== undefined ? { isActive: localRule.isActive } : {} ),
                ...( localRule.errorMessage !== undefined ? { errorMessage: localRule.errorMessage } : {} ),
                ...( localRule.formula !== undefined ? { formula: localRule.formula } : {} )
            };
            const fieldApiNames = runRecord ? [...runRecord.fieldApiNames] : [];

            if ( !localRule.isReadable ) {
                rules.push({ ruleName: localRule.ruleName, status: 'unreadable', fieldApiNames: fieldApiNames, reasons: ['the file could not be read as a validation rule'] });
            } else if ( localRule.isActive !== true ) {
                rules.push({ ruleName: localRule.ruleName, ...fileFields, status: 'inactive', fieldApiNames: fieldApiNames, reasons: [] });
            } else {
                rules.push({ ruleName: localRule.ruleName, ...fileFields, ...describeRun(runRecord), fieldApiNames: fieldApiNames });
            }

        });

        runRecords.forEach((runRecord, ruleName) => {
            if ( !listedRuleNames.has(ruleName) ) {
                rules.push({ ruleName: this.boundText(ruleName, VALIDATION_RULE_LIST_MAX_NAME_LENGTH), ...describeRun(runRecord), fieldApiNames: [...runRecord.fieldApiNames], isFileMissing: true });
            }
        });

        return {
            objectApiName: objectApiName,
            rules: rules,
            ...( localRules.unreadRuleCount > 0 ? { unreadRuleCount: localRules.unreadRuleCount } : {} )
        };

    }

    /*
        Every api-name object's run records, read once from the run's objects wrapper (as JSON.parse
        read it) and kept per model, so a model's trees share one parse. Only objects with a record
        are kept, so what is held is the rules, not the wrapper.
    */
    static readRunValidationRulesByObject(parsedWrapper: unknown): Map<string, Map<string, IValidationRuleListRunRecord>> {

        const runRulesByObject = new Map<string, Map<string, IValidationRuleListRunRecord>>();
        const objectToObjectInfoMap = this.asRecord(this.asRecord(parsedWrapper)?.ObjectToObjectInfoMap);

        Object.keys(objectToObjectInfoMap ?? {}).forEach(objectApiName => {
            if ( !SalesforceApiName.isApiName(objectApiName) ) {
                return;
            }
            const runRecords = this.readRunValidationRules(( objectToObjectInfoMap as Record<string, unknown> )[objectApiName]);
            if ( runRecords.size > 0 ) {
                runRulesByObject.set(objectApiName, runRecords);
            }
        });

        return runRulesByObject;

    }

    // THE WHOLE LIST FOR ONE TREE: ITS OBJECTS ONCE EACH, IN ITS ORDER, ONLY API NAMES
    // sourceFilePaths, WHEN GIVEN, IS FILLED WITH EACH LISTED RULE'S FILE BY pickRuleSourceFiles' RULE, FROM THE NAMES THIS READ RECORDED (#560)
    static async buildTreeValidationRules(objectsDirectoryPath: string,
                                            objectApiNames: readonly string[],
                                            runRulesByObject: ReadonlyMap<string, ReadonlyMap<string, IValidationRuleListRunRecord>>,
                                            sourceFilePaths?: { workspaceRoot: string; filePathsByRuleKey: Map<string, string> }): Promise<IValidationRuleListObject[]> {

        const listedObjectApiNames = [...new Set(objectApiNames)].filter(objectApiName => SalesforceApiName.isApiName(objectApiName));
        const objectDirectoryPaths = this.findObjectDirectoryPaths(objectsDirectoryPath, listedObjectApiNames);
        const readProgress: IValidationRuleListReadProgress = { readFileCount: 0 };
        const objects: IValidationRuleListObject[] = [];

        for ( const objectApiName of listedObjectApiNames ) {
            const objectDirectoryPath = objectDirectoryPaths.get(objectApiName);
            const localRules = objectDirectoryPath ? await this.readLocalValidationRules(objectDirectoryPath, readProgress) : { rules: [], unreadRuleCount: 0 };
            objects.push(this.buildObjectValidationRules(objectApiName, localRules, runRulesByObject.get(objectApiName) ?? new Map()));
            if ( sourceFilePaths ) {
                this.collectListedRuleSourceFiles(objectApiName, localRules, sourceFilePaths.workspaceRoot, sourceFilePaths.filePathsByRuleKey);
            }
        }

        return objects;

    }

    private static collectListedRuleSourceFiles(objectApiName: string,
                                                localRules: IValidationRuleListLocalRules,
                                                workspaceRoot: string,
                                                filePathsByRuleKey: Map<string, string>) {

        if ( !SalesforceApiName.isApiName(objectApiName) ) {
            return;
        }

        const recordedNamesByFilePath = new Map<string, string>();
        const ruleFiles: IValidationRuleSourceFile[] = [];
        localRules.rules.forEach(localRule => {
            if ( localRule.fileName !== undefined && localRule.filePath !== undefined && localRule.isTextRead ) {
                ruleFiles.push({ fileName: localRule.fileName, filePath: localRule.filePath });
                recordedNamesByFilePath.set(localRule.filePath, localRule.recordedName);
            }
        });

        const wantedRuleNames = new Set([...recordedNamesByFilePath.values()].filter(ruleName => SalesforceApiName.isApiName(ruleName)));
        const isContained = this.buildContainmentCheck(workspaceRoot);

        this.pickRuleSourceFiles(ruleFiles, wantedRuleNames, ruleFile => recordedNamesByFilePath.get(ruleFile.filePath))
            .forEach((ruleFilePath, ruleName) => {
                if ( isContained(ruleFilePath) ) {
                    filePathsByRuleKey.set(this.buildRuleSourceKey(objectApiName, ruleName), ruleFilePath);
                }
            });

    }

    // ONE RULE OF ONE OBJECT, AS THE PANEL NAMES IT TO OPEN ITS FILE (#560)
    static buildRuleSourceKey(objectApiName: string, ruleName: string): string {
        return `${objectApiName}\n${ruleName}`;
    }

    /*
        The file of each named rule (#560), keyed by buildRuleSourceKey. Source format names a rule's
        file after the rule, so <Rule>.validationRule-meta.xml is read first and taken when the name it
        is recorded under is that rule; only a rule no file is named after makes the object's other
        files be read, and a name two of those claim is left out. Only a regular file (a Dirent of a
        link is not a file) inside the workspace is kept, and only an object and rule that ARE api
        names are looked for. The workspace root's real path is resolved once per call.
    */
    static resolveRuleSourceFilePaths(objectsDirectoryPath: string,
                                        workspaceRoot: string,
                                        ruleNamesByObject: ReadonlyMap<string, readonly string[]>): Map<string, string> {

        const sourceFilePaths = new Map<string, string>();
        const wantedRuleNamesByObject = this.filterWantedRuleNames(ruleNamesByObject);

        if ( wantedRuleNamesByObject.size === 0 ) {
            return sourceFilePaths;
        }

        const isContained = this.buildContainmentCheck(workspaceRoot);
        const objectDirectoryPaths = this.findObjectDirectoryPaths(objectsDirectoryPath, [...wantedRuleNamesByObject.keys()]);

        wantedRuleNamesByObject.forEach((wantedRuleNames, objectApiName) => {

            const objectDirectoryPath = objectDirectoryPaths.get(objectApiName);
            if ( !objectDirectoryPath ) {
                return;
            }

            const rulesDirectoryPath = path.join(objectDirectoryPath, VALIDATION_RULES_DIRECTORY_NAME);
            let ruleFiles: IValidationRuleSourceFile[];
            try {
                if ( !fs.lstatSync(rulesDirectoryPath).isDirectory() ) {
                    return;
                }
                ruleFiles = fs.readdirSync(rulesDirectoryPath, { withFileTypes: true })
                    .filter(ruleEntry => ruleEntry.isFile() && ValidationRuleAnalyzerService.isValidationRuleFileName(ruleEntry.name))
                    .map(ruleEntry => ruleEntry.name)
                    .sort()
                    .slice(0, VALIDATION_RULE_LIST_MAX_RULES_PER_OBJECT)
                    .map(ruleFileName => ({ fileName: ruleFileName, filePath: path.join(rulesDirectoryPath, ruleFileName) }));
            } catch {
                return;
            }

            const recordedNames = new Map<string, string | undefined>();
            const readRecordedName = (ruleFile: IValidationRuleSourceFile) => {
                if ( !recordedNames.has(ruleFile.filePath) ) {
                    recordedNames.set(ruleFile.filePath, this.readRecordedRuleName(ruleFile.filePath, this.toFileRuleName(ruleFile.fileName)));
                }
                return recordedNames.get(ruleFile.filePath);
            };

            this.pickRuleSourceFiles(ruleFiles, wantedRuleNames, readRecordedName).forEach((ruleFilePath, ruleName) => {
                if ( isContained(ruleFilePath) ) {
                    sourceFilePaths.set(this.buildRuleSourceKey(objectApiName, ruleName), ruleFilePath);
                }
            });

        });

        return sourceFilePaths;

    }

    /*
        The one choice both the lookup and the Validation Rules list make: a wanted rule's own file when
        it is recorded under that rule, else the one file that is. readRecordedName is asked lazily, so
        the lookup reads the named files and, only for a rule no file is named after, the rest.
    */
    static pickRuleSourceFiles(ruleFiles: readonly IValidationRuleSourceFile[],
                                wantedRuleNames: ReadonlySet<string>,
                                readRecordedName: (ruleFile: IValidationRuleSourceFile) => string | undefined): Map<string, string> {

        const pickedFilePaths = new Map<string, string>();
        const ruleFilesByFileRuleName = new Map(ruleFiles.map(ruleFile => [this.toFileRuleName(ruleFile.fileName), ruleFile]));
        const unmatchedRuleNames = new Set<string>();

        wantedRuleNames.forEach(ruleName => {
            const ownRuleFile = ruleFilesByFileRuleName.get(ruleName);
            if ( ownRuleFile && readRecordedName(ownRuleFile) === ruleName ) {
                pickedFilePaths.set(ruleName, ownRuleFile.filePath);
            } else {
                unmatchedRuleNames.add(ruleName);
            }
        });

        if ( unmatchedRuleNames.size === 0 ) {
            return pickedFilePaths;
        }

        const claimingFilePaths = new Map<string, string[]>();
        ruleFiles.forEach(ruleFile => {
            const recordedName = readRecordedName(ruleFile);
            if ( recordedName !== undefined && unmatchedRuleNames.has(recordedName) ) {
                claimingFilePaths.set(recordedName, [...( claimingFilePaths.get(recordedName) ?? [] ), ruleFile.filePath]);
            }
        });
        claimingFilePaths.forEach((filePaths, ruleName) => {
            if ( filePaths.length === 1 ) {
                pickedFilePaths.set(ruleName, filePaths[0]);
            }
        });

        return pickedFilePaths;

    }

    /*
        The name a rule file is recorded under, read as readValidationRuleXml reads it (xml2js, which
        answers synchronously): <fullName> when it is one text element, else the file's own name, which
        is also what a file that does not parse is recorded under. undefined for a file whose text
        cannot be read, which is never linked.
    */
    static readRecordedRuleName(ruleFilePath: string, fileRuleName: string): string | undefined {

        const ruleXml = this.readRuleFileText(ruleFilePath);
        if ( ruleXml === undefined ) {
            return undefined;
        }

        let parsedXml: unknown;
        xml2js.parseString(ruleXml, (parseError: Error | null, parsedResult: unknown) => {
            parsedXml = parseError ? undefined : parsedResult;
        });

        const fullName = this.asRecord(this.asRecord(parsedXml)?.ValidationRule)?.fullName;
        return Array.isArray(fullName) && fullName.length === 1 && typeof fullName[0] === 'string' ? fullName[0] : fileRuleName;

    }

    // A RULE FILE'S TEXT THROUGH ONE HANDLE THAT FOLLOWS NO LINK WHERE THE PLATFORM CAN REFUSE ONE, OR undefined
    static readRuleFileText(ruleFilePath: string): string | undefined {

        let fileDescriptor: number | undefined;
        try {
            fileDescriptor = fs.openSync(ruleFilePath, fs.constants.O_RDONLY | ( fs.constants.O_NOFOLLOW ?? 0 ));
            const fileStats = fs.fstatSync(fileDescriptor);
            if ( !fileStats.isFile() || fileStats.size > VALIDATION_RULE_LIST_MAX_FILE_BYTES ) {
                return undefined;
            }
            return fs.readFileSync(fileDescriptor, 'utf-8');
        } catch {
            return undefined;
        } finally {
            if ( fileDescriptor !== undefined ) {
                fs.closeSync(fileDescriptor);
            }
        }

    }

    private static filterWantedRuleNames(ruleNamesByObject: ReadonlyMap<string, readonly string[]>): Map<string, Set<string>> {

        const wantedRuleNamesByObject = new Map<string, Set<string>>();
        ruleNamesByObject.forEach((ruleNames, objectApiName) => {
            const wantedRuleNames = new Set(ruleNames.filter(ruleName => SalesforceApiName.isApiName(ruleName)));
            if ( SalesforceApiName.isApiName(objectApiName) && wantedRuleNames.size > 0 ) {
                wantedRuleNamesByObject.set(objectApiName, wantedRuleNames);
            }
        });
        return wantedRuleNamesByObject;

    }

    // SfdxProjectService's OWN CHECK, ITS REAL RESOLVER MEMOIZED SO THE ROOT IS RESOLVED ONCE, NOT ONCE PER FILE
    private static buildContainmentCheck(workspaceRoot: string): (filePath: string) => boolean {

        const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
        const realDirectoryPaths = new Map<string, string>();
        const resolveRealDirectoryPath = (directoryPath: string) => {
            let realDirectoryPath = realDirectoryPaths.get(directoryPath);
            if ( realDirectoryPath === undefined ) {
                realDirectoryPath = SfdxProjectService.getRealDirectoryPath(directoryPath);
                realDirectoryPaths.set(directoryPath, realDirectoryPath);
            }
            return realDirectoryPath;
        };

        return (filePath: string) => SfdxProjectService.isPathContainedInWorkspace(path.resolve(filePath), resolvedWorkspaceRoot, resolveRealDirectoryPath);

    }

    private static toFileRuleName(ruleFileName: string): string {
        return ruleFileName.slice(0, -VALIDATION_RULE_FILE_SUFFIX.length);
    }

    // THE 1-BASED LINE A RULE FILE IS OPENED AT: ITS <errorConditionFormula>, ELSE ITS FIRST LINE
    static findFormulaLineNumber(ruleXml: string): number {

        const formulaLineIndex = ruleXml.split(/\r\n|\r|\n/).findIndex(ruleLine => ruleLine.includes('<errorConditionFormula>'));
        return formulaLineIndex >= 0 ? formulaLineIndex + 1 : 1;

    }

    private static isRuleName(ruleName: unknown): ruleName is string {
        return typeof ruleName === 'string';
    }

    static boundText(text: string, maximumLength: number): string {
        return text.length > maximumLength ? `${text.slice(0, maximumLength)}${VALIDATION_RULE_LIST_TRUNCATION_MARK}` : text;
    }

    private static asRecord(value: unknown): Record<string, unknown> | undefined {
        return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
    }

}
