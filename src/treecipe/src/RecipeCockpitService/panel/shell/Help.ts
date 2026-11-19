import { createButton, createElement, setShownWithMotion } from '../../../CockpitKit/panel/CockpitPanelElements';
import {
    RECIPE_COCKPIT_HELP_BACKEND_NOTE,
    RECIPE_COCKPIT_HELP_CLOSE_ARIA_LABEL,
    RECIPE_COCKPIT_HELP_CLOSE_LABEL,
    RECIPE_COCKPIT_HELP_GUIDE_LABEL,
    RECIPE_COCKPIT_HELP_NO_DIFFERENCE,
    RECIPE_COCKPIT_HELP_RUN_PREFIX,
    RECIPE_COCKPIT_HELP_SECTIONS,
    RECIPE_COCKPIT_HELP_SUMMARY_HEADING,
    RECIPE_COCKPIT_HELP_TITLE,
    RECIPE_COCKPIT_HELP_TOGGLE_ARIA_LABEL,
    RECIPE_COCKPIT_HELP_TOGGLE_LABEL
} from '../../RecipeCockpitHelpConstants';
import { cockpitBodyElement, vscodeApi } from '../RecipeCockpitPanelConnection';
import { describeTreeDifferences, displayTitleOf } from '../treecipe/navigation/TreePicker';
import { savePanelPlace } from './PanelPlace';
import type { ICardModel, ICardTree } from '../treecipe/card/CardTypes';

/*
    The help section (#332): where the recipes come from, what the cockpit changes without
    editing them, what does edit them and where the changes are kept, then one line per card
    that differs from its recipe file now. Everything is this file's own text or a name from the
    model, written through textContent; the guide's url is the host's, and the button posts
    nothing but the command. It outlives a model in this document, and its summary is drawn from
    the trees of the model on screen.
*/
let isHelpExpanded = false;
let helpToggleElement: HTMLButtonElement | null = null;
let helpSectionElement: HTMLElement | null = null;
let helpSummaryElement: HTMLElement | null = null;
let helpTrees: ICardTree[] = [];

export function renderHelp(recipe: ICardModel, hasObjects: boolean): void {

    helpTrees = hasObjects ? (recipe.trees || []) : [];

    const sectionElement = createElement('section', 'helpSection hidden');
    helpSectionElement = sectionElement;
    sectionElement.setAttribute('id', 'cockpitHelp');
    sectionElement.setAttribute('aria-label', RECIPE_COCKPIT_HELP_TITLE);
    const helpHeaderElement = createElement('div', 'helpHeader');
    helpHeaderElement.appendChild(createElement('div', 'helpTitle', RECIPE_COCKPIT_HELP_TITLE));
    const helpCloseElement = createButton('icon', 'helpClose', RECIPE_COCKPIT_HELP_CLOSE_LABEL);
    helpCloseElement.setAttribute('type', 'button');
    helpCloseElement.setAttribute('aria-label', RECIPE_COCKPIT_HELP_CLOSE_ARIA_LABEL);
    helpCloseElement.setAttribute('title', RECIPE_COCKPIT_HELP_CLOSE_ARIA_LABEL);
    helpCloseElement.setAttribute('aria-controls', 'cockpitHelp');
    helpCloseElement.addEventListener('click', closeHelp);
    helpHeaderElement.appendChild(helpCloseElement);
    sectionElement.appendChild(helpHeaderElement);
    sectionElement.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && isHelpExpanded) { closeHelp(); }
    });

    if (hasObjects && recipe.selectedRunFolderName) {
        sectionElement.appendChild(createElement('div', 'helpRun muted', RECIPE_COCKPIT_HELP_RUN_PREFIX + recipe.selectedRunFolderName));
    }

    RECIPE_COCKPIT_HELP_SECTIONS.forEach(function (helpSection) {
        const helpPartElement = createElement('div', 'helpPart');
        helpPartElement.appendChild(createElement('div', 'helpHeading', helpSection.heading));
        appendHelpParagraphs(helpPartElement, helpSection.paragraphs);
        if (Array.isArray(helpSection.items) && helpSection.items.length > 0) {
            const helpListElement = createElement('ul', 'helpList');
            helpSection.items.forEach(function (helpItem) { helpListElement.appendChild(createElement('li', '', helpItem)); });
            helpPartElement.appendChild(helpListElement);
        }
        appendHelpParagraphs(helpPartElement, helpSection.closingParagraphs);
        sectionElement.appendChild(helpPartElement);
    });

    sectionElement.appendChild(createElement('p', 'helpParagraph muted', RECIPE_COCKPIT_HELP_BACKEND_NOTE));

    if (hasObjects) {
        const helpSummaryPartElement = createElement('div', 'helpPart');
        helpSummaryPartElement.appendChild(createElement('div', 'helpHeading', RECIPE_COCKPIT_HELP_SUMMARY_HEADING));
        helpSummaryElement = createElement('ul', 'helpList helpSummary');
        helpSummaryPartElement.appendChild(helpSummaryElement);
        sectionElement.appendChild(helpSummaryPartElement);
        drawHelpSummary();
    }

    // A PRIMARY BUTTON: THE ONE MAIN ACTION OF THE HELP SECTION (#363)
    const helpActionsElement = createElement('div', 'emptyStateActions helpActions');
    const helpGuideElement = createButton('primary', 'helpGuideOpen', RECIPE_COCKPIT_HELP_GUIDE_LABEL);
    helpGuideElement.addEventListener('click', function () {
        vscodeApi.postMessage({ command: 'openHelpGuide' });
    });
    helpActionsElement.appendChild(helpGuideElement);
    sectionElement.appendChild(helpActionsElement);

    cockpitBodyElement.appendChild(sectionElement);

    if (helpToggleElement) {
        helpToggleElement.disabled = false;
        helpToggleElement.setAttribute('aria-controls', 'cockpitHelp');
    }
    setHelpExpanded(isHelpExpanded, false);

}

