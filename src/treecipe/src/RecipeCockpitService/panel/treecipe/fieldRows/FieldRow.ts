import { createButton, createElement, setShownWithMotion } from '../../../../CockpitKit/panel/CockpitPanelElements';
import { RECIPE_COCKPIT_DERIVED_FIELD_BADGE_LABEL, RECIPE_COCKPIT_DERIVED_FIELD_NOT_INSERTED_SUFFIX, RECIPE_COCKPIT_DERIVED_FIELD_REASON_PREFIX, RECIPE_COCKPIT_READ_ONLY_FORMULA_CLAMP_LENGTH, RECIPE_COCKPIT_READ_ONLY_FORMULA_HIDE_LABEL, RECIPE_COCKPIT_READ_ONLY_FORMULA_PREFIX, RECIPE_COCKPIT_READ_ONLY_FORMULA_SHOW_LABEL, RECIPE_COCKPIT_FIXED_VALUE_BADGE_LABEL, RECIPE_COCKPIT_PICKLIST_EDIT_VALUES_LABEL, RECIPE_COCKPIT_VALIDATION_RULE_SOURCE_LINK_PREFIX } from '../../../RecipeCockpitFieldRowsConstants';
import { StandardDerivedFields } from '../../../../ObjectInfoWrapper/StandardDerivedFields';
import { ReadOnlyFields } from '../../../../ObjectInfoWrapper/ReadOnlyFields';
import { RECIPE_COCKPIT_PICKLIST_RESET_LABEL } from '../../../RecipeCockpitTreecipeFieldEditorConstants';
import { drawTreePermissionSet } from '../../troubleshooting/TroubleshootingActions';
import { requestTroubleshootingSummary } from '../../troubleshooting/TroubleshootingTab';
import { buildValidationRuleSourceLink } from '../../troubleshooting/TroubleshootingValidationRules';
import type { ITroubleshootingTreeState } from '../../troubleshooting/TroubleshootingTypes';
import { drawTreeInsert } from '../dataOrg/TreeInsert';
import type { IDataOrgTreeState } from '../dataOrg/DataOrgTypes';
import { buildLookupDecisionElement, buildWireLookupElement, findEmptyLookup, findLookupWiring } from '../fieldEditor/LookupWiring';
import { drawPicklistValueEditor, requestPicklistValues } from '../fieldEditor/PicklistTiles';
import { buildTodoListElement } from '../recordTypes/TodosToggles';
import { buildFieldFixedValueElement } from './FieldRowFixedValue';
import { buildFieldValidationRuleElement, buildValidationRuleNotAppliedElement, hasSwitchableValidationRules } from './FieldRowValidationRule';
import { drawObjectFieldSelection } from './FieldScope';
import { drawObjectSelection } from './SelectionCascade';
import type { FieldRowsPanelMessage, IFieldRowField, IFieldRowFieldState, IFieldRowObjectState, IFieldRowTreeObject, IFieldRowTreeState, IObjectSelectionMessage, ISelectionTree } from './FieldRowTypes';
import { drawTreePickerObjects } from '../navigation/TreePicker';
import { drawStructureMatchCount } from '../navigation/StructureFilter';
import { buildNicknameBackLink, findReferencedOwnerState, readSourceFieldNickname } from '../navigation/Nicknames';
import { findTreeState, renderedSequence } from '../../shell/PanelRender';
import { savePanelPlace } from '../../shell/PanelPlace';
import { drawHelpSummary } from '../../shell/Help';
import { buildSourceLink } from '../../RecipeCockpitPanelShared';
import { vscodeApi as cockpitVscodeApi } from '../../RecipeCockpitPanelConnection';
import { navigationState } from '../navigation/NavigationState';

// THIS MODULE POSTS ONLY ITS OWN COMMANDS: THE TYPE HOLDS EVERY MESSAGE TO THEM
const vscodeApi: { postMessage(message: FieldRowsPanelMessage): void } = cockpitVscodeApi;

/*
    One field row of the Treecipe tab (#220, #262, #320, #325, #398, #421, #560) and the card-wide
    draws that follow a selection answer. The row's text is written with textContent; every click
    posts names only.
*/
// ONE LOWERCASED HAYSTACK PER FIELD (searchTextOf, #655), EMPTIED FOR EVERY MODEL, SO A HAYSTACK NEVER OUTLIVES THE FIELD IT WAS LOWERCASED FROM
let fieldSearchTexts: Map<IFieldRowField, string> = new Map();

