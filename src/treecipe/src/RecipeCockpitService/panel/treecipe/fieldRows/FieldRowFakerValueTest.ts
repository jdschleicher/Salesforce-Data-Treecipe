import { createButton, createElement, setShown } from '../../../../CockpitKit/panel/CockpitPanelElements';
import {
    RECIPE_COCKPIT_FAKER_VALUE_EXAMPLE_PREFIX,
    RECIPE_COCKPIT_FAKER_VALUE_TEST_BUSY_TITLE,
    RECIPE_COCKPIT_FAKER_VALUE_TEST_GLYPH,
    RECIPE_COCKPIT_FAKER_VALUE_TEST_LABEL_PREFIX,
    RECIPE_COCKPIT_FAKER_VALUE_TEST_TITLE
} from '../../../RecipeCockpitFieldRowsConstants';
import { RecipeCockpitFakerValueExample } from '../../../RecipeCockpitFakerValueExample';
import { vscodeApi as cockpitVscodeApi } from '../../RecipeCockpitPanelConnection';
import { hasOwnKey } from '../../RecipeCockpitOwnKey';
import { renderedSequence } from '../../shell/PanelRender';
import type { ITreeFieldState, ITreeObjectState } from '../fieldEditor/FieldEditorTypes';

/*
    "Test faker value" (#718): a button at the right of a field row's faker expression. It posts the
    row's names only; the host runs the expression the row shows and answers fakerValueExample, which
    draws "Example: <value>" under the expression with textContent, replacing the last one. The
    button is drawn only where RecipeCockpitFakerValueExample's rules hold, and hidden with the
    expression while a fixed value or edit takes its place.
*/

export interface ITestFakerValueMessage {
    command: 'testFakerValue';
    treeKey: string;
    objectApiName: string;
    fieldApiName: string;
    nickname?: string;
}

export interface IFakerValueExampleMessage {
    renderSequence: unknown;
    treeKey: unknown;
    objectApiName: unknown;
    nickname?: unknown;
    fieldApiName: unknown;
    exampleText?: unknown;
}

const vscodeApi: { postMessage(message: ITestFakerValueMessage): void } = cockpitVscodeApi;

// THE ROWS WAITING FOR AN ANSWER, BY THE NAMES THEY POSTED; KEYED BY NAMES FROM DISK, SO NO PROTOTYPE
let pendingExampleRowsByKey: Record<string, Array<(exampleText: string | undefined) => void>> = Object.create(null);

function buildExampleKey(treeKey: unknown, objectApiName: unknown, nickname: unknown, fieldApiName: unknown): string {
    return JSON.stringify([treeKey, objectApiName, nickname || '', fieldApiName]);
}

export function canTestFakerValue(treeObjectState: ITreeObjectState & { canSelectFields?: boolean }, fieldState: ITreeFieldState): boolean {

    const field = fieldState.field;

    return !!treeObjectState.canSelectFields && !!field.lineNumber && typeof field.recipeValue === 'string'
        && RecipeCockpitFakerValueExample.findNoExampleReason({
            objectApiName: treeObjectState.object.objectApiName,
            fieldApiName: field.fieldApiName,
            recipeValue: field.recipeValue,
            controllingField: field.controllingField
        }) === undefined;

}

// THE BUTTON FOR THE EXPRESSION ROW AND THE LINE UNDER IT; THE CALLER PLACES BOTH
export function buildFakerValueTestElements(treeObjectState: ITreeObjectState, fieldState: ITreeFieldState): { buttonElement: HTMLButtonElement; exampleElement: HTMLElement } {

    const tree = treeObjectState.tree;
    const object = treeObjectState.object;
    const field = fieldState.field;
    const buttonElement = createButton('icon', 'fakerValueTest', RECIPE_COCKPIT_FAKER_VALUE_TEST_GLYPH);
    const exampleElement = createElement('div', 'fakerValueExample muted hidden');

    buttonElement.setAttribute('aria-label', RECIPE_COCKPIT_FAKER_VALUE_TEST_LABEL_PREFIX + object.objectApiName + '.' + field.fieldApiName);
    buttonElement.setAttribute('title', RECIPE_COCKPIT_FAKER_VALUE_TEST_TITLE);
    exampleElement.setAttribute('aria-live', 'polite');

    const setBusy = function (isBusy: boolean): void {
        buttonElement.disabled = isBusy;
        buttonElement.setAttribute('aria-busy', isBusy ? 'true' : 'false');
        buttonElement.setAttribute('title', isBusy ? RECIPE_COCKPIT_FAKER_VALUE_TEST_BUSY_TITLE : RECIPE_COCKPIT_FAKER_VALUE_TEST_TITLE);
    };

    buttonElement.addEventListener('click', function () {

        if (buttonElement.disabled) { return; }

        const exampleKey = buildExampleKey(tree.treeKey, object.objectApiName, object.nickname, field.fieldApiName);
        if (!hasOwnKey(pendingExampleRowsByKey, exampleKey)) { pendingExampleRowsByKey[exampleKey] = []; }
        pendingExampleRowsByKey[exampleKey].push(function (exampleText) {
            setBusy(false);
            if (exampleText === undefined) { return; }
            exampleElement.textContent = RECIPE_COCKPIT_FAKER_VALUE_EXAMPLE_PREFIX + exampleText;
            setShown(exampleElement, true);
        });

        setBusy(true);
        const message: ITestFakerValueMessage = { command: 'testFakerValue', treeKey: tree.treeKey, objectApiName: object.objectApiName, fieldApiName: field.fieldApiName };
        if (object.nickname) { message.nickname = object.nickname; }
        vscodeApi.postMessage(message);

    });

    return { buttonElement: buttonElement, exampleElement: exampleElement };

}

// A NEW MODEL DRAWS NEW ROWS, SO AN ANSWER FOR THE OLD ONES HAS NOWHERE TO GO
export function resetFakerValueExampleRequests(): void {
    pendingExampleRowsByKey = Object.create(null);
}

// DRAWN ONLY INTO A ROW OF THE MODEL ON SCREEN THAT ASKED
export function renderFakerValueExample(exampleMessage: IFakerValueExampleMessage): void {

    if (exampleMessage.renderSequence !== renderedSequence) { return; }

    const exampleKey = buildExampleKey(exampleMessage.treeKey, exampleMessage.objectApiName, exampleMessage.nickname, exampleMessage.fieldApiName);
    if (!hasOwnKey(pendingExampleRowsByKey, exampleKey)) { return; }

    const answerRows = pendingExampleRowsByKey[exampleKey];
    delete pendingExampleRowsByKey[exampleKey];
    const exampleText = typeof exampleMessage.exampleText === 'string' ? exampleMessage.exampleText : undefined;
    answerRows.forEach(function (answerRow) { answerRow(exampleText); });

}
