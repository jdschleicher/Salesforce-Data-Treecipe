import { createButton, createElement, setShownWithMotion } from '../../../CockpitKit/panel/CockpitPanelElements';
import {
    RECIPE_COCKPIT_NO_LOCAL_VALIDATION_RULES_NOTE,
    RECIPE_COCKPIT_OBJECT_NO_VALIDATION_RULES_NOTE,
    RECIPE_COCKPIT_VALIDATION_RULES_LOADING_NOTE,
    RECIPE_COCKPIT_VALIDATION_RULE_FILE_MISSING_NOTE,
    RECIPE_COCKPIT_VALIDATION_RULE_NOT_IN_RUN_NOTE,
    RECIPE_COCKPIT_VALIDATION_RULE_NO_FIELDS_NOTE,
    RECIPE_COCKPIT_VALIDATION_RULE_SOURCE_LIST_LINK_LABEL,
    RECIPE_COCKPIT_VALIDATION_RULE_SOURCE_TITLE_PREFIX,
    RECIPE_COCKPIT_VALIDATION_RULE_STATUS_LABELS
} from '../../RecipeCockpitTroubleshootingConstants';
import { applyTroubleshootingFilter, buildTroubleshootingGroupCard, drawTroubleshootingGroupExpanded } from './TroubleshootingTab';
import { ITroubleshootingSubTabState, ITroubleshootingTreeState, IValidationRule, IValidationRuleEntry, IValidationRuleGroupState, IValidationRulesMessage } from './TroubleshootingTypes';

/*
    The Validation Rules sub-tab (#327, #560, #639): per tree object, each rule the project holds and
    what generation did with it, read by the host when the sub-tab first opens. These names are the
    panel script's own, read when a function runs.
*/
declare const vscodeApi: { postMessage(message: unknown): void };
declare const renderedSequence: number | null;
declare function findTreeState(treeKey: unknown): ITroubleshootingTreeState | null;
declare function hasOwnKey(record: object, key: unknown): boolean;
declare function pluralize(count: number, singular: string, plural: string): string;

type ValidationRuleStatus = keyof typeof RECIPE_COCKPIT_VALIDATION_RULE_STATUS_LABELS;

// AN OBJECT OF THE POSTED LIST: ITS RULES, AND HOW MANY RULE FILES THE HOST COULD NOT READ
interface IValidationRuleObject {
    objectApiName: unknown;
    rules?: unknown;
    unreadRuleCount?: unknown;
}

/*
    The Validation Rules list (#327), under "Retrieve validation rules…": per tree object, each
    rule the project holds -- its name, active or not, its error message, the fields it
    constrains and what generation did with it -- read by the host when the sub-tab first opens
    (loadValidationRules), so the posted model does not carry it. Every value is written with
    textContent, and a formula is built only when its button opens it.
*/
export function buildTroubleshootingValidationRules(treeState: ITroubleshootingTreeState, subTabState: ITroubleshootingSubTabState): void {

    subTabState.noun = ['rule', 'rules'];
    subTabState.ruleGroups = [];
    treeState.validationRuleSubTabState = subTabState;
    const validationRuleListElement = createElement('div', 'validationRuleList troubleshootingGroupCards');
    treeState.validationRuleListElement = validationRuleListElement;
    validationRuleListElement.appendChild(createElement('div', 'treeEmpty muted', RECIPE_COCKPIT_VALIDATION_RULES_LOADING_NOTE));
    subTabState.listElement.appendChild(validationRuleListElement);

}


// ASKED ONCE PER MODEL WHEN THE SUB-TAB IS SHOWN; ONE SHOWN BEFORE THE ACK ASKS WITH THE TAB'S COUNTS ONCE IT IS
export function requestTreeValidationRules(treeState: ITroubleshootingTreeState): void {

    if (renderedSequence === null || treeState.isValidationRulesRequested || !treeState.validationRuleListElement) { return; }

    treeState.isValidationRulesRequested = true;
    vscodeApi.postMessage({ command: 'loadValidationRules', treeKey: treeState.tree.treeKey, renderSequence: renderedSequence });

}


