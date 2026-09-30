/*
    The Recipe Cockpit's recipe writer: recipe text in, recipe text out.

    This file imports NOTHING, for the same reason RecipeCockpitMetadataDiff does: it cannot reach
    the disk, a webview, vscode or an org, so every edit is asserted on plain strings.

    It patches LINES rather than round-tripping YAML. Both faker backends write recipes as template
    strings, and the "### TODO" comments in them carry meaning -- which record type to pick, which
    lookup needs a reference. js-yaml drops every comment on dump, so a load and dump would delete
    them all. The writer instead holds to the layout contract RecipeCockpitService.parseRecipeSource
    reads: "- object: X" at column zero, "  fields:" under it, one field per line at exactly four
    spaces, anything deeper as the continuation of the field above, and a comment at one to four
    spaces as neither. A field's lines are its own line and its continuation lines; every other
    line of the file is left byte for byte as it was found, and so are its line endings.

    Unlike the reader, the writer never takes the first occurrence. First-wins is the right rule for
    jumping to a line and the wrong one for changing it: an object written twice, a field written
    twice or a second "fields:" block is REFUSED, because either copy could be the one the reader
    meant.
*/

export type RecipeWriterOperation = 'insert-field' | 'replace-field-value' | 'comment-out-field' | 'restore-commented-out-field' | 'set-object-property';

export type RecipeObjectProperty = 'nickname' | 'count';

export type RecipeWriterRefusalReason =
    | 'invalid-object-api-name'
    | 'invalid-field-api-name'
    | 'invalid-value'
    | 'object-not-found'
    | 'duplicate-object'
    | 'fields-block-not-found'
    | 'duplicate-fields-block'
    | 'field-not-found'
    | 'duplicate-field'
    | 'field-already-exists'
    | 'commented-out-field-not-found'
    | 'duplicate-commented-out-field'
    | 'unsupported-field-layout'
    | 'commented-out-field-altered'
    | 'property-not-found'
    | 'duplicate-property';

export interface IRecipeWriterRefusal {
    reason: RecipeWriterRefusalReason;
    message: string;
    objectApiName: string;
    fieldApiName?: string;
    propertyName?: RecipeObjectProperty;
}

/*
    What one operation changed, by line. startLineNumber is 1-based and is the same in the old text
    and the new one, since everything before it is untouched. Nothing was removed by an insert and
    nothing but the replacement lines was inserted by the others.
*/
export interface IRecipeWriterEdit {
    operation: RecipeWriterOperation;
    objectApiName: string;
    fieldApiName?: string;
    propertyName?: RecipeObjectProperty;
    startLineNumber: number;
    removedLines: string[];
    insertedLines: string[];
}

export type RecipeWriterResult =
    | { isApplied: true; recipeText: string; edit: IRecipeWriterEdit }
    | { isApplied: false; refusal: IRecipeWriterRefusal };

export interface IRecipeLines {
    lines: string[];
    // THE TERMINATOR AFTER EACH LINE, EXACTLY AS FOUND -- '' AFTER THE LAST ONE
    lineEndings: string[];
}

// [startIndex, endIndex) OVER THE FILE'S LINES
export interface ILineSpan {
    startIndex: number;
    endIndex: number;
}

export interface IScannedField extends ILineSpan {
    fieldApiName: string;
}

export interface IScannedObject {
    objectApiName: string;
    headerIndex: number;
    fieldsLineIndexes: number[];
    fields: IScannedField[];
    // THE LAST NON-BLANK LINE OF THE FIELDS BLOCK -- A FIELD, A CONTINUATION OR A COMMENT -- WHICH IS WHERE AN INSERT GOES AFTER
    lastFieldsBlockLineIndex: number;
    propertyLineIndexes: Record<RecipeObjectProperty, number[]>;
    commentedOutFieldMarkers: IScannedField[];
}

const FIELD_INDENT = '    ';
const PROPERTY_INDENT = '  ';
const COMMENT_PREFIX = `${FIELD_INDENT}#`;
const COMMENTED_OUT_MARKER_PREFIX = `${FIELD_INDENT}### TODO -- RECIPE COCKPIT -- FIELD COMMENTED OUT -- `;

