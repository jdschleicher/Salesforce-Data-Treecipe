/*
    What the Recipe Cockpit's hub, hosts and tests share as types (#671): the run and tree view
    model, every message between the host and the panel, a panel action and the panel state. Types
    only, each import type-only, so a file that imports it loads nothing.
*/

import type { CockpitButtonKind } from '../CockpitKit/CockpitButtonKinds';
import type { CockpitPaletteToken } from '../CockpitKit/CockpitPalette';
import type {
    CreateParentRefusalReason,
    IRemovedTodoComment,
    RecipeFixedValueKind,
    RecipeTodoRemoveLock
} from '../RecipeWriter/RecipeCockpitRecipeWriter';
import type { IAuthenticatedOrgDetail } from '../SalesforceCli/SalesforceCli';
import type {
    IOrgTypeDetail,
    IScratchOrgDetail
} from '../SalesforceOrgService/SalesforceOrgService';
import type {
    IRecipeCockpitAdapterChildBlockMessage,
    IRecipeCockpitAdapterChildPreviewMessage,
    IRecipeCockpitAdapterMetadataChangesMessage,
    IRecipeCockpitAdapterOrgOnlyField,
    IRecipeCockpitUpdaterLoadStateMessage,
    IRecipeCockpitUpdaterNewRecordsMessage,
    IRecipeCockpitUpdaterNewRecordsPageMessage,
    IRecipeCockpitUpdaterParentChangeMessage,
    IRecipeCockpitUpdaterRecordsMessage,
    IRecipeCockpitUpdaterRecordsPageMessage,
    IRecipeCockpitUpdaterSnapshotsMessage,
    RecipeCockpitAdapterPanelAction
} from './RecipeCockpitAdapterHost';
import type {
    IRecipeCockpitConfirmContent,
    IRecipeCockpitConfirmOrg,
    IRecipeCockpitConfirmSection
} from './RecipeCockpitConfirmContent';
import type {
    IRecipeCockpitCustomTreecipePreviewMessage,
    RecipeCockpitCustomTreecipePanelAction
} from './RecipeCockpitCustomTreecipeHost';
import type {
    IRecipeCockpitDatasetAddedMessage,
    IRecipeCockpitDatasetJourneyMessage,
    IRecipeCockpitDatasetLastInsertMessage,
    IRecipeCockpitDatasetPreferencesMessage,
    IRecipeCockpitDatasetRecordCountsMessage,
    RecipeCockpitDatasetsPanelAction
} from './RecipeCockpitDatasetsHost';
import type {
    IObjectRefreshComparisonRequest,
    IObjectRefreshItem,
    IObjectRefreshPlannedItem,
    ObjectRefreshKind
} from './RecipeCockpitObjectRefresh';
import type {
    IObjectSelectionDisabledLookup,
    IObjectSelectionExclusion
} from './RecipeCockpitObjectSelection';
import type { IRecipeCockpitPanelPlace } from './RecipeCockpitPanelPlace';
import type {
    IRecipeCockpitTreeQueriesMessage,
    IRecipeCockpitTreeQueryResultMessage,
    IRecipeCockpitTreeQueryStateMessage,
    RecipeCockpitQueryPanelAction
} from './RecipeCockpitQueryHost';
import type { IRecipeCockpitCreateReadinessViewModel } from './RecipeCockpitRecordCreation';
import type { IRecipeCockpitOpenableRecordPreview } from './RecipeCockpitRecordLinks';
import type { RecipeCockpitRecordLinksPanelAction } from './RecipeCockpitRecordLinksHost';
import type {
    IRecordTypeSetModeOffer,
    RecordTypeSetMode
} from './RecipeCockpitRecordTypeRecipe';
import type { RecipeCockpitRecordTypeImpactKind } from './RecipeCockpitRecordTypesConstants';
import type { RecipeCockpitTreeTab } from './RecipeCockpitShellConstants';
import type {
    IRecipeCockpitTreeHistoryTargets,
    IRecipeCockpitTreeHistoryViewModel
} from './RecipeCockpitTreeHistory';
import type { RecipeCockpitTreecipePanelAction } from './RecipeCockpitTreecipeHost';
import type { RecipeCockpitTreecipeOrgPanelAction } from './RecipeCockpitTreecipeOrgHost';
import type {
    RecipeCockpitTodoRemoveLock,
    RecipeCockpitTodosView,
    RecipeCockpitTroubleshootingSubTab
} from './RecipeCockpitTroubleshootingConstants';
import type {
    IRecipeCockpitMetadataDeployStateMessage,
    IRecipeCockpitMetadataRetrieveStateMessage,
    IRecipeCockpitPermissionSetAssignStateMessage,
    IRecipeCockpitTreeValidationRulesMessage,
    IRecipeCockpitTroubleshootingHistoryMessage,
    IRecipeCockpitTroubleshootingSummaryMessage,
    RecipeCockpitTroubleshootingPanelAction
} from './RecipeCockpitTroubleshootingHost';
import type { RecipeCockpitDatasetInsertStatus } from './RecipeCockpitDatasetsTabConstants';
import type { RecipeCockpitCreateParentRefusalReason } from './RecipeCockpitTreecipeFieldEditorConstants';
import type { InsertAttemptStatus } from '../DatasetInsertAttemptService/DatasetInsertAttemptService';

// THE PANEL'S INSERT STATUS UNION IS SPELLED OUT (#642); A STATUS ADDED TO DatasetInsertAttemptService WITHOUT IT FAILS HERE
type DatasetInsertStatusesMatch<Expected extends InsertAttemptStatus & RecipeCockpitDatasetInsertStatus> = Expected;
export type RecipeCockpitDatasetInsertStatusMatchesAttempts = DatasetInsertStatusesMatch<InsertAttemptStatus | RecipeCockpitDatasetInsertStatus>;

// THE PANEL'S CREATE-PARENT REFUSAL UNION IS SPELLED OUT (#653); A WRITER CODE ADDED OR RENAMED WITHOUT IT FAILS HERE
type CreateParentRefusalReasonsMatch<Expected extends CreateParentRefusalReason & RecipeCockpitCreateParentRefusalReason> = Expected;
export type RecipeCockpitCreateParentRefusalReasonMatchesWriter = CreateParentRefusalReasonsMatch<CreateParentRefusalReason | RecipeCockpitCreateParentRefusalReason>;

// THE PANEL'S LOCK UNION IS SPELLED OUT (#639); A WRITER LOCK ADDED OR RENAMED WITHOUT IT FAILS HERE
type WriterTodoRemoveLock = RecipeTodoRemoveLock | 'indistinct-occurrence';
type TodoRemoveLocksMatch<Expected extends WriterTodoRemoveLock & RecipeCockpitTodoRemoveLock> = Expected;
export type RecipeCockpitTodoRemoveLockMatchesWriter = TodoRemoveLocksMatch<WriterTodoRemoveLock | RecipeCockpitTodoRemoveLock>;

// THE PALETTE AND BUTTON KINDS ARE THE COCKPIT KIT'S (#524), SHARED WITH EVERY COCKPIT; THESE NAMES STAY FOR WHAT ALREADY READS THEM
export type RecipeCockpitPaletteToken = CockpitPaletteToken;

export type RecipeCockpitButtonKind = CockpitButtonKind;

// ONE GENERATE TREECIPE RUN ON DISK: ITS FOLDER, WHEN IT RAN, AND THE OBJECTS WRAPPER IT WROTE
export interface IRecipeCockpitRun {
    runFolderName: string;
    runFolderPath: string;
    generatedAtTimestamp: string;
    objectsWrapperFilePath: string;
    // THE run's "custom-" TREE FOLDERS (#677), EACH ITS OWN ENTRY IN THE RUN PICKER; SET ONLY WHEN THE RUN HAS ONE
    customTreeFolderNames?: string[];
}

/*
    One entry of the run picker: a run, or one custom tree of a run (#677). A custom entry keeps
    its run's runFolderName, so every path built from the run on screen stays the run's own.
*/
export interface IRecipeCockpitRunViewModel {
    runFolderName: string;
    label: string;
    customTreeFolderName?: string;
}

/*
    One field row. Every text value is a string rather than optional, so the panel never has to
    tell "absent" from "empty" for something it only displays.

    isOnlyInRecipeFile marks a field the recipe file carries and the objects wrapper does not. The
    standard-field mappings and the record type line are written straight into the recipe and never
    become a FieldInfo, so a view built from the wrapper alone would answer "Account has no Name"
    to a reader who can see Name in the file.
*/
/*
    fieldTypeWithSize is what the Structure tab draws ("Text(50)", "Number(16,2)"); fieldType stays
    the bare type.

    isPicklist is set ONLY on a picklist or multi-select picklist row, and is all the model says
    about its values: the values are posted when the reader expands the row (loadPicklistValues).
    Posting them with the model measured 96.17 MB at 120,000 fields with 50 values per picklist,
    past the 60 MB the issue set as the line for loading them on expand instead.
*/
export interface IRecipeCockpitFieldViewModel {
    fieldApiName: string;
    fieldLabel: string;
    fieldType: string;
    fieldTypeWithSize: string;
    recipeValue: string;
    controllingField: string;
    isOnlyInRecipeFile: boolean;
    lineNumber?: number;
    isPicklist?: boolean;
    // SET ONLY ON A FIELD A VALIDATION RULE NAMES (#324, #325), SO A WRAPPER WITHOUT RULES POSTS AS IT ALWAYS DID
    validationRules?: IRecipeCockpitFieldValidationRulesViewModel;
    // SET ONLY ON A FIELD WHOSE RECIPE LINES CARRY A TODO COMMENT (#354), SO A RECIPE WITHOUT ONE POSTS AS IT ALWAYS DID
    todos?: IRecipeCockpitTodoViewModel[];
    // SET ONLY ON A FORMULA FIELD (#685): ITS FORMULA, WHICH ITS READ-ONLY ROW SHOWS
    formula?: string;
}

/*
    One TODO comment of a recipe file (#354): its line and its text from the first "#". The text
    comes from a file the reader can edit, so the panel only ever writes it as text. On a FIELD the
    text is left out when the field's posted recipeValue already holds it -- the row draws that
    value, and every generated lookup and record type variant would otherwise post its TODO twice.
*/
export interface IRecipeCockpitTodoViewModel {
    lineNumber: number;
    text?: string;
    // SET ONLY ON A TODO THE PANEL'S "Remove TODO" CANNOT TAKE OUT (#391), AND WHY
    removeLock?: RecipeCockpitTodoRemoveLock;
    // WHERE A FIELD TODO WITH NO text SITS IN THE FIELD'S POSTED recipeValue (#365), SO A LIST AWAY FROM THE VALUE SHOWS IT EXACTLY
    valueStart?: number;
    valueLength?: number;
}