// WHAT A RULE IS FOUND BY: ITS OBJECT AND WHAT ITS ROW DRAWS, ITS FORMULA ONLY WHILE OPEN -- NEVER A TOOLTIP
function buildValidationRuleSearchText(objectApiName: string, entry: IValidationRuleEntry): string {

    const texts = [objectApiName, entry.ruleName, entry.statusLabel, entry.activeLabel, entry.messageText, entry.fieldsText]
        .concat(entry.reasonTexts);
    if (entry.isFormulaExpanded) { texts.push(entry.rule.formula as string); }
    return texts.join('\n').toLowerCase();

}


/*
    One group per object, its rows built when it opens, and groups opened within the
    auto-expand budgets, like the TODO's sub-tab: a tree with thousands of rules costs its
    headers and the rows the budget allows. Each rule's search text is taken once from the
    posted values, so a keystroke reads no DOM.
*/
export function renderTreeValidationRules(rulesMessage: IValidationRulesMessage): void {

    if (renderedSequence === null || rulesMessage.renderSequence !== renderedSequence) { return; }

    const treeState = findTreeState(rulesMessage.treeKey);
    if (!treeState || !treeState.validationRuleListElement) { return; }

    const listElement = treeState.validationRuleListElement;
    const subTabState = treeState.validationRuleSubTabState as ITroubleshootingSubTabState;
    const ruleGroups: IValidationRuleGroupState[] = [];
    listElement.textContent = '';
    subTabState.ruleGroups = ruleGroups;

    if (rulesMessage.failureMessage) {
        // ASKED AGAIN THE NEXT TIME THE SUB-TAB IS OPENED: THE READER IS LIKELY FIXING IT
        treeState.isValidationRulesRequested = false;
        listElement.appendChild(createElement('div', 'treeEmpty muted', String(rulesMessage.failureMessage)));
        applyTroubleshootingFilter(treeState, 'validationRules');
        return;
    }

    const objects: IValidationRuleObject[] = Array.isArray(rulesMessage.objects) ? rulesMessage.objects : [];
    const openableRuleKeys: Record<string, boolean> = Object.create(null);
    (Array.isArray(rulesMessage.openableRules) ? rulesMessage.openableRules : []).forEach(function (openableRule: { objectApiName: unknown; ruleName: unknown }) {
        openableRuleKeys[String(openableRule.objectApiName) + '\n' + String(openableRule.ruleName)] = true;
    });
    const hasLocalRules = objects.some(function (object) {
        return (Array.isArray(object.rules) && object.rules.some(function (rule: IValidationRule) { return !rule.isFileMissing; })) || (object.unreadRuleCount as number) > 0;
    });

    if (!hasLocalRules) {
        listElement.appendChild(createElement('div', 'validationRuleNoLocalRules muted', RECIPE_COCKPIT_NO_LOCAL_VALIDATION_RULES_NOTE));
    }

    objects.forEach(function (object) {

        const rules: IValidationRule[] = Array.isArray(object.rules) ? object.rules : [];
        const objectApiName = String(object.objectApiName);
        const groupState: IValidationRuleGroupState = {
            objectApiName: objectApiName,
            element: null,
            toggleElement: null,
            countElement: createElement('span', 'validationRuleCount muted'),
            bodyElement: createElement('div', 'validationRuleRows hidden'),
            entries: rules.map(function (rule) {
                const entry = buildValidationRuleEntryState(objectApiName, rule);
                entry.isSourceOpenable = !rule.isFileMissing && hasOwnKey(openableRuleKeys, objectApiName + '\n' + entry.ruleName);
                return entry;
            }),
            matchingCount: 0,
            isBuilt: false,
            isExpanded: false,
            isShown: true
        };

        const groupCard = buildTroubleshootingGroupCard('validationRules', 'validationRuleObject', 'validationRuleToggle', objectApiName, 'validationRuleObjectName', groupState.countElement, null, groupState.entries.length > 0);
        const groupElement = groupCard.element;
        groupState.element = groupElement;
        const statusDetail = describeValidationRuleStatuses(groupState.entries);
        if (statusDetail) { groupCard.headerElement.appendChild(createElement('span', 'validationRuleDetail muted', statusDetail)); }
        if (groupState.entries.length > 0) {
            groupState.toggleElement = groupCard.headerElement;
            groupState.toggleElement.addEventListener('click', function () {
                setValidationRuleGroupExpanded(treeState, groupState, !groupState.isExpanded, true);
            });
        }

        if (groupState.entries.length === 0 && !((object.unreadRuleCount as number) > 0)) {
            groupElement.appendChild(createElement('div', 'validationRuleEmpty muted', RECIPE_COCKPIT_OBJECT_NO_VALIDATION_RULES_NOTE));
        }

        groupElement.appendChild(groupState.bodyElement);

        if ((object.unreadRuleCount as number) > 0) {
            groupElement.appendChild(createElement('div', 'validationRuleUnread muted', pluralize(object.unreadRuleCount as number, 'more rule file was', 'more rule files were') + ' not read.'));
        }

        listElement.appendChild(groupElement);
        ruleGroups.push(groupState);

    });

    applyTroubleshootingFilter(treeState, 'validationRules');

    // ITS LINKS ARE HONOURED ONCE THE LIST IS ON SCREEN (#560)
    if (Object.keys(openableRuleKeys).length > 0) {
        vscodeApi.postMessage({ command: 'validationRulesRendered', treeKey: rulesMessage.treeKey, renderSequence: rulesMessage.renderSequence, listSequence: rulesMessage.listSequence });
    }

}


