import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as path from 'path';

jest.mock('vscode', () => ({
    window: { createWebviewPanel: jest.fn(), withProgress: jest.fn(), showWarningMessage: jest.fn() },
    commands: { executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    ProgressLocation: { Notification: 15 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }) }
}), { virtual: true });

import {
    RecipeCockpitService,
    RECIPE_COCKPIT_ORG_CHOOSE_LABEL,
    RECIPE_COCKPIT_ORG_LOADING_PLACEHOLDER,
    RECIPE_COCKPIT_ORG_NONE_LISTED_PLACEHOLDER,
    RECIPE_COCKPIT_ORG_PICKER_NAME,
    RECIPE_COCKPIT_ORG_SEARCH_PLACEHOLDER,
    RECIPE_COCKPIT_ORG_UNSELECTED_LABEL
} from '../RecipeCockpitService';
import { RecipeCockpitTreecipeDataOrgs } from '../RecipeCockpitTreecipeDataOrgs';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import {
    chooseOrgOption,
    isOrgPickerOpen,
    optionIndexOf,
    orgOptionLabelsOf,
    orgPickerPopupOf,
    orgPickerSearchOf,
    orgPickerShapeOf,
    orgPickerTriggerOf,
    selectedOrgIndexOf,
    shownOptionElementsOf,
    shownOrgLabelOf,
    typeOrgSearch
} from './RecipeCockpitOrgPickerProbe';

/*
    #678: Target Org Manager's dropdown is searched or chosen from. It opens on a "Search for org"
    box, a line saying "or choose org", then every org as "alias -- instance url"; typing narrows
    the list without posting anything, and choosing still posts only the host's index.
*/
const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const TREE_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';

const QA_LABEL = 'qa -- https://acme--qa.sandbox.my.salesforce.com (default)';
const UAT_LABEL = 'uat -- https://acme--uat.sandbox.my.salesforce.com';
const SCRATCH_LABEL = 'test-active@example.com -- https://ability-active-3.scratch.my.salesforce.com';

function renderPickerPanel(orgPickerLabels: unknown = [QA_LABEL, UAT_LABEL, SCRATCH_LABEL], orgLabels: string[] = ['qa (default)', 'uat', 'test-active@example.com'], selectedOrgIndex: number | null = null) {

    const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
    const recipe = RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, TREE_RUN_FOLDER_NAME).recipeViewModel;
    const panel = runPanelScript();
    panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1 });
    panel.expandAllTrees();
    panel.postToPanel({ command: 'dataOrgList', orgLabels: orgLabels, orgPickerLabels: orgPickerLabels, selectedOrgIndex: selectedOrgIndex, noOrgsMessage: '', renderSequence: 1 });
    const pickerElement = panel.findAll(panel.cockpitBodyElement, 'dataOrgSelect')[0];
    return { panel, pickerElement };

}

const postedSelections = (panel: any) => panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'selectDataOrg');

