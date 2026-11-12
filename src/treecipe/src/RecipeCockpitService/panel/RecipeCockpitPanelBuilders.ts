import { SVG_NAMESPACE, createButton, createElement } from '../../CockpitKit/panel/CockpitPanelElements';
import {
    IRecipeCockpitActionCard,
    RECIPE_COCKPIT_ACTION_VERB_EMOJI,
    RECIPE_COCKPIT_FIXED_VALUE_GLYPH_PATH,
    RECIPE_COCKPIT_SEARCH_GLYPH_PATH,
    RECIPE_COCKPIT_STANDALONE_ACTION_CARDS,
    RECIPE_COCKPIT_TOGGLE_COLLAPSED_GLYPH_PATH,
    RECIPE_COCKPIT_TREE_GLYPH_TRANSFORM,
    RECIPE_COCKPIT_TREE_GLYPH_VIEW_BOX,
    RECIPE_COCKPIT_TREE_LINKED_GLYPH_PATH,
    RecipeCockpitStandaloneAction,
    RecipeCockpitTroubleshootingAction,
    RECIPE_COCKPIT_TROUBLESHOOTING_ACTION_CARDS
} from '../RecipeCockpitPanelConstants';

/*
    The Recipe Cockpit's shared panel builders (#638): action cards, the one column table, a tab's
    search box, the chevron toggle and the glyphs. Every tab draws with them. Bundled into the
    cockpit's script; the two names below are the script's own, read when a search box is typed in.
*/
declare function displayTitleOf(tree: unknown): string;
declare function savePanelPlace(): void;

type RecipeCockpitCardAction = RecipeCockpitTroubleshootingAction | RecipeCockpitStandaloneAction;

const ACTION_CARDS: Readonly<Record<RecipeCockpitCardAction, IRecipeCockpitActionCard>> = { ...RECIPE_COCKPIT_TROUBLESHOOTING_ACTION_CARDS, ...RECIPE_COCKPIT_STANDALONE_ACTION_CARDS };

export interface IActionCardView {
    action: RecipeCockpitCardAction;
    buttonElement: HTMLButtonElement;
    titleElement: HTMLElement;
    detailElement: HTMLElement;
    reasonElement: HTMLElement;
}

let actionCardCount = 0;

/*
    A standalone action as ONE card (#381, #384). The whole card is the button, so its parts are
    spans and never controls: the verb's emoji (hidden from a screen reader) and the title, the
    line on when it is needed, the live detail and the reason it is disabled. The title names
    the button; the rest describes it.
*/
export function buildActionCard(action: RecipeCockpitCardAction, className: string, title: string): IActionCardView {

    // CALLERS STILL IN THE TEMPLATE-LITERAL SCRIPT ARE NOT TYPE CHECKED, SO AN UNKNOWN ACTION STILL THROWS
    const card = Object.prototype.hasOwnProperty.call(ACTION_CARDS, action) ? ACTION_CARDS[action] : undefined;
    if (!card || typeof RECIPE_COCKPIT_ACTION_VERB_EMOJI[card.verb] !== 'string') { throw new Error('Unknown action: ' + action); }

    actionCardCount++;
    const buttonElement = createButton('card', 'actionCard ' + className);
    const headingElement = createElement('span', 'actionCardHeading');
    const emojiElement = createElement('span', 'actionCardEmoji', RECIPE_COCKPIT_ACTION_VERB_EMOJI[card.verb]);
    const titleElement = createElement('span', 'actionCardTitle', title);
    const whyElement = createElement('span', 'actionCardWhy', card.why);
    const detailElement = createElement('span', 'actionCardDetail muted hidden');
    const reasonElement = createElement('span', 'actionCardReason hidden');

    emojiElement.setAttribute('aria-hidden', 'true');
    titleElement.setAttribute('id', 'actionCardTitle' + actionCardCount);
    whyElement.setAttribute('id', 'actionCardWhy' + actionCardCount);
    detailElement.setAttribute('id', 'actionCardDetail' + actionCardCount);
    reasonElement.setAttribute('id', 'actionCardReason' + actionCardCount);
    buttonElement.setAttribute('aria-labelledby', 'actionCardTitle' + actionCardCount);
    buttonElement.setAttribute('aria-describedby', ['actionCardWhy', 'actionCardDetail', 'actionCardReason'].map(function (idPrefix) { return idPrefix + actionCardCount; }).join(' '));

    headingElement.appendChild(emojiElement);
    headingElement.appendChild(titleElement);
    buttonElement.appendChild(headingElement);
    buttonElement.appendChild(whyElement);
    buttonElement.appendChild(detailElement);
    buttonElement.appendChild(reasonElement);

    return { action: action, buttonElement: buttonElement, titleElement: titleElement, detailElement: detailElement, reasonElement: reasonElement };

}