const OBJECT_HEADER_PATTERN = /^- object:\s*(\S+)\s*$/;
const FIELD_LINE_PATTERN = /^ {4}([A-Za-z][A-Za-z0-9_]*):(.*)$/;
const CONTINUATION_LINE_PATTERN = /^ {5,}\S/;
const FIELDS_BLOCK_COMMENT_PATTERN = /^ {1,4}#/;
const FIELDS_LINE_PATTERN = /^ {2}fields:\s*$/;
const PROPERTY_LINE_PATTERN = /^ {2}(nickname|count):/;
const API_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

export class RecipeCockpitRecipeWriter {

    static readonly COMMENTED_OUT_MARKER_PREFIX = COMMENTED_OUT_MARKER_PREFIX;

    /*
        valueText is what follows "Field: ", exactly as the faker services build a field's recipe:
        one line, or a first line followed by lines indented five spaces or more. A value that
        starts with a newline -- the dependent-picklist "if:" block -- leaves "Field: " with its
        trailing space, as RecipeService.appendFieldRecipeToObjectRecipe writes it.
    */
    static insertField(recipeText: string, objectApiName: string, fieldApiName: string, valueText: string): RecipeWriterResult {

        const located = this.locateObject(recipeText, objectApiName, fieldApiName);
        if ( 'refusal' in located ) {
            return located;
        }
        const { recipeLines, scannedObject } = located;

        const fieldsBlockRefusal = this.refuseUnlessOneFieldsBlock(scannedObject, fieldApiName);
        if ( fieldsBlockRefusal ) {
            return fieldsBlockRefusal;
        }

        if ( scannedObject.fields.some(scannedField => scannedField.fieldApiName === fieldApiName) ) {
            return this.refuse('field-already-exists', `${objectApiName} already has a ${fieldApiName} line, so it is not inserted again.`, objectApiName, fieldApiName);
        }

        const fieldLines = this.buildFieldLines(fieldApiName, valueText);
        if ( !fieldLines ) {
            return this.refuseInvalidValue(objectApiName, fieldApiName);
        }

        const insertAfterIndex = scannedObject.lastFieldsBlockLineIndex;

        return this.applySplice(recipeLines, { startIndex: insertAfterIndex + 1, endIndex: insertAfterIndex + 1 }, fieldLines, {
            operation: 'insert-field',
            objectApiName: objectApiName,
            fieldApiName: fieldApiName
        });

    }

    static replaceFieldValue(recipeText: string, objectApiName: string, fieldApiName: string, valueText: string): RecipeWriterResult {

        const located = this.locateField(recipeText, objectApiName, fieldApiName);
        if ( 'refusal' in located ) {
            return located;
        }

        const fieldLines = this.buildFieldLines(fieldApiName, valueText);
        if ( !fieldLines ) {
            return this.refuseInvalidValue(objectApiName, fieldApiName);
        }

        return this.applySplice(located.recipeLines, located.scannedField, fieldLines, {
            operation: 'replace-field-value',
            objectApiName: objectApiName,
            fieldApiName: fieldApiName
        });

    }

