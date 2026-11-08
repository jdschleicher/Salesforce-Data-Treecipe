import { OrgAuthorization } from '@salesforce/core';
import { SalesforceCli } from '../SalesforceCli';

import * as matchers from 'jest-extended';
expect.extend(matchers);

function buildOrgAuthorization(overrides: Partial<OrgAuthorization>): OrgAuthorization {
    return {
        orgId: '00D000000000000EAA',
        username: 'dev@example.com',
        oauthMethod: 'web',
        aliases: [],
        configs: [],
        isExpired: false,
        ...overrides
    } as OrgAuthorization;
}

describe('shouldBuildAuthenticatedOrgQuickPickDetails', () => {

    it('shouldPreferAliasOverUsernameAsTargetOrgIdentifier', () => {

        const orgDetails = SalesforceCli.buildAuthenticatedOrgDetails([
            buildOrgAuthorization({ username: 'dev@example.com', aliases: ['devHub'] })
        ]);

        expect(orgDetails).toHaveLength(1);
        expect(orgDetails[0].targetOrgIdentifier).toBe('devHub');

    });

    it('shouldFallBackToUsernameWhenNoAliasIsSet', () => {

        const orgDetails = SalesforceCli.buildAuthenticatedOrgDetails([
            buildOrgAuthorization({ username: 'scratch@example.com', aliases: [] })
        ]);

        expect(orgDetails[0].targetOrgIdentifier).toBe('scratch@example.com');
        expect(orgDetails[0].alias).toBeUndefined();

    });

    it('shouldSkipAuthorizationsWithoutAUsername', () => {

        const orgDetails = SalesforceCli.buildAuthenticatedOrgDetails([
            buildOrgAuthorization({ username: undefined as unknown as string, aliases: ['brokenEntry'] }),
            buildOrgAuthorization({ username: 'valid@example.com', aliases: [] })
        ]);

        expect(orgDetails).toHaveLength(1);
        expect(orgDetails[0].username).toBe('valid@example.com');

    });

    it('shouldDropAnOrgWhoseIdentifierCouldNotSafelyReachTheCli', () => {

        const orgDetails = SalesforceCli.buildAuthenticatedOrgDetails([
            buildOrgAuthorization({ username: 'ok@example.com', aliases: ['--json'] }),
            buildOrgAuthorization({ username: 'valid@example.com', aliases: [] })
        ]);

        expect(orgDetails).toHaveLength(1);
        expect(orgDetails[0].username).toBe('valid@example.com');

    });

    it('shouldLabelByTheAuthorizationsOwnAliasElseLeaveTheAliasUnset', () => {

        const orgDetails = SalesforceCli.buildAuthenticatedOrgDetails([
            buildOrgAuthorization({ username: 'qa@example.com', aliases: [] }),
            buildOrgAuthorization({ username: 'uat@example.com', aliases: ['uat'] })
        ]);

        expect(orgDetails).toEqual([
            { targetOrgIdentifier: 'qa@example.com', username: 'qa@example.com', alias: undefined },
            { targetOrgIdentifier: 'uat', username: 'uat@example.com', alias: 'uat' }
        ]);

    });

    it('shouldSkipAnAuthorizationAliasThatIsNotANonEmptyString', () => {

        const orgDetails = SalesforceCli.buildAuthenticatedOrgDetails([
            buildOrgAuthorization({ username: 'qa@example.com', aliases: [42, '', 'qa'] as unknown as string[] }),
            buildOrgAuthorization({ username: 'uat@example.com', aliases: 'uat' as unknown as string[] })
        ]);

        expect(orgDetails).toEqual([
            { targetOrgIdentifier: 'qa', username: 'qa@example.com', alias: 'qa' },
            { targetOrgIdentifier: 'uat@example.com', username: 'uat@example.com', alias: undefined }
        ]);

    });

    it('shouldReturnEmptyListWhenNoOrgsAreAuthenticated', () => {
        expect(SalesforceCli.buildAuthenticatedOrgDetails([])).toBeEmpty();
        expect(SalesforceCli.buildAuthenticatedOrgDetails(undefined as unknown as OrgAuthorization[])).toBeEmpty();
    });

});

describe('shouldHandleTheWindowsCliShim', () => {

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('shouldUseAShellOnWindowsBecauseSpawningACmdShimWithoutOneFailsWithEinval', () => {

        jest.spyOn(SalesforceCli, 'isWindowsPlatform').mockReturnValue(true);

        const invocation = SalesforceCli.buildSalesforceCliInvocation(['apex', 'run', 'test']);

        expect(invocation.command).toBe('sf.cmd');
        expect(invocation.useShell).toBeTrue();
        // EVERY ARGUMENT IS QUOTED ONCE THE SHELL IS IN PLAY
        expect(invocation.args).toSatisfyAll((argumentValue: string) => argumentValue.startsWith('"') && argumentValue.endsWith('"'));

    });

    it('shouldKeepTheArgvFormOnNonWindowsPlatforms', () => {

        jest.spyOn(SalesforceCli, 'isWindowsPlatform').mockReturnValue(false);

        const invocation = SalesforceCli.buildSalesforceCliInvocation(['apex', 'run', 'test']);

        expect(invocation.command).toBe('sf');
        expect(invocation.useShell).toBeFalse();
        expect(invocation.args).toEqual(['apex', 'run', 'test']);

    });

    it('shouldRejectAnArgumentContainingADoubleQuoteRatherThanEscapingIt', () => {

        jest.spyOn(SalesforceCli, 'isWindowsPlatform').mockReturnValue(true);

        expect(() => SalesforceCli.buildSalesforceCliInvocation(['--target-org', 'dev"org']))
            .toThrow('contains a double quote');

    });

});
