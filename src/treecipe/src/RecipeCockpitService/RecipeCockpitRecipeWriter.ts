/*
    The Recipe Cockpit's recipe writer: recipe text in, recipe text out.

    This file imports NOTHING, for the same reason RecipeCockpitMetadataDiff does: it cannot reach
    the disk, a webview, vscode or an org, so every edit is asserted on plain strings.

    It patches LINES rather than round-tripping YAML. Both faker backends write recipes as template
    strings, and the "### TODO" comments in them carry meaning -- which record type to pick, which
    lookup needs a reference. js-yaml drops every comment on dump, so a load and dump would delete
    them all. The writer instead holds to one layout contract, which RecipeCockpitService.parseRecipeSource
    reads through this file's own scanRecipeObjects: "- object: X" at column zero, "  fields:" under
    it, one field per line at exactly four spaces, anything deeper as the continuation of the field
    above, and a comment at one to four spaces as neither. A faker-js recipe nests child objects
    under "  friends:" (#46), and each friends level moves every one of those columns four spaces
    deeper: "    - object: Y" under a parent's "  friends:", its fields at eight spaces, and so on.
    A field's lines are its own line and its continuation lines; every other line of the file is
    left byte for byte as it was found, and so are its line endings.

    Unlike the reader, the writer never takes the first occurrence. First-wins is the right rule for
    jumping to a line and the wrong one for changing it: an object written twice, a field written
    twice or a second "fields:" block is REFUSED, because either copy could be the one the reader
    meant. The one way to name an occurrence is its NICKNAME: every operation takes an optional
    objectNickname, which is how the nested child iteration a self-lookup adds (#188) is edited
    apart from the object above it.
*/

export type RecipeWriterOperation = 'insert-field' | 'replace-field-value' | 'comment-out-field' | 'restore-commented-out-field' | 'set-object-property';

export type RecipeObjectProperty = 'nickname' | 'count';

export type RecipeWriterRefusalReason =
    | 'invalid-object-api-name'
    | 'invalid-object-nickname'
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
    objectNickname?: string;
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
    objectNickname?: string;
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
    // THE COLUMN OF "- object:" -- 0 AT THE TOP, FOUR MORE FOR EACH friends: LEVEL
    objectIndent: number;
    headerIndex: number;
    // THE headerIndex OF THE OBJECT WHOSE friends: BLOCK THIS ONE IS IN; ABSENT AT THE TOP LEVEL
    parentHeaderIndex?: number;
    // THE VALUE OF EVERY "nickname:" LINE, IN ORDER -- WHAT TELLS TWO OCCURRENCES OF ONE OBJECT APART (#188)
    nicknames: string[];
    fieldsLineIndexes: number[];
    fields: IScannedField[];
    // THE LAST NON-BLANK LINE OF THE FIELDS BLOCK -- A FIELD, A CONTINUATION OR A COMMENT -- WHICH IS WHERE AN INSERT GOES AFTER
    lastFieldsBlockLineIndex: number;
    propertyLineIndexes: Record<RecipeObjectProperty, number[]>;
    commentedOutFieldMarkers: IScannedField[];
}

/*
    Every column the layout contract names, for an object whose "- object:" sits at objectIndent.
    At 0 these are the top-level columns; a friend at 4 has its properties at 6 and its fields at 8.
*/
export interface IRecipeObjectLayout {
    objectIndent: number;
    propertyIndent: string;
    fieldIndent: string;
    commentPrefix: string;
    commentedOutMarkerPrefix: string;
    fieldLinePattern: RegExp;
    continuationLinePattern: RegExp;
    fieldsBlockCommentPattern: RegExp;
    fieldsLinePattern: RegExp;
    friendsLinePattern: RegExp;
    propertyLinePattern: RegExp;
}

interface IOpenScannedObject {
    scannedObject: IScannedObject;
    layout: IRecipeObjectLayout;
    isInFieldsBlock: boolean;
    isInFriendsBlock: boolean;
    currentField?: IScannedField;
}

const COMMENTED_OUT_MARKER_TEXT = '### TODO -- RECIPE COCKPIT -- FIELD COMMENTED OUT -- ';
const OBJECT_HEADER_PATTERN = /^( *)- object:\s*(\S+)\s*$/;
const FRIENDS_INDENT_STEP = 4;
const API_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