    /*
        The field's own lines become "    # " followed by the line without its first four spaces,
        under a marker that names the field and HOW MANY lines follow it. Every line of a field
        starts with four spaces (a field line has exactly four, a continuation five or more) except
        an empty line inside it, which becomes "    #". That encoding has one inverse, so
        restoreCommentedOutField gives back the field byte for byte; a whitespace-only line of one
        to three spaces has no place in it, and the field is refused rather than restored as
        something else. The count is what bounds the restore: without it, a comment of the reader's
        own directly below would read as more of the field. The lines sit at four spaces rather
        than deeper, because deeper lines would read as the continuation of the field above them.
    */
    static commentOutField(recipeText: string, objectApiName: string, fieldApiName: string, reason: string): RecipeWriterResult {

        const located = this.locateField(recipeText, objectApiName, fieldApiName);
        if ( 'refusal' in located ) {
            return located;
        }
        const { recipeLines, scannedField } = located;

        const fieldLines = recipeLines.lines.slice(scannedField.startIndex, scannedField.endIndex);

        if ( fieldLines.some(fieldLine => fieldLine && !fieldLine.startsWith(FIELD_INDENT)) ) {
            return this.refuse('unsupported-field-layout', `${objectApiName}.${fieldApiName} has a line of one to three spaces inside it, which commenting out could not give back exactly.`, objectApiName, fieldApiName);
        }

        // EVERY LINE BREAK PyYAML READS -- U+0085 IS NOT IN \s -- AND EVERY CONTROL CHARACTER, SO THE REASON CANNOT END THE COMMENT
        const singleLineReason = reason.replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
        const lineCountText = `${fieldLines.length} ${fieldLines.length === 1 ? 'line' : 'lines'}`;
        const markerLine = `${COMMENTED_OUT_MARKER_PREFIX}${fieldApiName} -- ${lineCountText}${singleLineReason ? ` -- ${singleLineReason}` : ''}`;
        const commentedLines = fieldLines.map(fieldLine => (
            fieldLine ? `${COMMENT_PREFIX} ${fieldLine.slice(FIELD_INDENT.length)}` : COMMENT_PREFIX
        ));

        return this.applySplice(recipeLines, scannedField, [markerLine, ...commentedLines], {
            operation: 'comment-out-field',
            objectApiName: objectApiName,
            fieldApiName: fieldApiName
        });

    }

    static restoreCommentedOutField(recipeText: string, objectApiName: string, fieldApiName: string): RecipeWriterResult {

        const located = this.locateObject(recipeText, objectApiName, fieldApiName);
        if ( 'refusal' in located ) {
            return located;
        }
        const { recipeLines, scannedObject } = located;

        if ( scannedObject.fields.some(scannedField => scannedField.fieldApiName === fieldApiName) ) {
            return this.refuse('field-already-exists', `${objectApiName} already has a ${fieldApiName} line, so the commented-out one is not restored over it.`, objectApiName, fieldApiName);
        }

        const markers = scannedObject.commentedOutFieldMarkers.filter(marker => marker.fieldApiName === fieldApiName);

        if ( markers.length === 0 ) {
            return this.refuse('commented-out-field-not-found', `${objectApiName} has no ${fieldApiName} commented out by the Recipe Cockpit.`, objectApiName, fieldApiName);
        }

        if ( markers.length > 1 ) {
            return this.refuse('duplicate-commented-out-field', `${objectApiName} has ${fieldApiName} commented out more than once, so which to restore cannot be told.`, objectApiName, fieldApiName);
        }

        const [marker] = markers;
        const restoredLines = this.readCommentedOutFieldLines(recipeLines.lines, marker);

        if ( !restoredLines ) {
            return this.refuse('commented-out-field-altered', `The lines under ${objectApiName}'s ${fieldApiName} marker are not the ones commenting it out wrote, so restoring them could not give the field back exactly.`, objectApiName, fieldApiName);
        }

        return this.applySplice(recipeLines, marker, restoredLines, {
            operation: 'restore-commented-out-field',
            objectApiName: objectApiName,
            fieldApiName: fieldApiName
        });

    }

