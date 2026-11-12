import { COCKPIT_BUTTON_KINDS, CockpitButtonKind } from '../CockpitButtonKindNames';
import { COCKPIT_MOTION_CONCEAL_MILLISECONDS, COCKPIT_MOTION_REVEAL_MILLISECONDS } from '../CockpitMotion';

/*
    The elements every cockpit panel draws with (#638): plain elements, the one button maker, and
    showing or hiding a body with motion. Browser code, bundled into a cockpit's script; it reads
    nothing from the script around it. Every text goes in through textContent.
*/
export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

export function createElement<TagName extends keyof HTMLElementTagNameMap>(tagName: TagName, className?: string, textContent?: string): HTMLElementTagNameMap[TagName] {

    const element = document.createElement(tagName);
    if (className) { element.className = className; }
    if (textContent !== undefined) { element.textContent = textContent; }
    return element;

}

// THE ONLY WAY THE PANEL MAKES A BUTTON (#363): ITS KIND STYLES IT, ITS OWN CLASS ONLY SIZES AND PLACES IT
export function createButton(kind: CockpitButtonKind, className?: string, textContent?: string, size?: 'compact'): HTMLButtonElement {

    // CODE STILL IN THE TEMPLATE-LITERAL SCRIPT IS NOT TYPE CHECKED, SO A KIND IS STILL CHECKED WHEN IT RUNS
    if (COCKPIT_BUTTON_KINDS.indexOf(kind) === -1) { throw new Error('Unknown button kind: ' + kind); }
    const buttonClassName = 'sdtButton sdtButton-' + kind + (size === 'compact' ? ' sdtButton-compact' : '') + (className ? ' ' + className : '');
    return createElement('button', buttonClassName, textContent);

}

export function setShown(element: Element, isShown: boolean): void {
    if (isShown) { element.classList.remove('hidden'); } else { element.classList.add('hidden'); }
}

export function isMotionReduced(): boolean {
    return typeof window.matchMedia === 'function' && !!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const motionTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>();

function endMotion(element: Element): void {
    const motionTimer = motionTimers.get(element);
    if (motionTimer === undefined) { return; }
    clearTimeout(motionTimer);
    motionTimers.delete(element);
    element.classList.remove('motionReveal');
    element.classList.remove('motionConceal');
    element.removeAttribute('aria-hidden');
    element.removeAttribute('inert');
}

/*
    "hidden" is set or cleared FIRST, so it -- and every test of it -- is accurate for the whole
    animation. A closing body stays drawn only while it fades, aria-hidden and inert meanwhile.
    A body is revealed after it is built, so an animation never builds a row.
*/
export function setShownWithMotion(element: Element, isShown: boolean, isAnimated: boolean): void {

    const wasShown = !element.classList.contains('hidden');

    endMotion(element);
    setShown(element, isShown);

    if (!isAnimated || wasShown === isShown || isMotionReduced()) { return; }

    if (isShown) {
        element.classList.add('motionReveal');
    } else {
        element.classList.add('motionConceal');
        element.setAttribute('aria-hidden', 'true');
        element.setAttribute('inert', '');
    }
    motionTimers.set(element, setTimeout(function () { endMotion(element); }, isShown ? COCKPIT_MOTION_REVEAL_MILLISECONDS : COCKPIT_MOTION_CONCEAL_MILLISECONDS));

}

// THE STYLESHEET TURNS THE ONE ▸ PATH ON aria-expanded, SO IT ROTATES RATHER THAN SWAPPING (#227)
export function drawToggle(toggleElement: Element, isExpanded: boolean, isAnimated: boolean): void {
    if (isAnimated) { toggleElement.classList.remove('noMotion'); } else { toggleElement.classList.add('noMotion'); }
    toggleElement.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
}
