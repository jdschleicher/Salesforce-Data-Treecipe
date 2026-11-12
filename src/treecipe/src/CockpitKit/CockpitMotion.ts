/*
    How long a body the reader opens fades in, and one they close fades out (#227): the kit's
    setShownWithMotion (panel/CockpitPanelElements.ts, #638) times its end with these, and a cockpit's
    stylesheet animates with the same numbers. Imports nothing.
*/
export const COCKPIT_MOTION_REVEAL_MILLISECONDS = 160;
export const COCKPIT_MOTION_CONCEAL_MILLISECONDS = 140;
