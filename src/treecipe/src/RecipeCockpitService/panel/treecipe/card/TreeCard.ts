import { createButton, createElement } from '../../../../CockpitKit/panel/CockpitPanelElements';
import { RECIPE_COCKPIT_FAVORITE_TREE_LABEL, RECIPE_COCKPIT_NOT_FAVORITE_TREE_LABEL } from '../../../RecipeCockpitDatasetsTabConstants';
import { RECIPE_COCKPIT_RESET_SELECTION_LABEL } from '../../../RecipeCockpitFieldRowsConstants';
import { RECIPE_COCKPIT_NO_FAVORITES_MESSAGE } from '../../../RecipeCockpitNavigationConstants';
import { RECIPE_COCKPIT_TREE_NAME_MAX_LENGTH } from '../../../RecipeCockpitShellConstants';
import { buildPencilGlyph } from '../../RecipeCockpitPanelBuilders';
import { vscodeApi } from '../../RecipeCockpitPanelConnection';
import { drawHelpSummary } from '../../shell/Help';
import { findTreeState, renderedSequence, treeStates, treesViewElement } from '../../shell/PanelRender';
import { buildTreeInsertElement, drawTreeInsert } from '../dataOrg/TreeInsert';
import { buildWireAllLookupsElement } from '../fieldEditor/LookupWiring';
import { drawResetSelection } from '../fieldRows/FieldRow';
import { drawObjectSelection } from '../fieldRows/SelectionCascade';
import { navigationState } from '../navigation/NavigationState';
import { buildTreePicker, displayTitleOf } from '../navigation/TreePicker';
import { applyTreecipesSearch, buildTreecipesSearch } from '../navigation/TreecipesSearch';
import { indexRecordTypeFields } from '../recordTypes/RecordTypeFieldsToggle';
import { recordTypesState } from '../recordTypes/RecordTypesState';
import { buildCustomizeTreeButton } from '../customTreecipe/CustomTreecipeDialog';
import { RECIPE_COCKPIT_CUSTOM_TREECIPE_COPY_LABEL_PREFIX } from '../../../RecipeCockpitCustomTreecipeConstants';
import { buildNameEditor } from './NameEditor';
import { buildTreeObjectState, resolveTreeObject } from './TreeObjectRow';
import type { CardTreeState, ICardModel, ICardObject, ICardTree } from './CardTypes';

/*
    The tree cards of the Treecipes section (#173, #374): one card per relationship tree, each with
    its header -- favorite, rename, name, folder and count -- and a body its first open builds.
*/

export function renderTrees(recipe: ICardModel): void {

    // KEYED BY NAMES FROM THE WRAPPER ON DISK -- "__proto__" MUST BE A KEY, NOT A NEW PROTOTYPE
    const objectsByApiName: Record<string, ICardObject> = Object.create(null);
    recipe.objects.forEach(function (object) { objectsByApiName[object.objectApiName] = object; });
    recordTypesState.recordTypeFieldsByObjectApiName = indexRecordTypeFields(recipe.objects);

    const trees = recipe.trees || [];
    const viewElement = treesViewElement as HTMLElement;

    if (trees.length === 0) {
        viewElement.appendChild(createElement('div', 'emptyState', 'This run has no relationship trees to show. Run "Generate Treecipe" again to draw its objects in relationship trees.'));
        return;
    }

    const recordTypeObjects = recipe.objects.filter(function (object) { return Array.isArray(object.recordTypes) && object.recordTypes.length > 0; });
    recordTypeObjects.forEach(function (object) {
        recordTypesState.recordTypeChoices[object.objectApiName] = (object.generatedRecordTypeDeveloperNames || []).slice();
    });
    recordTypesState.recordTypeObjects = recordTypeObjects as unknown as typeof recordTypesState.recordTypeObjects;

    trees.forEach(function (tree) { renderTree(tree, objectsByApiName); });

    // THE SECTION SEARCH, ITS RESULTS AND THE DROPDOWN, ABOVE THE ONE CARD DRAWN (#374)
    const controlsElement = navigationState.treecipesControlsElement;
    if (controlsElement) {
        const search = buildTreecipesSearch();
        controlsElement.appendChild(search.element);
        controlsElement.appendChild(search.resultsElement);
        controlsElement.appendChild(buildTreePicker(trees));
        navigationState.treePickerObjectsElement = createElement('div', 'treePickerObjects hidden');
        controlsElement.appendChild(navigationState.treePickerObjectsElement);
    }

    navigationState.noFavoritesElement = createElement('div', 'emptyState hidden', RECIPE_COCKPIT_NO_FAVORITES_MESSAGE);
    viewElement.appendChild(navigationState.noFavoritesElement);
    applyTreecipesSearch();

}

