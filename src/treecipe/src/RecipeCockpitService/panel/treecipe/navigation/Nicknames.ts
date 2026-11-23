import { createButton, createElement } from '../../../../CockpitKit/panel/CockpitPanelElements';
import { RECIPE_COCKPIT_CHILD_REFERENCE_MENU_HINT, RECIPE_COCKPIT_PARENT_NICKNAME_EMOJI, RECIPE_COCKPIT_PARENT_REFERENCE_MENU_HINT, RECIPE_COCKPIT_YAML_NON_STRING_NICKNAME_PATTERN } from '../../../RecipeCockpitNavigationConstants';
import { hasOwnKey } from '../../RecipeCockpitOwnKey';
import { StandardDerivedFields } from '../../../../ObjectInfoWrapper/StandardDerivedFields';
import type { IFieldRowFieldState } from '../fieldRows/FieldRowTypes';
import { buildChipEmoji, drawFriendsButton } from './Friends';
import { revealTreeObjectRow } from './TreecipesSearch';
import { asNavigationObjectState, asNavigationTreeState } from './NavigationTypes';
import type { INavigationObject, INavigationObjectState, INavigationTreeState, INicknameIndex, INicknameUsage, IOpenReferenceMenu, IReferenceMenuEntry, IReferenceMenuOwner, ITreeObjectStateView, ITreeStateView } from './NavigationTypes';
import { pluralize } from '../../RecipeCockpitPanelShared';
import { navigationState } from './NavigationState';

/*
    Nicknames as references (#380, #491): the one row each nickname names, the fields pointing to
    it, and the lists that move between them, kept to one open at a time with the keys a menu takes.
    The open list is navigationState's, since a new model and a click anywhere else close it.
    RECIPE_COCKPIT_YAML_NON_STRING_NICKNAME_PATTERN is the recipe writer's rule, spelled out where
    the panel can import it and held to the writer's by a test (#657).
*/

let nicknameMenuHintSequence = 0;

// AN OBJECT ROW'S OWN NICKNAME (#380): AN OCCURRENCE'S, OR THE ONE THE FIRST OCCURRENCE CARRIES
export function nicknameOfObject(object: { nickname?: string; recipeNickname?: string }): string {
    return object.nickname || object.recipeNickname || '';
}

function isReferenceableNickname(nickname: string): boolean {
    return /^[A-Za-z][A-Za-z0-9_]*$/.test(nickname) && !RECIPE_COCKPIT_YAML_NON_STRING_NICKNAME_PATTERN.test(nickname);
}

// A VALUE THAT IS ONE NICKNAME AND NOTHING ELSE, BUT FOR COMMENT LINES UNDER IT (#194'S RECORD TYPE BLOCKS NOTE); ELSE null
function readReferencedNickname(recipeValue: unknown): string | null {

    // THE FIRST LINE ALONE DECIDES MOST FIELDS, SO A LONG EXPRESSION IS NEVER SPLIT WHOLE
    const valueText = String(recipeValue || '');
    const firstLineEnd = valueText.indexOf('\n');
    const firstLine = (firstLineEnd === -1 ? valueText : valueText.slice(0, firstLineEnd)).trim();

    if (!isReferenceableNickname(firstLine)) { return null; }
    if (firstLineEnd === -1) { return firstLine; }

    return valueText.slice(firstLineEnd + 1).split('\n').every(function (valueLine) { return valueLine.trim().charAt(0) === '#'; }) ? firstLine : null;

}

/*
    The nickname a field's recipe value points to. A field Salesforce sets from another lookup (#680)
    follows the record that lookup on the same row holds now (#704): its own value, written at
    generation as "<nickname>.<field>" (AccountId: Opportunity_NickName.AccountId), names that record
    only while the lookup is not a nickname or reference(); every other field points only with a
    bare nickname.
*/
type ReferencingFieldState = { field: { fieldApiName: string; recipeValue?: unknown } };

function readFieldReferencedNickname(objectApiName: string, fieldStates: readonly ReferencingFieldState[], field: { fieldApiName: string; recipeValue?: unknown }): string | null {

    const derivedField = StandardDerivedFields.resolveDerivedField(objectApiName, field.fieldApiName);
    if (!derivedField) { return readReferencedNickname(field.recipeValue); }

    const throughFieldState = fieldStates.find(function (fieldState) { return fieldState.field.fieldApiName === derivedField.throughFieldApiName; });
    const throughNickname = throughFieldState ? StandardDerivedFields.readThroughSourceNickname(throughFieldState.field.recipeValue) : undefined;
    if (throughNickname !== undefined && isReferenceableNickname(throughNickname)) { return throughNickname; }

    const sourceNickname = StandardDerivedFields.readSourceNickname(String(field.recipeValue || '').trim(), derivedField);
    return sourceNickname !== undefined && isReferenceableNickname(sourceNickname) ? sourceNickname : null;

}

