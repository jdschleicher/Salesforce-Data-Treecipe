import * as fs from 'fs';
import * as path from 'path';

import { ObjectInfoWrapper } from '../ObjectInfoWrapper/ObjectInfoWrapper';
import { SalesforceApiName } from '../RecipeService/SalesforceApiName';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';
import { ISOQLTreeQuery, SOQLQueryKind, SOQLTemplateService } from '../SOQLTemplateService/SOQLTemplateService';

/*
    The Query tab (#367): a tree's generated SOQL, the check an edited query is held to before it is
    sent, the pages an org answers read back, and the preview and the JSON and CSV files made from
    them. It imports no vscode: the cockpit owns the org prompt, the progress, the files and the
    notifications.

    Every query is the READER's, typed in the cockpit's own panel or generated from this workspace,
    and SOQL only reads, so the check below is about sending ONE statement the API can parse, not
    about what it may read. Everything the org answers is untrusted: it is type-checked here, and the
    panel writes it with textContent.
*/

export const RECIPE_COCKPIT_QUERY_MAX_LENGTH = 10000;

// THE MOST RECORDS ONE RUN FETCHES: PAST IT THE RUN STOPS AND SAYS THE RESULT WAS TRUNCATED
export const RECIPE_COCKPIT_QUERY_RECORD_CAP = 50000;

export const RECIPE_COCKPIT_QUERY_PREVIEW_ROW_LIMIT = 50;

// A PREVIEW CELL LONGER THAN THIS IS CUT: A LONG TEXT AREA IS 131,072 CHARACTERS, AND THE EXPORT HOLDS IT WHOLE
export const RECIPE_COCKPIT_QUERY_PREVIEW_CELL_MAX_LENGTH = 300;

// A CELL A SPREADSHEET WOULD READ AS A FORMULA STARTS WITH ONE OF THESE (OWASP "CSV injection")
const CSV_FORMULA_PREFIX_PATTERN = /^[=+\-@\t\r]/;

const CSV_QUOTED_CHARACTER_PATTERN = /[",\r\n]/;

// ONE LINE BREAK OR TAB IS LAYOUT; ANY OTHER CONTROL CHARACTER IN A QUERY IS A PASTE GONE WRONG
const QUERY_CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0085\u2028\u2029]/;

export const RECIPE_COCKPIT_QUERY_RESULTS_FOLDER_NAME = 'QueryResults';

// TWO EXPORTS OF ONE QUERY IN ONE SECOND TAKE <name>-2, <name>-3, ... RATHER THAN OVERWRITE THE FIRST
const QUERY_EXPORT_FILE_ATTEMPTS = 20;

export type RecipeCockpitQueryExportFormat = 'json' | 'csv';

export const RECIPE_COCKPIT_QUERY_EXPORT_FORMATS: readonly RecipeCockpitQueryExportFormat[] = Object.freeze(['json', 'csv'] as RecipeCockpitQueryExportFormat[]);

export type RecipeCockpitQueryCheck = { query: string } | { refusal: string };

export interface IRecipeCockpitQueryPageSource {
    query(soql: string): Promise<unknown>;
    queryMore(nextRecordsUrl: string): Promise<unknown>;
}

export interface IRecipeCockpitQueryResult {
    records: Record<string, unknown>[];
    // WHAT THE ORG SAID THE QUERY MATCHES, WHICH IS MORE THAN records.length WHEN THE CAP STOPPED IT
    totalSize: number;
    isTruncated: boolean;
    isCancelled: boolean;
}

export interface IRecipeCockpitQueryPreview {
    columns: string[];
    rows: string[][];
}

export class RecipeCockpitQuery {

