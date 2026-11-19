import { releaseTreePickerObjectsList } from './TreePicker';
import type { IOpenReferenceMenu, ITreecipesSearch, ITreecipesSearchTree, ScriptTreeState } from './NavigationTypes';

/*
    The Treecipes section draws ONE card, chosen in its dropdown (#374). Every card stays in the
    document, hidden, so switching back finds its tab, searches and opened objects as they were,
    and an in-place update reaches a card whether or not it is on screen. The section search
    matches what the model carries; its index is lowercased once per model, on the first query.

    The choice, Favorites only and the search text are the reader's place and outlive a model; the
    rest belongs to one model, and resetNavigationState empties it before the next is drawn.
*/
export const navigationState = {
    // WHETHER ONLY FAVORITE CARDS ARE SHOWN (#235); A RELOAD AFTER RUN FAKER KEEPS THE READER'S VIEW
    isFavoritesOnly: false,
    selectedTreeKey: null as string | null,
    treecipesSearchText: '',
    favoritesToggleElement: null as HTMLButtonElement | null,
    favoritesCountElement: null as HTMLElement | null,
    noFavoritesElement: null as HTMLElement | null,
    treecipesControlsElement: null as HTMLElement | null,
    treePickerElement: null as HTMLSelectElement | null,
    treePickerTreeStates: [] as ScriptTreeState[],
    treePickerObjectsElement: null as HTMLElement | null,
    isTreePickerObjectsExpanded: false,
    treePickerShownTreeState: null as ScriptTreeState | null,
    treecipesSearch: null as ITreecipesSearch | null,
    treecipesSearchIndex: null as ITreecipesSearchTree[] | null,
    // TREE KEY -> true FOR A CARD THE SECTION SEARCH MATCHED, OR null WHILE THERE IS NO SEARCH; KEYED BY FOLDER NAMES, SO NO PROTOTYPE
    treecipesMatchedTreeKeys: null as Record<string, true> | null,
    // THE ONE REFERENCES LIST OPEN (#380, #491)
    openNicknameMenu: null as IOpenReferenceMenu | null
};

export function resetNavigationState(): void {

    navigationState.openNicknameMenu = null;
    navigationState.treecipesControlsElement = null;
    navigationState.treePickerElement = null;
    navigationState.treePickerTreeStates = [];
    navigationState.treePickerObjectsElement = null;
    releaseTreePickerObjectsList();
    navigationState.isTreePickerObjectsExpanded = false;
    navigationState.treePickerShownTreeState = null;
    navigationState.treecipesSearch = null;
    navigationState.treecipesSearchIndex = null;
    navigationState.treecipesMatchedTreeKeys = null;
    navigationState.favoritesToggleElement = null;
    navigationState.favoritesCountElement = null;
    navigationState.noFavoritesElement = null;

}