/*
    One TODO the reader removed from a card's recipe (#391), as the Removed sub-tab lists it.
    removalKey names it in the host's list for this model only; its owner and text come from the
    removed-TODOs file beside the recipe and are only ever written as text.
*/
export interface IRecipeCockpitRemovedTodoViewModel {
    removalKey: string;
    objectApiName: string;
    objectNickname?: string;
    fieldApiName?: string;
    lineNumber: number;
    text: string;
}

/*
    What #324 recorded about a field's validation rules (#325). appliedRuleNames is non-empty only
    when the wrapper also holds both values the box switches between: recipeValue, what the rules
    wrote, and unconstrainedRecipeValue, what the field generated before them, each as the wrapper
    records it (written as for a top-level object). unconstrainedExpression is the latter as the row
    draws it. Rule names and reasons come from workspace files and are only ever written as text.
*/
export interface IRecipeCockpitFieldValidationRulesViewModel {
    appliedRuleNames: string[];
    notAppliedRules: IRecipeCockpitValidationRuleNotAppliedViewModel[];
    recipeValue?: string;
    unconstrainedRecipeValue?: string;
    unconstrainedExpression?: string;
    // THE RULES, APPLIED OR NOT, WHOSE FILE THE PROJECT HOLDS (#560): SET ONLY WHEN ONE IS, SO A ROW DRAWS A LINK TO EACH
    sourceRuleNames?: string[];
}

export interface IRecipeCockpitValidationRuleNotAppliedViewModel {
    ruleName: string;
    reason: string;
}

// A FIELD OF A CARD, BY NAME
export interface IRecipeCockpitFieldReferenceViewModel {
    objectApiName: string;
    nickname?: string;
    fieldApiName: string;
}

/*
    One occurrence of a card's object as its own settings see it (#467): the first, or one of its
    iterations the card lists, with that occurrence's own field lines, values and count. nickname
    is set for every occurrence of an object with iterations, and never for an object written once,
    whose settings stay keyed by the object alone -- so a card with no iteration posts and stores
    exactly what it did.
*/
export interface IRecipeCockpitTreeOccurrence {
    objectApiName: string;
    nickname?: string;
    objectViewModel: IRecipeCockpitObjectViewModel;
}

export interface IRecipeCockpitRecordTypePicklistValuesViewModel {
    recordTypeDeveloperName: string;
    picklistValues: string[];
}

// WHAT ONE PICKLIST ROW SHOWS WHEN EXPANDED: ITS ACTIVE VALUES, THEN ONE GROUP PER RECORD TYPE THAT ASSIGNS IT VALUES
export interface IRecipeCockpitPicklistDisplayValues {
    picklistValues: string[];
    recordTypePicklistValues: IRecipeCockpitRecordTypePicklistValuesViewModel[];
}

export type RecipeCockpitPicklistDisplayValuesByObjectApiName = Map<string, Map<string, IRecipeCockpitPicklistDisplayValues>>;

/*
    recipeFilePath is the one path the panel is handed, and it is carried once per OBJECT rather
    than per field: a field only needs its line number to be opened, and a path repeated on every
    row would grow the payload with the field count for no information.
*/
export interface IRecipeCockpitObjectViewModel {
    objectApiName: string;
    recipeFilePath: string;
    lineNumber?: number;
    fields: IRecipeCockpitFieldViewModel[];
    // SET ONLY ON AN OBJECT WITH iterations, WHERE THE NICKNAME IS WHAT TELLS ITS OCCURRENCES APART
    nickname?: string;
    /*
        The first occurrence's one nickname on an object WITHOUT iterations (#380), which the row
        draws and the card's nickname index reads. Never "nickname": the panel posts that back, and
        the host matches it against nickname-keyed allow-lists an object without iterations is not in.
    */
    recipeNickname?: string;
    iterations?: IRecipeCockpitObjectIterationViewModel[];
    // WRITTEN MORE THAN ONCE WITH NO NICKNAME TO TELL THE OCCURRENCES APART, SO ITS TREE ICON IS REFUSED (#219)
    hasIndistinctOccurrences?: true;
    // HOST-ONLY, NEVER POSTED: AN ITERATION BUILT AS ITS OWN OBJECT BY buildIterationObjectViewModel (#467)
    isIterationOccurrence?: true;
    // A FIELD OTHER THAN RecordTypeId CARRIES A RECORD-TYPE SECTION, SO RecordTypeId STAYS TICKED (#220)
    hasRecordTypeSections?: true;
    /*
        The first occurrence's own "count:" (#255), set only when it has exactly one that is a plain
        whole number -- which is the line a count the reader sets replaces. countParentObjectApiName
        is the object whose friends: block holds it, so its count is records PER that parent record.
    */
    recordCount?: number;
    countParentObjectApiName?: string;
    // THE ONE NICKNAME OF THE OCCURRENCE WHOSE friends: BLOCK HOLDS THE FIRST OCCURRENCE, WHICH ITS FRIEND CHIP NAMES (#411)
    parentNickname?: string;
    /*
        Set only on an object with two or more record types under a valid developer name (#195):
        what the Record types section offers. generatedRecordTypeDeveloperNames is what the run's recipe
        writes, in block order, and isRecordTypeSelectionApplied says it was written from a choice
        rather than as the default -- the next generate sends that choice again unless it is changed (#623).
    */
    recordTypes?: IRecipeCockpitRecordTypeViewModel[];
    generatedRecordTypeDeveloperNames?: string[];
    isRecordTypeSelectionApplied?: true;
    // THE TODO COMMENTS OF THE OBJECT'S BLOCK THAT SIT ON NO FIELD (#354): A VALIDATION RULE NOT APPLIED, A COMMENTED-OUT FIELD...
    todos?: IRecipeCockpitTodoViewModel[];
}

// A FIELD A RECORD TYPE RESTRICTS: COUNTS ONLY, SO THE MODEL DOES NOT GROW BY EVERY RECORD TYPE'S VALUES
export interface IRecipeCockpitRecordTypeImpactViewModel {
    fieldApiName: string;
    kind: RecipeCockpitRecordTypeImpactKind;
    valueCount: number;
}

export interface IRecipeCockpitRecordTypeViewModel {
    developerName: string;
    isActive: boolean;
    impacts: IRecipeCockpitRecordTypeImpactViewModel[];
}

// ONE FIELD OF A LATER OCCURRENCE: ONLY ITS LINE AND VALUE -- ITS TYPE AND LABEL ARE THE OBJECT'S OWN FIELD'S
export interface IRecipeCockpitObjectIterationFieldViewModel {
    fieldApiName: string;
    lineNumber: number;
    recipeValue: string;
    todos?: IRecipeCockpitTodoViewModel[];
}

/*
    A later occurrence of an object in its recipe file, such as the nested child iteration a
    self-lookup adds (#188). It is told apart by its NICKNAME, never its api name, so its header and
    every field link open the occurrence the reader chose. parentObjectApiName and parentNickname
    name the object whose friends: block holds it.
*/
/*
    insertableFriendObjectApiNames is set only on a SELF-LOOKUP iteration -- nested under another
    occurrence of its own object -- with at least one friend to offer: the friends the occurrence
    above it carries that it does not, which is what its "+" lists (#197). It is the writer's own
    answer (RecipeCockpitRecipeWriter.listInsertableFriendObjectApiNames), so the panel never offers
    a friend the writer would refuse for a reason the file already shows.
*/
export interface IRecipeCockpitObjectIterationViewModel {
    nickname: string;
    lineNumber: number;
    // THE OCCURRENCE'S OWN ONE PLAIN WHOLE-NUMBER "count:" (#467), WHICH ITS COUNT BOX SETS
    recordCount?: number;
    parentObjectApiName?: string;
    parentNickname?: string;
    fields: IRecipeCockpitObjectIterationFieldViewModel[];
    insertableFriendObjectApiNames?: string[];
    todos?: IRecipeCockpitTodoViewModel[];
}

// ONE LOOKUP TYING AN OBJECT TO A PARENT IN ITS OWN TREE; A SELF-LOOKUP NAMES ITS OWN OBJECT AS THE PARENT
export interface IRecipeCockpitParentLookupViewModel {
    fieldApiName: string;
    parentObjectApiName: string;
}

/*
    A lookup the card's recipe still writes as "### TODO -- REFERENCE ID REQUIRED", and the nicknames
    it can be wired to (#151): RecipeCockpitRecipeWriter.listLookupWirings's own answer, so the panel
    never offers a nickname the writer would refuse. objectNickname is set only on an object written
    more than once, and is the nickname of the occurrence the row draws.
*/
export interface IRecipeCockpitLookupWiringViewModel {
    objectApiName: string;
    objectNickname?: string;
    fieldApiName: string;
    candidateNicknames: string[];
}

// A TODO LOOKUP WHOSE ONE PARENT THE RECIPE DOES NOT WRITE AND A TEMPLATE CAN ADD (#294)
export interface IRecipeCockpitAddableParentViewModel {
    objectApiName: string;
    objectNickname?: string;
    fieldApiName: string;
    parentObjectApiName: string;
}

// ONE "Add <Parent> to recipe" THE CONFIRMED-DRAWN MODEL OFFERS, WITH THE HOST-ONLY RECIPE FILE IT WRITES
export interface IRecipeCockpitAddableParentTarget {
    recipeFilePath: string;
    addition: IRecipeCockpitAddableParentViewModel;
}

/*
    A TODO lookup to one parent, as its row draws "Create <Parent> in recipe" and "Use existing
    <Parent> from org…" (#421): RecipeCockpitRecipeWriter.listEmptyLookups's own answer. Each refusal
    is why that button is disabled; Create is enabled exactly when addableParents lists the lookup.
*/
export interface IRecipeCockpitEmptyLookupViewModel {
    objectApiName: string;
    objectNickname?: string;
    fieldApiName: string;
    parentObjectApiName: string;
    createRefusalReason?: CreateParentRefusalReason;
    orgRecordRefusal?: string;
}

// ONE "Use existing <Parent> from org…" THE CONFIRMED-DRAWN MODEL OFFERS, WITH THE HOST-ONLY RECIPE FILE IT WRITES
export interface IRecipeCockpitOrgRecordLookupTarget {
    recipeFilePath: string;
    emptyLookup: IRecipeCockpitEmptyLookupViewModel;
}