// THE NICKNAME THE SOURCE RECORD'S OWN FIELD HOLDS (Opportunity_NickName's AccountId: Account_NickName), OR null
export function readSourceFieldNickname(sourceOwnerState: INavigationObjectState, sourceFieldApiName: string): string | null {

    const sourceFieldState = sourceOwnerState.fieldStates.find(function (fieldState) { return fieldState.field.fieldApiName === sourceFieldApiName; });

    return sourceFieldState ? readFieldReferencedNickname(sourceOwnerState.object.objectApiName, sourceOwnerState.fieldStates, sourceFieldState.field) : null;

}

export function nicknameKeyOf(recipeFilePath: string | undefined, nickname: string): string {
    return String(recipeFilePath || '') + '\n' + nickname;
}

/*
    One card's nicknames (#380): the ONE row each is held by -- in the same recipe file, never an
    object written again with no nickname to tell it apart -- and every field, in recipe order,
    whose value is that whole nickname, which is what the insert swaps for the record's Id. A
    nickname two rows hold names no single row, so nothing points to it. Built once per card,
    with no prototype, since a hand-edited recipe can name anything.
*/
export function ensureNicknameIndex(treeState: INavigationTreeState): INicknameIndex {

    if (treeState.nicknameIndex) { return treeState.nicknameIndex; }

    const ownerStatesByKey: Record<string, { nickname: string; states: INavigationObjectState[] }> = Object.create(null);

    treeState.objectStates.forEach(function (treeObjectState) {
        const nickname = nicknameOfObject(treeObjectState.object);
        if (!nickname) { return; }
        const nicknameKey = nicknameKeyOf(treeObjectState.object.recipeFilePath, nickname);
        if (!hasOwnKey(ownerStatesByKey, nicknameKey)) { ownerStatesByKey[nicknameKey] = { nickname: nickname, states: [] }; }
        ownerStatesByKey[nicknameKey].states.push(treeObjectState);
    });

    const nicknameIndex: INicknameIndex = { ownerStateByKey: Object.create(null), usagesByKey: Object.create(null) };

    Object.keys(ownerStatesByKey).forEach(function (nicknameKey) {
        const owners = ownerStatesByKey[nicknameKey];
        if (owners.states.length !== 1 || owners.states[0].object.hasIndistinctOccurrences || !isReferenceableNickname(owners.nickname)) { return; }
        nicknameIndex.ownerStateByKey[nicknameKey] = owners.states[0];
        nicknameIndex.usagesByKey[nicknameKey] = [];
    });

    treeState.objectStates.forEach(function (treeObjectState) {
        treeObjectState.fieldStates.forEach(function (fieldState) {

            if (!fieldState.field.lineNumber) { return; }

            const nickname = readFieldReferencedNickname(treeObjectState.object.objectApiName, treeObjectState.fieldStates, fieldState.field);
            if (nickname === null) { return; }

            const nicknameKey = nicknameKeyOf(treeObjectState.object.recipeFilePath, nickname);
            if (!hasOwnKey(nicknameIndex.ownerStateByKey, nicknameKey) || nicknameIndex.ownerStateByKey[nicknameKey] === treeObjectState) { return; }

            nicknameIndex.usagesByKey[nicknameKey].push({ objectState: treeObjectState, fieldState: fieldState });

        });
    });

    Object.keys(nicknameIndex.usagesByKey).forEach(function (nicknameKey) {
        nicknameIndex.usagesByKey[nicknameKey].sort(function (firstUsage, secondUsage) { return ( firstUsage.fieldState.field.lineNumber as number ) - ( secondUsage.fieldState.field.lineNumber as number ); });
    });

    treeState.nicknameIndex = nicknameIndex;
    return nicknameIndex;

}

