import * as path from 'path';

jest.mock('vscode', () => ({}), { virtual: true });

import { RecipeCockpitService } from '../RecipeCockpitService';
import { RecipeCockpitModelBuild } from '../RecipeCockpitModelBuild';
import { IRecipeCockpitRecipeViewModel } from '../RecipeCockpitViewModel';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { RECIPE_COCKPIT_PANEL_STYLESHEET } from '../RecipeCockpitPanelStylesheet.generated';

/*
    The panel half of "Customize and create new recipe" (#677), on the real panel script: the modal
    goes with the model it was opened on, a redraw leaves focus on the row the reader was on, and
    the name typed on the save step survives a preview landing.
*/

const HISTORY_FIXTURE_ROOT = path.join(__dirname, 'mocks', 'historyWorkspace');
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';

const loadRecipe = (): IRecipeCockpitRecipeViewModel => RecipeCockpitModelBuild.loadRecipeRunByRuns(
    RecipeCockpitModelBuild.findGeneratedRecipeRuns(path.join(HISTORY_FIXTURE_ROOT, 'treecipe', 'GeneratedRecipes')),
    HISTORY_FIXTURE_ROOT,
    'recipe-2026-09-20T10-00-00'
).recipeViewModel;

const openModal = () => {
    const panel = runPanelScript({});
    panel.postToPanel({ command: 'recipeData', recipe: loadRecipe(), renderSequence: 3 });
    panel.postToPanel({ command: 'rendered' });
    const accountCard = panel.treeCards()[0];
    panel.chooseTreeCard(accountCard);
    panel.findAll(accountCard, 'treeCustomize')[0].dispatch('click');
    return panel;
};

const buttonLabelled = (panel: ReturnType<typeof runPanelScript>, label: string) => [
    ...panel.findAll(panel.cockpitDialogHostElement, 'customTreecipeRemove'),
    ...panel.findAll(panel.cockpitDialogHostElement, 'customTreecipeRestore')
].find((buttonElement: any) => buttonElement.attributes['aria-label'] === label);

const lastPreviewRequest = (panel: ReturnType<typeof runPanelScript>) => [...panel.postedHostMessages].reverse().find((hostMessage: any) => hostMessage.command === 'previewCustomTreecipe');

type Panel = ReturnType<typeof runPanelScript>;

// THE HOST'S ANSWER TO THE LATEST CHANGE, WITH WHAT THE TEST SAYS ITS CASCADE TOOK
const answerLatestPreview = (panel: Panel, answer: Record<string, unknown> = {}) => panel.postToPanel({
    command: 'customTreecipePreview', renderSequence: 3, treeKey: ACCOUNT_TREE_KEY, previewSequence: lastPreviewRequest(panel).previewSequence,
    outOfRunExclusions: [], keptObjectCount: 3, objectCount: 3, folderName: `custom-${ACCOUNT_TREE_KEY}`,
    objectSelection: { exclusions: [], disabledLookups: [] }, ...answer
});

const objectRowOf = (panel: Panel, objectApiName: string) => panel.findAll(panel.cockpitDialogHostElement, 'customTreecipeObject')
    .find((rowElement: any) => panel.findAll(rowElement, 'customTreecipeObjectName')[0].textContent === objectApiName);

const fieldListOf = (panel: Panel, objectApiName: string) => panel.findAll(panel.cockpitDialogHostElement, 'customTreecipeFields')
    .find((listElement: any) => listElement.attributes['aria-label'] === `Fields of ${objectApiName}`);

const controlOf = (panel: Panel, objectApiName: string, className: string) => panel.findAll(objectRowOf(panel, objectApiName), className)[0];

// THE MODAL WITH ITS FIRST PREVIEW IN AND EVERY OBJECT OPEN, AS A READER WORKING THROUGH A WHOLE TREE HAS IT
const openModalWithEveryObjectOpen = () => {
    const panel = openModal();
    answerLatestPreview(panel);
    ['Account', 'OtherChildObject__c'].forEach(objectApiName => controlOf(panel, objectApiName, 'customTreecipeChevron').dispatch('click'));
    return panel;
};