function renderTree(tree: ICardTree, objectsByApiName: Record<string, ICardObject>): void {

    // HIDDEN UNTIL THE DROPDOWN CHOOSES IT (#374); ITS HEADER NO LONGER FOLDS IT
    const treeElement = createElement('div', 'treeCard hidden');
    const treeHeaderElement = createElement('div', 'treeHeader');

    // ONE OBJECT THAT IS EVERY TAB'S VIEW OF THE CARD
    const treeState = {
        tree: tree,
        objectStates: tree.objects
            .map(function (treeObject) { return { treeObject: treeObject, object: resolveTreeObject(treeObject, objectsByApiName) }; })
            .filter(function (resolved) { return resolved.object !== null; })
            .map(function (resolved) { return buildTreeObjectState(resolved.treeObject, resolved.object as ICardObject, tree); }),
        isBodyBuilt: false,
        isExpanded: false,
        element: treeElement,
        bodyElement: createElement('div', 'treeBody hidden'),
        searchQueries: { treecipe: '', datasets: '', troubleshooting: '', query: '', updater: '' },
        // WHAT THE READER TYPED IN EACH BOX, AS TYPED -- searchQueries IS ITS TRIMMED, LOWERCASED FORM
        searchTexts: { treecipe: '', datasets: '', troubleshooting: '', query: '', updater: '' },
        // THE TREECIPE UPDATER TAB (#415): CHOSEN FIELDS BY OBJECT AND FIELD NAME, AND OBJECTS THE READER OPENED, BOTH NAME-KEYED
        updaterChosenFieldKeys: Object.create(null),
        isFieldChoiceOffered: false,
        updaterExpandedObjectKeys: Object.create(null),
        updaterObjectStates: null,
        // THE ADAPTER'S STEP (#443): 'parent' (STEP 1) OR 'structure' (STEP 2), THE PARENT IT CHOSE AND ITS WHERE, ALL KEPT IN THE PLACE
        updaterStep: 'parent',
        updaterParentObjectApiName: '',
        updaterParentWhereText: '',
        // THE READER'S WHERE PER DESCENDANT OBJECT (#416), BY OBJECT NAME; PANEL-ONLY, NEVER SAVED IN THE PLACE
        updaterWhereTexts: Object.create(null),
        updaterRecordsMessage: null,
        updaterNewRecordsMessages: Object.create(null),
        // WHAT THE LAST "Retrieve latest metadata" FOUND (#445), DRAWN ON STEP 2 WHENEVER IT IS BUILT
        adapterChangesMessage: null,
        // THE NEW CHILD OBJECT BEING ADDED UNDER THE LOADED RECORDS (#447), ITS BLOCK'S STATE AND ELEMENTS
        adapterChild: null,
        adapterChildBlockMessage: null,
        adapterChildPreviewMessage: null,
        // A VALUE OR EXPRESSION TYPED PER FIELD IN THE UPDATER'S EDITOR (#417), BY FIELD KEY; PANEL-ONLY, NEVER SAVED IN THE PLACE OR THE RECIPE
        updaterEditedValues: Object.create(null),
        isDatasetFavoritesOnly: false,
        expandedJourneyDatasetFolderNames: Object.create(null),
        datasetFavoritesToggleElement: null,
        isRecordTypeFieldsOnly: false,
        recordTypeFieldsToggleElement: null,
        isTodosOnly: false,
        todosToggleElement: null,
        // THE TOP OF THE TREECIPE TAB (#255), MADE WITH THE TAB
        resetSelectionElement: null,
        insert: null,
        // WHICH ROW OWNS EACH NICKNAME AND WHICH FIELDS POINT TO IT (#380), BUILT WITH THE TREECIPE TAB OR FIRST ASKED FOR BY A FRIEND CHIP (#411)
        nicknameIndex: null,
        // WHICH PARENTS EACH FRIEND ROW NAMES AND ITS NUMBER AMONG THEIR FRIENDS (#411)
        friendIndex: null
    } as unknown as CardTreeState;

    treeState.objectStates.forEach(function (treeObjectState) { treeObjectState.treeState = treeState; });

    // AN OBJECT AND ITS FIELDS ARE COUNTED ONCE, HOWEVER MANY OCCURRENCES OF IT THE CARD DRAWS
    const objectStatesCounted = treeState.objectStates.filter(function (treeObjectState) { return !treeObjectState.isIteration; });
    const treeFieldCount = objectStatesCounted.reduce(function (fieldCount, treeObjectState) { return fieldCount + treeObjectState.fieldStates.length; }, 0);

    /*
        The actions sit at the START of the row, before the name they rename (#540). The click is
        stopped on the GROUP rather than on each button, because a browser may hand a click on a
        DISABLED button -- a rename while a write runs -- to its ancestors without running the
        button's own listener. Only a card with a folder has them: the name and the favorite are
        kept by folder, and the ungrouped card has none.
    */
    if (tree.folderName) {

        const actionsElement = createElement('span', 'treeHeaderActions');
        actionsElement.addEventListener('click', function (event) { event.stopPropagation(); });

        treeState.favoriteElement = createButton('secondary', 'treeFavorite');
        treeState.favoriteElement.addEventListener('click', function () {
            vscodeApi.postMessage({ command: 'toggleFavoriteTree', treeKey: tree.treeKey });
        });
        actionsElement.appendChild(treeState.favoriteElement);

        treeState.renameElement = createButton('secondary', 'treeRename');
        treeState.renameElement.appendChild(buildPencilGlyph('large'));
        actionsElement.appendChild(treeState.renameElement);

        treeHeaderElement.appendChild(actionsElement);

    }

    treeState.titleElement = createElement('span', 'treeTitle', displayTitleOf(tree));
    treeHeaderElement.appendChild(treeState.titleElement);

    treeState.nameEditor = null;
    if (tree.folderName) {
        treeState.nameEditor = buildNameEditor({
            nameTarget: 'tree',
            nameKey: tree.treeKey,
            maxLength: RECIPE_COCKPIT_TREE_NAME_MAX_LENGTH,
            openerElement: treeState.renameElement as HTMLButtonElement,
            displayElement: treeState.titleElement,
            placeholderText: tree.folderName,
            readCustomName: function () { return treeState.tree.customName || ''; },
            readDisplayName: function () { return displayTitleOf(treeState.tree); },
            onClose: function () { treeState.titleElement.classList.remove('hidden'); }
        });
    }

    // THE DEFAULT TITLE IS THE FOLDER (#389), SO THE FOLDER IS REPEATED ONLY UNDER A NAME THE READER GAVE IT
    treeState.folderElement = null;
    if (tree.folderName) {
        treeState.folderElement = createElement('span', 'treeFolder muted' + (tree.customName ? '' : ' hidden'), tree.folderName);
        treeHeaderElement.appendChild(treeState.folderElement);
    }

    // A CUSTOM TREE (#677) SAYS WHICH TREE IT WAS COPIED FROM
    if (tree.customCopyOf) {
        treeHeaderElement.appendChild(createElement('span', 'treeCustomCopyOf muted', RECIPE_COCKPIT_CUSTOM_TREECIPE_COPY_LABEL_PREFIX + tree.customCopyOf));
    }

    treeState.countedObjectCount = objectStatesCounted.length;
    treeState.countedFieldCount = treeFieldCount;
    treeState.countElement = createElement('span', 'treeCount muted');
    treeHeaderElement.appendChild(treeState.countElement);
    drawObjectSelection(treeState);

    // ITS NAME AND STAR ARE DRAWN ONCE THE FOLDER AND COUNT ARE IN PLACE
    if (tree.folderName) { drawTreeName(treeState); }

    treeElement.appendChild(treeHeaderElement);
    treeElement.appendChild(treeState.bodyElement);
    ( treesViewElement as HTMLElement ).appendChild(treeElement);

    treeStates.push(treeState);

}

