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
    isReadable: boolean;
    isActive?: boolean;
    errorMessage?: string;
    formula?: string;
}

export interface IValidationRuleListLocalRules {
    rules: IValidationRuleListLocalRule[];
    unreadRuleCount: number;
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
    static async readLocalValidationRules(objectDirectoryPath: string): Promise<IValidationRuleListLocalRules> {

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
        }

        return { rules: rules, unreadRuleCount: ruleFileNames.length - readFileNames.length };

    }

    static async readLocalValidationRule(ruleFilePath: string, ruleFileName: string): Promise<IValidationRuleListLocalRule> {

        const fileRuleName = this.boundText(ruleFileName.slice(0, -VALIDATION_RULE_FILE_SUFFIX.length), VALIDATION_RULE_LIST_MAX_NAME_LENGTH);
        const unreadable: IValidationRuleListLocalRule = { ruleName: fileRuleName, isReadable: false };

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

        let parsedXml: unknown;
        try {
            parsedXml = await xml2js.parseStringPromise(ruleXml);
        } catch {
            return { ruleName: fileRuleName, isReadable: false };
        }

        const validationRule = this.asRecord(this.asRecord(parsedXml)?.ValidationRule);
        if ( !validationRule ) {
            return { ruleName: fileRuleName, isReadable: false };
        }

        const readText = (elementName: string): string | undefined => {
            const element = validationRule[elementName];
            return Array.isArray(element) && element.length === 1 && typeof element[0] === 'string' ? element[0] : undefined;
        };

        // THE SAME NAME GENERATION RECORDS A RULE UNDER: <fullName>, ELSE THE FILE'S
        const fullName = readText('fullName');
        const activeText = readText('active');
        const errorMessage = readText('errorMessage');
        const formula = readText('errorConditionFormula');

        return {
            ruleName: fullName !== undefined && fullName !== '' ? this.boundText(fullName, VALIDATION_RULE_LIST_MAX_NAME_LENGTH) : fileRuleName,
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
        const recordOf = (ruleName: string) => {
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

            listedRuleNames.add(localRule.ruleName);
            const runRecord = runRecords.get(localRule.ruleName);
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
                rules.push({ ruleName: ruleName, ...describeRun(runRecord), fieldApiNames: [...runRecord.fieldApiNames], isFileMissing: true });
            }
        });

        return {
            objectApiName: objectApiName,
            rules: rules,
            ...( localRules.unreadRuleCount > 0 ? { unreadRuleCount: localRules.unreadRuleCount } : {} )
        };

    }

    /*
        The whole list for one tree: its objects once each, in its order, only api names. parsedWrapper
        is the run's objects wrapper as JSON.parse read it.
    */
    static async buildTreeValidationRules(objectsDirectoryPath: string, objectApiNames: readonly string[], parsedWrapper: unknown): Promise<IValidationRuleListObject[]> {

        const listedObjectApiNames = [...new Set(objectApiNames)].filter(objectApiName => SalesforceApiName.isApiName(objectApiName));
        const objectDirectoryPaths = this.findObjectDirectoryPaths(objectsDirectoryPath, listedObjectApiNames);
        const objectToObjectInfoMap = this.asRecord(this.asRecord(parsedWrapper)?.ObjectToObjectInfoMap);
        const objects: IValidationRuleListObject[] = [];

        for ( const objectApiName of listedObjectApiNames ) {
            const objectDirectoryPath = objectDirectoryPaths.get(objectApiName);
            const localRules = objectDirectoryPath ? await this.readLocalValidationRules(objectDirectoryPath) : { rules: [], unreadRuleCount: 0 };
            const objectInfo = objectToObjectInfoMap && Object.prototype.hasOwnProperty.call(objectToObjectInfoMap, objectApiName) ? objectToObjectInfoMap[objectApiName] : undefined;
            objects.push(this.buildObjectValidationRules(objectApiName, localRules, this.readRunValidationRules(objectInfo)));
        }

        return objects;

    }

    private static isRuleName(ruleName: unknown): ruleName is string {
        return typeof ruleName === 'string' && ruleName !== '' && ruleName.length <= VALIDATION_RULE_LIST_MAX_NAME_LENGTH;
    }

    static boundText(text: string, maximumLength: number): string {
        return text.length > maximumLength ? `${text.slice(0, maximumLength)}${VALIDATION_RULE_LIST_TRUNCATION_MARK}` : text;
    }

    private static asRecord(value: unknown): Record<string, unknown> | undefined {
        return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
    }

}
