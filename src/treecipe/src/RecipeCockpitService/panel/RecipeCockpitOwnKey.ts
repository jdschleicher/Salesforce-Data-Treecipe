// EVERY PANEL MAP IS KEYED BY NAMES FROM FILES OR THE ORG, SO A KEY COUNTS ONLY AS THE RECORD'S OWN, NEVER AN INHERITED __proto__ OR constructor
export function hasOwnKey(record: object | null | undefined, key: unknown): boolean {
    return !!record && Object.prototype.hasOwnProperty.call(record, key as PropertyKey);
}