    /*
        The wrapper JSON reduced to what SOQLTemplateService reads, every value type-checked: it is a
        file on disk. An object is kept only under an api name, in a map with no prototype, and a
        field only with a string api name and type.
    */
    static toQueryObjectsWrapper(parsedObjectsWrapper: unknown): ObjectInfoWrapper {

        const objectsWrapper = new ObjectInfoWrapper();
        objectsWrapper.ObjectToObjectInfoMap = Object.create(null);

        const objectToObjectInfoMap = this.asRecord(this.asRecord(parsedObjectsWrapper)?.ObjectToObjectInfoMap);
        if ( !objectToObjectInfoMap ) {
            return objectsWrapper;
        }

        Object.keys(objectToObjectInfoMap).forEach(objectApiName => {

            const objectInfo = this.asRecord(objectToObjectInfoMap[objectApiName]);
            if ( !objectInfo || !SalesforceApiName.isApiName(objectApiName) ) {
                return;
            }

            const fields = Array.isArray(objectInfo.Fields)
                ? objectInfo.Fields
                    .map(field => this.asRecord(field))
                    .filter((field): field is Record<string, unknown> => !!field && typeof field.fieldName === 'string' && typeof field.type === 'string')
                    .map(field => ({
                        fieldName: field.fieldName as string,
                        type: field.type as string,
                        referenceTo: typeof field.referenceTo === 'string' ? field.referenceTo : null
                    }))
                : [];

            const childObjectToFieldReferences: Record<string, string[]> = Object.create(null);
            const storedChildReferences = this.asRecord(this.asRecord(objectInfo.RelationshipDetail)?.childObjectToFieldReferences) ?? {};
            Object.keys(storedChildReferences).forEach(childObjectApiName => {
                const lookupFieldNames = storedChildReferences[childObjectApiName];
                if ( SalesforceApiName.isApiName(childObjectApiName) && Array.isArray(lookupFieldNames) ) {
                    childObjectToFieldReferences[childObjectApiName] = lookupFieldNames.filter((fieldName): fieldName is string => typeof fieldName === 'string' && SalesforceApiName.isApiName(fieldName));
                }
            });

            const recordTypesMap: Record<string, unknown> = Object.create(null);
            Object.keys(this.asRecord(objectInfo.RecordTypesMap) ?? {}).forEach(developerName => { recordTypesMap[developerName] = {}; });

            objectsWrapper.ObjectToObjectInfoMap[objectApiName] = {
                ApiName: objectApiName,
                Fields: fields,
                RelationshipDetail: { childObjectToFieldReferences: childObjectToFieldReferences },
                RecordTypesMap: recordTypesMap
            } as unknown as ObjectInfoWrapper['ObjectToObjectInfoMap'][string];

        });

        return objectsWrapper;

    }

    static listTreeQueries(parsedObjectsWrapper: unknown, treeObjectApiNames: readonly string[]): ISOQLTreeQuery[] {

        return SOQLTemplateService.listTreeQueries(this.toQueryObjectsWrapper(parsedObjectsWrapper), [...treeObjectApiNames]);

    }

    /*
        What is sent is ONE SELECT statement: trimmed, not empty, at most the length limit, one
        statement (a ";" outside a string literal is a second one, which the API refuses with a
        message less clear than this), and no control character but a tab or a line break.
    */
    static checkQueryText(candidateText: unknown): RecipeCockpitQueryCheck {

        if ( typeof candidateText !== 'string' ) {
            return { refusal: 'The query is not text.' };
        }

        const queryText = candidateText.trim();

        if ( queryText === '' ) {
            return { refusal: 'The query is empty.' };
        }

        if ( queryText.length > RECIPE_COCKPIT_QUERY_MAX_LENGTH ) {
            return { refusal: `The query is ${queryText.length} characters long, and at most ${RECIPE_COCKPIT_QUERY_MAX_LENGTH} can be sent.` };
        }

        if ( QUERY_CONTROL_CHARACTER_PATTERN.test(queryText) ) {
            return { refusal: 'The query holds a control character. Only tabs and line breaks can separate its words.' };
        }

        if ( !/^select\s/i.test(queryText) ) {
            return { refusal: 'The query must be one SOQL SELECT statement.' };
        }

        if ( this.hasStatementSeparator(queryText) ) {
            return { refusal: 'The query must be one statement: a ";" outside a quoted value starts another.' };
        }

        if ( this.isInsideStringLiteral(queryText) ) {
            return { refusal: 'The query has a quoted value that is never closed.' };
        }

        return { query: queryText };

    }

