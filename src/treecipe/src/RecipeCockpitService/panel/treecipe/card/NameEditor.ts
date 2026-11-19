import { createElement } from '../../../../CockpitKit/panel/CockpitPanelElements';
import { vscodeApi } from '../../RecipeCockpitPanelConnection';
import { findTreeState, renderedSequence, treeStates } from '../../shell/PanelRender';
import type { INameEditorOptions, INameEditorState } from './CardTypes';

/*
    A card's or a data set row's name, edited where it is drawn (#551). The box stands in the
    name's place while it is open and is built on the first open. Enter, or leaving the box,
    posts the typed text once; Escape puts the name back and focus on ✎. The host checks the
    name and answers nameEditResult: a refusal is written under the box with textContent and the
    box stays open with what was typed, a save closes it once the name has been redrawn.
*/
export function buildNameEditor(nameEditorOptions: INameEditorOptions): INameEditorState {

    const nameEditor: INameEditorState = Object.assign({ element: null, inputElement: null, refusalElement: null, isOpen: false, postedName: null }, nameEditorOptions);
    const openerElement = nameEditor.openerElement;

    openerElement.setAttribute('aria-expanded', 'false');
    // PRESSED WHILE THE BOX IS OPEN, ✎ WOULD TAKE FOCUS AND SO SAVE BY THE BOX'S blur; KEPT IN THE BOX, THE CLICK CANCELS
    openerElement.addEventListener('mousedown', function (event) {
        if (nameEditor.isOpen && typeof event.preventDefault === 'function') { event.preventDefault(); }
    });
    openerElement.addEventListener('click', function () {
        if (nameEditor.isOpen) { closeNameEditor(nameEditor, true); } else { openNameEditor(nameEditor); }
    });

    return nameEditor;

}

let nameEditorCount = 0;

function ensureNameEditorElement(nameEditor: INameEditorState): void {

    if (nameEditor.element) { return; }

    const refusalId = 'nameEditorRefusal' + (++nameEditorCount);

    const editorElement = createElement('span', 'nameEditor ' + (nameEditor.nameTarget === 'tree' ? 'treeNameEditor' : 'datasetNameEditor') + ' hidden');
    const inputElement = createElement('input', 'nameEditorInput');
    const refusalElement = createElement('span', 'nameEditorRefusal hidden');

    editorElement.setAttribute('role', 'group');
    inputElement.setAttribute('type', 'text');
    inputElement.setAttribute('maxlength', String(nameEditor.maxLength));
    inputElement.setAttribute('aria-describedby', refusalId);
    refusalElement.setAttribute('role', 'alert');
    refusalElement.setAttribute('id', refusalId);

    inputElement.addEventListener('keydown', function (event) {
        // ENTER THAT ENDS AN INPUT METHOD'S COMPOSITION IS THE COMPOSITION'S, NOT A SAVE
        if (event.isComposing) { return; }
        if (event.key === 'Enter') {
            if (typeof event.preventDefault === 'function') { event.preventDefault(); }
            commitNameEditor(nameEditor);
        } else if (event.key === 'Escape') {
            if (typeof event.preventDefault === 'function') { event.preventDefault(); }
            event.stopPropagation();
            closeNameEditor(nameEditor, true);
        }
    });
    inputElement.addEventListener('blur', function () {
        if (nameEditor.isOpen) { commitNameEditor(nameEditor); }
    });
    // A CLICK IN THE BOX IS THE BOX'S, NOT THE ROW'S OR THE CARD'S UNDER IT
    editorElement.addEventListener('click', function (event) { event.stopPropagation(); });

    editorElement.appendChild(inputElement);
    editorElement.appendChild(refusalElement);
    ( nameEditor.displayElement.parentNode as ParentNode & Node ).insertBefore(editorElement, nameEditor.displayElement);

    nameEditor.element = editorElement;
    nameEditor.inputElement = inputElement;
    nameEditor.refusalElement = refusalElement;

}

