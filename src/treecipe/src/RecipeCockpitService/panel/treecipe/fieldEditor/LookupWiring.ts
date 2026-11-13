import { createButton, createElement } from '../../../../CockpitKit/panel/CockpitPanelElements';
import {
    RECIPE_COCKPIT_ADD_FRIEND_ACTION_LABEL,
    RECIPE_COCKPIT_CREATE_PARENT_ACTION_PREFIX,
    RECIPE_COCKPIT_CREATE_PARENT_ACTION_SUFFIX,
    RECIPE_COCKPIT_CREATE_PARENT_REFUSAL_TEXTS,
    RECIPE_COCKPIT_USE_ORG_RECORD_ACTION_PREFIX,
    RECIPE_COCKPIT_USE_ORG_RECORD_ACTION_SUFFIX,
    RECIPE_COCKPIT_WIRE_ALL_LOOKUPS_ACTION_LABEL,
    RECIPE_COCKPIT_WIRE_LOOKUP_ACTION_LABEL
} from '../../../RecipeCockpitTreecipeFieldEditorConstants';
import type { FieldEditorPanelMessage, IAddableParent, IEmptyLookup, ILookupDecision, ILookupDecisionMessage, ILookupWiring, ITreeFieldState, ITreeObjectState, ITreecipeObject, ITreecipeTree } from './FieldEditorTypes';

/*
    A lookup row's "Wire to…", an empty lookup's two decisions, "Wire TODO lookups" and a self-lookup
    iteration's "+ Add friend" (#151, #197, #294, #421, #653). The run locks and button lists are the
    panel script's lets, declare let here: it empties the lists for every new model, and its
    wireLookupState and addIterationFriendState handlers give the locks back.
*/
declare const vscodeApi: { postMessage(message: FieldEditorPanelMessage): void };
declare let isAddFriendRunning: boolean;
declare let addFriendButtonElements: HTMLButtonElement[];
declare let isWireLookupRunning: boolean;
declare let wireLookupButtonElements: HTMLButtonElement[];
declare let lookupDecisions: ILookupDecision[];
declare const FIELD_PARENT_EXCLUDED_REASON: string;
declare const FIXED_VALUE_OBJECT_EXCLUDED_REASON: string;
declare const FIXED_VALUE_UNTICKED_REASON: string;
declare function hasOwnKey(record: object, key: unknown): boolean;
declare function occurrenceNicknameOf(object: ITreecipeObject): string;
declare function findObjectExclusion(tree: ITreecipeTree, objectApiName: string): unknown;
declare function findObjectFieldSelection(tree: ITreecipeTree, objectApiName: string, nickname: string): { lockReasonsByFieldApiName: Record<string, string>; excludedFieldApiNames: Record<string, unknown> } | null;

// EACH CARD'S lookupWirings BY OBJECT, OCCURRENCE AND FIELD, BUILT ONCE PER CARD RATHER THAN SCANNED PER ROW
const lookupWiringIndexByTree = new WeakMap<ITreecipeTree, Record<string, ILookupWiring>>();
const addableParentIndexByTree = new WeakMap<ITreecipeTree, Record<string, IAddableParent>>();
const emptyLookupIndexByTree = new WeakMap<ITreecipeTree, Record<string, IEmptyLookup>>();

