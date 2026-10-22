import { AuthInfo, Connection, Org, OrgAuthorization, StateAggregator } from '@salesforce/core';
import { IAuthenticatedOrgDetail, ISalesforceCliInvocationResult, PicklistDependencyCheckService } from '../PicklistDependencyCheckService/PicklistDependencyCheckService';
import { IAuthenticatedOrgListingForPicker, VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';
import { RecipeYamlScalar } from '../RecipeFakerService.ts/RecipeYamlScalar/RecipeYamlScalar';
import { SalesforceApiName } from '../RecipeService/SalesforceApiName';

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
    // THE DESCRIBE'S nameField: THE ONE FIELD A RECORD IS NAMED BY (Name, CaseNumber, ...)
    isNameField: boolean;
}

// isCreateable IS THE OBJECT'S OWN "createable" -- WHETHER THE USER CAN INSERT RECORDS OF IT AT ALL
export interface INormalizedOrgObjectDescribe {
    objectApiName: string;
    objectLabel: string;
    isCreateable: boolean;
    fields: INormalizedOrgField[];
    // THE THREE CHARACTERS EVERY RECORD Id OF THE OBJECT STARTS WITH; ABSENT WHEN THE DESCRIBE NAMES NONE
    keyPrefix?: string;
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
    // THE ORG ANSWERED THAT IT HAS NO SUCH OBJECT (NOT_FOUND) -- NOT A FAILURE TO ASK, WHICH SAYS NOTHING ABOUT THE OBJECT
    isNotFound?: boolean;
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

// MATCHED EXACTLY: A CASE OR WHITESPACE VARIANT IS NOT AN ANSWER THE ORG GIVES, SO IT IS REFUSED
export const DEVELOPER_EDITION_ORGANIZATION_TYPE = 'Developer Edition';

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
    aliasesByUsername?: Map<string, string>;
    checkedAuthorizationUsernames?: Set<string>;
    checkedAuthorizationAliasesByUsername?: Map<string, string>;
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
    orgDetails: IDataOrgDetail[];
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

// HOW MANY MATCHES A PARENT SEARCH LISTS (#254); ONE MORE IS ASKED FOR, SO THE PICKER CAN SAY THERE ARE MORE
export const ORG_PARENT_SEARCH_RESULT_LIMIT = 200;

/*
    One parent record a search found: its Id, type-checked, and its name-field value as text ('' when
    the record has none, which a quick pick still lists by its Id).
*/
export interface IParentRecordMatch {
    recordId: string;
    recordName: string;
}

export interface IParentRecordSearchResult {
    matches: IParentRecordMatch[];
    // TRUE WHEN MORE THAN ORG_PARENT_SEARCH_RESULT_LIMIT RECORDS MATCHED; ONLY THE FIRST ONES ARE LISTED
    hasMoreMatches: boolean;
}

export const ORG_ORGANIZATION_QUERY = 'SELECT IsSandbox, OrganizationType FROM Organization';

// THE CLI CONFIG KEY, ITS ENVIRONMENT VARIABLE, AND WHAT A READER WITH NONE SET IS TOLD TO RUN
export const TARGET_DEV_HUB_CONFIG_KEY = 'target-dev-hub';

export const TARGET_DEV_HUB_ENVIRONMENT_VARIABLE = 'SF_TARGET_DEV_HUB';

// THE sfdx-ERA NAMES THE CLI STILL HONOURS, EACH READ AFTER ITS sf COUNTERPART
export const LEGACY_TARGET_DEV_HUB_ENVIRONMENT_VARIABLE = 'SFDX_DEFAULTDEVHUBUSERNAME';

export const LEGACY_TARGET_DEV_HUB_CONFIG_KEY = 'defaultdevhubusername';

export const DEV_HUB_REAUTHORIZE_INSTRUCTION = 'Authorize one with "sf org login web --set-default-dev-hub" and try again.';

export const NO_AUTHORIZED_DEV_HUB_MESSAGE = `No Dev Hub is authorized, so no scratch org was created. ${DEV_HUB_REAUTHORIZE_INSTRUCTION}`;

export type DevHubConfigSource = 'environment' | 'project' | 'global';

// THE ORG "sf" COMMANDS TARGET WITH NO --target-org (#305), READ BY THE SAME NAMES AND ORDER AS THE DEFAULT DEV HUB
export const TARGET_ORG_CONFIG_KEY = 'target-org';

export const TARGET_ORG_ENVIRONMENT_VARIABLE = 'SF_TARGET_ORG';

export const LEGACY_TARGET_ORG_ENVIRONMENT_VARIABLE = 'SFDX_DEFAULTUSERNAME';

export const LEGACY_TARGET_ORG_CONFIG_KEY = 'defaultusername';

interface IDefaultOrgSettingNames {
    environmentVariableNames: string[];
    configKey: string;
    legacyConfigKey: string;
}

const DEFAULT_DEV_HUB_SETTING_NAMES: IDefaultOrgSettingNames = {
    environmentVariableNames: [TARGET_DEV_HUB_ENVIRONMENT_VARIABLE, LEGACY_TARGET_DEV_HUB_ENVIRONMENT_VARIABLE],
    configKey: TARGET_DEV_HUB_CONFIG_KEY,
    legacyConfigKey: LEGACY_TARGET_DEV_HUB_CONFIG_KEY
};

const DEFAULT_TARGET_ORG_SETTING_NAMES: IDefaultOrgSettingNames = {
    environmentVariableNames: [TARGET_ORG_ENVIRONMENT_VARIABLE, LEGACY_TARGET_ORG_ENVIRONMENT_VARIABLE],
    configKey: TARGET_ORG_CONFIG_KEY,
    legacyConfigKey: LEGACY_TARGET_ORG_CONFIG_KEY
};

/*
    An org the Treecipe tab's picker lists. isDefault marks the CLI's default org (#305): it is
    listed first whatever the CLI knows of its type, because what decides whether anything is
    inserted into it is the Organization row its selection asks for, never the listing.
*/
export interface IDataOrgDetail extends IAuthenticatedOrgDetail {
    isDefault?: boolean;
}

// A DEV HUB THE READER CAN PICK. configSource IS PRESENT ONLY ON THE ONE THE CLI HAS SET AS ITS DEFAULT
export interface IDevHubOrgDetail extends IAuthenticatedOrgDetail {
    // WHERE THE DEFAULT WAS READ: THE ENVIRONMENT, THE PROJECT'S .sf/config.json, OR THE GLOBAL ONE
    configSource?: DevHubConfigSource;
}

export interface IDevHubListingForPicker extends IAuthenticatedOrgListingForPicker<IDevHubOrgDetail> {
    defaultUsername?: string;
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