/*
    A lookup whose recipe value is an Id "Use existing <Parent> from org…" wrote (#421), read from the
    card's fixed-values file at load. orgLabel is the org's alias, else its username: the row's badge
    says the Id exists only there.
*/
export interface IRecipeCockpitOrgRecordLookupViewModel {
    objectApiName: string;
    fieldApiName: string;
    recordId: string;
    parentObjectApiName: string;
    orgLabel: string;
}

// A LOOKUP'S Id THE TREE INSERT ASKS ITS ORG ABOUT: AN ORG RECORD'S (#421) OR ONE TYPED WITH THE PENCIL (#627)
export interface ICheckedRecordIdLookup {
    objectApiName: string;
    fieldApiName: string;
    recordId: string;
    parentObjectApiName: string;
}

// A RECORD Id TYPED INTO A LOOKUP'S PENCIL (#627), WITH ITS PARENT AS THE ORG INSERTED INTO DESCRIBES THE FIELD: NONE FOR A POLYMORPHIC LOOKUP
export interface IRecipeCockpitTypedLookupId {
    objectApiName: string;
    fieldApiName: string;
    recordId: string;
    parentObjectApiName?: string;
}

// ONE "Wire to…" THE CONFIRMED-DRAWN MODEL OFFERS, WITH THE HOST-ONLY RECIPE FILE IT WRITES
export interface IRecipeCockpitLookupWiringTarget {
    recipeFilePath: string;
    wiring: IRecipeCockpitLookupWiringViewModel;
}

/*
    An object as a tree lists it. Its fields are not repeated here: the panel finds them by name in
    the recipe's objects, so every card that lists an object draws the one posted field model.
*/
export interface IRecipeCockpitTreeObjectViewModel {
    objectApiName: string;
    parentLookups: IRecipeCockpitParentLookupViewModel[];
    // SET ON THE ENTRY FOR ONE OF THE OBJECT'S iterations, WHICH THE PANEL FINDS BY THIS NICKNAME
    iterationNickname?: string;
    // HOW MANY friends: LEVELS UNDER THE OCCURRENCE IT IS LISTED BENEATH (#467); SET ONLY ON AN ITERATION DRAWN INDENTED
    nestingDepth?: number;
}

/*
    One relationship tree card. treeKey is the FOLDER the tree's recipe was written to, not its
    position: a position renumbers when another tree is added, and a key that moved would expand,
    scope or search a different card than the reader chose.
*/
/*
    history is set only on a card whose folder is in the run on screen -- the one identity a tree
    keeps across runs. The ungrouped card, and a recipe file with no tree folder, have none, and
    the panel draws no Previously Used Data Sets tab for them.
*/
/*
    runFakerRecipeFileName is set only on a card that can generate: the recipe FILE NAME, for the
    button's tooltip. The path stays on the host; the panel posts the treeKey.
*/
export interface IRecipeCockpitTreeViewModel {
    treeKey: string;
    title: string;
    folderName: string;
    // A CUSTOM TREE'S SOURCE TREE FOLDER (#677), WHICH ITS CARD NAMES; SET ONLY ON A CUSTOM TREE
    customCopyOf?: string;
    objects: IRecipeCockpitTreeObjectViewModel[];
    fieldCount: number;
    history?: IRecipeCockpitTreeHistoryViewModel;
    runFakerRecipeFileName?: string;
    // THE READER'S OWN NAME AND FAVORITE (#235), SET ONLY WHEN THEY HAVE ONE; title STAYS THE DEFAULT THE NAME REPLACES
    customName?: string;
    isFavorite?: boolean;
    // SET ONLY WHEN SOMETHING IN THE CARD IS EXCLUDED (#219), SO A CARD WITH EVERYTHING INCLUDED POSTS AS IT ALWAYS DID
    objectSelection?: IRecipeCockpitTreeObjectSelectionViewModel;
    // SET ONLY WHEN A FIELD OF THE CARD IS UNTICKED OR CANNOT BE (#220)
    fieldSelection?: IRecipeCockpitTreeFieldSelectionViewModel;
    // SET ONLY WHEN THE READER CHANGED A COUNT (#255), AND LISTING ONLY THE OBJECTS WHOSE COUNT DIFFERS FROM THE RECIPE'S
    objectCounts?: IRecipeCockpitObjectCountViewModel[];
    // SET ONLY WHEN A FIELD OF THE CARD HAS A FIXED VALUE (#262) A LOCK DOES NOT HOLD BACK
    fixedValues?: IRecipeCockpitFixedValueViewModel[];
    /*
        SET ONLY WHEN A RULE-SHAPED FIELD OF THE CARD GENERATES WITHOUT ITS RULES (#325): the reader
        unticked its box. A field a lock holds back (excluded, unticked, edited) is not listed.
    */
    validationRulesOff?: IRecipeCockpitFieldReferenceViewModel[];
    // SET ONLY ON A CARD THAT CAN GENERATE WHOSE RECIPE HAS A TODO LOOKUP WITH A PARENT INSERTED BEFORE IT (#151)
    lookupWirings?: IRecipeCockpitLookupWiringViewModel[];
    // SET ONLY ON A CARD THAT CAN GENERATE WHOSE RECIPE HAS A TODO LOOKUP TO A STANDARD PARENT IT DOES NOT WRITE (#294)
    addableParents?: IRecipeCockpitAddableParentViewModel[];
    // SET ONLY ON A CARD THAT CAN GENERATE WHOSE RECIPE HAS A TODO LOOKUP TO ONE PARENT (#421)
    emptyLookups?: IRecipeCockpitEmptyLookupViewModel[];
    // SET ONLY WHEN THE CARD'S FIXED-VALUES FILE HOLDS A LOOKUP SET TO AN EXISTING ORG RECORD (#421)
    orgRecordLookups?: IRecipeCockpitOrgRecordLookupViewModel[];
    // SET ONLY WHEN THE CARD'S REMOVED-TODOS FILE LISTS A TODO STILL OUT OF ITS RECIPE (#391)
    removedTodos?: IRecipeCockpitRemovedTodoViewModel[];
}

// THE VALUE THE READER TYPED FOR A FIELD (#262), OR THE "${{ ... }}" THEY EDITED (#356); kind IS THE HOST'S AND DECIDES HOW IT IS WRITTEN
export interface IRecipeCockpitFixedValueViewModel {
    objectApiName: string;
    // THE OCCURRENCE IT IS SET ON (#467): SET FOR EVERY ENTRY OF AN OBJECT WITH iterations, NEVER FOR ONE WITHOUT
    nickname?: string;
    fieldApiName: string;
    value: string;
    kind: RecipeFixedValueKind;
    // SET ONLY ON A LOOKUP'S Id WRITTEN BY "Use existing <Parent> from org…" (#421)
    orgRecord?: { orgLabel: string; parentObjectApiName: string };
}

export interface IRecipeCockpitObjectCountViewModel {
    objectApiName: string;
    nickname?: string;
    count: number;
}

// A FIELD WHOSE CHECKBOX THE HOST REFUSES, AND THE REASON THE ROW SHOWS
export interface IRecipeCockpitLockedFieldViewModel {
    fieldApiName: string;
    reason: string;
}

/*
    One object's fields as the host decided them (#220). excludedFieldApiNames is what generation
    leaves out: the reader's unticked fields, less any field a lock now holds ticked. A field a lock
    holds is drawn ticked and disabled, except a parent-excluded lookup, which is left out by the
    object cascade and drawn unticked and disabled.
*/
export interface IRecipeCockpitObjectFieldSelectionViewModel {
    objectApiName: string;
    nickname?: string;
    excludedFieldApiNames: string[];
    lockedFields: IRecipeCockpitLockedFieldViewModel[];
    isEveryFieldExcluded?: true;
}

// ONLY THE OBJECTS WITH SOMETHING TO SAY, SO THE PAYLOAD GROWS WITH THE SELECTION RATHER THAN THE RECIPE
export interface IRecipeCockpitTreeFieldSelectionViewModel {
    objects: IRecipeCockpitObjectFieldSelectionViewModel[];
}

// WHAT THE GENERATE BUTTON HANDS treecipe.runFakerByRecipe FOR A CARD THAT LEAVES SOMETHING OUT -- THE SHAPE ITS HANDLER TYPE-CHECKS
export interface IRecipeCockpitRunFakerFilteredRecipe {
    recipeText: string;
    excludedObjectApiNames: string[];
    excludedFieldApiNamesByObject?: Record<string, string[]>;
    objectCountsByObject?: Record<string, number>;
    fixedValuesByObject?: Record<string, Record<string, string>>;
    validationRulesOffByObject?: Record<string, string[]>;
    // SET WHEN THE COPY WAS BUILT AGAIN FOR THE RECORD TYPES TICKED AT THE CLICK (#623); EMPTY WHEN EVERY OBJECT IS BACK AT ITS DEFAULT
    recordTypeSelection?: Record<string, string[]>;
}

// WHAT workspaceState HOLDS FOR THE STRUCTURE TAB, BY TREE FOLDER NAME
export interface IRecipeCockpitTreeSelections {
    excludedObjectApiNamesByFolderName: Map<string, Set<string>>;
    excludedFieldApiNamesByFolderName: Map<string, Map<string, Set<string>>>;
    // THE RECORD COUNTS THE READER SET (#255), BY TREE FOLDER THEN OBJECT; A COUNT EQUAL TO THE RECIPE'S OWN IS NEVER STORED
    objectCountsByFolderName: Map<string, Map<string, number>>;
    // THE VALUES THE READER FIXED (#262), BY TREE FOLDER, OBJECT THEN FIELD
    fixedValuesByFolderName: Map<string, Map<string, Map<string, string>>>;
    // THE FIELDS WHOSE VALIDATION RULES THE READER UNTICKED (#325), BY TREE FOLDER THEN OBJECT; ONLY THE UNTICKS ARE KEPT
    validationRulesOffByFolderName: Map<string, Map<string, Set<string>>>;
}

/*
    The HOST's answer for one card (#219): what is left out of generation and why, and which lookups
    of an included object point at an excluded parent. The panel draws it and decides nothing. The
    counts are over the objects the card DRAWS (those with a recipe), which is what its header counts.
*/
export interface IRecipeCockpitTreeObjectSelectionViewModel {
    exclusions: IObjectSelectionExclusion[];
    disabledLookups: IObjectSelectionDisabledLookup[];
    includedObjectCount: number;
    objectCount: number;
}

// THE ONE CARD A CUSTOM TREE (#677) DRAWS AS
export interface IRecipeCockpitCustomTreeSource {
    folderName: string;
    objectApiNames: string[];
    customCopyOf: string;
}