export interface IRowTableColumn {
    key: string;
    label: string;
}

export interface IRowTableOptions {
    className: string;
    columnClassName?: string;
    columns: readonly IRowTableColumn[];
    sortColumns?: readonly string[];
    sort?: { column: string; isDescending: boolean } | null;
    onSort?: (columnKey: string) => void;
}

export interface IRowTableView {
    wrapElement: HTMLElement;
    bodyElement: HTMLElement;
    sortButtons: Record<string, HTMLButtonElement>;
}

/*
    The cockpit's ONE column table (#558): the History sub-tab, a data set's insert journey and a
    record preview. Every table is made here and styled by sdtRowTable, so a new table needs no
    rules of its own for its borders and cells. A column in sortColumns heads with a link button
    and aria-sort; the caller draws the rows into bodyElement and keeps the sort.
*/
export function buildRowTable(tableOptions: IRowTableOptions): IRowTableView {

    const wrapElement = createElement('div', 'sdtRowTableWrap ' + tableOptions.className + 'Wrap');
    const tableElement = createElement('table', 'sdtRowTable ' + tableOptions.className);
    const headElement = createElement('thead', '');
    const headRowElement = createElement('tr', '');
    const bodyElement = createElement('tbody', '');
    const sortColumns = Array.isArray(tableOptions.sortColumns) ? tableOptions.sortColumns : [];
    const sortButtons: Record<string, HTMLButtonElement> = Object.create(null);
    const columnClassName = typeof tableOptions.columnClassName === 'string' ? tableOptions.columnClassName : '';

    tableOptions.columns.forEach(function (column) {
        const headerElement = createElement('th', columnClassName ? columnClassName + 'Header ' + columnClassName + 'Header-' + column.key : '');
        headerElement.setAttribute('scope', 'col');
        if (!tableOptions.sort || sortColumns.indexOf(column.key) === -1) {
            headerElement.textContent = column.label;
        } else {
            const isSorted = tableOptions.sort.column === column.key;
            const sortArrow = isSorted ? (tableOptions.sort.isDescending ? ' ↓' : ' ↑') : '';
            headerElement.setAttribute('aria-sort', isSorted ? (tableOptions.sort.isDescending ? 'descending' : 'ascending') : 'none');
            const sortButton = createButton('link', columnClassName + 'Sort ' + columnClassName + 'Sort-' + column.key, column.label + sortArrow);
            sortButton.addEventListener('click', function () { if (tableOptions.onSort) { tableOptions.onSort(column.key); } });
            sortButtons[column.key] = sortButton;
            headerElement.appendChild(sortButton);
        }
        headRowElement.appendChild(headerElement);
    });

    headElement.appendChild(headRowElement);
    tableElement.appendChild(headElement);
    tableElement.appendChild(bodyElement);
    wrapElement.appendChild(tableElement);

    return { wrapElement: wrapElement, bodyElement: bodyElement, sortButtons: sortButtons };

}

// WHAT A TAB'S SEARCH BOX READS AND WRITES ON ITS TREE CARD'S STATE
export interface ITabSearchTreeState {
    tree: unknown;
    searchTexts: Record<string, string>;
    searchQueries: Record<string, string>;
}

export interface ITabSearchView {
    element: HTMLElement;
    inputElement: HTMLInputElement;
    matchCountElement: HTMLElement;
}

/*
    Every tab of every card has its own search box (#217). Its text lives in the card's state
    and its element stays in the tab's panel, so switching tabs or collapsing the card keeps
    it; a new model draws new cards, which starts every box empty.
*/
export function buildTabSearch<TreeState extends ITabSearchTreeState>(treeState: TreeState, tabName: string, placeholderText: string, applySearch: (treeState: TreeState) => void): ITabSearchView {

    const searchElement = createElement('div', 'tabSearch');
    const fieldElement = createElement('div', 'tabSearchField');
    const inputElement = createElement('input', 'tabSearchInput');
    const matchCountElement = createElement('span', 'tabMatchCount muted');
    const iconElement = buildSearchIconElement();

    iconElement.addEventListener('click', function () {
        if (typeof inputElement.focus === 'function') { inputElement.focus(); }
    });

    inputElement.setAttribute('type', 'search');
    inputElement.setAttribute('placeholder', placeholderText);
    inputElement.setAttribute('aria-label', placeholderText + ' (' + displayTitleOf(treeState.tree) + ')');
    inputElement.value = treeState.searchTexts[tabName];
    inputElement.addEventListener('input', function () {
        treeState.searchTexts[tabName] = String(inputElement.value || '');
        treeState.searchQueries[tabName] = treeState.searchTexts[tabName].trim().toLowerCase();
        applySearch(treeState);
        savePanelPlace();
    });

    fieldElement.appendChild(iconElement);
    fieldElement.appendChild(inputElement);
    searchElement.appendChild(fieldElement);
    searchElement.appendChild(matchCountElement);

    return { element: searchElement, inputElement: inputElement, matchCountElement: matchCountElement };

}