describe('RecipeCockpitService, Target Org Manager\'s searchable org dropdown (#678)', () => {

    describe('what it shows', () => {

        it('is a combobox named for what it picks, collapsed, saying "Choose org…" until an org is chosen', () => {

            const { pickerElement } = renderPickerPanel();
            const triggerElement = orgPickerTriggerOf(pickerElement);

            expect(triggerElement.attributes.role).toBe('combobox');
            expect(triggerElement.attributes['aria-label']).toBe(RECIPE_COCKPIT_ORG_PICKER_NAME);
            expect(triggerElement.attributes['aria-haspopup']).toBe('listbox');
            expect(triggerElement.attributes['aria-expanded']).toBe('false');
            expect(shownOrgLabelOf(pickerElement)).toBe(RECIPE_COCKPIT_ORG_UNSELECTED_LABEL);
            expect(orgPickerPopupOf(pickerElement).classList.contains('hidden')).toBe(true);

        });

        it('opens on the "Search for org" box, then "or choose org", then every org as "alias -- instance url"', () => {

            const { panel, pickerElement } = renderPickerPanel();
            orgPickerTriggerOf(pickerElement).dispatch('click');

            const popupElement = orgPickerPopupOf(pickerElement);
            const [searchElement, chooseLineElement, listElement] = popupElement.children;
            expect(isOrgPickerOpen(pickerElement)).toBe(true);
            expect(searchElement.attributes.type).toBe('search');
            expect(searchElement.attributes.placeholder).toBe(RECIPE_COCKPIT_ORG_SEARCH_PLACEHOLDER);
            expect(chooseLineElement.textContent).toBe(RECIPE_COCKPIT_ORG_CHOOSE_LABEL);
            expect(listElement.attributes.role).toBe('listbox');
            expect(listElement.attributes.id).toBe(orgPickerTriggerOf(pickerElement).attributes['aria-controls']);
            expect(shownOptionElementsOf(pickerElement).map(optionElement => [optionElement.attributes.role, optionElement.textContent])).toEqual([
                ['option', QA_LABEL], ['option', UAT_LABEL], ['option', SCRATCH_LABEL]
            ]);
            expect(panel.activeElement()).toBe(searchElement);

        });

        it('shows the chosen org\'s "alias -- instance url" on the closed button, and marks it selected in the list', () => {

            const { pickerElement } = renderPickerPanel(undefined, undefined, 1);

            expect(shownOrgLabelOf(pickerElement)).toBe(UAT_LABEL);
            expect(selectedOrgIndexOf(pickerElement)).toBe(1);

        });

        it('falls back to the short labels when the picker labels are missing, not all strings, or a different number of orgs', () => {

            [null, 'not a list', [QA_LABEL, 42, SCRATCH_LABEL], [QA_LABEL]].forEach(orgPickerLabels => {
                const { pickerElement } = renderPickerPanel(orgPickerLabels);
                expect(orgOptionLabelsOf(pickerElement)).toEqual(['qa (default)', 'uat', 'test-active@example.com']);
            });

        });

        it('writes a label holding markup as text', () => {

            const { panel, pickerElement } = renderPickerPanel(['<img src=x onerror=alert(1)> -- https://x.my.salesforce.com'], ['<img src=x onerror=alert(1)>']);

            expect(orgOptionLabelsOf(pickerElement)).toEqual(['<img src=x onerror=alert(1)> -- https://x.my.salesforce.com']);
            typeOrgSearch(pickerElement, '<b>');
            expect(panel.findAll(pickerElement, 'sdtSearchableSelectNoMatch')[0].textContent).toBe('No org matches "<b>"');
            expect(panel.findAll(pickerElement, 'sdtSearchableSelectNoMatch')[0].children).toEqual([]);

        });

    });

    describe('search', () => {

        it('narrows the list, ignoring case, to orgs whose alias or instance URL holds what was typed, and posts nothing while typing', () => {

            const { panel, pickerElement } = renderPickerPanel();
            const postedBefore = panel.postedHostMessages.length;

            typeOrgSearch(pickerElement, 'UAT');
            expect(shownOptionElementsOf(pickerElement).map(optionElement => optionElement.textContent)).toEqual([UAT_LABEL]);

            typeOrgSearch(pickerElement, 'scratch.my');
            expect(shownOptionElementsOf(pickerElement).map(optionElement => optionElement.textContent)).toEqual([SCRATCH_LABEL]);

            typeOrgSearch(pickerElement, 'test-active');
            expect(shownOptionElementsOf(pickerElement).map(optionElement => optionElement.textContent)).toEqual([SCRATCH_LABEL]);

            typeOrgSearch(pickerElement, '');
            expect(shownOptionElementsOf(pickerElement)).toHaveLength(3);
            expect(panel.postedHostMessages.length).toBe(postedBefore);

        });

        it('says no org matches, and offers nothing to choose, when nothing does', () => {

            const { panel, pickerElement } = renderPickerPanel();

            typeOrgSearch(pickerElement, 'zzz');
            orgPickerSearchOf(pickerElement).dispatch('keydown', { key: 'Enter' });

            const noMatchElement = panel.findAll(pickerElement, 'sdtSearchableSelectNoMatch')[0];
            expect(panel.isHidden(noMatchElement)).toBe(false);
            expect(noMatchElement.textContent).toBe('No org matches "zzz"');
            expect(shownOptionElementsOf(pickerElement)).toEqual([]);
            expect(postedSelections(panel)).toEqual([]);
            expect(isOrgPickerOpen(pickerElement)).toBe(true);

        });

        it('keeps the host\'s index on an option the search leaves, and posts only that index when it is chosen', () => {

            const { panel, pickerElement } = renderPickerPanel();

            typeOrgSearch(pickerElement, 'scratch');
            expect(shownOptionElementsOf(pickerElement).map(optionIndexOf)).toEqual([2]);
            shownOptionElementsOf(pickerElement)[0].dispatch('click');

            expect(postedSelections(panel)).toEqual([{ command: 'selectDataOrg', orgIndex: 2 }]);
            expect(isOrgPickerOpen(pickerElement)).toBe(false);
            panel.postToPanel({ command: 'dataOrgSelection', orgIndex: 2, orgLabel: 'test-active@example.com', orgTypeLabel: 'Scratch org', isSandbox: true, failureMessage: '', requestSequence: 1, renderSequence: 1 });
            expect(shownOrgLabelOf(pickerElement)).toBe(SCRATCH_LABEL);

        });

        // THE HOST DROPS A CHOICE WITHOUT ANSWERING WHILE AN INSERT, A PROMPT OR AN ADAPTER UPDATE HOLDS THE ORG: THE BUTTON MUST NAME THE ORG WRITES STILL GO TO
        it('keeps naming the org the host holds until the host answers a choice, so a choice it drops never shows', () => {

            const { panel, pickerElement } = renderPickerPanel(undefined, undefined, 0);
            panel.postToPanel({ command: 'dataOrgSelection', orgIndex: 0, orgLabel: 'qa (default)', orgTypeLabel: 'Sandbox', isSandbox: true, failureMessage: '', requestSequence: 1, renderSequence: 1 });

            chooseOrgOption(pickerElement, UAT_LABEL);

            expect(postedSelections(panel)).toEqual([{ command: 'selectDataOrg', orgIndex: 1 }]);
            expect(shownOrgLabelOf(pickerElement)).toBe(QA_LABEL);
            expect(selectedOrgIndexOf(pickerElement)).toBe(0);

            panel.postToPanel({ command: 'dataOrgSelection', orgIndex: 1, orgLabel: 'uat', orgTypeLabel: 'Sandbox', isSandbox: true, failureMessage: '', requestSequence: 2, renderSequence: 1 });

            expect(shownOrgLabelOf(pickerElement)).toBe(UAT_LABEL);
            expect(selectedOrgIndexOf(pickerElement)).toBe(1);

        });

        it('starts each opening with an empty search and every org listed', () => {

            const { pickerElement } = renderPickerPanel();

            typeOrgSearch(pickerElement, 'uat');
            orgPickerSearchOf(pickerElement).dispatch('keydown', { key: 'Escape' });
            orgPickerTriggerOf(pickerElement).dispatch('click');

            expect(orgPickerSearchOf(pickerElement).value).toBe('');
            expect(shownOptionElementsOf(pickerElement)).toHaveLength(3);

        });

    });

    describe('the keyboard', () => {

        it('moves through the shown orgs with Up and Down, and Enter chooses the one highlighted', () => {

            const { panel, pickerElement } = renderPickerPanel();
            orgPickerTriggerOf(pickerElement).dispatch('keydown', { key: 'ArrowDown' });
            const searchElement = orgPickerSearchOf(pickerElement);

            expect(isOrgPickerOpen(pickerElement)).toBe(true);
            searchElement.dispatch('keydown', { key: 'ArrowDown' });
            searchElement.dispatch('keydown', { key: 'ArrowDown' });
            searchElement.dispatch('keydown', { key: 'ArrowDown' });
            searchElement.dispatch('keydown', { key: 'ArrowUp' });

            const highlightedOption = shownOptionElementsOf(pickerElement).find(optionElement => optionElement.classList.contains('highlighted'));
            expect(highlightedOption.textContent).toBe(UAT_LABEL);
            expect(searchElement.attributes['aria-activedescendant']).toBe(highlightedOption.attributes.id);

            searchElement.dispatch('keydown', { key: 'Enter' });

            expect(postedSelections(panel)).toEqual([{ command: 'selectDataOrg', orgIndex: 1 }]);
            expect(isOrgPickerOpen(pickerElement)).toBe(false);
            expect(panel.activeElement()).toBe(orgPickerTriggerOf(pickerElement));

        });

        it('closes on Tab with focus back on the dropdown, so Tab moves on from there', () => {

            const { panel, pickerElement } = renderPickerPanel();
            orgPickerTriggerOf(pickerElement).dispatch('click');
            orgPickerSearchOf(pickerElement).dispatch('keydown', { key: 'Tab' });

            expect(isOrgPickerOpen(pickerElement)).toBe(false);
            expect(panel.activeElement()).toBe(orgPickerTriggerOf(pickerElement));
            expect(postedSelections(panel)).toEqual([]);

        });

        it('puts focus back on the dropdown when a run closes it while the reader is typing', () => {

            const { panel, pickerElement } = renderPickerPanel();
            typeOrgSearch(pickerElement, 'ua');
            expect(panel.activeElement()).toBe(orgPickerSearchOf(pickerElement));

            panel.findAll(panel.cockpitBodyElement, 'dataOrgNewScratch')[0].dispatch('click');

            expect(isOrgPickerOpen(pickerElement)).toBe(false);
            expect(panel.activeElement()).toBe(orgPickerTriggerOf(pickerElement));

        });

        it('closes on Escape with the selection unchanged and focus back on the dropdown', () => {

            const { panel, pickerElement } = renderPickerPanel(undefined, undefined, 0);
            orgPickerTriggerOf(pickerElement).dispatch('click');
            orgPickerSearchOf(pickerElement).dispatch('keydown', { key: 'ArrowDown' });
            orgPickerSearchOf(pickerElement).dispatch('keydown', { key: 'Escape' });

            expect(isOrgPickerOpen(pickerElement)).toBe(false);
            expect(shownOrgLabelOf(pickerElement)).toBe(QA_LABEL);
            expect(postedSelections(panel)).toEqual([]);
            expect(panel.activeElement()).toBe(orgPickerTriggerOf(pickerElement));

        });

        it('closes when a click lands outside it, choosing nothing', () => {

            const { panel, pickerElement } = renderPickerPanel();
            orgPickerTriggerOf(pickerElement).dispatch('click');

            panel.cockpitBodyElement.dispatch('click');

            expect(isOrgPickerOpen(pickerElement)).toBe(false);
            expect(postedSelections(panel)).toEqual([]);

        });

    });

    describe('when there is nothing to choose', () => {

        it('does not open while the orgs are loading, when none is listed, or while a run holds it', () => {

            const { panel, pickerElement } = renderPickerPanel();

            panel.findAll(panel.cockpitBodyElement, 'dataOrgRefresh')[0].dispatch('click');
            expect(shownOrgLabelOf(pickerElement)).toBe(RECIPE_COCKPIT_ORG_LOADING_PLACEHOLDER);
            orgPickerTriggerOf(pickerElement).dispatch('click');
            expect(isOrgPickerOpen(pickerElement)).toBe(false);

            panel.postToPanel({ command: 'dataOrgList', orgLabels: [], orgPickerLabels: [], selectedOrgIndex: null, noOrgsMessage: 'No org.', renderSequence: 1 });
            expect(orgPickerShapeOf(pickerElement)).toEqual({ shown: RECIPE_COCKPIT_ORG_NONE_LISTED_PLACEHOLDER, options: [] });

            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['uat'], orgPickerLabels: [UAT_LABEL], selectedOrgIndex: null, noOrgsMessage: '', renderSequence: 1 });
            orgPickerTriggerOf(pickerElement).dispatch('click');
            expect(isOrgPickerOpen(pickerElement)).toBe(true);
            panel.findAll(panel.cockpitBodyElement, 'dataOrgNewScratch')[0].dispatch('click');

            expect(orgPickerTriggerOf(pickerElement).disabled).toBe(true);
            expect(isOrgPickerOpen(pickerElement)).toBe(false);
            orgPickerTriggerOf(pickerElement).dispatch('click');
            expect(isOrgPickerOpen(pickerElement)).toBe(false);
            expect(() => chooseOrgOption(pickerElement, UAT_LABEL)).toThrow('The org picker lists no');
            expect(postedSelections(panel)).toEqual([]);

        });

    });

    describe('the host\'s picker labels', () => {

        it.each([
            ['an alias and an instance URL', { targetOrgIdentifier: 'qa', username: 'qa@example.com.qa', alias: 'qa', instanceUrl: 'https://acme--qa.sandbox.my.salesforce.com' }, 'qa -- https://acme--qa.sandbox.my.salesforce.com'],
            ['no alias', { targetOrgIdentifier: 'qa@example.com.qa', username: 'qa@example.com.qa', instanceUrl: 'https://acme--qa.sandbox.my.salesforce.com' }, 'qa@example.com.qa -- https://acme--qa.sandbox.my.salesforce.com'],
            ['no instance URL', { targetOrgIdentifier: 'qa', username: 'qa@example.com.qa', alias: 'qa' }, 'qa'],
            ['the CLI\'s default org', { targetOrgIdentifier: 'qa', username: 'qa@example.com.qa', alias: 'qa', instanceUrl: 'https://acme--qa.sandbox.my.salesforce.com', isDefault: true }, 'qa -- https://acme--qa.sandbox.my.salesforce.com (default)'],
            ['the default org with no instance URL', { targetOrgIdentifier: 'qa', username: 'qa@example.com.qa', alias: 'qa', isDefault: true }, 'qa (default)']
        ])('labels an org with %s', (_caseName, orgDetail, expectedLabel) => {

            expect(RecipeCockpitTreecipeDataOrgs.buildDataOrgPickerLabel(orgDetail)).toBe(expectedLabel);

        });

        it('keeps every other label the alias alone', () => {

            expect(RecipeCockpitTreecipeDataOrgs.buildDataOrgListLabel({ targetOrgIdentifier: 'qa', username: 'qa@example.com.qa', alias: 'qa', instanceUrl: 'https://acme--qa.sandbox.my.salesforce.com', isDefault: true })).toBe('qa (default)');

        });

    });

});
