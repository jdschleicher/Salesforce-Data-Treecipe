import * as fs from 'fs';
import * as path from 'path';
import * as xml2js from 'xml2js';

import { SalesforceApiName } from '../RecipeService/SalesforceApiName';
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
    isReadable: boolean;
    isActive?: boolean;
    errorMessage?: string;
    formula?: string;
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
            rules.push(await this.readLocalValidationRule(path.join(rulesDirectoryPath, ruleFileName), ruleFileName));
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

        return this.readValidationRuleXml(ruleXml, fileRuleName);

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
    static async buildTreeValidationRules(objectsDirectoryPath: string,
                                            objectApiNames: readonly string[],
                                            runRulesByObject: ReadonlyMap<string, ReadonlyMap<string, IValidationRuleListRunRecord>>): Promise<IValidationRuleListObject[]> {

        const listedObjectApiNames = [...new Set(objectApiNames)].filter(objectApiName => SalesforceApiName.isApiName(objectApiName));
        const objectDirectoryPaths = this.findObjectDirectoryPaths(objectsDirectoryPath, listedObjectApiNames);
        const readProgress: IValidationRuleListReadProgress = { readFileCount: 0 };
        const objects: IValidationRuleListObject[] = [];

        for ( const objectApiName of listedObjectApiNames ) {
            const objectDirectoryPath = objectDirectoryPaths.get(objectApiName);
            const localRules = objectDirectoryPath ? await this.readLocalValidationRules(objectDirectoryPath, readProgress) : { rules: [], unreadRuleCount: 0 };
            objects.push(this.buildObjectValidationRules(objectApiName, localRules, runRulesByObject.get(objectApiName) ?? new Map()));
        }

        return objects;

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