export function resetFieldSearchTexts(): void {
    fieldSearchTexts = new Map();
}

/*
    One lowercased haystack per FIELD, shared by every occurrence of its object a card draws, so
    the faker expression that dominates it is lowercased and held once. The type is matched
    separately, as the type with its size the row draws, because a match has to be on screen.
*/
function searchTextOf(field: IFieldRowField): string {

    let fieldSearchText = fieldSearchTexts.get(field);

    if (fieldSearchText === undefined) {
        fieldSearchText = [field.fieldApiName, field.fieldLabel, field.controllingField, field.recipeValue].join('\n').toLowerCase();
        fieldSearchTexts.set(field, fieldSearchText);
    }

    return fieldSearchText;

}

export function isFieldTextMatch(fieldState: IFieldRowFieldState, searchQuery: string): boolean {
    return searchTextOf(fieldState.field).indexOf(searchQuery) !== -1 || fieldState.typeSearchText.indexOf(searchQuery) !== -1;
}

// A SELF-LOOKUP NAMES ONLY ITS FIELD: "(ParentId)" SAYS WHAT "(ParentId → Account)" SAYS ON Account, WITHOUT THE REPEAT
// A LOOKUP TO AN EXCLUDED PARENT IS SAID SO, AND IS LEFT OUT OF WHAT IS GENERATED (#219)
export function formatParentLookups(treeObject: IFieldRowTreeObject, disabledFieldApiNames?: string[]): string {

    if (!treeObject.parentLookups || treeObject.parentLookups.length === 0) { return ''; }

    return '(' + treeObject.parentLookups.map(function (parentLookup) {
        if (parentLookup.parentObjectApiName === treeObject.objectApiName) { return parentLookup.fieldApiName; }
        const lookupText = parentLookup.fieldApiName + ' → ' + parentLookup.parentObjectApiName;
        return disabledFieldApiNames && disabledFieldApiNames.indexOf(parentLookup.fieldApiName) !== -1 ? lookupText + ' · parent excluded' : lookupText;
    }).join(', ') + ')';

}

export function drawFieldSelection(treeState: IFieldRowTreeState): void {
    let isAnyObjectRefiltered = false;
    treeState.objectStates.forEach(function (treeObjectState) {
        if (drawObjectFieldSelection(treeObjectState)) { isAnyObjectRefiltered = true; }
    });
    // ONE COUNT FOR THE TAB, HOWEVER MANY OBJECTS HIDE THEIR UNSELECTED FIELDS
    if (isAnyObjectRefiltered) { drawStructureMatchCount(treeState); }
}

function hasTreeSelection(tree: ISelectionTree): boolean {
    return !!tree.objectSelection
        || ( Array.isArray(tree.objectCounts) && tree.objectCounts.length > 0 )
        || ( Array.isArray(tree.validationRulesOff) && tree.validationRulesOff.length > 0 )
        || ( !!tree.fieldSelection && Array.isArray(tree.fieldSelection.objects) && tree.fieldSelection.objects.some(function (objectFieldSelection) {
            return Array.isArray(objectFieldSelection.excludedFieldApiNames) && objectFieldSelection.excludedFieldApiNames.length > 0;
        }) );
}

// SHOWN ONLY WHILE THE CARD LEAVES SOMETHING OUT; THE HOST ASKS BEFORE IT CLEARS ANYTHING
export function drawResetSelection(treeState: IFieldRowTreeState): void {

    if (!treeState.resetSelectionElement) { return; }

    if (hasTreeSelection(treeState.tree)) { treeState.resetSelectionElement.classList.remove('hidden'); } else { treeState.resetSelectionElement.classList.add('hidden'); }

}

// ONLY FOR THE MODEL ON SCREEN: A NEWER ONE WAS BUILT FROM THE SELECTION THIS UPDATE REPORTS
export function renderObjectSelection(objectSelectionMessage: IObjectSelectionMessage): void {

    if (renderedSequence === null || objectSelectionMessage.renderSequence !== renderedSequence) { return; }

    const treeState = findTreeState(objectSelectionMessage.treeKey);
    if (!treeState) { return; }

    treeState.tree.objectSelection = objectSelectionMessage.objectSelection || undefined;
    treeState.tree.fieldSelection = objectSelectionMessage.fieldSelection || undefined;
    treeState.tree.objectCounts = objectSelectionMessage.objectCounts || undefined;
    treeState.tree.fixedValues = objectSelectionMessage.fixedValues || undefined;
    treeState.tree.validationRulesOff = objectSelectionMessage.validationRulesOff || undefined;
    drawObjectSelection(treeState);
    drawTreeInsert(treeState);
    drawTreePermissionSet(treeState);
    drawHelpSummary();
    if (treeState === navigationState.treePickerShownTreeState) { drawTreePickerObjects(); }

    // WHAT THE TROUBLESHOOTING TAB COUNTS LEAVES OUT EXCLUDED OBJECTS AND UNTICKED FIELDS (#346)
    if (treeState.selectedTab === 'troubleshooting') { requestTroubleshootingSummary(treeState); }

}

