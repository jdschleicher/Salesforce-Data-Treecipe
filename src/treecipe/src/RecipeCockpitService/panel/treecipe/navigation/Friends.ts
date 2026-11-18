import { createButton, createElement } from '../../../../CockpitKit/panel/CockpitPanelElements';
import { RECIPE_COCKPIT_FRIEND_EMOJI, RECIPE_COCKPIT_FRIENDS_MENU_HINT } from '../../../RecipeCockpitNavigationConstants';
import { hasOwnKey } from '../../RecipeCockpitOwnKey';
import { closeNicknameMenu, describeExclusion, describeMenuObject, ensureNicknameIndex, findReferencedOwnerState, nicknameKeyOf, nicknameOfObject, openReferenceMenu, readNestingParent } from './Nicknames';
import { revealTreeObjectRow } from './TreecipesSearch';
import type { IFriend, IFriendChip, IFriendIndex, INavigationObjectState, INavigationTreeState, IOpenReferenceMenu } from './NavigationTypes';

/*
    Friend rows (#411, #492): the chips naming the parents a friend row is nested under or points
    to, numbered the same on every row, and a parent row's 👥 N list of its friends. The open list
    is the panel script's let, declare let here, shared with the nickname lists.
*/
declare const openNicknameMenu: IOpenReferenceMenu | null;
declare function pluralize(count: number, singular: string, plural: string): string;

interface IFriendParent {
    parentKey: string;
    label: string;
    ownerState: INavigationObjectState | null;
}

// A PARENT ROW'S 👥 N (#492), RIGHT AFTER ITS NICKNAME: ONLY WHERE #411'S INDEX LISTS A FRIEND OF IT
export function drawFriendsButton(treeObjectState: INavigationObjectState): void {

    treeObjectState.friendsButtonElement = null;

    const friends = listFriendsOf(treeObjectState);
    if (friends.length === 0) { return; }

    const objectApiName = treeObjectState.object.objectApiName;
    const buttonElement = createButton('secondary', 'treeFriendsButton', '', 'compact');
    buttonElement.appendChild(buildChipEmoji(RECIPE_COCKPIT_FRIEND_EMOJI));
    buttonElement.appendChild(createElement('span', 'treeFriendsCount', String(friends.length)));
    buttonElement.setAttribute('aria-haspopup', 'menu');
    buttonElement.setAttribute('aria-expanded', 'false');
    buttonElement.setAttribute('aria-label', objectApiName + ': ' + pluralize(friends.length, 'friend', 'friends'));
    buttonElement.setAttribute('title', 'Show the friends of ' + nicknameOfObject(treeObjectState.object));
    buttonElement.addEventListener('click', function () {
        if (openNicknameMenu && openNicknameMenu.menuOwner === treeObjectState.friendsMenuOwner) {
            closeNicknameMenu(true);
            return;
        }
        openFriendsMenuOf(treeObjectState);
    });

    treeObjectState.friendsButtonElement = buttonElement;
    ( treeObjectState.nicknameSlotElement as HTMLElement ).appendChild(buttonElement);

}

function openFriendsMenuOf(treeObjectState: INavigationObjectState): void {

    const treeState = treeObjectState.treeState;

    openReferenceMenu(treeObjectState.friendsMenuOwner, treeObjectState.headerElement, function () { return treeObjectState.friendsButtonElement; }, RECIPE_COCKPIT_FRIENDS_MENU_HINT, listFriendsOf(treeObjectState).map(function (friend) {
        return {
            label: friend.label + ': ' + describeMenuObject(friend.friendState) + describeExclusion(friend.friendState),
            choose: function () {
                closeNicknameMenu(false);
                const friendState = friend.friendState;
                revealTreeObjectRow(treeState, friendState, null, friendState.friendChipElementsByOwnerState.get(treeObjectState) || friendState.toggleElement);
            }
        };
    }));

}

