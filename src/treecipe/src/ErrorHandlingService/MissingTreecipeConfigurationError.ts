/*
    Keeps the message prefix ErrorHandlingService keys the missing-config flow on, and carries the
    stale setting separately so the dialog can name where the extension looked.
*/
export class MissingTreecipeConfigurationError extends Error {

    constructor(message: string, readonly staleSettingNotice?: string) {
        super(message);
        this.name = 'MissingTreecipeConfigurationError';
    }

}
