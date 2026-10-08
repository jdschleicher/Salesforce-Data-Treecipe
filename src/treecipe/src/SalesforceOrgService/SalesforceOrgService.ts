import { AuthInfo, Connection, Org } from '@salesforce/core';
import { IAuthenticatedOrgDetail, PicklistDependencyCheckService } from '../PicklistDependencyCheckService/PicklistDependencyCheckService';
import { VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';

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

/*
    One object's record count in an org. "notInOrg" is INVALID_TYPE -- the org has no such object,
    or the user cannot see it at all -- and "noAccess" an INSUFFICIENT_ACCESS answer; anything else
    the query threw is "failed" with its message. recordCount is set only on "count".
*/
export type OrgRecordCountStatus = 'count' | 'notInOrg' | 'noAccess' | 'failed';

export interface IOrgRecordCountOutcome {
    objectApiName: string;
    status: OrgRecordCountStatus;
    recordCount?: number;
    failureMessage?: string;
    wasCached: boolean;
}

export interface IOrgRecordCountRequestResult {
    outcomes: IOrgRecordCountOutcome[];
    wasCancelled: boolean;
}

// THE ONE METHOD OF A CONNECTION THE COUNT AND ORGANIZATION QUERIES CALL
export interface IOrgQuerySource {
    query(soql: string): Promise<unknown>;
}

export interface IOrgRecordCountRequestOptions {
    onObjectCounted?: (countOutcome: IOrgRecordCountOutcome, completedCount: number, requestedCount: number) => void;
    isCancellationRequested?: () => boolean;
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

// THE AUTHORIZED ORGS DATA-BY-ORG MAY CONNECT TO, AND HOW MANY IT LEFT OUT FOR NOT BEING KNOWN AS NON-PRODUCTION
export interface IDataOrgListing {
    orgDetails: IAuthenticatedOrgDetail[];
    hiddenOrgCount: number;
}

/*
    A sandbox's instance url: "<domain>--<sandbox>.sandbox.my.salesforce.com" with enhanced domains,
    and "<domain>--<sandbox>.my.salesforce.com" before them. "--" separates the sandbox name and
    cannot appear in a production My Domain name.
*/
const SANDBOX_INSTANCE_HOST_PATTERN = /(?:\.sandbox\.my\.salesforce\.com|--[a-z0-9-]+\.my\.salesforce\.com)$/i;

export const ORG_PARENT_RECORD_ID_LIMIT = 2000;

const SALESFORCE_RECORD_ID_PATTERN = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;

export const ORG_ORGANIZATION_QUERY = 'SELECT IsSandbox, OrganizationType FROM Organization';

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

    // KEYED LIKE THE DESCRIBE CACHE, BY USERNAME AND OBJECT, AND LIKE IT HOLDING ONLY SUCCESSES
    private static recordCountCache = new Map<string, number>();

    /*
        With a username, only that org's counts -- what the cockpit's ⟳ asks for; with an object
        name too, only that one count, which is what a Create that just inserted records needs.
    */
    static clearRecordCountCache(orgUsername?: string, objectApiName?: string) {

        if ( orgUsername === undefined ) {
            this.recordCountCache.clear();
            return;
        }

        if ( objectApiName !== undefined ) {
            this.recordCountCache.delete(this.buildDescribeCacheKey(orgUsername, objectApiName));
            return;
        }

        const usernamePrefix = `${orgUsername}\n`;
        [...this.recordCountCache.keys()]
            .filter(cacheKey => cacheKey.startsWith(usernamePrefix))
            .forEach(cacheKey => this.recordCountCache.delete(cacheKey));

    }

    static getCachedRecordCount(orgUsername: string, objectApiName: string): number | undefined {

        return this.recordCountCache.get(this.buildDescribeCacheKey(orgUsername, objectApiName));

    }

    /*
        SELECT COUNT() for each requested object, five at a time, answering from the session cache
        where it can -- the same shape as describeObjects, for the same reasons. A name that is not
        an api name is refused before any query: it is interpolated into SOQL, where "Account; DELETE"
        would otherwise be sent. A connection failure throws, because it is an answer about the org;
        a query failure is that object's outcome.
    */
    static async countRecords(orgUsername: string,
                                objectApiNames: string[],
                                querySourceFactory: () => Promise<IOrgQuerySource>,
                                requestOptions: IOrgRecordCountRequestOptions = {}): Promise<IOrgRecordCountRequestResult> {

        const requestedObjectApiNames = [...new Set(objectApiNames)];
        const requestedCount = requestedObjectApiNames.length;
        const outcomesByObjectApiName = new Map<string, IOrgRecordCountOutcome>();
        let completedCount = 0;

        const recordOutcome = (countOutcome: IOrgRecordCountOutcome) => {
            outcomesByObjectApiName.set(countOutcome.objectApiName, countOutcome);
            completedCount++;
            requestOptions.onObjectCounted?.(countOutcome, completedCount, requestedCount);
        };

        const uncachedObjectApiNames = requestedObjectApiNames.filter(objectApiName => {

            if ( !this.isUsableObjectApiName(objectApiName) ) {
                recordOutcome({ objectApiName: objectApiName, status: 'failed', failureMessage: ORG_DESCRIBE_UNUSABLE_NAME_MESSAGE, wasCached: false });
                return false;
            }

            const cachedRecordCount = this.getCachedRecordCount(orgUsername, objectApiName);

            if ( cachedRecordCount !== undefined ) {
                recordOutcome({ objectApiName: objectApiName, status: 'count', recordCount: cachedRecordCount, wasCached: true });
            }

            return cachedRecordCount === undefined;

        });

        const isCancellationRequested = () => !!requestOptions.isCancellationRequested?.();

        if ( uncachedObjectApiNames.length > 0 && !isCancellationRequested() ) {

            const querySource = await querySourceFactory();
            const pendingObjectApiNames = [...uncachedObjectApiNames];

            const countUntilDrained = async (): Promise<void> => {

                let objectApiName = pendingObjectApiNames.shift();

                while ( objectApiName !== undefined && !isCancellationRequested() ) {

                    try {

                        const recordCount = this.readTotalSize(await querySource.query(`SELECT COUNT() FROM ${objectApiName}`));
                        this.recordCountCache.set(this.buildDescribeCacheKey(orgUsername, objectApiName), recordCount);
                        recordOutcome({ objectApiName: objectApiName, status: 'count', recordCount: recordCount, wasCached: false });

                    } catch (queryError) {

                        recordOutcome({ objectApiName: objectApiName, ...this.classifyCountFailure(queryError), wasCached: false });

                    }

                    objectApiName = pendingObjectApiNames.shift();

                }

            };

            await Promise.all(Array.from(
                { length: Math.min(ORG_DESCRIBE_CONCURRENCY, uncachedObjectApiNames.length) },
                () => countUntilDrained()
            ));

        }

        let wasCancelled = false;

        const outcomes = requestedObjectApiNames.map(objectApiName => {

            const countOutcome = outcomesByObjectApiName.get(objectApiName);

            if ( countOutcome ) {
                return countOutcome;
            }

            wasCancelled = true;

            return { objectApiName: objectApiName, status: 'failed' as const, failureMessage: ORG_DESCRIBE_CANCELLED_MESSAGE, wasCached: false };

        });

        return { outcomes: outcomes, wasCancelled: wasCancelled };

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

    // A COUNT() QUERY ANSWERS IN totalSize; ANYTHING ELSE IS NOT A COUNT AND THROWS, WHICH countRecords RECORDS AS "failed"
    static readTotalSize(queryResult: unknown): number {

        const totalSize = this.asRecord(queryResult)?.totalSize;

        if ( typeof totalSize !== 'number' || !Number.isInteger(totalSize) || totalSize < 0 ) {
            throw new Error('The count query returned no record count.');
        }

        return totalSize;

    }

    static classifyCountFailure(queryError: unknown): { status: OrgRecordCountStatus; failureMessage: string } {

        const errorCode = ( queryError as { errorCode?: unknown; name?: unknown } | undefined )?.errorCode
                            ?? ( queryError as { name?: unknown } | undefined )?.name;
        const failureMessage = this.describeFailure(queryError);
        const codeText = typeof errorCode === 'string' ? errorCode : '';

        if ( codeText === 'INVALID_TYPE' || failureMessage.startsWith('INVALID_TYPE') ) {
            return { status: 'notInOrg', failureMessage: failureMessage };
        }

        if ( codeText.startsWith('INSUFFICIENT_ACCESS') || failureMessage.startsWith('INSUFFICIENT_ACCESS') ) {
            return { status: 'noAccess', failureMessage: failureMessage };
        }

        return { status: 'failed', failureMessage: failureMessage };

    }

    /*
        The org's IsSandbox and OrganizationType, or undefined when the query failed or answered
        with anything else. Never throws: an org whose type cannot be read is still an org whose
        records can be counted, and the caller labels it "type unknown".
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

    // THE ORGS DATA-BY-ORG LISTS: ONLY THOSE KNOWN NOT TO BE PRODUCTION, WITH A COUNT OF THE REST
    static async listDataOrgDetails(): Promise<IDataOrgListing> {

        const allAuthorizations = await AuthInfo.listAllAuthorizations();
        const authorizations = Array.isArray(allAuthorizations) ? allAuthorizations : [];
        const nonProductionAuthorizations = authorizations.filter(authorization => this.isKnownNonProductionAuthorization(authorization));

        return {
            orgDetails: PicklistDependencyCheckService.buildAuthenticatedOrgDetails(nonProductionAuthorizations),
            hiddenOrgCount: authorizations.length - nonProductionAuthorizations.length
        };

    }

    static async listAuthorizedOrgDetails(): Promise<IAuthenticatedOrgDetail[]> {

        const allAuthorizations = await AuthInfo.listAllAuthorizations();

        return PicklistDependencyCheckService.buildAuthenticatedOrgDetails(allAuthorizations);

    }

    /*
        The authorized orgs the CLI knows, as a quick pick. No authorized org is SAID rather than
        shown as an empty list, which would look like a picker that failed to load.
    */
    static async promptForAuthorizedOrg(placeHolder: string): Promise<IAuthenticatedOrgDetail | undefined> {

        const authorizedOrgDetails = await this.listAuthorizedOrgDetails();

        if ( authorizedOrgDetails.length === 0 ) {
            VSCodeWorkspaceService.showWarningMessage(NO_AUTHORIZED_ORGS_MESSAGE);
            return undefined;
        }

        return await VSCodeWorkspaceService.promptForAuthenticatedOrgDetail(authorizedOrgDetails, placeHolder);

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