// A CARD'S EXCLUSIONS OR UNTICKED FIELDS CHANGED: REDRAWN IN PLACE, TAGGED WITH THE MODEL IT IS ABOUT
export interface IRecipeCockpitObjectSelectionMessage {
    command: 'objectSelection';
    renderSequence: number;
    treeKey: string;
    objectSelection?: IRecipeCockpitTreeObjectSelectionViewModel;
    fieldSelection?: IRecipeCockpitTreeFieldSelectionViewModel;
    objectCounts?: IRecipeCockpitObjectCountViewModel[];
    fixedValues?: IRecipeCockpitFixedValueViewModel[];
    validationRulesOff?: IRecipeCockpitFieldReferenceViewModel[];
}

/*
    How a field's inline edit (#337) ended: saved (the card's objectSelection follows) or refused,
    with the reason the panel writes under the editor through textContent. Tagged with the model it
    is about, so an answer for a model no longer on screen is dropped.
*/
export interface IRecipeCockpitFieldEditResultMessage {
    command: 'fieldEditResult';
    renderSequence: number;
    treeKey: string;
    objectApiName: string;
    fieldApiName: string;
    edit: RecipeCockpitFieldEdit;
    refusal?: string;
}

// THE ONE-BOX EDITOR (#356) OR A PICKLIST'S VALUE TILES (#465): BOTH WRITE THROUGH THE SAME FIXED-VALUE PATH
export type RecipeCockpitFieldEdit = 'fixedValue' | 'picklistValues';

// WHAT workspaceState HOLDS FOR THE CARDS, BY TREE FOLDER NAME; BOTH KEYED BY NAMES FROM DISK, SO NEITHER IS A PLAIN {}
export interface IRecipeCockpitTreePreferences {
    customNamesByFolderName: Map<string, string>;
    favoriteFolderNames: Set<string>;
}

// A CARD'S NAME OR FAVORITE CHANGED: EVERY CARD OF THAT FOLDER, REDRAWN IN PLACE RATHER THAN BY A RELOAD
export interface IRecipeCockpitTreePreferencesMessage {
    command: 'treePreferences';
    renderSequence: number;
    trees: Array<{ treeKey: string; customName?: string; isFavorite: boolean }>;
}

/*
    How a card's or a data set row's inline rename (#551) ended. A saved name is redrawn by the
    treePreferences or datasetPreferences message posted before this one, so this closes the box;
    a refusal is written under the box with textContent and the box stays open. nameKey is the
    card's treeKey or the row's data set folder name. Tagged with the model the name was typed
    over and with the name as posted, so an answer to an earlier post never settles a later one.
*/
export interface IRecipeCockpitNameEditResultMessage {
    command: 'nameEditResult';
    renderSequence: number;
    nameTarget: 'tree' | 'dataset';
    nameKey: string;
    name: string;
    refusal?: string;
}

export interface IRecipeCockpitRecipeViewModel {
    runs: IRecipeCockpitRunViewModel[];
    selectedRunFolderName: string;
    // SET ONLY WHILE ONE CUSTOM TREE OF THE RUN IS ON SCREEN (#677)
    selectedCustomTreeFolderName?: string;
    objects: IRecipeCockpitObjectViewModel[];
    trees: IRecipeCockpitTreeViewModel[];
    notices: string[];
    emptyStateMessage: string;
}

/*
    What normalizeObjectsWrapper reads from the wrapper. picklistDisplayValuesByObjectApiName is
    kept off the field view model so the model posted to the panel does not grow by every picklist's
    values: the panel asks for one row's values when it is opened.
*/
export interface IRecipeCockpitNormalizedObjectsWrapper {
    objects: IRecipeCockpitObjectViewModel[];
    notices: string[];
    isObjectsWrapper: boolean;
    fieldlessObjectApiNames: Set<string>;
    picklistDisplayValuesByObjectApiName: RecipeCockpitPicklistDisplayValuesByObjectApiName;
    recipeTrees: IRecipeCockpitWrapperTree[];
    parentLookupsByObjectApiName: Map<string, IRecipeCockpitParentLookupViewModel[]>;
    // RelationshipService's LEVEL PER OBJECT, HOST-ONLY: WHAT A FILTERED COPY NESTS A KEPT FRIEND BY (#219)
    objectLevelsByApiName?: Map<string, number>;
}

// ONE RecipeFiles ENTRY, AS IT WAS WRITTEN: EVERY OBJECT IT LISTS, IN INSERT ORDER, LOOKUP TARGETS INCLUDED
export interface IRecipeCockpitWrapperTree {
    objectApiNames: string[];
}

export interface IRecipeSourceFieldEntry {
    lineNumber: number;
    valueText: string;
    todos?: IRecipeCockpitTodoViewModel[];
}

export interface IRecipeSourceObjectEntry {
    lineNumber: number;
    nickname?: string;
    recordCount?: number;
    countParentObjectApiName?: string;
    parentNickname?: string;
    fieldEntries: Map<string, IRecipeSourceFieldEntry>;
    iterations?: IRecipeSourceObjectIterationEntry[];
    // A LATER OCCURRENCE WAS LEFT TO THE FIRST: NO NICKNAME TELLS THEM APART, SO THE OBJECT CANNOT BE EXCLUDED (#219)
    hasIndistinctOccurrences?: true;
    hasRecordTypeSections?: true;
    todos?: IRecipeCockpitTodoViewModel[];
}

export interface IRecipeSourceObjectIterationEntry {
    nickname: string;
    lineNumber: number;
    recordCount?: number;
    parentObjectApiName?: string;
    parentNickname?: string;
    fieldEntries: Map<string, IRecipeSourceFieldEntry>;
    insertableFriendObjectApiNames?: string[];
    todos?: IRecipeCockpitTodoViewModel[];
}

export interface IRecipeSourceFile {
    filePath: string;
    objectEntries: Map<string, IRecipeSourceObjectEntry>;
}

/*
    Everything the cockpit webview can post back.

    One shape with every field optional, matching the explorer: nothing arriving here is trusted,
    and routePanelMessage checks the TYPE of every field it reads before matching it against an
    allow-list built from the model the host itself rendered. A posted path is never validated as a
    path and never resolved on the panel's say-so -- it opens only if the rendered model named it.
*/
export interface IRecipeCockpitPanelMessage {
    command?: string;
    // "Customize and create new recipe" (#677): WHAT THE MODAL REMOVED OR LEFT OUT OF A RUN, BY NAME, AND WHICH PREVIEW IT ASKS FOR
    removedObjectApiNames?: unknown;
    removedFields?: unknown;
    outOfRunObjectApiNames?: unknown;
    previewSequence?: unknown;
    // GET LATEST OBJECT DETAIL (#612): THE OPEN DIALOG'S ID, THE KINDS TICKED IN STEP 1 AND THE INDEXES OF THE ITEMS TICKED IN STEP 3
    refreshId?: unknown;
    kinds?: unknown;
    itemIndexes?: unknown;
    // A RULE'S FILE (#560): THE RULE A DRAWN ROW NAMES, AND THE VALIDATION RULES LIST AN ACK SAYS WAS DRAWN
    ruleName?: unknown;
    listSequence?: unknown;
    // THE QUERY TAB (#367): WHICH GENERATED QUERY, THE READER'S TEXT FOR IT, AND AN EXPORT'S FORMAT
    queryKey?: unknown;
    queryText?: unknown;
    exportFormat?: unknown;
    // THE TREECIPE UPDATER'S LOAD (#416): PER OBJECT, THE READER'S WHERE
    objects?: unknown;
    // THE TREECIPE ADAPTER'S LOAD (#444): THE PARENT STEP 1 CHOSE, WHOSE OBJECTS ARE THE ONLY ONES IT READS
    parentObjectApiName?: unknown;
    // "Add to data set" (#447): THE NEW CHILD OBJECT, ITS LOOKUP TO THE PARENT, AND HOW MANY PER PARENT RECORD
    childObjectApiName?: unknown;
    lookupFieldApiName?: unknown;
    countPerParent?: unknown;
    fields?: unknown;
    // A RECORD Id OPENED FROM A PREVIEW (#556): WHICH PREVIEW, AND WHICH OF ITS ROWS
    recordLinkSequence?: unknown;
    rowIndex?: unknown;
    // AN ADAPTER RECORD TABLE'S PAGE AND, FOR A LOOKUP CELL, ITS COLUMN (#720)
    pageIndex?: unknown;
    columnIndex?: unknown;
    // ONE EDIT OF THE ADAPTER'S RECORDS ON SCREEN (#721): WHICH OF RECIPE_COCKPIT_UPDATER_EDIT_RULES
    editKind?: unknown;
    // THE UPDATER'S RESTORE (#419): A SNAPSHOT'S FILE NAME, AND THE LIST THE PANEL DREW IT FROM
    snapshotName?: unknown;
    snapshotsSequence?: unknown;
    // THE TROUBLESHOOTING HISTORY (#485): THE ROWS THE PANEL DREW, AND ONE OF THEIR FILES BY ITS INDEX
    historySequence?: unknown;
    fileIndex?: unknown;
    // A DATA SET'S INSERT JOURNEY (#471): THE ENTRIES THE PANEL DREW, AND ONE OF THEIR FILES BY ITS INDEX
    journeySequence?: unknown;
    // A ROW OF THE TODO'S SUB-TAB'S REMOVED LIST (#391)
    removalKey?: unknown;
    filePath?: unknown;
    lineNumber?: unknown;
    runFolderName?: unknown;
    customTreeFolderName?: unknown;
    phase?: unknown;
    renderSequence?: unknown;
    objectApiName?: unknown;
    fieldApiName?: unknown;
    treeKey?: unknown;
    orgIndex?: unknown;
    count?: unknown;
    datasetFolderName?: unknown;
    // THE NAME TYPED IN A CARD'S OR A DATA SET ROW'S INLINE RENAME BOX (#551)
    name?: unknown;
    tab?: unknown;
    chooseOrg?: unknown;
    objectNickname?: unknown;
    friendObjectApiName?: unknown;
    message?: unknown;
    stack?: unknown;
    place?: unknown;
    nickname?: unknown;
    included?: unknown;
    // "Standard fields" (#477): setAllFieldsIncluded OVER THE STANDARD FIELDS ONLY
    fieldScope?: unknown;
    applied?: unknown;
    updateSequence?: unknown;
    requestSequence?: unknown;
    recordTypeSelection?: unknown;
    // "Remember this selection" (#196): ONLY true SAVES
    isRemembered?: unknown;
    // A FIELD'S INLINE EDITOR (#337, #356): A FIXED VALUE OR AN EDITED EXPRESSION, AS TYPED -- CHECKED AGAIN BY THE HOST
    value?: unknown;
    picklistValues?: unknown;
    min?: unknown;
    max?: unknown;
    // AN IN-PANEL CONFIRMATION'S ANSWER (#349): THE ONE-USE ID IT WAS ASKED WITH, AND THE INDEX OF THE BUTTON CHOSEN
    confirmationId?: unknown;
    choice?: unknown;
    // WHETHER ITS CHECKBOX WAS TICKED (#402); ANYTHING BUT A BOOLEAN IS READ AS CANCEL
    isChecked?: unknown;
    // THE RECORD TYPE SET MODE CHOSEN ON A CONFIRMATION THAT OFFERED MODES (#623): A NAME, MATCHED AGAINST THE ONES OFFERED
    recordTypeSetMode?: unknown;
    // "Change org…" ON A CONFIRMATION (#480): THE READER ASKED FOR ANOTHER ORG RATHER THAN A BUTTON'S ANSWER
    changeOrg?: unknown;
}

