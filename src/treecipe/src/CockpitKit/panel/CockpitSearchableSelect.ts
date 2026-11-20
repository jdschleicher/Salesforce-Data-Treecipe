import { createButton, createElement, focusElement, setShown } from './CockpitPanelElements';

/*
    A dropdown a reader can search or choose from (#678): a combobox button that opens a popup with
    a search box, a line inviting a choice, and a listbox of the labels it was given. It knows
    nothing of what the labels name -- the cockpit hands it labels and hears back only the INDEX of
    the one chosen, so a list of orgs, objects or anything else is drawn the same way. The search
    filters only the labels already drawn; nothing is posted while the reader types. Every label
    goes in through textContent.
*/
export interface ISearchableSelectSettings {
    className: string;
    accessibleName: string;
    searchPlaceholder: string;
    chooseLabel: string;
    // WHAT THE CLOSED BUTTON SAYS WHEN THERE ARE LABELS BUT NONE IS SELECTED
    unselectedLabel: string;
    buildNoMatchText(searchText: string): string;
    onSelect(optionIndex: number): void;
}

export interface ISearchableSelect {
    element: HTMLElement;
    triggerElement: HTMLButtonElement;
    searchElement: HTMLInputElement;
    drawOptions(optionLabels: readonly string[], selectedIndex: number | null): void;
    // NO LABEL TO CHOOSE: THE BUTTON SHOWS placeholderText AND DOES NOT OPEN
    drawPlaceholder(placeholderText: string): void;
    setDisabled(isDisabled: boolean): void;
    isOpen(): boolean;
}

interface ISearchableSelectInstance {
    rootElement: HTMLElement;
    close(isFocusReturned: boolean): void;
}

let searchableSelectCount = 0;
// ONE POPUP IS OPEN AT A TIME, SO ONE DOCUMENT LISTENER CLOSES IT, HOWEVER MANY DROPDOWNS ARE BUILT
let openSearchableSelect: ISearchableSelectInstance | null = null;
let isOutsideClickListenerAdded = false;

function isInside(targetElement: unknown, rootElement: HTMLElement): boolean {
    for (let currentElement = targetElement as { parentNode: unknown } | null; currentElement; currentElement = currentElement.parentNode as { parentNode: unknown } | null) {
        if (currentElement === (rootElement as unknown)) { return true; }
    }
    return false;
}

function addOutsideClickListener(): void {
    if (isOutsideClickListenerAdded) { return; }
    isOutsideClickListenerAdded = true;
    document.addEventListener('click', function (event: Event) {
        if (openSearchableSelect && !isInside(event.target, openSearchableSelect.rootElement)) { openSearchableSelect.close(false); }
    }, true);
}

export function matchesSearchText(optionLabel: string, searchText: string): boolean {
    const wantedText = searchText.trim().toLowerCase();
    return !wantedText || optionLabel.toLowerCase().indexOf(wantedText) !== -1;
}

