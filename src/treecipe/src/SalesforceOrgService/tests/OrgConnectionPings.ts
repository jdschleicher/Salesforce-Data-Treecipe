import * as fs from 'fs';
import * as path from 'path';

/*
    The in-process connection check (#502) pings each authorization with Org.create(...).refreshAuth().
    A suite that mocks @salesforce/core answers those pings from here: an org in connectedUsernames
    answers, every other one fails with the error orgConnectionPings.json records for it.
*/
const ORG_CONNECTION_PINGS = JSON.parse(fs.readFileSync(path.join(__dirname, 'mocks', 'orgConnectionPings.json'), 'utf-8'));

export const CONNECTED_ORG_USERNAMES: readonly string[] = ORG_CONNECTION_PINGS.connectedUsernames;

export const FAILED_PING_MESSAGES_BY_USERNAME: Readonly<Record<string, string>> = ORG_CONNECTION_PINGS.failedPings;

export function answerOrgConnectionPings(orgCreate: jest.Mock,
                                            isConnected: (username: string) => boolean = username => CONNECTED_ORG_USERNAMES.includes(username)): jest.Mock {

    const refreshAuth = jest.fn();

    orgCreate.mockImplementation(async ({ aliasOrUsername }: { aliasOrUsername: string }) => ({
        getUsername: () => aliasOrUsername,
        refreshAuth: () => {
            refreshAuth(aliasOrUsername);
            return isConnected(aliasOrUsername)
                ? Promise.resolve()
                : Promise.reject(new Error(FAILED_PING_MESSAGES_BY_USERNAME[aliasOrUsername] ?? 'expired access/refresh token'));
        }
    }));

    return refreshAuth;

}
