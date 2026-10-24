/*
    The Recipe Cockpit's recipe writer: recipe text in, recipe text out.

    This file imports NOTHING, like RecipeCockpitRecordCreation and RecipeCockpitObjectSelection: it
    cannot reach the disk, a webview, vscode or an org, so every edit is asserted on plain strings.

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
    apart from the object above it. insertFriend (#197) takes that nickname as REQUIRED, since the
    only object it adds a friend to is such an iteration.
*/

export type RecipeWriterOperation = 'insert-field' | 'replace-field-value' | 'comment-out-field' | 'restore-commented-out-field' | 'set-object-property' | 'insert-friend' | 'wire-lookup' | 'add-parent-object';

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
    | 'duplicate-property'
    | 'invalid-friend-object-api-name'
    | 'not-a-self-lookup-iteration'
    | 'friend-not-found'
    | 'duplicate-friend'
    | 'friend-already-exists'
    | 'duplicate-friends-block'
    | 'unsupported-friend-layout'
    | 'all-objects-excluded'
    | 'unsupported-filter-layout'
    | 'no-lookup-wirings'
    | 'duplicate-lookup-wiring'
    | 'lookup-not-wireable'
    | 'parent-nickname-not-a-candidate'
    | 'polymorphic-lookup'
    | 'no-parent-template'
    | 'parent-object-already-exists'
    | 'parent-not-inserted-first'
    | 'pinned-field-changed'
    | 'todo-not-found'
    | 'todo-changed'
    | 'todo-not-removable'
    | 'indistinct-todo-occurrence'
    | 'todo-owner-not-found'
    | 'todo-place-not-found'
    | 'todo-already-back'
    | 'todo-structure-changed';

export interface IRecipeWriterRefusal {
    reason: RecipeWriterRefusalReason;
    message: string;
    objectApiName: string;
    objectNickname?: string;
    fieldApiName?: string;
    propertyName?: RecipeObjectProperty;
    friendObjectApiName?: string;
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
    friendObjectApiName?: string;
    // THE NICKNAME insertFriend GAVE THE FRIEND IT ADDED
    friendNickname?: string;
    // THE NICKNAME wireLookups WROTE AS THE LOOKUP'S VALUE, OR THE ONE addParentObject GAVE THE PARENT IT ADDED
    parentNickname?: string;
    // THE OBJECT addParentObject ADDED
    parentObjectApiName?: string;
    startLineNumber: number;
    removedLines: string[];
    insertedLines: string[];
}

// A ONE-OBJECT RECIPE CUT FROM A LARGER ONE, OR WHY IT COULD NOT BE CUT
export type RecipeBlockExtractionResult =
    | { isExtracted: true; recipeText: string }
    | { isExtracted: false; refusal: IRecipeWriterRefusal };

// ONE FIELD OF A TREECIPE UPDATER VALUE RECIPE (#417): ITS VALUE TEXT AS A FAKER SERVICE WRITES IT AFTER "Field: "
export interface IUpdaterValueRecipeField {
    fieldApiName: string;
    valueText: string;
}

// THE ONE-OBJECT RECIPE THE TREECIPE UPDATER GENERATES ITS VALUES FROM, OR WHY IT COULD NOT BE BUILT
export type RecipeUpdaterValueRecipeResult =
    | { isBuilt: true; recipeText: string }
    | { isBuilt: false; refusal: string };

export interface ICreateBlockFieldListRequest {
    objectApiName: string;
    objectNickname?: string;
    // THE FIELDS THE STRUCTURE TAB UNTICKED (#220): LEFT OUT OF THE LIST, AS THEY ARE LEFT OUT OF THE CUT
    excludedFieldApiNames?: readonly string[];
}

export type RecipeBlockFieldListResult =
    | { isListed: true; fieldApiNames: string[] }
    | { isListed: false; refusal: IRecipeWriterRefusal };

// ONE LOOKUP OF AN OBJECT AND THE OBJECT IT POINTS AT
export interface IRecipeFilterLookup {
    fieldApiName: string;
    parentObjectApiName: string;
}

/*
    What buildFilteredRecipe leaves out (#219). excludedObjectApiNames is EVERY object left out, the
    ones the reader excluded and the ones that followed a parent. The lookups are what tell a
    snowfakery "### TODO" lookup apart from any other field, and what a moved friend is wired by.
    Levels are RelationshipService's; without one, an object's nesting depth in the recipe stands in.
    excludedFieldApiNamesByObject is the fields the reader unticked (#220), by object; each is left
    out of EVERY kept occurrence of its object, a self-lookup's iteration included.
    objectCountsByObject is the record count the reader set for an object (#255), written on the
    "count:" line of its FIRST occurrence -- the one the Recipe Cockpit draws a count box for; a
    self-lookup's iteration keeps its own. For a nested faker-js friend that is records per parent
    record, as "count:" always meant there.
*/
export interface IRecipeFilterRequest {
    excludedObjectApiNames: readonly string[];
    parentLookupsByObjectApiName: ReadonlyMap<string, readonly IRecipeFilterLookup[]>;
    levelsByObjectApiName?: ReadonlyMap<string, number>;
    excludedFieldApiNamesByObject?: ReadonlyMap<string, readonly string[]>;
    objectCountsByObject?: ReadonlyMap<string, number>;
    fixedValuesByObject?: ReadonlyMap<string, ReadonlyMap<string, IRecipeFixedValue>>;
    constrainedExpressionsByObject?: ReadonlyMap<string, ReadonlyMap<string, string>>;
    unconstrainedValuesByObject?: ReadonlyMap<string, ReadonlyMap<string, IRecipeUnconstrainedValue>>;
}

/*
    A field whose validation rules the reader switched off (#325). Both values are as the objects
    wrapper records them -- written as for a top-level object, continuation lines included -- and
    the field's lines are swapped only on an occurrence that still holds EXACTLY what the rules
    wrote: anything else is a recipe the rules no longer describe (a hand edit, or a later record
    type block written with other values), and the copy is refused rather than guessed at. A fixed
    value or a constrained expression on the same field wins, as it would over the rules.
*/
export interface IRecipeUnconstrainedValue {
    constrainedValue: string;
    unconstrainedValue: string;
}

/*
    A field's constrained faker expression (#323), built by the recipe's own backend from bounds the
    host already checked, and written in place of the field's line on every kept occurrence of its
    object, double-quoted so its ": " and "," never read as YAML. A fixed value on the same field
    wins: it is one value, and a range around one value says nothing more.
*/
export interface IRecipeFilterConstrainedExpression {
    objectApiName: string;
    fieldApiName: string;
    expression: string;
}

/*
    A value the reader typed for a field (#262), written in place of its faker expression on every
    kept occurrence of its object. kind decides the YAML scalar: text is always double-quoted, so
    "Yes" or "007" stays the string it was typed as; a number and a boolean are written plain so
    both backends generate the type the field holds. An expression (#356) is one "${{ ... }}" the
    reader edited, held to checkConstrainedExpression and double-quoted like text, which can never
    hold "${" -- so a written line says by itself which of the two it is.
*/
export type RecipeFixedValueKind = 'text' | 'number' | 'boolean' | 'expression';

export interface IRecipeFixedValue {
    value: string;
    kind: RecipeFixedValueKind;
}

// ONE FIXED VALUE buildFilteredRecipe WROTE, AS IT READ BACK
export interface IRecipeFilterFixedValue extends IRecipeFixedValue {
    objectApiName: string;
    fieldApiName: string;
}

// ONE COUNT buildFilteredRecipe WROTE, AS IT READ BACK
export interface IRecipeFilterCount {
    objectApiName: string;
    count: number;
}

// ONE FIELD buildFilteredRecipe LEFT OUT BECAUSE THE READER UNTICKED IT
export interface IRecipeFilterDroppedField {
    objectApiName: string;
    fieldApiName: string;
}

// A KEPT FRIEND WHOSE friends: PARENT WAS LEFT OUT; NO newParentObjectApiName MEANS IT WAS MOVED TO THE TOP LEVEL
export interface IRecipeFilterMove {
    objectApiName: string;
    newParentObjectApiName?: string;
}

export type RecipeFilterResult =
    | {
        isFiltered: true;
        recipeText: string;
        droppedObjectApiNames: string[];
        droppedLookups: IRecipeFilterLookup[];
        movedObjects: IRecipeFilterMove[];
        droppedFields: IRecipeFilterDroppedField[];
        appliedCounts: IRecipeFilterCount[];
        appliedFixedValues: IRecipeFilterFixedValue[];
        appliedConstrainedExpressions: IRecipeFilterConstrainedExpression[];
        appliedUnconstrainedValues: IRecipeFilterDroppedField[];
    }
    | { isFiltered: false; refusal: IRecipeWriterRefusal };

/*
    One lookup a recipe still writes as "### TODO -- REFERENCE ID REQUIRED", and the nicknames it can
    be wired to (#151). objectNickname is set only when the object is written more than once, which
    is when the writer needs it to tell the occurrences apart. candidateNicknames is never empty:
    a TODO nothing can resolve is not listed.
*/
export interface ILookupWiring {
    objectApiName: string;
    objectNickname?: string;
    fieldApiName: string;
    parentObjectApiNames: string[];
    candidateNicknames: string[];
}

// WHAT A CALLER ASKS wireLookups TO WRITE: ONE TODO LOOKUP AND THE NICKNAME IT BECOMES
export interface ILookupWiringRequest {
    objectApiName: string;
    objectNickname?: string;
    fieldApiName: string;
    parentNickname: string;
}

// THE LOOKUPS AND LEVELS listLookupWirings DECIDES BY -- THE SAME TWO buildFilteredRecipe TAKES
export interface ILookupWiringContext {
    parentLookupsByObjectApiName: ReadonlyMap<string, readonly IRecipeFilterLookup[]>;
    levelsByObjectApiName?: ReadonlyMap<string, number>;
}

export type RecipeLookupWiringResult =
    | { isApplied: true; recipeText: string; edits: IRecipeWriterEdit[] }
    | { isApplied: false; refusal: IRecipeWriterRefusal };

/*
    A TODO lookup whose parent the recipe does not write, and which addParentObject can add from a
    template (#294). objectNickname is set only when the object is written more than once.
*/
export interface IParentObjectAddition {
    objectApiName: string;
    objectNickname?: string;
    fieldApiName: string;
    parentObjectApiName: string;
}

/*
    A TODO lookup to ONE parent, as the Recipe Cockpit's row draws its two decisions (#421): create
    the parent in the recipe (#294's addParentObject) or use an existing org record (a pin, #342).
    createRefusalReason says why addParentObject would refuse -- no template, the parent already
    written, or not inserted first; a code rather than the writer's sentence, since one is posted per
    row and the panel words it -- and orgRecordRefusal why a pin of an Id cannot be written: pinField
    writes every occurrence of the object, so each one's field must still be the empty lookup.
*/
export interface IEmptyLookup {
    objectApiName: string;
    objectNickname?: string;
    fieldApiName: string;
    parentObjectApiName: string;
    createRefusalReason?: CreateParentRefusalReason;
    orgRecordRefusal?: string;
}

export type CreateParentRefusalReason = 'no-parent-template' | 'parent-object-already-exists' | 'parent-not-inserted-first';

// THE REFUSALS OF addParentObject THAT STILL LEAVE AN EMPTY LOOKUP TO ONE PARENT: THE ROW DRAWS "Create" DISABLED, WITH THE REASON
const CREATE_PARENT_REFUSAL_REASONS: ReadonlySet<RecipeWriterRefusalReason> = new Set<CreateParentRefusalReason>(['no-parent-template', 'parent-object-already-exists', 'parent-not-inserted-first']);

/*
    WHAT addParentObject IS ASKED TO WRITE: THE LOOKUP, AND THE TEMPLATE'S FIELD VALUES FOR EVERY PARENT IT KNOWS.
    nestTreeUnderParent (#405) moves the top-level block holding the lookup under the parent's friends:
*/
export interface IParentObjectAdditionRequest {
    objectApiName: string;
    objectNickname?: string;
    fieldApiName: string;
    parentTemplatesByObjectApiName: Readonly<Record<string, Readonly<Record<string, string>>>>;
    nestTreeUnderParent?: boolean;
}

// ONE TODO LOOKUP A NESTED ADDITION WIRED TO THE NEW PARENT (#405); objectNickname ONLY WHEN THE OBJECT IS WRITTEN MORE THAN ONCE
export interface IParentObjectAdditionWiring {
    objectApiName: string;
    objectNickname?: string;
    fieldApiName: string;
}

/*
    nestedObjectApiNames and wiredLookups are set only for a nested addition (#405): every object of
    the moved block once, in file order, and every lookup wired, the requested one included.
*/
export type RecipeParentObjectAdditionResult =
    | {
        isApplied: true;
        recipeText: string;
        parentObjectApiName: string;
        parentNickname: string;
        edits: IRecipeWriterEdit[];
        nestedObjectApiNames?: string[];
        wiredLookups?: IParentObjectAdditionWiring[];
    }
    | { isApplied: false; refusal: IRecipeWriterRefusal };

/*
    One occurrence of an object whose field pinField wrote a fixed value into (#342). The occurrence
    is told apart by its place among the object's occurrences, in file order, and by its first
    nickname -- the pair a restore matches before it touches anything. originalText is the field's
    own lines as they were, joined by their own line endings; the ending after the last of them
    belongs to the line that follows and is never part of it.
*/
export interface IPinnedFieldOccurrence {
    occurrenceIndex: number;
    nickname?: string;
    writtenLine: string;
    originalText: string;
}

export type RecipeFieldPinResult =
    | { isPinned: true; recipeText: string; occurrences: IPinnedFieldOccurrence[] }
    | { isPinned: false; refusal: IRecipeWriterRefusal };

/*
    What restorePinnedField puts back on one occurrence: the recorded originalText verbatim, or,
    when there is none, valueText -- what follows "Field: ", written as for a top-level object and
    moved to the occurrence's depth as insertField moves it.
*/
export interface IPinnedFieldRestoreRequest {
    occurrenceIndex: number;
    nickname?: string;
    writtenLine: string;
    originalText?: string;
    valueText?: string;
}

// ONE PINNED FIELD AS THE COCKPIT'S LOAD CHECKS IT (listChangedPinnedFields)
export interface IPinnedFieldCheck {
    objectApiName: string;
    fieldApiName: string;
    restoreRequests: readonly IPinnedFieldRestoreRequest[];
}

export type RecipeFieldRestoreResult =
    | { isRestored: true; recipeText: string }
    | { isRestored: false; refusal: IRecipeWriterRefusal };

export type RecipeWriterResult =
    | { isApplied: true; recipeText: string; edit: IRecipeWriterEdit }
    | { isApplied: false; refusal: IRecipeWriterRefusal };

/*
    Why a TODO comment cannot be removed (#391). field-value: the comment IS the field's value (a
    lookup's "### TODO -- REFERENCE ID REQUIRED", a formula's placeholder), so removing it would leave
    the field null. record-type-options: the cockpit and Run Faker read a "### TODO: -- RecordType
    Options --" line to find record type sections. commented-out-marker: the cockpit's own marker,
    without which a commented-out field cannot be restored. scalar-content: the line is inside a
    field's block (| or >) or unclosed quoted value, where YAML reads "#" as part of the value.
*/
export type RecipeTodoRemoveLock = 'field-value' | 'record-type-options' | 'commented-out-marker' | 'scalar-content';

/*
    One TODO comment removeTodoComment took out of a recipe, and what restoreTodoComment needs to put
    it back exactly (#391). The owner is the occurrence (by nickname, when its object is written more
    than once) and field the comment sat in, or the occurrence alone for one on no field. A 'line'
    TODO was a whole line: it goes back under previousLine, the nearest line above it that is not a
    TODO line, past the TODO lines that were above it (previousTodoLines) and before those that were
    right below it (nextTodoLines), with the line ending it had. Of two TODOs removed side by side,
    the one removed first saw the other, so its record orders the pair whichever is restored first. A 'trailing' TODO followed a value on its line: cutLine is that line as it
    was left, and originalLine replaces it.
*/
export interface IRemovedTodoComment {
    objectApiName: string;
    objectNickname?: string;
    fieldApiName?: string;
    lineNumber: number;
    todoText: string;
    originalLine: string;
    kind: 'line' | 'trailing';
    lineEnding?: string;
    previousLine?: string;
    previousTodoLines?: string[];
    nextTodoLines?: string[];
    cutLine?: string;
}

// WHAT A CALLER ASKS removeTodoComment TO TAKE OUT: THE LINE AND THE TODO TEXT THE PANEL DREW FOR IT
export interface ITodoRemoveRequest {
    lineNumber: number;
    todoText: string;
}

export type RecipeTodoRemoveResult =
    | { isRemoved: true; recipeText: string; removed: IRemovedTodoComment }
    | { isRemoved: false; refusal: IRecipeWriterRefusal };

export type RecipeTodoRestoreResult =
    | { isRestored: true; recipeText: string; lineNumber: number }
    | { isRestored: false; refusal: IRecipeWriterRefusal };

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
    friendsLineIndexes: number[];
    fields: IScannedField[];
    // THE LAST NON-BLANK LINE OF THE FIELDS BLOCK -- A FIELD, A CONTINUATION OR A COMMENT -- WHICH IS WHERE AN INSERT GOES AFTER
    lastFieldsBlockLineIndex: number;
    propertyLineIndexes: Record<RecipeObjectProperty, number[]>;
    commentedOutFieldMarkers: IScannedField[];
    // EVERY LINE OF THE OBJECT'S OWN BLOCK CARRYING A TODO COMMENT (#354) -- A FRIEND'S LINES ARE THE FRIEND'S
    todoLineIndexes: number[];
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

