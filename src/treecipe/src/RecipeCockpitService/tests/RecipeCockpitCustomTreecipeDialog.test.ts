import * as path from 'path';

jest.mock('vscode', () => ({}), { virtual: true });

import { IRecipeCockpitRecipeViewModel, RecipeCockpitService } from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';

/*
    The panel half of "Customize and create new recipe" (#677), on the real panel script: the modal
    goes with the model it was opened on, a redraw leaves focus on the row the reader was on, and
    the name typed on the save step survives a preview landing.
*/

const HISTORY_FIXTURE_ROOT = path.join(__dirname, 'mocks', 'historyWorkspace');
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';

const loadRecipe = (): IRecipeCockpitRecipeViewModel => RecipeCockpitService.loadRecipeRunByRuns(
    RecipeCockpitService.findGeneratedRecipeRuns(path.join(HISTORY_FIXTURE_ROOT, 'treecipe', 'GeneratedRecipes')),
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

    it('drops a preview for an older change', () => {

        const panel = openModal();
        buttonLabelled(panel, 'Remove OtherChildObject__c from the new recipe').dispatch('click');

        panel.postToPanel({ command: 'customTreecipePreview', renderSequence: 3, treeKey: ACCOUNT_TREE_KEY, previewSequence: 1, outOfRunExclusions: [], keptObjectCount: 3, objectCount: 3, refusal: 'stale' });

        expect(panel.findAll(panel.cockpitDialogHostElement, 'customTreecipeStatus')[0].textContent).not.toBe('stale');

    });

});