    static setObjectProperty(recipeText: string, objectApiName: string, propertyName: RecipeObjectProperty, value: string | number): RecipeWriterResult {

        const located = this.locateObject(recipeText, objectApiName);
        if ( 'refusal' in located ) {
            return located;
        }
        const { recipeLines, scannedObject } = located;

        const propertyValueText = this.buildPropertyValueText(propertyName, value);
        if ( propertyValueText === undefined ) {
            return {
                isApplied: false,
                refusal: {
                    reason: 'invalid-value',
                    message: propertyName === 'count'
                        ? `The count for ${objectApiName} must be a whole number of zero or more.`
                        : `The nickname for ${objectApiName} must be a name of letters, digits and underscores, starting with a letter.`,
                    objectApiName: objectApiName,
                    propertyName: propertyName
                }
            };
        }

        const propertyLineIndexes = scannedObject.propertyLineIndexes[propertyName];

        if ( propertyLineIndexes.length !== 1 ) {
            return {
                isApplied: false,
                refusal: {
                    reason: propertyLineIndexes.length === 0 ? 'property-not-found' : 'duplicate-property',
                    message: propertyLineIndexes.length === 0
                        ? `${objectApiName} has no "${propertyName}:" line to set.`
                        : `${objectApiName} has more than one "${propertyName}:" line, so which to set cannot be told.`,
                    objectApiName: objectApiName,
                    propertyName: propertyName
                }
            };
        }

        const [propertyLineIndex] = propertyLineIndexes;

        return this.applySplice(recipeLines, { startIndex: propertyLineIndex, endIndex: propertyLineIndex + 1 }, [`${PROPERTY_INDENT}${propertyName}: ${propertyValueText}`], {
            operation: 'set-object-property',
            objectApiName: objectApiName,
            propertyName: propertyName
        });

    }

    static splitRecipeLines(recipeText: string): IRecipeLines {

        const lines: string[] = [];
        const lineEndings: string[] = [];
        const lineEndingPattern = /\r\n|\n/g;

        let lineStartIndex = 0;
        let lineEndingMatch: RegExpExecArray | null;

        while ( (lineEndingMatch = lineEndingPattern.exec(recipeText)) !== null ) {
            lines.push(recipeText.slice(lineStartIndex, lineEndingMatch.index));
            lineEndings.push(lineEndingMatch[0]);
            lineStartIndex = lineEndingMatch.index + lineEndingMatch[0].length;
        }

        lines.push(recipeText.slice(lineStartIndex));
        lineEndings.push('');

        return { lines: lines, lineEndings: lineEndings };

    }

    static joinRecipeLines(recipeLines: IRecipeLines): string {
        return recipeLines.lines.map((line, lineIndex) => `${line}${recipeLines.lineEndings[lineIndex]}`).join('');
    }

    /*
        Every object in the file, in the order written, duplicates included. The walk is
        parseRecipeSource's, line for line; where they differ it is only that this one keeps what
        the reader discards -- the second occurrences, the spans, the "nickname:" and "count:"
        lines and the markers commentOutField leaves.
    */
    static scanRecipeObjects(lines: string[]): IScannedObject[] {

        const scannedObjects: IScannedObject[] = [];

        let currentObject: IScannedObject | undefined;
        let currentField: IScannedField | undefined;
        let isInFieldsBlock = false;

        const closeCurrentField = () => {
            currentField = undefined;
        };

        lines.forEach((recipeLine, lineIndex) => {

            const objectMatch = OBJECT_HEADER_PATTERN.exec(recipeLine);

            if ( objectMatch ) {
                closeCurrentField();
                isInFieldsBlock = false;
                currentObject = {
                    objectApiName: objectMatch[1],
                    headerIndex: lineIndex,
                    fieldsLineIndexes: [],
                    fields: [],
                    lastFieldsBlockLineIndex: -1,
                    propertyLineIndexes: { nickname: [], count: [] },
                    commentedOutFieldMarkers: []
                };
                scannedObjects.push(currentObject);
                return;
            }

            if ( !currentObject || !recipeLine.trim() ) {
                return;
            }

            const fieldMatch = FIELD_LINE_PATTERN.exec(recipeLine);

            if ( isInFieldsBlock && fieldMatch ) {
                closeCurrentField();
                currentField = { fieldApiName: fieldMatch[1], startIndex: lineIndex, endIndex: lineIndex + 1 };
                currentObject.fields.push(currentField);
                currentObject.lastFieldsBlockLineIndex = lineIndex;
                return;
            }

            if ( isInFieldsBlock && CONTINUATION_LINE_PATTERN.test(recipeLine) ) {
                if ( currentField ) {
                    currentField.endIndex = lineIndex + 1;
                }
                currentObject.lastFieldsBlockLineIndex = lineIndex;
                return;
            }

            if ( isInFieldsBlock && FIELDS_BLOCK_COMMENT_PATTERN.test(recipeLine) ) {
                const commentedOutFieldMarker = this.readCommentedOutFieldMarker(recipeLine, lineIndex);
                if ( commentedOutFieldMarker ) {
                    currentObject.commentedOutFieldMarkers.push(commentedOutFieldMarker);
                }
                currentField = undefined;
                currentObject.lastFieldsBlockLineIndex = lineIndex;
                return;
            }

            closeCurrentField();
            isInFieldsBlock = FIELDS_LINE_PATTERN.test(recipeLine);

            if ( isInFieldsBlock ) {
                currentObject.fieldsLineIndexes.push(lineIndex);
                currentObject.lastFieldsBlockLineIndex = lineIndex;
                return;
            }

            const propertyMatch = PROPERTY_LINE_PATTERN.exec(recipeLine);
            if ( propertyMatch ) {
                currentObject.propertyLineIndexes[propertyMatch[1] as RecipeObjectProperty].push(lineIndex);
                return;
            }

            if ( /^\S/.test(recipeLine) ) {
                currentObject = undefined;
            }

        });

        return scannedObjects;

    }