// THE HEADER'S NAME AND STAR, DRAWN AT FIRST AND AGAIN WHEN THE HOST SAYS EITHER CHANGED
function drawTreeName(treeState: CardTreeState): void {

    const tree = treeState.tree;
    const displayTitle = displayTitleOf(tree);

    treeState.titleElement.textContent = displayTitle;
    treeState.element.setAttribute('aria-label', displayTitle);

    if (treeState.folderElement) {
        if (tree.customName) { treeState.folderElement.classList.remove('hidden'); } else { treeState.folderElement.classList.add('hidden'); }
    }

    if (treeState.favoriteElement) {
        treeState.favoriteElement.textContent = tree.isFavorite ? RECIPE_COCKPIT_FAVORITE_TREE_LABEL : RECIPE_COCKPIT_NOT_FAVORITE_TREE_LABEL;
        treeState.favoriteElement.setAttribute('aria-pressed', tree.isFavorite ? 'true' : 'false');
        treeState.favoriteElement.setAttribute('aria-label', (tree.isFavorite ? 'Remove ' + displayTitle + ' from favorites' : 'Mark ' + displayTitle + ' as a favorite'));
        treeState.favoriteElement.setAttribute('title', tree.isFavorite ? 'Remove from favorites' : 'Mark as a favorite');
    }

    if (treeState.renameElement) {
        treeState.renameElement.setAttribute('aria-label', 'Rename ' + displayTitle);
        treeState.renameElement.setAttribute('title', 'Rename this tree');
    }

    if (treeState.insert) {
        drawTreeInsert(treeState);
    }

}

