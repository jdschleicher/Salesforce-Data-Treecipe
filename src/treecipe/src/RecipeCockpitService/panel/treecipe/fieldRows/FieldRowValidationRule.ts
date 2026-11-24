import { createButton, createElement } from '../../../../CockpitKit/panel/CockpitPanelElements';
import {
    RECIPE_COCKPIT_FIELD_PARENT_EXCLUDED_REASON,
    RECIPE_COCKPIT_FIXED_VALUE_OBJECT_EXCLUDED_REASON,
    RECIPE_COCKPIT_FIXED_VALUE_UNTICKED_REASON,
    RECIPE_COCKPIT_VALIDATION_RULE_FIXED_VALUE_REASON,
    RECIPE_COCKPIT_VALIDATION_RULE_NOT_APPLIED_LABEL
} from '../../../RecipeCockpitFieldRowsConstants';
import { hasOwnKey } from '../../RecipeCockpitOwnKey';
import { findFixedValue } from './FieldRowFixedValue';
import { findObjectExclusion, findObjectFieldSelection, isSameOccurrence, occurrenceNicknameOf } from './SelectionCascade';
import type { FieldRowsPanelMessage, IFieldRowField, IFieldRowFieldState, IFieldRowObjectState, IFieldValidationRules, ISelectionTree } from './FieldRowTypes';
import { vscodeApi as cockpitVscodeApi } from '../../RecipeCockpitPanelConnection';

// THIS MODULE POSTS ONLY ITS OWN COMMANDS: THE TYPE HOLDS EVERY MESSAGE TO THEM
const vscodeApi: { postMessage(message: FieldRowsPanelMessage): void } = cockpitVscodeApi;

/*
    A field row's validation-rule box (#325), or the note naming rules #324 could not apply. The box
    posts names and the state asked for; the host decides, may ask first, and re-derives the lock.
*/

export function hasSwitchableValidationRules(field: IFieldRowField): boolean {
    return !!field.lineNumber && !!field.validationRules && Array.isArray(field.validationRules.appliedRuleNames) && field.validationRules.appliedRuleNames.length > 0;
}

// WHETHER THE HOST SAYS THIS CARD GENERATES THE FIELD WITHOUT ITS VALIDATION RULES (#325)
function isValidationRuleOff(tree: ISelectionTree, objectApiName: string, fieldApiName: string, nickname: string): boolean {
    const validationRulesOff = Array.isArray(tree.validationRulesOff) ? tree.validationRulesOff : [];
    return validationRulesOff.some(function (candidate) { return isSameOccurrence(candidate, objectApiName, nickname) && candidate.fieldApiName === fieldApiName; });
}

/*
    Why a field's validation-rule box is disabled (#325): the host's own rule
    (findValidationRuleLockReason) drawn from the model the panel holds -- a field generation
    leaves out, or writes a fixed value for, has nothing the rules would shape.
*/
function findValidationRuleLockReason(treeObjectState: IFieldRowObjectState, fieldState: IFieldRowFieldState): string {

    const tree = treeObjectState.tree;
    const objectApiName = treeObjectState.object.objectApiName;
    const fieldApiName = fieldState.field.fieldApiName;
    const nickname = occurrenceNicknameOf(treeObjectState.object);
    const objectFieldSelection = findObjectFieldSelection(tree, objectApiName, nickname);

    if (findObjectExclusion(tree, objectApiName)) { return RECIPE_COCKPIT_FIXED_VALUE_OBJECT_EXCLUDED_REASON; }
    if (objectFieldSelection && hasOwnKey(objectFieldSelection.lockReasonsByFieldApiName, fieldApiName) && objectFieldSelection.lockReasonsByFieldApiName[fieldApiName] === RECIPE_COCKPIT_FIELD_PARENT_EXCLUDED_REASON) { return RECIPE_COCKPIT_FIELD_PARENT_EXCLUDED_REASON; }
    if (objectFieldSelection && hasOwnKey(objectFieldSelection.excludedFieldApiNames, fieldApiName)) { return RECIPE_COCKPIT_FIXED_VALUE_UNTICKED_REASON; }
    if (findFixedValue(tree, objectApiName, fieldApiName, nickname) !== null) { return RECIPE_COCKPIT_VALIDATION_RULE_FIXED_VALUE_REASON; }

    return '';

}

