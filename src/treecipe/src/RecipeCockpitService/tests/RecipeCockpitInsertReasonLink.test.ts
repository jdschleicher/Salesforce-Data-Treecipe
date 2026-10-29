import * as path from 'path';

jest.mock('vscode', () => ({}), { virtual: true });

import {
    RecipeCockpitService,
    IRecipeCockpitRecipeViewModel,
    RECIPE_COCKPIT_CANNOT_INSERT_PREFIX,
    RECIPE_COCKPIT_CHOOSE_INSERT_ORG_NOTE,
    RECIPE_COCKPIT_INSERT_REASON_TREECIPE_LINK_PREFIX,
    RECIPE_COCKPIT_INSERT_REASON_TROUBLESHOOTING_LINKS,
    RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS
} from '../RecipeCockpitService';
import { RECIPE_COCKPIT_CREATE_REASON_CODES } from '../RecipeCockpitRecordCreation';
import { runPanelScript } from './RecipeCockpitPanelHarness';

/*
    A disabled "Generate fake data and insert" links its reason to the place that fixes it (#539):
    an object the org lacks to Troubleshooting › Fields, one it will not create to Troubleshooting ›
    Permissions, an unticked required field to its own row. The link is read from the readiness's
    code, posts nothing, and draws for no other reason.
*/

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';

type Panel = ReturnType<typeof runPanelScript>;

const loadRecipe = (): IRecipeCockpitRecipeViewModel => RecipeCockpitService.loadRecipeRunByRuns(
    RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes')),
    TREE_WORKSPACE_ROOT,
    RUN_FOLDER_NAME
).recipeViewModel;

const renderPanel = (recipeChanges: (recipe: IRecipeCockpitRecipeViewModel) => void = () => undefined): Panel => {
    const panel = runPanelScript();
    const recipe = loadRecipe();
    recipeChanges(recipe);
    panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1 });
    panel.postToPanel({ command: 'rendered' });
    panel.expandAllTrees();
    return panel;
};

const selectOrg = (panel: Panel, failureMessage?: string) => {
    panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: 0, noOrgsMessage: '', renderSequence: 1 });
    panel.postToPanel({
        command: 'dataOrgSelection', orgIndex: 0, orgLabel: 'qa', orgTypeLabel: failureMessage ? 'Production · Enterprise Edition' : 'Sandbox',
        isSandbox: !failureMessage, requestSequence: 3, renderSequence: 1, ...( failureMessage ? { failureMessage } : {} )
    });
};

const ready = (objectApiName: string) => ({ objectApiName, disabledReason: '', requiredLookups: [] });

const postReadiness = (panel: Panel, blocked: Record<string, unknown>) => panel.postToPanel({
    command: 'dataOrgReadiness',
    objects: ['Account', 'Contact', 'OtherChildObject__c', 'Lead']
        .map(objectApiName => objectApiName === blocked.objectApiName ? { requiredLookups: [], ...blocked } : ready(objectApiName)),
    createTargets: [],
    requestSequence: 3,
    renderSequence: 1
});

const accountCard = (panel: Panel) => panel.treeCards().find((treeCard: any) => panel.findAll(treeCard, 'treeInsertControls').length > 0
    && panel.findAll(treeCard, 'treeTitle').concat(panel.findAll(treeCard, 'treeName')).some((titleElement: any) => /Account-thru-OtherChildObject__c/.test(titleElement.textContent)))
    ?? panel.treeCards()[0];
const partOf = (panel: Panel, rootElement: any, className: string) => panel.findAll(rootElement, className)[0];
const reasonLinkOf = (panel: Panel) => partOf(panel, accountCard(panel), 'treeInsertReasonLink');
const selectedTextOf = (panel: Panel, className: string) => panel.findAll(accountCard(panel), className)
    .find((tabElement: any) => tabElement.classList.contains('selected'))?.textContent;

const summary = {
    command: 'troubleshootingSummary', renderSequence: 1, treeKey: ACCOUNT_TREE_KEY,
    permissionSetCount: 1, customFieldCount: 6, standardFieldCount: 1, unreadableFieldCount: 0,
    globalValueSetCount: 1, missingGlobalValueSetCount: 0, recordTypeCount: 2
};