export class RecipeCockpitRecipeWriter {

    private static readonly objectLayoutsByIndent = new Map<number, IRecipeObjectLayout>();

    static getObjectLayout(objectIndent: number): IRecipeObjectLayout {

        const cachedLayout = this.objectLayoutsByIndent.get(objectIndent);
        if ( cachedLayout ) {
            return cachedLayout;
        }

        const fieldIndent = ' '.repeat(objectIndent + 4);
        const layout: IRecipeObjectLayout = {
            objectIndent: objectIndent,
            propertyIndent: ' '.repeat(objectIndent + 2),
            fieldIndent: fieldIndent,
            commentPrefix: `${fieldIndent}#`,
            commentedOutMarkerPrefix: `${fieldIndent}${COMMENTED_OUT_MARKER_TEXT}`,
            fieldLinePattern: new RegExp(`^ {${objectIndent + 4}}([A-Za-z][A-Za-z0-9_]*):(.*)$`),
            continuationLinePattern: new RegExp(`^ {${objectIndent + 5},}\\S`),
            fieldsBlockCommentPattern: new RegExp(`^ {1,${objectIndent + 4}}#`),
            fieldsLinePattern: new RegExp(`^ {${objectIndent + 2}}fields:\\s*$`),
            friendsLinePattern: new RegExp(`^ {${objectIndent + 2}}friends:\\s*$`),
            propertyLinePattern: new RegExp(`^ {${objectIndent + 2}}(nickname|count):`)
        };

        this.objectLayoutsByIndent.set(objectIndent, layout);
        return layout;

    }

    static readonly COMMENTED_OUT_MARKER_PREFIX = RecipeCockpitRecipeWriter.getObjectLayout(0).commentedOutMarkerPrefix;

    /*
        valueText is what follows "Field: ", exactly as the faker services build a field's recipe:
        one line, or a first line followed by lines indented five spaces or more. A value that
        starts with a newline -- the dependent-picklist "if:" block -- leaves "Field: " with its
        trailing space, as RecipeService.appendFieldRecipeToObjectRecipe writes it. It is always
        written for a TOP-LEVEL object; for a friend, every continuation line is moved to the
        friend's depth, as RelationshipService moves the whole recipe when it nests one (#46).
    */
    static insertField(recipeText: string, objectApiName: string, fieldApiName: string, valueText: string, objectNickname?: string): RecipeWriterResult {

        const objectLabel = this.describeObject(objectApiName, objectNickname);

        const located = this.locateObject(recipeText, objectApiName, fieldApiName, objectNickname);
        if ( 'refusal' in located ) {
            return located;
        }
        const { recipeLines, scannedObject } = located;

        const fieldsBlockRefusal = this.refuseUnlessOneFieldsBlock(scannedObject, fieldApiName, objectNickname);
        if ( fieldsBlockRefusal ) {
            return fieldsBlockRefusal;
        }

        if ( scannedObject.fields.some(scannedField => scannedField.fieldApiName === fieldApiName) ) {
            return this.refuse('field-already-exists', `${objectLabel} already has a ${fieldApiName} line, so it is not inserted again.`, objectApiName, fieldApiName, objectNickname);
        }

        const fieldLines = this.buildFieldLines(fieldApiName, valueText, this.getObjectLayout(scannedObject.objectIndent));
        if ( !fieldLines ) {
            return this.refuseInvalidValue(objectApiName, fieldApiName, objectNickname);
        }

        const insertAfterIndex = scannedObject.lastFieldsBlockLineIndex;

        return this.applySplice(recipeLines, { startIndex: insertAfterIndex + 1, endIndex: insertAfterIndex + 1 }, fieldLines, {
            operation: 'insert-field',
            objectApiName: objectApiName,
            ...( objectNickname !== undefined ? { objectNickname: objectNickname } : {} ),
            fieldApiName: fieldApiName
        });

    }