    /*
        Every page of the query, until the org says it is done, the cap is reached or the reader
        cancels. Each page is type-checked; one the org answers without a records array, or without a
        next page while saying it is not done, throws rather than reading as an empty result.
    */
    static async fetchQueryRecords(pageSource: IRecipeCockpitQueryPageSource,
                                    queryText: string,
                                    recordCap: number = RECIPE_COCKPIT_QUERY_RECORD_CAP,
                                    isCancellationRequested: () => boolean = () => false): Promise<IRecipeCockpitQueryResult> {

        const records: Record<string, unknown>[] = [];
        let page = this.readQueryPage(await pageSource.query(queryText));
        const totalSize = page.totalSize ?? page.records.length;

        for (;;) {

            for ( const pageRecord of page.records ) {
                if ( records.length >= recordCap ) {
                    return { records: records, totalSize: totalSize, isTruncated: true, isCancelled: false };
                }
                records.push(pageRecord);
            }

            if ( page.done ) {
                return { records: records, totalSize: totalSize, isTruncated: false, isCancelled: false };
            }

            if ( records.length >= recordCap ) {
                return { records: records, totalSize: totalSize, isTruncated: true, isCancelled: false };
            }

            if ( isCancellationRequested() ) {
                return { records: records, totalSize: totalSize, isTruncated: false, isCancelled: true };
            }

            if ( !page.nextRecordsUrl ) {
                throw new Error('The org said there were more records but named no page to read them from.');
            }

            page = this.readQueryPage(await pageSource.queryMore(page.nextRecordsUrl));

        }

    }

    // THE RECORDS AS THE ORG ANSWERED THEM, WITHOUT "attributes", AND A SUBQUERY AS ITS RECORDS
    static stripRecord(record: Record<string, unknown>): Record<string, unknown> {

        const strippedRecord: Record<string, unknown> = {};

        Object.keys(record).forEach(key => {
            if ( key === 'attributes' ) {
                return;
            }
            Object.defineProperty(strippedRecord, key, { value: this.stripValue(record[key]), enumerable: true, writable: true, configurable: true });
        });

        return strippedRecord;

    }

    static buildJsonExport(records: readonly Record<string, unknown>[]): string {

        return JSON.stringify(records.map(record => this.stripRecord(record)), null, 2) + '\n';

    }

    /*
        One row per record and one column per value, in the order the org first answered each: a
        parent's fields as dotted columns (Account.Name), a subquery as ONE column holding its
        records as JSON. Quoted per RFC 4180, and a text cell a spreadsheet would read as a formula
        is prefixed with a ' so opening the file runs nothing.
    */
    static buildCsvExport(records: readonly Record<string, unknown>[]): string {

        const { columns, flattenedRecords } = this.flattenRecords(records);
        const csvLines = [
            columns.map(column => this.toCsvCell(column)).join(','),
            ...flattenedRecords.map(flattenedRecord => columns.map(column => this.toCsvCell(flattenedRecord.get(column))).join(','))
        ];

        return csvLines.join('\r\n') + '\r\n';

    }