export function buildSearchableSelect(settings: ISearchableSelectSettings): ISearchableSelect {

    searchableSelectCount++;
    const listId = 'sdtSearchableSelect-' + searchableSelectCount + '-list';

    const rootElement = createElement('span', 'sdtSearchableSelect ' + settings.className);
    const triggerElement = createButton('secondary', 'sdtSearchableSelectTrigger');
    const popupElement = createElement('div', 'sdtSearchableSelectPopup hidden');
    const searchElement = createElement('input', 'sdtSearchableSelectSearch');
    const chooseLabelElement = createElement('div', 'sdtSearchableSelectChoose muted', settings.chooseLabel);
    const listElement = createElement('div', 'sdtSearchableSelectList');
    const noMatchElement = createElement('div', 'sdtSearchableSelectNoMatch muted hidden');

    triggerElement.setAttribute('role', 'combobox');
    triggerElement.setAttribute('aria-label', settings.accessibleName);
    triggerElement.setAttribute('aria-haspopup', 'listbox');
    triggerElement.setAttribute('aria-controls', listId);
    triggerElement.setAttribute('aria-expanded', 'false');

    searchElement.setAttribute('type', 'search');
    searchElement.setAttribute('placeholder', settings.searchPlaceholder);
    searchElement.setAttribute('aria-label', settings.searchPlaceholder);
    searchElement.setAttribute('aria-controls', listId);
    searchElement.setAttribute('autocomplete', 'off');

    listElement.setAttribute('id', listId);
    listElement.setAttribute('role', 'listbox');
    listElement.setAttribute('aria-label', settings.accessibleName);
    noMatchElement.setAttribute('role', 'status');

    popupElement.appendChild(searchElement);
    popupElement.appendChild(chooseLabelElement);
    popupElement.appendChild(listElement);
    popupElement.appendChild(noMatchElement);
    rootElement.appendChild(triggerElement);
    rootElement.appendChild(popupElement);

    let optionLabels: readonly string[] = [];
    let selectedIndex: number | null = null;
    let isOpenable = false;
    // THE INDEXES THE SEARCH LEAVES SHOWN, IN LIST ORDER, AND WHICH OF THEM ENTER WOULD CHOOSE
    let shownIndexes: number[] = [];
    let highlightedPosition = -1;

    const instance: ISearchableSelectInstance = { rootElement: rootElement, close: close };

    function drawTrigger(triggerText: string): void {
        triggerElement.textContent = triggerText;
    }

    function drawList(): void {

        listElement.textContent = '';
        shownIndexes = [];
        optionLabels.forEach(function (optionLabel, optionIndex) {
            if (!matchesSearchText(optionLabel, String(searchElement.value || ''))) { return; }
            shownIndexes.push(optionIndex);
            const optionElement = createElement('div', 'sdtSearchableSelectOption', optionLabel);
            optionElement.setAttribute('role', 'option');
            optionElement.setAttribute('id', listId + '-option-' + optionIndex);
            optionElement.setAttribute('aria-selected', optionIndex === selectedIndex ? 'true' : 'false');
            optionElement.addEventListener('click', function () { choose(optionIndex); });
            listElement.appendChild(optionElement);
        });

        const isNothingShown = shownIndexes.length === 0;
        noMatchElement.textContent = isNothingShown ? settings.buildNoMatchText(String(searchElement.value || '').trim()) : '';
        setShown(noMatchElement, isNothingShown);
        setShown(listElement, !isNothingShown);

        const selectedPosition = selectedIndex === null ? -1 : shownIndexes.indexOf(selectedIndex);
        highlight(selectedPosition >= 0 ? selectedPosition : (isNothingShown ? -1 : 0));

    }

    function highlight(position: number): void {

        highlightedPosition = position;
        Array.prototype.forEach.call(listElement.children, function (optionElement: HTMLElement, childPosition: number) {
            if (childPosition === position) { optionElement.classList.add('highlighted'); } else { optionElement.classList.remove('highlighted'); }
        });
        if (position >= 0) {
            searchElement.setAttribute('aria-activedescendant', listId + '-option-' + shownIndexes[position]);
        } else {
            searchElement.removeAttribute('aria-activedescendant');
        }

    }

    function open(): void {

        if (!isOpenable || triggerElement.disabled || openSearchableSelect === instance) { return; }
        if (openSearchableSelect) { openSearchableSelect.close(false); }
        addOutsideClickListener();
        openSearchableSelect = instance;
        searchElement.value = '';
        drawList();
        setShown(popupElement, true);
        triggerElement.setAttribute('aria-expanded', 'true');
        focusElement(searchElement);

    }

    function close(isFocusReturned: boolean): void {

        if (openSearchableSelect === instance) { openSearchableSelect = null; }
        setShown(popupElement, false);
        triggerElement.setAttribute('aria-expanded', 'false');
        if (isFocusReturned) { focusElement(triggerElement); }

    }

    function choose(optionIndex: number): void {

        if (triggerElement.disabled || optionIndex < 0 || optionIndex >= optionLabels.length) { return; }
        selectedIndex = optionIndex;
        drawTrigger(optionLabels[optionIndex]);
        close(true);
        settings.onSelect(optionIndex);

    }

    triggerElement.addEventListener('click', function () {
        if (openSearchableSelect === instance) { close(true); } else { open(); }
    });
    triggerElement.addEventListener('keydown', function (event: Event) {
        const key = (event as KeyboardEvent).key;
        if (key === 'ArrowDown' || key === 'ArrowUp') {
            if (typeof (event as KeyboardEvent).preventDefault === 'function') { (event as KeyboardEvent).preventDefault(); }
            open();
        }
    });

    searchElement.addEventListener('input', drawList);
    searchElement.addEventListener('keydown', function (event: Event) {

        const keyboardEvent = event as KeyboardEvent;
        const preventDefault = function () { if (typeof keyboardEvent.preventDefault === 'function') { keyboardEvent.preventDefault(); } };

        if (keyboardEvent.key === 'ArrowDown' && shownIndexes.length > 0) {
            preventDefault();
            highlight(Math.min(highlightedPosition + 1, shownIndexes.length - 1));
        } else if (keyboardEvent.key === 'ArrowUp' && shownIndexes.length > 0) {
            preventDefault();
            highlight(Math.max(highlightedPosition - 1, 0));
        } else if (keyboardEvent.key === 'Enter') {
            preventDefault();
            if (highlightedPosition >= 0) { choose(shownIndexes[highlightedPosition]); }
        } else if (keyboardEvent.key === 'Escape') {
            preventDefault();
            if (typeof keyboardEvent.stopPropagation === 'function') { keyboardEvent.stopPropagation(); }
            close(true);
        } else if (keyboardEvent.key === 'Tab') {
            close(false);
        }

    });

    return {
        element: rootElement,
        triggerElement: triggerElement,
        searchElement: searchElement,
        drawOptions: function (nextOptionLabels: readonly string[], nextSelectedIndex: number | null) {
            optionLabels = nextOptionLabels.slice();
            selectedIndex = nextSelectedIndex !== null && nextSelectedIndex >= 0 && nextSelectedIndex < optionLabels.length ? nextSelectedIndex : null;
            isOpenable = optionLabels.length > 0;
            drawTrigger(selectedIndex === null ? settings.unselectedLabel : optionLabels[selectedIndex]);
            if (!isOpenable) { close(false); } else if (openSearchableSelect === instance) { drawList(); }
        },
        drawPlaceholder: function (placeholderText: string) {
            optionLabels = [];
            selectedIndex = null;
            isOpenable = false;
            drawTrigger(placeholderText);
            close(false);
        },
        setDisabled: function (isDisabled: boolean) {
            triggerElement.disabled = isDisabled;
            if (isDisabled && openSearchableSelect === instance) { close(false); }
        },
        isOpen: function () { return openSearchableSelect === instance; }
    };

}