// DECORATIVE: THE INPUT'S OWN aria-label NAMES THE BOX, SO THE ICON IS HIDDEN FROM A SCREEN READER
export function buildSearchIconElement(): SVGSVGElement {

    const glyphElement = document.createElementNS(SVG_NAMESPACE, 'svg');
    const pathElement = document.createElementNS(SVG_NAMESPACE, 'path');

    glyphElement.setAttribute('class', 'tabSearchIcon');
    glyphElement.setAttribute('viewBox', RECIPE_COCKPIT_TREE_GLYPH_VIEW_BOX);
    glyphElement.setAttribute('aria-hidden', 'true');
    glyphElement.setAttribute('focusable', 'false');
    pathElement.setAttribute('d', RECIPE_COCKPIT_SEARCH_GLYPH_PATH);
    glyphElement.appendChild(pathElement);

    return glyphElement;

}

/*
    The ▸/▾ of a tree card, a Treecipe object and a picklist field (#277): a real button, keyboard
    operable, its SVG built node by node -- no markup string -- and coloured by CSS from the palette.
*/
export function buildToggleElement(className: string): HTMLButtonElement {

    const toggleElement = createButton('secondary', 'chevronToggle ' + className);
    const glyphElement = document.createElementNS(SVG_NAMESPACE, 'svg');
    const pathElement = document.createElementNS(SVG_NAMESPACE, 'path');

    glyphElement.setAttribute('class', 'toggleGlyph');
    glyphElement.setAttribute('viewBox', RECIPE_COCKPIT_TREE_GLYPH_VIEW_BOX);
    glyphElement.setAttribute('aria-hidden', 'true');
    glyphElement.setAttribute('focusable', 'false');
    pathElement.setAttribute('d', RECIPE_COCKPIT_TOGGLE_COLLAPSED_GLYPH_PATH);
    glyphElement.appendChild(pathElement);
    toggleElement.appendChild(glyphElement);

    return toggleElement;

}

// THE TREE ICON'S CHAIN LINK (#219); THE ROW KEEPS ITS PATH SO A LATER STATE CHANGE REDRAWS ONLY THE PATH
export function buildTreeGlyph(treeObjectState: { glyphPathElement?: SVGPathElement }): SVGSVGElement {

    const glyphElement = document.createElementNS(SVG_NAMESPACE, 'svg');
    const pathElement = document.createElementNS(SVG_NAMESPACE, 'path');

    glyphElement.setAttribute('class', 'treeGlyph');
    glyphElement.setAttribute('viewBox', RECIPE_COCKPIT_TREE_GLYPH_VIEW_BOX);
    glyphElement.setAttribute('aria-hidden', 'true');
    glyphElement.setAttribute('focusable', 'false');
    pathElement.setAttribute('d', RECIPE_COCKPIT_TREE_LINKED_GLYPH_PATH);
    pathElement.setAttribute('transform', RECIPE_COCKPIT_TREE_GLYPH_TRANSFORM);
    glyphElement.appendChild(pathElement);
    treeObjectState.glyphPathElement = pathElement;

    return glyphElement;

}

/*
    The ONE pencil every edit button draws (#540), built node by node like the chain link. Its
    size is a class: 'default' on a row's buttons, 'large' on a tree card's rename.
*/
export function buildPencilGlyph(size: 'default' | 'large'): SVGSVGElement {

    const glyphElement = document.createElementNS(SVG_NAMESPACE, 'svg');
    const pathElement = document.createElementNS(SVG_NAMESPACE, 'path');

    glyphElement.setAttribute('class', size === 'large' ? 'fixedValueGlyph fixedValueGlyph-large' : 'fixedValueGlyph');
    glyphElement.setAttribute('viewBox', RECIPE_COCKPIT_TREE_GLYPH_VIEW_BOX);
    glyphElement.setAttribute('aria-hidden', 'true');
    glyphElement.setAttribute('focusable', 'false');
    pathElement.setAttribute('d', RECIPE_COCKPIT_FIXED_VALUE_GLYPH_PATH);
    glyphElement.appendChild(pathElement);

    return glyphElement;

}
