import { SVG_NAMESPACE, createButton, createElement } from '../../../CockpitKit/panel/CockpitPanelElements';
import { RECIPE_COCKPIT_CHANGELOG_LINK_LABEL, RECIPE_COCKPIT_GITHUB_GLYPH_PATH, RECIPE_COCKPIT_GITHUB_GLYPH_VIEW_BOX } from '../../RecipeCockpitShellConstants';
import { cockpitMetaElement, vscodeApi } from '../RecipeCockpitPanelConnection';
import { buildHelpToggle } from './Help';

/*
    The CHANGELOG button and ? at the top right (#333, #350), drawn once beside the title and
    outside the body, so every load, empty state and failure to draw keeps them. The version is
    INSIDE the CHANGELOG button (#487), so a click on either opens it; it arrives from the host
    and is written as text, and the button posts no address -- the host owns it.
*/
let cockpitVersionElement: HTMLElement | null = null;
let cockpitChangelogElement: HTMLButtonElement | null = null;

export function renderCockpitMeta(): void {

    if (!cockpitMetaElement) { return; }

    const changelogElement = createButton('icon', 'cockpitChangelog');
    cockpitChangelogElement = changelogElement;
    cockpitVersionElement = createElement('span', 'cockpitVersion', '');
    const glyphElement = document.createElementNS(SVG_NAMESPACE, 'svg');
    const pathElement = document.createElementNS(SVG_NAMESPACE, 'path');

    changelogElement.setAttribute('type', 'button');
    labelChangelog('');
    glyphElement.setAttribute('class', 'githubGlyph');
    glyphElement.setAttribute('viewBox', RECIPE_COCKPIT_GITHUB_GLYPH_VIEW_BOX);
    glyphElement.setAttribute('aria-hidden', 'true');
    glyphElement.setAttribute('focusable', 'false');
    pathElement.setAttribute('d', RECIPE_COCKPIT_GITHUB_GLYPH_PATH);
    glyphElement.appendChild(pathElement);
    changelogElement.appendChild(glyphElement);
    changelogElement.appendChild(cockpitVersionElement);

    changelogElement.addEventListener('click', function () {
        vscodeApi.postMessage({ command: 'openChangelog' });
    });

    const helpToggleElement = buildHelpToggle();

    cockpitMetaElement.appendChild(changelogElement);
    cockpitMetaElement.appendChild(helpToggleElement);

}

interface IExtensionInfoMessage {
    version?: unknown;
}

export function renderExtensionInfo(hostMessage: IExtensionInfoMessage): void {

    if (!cockpitVersionElement) { return; }
    const versionText = typeof hostMessage.version === 'string' && hostMessage.version ? 'v' + hostMessage.version : '';
    cockpitVersionElement.textContent = versionText;
    labelChangelog(versionText);

}

function labelChangelog(versionText: string): void {

    if (!cockpitChangelogElement) { return; }
    const label = versionText ? RECIPE_COCKPIT_CHANGELOG_LINK_LABEL + ', ' + versionText : RECIPE_COCKPIT_CHANGELOG_LINK_LABEL;
    cockpitChangelogElement.setAttribute('aria-label', label);
    cockpitChangelogElement.setAttribute('title', label);

}