    // THE SPAN IS THE MARKER AND THE LINE COUNT IT DECLARES, WHETHER OR NOT THOSE LINES ARE STILL THERE -- readCommentedOutFieldLines DECIDES THAT
    private static readCommentedOutFieldMarker(recipeLine: string, lineIndex: number): IScannedField | undefined {

        if ( !recipeLine.startsWith(COMMENTED_OUT_MARKER_PREFIX) ) {
            return undefined;
        }

        const markerMatch = /^([A-Za-z][A-Za-z0-9_]*) -- (\d{1,9}) lines?(?: -- |$)/.exec(recipeLine.slice(COMMENTED_OUT_MARKER_PREFIX.length));

        return markerMatch
            ? { fieldApiName: markerMatch[1], startIndex: lineIndex, endIndex: lineIndex + 1 + Number(markerMatch[2]) }
            : undefined;

    }

    /*
        The field's lines under a marker, uncommented -- or undefined unless they are exactly what
        commentOutField writes: the declared number of commented lines, the first the field's own
        line, the rest continuations or blank, and the last not blank.
    */
    private static readCommentedOutFieldLines(lines: string[], marker: IScannedField): string[] | undefined {

        const commentedLines = lines.slice(marker.startIndex + 1, marker.endIndex);

        if ( commentedLines.length === 0 || marker.endIndex > lines.length || !commentedLines.every(commentedLine => this.isCommentedLine(commentedLine)) ) {
            return undefined;
        }

        const [fieldLine, ...continuationLines] = commentedLines.map(commentedLine => this.uncommentLine(commentedLine));

        if ( !fieldLine.startsWith(`${FIELD_INDENT}${marker.fieldApiName}:`) ) {
            return undefined;
        }

        if ( !continuationLines.every(continuationLine => this.isBlankFieldLine(continuationLine) || CONTINUATION_LINE_PATTERN.test(continuationLine)) ) {
            return undefined;
        }

        if ( continuationLines.length > 0 && !continuationLines[continuationLines.length - 1].trim() ) {
            return undefined;
        }

        return [fieldLine, ...continuationLines];

    }

    // THE ONLY BLANK LINES commentOutField CAN GIVE BACK EXACTLY: EMPTY, OR WHITESPACE BEHIND AT LEAST THE FIELD INDENT
    private static isBlankFieldLine(recipeLine: string): boolean {
        return !recipeLine || ( recipeLine.startsWith(FIELD_INDENT) && !recipeLine.trim() );
    }

    private static isCommentedLine(recipeLine: string): boolean {
        return recipeLine === COMMENT_PREFIX || recipeLine.startsWith(`${COMMENT_PREFIX} `);
    }

    private static uncommentLine(commentedLine: string): string {
        return commentedLine === COMMENT_PREFIX ? '' : `${FIELD_INDENT}${commentedLine.slice(COMMENT_PREFIX.length + 1)}`;
    }

