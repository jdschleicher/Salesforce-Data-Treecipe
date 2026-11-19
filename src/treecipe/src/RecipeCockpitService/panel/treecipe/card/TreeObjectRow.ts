import { createElement, drawToggle, setShownWithMotion } from '../../../../CockpitKit/panel/CockpitPanelElements';
import { RECIPE_COCKPIT_NO_FIELDS_SELECTED_MESSAGE } from '../../../RecipeCockpitFieldRowsConstants';
import { RECIPE_COCKPIT_MAX_DRAWN_NESTING_DEPTH } from '../../../RecipeCockpitShellConstants';
import { buildToggleElement } from '../../RecipeCockpitPanelBuilders';
import { hasOwnKey } from '../../RecipeCockpitOwnKey';
import { buildSourceLink } from '../../RecipeCockpitPanelShared';
import { savePanelPlace } from '../../shell/PanelPlace';
import { buildTreeFieldState } from '../fieldEditor/FieldEditor';
import { appendAddFriendControls } from '../fieldEditor/LookupWiring';
import { applyTreeFieldVisibility, buildTreeFieldRow, formatParentLookups } from '../fieldRows/FieldRow';
import { buildSelectAllFieldsElement, drawObjectFieldSelection } from '../fieldRows/FieldScope';
import { buildIncludeElement } from '../fieldRows/SelectionCascade';
import { nicknameOfObject, readNestingParent } from '../navigation/Nicknames';
import { drawStructureMatchCount } from '../navigation/StructureFilter';
import { buildObjectRefreshButton } from '../objectRefresh/ObjectRefreshDialog';
import { buildTodoListElement } from '../recordTypes/TodosToggles';
import { recordTypesState } from '../recordTypes/RecordTypesState';
import { buildRecordCountElement } from './RecordCount';
import { asCardObjectState } from './CardTypes';
import type { CardObjectState, ICardField, ICardObject, ICardTree, ICardTreeObject } from './CardTypes';
import type { ITreeObjectStateView } from '../navigation/NavigationTypes';
import type { IRecipeTodo } from '../recordTypes/RecordTypeTypes';

/*
    One object row of a tree card (#188, #255, #467): its header is made with the card, its field
    rows wait for the row's own first expand. A later occurrence of an object (an iteration) is a
    row of its own, built from the object and the occurrence's own lines.
*/

export function setTreeObjectExpanded(treeObjectStateView: ITreeObjectStateView, isExpanded: boolean | undefined, isAnimated?: boolean): void {

    const treeObjectState = asCardObjectState(treeObjectStateView);

    if (isExpanded && !treeObjectState.isBodyBuilt) {
        if (treeObjectState.objectTodos.length > 0) {
            treeObjectState.bodyElement.appendChild(buildTodoListElement(treeObjectState.object.recipeFilePath, treeObjectState.objectTodos as IRecipeTodo[]));
        }
        // THE ROW HOLDS THE FIELD BOXES (#410, #477) AND THE OBJECT'S OWN TODO FILTER (#477); EACH HIDES ON ITS OWN
        const hasSelectableFields = treeObjectState.canSelectFields && treeObjectState.fieldStates.some(function (fieldState) { return !!fieldState.field.lineNumber; });
        if (hasSelectableFields || treeObjectState.todoCount > 0) {
            treeObjectState.bodyElement.appendChild(buildSelectAllFieldsElement(treeObjectState, hasSelectableFields));
        }
        // THE FIELDS ARE ONE BORDERED BOX (#494), THEIR CHECKBOXES UNDER THE OBJECT'S ▸
        if (treeObjectState.fieldStates.length > 0) {
            const fieldsBoxElement = createElement('div', 'treeFieldsBox');
            treeObjectState.fieldStates.forEach(function (fieldState) {
                fieldState.rowElement = buildTreeFieldRow(treeObjectState, fieldState);
                applyTreeFieldVisibility(fieldState);
                fieldsBoxElement.appendChild(fieldState.rowElement);
            });
            treeObjectState.bodyElement.appendChild(fieldsBoxElement);
        }
        treeObjectState.isBodyBuilt = true;
        if (drawObjectFieldSelection(treeObjectState)) { drawStructureMatchCount(treeObjectState.treeState); }
    }

    // A RESTORE PASSES WHAT THE READER LAST DID, WHICH IS undefined FOR A ROW NOBODY OPENED: THE ROW STAYS CLOSED
    setShownWithMotion(treeObjectState.bodyElement, isExpanded as boolean, isAnimated as boolean);

    treeObjectState.isExpanded = isExpanded as boolean;
    drawToggle(treeObjectState.toggleElement, isExpanded as boolean, isAnimated as boolean);

}