function openNameEditor(nameEditor: INameEditorState): void {

    if (nameEditor.isOpen || ( nameEditor.openerElement as HTMLButtonElement ).disabled) { return; }

    ensureNameEditorElement(nameEditor);
    const inputElement = nameEditor.inputElement as HTMLInputElement;
    const editorElement = nameEditor.element as HTMLElement;

    nameEditor.isOpen = true;
    nameEditor.postedName = null;
    inputElement.value = nameEditor.readCustomName();
    inputElement.setAttribute('placeholder', nameEditor.placeholderText);
    editorElement.setAttribute('aria-label', 'Rename ' + nameEditor.readDisplayName());
    inputElement.setAttribute('aria-label', 'New name for ' + nameEditor.readDisplayName() + '. Leave it empty to show ' + nameEditor.placeholderText + '.');
    setNameEditorRefusal(nameEditor, '');
    nameEditor.displayElement.classList.add('hidden');
    editorElement.classList.remove('hidden');
    nameEditor.openerElement.setAttribute('aria-expanded', 'true');
    inputElement.focus();
    if (typeof inputElement.select === 'function') { inputElement.select(); }

}

// CLOSED BEFORE FOCUS MOVES, SO THE BOX'S OWN blur DOES NOT POST A NAME THE READER CANCELLED
function closeNameEditor(nameEditor: INameEditorState, isFocusReturned: boolean): void {

    if (!nameEditor.isOpen) { return; }

    nameEditor.isOpen = false;
    nameEditor.postedName = null;
    setNameEditorRefusal(nameEditor, '');
    ( nameEditor.element as HTMLElement ).classList.add('hidden');
    nameEditor.openerElement.setAttribute('aria-expanded', 'false');
    nameEditor.onClose();
    if (isFocusReturned && typeof nameEditor.openerElement.focus === 'function') { nameEditor.openerElement.focus(); }

}

function setNameEditorRefusal(nameEditor: INameEditorState, refusalText: string): void {

    const refusalElement = nameEditor.refusalElement as HTMLElement;
    const inputElement = nameEditor.inputElement as HTMLInputElement;

    refusalElement.textContent = refusalText;
    if (refusalText) { refusalElement.classList.remove('hidden'); } else { refusalElement.classList.add('hidden'); }
    if (refusalText) { inputElement.setAttribute('aria-invalid', 'true'); } else { inputElement.removeAttribute('aria-invalid'); }

}

// A NAME ALREADY POSTED IS NOT POSTED AGAIN BY THE blur THAT FOLLOWS ENTER, NOR AFTER THE HOST REFUSED IT
function commitNameEditor(nameEditor: INameEditorState): void {

    if (!nameEditor.isOpen || renderedSequence === null) { return; }

    const typedName = String(( nameEditor.inputElement as HTMLInputElement ).value);
    if (typedName === nameEditor.postedName) { return; }

    if (typedName.trim() === nameEditor.readCustomName()) {
        closeNameEditor(nameEditor, true);
        return;
    }

    nameEditor.postedName = typedName;
    const renameMessage: { command: string; treeKey?: string; datasetFolderName?: string; name?: string; renderSequence?: number } = nameEditor.nameTarget === 'tree'
        ? { command: 'renameTree', treeKey: nameEditor.nameKey }
        : { command: 'renameDataset', datasetFolderName: nameEditor.nameKey };
    renameMessage.name = typedName;
    renameMessage.renderSequence = renderedSequence;
    vscodeApi.postMessage(renameMessage);

}

interface INameEditResultMessage {
    renderSequence?: unknown;
    nameTarget?: unknown;
    nameKey?: unknown;
    name?: unknown;
    refusal?: unknown;
}

export function renderNameEditResult(nameEditResultMessage: INameEditResultMessage): void {

    if (renderedSequence === null || nameEditResultMessage.renderSequence !== renderedSequence) { return; }

    const nameEditors: INameEditorState[] = [];
    if (nameEditResultMessage.nameTarget === 'tree') {
        const treeState = findTreeState(nameEditResultMessage.nameKey);
        if (treeState && treeState.nameEditor) { nameEditors.push(treeState.nameEditor); }
    } else if (nameEditResultMessage.nameTarget === 'dataset') {
        treeStates.forEach(function (treeState) {
            (treeState.datasetRowStates || []).forEach(function (rowState) {
                if (rowState.dataset.datasetFolderName === nameEditResultMessage.nameKey && rowState.nameEditor) { nameEditors.push(rowState.nameEditor as INameEditorState); }
            });
        });
    }

    nameEditors
        .filter(function (nameEditor) { return nameEditor.isOpen && nameEditor.postedName === nameEditResultMessage.name; })
        .forEach(function (nameEditor) {
            if (typeof nameEditResultMessage.refusal === 'string') {
                setNameEditorRefusal(nameEditor, nameEditResultMessage.refusal);
            } else {
                closeNameEditor(nameEditor, document.activeElement === nameEditor.inputElement);
            }
        });

}