    static replaceFieldValue(recipeText: string, objectApiName: string, fieldApiName: string, valueText: string, objectNickname?: string): RecipeWriterResult {

        const objectLabel = this.describeObject(objectApiName, objectNickname);

        const located = this.locateField(recipeText, objectApiName, fieldApiName, objectNickname);
        if ( 'refusal' in located ) {
            return located;
        }

        const fieldLines = this.buildFieldLines(fieldApiName, valueText, located.layout);
        if ( !fieldLines ) {
            return this.refuseInvalidValue(objectApiName, fieldApiName, objectNickname);
        }

        return this.applySplice(located.recipeLines, located.scannedField, fieldLines, {
            operation: 'replace-field-value',
            objectApiName: objectApiName,
            ...( objectNickname !== undefined ? { objectNickname: objectNickname } : {} ),
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
    static commentOutField(recipeText: string, objectApiName: string, fieldApiName: string, reason: string, objectNickname?: string): RecipeWriterResult {

        const objectLabel = this.describeObject(objectApiName, objectNickname);

        const located = this.locateField(recipeText, objectApiName, fieldApiName, objectNickname);
        if ( 'refusal' in located ) {
            return located;
        }
        const { recipeLines, scannedField, layout } = located;

        const fieldLines = recipeLines.lines.slice(scannedField.startIndex, scannedField.endIndex);

        if ( fieldLines.some(fieldLine => fieldLine && !fieldLine.startsWith(layout.fieldIndent)) ) {
            return this.refuse('unsupported-field-layout', `${objectLabel}.${fieldApiName} has a line of one to three spaces inside it, which commenting out could not give back exactly.`, objectApiName, fieldApiName, objectNickname);
        }

        // EVERY LINE BREAK PyYAML READS -- U+0085 IS NOT IN \s -- AND EVERY CONTROL CHARACTER, SO THE REASON CANNOT END THE COMMENT
        const singleLineReason = reason.replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
        const lineCountText = `${fieldLines.length} ${fieldLines.length === 1 ? 'line' : 'lines'}`;
        const markerLine = `${layout.commentedOutMarkerPrefix}${fieldApiName} -- ${lineCountText}${singleLineReason ? ` -- ${singleLineReason}` : ''}`;
        const commentedLines = fieldLines.map(fieldLine => (
            fieldLine ? `${layout.commentPrefix} ${fieldLine.slice(layout.fieldIndent.length)}` : layout.commentPrefix
        ));

        return this.applySplice(recipeLines, scannedField, [markerLine, ...commentedLines], {
            operation: 'comment-out-field',
            objectApiName: objectApiName,
            ...( objectNickname !== undefined ? { objectNickname: objectNickname } : {} ),
            fieldApiName: fieldApiName
        });

    }

    static restoreCommentedOutField(recipeText: string, objectApiName: string, fieldApiName: string, objectNickname?: string): RecipeWriterResult {

        const objectLabel = this.describeObject(objectApiName, objectNickname);

        const located = this.locateObject(recipeText, objectApiName, fieldApiName, objectNickname);
        if ( 'refusal' in located ) {
            return located;
        }
        const { recipeLines, scannedObject } = located;

        if ( scannedObject.fields.some(scannedField => scannedField.fieldApiName === fieldApiName) ) {
            return this.refuse('field-already-exists', `${objectLabel} already has a ${fieldApiName} line, so the commented-out one is not restored over it.`, objectApiName, fieldApiName, objectNickname);
        }

        const markers = scannedObject.commentedOutFieldMarkers.filter(marker => marker.fieldApiName === fieldApiName);

        if ( markers.length === 0 ) {
            return this.refuse('commented-out-field-not-found', `${objectLabel} has no ${fieldApiName} commented out by the Recipe Cockpit.`, objectApiName, fieldApiName, objectNickname);
        }

        if ( markers.length > 1 ) {
            return this.refuse('duplicate-commented-out-field', `${objectLabel} has ${fieldApiName} commented out more than once, so which to restore cannot be told.`, objectApiName, fieldApiName, objectNickname);
        }

        const [marker] = markers;
        const restoredLines = this.readCommentedOutFieldLines(recipeLines.lines, marker, this.getObjectLayout(scannedObject.objectIndent));

        if ( !restoredLines ) {
            return this.refuse('commented-out-field-altered', `The lines under ${objectLabel}'s ${fieldApiName} marker are not the ones commenting it out wrote, so restoring them could not give the field back exactly.`, objectApiName, fieldApiName, objectNickname);
        }

        return this.applySplice(recipeLines, marker, restoredLines, {
            operation: 'restore-commented-out-field',
            objectApiName: objectApiName,
            ...( objectNickname !== undefined ? { objectNickname: objectNickname } : {} ),
            fieldApiName: fieldApiName
        });

    }

    static setObjectProperty(recipeText: string, objectApiName: string, propertyName: RecipeObjectProperty, value: string | number, objectNickname?: string): RecipeWriterResult {

        const objectLabel = this.describeObject(objectApiName, objectNickname);

        const located = this.locateObject(recipeText, objectApiName, undefined, objectNickname);
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
                        ? `The count for ${objectLabel} must be a whole number of zero or more.`
                        : `The nickname for ${objectLabel} must be a name of letters, digits and underscores, starting with a letter.`,
                    objectApiName: objectApiName,
                    ...( objectNickname !== undefined ? { objectNickname: objectNickname } : {} ),
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
                        ? `${objectLabel} has no "${propertyName}:" line to set.`
                        : `${objectLabel} has more than one "${propertyName}:" line, so which to set cannot be told.`,
                    objectApiName: objectApiName,
                    ...( objectNickname !== undefined ? { objectNickname: objectNickname } : {} ),
                    propertyName: propertyName
                }
            };
        }

        const [propertyLineIndex] = propertyLineIndexes;

        return this.applySplice(recipeLines, { startIndex: propertyLineIndex, endIndex: propertyLineIndex + 1 }, [`${this.getObjectLayout(scannedObject.objectIndent).propertyIndent}${propertyName}: ${propertyValueText}`], {
            operation: 'set-object-property',
            objectApiName: objectApiName,
            ...( objectNickname !== undefined ? { objectNickname: objectNickname } : {} ),
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
        Every object in the file, in the order written, duplicates included and friends at every
        depth. This is the one scan of the layout contract: RecipeCockpitService.parseRecipeSource
        reads its objects and fields from it, and keeps only the FIRST of each name, where the
        writer refuses a name it finds twice.

        The objects still open form a stack, one per friends level, so the object at depth d always
        has its "- object:" at column 4d. A header at column 4d opens a friend only while the object
        at depth d - 1 is inside its "  friends:" block; anywhere else it is just an unrecognized
        line. Any other non-blank line at or left of an open object's header column closes that
        object -- which, at depth 0, is the "line at column zero that is not an object header ends
        the object" rule a flat recipe has always had.
    */
    static scanRecipeObjects(lines: string[]): IScannedObject[] {

        const scannedObjects: IScannedObject[] = [];
        const openObjects: IOpenScannedObject[] = [];

        lines.forEach((recipeLine, lineIndex) => {

            const objectHeaderMatch = OBJECT_HEADER_PATTERN.exec(recipeLine);
            const objectIndent = objectHeaderMatch ? objectHeaderMatch[1].length : -1;
            const parentDepth = objectIndent / FRIENDS_INDENT_STEP - 1;
            const isTopLevelHeader = objectIndent === 0;
            const isFriendHeader = objectIndent > 0
                                    && Number.isInteger(parentDepth)
                                    && openObjects[parentDepth]?.isInFriendsBlock === true;

            if ( isTopLevelHeader || isFriendHeader ) {

                openObjects.length = isTopLevelHeader ? 0 : parentDepth + 1;
                openObjects.forEach(openObject => { openObject.currentField = undefined; });

                const scannedObject: IScannedObject = {
                    objectApiName: objectHeaderMatch[2],
                    objectIndent: objectIndent,
                    headerIndex: lineIndex,
                    ...( isFriendHeader ? { parentHeaderIndex: openObjects[parentDepth].scannedObject.headerIndex } : {} ),
                    nicknames: [],
                    fieldsLineIndexes: [],
                    fields: [],
                    lastFieldsBlockLineIndex: -1,
                    propertyLineIndexes: { nickname: [], count: [] },
                    commentedOutFieldMarkers: []
                };
                scannedObjects.push(scannedObject);
                openObjects.push({
                    scannedObject: scannedObject,
                    layout: this.getObjectLayout(objectIndent),
                    isInFieldsBlock: false,
                    isInFriendsBlock: false
                });
                return;

            }

            if ( openObjects.length === 0 || !recipeLine.trim() ) {
                return;
            }

            const lineIndent = recipeLine.length - recipeLine.trimStart().length;
            while ( openObjects.length > 0 && lineIndent <= openObjects[openObjects.length - 1].layout.objectIndent ) {
                openObjects.pop();
            }

            const openObject = openObjects[openObjects.length - 1];
            if ( !openObject ) {
                return;
            }

            const { scannedObject, layout } = openObject;
            const fieldMatch = layout.fieldLinePattern.exec(recipeLine);

            if ( openObject.isInFieldsBlock && fieldMatch ) {
                openObject.currentField = { fieldApiName: fieldMatch[1], startIndex: lineIndex, endIndex: lineIndex + 1 };
                scannedObject.fields.push(openObject.currentField);
                scannedObject.lastFieldsBlockLineIndex = lineIndex;
                return;
            }

            if ( openObject.isInFieldsBlock && layout.continuationLinePattern.test(recipeLine) ) {
                if ( openObject.currentField ) {
                    openObject.currentField.endIndex = lineIndex + 1;
                }
                scannedObject.lastFieldsBlockLineIndex = lineIndex;
                return;
            }

            // A COMMENT AT FIELD DEPTH OR SHALLOWER ENDS THE FIELD ABOVE BUT NOT THE BLOCK -- IT IS WHERE commentOutField LEAVES A FIELD
            if ( openObject.isInFieldsBlock && layout.fieldsBlockCommentPattern.test(recipeLine) ) {
                const commentedOutFieldMarker = this.readCommentedOutFieldMarker(recipeLine, lineIndex, layout);
                if ( commentedOutFieldMarker ) {
                    scannedObject.commentedOutFieldMarkers.push(commentedOutFieldMarker);
                }
                openObject.currentField = undefined;
                scannedObject.lastFieldsBlockLineIndex = lineIndex;
                return;
            }

            openObject.currentField = undefined;

            // OUTSIDE THE FIELDS BLOCK A COMMENT CHANGES NOTHING -- THE ONE NAMING A FRIEND SITS INSIDE ITS PARENT'S friends: BLOCK
            if ( recipeLine.trimStart().startsWith('#') ) {
                return;
            }

            openObject.isInFieldsBlock = layout.fieldsLinePattern.test(recipeLine);
            openObject.isInFriendsBlock = layout.friendsLinePattern.test(recipeLine);

            if ( openObject.isInFieldsBlock ) {
                scannedObject.fieldsLineIndexes.push(lineIndex);
                scannedObject.lastFieldsBlockLineIndex = lineIndex;
                return;
            }

            const propertyMatch = layout.propertyLinePattern.exec(recipeLine);
            if ( propertyMatch ) {
                scannedObject.propertyLineIndexes[propertyMatch[1] as RecipeObjectProperty].push(lineIndex);
                if ( propertyMatch[1] === 'nickname' ) {
                    scannedObject.nicknames.push(recipeLine.slice(propertyMatch[0].length).trim());
                }
            }

        });

        return scannedObjects;

    }

    // THE SPAN IS THE MARKER AND THE LINE COUNT IT DECLARES, WHETHER OR NOT THOSE LINES ARE STILL THERE -- readCommentedOutFieldLines DECIDES THAT
    private static readCommentedOutFieldMarker(recipeLine: string, lineIndex: number, layout: IRecipeObjectLayout): IScannedField | undefined {

        if ( !recipeLine.startsWith(layout.commentedOutMarkerPrefix) ) {
            return undefined;
        }

        const markerMatch = /^([A-Za-z][A-Za-z0-9_]*) -- (\d{1,9}) lines?(?: -- |$)/.exec(recipeLine.slice(layout.commentedOutMarkerPrefix.length));

        return markerMatch
            ? { fieldApiName: markerMatch[1], startIndex: lineIndex, endIndex: lineIndex + 1 + Number(markerMatch[2]) }
            : undefined;

    }

    /*
        The field's lines under a marker, uncommented -- or undefined unless they are exactly what
        commentOutField writes: the declared number of commented lines, the first the field's own
        line, the rest continuations or blank, and the last not blank.
    */
    private static readCommentedOutFieldLines(lines: string[], marker: IScannedField, layout: IRecipeObjectLayout): string[] | undefined {

        const commentedLines = lines.slice(marker.startIndex + 1, marker.endIndex);

        if ( commentedLines.length === 0 || marker.endIndex > lines.length || !commentedLines.every(commentedLine => this.isCommentedLine(commentedLine, layout)) ) {
            return undefined;
        }

        const [fieldLine, ...continuationLines] = commentedLines.map(commentedLine => this.uncommentLine(commentedLine, layout));

        if ( !fieldLine.startsWith(`${layout.fieldIndent}${marker.fieldApiName}:`) ) {
            return undefined;
        }

        if ( !continuationLines.every(continuationLine => this.isBlankFieldLine(continuationLine, layout) || layout.continuationLinePattern.test(continuationLine)) ) {
            return undefined;
        }

        if ( continuationLines.length > 0 && !continuationLines[continuationLines.length - 1].trim() ) {
            return undefined;
        }

        return [fieldLine, ...continuationLines];

    }

    // THE ONLY BLANK LINES commentOutField CAN GIVE BACK EXACTLY: EMPTY, OR WHITESPACE BEHIND AT LEAST THE FIELD INDENT
    private static isBlankFieldLine(recipeLine: string, layout: IRecipeObjectLayout): boolean {
        return !recipeLine || ( recipeLine.startsWith(layout.fieldIndent) && !recipeLine.trim() );
    }

    private static isCommentedLine(recipeLine: string, layout: IRecipeObjectLayout): boolean {
        return recipeLine === layout.commentPrefix || recipeLine.startsWith(`${layout.commentPrefix} `);
    }

    private static uncommentLine(commentedLine: string, layout: IRecipeObjectLayout): string {
        return commentedLine === layout.commentPrefix ? '' : `${layout.fieldIndent}${commentedLine.slice(layout.commentPrefix.length + 1)}`;
    }

    /*
        An object written more than once -- a self-lookup's nested iteration (#188), or a file edited
        by hand -- is picked out by its nickname. Without one, or with one that more than one
        occurrence carries, it is refused rather than guessed.
    */
    private static locateObject(recipeText: string, objectApiName: string, fieldApiName?: string, objectNickname?: string):
        { recipeLines: IRecipeLines; scannedObject: IScannedObject } | { isApplied: false; refusal: IRecipeWriterRefusal } {

        if ( !API_NAME_PATTERN.test(objectApiName) ) {
            return this.refuse('invalid-object-api-name', `"${objectApiName}" is not an object api name.`, objectApiName, fieldApiName, objectNickname);
        }

        if ( objectNickname !== undefined && !API_NAME_PATTERN.test(objectNickname) ) {
            return this.refuse('invalid-object-nickname', `"${objectNickname}" is not a nickname.`, objectApiName, fieldApiName, objectNickname);
        }

        if ( fieldApiName !== undefined && !API_NAME_PATTERN.test(fieldApiName) ) {
            return this.refuse('invalid-field-api-name', `"${fieldApiName}" is not a field api name.`, objectApiName, fieldApiName, objectNickname);
        }

        const recipeLines = this.splitRecipeLines(recipeText);
        const scannedObjects = this.scanRecipeObjects(recipeLines.lines)
            .filter(scannedObject => scannedObject.objectApiName === objectApiName
                                        && ( objectNickname === undefined || scannedObject.nicknames.includes(objectNickname) ));

        if ( scannedObjects.length === 0 ) {
            return this.refuse('object-not-found',
                objectNickname === undefined
                    ? `The recipe has no "- object: ${objectApiName}" line.`
                    : `The recipe has no "- object: ${objectApiName}" with the nickname ${objectNickname}.`,
                objectApiName, fieldApiName, objectNickname);
        }

        if ( scannedObjects.length > 1 ) {
            return this.refuse('duplicate-object',
                objectNickname === undefined
                    ? `The recipe has ${scannedObjects.length} "- object: ${objectApiName}" lines, so which to change cannot be told without a nickname.`
                    : `The recipe has ${scannedObjects.length} "- object: ${objectApiName}" lines with the nickname ${objectNickname}, so which to change cannot be told.`,
                objectApiName, fieldApiName, objectNickname);
        }

        return { recipeLines: recipeLines, scannedObject: scannedObjects[0] };

    }

    private static locateField(recipeText: string, objectApiName: string, fieldApiName: string, objectNickname?: string):
        { recipeLines: IRecipeLines; scannedField: IScannedField; layout: IRecipeObjectLayout } | { isApplied: false; refusal: IRecipeWriterRefusal } {

        const located = this.locateObject(recipeText, objectApiName, fieldApiName, objectNickname);
        if ( 'refusal' in located ) {
            return located;
        }

        const fieldsBlockRefusal = this.refuseUnlessOneFieldsBlock(located.scannedObject, fieldApiName, objectNickname);
        if ( fieldsBlockRefusal ) {
            return fieldsBlockRefusal;
        }

        const objectLabel = this.describeObject(objectApiName, objectNickname);
        const scannedFields = located.scannedObject.fields.filter(scannedField => scannedField.fieldApiName === fieldApiName);

        if ( scannedFields.length === 0 ) {
            return this.refuse('field-not-found', `${objectLabel} has no ${fieldApiName} line in its fields.`, objectApiName, fieldApiName, objectNickname);
        }

        if ( scannedFields.length > 1 ) {
            return this.refuse('duplicate-field', `${objectLabel} has ${fieldApiName} more than once, so which to change cannot be told.`, objectApiName, fieldApiName, objectNickname);
        }

        return { recipeLines: located.recipeLines, scannedField: scannedFields[0], layout: this.getObjectLayout(located.scannedObject.objectIndent) };

    }

    // "Account" -- OR "Account (Account_child_NickName)" WHEN THE CALLER PICKED ONE OCCURRENCE BY NICKNAME
    private static describeObject(objectApiName: string, objectNickname?: string): string {
        return objectNickname === undefined ? objectApiName : `${objectApiName} (${objectNickname})`;
    }

    private static refuseUnlessOneFieldsBlock(scannedObject: IScannedObject, fieldApiName: string, objectNickname?: string): { isApplied: false; refusal: IRecipeWriterRefusal } | undefined {

        const objectLabel = this.describeObject(scannedObject.objectApiName, objectNickname);

        if ( scannedObject.fieldsLineIndexes.length === 0 ) {
            return this.refuse('fields-block-not-found', `${objectLabel} has no "  fields:" line.`, scannedObject.objectApiName, fieldApiName, objectNickname);
        }

        if ( scannedObject.fieldsLineIndexes.length > 1 ) {
            return this.refuse('duplicate-fields-block', `${objectLabel} has more than one "  fields:" line, so which to change cannot be told.`, scannedObject.objectApiName, fieldApiName, objectNickname);
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
    private static buildFieldLines(fieldApiName: string, valueText: string, layout: IRecipeObjectLayout): string[] | undefined {

        const objectIndentation = ' '.repeat(layout.objectIndent);
        const fieldLines = `${layout.fieldIndent}${fieldApiName}: ${valueText}`.split(/\r\n|\n/)
            .map((fieldLine, lineIndex) => ( lineIndex > 0 && fieldLine ? `${objectIndentation}${fieldLine}` : fieldLine ));
        const continuationLines = fieldLines.slice(1);

        if ( fieldLines.some(fieldLine => /[\r\u0085\u2028\u2029]/.test(fieldLine)) ) {
            return undefined;
        }

        if ( !continuationLines.every(continuationLine => this.isBlankFieldLine(continuationLine, layout) || layout.continuationLinePattern.test(continuationLine)) ) {
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

    private static refuseInvalidValue(objectApiName: string, fieldApiName: string, objectNickname?: string): { isApplied: false; refusal: IRecipeWriterRefusal } {
        return this.refuse(
            'invalid-value',
            `The value for ${this.describeObject(objectApiName, objectNickname)}.${fieldApiName} does not keep the recipe layout: every line after the first must be indented five spaces or more, and the last must not be blank.`,
            objectApiName,
            fieldApiName,
            objectNickname
        );
    }

    private static refuse(reason: RecipeWriterRefusalReason, message: string, objectApiName: string, fieldApiName?: string, objectNickname?: string): { isApplied: false; refusal: IRecipeWriterRefusal } {
        return {
            isApplied: false,
            refusal: {
                reason: reason,
                message: message,
                objectApiName: objectApiName,
                ...( objectNickname !== undefined ? { objectNickname: objectNickname } : {} ),
                ...( fieldApiName !== undefined ? { fieldApiName: fieldApiName } : {} )
            }
        };
    }

}