/*
    A self-lookup iteration's "+" (#197): the button, and the list of friends it opens on a line
    of its own at the end of the header, so an object is still its header and its rows. Each choice posts NAMES only -- the card, the
    object, the iteration's nickname and the friend -- and the host matches the four against what
    it rendered. One click disables every "+" until the host answers, so only one friend is ever
    being added.
*/
export function appendAddFriendControls(treeKey: string, object: ITreecipeObject, objectHeaderElement: HTMLElement): void {

    const friendObjectApiNames = ( object.iteration && object.iteration.insertableFriendObjectApiNames ) || [];
    if (friendObjectApiNames.length === 0) { return; }

    const addFriendElement = createButton('secondary', 'treeAddFriend', RECIPE_COCKPIT_ADD_FRIEND_ACTION_LABEL);
    const addFriendsElement = createElement('div', 'treeAddFriends hidden');

    addFriendElement.setAttribute('title', 'Add one of the friends of ' + object.objectApiName + ' under ' + object.nickname);
    addFriendElement.setAttribute('aria-label', 'Add friend under ' + object.nickname);
    addFriendElement.setAttribute('aria-expanded', 'false');
    addFriendElement.addEventListener('click', function () {
        const isOpening = addFriendsElement.classList.contains('hidden');
        if (isOpening) { addFriendsElement.classList.remove('hidden'); } else { addFriendsElement.classList.add('hidden'); }
        addFriendElement.setAttribute('aria-expanded', isOpening ? 'true' : 'false');
    });

    addFriendsElement.appendChild(createElement('span', 'muted', 'Add under ' + object.nickname + ':'));

    friendObjectApiNames.forEach(function (friendObjectApiName) {
        const choiceElement = createButton('secondary', 'treeAddFriendChoice', '+ ' + friendObjectApiName);
        choiceElement.setAttribute('aria-label', 'Add ' + friendObjectApiName + ' under ' + object.nickname);
        choiceElement.addEventListener('click', function () {
            if (isAddFriendRunning) { return; }
            setAddFriendRunning(true);
            vscodeApi.postMessage({
                command: 'addIterationFriend',
                treeKey: treeKey,
                objectApiName: object.objectApiName,
                objectNickname: object.nickname,
                friendObjectApiName: friendObjectApiName
            });
        });
        choiceElement.disabled = isAddFriendRunning;
        addFriendButtonElements.push(choiceElement);
        addFriendsElement.appendChild(choiceElement);
    });

    addFriendButtonElements.push(addFriendElement);
    objectHeaderElement.appendChild(addFriendElement);
    objectHeaderElement.appendChild(addFriendsElement);
    // ONLY THIS ROW'S BUTTONS -- SETTING EVERY ONE DRAWN SO FAR, PER ROW, IS QUADRATIC IN THE ROWS
    addFriendElement.disabled = isAddFriendRunning;

}

export function setAddFriendRunning(isRunning: boolean): void {

    isAddFriendRunning = isRunning;
    addFriendButtonElements.forEach(function (buttonElement) { buttonElement.disabled = isRunning; });

}

function lookupWiringKeyOf(objectApiName: string, objectNickname: string | undefined, fieldApiName: string): string {
    return objectApiName + '\n' + (objectNickname || '') + '\n' + fieldApiName;
}

// THE WIRING A ROW DRAWS "Wire to…" FOR: THE CARD'S OWN, FOR THIS OCCURRENCE OF THE OBJECT -- null FOR EVERY OTHER ROW
export function findLookupWiring(tree: ITreecipeTree, object: ITreecipeObject, fieldApiName: string): ILookupWiring | null {

    if (!tree.lookupWirings || tree.lookupWirings.length === 0) { return null; }

    let lookupWiringIndex = lookupWiringIndexByTree.get(tree);
    if (!lookupWiringIndex) {
        lookupWiringIndex = Object.create(null) as Record<string, ILookupWiring>;
        const builtIndex = lookupWiringIndex;
        tree.lookupWirings.forEach(function (entry) {
            builtIndex[lookupWiringKeyOf(entry.objectApiName, entry.objectNickname, entry.fieldApiName)] = entry;
        });
        lookupWiringIndexByTree.set(tree, lookupWiringIndex);
    }

    const key = lookupWiringKeyOf(object.objectApiName, object.nickname, fieldApiName);
    return Object.prototype.hasOwnProperty.call(lookupWiringIndex, key) ? lookupWiringIndex[key] : null;

}

