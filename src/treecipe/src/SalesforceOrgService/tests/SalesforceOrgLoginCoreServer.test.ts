import { WebOAuthServer } from '@salesforce/core';

/*
    SalesforceOrgLogin closes core's local login server through a member core keeps private, and
    every other suite fakes that server. This one asks the real class, without listening on any
    port, so a core release that renames the member fails here rather than leaving a cancelled
    login holding the port.
*/
describe('@salesforce/core WebOAuthServer, as SalesforceOrgLogin reaches into it (#630)', () => {

    it('still holds its local server as webServer, with a close()', async () => {

        const oauthServer = await WebOAuthServer.create({ oauthConfig: { loginUrl: 'https://test.salesforce.com' } });
        const webServer = ( oauthServer as unknown as { webServer?: { close?: unknown } } ).webServer;

        expect(typeof webServer?.close).toBe('function');
        expect(oauthServer.getAuthorizationUrl()).toMatch(/^https:\/\/test\.salesforce\.com\/services\/oauth2\/authorize\?/);

    });

});