const everyFieldList = (panel: Panel) => ['Account', 'Contact', 'OtherChildObject__c'].map(objectApiName => fieldListOf(panel, objectApiName));

describe('the "Customize and create new recipe" modal (#677)', () => {

    it('opens over the card and asks the host for its first preview', () => {

        const panel = openModal();

        expect(panel.findAll(panel.cockpitDialogHostElement, 'customTreecipeDialog')).toHaveLength(1);
        expect(lastPreviewRequest(panel)).toMatchObject({ treeKey: ACCOUNT_TREE_KEY, renderSequence: 3, previewSequence: 1, removedObjectApiNames: [], removedFields: [], outOfRunObjectApiNames: [] });

    });

    it('closes when a new model is drawn, so it never posts for a card that is gone', () => {

        const panel = openModal();

        panel.postToPanel({ command: 'recipeData', recipe: loadRecipe(), renderSequence: 4 });

        expect(panel.findAll(panel.cockpitDialogHostElement, 'customTreecipeDialog')).toEqual([]);

    });

    it('keeps focus on the row a ✕ was clicked on, now its ↺, rather than the top of the list', () => {

        const panel = openModal();
        const removeLastName = buttonLabelled(panel, 'Remove Contact.LastName from the new recipe');

        removeLastName.focus();
        removeLastName.dispatch('click');

        expect(panel.activeElement().attributes['aria-label']).toBe('Restore Contact.LastName');
        expect(lastPreviewRequest(panel).removedFields).toEqual([{ objectApiName: 'Contact', fieldApiName: 'LastName' }]);

    });

    it('keeps the name typed on the save step when a preview lands', () => {

        const panel = openModal();
        buttonLabelled(panel, 'Remove OtherChildObject__c from the new recipe').dispatch('click');
        panel.postToPanel({ command: 'customTreecipePreview', renderSequence: 3, treeKey: ACCOUNT_TREE_KEY, previewSequence: lastPreviewRequest(panel).previewSequence, outOfRunExclusions: [], keptObjectCount: 2, objectCount: 3, folderName: `custom-${ACCOUNT_TREE_KEY}`,
            objectSelection: { exclusions: [{ objectApiName: 'OtherChildObject__c', kind: 'excluded' }], disabledLookups: [] } });
        panel.findAll(panel.cockpitDialogHostElement, 'customTreecipeSave')[0].dispatch('click');

        const nameInput = panel.findAll(panel.cockpitDialogHostElement, 'customTreecipeNameInput')[0];
        nameInput.value = 'Accounts and contacts';
        nameInput.dispatch('input');
        panel.postToPanel({ command: 'customTreecipePreview', renderSequence: 3, treeKey: ACCOUNT_TREE_KEY, previewSequence: lastPreviewRequest(panel).previewSequence, outOfRunExclusions: [], keptObjectCount: 2, objectCount: 3, folderName: `custom-${ACCOUNT_TREE_KEY}`,
            objectSelection: { exclusions: [{ objectApiName: 'OtherChildObject__c', kind: 'excluded' }], disabledLookups: [] } });

        expect(panel.findAll(panel.cockpitDialogHostElement, 'customTreecipeNameInput')[0].value).toBe('Accounts and contacts');

    });

    it('rebuilds only the rows a change touched: a ✕ on a Contact field leaves Account\'s row the same element', () => {

        const panel = openModal();
        const objectRowNamed = (objectApiName: string) => panel.findAll(panel.cockpitDialogHostElement, 'customTreecipeObject')
            .find((rowElement: any) => panel.findAll(rowElement, 'customTreecipeObjectName')[0].textContent === objectApiName);
        const accountRowBefore = objectRowNamed('Account');
        const contactRowBefore = objectRowNamed('Contact');

        buttonLabelled(panel, 'Remove Contact.LastName from the new recipe').dispatch('click');

        expect(objectRowNamed('Account')).toBe(accountRowBefore);
        expect(objectRowNamed('Contact')).not.toBe(contactRowBefore);
        expect(buttonLabelled(panel, 'Restore Contact.LastName')).toBeDefined();

    });

    it('drops a preview for an older change', () => {

        const panel = openModal();
        buttonLabelled(panel, 'Remove OtherChildObject__c from the new recipe').dispatch('click');

        panel.postToPanel({ command: 'customTreecipePreview', renderSequence: 3, treeKey: ACCOUNT_TREE_KEY, previewSequence: 1, outOfRunExclusions: [], keptObjectCount: 3, objectCount: 3, refusal: 'stale' });

        expect(panel.findAll(panel.cockpitDialogHostElement, 'customTreecipeStatus')[0].textContent).not.toBe('stale');

    });

    describe('a field list is kept apart from its row, so the fields under a change are reused (#684)', () => {

        it('a chain toggle rebuilds the rows it changed and leaves every open field list the same element', () => {

            const panel = openModalWithEveryObjectOpen();
            const fieldListsBefore = everyFieldList(panel);
            const contactRowBefore = objectRowOf(panel, 'Contact');

            controlOf(panel, 'Contact', 'customTreecipeChain').dispatch('click');
            answerLatestPreview(panel, { outOfRunExclusions: [{ objectApiName: 'Contact', kind: 'excluded' }, { objectApiName: 'OtherChildObject__c', kind: 'autoExcluded' }] });

            expect(objectRowOf(panel, 'Contact')).not.toBe(contactRowBefore);
            expect(everyFieldList(panel)).toEqual(fieldListsBefore);
            everyFieldList(panel).forEach((listElement: any, listIndex: number) => expect(listElement).toBe(fieldListsBefore[listIndex]));

        });

        it('a field ✕ in a field list kept across a chain toggle still removes that field', () => {

            const panel = openModalWithEveryObjectOpen();
            controlOf(panel, 'Contact', 'customTreecipeChain').dispatch('click');
            answerLatestPreview(panel, { outOfRunExclusions: [{ objectApiName: 'Contact', kind: 'excluded' }] });

            buttonLabelled(panel, 'Remove Contact.LastName from the new recipe').dispatch('click');

            expect(lastPreviewRequest(panel)).toMatchObject({ removedFields: [{ objectApiName: 'Contact', fieldApiName: 'LastName' }], outOfRunObjectApiNames: ['Contact'] });
            expect(buttonLabelled(panel, 'Restore Contact.LastName')).toBeDefined();

        });

        it('↺ on a removed object puts its fields and its child\'s back as the elements they were', () => {

            const panel = openModalWithEveryObjectOpen();
            const fieldListsBefore = everyFieldList(panel);

            buttonLabelled(panel, 'Remove Contact from the new recipe').dispatch('click');
            answerLatestPreview(panel, { keptObjectCount: 1, objectSelection: { exclusions: [{ objectApiName: 'Contact', kind: 'excluded' }, { objectApiName: 'OtherChildObject__c', kind: 'autoExcluded' }], disabledLookups: [] } });
            expect(fieldListOf(panel, 'Contact')).toBeUndefined();
            expect(fieldListOf(panel, 'OtherChildObject__c')).toBeUndefined();

            buttonLabelled(panel, 'Restore Contact').dispatch('click');
            answerLatestPreview(panel);

            everyFieldList(panel).forEach((listElement: any, listIndex: number) => expect(listElement).toBe(fieldListsBefore[listIndex]));

        });

        it('a lookup the cascade cuts, then gives back, rebuilds only the field list that holds it', () => {

            const panel = openModalWithEveryObjectOpen();
            const [accountFieldsBefore, contactFieldsBefore, otherChildFieldsBefore] = everyFieldList(panel);

            buttonLabelled(panel, 'Remove Contact.LastName from the new recipe').dispatch('click');
            answerLatestPreview(panel, { objectSelection: { exclusions: [], disabledLookups: [{ objectApiName: 'OtherChildObject__c', fieldApiName: 'Contact__c' }] } });

            expect(fieldListOf(panel, 'Account')).toBe(accountFieldsBefore);
            expect(fieldListOf(panel, 'Contact')).not.toBe(contactFieldsBefore);
            const otherChildFieldsWhileCut = fieldListOf(panel, 'OtherChildObject__c');
            expect(otherChildFieldsWhileCut).not.toBe(otherChildFieldsBefore);
            expect(panel.findAll(otherChildFieldsWhileCut, 'customTreecipeField').some((fieldElement: any) => fieldElement.className.includes('isCut'))).toBeTrue();

            buttonLabelled(panel, 'Restore Contact.LastName').dispatch('click');
            answerLatestPreview(panel);

            expect(fieldListOf(panel, 'Account')).toBe(accountFieldsBefore);
            expect(fieldListOf(panel, 'OtherChildObject__c')).not.toBe(otherChildFieldsWhileCut);
            expect(panel.findAll(fieldListOf(panel, 'OtherChildObject__c'), 'customTreecipeField').some((fieldElement: any) => fieldElement.className.includes('isCut'))).toBeFalse();

        });

        it('a preview whose refusal drops a lock rebuilds that object\'s field list and no other', () => {

            const panel = openModalWithEveryObjectOpen();
            buttonLabelled(panel, 'Remove Contact.LastName from the new recipe').dispatch('click');
            answerLatestPreview(panel, { fieldSelection: { objects: [{ objectApiName: 'Account', lockedFields: [{ fieldApiName: 'ParentId', reason: 'a record type field' }] }] } });
            const [accountFieldsLocked, contactFields, otherChildFields] = everyFieldList(panel);

            buttonLabelled(panel, 'Restore Contact.LastName').dispatch('click');
            const contactFieldsRestored = fieldListOf(panel, 'Contact');
            answerLatestPreview(panel, { refusal: 'Account-thru-OtherChildObject__c could not be read: ENOENT.' });

            expect(fieldListOf(panel, 'Account')).not.toBe(accountFieldsLocked);
            expect(fieldListOf(panel, 'Contact')).toBe(contactFieldsRestored);
            expect(fieldListOf(panel, 'OtherChildObject__c')).toBe(otherChildFields);
            expect(contactFieldsRestored).not.toBe(contactFields);

        });

        it('closing one object takes its field list out and leaves every other row and list where it was', () => {

            const panel = openModalWithEveryObjectOpen();
            const [accountFieldsBefore, , otherChildFieldsBefore] = everyFieldList(panel);
            const accountRowBefore = objectRowOf(panel, 'Account');
            const bodyElement = panel.findAll(panel.cockpitDialogHostElement, 'customTreecipeBody')[0];

            controlOf(panel, 'Contact', 'customTreecipeChevron').dispatch('click');

            expect(fieldListOf(panel, 'Contact')).toBeUndefined();
            expect(objectRowOf(panel, 'Account')).toBe(accountRowBefore);
            expect(fieldListOf(panel, 'Account')).toBe(accountFieldsBefore);
            expect(fieldListOf(panel, 'OtherChildObject__c')).toBe(otherChildFieldsBefore);
            expect(bodyElement.children).toEqual([accountRowBefore, accountFieldsBefore, objectRowOf(panel, 'Contact'), objectRowOf(panel, 'OtherChildObject__c'), otherChildFieldsBefore]);

        });

        it('the root\'s confirmation comes and goes above the rows without rebuilding any of them', () => {

            const panel = openModalWithEveryObjectOpen();
            const bodyElement = panel.findAll(panel.cockpitDialogHostElement, 'customTreecipeBody')[0];
            const rowsBefore = [...bodyElement.children];

            buttonLabelled(panel, 'Remove Account from the new recipe').dispatch('click');

            expect(bodyElement.children.slice(1)).toEqual(rowsBefore);
            bodyElement.children.slice(1).forEach((element: any, elementIndex: number) => expect(element).toBe(rowsBefore[elementIndex]));

            panel.findAll(bodyElement, 'customTreecipeKeepRoot')[0].dispatch('click');

            expect(bodyElement.children).toHaveLength(rowsBefore.length);
            bodyElement.children.forEach((element: any, elementIndex: number) => expect(element).toBe(rowsBefore[elementIndex]));

        });

        it('the save step and Back add and take away the form below the rows without rebuilding any of them', () => {

            const panel = openModalWithEveryObjectOpen();
            buttonLabelled(panel, 'Remove Contact.LastName from the new recipe').dispatch('click');
            answerLatestPreview(panel);
            const bodyElement = panel.findAll(panel.cockpitDialogHostElement, 'customTreecipeBody')[0];
            const rowsBefore = [...bodyElement.children];

            panel.findAll(panel.cockpitDialogHostElement, 'customTreecipeSave')[0].dispatch('click');

            expect(bodyElement.children).toHaveLength(rowsBefore.length + 1);
            rowsBefore.forEach((element: any, elementIndex: number) => expect(bodyElement.children[elementIndex]).toBe(element));

            panel.findAll(bodyElement, 'customTreecipeBack')[0].dispatch('click');

            expect(bodyElement.children).toHaveLength(rowsBefore.length);
            rowsBefore.forEach((element: any, elementIndex: number) => expect(bodyElement.children[elementIndex]).toBe(element));

        });

        it('focus on a control in a row a redraw kept stays on that very element', () => {

            const panel = openModalWithEveryObjectOpen();
            const accountChain = controlOf(panel, 'Account', 'customTreecipeChain');
            buttonLabelled(panel, 'Remove Contact.LastName from the new recipe').dispatch('click');
            accountChain.focus();

            answerLatestPreview(panel);

            expect(controlOf(panel, 'Account', 'customTreecipeChain')).toBe(accountChain);
            expect(panel.activeElement()).toBe(accountChain);

        });

    });

    describe('a field list the browser has not drawn yet is about as tall as its fields (#693)', () => {

        const FIELD_LIST_RULE_PATTERN = /\.treeFieldsBox\.customTreecipeFields\.fieldCountUpTo(\d+) \{ contain-intrinsic-size: auto ([\d.]+)rem; \}/g;
        const sizeRulesInStylesheet = () => [...RECIPE_COCKPIT_PANEL_STYLESHEET.matchAll(FIELD_LIST_RULE_PATTERN)]
            .map(ruleMatch => ({ fieldCount: Number(ruleMatch[1]), heightRem: Number(ruleMatch[2]) }));

        it('lays out only the lists near the view, and never lets the body\'s column squeeze one it skipped', () => {

            expect(RECIPE_COCKPIT_PANEL_STYLESHEET).toMatch(/\.treeFieldsBox\.customTreecipeFields \{[^}]*content-visibility: auto;[^}]*contain-intrinsic-size: auto [\d.]+rem;[^}]*flex-shrink: 0;[^}]*\}/);

        });

        it('has a size rule for each power of 2 from 8 to 1024 fields, each 2.35rem a field', () => {

            expect(sizeRulesInStylesheet()).toEqual([8, 16, 32, 64, 128, 256, 512, 1024].map(fieldCount => ({ fieldCount: fieldCount, heightRem: Number((fieldCount * 2.35).toFixed(2)) })));

        });

        it('gives each list the smallest size class that holds its fields, kept when the list is reused', () => {

            const panel = openModalWithEveryObjectOpen();
            const sizeFieldCounts = sizeRulesInStylesheet().map(sizeRule => sizeRule.fieldCount);
            const sizeClassOf = (listElement: any) => listElement.className.split(' ').filter((className: string) => className.startsWith('fieldCountUpTo'));

            everyFieldList(panel).forEach((listElement: any) => {
                const fieldCount = panel.findAll(listElement, 'customTreecipeField').length;
                expect(sizeClassOf(listElement)).toEqual([`fieldCountUpTo${sizeFieldCounts.find(sizeFieldCount => fieldCount <= sizeFieldCount)}`]);
            });

            const accountFieldsBefore = fieldListOf(panel, 'Account');
            controlOf(panel, 'Contact', 'customTreecipeChain').dispatch('click');
            answerLatestPreview(panel, { outOfRunExclusions: [{ objectApiName: 'Contact', kind: 'excluded' }] });

            expect(fieldListOf(panel, 'Account')).toBe(accountFieldsBefore);
            expect(sizeClassOf(fieldListOf(panel, 'Account'))).toHaveLength(1);

        });

    });

});