/*
    "Wire to…" (#151) on a lookup the recipe still writes as a TODO, posting NAMES only -- the card,
    the object, the occurrence's nickname and the field. The nickname it is wired to is chosen on
    the host. One click disables every wire button until the host's wireLookupState gives them back.
*/
export function buildWireLookupElement(tree: ITreecipeTree, wiring: ILookupWiring): HTMLButtonElement {

    const wireElement = createButton('secondary', 'treeWireLookup', RECIPE_COCKPIT_WIRE_LOOKUP_ACTION_LABEL);
    const fieldLabel = wiring.objectApiName + (wiring.objectNickname ? ' (' + wiring.objectNickname + ')' : '') + '.' + wiring.fieldApiName;

    wireElement.setAttribute('title', wiring.candidateNicknames.length === 1
        ? 'Point this lookup at ' + wiring.candidateNicknames[0] + ' in the recipe file, after a confirmation'
        : 'Choose which of ' + wiring.candidateNicknames.join(', ') + ' this lookup points at in the recipe file');
    wireElement.setAttribute('aria-label', 'Wire ' + fieldLabel);
    wireElement.addEventListener('click', function () {
        if (isWireLookupRunning) { return; }
        setWireLookupRunning(true);
        const wireMessage: ILookupDecisionMessage = { command: 'wireLookup', treeKey: tree.treeKey, objectApiName: wiring.objectApiName, fieldApiName: wiring.fieldApiName };
        if (wiring.objectNickname) { wireMessage.objectNickname = wiring.objectNickname; }
        vscodeApi.postMessage(wireMessage);
    });
    wireElement.disabled = isWireLookupRunning;
    wireLookupButtonElements.push(wireElement);

    return wireElement;

}

// THE ADDITION A ROW DRAWS "Add <Parent> to recipe" FOR (#294) -- null FOR EVERY OTHER ROW
function findAddableParent(tree: ITreecipeTree, object: ITreecipeObject, fieldApiName: string): IAddableParent | null {

    if (!tree.addableParents || tree.addableParents.length === 0) { return null; }

    let addableParentIndex = addableParentIndexByTree.get(tree);
    if (!addableParentIndex) {
        addableParentIndex = Object.create(null) as Record<string, IAddableParent>;
        const builtIndex = addableParentIndex;
        tree.addableParents.forEach(function (entry) {
            builtIndex[lookupWiringKeyOf(entry.objectApiName, entry.objectNickname, entry.fieldApiName)] = entry;
        });
        addableParentIndexByTree.set(tree, addableParentIndex);
    }

    const key = lookupWiringKeyOf(object.objectApiName, object.nickname, fieldApiName);
    return Object.prototype.hasOwnProperty.call(addableParentIndex, key) ? addableParentIndex[key] : null;

}

// THE EMPTY LOOKUP A ROW DRAWS ITS TWO DECISIONS FOR (#421) -- null FOR EVERY OTHER ROW
export function findEmptyLookup(tree: ITreecipeTree, object: ITreecipeObject, fieldApiName: string): IEmptyLookup | null {

    if (!tree.emptyLookups || tree.emptyLookups.length === 0) { return null; }

    let emptyLookupIndex = emptyLookupIndexByTree.get(tree);
    if (!emptyLookupIndex) {
        emptyLookupIndex = Object.create(null) as Record<string, IEmptyLookup>;
        const builtIndex = emptyLookupIndex;
        tree.emptyLookups.forEach(function (entry) {
            builtIndex[lookupWiringKeyOf(entry.objectApiName, entry.objectNickname, entry.fieldApiName)] = entry;
        });
        emptyLookupIndexByTree.set(tree, emptyLookupIndex);
    }

    const key = lookupWiringKeyOf(object.objectApiName, object.nickname, fieldApiName);
    return Object.prototype.hasOwnProperty.call(emptyLookupIndex, key) ? emptyLookupIndex[key] : null;

}