export function findReferencedOwnerState(treeObjectStateView: ITreeObjectStateView, fieldState: IFieldRowFieldState): INavigationObjectState | null {

    const treeObjectState = asNavigationObjectState(treeObjectStateView);
    if (!treeObjectState.treeState || !fieldState.field.lineNumber) { return null; }

    const nickname = readFieldReferencedNickname(treeObjectState.object.objectApiName, treeObjectState.fieldStates, fieldState.field);
    if (nickname === null) { return null; }

    const nicknameIndex = ensureNicknameIndex(treeObjectState.treeState);
    const nicknameKey = nicknameKeyOf(treeObjectState.object.recipeFilePath, nickname);
    const ownerState = hasOwnKey(nicknameIndex.ownerStateByKey, nicknameKey) ? nicknameIndex.ownerStateByKey[nicknameKey] : null;

    return ownerState === treeObjectState ? null : ownerState;

}

function listNicknameUsages(treeObjectState: INavigationObjectState): INicknameUsage[] | null {

    const nicknameIndex = ensureNicknameIndex(treeObjectState.treeState);
    const nicknameKey = nicknameKeyOf(treeObjectState.object.recipeFilePath, nicknameOfObject(treeObjectState.object));

    return hasOwnKey(nicknameIndex.ownerStateByKey, nicknameKey) && nicknameIndex.ownerStateByKey[nicknameKey] === treeObjectState
        ? nicknameIndex.usagesByKey[nicknameKey]
        : null;

}

// THE NICKNAME BESIDE AN OBJECT'S NAME (#380): A BUTTON LISTING THE FIELDS THAT POINT TO IT, OR TEXT WHEN NONE CAN
export function drawObjectNickname(treeObjectState: INavigationObjectState): void {

    const slotElement = treeObjectState.nicknameSlotElement;
    if (!slotElement || !treeObjectState.treeState) { return; }

    const nickname = nicknameOfObject(treeObjectState.object);
    const usages = listNicknameUsages(treeObjectState);

    slotElement.textContent = '';
    treeObjectState.nicknameChipElement = null;

    if (!usages || usages.length === 0) {
        const nicknameTextElement = createElement('span', 'treeNickname muted');
        nicknameTextElement.appendChild(buildChipEmoji(RECIPE_COCKPIT_PARENT_NICKNAME_EMOJI));
        nicknameTextElement.appendChild(createElement('span', 'treeNicknameText', nickname));
        nicknameTextElement.setAttribute('title', usages
            ? 'No field of this treecipe points to ' + nickname
            : nickname + ' does not name exactly one object of this recipe, so no field can point to it');
        slotElement.appendChild(nicknameTextElement);
        drawFriendsButton(treeObjectState);
        return;
    }

    const chipElement = createButton('secondary', 'treeNickname', '', 'compact');
    chipElement.appendChild(buildChipEmoji(RECIPE_COCKPIT_PARENT_NICKNAME_EMOJI));
    chipElement.appendChild(createElement('span', 'treeNicknameText', nickname));
    chipElement.setAttribute('aria-haspopup', 'menu');
    chipElement.setAttribute('aria-expanded', 'false');
    chipElement.setAttribute('aria-label', nickname + ': ' + pluralize(usages.length, 'field points', 'fields point') + ' to it');
    chipElement.setAttribute('title', 'Show the fields that point to ' + nickname);
    chipElement.addEventListener('click', function () {
        if (navigationState.openNicknameMenu && navigationState.openNicknameMenu.menuOwner === treeObjectState) {
            closeNicknameMenu(true);
            return;
        }
        openNicknameMenuOf(treeObjectState);
    });

    treeObjectState.nicknameChipElement = chipElement;
    slotElement.appendChild(chipElement);
    drawFriendsButton(treeObjectState);

}

// AN OBJECT WRITTEN MORE THAN ONCE IS TOLD APART BY ITS NICKNAME, AS ITS ROW IS
export function describeMenuObject(objectState: { object: INavigationObject }): string {
    const object = objectState.object;
    return object.objectApiName + (object.nickname ? ' · ' + object.nickname : '');
}

export function describeExclusion(objectState: { element: HTMLElement }): string {
    return objectState.element.classList.contains('excluded') ? ' — excluded' : '';
}

function describeNicknameUsage(usage: INicknameUsage): string {
    return describeMenuObject(usage.objectState) + '.' + usage.fieldState.field.fieldApiName + describeExclusion(usage.objectState);
}