    /*
        Everything, or one org's answer for one object -- after a permission set assignment changed
        what that object's describe answers (#274), so the next readiness check describes it afresh
        instead of reading the answer from before.
    */
    static clearDescribeCache(orgUsername?: string, objectApiName?: string) {

        if ( orgUsername === undefined || objectApiName === undefined ) {
            this.describeCache.clear();
            return;
        }

        this.describeCache.delete(this.buildDescribeCacheKey(orgUsername, objectApiName));

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
        Which of the named Ids the org holds as records of the object (#421), as the org spells them
        (18 characters). Every Id is held to the Salesforce Id pattern before it is quoted, so none can
        close the quote, and the object name to the api-name rule. A query that fails, or an answer
        with no records list, THROWS: a caller never reads it as "none of them exist".
    */
    static async queryExistingRecordIds(querySource: IOrgQuerySource, objectApiName: string, recordIds: readonly string[]): Promise<string[]> {

        if ( !this.isUsableObjectApiName(objectApiName) ) {
            throw new Error(`"${objectApiName}" is ${ORG_DESCRIBE_UNUSABLE_NAME_MESSAGE}.`);
        }
        if ( recordIds.length === 0 ) {
            return [];
        }
        recordIds.forEach(recordId => {
            if ( typeof recordId !== 'string' || !SALESFORCE_RECORD_ID_PATTERN.test(recordId) ) {
                throw new Error(`"${recordId}" is not a Salesforce Id, so it was not sent to the org.`);
            }
        });

        const quotedIds = [...new Set(recordIds)].map(recordId => `'${recordId}'`).join(', ');
        const queryRecords = this.asRecord(await querySource.query(`SELECT Id FROM ${objectApiName} WHERE Id IN (${quotedIds})`))?.records;

        if ( !Array.isArray(queryRecords) ) {
            throw new Error(`The org's answer about its ${objectApiName} records could not be read.`);
        }

        return queryRecords
            .map(queryRecord => this.asRecord(queryRecord)?.Id)
            .filter((recordId): recordId is string => typeof recordId === 'string' && SALESFORCE_RECORD_ID_PATTERN.test(recordId));

    }

    // A 15-CHARACTER Id IS THE CASE-SENSITIVE HEAD OF ITS 18-CHARACTER FORM, SO EITHER NAMES THE SAME RECORD
    static isSameRecordId(leftRecordId: string, rightRecordId: string): boolean {

        return leftRecordId.length >= 15 && rightRecordId.length >= 15
                && leftRecordId.slice(0, 15) === rightRecordId.slice(0, 15)
                && ( leftRecordId.length === 15 || rightRecordId.length === 15 || leftRecordId === rightRecordId );

    }

    /*
        Which of the named permission sets the org holds, as the org spells them. Every name is held
        to the api-name rule before it is quoted into the SOQL, so a name cannot close the quote, and
        every answer is type-checked: it came over the network. A query that fails throws, so a
        caller never reads a failed query as "the org has none of them".
    */
    static async queryPermissionSetNames(querySource: IOrgQuerySource, permissionSetNames: readonly string[]): Promise<string[]> {

        if ( permissionSetNames.length === 0 ) {
            return [];
        }

        permissionSetNames.forEach(permissionSetName => {
            if ( !SalesforceApiName.isApiName(permissionSetName) ) {
                throw new Error(`"${permissionSetName}" is not a Salesforce api name, so it was not sent to the org.`);
            }
        });

        const quotedNames = permissionSetNames.map(permissionSetName => `'${permissionSetName}'`).join(', ');
        const queryRecords = this.asRecord(await querySource.query(`SELECT Name FROM PermissionSet WHERE Name IN (${quotedNames})`))?.records;

        if ( !Array.isArray(queryRecords) ) {
            throw new Error('The org\'s answer about its permission sets could not be read.');
        }

        return queryRecords
            .map(queryRecord => this.asRecord(queryRecord)?.Name)
            .filter((permissionSetName): permissionSetName is string => typeof permissionSetName === 'string' && SalesforceApiName.isApiName(permissionSetName));

    }

    /*
        The name field a describe marks (nameField), or undefined when it marks none or more than one:
        a parent search has exactly one field to search, or it offers Random only.
    */
    static findNameFieldApiName(describe: Pick<INormalizedOrgObjectDescribe, 'fields'>): string | undefined {

        const nameFields = describe.fields.filter(describeField => describeField.isNameField === true);

        return nameFields.length === 1 && this.isUsableObjectApiName(nameFields[0].fieldApiName)
            ? nameFields[0].fieldApiName
            : undefined;

    }

    /*
        The search text as the inside of a SOQL LIKE literal that matches it LITERALLY, between the
        two % that make it a "contains". A backslash and a quote are escaped for the string literal,
        and % and _ for LIKE, so none of them can end the literal or widen the match. A control
        character has no place in a name a reader types, and a pasted one could be a line break, so
        text carrying one is refused (undefined) rather than sent in any form.
    */
    static escapeSoqlLikeSearchText(searchText: string): string | undefined {

        if ( typeof searchText !== 'string' || /[\p{Cc}\u2028\u2029]/u.test(searchText) ) {
            return undefined;
        }

        return searchText.replace(/[\\'"%_]/g, matchedCharacter => `\\${matchedCharacter}`);

    }

    /*
        The SOQL a parent search sends, or undefined when it cannot be built safely: the object and
        name-field names must be api names, and the search text must escape. Names are held to the
        same rule a describe is, because both are joined into the query as they are. No COUNT():
        the query asks for records, one more than the picker lists.
    */
    static buildParentSearchQuery(objectApiName: string, nameFieldApiName: string, searchText: string): string | undefined {

        if ( !this.isUsableObjectApiName(objectApiName) || !this.isUsableObjectApiName(nameFieldApiName) ) {
            return undefined;
        }

        const escapedSearchText = this.escapeSoqlLikeSearchText(searchText);

        if ( escapedSearchText === undefined ) {
            return undefined;
        }

        return `SELECT Id, ${nameFieldApiName} FROM ${objectApiName} WHERE ${nameFieldApiName} LIKE '%${escapedSearchText}%' ORDER BY ${nameFieldApiName} LIMIT ${ORG_PARENT_SEARCH_RESULT_LIMIT + 1}`;

    }

    /*
        The parent records whose name field contains the search text. Every Id is type-checked as a
        Salesforce Id and a record without one is dropped; the name is kept only as a string. Throws
        when the query cannot be built or the org refuses it, so the picker can say why.
    */
    static async searchParentRecords(querySource: IOrgQuerySource,
                                        objectApiName: string,
                                        nameFieldApiName: string,
                                        searchText: string): Promise<IParentRecordSearchResult> {

        const searchQuery = this.buildParentSearchQuery(objectApiName, nameFieldApiName, searchText);

        if ( !searchQuery ) {
            throw new Error('The search could not be sent: it names something that is not an api name, or the text carries a control character.');
        }

        const queryRecords = this.asRecord(await querySource.query(searchQuery))?.records;
        const matches: IParentRecordMatch[] = [];
        const seenRecordIds = new Set<string>();

        ( Array.isArray(queryRecords) ? queryRecords : [] ).forEach(queryRecord => {
            const recordFields = this.asRecord(queryRecord);
            const recordId = recordFields?.Id;
            if ( typeof recordId !== 'string' || !SALESFORCE_RECORD_ID_PATTERN.test(recordId) || seenRecordIds.has(recordId) ) {
                return;
            }
            seenRecordIds.add(recordId);
            matches.push({ recordId: recordId, recordName: this.asString(recordFields[nameFieldApiName]) });
        });

        return {
            matches: matches.slice(0, ORG_PARENT_SEARCH_RESULT_LIMIT),
            hasMoreMatches: matches.length > ORG_PARENT_SEARCH_RESULT_LIMIT
        };

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

    /*
        Insert Data Set by Directory's rule: a sandbox or scratch org (IsSandbox), or a Developer
        Edition org. Everything else is refused, an org whose type could not be read included.
        Data-by-Org's Create is stricter on purpose and does not use this.
    */
    static isOrgTypeAllowedForDataSetInsert(orgTypeDetail: IOrgTypeDetail | undefined): boolean {

        if ( !orgTypeDetail ) {
            return false;
        }

        return orgTypeDetail.isSandbox === true || orgTypeDetail.organizationType === DEVELOPER_EDITION_ORGANIZATION_TYPE;

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

        const checkedAuthorizationUsernames = new Set<string>();
        const checkedAuthorizationAliasesByUsername = new Map<string, string>();

        (await this.readFreshAuthorizations()).forEach(authorization => {
            const username = authorization?.username;
            if ( typeof username === 'string' && username ) {
                checkedAuthorizationUsernames.add(username);
                checkedAuthorizationAliasesByUsername.set(username, PicklistDependencyCheckService.readFirstAuthorizationAlias(authorization) ?? '');
            }
        });

        const invocationResult = await PicklistDependencyCheckService.runSalesforceCli(
            [...SALESFORCE_CLI_ORG_LIST_ARGUMENTS],
            undefined,
            SALESFORCE_CLI_ORG_LIST_TIMEOUT_MILLISECONDS
        );

        return {
            ...this.parseOrgListInvocation(invocationResult),
            checkedAuthorizationUsernames: checkedAuthorizationUsernames,
            checkedAuthorizationAliasesByUsername: checkedAuthorizationAliasesByUsername
        };

    }

    /*
        @salesforce/core reads aliases once per process into a StateAggregator, so inside a long-lived
        extension host an alias set after the extension loaded -- "sf alias set", "sf org login
        --alias", a scratch org this extension created -- never appeared, and the org was listed by
        username (#286). Dropping the instance makes every listing read the alias file again.
    */
    private static async readFreshAuthorizations(): Promise<OrgAuthorization[]> {

        StateAggregator.clearInstance();

        return this.readAuthorizations(await AuthInfo.listAllAuthorizations());

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
        const aliasesByUsername = new Map<string, string>();

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

                const alias = this.readOrgListEntryAlias(orgListEntryRecord);

                if ( alias && !aliasesByUsername.has(username) ) {
                    aliasesByUsername.set(username, alias);
                }

            });

        });

        return { connectionStatesByUsername: connectionStatesByUsername, aliasesByUsername: aliasesByUsername };

    }

    /*
        An entry's alias, as untrusted as the rest of the answer: "alias" when it is a string, else
        the first string of "aliases". It is only ever a label, but one that could not be an org
        identifier is not one this extension offers either, so the org keeps its username.
    */
    static readOrgListEntryAlias(orgListEntry: Record<string, unknown>): string | undefined {

        const { alias, aliases } = orgListEntry;
        const candidateAlias = typeof alias === 'string' && alias
            ? alias
            : ( Array.isArray(aliases) ? aliases.find((listedAlias: unknown): listedAlias is string => typeof listedAlias === 'string' && !!listedAlias) : undefined );

        return candidateAlias !== undefined && PicklistDependencyCheckService.isValidTargetOrgIdentifier(candidateAlias) ? candidateAlias : undefined;

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
        const labelAliasesByUsername = this.buildLabelAliasesByUsername(this.readAuthorizations(authorizations), connectedOrgStatusListing);

        this.readAuthorizations(authorizations).forEach(authorization => {

            const username = authorization?.username;

            if ( typeof username !== 'string' || !username ) {
                return;
            }

            const hiddenReason = this.findHiddenOrgReason(authorization, connectedOrgStatusListing, isProductionExcluded);

            if ( hiddenReason ) {
                const label = PicklistDependencyCheckService.readFirstAuthorizationAlias(authorization) || labelAliasesByUsername.get(username) || username;
                hiddenOrgs.push({ username: username, label: label, reason: hiddenReason });
                return;
            }

            usableAuthorizations.push(authorization);

        });

        return {
            orgDetails: PicklistDependencyCheckService.buildAuthenticatedOrgDetails(usableAuthorizations, labelAliasesByUsername),
            hiddenOrgs: hiddenOrgs,
            hiddenOrgReasonCounts: this.countHiddenOrgReasons(hiddenOrgs)
        };

    }

    /*
        The CLI's alias for each authorization that carries none of its own. The authorizations are
        read fresh on every listing while the CLI's answer is cached until ⟳, so an alias the fresh
        read already gives another org has moved, and is not put back on this one; and an org whose
        authorization DID carry an alias when the CLI ran has had it removed since ("sf alias
        unset"), so the CLI's copy of it is stale too.
    */
    private static buildLabelAliasesByUsername(authorizations: OrgAuthorization[],
                                                connectedOrgStatusListing: IConnectedOrgStatusListing): Map<string, string> {

        const labelAliasesByUsername = new Map<string, string>();
        const cliAliasesByUsername = connectedOrgStatusListing.aliasesByUsername;

        if ( !( cliAliasesByUsername instanceof Map ) ) {
            return labelAliasesByUsername;
        }

        const heldAliases = new Set(authorizations.flatMap(authorization => (
            Array.isArray(authorization?.aliases) ? authorization.aliases.filter((alias: unknown) => typeof alias === 'string') : []
        )));

        const checkedAliasesByUsername = connectedOrgStatusListing.checkedAuthorizationAliasesByUsername;

        cliAliasesByUsername.forEach((alias, username) => {
            if ( !heldAliases.has(alias) && !checkedAliasesByUsername?.get(username) ) {
                labelAliasesByUsername.set(username, alias);
            }
        });

        return labelAliasesByUsername;

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

    /*
        The orgs Data-by-Org lists: only those known not to be production and reported connected,
        with why the rest are not. Given the workspace, the CLI's default org is listed FIRST and
        marked isDefault (#305) whenever the CLI reports it connected -- production included, since
        selecting it asks its Organization row and refuses every insert unless it answers IsSandbox.
    */
    static async listDataOrgDetails(workspaceRoot?: string,
                                    homeDirectoryPath?: string,
                                    environmentVariables?: NodeJS.ProcessEnv): Promise<IDataOrgListing> {

        const authorizations = await this.readFreshAuthorizations();
        const connectedOrgStatusListing = await this.listConnectedOrgStatusForAuthorizations(authorizations);
        const connectedOrgListing = this.buildConnectedOrgListing(authorizations, connectedOrgStatusListing, true);
        const defaultAuthorization = workspaceRoot === undefined
            ? undefined
            : this.findDefaultTargetOrgAuthorization(authorizations, workspaceRoot, homeDirectoryPath, environmentVariables);
        const defaultOrgDetail = defaultAuthorization
            ? this.buildConnectedOrgListing([defaultAuthorization], connectedOrgStatusListing, false).orgDetails[0]
            : undefined;

        if ( !defaultOrgDetail ) {
            return { ...connectedOrgListing, hiddenOrgCount: this.countHiddenOrgs(connectedOrgListing.hiddenOrgReasonCounts) };
        }

        const hiddenOrgs = connectedOrgListing.hiddenOrgs.filter(hiddenOrg => hiddenOrg.username !== defaultOrgDetail.username);
        const hiddenOrgReasonCounts = this.countHiddenOrgReasons(hiddenOrgs);

        return {
            orgDetails: [
                { ...defaultOrgDetail, isDefault: true },
                ...connectedOrgListing.orgDetails.filter(orgDetail => orgDetail.username !== defaultOrgDetail.username)
            ],
            hiddenOrgs: hiddenOrgs,
            hiddenOrgReasonCounts: hiddenOrgReasonCounts,
            hiddenOrgCount: this.countHiddenOrgs(hiddenOrgReasonCounts)
        };

    }

    /*
        An org named by username or alias, from the LOCAL authorization files alone -- no CLI, no
        connection -- so the picker can show it while "sf org list" is still checking (#305).
        isDefault says whether it is the CLI's default org. Nothing here says it is connected.
    */
    static async readLocalDataOrgDetail(identifier: string | undefined,
                                        workspaceRoot: string,
                                        homeDirectoryPath?: string,
                                        environmentVariables?: NodeJS.ProcessEnv): Promise<IDataOrgDetail | undefined> {

        const authorizations = await this.readFreshAuthorizations();
        const defaultAuthorization = this.findDefaultTargetOrgAuthorization(authorizations, workspaceRoot, homeDirectoryPath, environmentVariables);
        const authorization = identifier === undefined ? defaultAuthorization : this.findAuthorizationByIdentifier(authorizations, identifier);
        const orgDetail = authorization ? PicklistDependencyCheckService.buildAuthenticatedOrgDetails([authorization])[0] : undefined;

        if ( !orgDetail ) {
            return undefined;
        }

        return defaultAuthorization?.username === orgDetail.username ? { ...orgDetail, isDefault: true } : orgDetail;

    }

    private static findDefaultTargetOrgAuthorization(authorizations: OrgAuthorization[],
                                                        workspaceRoot: string,
                                                        homeDirectoryPath?: string,
                                                        environmentVariables?: NodeJS.ProcessEnv): OrgAuthorization | undefined {

        const defaultTargetOrg = this.readDefaultTargetOrgIdentifier(workspaceRoot, homeDirectoryPath, environmentVariables);

        return defaultTargetOrg ? this.findAuthorizationByIdentifier(authorizations, defaultTargetOrg.identifier) : undefined;

    }

    // A USERNAME MATCHES ITS OWN AUTHORIZATION FIRST, SO AN ALIAS THAT HAPPENS TO SPELL ANOTHER ORG'S USERNAME NEVER WINS
    private static findAuthorizationByIdentifier(authorizations: OrgAuthorization[], identifier: string): OrgAuthorization | undefined {

        const readableAuthorizations = this.readAuthorizations(authorizations);

        return readableAuthorizations.find(authorization => authorization?.username === identifier)
            ?? readableAuthorizations.find(authorization => Array.isArray(authorization?.aliases) && authorization.aliases.includes(identifier));

    }

    /*
        Which authorized org holds each alias, read from the local authorizations alone -- no CLI,
        no connection -- so "+ New scratch org" can say an alias the reader typed will be moved off
        another org (#279). A map, so an alias named __proto__ is an alias like any other.
    */
    static async listAliasHolders(): Promise<Map<string, string>> {

        const aliasHolders = new Map<string, string>();

        for ( const authorization of await this.readFreshAuthorizations() ) {
            const username = authorization?.username;
            if ( typeof username !== 'string' || !username || !Array.isArray(authorization?.aliases) ) {
                continue;
            }
            for ( const alias of authorization.aliases ) {
                if ( typeof alias === 'string' && alias && !aliasHolders.has(alias) ) {
                    aliasHolders.set(alias, username);
                }
            }
        }

        return aliasHolders;

    }

    /*
        The quick-pick commands have no ⟳, so an answer from the cache that leaves them nothing to
        offer is asked again once: the reader may have re-authorized an org since, which is exactly
        what the empty-list warning tells them to do.
    */
    static async listAuthorizedOrgDetails(): Promise<IConnectedOrgListing> {

        return await this.listConnectedOrgDetailsFor(await this.readFreshAuthorizations());

    }

    private static async listConnectedOrgDetailsFor(authorizations: OrgAuthorization[]): Promise<IConnectedOrgListing> {

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

            return { orgDetails: [], emptyListMessage: this.describeOrgListingFailure(listError) };

        }

    }

    /*
        The reason is the CLI's own text -- its JSON message, stderr or a spawn error -- and a
        notification renders [label](command:...) as a link that RUNS the command, so it is escaped
        like any other text this extension does not author.
    */
    private static describeOrgListingFailure(listError: unknown): string {

        return RecipeYamlScalar.escapeForNotification(listError instanceof OrgConnectionStatusUnavailableError
            ? listError.message
            : `The authorized Salesforce orgs could not be listed: ${(listError as Error)?.message ?? listError}`);

    }

    /*
        The connected orgs as a quick pick, which opens busy at once and fills only when the CLI
        has answered. Insert Data Set by Directory and Run Picklist Dependency Check both come
        through here.
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
                                        environmentVariables: NodeJS.ProcessEnv = process.env): { identifier: string; configSource: DevHubConfigSource } | undefined {

        return this.readDefaultOrgSetting(DEFAULT_DEV_HUB_SETTING_NAMES, workspaceRoot, homeDirectoryPath, environmentVariables);

    }

    // THE CLI'S DEFAULT TARGET ORG (#305), READ IN PROCESS THE SAME WAY, SO THE PICKER CAN NAME IT BEFORE "sf org list" ANSWERS
    static readDefaultTargetOrgIdentifier(workspaceRoot: string,
                                            homeDirectoryPath: string = os.homedir(),
                                            environmentVariables: NodeJS.ProcessEnv = process.env): { identifier: string; configSource: DevHubConfigSource } | undefined {

        return this.readDefaultOrgSetting(DEFAULT_TARGET_ORG_SETTING_NAMES, workspaceRoot, homeDirectoryPath, environmentVariables);

    }

    private static readDefaultOrgSetting(settingNames: IDefaultOrgSettingNames,
                                            workspaceRoot: string,
                                            homeDirectoryPath: string,
                                            environmentVariables: NodeJS.ProcessEnv): { identifier: string; configSource: DevHubConfigSource } | undefined {

        for ( const environmentVariableName of settingNames.environmentVariableNames ) {

            const environmentValue = environmentVariables[environmentVariableName];

            if ( typeof environmentValue === 'string' && environmentValue.trim() !== '' ) {
                return PicklistDependencyCheckService.isValidTargetOrgIdentifier(environmentValue.trim())
                    ? { identifier: environmentValue.trim(), configSource: 'environment' }
                    : undefined;
            }

        }

        const configCandidates: Array<{ configFilePath: string; configKey: string; configSource: DevHubConfigSource }> = [
            { configFilePath: path.join(workspaceRoot, '.sf', 'config.json'), configKey: settingNames.configKey, configSource: 'project' },
            { configFilePath: path.join(workspaceRoot, '.sfdx', 'sfdx-config.json'), configKey: settingNames.legacyConfigKey, configSource: 'project' },
            { configFilePath: path.join(homeDirectoryPath, '.sf', 'config.json'), configKey: settingNames.configKey, configSource: 'global' },
            { configFilePath: path.join(homeDirectoryPath, '.sfdx', 'sfdx-config.json'), configKey: settingNames.legacyConfigKey, configSource: 'global' }
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
        Every Dev Hub the reader can create a scratch org through: authorizations whose isDevHub is
        exactly true, of those only the ones the CLI reports connected (#243). The CLI's default is
        listed first and carries where it was set, but it is never chosen for the reader -- even a
        lone Dev Hub is picked, so the reader always knows whose scratch org limits a run spends.
    */
    static async listDevHubOrgDetails(workspaceRoot: string,
                                        homeDirectoryPath?: string,
                                        environmentVariables?: NodeJS.ProcessEnv): Promise<IConnectedOrgListing & { orgDetails: IDevHubOrgDetail[]; defaultUsername?: string }> {

        const devHubAuthorizations = (await this.readFreshAuthorizations())
            .filter(authorization => authorization?.isDevHub === true);
        const connectedListing = await this.listConnectedOrgDetailsFor(devHubAuthorizations);
        // THE ARGV NAMES THE USERNAME, SO A DEV HUB WHOSE ALIAS PASSES BUT WHOSE USERNAME DOES NOT IS NEVER OFFERED
        const connectedOrgListing = {
            ...connectedListing,
            orgDetails: connectedListing.orgDetails.filter(orgDetail => PicklistDependencyCheckService.isValidTargetOrgIdentifier(orgDetail.username))
        };

        const defaultDevHub = this.readDefaultDevHubIdentifier(workspaceRoot, homeDirectoryPath, environmentVariables);
        const defaultAuthorization = defaultDevHub && devHubAuthorizations.find(authorization => (
            authorization?.username === defaultDevHub.identifier
            || ( Array.isArray(authorization?.aliases) && authorization.aliases.includes(defaultDevHub.identifier) )
        ));
        const defaultOrgDetail = defaultAuthorization
            ? connectedOrgListing.orgDetails.find(orgDetail => orgDetail.username === defaultAuthorization.username)
            : undefined;

        if ( !defaultDevHub || !defaultOrgDetail ) {
            return connectedOrgListing;
        }

        return {
            ...connectedOrgListing,
            orgDetails: [
                { ...defaultOrgDetail, configSource: defaultDevHub.configSource },
                ...connectedOrgListing.orgDetails.filter(orgDetail => orgDetail !== defaultOrgDetail)
            ],
            defaultUsername: defaultOrgDetail.username
        };

    }

    // NEVER THROWS: WITH NOTHING TO OFFER, THE PICKER SHOWS WHY INSTEAD OF AN EMPTY LIST
    static async listDevHubOrgDetailsForPicker(workspaceRoot: string): Promise<IDevHubListingForPicker> {

        try {

            const devHubListing = await this.listDevHubOrgDetails(workspaceRoot);
            const hiddenOrgCount = this.countHiddenOrgs(devHubListing.hiddenOrgReasonCounts);

            return {
                orgDetails: devHubListing.orgDetails,
                defaultUsername: devHubListing.defaultUsername,
                emptyListMessage: hiddenOrgCount > 0
                    ? `No connected Dev Hub is authorized, so no scratch org was created: ${hiddenOrgCount} authorized ${hiddenOrgCount === 1 ? 'Dev Hub is' : 'Dev Hubs are'} not listed (${this.formatHiddenOrgReasons(devHubListing.hiddenOrgReasonCounts)}). ${DEV_HUB_REAUTHORIZE_INSTRUCTION}`
                    : NO_AUTHORIZED_DEV_HUB_MESSAGE
            };

        } catch (listError) {

            return { orgDetails: [], emptyListMessage: this.describeOrgListingFailure(listError) };

        }

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

                        recordOutcome({
                            objectApiName: objectApiName,
                            failureMessage: this.describeFailure(describeError),
                            ...( this.isNotFoundError(describeError) ? { isNotFound: true } : {} ),
                            wasCached: false
                        });

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

    // jsforce REPORTS A DESCRIBE OF AN OBJECT THE ORG DOES NOT HAVE AS errorCode NOT_FOUND
    static isNotFoundError(describeError: unknown): boolean {

        return ( describeError as { errorCode?: unknown } | undefined )?.errorCode === 'NOT_FOUND';

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
                isDefaultedOnCreate: fieldRecord.defaultedOnCreate === true,
                isNameField: fieldRecord.nameField === true
            });

        });

        const describedObjectApiName = describeRecord.name;

        return {
            objectApiName: typeof describedObjectApiName === 'string' && describedObjectApiName ? describedObjectApiName : requestedObjectApiName,
            objectLabel: this.asString(describeRecord.label),
            isCreateable: describeRecord.createable === true,
            fields: fields,
            ...( typeof describeRecord.keyPrefix === 'string' && /^[A-Za-z0-9]{3}$/.test(describeRecord.keyPrefix) ? { keyPrefix: describeRecord.keyPrefix } : {} )
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