    private static locateObject(recipeText: string, objectApiName: string, fieldApiName?: string):
        { recipeLines: IRecipeLines; scannedObject: IScannedObject } | { isApplied: false; refusal: IRecipeWriterRefusal } {

        if ( !API_NAME_PATTERN.test(objectApiName) ) {
            return this.refuse('invalid-object-api-name', `"${objectApiName}" is not an object api name.`, objectApiName, fieldApiName);
        }

        if ( fieldApiName !== undefined && !API_NAME_PATTERN.test(fieldApiName) ) {
            return this.refuse('invalid-field-api-name', `"${fieldApiName}" is not a field api name.`, objectApiName, fieldApiName);
        }

        const recipeLines = this.splitRecipeLines(recipeText);
        const scannedObjects = this.scanRecipeObjects(recipeLines.lines).filter(scannedObject => scannedObject.objectApiName === objectApiName);

        if ( scannedObjects.length === 0 ) {
            return this.refuse('object-not-found', `The recipe has no "- object: ${objectApiName}" line.`, objectApiName, fieldApiName);
        }

        if ( scannedObjects.length > 1 ) {
            return this.refuse('duplicate-object', `The recipe has ${scannedObjects.length} "- object: ${objectApiName}" lines, so which to change cannot be told.`, objectApiName, fieldApiName);
        }

        return { recipeLines: recipeLines, scannedObject: scannedObjects[0] };

    }

    private static locateField(recipeText: string, objectApiName: string, fieldApiName: string):
        { recipeLines: IRecipeLines; scannedField: IScannedField } | { isApplied: false; refusal: IRecipeWriterRefusal } {

        const located = this.locateObject(recipeText, objectApiName, fieldApiName);
        if ( 'refusal' in located ) {
            return located;
        }

        const fieldsBlockRefusal = this.refuseUnlessOneFieldsBlock(located.scannedObject, fieldApiName);
        if ( fieldsBlockRefusal ) {
            return fieldsBlockRefusal;
        }

        const scannedFields = located.scannedObject.fields.filter(scannedField => scannedField.fieldApiName === fieldApiName);

        if ( scannedFields.length === 0 ) {
            return this.refuse('field-not-found', `${objectApiName} has no ${fieldApiName} line in its fields.`, objectApiName, fieldApiName);
        }

        if ( scannedFields.length > 1 ) {
            return this.refuse('duplicate-field', `${objectApiName} has ${fieldApiName} more than once, so which to change cannot be told.`, objectApiName, fieldApiName);
        }

        return { recipeLines: located.recipeLines, scannedField: scannedFields[0] };

    }

    private static refuseUnlessOneFieldsBlock(scannedObject: IScannedObject, fieldApiName: string): { isApplied: false; refusal: IRecipeWriterRefusal } | undefined {

        if ( scannedObject.fieldsLineIndexes.length === 0 ) {
            return this.refuse('fields-block-not-found', `${scannedObject.objectApiName} has no "  fields:" line.`, scannedObject.objectApiName, fieldApiName);
        }

        if ( scannedObject.fieldsLineIndexes.length > 1 ) {
            return this.refuse('duplicate-fields-block', `${scannedObject.objectApiName} has more than one "  fields:" line, so which to change cannot be told.`, scannedObject.objectApiName, fieldApiName);
        }

        return undefined;

    }

    /*
        undefined when the value would not read back as this one field: every line after the first
        must be a continuation (five spaces or more) or a blank commentOutField can give back, and
        the last must not be blank, since a trailing blank line is the gap between fields rather
        than part of one. A bare CR and the Unicode line breaks are refused outright: PyYAML, which
        snowfakery reads recipes with, breaks lines at U+0085, U+2028 and U+2029, so any of them
        would start a line this writer never checked -- a new field, or a new object.
    */
    private static buildFieldLines(fieldApiName: string, valueText: string): string[] | undefined {

        const fieldLines = `${FIELD_INDENT}${fieldApiName}: ${valueText}`.split(/\r\n|\n/);
        const continuationLines = fieldLines.slice(1);

        if ( fieldLines.some(fieldLine => /[\r\u0085\u2028\u2029]/.test(fieldLine)) ) {
            return undefined;
        }

        if ( !continuationLines.every(continuationLine => this.isBlankFieldLine(continuationLine) || CONTINUATION_LINE_PATTERN.test(continuationLine)) ) {
            return undefined;
        }

        if ( continuationLines.length > 0 && !continuationLines[continuationLines.length - 1].trim() ) {
            return undefined;
        }

        return fieldLines;

    }

