import { COCKPIT_KIT_CUSTOM_PROPERTIES } from '../../CockpitKit/CockpitKitStylesheet';
import { RECIPE_COCKPIT_CUSTOM_PROPERTIES } from '../RecipeCockpitService';

/*
    The stylesheet as a browser applies it (#644): every value the shell writes into :root beside the
    palette put back into the rules that read it, and the two calc() forms those values make worked
    out. A suite that pins "a body fades in over RECIPE_COCKPIT_MOTION_REVEAL_MILLISECONDS" still
    proves the constant reaches the rule. Colours stay var(--sdt-…): the palette checks read those.
*/
const VALUES_BY_PROPERTY: Readonly<Record<string, string>> = { ...COCKPIT_KIT_CUSTOM_PROPERTIES, ...RECIPE_COCKPIT_CUSTOM_PROPERTIES };

export function withCustomPropertyValues(shellHtml: string): string {

    return shellHtml
        .replace(/var\((--sdt-[\w-]+)\)/g, (variableRead, propertyName: string) =>
            Object.prototype.hasOwnProperty.call(VALUES_BY_PROPERTY, propertyName) ? VALUES_BY_PROPERTY[propertyName] : variableRead)
        .replace(/calc\(([0-9.]+)rem \* ([0-9]+)\)/g, (_calc, remText: string, factorText: string) => String(Number(remText) * Number(factorText)) + 'rem')
        .replace(/calc\(([0-9.]+)rem \+ ([0-9.]+)rem\)/g, (_calc, firstText: string, secondText: string) => String(Number(firstText) + Number(secondText)) + 'rem');

}