export interface IRecipeCockpitLoadPhaseMessage {
    command: 'loadPhase';
    message: string;
}

/*
    renderSequence is echoed back by the panel's "rendered", so an acknowledgement can only promote
    the allow-lists of the model it was actually drawn from. Without it, a replayed model's ack
    arriving after a newer load had posted would activate the NEWER model's targets while the older
    one's rows were on screen.
*/
/*
    focusTree is set only on a reload the host made because a data set the reader acted on was gone:
    it re-opens the card and tab the reader was on, so "refreshed" does not mean "thrown back to a
    collapsed list".
*/
export interface IRecipeCockpitRecipeDataMessage {
    command: 'recipeData';
    recipe: IRecipeCockpitRecipeViewModel;
    renderSequence: number;
    focusTree?: IRecipeCockpitTreeFocus;
    // A PLACE KEPT IN workspaceState (#230), FOR A DOCUMENT WHOSE OWN getState HAS NONE: A PANEL OPENED AFTER A CLOSE OR A WINDOW RELOAD
    restorePlace?: IRecipeCockpitPanelPlace;
}

export interface IRecipeCockpitTreeFocus {
    treeKey: string;
    tab: RecipeCockpitTreeTab;
    // OPENS THE TREECIPE TAB'S RECORD TYPES SECTION (#321), SCROLLED TO THE OBJECT "Change record types" (#196) IS ABOUT
    recordTypes?: { objectApiName?: string };
    // WITH tab 'troubleshooting': THE SUB-TAB A FAILED INSERT'S "Open Troubleshooting" (#375) SELECTS
    troubleshootingSubTab?: RecipeCockpitTroubleshootingSubTab;
    // WITH troubleshootingSubTab 'todos': WHICH OF ITS LISTS A REMOVE OR A RESTORE (#391) RELOADS ONTO
    todosView?: RecipeCockpitTodosView;
}

// WHAT AN OPEN OF THE COCKPIT CAN BE ASKED TO FOCUS ONCE ITS RUN IS LOADED
export type RecipeCockpitOpenFocusRequest = IRecipeCockpitRecordTypesFocusRequest | IRecipeCockpitTroubleshootingFocusRequest;

/*
    "Open Troubleshooting" (#375) on a cockpit that was closed or shows another run: the run and the
    tree are NAMES, matched against the run once it is loaded, as "Change record types" (#196) names
    an object. A tree no card has gets no focus.
*/
export interface IRecipeCockpitTroubleshootingFocusRequest {
    runFolderName: string;
    treeFolderName: string;
    troubleshootingSubTab: RecipeCockpitTroubleshootingSubTab;
}

/*
    "Change record types" (#196) opens the cockpit on a Record types section before any model exists, so
    it names an OBJECT and the card is chosen once the run is loaded.
*/
export interface IRecipeCockpitRecordTypesFocusRequest {
    objectApiName?: string;
}

export interface IRecipeCockpitLoadFailedMessage {
    command: 'loadFailed';
    message: string;
}

// A RUN SWITCH THE READER CANCELLED (#399): THE RUN ON SCREEN STAYS, AND THE DROPDOWN NAMES IT AGAIN
export interface IRecipeCockpitRunSwitchCancelledMessage {
    command: 'runSwitchCancelled';
}

// ONE PICKLIST ROW'S VALUES, ANSWERING THE PANEL'S loadPicklistValues FOR THE MODEL renderSequence NAMES
/*
    A field row's "Test faker value" answer (#718): the example its expression generated, or no
    exampleText when it could not -- the one notification says why -- so the row's button is
    pressable again either way. Dropped by a panel that has drawn another model since.
*/
export interface IRecipeCockpitFakerValueExampleMessage {
    command: 'fakerValueExample';
    renderSequence: number;
    treeKey: string;
    objectApiName: string;
    nickname?: string;
    fieldApiName: string;
    exampleText?: string;
}

export interface IRecipeCockpitPicklistValuesMessage extends IRecipeCockpitPicklistDisplayValues {
    command: 'picklistValues';
    objectApiName: string;
    fieldApiName: string;
    renderSequence: number;
    // THE CARD WHOSE VALUE TILES ASKED (#465), AND WHAT ITS EDIT OF THE FIELD TICKS: SET ONLY WHEN THE EDIT IS A CHOICE OF VALUES
    treeKey?: string;
    chosenPicklistValues?: string[];
    // THE FIELD HAS AN EDIT THAT IS NOT A CHOICE OF ITS VALUES, WHICH A SAVE FROM THE TILES REPLACES
    isOtherEdit?: true;
    // THE FIELD HAS AN EDIT OF ANY KIND, WHICH THE TILES' RESET TO GENERATED CLEARS (#479)
    isEdited?: true;
}

/*
    A failed tree insert's "Open Troubleshooting" (#375) on the model already on screen: the card is
    opened on that tab and sub-tab in place, so the org selection and readiness stay. renderSequence
    names the model, and the panel drops it for any other.
*/
export interface IRecipeCockpitFocusTreeMessage {
    command: 'focusTree';
    focusTree: IRecipeCockpitTreeFocus;
    renderSequence: number;
}

/*
    The authorized orgs the Data-by-Org dropdown offers, as LABELS only: the panel posts back the
    index of the one chosen, and the host looks the username up in the list it holds. A name the
    panel posted would be an org of its choosing; an index can only be one the host offered.
*/
/*
    hiddenOrgNote is RECIPE_COCKPIT_HIDDEN_ORGS_NOTE when any authorized org was left out -- because the
    CLI does not know it to be a sandbox or a scratch org (Data-by-Org lists no production org but the
    CLI's default, #305), or because it does not report it connected -- and empty otherwise. A label
    ending " (default)" is the CLI's default org, always listed first.
    forgottenOrgNotice names the org chosen last when it was forgotten for no longer being connected.
*/
export interface IRecipeCockpitDataOrgListMessage {
    command: 'dataOrgList';
    orgLabels: string[];
    // THE SAME ORGS AS THE PICKER LISTS THEM, "alias -- instance url" (#678); orgLabels STAYS WHAT EVERY OTHER TEXT QUOTES
    orgPickerLabels: string[];
    selectedOrgIndex: number | null;
    noOrgsMessage: string;
    hiddenOrgNote: string;
    forgottenOrgNotice: string;
    renderSequence: number;
}

/*
    The org the dropdown shows while the connections are checked (#305): the org chosen
    last, else the CLI's default, read from the local authorization files and config alone. It is
    a LABEL and nothing else -- the panel cannot select it, and nothing is inserted until the list
    answers and the selection's own Organization row says sandbox. requestSequence names the check
    it was read for, so one read for a check since replaced is dropped.
*/
export interface IRecipeCockpitDataOrgProvisionalMessage {
    command: 'dataOrgProvisional';
    orgLabel: string;
    requestSequence: number;
    renderSequence: number;
}

/*
    The org Data-by-Org has selected. orgTypeLabel is '' while the Organization query is still
    out; isSandbox is null until it answers, and stays null when it failed. failureMessage is set
    when the org could not be connected to, or did not answer that it is a sandbox, and is then
    the whole answer about it. requestSequence names the selection, so an answer for an org the
    reader has since replaced is dropped.
*/
export interface IRecipeCockpitDataOrgSelectionMessage {
    command: 'dataOrgSelection';
    orgIndex: number;
    orgLabel: string;
    orgTypeLabel: string;
    isSandbox: boolean | null;
    failureMessage: string;
    requestSequence: number;
    renderSequence: number;
}

// ONE OBJECT OF ONE TREE AS THE TREE INSERT SENDS IT: THE FIELDS OF ITS BLOCK, OR WHY THE BLOCK COULD NOT BE READ
export interface IRecipeCockpitCreateTarget {
    treeKey: string;
    objectApiName: string;
    recipeFieldApiNames?: string[];
    recipeFieldRefusalReason?: string;
    // UNTICKED IN THAT TREE'S STRUCTURE TAB (#220): LEFT OUT OF THE CUT, AND A REASON WHEN THE ORG REQUIRES ONE
    excludedFieldApiNames?: string[];
}

export interface IRecipeCockpitCreateReadinessByTarget {
    byObjectApiName: Map<string, IRecipeCockpitCreateReadinessViewModel>;
    // KEYED BY buildTreeObjectKey
    byCreateKey: Map<string, IRecipeCockpitCreateReadinessViewModel>;
}

/*
    Whether each object the trees list is ready to be inserted into the org the selection names --
    a tree's "Generate fake data and insert" is offered only while every object it inserts is --
    and the last insert of each tree made there.
*/
export interface IRecipeCockpitDataOrgReadinessMessage {
    command: 'dataOrgReadiness';
    objects: IRecipeCockpitCreateReadinessViewModel[];
    // ONE PER TREE AND OBJECT, FOR THAT TREE'S BLOCK (#210); A ROW READS ITS OWN BEFORE ITS OBJECT'S
    createTargets: IRecipeCockpitCreateReadinessViewModel[];
    requestSequence: number;
    renderSequence: number;
}

// AN INSERT IN FLIGHT DISABLES ITS OWN TREE'S BUTTON AND DISABLES EVERY OTHER (#375); REPLAYED ON A RELOAD SO A RELOADED DOCUMENT DOES NOT OFFER A SECOND
export interface IRecipeCockpitInsertStateMessage {
    command: 'insertState';
    isRunning: boolean;
    treeKey: string;
    // A DATA SET ROW'S Insert… (#541): THE DATA SET BEING INSERTED, WITH AN EMPTY treeKey; ABSENT FOR A TREE'S INSERT
    datasetFolderName?: string;
}

