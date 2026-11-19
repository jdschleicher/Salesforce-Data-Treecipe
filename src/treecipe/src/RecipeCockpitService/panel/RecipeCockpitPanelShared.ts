import { createButton, createElement } from '../../CockpitKit/panel/CockpitPanelElements';
import { loadStatusElement, vscodeApi } from './RecipeCockpitPanelConnection';
import type { IActionCardView } from './RecipeCockpitPanelBuilders';

/*
    The small helpers every tab of the Recipe Cockpit draws with (#657): text that shows only when
    there is some, an action card's disabled reason, the load status line, a count with its noun, a
    link to a recipe line, and a set of names read from a saved place.
*/

export function setTextShown(element: HTMLElement, text: string): void {
    if (element.textContent !== text) { element.textContent = text; }
    if (text) { element.classList.remove('hidden'); } else { element.classList.add('hidden'); }
}

// A DISABLED CARD SAYS WHY ON THE CARD, NOT ONLY IN ITS TOOLTIP; A REASON THE DETAIL ALREADY SAYS IS NOT SAID TWICE.
// THE TOOLTIP ALSO CARRIES THE WHOLE DETAIL, WHICH THE CARD MAY CLAMP
export function drawActionCardState(actionCard: IActionCardView, reason: string, title: string): void {
    const detail = actionCard.detailElement.textContent;
    actionCard.buttonElement.disabled = reason !== '';
    actionCard.buttonElement.setAttribute('title', (reason || title) + (detail && detail !== reason ? '\n' + detail : ''));
    setTextShown(actionCard.reasonElement, reason === detail ? '' : reason);
}

export function setLoadStatus(statusMessage: unknown, isFailure: boolean): void {

    if (!loadStatusElement) { return; }

    if (!statusMessage) {
        loadStatusElement.classList.add('hidden');
        return;
    }

    loadStatusElement.textContent = String(statusMessage);
    loadStatusElement.classList.remove('hidden');

    if (isFailure) {
        loadStatusElement.classList.add('failed');
    } else {
        loadStatusElement.classList.remove('failed');
    }

}

export function pluralize(count: number, singular: string, plural: string): string {
    return count + ' ' + (count === 1 ? singular : plural);
}

export function buildSourceLink(className: string, labelText: string, filePath: unknown, lineNumber: unknown): HTMLElement {

    if (!filePath || !lineNumber) {
        return createElement('span', className, labelText);
    }

    const sourceLinkElement = createButton('link', className + ' sourceLink', labelText);
    sourceLinkElement.setAttribute('title', 'Open in the recipe file');
    sourceLinkElement.addEventListener('click', function () {
        vscodeApi.postMessage({ command: 'openSource', filePath: filePath, lineNumber: lineNumber });
    });

    return sourceLinkElement;

}

// A SET OF THE STRINGS IN A LIST READ FROM A SAVED PLACE; KEYED BY NAMES FROM FILES, SO NO PROTOTYPE
export function toStringSet(candidateList: unknown): Record<string, true> {

    const stringSet: Record<string, true> = Object.create(null);
    if (Array.isArray(candidateList)) {
        candidateList.forEach(function (candidate) { if (typeof candidate === 'string') { stringSet[candidate] = true; } });
    }
    return stringSet;

}

export function hasString(stringSet: Record<string, true>, candidate: unknown): boolean {
    return Object.prototype.hasOwnProperty.call(stringSet, candidate as PropertyKey);
}

export function hasAnyString(stringSet: Record<string, true>): boolean {
    return Object.keys(stringSet).length > 0;
}