    /*
        treecipe/QueryResults/<tree folder>/<yyyyMMdd-HHmmss>-<object>-<kind>.<json|csv>, inside the
        workspace or not at all. Org data is not meant to be committed by accident, so the folder
        gets a .gitignore that ignores everything in it, written once and never overwritten, and the
        file is written with "wx", so a link planted at its name is never followed. Answers the path
        written, or undefined when nothing could be.
    */
    static writeQueryExport(workspaceRoot: string,
                            treeFolderName: string,
                            objectApiName: string,
                            queryKind: SOQLQueryKind,
                            exportFormat: RecipeCockpitQueryExportFormat,
                            exportContent: string,
                            date: Date): string | undefined {

        if ( !this.isUsableFolderName(treeFolderName) || !SalesforceApiName.isApiName(objectApiName) ) {
            return undefined;
        }

        const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
        const resultsFolderPath = path.join(resolvedWorkspaceRoot, 'treecipe', RECIPE_COCKPIT_QUERY_RESULTS_FOLDER_NAME);
        const exportFolderPath = path.join(resultsFolderPath, treeFolderName);
        const exportFilePath = path.join(exportFolderPath, `${this.buildCompactTimestamp(date)}-${objectApiName}-${queryKind}.${exportFormat}`);

        if ( !SfdxProjectService.isPathContainedInWorkspace(exportFilePath, resolvedWorkspaceRoot) ) {
            return undefined;
        }

        try {
            fs.mkdirSync(exportFolderPath, { recursive: true });
        } catch {
            return undefined;
        }

        // AGAIN ONCE THE FOLDERS EXIST: ONE OF THEM COULD HAVE BEEN A LINK MADE IN BETWEEN
        if ( !SfdxProjectService.isPathContainedInWorkspace(exportFolderPath, resolvedWorkspaceRoot) ) {
            return undefined;
        }

        try {
            fs.writeFileSync(path.join(resultsFolderPath, '.gitignore'), '*\n', { encoding: 'utf-8', flag: 'wx' });
        } catch {
            // ALREADY THERE -- OR NOT WRITABLE, WHICH THE EXPORT'S OWN WRITE WILL SAY
        }

        for ( let attempt = 1; attempt <= QUERY_EXPORT_FILE_ATTEMPTS; attempt++ ) {
            const attemptFilePath = attempt === 1 ? exportFilePath : exportFilePath.replace(new RegExp(`\\.${exportFormat}$`), `-${attempt}.${exportFormat}`);
            try {
                fs.writeFileSync(attemptFilePath, exportContent, { encoding: 'utf-8', flag: 'wx' });
                return attemptFilePath;
            } catch (writeError) {
                if ( ( writeError as NodeJS.ErrnoException )?.code !== 'EEXIST' ) {
                    return undefined;
                }
            }
        }

        return undefined;

    }

    static buildPreview(records: readonly Record<string, unknown>[], rowLimit: number = RECIPE_COCKPIT_QUERY_PREVIEW_ROW_LIMIT): IRecipeCockpitQueryPreview {

        const { columns, flattenedRecords } = this.flattenRecords(records.slice(0, rowLimit));

        return {
            columns: columns,
            rows: flattenedRecords.map(flattenedRecord => columns.map(column => {
                const cellText = this.toCellText(flattenedRecord.get(column));
                return cellText.length > RECIPE_COCKPIT_QUERY_PREVIEW_CELL_MAX_LENGTH
                    ? cellText.slice(0, RECIPE_COCKPIT_QUERY_PREVIEW_CELL_MAX_LENGTH) + '…'
                    : cellText;
            }))
        };

    }

    static flattenRecords(records: readonly Record<string, unknown>[]): { columns: string[]; flattenedRecords: Map<string, unknown>[] } {

        const columns: string[] = [];
        const seenColumns = new Set<string>();
        const flattenedRecords = records.map(record => {
            const flattenedRecord = new Map<string, unknown>();
            this.flattenInto(record, '', flattenedRecord);
            flattenedRecord.forEach((_value, column) => {
                if ( !seenColumns.has(column) ) {
                    seenColumns.add(column);
                    columns.push(column);
                }
            });
            return flattenedRecord;
        });

        return { columns: columns, flattenedRecords: flattenedRecords };

    }

    private static flattenInto(record: Record<string, unknown>, prefix: string, flattenedRecord: Map<string, unknown>) {

        Object.keys(record).forEach(key => {

            if ( key === 'attributes' ) {
                return;
            }

            const column = prefix + key;
            const value = record[key];
            const valueRecord = this.asRecord(value);

            if ( valueRecord && Array.isArray(valueRecord.records) ) {
                flattenedRecord.set(column, JSON.stringify(this.stripValue(value)));
            } else if ( valueRecord ) {
                this.flattenInto(valueRecord, column + '.', flattenedRecord);
            } else {
                flattenedRecord.set(column, value);
            }

        });

    }