/*
    The parents each FRIEND row names (#411): the occurrence its friends: block nests it under,
    then every other row a field of it points to by nickname (#380's index), in field order, each
    once. A parent is the ONE row holding its nickname; a nesting parent no row holds that way is
    named by its object, with no row to open. A parent's friends are the friend rows naming it,
    in recipe line order, and a chip's number is the row's place among them -- so one parent is
    numbered the same on every row, and an excluded friend keeps its number. Built once per card,
    with no prototype, since a hand-edited recipe can name anything.
*/
function ensureFriendIndex(treeState: INavigationTreeState): IFriendIndex {

    if (treeState.friendIndex) { return treeState.friendIndex; }

    // A FLAT CARD (EVERY SNOWFAKERY ONE) HAS NO FRIEND ROW, SO ITS FIELDS ARE NEVER READ FOR NICKNAMES HERE
    if (!treeState.objectStates.some(function (treeObjectState) { return readNestingParent(treeObjectState.object) !== null; })) {
        treeState.friendIndex = { chipsByObjectState: new Map(), friendsByOwnerState: new Map() };
        return treeState.friendIndex;
    }

    const nicknameIndex = ensureNicknameIndex(treeState);
    const parentsByObjectState = new Map<INavigationObjectState, IFriendParent[]>();
    const friendStatesByParentKey: Record<string, INavigationObjectState[]> = Object.create(null);
    const ownerStateByParentKey: Record<string, INavigationObjectState | null> = Object.create(null);

    treeState.objectStates.forEach(function (treeObjectState) {

        const nestingParent = readNestingParent(treeObjectState.object);
        if (!nestingParent) { return; }

        const recipeFilePath = treeObjectState.object.recipeFilePath;
        const parents: IFriendParent[] = [];
        const parentKeys: Record<string, true> = Object.create(null);
        const addParent = function (parent: IFriendParent): void {
            if (parentKeys[parent.parentKey] === true) { return; }
            parentKeys[parent.parentKey] = true;
            parents.push(parent);
            if (!hasOwnKey(friendStatesByParentKey, parent.parentKey)) {
                friendStatesByParentKey[parent.parentKey] = [];
                ownerStateByParentKey[parent.parentKey] = parent.ownerState;
            }
            friendStatesByParentKey[parent.parentKey].push(treeObjectState);
        };

        const nestingNicknameKey = nicknameKeyOf(recipeFilePath, nestingParent.nickname);
        const nestingOwnerState = nestingParent.nickname && hasOwnKey(nicknameIndex.ownerStateByKey, nestingNicknameKey) && nicknameIndex.ownerStateByKey[nestingNicknameKey] !== treeObjectState
            ? nicknameIndex.ownerStateByKey[nestingNicknameKey]
            : null;

        addParent(nestingOwnerState
            ? { parentKey: 'nickname\n' + nestingNicknameKey, label: nestingParent.nickname, ownerState: nestingOwnerState }
            : { parentKey: 'object\n' + String(recipeFilePath || '') + '\n' + nestingParent.objectApiName, label: nestingParent.objectApiName, ownerState: null });

        treeObjectState.fieldStates.forEach(function (fieldState) {
            const ownerState = findReferencedOwnerState(treeObjectState, fieldState);
            if (!ownerState) { return; }
            const ownerNickname = nicknameOfObject(ownerState.object);
            addParent({ parentKey: 'nickname\n' + nicknameKeyOf(recipeFilePath, ownerNickname), label: ownerNickname, ownerState: ownerState });
        });

        parentsByObjectState.set(treeObjectState, parents);

    });

    // ONE POSITION MAP PER PARENT, SO A ROOT WITH THOUSANDS OF FRIENDS IS NUMBERED IN ONE PASS
    const lineNumberOf = function (treeObjectState: INavigationObjectState): number { return typeof treeObjectState.object.lineNumber === 'number' ? treeObjectState.object.lineNumber : Number.MAX_SAFE_INTEGER; };
    const friendNumbersByParentKey: Record<string, Map<INavigationObjectState, number>> = Object.create(null);
    // THE SAME SORTED LISTS, INVERTED (#492): EACH PARENT ROW'S FRIENDS, LABELLED AS THEIR CHIPS READ
    const friendsByOwnerState = new Map<INavigationObjectState, IFriend[]>();
    Object.keys(friendStatesByParentKey).forEach(function (parentKey) {
        const friendNumbers = new Map<INavigationObjectState, number>();
        const ownerState = ownerStateByParentKey[parentKey];
        const ownerFriends: IFriend[] = [];
        friendStatesByParentKey[parentKey]
            .sort(function (firstState, secondState) { return lineNumberOf(firstState) - lineNumberOf(secondState); })
            .forEach(function (friendState, friendIndex) {
                friendNumbers.set(friendState, friendIndex + 1);
                if (ownerState) { ownerFriends.push({ friendState: friendState, label: nicknameOfObject(ownerState.object) + '-' + (friendIndex + 1) }); }
            });
        friendNumbersByParentKey[parentKey] = friendNumbers;
        if (ownerState) { friendsByOwnerState.set(ownerState, ownerFriends); }
    });

    const chipsByObjectState = new Map<INavigationObjectState, IFriendChip[]>();
    parentsByObjectState.forEach(function (parents, treeObjectState) {
        chipsByObjectState.set(treeObjectState, parents.map(function (parent) {
            const friendNumber = friendNumbersByParentKey[parent.parentKey].get(treeObjectState) as number;
            return { label: parent.label + '-' + friendNumber, parentLabel: parent.label, friendNumber: friendNumber, ownerState: parent.ownerState };
        }));
    });

    treeState.friendIndex = { chipsByObjectState: chipsByObjectState, friendsByOwnerState: friendsByOwnerState };
    return treeState.friendIndex;

}