/*
    An empty lookup's two decisions (#421), side by side: "Create <Parent> in recipe" -- #294's
    addition, posting the same NAMES "Wire to…" does -- and "Use existing <Parent> from org…",
    which posts the same NAMES; the org, the record and the Id are all chosen on the host. Both
    write the recipe file, so both are held by the one-write lock and given back by its
    wireLookupState. Create is drawn disabled, never hidden, when the host would refuse it.
*/
export function buildLookupDecisionElement(treeObjectState: ITreeObjectState, fieldState: ITreeFieldState, emptyLookup: IEmptyLookup): HTMLElement {

    const tree = treeObjectState.tree;
    const addition = findAddableParent(tree, treeObjectState.object, emptyLookup.fieldApiName);
    const fieldLabel = emptyLookup.objectApiName + (emptyLookup.objectNickname ? ' (' + emptyLookup.objectNickname + ')' : '') + '.' + emptyLookup.fieldApiName;
    const decisionElement = createElement('span', 'treeLookupDecision');
    const createParentElement = createButton('secondary', 'treeAddParentObject', RECIPE_COCKPIT_CREATE_PARENT_ACTION_PREFIX + emptyLookup.parentObjectApiName + RECIPE_COCKPIT_CREATE_PARENT_ACTION_SUFFIX);
    const useOrgRecordElement = createButton('secondary', 'treeUseOrgRecord', RECIPE_COCKPIT_USE_ORG_RECORD_ACTION_PREFIX + emptyLookup.parentObjectApiName + RECIPE_COCKPIT_USE_ORG_RECORD_ACTION_SUFFIX);
    const postDecision = function (command: 'addParentObject' | 'useOrgRecordForLookup'): void {
        if (isWireLookupRunning) { return; }
        setWireLookupRunning(true);
        const decisionMessage: ILookupDecisionMessage = { command: command, treeKey: tree.treeKey, objectApiName: emptyLookup.objectApiName, fieldApiName: emptyLookup.fieldApiName };
        if (emptyLookup.objectNickname) { decisionMessage.objectNickname = emptyLookup.objectNickname; }
        vscodeApi.postMessage(decisionMessage);
    };

    createParentElement.setAttribute('aria-label', 'Create ' + emptyLookup.parentObjectApiName + ' in the recipe for ' + fieldLabel);
    createParentElement.addEventListener('click', function () {
        if (createParentElement.disabled || !addition) { return; }
        postDecision('addParentObject');
    });
    useOrgRecordElement.setAttribute('aria-label', 'Use an existing ' + emptyLookup.parentObjectApiName + ' record from an org for ' + fieldLabel);
    useOrgRecordElement.addEventListener('click', function () {
        if (useOrgRecordElement.disabled) { return; }
        postDecision('useOrgRecordForLookup');
    });

    decisionElement.appendChild(createParentElement);
    decisionElement.appendChild(useOrgRecordElement);

    const decision: ILookupDecision = {
        element: decisionElement,
        createParentElement: createParentElement,
        useOrgRecordElement: useOrgRecordElement,
        emptyLookup: emptyLookup,
        createReason: addition ? '' : describeCreateParentRefusal(emptyLookup),
        useReason: emptyLookup.orgRecordRefusal || ''
    };
    fieldState.lookupDecision = decision;
    lookupDecisions.push(decision);
    drawLookupDecisionButtons(decision);

    return decisionElement;

}

/*
    An empty lookup's decisions as the card's selection now stands: a lookup to an excluded object
    (#219) draws neither, and one whose own object is excluded or whose field is unticked cannot be
    set to an org record, since generation leaves it out.
*/
export function drawFieldRowLookupDecision(treeObjectState: ITreeObjectState, fieldState: ITreeFieldState): void {

    const decision = fieldState.lookupDecision;
    if (!decision) { return; }

    const tree = treeObjectState.tree;
    const objectApiName = treeObjectState.object.objectApiName;
    const fieldApiName = fieldState.field.fieldApiName;
    const objectFieldSelection = findObjectFieldSelection(tree, objectApiName, occurrenceNicknameOf(treeObjectState.object));
    const lockReason = objectFieldSelection && hasOwnKey(objectFieldSelection.lockReasonsByFieldApiName, fieldApiName) ? objectFieldSelection.lockReasonsByFieldApiName[fieldApiName] : '';
    const isParentExcluded = lockReason === FIELD_PARENT_EXCLUDED_REASON || !!findObjectExclusion(tree, decision.emptyLookup.parentObjectApiName);

    if (isParentExcluded) { decision.element.classList.add('hidden'); } else { decision.element.classList.remove('hidden'); }

    decision.selectionReason = findObjectExclusion(tree, objectApiName) ? FIXED_VALUE_OBJECT_EXCLUDED_REASON
        : objectFieldSelection && hasOwnKey(objectFieldSelection.excludedFieldApiNames, fieldApiName) ? FIXED_VALUE_UNTICKED_REASON
        : '';
    drawLookupDecisionButtons(decision);

}