    private static stripValue(value: unknown): unknown {

        if ( Array.isArray(value) ) {
            return value.map(item => this.stripValue(item));
        }

        const valueRecord = this.asRecord(value);
        if ( !valueRecord ) {
            return value;
        }

        if ( Array.isArray(valueRecord.records) ) {
            return valueRecord.records.map(subRecord => this.stripValue(subRecord));
        }

        return this.stripRecord(valueRecord);

    }

    private static toCellText(value: unknown): string {

        if ( value === null || value === undefined ) {
            return '';
        }

        return typeof value === 'object' ? JSON.stringify(value) : String(value);

    }

    private static toCsvCell(value: unknown): string {

        let cellText = this.toCellText(value);

        if ( typeof value === 'string' && CSV_FORMULA_PREFIX_PATTERN.test(cellText) ) {
            cellText = `'${cellText}`;
        }

        return CSV_QUOTED_CHARACTER_PATTERN.test(cellText) ? `"${cellText.replace(/"/g, '""')}"` : cellText;

    }

    private static readQueryPage(answer: unknown): { records: Record<string, unknown>[]; done: boolean; totalSize?: number; nextRecordsUrl?: string } {

        const page = this.asRecord(answer);

        if ( !page || !Array.isArray(page.records) ) {
            throw new Error('The org\'s answer to the query could not be read.');
        }

        return {
            records: page.records.map(pageRecord => this.asRecord(pageRecord)).filter((pageRecord): pageRecord is Record<string, unknown> => !!pageRecord),
            done: page.done !== false,
            ...( typeof page.totalSize === 'number' && Number.isSafeInteger(page.totalSize) && page.totalSize >= 0 ? { totalSize: page.totalSize } : {} ),
            ...( typeof page.nextRecordsUrl === 'string' && page.nextRecordsUrl !== '' ? { nextRecordsUrl: page.nextRecordsUrl } : {} )
        };

    }

    private static hasStatementSeparator(queryText: string): boolean {

        return this.scanOutsideStringLiterals(queryText).hasSeparator;

    }

    private static isInsideStringLiteral(queryText: string): boolean {

        return this.scanOutsideStringLiterals(queryText).isInsideLiteral;

    }

    // SOQL QUOTES A VALUE WITH ' AND ESCAPES WITH A BACKSLASH, SO A ";" OR A QUOTE AFTER ONE IS PART OF THE VALUE
    private static scanOutsideStringLiterals(queryText: string): { hasSeparator: boolean; isInsideLiteral: boolean } {

        let isInsideLiteral = false;
        let hasSeparator = false;

        for ( let characterIndex = 0; characterIndex < queryText.length; characterIndex++ ) {
            const character = queryText[characterIndex];
            if ( isInsideLiteral && character === '\\' ) {
                characterIndex++;
            } else if ( character === '\'' ) {
                isInsideLiteral = !isInsideLiteral;
            } else if ( character === ';' && !isInsideLiteral ) {
                hasSeparator = true;
            }
        }

        return { hasSeparator: hasSeparator, isInsideLiteral: isInsideLiteral };

    }

    // yyyyMMdd-HHmmss IN LOCAL TIME, AS EVERY treecipe/OrgOperations RESULT FILE IS NAMED
    static buildCompactTimestamp(date: Date): string {

        const twoDigits = (value: number) => String(value).padStart(2, '0');

        return `${date.getFullYear()}${twoDigits(date.getMonth() + 1)}${twoDigits(date.getDate())}-${twoDigits(date.getHours())}${twoDigits(date.getMinutes())}${twoDigits(date.getSeconds())}`;

    }

    private static isUsableFolderName(folderName: string): boolean {

        return folderName !== '' && folderName !== '.' && folderName !== '..' && folderName.length <= 255 && !/[\\/\u0000]/.test(folderName);

    }

    private static asRecord(value: unknown): Record<string, unknown> | undefined {

        return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

    }

}