// ✕ AND ESCAPE CLOSE THE HELP AS ? DOES, AND HAND FOCUS BACK TO ? (#487)
function closeHelp(): void {

    if (!helpSectionElement) { return; }
    setHelpExpanded(false, true);
    savePanelPlace();
    if (helpToggleElement && !helpToggleElement.disabled) { helpToggleElement.focus(); }

}

function appendHelpParagraphs(containerElement: HTMLElement, paragraphs: readonly string[] | undefined): void {
    (paragraphs || []).forEach(function (paragraph) {
        containerElement.appendChild(createElement('p', 'helpParagraph', paragraph));
    });
}

function setHelpExpanded(isExpanded: boolean, isAnimated: boolean): void {

    isHelpExpanded = isExpanded;
    if (!helpToggleElement || !helpSectionElement) { return; }

    helpToggleElement.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    setShownWithMotion(helpSectionElement, isExpanded, isAnimated);

}

// WHETHER THE HELP IS OPEN IS PART OF THE READER'S PLACE (#222): SAVED WITH IT, AND PUT BACK BEFORE THE NEXT DRAW
export function isHelpOpen(): boolean {
    return isHelpExpanded;
}

export function restoreHelpExpanded(isExpanded: boolean): void {
    isHelpExpanded = isExpanded;
}

/*
    One line per card with a folder that generates something other than its recipe file, from
    the same fields the card draws its selection from. A card with no folder (the ungrouped one)
    can hold no selection, so it is never listed.
*/
export function drawHelpSummary(): void {

    const summaryElement = helpSummaryElement;
    if (!summaryElement) { return; }

    summaryElement.textContent = '';

    const summaryLines: string[] = [];
    helpTrees.forEach(function (tree) {
        if (!tree.folderName) { return; }
        const differences = describeTreeDifferences(tree);
        if (differences.length > 0) { summaryLines.push(displayTitleOf(tree) + ': ' + differences.join(' · ')); }
    });

    if (summaryLines.length === 0) {
        summaryElement.appendChild(createElement('li', 'muted', RECIPE_COCKPIT_HELP_NO_DIFFERENCE));
        return;
    }

    summaryLines.forEach(function (summaryLine) {
        summaryElement.appendChild(createElement('li', '', summaryLine));
    });

}

/*
    ? toggles the help section a render draws in the body (#350), and is disabled while there is
    none: before the first model, and after a failure to draw. STILL A PRIMARY BUTTON, AS IT WAS
    IN THE TOOLBAR (#363).
*/
export function buildHelpToggle(): HTMLButtonElement {

    const toggleElement = createButton('primary', 'helpToggle', RECIPE_COCKPIT_HELP_TOGGLE_LABEL);
    helpToggleElement = toggleElement;
    toggleElement.setAttribute('aria-label', RECIPE_COCKPIT_HELP_TOGGLE_ARIA_LABEL);
    toggleElement.setAttribute('title', RECIPE_COCKPIT_HELP_TOGGLE_ARIA_LABEL);
    toggleElement.addEventListener('click', function () {
        if (!helpSectionElement) { return; }
        setHelpExpanded(!isHelpExpanded, true);
        savePanelPlace();
    });
    disableHelpToggle();

    return toggleElement;

}

function disableHelpToggle(): void {

    if (!helpToggleElement) { return; }
    helpToggleElement.disabled = true;
    helpToggleElement.removeAttribute('aria-expanded');
    helpToggleElement.removeAttribute('aria-controls');

}

// A NEW MODEL OR A FAILURE TO DRAW DROPS THE SECTION; WHETHER IT WAS OPEN STAYS, FOR THE NEXT DRAW
export function resetHelpState(): void {

    disableHelpToggle();
    helpSectionElement = null;
    helpSummaryElement = null;
    helpTrees = [];

}
