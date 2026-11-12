/*
    The button kinds every cockpit draws (#363), apart from their CSS (CockpitButtonKinds.ts), so the
    panel's createButton can import the list without bundling the stylesheet into the webview's
    script (#638). Imports nothing.
*/
export type CockpitButtonKind = 'primary' | 'secondary' | 'icon' | 'check' | 'link' | 'card';
export const COCKPIT_BUTTON_KINDS: readonly CockpitButtonKind[] = Object.freeze(['primary', 'secondary', 'icon', 'check', 'link', 'card'] as CockpitButtonKind[]);