/*
    Whether a friend is being added to a self-lookup iteration from this panel. Every "+" is
    disabled while one is, since the host writes one at a time, and the message is replayed on a
    reveal so a reloaded document does not offer a second.
*/
export interface IRecipeCockpitAddFriendStateMessage {
    command: 'addFriendState';
    isRunning: boolean;
}

// THE SAME FOR "Wire to…" AND "Wire TODO lookups" (#151): ONE WRITE AT A TIME, REPLAYED ON A REVEAL
export interface IRecipeCockpitWireLookupStateMessage {
    command: 'wireLookupState';
    isRunning: boolean;
}

/*
    The "+ New scratch org" run (#200): while isRunning, the button, every "+ Create" and the org
    dropdown are disabled. How the run went is a notification's, with its "View output" button
    (#301): the panel draws no line for it. Stored and replayed, so a reloaded document holds them.
*/
export interface IRecipeCockpitScratchOrgStateMessage {
    command: 'scratchOrgState';
    isRunning: boolean;
    // "Authorize org" (#630) HOLDS THE SAME CONTROLS, SO IT IS THIS RUN TOO: SET ONLY WHILE THE RUN IS A LOGIN
    isAuthorizing?: boolean;
}

/*
    The Treecipe Adapter's load (#416): one per window; while isRunning every Load records button is
    disabled, and treeKey names the card clicked. How it went is a VS Code notification. Stored and
    replayed, like a query run's.
*/
/*
    The "Get latest object detail from target org" dialog (#612), as the host drives it: choose the
    kinds, retrieving, review (one group per kind, items by index), confirming (the dialog steps
    aside for the in-panel confirmation), applying, closed. Names and text only, never a path.
*/
export type RecipeCockpitObjectRefreshStep = 'choose' | 'retrieving' | 'review' | 'confirming' | 'applying' | 'closed';

export interface IRecipeCockpitObjectRefreshGroup {
    kind: ObjectRefreshKind;
    label: string;
    unchangedCount: number;
    unreadableCount: number;
    // EACH ITEM'S INDEX IS ITS PLACE IN EVERY GROUP'S ITEMS, IN ORDER
    items: IObjectRefreshItem[];
}

export interface IRecipeCockpitObjectRefreshStateMessage {
    command: 'objectRefreshState';
    refreshId: string;
    renderSequence: number;
    treeKey: string;
    objectApiName: string;
    nickname?: string;
    step: RecipeCockpitObjectRefreshStep;
    kinds: ObjectRefreshKind[];
    orgLabel?: string;
    groups?: IRecipeCockpitObjectRefreshGroup[];
    tickedItemIndexes?: number[];
}

// ONE OPEN DIALOG; HOST-ONLY BEYOND ITS stateMessage
export interface IRecipeCockpitObjectRefreshSession {
    stateMessage: IRecipeCockpitObjectRefreshStateMessage;
    cancellation: IRecipeCockpitPanelCancellation;
    stagingFolderPath?: string;
    // THE package.xml AS WRITTEN, WHICH MAY BE A -<n> NAME WHEN THE FIRST WAS TAKEN, SO A DISCARD REMOVES ONLY ITS OWN
    packageXmlFilePath?: string;
    comparisonRequest?: IObjectRefreshComparisonRequest;
    plannedItems?: IObjectRefreshPlannedItem[];
}

// A CANCEL FROM THE PANEL ITSELF, BESIDE THE PROGRESS NOTIFICATION'S OWN
export interface IRecipeCockpitPanelCancellation {
    isRequested: boolean;
    onRequested?: () => void;
}

/*
    "Open in browser" (#279): the panel disabled the button on the click, and this says the open has
    finished -- whether it opened, refused or failed is a notification's, since the URL it opened
    carries a session id and nothing about it is ever posted.
*/
export interface IRecipeCockpitOrgOpenStateMessage {
    command: 'orgOpenState';
    isRunning: boolean;
}

/*
    The answer to ⟳ or a first listing while a run holds the selection (#537). The panel cleared its
    picker and started its spinner on the click, so a refusal that answered nothing left it spinning
    with no list until VS Code restarted; this puts the picker back and says which run holds it.
*/
export interface IRecipeCockpitDataOrgListingRefusedMessage {
    command: 'dataOrgListingRefused';
    renderSequence: number;
    message: string;
}

export interface IRecipeCockpitExtensionInfoMessage {
    command: 'extensionInfo';
    version: string;
}

// A PRIMARY BUTTON THAT STAYS A BUTTON BUT NAMES ITS VERB (#384): ITS EMOJI IS DRAWN BEFORE ITS LABEL BY THE STYLESHEET
export type RecipeCockpitVerbButtonClassName = 'treeInsert' | 'dataOrgNewScratch' | 'dataOrgAuthorize';

export type RecipeCockpitHostMessage = IRecipeCockpitLoadPhaseMessage
                                        | IRecipeCockpitCustomTreecipePreviewMessage
                                        | IRecipeCockpitUpdaterLoadStateMessage
                                        | IRecipeCockpitUpdaterRecordsMessage
                                        | IRecipeCockpitUpdaterRecordsPageMessage
                                        | IRecipeCockpitUpdaterNewRecordsMessage
                                        | IRecipeCockpitUpdaterNewRecordsPageMessage
                                        | IRecipeCockpitUpdaterParentChangeMessage
                                        | IRecipeCockpitAdapterMetadataChangesMessage
                                        | IRecipeCockpitObjectRefreshStateMessage
                                        | IRecipeCockpitAdapterChildBlockMessage
                                        | IRecipeCockpitAdapterChildPreviewMessage
                                        | IRecipeCockpitUpdaterSnapshotsMessage
                                        | IRecipeCockpitTroubleshootingHistoryMessage
                                        | IRecipeCockpitDatasetJourneyMessage
                                        | IRecipeCockpitRecipeDataMessage
                                        | IRecipeCockpitLoadFailedMessage
                                        | IRecipeCockpitRunSwitchCancelledMessage
                                        | IRecipeCockpitPicklistValuesMessage
                                        | IRecipeCockpitFakerValueExampleMessage
                                        | IRecipeCockpitDatasetRecordCountsMessage
                                        | IRecipeCockpitFocusTreeMessage
                                        | IRecipeCockpitDataOrgListMessage
                                        | IRecipeCockpitDataOrgProvisionalMessage
                                        | IRecipeCockpitDataOrgSelectionMessage
                                        | IRecipeCockpitDataOrgReadinessMessage
                                        | IRecipeCockpitInsertStateMessage
                                        | IRecipeCockpitAddFriendStateMessage
                                        | IRecipeCockpitWireLookupStateMessage
                                        | IRecipeCockpitTreePreferencesMessage
                                        | IRecipeCockpitDatasetPreferencesMessage
                                        | IRecipeCockpitNameEditResultMessage
                                        | IRecipeCockpitObjectSelectionMessage
                                        | IRecipeCockpitFieldEditResultMessage
                                        | IRecipeCockpitScratchOrgStateMessage
                                        | IRecipeCockpitPermissionSetAssignStateMessage
                                        | IRecipeCockpitMetadataRetrieveStateMessage
                                        | IRecipeCockpitMetadataDeployStateMessage
                                        | IRecipeCockpitTroubleshootingSummaryMessage
                                        | IRecipeCockpitTreeQueriesMessage
                                        | IRecipeCockpitTreeValidationRulesMessage
                                        | IRecipeCockpitTreeQueryStateMessage
                                        | IRecipeCockpitTreeQueryResultMessage
                                        | IRecipeCockpitOrgOpenStateMessage
                                        | IRecipeCockpitDataOrgListingRefusedMessage
                                        | IRecipeCockpitDatasetAddedMessage
                                        | IRecipeCockpitDatasetLastInsertMessage
                                        | IRecipeCockpitExtensionInfoMessage
                                        | IRecipeCockpitConfirmRequestMessage;

/*
    A confirmation the HOST asks for inside the panel (#349), in place of VS Code's modal. The host
    writes every string and decides what each answer means: the panel only draws the lines with
    textContent and answers with the index of a button it was given, under the one-use id. It is
    never stored or replayed: a reload, a new model, a failure to draw or a closed panel answers
    Cancel, and the action asks again only if the reader starts it again.
*/
export interface IRecipeCockpitConfirmRequestMessage {
    command: 'confirmRequest';
    confirmationId: string;
    renderSequence: number;
    title: string;
    summary: string[];
    // THE ORG THE ACTION ACTS ON (#480), DRAWN APART FROM THE SUMMARY: ITS ALIAS AND USERNAME EACH IN THEIR OWN STYLE
    org?: IRecipeCockpitConfirmOrg;
    badge?: string;
    warnings: string[];
    sections: IRecipeCockpitConfirmSection[];
    buttons: string[];
    // "Change org…" BESIDE THE ORG (#480), SET ONLY WHEN THE HOST CAN START THE ACTION AGAIN ON ANOTHER ORG
    canChangeOrg?: boolean;
    // role="alertdialog" FOR AN ACTION THAT WRITES TO AN ORG OR OVERWRITES FILES WITH NO UNDO
    isDestructive: boolean;
    // ONE UNTICKED CHECKBOX UNDER THE LINES (#402), SET ONLY WHEN THE HOST ASKS FOR ONE; THE PANEL ANSWERS isChecked WITH ITS CHOICE
    checkboxLabel?: string;
}

/*
    What "Change org…" starts again once the reader has picked another org (#480): the panel message
    the action was routed from, which is routed again through every guard a click meets, and whether
    the action writes, in which case only a pick that answered it is a sandbox starts it again.
*/
export interface IRecipeCockpitConfirmChangeOrg {
    restartMessage: IRecipeCockpitPanelMessage;
    isSandboxOnly: boolean;
}

export interface IRecipeCockpitConfirmOptions extends IRecipeCockpitConfirmContent {
    isDestructive?: boolean;
    changeOrg?: IRecipeCockpitConfirmChangeOrg;
}

export interface IRecipeCockpitConfirmWithCheckboxOptions extends IRecipeCockpitConfirmOptions {
    checkboxLabel: string;
}

// THE RECORD TYPE SET MODES A CONFIRMATION OFFERS (#623), IN THE ORDER DRAWN; THE FIRST ENABLED ONE IS CHOSEN WHEN IT OPENS, AND A DISABLED ONE (#624) IS NEVER AN ANSWER
export interface IRecipeCockpitConfirmWithRecordTypeSetModesOptions extends IRecipeCockpitConfirmOptions {
    recordTypeSetModes: IRecordTypeSetModeOffer[];
}