// WHAT ONE RULE'S ROW WILL DRAW, TAKEN FROM THE POSTED VALUES BEFORE ANY ROW IS BUILT
function buildValidationRuleEntryState(objectApiName: string, rule: IValidationRule): IValidationRuleEntry {

    const fieldApiNames: unknown[] = Array.isArray(rule.fieldApiNames) ? rule.fieldApiNames : [];
    const reasonTexts = (Array.isArray(rule.reasons) ? rule.reasons : []).map(function (reason: unknown) { return 'Why not applied: ' + String(reason); });
    if (rule.status === 'notInRun') { reasonTexts.push(RECIPE_COCKPIT_VALIDATION_RULE_NOT_IN_RUN_NOTE); }
    if (rule.isFileMissing) { reasonTexts.push(RECIPE_COCKPIT_VALIDATION_RULE_FILE_MISSING_NOTE); }

    const entry: IValidationRuleEntry = {
        rule: rule,
        ruleName: String(rule.ruleName),
        statusLabel: hasOwnKey(RECIPE_COCKPIT_VALIDATION_RULE_STATUS_LABELS, rule.status) ? RECIPE_COCKPIT_VALIDATION_RULE_STATUS_LABELS[rule.status as ValidationRuleStatus] : String(rule.status),
        activeLabel: rule.isActive === true ? 'active' : rule.isActive === false ? 'inactive' : '',
        messageText: typeof rule.errorMessage === 'string' && rule.errorMessage !== '' ? 'Error message: ' + rule.errorMessage : '',
        fieldsText: fieldApiNames.length > 0 ? 'Constrains: ' + fieldApiNames.map(String).join(', ') : RECIPE_COCKPIT_VALIDATION_RULE_NO_FIELDS_NOTE,
        reasonTexts: reasonTexts,
        hasFormula: typeof rule.formula === 'string' && rule.formula !== '',
        isFormulaExpanded: false,
        formulaElement: null,
        searchText: '',
        isMatch: true,
        isShown: true,
        element: null
    };
    entry.searchText = buildValidationRuleSearchText(objectApiName, entry);

    return entry;

}


export function setValidationRuleGroupExpanded(treeState: ITroubleshootingTreeState, groupState: IValidationRuleGroupState, isExpanded: boolean, isAnimated: boolean): void {

    if (!groupState.toggleElement) { return; }

    if (isExpanded && !groupState.isBuilt) {
        groupState.entries.forEach(function (entry) {
            const ruleElement = buildValidationRuleRow(treeState, groupState, entry);
            entry.element = ruleElement;
            if (!entry.isMatch) { ruleElement.classList.add('hidden'); }
            entry.isShown = entry.isMatch;
            groupState.bodyElement.appendChild(ruleElement);
        });
        groupState.isBuilt = true;
    }

    groupState.isExpanded = isExpanded;
    setShownWithMotion(groupState.bodyElement, isExpanded, isAnimated);
    drawTroubleshootingGroupExpanded(groupState, isExpanded);

}