/*
    A field's checkbox (#220): a real button with role="checkbox", keyboard operable. A click posts
    NAMES only; the host decides whether the field may be unticked and posts the card back.
*/
function buildFieldIncludeElement(treeObjectState: IFieldRowObjectState, fieldState: IFieldRowFieldState): HTMLButtonElement {

    const includeElement = createButton('check', 'treeFieldInclude');
    const object = treeObjectState.object;

    includeElement.setAttribute('role', 'checkbox');
    includeElement.addEventListener('click', function () {
        if (includeElement.disabled) { return; }
        const message: FieldRowsPanelMessage = {
            command: 'setFieldIncluded',
            treeKey: treeObjectState.tree.treeKey,
            objectApiName: object.objectApiName,
            fieldApiName: fieldState.field.fieldApiName,
            included: !fieldState.isIncluded
        };
        if (object.nickname) { message.nickname = object.nickname; }
        vscodeApi.postMessage(message);
    });
    fieldState.includeElement = includeElement;

    return includeElement;

}

// A LONG FORMULA IS CLAMPED TO TWO LINES (#706); THE BUTTON EXPANDS IT IN PLACE AND CLAMPS IT AGAIN
function buildFormulaClampToggle(formulaNoteElement: HTMLElement, fieldApiName: string): HTMLButtonElement {

    formulaNoteElement.classList.add('readOnlyFormulaNote');
    formulaNoteElement.classList.add('readOnlyFormulaClamped');
    const toggleElement = createButton('link', 'readOnlyFormulaToggle', RECIPE_COCKPIT_READ_ONLY_FORMULA_SHOW_LABEL);
    toggleElement.setAttribute('aria-expanded', 'false');
    // EVERY LONG FORMULA ROW HAS ONE, SO ITS ACCESSIBLE NAME SAYS WHOSE FORMULA IT OPENS
    toggleElement.setAttribute('aria-label', RECIPE_COCKPIT_READ_ONLY_FORMULA_SHOW_LABEL + ' of ' + fieldApiName);
    toggleElement.addEventListener('click', () => {
        const isExpanding = formulaNoteElement.classList.contains('readOnlyFormulaClamped');
        if (isExpanding) { formulaNoteElement.classList.remove('readOnlyFormulaClamped'); } else { formulaNoteElement.classList.add('readOnlyFormulaClamped'); }
        toggleElement.textContent = isExpanding ? RECIPE_COCKPIT_READ_ONLY_FORMULA_HIDE_LABEL : RECIPE_COCKPIT_READ_ONLY_FORMULA_SHOW_LABEL;
        toggleElement.setAttribute('aria-label', toggleElement.textContent + ' of ' + fieldApiName);
        toggleElement.setAttribute('aria-expanded', isExpanding ? 'true' : 'false');
    });
    return toggleElement;

}

