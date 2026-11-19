/*
    The button kinds every Treecipe cockpit draws (#363, shared by #524). A button is made ONLY by the
    panel script's createButton, and styled ONLY by its kind's rules, so a new button cannot come out
    as a browser default by missing a selector list. compact is a size, not a kind.

    The rules are panel/CockpitButtonKinds.*.css (#644), kept as the four pieces the Recipe Cockpit's
    stylesheet has always interleaved with its own rules, so its cascade keeps that order; a cockpit
    with no rules between them includes the four in a row.
*/
export { COCKPIT_BUTTON_KINDS } from './CockpitButtonKindNames';
export type { CockpitButtonKind } from './CockpitButtonKindNames';

// ONE SIZE FOR EVERY STANDALONE ACTION CARD (#381), SO A GRID OF THEM LINES UP
export const COCKPIT_ACTION_CARD_HEIGHT = '10.5rem';