function openNicknameMenuOf(treeObjectState: INavigationObjectState): void {

    const usages = listNicknameUsages(treeObjectState) || [];

    openReferenceMenu(treeObjectState, treeObjectState.headerElement, function () { return treeObjectState.nicknameChipElement; }, RECIPE_COCKPIT_CHILD_REFERENCE_MENU_HINT, usages.map(function (usage) {
        return { label: describeNicknameUsage(usage), choose: function () { chooseNicknameUsage(usage); } };
    }));

}

/*
    ONE LIST OPEN AT A TIME, ON A LINE OF ITS OWN UNDER THE ROW THAT OPENED IT; BUILT ON EVERY OPEN, SO AN
    EXCLUSION SINCE IS SHOWN. ITS FIRST LINE SAYS WHERE A CLICK GOES (#491): TEXT THE KEYS NEVER STOP ON,
    AND THE LIST'S NAME. IT SITS BESIDE THE role="menu" ELEMENT, NOT IN IT, SINCE A MENU OWNS ONLY ITS ITEMS
*/
export function openReferenceMenu(menuOwner: IReferenceMenuOwner, hostElement: HTMLElement, openerOf: () => HTMLElement | null, hintText: string, entries: IReferenceMenuEntry[]): void {

    closeNicknameMenu(false);

    if (!menuOwner.nicknameMenuElement) {
        menuOwner.nicknameMenuElement = createElement('div', 'treeNicknameMenu hidden');
        hostElement.appendChild(menuOwner.nicknameMenuElement);
    }

    const menuElement = menuOwner.nicknameMenuElement;
    menuElement.textContent = '';

    nicknameMenuHintSequence += 1;
    const hintId = 'treeNicknameMenuHint' + nicknameMenuHintSequence;
    const hintElement = createElement('span', 'treeNicknameMenuHint', hintText);
    hintElement.setAttribute('id', hintId);
    menuElement.appendChild(hintElement);

    const itemsElement = createElement('div', 'treeNicknameMenuItems');
    itemsElement.setAttribute('role', 'menu');
    itemsElement.setAttribute('aria-labelledby', hintId);
    menuElement.appendChild(itemsElement);

    const itemElements = entries.map(function (entry, entryIndex) {

        const itemElement = createButton('link', 'treeNicknameMenuItem', entry.label);
        itemElement.setAttribute('role', 'menuitem');
        itemElement.setAttribute('tabindex', entryIndex === 0 ? '0' : '-1');
        itemElement.addEventListener('click', function () { entry.choose(); });
        itemElement.addEventListener('keydown', function (event) { handleNicknameMenuKey(event, entryIndex); });
        itemsElement.appendChild(itemElement);

        return itemElement;

    });

    menuElement.classList.remove('hidden');
    const openerElement = openerOf();
    if (openerElement) { openerElement.setAttribute('aria-expanded', 'true'); }

    navigationState.openNicknameMenu = { menuOwner: menuOwner, menuElement: menuElement, itemElements: itemElements, entries: entries, openerOf: openerOf };

    if (itemElements.length > 0) { itemElements[0].focus(); }

}

export function closeNicknameMenu(isFocusReturned: boolean): void {

    if (!navigationState.openNicknameMenu) { return; }

    const closingMenu = navigationState.openNicknameMenu;
    navigationState.openNicknameMenu = null;

    closingMenu.menuElement.textContent = '';
    closingMenu.menuElement.classList.add('hidden');

    const openerElement = closingMenu.openerOf();
    if (openerElement) {
        openerElement.setAttribute('aria-expanded', 'false');
        if (isFocusReturned) { openerElement.focus(); }
    }

}

function chooseNicknameUsage(usage: INicknameUsage): void {

    const treeState = usage.objectState.treeState;
    closeNicknameMenu(false);

    // THE FIELD'S ROW IS BUILT BY THE OPEN, SO ITS BACK-LINK IS FOUND AFTER IT
    revealTreeObjectRow(treeState, usage.objectState, usage.fieldState, null);
    if (usage.fieldState.rowElement) {
        const backLinkElement = findDescendantWithClass(usage.fieldState.rowElement, 'treeNicknameBackLink');
        if (backLinkElement) { ( backLinkElement as HTMLElement ).focus(); }
    }

}