function listFriendChips(treeObjectState: INavigationObjectState): IFriendChip[] {
    if (!treeObjectState.treeState) { return []; }
    return ensureFriendIndex(treeObjectState.treeState).chipsByObjectState.get(treeObjectState) || [];
}

function listFriendsOf(treeObjectState: INavigationObjectState): IFriend[] {
    if (!treeObjectState.treeState) { return []; }
    return ensureFriendIndex(treeObjectState.treeState).friendsByOwnerState.get(treeObjectState) || [];
}

/*
    Every chip's text by object, for the two places that name an object once (#374, #385). An
    iteration is left out: beside the object's one name, its chip would read as the TOP
    occurrence being a friend of its own nickname.
*/
export function listFriendLabelsByObjectApiName(treeState: INavigationTreeState): Record<string, string[]> {

    const friendLabelsByObjectApiName: Record<string, string[]> = Object.create(null);

    treeState.objectStates.forEach(function (treeObjectState) {
        if (treeObjectState.isIteration) { return; }
        listFriendChips(treeObjectState).forEach(function (chip) {
            const objectApiName = treeObjectState.object.objectApiName;
            if (!hasOwnKey(friendLabelsByObjectApiName, objectApiName)) { friendLabelsByObjectApiName[objectApiName] = []; }
            if (friendLabelsByObjectApiName[objectApiName].indexOf(chip.label) === -1) { friendLabelsByObjectApiName[objectApiName].push(chip.label); }
        });
    });

    return friendLabelsByObjectApiName;

}

export function buildChipEmoji(emoji: string): HTMLElement {

    const emojiElement = createElement('span', 'treeChipEmoji', emoji);
    emojiElement.setAttribute('aria-hidden', 'true');
    return emojiElement;

}

// ONE CHIP PER PARENT (#411): A BUTTON OPENING THE PARENT'S ROW, OR MUTED TEXT WHEN NO ONE ROW IS THAT PARENT
export function drawFriendChips(treeObjectState: INavigationObjectState): void {

    const slotElement = treeObjectState.friendSlotElement;
    if (!slotElement) { return; }

    slotElement.textContent = '';
    treeObjectState.friendChipElementsByOwnerState = new Map();
    const chips = listFriendChips(treeObjectState);
    treeObjectState.friendSearchText = chips.map(function (chip) { return chip.label; }).join('\n').toLowerCase();

    chips.forEach(function (chip) {

        const description = 'Friend ' + chip.friendNumber + ' of ' + chip.parentLabel;
        const chipElement = chip.ownerState
            ? createButton('secondary', 'treeFriendChip', '', 'compact')
            : createElement('span', 'treeFriendChip muted');

        chipElement.appendChild(buildChipEmoji(RECIPE_COCKPIT_FRIEND_EMOJI));
        chipElement.appendChild(createElement('span', 'treeFriendLabel', chip.label));

        if (chip.ownerState) {
            const ownerState = chip.ownerState;
            // THE NAME STARTS WITH THE TEXT ON THE CHIP, SO A VOICE COMMAND SAYING WHAT IS SHOWN REACHES IT
            chipElement.setAttribute('aria-label', chip.label + ', friend ' + chip.friendNumber + ' of ' + chip.parentLabel + ': go to ' + ownerState.object.objectApiName);
            chipElement.setAttribute('title', description + '. Go to ' + ownerState.object.objectApiName + ', which holds ' + chip.parentLabel);
            chipElement.addEventListener('click', function () {
                closeNicknameMenu(false);
                revealTreeObjectRow(treeObjectState.treeState, ownerState, null, ownerState.nicknameChipElement || ownerState.toggleElement);
            });
            treeObjectState.friendChipElementsByOwnerState.set(ownerState, chipElement);
        } else {
            chipElement.setAttribute('title', description + ', which no one row of this recipe holds by nickname');
        }

        slotElement.appendChild(chipElement);

    });

}