describe('RecipeCockpitService, a disabled insert links its reason to the fix (#539)', () => {

    it('links an object the org lacks to Troubleshooting › Fields, and focuses Deploy fields… once it can be clicked', () => {

        const panel = renderPanel();
        selectOrg(panel);
        postReadiness(panel, { objectApiName: 'OtherChildObject__c', disabledReason: 'OtherChildObject__c is not in this org (NOT_FOUND).', disabledReasonCode: 'objectNotInOrg' });

        const linkElement = reasonLinkOf(panel);
        expect(partOf(panel, accountCard(panel), 'treeInsert').disabled).toBe(true);
        expect(partOf(panel, accountCard(panel), 'treeInsertReason').textContent).toBe(`${RECIPE_COCKPIT_CANNOT_INSERT_PREFIX}OtherChildObject__c is not in this org (NOT_FOUND).`);
        expect(panel.isHidden(linkElement)).toBe(false);
        expect(linkElement.textContent).toBe('Troubleshooting › Fields');
        expect(linkElement.classList.contains('sdtButton-link')).toBe(true);

        const postedBefore = panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command !== 'savePlace' && hostMessage.command !== 'loadTroubleshootingSummary').length;
        linkElement.dispatch('click');

        expect(selectedTextOf(panel, 'treeTab')).toBe('Troubleshooting');
        expect(selectedTextOf(panel, 'troubleshootingSubTab')).toBe('Fields');
        const deployFieldsCard = partOf(panel, accountCard(panel), 'troubleshootingDeploy-fields');
        // NOT READ YET, SO DISABLED: A DISABLED BUTTON TAKES NO FOCUS, AND IT IS LEFT ON ITS SUB-TAB
        expect(deployFieldsCard.disabled).toBe(true);
        expect(panel.activeElement()).toBe(panel.findAll(accountCard(panel), 'troubleshootingSubTab').find((tabElement: any) => tabElement.textContent === 'Fields'));
        expect(deployFieldsCard.scrolledIntoViewCount).toBeGreaterThan(0);

        panel.postToPanel(summary);
        panel.findAll(accountCard(panel), 'treeTab').find((tabElement: any) => tabElement.textContent === 'Treecipe').dispatch('click');
        reasonLinkOf(panel).dispatch('click');

        expect(deployFieldsCard.disabled).toBe(false);
        expect(selectedTextOf(panel, 'troubleshootingSubTab')).toBe('Fields');
        expect(panel.activeElement()).toBe(deployFieldsCard);

        // NAVIGATION ONLY: NOTHING IS ASKED OF THE HOST BUT WHAT OPENING THE TAB ALWAYS ASKS
        expect(panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command !== 'savePlace' && hostMessage.command !== 'loadTroubleshootingSummary')).toHaveLength(postedBefore);

    });

    it('links an object the org will not create to Troubleshooting › Permissions and focuses Assign permission sets to me…', () => {

        const panel = renderPanel();
        selectOrg(panel);
        postReadiness(panel, { objectApiName: 'Contact', disabledReason: 'Contact is not createable in this org.', disabledReasonCode: 'objectNotCreateable' });

        expect(reasonLinkOf(panel).textContent).toBe('Troubleshooting › Permissions');
        reasonLinkOf(panel).dispatch('click');

        expect(selectedTextOf(panel, 'treeTab')).toBe('Troubleshooting');
        expect(selectedTextOf(panel, 'troubleshootingSubTab')).toBe('Permissions');
        expect(panel.activeElement()).toBe(partOf(panel, accountCard(panel), 'treePermissionSets'));

    });

    it('links an unticked required field to its own row on the Treecipe tab, matching the org\'s name case-insensitively', () => {

        const panel = renderPanel();
        selectOrg(panel);
        postReadiness(panel, {
            objectApiName: 'Contact',
            disabledReason: 'Contact has 1 unticked field this org requires: LastName. Tick it in the Treecipe tab to insert records.',
            disabledReasonCode: 'requiredFieldUnticked',
            disabledReasonFieldApiName: 'lastname'
        });

        expect(reasonLinkOf(panel).textContent).toBe(`${RECIPE_COCKPIT_INSERT_REASON_TREECIPE_LINK_PREFIX}Contact.LastName`);

        panel.findAll(accountCard(panel), 'treeTab').find((tabElement: any) => tabElement.textContent === 'Troubleshooting').dispatch('click');
        reasonLinkOf(panel).dispatch('click');

        expect(selectedTextOf(panel, 'treeTab')).toBe('Treecipe');
        const focused = panel.activeElement();
        expect(focused).toBeDefined();
        const fieldRow = panel.findAll(accountCard(panel), 'treeField').find((rowElement: any) => rowElement === focused || panel.findAll(rowElement, 'treeFieldInclude').includes(focused));
        expect(fieldRow).toBeDefined();
        expect(partOf(panel, fieldRow, 'treeFieldName').textContent).toBe('LastName');
        expect(panel.isHidden(fieldRow)).toBe(false);

    });

    it('shows the field even when its object\'s own Hide unselected or TODOs only hides it, and turns that filter off', () => {

        const panel = renderPanel(recipe => RecipeCockpitService.applyObjectSelections(
            recipe, new Map(), new Map([[ACCOUNT_TREE_KEY, new Map([['Contact', new Set(['LastName'])]])]])
        ));
        selectOrg(panel);
        const contact = panel.objectElements().find((objectElement: any) => panel.objectNameOf(objectElement) === 'Contact');
        panel.expandObject(contact);
        const hideElement = panel.findAll(panel.objectBodyOf(contact), 'treeHideUnselectedToggle')[0];
        hideElement.dispatch('click');
        expect(panel.visibleFieldNamesOf(contact)).not.toContain('LastName');

        postReadiness(panel, {
            objectApiName: 'Contact',
            disabledReason: 'Contact has 1 unticked field this org requires: LastName. Tick it in the Treecipe tab to insert records.',
            disabledReasonCode: 'requiredFieldUnticked',
            disabledReasonFieldApiName: 'LastName'
        });
        reasonLinkOf(panel).dispatch('click');

        expect(panel.visibleFieldNamesOf(contact)).toContain('LastName');
        expect(hideElement.attributes['aria-checked']).toBe('false');
        const fieldRow = panel.findAll(contact, 'treeField').find((rowElement: any) => partOf(panel, rowElement, 'treeFieldName').textContent === 'LastName');
        expect(panel.isHidden(fieldRow)).toBe(false);
        expect([fieldRow, ...panel.findAll(fieldRow, 'treeFieldInclude')]).toContain(panel.activeElement());

    });

    it('draws no link for a field the card does not list, an unknown code, or a reason with no code', () => {

        const panel = renderPanel();
        selectOrg(panel);

        [
            { objectApiName: 'Contact', disabledReason: 'Contact has 1 unticked field this org requires: Ghost__c.', disabledReasonCode: 'requiredFieldUnticked', disabledReasonFieldApiName: 'Ghost__c' },
            { objectApiName: 'Contact', disabledReason: 'Contact has 1 unticked field this org requires.', disabledReasonCode: 'requiredFieldUnticked' },
            { objectApiName: 'Contact', disabledReason: 'Contact is gone.', disabledReasonCode: 'objectGone' },
            { objectApiName: 'Contact', disabledReason: 'Contact is gone.', disabledReasonCode: '__proto__' },
            { objectApiName: 'Contact', disabledReason: 'WhatId is required and can point at more than one object (Account, Lead), so no parent can be chosen for it.' }
        ].forEach(blocked => {
            postReadiness(panel, blocked);
            expect(partOf(panel, accountCard(panel), 'treeInsertReason').textContent).toBe(`${RECIPE_COCKPIT_CANNOT_INSERT_PREFIX}${blocked.disabledReason}`);
            expect(panel.isHidden(reasonLinkOf(panel))).toBe(true);
            reasonLinkOf(panel).dispatch('click');
            expect(selectedTextOf(panel, 'treeTab')).toBe('Treecipe');
        });

    });

    it('removes the link when the reason clears or becomes one with no fix here, and never draws one with no org chosen', () => {

        const panel = renderPanel();
        panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: null, noOrgsMessage: '', renderSequence: 1 });
        expect(partOf(panel, accountCard(panel), 'treeInsert').disabled).toBe(false);
        expect(partOf(panel, accountCard(panel), 'treeInsertReason').textContent).toBe(RECIPE_COCKPIT_CHOOSE_INSERT_ORG_NOTE);
        expect(panel.isHidden(reasonLinkOf(panel))).toBe(true);

        selectOrg(panel);
        postReadiness(panel, { objectApiName: 'Contact', disabledReason: 'Contact is not createable in this org.', disabledReasonCode: 'objectNotCreateable' });
        expect(panel.isHidden(reasonLinkOf(panel))).toBe(false);

        postReadiness(panel, { objectApiName: 'Contact', disabledReason: '' });
        expect(partOf(panel, accountCard(panel), 'treeInsert').disabled).toBe(false);
        expect(panel.isHidden(reasonLinkOf(panel))).toBe(true);

        const productionPanel = renderPanel();
        selectOrg(productionPanel, 'qa is not a sandbox.');
        postReadiness(productionPanel, { objectApiName: 'Contact', disabledReason: 'Contact is not createable in this org.', disabledReasonCode: 'objectNotCreateable' });
        expect(partOf(productionPanel, accountCard(productionPanel), 'treeInsertReason').textContent).toBe(`${RECIPE_COCKPIT_CANNOT_INSERT_PREFIX}qa is not a sandbox.`);
        expect(productionPanel.isHidden(reasonLinkOf(productionPanel))).toBe(true);

    });

    it('names only Troubleshooting sub-tabs that exist, for every code but the field one', () => {

        const linkedCodes = Object.keys(RECIPE_COCKPIT_INSERT_REASON_TROUBLESHOOTING_LINKS);
        expect([...linkedCodes, 'requiredFieldUnticked'].sort()).toEqual([...RECIPE_COCKPIT_CREATE_REASON_CODES].sort());
        Object.values(RECIPE_COCKPIT_INSERT_REASON_TROUBLESHOOTING_LINKS).forEach(link => expect(RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS).toContain(link.subTab));

    });

});