export interface IScannedFriendIndex {
    objectsByHeaderIndex: Map<number, IScannedObject>;
    // THE OBJECTS WHOSE "- object:" SITS IN THE friends: BLOCK OF THE OBJECT AT THIS HEADER LINE, IN FILE ORDER
    friendsByParentHeaderIndex: Map<number, IScannedObject[]>;
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
// THE START OF A COMMENT WHOSE TEXT IS A TODO -- GENERATED ("### TODO -- ...", "### TODO: ...") OR HAND-WRITTEN ("# TODO ...") (#354)
const TODO_COMMENT_START_PATTERN = /^#+[ \t]*TODO\b/;
// WHAT MAY STAND BEFORE A YAML QUOTED SCALAR'S OPENING QUOTE: NOTHING, A KEY'S ":", A LIST ITEM'S "-", OR A FLOW COLLECTION
const QUOTED_SCALAR_LEAD_CHARACTERS = new Set(['', ':', '-', ',', '[', '{']);
const FRIENDS_INDENT_STEP = 4;
const API_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const RECORD_TYPE_ID_FIELD_API_NAME = 'RecordTypeId';
const RECORD_TYPE_SECTION_MARKER = '### TODO: -- RecordType Options -- ';
// WHAT ExtensionCommandService AND hasRecordTypeSections BOTH START A RECORD TYPE SECTION'S TODO WITH (#391)
const RECORD_TYPE_OPTIONS_TODO_START = '### TODO: -- RecordType Options --';
const LINE_BREAK_PATTERN = /[\r\n\u0085\u2028\u2029]/;
const FIXED_VALUE_TEMPLATE_OPENERS = ['${', '{{', '{%', '<<', '<%'];
const FIXED_NUMBER_PATTERN = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const FIXED_NUMBER_MAX_EXACT_DIGITS = 15;
// THE BACKEND BUILT THE EXPRESSION, SO THIS ONLY HOLDS IT TO ONE TEMPLATE: NO SECOND OPENER OF EITHER ENVIRONMENT, AND NO "}}" THAT ENDS faker-js EARLY
const CONSTRAINED_EXPRESSION_INNER_DELIMITERS = ['${', '{{', '}}', '{%', '%}', '<<', '<%'];
const CONSTRAINED_EXPRESSION_MAX_LENGTH = 1000;
// RelationshipService.referenceIdRequiredTodo, ALONE OR WITH THE " -- <Parent>, <Parent>" A NESTED TREE APPENDS (#46) -- A TEST HOLDS THE TWO TOGETHER
// AN API NAME THAT YAML 1.1 (PyYAML, snowfakery's reader) OR 1.2 (js-yaml) LOADS AS A BOOLEAN OR NULL RATHER THAN A STRING
export const YAML_NON_STRING_PLAIN_SCALAR_PATTERN = /^(?:y|Y|yes|Yes|YES|n|N|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF|null|Null|NULL)$/;
const REFERENCE_ID_REQUIRED_TODO_TEXT = '### TODO -- REFERENCE ID REQUIRED';
const REFERENCE_ID_REQUIRED_TODO_PATTERN = /^### TODO -- REFERENCE ID REQUIRED(?: -- [^\r\n\u0085\u2028\u2029]*)?[ \t]*$/;

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
        A fixed value written into the recipe FILE (#342): the field's own lines -- its line and every
        continuation, record type variants and all -- become one line holding the value, on every
        occurrence of the object that has the field, nested friends and later record type blocks
        included, each at its own depth. What each occurrence held is answered so it can be put back
        byte for byte; the line ending after the replaced lines is kept, so a missing final newline
        stays missing. The value is held to checkFixedValue and refused when it is a nickname of the
        recipe, as the filtered copy refuses it, and the result is scanned again before it is answered.
    */
    static pinField(recipeText: string, objectApiName: string, fieldApiName: string, fixedValue: IRecipeFixedValue): RecipeFieldPinResult {

        const refusePin = (refusal: { refusal: IRecipeWriterRefusal }): RecipeFieldPinResult => ({ isPinned: false, refusal: refusal.refusal });

        if ( !API_NAME_PATTERN.test(objectApiName) ) {
            return refusePin(this.refuse('invalid-object-api-name', `"${objectApiName}" is not an object api name.`, objectApiName));
        }
        if ( !API_NAME_PATTERN.test(fieldApiName) ) {
            return refusePin(this.refuse('invalid-field-api-name', `"${fieldApiName}" is not a field api name.`, objectApiName, fieldApiName));
        }

        const valueRefusal = this.checkFixedValue(fixedValue);
        if ( valueRefusal !== undefined ) {
            return refusePin(this.refuse('invalid-value', `The fixed value for ${objectApiName}.${fieldApiName} ${valueRefusal}`, objectApiName, fieldApiName));
        }

        const recipeLines = this.splitRecipeLines(recipeText);
        const scannedObjects = this.scanRecipeObjects(recipeLines.lines);

        if ( scannedObjects.some(scannedObject => scannedObject.nicknames.includes(fixedValue.value)) ) {
            return refusePin(this.refuse('invalid-value', `The fixed value for ${objectApiName}.${fieldApiName} is the nickname of an object in this recipe, which generation would read as a reference to that record.`, objectApiName, fieldApiName));
        }

        const located = this.locatePinnableOccurrences(scannedObjects, objectApiName, fieldApiName);
        if ( 'refusal' in located ) {
            return refusePin(located);
        }

        const occurrences: IPinnedFieldOccurrence[] = located.occurrences.map(({ occurrenceIndex, scannedObject, scannedField }) => ({
            occurrenceIndex: occurrenceIndex,
            ...( scannedObject.nicknames[0] !== undefined ? { nickname: scannedObject.nicknames[0] } : {} ),
            writtenLine: this.buildFixedValueFieldLine(this.getObjectLayout(scannedObject.objectIndent).fieldIndent, fieldApiName, fixedValue),
            originalText: this.joinSpanText(recipeLines, scannedField)
        }));

        const patchedLines = this.spliceFieldSpans(recipeLines, located.occurrences.map(({ scannedField }, spanIndex) => ({
            span: scannedField,
            replacementLines: [occurrences[spanIndex].writtenLine],
            replacementInteriorEndings: []
        })));

        if ( !this.isFieldSpanReadBack(scannedObjects, patchedLines.lines, objectApiName, fieldApiName, new Map(occurrences.map(occurrence => [occurrence.occurrenceIndex, 1]))) ) {
            return refusePin(this.refuse('unsupported-field-layout', `${objectApiName}.${fieldApiName} did not read back as one line holding its fixed value, so nothing was written.`, objectApiName, fieldApiName));
        }

        return { isPinned: true, recipeText: this.joinRecipeLines(patchedLines), occurrences: occurrences };

    }

    /*
        Clear for a pinned field (#342): every requested occurrence must still hold EXACTLY the one
        line pinField wrote -- a hand edit, or a file regenerated since, is refused whole and changes
        nothing, as restoreCommentedOutField refuses a commented-out field that was altered. Every
        occurrence is checked before any replacement is built. An occurrence is found by its first
        nickname when exactly one occurrence holds it, and by its place otherwise, so an object added
        above it since does not move it. An occurrence the request does not name that holds a pinned
        line is a COPY made since the pin (Add friend copies a block one level deeper) and is put back
        too, from a recorded original moved to its depth, so Clear never leaves the value behind. A
        line put back may not carry a bare CR or a line break only PyYAML sees, and the result must
        scan to the same objects and fields as before, each restored field spanning exactly the lines
        put back; anything else would be a line this writer never checked.
    */
    static restorePinnedField(recipeText: string, objectApiName: string, fieldApiName: string, restoreRequests: readonly IPinnedFieldRestoreRequest[]): RecipeFieldRestoreResult {

        const refuseRestore = (refusal: { refusal: IRecipeWriterRefusal }): RecipeFieldRestoreResult => ({ isRestored: false, refusal: refusal.refusal });

        if ( !API_NAME_PATTERN.test(objectApiName) ) {
            return refuseRestore(this.refuse('invalid-object-api-name', `"${objectApiName}" is not an object api name.`, objectApiName));
        }
        if ( !API_NAME_PATTERN.test(fieldApiName) ) {
            return refuseRestore(this.refuse('invalid-field-api-name', `"${fieldApiName}" is not a field api name.`, objectApiName, fieldApiName));
        }
        if ( restoreRequests.length === 0 ) {
            return refuseRestore(this.refuse('field-not-found', `There is no pinned ${objectApiName}.${fieldApiName} to put back.`, objectApiName, fieldApiName));
        }

        const recipeLines = this.splitRecipeLines(recipeText);
        const scannedObjects = this.scanRecipeObjects(recipeLines.lines);
        const objectOccurrences = scannedObjects.filter(scannedObject => scannedObject.objectApiName === objectApiName);
        const recordedTargets = this.locateRecordedPinTargets(recipeLines.lines, objectOccurrences, fieldApiName, restoreRequests);
        if ( !recordedTargets ) {
            return refuseRestore(this.refuse('pinned-field-changed', `${objectApiName}.${fieldApiName} is no longer the fixed value the Recipe Cockpit wrote, so it is not put back. Edit the recipe by hand, or pin and clear it again.`, objectApiName, fieldApiName));
        }
        const targets: { occurrenceIndex: number; scannedObject: IScannedObject; scannedField: IScannedField; request?: IPinnedFieldRestoreRequest }[] = [...recordedTargets];

        const pinnedLineTexts = new Set(restoreRequests.map(restoreRequest => restoreRequest.writtenLine.trimStart()));
        objectOccurrences.forEach((scannedObject, occurrenceIndex) => {
            const scannedField = targets.some(target => target.occurrenceIndex === occurrenceIndex) ? undefined : this.findPinnedLineField(scannedObject, fieldApiName);
            if ( scannedField && pinnedLineTexts.has(recipeLines.lines[scannedField.startIndex].trimStart()) ) {
                targets.push({ occurrenceIndex: occurrenceIndex, scannedObject: scannedObject, scannedField: scannedField });
            }
        });

        const recordedSource = restoreRequests.find(restoreRequest => restoreRequest.originalText !== undefined);
        const derivedValueText = restoreRequests.find(restoreRequest => restoreRequest.valueText !== undefined)?.valueText;
        const splices: { span: ILineSpan; replacementLines: string[]; replacementInteriorEndings: string[] }[] = [];
        const lineCountsByOccurrenceIndex = new Map<number, number>();

        for ( const { occurrenceIndex, scannedObject, scannedField, request } of targets ) {

            const layout = this.getObjectLayout(scannedObject.objectIndent);
            const originalText = request
                ? request.originalText
                : recordedSource && this.reindentFieldText(recordedSource.originalText as string, this.countIndent(recordedSource.writtenLine), layout.fieldIndent.length);
            const valueText = request ? request.valueText : derivedValueText;

            let replacement: IRecipeLines | undefined;
            if ( originalText !== undefined ) {
                replacement = this.splitRecipeLines(originalText);
            } else if ( valueText !== undefined ) {
                const fieldLines = this.buildFieldLines(fieldApiName, valueText, layout);
                replacement = fieldLines ? { lines: fieldLines, lineEndings: fieldLines.map(() => '\n') } : undefined;
            }

            if ( !replacement || replacement.lines.some(replacementLine => /[\r\u0085\u2028\u2029]/.test(replacementLine))
                    || layout.fieldLinePattern.exec(replacement.lines[0])?.[1] !== fieldApiName ) {
                return refuseRestore(this.refuseInvalidValue(objectApiName, fieldApiName, scannedObject.nicknames[0]));
            }

            // A RE-DERIVED VALUE TAKES THE ENDING THE FILE ALREADY USES THERE, SO A CRLF FILE STAYS CRLF
            const interiorEndings = originalText !== undefined
                ? replacement.lineEndings.slice(0, -1)
                : replacement.lines.slice(1).map(() => recipeLines.lineEndings[scannedField.startIndex] || '\n');

            splices.push({ span: scannedField, replacementLines: replacement.lines, replacementInteriorEndings: interiorEndings });
            lineCountsByOccurrenceIndex.set(occurrenceIndex, replacement.lines.length);

        }

        const patchedLines = this.spliceFieldSpans(recipeLines, splices);

        if ( !this.isFieldSpanReadBack(scannedObjects, patchedLines.lines, objectApiName, fieldApiName, lineCountsByOccurrenceIndex) ) {
            return refuseRestore(this.refuseInvalidValue(objectApiName, fieldApiName));
        }

        return { isRestored: true, recipeText: this.joinRecipeLines(patchedLines) };

    }

    /*
        Which pinned fields were changed since their pin, for the cockpit's load: ONE split and scan of
        the recipe however many pins it checks, an index of occurrences by object, and per pin exactly
        the checks restorePinnedField makes before it builds anything (locateRecordedPinTargets), so
        the load and Clear cannot disagree. Answers one boolean per pin, in order.
    */
    static listChangedPinnedFields(recipeText: string, pinnedFields: readonly IPinnedFieldCheck[]): boolean[] {

        const { lines } = this.splitRecipeLines(recipeText);
        const occurrencesByObjectApiName = new Map<string, IScannedObject[]>();
        this.scanRecipeObjects(lines).forEach(scannedObject => {
            const objectOccurrences = occurrencesByObjectApiName.get(scannedObject.objectApiName) ?? [];
            objectOccurrences.push(scannedObject);
            occurrencesByObjectApiName.set(scannedObject.objectApiName, objectOccurrences);
        });

        return pinnedFields.map(pinnedField => !this.locateRecordedPinTargets(lines, occurrencesByObjectApiName.get(pinnedField.objectApiName) ?? [], pinnedField.fieldApiName, pinnedField.restoreRequests));

    }

    // EACH RECORDED OCCURRENCE WITH ITS ONE-LINE FIELD, OR undefined WHEN ANY OF THEM NO LONGER HOLDS EXACTLY THE LINE ITS PIN WROTE
    private static locateRecordedPinTargets(lines: string[], objectOccurrences: IScannedObject[], fieldApiName: string, restoreRequests: readonly IPinnedFieldRestoreRequest[]):
        { occurrenceIndex: number; scannedObject: IScannedObject; scannedField: IScannedField; request: IPinnedFieldRestoreRequest }[] | undefined {

        const targets: { occurrenceIndex: number; scannedObject: IScannedObject; scannedField: IScannedField; request: IPinnedFieldRestoreRequest }[] = [];
        for ( const restoreRequest of restoreRequests ) {
            const occurrenceIndex = this.findPinnedOccurrenceIndex(objectOccurrences, restoreRequest);
            const scannedObject = occurrenceIndex === undefined ? undefined : objectOccurrences[occurrenceIndex];
            const scannedField = scannedObject ? this.findPinnedLineField(scannedObject, fieldApiName) : undefined;
            if ( occurrenceIndex === undefined || !scannedObject || !scannedField
                    || targets.some(target => target.occurrenceIndex === occurrenceIndex)
                    || lines[scannedField.startIndex] !== restoreRequest.writtenLine ) {
                return undefined;
            }
            targets.push({ occurrenceIndex: occurrenceIndex, scannedObject: scannedObject, scannedField: scannedField, request: restoreRequest });
        }
        return targets;

    }

    // THE FIELD WHEN THE OCCURRENCE HOLDS IT ONCE, ON ONE LINE, IN ONE fields: BLOCK -- THE ONLY SHAPE A PIN WRITES
    private static findPinnedLineField(scannedObject: IScannedObject, fieldApiName: string): IScannedField | undefined {
        const scannedFields = scannedObject.fields.filter(scannedField => scannedField.fieldApiName === fieldApiName);
        return scannedFields.length === 1 && scannedObject.fieldsLineIndexes.length === 1 && scannedFields[0].endIndex - scannedFields[0].startIndex === 1
            ? scannedFields[0]
            : undefined;
    }

    /*
        A field's lines moved from one field column to another, as insertFriend moves a block one level
        deeper: every non-empty line gains (or loses) the same spaces. undefined when the first line is
        not at fromIndent, or a line has fewer spaces than it would lose.
    */
    static reindentFieldText(fieldText: string, fromIndent: number, toIndent: number): string | undefined {

        const fieldLines = this.splitRecipeLines(fieldText);
        const indentDelta = toIndent - fromIndent;

        if ( this.countIndent(fieldLines.lines[0]) !== fromIndent
                || ( indentDelta < 0 && fieldLines.lines.some(fieldLine => fieldLine !== '' && this.countIndent(fieldLine) < -indentDelta) ) ) {
            return undefined;
        }

        return this.joinRecipeLines({
            lines: fieldLines.lines.map(fieldLine => ( fieldLine === '' ? fieldLine : indentDelta >= 0 ? `${' '.repeat(indentDelta)}${fieldLine}` : fieldLine.slice(-indentDelta) )),
            lineEndings: fieldLines.lineEndings
        });

    }

    static countIndent(line: string): number {
        return line.length - line.replace(/^ +/, '').length;
    }

    // BY ITS FIRST NICKNAME WHEN EXACTLY ONE OCCURRENCE HOLDS IT; OTHERWISE BY ITS PLACE, WHICH MUST STILL HOLD THAT NICKNAME, OR NONE
    private static findPinnedOccurrenceIndex(objectOccurrences: IScannedObject[], restoreRequest: IPinnedFieldRestoreRequest): number | undefined {

        if ( restoreRequest.nickname !== undefined ) {
            const nicknameIndexes = objectOccurrences
                .map((scannedObject, occurrenceIndex) => ( scannedObject.nicknames[0] === restoreRequest.nickname ? occurrenceIndex : -1 ))
                .filter(occurrenceIndex => occurrenceIndex >= 0);
            if ( nicknameIndexes.length === 1 ) {
                return nicknameIndexes[0];
            }
        }

        return objectOccurrences[restoreRequest.occurrenceIndex]?.nicknames[0] === restoreRequest.nickname ? restoreRequest.occurrenceIndex : undefined;

    }

    // EVERY OCCURRENCE OF THE OBJECT THAT CARRIES THE FIELD ONCE, IN ONE fields: BLOCK -- ANY OTHER SHAPE IS REFUSED RATHER THAN GUESSED AT
    private static locatePinnableOccurrences(scannedObjects: IScannedObject[], objectApiName: string, fieldApiName: string):
        { occurrences: { occurrenceIndex: number; scannedObject: IScannedObject; scannedField: IScannedField }[] } | { isApplied: false; refusal: IRecipeWriterRefusal } {

        const objectOccurrences = scannedObjects.filter(scannedObject => scannedObject.objectApiName === objectApiName);
        if ( objectOccurrences.length === 0 ) {
            return this.refuse('object-not-found', `The recipe has no "- object: ${objectApiName}" line.`, objectApiName, fieldApiName);
        }

        const occurrences: { occurrenceIndex: number; scannedObject: IScannedObject; scannedField: IScannedField }[] = [];
        for ( const [occurrenceIndex, scannedObject] of objectOccurrences.entries() ) {
            const scannedFields = scannedObject.fields.filter(scannedField => scannedField.fieldApiName === fieldApiName);
            if ( scannedFields.length === 0 ) {
                continue;
            }
            const objectNickname = scannedObject.nicknames[0];
            const fieldsBlockRefusal = this.refuseUnlessOneFieldsBlock(scannedObject, fieldApiName, objectNickname);
            if ( fieldsBlockRefusal ) {
                return fieldsBlockRefusal;
            }
            if ( scannedFields.length > 1 ) {
                return this.refuse('duplicate-field', `${this.describeObject(objectApiName, objectNickname)} has more than one ${fieldApiName} line, so which to change cannot be told.`, objectApiName, fieldApiName, objectNickname);
            }
            occurrences.push({ occurrenceIndex: occurrenceIndex, scannedObject: scannedObject, scannedField: scannedFields[0] });
        }

        if ( occurrences.length === 0 ) {
            return this.refuse('field-not-found', `${objectApiName} has no ${fieldApiName} line.`, objectApiName, fieldApiName);
        }

        return { occurrences: occurrences };

    }

    // THE SPAN'S LINES JOINED BY THEIR OWN ENDINGS, WITHOUT THE ONE AFTER THE LAST
    private static joinSpanText(recipeLines: IRecipeLines, span: ILineSpan): string {
        return recipeLines.lines.slice(span.startIndex, span.endIndex)
            .map((spanLine, spanLineIndex) => ( span.startIndex + spanLineIndex < span.endIndex - 1 ? `${spanLine}${recipeLines.lineEndings[span.startIndex + spanLineIndex]}` : spanLine ))
            .join('');
    }

    // LAST SPAN FIRST, SO EVERY EARLIER INDEX STAYS WHERE IT WAS; EACH SPLICE KEEPS THE ENDING AFTER THE LINES IT REPLACES
    private static spliceFieldSpans(recipeLines: IRecipeLines, splices: { span: ILineSpan; replacementLines: string[]; replacementInteriorEndings: string[] }[]): IRecipeLines {

        const lines = [...recipeLines.lines];
        const lineEndings = [...recipeLines.lineEndings];

        [...splices].sort((left, right) => right.span.startIndex - left.span.startIndex).forEach(({ span, replacementLines, replacementInteriorEndings }) => {
            const trailingEnding = lineEndings[span.endIndex - 1];
            lines.splice(span.startIndex, span.endIndex - span.startIndex, ...replacementLines);
            lineEndings.splice(span.startIndex, span.endIndex - span.startIndex, ...replacementInteriorEndings, trailingEnding);
        });

        return { lines: lines, lineEndings: lineEndings };

    }

    /*
        The patched file scans to the same objects, in order, with the same nicknames and the same
        field names, and the field spans exactly the expected number of lines on every occurrence
        that was changed: nothing the splice wrote reads as another field or another object.
    */
    private static isFieldSpanReadBack(scannedObjectsBefore: IScannedObject[], patchedLines: string[], objectApiName: string, fieldApiName: string, lineCountsByOccurrenceIndex: ReadonlyMap<number, number>): boolean {

        const scannedObjectsAfter = this.scanRecipeObjects(patchedLines);
        if ( scannedObjectsAfter.length !== scannedObjectsBefore.length ) {
            return false;
        }

        let occurrenceIndex = -1;
        return scannedObjectsAfter.every((scannedObjectAfter, objectIndex) => {

            const scannedObjectBefore = scannedObjectsBefore[objectIndex];
            if ( scannedObjectAfter.objectApiName !== scannedObjectBefore.objectApiName
                    || scannedObjectAfter.objectIndent !== scannedObjectBefore.objectIndent
                    || scannedObjectAfter.nicknames.join('\n') !== scannedObjectBefore.nicknames.join('\n')
                    || scannedObjectAfter.fields.map(scannedField => scannedField.fieldApiName).join('\n') !== scannedObjectBefore.fields.map(scannedField => scannedField.fieldApiName).join('\n') ) {
                return false;
            }

            if ( scannedObjectAfter.objectApiName !== objectApiName ) {
                return true;
            }

            occurrenceIndex += 1;
            const expectedLineCount = lineCountsByOccurrenceIndex.get(occurrenceIndex);
            const changedField = scannedObjectAfter.fields.find(scannedField => scannedField.fieldApiName === fieldApiName);
            return expectedLineCount === undefined || ( !!changedField && changedField.endIndex - changedField.startIndex === expectedLineCount );

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

    /*
        Adds one of an object's friends beneath the nested child iteration a self-lookup gives it
        (#188, #197), so child records hang off child records the way the top occurrence's do.

        The friend's block is COPIED from the top occurrence -- the object whose friends: block holds
        the iteration -- so a hand edit made there is kept, every TODO the generator wrote still says
        what it said, and nothing is regenerated from metadata. Only its OWN block is copied, as
        extractObjectBlock cuts it: the friend's own friends: block stays with the original, so the
        recipe grows by one object per call. The copy moves one friends level deeper and changes in
        exactly two ways:

          - its nickname, so the reader and the writer can still tell it from every other occurrence
            of the object: "_NickName" becomes "_child_NickName" (anything else gains "_child"), and
            "_2", "_3", ... follow while the name is already held anywhere in the file;
          - every field whose whole value was the TOP occurrence's nickname now holds the
            iteration's, so its records point at the child records they are generated under. A
            lookup to any other ancestor still names an ancestor, and any other value -- a TODO, a
            non-ancestor nickname -- is copied as it is.

        The lines go after the iteration's last line, under its friends: block, which is written
        first when the iteration has none. The result is read back through scanRecipeObjects, and
        anything that does not read as exactly one new friend of the iteration is refused rather
        than written.
    */
    static insertFriend(recipeText: string, objectApiName: string, iterationNickname: string, friendObjectApiName: string): RecipeWriterResult {

        const iterationLabel = this.describeObject(objectApiName, iterationNickname);
        const refuseFriend = (reason: RecipeWriterRefusalReason, message: string): { isApplied: false; refusal: IRecipeWriterRefusal } => ({
            isApplied: false,
            refusal: { reason: reason, message: message, objectApiName: objectApiName, objectNickname: iterationNickname, friendObjectApiName: friendObjectApiName }
        });

        if ( !API_NAME_PATTERN.test(friendObjectApiName) ) {
            return refuseFriend('invalid-friend-object-api-name', `"${friendObjectApiName}" is not an object api name.`);
        }

        // REQUIRED HERE, SO A MISSING ONE IS A NICKNAME THAT IS NOT ONE RATHER THAN "ANY OCCURRENCE"
        if ( typeof iterationNickname !== 'string' || !API_NAME_PATTERN.test(iterationNickname) ) {
            return refuseFriend('invalid-object-nickname', `"${iterationNickname}" is not a nickname.`);
        }

        const located = this.locateObject(recipeText, objectApiName, undefined, iterationNickname);
        if ( 'refusal' in located ) {
            return { isApplied: false, refusal: { ...located.refusal, friendObjectApiName: friendObjectApiName } };
        }
        const { recipeLines, scannedObject: iteration, allScannedObjects } = located;

        const topOccurrence = allScannedObjects.find(scannedObject => scannedObject.headerIndex === iteration.parentHeaderIndex);
        if ( !topOccurrence || topOccurrence.objectApiName !== objectApiName ) {
            return refuseFriend('not-a-self-lookup-iteration', `${iterationLabel} is not nested under another ${objectApiName}, so it is not a self-lookup iteration to add a friend to.`);
        }

        if ( topOccurrence.nicknames.length !== 1 ) {
            return refuseFriend('unsupported-friend-layout', `The ${objectApiName} ${iterationNickname} is nested under has ${topOccurrence.nicknames.length === 0 ? 'no' : 'more than one'} "nickname:" line, so which lookups point at it cannot be told.`);
        }

        if ( friendObjectApiName === objectApiName ) {
            return refuseFriend('friend-not-found', `${objectApiName} is the iteration's own object, which is not added beneath itself.`);
        }

        const sourceFriends = allScannedObjects.filter(scannedObject => scannedObject.parentHeaderIndex === topOccurrence.headerIndex && scannedObject.objectApiName === friendObjectApiName);
        if ( sourceFriends.length === 0 ) {
            return refuseFriend('friend-not-found', `The ${objectApiName} above ${iterationNickname} has no ${friendObjectApiName} under its friends: block to copy.`);
        }
        if ( sourceFriends.length > 1 ) {
            return refuseFriend('duplicate-friend', `The ${objectApiName} above ${iterationNickname} has ${friendObjectApiName} under its friends: block more than once, so which to copy cannot be told.`);
        }
        const [sourceFriend] = sourceFriends;

        if ( allScannedObjects.some(scannedObject => scannedObject.parentHeaderIndex === iteration.headerIndex && scannedObject.objectApiName === friendObjectApiName) ) {
            return refuseFriend('friend-already-exists', `${iterationLabel} already has ${friendObjectApiName} under its friends: block, so it is not added again.`);
        }

        if ( iteration.friendsLineIndexes.length > 1 ) {
            return refuseFriend('duplicate-friends-block', `${iterationLabel} has more than one "friends:" line, so which to add to cannot be told.`);
        }

        if ( sourceFriend.nicknames.length !== 1 || sourceFriend.propertyLineIndexes.nickname.length !== 1 ) {
            return refuseFriend('unsupported-friend-layout', `The ${friendObjectApiName} to copy has ${sourceFriend.nicknames.length === 0 ? 'no' : 'more than one'} "nickname:" line, so the copy could not be given one of its own.`);
        }

        const friendNickname = this.buildFriendCopyNickname(sourceFriend.nicknames[0], allScannedObjects);
        if ( !friendNickname ) {
            return refuseFriend('unsupported-friend-layout', `The ${friendObjectApiName} to copy has the nickname "${sourceFriend.nicknames[0]}", from which no nickname of letters, digits and underscores could be made for the copy.`);
        }

        const friendLines = this.buildFriendCopyLines(recipeLines.lines, sourceFriend, topOccurrence.nicknames[0], iterationNickname, friendNickname);

        /*
            The copy is moved a level deeper by indenting each line the JS split sees, but YAML also
            breaks at a lone CR -- and PyYAML at U+0085, U+2028 and U+2029 -- so text after one of
            those would stay at its old column and could leave a block scalar as a field of its own,
            which the read-back below cannot tell from the original. Such a block is refused.
        */
        if ( friendLines.some(friendLine => /[\r\u0085\u2028\u2029]/.test(friendLine)) ) {
            return refuseFriend('unsupported-friend-layout', `The ${friendObjectApiName} to copy has a line break inside a line (a lone carriage return, or U+0085, U+2028 or U+2029), so it could not be moved a level deeper exactly.`);
        }

        const iterationLayout = this.getObjectLayout(iteration.objectIndent);
        const friendIndentation = ' '.repeat(iteration.objectIndent + FRIENDS_INDENT_STEP);
        const insertedLines = [
            ...( iteration.friendsLineIndexes.length === 0 ? [`${iterationLayout.propertyIndent}friends:`] : [] ),
            `${friendIndentation}# ${friendObjectApiName} (Added by the Recipe Cockpit under ${iterationNickname}, copied from the ${friendObjectApiName} under ${topOccurrence.nicknames[0]})`,
            ...friendLines
        ];
        const insertIndex = this.findLastLineIndexOfObject(recipeLines.lines, iteration) + 1;

        const result = this.applySplice(recipeLines, { startIndex: insertIndex, endIndex: insertIndex }, insertedLines, {
            operation: 'insert-friend',
            objectApiName: objectApiName,
            objectNickname: iterationNickname,
            friendObjectApiName: friendObjectApiName,
            friendNickname: friendNickname
        });

        if ( !this.isInsertedFriendReadBack(result.recipeText, allScannedObjects.length, iteration.headerIndex, insertIndex + insertedLines.length - friendLines.length, friendObjectApiName, friendNickname, sourceFriend) ) {
            return refuseFriend('unsupported-friend-layout', `${iterationLabel}'s block does not end with its friends: block, so a ${friendObjectApiName} added after it would not read back as its friend.`);
        }

        return result;

    }

    /*
        The scanned objects by header line and by the friends: block they sit in, built ONCE per scan:
        listInsertableFriendObjectApiNames runs for every iteration of a recipe at every cockpit load,
        and walking the whole scan per iteration made a load of a ten-thousand-object recipe take
        seconds rather than milliseconds.
    */
    static buildScannedFriendIndex(scannedObjects: IScannedObject[]): IScannedFriendIndex {

        const objectsByHeaderIndex = new Map<number, IScannedObject>();
        const friendsByParentHeaderIndex = new Map<number, IScannedObject[]>();

        scannedObjects.forEach(scannedObject => {
            objectsByHeaderIndex.set(scannedObject.headerIndex, scannedObject);
            if ( scannedObject.parentHeaderIndex !== undefined ) {
                const friends = friendsByParentHeaderIndex.get(scannedObject.parentHeaderIndex) ?? [];
                friends.push(scannedObject);
                friendsByParentHeaderIndex.set(scannedObject.parentHeaderIndex, friends);
            }
        });

        return { objectsByHeaderIndex: objectsByHeaderIndex, friendsByParentHeaderIndex: friendsByParentHeaderIndex };

    }

    /*
        The friends insertFriend would accept for this occurrence, in the order the top occurrence
        lists them: what the Recipe Cockpit's "+" offers, so the panel never offers a friend the
        writer would refuse for a reason the file already shows. Empty for anything that is not a
        self-lookup iteration. A caller asking for many iterations of one scan passes the index it
        built once.
    */
    static listInsertableFriendObjectApiNames(scannedObjects: IScannedObject[],
                                                iteration: IScannedObject,
                                                friendIndex: IScannedFriendIndex = this.buildScannedFriendIndex(scannedObjects)): string[] {

        const topOccurrence = iteration.parentHeaderIndex === undefined ? undefined : friendIndex.objectsByHeaderIndex.get(iteration.parentHeaderIndex);

        if ( !topOccurrence
                || topOccurrence.objectApiName !== iteration.objectApiName
                || topOccurrence.nicknames.length !== 1
                || iteration.nicknames.length !== 1
                || !API_NAME_PATTERN.test(iteration.objectApiName)
                || !API_NAME_PATTERN.test(iteration.nicknames[0])
                || iteration.friendsLineIndexes.length > 1 ) {
            return [];
        }

        const topFriends = friendIndex.friendsByParentHeaderIndex.get(topOccurrence.headerIndex) ?? [];
        const iterationFriendApiNames = new Set(( friendIndex.friendsByParentHeaderIndex.get(iteration.headerIndex) ?? [] ).map(friend => friend.objectApiName));
        const topFriendCounts = new Map<string, number>();
        topFriends.forEach(friend => topFriendCounts.set(friend.objectApiName, (topFriendCounts.get(friend.objectApiName) ?? 0) + 1));

        return topFriends
            .filter(friend => friend.objectApiName !== iteration.objectApiName
                                && API_NAME_PATTERN.test(friend.objectApiName)
                                && topFriendCounts.get(friend.objectApiName) === 1
                                && !iterationFriendApiNames.has(friend.objectApiName)
                                && friend.nicknames.length === 1
                                && friend.propertyLineIndexes.nickname.length === 1
                                && !!this.buildFriendCopyBaseNickname(friend.nicknames[0]))
            .map(friend => friend.objectApiName);

    }

    // "_NickName" BECOMES "_child_NickName", ANYTHING ELSE GAINS "_child" -- OR undefined WHEN THAT IS NOT A NAME
    private static buildFriendCopyBaseNickname(sourceNickname: string): string | undefined {

        const baseNickname = /_NickName$/.test(sourceNickname)
            ? sourceNickname.replace(/_NickName$/, '_child_NickName')
            : `${sourceNickname}_child`;

        return API_NAME_PATTERN.test(baseNickname) ? baseNickname : undefined;

    }

    // A NICKNAME NO OCCURRENCE IN THE FILE HOLDS, OR undefined WHEN THE SOURCE'S CANNOT BE MADE INTO ONE
    private static buildFriendCopyNickname(sourceNickname: string, scannedObjects: IScannedObject[]): string | undefined {

        const baseNickname = this.buildFriendCopyBaseNickname(sourceNickname);

        if ( !baseNickname ) {
            return undefined;
        }

        const heldNicknames = new Set(scannedObjects.flatMap(scannedObject => scannedObject.nicknames));
        let candidateNickname = baseNickname;

        for ( let suffix = 2; heldNicknames.has(candidateNickname); suffix++ ) {
            candidateNickname = `${baseNickname}_${suffix}`;
        }

        return candidateNickname;

    }

    // THE SOURCE FRIEND'S OWN BLOCK ONE friends LEVEL DEEPER, WITH ITS NICKNAME AND ITS LOOKUPS TO THE TOP OCCURRENCE CHANGED
    private static buildFriendCopyLines(lines: string[], sourceFriend: IScannedObject, topNickname: string, iterationNickname: string, friendNickname: string): string[] {

        const copyLayout = this.getObjectLayout(sourceFriend.objectIndent + FRIENDS_INDENT_STEP);
        const sourceLayout = this.getObjectLayout(sourceFriend.objectIndent);
        const [nicknameLineIndex] = sourceFriend.propertyLineIndexes.nickname;
        const indentation = ' '.repeat(FRIENDS_INDENT_STEP);

        const rewrittenLinesByIndex = new Map<number, string>([[nicknameLineIndex, `${copyLayout.propertyIndent}nickname: ${friendNickname}`]]);

        sourceFriend.fields
            .filter(scannedField => scannedField.endIndex === scannedField.startIndex + 1
                                        && lines[scannedField.startIndex].slice(sourceLayout.fieldIndent.length + scannedField.fieldApiName.length + 1).trim() === topNickname)
            .forEach(scannedField => rewrittenLinesByIndex.set(scannedField.startIndex, `${copyLayout.fieldIndent}${scannedField.fieldApiName}: ${iterationNickname}`));

        return this.collectOwnBlockLineIndexes(lines, sourceFriend).map(lineIndex => (
            rewrittenLinesByIndex.get(lineIndex) ?? ( lines[lineIndex] ? `${indentation}${lines[lineIndex]}` : lines[lineIndex] )
        ));

    }

    /*
        Whether the patched text reads as before plus exactly one object: the friend, at the header
        line it was written to, nested under the iteration, with the nickname it was given and the
        fields it was copied with.
    */
    private static isInsertedFriendReadBack(patchedRecipeText: string,
                                            scannedObjectCount: number,
                                            iterationHeaderIndex: number,
                                            friendHeaderIndex: number,
                                            friendObjectApiName: string,
                                            friendNickname: string,
                                            sourceFriend: IScannedObject): boolean {

        const patchedScannedObjects = this.scanRecipeObjects(this.splitRecipeLines(patchedRecipeText).lines);
        const insertedFriend = patchedScannedObjects.find(scannedObject => scannedObject.headerIndex === friendHeaderIndex);

        return patchedScannedObjects.length === scannedObjectCount + 1
                && !!insertedFriend
                && insertedFriend.objectApiName === friendObjectApiName
                && insertedFriend.parentHeaderIndex === iterationHeaderIndex
                && insertedFriend.nicknames.length === 1
                && insertedFriend.nicknames[0] === friendNickname
                && insertedFriend.fields.map(scannedField => scannedField.fieldApiName).join('\n') === sourceFriend.fields.map(scannedField => scannedField.fieldApiName).join('\n');

    }

    /*
        Every lookup the recipe still writes as the generated "### TODO -- REFERENCE ID REQUIRED", and
        the nicknames it can be wired to (#151). Wiring writes the nickname as the lookup's value, which
        both backends leave as a plain string and the insert replaces with the Id of the record holding
        that nickname -- so a nickname is offered only where the insert can RESOLVE it: an ANCESTOR of
        the occurrence (a faker-js friend is generated under it), or an object of the same file at a
        strictly LOWER relationship level, which is inserted first. A cycle, a self-lookup's top record
        and a parent with no recipe stay TODOs: there is no record inserted before them to name.

        A nickname counts only when exactly one occurrence in the file carries it, since a nickname two
        occurrences share resolves to whichever is inserted first. Only a field that is ONE line and
        that line exactly the TODO is listed, so a lookup a person already filled in is never offered.
    */
    static listLookupWirings(recipeText: string, wiringContext: ILookupWiringContext): ILookupWiring[] {

        const { lines } = this.splitRecipeLines(recipeText);
        return this.locateLookupWirings(lines, this.scanRecipeObjects(lines), wiringContext).map(locatedWiring => locatedWiring.wiring);

    }

    /*
        Writes each requested nickname over its TODO in ONE scan, or nothing: every request is checked
        against listLookupWirings of the text as it is NOW, so a TODO filled in, a nickname renamed or
        an object moved since the caller listed them refuses the whole batch rather than writing part
        of it. Each field's one line is replaced and every other line, line endings included, is left
        as it was.
    */
    static wireLookups(recipeText: string, wiringRequests: readonly ILookupWiringRequest[], wiringContext: ILookupWiringContext): RecipeLookupWiringResult {

        if ( wiringRequests.length === 0 ) {
            return this.refuse('no-lookup-wirings', 'No lookup was named to wire.', '');
        }

        const requestKeys = new Set<string>();

        for ( const wiringRequest of wiringRequests ) {

            const { objectApiName, objectNickname, fieldApiName, parentNickname } = wiringRequest;

            if ( !API_NAME_PATTERN.test(objectApiName) ) {
                return this.refuse('invalid-object-api-name', `"${objectApiName}" is not an object api name.`, objectApiName, fieldApiName, objectNickname);
            }
            if ( objectNickname !== undefined && !API_NAME_PATTERN.test(objectNickname) ) {
                return this.refuse('invalid-object-nickname', `"${objectNickname}" is not a nickname.`, objectApiName, fieldApiName, objectNickname);
            }
            if ( !API_NAME_PATTERN.test(fieldApiName) ) {
                return this.refuse('invalid-field-api-name', `"${fieldApiName}" is not a field api name.`, objectApiName, fieldApiName, objectNickname);
            }
            if ( !API_NAME_PATTERN.test(parentNickname) ) {
                return this.refuse('invalid-value', `"${parentNickname}" is not a nickname.`, objectApiName, fieldApiName, objectNickname);
            }

            const requestKey = this.buildLookupWiringKey(objectApiName, objectNickname, fieldApiName);
            if ( requestKeys.has(requestKey) ) {
                return this.refuse('duplicate-lookup-wiring', `${this.describeObject(objectApiName, objectNickname)}.${fieldApiName} was named more than once.`, objectApiName, fieldApiName, objectNickname);
            }
            requestKeys.add(requestKey);

        }

        const recipeLines = this.splitRecipeLines(recipeText);
        const scannedObjects = this.scanRecipeObjects(recipeLines.lines);
        const locatedWiringsByKey = new Map(this.locateLookupWirings(recipeLines.lines, scannedObjects, wiringContext)
            .map(locatedWiring => [this.buildLookupWiringKey(locatedWiring.wiring.objectApiName, locatedWiring.wiring.objectNickname, locatedWiring.wiring.fieldApiName), locatedWiring]));

        const nextLines = recipeLines.lines.slice();
        const edits: IRecipeWriterEdit[] = [];

        for ( const wiringRequest of wiringRequests ) {

            const { objectApiName, objectNickname, fieldApiName, parentNickname } = wiringRequest;
            const fieldLabel = `${this.describeObject(objectApiName, objectNickname)}.${fieldApiName}`;
            const locatedWiring = locatedWiringsByKey.get(this.buildLookupWiringKey(objectApiName, objectNickname, fieldApiName));

            if ( !locatedWiring ) {
                return this.refuse('lookup-not-wireable', `${fieldLabel} is no longer a "${REFERENCE_ID_REQUIRED_TODO_TEXT}" lookup with a parent inserted before it, so nothing was wired.`, objectApiName, fieldApiName, objectNickname);
            }

            if ( !locatedWiring.wiring.candidateNicknames.includes(parentNickname) ) {
                return this.refuse('parent-nickname-not-a-candidate', `${parentNickname} is not a record ${fieldLabel} can be wired to: it must be held by one occurrence of ${locatedWiring.wiring.parentObjectApiNames.join(' or ')} inserted before it.`, objectApiName, fieldApiName, objectNickname);
            }

            const wiredLine = `${locatedWiring.fieldIndent}${fieldApiName}: ${parentNickname}`;
            edits.push({
                operation: 'wire-lookup',
                objectApiName: objectApiName,
                ...( objectNickname !== undefined ? { objectNickname: objectNickname } : {} ),
                fieldApiName: fieldApiName,
                parentNickname: parentNickname,
                startLineNumber: locatedWiring.lineIndex + 1,
                removedLines: [recipeLines.lines[locatedWiring.lineIndex]],
                insertedLines: [wiredLine]
            });
            nextLines[locatedWiring.lineIndex] = wiredLine;

        }

        // READ BACK: THE SAME OBJECTS, AND EACH WRITTEN LINE STILL THE FIELD IT REPLACED -- BY ONE INDEX, SINCE A WIRE-ALL CAN BE TENS OF THOUSANDS OF EDITS
        const nextScannedObjects = this.scanRecipeObjects(nextLines);
        const fieldApiNamesByStartIndex = new Map<number, string>();
        nextScannedObjects.forEach(scannedObject => scannedObject.fields.forEach(scannedField => fieldApiNamesByStartIndex.set(scannedField.startIndex, scannedField.fieldApiName)));
        const isReadBack = nextScannedObjects.length === scannedObjects.length
            && edits.every(edit => fieldApiNamesByStartIndex.get(edit.startLineNumber - 1) === edit.fieldApiName);

        if ( !isReadBack ) {
            const firstEdit = edits[0];
            return this.refuse('unsupported-field-layout', 'The wired recipe did not read back as the same objects and fields, so nothing was wired.', firstEdit.objectApiName, firstEdit.fieldApiName, firstEdit.objectNickname);
        }

        return {
            isApplied: true,
            recipeText: this.joinRecipeLines({ lines: nextLines, lineEndings: recipeLines.lineEndings }),
            edits: edits
        };

    }

    static buildLookupWiringKey(objectApiName: string, objectNickname: string | undefined, fieldApiName: string): string {
        return `${objectApiName}\n${objectNickname ?? ''}\n${fieldApiName}`;
    }

    /*
        Every TODO lookup addParentObject would accept (#294): one line that is exactly the
        "### TODO -- REFERENCE ID REQUIRED", whose field the card's lookups point at ONE parent, that
        parent has a template, the recipe writes no block for it, and RelationshipService puts it at
        a strictly LOWER level than the object -- which is what makes the insert send it first and
        listLookupWirings accept its nickname afterwards. It is what the Recipe Cockpit offers, so the
        panel never draws an "Add" the writer would refuse for a reason the file already shows.
    */
    static listAddableParentObjects(recipeText: string,
                                    wiringContext: ILookupWiringContext,
                                    templateObjectApiNames: ReadonlySet<string>): IParentObjectAddition[] {

        const { lines } = this.splitRecipeLines(recipeText);
        const scannedObjects = this.scanRecipeObjects(lines);
        const additionIndex = this.buildParentObjectAdditionIndex(scannedObjects);
        const parentTemplates = Object.fromEntries([...templateObjectApiNames].map(objectApiName => [objectApiName, {}]));

        return scannedObjects.flatMap(scannedObject => {

            const lookupFieldApiNames = new Set(( wiringContext.parentLookupsByObjectApiName.get(scannedObject.objectApiName) ?? [] ).map(parentLookup => parentLookup.fieldApiName));
            if ( lookupFieldApiNames.size === 0 ) {
                return [];
            }

            const occurrences = additionIndex.occurrencesByObjectApiName.get(scannedObject.objectApiName);
            const objectNickname = occurrences.length === 1 ? undefined : scannedObject.nicknames[0];

            return [...new Set(scannedObject.fields.map(scannedField => scannedField.fieldApiName))].filter(fieldApiName => lookupFieldApiNames.has(fieldApiName)).flatMap(fieldApiName => {
                const located = this.locateParentObjectAddition(lines, additionIndex, {
                    objectApiName: scannedObject.objectApiName,
                    ...( objectNickname !== undefined ? { objectNickname: objectNickname } : {} ),
                    fieldApiName: fieldApiName,
                    parentTemplatesByObjectApiName: parentTemplates
                }, wiringContext);
                return 'refusal' in located || located.scannedObject !== scannedObject ? [] : [located.addition];
            });

        });

    }

    /*
        Every TODO lookup to exactly ONE parent (#421), in file order: the field's one line is exactly
        the "### TODO -- REFERENCE ID REQUIRED", and the card's lookups name one parent for it. Each
        says whether addParentObject would add that parent (listAddableParentObjects' own rule, so the
        two never disagree) and whether one Id can be pinned on it. A polymorphic lookup, or an
        object written more than once without a distinct nickname on each, is left out: there is no
        one parent, or no one row, to decide for.
    */
    static listEmptyLookups(recipeText: string,
                            wiringContext: ILookupWiringContext,
                            templateObjectApiNames: ReadonlySet<string>): IEmptyLookup[] {

        const { lines } = this.splitRecipeLines(recipeText);
        const scannedObjects = this.scanRecipeObjects(lines);
        const additionIndex = this.buildParentObjectAdditionIndex(scannedObjects);
        const parentTemplates = Object.fromEntries([...templateObjectApiNames].map(objectApiName => [objectApiName, {}]));
        const orgRecordRefusalsByField = new Map<string, string | undefined>();

        // pinField WRITES EVERY OCCURRENCE OF THE OBJECT THAT HAS THE FIELD, SO EACH MUST STILL BE THE EMPTY LOOKUP; ONCE PER OBJECT AND FIELD
        const findOrgRecordRefusal = (objectApiName: string, fieldApiName: string): string | undefined => {
            const fieldKey = `${objectApiName}\n${fieldApiName}`;
            if ( !orgRecordRefusalsByField.has(fieldKey) ) {
                const occurrences = additionIndex.occurrencesByObjectApiName.get(objectApiName) ?? [];
                const filledCount = occurrences.filter(occurrence => {
                    const { fieldIndent } = this.getObjectLayout(occurrence.objectIndent);
                    return occurrence.fields.filter(scannedField => scannedField.fieldApiName === fieldApiName).some(scannedField => (
                        !REFERENCE_ID_REQUIRED_TODO_PATTERN.test(lines[scannedField.startIndex].slice(fieldIndent.length + fieldApiName.length + 1).replace(/^[ \t]+/, ''))
                            || lines.slice(scannedField.startIndex + 1, scannedField.endIndex).some(continuationLine => continuationLine.trim())
                    ));
                }).length;
                orgRecordRefusalsByField.set(fieldKey, filledCount === 0
                    ? undefined
                    : `The recipe writes ${objectApiName} ${occurrences.length} times and ${fieldApiName} is already set on ${filledCount} of them; an org record is written on every one, so it would replace ${filledCount === 1 ? 'that value' : 'those values'}.`);
            }
            return orgRecordRefusalsByField.get(fieldKey);
        };

        return scannedObjects.flatMap(scannedObject => {

            const parentLookups = wiringContext.parentLookupsByObjectApiName.get(scannedObject.objectApiName) ?? [];
            if ( parentLookups.length === 0 ) {
                return [];
            }

            const occurrences = additionIndex.occurrencesByObjectApiName.get(scannedObject.objectApiName);
            const objectNickname = occurrences.length === 1 ? undefined : scannedObject.nicknames[0];

            return [...new Set(scannedObject.fields.map(scannedField => scannedField.fieldApiName))].flatMap(fieldApiName => {

                const parentObjectApiNames = [...new Set(parentLookups.filter(parentLookup => parentLookup.fieldApiName === fieldApiName).map(parentLookup => parentLookup.parentObjectApiName))];
                if ( parentObjectApiNames.length !== 1 || !API_NAME_PATTERN.test(parentObjectApiNames[0]) ) {
                    return [];
                }

                const located = this.locateParentObjectAddition(lines, additionIndex, {
                    objectApiName: scannedObject.objectApiName,
                    ...( objectNickname !== undefined ? { objectNickname: objectNickname } : {} ),
                    fieldApiName: fieldApiName,
                    parentTemplatesByObjectApiName: parentTemplates
                }, wiringContext);

                if ( 'refusal' in located ? !CREATE_PARENT_REFUSAL_REASONS.has(located.refusal.reason) : located.scannedObject !== scannedObject ) {
                    return [];
                }

                const orgRecordRefusal = findOrgRecordRefusal(scannedObject.objectApiName, fieldApiName);

                return [{
                    objectApiName: scannedObject.objectApiName,
                    ...( objectNickname !== undefined ? { objectNickname: objectNickname } : {} ),
                    fieldApiName: fieldApiName,
                    parentObjectApiName: parentObjectApiNames[0],
                    ...( 'refusal' in located ? { createRefusalReason: located.refusal.reason as CreateParentRefusalReason } : {} ),
                    ...( orgRecordRefusal !== undefined ? { orgRecordRefusal: orgRecordRefusal } : {} )
                }];

            });

        });

    }

    /*
        Adds the lookup's parent to the recipe as a top-level block -- a unique nickname, "count: 1"
        and only the template's fields -- and wires the lookup to it, in one write or none (#294).
        The block goes directly above the top-level block holding the lookup (above the comment lines
        that head it), so the parent reads before its children; the insert sends it first by its
        level either way. Everything is checked against the text as it is NOW, so a lookup filled in
        or a parent added since the caller listed it refuses rather than writing a second block.
        Only the new lines and the lookup's one line change; every other line keeps its bytes and
        its line ending, and the result is scanned again before it is answered.
    */
    static addParentObject(recipeText: string, additionRequest: IParentObjectAdditionRequest, wiringContext: ILookupWiringContext): RecipeParentObjectAdditionResult {

        const { objectApiName, objectNickname, fieldApiName } = additionRequest;

        if ( !API_NAME_PATTERN.test(objectApiName) ) {
            return this.refuse('invalid-object-api-name', `"${objectApiName}" is not an object api name.`, objectApiName, fieldApiName, objectNickname);
        }
        if ( objectNickname !== undefined && !API_NAME_PATTERN.test(objectNickname) ) {
            return this.refuse('invalid-object-nickname', `"${objectNickname}" is not a nickname.`, objectApiName, fieldApiName, objectNickname);
        }
        if ( !API_NAME_PATTERN.test(fieldApiName) ) {
            return this.refuse('invalid-field-api-name', `"${fieldApiName}" is not a field api name.`, objectApiName, fieldApiName, objectNickname);
        }

        const recipeLines = this.splitRecipeLines(recipeText);
        const scannedObjects = this.scanRecipeObjects(recipeLines.lines);
        const additionIndex = this.buildParentObjectAdditionIndex(scannedObjects);
        const located = this.locateParentObjectAddition(recipeLines.lines, additionIndex, additionRequest, wiringContext);

        if ( 'refusal' in located ) {
            return located;
        }

        const { parentObjectApiName } = located.addition;
        const parentTemplate = additionRequest.parentTemplatesByObjectApiName[parentObjectApiName];
        const fieldLabel = `${this.describeObject(objectApiName, objectNickname)}.${fieldApiName}`;
        const topLayout = this.getObjectLayout(0);

        const templateFieldLines: string[] = [];
        for ( const [templateFieldApiName, templateValueText] of Object.entries(parentTemplate) ) {
            const fieldLines = API_NAME_PATTERN.test(templateFieldApiName) && typeof templateValueText === 'string'
                ? this.buildFieldLines(templateFieldApiName, templateValueText, topLayout)
                : undefined;
            if ( !fieldLines ) {
                return this.refuse('invalid-value', `The ${parentObjectApiName} template's ${templateFieldApiName} does not keep the recipe layout, so nothing was added.`, objectApiName, fieldApiName, objectNickname);
            }
            templateFieldLines.push(...fieldLines);
        }

        const heldNicknames = new Set(scannedObjects.flatMap(scannedObject => scannedObject.nicknames));
        const baseNickname = `${parentObjectApiName}_NickName`;
        let parentNickname = baseNickname;
        for ( let suffix = 2; heldNicknames.has(parentNickname); suffix++ ) {
            parentNickname = `${baseNickname}_${suffix}`;
        }

        const blockLines = [
            `# ${parentObjectApiName} (Added by the Recipe Cockpit as the parent of ${fieldLabel})`,
            `- object: ${parentObjectApiName}`,
            `${topLayout.propertyIndent}nickname: ${parentNickname}`,
            `${topLayout.propertyIndent}count: 1`,
            ...( templateFieldLines.length > 0 ? [`${topLayout.propertyIndent}fields:`, ...templateFieldLines] : [] ),
            ''
        ];

        /*
            The block goes above the comment that names the top-level object -- Generate Treecipe's
            "# Contact (Parents: …)", with or without blank lines before the header -- so that comment
            stays with the object it names. Any other comment (a "# Level N" banner, a reader's note)
            is not taken to head the object, so the block goes directly above the header instead.
        */
        const rootObjectApiName = additionIndex.friendIndex.objectsByHeaderIndex.get(located.rootHeaderIndex).objectApiName;
        let headingIndex = located.rootHeaderIndex - 1;
        while ( headingIndex >= 0 && !recipeLines.lines[headingIndex].trim() ) {
            headingIndex--;
        }
        const isRootHeading = headingIndex >= 0
            && ( recipeLines.lines[headingIndex] === `# ${rootObjectApiName}` || recipeLines.lines[headingIndex].startsWith(`# ${rootObjectApiName} `) );
        const insertIndex = isRootHeading ? headingIndex : located.rootHeaderIndex;

        if ( additionRequest.nestTreeUnderParent ) {
            return this.nestTreeUnderAddedParent(recipeLines, scannedObjects, additionIndex, located, additionRequest, wiringContext, {
                parentObjectApiName: parentObjectApiName,
                parentNickname: parentNickname,
                parentFieldApiNames: Object.keys(parentTemplate),
                templateFieldLines: templateFieldLines,
                moveStartIndex: insertIndex
            });
        }

        const { lines, lineEndings } = recipeLines;
        const defaultLineEnding = lineEndings.find(lineEnding => lineEnding) ?? '\n';
        const blockLineEnding = ( insertIndex > 0 ? lineEndings[insertIndex - 1] : lineEndings[insertIndex] ) || defaultLineEnding;
        const wiredLine = `${located.fieldIndent}${fieldApiName}: ${parentNickname}`;

        const wiredLines = lines.slice();
        wiredLines[located.lineIndex] = wiredLine;
        const nextLines = [...wiredLines.slice(0, insertIndex), ...blockLines, ...wiredLines.slice(insertIndex)];
        const nextLineEndings = [...lineEndings.slice(0, insertIndex), ...blockLines.map(() => blockLineEnding), ...lineEndings.slice(insertIndex)];
        const wiredLineIndex = located.lineIndex + blockLines.length;

        // READ BACK: EVERY OBJECT THAT WAS THERE, PLUS THE PARENT AT THE TOP LEVEL WITH ITS NICKNAME AND THE TEMPLATE'S FIELDS, AND THE LOOKUP STILL ITS FIELD
        const nextScannedObjects = this.scanRecipeObjects(nextLines);
        const addedParent = nextScannedObjects.find(scannedObject => scannedObject.headerIndex === insertIndex + 1);
        const wiredObject = nextScannedObjects.find(scannedObject => scannedObject.headerIndex === located.scannedObject.headerIndex + blockLines.length);
        const isReadBack = nextScannedObjects.length === scannedObjects.length + 1
            && !!addedParent
            && addedParent.objectApiName === parentObjectApiName
            && addedParent.objectIndent === 0
            && addedParent.nicknames.length === 1
            && addedParent.nicknames[0] === parentNickname
            && addedParent.propertyLineIndexes.count.length === 1
            && addedParent.fields.map(scannedField => scannedField.fieldApiName).join('\n') === Object.keys(parentTemplate).join('\n')
            && !!wiredObject
            && wiredObject.objectApiName === objectApiName
            && wiredObject.fields.some(scannedField => scannedField.startIndex === wiredLineIndex && scannedField.fieldApiName === fieldApiName);

        if ( !isReadBack ) {
            return this.refuse('unsupported-field-layout', `The recipe with ${parentObjectApiName} added did not read back as the same objects plus ${parentObjectApiName}, so nothing was added.`, objectApiName, fieldApiName, objectNickname);
        }

        return {
            isApplied: true,
            recipeText: this.joinRecipeLines({ lines: nextLines, lineEndings: nextLineEndings }),
            parentObjectApiName: parentObjectApiName,
            parentNickname: parentNickname,
            edits: [
                {
                    operation: 'add-parent-object',
                    objectApiName: objectApiName,
                    ...( objectNickname !== undefined ? { objectNickname: objectNickname } : {} ),
                    fieldApiName: fieldApiName,
                    parentObjectApiName: parentObjectApiName,
                    parentNickname: parentNickname,
                    startLineNumber: insertIndex + 1,
                    removedLines: [],
                    insertedLines: blockLines
                },
                {
                    operation: 'wire-lookup',
                    objectApiName: objectApiName,
                    ...( objectNickname !== undefined ? { objectNickname: objectNickname } : {} ),
                    fieldApiName: fieldApiName,
                    parentNickname: parentNickname,
                    startLineNumber: wiredLineIndex + 1,
                    removedLines: [lines[located.lineIndex]],
                    insertedLines: [wiredLine]
                }
            ]
        };

    }

    /*
        The nested addition (#405): the parent's block takes the place of the top-level block holding
        the lookup, and that block -- with the "# <Object>" comment that heads it, its own friends:
        and everything under them -- moves under the parent's new friends: line, every line four
        spaces deeper, so each object and field keeps its column relative to its block and a block
        scalar keeps its content. The parent is then an ANCESTOR of every moved object, which is the
        wiring Generate Treecipe writes for a nested tree (#46): the requested lookup and every other
        moved TODO lookup that points at this parent alone, from an object at a higher level, take
        its nickname. Nothing outside the moved block changes, and the result is read back as the
        same objects -- the moved ones one level deeper -- plus the parent.
    */
    private static nestTreeUnderAddedParent(recipeLines: IRecipeLines,
                                            scannedObjects: IScannedObject[],
                                            additionIndex: ReturnType<typeof RecipeCockpitRecipeWriter.buildParentObjectAdditionIndex>,
                                            located: { addition: IParentObjectAddition; scannedObject: IScannedObject; lineIndex: number; fieldIndent: string; rootHeaderIndex: number },
                                            additionRequest: IParentObjectAdditionRequest,
                                            wiringContext: ILookupWiringContext,
                                            parentBlock: { parentObjectApiName: string; parentNickname: string; parentFieldApiNames: string[]; templateFieldLines: string[]; moveStartIndex: number }):
        RecipeParentObjectAdditionResult {

        const { objectApiName, objectNickname, fieldApiName } = additionRequest;
        const { parentObjectApiName, parentNickname, parentFieldApiNames, templateFieldLines, moveStartIndex } = parentBlock;
        const { lines, lineEndings } = recipeLines;
        const refuse = (reason: RecipeWriterRefusalReason, message: string) => this.refuse(reason, message, objectApiName, fieldApiName, objectNickname);

        const rootObject = additionIndex.friendIndex.objectsByHeaderIndex.get(located.rootHeaderIndex);
        const moveEndIndex = this.findLastLineIndexOfObject(lines, rootObject) + 1;
        const movedObjects = scannedObjects.filter(scannedObject => scannedObject.headerIndex >= located.rootHeaderIndex && scannedObject.headerIndex < moveEndIndex);
        const movedLines = lines.slice(moveStartIndex, moveEndIndex);

        /*
            The move ends at the block's last line before a column-0 line, but a reader's column-0
            comment does not end the block for YAML: an indented line after it is still the block's,
            and would keep its old column. Up to the next top-level object, only column-0 lines and
            blank ones may follow.
        */
        const nextTopLevelHeaderIndex = scannedObjects.find(scannedObject => scannedObject.objectIndent === 0 && scannedObject.headerIndex > located.rootHeaderIndex)?.headerIndex ?? lines.length;
        if ( lines.slice(moveEndIndex, nextTopLevelHeaderIndex).some(trailingLine => trailingLine.trim() && /^\s/.test(trailingLine)) ) {
            return refuse('unsupported-friend-layout', `The ${rootObject.objectApiName} block continues after a line at column 0, such as a comment, so it could not be moved under ${parentObjectApiName} as a whole.`);
        }

        // AS FOR insertFriend: TEXT AFTER A BREAK THE JS SPLIT DOES NOT SEE WOULD KEEP ITS OLD COLUMN
        if ( movedLines.some(movedLine => /[\r\u0085\u2028\u2029]/.test(movedLine)) ) {
            return refuse('unsupported-friend-layout', `The ${rootObject.objectApiName} block has a line break inside a line (a lone carriage return, or U+0085, U+2028 or U+2029), so it could not be moved under ${parentObjectApiName} exactly.`);
        }

        const wirings = this.listNestedParentWirings(lines, movedObjects, additionIndex, parentObjectApiName, wiringContext);
        if ( !wirings.some(wiring => wiring.lineIndex === located.lineIndex) ) {
            return refuse('lookup-not-wireable', `${this.describeObject(objectApiName, objectNickname)}.${fieldApiName} could not be wired to ${parentObjectApiName} in the moved block, so nothing was added.`);
        }
        const wiredLinesByIndex = new Map(wirings.map(wiring => [wiring.lineIndex, `${wiring.fieldIndent}${' '.repeat(FRIENDS_INDENT_STEP)}${wiring.lookup.fieldApiName}: ${parentNickname}`]));

        const topLayout = this.getObjectLayout(0);
        const indentation = ' '.repeat(FRIENDS_INDENT_STEP);
        const parentLines = [
            `# ${parentObjectApiName} (Added by the Recipe Cockpit as the parent of ${rootObject.objectApiName}, nested under it as friends)`,
            `- object: ${parentObjectApiName}`,
            `${topLayout.propertyIndent}nickname: ${parentNickname}`,
            `${topLayout.propertyIndent}count: 1`,
            ...( templateFieldLines.length > 0 ? [`${topLayout.propertyIndent}fields:`, ...templateFieldLines] : [] ),
            `${topLayout.propertyIndent}friends:`
        ];
        const nestedLines = movedLines.map((movedLine, offset) => wiredLinesByIndex.get(moveStartIndex + offset) ?? ( movedLine ? `${indentation}${movedLine}` : movedLine ));

        const defaultLineEnding = lineEndings.find(lineEnding => lineEnding) ?? '\n';
        const blockLineEnding = ( moveStartIndex > 0 ? lineEndings[moveStartIndex - 1] : lineEndings[moveStartIndex] ) || defaultLineEnding;
        const nextLines = [...lines.slice(0, moveStartIndex), ...parentLines, ...nestedLines, ...lines.slice(moveEndIndex)];
        const nextLineEndings = [...lineEndings.slice(0, moveStartIndex), ...parentLines.map(() => blockLineEnding), ...lineEndings.slice(moveStartIndex)];

        // READ BACK: EVERY OBJECT AT ITS SHIFTED LINE, THE MOVED ONES ONE LEVEL DEEPER UNDER THE PARENT, AND EVERY WIRED LINE STILL ITS FIELD
        const shift = parentLines.length;
        const parentHeaderIndex = moveStartIndex + 1;
        const nextScannedObjects = this.scanRecipeObjects(nextLines);
        const nextObjectsByHeaderIndex = new Map(nextScannedObjects.map(scannedObject => [scannedObject.headerIndex, scannedObject]));
        const addedParent = nextObjectsByHeaderIndex.get(parentHeaderIndex);
        const shiftLineIndex = (lineIndex: number) => ( lineIndex >= moveStartIndex ? lineIndex + shift : lineIndex );
        const isFieldList = (left: IScannedObject, right: IScannedObject) => left.fields.map(scannedField => scannedField.fieldApiName).join('\n') === right.fields.map(scannedField => scannedField.fieldApiName).join('\n');

        const isReadBack = nextScannedObjects.length === scannedObjects.length + 1
            && !!addedParent
            && addedParent.objectApiName === parentObjectApiName
            && addedParent.objectIndent === 0
            && addedParent.nicknames.length === 1
            && addedParent.nicknames[0] === parentNickname
            && addedParent.propertyLineIndexes.count.length === 1
            && addedParent.friendsLineIndexes.length === 1
            && addedParent.fields.map(scannedField => scannedField.fieldApiName).join('\n') === parentFieldApiNames.join('\n')
            && scannedObjects.every(scannedObject => {
                const isMoved = scannedObject.headerIndex >= located.rootHeaderIndex && scannedObject.headerIndex < moveEndIndex;
                const nextObject = nextObjectsByHeaderIndex.get(shiftLineIndex(scannedObject.headerIndex));
                const expectedParentHeaderIndex = scannedObject.headerIndex === located.rootHeaderIndex
                    ? parentHeaderIndex
                    : ( scannedObject.parentHeaderIndex === undefined ? undefined : shiftLineIndex(scannedObject.parentHeaderIndex) );
                return !!nextObject
                    && nextObject.parentHeaderIndex === expectedParentHeaderIndex
                    && nextObject.objectApiName === scannedObject.objectApiName
                    && nextObject.objectIndent === scannedObject.objectIndent + ( isMoved ? FRIENDS_INDENT_STEP : 0 )
                    && nextObject.nicknames.join('\n') === scannedObject.nicknames.join('\n')
                    && isFieldList(nextObject, scannedObject);
            })
            && wirings.every(wiring => nextObjectsByHeaderIndex.get(wiring.scannedObject.headerIndex + shift)?.fields
                .some(scannedField => scannedField.startIndex === wiring.lineIndex + shift && scannedField.fieldApiName === wiring.lookup.fieldApiName));

        if ( !isReadBack ) {
            return refuse('unsupported-friend-layout', `The recipe with ${rootObject.objectApiName} moved under ${parentObjectApiName} did not read back as the same objects one level deeper plus ${parentObjectApiName}, so nothing was added.`);
        }

        return {
            isApplied: true,
            recipeText: this.joinRecipeLines({ lines: nextLines, lineEndings: nextLineEndings }),
            parentObjectApiName: parentObjectApiName,
            parentNickname: parentNickname,
            nestedObjectApiNames: [...new Set(movedObjects.map(scannedObject => scannedObject.objectApiName))],
            wiredLookups: wirings.map(wiring => wiring.lookup),
            edits: [
                {
                    operation: 'add-parent-object',
                    objectApiName: objectApiName,
                    ...( objectNickname !== undefined ? { objectNickname: objectNickname } : {} ),
                    fieldApiName: fieldApiName,
                    parentObjectApiName: parentObjectApiName,
                    parentNickname: parentNickname,
                    startLineNumber: moveStartIndex + 1,
                    removedLines: movedLines,
                    insertedLines: [...parentLines, ...nestedLines]
                }
            ]
        };

    }

    /*
        The moved block's TODO lookups a nested addition wires to the parent (#405): a field of ONE
        line that is exactly the REFERENCE ID REQUIRED TODO, in an occurrence with one fields: block
        and the field once, which the card's lookups point at this parent ALONE, from an object at a
        strictly higher level -- so the insert still sends the parent first. An object written more
        than once is wired only when every occurrence has a nickname of its own, as #151's wiring.
    */
    private static listNestedParentWirings(lines: string[],
                                            movedObjects: IScannedObject[],
                                            additionIndex: ReturnType<typeof RecipeCockpitRecipeWriter.buildParentObjectAdditionIndex>,
                                            parentObjectApiName: string,
                                            wiringContext: ILookupWiringContext):
        { lookup: IParentObjectAdditionWiring; scannedObject: IScannedObject; lineIndex: number; fieldIndent: string }[] {

        const parentLevel = wiringContext.levelsByObjectApiName?.get(parentObjectApiName);

        return movedObjects.flatMap(scannedObject => {

            const objectLevel = wiringContext.levelsByObjectApiName?.get(scannedObject.objectApiName);
            const occurrences = additionIndex.occurrencesByObjectApiName.get(scannedObject.objectApiName) ?? [];

            if ( parentLevel === undefined || objectLevel === undefined || parentLevel >= objectLevel
                    || scannedObject.fieldsLineIndexes.length !== 1
                    || ( occurrences.length > 1 && !additionIndex.hasDistinctNicknamesByObjectApiName.get(scannedObject.objectApiName) ) ) {
                return [];
            }

            const parentObjectApiNamesByField = new Map<string, Set<string>>();
            ( wiringContext.parentLookupsByObjectApiName.get(scannedObject.objectApiName) ?? [] ).forEach(parentLookup => {
                const parentObjectApiNames = parentObjectApiNamesByField.get(parentLookup.fieldApiName) ?? new Set<string>();
                parentObjectApiNames.add(parentLookup.parentObjectApiName);
                parentObjectApiNamesByField.set(parentLookup.fieldApiName, parentObjectApiNames);
            });

            const { fieldIndent } = this.getObjectLayout(scannedObject.objectIndent);
            const fieldCounts = new Map<string, number>();
            scannedObject.fields.forEach(scannedField => fieldCounts.set(scannedField.fieldApiName, (fieldCounts.get(scannedField.fieldApiName) ?? 0) + 1));

            return scannedObject.fields.filter(scannedField => {
                const parentObjectApiNames = parentObjectApiNamesByField.get(scannedField.fieldApiName);
                const valueText = lines[scannedField.startIndex].slice(fieldIndent.length + scannedField.fieldApiName.length + 1).replace(/^[ \t]+/, '');
                return fieldCounts.get(scannedField.fieldApiName) === 1
                    && parentObjectApiNames?.size === 1
                    && parentObjectApiNames.has(parentObjectApiName)
                    && REFERENCE_ID_REQUIRED_TODO_PATTERN.test(valueText)
                    && !lines.slice(scannedField.startIndex + 1, scannedField.endIndex).some(continuationLine => continuationLine.trim());
            }).map(scannedField => ({
                lookup: {
                    objectApiName: scannedObject.objectApiName,
                    ...( occurrences.length > 1 ? { objectNickname: scannedObject.nicknames[0] } : {} ),
                    fieldApiName: scannedField.fieldApiName
                },
                scannedObject: scannedObject,
                lineIndex: scannedField.startIndex,
                fieldIndent: fieldIndent
            }));

        });

    }

    private static buildParentObjectAdditionIndex(scannedObjects: IScannedObject[]): {
        friendIndex: IScannedFriendIndex;
        occurrencesByObjectApiName: Map<string, IScannedObject[]>;
        hasDistinctNicknamesByObjectApiName: Map<string, boolean>;
        occurrencesByNickname: Map<string, IScannedObject>;
    } {

        const occurrencesByObjectApiName = new Map<string, IScannedObject[]>();
        const occurrenceCountsByNickname = new Map<string, number>();

        scannedObjects.forEach(scannedObject => {
            const occurrences = occurrencesByObjectApiName.get(scannedObject.objectApiName);
            if ( occurrences ) {
                occurrences.push(scannedObject);
            } else {
                occurrencesByObjectApiName.set(scannedObject.objectApiName, [scannedObject]);
            }
            scannedObject.nicknames.forEach(nickname => occurrenceCountsByNickname.set(nickname, (occurrenceCountsByNickname.get(nickname) ?? 0) + 1));
        });

        // WHETHER EVERY OCCURRENCE OF AN OBJECT HAS A NICKNAME NO OTHER OCCURRENCE HOLDS -- ONCE PER OBJECT, NOT PER LOOKUP, SINCE AN OBJECT CAN BE WRITTEN THOUSANDS OF TIMES
        const hasDistinctNicknamesByObjectApiName = new Map<string, boolean>();
        occurrencesByObjectApiName.forEach((occurrences, objectApiName) => hasDistinctNicknamesByObjectApiName.set(objectApiName, occurrences.every(occurrence => (
            occurrence.nicknames.length === 1
                && API_NAME_PATTERN.test(occurrence.nicknames[0])
                && occurrenceCountsByNickname.get(occurrence.nicknames[0]) === 1
        ))));

        const occurrencesByNickname = new Map<string, IScannedObject>();
        scannedObjects.forEach(scannedObject => {
            if ( scannedObject.nicknames.length === 1 && occurrenceCountsByNickname.get(scannedObject.nicknames[0]) === 1 ) {
                occurrencesByNickname.set(scannedObject.nicknames[0], scannedObject);
            }
        });

        return {
            friendIndex: this.buildScannedFriendIndex(scannedObjects),
            occurrencesByObjectApiName: occurrencesByObjectApiName,
            hasDistinctNicknamesByObjectApiName: hasDistinctNicknamesByObjectApiName,
            occurrencesByNickname: occurrencesByNickname
        };

    }

    // THE ONE RULE BOTH listAddableParentObjects AND addParentObject DECIDE BY, WITH A REFUSAL SAYING WHICH PART FAILED
    private static locateParentObjectAddition(lines: string[],
                                                additionIndex: ReturnType<typeof RecipeCockpitRecipeWriter.buildParentObjectAdditionIndex>,
                                                additionRequest: IParentObjectAdditionRequest,
                                                wiringContext: ILookupWiringContext):
        { addition: IParentObjectAddition; scannedObject: IScannedObject; lineIndex: number; fieldIndent: string; rootHeaderIndex: number } | { isApplied: false; refusal: IRecipeWriterRefusal } {

        const { objectApiName, objectNickname, fieldApiName, parentTemplatesByObjectApiName } = additionRequest;
        const { friendIndex, occurrencesByObjectApiName, hasDistinctNicknamesByObjectApiName, occurrencesByNickname } = additionIndex;
        const refuse = (reason: RecipeWriterRefusalReason, message: string) => this.refuse(reason, message, objectApiName, fieldApiName, objectNickname);
        const objectLabel = this.describeObject(objectApiName, objectNickname);
        const fieldLabel = `${objectLabel}.${fieldApiName}`;

        // listAddableParentObjects ASKS ABOUT EVERY OBJECT THE FILE WRITES, AND ONLY AN API NAME MAY REACH A NOTIFICATION OR THE RECIPE
        if ( !API_NAME_PATTERN.test(objectApiName) || !API_NAME_PATTERN.test(fieldApiName) || ( objectNickname !== undefined && !API_NAME_PATTERN.test(objectNickname) ) ) {
            return refuse('invalid-object-api-name', `"${objectApiName}.${fieldApiName}" is not an object and field api name.`);
        }

        const occurrences = occurrencesByObjectApiName.get(objectApiName) ?? [];
        if ( occurrences.length === 0 ) {
            return refuse('object-not-found', `The recipe has no "- object: ${objectApiName}" line.`);
        }

        if ( occurrences.length > 1 && ( objectNickname === undefined || !hasDistinctNicknamesByObjectApiName.get(objectApiName) ) ) {
            return refuse('duplicate-object', `The recipe writes ${objectApiName} ${occurrences.length} times and its occurrences cannot be told apart by nickname, so which one's lookup to wire cannot be told.`);
        }

        const nicknamedOccurrence = objectNickname === undefined ? undefined : occurrencesByNickname.get(objectNickname);
        const scannedObject = occurrences.length === 1 && ( objectNickname === undefined || occurrences[0].nicknames.includes(objectNickname) )
            ? occurrences[0]
            : ( nicknamedOccurrence?.objectApiName === objectApiName ? nicknamedOccurrence : undefined );

        if ( !scannedObject ) {
            return refuse('object-not-found', `The recipe has no "- object: ${objectApiName}" with the nickname ${objectNickname}.`);
        }

        const { fieldIndent } = this.getObjectLayout(scannedObject.objectIndent);
        const scannedFields = scannedObject.fields.filter(scannedField => scannedField.fieldApiName === fieldApiName);
        const scannedField = scannedObject.fieldsLineIndexes.length === 1 && scannedFields.length === 1 ? scannedFields[0] : undefined;
        const valueText = scannedField ? lines[scannedField.startIndex].slice(fieldIndent.length + fieldApiName.length + 1).replace(/^[ \t]+/, '') : '';

        if ( !scannedField
                || !REFERENCE_ID_REQUIRED_TODO_PATTERN.test(valueText)
                || lines.slice(scannedField.startIndex + 1, scannedField.endIndex).some(continuationLine => continuationLine.trim()) ) {
            return refuse('lookup-not-wireable', `${fieldLabel} is no longer a "${REFERENCE_ID_REQUIRED_TODO_TEXT}" lookup, so nothing was added.`);
        }

        const parentObjectApiNames = [...new Set(( wiringContext.parentLookupsByObjectApiName.get(objectApiName) ?? [] )
            .filter(parentLookup => parentLookup.fieldApiName === fieldApiName)
            .map(parentLookup => parentLookup.parentObjectApiName))];

        if ( parentObjectApiNames.length === 0 ) {
            return refuse('lookup-not-wireable', `${fieldLabel} is not a lookup of this tree, so nothing was added.`);
        }

        if ( parentObjectApiNames.length > 1 ) {
            return refuse('polymorphic-lookup', `${fieldLabel} can point at ${parentObjectApiNames.join(' or ')}, so which object to add cannot be told.`);
        }

        const [parentObjectApiName] = parentObjectApiNames;

        if ( !API_NAME_PATTERN.test(parentObjectApiName) || !Object.prototype.hasOwnProperty.call(parentTemplatesByObjectApiName, parentObjectApiName) ) {
            return refuse('no-parent-template', `There is no minimum required fields template for ${parentObjectApiName}, so it cannot be added to the recipe.`);
        }

        if ( occurrencesByObjectApiName.has(parentObjectApiName) ) {
            return refuse('parent-object-already-exists', `The recipe already has a "- object: ${parentObjectApiName}" block, so nothing was added.`);
        }

        const parentLevel = wiringContext.levelsByObjectApiName?.get(parentObjectApiName);
        const objectLevel = wiringContext.levelsByObjectApiName?.get(objectApiName);

        if ( parentLevel === undefined || objectLevel === undefined || parentLevel >= objectLevel ) {
            return refuse('parent-not-inserted-first', `${parentObjectApiName} is not at a lower relationship level than ${objectApiName}, so the insert would not send it first, and nothing was added.`);
        }

        let rootObject = scannedObject;
        while ( rootObject.parentHeaderIndex !== undefined ) {
            rootObject = friendIndex.objectsByHeaderIndex.get(rootObject.parentHeaderIndex);
        }

        return {
            addition: {
                objectApiName: objectApiName,
                ...( occurrences.length > 1 ? { objectNickname: scannedObject.nicknames[0] } : {} ),
                fieldApiName: fieldApiName,
                parentObjectApiName: parentObjectApiName
            },
            scannedObject: scannedObject,
            lineIndex: scannedField.startIndex,
            fieldIndent: fieldIndent,
            rootHeaderIndex: rootObject.headerIndex
        };

    }

    private static locateLookupWirings(lines: string[], scannedObjects: IScannedObject[], wiringContext: ILookupWiringContext): { wiring: ILookupWiring; lineIndex: number; fieldIndent: string }[] {

        const friendIndex = this.buildScannedFriendIndex(scannedObjects);
        const occurrencesByObjectApiName = new Map<string, IScannedObject[]>();
        const occurrenceCountsByNickname = new Map<string, number>();

        scannedObjects.forEach(scannedObject => {
            const occurrences = occurrencesByObjectApiName.get(scannedObject.objectApiName);
            if ( occurrences ) {
                occurrences.push(scannedObject);
            } else {
                occurrencesByObjectApiName.set(scannedObject.objectApiName, [scannedObject]);
            }
            scannedObject.nicknames.forEach(nickname => occurrenceCountsByNickname.set(nickname, (occurrenceCountsByNickname.get(nickname) ?? 0) + 1));
        });

        const readDistinctNickname = (scannedObject: IScannedObject): string | undefined => (
            scannedObject.nicknames.length === 1
                && API_NAME_PATTERN.test(scannedObject.nicknames[0])
                && occurrenceCountsByNickname.get(scannedObject.nicknames[0]) === 1
                ? scannedObject.nicknames[0]
                : undefined
        );
        // A NICKNAME WRITTEN AS A VALUE MUST LOAD AS THE STRING IT IS, OR THE INSERT'S WHOLE-STRING SWAP NEVER MATCHES IT
        const readWritableNickname = (scannedObject: IScannedObject): string | undefined => {
            const nickname = readDistinctNickname(scannedObject);
            return nickname !== undefined && !YAML_NON_STRING_PLAIN_SCALAR_PATTERN.test(nickname) ? nickname : undefined;
        };
        const levelOf = (objectApiName: string): number | undefined => wiringContext.levelsByObjectApiName?.get(objectApiName);

        const locatedWirings: { wiring: ILookupWiring; lineIndex: number; fieldIndent: string }[] = [];

        scannedObjects.forEach(scannedObject => {

            const parentLookups = wiringContext.parentLookupsByObjectApiName.get(scannedObject.objectApiName) ?? [];
            const occurrences = occurrencesByObjectApiName.get(scannedObject.objectApiName);
            const isWrittenOnce = occurrences.length === 1;
            const objectNickname = isWrittenOnce ? undefined : readDistinctNickname(scannedObject);

            /*
                An object written more than once is wired only when EVERY occurrence has a nickname of
                its own: RecipeCockpitService.parseRecipeSource draws such an object as one row with no
                nickname (hasIndistinctOccurrences), so a wiring keyed by one occurrence's nickname would
                have no "Wire to…" to show and would be written by "Wire TODO lookups" alone.
            */
            if ( parentLookups.length === 0
                    || !API_NAME_PATTERN.test(scannedObject.objectApiName)
                    || ( !isWrittenOnce && occurrences.some(occurrence => readDistinctNickname(occurrence) === undefined) )
                    || scannedObject.fieldsLineIndexes.length !== 1 ) {
                return;
            }

            const ancestors: IScannedObject[] = [];
            for ( let ancestor = friendIndex.objectsByHeaderIndex.get(scannedObject.parentHeaderIndex);
                    ancestor;
                    ancestor = ancestor.parentHeaderIndex === undefined ? undefined : friendIndex.objectsByHeaderIndex.get(ancestor.parentHeaderIndex) ) {
                ancestors.push(ancestor);
            }

            const { fieldIndent } = this.getObjectLayout(scannedObject.objectIndent);
            const fieldCountsByApiName = new Map<string, number>();
            scannedObject.fields.forEach(scannedField => fieldCountsByApiName.set(scannedField.fieldApiName, (fieldCountsByApiName.get(scannedField.fieldApiName) ?? 0) + 1));
            const objectLevel = levelOf(scannedObject.objectApiName);

            scannedObject.fields.forEach(scannedField => {

                const parentObjectApiNames = [...new Set(parentLookups
                    .filter(parentLookup => parentLookup.fieldApiName === scannedField.fieldApiName && API_NAME_PATTERN.test(parentLookup.parentObjectApiName))
                    .map(parentLookup => parentLookup.parentObjectApiName))];

                const valueText = lines[scannedField.startIndex].slice(fieldIndent.length + scannedField.fieldApiName.length + 1).replace(/^[ \t]+/, '');

                if ( parentObjectApiNames.length === 0
                        || fieldCountsByApiName.get(scannedField.fieldApiName) !== 1
                        || !API_NAME_PATTERN.test(scannedField.fieldApiName)
                        || !REFERENCE_ID_REQUIRED_TODO_PATTERN.test(valueText)
                        || lines.slice(scannedField.startIndex + 1, scannedField.endIndex).some(continuationLine => continuationLine.trim()) ) {
                    return;
                }

                const ancestorNicknames = ancestors
                    .filter(ancestor => parentObjectApiNames.includes(ancestor.objectApiName))
                    .map(readWritableNickname);
                const lowerLevelNicknames = parentObjectApiNames
                    .filter(parentObjectApiName => {
                        const parentLevel = levelOf(parentObjectApiName);
                        return parentLevel !== undefined && objectLevel !== undefined && parentLevel < objectLevel;
                    })
                    .flatMap(parentObjectApiName => ( occurrencesByObjectApiName.get(parentObjectApiName) ?? [] ))
                    .filter(parentOccurrence => parentOccurrence !== scannedObject)
                    .map(readWritableNickname);

                const candidateNicknames = [...new Set([...ancestorNicknames, ...lowerLevelNicknames].filter((nickname): nickname is string => nickname !== undefined))];

                if ( candidateNicknames.length === 0 ) {
                    return;
                }

                locatedWirings.push({
                    wiring: {
                        objectApiName: scannedObject.objectApiName,
                        ...( objectNickname !== undefined ? { objectNickname: objectNickname } : {} ),
                        fieldApiName: scannedField.fieldApiName,
                        parentObjectApiNames: parentObjectApiNames,
                        candidateNicknames: candidateNicknames
                    },
                    lineIndex: scannedField.startIndex,
                    fieldIndent: fieldIndent
                });

            });

        });

        return locatedWirings;

    }

    /*
        One object's own block as a recipe of its own, with "count:" set: what the Recipe Cockpit's
        Create runs to make N records of one object (#180).

        Its lines are copied, not rebuilt -- the header, its properties and its fields block with
        every comment in it, so a TODO the generator wrote still says what it said -- and moved to
        column zero when the object is a friend. Its OWN friends: block is left out: a Create makes
        records of this object and nothing beneath it. An object written twice is picked by its
        nickname, as for every other operation. A lookup value that names an ancestor's nickname is
        copied as it is: it is just a string to the processor, and the caller replaces every lookup
        after generation. A field in excludedFieldApiNames -- unticked on the Structure tab (#220) --
        is left out of the cut, its continuation lines with it.
    */
    static extractObjectBlock(recipeText: string, objectApiName: string, recordCount: number, objectNickname?: string, excludedFieldApiNames: readonly string[] = []): RecipeBlockExtractionResult {

        const located = this.locateObject(recipeText, objectApiName, undefined, objectNickname);
        if ( 'refusal' in located ) {
            return { isExtracted: false, refusal: located.refusal };
        }

        if ( !Number.isSafeInteger(recordCount) || recordCount < 1 ) {
            return {
                isExtracted: false,
                refusal: {
                    reason: 'invalid-value',
                    message: `The count for ${this.describeObject(objectApiName, objectNickname)} must be a whole number of one or more.`,
                    objectApiName: objectApiName,
                    ...( objectNickname !== undefined ? { objectNickname: objectNickname } : {} ),
                    propertyName: 'count'
                }
            };
        }

        const { recipeLines, scannedObject } = located;
        const excludedFieldSet = new Set(excludedFieldApiNames);
        const excludedFields = scannedObject.fields.filter(scannedField => excludedFieldSet.has(scannedField.fieldApiName));
        const excludedLineIndexes = new Set(excludedFields
            .flatMap(scannedField => Array.from({ length: scannedField.endIndex - scannedField.startIndex }, (_, offset) => scannedField.startIndex + offset)));
        // AS IN buildFilteredRecipe: A fields: LINE LEFT WITH NOTHING UNDER IT LOADS AS null, WHICH SNOWFAKERY DOES NOT TAKE FOR "NO FIELDS"
        if ( scannedObject.fields.length > 0 && excludedFields.length === scannedObject.fields.length && scannedObject.fieldsLineIndexes.length === 1 ) {
            excludedLineIndexes.add(scannedObject.fieldsLineIndexes[0]);
        }
        const blockLines = this.collectOwnBlockLineIndexes(recipeLines.lines, scannedObject)
            .filter(lineIndex => !excludedLineIndexes.has(lineIndex))
            .map(lineIndex => recipeLines.lines[lineIndex]);

        const extractedText = [
            `# Recipe Cockpit -- ${recordCount} ${objectApiName} ${recordCount === 1 ? 'record' : 'records'}, cut from the object's own block in its tree's recipe`,
            '',
            ...blockLines.map(blockLine => blockLine.slice(Math.min(scannedObject.objectIndent, blockLine.length - blockLine.trimStart().length))),
            ''
        ].join('\n');

        const countResult = this.setObjectProperty(extractedText, objectApiName, 'count', recordCount);

        return 'refusal' in countResult
            ? { isExtracted: false, refusal: countResult.refusal }
            : { isExtracted: true, recipeText: countResult.recipeText };

    }

    /*
        The field keys of the block extractObjectBlock would cut, read back from the cut itself, so
        the parent picker and a deploy target read exactly the fields the insert would send: no
        friend's field, no commented-out field, and a block that cannot be cut is that refusal
        rather than a list.
    */
    static listCreateBlockFieldApiNames(recipeText: string, objectApiName: string, objectNickname?: string, excludedFieldApiNames: readonly string[] = []): RecipeBlockFieldListResult {

        const extraction = this.extractObjectBlock(recipeText, objectApiName, 1, objectNickname, excludedFieldApiNames);
        if ( 'refusal' in extraction ) {
            return { isListed: false, refusal: extraction.refusal };
        }

        const [cutObject] = this.scanRecipeObjects(this.splitRecipeLines(extraction.recipeText).lines);

        return { isListed: true, fieldApiNames: cutObject.fields.map(scannedField => scannedField.fieldApiName) };

    }

    /*
        listCreateBlockFieldApiNames for many objects of one recipe from ONE scan: per object it costs
        a lookup rather than a scan of the whole file, which made Data-by-Org quadratic in a tree's
        objects (25 s at 1,000). An object the scan finds exactly once, with one "count:" line, is
        listed from that scan -- the same fields its cut carries; anything else goes through
        listCreateBlockFieldApiNames itself, so every refusal is word for word the per-object one.
    */
    static listCreateBlockFieldApiNamesForObjects(recipeText: string, requests: ICreateBlockFieldListRequest[]): RecipeBlockFieldListResult[] {

        const scannedObjectsByApiName = new Map<string, IScannedObject[]>();
        this.scanRecipeObjects(this.splitRecipeLines(recipeText).lines).forEach(scannedObject => {
            scannedObjectsByApiName.set(scannedObject.objectApiName, [...( scannedObjectsByApiName.get(scannedObject.objectApiName) ?? [] ), scannedObject]);
        });

        return requests.map(({ objectApiName, objectNickname, excludedFieldApiNames = [] }) => {

            const excludedFieldSet = new Set(excludedFieldApiNames);

            const matchingObjects = ( scannedObjectsByApiName.get(objectApiName) ?? [] )
                .filter(scannedObject => objectNickname === undefined || scannedObject.nicknames.includes(objectNickname));
            const isListableFromScan = API_NAME_PATTERN.test(objectApiName)
                                        && ( objectNickname === undefined || API_NAME_PATTERN.test(objectNickname) )
                                        && matchingObjects.length === 1
                                        && matchingObjects[0].propertyLineIndexes.count.length === 1;

            return isListableFromScan
                ? { isListed: true, fieldApiNames: matchingObjects[0].fields.map(scannedField => scannedField.fieldApiName).filter(fieldApiName => !excludedFieldSet.has(fieldApiName)) }
                : this.listCreateBlockFieldApiNames(recipeText, objectApiName, objectNickname, excludedFieldApiNames);

        });

    }

    /*
        The recipe the Treecipe Adapter generates its values from (#417): ONE top-level object, a
        nickname of its own, "count:" set to the records loaded, and only the fields given -- no
        lookup, no friend, nothing else of the tree. Each value is written by buildFieldLines, the
        line rule every other write is held to, so a value cannot add a line the layout would read
        as another field or object, and the text is scanned back: one object, exactly these fields.
    */
    static buildUpdaterValueRecipe(objectApiName: string, recordCount: number, fields: readonly IUpdaterValueRecipeField[]): RecipeUpdaterValueRecipeResult {

        if ( fields.length === 0 && API_NAME_PATTERN.test(objectApiName) && this.isRecordCount(recordCount) ) {
            return { isBuilt: false, refusal: `No field of ${objectApiName} has a value to generate.` };
        }

        return this.buildSingleObjectRecipe(objectApiName, recordCount, fields, 'Updater', `Treecipe Adapter values for ${recordCount} ${objectApiName} ${recordCount === 1 ? 'record' : 'records'}`);

    }

    /*
        The block the Treecipe Adapter generates a NEW child object's records from (#447): one
        top-level object, its own nickname, "count:" set to the count per parent times the parents
        loaded, and only the fields ticked -- none is allowed, since the lookup to the parent is set
        per record after generation. Built and read back by the same rule as the Updater's values.
    */
    static buildAdapterChildRecipe(objectApiName: string, recordCount: number, fields: readonly IUpdaterValueRecipeField[]): RecipeUpdaterValueRecipeResult {

        return this.buildSingleObjectRecipe(objectApiName, recordCount, fields, 'Adapter', `Treecipe Adapter block for ${recordCount} new ${objectApiName} ${recordCount === 1 ? 'record' : 'records'}`);

    }

    private static buildSingleObjectRecipe(objectApiName: string,
                                           recordCount: number,
                                           fields: readonly IUpdaterValueRecipeField[],
                                           nicknameInfix: string,
                                           heading: string): RecipeUpdaterValueRecipeResult {

        if ( !API_NAME_PATTERN.test(objectApiName) ) {
            return { isBuilt: false, refusal: `${objectApiName} is not an object api name.` };
        }
        if ( !this.isRecordCount(recordCount) ) {
            return { isBuilt: false, refusal: `The count for ${objectApiName} must be a whole number of one or more.` };
        }

        const layout = this.getObjectLayout(0);
        const fieldLines: string[] = [];
        const fieldApiNames = new Set<string>();

        for ( const field of fields ) {
            if ( !API_NAME_PATTERN.test(field.fieldApiName) || fieldApiNames.has(field.fieldApiName) ) {
                return { isBuilt: false, refusal: `${objectApiName}.${field.fieldApiName} is not one field api name.` };
            }
            const builtLines = typeof field.valueText === 'string' && field.valueText.trim() !== ''
                ? this.buildFieldLines(field.fieldApiName, field.valueText, layout)
                : undefined;
            if ( !builtLines ) {
                return { isBuilt: false, refusal: `The value of ${objectApiName}.${field.fieldApiName} cannot be written as its own recipe lines.` };
            }
            fieldApiNames.add(field.fieldApiName);
            fieldLines.push(...builtLines);
        }

        const recipeText = [
            `# Recipe Cockpit -- ${heading}`,
            '',
            `- object: ${objectApiName}`,
            `${layout.propertyIndent}nickname: ${objectApiName}_${nicknameInfix}_NickName`,
            `${layout.propertyIndent}count: ${recordCount}`,
            // AN EMPTY "fields:" LOADS AS null, SO A BLOCK WITH NO FIELD HAS NO SUCH LINE
            ...( fieldLines.length > 0 ? [`${layout.propertyIndent}fields:`, ...fieldLines] : [] ),
            ''
        ].join('\n');

        const scannedObjects = this.scanRecipeObjects(this.splitRecipeLines(recipeText).lines);
        const scannedFieldApiNames = scannedObjects.length === 1 ? scannedObjects[0].fields.map(scannedField => scannedField.fieldApiName) : [];

        if ( scannedObjects.length !== 1
                || scannedObjects[0].objectApiName !== objectApiName
                || scannedFieldApiNames.length !== fields.length
                || scannedFieldApiNames.some((scannedFieldApiName, fieldIndex) => scannedFieldApiName !== fields[fieldIndex].fieldApiName) ) {
            return { isBuilt: false, refusal: `The values of ${objectApiName} did not read back as one object with exactly the fields given.` };
        }

        return { isBuilt: true, recipeText: recipeText };

    }

    /*
        Whether a field other than RecordTypeId carries a record-type "### TODO: -- RecordType Options --"
        section among its continuation lines. Each such section assumes a record type is chosen, so
        while one exists the Structure tab keeps the RecordTypeId line ticked (#220).
    */
    static hasRecordTypeSections(lines: string[], scannedObject: IScannedObject): boolean {

        return scannedObject.fields
            .filter(scannedField => scannedField.fieldApiName !== RECORD_TYPE_ID_FIELD_API_NAME)
            .some(scannedField => lines
                .slice(scannedField.startIndex + 1, scannedField.endIndex)
                .some(continuationLine => continuationLine.trimStart().startsWith(RECORD_TYPE_SECTION_MARKER)));

    }

    /*
        The lines of one object's OWN block, by index: its header, its properties and its fields block
        with every comment in it, and not its friends: block, which belongs to the objects beneath it.
        Trailing blank lines are the gap before whatever follows, not part of the object.
    */
    private static collectOwnBlockLineIndexes(lines: string[], scannedObject: IScannedObject): number[] {

        const layout = this.getObjectLayout(scannedObject.objectIndent);
        const blockLineIndexes = [scannedObject.headerIndex];
        let isInFriendsBlock = false;

        for ( let lineIndex = scannedObject.headerIndex + 1; lineIndex < lines.length; lineIndex++ ) {

            const recipeLine = lines[lineIndex];
            const isBlank = !recipeLine.trim();
            const lineIndent = recipeLine.length - recipeLine.trimStart().length;

            // ANY LINE AT OR LEFT OF THE HEADER'S COLUMN ENDS THE OBJECT, AS IN scanRecipeObjects
            if ( !isBlank && lineIndent <= scannedObject.objectIndent ) {
                break;
            }

            // A friends: BLOCK RUNS UNTIL THE NEXT PROPERTY-COLUMN LINE THAT IS NOT A COMMENT
            if ( isInFriendsBlock && ( isBlank || lineIndent > scannedObject.objectIndent + 2 || recipeLine.trimStart().startsWith('#') ) ) {
                continue;
            }

            isInFriendsBlock = layout.friendsLinePattern.test(recipeLine);

            if ( !isInFriendsBlock ) {
                blockLineIndexes.push(lineIndex);
            }

        }

        while ( blockLineIndexes.length > 1 && !lines[blockLineIndexes[blockLineIndexes.length - 1]].trim() ) {
            blockLineIndexes.pop();
        }

        return blockLineIndexes;

    }

    /*
        A copy of a tree's recipe without the objects the Recipe Cockpit's Structure tab excluded
        (#219): what the cockpit's generate button generates from, so the recipe file itself is never written.

        An excluded object's block is dropped -- its header comment, its own block and its friends:
        block -- and so is every later occurrence of any object nested under it (a copy under a
        self-lookup iteration goes with what it was copied under). Every other line is copied byte
        for byte, its line ending included, except for three kinds of change:

        - a lookup field of a kept object that points at a dropped object -- by the lookups handed
          in, or by a value that is exactly a dropped occurrence's nickname -- is left out;
        - a kept friend whose friends: parent was dropped is moved, with everything nested under it,
          under its CLOSEST remaining parent that has a recipe: deepest level, ties by "<", and only a
          parent at a strictly lower level, which is RelationshipService's rule (#46), so moves can
          never form a cycle. Its lookup to that parent is written as the parent's nickname, so a
          count still means records per parent record. With no such parent it moves to the top level
          and its remaining lookups are nicknames the processor resolves as non-ancestors (#189);
        - a friends: block left with no friend is dropped rather than written as "friends:" alone;
        - a field the reader unticked (#220) is left out of every kept occurrence of its object, its
          continuation lines with it. Unticking every field keeps the object, with no field set and
          no "fields:" line, which would otherwise load as null.

        A flat recipe -- snowfakery's, or a tree nothing nests in -- has no friends to move, so only
        blocks and lookups are dropped. The copy is read back through scanRecipeObjects and refused
        unless it reads as exactly the kept occurrences, moved where this said.
    */
    static buildFilteredRecipe(recipeText: string, filterRequest: IRecipeFilterRequest): RecipeFilterResult {

        const excludedObjectApiNames = new Set(filterRequest.excludedObjectApiNames);
        const refuseFilter = (reason: RecipeWriterRefusalReason, message: string, objectApiName = filterRequest.excludedObjectApiNames[0] ?? ''): RecipeFilterResult => ({
            isFiltered: false,
            refusal: { reason: reason, message: message, objectApiName: objectApiName }
        });

        const invalidObjectApiName = filterRequest.excludedObjectApiNames.find(excludedObjectApiName => !API_NAME_PATTERN.test(excludedObjectApiName));
        if ( invalidObjectApiName !== undefined ) {
            return refuseFilter('invalid-object-api-name', `"${invalidObjectApiName}" is not an object api name.`, invalidObjectApiName);
        }

        // THE NAMES GO INTO THE COPY'S HEADER COMMENT, SO EACH IS HELD TO THE API NAME RULE BEFORE ANYTHING IS WRITTEN
        const excludedFieldsByObject = new Map<string, Set<string>>();
        for ( const [objectApiName, fieldApiNames] of filterRequest.excludedFieldApiNamesByObject ?? new Map<string, readonly string[]>() ) {
            if ( !API_NAME_PATTERN.test(objectApiName) ) {
                return refuseFilter('invalid-object-api-name', `"${objectApiName}" is not an object api name.`, objectApiName);
            }
            const invalidFieldApiName = fieldApiNames.find(fieldApiName => !API_NAME_PATTERN.test(fieldApiName));
            if ( invalidFieldApiName !== undefined ) {
                return { isFiltered: false, refusal: { reason: 'invalid-field-api-name', message: `"${invalidFieldApiName}" is not a field api name.`, objectApiName: objectApiName, fieldApiName: invalidFieldApiName } };
            }
            if ( fieldApiNames.length > 0 ) {
                excludedFieldsByObject.set(objectApiName, new Set(fieldApiNames));
            }
        }

        const countsByObject = new Map<string, number>();
        for ( const [objectApiName, recordCount] of filterRequest.objectCountsByObject ?? new Map<string, number>() ) {
            if ( !API_NAME_PATTERN.test(objectApiName) ) {
                return refuseFilter('invalid-object-api-name', `"${objectApiName}" is not an object api name.`, objectApiName);
            }
            if ( !this.isRecordCount(recordCount) ) {
                return { isFiltered: false, refusal: { reason: 'invalid-value', message: `The count for ${objectApiName} must be a whole number of one or more.`, objectApiName: objectApiName, propertyName: 'count' } };
            }
            countsByObject.set(objectApiName, recordCount);
        }

        const fixedValuesByObject = new Map<string, Map<string, IRecipeFixedValue>>();
        for ( const [objectApiName, fixedValuesByField] of filterRequest.fixedValuesByObject ?? new Map<string, ReadonlyMap<string, IRecipeFixedValue>>() ) {
            if ( !API_NAME_PATTERN.test(objectApiName) ) {
                return refuseFilter('invalid-object-api-name', `"${objectApiName}" is not an object api name.`, objectApiName);
            }
            for ( const [fieldApiName, fixedValue] of fixedValuesByField ) {
                if ( !API_NAME_PATTERN.test(fieldApiName) ) {
                    return { isFiltered: false, refusal: { reason: 'invalid-field-api-name', message: `"${fieldApiName}" is not a field api name.`, objectApiName: objectApiName, fieldApiName: fieldApiName } };
                }
                const valueRefusal = this.checkFixedValue(fixedValue);
                if ( valueRefusal !== undefined ) {
                    return { isFiltered: false, refusal: { reason: 'invalid-value', message: `The fixed value for ${objectApiName}.${fieldApiName} ${valueRefusal}`, objectApiName: objectApiName, fieldApiName: fieldApiName } };
                }
            }
            if ( fixedValuesByField.size > 0 ) {
                fixedValuesByObject.set(objectApiName, new Map(fixedValuesByField));
            }
        }

        const constrainedExpressionsByObject = new Map<string, Map<string, string>>();
        for ( const [objectApiName, expressionsByField] of filterRequest.constrainedExpressionsByObject ?? new Map<string, ReadonlyMap<string, string>>() ) {
            if ( !API_NAME_PATTERN.test(objectApiName) ) {
                return refuseFilter('invalid-object-api-name', `"${objectApiName}" is not an object api name.`, objectApiName);
            }
            for ( const [fieldApiName, expression] of expressionsByField ) {
                if ( !API_NAME_PATTERN.test(fieldApiName) ) {
                    return { isFiltered: false, refusal: { reason: 'invalid-field-api-name', message: `"${fieldApiName}" is not a field api name.`, objectApiName: objectApiName, fieldApiName: fieldApiName } };
                }
                const expressionRefusal = this.checkConstrainedExpression(expression);
                if ( expressionRefusal !== undefined ) {
                    return { isFiltered: false, refusal: { reason: 'invalid-value', message: `The constrained expression for ${objectApiName}.${fieldApiName} ${expressionRefusal}`, objectApiName: objectApiName, fieldApiName: fieldApiName } };
                }
            }
            const expressionsByUnfixedField = new Map([...expressionsByField].filter(([fieldApiName]) => !fixedValuesByObject.get(objectApiName)?.has(fieldApiName)));
            if ( expressionsByUnfixedField.size > 0 ) {
                constrainedExpressionsByObject.set(objectApiName, expressionsByUnfixedField);
            }
        }

        const unconstrainedValuesByObject = new Map<string, Map<string, IRecipeUnconstrainedValue>>();
        for ( const [objectApiName, valuesByField] of filterRequest.unconstrainedValuesByObject ?? new Map<string, ReadonlyMap<string, IRecipeUnconstrainedValue>>() ) {
            if ( !API_NAME_PATTERN.test(objectApiName) ) {
                return refuseFilter('invalid-object-api-name', `"${objectApiName}" is not an object api name.`, objectApiName);
            }
            for ( const [fieldApiName, unconstrainedValue] of valuesByField ) {
                if ( !API_NAME_PATTERN.test(fieldApiName) ) {
                    return { isFiltered: false, refusal: { reason: 'invalid-field-api-name', message: `"${fieldApiName}" is not a field api name.`, objectApiName: objectApiName, fieldApiName: fieldApiName } };
                }
                if ( !this.buildFieldLines(fieldApiName, unconstrainedValue.constrainedValue, this.getObjectLayout(0))
                        || !this.buildFieldLines(fieldApiName, unconstrainedValue.unconstrainedValue, this.getObjectLayout(0)) ) {
                    return { isFiltered: false, refusal: { reason: 'invalid-value', message: `The value ${objectApiName}.${fieldApiName} generates without its validation rules does not keep the recipe layout.`, objectApiName: objectApiName, fieldApiName: fieldApiName } };
                }
            }
            const valuesByFreeField = new Map([...valuesByField].filter(([fieldApiName]) => !fixedValuesByObject.get(objectApiName)?.has(fieldApiName)
                                                                                            && !constrainedExpressionsByObject.get(objectApiName)?.has(fieldApiName)));
            if ( valuesByFreeField.size > 0 ) {
                unconstrainedValuesByObject.set(objectApiName, valuesByFreeField);
            }
        }

        const recipeLines = this.splitRecipeLines(recipeText);
        const { lines } = recipeLines;
        const scannedObjects = this.scanRecipeObjects(lines);

        if ( scannedObjects.length === 0 ) {
            return refuseFilter('object-not-found', 'The recipe has no "- object:" line, so it could not be filtered.');
        }

        // A VALUE THAT IS EXACTLY A NICKNAME IS READ AS A REFERENCE TO THAT RECORD -- BY faker-js AND BY THE INSERT'S Id SWAP -- SO IT WOULD NOT BE ITSELF
        const recipeNicknames = new Set(scannedObjects.flatMap(scannedObject => scannedObject.nicknames));
        for ( const [objectApiName, fixedValuesByField] of fixedValuesByObject ) {
            for ( const [fieldApiName, fixedValue] of fixedValuesByField ) {
                if ( recipeNicknames.has(fixedValue.value) ) {
                    return { isFiltered: false, refusal: { reason: 'invalid-value', message: `The fixed value for ${objectApiName}.${fieldApiName} is the nickname of an object in this recipe, which generation would read as a reference to that record.`, objectApiName: objectApiName, fieldApiName: fieldApiName } };
                }
            }
        }

        // NOTHING EXCLUDED, NO COUNT SET AND NO VALUE FIXED IS THE RECIPE ITSELF, BYTE FOR BYTE
        if ( excludedObjectApiNames.size === 0 && excludedFieldsByObject.size === 0 && countsByObject.size === 0 && fixedValuesByObject.size === 0 && constrainedExpressionsByObject.size === 0 && unconstrainedValuesByObject.size === 0 ) {
            return { isFiltered: true, recipeText: recipeText, droppedObjectApiNames: [], droppedLookups: [], movedObjects: [], droppedFields: [], appliedCounts: [], appliedFixedValues: [], appliedConstrainedExpressions: [], appliedUnconstrainedValues: [] };
        }

        const friendIndex = this.buildScannedFriendIndex(scannedObjects);
        const spansByHeaderIndex = new Map<number, ILineSpan>(scannedObjects.map(scannedObject => [scannedObject.headerIndex, {
            startIndex: this.findHeaderCommentStartIndex(lines, scannedObject),
            endIndex: this.findLastLineIndexOfObject(lines, scannedObject) + 1
        }]));

        const firstOccurrencesByApiName = new Map<string, IScannedObject>();
        scannedObjects.forEach(scannedObject => {
            if ( !firstOccurrencesByApiName.has(scannedObject.objectApiName) ) {
                firstOccurrencesByApiName.set(scannedObject.objectApiName, scannedObject);
            }
        });

        // FILE ORDER IS PARENTS BEFORE FRIENDS, SO A PARENT'S FATE IS DECIDED BEFORE ITS FRIENDS ASK
        const droppedHeaderIndexes = new Set<number>();
        const objectsToMove: IScannedObject[] = [];
        scannedObjects.forEach(scannedObject => {
            const isParentDropped = scannedObject.parentHeaderIndex !== undefined && droppedHeaderIndexes.has(scannedObject.parentHeaderIndex);
            if ( excludedObjectApiNames.has(scannedObject.objectApiName) || ( isParentDropped && firstOccurrencesByApiName.get(scannedObject.objectApiName) !== scannedObject ) ) {
                droppedHeaderIndexes.add(scannedObject.headerIndex);
            } else if ( isParentDropped ) {
                objectsToMove.push(scannedObject);
            }
        });

        const keptObjects = scannedObjects.filter(scannedObject => !droppedHeaderIndexes.has(scannedObject.headerIndex));
        const hasLookupToDrop = keptObjects.some(keptObject => ( filterRequest.parentLookupsByObjectApiName.get(keptObject.objectApiName) ?? [] )
            .some(lookup => excludedObjectApiNames.has(lookup.parentObjectApiName)));
        const hasFieldToDrop = keptObjects.some(keptObject => {
            const excludedFieldApiNames = excludedFieldsByObject.get(keptObject.objectApiName);
            return !!excludedFieldApiNames && keptObject.fields.some(scannedField => excludedFieldApiNames.has(scannedField.fieldApiName));
        });

        // A COUNT GOES ON THE FIRST OCCURRENCE'S ONE "count:" LINE; ONE ALREADY HOLDING IT CHANGES NOTHING
        const countOverridesByLineIndex = new Map<number, number>();
        const appliedCounts: IRecipeFilterCount[] = [];
        for ( const [objectApiName, recordCount] of countsByObject ) {
            const countedObject = firstOccurrencesByApiName.get(objectApiName);
            if ( !countedObject || droppedHeaderIndexes.has(countedObject.headerIndex) ) {
                continue;
            }
            if ( countedObject.propertyLineIndexes.count.length !== 1 ) {
                return refuseFilter('unsupported-filter-layout', `${objectApiName} has ${countedObject.propertyLineIndexes.count.length === 0 ? 'no' : 'more than one'} "count:" line, so its count could not be set.`, objectApiName);
            }
            if ( this.readObjectCount(lines, countedObject) !== recordCount ) {
                countOverridesByLineIndex.set(countedObject.propertyLineIndexes.count[0], recordCount);
                appliedCounts.push({ objectApiName: objectApiName, count: recordCount });
            }
        }

        const hasFieldToFix = keptObjects.some(keptObject => {
            const fixedValuesByField = fixedValuesByObject.get(keptObject.objectApiName);
            const expressionsByField = constrainedExpressionsByObject.get(keptObject.objectApiName);
            const unconstrainedByField = unconstrainedValuesByObject.get(keptObject.objectApiName);
            return keptObject.fields.some(scannedField => !!fixedValuesByField?.has(scannedField.fieldApiName)
                                                            || !!expressionsByField?.has(scannedField.fieldApiName)
                                                            || !!unconstrainedByField?.has(scannedField.fieldApiName));
        });

        // NOTHING IN THIS RECIPE IS LEFT OUT, RECOUNTED OR FIXED: THE RECIPE ITSELF, BYTE FOR BYTE
        if ( droppedHeaderIndexes.size === 0 && !hasLookupToDrop && !hasFieldToDrop && countOverridesByLineIndex.size === 0 && !hasFieldToFix ) {
            return { isFiltered: true, recipeText: recipeText, droppedObjectApiNames: [], droppedLookups: [], movedObjects: [], droppedFields: [], appliedCounts: [], appliedFixedValues: [], appliedConstrainedExpressions: [], appliedUnconstrainedValues: [] };
        }

        if ( keptObjects.length === 0 ) {
            return refuseFilter('all-objects-excluded', 'Every object in the recipe is excluded, so there is nothing to generate.');
        }

        const levelOf = (scannedObject: IScannedObject) => filterRequest.levelsByObjectApiName?.get(scannedObject.objectApiName) ?? scannedObject.objectIndent / FRIENDS_INDENT_STEP;
        const isNestedUnder = (candidate: IScannedObject, ancestorHeaderIndex: number) => {
            for ( let parentHeaderIndex = candidate.parentHeaderIndex; parentHeaderIndex !== undefined; parentHeaderIndex = friendIndex.objectsByHeaderIndex.get(parentHeaderIndex)?.parentHeaderIndex ) {
                if ( parentHeaderIndex === ancestorHeaderIndex ) {
                    return true;
                }
            }
            return false;
        };
        const lookupsOf = (objectApiName: string) => filterRequest.parentLookupsByObjectApiName.get(objectApiName) ?? [];

        const finalParentHeaderIndexes = new Map<number, number | undefined>(keptObjects.map(keptObject => [keptObject.headerIndex, keptObject.parentHeaderIndex]));
        const newParentsByMovedHeaderIndex = new Map<number, IScannedObject | undefined>();
        const movedInObjectsByParentHeaderIndex = new Map<number | undefined, IScannedObject[]>();

        for ( const objectToMove of objectsToMove ) {

            const [newParent] = lookupsOf(objectToMove.objectApiName)
                .map(lookup => lookup.parentObjectApiName)
                .filter(parentObjectApiName => parentObjectApiName !== objectToMove.objectApiName && !excludedObjectApiNames.has(parentObjectApiName))
                .map(parentObjectApiName => firstOccurrencesByApiName.get(parentObjectApiName))
                .filter((candidate): candidate is IScannedObject => !!candidate
                                                                    && !droppedHeaderIndexes.has(candidate.headerIndex)
                                                                    && !isNestedUnder(candidate, objectToMove.headerIndex)
                                                                    && levelOf(candidate) < levelOf(objectToMove))
                .sort((left, right) => levelOf(right) - levelOf(left) || ( left.objectApiName < right.objectApiName ? -1 : left.objectApiName > right.objectApiName ? 1 : 0 ));

            // THE NICKNAME BECOMES A FIELD VALUE, SO IT IS HELD TO THE SAME NAME RULE insertFriend HOLDS ITS NICKNAMES TO
            if ( newParent && ( newParent.nicknames.length !== 1 || !API_NAME_PATTERN.test(newParent.nicknames[0]) ) ) {
                return refuseFilter('unsupported-filter-layout', `${newParent.objectApiName} has ${newParent.nicknames.length === 0 ? 'no' : 'more than one'} "nickname:" line, so ${objectToMove.objectApiName} could not be moved under it.`, objectToMove.objectApiName);
            }
            if ( newParent && newParent.friendsLineIndexes.length > 1 ) {
                return refuseFilter('unsupported-filter-layout', `${newParent.objectApiName} has more than one "friends:" line, so ${objectToMove.objectApiName} could not be moved under it.`, objectToMove.objectApiName);
            }

            newParentsByMovedHeaderIndex.set(objectToMove.headerIndex, newParent);
            finalParentHeaderIndexes.set(objectToMove.headerIndex, newParent?.headerIndex);
            const movedInObjects = movedInObjectsByParentHeaderIndex.get(newParent?.headerIndex) ?? [];
            movedInObjects.push(objectToMove);
            movedInObjectsByParentHeaderIndex.set(newParent?.headerIndex, movedInObjects);

        }

        // A HAND-EDITED RECIPE CAN NEST AGAINST ITS LEVELS; A MOVE THAT WOULD CLOSE A LOOP IS REFUSED RATHER THAN WRITTEN
        const isInCycle = keptObjects.some(keptObject => {
            let parentHeaderIndex = finalParentHeaderIndexes.get(keptObject.headerIndex);
            for ( let step = 0; parentHeaderIndex !== undefined; step++ ) {
                if ( step > keptObjects.length ) {
                    return true;
                }
                parentHeaderIndex = finalParentHeaderIndexes.get(parentHeaderIndex);
            }
            return false;
        });
        if ( isInCycle ) {
            return refuseFilter('unsupported-filter-layout', 'Moving the kept objects under their remaining parents would nest an object under itself.');
        }

        const keptNicknames = new Set(keptObjects.flatMap(keptObject => keptObject.nicknames));
        const droppedNicknames = new Set(scannedObjects
            .filter(scannedObject => droppedHeaderIndexes.has(scannedObject.headerIndex))
            .flatMap(scannedObject => scannedObject.nicknames)
            .filter(nickname => !keptNicknames.has(nickname)));

        const removedLineIndexes = new Set<number>();
        const rewiredFieldsByLineIndex = new Map<number, { fieldApiName: string; nickname: string }>();
        const droppedLookups: IRecipeFilterLookup[] = [];
        const droppedFieldKeys = new Set<string>();
        const droppedFields: IRecipeFilterDroppedField[] = [];
        const removeFieldLines = (scannedField: IScannedField, fromIndex = scannedField.startIndex) => {
            for ( let lineIndex = fromIndex; lineIndex < scannedField.endIndex; lineIndex++ ) {
                removedLineIndexes.add(lineIndex);
            }
        };
        const fixedFieldsByLineIndex = new Map<number, { fieldApiName: string; fixedValue: IRecipeFixedValue }>();
        const appliedFixedValueKeys = new Set<string>();
        const appliedFixedValues: IRecipeFilterFixedValue[] = [];
        const constrainedFieldsByLineIndex = new Map<number, { fieldApiName: string; expression: string }>();
        const appliedConstrainedExpressionKeys = new Set<string>();
        const appliedConstrainedExpressions: IRecipeFilterConstrainedExpression[] = [];
        const unconstrainedFieldsByLineIndex = new Map<number, { fieldApiName: string; value: string }>();
        const appliedUnconstrainedKeys = new Set<string>();
        const appliedUnconstrainedValues: IRecipeFilterDroppedField[] = [];
        let unconstrainedMismatch: IRecipeFilterDroppedField | undefined;

        keptObjects.forEach(keptObject => {

            const fieldIndent = this.getObjectLayout(keptObject.objectIndent).fieldIndent;
            const parentsByFieldApiName = new Map(lookupsOf(keptObject.objectApiName).map(lookup => [lookup.fieldApiName, lookup.parentObjectApiName]));
            const newParent = newParentsByMovedHeaderIndex.get(keptObject.headerIndex);
            const excludedFieldApiNames = excludedFieldsByObject.get(keptObject.objectApiName);
            const fixedValuesByField = fixedValuesByObject.get(keptObject.objectApiName);
            const expressionsByField = constrainedExpressionsByObject.get(keptObject.objectApiName);
            const unconstrainedByField = unconstrainedValuesByObject.get(keptObject.objectApiName);

            keptObject.fields.forEach(scannedField => {

                // AN UNTICKED FIELD GOES, ITS CONTINUATION LINES WITH IT, BEFORE ANY LOOKUP IS RE-WIRED
                if ( excludedFieldApiNames?.has(scannedField.fieldApiName) ) {
                    removeFieldLines(scannedField);
                    const droppedFieldKey = `${keptObject.objectApiName}\n${scannedField.fieldApiName}`;
                    if ( !droppedFieldKeys.has(droppedFieldKey) ) {
                        droppedFieldKeys.add(droppedFieldKey);
                        droppedFields.push({ objectApiName: keptObject.objectApiName, fieldApiName: scannedField.fieldApiName });
                    }
                    return;
                }

                // A FIXED VALUE REPLACES THE FIELD'S LINE AND DROPS ITS CONTINUATION LINES; IT IS NEVER A LOOKUP TO RE-WIRE
                const fixedValue = fixedValuesByField?.get(scannedField.fieldApiName);
                if ( fixedValue ) {
                    fixedFieldsByLineIndex.set(scannedField.startIndex, { fieldApiName: scannedField.fieldApiName, fixedValue: fixedValue });
                    removeFieldLines(scannedField, scannedField.startIndex + 1);
                    const fixedValueKey = `${keptObject.objectApiName}\n${scannedField.fieldApiName}`;
                    if ( !appliedFixedValueKeys.has(fixedValueKey) ) {
                        appliedFixedValueKeys.add(fixedValueKey);
                        appliedFixedValues.push({ objectApiName: keptObject.objectApiName, fieldApiName: scannedField.fieldApiName, ...fixedValue });
                    }
                    return;
                }

                const expression = expressionsByField?.get(scannedField.fieldApiName);
                if ( expression !== undefined ) {
                    constrainedFieldsByLineIndex.set(scannedField.startIndex, { fieldApiName: scannedField.fieldApiName, expression: expression });
                    removeFieldLines(scannedField, scannedField.startIndex + 1);
                    const constrainedKey = `${keptObject.objectApiName}\n${scannedField.fieldApiName}`;
                    if ( !appliedConstrainedExpressionKeys.has(constrainedKey) ) {
                        appliedConstrainedExpressionKeys.add(constrainedKey);
                        appliedConstrainedExpressions.push({ objectApiName: keptObject.objectApiName, fieldApiName: scannedField.fieldApiName, expression: expression });
                    }
                    return;
                }

                const unconstrainedValue = unconstrainedByField?.get(scannedField.fieldApiName);
                if ( unconstrainedValue !== undefined ) {
                    const ruleWrittenLines = this.buildFieldLines(scannedField.fieldApiName, unconstrainedValue.constrainedValue, this.getObjectLayout(keptObject.objectIndent)) as string[];
                    const isRuleWritten = ruleWrittenLines.length === scannedField.endIndex - scannedField.startIndex
                                            && ruleWrittenLines.every((ruleWrittenLine, lineOffset) => lines[scannedField.startIndex + lineOffset] === ruleWrittenLine);
                    if ( !isRuleWritten ) {
                        unconstrainedMismatch = unconstrainedMismatch ?? { objectApiName: keptObject.objectApiName, fieldApiName: scannedField.fieldApiName };
                        return;
                    }
                    unconstrainedFieldsByLineIndex.set(scannedField.startIndex, { fieldApiName: scannedField.fieldApiName, value: unconstrainedValue.unconstrainedValue });
                    removeFieldLines(scannedField, scannedField.startIndex + 1);
                    const unconstrainedKey = `${keptObject.objectApiName}\n${scannedField.fieldApiName}`;
                    if ( !appliedUnconstrainedKeys.has(unconstrainedKey) ) {
                        appliedUnconstrainedKeys.add(unconstrainedKey);
                        appliedUnconstrainedValues.push({ objectApiName: keptObject.objectApiName, fieldApiName: scannedField.fieldApiName });
                    }
                    return;
                }

                const parentObjectApiName = parentsByFieldApiName.get(scannedField.fieldApiName);
                const isSingleLine = scannedField.endIndex === scannedField.startIndex + 1;
                const fieldValue = isSingleLine ? lines[scannedField.startIndex].slice(fieldIndent.length + scannedField.fieldApiName.length + 1).trim() : undefined;

                if ( newParent && isSingleLine && parentObjectApiName === newParent.objectApiName ) {
                    rewiredFieldsByLineIndex.set(scannedField.startIndex, { fieldApiName: scannedField.fieldApiName, nickname: newParent.nicknames[0] });
                    return;
                }

                const isDroppedParentByLookup = parentObjectApiName !== undefined && excludedObjectApiNames.has(parentObjectApiName);
                const isDroppedParentByNickname = fieldValue !== undefined && droppedNicknames.has(fieldValue);

                if ( isDroppedParentByLookup || isDroppedParentByNickname ) {
                    removeFieldLines(scannedField);
                    droppedLookups.push({
                        fieldApiName: scannedField.fieldApiName,
                        parentObjectApiName: parentObjectApiName ?? scannedObjects.find(scannedObject => scannedObject.nicknames.includes(fieldValue as string))?.objectApiName ?? ''
                    });
                }

            });

            // A fields: LINE WITH NOTHING LEFT UNDER IT LOADS AS null, WHICH SNOWFAKERY DOES NOT TAKE FOR "NO FIELDS"; THE OBJECT IS KEPT WITHOUT IT
            if ( keptObject.fields.length > 0
                    && keptObject.fieldsLineIndexes.length === 1
                    && keptObject.fields.every(scannedField => removedLineIndexes.has(scannedField.startIndex)) ) {
                removedLineIndexes.add(keptObject.fieldsLineIndexes[0]);
            }

        });

        if ( unconstrainedMismatch !== undefined ) {
            return {
                isFiltered: false,
                refusal: {
                    reason: 'unsupported-filter-layout',
                    message: `${unconstrainedMismatch.objectApiName}.${unconstrainedMismatch.fieldApiName} in the recipe is not the value its validation rules wrote, so they could not be switched off.`,
                    objectApiName: unconstrainedMismatch.objectApiName,
                    fieldApiName: unconstrainedMismatch.fieldApiName
                }
            };
        }

        const movedHeaderIndexes = new Set(objectsToMove.map(objectToMove => objectToMove.headerIndex));
        const renderedLines: Array<{ text: string; ending: string }> = [];
        const defaultLineEnding = recipeLines.lineEndings.find(lineEnding => lineEnding !== '') ?? '\n';
        const emit = (text: string, lineIndex?: number) => renderedLines.push({ text: text, ending: ( lineIndex === undefined ? '' : recipeLines.lineEndings[lineIndex] ) || defaultLineEnding });
        const isLastEmittedBlank = () => renderedLines.length === 0 || !renderedLines[renderedLines.length - 1].text.trim();
        const skipBlankLines = (fromIndex: number, toIndex: number) => {
            let lineIndex = fromIndex;
            while ( lineIndex < toIndex && !lines[lineIndex].trim() && isLastEmittedBlank() ) {
                lineIndex++;
            }
            return lineIndex;
        };

        const reindent = (recipeLine: string, indentDelta: number): string | undefined => {
            if ( indentDelta === 0 || !recipeLine.trim() ) {
                return recipeLine;
            }
            // AS FOR insertFriend: TEXT AFTER A BREAK THE JS SPLIT DOES NOT SEE WOULD KEEP ITS OLD COLUMN
            if ( /[\r\u0085\u2028\u2029]/.test(recipeLine) ) {
                return undefined;
            }
            if ( indentDelta > 0 ) {
                return `${' '.repeat(indentDelta)}${recipeLine}`;
            }
            return recipeLine.startsWith(' '.repeat(-indentDelta)) ? recipeLine.slice(-indentDelta) : undefined;
        };

        // EMITS ONE KEPT OBJECT WITH EVERYTHING KEPT UNDER IT, ITS "- object:" AT newObjectIndent; A MESSAGE WHEN IT COULD NOT BE MOVED EXACTLY
        const renderObject = (scannedObject: IScannedObject, newObjectIndent: number): string | undefined => {

            const indentDelta = newObjectIndent - scannedObject.objectIndent;
            const span = spansByHeaderIndex.get(scannedObject.headerIndex) as ILineSpan;
            const friends = friendIndex.friendsByParentHeaderIndex.get(scannedObject.headerIndex) ?? [];
            const friendsBySpanStart = new Map(friends.map(friend => [( spansByHeaderIndex.get(friend.headerIndex) as ILineSpan ).startIndex, friend]));
            const keptFriendCount = friends.filter(friend => !droppedHeaderIndexes.has(friend.headerIndex) && !movedHeaderIndexes.has(friend.headerIndex)).length;
            const movedInObjects = movedInObjectsByParentHeaderIndex.get(scannedObject.headerIndex) ?? [];
            const ownBlockLineIndexes = new Set(this.collectOwnBlockLineIndexes(lines, scannedObject));
            const isFriendsBlockEmptied = keptFriendCount + movedInObjects.length === 0;

            for ( let lineIndex = span.startIndex; lineIndex < span.endIndex; ) {

                const friend = friendsBySpanStart.get(lineIndex);
                if ( friend ) {
                    const friendSpan = spansByHeaderIndex.get(friend.headerIndex) as ILineSpan;
                    if ( droppedHeaderIndexes.has(friend.headerIndex) || movedHeaderIndexes.has(friend.headerIndex) ) {
                        lineIndex = skipBlankLines(friendSpan.endIndex, span.endIndex);
                        continue;
                    }
                    const friendRefusal = renderObject(friend, newObjectIndent + FRIENDS_INDENT_STEP);
                    if ( friendRefusal ) {
                        return friendRefusal;
                    }
                    lineIndex = friendSpan.endIndex;
                    continue;
                }

                const isFriendsBlockLine = lineIndex > scannedObject.headerIndex && !ownBlockLineIndexes.has(lineIndex);
                if ( removedLineIndexes.has(lineIndex) || ( isFriendsBlockEmptied && isFriendsBlockLine ) ) {
                    lineIndex++;
                    continue;
                }

                const unconstrainedField = unconstrainedFieldsByLineIndex.get(lineIndex);
                if ( unconstrainedField ) {
                    ( this.buildFieldLines(unconstrainedField.fieldApiName, unconstrainedField.value, this.getObjectLayout(newObjectIndent)) as string[] )
                        .forEach(unconstrainedLine => emit(unconstrainedLine, lineIndex));
                    lineIndex++;
                    continue;
                }

                const rewiredField = rewiredFieldsByLineIndex.get(lineIndex);
                const fixedField = fixedFieldsByLineIndex.get(lineIndex);
                const constrainedField = constrainedFieldsByLineIndex.get(lineIndex);
                const countOverride = countOverridesByLineIndex.get(lineIndex);
                const renderedLine = rewiredField
                    ? `${this.getObjectLayout(newObjectIndent).fieldIndent}${rewiredField.fieldApiName}: ${rewiredField.nickname}`
                    : fixedField
                    ? this.buildFixedValueFieldLine(this.getObjectLayout(newObjectIndent).fieldIndent, fixedField.fieldApiName, fixedField.fixedValue)
                    : constrainedField
                    ? this.buildConstrainedExpressionFieldLine(this.getObjectLayout(newObjectIndent).fieldIndent, constrainedField.fieldApiName, constrainedField.expression)
                    : countOverride !== undefined
                        ? `${this.getObjectLayout(newObjectIndent).propertyIndent}count: ${countOverride}`
                        : reindent(lines[lineIndex], indentDelta);
                if ( renderedLine === undefined ) {
                    return `${scannedObject.objectApiName} has a line that could not be moved to its new depth exactly (a lone carriage return, U+0085, U+2028 or U+2029 inside it, or a line indented less than its object).`;
                }
                emit(renderedLine, lineIndex);
                lineIndex++;

            }

            if ( movedInObjects.length > 0 && scannedObject.friendsLineIndexes.length === 0 ) {
                emit(`${this.getObjectLayout(newObjectIndent).propertyIndent}friends:`);
            }

            for ( const movedInObject of movedInObjects ) {
                const movedRefusal = renderObject(movedInObject, newObjectIndent + FRIENDS_INDENT_STEP);
                if ( movedRefusal ) {
                    return movedRefusal;
                }
            }

            return undefined;

        };

        const droppedObjectApiNames = [...new Set(scannedObjects
            .filter(scannedObject => droppedHeaderIndexes.has(scannedObject.headerIndex))
            .map(scannedObject => scannedObject.objectApiName))];

        const leftOutParts = [
            ...( droppedObjectApiNames.length > 0 ? [droppedObjectApiNames.join(', ')] : [] ),
            ...( droppedFields.length > 0 ? [`fields ${droppedFields.map(droppedField => `${droppedField.objectApiName}.${droppedField.fieldApiName}`).join(', ')}`] : [] )
        ];
        const headerParts = [
            ...( leftOutParts.length > 0 ? [`leaving out: ${leftOutParts.join('; ')}`] : [] ),
            ...( appliedCounts.length > 0 ? [`with counts: ${appliedCounts.map(appliedCount => `${appliedCount.objectApiName} ${appliedCount.count}`).join(', ')}`] : [] ),
            ...( appliedFixedValues.length > 0 ? [`with fixed values: ${appliedFixedValues.map(appliedFixedValue => `${appliedFixedValue.objectApiName}.${appliedFixedValue.fieldApiName}`).join(', ')}`] : [] ),
            ...( appliedConstrainedExpressions.length > 0 ? [`with constrained fields: ${appliedConstrainedExpressions.map(appliedExpression => `${appliedExpression.objectApiName}.${appliedExpression.fieldApiName}`).join(', ')}`] : [] ),
            ...( appliedUnconstrainedValues.length > 0 ? [`with validation rules off: ${appliedUnconstrainedValues.map(appliedValue => `${appliedValue.objectApiName}.${appliedValue.fieldApiName}`).join(', ')}`] : [] )
        ];
        emit(`# Recipe Cockpit -- a filtered copy of this tree's recipe, ${headerParts.join('; ')}`);

        // A FILE THAT ENDS WITH A LINE BREAK SPLITS INTO A LAST EMPTY LINE, WHICH STAYS LAST
        const hasFinalEmptyLine = lines.length > 1 && lines[lines.length - 1] === '';
        const topLevelEndIndex = hasFinalEmptyLine ? lines.length - 1 : lines.length;
        const topLevelObjectsBySpanStart = new Map(scannedObjects
            .filter(scannedObject => scannedObject.parentHeaderIndex === undefined)
            .map(scannedObject => [( spansByHeaderIndex.get(scannedObject.headerIndex) as ILineSpan ).startIndex, scannedObject]));

        for ( let lineIndex = 0; lineIndex < topLevelEndIndex; ) {

            const topLevelObject = topLevelObjectsBySpanStart.get(lineIndex);
            if ( !topLevelObject ) {
                emit(lines[lineIndex], lineIndex);
                lineIndex++;
                continue;
            }

            const topLevelSpan = spansByHeaderIndex.get(topLevelObject.headerIndex) as ILineSpan;
            if ( droppedHeaderIndexes.has(topLevelObject.headerIndex) ) {
                lineIndex = skipBlankLines(topLevelSpan.endIndex, topLevelEndIndex);
                continue;
            }

            const renderRefusal = renderObject(topLevelObject, 0);
            if ( renderRefusal ) {
                return refuseFilter('unsupported-filter-layout', renderRefusal, topLevelObject.objectApiName);
            }
            lineIndex = topLevelSpan.endIndex;

        }

        for ( const movedToTopObject of movedInObjectsByParentHeaderIndex.get(undefined) ?? [] ) {
            if ( !isLastEmittedBlank() ) {
                emit('');
            }
            const movedRefusal = renderObject(movedToTopObject, 0);
            if ( movedRefusal ) {
                return refuseFilter('unsupported-filter-layout', movedRefusal, movedToTopObject.objectApiName);
            }
        }

        if ( hasFinalEmptyLine ) {
            emit('');
        }
        renderedLines[renderedLines.length - 1].ending = '';

        const filteredRecipeText = renderedLines.map(renderedLine => `${renderedLine.text}${renderedLine.ending}`).join('');

        const movedObjects: IRecipeFilterMove[] = objectsToMove.map(movedObject => {
            const newParent = newParentsByMovedHeaderIndex.get(movedObject.headerIndex);
            return { objectApiName: movedObject.objectApiName, ...( newParent ? { newParentObjectApiName: newParent.objectApiName } : {} ) };
        });

        if ( !this.isFilteredRecipeReadBack(filteredRecipeText, keptObjects, finalParentHeaderIndexes, friendIndex, excludedObjectApiNames, excludedFieldsByObject, appliedCounts, fixedValuesByObject, constrainedExpressionsByObject, unconstrainedValuesByObject) ) {
            return refuseFilter('unsupported-filter-layout', 'The filtered copy did not read back as the kept objects nested where they were meant to be, with the counts, fixed values, constraints and validation rules that were set, so it was not used.');
        }

        return {
            isFiltered: true,
            recipeText: filteredRecipeText,
            droppedObjectApiNames: droppedObjectApiNames,
            droppedLookups: droppedLookups,
            movedObjects: movedObjects,
            droppedFields: droppedFields,
            appliedCounts: appliedCounts,
            appliedFixedValues: appliedFixedValues,
            appliedConstrainedExpressions: appliedConstrainedExpressions,
            appliedUnconstrainedValues: appliedUnconstrainedValues
        };

    }

    /*
        Why a constrained expression cannot be written (#323), or undefined. The backend built it from
        bounds the host checked, so this holds the BACKEND to the shape the copy relies on rather than
        guarding a reader's text: one "${{ ... }}" and nothing else, on one line, with no second
        template delimiter of either snowfakery environment inside -- and no "}}", which ends a
        faker-js expression early. The answer completes "The constrained expression for X ...".
    */
    /*
        The FIRST "${{ ... }}" line of a field's value, a double-quoted one unquoted, or undefined:
        what the Treecipe Adapter generates a recipe field's values from (#417) and what it offers a
        field only the org holds (#446). A line that does not parse as a quoted string, or carries a
        line break either YAML reader sees, is not one.
    */
    static findFirstExpressionLine(value: string | undefined): string | undefined {

        for ( const valueLine of String(value ?? '').split('\n') ) {
            const trimmedLine = valueLine.trim();
            let candidate: unknown = trimmedLine;
            if ( trimmedLine.length >= 2 && trimmedLine.startsWith('"') && trimmedLine.endsWith('"') ) {
                try {
                    candidate = JSON.parse(trimmedLine);
                } catch {
                    candidate = trimmedLine;
                }
            }
            if ( typeof candidate === 'string' && candidate.startsWith('${{') && !/[\r\n\u0085\u2028\u2029]/.test(candidate) ) {
                return candidate;
            }
        }

        return undefined;

    }

    static checkConstrainedExpression(expression: string): string | undefined {

        if ( typeof expression !== 'string' || !expression.startsWith('${{') || !expression.endsWith('}}') || expression.length < 6 ) {
            return 'is not one "${{ ... }}" expression.';
        }
        if ( expression.length > CONSTRAINED_EXPRESSION_MAX_LENGTH ) {
            return `is longer than ${CONSTRAINED_EXPRESSION_MAX_LENGTH} characters.`;
        }
        if ( /[\u0000-\u001f\u007f-\u009f\u2028\u2029\ufeff\ufffe\uffff]/.test(expression) ) {
            return 'contains a line break or control character.';
        }
        const innerCode = expression.slice(3, -2);
        const innerDelimiter = CONSTRAINED_EXPRESSION_INNER_DELIMITERS.find(delimiter => innerCode.includes(delimiter));
        if ( innerDelimiter !== undefined ) {
            return `contains "${innerDelimiter}" inside it.`;
        }
        return undefined;

    }

    // DOUBLE-QUOTED, SO ITS ": " AND "," ARE NEVER READ AS YAML; checkConstrainedExpression LEAVES ONLY \ AND " TO ESCAPE
    static buildConstrainedExpressionFieldLine(fieldIndent: string, fieldApiName: string, expression: string): string {
        return `${fieldIndent}${fieldApiName}: "${expression.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }

    /*
        Why a fixed value cannot be written (#262), or undefined when it can. The value is the
        reader's, and both backends read the copy as YAML and then as templates, so it is refused
        rather than escaped wherever it could be read as anything but itself: a line break either
        parser sees (js-yaml breaks at CR and LF, PyYAML also at U+0085, U+2028 and U+2029), any other
        character PyYAML refuses in a stream, and every template opener -- faker-js runs "${{ }}"
        with new Function(), and snowfakery renders "${{", "${%" and, in its default
        snowfakery_version 2, a legacy unsandboxed "<<" / "<%" environment, quoted or not. "${",
        "{{" and "{%" are wider than any delimiter on purpose. The answer completes "The fixed value
        for X ...".
    */
    static checkFixedValue(fixedValue: IRecipeFixedValue): string | undefined {

        if ( typeof fixedValue?.value !== 'string' || fixedValue.value.length === 0 ) {
            return 'is empty.';
        }
        if ( fixedValue.kind === 'expression' ) {
            return this.checkConstrainedExpression(fixedValue.value);
        }
        if ( /[\u0000-\u001f\u007f-\u009f\u2028\u2029\ufeff\ufffe\uffff]/.test(fixedValue.value) ) {
            return 'has a line break or another control character in it.';
        }
        const templateOpener = FIXED_VALUE_TEMPLATE_OPENERS.find(opener => fixedValue.value.includes(opener));
        if ( templateOpener !== undefined ) {
            return `has "${templateOpener}" in it, which a faker backend would read as the start of a template.`;
        }
        if ( fixedValue.kind === 'number' && !FIXED_NUMBER_PATTERN.test(fixedValue.value) ) {
            return 'is not a plain number.';
        }
        if ( fixedValue.kind === 'boolean' && fixedValue.value !== 'true' && fixedValue.value !== 'false' ) {
            return 'is not true or false.';
        }
        if ( fixedValue.kind !== 'text' && fixedValue.kind !== 'number' && fixedValue.kind !== 'boolean' ) {
            return 'has no kind the writer knows.';
        }
        return undefined;

    }

    /*
        Text is always double-quoted, which checkFixedValue leaves only \ and " to escape; a number or
        boolean is written plain. A number past what a double holds exactly is quoted too: js-yaml
        reads 123456789012345678 as 123456789012345680, so faker-js would generate a different number
        than the one typed, where the string reaches the org as the digits themselves.
    */
    static toFixedValueScalar(fixedValue: IRecipeFixedValue): string {
        const isExactAsNumber = fixedValue.value.replace(/[-.]/g, '').replace(/^0+/, '').length <= FIXED_NUMBER_MAX_EXACT_DIGITS;
        return fixedValue.kind === 'text' || fixedValue.kind === 'expression' || ( fixedValue.kind === 'number' && !isExactAsNumber )
            ? `"${fixedValue.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
            : fixedValue.value;
    }

    private static buildFixedValueFieldLine(fieldIndent: string, fieldApiName: string, fixedValue: IRecipeFixedValue): string {
        return `${fieldIndent}${fieldApiName}: ${this.toFixedValueScalar(fixedValue)}`;
    }

    /*
        How many records of each object a recipe generates (#255): an occurrence's "count:" times the
        records of the occurrence whose friends: block holds it -- a nested faker-js friend's count
        is per parent record -- summed over every occurrence of the object. An occurrence with no
        readable "count:" generates one per parent record, which is what both backends do with none.
    */
    static countRecipeRecordsByObject(recipeText: string): Map<string, number> {

        const { lines } = this.splitRecipeLines(recipeText);
        const scannedObjects = this.scanRecipeObjects(lines);
        const recordsByHeaderIndex = new Map<number, number>();
        const recordTotalsByObject = new Map<string, number>();

        // FILE ORDER PUTS A PARENT BEFORE ITS FRIENDS, SO ITS RECORDS ARE KNOWN WHEN THEY ASK
        scannedObjects.forEach(scannedObject => {
            const parentRecords = scannedObject.parentHeaderIndex === undefined ? 1 : recordsByHeaderIndex.get(scannedObject.parentHeaderIndex) ?? 1;
            const occurrenceRecords = ( this.readObjectCount(lines, scannedObject) ?? 1 ) * parentRecords;
            recordsByHeaderIndex.set(scannedObject.headerIndex, occurrenceRecords);
            recordTotalsByObject.set(scannedObject.objectApiName, ( recordTotalsByObject.get(scannedObject.objectApiName) ?? 0 ) + occurrenceRecords);
        });

        return recordTotalsByObject;

    }

    // A COUNT THE READER CAN SET: A WHOLE NUMBER OF ONE OR MORE, NOTHING PAST WHAT A NUMBER HOLDS EXACTLY
    static isRecordCount(candidate: unknown): candidate is number {
        return typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 1;
    }

    // THE VALUE OF AN OCCURRENCE'S ONE "count:" LINE, OR undefined WHEN IT HAS NONE, SEVERAL, OR ONE THAT IS NOT A PLAIN WHOLE NUMBER
    static readObjectCount(lines: string[], scannedObject: IScannedObject): number | undefined {

        if ( scannedObject.propertyLineIndexes.count.length !== 1 ) {
            return undefined;
        }

        const countMatch = /^ *count:\s*(\d+)\s*$/.exec(lines[scannedObject.propertyLineIndexes.count[0]]);
        const recordCount = countMatch ? Number(countMatch[1]) : undefined;

        return Number.isSafeInteger(recordCount) ? recordCount : undefined;

    }

    // EVERY KEPT OCCURRENCE, IN THE SAME ORDER OF NAMES AND NICKNAMES, UNDER THE PARENT THE FILTER CHOSE; NO EXCLUDED OBJECT, AND NO UNTICKED FIELD
    private static isFilteredRecipeReadBack(filteredRecipeText: string,
                                            keptObjects: IScannedObject[],
                                            finalParentHeaderIndexes: Map<number, number | undefined>,
                                            friendIndex: IScannedFriendIndex,
                                            excludedObjectApiNames: Set<string>,
                                            excludedFieldsByObject: Map<string, Set<string>>,
                                            appliedCounts: IRecipeFilterCount[],
                                            fixedValuesByObject: Map<string, Map<string, IRecipeFixedValue>>,
                                            constrainedExpressionsByObject: Map<string, Map<string, string>>,
                                            unconstrainedValuesByObject: Map<string, Map<string, IRecipeUnconstrainedValue>>): boolean {

        const describeOccurrence = (scannedObject: IScannedObject | undefined) => scannedObject ? `${scannedObject.objectApiName}\u0000${scannedObject.nicknames.join('\u0000')}` : '';
        const describeExpected = (keptObject: IScannedObject) => {
            const parentHeaderIndex = finalParentHeaderIndexes.get(keptObject.headerIndex);
            return `${describeOccurrence(keptObject)}\u0001${describeOccurrence(parentHeaderIndex === undefined ? undefined : friendIndex.objectsByHeaderIndex.get(parentHeaderIndex))}`;
        };

        const filteredLines = this.splitRecipeLines(filteredRecipeText).lines;
        const filteredObjects = this.scanRecipeObjects(filteredLines);
        const filteredIndex = this.buildScannedFriendIndex(filteredObjects);
        const describeFiltered = (filteredObject: IScannedObject) => `${describeOccurrence(filteredObject)}\u0001${describeOccurrence(filteredObject.parentHeaderIndex === undefined ? undefined : filteredIndex.objectsByHeaderIndex.get(filteredObject.parentHeaderIndex))}`;

        const expected = keptObjects.map(describeExpected).sort();
        const actual = filteredObjects.map(describeFiltered).sort();

        return !filteredObjects.some(filteredObject => excludedObjectApiNames.has(filteredObject.objectApiName))
                && !filteredObjects.some(filteredObject => filteredObject.fields.some(scannedField => excludedFieldsByObject.get(filteredObject.objectApiName)?.has(scannedField.fieldApiName)))
                && expected.length === actual.length
                && expected.every((description, index) => description === actual[index])
                && appliedCounts.every(appliedCount => {
                    const countedObject = filteredObjects.find(filteredObject => filteredObject.objectApiName === appliedCount.objectApiName);
                    return !!countedObject && this.readObjectCount(filteredLines, countedObject) === appliedCount.count;
                })
                && filteredObjects.every(filteredObject => {
                    const fixedValuesByField = fixedValuesByObject.get(filteredObject.objectApiName);
                    const fieldIndent = this.getObjectLayout(filteredObject.objectIndent).fieldIndent;
                    return !fixedValuesByField || filteredObject.fields
                        .filter(scannedField => fixedValuesByField.has(scannedField.fieldApiName))
                        .every(scannedField => scannedField.endIndex === scannedField.startIndex + 1
                                                && filteredLines[scannedField.startIndex] === this.buildFixedValueFieldLine(fieldIndent, scannedField.fieldApiName, fixedValuesByField.get(scannedField.fieldApiName) as IRecipeFixedValue));
                })
                && filteredObjects.every(filteredObject => {
                    const expressionsByField = constrainedExpressionsByObject.get(filteredObject.objectApiName);
                    const fieldIndent = this.getObjectLayout(filteredObject.objectIndent).fieldIndent;
                    return !expressionsByField || filteredObject.fields
                        .filter(scannedField => expressionsByField.has(scannedField.fieldApiName))
                        .every(scannedField => scannedField.endIndex === scannedField.startIndex + 1
                                                && filteredLines[scannedField.startIndex] === this.buildConstrainedExpressionFieldLine(fieldIndent, scannedField.fieldApiName, expressionsByField.get(scannedField.fieldApiName) as string));
                })
                && filteredObjects.every(filteredObject => {
                    const unconstrainedByField = unconstrainedValuesByObject.get(filteredObject.objectApiName);
                    const layout = this.getObjectLayout(filteredObject.objectIndent);
                    return !unconstrainedByField || filteredObject.fields
                        .filter(scannedField => unconstrainedByField.has(scannedField.fieldApiName))
                        .every(scannedField => {
                            const expectedLines = this.buildFieldLines(scannedField.fieldApiName, ( unconstrainedByField.get(scannedField.fieldApiName) as IRecipeUnconstrainedValue ).unconstrainedValue, layout) as string[];
                            return expectedLines.length === scannedField.endIndex - scannedField.startIndex
                                    && expectedLines.every((expectedLine, lineOffset) => filteredLines[scannedField.startIndex + lineOffset] === expectedLine);
                        });
                });

    }

    // THE "# Object (...)" COMMENT LINES DIRECTLY ABOVE AN OBJECT'S HEADER, AT ITS COLUMN, BELONG TO IT
    private static findHeaderCommentStartIndex(lines: string[], scannedObject: IScannedObject): number {

        let startIndex = scannedObject.headerIndex;

        while ( startIndex > 0
                && lines[startIndex - 1].trimStart().startsWith('#')
                && lines[startIndex - 1].length - lines[startIndex - 1].trimStart().length === scannedObject.objectIndent ) {
            startIndex--;
        }

        return startIndex;

    }

    // THE LAST NON-BLANK LINE OF THE OBJECT, ITS friends: BLOCK AND EVERYTHING NESTED IN IT INCLUDED
    private static findLastLineIndexOfObject(lines: string[], scannedObject: IScannedObject): number {

        let lastLineIndex = scannedObject.headerIndex;

        for ( let lineIndex = scannedObject.headerIndex + 1; lineIndex < lines.length; lineIndex++ ) {

            const recipeLine = lines[lineIndex];

            if ( !recipeLine.trim() ) {
                continue;
            }

            if ( recipeLine.length - recipeLine.trimStart().length <= scannedObject.objectIndent ) {
                break;
            }

            lastLineIndex = lineIndex;

        }

        return lastLineIndex;

    }

    /*
        The line's comment, from its "#", when its text starts with TODO (#354); undefined otherwise.
        A comment is a "#" at the start of the line or after a space or tab, outside a YAML quoted
        scalar and outside a "{{ ... }}" template and the quoted strings in it -- so a picklist value
        or a fixed value holding " # TODO" is a value, not a TODO. One pass over the line, so a long
        line costs its length and nothing more.
    */
    static readTodoCommentText(recipeLine: string): string | undefined {

        if ( !recipeLine.includes('TODO') ) {
            return undefined;
        }

        const commentStartIndex = this.findCommentStartIndex(recipeLine);
        if ( commentStartIndex < 0 ) {
            return undefined;
        }

        const commentText = recipeLine.slice(commentStartIndex);
        return TODO_COMMENT_START_PATTERN.test(commentText) ? commentText.trim() : undefined;

    }

    private static findCommentStartIndex(recipeLine: string): number {

        let quoteCharacter = '';
        let isBackslashEscaped = false;
        let templateDepth = 0;
        let previousCharacter = '';
        let previousNonBlankCharacter = '';

        for ( let characterIndex = 0; characterIndex < recipeLine.length; characterIndex++ ) {

            const character = recipeLine[characterIndex];
            const nextCharacter = recipeLine[characterIndex + 1];
            const isAfterBlank = previousCharacter === '' || previousCharacter === ' ' || previousCharacter === '\t';
            previousCharacter = character;

            if ( quoteCharacter ) {
                // A YAML SINGLE-QUOTED SCALAR ESCAPES ITS QUOTE AS ''; EVERY OTHER STRING HERE ESCAPES WITH A BACKSLASH
                if ( isBackslashEscaped && character === '\\' ) {
                    characterIndex++;
                    previousCharacter = '';
                } else if ( character === quoteCharacter && !isBackslashEscaped && nextCharacter === quoteCharacter ) {
                    characterIndex++;
                } else if ( character === quoteCharacter ) {
                    quoteCharacter = '';
                }
                continue;
            }

            if ( character === '{' && nextCharacter === '{' ) {
                templateDepth++;
                characterIndex++;
                continue;
            }

            if ( templateDepth > 0 ) {
                if ( character === '}' && nextCharacter === '}' ) {
                    templateDepth--;
                    characterIndex++;
                } else if ( character === '"' || character === "'" ) {
                    quoteCharacter = character;
                    isBackslashEscaped = true;
                }
                continue;
            }

            if ( (character === '"' || character === "'") && isAfterBlank && QUOTED_SCALAR_LEAD_CHARACTERS.has(previousNonBlankCharacter) ) {
                quoteCharacter = character;
                isBackslashEscaped = character === '"';
                continue;
            }

            if ( character === '#' && isAfterBlank ) {
                return characterIndex;
            }

            if ( character !== ' ' && character !== '\t' ) {
                previousNonBlankCharacter = character;
            }

        }

        return -1;

    }

    /*
        Why the TODO comment on this line of the occurrence cannot be removed (#391), or undefined
        when it can. The line must be one of the occurrence's todoLineIndexes.
    */
    /*
        A caller walking an occurrence's TODOs hands in what it already holds -- the field starting at
        the line, or null for none, and the marker lines -- so a load over thousands of TODOs is one
        pass rather than a search of the fields per TODO.
    */
    static findTodoRemoveLock(lines: string[],
                                scannedObject: IScannedObject,
                                lineIndex: number,
                                known?: { fieldStartingAtLine: IScannedField | null; owningField?: IScannedField | null; markerStartIndexes: ReadonlySet<number> }): RecipeTodoRemoveLock | undefined {

        const isMarkerLine = known
            ? known.markerStartIndexes.has(lineIndex)
            : scannedObject.commentedOutFieldMarkers.some(marker => marker.startIndex === lineIndex);
        if ( isMarkerLine ) {
            return 'commented-out-marker';
        }

        const recipeLine = lines[lineIndex];
        const commentStartIndex = this.findCommentStartIndex(recipeLine);
        if ( recipeLine.slice(commentStartIndex).startsWith(RECORD_TYPE_OPTIONS_TODO_START) ) {
            return 'record-type-options';
        }

        const scannedField = known ? known.fieldStartingAtLine : scannedObject.fields.find(candidateField => candidateField.startIndex === lineIndex);
        if ( scannedField ) {
            const { fieldIndent } = this.getObjectLayout(scannedObject.objectIndent);
            const valueBeforeComment = recipeLine.slice(fieldIndent.length + scannedField.fieldApiName.length + 1, commentStartIndex);
            if ( valueBeforeComment.trim() === '' ) {
                return 'field-value';
            }
            return undefined;
        }

        // A CONTINUATION LINE: ONLY ITS FIELD'S FIRST LINE SAYS WHETHER A "#" HERE IS A COMMENT OR PART OF THE VALUE
        const owningField = known && !known.owningField ? undefined : ( known?.owningField ?? scannedObject.fields.find(candidateField => candidateField.startIndex < lineIndex && lineIndex < candidateField.endIndex) );
        return owningField && !this.isFieldValueClosedOnFirstLine(lines, scannedObject, owningField) ? 'scalar-content' : undefined;

    }

    /*
        Takes one TODO comment out of a recipe (#391): a whole comment line is deleted, a comment after
        a value is cut off and the value kept. Every other line keeps its bytes and its ending, and the
        result is scanned again: anything but the one TODO fewer, in the same occurrence and field, is
        refused. The line must still carry the TODO the panel drew, so a recipe edited since writes
        nothing.
    */
    static removeTodoComment(recipeText: string, removeRequest: ITodoRemoveRequest): RecipeTodoRemoveResult {

        const recipeLines = this.splitRecipeLines(recipeText);
        const { lines, lineEndings } = recipeLines;
        const lineIndex = removeRequest.lineNumber - 1;
        const refuseRemove = (reason: RecipeWriterRefusalReason, message: string, objectApiName = '', fieldApiName?: string, objectNickname?: string): RecipeTodoRemoveResult => (
            { isRemoved: false, refusal: this.refuse(reason, message, objectApiName, fieldApiName, objectNickname).refusal }
        );

        if ( !Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= lines.length ) {
            return refuseRemove('todo-not-found', `The recipe has no line ${removeRequest.lineNumber}.`);
        }

        const todoText = this.readTodoCommentText(lines[lineIndex]);
        if ( todoText === undefined ) {
            return refuseRemove('todo-not-found', `Line ${removeRequest.lineNumber} of the recipe carries no TODO comment.`);
        }
        if ( todoText !== removeRequest.todoText ) {
            return refuseRemove('todo-changed', `Line ${removeRequest.lineNumber} of the recipe no longer carries this TODO; it was changed since the Recipe Cockpit read it.`);
        }

        const scannedObjects = this.scanRecipeObjects(lines);
        const ownerIndex = scannedObjects.findIndex(scannedObject => scannedObject.todoLineIndexes.includes(lineIndex));
        if ( ownerIndex === -1 ) {
            return refuseRemove('todo-not-found', `Line ${removeRequest.lineNumber} of the recipe is not a TODO of any object in it.`);
        }

        const owner = scannedObjects[ownerIndex];
        const ownerField = owner.fields.find(scannedField => scannedField.startIndex <= lineIndex && lineIndex < scannedField.endIndex);
        const fieldApiName = ownerField?.fieldApiName;
        const occurrences = scannedObjects.filter(scannedObject => scannedObject.objectApiName === owner.objectApiName);
        const objectNickname = this.readDistinctOccurrenceNickname(occurrences, owner);
        if ( occurrences.length > 1 && objectNickname === undefined ) {
            return refuseRemove('indistinct-todo-occurrence', `${owner.objectApiName} is written more than once without a nickname that tells this one apart, so the TODO could not be put back in the same place.`, owner.objectApiName, fieldApiName);
        }

        const removeLock = this.findTodoRemoveLock(lines, owner, lineIndex);
        if ( removeLock !== undefined || LINE_BREAK_PATTERN.test(lines[lineIndex]) ) {
            return refuseRemove('todo-not-removable', this.describeTodoRemoveLock(removeLock), owner.objectApiName, fieldApiName, objectNickname);
        }

        const originalLine = lines[lineIndex];
        const commentStartIndex = this.findCommentStartIndex(originalLine);
        const valueBeforeComment = originalLine.slice(0, commentStartIndex);
        const isWholeLine = valueBeforeComment.trim() === '';
        const patchedLines = lines.slice();
        const patchedLineEndings = lineEndings.slice();
        let lineEnding: string | undefined;

        if ( isWholeLine ) {
            // THE LAST LINE HAS NO ENDING OF ITS OWN, SO THE ONE BEFORE IT GIVES UP ITS ENDING AND A FILE WITH NO FINAL NEWLINE STAYS SO
            const isLastLine = lineIndex === lines.length - 1;
            lineEnding = isLastLine ? patchedLineEndings[lineIndex - 1] : patchedLineEndings[lineIndex];
            if ( isLastLine ) {
                patchedLineEndings[lineIndex - 1] = '';
            }
            patchedLines.splice(lineIndex, 1);
            patchedLineEndings.splice(lineIndex, 1);
        } else {
            patchedLines[lineIndex] = valueBeforeComment.trimEnd();
        }

        const anchorIndex = this.findTodoAnchorIndex(lines, lineIndex - 1);
        const nextTodoLines: string[] = [];
        for ( let nextIndex = lineIndex + 1; isWholeLine && nextIndex < lines.length && this.isWholeTodoCommentLine(lines[nextIndex]); nextIndex++ ) {
            nextTodoLines.push(lines[nextIndex]);
        }

        const fieldIndex = ownerField ? owner.fields.indexOf(ownerField) : -1;
        const expectedStructure = this.describeTodoStructure(scannedObjects, ownerIndex, isWholeLine ? fieldIndex : -1, -1);
        if ( this.describeTodoStructure(this.scanRecipeObjects(patchedLines), -1, -1, 0) !== expectedStructure ) {
            return refuseRemove('todo-structure-changed', `Removing this TODO would change how the recipe around it reads, so nothing was written.`, owner.objectApiName, fieldApiName, objectNickname);
        }

        return {
            isRemoved: true,
            recipeText: this.joinRecipeLines({ lines: patchedLines, lineEndings: patchedLineEndings }),
            removed: {
                objectApiName: owner.objectApiName,
                ...( objectNickname !== undefined ? { objectNickname: objectNickname } : {} ),
                ...( fieldApiName !== undefined ? { fieldApiName: fieldApiName } : {} ),
                lineNumber: removeRequest.lineNumber,
                todoText: todoText,
                originalLine: originalLine,
                kind: isWholeLine ? 'line' : 'trailing',
                ...( isWholeLine ? {
                    lineEnding: lineEnding,
                    previousLine: lines[anchorIndex],
                    ...( anchorIndex < lineIndex - 1 ? { previousTodoLines: lines.slice(anchorIndex + 1, lineIndex) } : {} ),
                    ...( nextTodoLines.length > 0 ? { nextTodoLines: nextTodoLines } : {} )
                } : { cutLine: patchedLines[lineIndex] } )
            }
        };

    }

    /*
        Puts a removed TODO comment back where removeTodoComment took it from (#391). The place is
        found in the same occurrence and field: under the nearest line above it that is not a TODO line
        -- the one at its old place when that still matches, else the only match there -- and past the
        TODO lines under it, up to one that was below it. A trailing TODO goes back on the line it was cut
        from. Refused when the place is gone or ambiguous, when the TODO is already back, and when the
        result reads as anything but one TODO more.
    */
    static restoreTodoComment(recipeText: string, removed: IRemovedTodoComment, otherRemovedTodos: readonly IRemovedTodoComment[] = []): RecipeTodoRestoreResult {

        const refuseRestore = (reason: RecipeWriterRefusalReason, message: string): RecipeTodoRestoreResult => (
            { isRestored: false, refusal: this.refuse(reason, message, removed.objectApiName, removed.fieldApiName, removed.objectNickname).refusal }
        );

        if ( !this.isUsableRemovedTodo(removed) ) {
            return refuseRestore('invalid-value', 'The removed TODO is not one the Recipe Cockpit can put back.');
        }

        const recipeLines = this.splitRecipeLines(recipeText);
        const { lines, lineEndings } = recipeLines;
        const scannedObjects = this.scanRecipeObjects(lines);
        const located = this.locateRemovedTodoPlace(lines, scannedObjects, removed, otherRemovedTodos);
        if ( 'refusal' in located ) {
            return refuseRestore(located.refusal, located.message);
        }

        const ownerObject = scannedObjects[located.ownerIndex];
        const targetField = located.fieldIndex >= 0 ? ownerObject.fields[located.fieldIndex] : undefined;
        const isIntoFieldContinuation = !!targetField && ( removed.kind === 'line' || located.lineIndex > targetField.startIndex );
        if ( isIntoFieldContinuation && !this.isFieldValueClosedOnFirstLine(lines, ownerObject, targetField) ) {
            return refuseRestore('todo-not-removable', this.describeTodoRemoveLock('scalar-content'));
        }

        const patchedLines = lines.slice();
        const patchedLineEndings = lineEndings.slice();

        if ( removed.kind === 'line' ) {
            if ( located.lineIndex === patchedLines.length ) {
                patchedLineEndings[located.lineIndex - 1] = removed.lineEnding;
                patchedLines.push(removed.originalLine);
                patchedLineEndings.push('');
            } else {
                patchedLines.splice(located.lineIndex, 0, removed.originalLine);
                patchedLineEndings.splice(located.lineIndex, 0, removed.lineEnding);
            }
        } else {
            patchedLines[located.lineIndex] = removed.originalLine;
        }

        const patchedObjects = this.scanRecipeObjects(patchedLines);
        const owner = patchedObjects[located.ownerIndex];
        const ownerField = located.fieldIndex >= 0 ? owner?.fields[located.fieldIndex] : undefined;
        const isBackInOwner = !!owner && owner.todoLineIndexes.includes(located.lineIndex)
                                && ( located.fieldIndex < 0 || ( !!ownerField && ownerField.startIndex <= located.lineIndex && located.lineIndex < ownerField.endIndex ) );
        const expectedStructure = this.describeTodoStructure(scannedObjects, located.ownerIndex, removed.kind === 'line' ? located.fieldIndex : -1, 1);

        if ( !isBackInOwner || this.describeTodoStructure(patchedObjects, -1, -1, 0) !== expectedStructure ) {
            return refuseRestore('todo-structure-changed', 'Putting this TODO back would change how the recipe around it reads, so nothing was written.');
        }

        return { isRestored: true, recipeText: this.joinRecipeLines({ lines: patchedLines, lineEndings: patchedLineEndings }), lineNumber: located.lineIndex + 1 };

    }

    /*
        Whether a removed TODO is in the recipe again (#391): put back by hand, or never really gone.
        A 'line' TODO is back when its line already stands where a restore would put it; a 'trailing'
        one when its cut line is gone and its original line is there instead. A place that cannot be
        found is not back -- Restore then says why.
    */
    static isRemovedTodoBack(lines: string[], scannedObjects: IScannedObject[], removed: IRemovedTodoComment, otherRemovedTodos: readonly IRemovedTodoComment[] = []): boolean {
        const located = this.locateRemovedTodoPlace(lines, scannedObjects, removed, otherRemovedTodos);
        return 'refusal' in located && located.refusal === 'todo-already-back';
    }

    static describeTodoRemoveLock(removeLock: RecipeTodoRemoveLock | undefined): string {
        switch ( removeLock ) {
            case 'field-value':
                return 'This TODO is the field\'s whole value: removing it would leave the field empty.';
            case 'record-type-options':
                return 'The Recipe Cockpit and Run Faker read this line to find the field\'s record type sections.';
            case 'commented-out-marker':
                return 'This line is the Recipe Cockpit\'s marker for a commented-out field, which restoring the field needs.';
            case 'scalar-content':
                return 'This line is inside the field\'s multi-line value, where YAML reads it as part of the value rather than a comment.';
            default:
                return 'This TODO carries a line break that would not be put back as it was.';
        }
    }

    static isUsableRemovedTodo(removed: IRemovedTodoComment): boolean {

        const { originalLine } = removed;
        if ( LINE_BREAK_PATTERN.test(originalLine) || this.readTodoCommentText(originalLine) !== removed.todoText ) {
            return false;
        }

        const valueBeforeComment = originalLine.slice(0, this.findCommentStartIndex(originalLine));

        if ( removed.kind === 'line' ) {
            return valueBeforeComment.trim() === ''
                    && ( removed.lineEnding === '\n' || removed.lineEnding === '\r\n' )
                    && typeof removed.previousLine === 'string' && !LINE_BREAK_PATTERN.test(removed.previousLine) && !this.isWholeTodoCommentLine(removed.previousLine)
                    && this.isUsableTodoLineList(removed.previousTodoLines)
                    && this.isUsableTodoLineList(removed.nextTodoLines);
        }

        return valueBeforeComment.trim() !== '' && removed.cutLine === valueBeforeComment.trimEnd();

    }

    private static isUsableTodoLineList(todoLines: unknown): boolean {
        return todoLines === undefined || ( Array.isArray(todoLines) && todoLines.length > 0
                && todoLines.every(todoLine => typeof todoLine === 'string' && !LINE_BREAK_PATTERN.test(todoLine) && this.isWholeTodoCommentLine(todoLine)) );
    }

    private static readDistinctOccurrenceNickname(occurrences: IScannedObject[], occurrence: IScannedObject): string | undefined {

        if ( occurrence.nicknames.length !== 1 ) {
            return undefined;
        }

        const nickname = occurrence.nicknames[0];
        return occurrences.filter(candidate => candidate.nicknames.includes(nickname)).length === 1 ? nickname : undefined;

    }

    private static locateRemovedTodoPlace(lines: string[], scannedObjects: IScannedObject[], removed: IRemovedTodoComment, otherRemovedTodos: readonly IRemovedTodoComment[]):
        { ownerIndex: number; fieldIndex: number; lineIndex: number } | { refusal: RecipeWriterRefusalReason; message: string } {

        const ownerLabel = this.describeObject(removed.objectApiName, removed.objectNickname);
        const ownerIndexes = scannedObjects
            .map((scannedObject, scannedIndex) => ({ scannedObject, scannedIndex }))
            .filter(({ scannedObject }) => scannedObject.objectApiName === removed.objectApiName);
        const matchingOwners = removed.objectNickname !== undefined
            ? ownerIndexes.filter(({ scannedObject }) => scannedObject.nicknames.length === 1 && scannedObject.nicknames[0] === removed.objectNickname)
            : ownerIndexes;

        if ( matchingOwners.length !== 1 ) {
            return { refusal: 'todo-owner-not-found', message: `The recipe no longer writes ${ownerLabel} once, so there is no one place to put the TODO back.` };
        }

        const { scannedObject: owner, scannedIndex: ownerIndex } = matchingOwners[0];
        let fieldIndex = -1;
        let span: ILineSpan = { startIndex: owner.headerIndex, endIndex: this.findLastLineIndexOfObject(lines, owner) + 1 };

        if ( removed.fieldApiName !== undefined ) {
            const fieldIndexes = owner.fields
                .map((scannedField, candidateIndex) => ({ scannedField, candidateIndex }))
                .filter(({ scannedField }) => scannedField.fieldApiName === removed.fieldApiName);
            if ( fieldIndexes.length !== 1 ) {
                return { refusal: 'todo-owner-not-found', message: `${ownerLabel} no longer writes ${removed.fieldApiName} once, so there is no one place to put the TODO back.` };
            }
            fieldIndex = fieldIndexes[0].candidateIndex;
            span = fieldIndexes[0].scannedField;
        }

        const oldLineIndex = removed.lineNumber - 1;
        const findInSpan = (wantedLine: string, preferredIndex: number): number | undefined => {
            if ( preferredIndex >= span.startIndex && preferredIndex < span.endIndex && lines[preferredIndex] === wantedLine ) {
                return preferredIndex;
            }
            const matches: number[] = [];
            for ( let lineIndex = span.startIndex; lineIndex < span.endIndex && matches.length < 2; lineIndex++ ) {
                if ( lines[lineIndex] === wantedLine ) {
                    matches.push(lineIndex);
                }
            }
            return matches.length === 1 ? matches[0] : undefined;
        };

        if ( removed.kind === 'trailing' ) {
            const cutLineIndex = findInSpan(removed.cutLine, oldLineIndex);
            if ( cutLineIndex !== undefined ) {
                return { ownerIndex: ownerIndex, fieldIndex: fieldIndex, lineIndex: cutLineIndex };
            }
            return findInSpan(removed.originalLine, oldLineIndex) !== undefined
                ? { refusal: 'todo-already-back', message: 'The TODO is already back in the recipe.' }
                : { refusal: 'todo-place-not-found', message: `The line the TODO was cut from is no longer in ${ownerLabel}${removed.fieldApiName !== undefined ? `.${removed.fieldApiName}` : ''}.` };
        }

        const previousLineIndex = findInSpan(removed.previousLine, this.findTodoAnchorIndex(lines, Math.min(oldLineIndex, lines.length) - 1));
        if ( previousLineIndex === undefined ) {
            return { refusal: 'todo-place-not-found', message: `The line the TODO stood under is no longer in ${ownerLabel}${removed.fieldApiName !== undefined ? `.${removed.fieldApiName}` : ''}, or is there more than once.` };
        }

        // TODO LINES UNDER THE SAME LINE ARE PASSED UP TO ONE THAT WAS BELOW IT, SO SEVERAL COME BACK IN THEIR ORDER WHATEVER ORDER THEY ARE RESTORED IN
        /*
            Back only when the TODO lines under the anchor hold MORE copies of the line than stood
            beside it when it was removed: two identical TODOs side by side are both real, and the
            copy left behind is not the removed one come back.
        */
        const countCopies = (candidateLines: readonly string[]) => candidateLines.filter(candidateLine => candidateLine === removed.originalLine).length;
        const runLines: string[] = [];
        for ( let runIndex = previousLineIndex + 1; runIndex < span.endIndex && this.isWholeTodoCommentLine(lines[runIndex]); runIndex++ ) {
            runLines.push(lines[runIndex]);
        }
        if ( countCopies(runLines) > countCopies(removed.previousTodoLines ?? []) + countCopies(removed.nextTodoLines ?? []) ) {
            return { refusal: 'todo-already-back', message: 'The TODO is already back in the recipe.' };
        }

        const isAfterRemovedTodo = this.buildRemovedTodoOrder(removed, otherRemovedTodos);
        let lineIndex = previousLineIndex + 1;
        while ( lineIndex < span.endIndex && this.isWholeTodoCommentLine(lines[lineIndex]) && !isAfterRemovedTodo(lines[lineIndex]) ) {
            lineIndex++;
        }

        return { ownerIndex: ownerIndex, fieldIndex: fieldIndex, lineIndex: lineIndex };

    }

    /*
        Whether a TODO line standing under the same line was BELOW the removed one: it was in the
        removed one's nextTodoLines, or it is another removed TODO of the same place that had the
        removed one in its previousTodoLines. Anything else -- one that was above it, or a TODO the
        two records do not know -- is passed.
    */
    private static buildRemovedTodoOrder(removed: IRemovedTodoComment, otherRemovedTodos: readonly IRemovedTodoComment[]): (todoLine: string) => boolean {

        const linesBelow = new Set(removed.nextTodoLines ?? []);
        const linesAbove = new Set(removed.previousTodoLines ?? []);

        otherRemovedTodos
            .filter(otherRemoved => otherRemoved !== removed && otherRemoved.kind === 'line'
                    && otherRemoved.objectApiName === removed.objectApiName && otherRemoved.objectNickname === removed.objectNickname
                    && otherRemoved.fieldApiName === removed.fieldApiName && otherRemoved.previousLine === removed.previousLine)
            .forEach(otherRemoved => {
                if ( ( otherRemoved.previousTodoLines ?? [] ).includes(removed.originalLine) ) {
                    linesBelow.add(otherRemoved.originalLine);
                }
                if ( ( otherRemoved.nextTodoLines ?? [] ).includes(removed.originalLine) ) {
                    linesAbove.add(otherRemoved.originalLine);
                }
            });

        return todoLine => linesBelow.has(todoLine) && !linesAbove.has(todoLine);

    }

    // THE NEAREST LINE AT OR ABOVE lineIndex THAT IS NOT A WHOLE TODO LINE -- A FIELD'S OWN LINE, OR THE OBJECT'S HEADER, AT THE LATEST
    private static findTodoAnchorIndex(lines: string[], lineIndex: number): number {
        let anchorIndex = lineIndex;
        while ( anchorIndex > 0 && this.isWholeTodoCommentLine(lines[anchorIndex]) ) {
            anchorIndex--;
        }
        return anchorIndex;
    }

    /*
        Whether a field's value ends on its own line, so the lines under it are comments or a plain
        scalar's continuation rather than the inside of a block (| or >) or quoted value -- where YAML
        reads "#" as text and a "TODO" line is part of the value (#391).
    */
    static isFieldValueClosedOnFirstLine(lines: string[], scannedObject: IScannedObject, scannedField: IScannedField): boolean {

        const { fieldIndent } = this.getObjectLayout(scannedObject.objectIndent);
        const firstLineValue = lines[scannedField.startIndex].slice(fieldIndent.length + scannedField.fieldApiName.length + 1).trimStart();

        if ( /^[|>]/.test(firstLineValue) ) {
            return false;
        }

        const quoteCharacter = firstLineValue[0];
        if ( quoteCharacter !== '"' && quoteCharacter !== "'" ) {
            return true;
        }

        for ( let characterIndex = 1; characterIndex < firstLineValue.length; characterIndex++ ) {
            const character = firstLineValue[characterIndex];
            if ( quoteCharacter === '"' && character === '\\' ) {
                characterIndex++;
            } else if ( character === quoteCharacter && quoteCharacter === "'" && firstLineValue[characterIndex + 1] === "'" ) {
                characterIndex++;
            } else if ( character === quoteCharacter ) {
                return true;
            }
        }

        return false;

    }

    private static isWholeTodoCommentLine(recipeLine: string): boolean {
        return this.readTodoCommentText(recipeLine) !== undefined && recipeLine.slice(0, this.findCommentStartIndex(recipeLine)).trim() === '';
    }

    /*
        The shape of every occurrence as the reader reads it -- its object, depth, nicknames, blocks,
        properties, markers, TODO count and each field's name and line count -- with one TODO more or
        fewer (todoDelta) on the owner at ownerIndex and, when fieldIndex is set, one line more or fewer
        on that field. Two texts with equal descriptions differ only in the TODO line.
    */
    private static describeTodoStructure(scannedObjects: IScannedObject[], ownerIndex: number, fieldIndex: number, todoDelta: number): string {

        return scannedObjects.map((scannedObject, scannedIndex) => {
            const isOwner = scannedIndex === ownerIndex;
            return JSON.stringify([
                scannedObject.objectApiName,
                scannedObject.objectIndent,
                scannedObject.nicknames,
                scannedObject.fieldsLineIndexes.length,
                scannedObject.friendsLineIndexes.length,
                scannedObject.propertyLineIndexes.nickname.length,
                scannedObject.propertyLineIndexes.count.length,
                scannedObject.commentedOutFieldMarkers.map(marker => [marker.fieldApiName, marker.endIndex - marker.startIndex]),
                scannedObject.todoLineIndexes.length + ( isOwner ? todoDelta : 0 ),
                scannedObject.fields.map((scannedField, candidateIndex) => [
                    scannedField.fieldApiName,
                    scannedField.endIndex - scannedField.startIndex + ( isOwner && candidateIndex === fieldIndex ? todoDelta : 0 )
                ])
            ]);
        }).join('\n');

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
                    friendsLineIndexes: [],
                    fields: [],
                    lastFieldsBlockLineIndex: -1,
                    propertyLineIndexes: { nickname: [], count: [] },
                    commentedOutFieldMarkers: [],
                    todoLineIndexes: []
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
            if ( this.readTodoCommentText(recipeLine) !== undefined ) {
                scannedObject.todoLineIndexes.push(lineIndex);
            }
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

            if ( openObject.isInFriendsBlock ) {
                scannedObject.friendsLineIndexes.push(lineIndex);
                return;
            }

            const propertyMatch = layout.propertyLinePattern.exec(recipeLine);
            if ( propertyMatch ) {
                scannedObject.propertyLineIndexes[propertyMatch[1] as RecipeObjectProperty].push(lineIndex);
                if ( propertyMatch[1] === 'nickname' ) {
                    // A YAML COMMENT AFTER THE VALUE IS NOT PART OF THE NICKNAME, OR THE OCCURRENCE COULD NOT BE ADDRESSED BY IT
                    scannedObject.nicknames.push(recipeLine.slice(propertyMatch[0].length).replace(/\s#.*$/, '').trim());
                }
            }

        });

        // A COMMENTED-OUT FIELD IS ONE TODO, ITS MARKER: THE FIELD'S OWN LINES UNDER IT ARE ITS CONTENT, A LOOKUP'S TODO VALUE INCLUDED (#354)
        scannedObjects
            .filter(scannedObject => scannedObject.commentedOutFieldMarkers.length > 0 && scannedObject.todoLineIndexes.length > 0)
            .forEach(scannedObject => {
                scannedObject.todoLineIndexes = scannedObject.todoLineIndexes.filter(todoLineIndex => !scannedObject.commentedOutFieldMarkers.some(marker => (
                    todoLineIndex > marker.startIndex && todoLineIndex < marker.endIndex
                )));
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
        { recipeLines: IRecipeLines; scannedObject: IScannedObject; allScannedObjects: IScannedObject[] } | { isApplied: false; refusal: IRecipeWriterRefusal } {

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
        const allScannedObjects = this.scanRecipeObjects(recipeLines.lines);
        const scannedObjects = allScannedObjects
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

        return { recipeLines: recipeLines, scannedObject: scannedObjects[0], allScannedObjects: allScannedObjects };

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
        editIdentity: Omit<IRecipeWriterEdit, 'startLineNumber' | 'removedLines' | 'insertedLines'>
    ): Extract<RecipeWriterResult, { isApplied: true }> {

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