// THE HOST POSTS A CODE PER ROW; THE SENTENCE IS WORDED HERE, ONE CONSTANT FOR EVERY ROW
function describeCreateParentRefusal(emptyLookup: IEmptyLookup): string {
    const template = emptyLookup.createRefusalReason !== undefined && hasOwnKey(RECIPE_COCKPIT_CREATE_PARENT_REFUSAL_TEXTS, emptyLookup.createRefusalReason)
        ? RECIPE_COCKPIT_CREATE_PARENT_REFUSAL_TEXTS[emptyLookup.createRefusalReason]
        : 'the recipe cannot add {parent}';
    return template.split('{parent}').join(emptyLookup.parentObjectApiName).split('{object}').join(emptyLookup.objectApiName);
}

function drawLookupDecisionButtons(decision: ILookupDecision): void {

    const parentObjectApiName = decision.emptyLookup.parentObjectApiName;
    const useReason = decision.useReason || decision.selectionReason || '';

    decision.createParentElement.disabled = isWireLookupRunning || !!decision.createReason;
    decision.createParentElement.setAttribute('title', decision.createReason
        ? 'Cannot be created: ' + decision.createReason
        : 'Add a ' + parentObjectApiName + ' block with its minimum required fields to the recipe file and point this lookup at it, after a confirmation');
    decision.useOrgRecordElement.disabled = isWireLookupRunning || !!useReason;
    decision.useOrgRecordElement.setAttribute('title', useReason
        ? 'Cannot use an org record: ' + useReason
        : 'Choose an org, then search ' + parentObjectApiName + ' or enter a record Id; the Id is written into the recipe file after a confirmation');

}

// "Wire TODO lookups" ON A CARD WITH AT LEAST ONE LOOKUP THAT HAS EXACTLY ONE RECORD TO CHOOSE FROM; null OTHERWISE
export function buildWireAllLookupsElement(tree: ITreecipeTree): HTMLButtonElement | null {

    const singleCandidateCount = (tree.lookupWirings || []).filter(function (wiring) { return wiring.candidateNicknames.length === 1; }).length;
    if (singleCandidateCount === 0) { return null; }

    const wireAllElement = createButton('secondary', 'treeWireAllLookups', RECIPE_COCKPIT_WIRE_ALL_LOOKUPS_ACTION_LABEL + ' (' + singleCandidateCount + ')');
    wireAllElement.setAttribute('title', 'Point every TODO lookup of this tree that has exactly one record to choose from at that record\'s nickname, in the recipe file, after a confirmation that lists them');
    wireAllElement.addEventListener('click', function () {
        if (isWireLookupRunning) { return; }
        setWireLookupRunning(true);
        vscodeApi.postMessage({ command: 'wireAllLookups', treeKey: tree.treeKey });
    });
    wireAllElement.disabled = isWireLookupRunning;
    wireLookupButtonElements.push(wireAllElement);

    return wireAllElement;

}

export function setWireLookupRunning(isRunning: boolean): void {

    isWireLookupRunning = isRunning;
    wireLookupButtonElements.forEach(function (buttonElement) { buttonElement.disabled = isRunning; });
    lookupDecisions.forEach(drawLookupDecisionButtons);

}