export function buildTreeFieldRow(treeObjectState: IFieldRowObjectState, fieldState: IFieldRowFieldState): HTMLElement {

    const field = fieldState.field;
    const fieldRowElement = createElement('div', 'treeField');
    const fieldHeaderElement = createElement('div', 'treeFieldHeader');

    // ONLY A FIELD WITH A LINE IN THE RECIPE: THAT LINE IS WHAT THE FILTERED COPY LEAVES OUT
    if (treeObjectState.canSelectFields && field.lineNumber) {
        fieldHeaderElement.appendChild(buildFieldIncludeElement(treeObjectState, fieldState));
        fieldHeaderElement.appendChild(buildFieldFixedValueElement(treeObjectState, fieldState));
    }

    fieldHeaderElement.appendChild(createElement('span', 'treeFieldName', field.fieldApiName));

    const referencedOwnerState = findReferencedOwnerState(treeObjectState, fieldState);
    if (referencedOwnerState) {
        fieldHeaderElement.appendChild(buildNicknameBackLink(treeObjectState.treeState, referencedOwnerState, fieldHeaderElement));
    }

    if (field.fieldTypeWithSize || field.fieldType) {
        fieldHeaderElement.appendChild(createElement('span', 'fieldType', field.fieldTypeWithSize || field.fieldType));
    }

    // A FIELD SALESFORCE SETS FROM ANOTHER LOOKUP (#680): READ ONLY, NAMING THE LOOKUP AND THE RECORD THE SOURCE HOLDS
    const derivedField = StandardDerivedFields.resolveDerivedField(treeObjectState.object.objectApiName, field.fieldApiName);
    if (derivedField) {
        const derivedReason = RECIPE_COCKPIT_DERIVED_FIELD_REASON_PREFIX + derivedField.throughFieldApiName;
        const derivedBadgeElement = createElement('span', 'fixedValueBadge derivedFieldBadge', RECIPE_COCKPIT_DERIVED_FIELD_BADGE_LABEL);
        derivedBadgeElement.setAttribute('title', 'Salesforce sets ' + field.fieldApiName + ' from ' + derivedField.throughFieldApiName + RECIPE_COCKPIT_DERIVED_FIELD_NOT_INSERTED_SUFFIX);
        fieldHeaderElement.appendChild(derivedBadgeElement);
        const copiedNickname = referencedOwnerState ? readSourceFieldNickname(referencedOwnerState, derivedField.sourceFieldApiName) : null;
        fieldHeaderElement.appendChild(createElement('span', 'treeFieldNote derivedFieldNote muted', copiedNickname ? derivedReason + ' → ' + copiedNickname : derivedReason));
    }

    // A FIELD SALESFORCE CALCULATES OR SETS ITSELF (#685): READ ONLY, SAYING WHY, AND A FORMULA FIELD SHOWING ITS FORMULA
    const readOnlyReason = derivedField ? undefined : ReadOnlyFields.readReason(field.recipeValue);
    if (readOnlyReason) {
        const readOnlyBadgeElement = createElement('span', 'fixedValueBadge derivedFieldBadge', RECIPE_COCKPIT_DERIVED_FIELD_BADGE_LABEL);
        readOnlyBadgeElement.setAttribute('title', 'Salesforce sets ' + field.fieldApiName + ' itself (' + readOnlyReason + ')' + RECIPE_COCKPIT_DERIVED_FIELD_NOT_INSERTED_SUFFIX);
        fieldHeaderElement.appendChild(readOnlyBadgeElement);
        const readOnlyNote = readOnlyReason === 'formula' && field.formula ? RECIPE_COCKPIT_READ_ONLY_FORMULA_PREFIX + field.formula : readOnlyReason;
        const readOnlyNoteElement = fieldHeaderElement.appendChild(createElement('span', 'treeFieldNote readOnlyFieldNote muted', readOnlyNote));
        if (readOnlyReason === 'formula' && field.formula && field.formula.length > RECIPE_COCKPIT_READ_ONLY_FORMULA_CLAMP_LENGTH) {
            fieldHeaderElement.appendChild(buildFormulaClampToggle(readOnlyNoteElement, field.fieldApiName));
        }
    }

    // THE RECORD TYPES THAT RESTRICT THIS FIELD (#320), AS TEXT, WHETHER OR NOT THE CHECK IS ON
    if (fieldState.recordTypeDeveloperNames) {
        const recordTypeNamesText = fieldState.recordTypeDeveloperNames.join(', ');
        const recordTypeChipElement = createElement('span', 'recordTypeChip', recordTypeNamesText);
        recordTypeChipElement.setAttribute('title', 'Restricted by ' + (fieldState.recordTypeDeveloperNames.length === 1 ? 'record type ' : 'record types ') + recordTypeNamesText);
        fieldHeaderElement.appendChild(recordTypeChipElement);
    }

    const lookupWiring = field.lineNumber ? findLookupWiring(treeObjectState.tree, treeObjectState.object, field.fieldApiName) : null;
    if (lookupWiring) {
        fieldHeaderElement.appendChild(buildWireLookupElement(treeObjectState.tree, lookupWiring));
    }

    const emptyLookup = field.lineNumber ? findEmptyLookup(treeObjectState.tree, treeObjectState.object, field.fieldApiName) : null;
    if (emptyLookup) {
        fieldHeaderElement.appendChild(buildLookupDecisionElement(treeObjectState, fieldState, emptyLookup));
    }

    if (field.controllingField) {
        fieldHeaderElement.appendChild(createElement('span', 'controllingField muted', 'controlled by ' + field.controllingField));
    }

    if (field.isOnlyInRecipeFile) {
        fieldHeaderElement.appendChild(createElement('span', 'recipeFileOnly muted', 'read from the recipe file'));
    }

    fieldState.fixedValueBadgeElement = createElement('span', 'fixedValueBadge hidden', RECIPE_COCKPIT_FIXED_VALUE_BADGE_LABEL);
    fieldHeaderElement.appendChild(fieldState.fixedValueBadgeElement);


    fieldState.noteElement = createElement('span', 'treeFieldNote muted hidden');
    fieldHeaderElement.appendChild(fieldState.noteElement);

    if (treeObjectState.object.recipeFilePath && field.lineNumber) {
        fieldHeaderElement.appendChild(buildSourceLink('treeFieldSource', '↗ yml', treeObjectState.object.recipeFilePath, field.lineNumber));
    }

    // AT THE END OF THE ROW (#325): A BOX FOR A FIELD ITS RULES SHAPE, OR A NOTE NAMING RULES THAT COULD NOT BE APPLIED
    if (treeObjectState.canSelectFields && hasSwitchableValidationRules(field)) {
        fieldHeaderElement.appendChild(buildFieldValidationRuleElement(treeObjectState, fieldState));
    } else if (field.validationRules && Array.isArray(field.validationRules.notAppliedRules) && field.validationRules.notAppliedRules.length > 0
                && !( Array.isArray(field.validationRules.appliedRuleNames) && field.validationRules.appliedRuleNames.length > 0 )) {
        fieldHeaderElement.appendChild(buildValidationRuleNotAppliedElement(field));
    }

    // ONE LINK PER RULE WHOSE FILE THE HOST FOUND (#560), APPLIED OR NOT, AFTER THE BOX OR NOTE
    if (field.validationRules && Array.isArray(field.validationRules.sourceRuleNames)) {
        field.validationRules.sourceRuleNames.forEach(function (ruleName) {
            fieldHeaderElement.appendChild(buildValidationRuleSourceLink('treeFieldRuleSource', RECIPE_COCKPIT_VALIDATION_RULE_SOURCE_LINK_PREFIX + String(ruleName), treeObjectState.object.objectApiName, String(ruleName)));
        });
    }

    fieldRowElement.appendChild(fieldHeaderElement);

    if (fieldState.todos.length > 0) {
        fieldRowElement.appendChild(buildTodoListElement(treeObjectState.object.recipeFilePath, fieldState.todos));
    }

    // THE SEARCH BOX MATCHES A FIELD BY ITS FAKER EXPRESSION, SO THE EXPRESSION IS ON SCREEN WITH THE ROW
    if (field.recipeValue) {
        const expressionRowElement = createElement('div', 'expressionRow');
        fieldState.expressionElement = createElement('pre', 'expression', field.recipeValue);
        expressionRowElement.appendChild(fieldState.expressionElement);
        fieldRowElement.appendChild(expressionRowElement);
    }

    fieldState.fixedValueElement = createElement('pre', 'fixedValue hidden');
    fieldRowElement.appendChild(fieldState.fixedValueElement);

    // A PICKLIST'S EDIT VALUES SITS UNDER ITS FAKER VALUE, NOT IN THE HEADER, SO NO ROW KEEPS A SLOT FOR IT (#398, #465)
    let setPicklistExpanded: ((isExpanding: boolean, isAnimated?: boolean) => void) | null = null;

    if (field.isPicklist) {

        const picklistSectionElement = createElement('div', 'picklistSection');
        const picklistToggleElement = createButton('secondary', 'picklistToggle', RECIPE_COCKPIT_PICKLIST_EDIT_VALUES_LABEL);
        const editorElement = createElement('div', 'picklistValues picklistEditor hidden');
        const fieldLabel = treeObjectState.object.objectApiName + '.' + field.fieldApiName;
        const closeButtonElement = createButton('icon', 'picklistEditorClose', '×');
        const editorBodyElement = createElement('div', 'picklistEditorBody');
        const editorHeaderElement = createElement('div', 'picklistEditorHeader');

        editorElement.setAttribute('role', 'group');
        editorElement.setAttribute('aria-label', 'Edit values of ' + fieldLabel);
        closeButtonElement.setAttribute('aria-label', 'Close the values of ' + field.fieldApiName);
        closeButtonElement.setAttribute('title', 'Close without saving');
        editorHeaderElement.appendChild(createElement('span', 'fieldEditorHint muted', 'Tick the values ' + field.fieldApiName + ' generates. Save writes them into the recipe file; ' + RECIPE_COCKPIT_PICKLIST_RESET_LABEL + ' puts back the lines the field had.'));
        editorHeaderElement.appendChild(closeButtonElement);
        editorElement.appendChild(editorHeaderElement);
        editorElement.appendChild(editorBodyElement);

        const setExpanded = function (isExpanding: boolean, isAnimated?: boolean): void {
            const wasExpanded = !editorElement.classList.contains('hidden');
            editorBodyElement.textContent = '';
            fieldState.picklistRefusalElement = null;
            fieldState.endPicklistSave = null;
            if (isExpanding) {
                editorBodyElement.appendChild(createElement('div', 'picklistLoading muted', 'Loading values…'));
                requestPicklistValues(treeObjectState.tree.treeKey, treeObjectState.object.objectApiName, treeObjectState.object.nickname, field.fieldApiName, function (picklistValuesMessage) {
                    if (editorElement.classList.contains('hidden')) { return; }
                    drawPicklistValueEditor(treeObjectState, fieldState, editorBodyElement, picklistValuesMessage, function () {
                        setExpanded(false, true);
                        savePanelPlace();
                    });
                });
            }
            setShownWithMotion(editorElement, isExpanding, isAnimated === true);
            fieldState.isPicklistExpanded = isExpanding;
            picklistToggleElement.setAttribute('aria-expanded', isExpanding ? 'true' : 'false');
            // WHILE THE TILES ARE OPEN THE ONLY WAYS OUT ARE SAVE OR CANCEL (#495); × AND ESCAPE STAY FOR THE LOAD
            if (isExpanding) { picklistToggleElement.classList.add('hidden'); } else { picklistToggleElement.classList.remove('hidden'); }
            if (isExpanding && isAnimated && typeof closeButtonElement.focus === 'function') { closeButtonElement.focus(); }
            if (!isExpanding && wasExpanded && typeof picklistToggleElement.focus === 'function') { picklistToggleElement.focus(); }
        };
        setPicklistExpanded = setExpanded;
        fieldState.setPicklistExpanded = setExpanded;

        // THE NAME STARTS WITH THE TEXT ON THE BUTTON, SO A VOICE COMMAND OF WHAT IS ON SCREEN REACHES IT
        picklistToggleElement.setAttribute('aria-label', RECIPE_COCKPIT_PICKLIST_EDIT_VALUES_LABEL + ' of ' + field.fieldApiName);
        picklistToggleElement.setAttribute('aria-expanded', 'false');
        // IT IS HIDDEN WHILE THE TILES ARE OPEN (#495), SO A CLICK ONLY EVER OPENS THEM
        picklistToggleElement.addEventListener('click', function () {
            if (!editorElement.classList.contains('hidden')) { return; }
            setExpanded(true, true);
            savePanelPlace();
        });
        closeButtonElement.addEventListener('click', function (event) {
            event.stopPropagation();
            setExpanded(false, true);
            savePanelPlace();
        });
        editorElement.addEventListener('keydown', function (event) {
            if (event.key !== 'Escape') { return; }
            event.stopPropagation();
            setExpanded(false, true);
            savePanelPlace();
        });

        picklistSectionElement.appendChild(picklistToggleElement);
        picklistSectionElement.appendChild(editorElement);
        fieldRowElement.appendChild(picklistSectionElement);
        fieldState.picklistSectionElement = picklistSectionElement;

    }

    // A ROW BUILT FROM A RESTORED PLACE OPENS ONLY ONCE IT IS WHOLE: OPENED EARLIER, ITS VALUES WERE
    // APPENDED BEFORE ITS HEADER AND DREW ABOVE THE FIELD NAME (#277). IT STILL ASKS THE HOST AGAIN
    if (setPicklistExpanded && fieldState.isPicklistExpanded) { setPicklistExpanded(true); }

    return fieldRowElement;

}

export function applyTreeFieldVisibility(fieldState: IFieldRowFieldState): void {

    if (!fieldState.rowElement) { return; }

    if (fieldState.isMatch) {
        fieldState.rowElement.classList.remove('hidden');
    } else {
        fieldState.rowElement.classList.add('hidden');
    }

}