function handleNicknameMenuKey(event: KeyboardEvent, usageIndex: number): void {

    if (!navigationState.openNicknameMenu) { return; }

    const itemElements = navigationState.openNicknameMenu.itemElements;
    let nextIndex: number | null = null;

    if (event.key === 'ArrowDown') { nextIndex = (usageIndex + 1) % itemElements.length; }
    if (event.key === 'ArrowUp') { nextIndex = (usageIndex - 1 + itemElements.length) % itemElements.length; }
    if (event.key === 'Home') { nextIndex = 0; }
    if (event.key === 'End') { nextIndex = itemElements.length - 1; }

    if (nextIndex !== null) {
        const focusedIndex = nextIndex;
        if (typeof event.preventDefault === 'function') { event.preventDefault(); }
        itemElements.forEach(function (itemElement, itemIndex) { itemElement.setAttribute('tabindex', itemIndex === focusedIndex ? '0' : '-1'); });
        itemElements[focusedIndex].focus();
        return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
        // THE BROWSER WOULD CLICK THE BUTTON TOO; ONE CHOICE, NOT TWO
        if (typeof event.preventDefault === 'function') { event.preventDefault(); }
        navigationState.openNicknameMenu.entries[usageIndex].choose();
        return;
    }

    if (event.key === 'Escape') {
        if (typeof event.preventDefault === 'function') { event.preventDefault(); }
        if (typeof event.stopPropagation === 'function') { event.stopPropagation(); }
        closeNicknameMenu(true);
        return;
    }

    if (event.key === 'Tab') { closeNicknameMenu(false); }

}

export function isElementWithin(element: Node | null, containerElement: Node): boolean {

    for (let currentElement: Node | null = element; currentElement; currentElement = currentElement.parentNode) {
        if (currentElement === containerElement) { return true; }
    }

    return false;

}

function findDescendantWithClass(rootElement: Element, className: string): Element | null {

    if (rootElement.classList && rootElement.classList.contains(className)) { return rootElement; }

    const childElements = rootElement.children || [];
    for (let childIndex = 0; childIndex < childElements.length; childIndex++) {
        const foundElement = findDescendantWithClass(childElements[childIndex], className);
        if (foundElement) { return foundElement; }
    }

    return null;

}

// A CHILD FIELD'S WAY BACK (#380): THE NICKNAME IT HOLDS, HIGHLIGHTED, LISTING THE ROW THAT HOLDS IT UNDER THE FIELD (#491)
export function buildNicknameBackLink(treeStateView: ITreeStateView, ownerState: INavigationObjectState, fieldHeaderElement: HTMLElement): HTMLButtonElement {

    const treeState = asNavigationTreeState(treeStateView);
    const nickname = nicknameOfObject(ownerState.object);
    const backLinkElement = createButton('secondary', 'treeNicknameBackLink', '↖ ' + nickname, 'compact');
    const menuOwner: IReferenceMenuOwner = { nicknameMenuElement: null };
    const openerOf = function (): HTMLElement { return backLinkElement; };

    backLinkElement.setAttribute('aria-haspopup', 'menu');
    backLinkElement.setAttribute('aria-expanded', 'false');
    backLinkElement.setAttribute('title', 'Show the ' + ownerState.object.objectApiName + ' that holds ' + nickname);
    backLinkElement.setAttribute('aria-label', nickname + ': show the ' + ownerState.object.objectApiName + ' this field points to');
    backLinkElement.addEventListener('click', function () {

        if (navigationState.openNicknameMenu && navigationState.openNicknameMenu.menuOwner === menuOwner) {
            closeNicknameMenu(true);
            return;
        }

        openReferenceMenu(menuOwner, fieldHeaderElement, openerOf, RECIPE_COCKPIT_PARENT_REFERENCE_MENU_HINT, [{
            label: describeMenuObject(ownerState) + describeExclusion(ownerState),
            choose: function () {
                closeNicknameMenu(false);
                revealTreeObjectRow(treeState, ownerState, null, ownerState.nicknameChipElement);
            }
        }]);

    });

    return backLinkElement;

}

// THE OCCURRENCE WHOSE friends: BLOCK HOLDS A ROW (#411), OR null FOR A TOP-LEVEL ONE
export function readNestingParent(object: INavigationObject): { objectApiName: string; nickname: string } | null {

    if (object.iteration) {
        return object.iteration.parentObjectApiName ? { objectApiName: object.iteration.parentObjectApiName, nickname: object.iteration.parentNickname || '' } : null;
    }

    return typeof object.countParentObjectApiName === 'string' && object.countParentObjectApiName
        ? { objectApiName: object.countParentObjectApiName, nickname: typeof object.parentNickname === 'string' ? object.parentNickname : '' }
        : null;

}
