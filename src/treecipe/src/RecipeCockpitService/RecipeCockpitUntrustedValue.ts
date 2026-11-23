/*
    The two checks every cockpit host file makes on a value it did not write: a stored workspaceState
    entry, a posted panel message, a parsed file, or what a try block caught. Imports nothing, so a
    host-free file can load it too (#671).
*/
export class RecipeCockpitUntrustedValue {

    static isPlainRecord(candidate: unknown): candidate is Record<string, unknown> {

        return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate);

    }

    static describeThrown(thrownValue: unknown): string {

        return String(( thrownValue as Error | undefined )?.message ?? thrownValue);

    }

}
