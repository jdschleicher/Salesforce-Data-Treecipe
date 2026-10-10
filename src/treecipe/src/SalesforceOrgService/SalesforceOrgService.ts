import { AuthInfo, Connection, Org, OrgAuthorization } from '@salesforce/core';
import { IAuthenticatedOrgDetail, ISalesforceCliInvocationResult, PicklistDependencyCheckService } from '../PicklistDependencyCheckService/PicklistDependencyCheckService';
import { IAuthenticatedOrgListingForPicker, VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';
import { RecipeYamlScalar } from '../RecipeFakerService.ts/RecipeYamlScalar/RecipeYamlScalar';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const NO_AUTHORIZED_ORGS_MESSAGE = 'No authorized Salesforce orgs were found. Authorize one with "sf org login web" and try again.';

export const ORG_DESCRIBE_CANCELLED_MESSAGE = 'cancelled before it was described';

export const ORG_DESCRIBE_UNUSABLE_NAME_MESSAGE = 'not a Salesforce object api name, so it was not sent to the org';

/*
    What an sObject api name can be: a letter, then letters, digits and underscores -- which covers
    a namespace prefix and every suffix (__c, __mdt, __e, __x). The name comes from files in the
    workspace, and jsforce joins it into the describe URL's PATH unencoded, so a name like
    "x/../../query" would otherwise send an authenticated request to an endpoint of the file's
    choosing in the org the reader picked.
*/
const OBJECT_API_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

/*
    How many describe calls are in flight at once. One at a time makes a 100-object recipe a
    100-round-trip wait; all at once lets a large recipe burst past the org's concurrent request
    limit. Five keeps a recipe of that size to a few seconds without being the caller that trips it.
*/
export const ORG_DESCRIBE_CONCURRENCY = 5;

export interface INormalizedOrgPicklistValue {
    value: string;
    label: string;
    isActive: boolean;
    isDefault: boolean;
}

/*
    One field as the ORG describes it, reduced to what can be compared with a recipe field.

    Every value is present rather than optional -- a string is '' and a number 0 where the describe
    has none -- so a comparison never has to tell "absent" from "empty". precision and scale are the
    describe's own, which for a number or currency field are the same total-digits and decimal-places
    the metadata's <precision> and <scale> carry; length is the text length.
*/
export interface INormalizedOrgField {
    fieldApiName: string;
    fieldLabel: string;
    fieldType: string;
    length: number;
    precision: number;
    scale: number;
    picklistValues: INormalizedOrgPicklistValue[];
    controllingField: string;
    referenceTo: string[];
    isNillable: boolean;
    isCreateable: boolean;
    isCalculated: boolean;
    isDefaultedOnCreate: boolean;
}

// isCreateable IS THE OBJECT'S OWN "createable" -- WHETHER THE USER CAN INSERT RECORDS OF IT AT ALL
export interface INormalizedOrgObjectDescribe {
    objectApiName: string;
    objectLabel: string;
    isCreateable: boolean;
    fields: INormalizedOrgField[];
}

/*
    One requested object's answer. Exactly one of describe or failureMessage is set: an object the
    org does not have is an ordinary answer for a recipe generated from local metadata, not an
    exception, so it is reported per object rather than failing the objects that did describe.
*/
export interface IOrgObjectDescribeOutcome {
    objectApiName: string;
    describe?: INormalizedOrgObjectDescribe;
    failureMessage?: string;
    wasCached: boolean;
}

export interface IOrgDescribeRequestResult {
    outcomes: IOrgObjectDescribeOutcome[];
    wasCancelled: boolean;
}

// THE ONE METHOD OF A CONNECTION THIS SERVICE CALLS, SO A TEST CAN HAND IN ANYTHING THAT ANSWERS IT
export interface IOrgDescribeSource {
    describe(objectApiName: string): Promise<unknown>;
}

export interface IOrgDescribeRequestOptions {
    onObjectDescribed?: (completedCount: number, requestedCount: number) => void;
    isCancellationRequested?: () => boolean;
}

// THE ONE METHOD OF A CONNECTION THE ORGANIZATION AND PARENT ID QUERIES CALL
export interface IOrgQuerySource {
    query(soql: string): Promise<unknown>;
}

/*
    The org's Organization row, as far as the cockpit reads it. A query that failed, or an answer
    that does not carry both values typed as expected, is undefined -- never "not a sandbox" or
    "a sandbox" by default, so whatever needs to know fails closed.
*/
export interface IOrgTypeDetail {
    isSandbox: boolean;
    organizationType: string;
}

export const ORG_TYPE_UNKNOWN_LABEL = 'type unknown';

/*
    The slice of a CLI authorization Data-by-Org judges an org by, before it ever connects. Every
    flag is optional because older authorizations carry none of them.
*/
export interface INonProductionAuthorizationFields {
    isSandbox?: boolean;
    isScratchOrg?: boolean;
    instanceUrl?: string;
}

/*
    Why the Salesforce CLI's answer leaves an authorized org out of every picker. "notConnected"
    covers everything that is not a clear yes: an auth error code, "Unknown", a missing or mistyped
    field, and an org the answer does not mention at all.
*/
export type OrgConnectionUnusableReason = 'expired' | 'deleted' | 'notConnected';

export type OrgConnectionState = 'connected' | OrgConnectionUnusableReason;

// WHY DATA-BY-ORG LEFT AN AUTHORIZED ORG OUT: THE CONNECTION REASONS, AND PRODUCTION
export type HiddenOrgReason = 'production' | OrgConnectionUnusableReason;

export interface IHiddenOrgReasonCounts {
    production: number;
    expired: number;
    deleted: number;
    notConnected: number;
}

export interface IHiddenAuthorizedOrg {
    username: string;
    label: string;
    reason: HiddenOrgReason;
}

/*
    What one "sf org list" answered, by username, and which authorizations existed when it was asked.
    An authorization added since -- "sf org login web" in a terminal, or a scratch org created --
    is one the answer cannot speak for, so it is asked again rather than reported not connected.
*/
export interface IConnectedOrgStatusListing {
    connectionStatesByUsername: Map<string, OrgConnectionState>;
    checkedAuthorizationUsernames?: Set<string>;
}

/*
    The authorized orgs a picker offers, the ones it left out, and why. Data-by-Org also leaves out
    every org not known to be non-production; the quick-pick commands leave out only unusable ones.
*/
export interface IConnectedOrgListing {
    orgDetails: IAuthenticatedOrgDetail[];
    hiddenOrgs: IHiddenAuthorizedOrg[];
    hiddenOrgReasonCounts: IHiddenOrgReasonCounts;
}

export interface IDataOrgListing extends IConnectedOrgListing {
    hiddenOrgCount: number;
}

// THE CLI COULD NOT SAY WHICH ORGS ARE CONNECTED, SO NO ORG IS LISTED -- NEVER AN UNCHECKED FALLBACK
export class OrgConnectionStatusUnavailableError extends Error {

    constructor(reason: string) {
        super(`The Salesforce CLI could not report which authorized orgs are connected, so no org is listed. ${reason}`);
        this.name = 'OrgConnectionStatusUnavailableError';
    }

}

/*
    "--verbose" for the scratch orgs' status from their Dev Hub, and never "--skip-connection-status",
    which is the whole answer this asks for. Without "--all" the CLI already leaves out a scratch org
    that is not Active; such an org is then simply not in the answer, and is left out here too.
*/
export const SALESFORCE_CLI_ORG_LIST_ARGUMENTS: readonly string[] = ['org', 'list', '--json', '--verbose'];

// THE CLI PINGS EVERY AUTHORIZED ORG'S TOKEN, SO THE CHECK IS GIVEN TIME -- BUT NOT FOREVER
export const SALESFORCE_CLI_ORG_LIST_TIMEOUT_MILLISECONDS = 60000;

const SALESFORCE_CLI_ORG_LIST_GROUPS = ['nonScratchOrgs', 'other', 'sandboxes', 'devHubs', 'scratchOrgs'];

export const REAUTHORIZE_ORG_INSTRUCTION = 'Re-authorize one with "sf org login web" and try again.';

/*
    A sandbox's instance url: "<domain>--<sandbox>.sandbox.my.salesforce.com" with enhanced domains,
    and "<domain>--<sandbox>.my.salesforce.com" before them. "--" separates the sandbox name and
    cannot appear in a production My Domain name.
*/
const SANDBOX_INSTANCE_HOST_PATTERN = /(?:\.sandbox\.my\.salesforce\.com|--[a-z0-9-]+\.my\.salesforce\.com)$/i;

export const ORG_PARENT_RECORD_ID_LIMIT = 2000;

const SALESFORCE_RECORD_ID_PATTERN = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;

export const ORG_ORGANIZATION_QUERY = 'SELECT IsSandbox, OrganizationType FROM Organization';

// THE CLI CONFIG KEY, ITS ENVIRONMENT VARIABLE, AND WHAT A READER WITH NONE SET IS TOLD TO RUN
export const TARGET_DEV_HUB_CONFIG_KEY = 'target-dev-hub';

export const TARGET_DEV_HUB_ENVIRONMENT_VARIABLE = 'SF_TARGET_DEV_HUB';

// THE sfdx-ERA NAMES THE CLI STILL HONOURS, EACH READ AFTER ITS sf COUNTERPART
export const LEGACY_TARGET_DEV_HUB_ENVIRONMENT_VARIABLE = 'SFDX_DEFAULTDEVHUBUSERNAME';

export const LEGACY_TARGET_DEV_HUB_CONFIG_KEY = 'defaultdevhubusername';

export const NO_DEFAULT_DEV_HUB_MESSAGE = 'No default Dev Hub is set for the Salesforce CLI, so no scratch org was created. Set one with "sf config set target-dev-hub=<alias>" (add --global to use it in every project) and try again.';

// THE DEFAULT DEV HUB AS THE CLI WOULD RESOLVE IT, AND THE AUTHORIZATION IT NAMES
export interface IDefaultDevHubDetail extends IAuthenticatedOrgDetail {
    // WHERE THE SETTING WAS READ: THE ENVIRONMENT, THE PROJECT'S .sf/config.json, OR THE GLOBAL ONE
    configSource: 'environment' | 'project' | 'global';
}

export class SalesforceOrgService {

    /*
        Every successful describe this session, keyed by org USERNAME and object.

        By username rather than alias: an alias is a local nickname that can be re-pointed at another
        org between two requests, and the cache must never answer for an org it did not describe. A
        failure is never cached -- the usual causes (an expired session, an object not deployed yet)
        are ones the reader fixes and then asks again.
    */
    private static describeCache = new Map<string, INormalizedOrgObjectDescribe>();

    static clearDescribeCache() {

        this.describeCache.clear();

    }

    /*
        Up to 2000 Ids of one object -- the parents a Create picks from at random. The name is held
        to the api-name rule before it is put in the SOQL, and every Id is type-checked: the answer
        came over the network, and what is kept is written into a record's lookup field.
    */
    static async queryRecordIds(querySource: IOrgQuerySource, objectApiName: string): Promise<string[]> {

        if ( !this.isUsableObjectApiName(objectApiName) ) {
            throw new Error(`"${objectApiName}" is ${ORG_DESCRIBE_UNUSABLE_NAME_MESSAGE}.`);
        }

        const queryRecords = this.asRecord(await querySource.query(`SELECT Id FROM ${objectApiName} LIMIT ${ORG_PARENT_RECORD_ID_LIMIT}`))?.records;

        return Array.isArray(queryRecords)
            ? queryRecords
                .map(queryRecord => this.asRecord(queryRecord)?.Id)
                .filter((recordId): recordId is string => typeof recordId === 'string' && SALESFORCE_RECORD_ID_PATTERN.test(recordId))
            : [];

    }

    /*
        The org's IsSandbox and OrganizationType, or undefined when the query failed or answered
        with anything else. Never throws: an org whose type cannot be read is labelled "type unknown"
        by the caller, which treats it as not a sandbox.
    */
    static async queryOrganizationType(querySource: IOrgQuerySource): Promise<IOrgTypeDetail | undefined> {

        try {
            return this.normalizeOrganizationResult(await querySource.query(ORG_ORGANIZATION_QUERY));
        } catch {
            return undefined;
        }

    }

    static normalizeOrganizationResult(queryResult: unknown): IOrgTypeDetail | undefined {

        const queryRecords = this.asRecord(queryResult)?.records;
        const organizationRecord = Array.isArray(queryRecords) && queryRecords.length === 1 ? this.asRecord(queryRecords[0]) : undefined;

        if ( typeof organizationRecord?.IsSandbox !== 'boolean' || typeof organizationRecord.OrganizationType !== 'string' ) {
            return undefined;
        }

        return { isSandbox: organizationRecord.IsSandbox, organizationType: organizationRecord.OrganizationType };

    }

    static buildOrgTypeLabel(orgTypeDetail: IOrgTypeDetail | undefined): string {

        if ( !orgTypeDetail ) {
            return ORG_TYPE_UNKNOWN_LABEL;
        }

        return orgTypeDetail.isSandbox ? 'Sandbox' : `Production · ${orgTypeDetail.organizationType || 'type unknown'}`;

    }

    /*
        The one place a Treecipe command turns an alias or username into a connection. The insert
        path (CollectionsApiService) and the cockpit's describe path both come through here, so how
        an org is resolved cannot differ between the two.
    */
    static async getConnection(aliasOrUsername: string): Promise<Connection> {

        const authorizedOrg = await Org.create({ aliasOrUsername: aliasOrUsername });

        return authorizedOrg.getConnection();

    }

    // A jsforce Query IS A THENABLE RATHER THAN A Promise, SO IT IS SETTLED INTO ONE HERE
    static toQuerySource(connection: Pick<Connection, 'query'>): IOrgQuerySource {

        return { query: async (soql: string) => await connection.query(soql) };

    }

    /*
        Whether the CLI's own record of an org says it is NOT production: a scratch org, an org the
        CLI recorded as a sandbox, or one whose instance url is a sandbox's. Anything else -- a
        production org, a Developer Edition, or an authorization that says nothing -- is false, so
        Data-by-Org never even offers to connect to it. The CLI records isSandbox only when the
        sandbox's production org is authorized too, which is why the url is read as well.
    */
    static isKnownNonProductionAuthorization(authorization: INonProductionAuthorizationFields | null | undefined): boolean {

        if ( authorization?.isScratchOrg === true || authorization?.isSandbox === true ) {
            return true;
        }

        if ( typeof authorization?.instanceUrl !== 'string' ) {
            return false;
        }

        try {
            return SANDBOX_INSTANCE_HOST_PATTERN.test(new URL(authorization.instanceUrl).hostname);
        } catch {
            return false;
        }

    }

    /*
        The session cache of the CLI's answer, and the one check in flight. Two pickers opened during
        a check share its process. A failure is never cached, so the next picker asks again; a
        generation bump on clear means a check started before the clear cannot write an answer the
        reader has asked to replace.
    */
    private static connectedOrgStatusCache: IConnectedOrgStatusListing | undefined;

    private static connectedOrgStatusRequest: Promise<IConnectedOrgStatusListing> | undefined;

    private static connectedOrgStatusGeneration = 0;

    static clearConnectedOrgStatusCache() {

        this.connectedOrgStatusCache = undefined;
        this.connectedOrgStatusRequest = undefined;
        this.connectedOrgStatusGeneration++;

    }

    static isConnectedOrgStatusCached(): boolean {

        return this.connectedOrgStatusCache !== undefined;

    }

    /*
        Which authorized orgs the Salesforce CLI reports as connected, asked once per session --
        "sf org list" pings every authorized org's token, which is slow. Nothing here connects to an
        org itself, and nothing logs out of, deletes or changes one.
    */
    static async listConnectedOrgAuthorizations(): Promise<IConnectedOrgStatusListing> {

        if ( this.connectedOrgStatusCache ) {
            return this.connectedOrgStatusCache;
        }

        if ( !this.connectedOrgStatusRequest ) {

            const requestGeneration = this.connectedOrgStatusGeneration;
            const isRequestCurrent = () => requestGeneration === this.connectedOrgStatusGeneration;

            this.connectedOrgStatusRequest = this.runOrgListCommand().then(
                connectedOrgStatusListing => {
                    if ( isRequestCurrent() ) {
                        this.connectedOrgStatusCache = connectedOrgStatusListing;
                        this.connectedOrgStatusRequest = undefined;
                    }
                    return connectedOrgStatusListing;
                },
                (listError: unknown) => {
                    if ( isRequestCurrent() ) {
                        this.connectedOrgStatusRequest = undefined;
                    }
                    throw listError;
                }
            );

        }

        return await this.connectedOrgStatusRequest;

    }

    /*
        Data-by-Org's ⟳, and an org the extension just created: ask the CLI again and replace the
        cached answer. A check already in flight IS a fresh answer, so it is shared rather than
        joined by a second process -- repeated clicks would otherwise each start an "sf org list"
        that pings every authorized org, none of them killed.
    */
    static async refreshConnectedOrgAuthorizations(): Promise<IConnectedOrgStatusListing> {

        if ( !this.connectedOrgStatusRequest ) {
            this.clearConnectedOrgStatusCache();
        }

        return await this.listConnectedOrgAuthorizations();

    }

    /*
        The cached answer, unless it cannot speak for the authorizations in hand: one added after
        it was asked is checked rather than reported "not connected", which would leave a reader
        who followed "re-authorize one with sf org login web" looking at the same refusal.
    */
    private static async listConnectedOrgStatusForAuthorizations(authorizations: OrgAuthorization[]): Promise<IConnectedOrgStatusListing> {

        const connectedOrgStatusListing = await this.listConnectedOrgAuthorizations();
        const checkedAuthorizationUsernames = connectedOrgStatusListing.checkedAuthorizationUsernames;

        const hasUncheckedAuthorization = !!checkedAuthorizationUsernames && authorizations.some(authorization => (
            typeof authorization?.username === 'string'
            && !!authorization.username
            && !checkedAuthorizationUsernames.has(authorization.username)
        ));

        return hasUncheckedAuthorization ? await this.refreshConnectedOrgAuthorizations() : connectedOrgStatusListing;

    }

    // THE AUTHORIZATIONS ARE READ BEFORE THE CLI RUNS, SO ONE ADDED DURING THE CHECK IS NEVER COUNTED AS CHECKED
    private static async runOrgListCommand(): Promise<IConnectedOrgStatusListing> {

        const checkedAuthorizationUsernames = new Set(this.readAuthorizations(await AuthInfo.listAllAuthorizations())
            .map(authorization => authorization?.username)
            .filter((username): username is string => typeof username === 'string' && !!username));

        const invocationResult = await PicklistDependencyCheckService.runSalesforceCli(
            [...SALESFORCE_CLI_ORG_LIST_ARGUMENTS],
            undefined,
            SALESFORCE_CLI_ORG_LIST_TIMEOUT_MILLISECONDS
        );

        return { ...this.parseOrgListInvocation(invocationResult), checkedAuthorizationUsernames: checkedAuthorizationUsernames };

    }

    private static readAuthorizations(authorizations: unknown): OrgAuthorization[] {

        return Array.isArray(authorizations) ? authorizations : [];

    }

    /*
        The CLI's answer, read as untrusted: a spawn failure, a timeout, a non-zero exit or output
        that is not an org list throws, so nothing is listed and nothing is cached.
    */
    static parseOrgListInvocation(invocationResult: ISalesforceCliInvocationResult): IConnectedOrgStatusListing {

        if ( invocationResult.spawnError ) {
            try {
                PicklistDependencyCheckService.parseSalesforceCliJsonOutput(invocationResult);
            } catch (spawnFailure) {
                throw new OrgConnectionStatusUnavailableError((spawnFailure as Error).message);
            }
        }

        if ( invocationResult.timedOut || invocationResult.exitCode === null ) {
            throw new OrgConnectionStatusUnavailableError(`"sf org list" did not answer within ${SALESFORCE_CLI_ORG_LIST_TIMEOUT_MILLISECONDS / 1000} seconds.`);
        }

        let orgListPayload: unknown;

        try {
            orgListPayload = JSON.parse(invocationResult.stdout);
        } catch {
            throw new OrgConnectionStatusUnavailableError(`"sf org list" did not return usable JSON (exit code ${invocationResult.exitCode}).`);
        }

        if ( invocationResult.exitCode !== 0 ) {
            const failureMessage = this.asString(this.asRecord(orgListPayload)?.message) || invocationResult.stderr.trim();
            throw new OrgConnectionStatusUnavailableError(`"sf org list" failed (exit code ${invocationResult.exitCode})${failureMessage ? `: ${failureMessage}` : '.'}`);
        }

        return this.normalizeOrgListResult(this.asRecord(orgListPayload)?.result);

    }

    /*
        Every org the answer names, by username. An org named more than once (the CLI repeats a
        non-scratch org under its group) keeps the first reason it is NOT usable, so one entry that
        says Connected can never outvote one that says otherwise.
    */
    static normalizeOrgListResult(orgListResult: unknown): IConnectedOrgStatusListing {

        const orgListRecord = this.asRecord(orgListResult);

        if ( !orgListRecord ) {
            throw new OrgConnectionStatusUnavailableError('"sf org list" returned no org list.');
        }

        const connectionStatesByUsername = new Map<string, OrgConnectionState>();

        SALESFORCE_CLI_ORG_LIST_GROUPS.forEach(orgListGroup => {

            const orgListEntries = orgListRecord[orgListGroup];

            if ( !Array.isArray(orgListEntries) ) {
                return;
            }

            orgListEntries.forEach(orgListEntry => {

                const orgListEntryRecord = this.asRecord(orgListEntry);
                const username = orgListEntryRecord?.username;

                if ( typeof username !== 'string' || !username ) {
                    return;
                }

                const connectionState = this.classifyOrgListEntry(orgListEntryRecord, orgListGroup === 'scratchOrgs');
                const knownConnectionState = connectionStatesByUsername.get(username);

                if ( knownConnectionState === undefined || knownConnectionState === 'connected' ) {
                    connectionStatesByUsername.set(username, connectionState);
                }

            });

        });

        return { connectionStatesByUsername: connectionStatesByUsername };

    }

    /*
        Usable only on a clear yes. A non-scratch org must say connectedStatus "Connected" exactly.
        The CLI never pings a scratch org -- it asks the Dev Hub instead -- so a scratch org must say
        status "Active", and isExpired must not be true; were it ever to carry a connectedStatus,
        that must be "Connected" too. Every other value, a missing one and a mistyped one included,
        is not usable.
    */
    static classifyOrgListEntry(orgListEntry: Record<string, unknown>, isScratchOrg: boolean): OrgConnectionState {

        const { connectedStatus, isExpired, status } = orgListEntry;

        if ( ( connectedStatus !== undefined && typeof connectedStatus !== 'string' )
                || ( isExpired !== undefined && typeof isExpired !== 'boolean' )
                || ( status !== undefined && typeof status !== 'string' ) ) {
            return 'notConnected';
        }

        if ( status === 'Deleted' ) {
            return 'deleted';
        }

        if ( isExpired === true || status === 'Expired' ) {
            return 'expired';
        }

        if ( isScratchOrg ) {
            return status === 'Active' && ( connectedStatus === undefined || connectedStatus === 'Connected' ) ? 'connected' : 'notConnected';
        }

        return connectedStatus === 'Connected' && ( status === undefined || status === 'Active' ) ? 'connected' : 'notConnected';

    }

    /*
        The CLI's answer matched against the authorization files: an org the answer does not name
        is not listed, and neither is a username the answer names with no authorization file. An
        unusable alias or username is dropped by buildAuthenticatedOrgDetails, as it always was.
    */
    static buildConnectedOrgListing(authorizations: OrgAuthorization[],
                                    connectedOrgStatusListing: IConnectedOrgStatusListing,
                                    isProductionExcluded: boolean): IConnectedOrgListing {

        const hiddenOrgs: IHiddenAuthorizedOrg[] = [];
        const usableAuthorizations: OrgAuthorization[] = [];

        this.readAuthorizations(authorizations).forEach(authorization => {

            const username = authorization?.username;

            if ( typeof username !== 'string' || !username ) {
                return;
            }

            const hiddenReason = this.findHiddenOrgReason(authorization, connectedOrgStatusListing, isProductionExcluded);

            if ( hiddenReason ) {
                hiddenOrgs.push({ username: username, label: authorization.aliases?.[0] || username, reason: hiddenReason });
                return;
            }

            usableAuthorizations.push(authorization);

        });

        return {
            orgDetails: PicklistDependencyCheckService.buildAuthenticatedOrgDetails(usableAuthorizations),
            hiddenOrgs: hiddenOrgs,
            hiddenOrgReasonCounts: this.countHiddenOrgReasons(hiddenOrgs)
        };

    }

    private static findHiddenOrgReason(authorization: OrgAuthorization,
                                        connectedOrgStatusListing: IConnectedOrgStatusListing,
                                        isProductionExcluded: boolean): HiddenOrgReason | undefined {

        if ( isProductionExcluded && !this.isKnownNonProductionAuthorization(authorization) ) {
            return 'production';
        }

        const connectionState = connectedOrgStatusListing.connectionStatesByUsername.get(authorization.username);

        if ( connectionState === undefined ) {
            return authorization.isExpired === true ? 'expired' : 'notConnected';
        }

        return connectionState === 'connected' ? undefined : connectionState;

    }

    static countHiddenOrgReasons(hiddenOrgs: IHiddenAuthorizedOrg[]): IHiddenOrgReasonCounts {

        const hiddenOrgReasonCounts: IHiddenOrgReasonCounts = { production: 0, expired: 0, deleted: 0, notConnected: 0 };
        hiddenOrgs.forEach(hiddenOrg => hiddenOrgReasonCounts[hiddenOrg.reason]++);

        return hiddenOrgReasonCounts;

    }

    // "1 production, 1 expired, 1 not connected" -- EACH REASON THAT LEFT AN ORG OUT, IN A FIXED ORDER
    static formatHiddenOrgReasons(hiddenOrgReasonCounts: IHiddenOrgReasonCounts): string {

        return ([
            [hiddenOrgReasonCounts.production, 'production'],
            [hiddenOrgReasonCounts.expired, 'expired'],
            [hiddenOrgReasonCounts.deleted, 'deleted'],
            [hiddenOrgReasonCounts.notConnected, 'not connected']
        ] as [number, string][])
            .filter(([reasonCount]) => reasonCount > 0)
            .map(([reasonCount, reasonLabel]) => `${reasonCount} ${reasonLabel}`)
            .join(', ');

    }

    static countHiddenOrgs(hiddenOrgReasonCounts: IHiddenOrgReasonCounts): number {

        return hiddenOrgReasonCounts.production + hiddenOrgReasonCounts.expired + hiddenOrgReasonCounts.deleted + hiddenOrgReasonCounts.notConnected;

    }

    // THE ORGS DATA-BY-ORG LISTS: ONLY THOSE KNOWN NOT TO BE PRODUCTION AND REPORTED CONNECTED, WITH WHY THE REST ARE NOT
    static async listDataOrgDetails(): Promise<IDataOrgListing> {

        const authorizations = this.readAuthorizations(await AuthInfo.listAllAuthorizations());
        const connectedOrgStatusListing = await this.listConnectedOrgStatusForAuthorizations(authorizations);
        const connectedOrgListing = this.buildConnectedOrgListing(authorizations, connectedOrgStatusListing, true);

        return { ...connectedOrgListing, hiddenOrgCount: this.countHiddenOrgs(connectedOrgListing.hiddenOrgReasonCounts) };

    }

    /*
        The quick-pick commands have no ⟳, so an answer from the cache that leaves them nothing to
        offer is asked again once: the reader may have re-authorized an org since, which is exactly
        what the empty-list warning tells them to do.
    */
    static async listAuthorizedOrgDetails(): Promise<IConnectedOrgListing> {

        const authorizations = this.readAuthorizations(await AuthInfo.listAllAuthorizations());
        const cachedOrgStatusListing = this.connectedOrgStatusCache;
        const connectedOrgStatusListing = await this.listConnectedOrgStatusForAuthorizations(authorizations);
        const connectedOrgListing = this.buildConnectedOrgListing(authorizations, connectedOrgStatusListing, false);
        const wasAnsweredFromCache = cachedOrgStatusListing !== undefined && connectedOrgStatusListing === cachedOrgStatusListing;

        if ( wasAnsweredFromCache && connectedOrgListing.orgDetails.length === 0 && connectedOrgListing.hiddenOrgs.length > 0 ) {
            return this.buildConnectedOrgListing(authorizations, await this.refreshConnectedOrgAuthorizations(), false);
        }

        return connectedOrgListing;

    }

    /*
        What a quick pick says when it has nothing to offer: that no org is authorized, or how many
        were left out and why, or why the CLI could not be asked at all. It never throws -- the
        picker shows the message instead of an empty list.
    */
    static async listAuthorizedOrgDetailsForPicker(): Promise<IAuthenticatedOrgListingForPicker> {

        try {

            const connectedOrgListing = await this.listAuthorizedOrgDetails();
            const hiddenOrgCount = this.countHiddenOrgs(connectedOrgListing.hiddenOrgReasonCounts);

            return {
                orgDetails: connectedOrgListing.orgDetails,
                emptyListMessage: hiddenOrgCount > 0
                    ? `No connected Salesforce org is authorized: ${hiddenOrgCount} authorized ${hiddenOrgCount === 1 ? 'org is' : 'orgs are'} not listed (${this.formatHiddenOrgReasons(connectedOrgListing.hiddenOrgReasonCounts)}). ${REAUTHORIZE_ORG_INSTRUCTION}`
                    : NO_AUTHORIZED_ORGS_MESSAGE
            };

        } catch (listError) {

            /*
                The reason is the CLI's own text -- its JSON message, stderr or a spawn error -- and a
                notification renders [label](command:...) as a link that RUNS the command, so it is
                escaped like any other text this extension does not author.
            */
            const failureReason = RecipeYamlScalar.escapeForNotification(listError instanceof OrgConnectionStatusUnavailableError
                ? listError.message
                : `The authorized Salesforce orgs could not be listed: ${(listError as Error)?.message ?? listError}`);

            return { orgDetails: [], emptyListMessage: failureReason };

        }

    }

    /*
        The connected orgs as a quick pick, which opens busy at once and fills only when the CLI
        has answered. Compare with an org…, Insert Data Set by Directory and Run Picklist Dependency
        Check all come through here.
    */
    static async promptForAuthorizedOrg(placeHolder: string): Promise<IAuthenticatedOrgDetail | undefined> {

        return await VSCodeWorkspaceService.promptForAuthenticatedOrgDetailOnceListed(this.listAuthorizedOrgDetailsForPicker(), placeHolder);

    }

    /*
        The Dev Hub "sf org create scratch" would use with no --target-dev-hub, read IN PROCESS from
        what the CLI reads -- its environment variable, then the project's config, then the global
        one, each sf name before its legacy sfdx one -- so the confirmation can name it before any process is started (#200). Both
        files and the variable are untrusted text: only a usable alias or username is answered, and
        one that is not is the same as none, since the CLI could not be handed it either.
    */
    static readDefaultDevHubIdentifier(workspaceRoot: string,
                                        homeDirectoryPath: string = os.homedir(),
                                        environmentVariables: NodeJS.ProcessEnv = process.env): { identifier: string; configSource: IDefaultDevHubDetail['configSource'] } | undefined {

        for ( const environmentVariableName of [TARGET_DEV_HUB_ENVIRONMENT_VARIABLE, LEGACY_TARGET_DEV_HUB_ENVIRONMENT_VARIABLE] ) {

            const environmentValue = environmentVariables[environmentVariableName];

            if ( typeof environmentValue === 'string' && environmentValue.trim() !== '' ) {
                return PicklistDependencyCheckService.isValidTargetOrgIdentifier(environmentValue.trim())
                    ? { identifier: environmentValue.trim(), configSource: 'environment' }
                    : undefined;
            }

        }

        const configCandidates: Array<{ configFilePath: string; configKey: string; configSource: IDefaultDevHubDetail['configSource'] }> = [
            { configFilePath: path.join(workspaceRoot, '.sf', 'config.json'), configKey: TARGET_DEV_HUB_CONFIG_KEY, configSource: 'project' },
            { configFilePath: path.join(workspaceRoot, '.sfdx', 'sfdx-config.json'), configKey: LEGACY_TARGET_DEV_HUB_CONFIG_KEY, configSource: 'project' },
            { configFilePath: path.join(homeDirectoryPath, '.sf', 'config.json'), configKey: TARGET_DEV_HUB_CONFIG_KEY, configSource: 'global' },
            { configFilePath: path.join(homeDirectoryPath, '.sfdx', 'sfdx-config.json'), configKey: LEGACY_TARGET_DEV_HUB_CONFIG_KEY, configSource: 'global' }
        ];

        for ( const configCandidate of configCandidates ) {

            const configuredValue = this.readConfigFileValue(configCandidate.configFilePath, configCandidate.configKey);

            if ( configuredValue === undefined ) {
                continue;
            }

            return PicklistDependencyCheckService.isValidTargetOrgIdentifier(configuredValue)
                ? { identifier: configuredValue, configSource: configCandidate.configSource }
                : undefined;

        }

        return undefined;

    }

    // A FILE THAT IS MISSING, NOT A FILE, NOT JSON OR WITHOUT A STRING AT THE KEY HOLDS NO SETTING
    private static readConfigFileValue(configFilePath: string, configKey: string): string | undefined {

        try {

            if ( !fs.statSync(configFilePath).isFile() ) {
                return undefined;
            }

            const configuredValue = this.asRecord(JSON.parse(fs.readFileSync(configFilePath, 'utf-8')))?.[configKey];

            return typeof configuredValue === 'string' && configuredValue.trim() !== '' ? configuredValue.trim() : undefined;

        } catch {
            return undefined;
        }

    }

    /*
        The default Dev Hub and the authorization it names, by alias or username, read from the
        authorization files rather than by asking the CLI. Throws a message the reader can act on
        when none is set or the one set is not authorized here.
    */
    static async resolveDefaultDevHub(workspaceRoot: string,
                                        homeDirectoryPath?: string,
                                        environmentVariables?: NodeJS.ProcessEnv): Promise<IDefaultDevHubDetail> {

        const defaultDevHub = this.readDefaultDevHubIdentifier(workspaceRoot, homeDirectoryPath, environmentVariables);

        if ( !defaultDevHub ) {
            throw new Error(NO_DEFAULT_DEV_HUB_MESSAGE);
        }

        const devHubAuthorization = this.readAuthorizations(await AuthInfo.listAllAuthorizations()).find(authorization => (
            authorization?.username === defaultDevHub.identifier
            || ( Array.isArray(authorization?.aliases) && authorization.aliases.includes(defaultDevHub.identifier) )
        ));

        if ( !devHubAuthorization || typeof devHubAuthorization.username !== 'string' || !devHubAuthorization.username ) {
            throw new Error(`The default Dev Hub "${defaultDevHub.identifier}" is not an authorized org here, so no scratch org was created. Authorize it with "sf org login web --set-default-dev-hub", or set another with "sf config set target-dev-hub=<alias>", and try again.`);
        }

        const alias = Array.isArray(devHubAuthorization.aliases) && typeof devHubAuthorization.aliases[0] === 'string' ? devHubAuthorization.aliases[0] : undefined;

        return {
            targetOrgIdentifier: defaultDevHub.identifier,
            username: devHubAuthorization.username,
            alias: alias,
            configSource: defaultDevHub.configSource
        };

    }

    static getCachedDescribe(orgUsername: string, objectApiName: string): INormalizedOrgObjectDescribe | undefined {

        return this.describeCache.get(this.buildDescribeCacheKey(orgUsername, objectApiName));

    }

    static buildDescribeCacheKey(orgUsername: string, objectApiName: string): string {

        // SALESFORCE API NAMES ARE CASE-INSENSITIVE, SO "account" AND "Account" ARE ONE DESCRIBE
        return `${orgUsername}\n${objectApiName.toLowerCase()}`;

    }

    /*
        Describes each requested object once, answering from the session cache where it can.

        The connection is made only if something is NOT cached, so a repeat request makes no API
        call at all -- not even the authentication a connection costs. A connection failure throws,
        because it is an answer about the org rather than about any one object; a describe failure
        is recorded on that object's outcome and the rest carry on.
    */
    static async describeObjects(orgUsername: string,
                                    objectApiNames: string[],
                                    describeSourceFactory: () => Promise<IOrgDescribeSource>,
                                    requestOptions: IOrgDescribeRequestOptions = {}): Promise<IOrgDescribeRequestResult> {

        const requestedObjectApiNames = [...new Set(objectApiNames)];
        const requestedCount = requestedObjectApiNames.length;
        const outcomesByObjectApiName = new Map<string, IOrgObjectDescribeOutcome>();
        let completedCount = 0;

        const recordOutcome = (describeOutcome: IOrgObjectDescribeOutcome) => {
            outcomesByObjectApiName.set(describeOutcome.objectApiName, describeOutcome);
            completedCount++;
            requestOptions.onObjectDescribed?.(completedCount, requestedCount);
        };

        const uncachedObjectApiNames = requestedObjectApiNames.filter(objectApiName => {

            if ( !this.isUsableObjectApiName(objectApiName) ) {
                recordOutcome({ objectApiName: objectApiName, failureMessage: ORG_DESCRIBE_UNUSABLE_NAME_MESSAGE, wasCached: false });
                return false;
            }

            const cachedDescribe = this.describeCache.get(this.buildDescribeCacheKey(orgUsername, objectApiName));

            if ( cachedDescribe ) {
                recordOutcome({ objectApiName: objectApiName, describe: cachedDescribe, wasCached: true });
            }

            return !cachedDescribe;

        });

        const isCancellationRequested = () => !!requestOptions.isCancellationRequested?.();
        let wasCancelled = false;

        if ( uncachedObjectApiNames.length > 0 && !isCancellationRequested() ) {

            const describeSource = await describeSourceFactory();
            const pendingObjectApiNames = [...uncachedObjectApiNames];

            // EACH WORKER TAKES THE NEXT NAME UNTIL NONE ARE LEFT, SO AT MOST ORG_DESCRIBE_CONCURRENCY ARE IN FLIGHT
            const describeUntilDrained = async (): Promise<void> => {

                let objectApiName = pendingObjectApiNames.shift();

                while ( objectApiName !== undefined && !isCancellationRequested() ) {

                    try {

                        const normalizedDescribe = this.normalizeDescribeResult(objectApiName, await describeSource.describe(objectApiName));
                        this.describeCache.set(this.buildDescribeCacheKey(orgUsername, objectApiName), normalizedDescribe);
                        recordOutcome({ objectApiName: objectApiName, describe: normalizedDescribe, wasCached: false });

                    } catch (describeError) {

                        recordOutcome({ objectApiName: objectApiName, failureMessage: this.describeFailure(describeError), wasCached: false });

                    }

                    objectApiName = pendingObjectApiNames.shift();

                }

            };

            await Promise.all(Array.from(
                { length: Math.min(ORG_DESCRIBE_CONCURRENCY, uncachedObjectApiNames.length) },
                () => describeUntilDrained()
            ));

        }

        const outcomes = requestedObjectApiNames.map(objectApiName => {

            const describeOutcome = outcomesByObjectApiName.get(objectApiName);

            if ( describeOutcome ) {
                return describeOutcome;
            }

            wasCancelled = true;

            return { objectApiName: objectApiName, failureMessage: ORG_DESCRIBE_CANCELLED_MESSAGE, wasCached: false };

        });

        return { outcomes: outcomes, wasCancelled: wasCancelled };

    }

    static isUsableObjectApiName(objectApiName: string): boolean {

        return typeof objectApiName === 'string' && OBJECT_API_NAME_PATTERN.test(objectApiName);

    }

    private static describeFailure(describeError: unknown): string {

        const errorRecord = describeError as { errorCode?: unknown; message?: unknown } | undefined;
        const failureText = typeof errorRecord?.message === 'string' && errorRecord.message
            ? errorRecord.message
            : String(describeError);

        return typeof errorRecord?.errorCode === 'string' && errorRecord.errorCode && !failureText.startsWith(errorRecord.errorCode)
            ? `${errorRecord.errorCode}: ${failureText}`
            : failureText;

    }

    /*
        A describe result reduced to the comparable field model, and nothing else.

        Pure, and checked on the way: the result comes over the network, so every value read is
        type-checked rather than assumed. A result with no field list is not a describe of anything
        and throws, which describeObjects records as that object's failure. A field entry with no
        name cannot be compared with anything and is dropped.
    */
    static normalizeDescribeResult(requestedObjectApiName: string, describeResult: unknown): INormalizedOrgObjectDescribe {

        const describeRecord = this.asRecord(describeResult);
        const describeFields = describeRecord?.fields;

        if ( !Array.isArray(describeFields) ) {
            throw new Error(`The describe of ${requestedObjectApiName} returned no field list.`);
        }

        const fields: INormalizedOrgField[] = [];

        describeFields.forEach(describeField => {

            const fieldRecord = this.asRecord(describeField);
            const fieldApiName = fieldRecord?.name;

            if ( typeof fieldApiName !== 'string' || !fieldApiName ) {
                return;
            }

            fields.push({
                fieldApiName: fieldApiName,
                fieldLabel: this.asString(fieldRecord.label),
                fieldType: this.asString(fieldRecord.type),
                length: this.asNumber(fieldRecord.length),
                precision: this.asNumber(fieldRecord.precision),
                scale: this.asNumber(fieldRecord.scale),
                picklistValues: this.normalizePicklistValues(fieldRecord.picklistValues),
                controllingField: this.asString(fieldRecord.controllerName),
                referenceTo: Array.isArray(fieldRecord.referenceTo)
                    ? fieldRecord.referenceTo.filter((referencedObject): referencedObject is string => typeof referencedObject === 'string')
                    : [],
                isNillable: fieldRecord.nillable === true,
                isCreateable: fieldRecord.createable === true,
                isCalculated: fieldRecord.calculated === true,
                isDefaultedOnCreate: fieldRecord.defaultedOnCreate === true
            });

        });

        const describedObjectApiName = describeRecord.name;

        return {
            objectApiName: typeof describedObjectApiName === 'string' && describedObjectApiName ? describedObjectApiName : requestedObjectApiName,
            objectLabel: this.asString(describeRecord.label),
            isCreateable: describeRecord.createable === true,
            fields: fields
        };

    }

    static normalizePicklistValues(describePicklistValues: unknown): INormalizedOrgPicklistValue[] {

        if ( !Array.isArray(describePicklistValues) ) {
            return [];
        }

        return describePicklistValues.reduce((picklistValues: INormalizedOrgPicklistValue[], describePicklistValue) => {

            const picklistValueRecord = this.asRecord(describePicklistValue);
            const picklistValue = picklistValueRecord?.value;

            if ( typeof picklistValue !== 'string' ) {
                return picklistValues;
            }

            picklistValues.push({
                value: picklistValue,
                label: this.asString(picklistValueRecord.label) || picklistValue,
                isActive: picklistValueRecord.active === true,
                isDefault: picklistValueRecord.defaultValue === true
            });

            return picklistValues;

        }, []);

    }

    private static asRecord(candidateValue: unknown): Record<string, unknown> | undefined {

        return candidateValue !== null && typeof candidateValue === 'object' && !Array.isArray(candidateValue)
            ? candidateValue as Record<string, unknown>
            : undefined;

    }

    private static asString(candidateValue: unknown): string {

        return typeof candidateValue === 'string' ? candidateValue : '';

    }

    private static asNumber(candidateValue: unknown): number {

        return typeof candidateValue === 'number' && Number.isFinite(candidateValue) ? candidateValue : 0;

    }

}