    private static buildPropertyValueText(propertyName: RecipeObjectProperty, value: string | number): string | undefined {

        if ( propertyName === 'count' ) {
            const countText = typeof value === 'number' ? String(value) : value;
            return /^\d+$/.test(countText) && Number.isSafeInteger(Number(countText)) ? String(Number(countText)) : undefined;
        }

        return typeof value === 'string' && API_NAME_PATTERN.test(value) ? value : undefined;

    }

    /*
        New lines take the line ending of the line they follow, so a CRLF file stays CRLF and a
        mixed one stays locally consistent. The last new line takes the ending of the last line it
        replaced, which is what keeps a missing final newline missing. An insert after the file's
        last line gives that line the ending it lacked and leaves the new last line without one.
    */
    private static applySplice(
        recipeLines: IRecipeLines,
        span: ILineSpan,
        newLines: string[],
        editIdentity: Pick<IRecipeWriterEdit, 'operation' | 'objectApiName' | 'fieldApiName' | 'propertyName'>
    ): RecipeWriterResult {

        const { lines, lineEndings } = recipeLines;
        const defaultLineEnding = lineEndings.find(lineEnding => lineEnding) ?? '\n';

        const isInsert = span.startIndex === span.endIndex;
        const precedingLineEnding = span.startIndex > 0 ? lineEndings[span.startIndex - 1] : '';
        const innerLineEnding = ( isInsert ? precedingLineEnding : lineEndings[span.startIndex] ) || defaultLineEnding;
        const lastLineEnding = isInsert ? precedingLineEnding : lineEndings[span.endIndex - 1];

        const newLineEndings = newLines.map((_newLine, newLineIndex) => (
            newLineIndex === newLines.length - 1 ? lastLineEnding : innerLineEnding
        ));

        const nextLineEndings = lineEndings.slice();
        if ( isInsert && span.startIndex > 0 && !precedingLineEnding ) {
            nextLineEndings[span.startIndex - 1] = defaultLineEnding;
        }

        const removedLines = lines.slice(span.startIndex, span.endIndex);

        const nextLines = [...lines.slice(0, span.startIndex), ...newLines, ...lines.slice(span.endIndex)];
        nextLineEndings.splice(span.startIndex, span.endIndex - span.startIndex, ...newLineEndings);

        return {
            isApplied: true,
            recipeText: this.joinRecipeLines({ lines: nextLines, lineEndings: nextLineEndings }),
            edit: {
                ...editIdentity,
                startLineNumber: span.startIndex + 1,
                removedLines: removedLines,
                insertedLines: newLines.slice()
            }
        };

    }

    private static refuseInvalidValue(objectApiName: string, fieldApiName: string): { isApplied: false; refusal: IRecipeWriterRefusal } {
        return this.refuse(
            'invalid-value',
            `The value for ${objectApiName}.${fieldApiName} does not keep the recipe layout: every line after the first must be indented five spaces or more, and the last must not be blank.`,
            objectApiName,
            fieldApiName
        );
    }

    private static refuse(reason: RecipeWriterRefusalReason, message: string, objectApiName: string, fieldApiName?: string): { isApplied: false; refusal: IRecipeWriterRefusal } {
        return {
            isApplied: false,
            refusal: {
                reason: reason,
                message: message,
                objectApiName: objectApiName,
                ...( fieldApiName !== undefined ? { fieldApiName: fieldApiName } : {} )
            }
        };
    }

}