// THE LABEL CHOSEN, OR undefined FOR CANCEL; isChecked IS true ONLY FOR A BOX TICKED UNDER A CHOSEN BUTTON
export interface IRecipeCockpitConfirmAnswer {
    chosenLabel: string | undefined;
    isChecked: boolean;
    // SET ONLY UNDER A CHOSEN BUTTON OF A CONFIRMATION THAT OFFERED MODES (#623), AND ONLY TO ONE IT OFFERED
    recordTypeSetMode?: RecordTypeSetMode;
}

// THE SLICE OF vscode.Memento THE COCKPIT USES, SO A TEST CAN HAND IN A MAP
export interface IRecipeCockpitWorkspaceState {
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): Thenable<void>;
}

/*
    Host-only: the org Data-by-Org has selected. orgDetail carries the USERNAME, which the panel is
    never told and never posts.
*/
export interface IRecipeCockpitDataOrgSelection {
    orgIndex: number;
    orgDetail: IAuthenticatedOrgDetail;
    requestSequence: number;
    orgTypeDetail?: IOrgTypeDetail;
    // WHAT THE LOCAL AUTHORIZATION SAYS (#458, #499): WHICH KIND OF SANDBOX IT IS, FOR THE LABEL ONLY
    scratchOrgDetail?: IScratchOrgDetail;
    // SET WHEN NO CONNECTION COULD BE OPENED TO IT: A QUERY (#439), WHICH READS FROM ANY ORG THAT ANSWERED, REFUSES IT
    isConnectionFailed?: boolean;
    /*
        Set once this selection's describes have answered and its readiness was posted (#274). A
        permission set assignment in the selection waits for it: a readiness built from describes
        taken BEFORE an assignment, posted after it, would put back the reasons it just removed.
    */
    isReadinessPosted?: boolean;
}

// THE LOADER'S WHOLE ANSWER: WHAT IS POSTED, AND THE PICKLIST VALUES THE PANEL ASKS FOR ONE ROW AT A TIME
export interface IRecipeCockpitLoadedRecipe {
    recipeViewModel: IRecipeCockpitRecipeViewModel;
    picklistDisplayValuesByObjectApiName: RecipeCockpitPicklistDisplayValuesByObjectApiName;
    treeHistoryTargets: IRecipeCockpitTreeHistoryTargets;
    objectLevelsByApiName?: Map<string, number>;
    // WHAT EACH CARD'S FIXED-VALUES FILE PINS (#342), BY TREE FOLDER, THEN OBJECT, THEN FIELD
    pinnedFixedValuesByFolderName?: Map<string, Map<string, Map<string, string>>>;
    // THE WRAPPER THE MODEL WAS READ FROM, WHICH THE QUERY TAB READS AGAIN (#367); UNSET WHEN IT COULD NOT BE READ
    objectsWrapperFilePath?: string;
    // EVERY CARD'S REMOVED TODOS (#391), BY TREE KEY, IN THE ORDER tree.removedTodos NUMBERS THEM -- WHAT A RESTORE PUTS BACK
    removedTodosByTreeKey?: Map<string, IRemovedTodoComment[]>;
}

/*
    The allow-lists of the tree cards' actions, one per action, each a set of NAMES drawn from the
    rendered model's trees. The three data set actions are keyed by data set folder name.
*/
export interface IRecipeCockpitTreeHistoryAllowLists {
    openableDatasetFolderNames: Set<string>;
    insertableDatasetFolderNames: Set<string>;
    countableDatasetFolderNames: Set<string>;
    // THE DATA SET ROWS THAT DRAW "View results" FOR THEIR NEWEST INSERT (#469)
    viewableInsertResultsDatasetFolderNames: Set<string>;
    // THE CARDS ✎ AND ☆ ARE DRAWN ON: EVERY CARD WITH A FOLDER, WHICH LEAVES OUT ONLY THE UNGROUPED ONE
    nameableTreeKeys: Set<string>;
    // THE DATA SET ROWS ✎ AND ☆ ARE DRAWN ON: EVERY ROW THE RENDERED HISTORIES LIST
    nameableDatasetFolderNames: Set<string>;
    // "<treeKey>\n<object>" FOR EVERY TREE ICON THE PANEL DRAWS CLICKABLE (#219): A CARD WITH A FOLDER, AN OBJECT IT DRAWS, TOLD APART FROM ANY OTHER OCCURRENCE
    selectableObjectKeys: Set<string>;
    // "<treeKey>\n<object>\n<field>" FOR EVERY FIELD CHECKBOX (#220): A SELECTABLE OBJECT'S FIELDS THAT HAVE A LINE IN THE RECIPE
    selectableFieldKeys: Set<string>;
    // "<object>\n<developerName>" FOR EVERY RECORD TYPE A CARD'S RECORD TYPES SECTION OFFERS (#195): WHAT THE TICKS POSTED WITH insertTree ARE MATCHED AGAINST (#623)
    selectableRecordTypeKeys: Set<string>;
    // "<treeKey>\n<lineNumber>" FOR EVERY TODO THE OPEN SUB-TAB DRAWS A REMOVE BUTTON FOR (#391): ONE OF THE CARD'S OWN RECIPE FILE, NO LOCK HOLDING IT
    removableTodoKeys: Set<string>;
    // "<treeKey>\n<removalKey>" FOR EVERY ROW OF THE REMOVED SUB-TAB (#391)
    restorableTodoKeys: Set<string>;
}

/*
    What the host should DO about a panel message -- the router's answer, kept as data so the
    decision is asserted without a live webview and the side effects live in one executor.
*/
export type RecipeCockpitPanelAction =
    { kind: 'replay'; hostMessages: RecipeCockpitHostMessage[] }
    | RecipeCockpitQueryPanelAction
    | RecipeCockpitTroubleshootingPanelAction
    | RecipeCockpitDatasetsPanelAction
    | RecipeCockpitAdapterPanelAction
    | RecipeCockpitRecordLinksPanelAction
    | RecipeCockpitCustomTreecipePanelAction
    | RecipeCockpitTreecipeOrgPanelAction
    | RecipeCockpitTreecipePanelAction
    | { kind: 'activateActions' }
    | { kind: 'activateDatasetActions' }
    | { kind: 'reportRenderFailure'; failureDescription: string; failureStack: string; invalidatesPanel: boolean }
    | { kind: 'openSource'; filePath: string; lineNumber: number }
    | { kind: 'activateValidationRuleList'; treeKey: string }
    | { kind: 'selectRun'; runFolderName: string; customTreeFolderName?: string }
    | { kind: 'generateTreecipe' }
    | { kind: 'openHelpGuide' }
    | { kind: 'postPicklistValues'; hostMessage: IRecipeCockpitPicklistValuesMessage }
    | { kind: 'postInsertState'; hostMessage: IRecipeCockpitInsertStateMessage }
    | { kind: 'persistPlace'; place: IRecipeCockpitPanelPlace }
    | { kind: 'activateTroubleshootingHistory'; treeKey: string }
    | { kind: 'activateDatasetJourney'; datasetFolderName: string }
    // THE UPDATER'S VALUES (#417): THE FIELDS, AND ANY VALUE TYPED FOR ONE, CHECKED AGAIN AND CONFIRMED BY THE EXECUTOR
    // A RECORD Id OPENED FROM A PREVIEW (#556): THE PREVIEW THE PANEL DREW, THEN ONE OF ITS ROWS
    | { kind: 'activateRecordLinks'; recordLinkSequence: number }
    // THE UPDATER'S RESTORE (#419): THE SNAPSHOT LIST THE PANEL DREW, WHICH A RESTORE THEN NAMES BY FILE NAME
    | { kind: 'activateUpdaterSnapshots'; treeKey: string }
    | { kind: 'openChangelog' }
    | { kind: 'answerConfirmation'; confirmationId: string; choice: unknown; isChecked: unknown; recordTypeSetMode: unknown; isChangeOrg: boolean };