interface ITreePreferencesMessage {
    renderSequence?: unknown;
    trees?: unknown;
}

interface ITreePreference {
    treeKey: string;
    customName?: unknown;
    isFavorite?: unknown;
}

// ONLY FOR THE MODEL ON SCREEN: A NEWER ONE WAS BUILT FROM THE PREFERENCES THIS UPDATE REPORTS
export function renderTreePreferences(treePreferencesMessage: ITreePreferencesMessage): void {

    if (renderedSequence === null || treePreferencesMessage.renderSequence !== renderedSequence || !Array.isArray(treePreferencesMessage.trees)) { return; }

    (treePreferencesMessage.trees as ITreePreference[]).forEach(function (treePreference) {

        const treeState = findTreeState(treePreference.treeKey);
        if (!treeState) { return; }

        treeState.tree.customName = typeof treePreference.customName === 'string' ? treePreference.customName : undefined;
        treeState.tree.isFavorite = treePreference.isFavorite === true;
        drawTreeName(treeState);

    });

    drawHelpSummary();
    // A NEW NAME OR STAR IS WHAT THE SECTION SEARCH AND THE DROPDOWN MATCH AND LIST, SO THE INDEX IS BUILT AGAIN
    navigationState.treecipesSearchIndex = null;
    applyTreecipesSearch();

}

/*
    The top of a card's Treecipe tab: "Generate fake data and insert into <org>" with Reset
    Selections to its right (#539). The org picker is the panel's Target Org Manager section since #348, not a view per card. Each posts
    the tree's KEY alone; which org, which recipe file, which counts and which objects are the
    host's.
*/
export function buildTreecipeHeader(treeState: CardTreeState): HTMLElement {

    const tree = treeState.tree;
    const headerElement = createElement('div', 'treecipeHeader');
    const actionsElement = createElement('div', 'treecipeActions');

    if (tree.folderName) {
        const resetSelectionElement = createButton('secondary', 'treeResetSelection hidden', RECIPE_COCKPIT_RESET_SELECTION_LABEL);
        treeState.resetSelectionElement = resetSelectionElement;
        resetSelectionElement.setAttribute('title', 'Include every object, tick every field and set every count back to the recipe\'s own');
        resetSelectionElement.addEventListener('click', function () {
            vscodeApi.postMessage({ command: 'resetTreeSelection', treeKey: tree.treeKey });
        });
        // BESIDE THE INSERT ON A CARD THAT HAS ONE (#539)
        if (!tree.runFakerRecipeFileName) { actionsElement.appendChild(resetSelectionElement); }
        drawResetSelection(treeState);
    }

    const customizeElement = buildCustomizeTreeButton(treeState);
    if (customizeElement) {
        actionsElement.appendChild(customizeElement);
    }

    const wireAllLookupsElement = buildWireAllLookupsElement(tree);
    if (wireAllLookupsElement) {
        actionsElement.appendChild(wireAllLookupsElement);
    }

    headerElement.appendChild(actionsElement);

    if (tree.runFakerRecipeFileName) {
        headerElement.appendChild(buildTreeInsertElement(treeState));
    }

    drawTreeName(treeState);

    return headerElement;

}

export function versionLabelOf(treeStateView: { tree: object }, runFolderName: string | null): string {

    // A CARD WITH NO HISTORY STILL DRAWS TROUBLESHOOTING, AND ITS HISTORY SUB-TAB (#485) NAMES RUNS TOO
    const tree = treeStateView.tree as ICardTree;
    const versions = tree.history && Array.isArray(tree.history.versions) ? tree.history.versions : [];
    const version = runFolderName === null ? null : versions.find(function (candidateVersion) {
        return candidateVersion.runFolderName === runFolderName;
    });

    if (!version) { return 'version unknown'; }

    return version.isCurrent ? 'current version' : 'version of ' + version.generatedAtLabel;

}