/*
    An object's header is made with its tree; its ROWS wait for the object's own first expand.
*/
export function buildTreeObjectState(treeObject: ICardTreeObject, object: ICardObject, tree: ICardTree): CardObjectState {

    const treeKey = tree.treeKey;
    const objectElement = createElement('div', 'treeObject');
    const objectHeaderElement = createElement('div', 'treeObjectHeader');
    const toggleElement = buildToggleElement('treeObjectToggle');

    // A LATER OCCURRENCE IS INDENTED UNDER THE ONE WHOSE friends: BLOCK HOLDS IT (#467)
    if (typeof treeObject.nestingDepth === 'number' && treeObject.nestingDepth > 0) {
        objectElement.classList.add('treeObjectNested');
        objectElement.classList.add('treeObjectDepth' + Math.min(Math.floor(treeObject.nestingDepth), RECIPE_COCKPIT_MAX_DRAWN_NESTING_DEPTH));
    }

    // ONE OBJECT THAT IS EVERY TAB'S VIEW OF THE ROW; treeState IS SET BY renderTree ONCE THE CARD'S STATE EXISTS
    const treeObjectState = {
        treeObject: treeObject,
        object: object,
        isIteration: !!object.iteration,
        objectSearchText: [object.objectApiName, object.nickname || ''].join(' ').toLowerCase(),
        fieldStates: object.fields.map(buildTreeFieldState),
        matchingFieldCount: object.fields.length,
        isBodyBuilt: false,
        isExpanded: false,
        isExpandedByReader: false,
        element: objectElement,
        toggleElement: toggleElement,
        bodyElement: createElement('div', 'treeObjectBody hidden'),
        countElement: createElement('span', 'treeObjectCount muted'),
        lookupsElement: createElement('span', 'treeLookups muted'),
        exclusionElement: createElement('span', 'treeExclusion muted hidden'),
        noFieldsSelectedElement: createElement('span', 'treeNoFieldsSelected hidden', RECIPE_COCKPIT_NO_FIELDS_SELECTED_MESSAGE),
        headerDetailElements: [],
        includeElement: null,
        glyphElement: null,
        glyphPathElement: null,
        tree: tree,
        // A CARD WITH A FOLDER KEEPS ITS UNTICKED FIELDS (#220); AN ITERATION KEEPS ITS OWN (#467)
        canSelectFields: !!tree.folderName && !object.hasIndistinctOccurrences,
        recordCountElement: null,
        countButtonElement: null,
        countValueElement: null,
        countChangedElement: null,
        countLabelElement: null,
        countInputElement: null,
        countErrorElement: null,
        countDrawnKey: null,
        isCountEditorOpen: false,
        hasRecordTypes: hasOwnKey(recordTypesState.recordTypeFieldsByObjectApiName, object.objectApiName),
        recordTypeFieldCount: 0,
        // THE TODO COMMENTS OF THE BLOCK THAT SIT ON NO FIELD, AND EVERY TODO OF THE OCCURRENCE (#354)
        objectTodos: Array.isArray(object.todos) ? object.todos : [],
        todoCount: 0,
        // THE OBJECT'S OWN "Hide unselected" (#483), PANEL-ONLY
        isHidingUnselected: false,
        hideUnselectedCheckElement: null,
        hideUnselectedLabelElement: null,
        hideUnselectedToggleElement: null,
        treeState: null,
        headerElement: objectHeaderElement,
        nicknameSlotElement: null,
        nicknameChipElement: null,
        nicknameMenuElement: null,
        // THE PARENTS A FRIEND ROW NAMES, DRAWN WITH THE TREECIPE TAB (#411); THEIR TEXT IS SEARCHED WITH THE OBJECT'S NAME
        friendSlotElement: null,
        friendSearchText: '',
        // EACH PARENT'S CHIP ON THIS ROW, SO A PARENT'S 👥 N LIST CAN FOCUS THE ONE POINTING BACK (#492)
        friendChipElementsByOwnerState: new Map(),
        friendsButtonElement: null,
        friendsMenuOwner: { nicknameMenuElement: null }
    } as unknown as CardObjectState;

    treeObjectState.todoCount = treeObjectState.fieldStates.reduce(function (todoCount, fieldState) { return todoCount + fieldState.todos.length; }, treeObjectState.objectTodos.length);

    // AN ITERATION IS THE SAME OBJECT, SO ITS ROWS CARRY THE SAME CHIPS
    if (treeObjectState.hasRecordTypes) {
        const developerNamesByFieldApiName = recordTypesState.recordTypeFieldsByObjectApiName[object.objectApiName];
        treeObjectState.fieldStates.forEach(function (fieldState) {
            if (!hasOwnKey(developerNamesByFieldApiName, fieldState.field.fieldApiName)) { return; }
            fieldState.recordTypeDeveloperNames = developerNamesByFieldApiName[fieldState.field.fieldApiName];
            treeObjectState.recordTypeFieldCount++;
        });
    }

    toggleElement.setAttribute('aria-expanded', 'false');
    toggleElement.setAttribute('aria-label', 'Show or hide the fields of ' + object.objectApiName);
    toggleElement.addEventListener('click', function () {
        treeObjectState.isExpandedByReader = !treeObjectState.isExpanded;
        setTreeObjectExpanded(treeObjectState, treeObjectState.isExpandedByReader, true);
        savePanelPlace();
    });

    // A CARD WITH A FOLDER KEEPS ITS EXCLUSIONS; AN ITERATION FOLLOWS ITS OBJECT AND HAS NO ICON OF ITS OWN (#219)
    // THE LINK LEADS THE ROW, AND A ROW WITHOUT ONE KEEPS ITS SLOT, SO EVERY ▸ AND NAME OF A CARD LINES UP (#257)
    if (tree.folderName && !object.iteration) {
        buildIncludeElement(treeObjectState, treeKey);
        objectHeaderElement.appendChild(treeObjectState.includeElement as HTMLButtonElement);
    } else {
        const spacerElement = createElement('span', 'treeObjectIncludeSpacer');
        spacerElement.setAttribute('aria-hidden', 'true');
        objectHeaderElement.appendChild(spacerElement);
    }

    objectHeaderElement.appendChild(toggleElement);

    objectHeaderElement.appendChild(buildSourceLink('treeObjectName', object.objectApiName, object.recipeFilePath, object.lineNumber));
    const nameChildCount = objectHeaderElement.children.length;

    // FILLED WHEN THE CARD'S TREECIPE TAB IS BUILT, SINCE WHETHER IT OPENS A LIST DEPENDS ON THE WHOLE CARD (#380)
    if (nicknameOfObject(object)) {
        treeObjectState.nicknameSlotElement = createElement('span', 'treeNicknameSlot');
        objectHeaderElement.appendChild(treeObjectState.nicknameSlotElement);
    }

    if (object.iteration) {
        const parentName = object.iteration.parentNickname || object.iteration.parentObjectApiName;
        if (parentName) { objectHeaderElement.appendChild(createElement('span', 'treeIteration muted', 'nested under ' + parentName)); }
    }

    if (readNestingParent(treeObjectState.object)) {
        treeObjectState.friendSlotElement = createElement('span', 'treeFriendSlot');
        objectHeaderElement.appendChild(treeObjectState.friendSlotElement);
    }

    // A COUNT BOX ONLY WHERE THE HOST CAN STORE ONE: A CARD WITH A FOLDER, AN OBJECT TOLD APART, WITH A READABLE "count:" (#255); AN ITERATION HAS ITS OWN (#467)
    if (tree.folderName && !object.hasIndistinctOccurrences && typeof object.recordCount === 'number') {
        objectHeaderElement.appendChild(buildRecordCountElement(treeObjectState));
    }

    if (formatParentLookups(treeObject)) {
        objectHeaderElement.appendChild(treeObjectState.lookupsElement);
    }

    objectHeaderElement.appendChild(treeObjectState.exclusionElement);
    objectHeaderElement.appendChild(treeObjectState.countElement);

    if (object.iteration) { appendAddFriendControls(treeKey, treeObjectState.object, objectHeaderElement); }

    // LAST ON THE ROW (#612): A CARD WITH A FOLDER, NEVER AN ITERATION, WHICH IS THE SAME OBJECT
    if (tree.folderName && !object.iteration) {
        objectHeaderElement.appendChild(buildObjectRefreshButton(treeKey, object));
    }

    treeObjectState.headerDetailElements = Array.prototype.slice.call(objectHeaderElement.children, nameChildCount);
    objectHeaderElement.appendChild(treeObjectState.noFieldsSelectedElement);

    objectElement.appendChild(objectHeaderElement);
    objectElement.appendChild(treeObjectState.bodyElement);

    return treeObjectState;

}