/*
    Everything the host holds for the one panel, replaced wholesale when the panel is (re)opened --
    a reopen keeps only the run on screen, and the request sequence of the Treecipe tab's org
    selection.

    Two generations of allow-list: the PENDING pair is built when a model is posted, and only the
    panel's "rendered" acknowledgement promotes it to ACTIVE. A post succeeding says the message
    left the host, not that anything is on screen -- and every reload of the document (each reveal
    of a hidden tab) empties the active pair until the replayed model is drawn again. An action is
    honoured only when the panel has confirmed the row it came from is actually drawn.

    picklistDisplayValuesByObjectApiName belongs to recipeDataMessage and is replaced with it. It is
    posted one row at a time, only for a row the rendered model marked as a picklist (the loadable
    picklist keys, another pending/active pair).
*/
export interface IRecipeCockpitPanelState {
    workspaceRoot: string;
    isPanelReady: boolean;
    loadPhaseMessage: string;
    recipeDataMessage?: IRecipeCockpitRecipeDataMessage;
    picklistDisplayValuesByObjectApiName: RecipeCockpitPicklistDisplayValuesByObjectApiName;
    loadFailedMessage?: IRecipeCockpitLoadFailedMessage;
    pendingOpenableSourceKeys: Set<string>;
    // A RULE'S FILE (#560), BY RecipeCockpitValidationRuleList.buildRuleSourceKey: THE FIELD ROWS' AT POST, EACH VALIDATION RULES LIST'S UNTIL IT IS DRAWN
    pendingOpenableValidationRuleKeys: Set<string>;
    pendingValidationRuleListKeys: Map<string, { renderSequence: number; listSequence: number; ruleKeys: string[] }>;
    validationRuleListSequence: number;
    openableValidationRuleKeys: Set<string>;
    pendingSelectableRunFolderNames: Set<string>;
    pendingLoadablePicklistKeys: Set<string>;
    openableSourceKeys: Set<string>;
    selectableRunFolderNames: Set<string>;
    loadablePicklistKeys: Set<string>;
    treeHistoryTargets: IRecipeCockpitTreeHistoryTargets;
    pendingTreeHistoryAllowLists: IRecipeCockpitTreeHistoryAllowLists;
    treeHistoryAllowLists: IRecipeCockpitTreeHistoryAllowLists;
    // "Open in browser" (#279, #501): ONE OPEN AT A TIME, SO A DOUBLE CLICK OPENS ONE TAB
    isOrgOpenInFlight?: boolean;
    isGenerateTreecipeInFlight: boolean;
    pendingIsGenerateTreecipeOffered: boolean;
    isGenerateTreecipeOffered: boolean;
    reportedFailureDescriptions: Set<string>;
    pendingDataOrgObjectApiNames: Set<string>;
    dataOrgObjectApiNames: Set<string>;
    dataOrgDetails: IAuthenticatedOrgDetail[];
    dataOrgUsername?: string;
    dataOrgSelection?: IRecipeCockpitDataOrgSelection;
    dataOrgRequestSequence: number;
    // THE CARDS "Generate fake data and insert" IS DRAWN ON: EVERY CARD THAT CAN GENERATE (#255)
    pendingInsertableTreeKeys: Set<string>;
    insertableTreeKeys: Set<string>;
    insertStateMessage?: IRecipeCockpitInsertStateMessage;
    pendingInsertableFriendTargets: Map<string, string>;
    insertableFriendTargets: Map<string, string>;
    addFriendStateMessage?: IRecipeCockpitAddFriendStateMessage;
    // EVERY "Wire to…" THE MODEL DRAWS, BY CARD, OBJECT, OCCURRENCE AND FIELD (#151), A PENDING/ACTIVE PAIR LIKE THE "+"'s
    pendingWireableLookupTargets: Map<string, IRecipeCockpitLookupWiringTarget>;
    wireableLookupTargets: Map<string, IRecipeCockpitLookupWiringTarget>;
    pendingAddableParentTargets: Map<string, IRecipeCockpitAddableParentTarget>;
    addableParentTargets: Map<string, IRecipeCockpitAddableParentTarget>;
    // EVERY "Use existing <Parent> from org…" THE MODEL DRAWS ENABLED (#421), THE SAME PAIR
    pendingOrgRecordLookupTargets: Map<string, IRecipeCockpitOrgRecordLookupTarget>;
    orgRecordLookupTargets: Map<string, IRecipeCockpitOrgRecordLookupTarget>;
    wireLookupStateMessage?: IRecipeCockpitWireLookupStateMessage;
    // THE "+ New scratch org" RUN (#200)
    scratchOrgStateMessage?: IRecipeCockpitScratchOrgStateMessage;
    /*
        "Assign permission sets to me…" (#274, #302): the cards it is drawn on, every card with a
        folder and an object, a pending/active pair like the insert's. WHICH objects are read from
        the stored model's tree on the host, never from the message.
    */
    pendingAssignableTreeKeys: Set<string>;
    assignableTreeKeys: Set<string>;
    permissionSetAssignStateMessage?: IRecipeCockpitPermissionSetAssignStateMessage;
    // THE TROUBLESHOOTING TAB'S RETRIEVES (#326, #382): ONE PER WINDOW, STORED AND REPLAYED LIKE THE ASSIGNMENT'S
    metadataRetrieveStateMessage?: IRecipeCockpitMetadataRetrieveStateMessage;
    // THE TROUBLESHOOTING TAB'S DEPLOYS (#346): ONE PER WINDOW, STORED AND REPLAYED LIKE THE ASSIGNMENT'S
    metadataDeployStateMessage?: IRecipeCockpitMetadataDeployStateMessage;
    // THE QUERY TAB'S RUN (#367): ONE PER WINDOW, STORED AND REPLAYED LIKE THE RETRIEVE'S
    treeQueryStateMessage?: IRecipeCockpitTreeQueryStateMessage;
    // THE LAST PREVIEW POSTED (#367), REPLAYED WHILE ITS MODEL IS THE ONE ON SCREEN
    treeQueryResultMessage?: IRecipeCockpitTreeQueryResultMessage;
    // THE TREECIPE UPDATER'S LOAD (#416): ONE PER WINDOW, STORED AND REPLAYED LIKE A QUERY RUN'S
    updaterLoadStateMessage?: IRecipeCockpitUpdaterLoadStateMessage;
    /*
        Set while a load asks for an org and checks the pick (#416). It holds the window as the
        insert's own state does while it asks (#375): every router the insert's state refuses --
        the org listing, the dropdown, ⟳, + New scratch org, the insert, the assignment and the
        deploys -- refuses while it is set, so no run changes the selection under the pick.
    */
    isUpdaterOrgPromptOpen?: boolean;
    // SET WHILE A QUERY ASKS FOR AN ORG AND CHECKS THE PICK (#439), HOLDING THE SELECTION AS isUpdaterOrgPromptOpen DOES
    isQueryOrgPromptOpen?: boolean;
    // SET WHILE A RETRIEVE (#480) OR A CONFIRMATION'S "Change org…" ASKS FOR AN ORG AND CHECKS THE PICK, HOLDING THE SELECTION THE SAME WAY
    isOrgPromptOpen?: boolean;
    // THE LAST RECORDS IT POSTED, REPLAYED WHILE ITS MODEL IS THE ONE ON SCREEN
    updaterRecordsMessage?: IRecipeCockpitUpdaterRecordsMessage;
    // THE LAST "Retrieve latest metadata" (#445): WHAT IT POSTED, REPLAYED WHILE ITS MODEL IS ON SCREEN, AND THE STAGING FOLDER IT READ (HOST-ONLY)
    adapterMetadataChangesMessage?: IRecipeCockpitAdapterMetadataChangesMessage;
    adapterRetrieveStagingFolderPath?: string;
    // THE OPEN "Get latest object detail" DIALOG (#612), REPLAYED WHILE IT RETRIEVES OR APPLIES
    objectRefreshSession?: IRecipeCockpitObjectRefreshSession;
    // THE FIELDS ONLY THE ORG HOLDS THAT IT OFFERED (#446), BY "<object>\n<field>": WHAT LOAD, GENERATE AND UPDATE ACCEPT BEYOND THE RECIPE'S FIELDS (HOST-ONLY)
    adapterOrgOnlyFields?: Map<string, IRecipeCockpitAdapterOrgOnlyField>;
    // THE NEW CHILD OBJECT BEING ADDED (#447) AND ITS LAST PREVIEW, REPLAYED WHILE THEIR MODEL IS ON SCREEN; THE FIELD MODELS AND RECORDS ARE HELD ON THE CLASS
    adapterChildBlockMessage?: IRecipeCockpitAdapterChildBlockMessage;
    adapterChildPreviewMessage?: IRecipeCockpitAdapterChildPreviewMessage;
    // EACH OBJECT'S NEW RECORDS (#722) AS LAST POSTED, PAGE 0, FOR A REOPENED PANEL
    updaterNewRecordsMessages?: IRecipeCockpitUpdaterNewRecordsMessage[];
    /*
        A record Id opened from a preview (#556): the previews whose rows link a record, by
        recordLinkSequence, a pending/active pair holding at most one preview of each kind. PENDING is
        set with the preview; only the panel's "recordLinksRendered" echoing its sequence makes it
        ACTIVE. A ready empties ACTIVE, and a new model and a failure to draw empty both.
    */
    pendingOpenableRecordPreviews: Map<number, IRecipeCockpitOpenableRecordPreview>;
    openableRecordPreviews: Map<number, IRecipeCockpitOpenableRecordPreview>;
    /*
        "Restore previous values…" (#419): per card, the snapshot FILE NAMES last posted and the
        host-only path each resolves to, a pending/active pair. PENDING is set with the list; only
        the panel's "updaterSnapshotsRendered" echoing its snapshotsSequence makes it ACTIVE, and a
        ready, a new model and a failure to draw empty both.
    */
    pendingRestorableSnapshots: Map<string, { snapshotsSequence: number; snapshotPathsByName: Map<string, string> }>;
    restorableSnapshots: Map<string, Map<string, string>>;
    /*
        The Troubleshooting History (#485): per card, the host-only file paths of the rows last
        posted, a pending/active pair like the snapshots. PENDING is set with the rows; only the
        panel's "troubleshootingHistoryRendered" echoing its historySequence makes it ACTIVE, and a
        ready, a new model and a failure to draw empty both.
    */
    pendingHistoryFiles: Map<string, { historySequence: number; filePaths: string[] }>;
    historyFiles: Map<string, { historySequence: number; filePaths: string[] }>;
    // A DATA SET'S INSERT JOURNEY (#471): THE SAME PAIR, PER DATA SET FOLDER NAME, ACTIVATED BY "datasetJourneyRendered"
    pendingJourneyFiles: Map<string, { journeySequence: number; filePaths: string[] }>;
    journeyFiles: Map<string, { journeySequence: number; filePaths: string[] }>;
    // HOST-ONLY, REPLACED WITH THE MODEL: THE WRAPPER THE QUERY TAB'S QUERIES ARE READ FROM (#367)
    objectsWrapperFilePath?: string;
    // THE PLACE workspaceState KEPT FOR THIS MODEL (#230), REPLAYED UNTIL THE MODEL'S "rendered" SAYS IT WAS DRAWN
    restorePlace?: IRecipeCockpitPanelPlace;
    /*
        The Record types section "Change record types" opened the panel on (#196). An open posts its model
        before the new document is ready, so like restorePlace it rides on every replay until the
        model's "rendered".
    */
    openFocusTree?: IRecipeCockpitTreeFocus;
    // HOST-ONLY, REPLACED WITH THE MODEL: WHAT A FILTERED COPY NESTS A KEPT FRIEND BY (#219)
    objectLevelsByApiName?: Map<string, number>;
    // HOST-ONLY, REPLACED WITH THE MODEL: WHAT THE CARDS' FIXED-VALUES FILES PIN (#342), WHICH workspaceState NO LONGER HOLDS
    pinnedFixedValuesByFolderName?: Map<string, Map<string, Map<string, string>>>;
    // HOST-ONLY, REPLACED WITH THE MODEL: EVERY CARD'S REMOVED TODOS (#391), WHICH tree.removedTodos NAMES BY removalKey
    removedTodosByTreeKey?: Map<string, IRemovedTodoComment[]>;
    // THE LAST datasetAdded POSTED (#226): ONLY ITS "partialRendered" PROMOTES THE PENDING HISTORY ALLOW-LISTS
    datasetUpdateSequence: number;
    /*
        The model whose "rendered" arrived since the last ready, post or failure to draw -- null until
        then. A "partialRendered" is honoured only over that model: promoting the pending lists of one
        no document has acknowledged would activate its every history action, not just the new row's.
    */
    acknowledgedRenderSequence: number | null;
    // THE INSTALLED VERSION (#333), SET ONLY WHEN IT IS ONE RECIPE_COCKPIT_EXTENSION_VERSION_PATTERN ACCEPTS
    extensionVersion?: string;
}