/*
    A field's validation-rule box (#325), drawn from the host's answer: ticked while the rules
    shape the field, and the row's expression is what the rules wrote; unticked, it is what the
    field generated before them. The state is never colour alone: the mark, aria-checked and the
    title all say it, and the title names the rules.
*/
export function drawFieldRowValidationRule(treeObjectState: IFieldRowObjectState, fieldState: IFieldRowFieldState): void {

    const field = fieldState.field;
    const buttonElement = fieldState.validationRuleElement as HTMLButtonElement | null;
    if (!buttonElement) { return; }

    // THE BOX IS BUILT ONLY FOR A FIELD hasSwitchableValidationRules ACCEPTS
    const validationRules = field.validationRules as IFieldValidationRules;
    const objectApiName = treeObjectState.object.objectApiName;
    const lockReason = findValidationRuleLockReason(treeObjectState, fieldState);
    const isApplied = !lockReason && !isValidationRuleOff(treeObjectState.tree, objectApiName, field.fieldApiName, occurrenceNicknameOf(treeObjectState.object));
    const ruleNames = validationRules.appliedRuleNames.join(', ');

    fieldState.isValidationRuleApplied = isApplied;
    buttonElement.textContent = isApplied ? '✓' : '';
    buttonElement.setAttribute('aria-checked', isApplied ? 'true' : 'false');
    buttonElement.disabled = !!lockReason;

    const title = lockReason ? 'Validation rules ' + ruleNames + ' cannot be switched: ' + lockReason
        : isApplied ? 'Validation rules applied: ' + ruleNames + ' — untick to generate without them'
        : 'Validation rules not applied: ' + ruleNames + ' — tick to apply them';
    buttonElement.setAttribute('title', title);
    buttonElement.setAttribute('aria-label', field.fieldApiName + ': ' + title);

    if (fieldState.expressionElement && typeof validationRules.unconstrainedExpression === 'string') {
        const shownExpression = isApplied || lockReason ? ( field.recipeValue as string ) : validationRules.unconstrainedExpression;
        // AN EXAMPLE OF THE OTHER EXPRESSION (#718) NO LONGER SAYS WHAT THIS ONE GENERATES
        if (fieldState.fakerValueExampleElement && fieldState.expressionElement.textContent !== shownExpression) {
            fieldState.fakerValueExampleElement.textContent = '';
            fieldState.fakerValueExampleElement.classList.add('hidden');
        }
        fieldState.expressionElement.textContent = shownExpression;
    }

}

// A FIELD'S VALIDATION-RULE BOX (#325): A click posts NAMES and the state asked for; the host decides, and may ask first
export function buildFieldValidationRuleElement(treeObjectState: IFieldRowObjectState, fieldState: IFieldRowFieldState): HTMLElement {

    const controlElement = createElement('span', 'validationRuleControl');
    const buttonElement = createButton('check', 'treeFieldInclude treeFieldValidationRule');
    const object = treeObjectState.object;

    controlElement.appendChild(createElement('span', 'muted', 'rules'));
    buttonElement.setAttribute('role', 'checkbox');
    buttonElement.addEventListener('click', function () {
        if (buttonElement.disabled) { return; }
        const message: FieldRowsPanelMessage = {
            command: 'setFieldValidationRuleApplied',
            treeKey: treeObjectState.tree.treeKey,
            objectApiName: object.objectApiName,
            fieldApiName: fieldState.field.fieldApiName,
            applied: !fieldState.isValidationRuleApplied
        };
        if (object.nickname) { message.nickname = object.nickname; }
        vscodeApi.postMessage(message);
    });
    controlElement.appendChild(buttonElement);
    fieldState.validationRuleElement = buttonElement;

    return controlElement;

}

// A FIELD WHOSE RULES WERE ALL NOT APPLIED (#325) NAMES THEM, AND WHY IN ITS TITLE, IN TEXT ONLY
export function buildValidationRuleNotAppliedElement(field: IFieldRowField): HTMLElement {

    const notAppliedRules = ( field.validationRules as IFieldValidationRules ).notAppliedRules;
    const noteElement = createElement('span', 'validationRuleNotApplied muted', RECIPE_COCKPIT_VALIDATION_RULE_NOT_APPLIED_LABEL + ': ' + notAppliedRules.map(function (notAppliedRule) { return notAppliedRule.ruleName; }).join(', '));
    noteElement.setAttribute('title', notAppliedRules.map(function (notAppliedRule) { return notAppliedRule.ruleName + (notAppliedRule.reason ? ' — ' + notAppliedRule.reason : ''); }).join('\n'));

    return noteElement;

}