// A RULE GROUP'S ONE DETAIL LINE (#383): HOW MANY RULES ARE IN EACH STATUS, IN THE STATUS LABELS' ORDER, A STATUS NONE HAS LEFT OUT
function describeValidationRuleStatuses(entries: IValidationRuleEntry[]): string {

    const countsByLabel: Record<string, number> = Object.create(null);
    const labels: string[] = [];
    (Object.keys(RECIPE_COCKPIT_VALIDATION_RULE_STATUS_LABELS) as ValidationRuleStatus[]).forEach(function (status) { labels.push(RECIPE_COCKPIT_VALIDATION_RULE_STATUS_LABELS[status]); });
    entries.forEach(function (entry) {
        if (!hasOwnKey(countsByLabel, entry.statusLabel)) {
            countsByLabel[entry.statusLabel] = 0;
            if (labels.indexOf(entry.statusLabel) === -1) { labels.push(entry.statusLabel); }
        }
        countsByLabel[entry.statusLabel]++;
    });

    return labels
        .filter(function (label) { return hasOwnKey(countsByLabel, label); })
        .map(function (label) { return countsByLabel[label] + ' ' + label.toLowerCase(); })
        .join(' · ');

}


function buildValidationRuleRow(treeState: ITroubleshootingTreeState, groupState: IValidationRuleGroupState, entry: IValidationRuleEntry): HTMLElement {

    const rule = entry.rule;
    const ruleElement = createElement('div', 'validationRule validationRule-' + String(rule.status));
    const headerElement = createElement('div', 'validationRuleHeader');

    headerElement.appendChild(createElement('span', 'validationRuleName', entry.ruleName));
    headerElement.appendChild(createElement('span', 'validationRuleStatus', entry.statusLabel));
    if (entry.activeLabel) { headerElement.appendChild(createElement('span', 'validationRuleActive muted', entry.activeLabel)); }
    if (entry.isSourceOpenable) { headerElement.appendChild(buildValidationRuleSourceLink('validationRuleSource', RECIPE_COCKPIT_VALIDATION_RULE_SOURCE_LIST_LINK_LABEL, groupState.objectApiName, entry.ruleName)); }
    ruleElement.appendChild(headerElement);

    if (entry.messageText) { ruleElement.appendChild(createElement('div', 'validationRuleMessage', entry.messageText)); }
    ruleElement.appendChild(createElement('div', 'validationRuleFields muted', entry.fieldsText));
    entry.reasonTexts.forEach(function (reasonText) { ruleElement.appendChild(createElement('div', 'validationRuleReason muted', reasonText)); });

    if (entry.hasFormula) {

        const toggleElement = createButton('secondary', 'validationRuleFormulaToggle', 'Show formula', 'compact');
        toggleElement.setAttribute('aria-expanded', 'false');
        toggleElement.addEventListener('click', function () {
            if (!entry.formulaElement) {
                entry.formulaElement = createElement('div', 'validationRuleFormula hidden', rule.formula as string);
                ruleElement.appendChild(entry.formulaElement);
            }
            entry.isFormulaExpanded = !entry.isFormulaExpanded;
            entry.searchText = buildValidationRuleSearchText(groupState.objectApiName, entry);
            toggleElement.textContent = entry.isFormulaExpanded ? 'Hide formula' : 'Show formula';
            toggleElement.setAttribute('aria-expanded', entry.isFormulaExpanded ? 'true' : 'false');
            setShownWithMotion(entry.formulaElement, entry.isFormulaExpanded, true);
            // A SEARCH TYPED BEFORE THE FORMULA OPENED OR CLOSED NOW MATCHES WHAT IS ON SCREEN
            applyTroubleshootingFilter(treeState, 'validationRules');
        });
        ruleElement.appendChild(toggleElement);

    }

    return ruleElement;

}


// A RULE'S FILE (#560): NAMES ONLY ARE POSTED, AND THE HOST OPENS THE FILE IT FINDS FOR THEM
export function buildValidationRuleSourceLink(className: string, labelText: string, objectApiName: string, ruleName: string): HTMLButtonElement {

    const sourceLinkElement = createButton('link', className + ' sourceLink', labelText);
    const description = RECIPE_COCKPIT_VALIDATION_RULE_SOURCE_TITLE_PREFIX + ' ' + objectApiName + '.' + ruleName;
    sourceLinkElement.setAttribute('title', description);
    sourceLinkElement.setAttribute('aria-label', description);
    sourceLinkElement.addEventListener('click', function () {
        vscodeApi.postMessage({ command: 'openValidationRuleSource', objectApiName: objectApiName, ruleName: ruleName });
    });

    return sourceLinkElement;

}