/*
    One later occurrence of an object, drawn as an object of its own (#188): the object's field
    rows, each at the occurrence's line and with its value, and the occurrence's own header line.
    A field only the occurrence writes is listed after them, as read from the recipe file.
*/
export function buildIterationObject(object: ICardObject, iterationNickname: string): ICardObject | null {

    const iteration = (object.iterations || []).find(function (candidate) { return candidate.nickname === iterationNickname; });
    if (!iteration) { return null; }

    const iterationFieldsByApiName = Object.create(null);
    iteration.fields.forEach(function (iterationField) { iterationFieldsByApiName[iterationField.fieldApiName] = iterationField; });

    const objectFieldApiNames = Object.create(null);
    const fields: ICardField[] = object.fields.map(function (field) {
        objectFieldApiNames[field.fieldApiName] = true;
        const iterationField = iterationFieldsByApiName[field.fieldApiName];
        return Object.assign({}, field, {
            lineNumber: iterationField ? iterationField.lineNumber : undefined,
            recipeValue: iterationField ? iterationField.recipeValue : field.recipeValue,
            // THE OCCURRENCE'S OWN TODOS (#354): THE OBJECT'S ARE THE FIRST OCCURRENCE'S
            todos: iterationField && Array.isArray(iterationField.todos) ? iterationField.todos : undefined
        });
    });

    iteration.fields.forEach(function (iterationField) {
        if (objectFieldApiNames[iterationField.fieldApiName]) { return; }
        fields.push({
            fieldApiName: iterationField.fieldApiName,
            fieldLabel: '',
            fieldType: '',
            fieldTypeWithSize: '',
            recipeValue: iterationField.recipeValue,
            controllingField: '',
            isOnlyInRecipeFile: true,
            lineNumber: iterationField.lineNumber,
            todos: Array.isArray(iterationField.todos) ? iterationField.todos : undefined
        });
    });

    return {
        objectApiName: object.objectApiName,
        recipeFilePath: object.recipeFilePath,
        lineNumber: iteration.lineNumber,
        nickname: iteration.nickname,
        iteration: iteration,
        fields: fields,
        todos: Array.isArray(iteration.todos) ? iteration.todos : undefined,
        // ITS OWN "count:" AND THE OBJECT IT IS RECORDS PER (#467), SO ITS COUNT BOX READS AND SETS THAT OCCURRENCE
        recordCount: typeof iteration.recordCount === 'number' ? iteration.recordCount : undefined,
        countParentObjectApiName: iteration.parentObjectApiName,
        hasRecordTypeSections: object.hasRecordTypeSections
    };

}

export function resolveTreeObject(treeObject: ICardTreeObject, objectsByApiName: Record<string, ICardObject>): ICardObject | null {

    if (!Object.prototype.hasOwnProperty.call(objectsByApiName, treeObject.objectApiName)) { return null; }

    const object = objectsByApiName[treeObject.objectApiName];
    return treeObject.iterationNickname === undefined ? object : buildIterationObject(object, treeObject.iterationNickname);

}
