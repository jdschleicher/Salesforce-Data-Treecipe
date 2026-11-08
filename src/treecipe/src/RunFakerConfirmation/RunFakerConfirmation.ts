import * as crypto from 'crypto';

/*
    The Recipe Cockpit's tree insert (#255) asks its own host modal before it runs Run Faker by Recipe,
    so the command's "Generate Data" question is not asked twice. The command is callable by id, so a
    flag in its arguments would let any caller skip that consent: instead the cockpit is issued a
    one-time random token here, in the extension host's own memory, and the command skips its modal
    only for a token this class issued and has not yet spent. Imports only crypto, so both sides can
    hold it without importing each other.
*/
export class RunFakerConfirmation {

    private static readonly issuedTokens = new Set<string>();

    static issue(): string {

        const confirmationToken = crypto.randomBytes(32).toString('hex');
        this.issuedTokens.add(confirmationToken);
        return confirmationToken;

    }

    // TRUE ONCE PER ISSUED TOKEN: SPENT ON THE FIRST CHECK, WHATEVER THE RUN DOES NEXT
    static spend(candidateToken: unknown): boolean {

        return typeof candidateToken === 'string' && this.issuedTokens.delete(candidateToken);

    }

    // A TOKEN ISSUED FOR A RUN THAT NEVER CHECKED IT IS NOT LEFT LYING AROUND
    static revoke(confirmationToken: string): void {

        this.issuedTokens.delete(confirmationToken);

    }

}
