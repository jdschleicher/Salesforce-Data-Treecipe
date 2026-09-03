import {
    IPicklistDependencySkippedField,
    IPicklistDependencySpecDetail,
    IRecordTypePicklistDependencySpecDetail,
    PicklistDependencyTestService
} from '../PicklistDependencyTestService/PicklistDependencyTestService';

import {
    IPicklistDependencyManifest,
    IPicklistDependencyManifestFreshnessResult,
    IPicklistDependencyManifestLoad,
    PicklistDependencyManifestLoadState,
    PicklistDependencyManifestFreshness,
    PicklistDependencyManifestService
} from '../PicklistDependencyManifestService/PicklistDependencyManifestService';

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/*
    A combination is either confirmed good, confirmed drifted, or not covered by the run that was
    loaded. "unknown" is a distinct state on purpose: a check that has not run, or a failure that
    could not be tied to a combination, must never render as a green tick -- the panel would then
    report a dependency as verified when nothing verified it.
*/
export type PicklistDependencyCheckStatus = 'passed' | 'failed' | 'unknown';

/*
    Why the panel has no results to overlay, which the empty states are keyed off. "noResultsFound"
    and "unreadableResults" are both non-error states -- the structure still renders either way.
*/
export type PicklistDependencyRunLoadState = 'loaded' | 'noResultsFound' | 'unreadableResults';

/*
    Where the structure on screen came from. Kept as an explicit field rather than inferred from the
    presence of a manifest, because the panel's central promise -- that what is rendered is what the
    generated tests assert -- is only true for one of these two, and a reader has to be told which.
*/
export type PicklistDependencyExplorerModelSource = 'manifest' | 'metadataPreview';

export interface IPicklistDependencyFailureDetailViewModel {
    kind: string;
    message: string;
}

export interface IPicklistDependencyCombinationViewModel {
    /*
        The stable identity this combination is attributed by, from the spec manifest. Failure
        attribution resolves against these rather than against freshly re-derived metadata, so a
        failure either lands on the combination the generated spec declared or is surfaced as
        unattributed -- there is no path by which it lands on a row it is not about.
    */
    combinationKey: string;
    controllingValue: string;
    allowedValues: string[];
    /*
        Whether the spec asserts what this controlling value must NOT unlock. The forbidden values
        themselves are not carried here: they are the complement of allowedValues within the node's
        declaredValues, and the panel derives them. Carrying them per combination made the payload
        the product of the two picklists' sizes -- 62MB of embedded JSON for a large org -- when the
        information content is their sum.
    */
    hasForbiddenAssertion: boolean;
    /*
        The controlling value is not reachable at all under this combination's scope -- emitted as
        expectUnavailable rather than expectNone. Only ever true on a record-type scoped combination:
        a record type that does not assign a controlling value does not expose it as an empty choice.
    */
    controllingValueUnavailable: boolean;
    status: PicklistDependencyCheckStatus;
    // EVERY FAILURE THE RUN REPORTED FOR THIS COMBINATION. THE VALIDATOR CAN RAISE MORE THAN ONE.
    failures: IPicklistDependencyFailureDetailViewModel[];
}

/*
    One record type's view of a dependent field, drawn beneath the field-level combinations rather
    than beside them: the record type narrows the same dependency, so nesting is what shows that a
    scoped combination can only ever be a subset of the field-level one above it.
*/
export interface IPicklistDependencyRecordTypeScopeViewModel {
    recordTypeDeveloperName: string;
    // THE GENERATED APEX METHOD THAT RETURNS THIS SCOPE'S SPEC, EMPTY WHERE THE MODEL DID NOT COME FROM A MANIFEST
    specMethodName: string;
    // WHAT THE RECORD TYPE ASSIGNS TO THE DEPENDENT FIELD -- THE UNIVERSE ITS FORBIDDEN SETS COMPLEMENT AGAINST
    declaredValues: string[];
    combinations: IPicklistDependencyCombinationViewModel[];
    status: PicklistDependencyCheckStatus;
    failureCount: number;
}

export interface IPicklistDependencyNodeViewModel {
    objectApiName: string;
    fieldApiName: string;
    controllingFieldApiName: string;
    /*
        The generated class and method that assert this field, so every panel node names the code
        behind it. Empty when the model was built as a metadata preview rather than from a manifest,
        which is exactly the case where no generated code asserts the node at all.
    */
    generatedClassName: string;
    specMethodName: string;
    // ABSOLUTE PATH TO THE ".field-meta.xml" THAT GENERATED THIS NODE, FOR THE REVEAL ACTION
    sourceFilePath: string;
    // EVERY VALUE THE DEPENDENT FIELD DECLARES. THE UNIVERSE EACH COMBINATION'S FORBIDDEN SET IS THE COMPLEMENT AGAINST.
    declaredValues: string[];
    combinations: IPicklistDependencyCombinationViewModel[];
    // FIELDS CONTROLLED BY THIS ONE, WHICH IS WHAT MAKES A CHAIN A GRAPH RATHER THAN REPEATED ROWS
    downstreamNodes: IPicklistDependencyNodeViewModel[];
    status: PicklistDependencyCheckStatus;
    failureCount: number;
    // FAILURES THE VALIDATOR RAISED AGAINST THE FIELD RATHER THAN AGAINST ONE COMBINATION
    fieldLevelFailures: IPicklistDependencyFailureDetailViewModel[];
    // ONE PER RECORD TYPE THAT NARROWS THIS FIELD, EMPTY WHERE THE OBJECT DECLARES NO RECORD TYPES
    recordTypeScopes: IPicklistDependencyRecordTypeScopeViewModel[];
}

/*
    A dependent picklist the generator did not spec, with the reason in the words the generate
    command reported. Its status is neither passed nor failed nor unknown -- nothing asserts it, and
    saying "unknown" would imply a spec exists whose result has not been seen.
*/
export interface IPicklistDependencySkippedFieldViewModel {
    fieldApiName: string;
    recordTypeDeveloperName: string;
    warning: string;
}

export interface IPicklistDependencyObjectViewModel {
    objectApiName: string;
    rootNodes: IPicklistDependencyNodeViewModel[];
    dependentFieldCount: number;
    combinationCount: number;
    /*
        Counted apart from combinationCount rather than folded into it. combinationCount is what the
        generated test class actually verifies; no source shipped with the framework can check a
        record-type scoped combination, so adding them to one total would overstate what a green run
        proves.
    */
    recordTypeCombinationCount: number;
    status: PicklistDependencyCheckStatus;
    failureCount: number;
    /*
        The generated Apex test method that covers this object. Held so a reader can tie a panel row
        back to the line in results.json, and so an object present in the metadata but absent from
        the loaded run is distinguishable from one that ran and passed.
    */
    testMethodName: string;
    // THE GENERATED PER-OBJECT CLASS CARRYING THIS OBJECT'S SPECS, EMPTY IN A METADATA PREVIEW
    generatedClassName: string;
    generatedClassFilePath: string;
    /*
        Dependent picklists on this object that the generator declined to spec. Rendered as rows in
        their own right rather than omitted: a field absent from both the Apex and the panel is
        indistinguishable from one that has no dependency at all, which is the more dangerous of the
        two readings.
    */
    skippedFields: IPicklistDependencySkippedFieldViewModel[];
    /*
        Failure text from the run that could NOT be tied to a combination in this object -- either
        the message named no combination at all, or it named one this metadata no longer describes.
        Its presence is what holds the object's combinations at "unknown".
    */
    unattributedFailureMessages: string[];
}

export interface IPicklistDependencyRunSummary {
    targetOrg: string;
    ranAt: string;
    passed: boolean;
    failureCount: number;
    methodsRun: number;
    resultsFilePath: string;
}

export interface IPicklistDependencyExplorerViewModel {
    scannedObjectsDirectoryPath: string;
    objects: IPicklistDependencyObjectViewModel[];
    dependentFieldCount: number;
    combinationCount: number;
    recordTypeCombinationCount: number;
    runLoadState: PicklistDependencyRunLoadState;
    runSummary?: IPicklistDependencyRunSummary;
    // WHY A RUN COULD NOT BE LOADED, IN WORDS A READER CAN ACT ON
    runLoadMessage: string;
    skippedFieldWarnings: string[];
    /*
        How this model was sourced. "manifest" is the honest rendering -- these are the specs that
        were generated and are what the tests assert. "metadataPreview" is the explicit opt-in for a
        workspace that has never generated, and every row it produces is un-asserted by definition:
        nothing has been emitted for it, so nothing can have run against it.
    */
    modelSource: PicklistDependencyExplorerModelSource;
    manifestLoadState: PicklistDependencyManifestLoadState;
    // WHY NO MANIFEST COULD BE READ, IN WORDS NAMING THE COMMAND THAT WRITES ONE
    manifestLoadMessage: string;
    manifestFreshness: PicklistDependencyManifestFreshness;
    // THE STALENESS BANNER, EMPTY WHEN THE MANIFEST STILL DESCRIBES THE METADATA ON DISK
    manifestFreshnessMessage: string;
    manifestFilePath: string;
    generatedAt: string;
    generatorVersion: string;
    aggregatorClassName: string;
    specsTestClassName: string;
    classesDirectoryPath: string;
}

/*
    The generated Apex names for one object, so a node can say which class and method assert it.

    Passed in rather than recomputed: the manifest already recorded the names the generator used,
    and deriving them a second time here is how the panel and the Apex came to disagree in the
    first place. A model built without them renders empty names, which is the correct answer for a
    metadata preview -- no generated code asserts it.
*/
export interface IPicklistDependencyGeneratedNames {
    generatedClassName: string;
    specMethodNamesByFieldKey: Record<string, string>;
}

export const EMPTY_GENERATED_NAMES: IPicklistDependencyGeneratedNames = {
    generatedClassName: '',
    specMethodNamesByFieldKey: {}
};

/*
    Everything about a view model that comes from the spec manifest rather than from the dependency
    structure itself. Defaulted so a metadata preview -- the explicit "not generated" path -- reads
    as exactly that without every caller having to spell it out.
*/
export interface IPicklistDependencyExplorerContext {
    modelSource: PicklistDependencyExplorerModelSource;
    manifestLoadState: PicklistDependencyManifestLoadState;
    manifestLoadMessage: string;
    manifestFreshness: PicklistDependencyManifestFreshness;
    manifestFreshnessMessage: string;
    manifestFilePath: string;
    generatedAt: string;
    generatorVersion: string;
    aggregatorClassName: string;
    specsTestClassName: string;
    classesDirectoryPath: string;
    generatedNamesByObjectApiName: Record<string, IPicklistDependencyGeneratedNames>;
    generatedClassFilePathsByObjectApiName: Record<string, string>;
    skippedFields: IPicklistDependencySkippedField[];
}

export interface IParsedPicklistDependencyFailure {
    objectApiName: string;
    fieldApiName: string;
    /*
        Set when the failure line carried a "[RecordType]" scope, which SDTPicklistDependencyValidator
        emits for a record-type scoped spec. Absent for a field-level failure.
    */
    recordTypeDeveloperName?: string;
    kind: string;
    /*
        The raw text after "@ " for a scoped failure, which is "<controllingValue>: <message>".
        A Salesforce picklist value may itself contain ": ", so where that split falls cannot be
        decided by the line alone -- it is resolved against the controlling values the metadata
        actually declares. Absent for a failure raised against the whole field.
    */
    controllingValueAndMessage?: string;
    // SET ONLY FOR A FIELD LEVEL FAILURE, WHERE NO CONTROLLING VALUE IS IN PLAY
    fieldLevelMessage?: string;
}

export interface IPicklistDependencyResultsMethodOutcome {
    methodName: string;
    passed: boolean;
    message?: string;
}

export interface IPicklistDependencyResultsFile {
    targetOrg: string;
    ranAt: string;
    passed: boolean;
    failureCount: number;
    methodsRun: number;
    methodOutcomes: IPicklistDependencyResultsMethodOutcome[];
}

export interface IPicklistDependencyResultsLoad {
    state: PicklistDependencyRunLoadState;
    message: string;
    results?: IPicklistDependencyResultsFile;
    resultsFilePath?: string;
}

export class PicklistDependencyExplorerService {

    static getResultsFileName(): string {
        return 'results.json';
    }

    /*
        The run folder name is "check-{org}-{timestamp}" and the org identifier can itself contain
        hyphens, so the timestamp is anchored at the END of the name rather than split out by
        position. VSCodeWorkspaceService writes it as an ISO string with the colons replaced, which
        is fixed width and therefore sorts chronologically as plain text.
    */
    private static resultsFolderTimestampPattern = /-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})$/;

    static getResultsFolderTimestamp(resultsFolderName: string): string | undefined {

        const timestampMatch = this.resultsFolderTimestampPattern.exec(resultsFolderName);
        return timestampMatch ? timestampMatch[1] : undefined;

    }

    /*
        The most recent run folder holding a results.json.

        Ordering is by the timestamp in the folder name rather than by mtime: every file in a fresh
        clone carries the checkout time, which would make the "most recent" run arbitrary for anyone
        who committed their check artifacts. A folder whose name carries no parseable timestamp is
        skipped rather than guessed at -- it was not written by the check command.
    */
    static findLatestResultsFilePath(resultsFolderPath: string): string | undefined {

        if ( !fs.existsSync(resultsFolderPath) ) {
            return undefined;
        }

        let latestTimestamp: string | undefined;
        let latestResultsFilePath: string | undefined;

        const resultsFolderEntries = fs.readdirSync(resultsFolderPath, { withFileTypes: true });

        resultsFolderEntries.forEach(resultsFolderEntry => {

            if ( !resultsFolderEntry.isDirectory() ) {
                return;
            }

            const runFolderTimestamp = this.getResultsFolderTimestamp(resultsFolderEntry.name);
            if ( !runFolderTimestamp ) {
                return;
            }

            const candidateResultsFilePath = path.join(resultsFolderPath, resultsFolderEntry.name, this.getResultsFileName());
            if ( !fs.existsSync(candidateResultsFilePath) ) {
                return;
            }

            if ( latestTimestamp === undefined || runFolderTimestamp > latestTimestamp ) {
                latestTimestamp = runFolderTimestamp;
                latestResultsFilePath = candidateResultsFilePath;
            }

        });

        return latestResultsFilePath;

    }

    /*
        A results.json that cannot be read is reported as a state rather than thrown. The dependency
        STRUCTURE is readable without any run at all, so a corrupt artifact must degrade the overlay
        and nothing else -- throwing here would leave the user with a blank panel and no way to see
        the dependencies the file has nothing to do with.
    */
    static loadLatestResults(resultsFolderPath: string): IPicklistDependencyResultsLoad {

        const latestResultsFilePath = this.findLatestResultsFilePath(resultsFolderPath);

        if ( !latestResultsFilePath ) {
            return {
                state: 'noResultsFound',
                message: `No picklist dependency check has been run yet -- no run results were found in "${resultsFolderPath}". Run "Salesforce Treecipe: Run Picklist Dependency Check" to overlay pass/fail state on the structure below.`
            };
        }

        let parsedResultsFileContent: unknown;

        try {
            parsedResultsFileContent = JSON.parse(fs.readFileSync(latestResultsFilePath, 'utf-8'));
        } catch (error) {
            return {
                state: 'unreadableResults',
                message: `The most recent check results at "${latestResultsFilePath}" could not be read as JSON (${error.message}). The dependency structure below is shown without pass/fail state -- re-run the picklist dependency check to replace the file.`,
                resultsFilePath: latestResultsFilePath
            };
        }

        const resultsFileRecord = parsedResultsFileContent as Record<string, unknown> | null;

        // A FILE THAT PARSES BUT CARRIES NO OUTCOMES IS AS UNUSABLE AS ONE THAT DOES NOT PARSE, AND IS REPORTED THE SAME WAY
        if ( !resultsFileRecord || !Array.isArray(resultsFileRecord.methodOutcomes) ) {
            return {
                state: 'unreadableResults',
                message: `The most recent check results at "${latestResultsFilePath}" are missing the "methodOutcomes" list, so no pass/fail state could be overlaid. Re-run the picklist dependency check to replace the file.`,
                resultsFilePath: latestResultsFilePath
            };
        }

        const methodOutcomes: IPicklistDependencyResultsMethodOutcome[] = resultsFileRecord.methodOutcomes.map(
            (methodOutcomeEntry: unknown) => {

                const methodOutcome = methodOutcomeEntry as Record<string, unknown> | null;

                return {
                    methodName: typeof methodOutcome?.methodName === 'string' ? methodOutcome.methodName : 'unknown',
                    passed: methodOutcome?.passed === true,
                    message: typeof methodOutcome?.message === 'string' ? methodOutcome.message : undefined
                };

            }
        );

        return {
            state: 'loaded',
            message: '',
            resultsFilePath: latestResultsFilePath,
            results: {
                targetOrg: typeof resultsFileRecord.targetOrg === 'string' ? resultsFileRecord.targetOrg : 'unknown org',
                ranAt: typeof resultsFileRecord.ranAt === 'string' ? resultsFileRecord.ranAt : 'unknown time',
                passed: resultsFileRecord.passed === true,
                failureCount: typeof resultsFileRecord.failureCount === 'number' ? resultsFileRecord.failureCount : 0,
                methodsRun: typeof resultsFileRecord.methodsRun === 'number' ? resultsFileRecord.methodsRun : methodOutcomes.length,
                methodOutcomes: methodOutcomes
            }
        };

    }

    /*
        Matches "KIND — Object.Field" and hands back everything after it, rather than trying to split
        the remainder in the same expression.

        The kind group requires all caps, which is what keeps the generated header line -- "Picklist
        dependency drift on Account -- 3 combination(s)..." -- from matching.
    */
    private static failureLinePattern = /^\s*(?:-\s*)?([A-Z][A-Z0-9_]*)\s+(?:—|--|-)\s+([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)([\s\S]*)$/;

    /*
        A record-type scoped failure names its scope between the field and the rest of the line:
        "MISSING_VALUES — Account.Region__c [US_Only] @ United States: ...". Matched off the front of
        the tail so a field-level line, which has no such segment, is untouched.
    */
    private static recordTypeScopeTailPattern = /^\s+\[([A-Za-z0-9_]+)\]([\s\S]*)$/;

    private static scopedFailureTailPattern = /^\s+@\s+([\s\S]+)$/;

    private static fieldLevelFailureTailPattern = /^\s*:\s*([\s\S]*)$/;

    /*
        Pulls the failures out of an Apex assertion message.

        The generated test class joins SDTPicklistDependencyValidator.Failure.toLine() output, whose
        shape is "KIND — Object.Field @ ControllingValue: message". The message reaching results.json
        is that text wrapped in whatever the CLI adds around a failed assertion, so every line is
        scanned rather than the message being parsed as a whole.

        The controlling value is NOT split from the message here. A picklist value may contain ": "
        -- "Tier 1: Premium" is a legal value -- so the line alone cannot say where the boundary is,
        and guessing at the first colon silently mis-attributed the failure. The raw tail is carried
        instead and resolved against the controlling values the metadata declares.

        Both an em dash and a plain hyphen are accepted as the separator: the Apex emits an em dash,
        but a message that has been through a lossy encoding on its way out of the org should still
        attribute rather than degrading the whole object to "unknown".
    */
    static parseFailureLines(assertionMessage: string | undefined): IParsedPicklistDependencyFailure[] {

        if ( !assertionMessage ) {
            return [];
        }

        let parsedFailures: IParsedPicklistDependencyFailure[] = [];

        assertionMessage.split(/\r\n|\r|\n/).forEach(messageLine => {

            const failureLineMatch = this.failureLinePattern.exec(messageLine);
            if ( !failureLineMatch ) {
                return;
            }

            const [, failureKind, objectApiName, fieldApiName, rawFailureLineTail] = failureLineMatch;

            const recordTypeScopeMatch = this.recordTypeScopeTailPattern.exec(rawFailureLineTail);
            const recordTypeDeveloperName = recordTypeScopeMatch ? recordTypeScopeMatch[1] : undefined;
            const failureLineTail = recordTypeScopeMatch ? recordTypeScopeMatch[2] : rawFailureLineTail;

            const scopedTailMatch = this.scopedFailureTailPattern.exec(failureLineTail);

            if ( scopedTailMatch ) {

                parsedFailures.push({
                    objectApiName: objectApiName,
                    fieldApiName: fieldApiName,
                    recordTypeDeveloperName: recordTypeDeveloperName,
                    kind: failureKind,
                    controllingValueAndMessage: scopedTailMatch[1]
                });

                return;

            }

            const fieldLevelTailMatch = this.fieldLevelFailureTailPattern.exec(failureLineTail);

            // NEITHER SHAPE MEANS THE LINE IS NOT A FAILURE LINE, SO IT IS NOT COUNTED AS ONE
            if ( !fieldLevelTailMatch ) {
                return;
            }

            parsedFailures.push({
                objectApiName: objectApiName,
                fieldApiName: fieldApiName,
                recordTypeDeveloperName: recordTypeDeveloperName,
                kind: failureKind,
                fieldLevelMessage: fieldLevelTailMatch[1].trim()
            });

        });

        return parsedFailures;

    }

    /*
        Splits a scoped failure's tail against a known controlling value.

        The tail is "<controllingValue>: <message>", and the controlling value is the ground truth
        the metadata provides -- so rather than guessing where the colon falls, each candidate value
        is tested as a prefix. Returns the message when the value matches, undefined when it does
        not, which is what lets an unmatched failure be reported rather than quietly dropped.
    */
    static extractFailureMessageForControllingValue(controllingValueAndMessage: string, controllingValue: string): string | undefined {

        if ( controllingValueAndMessage === controllingValue ) {
            return '';
        }

        if ( !controllingValueAndMessage.startsWith(`${controllingValue}:`) ) {
            return undefined;
        }

        return controllingValueAndMessage.slice(controllingValue.length + 1).trim();

    }

    /*
        The ".field-meta.xml" that produced a spec. Derived from the scanned objects directory rather
        than recorded during collection, which keeps the collection service read-only -- source format
        fixes the layout as "<objects>/<Object>/fields/<Field>.field-meta.xml", so nothing is guessed.

        The api names are re-validated here even though every in-repo caller has already validated
        them upstream. This function is what the reveal allow-list is built from, so the guarantee
        that it cannot produce a path outside the objects directory belongs to it rather than to a
        caller that happens to check first.
    */
    static buildFieldSourceFilePath(objectsDirectoryPath: string, objectApiName: string, fieldApiName: string): string {

        const invalidApiName = [objectApiName, fieldApiName].find(apiName => !PicklistDependencyTestService.isValidSalesforceApiName(apiName));

        if ( invalidApiName !== undefined ) {
            throw new Error(`Cannot build a field metadata path for the api name "${invalidApiName}": a Salesforce api name is letters, numbers and underscores only.`);
        }

        return path.join(objectsDirectoryPath, objectApiName, 'fields', `${fieldApiName}.field-meta.xml`);

    }

    /*
        Every value the dependent field declares, reconstructed from the expectations.

        forbiddenValues is the complement of dependentValues within the declared set, so the union of
        both across every expectation is that declared set exactly. Reconstructing it lets the node
        carry each value once instead of once per controlling value that does not unlock it.
    */
    static buildDeclaredValuesByExpectations(specDetail: IPicklistDependencySpecDetail): string[] {

        let declaredValues: string[] = [];
        let seenValues = new Set<string>();

        specDetail.expectations.forEach(expectation => {

            const expectationValues = [...expectation.dependentValues, ...(expectation.forbiddenValues || [])];

            expectationValues.forEach(expectationValue => {

                if ( seenValues.has(expectationValue) ) {
                    return;
                }

                seenValues.add(expectationValue);
                declaredValues.push(expectationValue);

            });

        });

        return declaredValues;

    }

    static buildCombinationViewModels(specDetail: IPicklistDependencySpecDetail): IPicklistDependencyCombinationViewModel[] {

        return specDetail.expectations.map(expectation => ({
            /*
                Built by the manifest service rather than formatted here, so the key a combination
                carries is the same string the manifest recorded for it. Two builders producing
                "the same" key is precisely the kind of parallel derivation this feature removes.
            */
            combinationKey: PicklistDependencyManifestService.buildCombinationKey(
                specDetail.objectApiName,
                specDetail.fieldApiName,
                expectation.controllingValue,
                specDetail.recordTypeDeveloperName
            ),
            controllingValue: expectation.controllingValue,
            allowedValues: [...expectation.dependentValues],
            /*
                An expectation that never declared a forbidden list asserted only the positive half,
                so the panel must not render a complement it does not claim. An empty declared list
                is still an assertion -- it means this controlling value unlocks everything.
            */
            hasForbiddenAssertion: Array.isArray(expectation.forbiddenValues),
            controllingValueUnavailable: !!expectation.controllingValueUnavailable,
            status: 'unknown' as PicklistDependencyCheckStatus,
            failures: []
        }));

    }

    /*
        The forbidden values for one combination: what the field declares, minus what this
        controlling value unlocks. Held here rather than in the model so the payload carries each
        declared value once per field instead of once per controlling value.
    */
    static buildForbiddenValues(declaredValues: string[], combination: IPicklistDependencyCombinationViewModel): string[] {

        /*
            An unavailable controlling value asserts nothing about values -- the emitted Apex is a
            bare expectUnavailable line. Its empty allowed list would otherwise make the complement
            every value the scope declares, rendering a struck-through universe the spec never
            claimed and reading as the expectNone row it is deliberately not.
        */
        if ( combination.controllingValueUnavailable ) {
            return [];
        }

        if ( !combination.hasForbiddenAssertion ) {
            return [];
        }

        const allowedValues = new Set(combination.allowedValues);

        return declaredValues.filter(declaredValue => !allowedValues.has(declaredValue));

    }

    /*
        Assembles one object's dependent fields into a connected graph.

        A spec whose controlling field is itself a dependent picklist carries upstreamFieldApiName,
        so the chain is already described -- this turns those links into containment, which is what
        lets the panel draw a chain once instead of repeating the same controlling field on every
        flat row beneath it.

        visitedFieldApiNames guards the descent. A spec pair that names each other as upstream is
        not producible by the generator, but the view model is also built from hand-assembled spec
        details in tests and by any future caller, and an unguarded walk would not return.
    */
    static buildNodesByObjectSpecDetails(objectsDirectoryPath: string,
                                            objectApiName: string,
                                            objectSpecDetails: IPicklistDependencySpecDetail[],
                                            objectRecordTypeSpecDetails: IRecordTypePicklistDependencySpecDetail[] = [],
                                            generatedNames: IPicklistDependencyGeneratedNames = EMPTY_GENERATED_NAMES): IPicklistDependencyNodeViewModel[] {

        /*
            Grouped by field so a node can pick up its own scopes as it is built. Sorted by developer
            name inside the builder so the panel lists a field's record types in a stable order
            whatever order the collection returned them in.
        */
        let recordTypeSpecDetailsByFieldApiName: Record<string, IRecordTypePicklistDependencySpecDetail[]> = {};
        objectRecordTypeSpecDetails.forEach(recordTypeSpecDetail => {
            const fieldApiName = recordTypeSpecDetail.fieldApiName;
            recordTypeSpecDetailsByFieldApiName[fieldApiName] = recordTypeSpecDetailsByFieldApiName[fieldApiName] || [];
            recordTypeSpecDetailsByFieldApiName[fieldApiName].push(recordTypeSpecDetail);
        });

        let downstreamSpecDetailsByUpstreamFieldApiName: Record<string, IPicklistDependencySpecDetail[]> = {};
        const specDetailFieldApiNames = new Set(objectSpecDetails.map(specDetail => specDetail.fieldApiName));

        objectSpecDetails.forEach(specDetail => {

            /*
                An upstream field naming a spec that is not in this object's collection cannot be
                nested under anything, so the spec is treated as a root. That happens when the
                upstream field was skipped for an invalid api name or missing valueSettings.

                A field naming ITSELF is likewise treated as a root rather than nested under itself.
            */
            if ( !specDetail.upstreamFieldApiName
                    || specDetail.upstreamFieldApiName === specDetail.fieldApiName
                    || !specDetailFieldApiNames.has(specDetail.upstreamFieldApiName) ) {
                return;
            }

            const upstreamFieldApiName = specDetail.upstreamFieldApiName;
            downstreamSpecDetailsByUpstreamFieldApiName[upstreamFieldApiName] = downstreamSpecDetailsByUpstreamFieldApiName[upstreamFieldApiName] || [];
            downstreamSpecDetailsByUpstreamFieldApiName[upstreamFieldApiName].push(specDetail);

        });

        const nestedFieldApiNames = new Set(
            Object.values(downstreamSpecDetailsByUpstreamFieldApiName)
                .reduce((allDownstream: IPicklistDependencySpecDetail[], downstreamSpecDetails) => allDownstream.concat(downstreamSpecDetails), [])
                .map(specDetail => specDetail.fieldApiName)
        );

        const buildNode = (specDetail: IPicklistDependencySpecDetail,
                            visitedFieldApiNames: Set<string>): IPicklistDependencyNodeViewModel => {

            const alreadyVisitedFieldApiNames = new Set(visitedFieldApiNames);
            alreadyVisitedFieldApiNames.add(specDetail.fieldApiName);

            const downstreamSpecDetails = (downstreamSpecDetailsByUpstreamFieldApiName[specDetail.fieldApiName] || [])
                .filter(downstreamSpecDetail => !alreadyVisitedFieldApiNames.has(downstreamSpecDetail.fieldApiName));

            return {
                objectApiName: specDetail.objectApiName,
                fieldApiName: specDetail.fieldApiName,
                controllingFieldApiName: specDetail.controllingFieldApiName,
                generatedClassName: generatedNames.generatedClassName,
                specMethodName: generatedNames.specMethodNamesByFieldKey[
                    PicklistDependencyManifestService.buildFieldKey(specDetail.objectApiName, specDetail.fieldApiName)
                ] ?? '',
                sourceFilePath: this.buildFieldSourceFilePath(objectsDirectoryPath, specDetail.objectApiName, specDetail.fieldApiName),
                declaredValues: this.buildDeclaredValuesByExpectations(specDetail),
                combinations: this.buildCombinationViewModels(specDetail),
                downstreamNodes: downstreamSpecDetails.map(downstreamSpecDetail => buildNode(downstreamSpecDetail, alreadyVisitedFieldApiNames)),
                status: 'unknown',
                failureCount: 0,
                fieldLevelFailures: [],
                recordTypeScopes: this.buildRecordTypeScopeViewModels(
                    recordTypeSpecDetailsByFieldApiName[specDetail.fieldApiName] || [],
                    generatedNames
                )
            };

        };

        const rootSpecDetails = objectSpecDetails.filter(specDetail => !nestedFieldApiNames.has(specDetail.fieldApiName));
        let rootNodes = rootSpecDetails.map(specDetail => buildNode(specDetail, new Set<string>()));

        /*
            A mutual upstream cycle leaves every field in it nested under another, so none is a root
            and the whole group would vanish from the panel -- an object rendering as empty while its
            metadata plainly declares dependent picklists. Any field that no root reaches is promoted
            to a root so it is shown rather than silently dropped.
        */
        let reachedFieldApiNames = new Set<string>();
        const collectReached = (nodes: IPicklistDependencyNodeViewModel[]) => {
            nodes.forEach(node => {
                reachedFieldApiNames.add(node.fieldApiName);
                collectReached(node.downstreamNodes);
            });
        };
        collectReached(rootNodes);

        objectSpecDetails.forEach(specDetail => {

            if ( reachedFieldApiNames.has(specDetail.fieldApiName) ) {
                return;
            }

            const promotedNode = buildNode(specDetail, new Set<string>([specDetail.fieldApiName]));
            rootNodes.push(promotedNode);

            /*
                The promoted node brings its whole subtree with it, so every field in that subtree
                is now shown. Marking only the promoted field would promote the rest of the cycle a
                second time, rendering each member once per member.
            */
            collectReached([promotedNode]);

        });

        return rootNodes;

    }

    /*
        One scope per record type that narrows this field. declaredValues is taken from the scoped
        expectations rather than from the field, so the panel's forbidden complement is drawn against
        what the RECORD TYPE assigns -- a value it does not expose is already unreachable through it,
        and showing it struck through would claim the spec asserts something it does not.

        Status stays "unknown" rather than inheriting the field's. Nothing shipped with the framework
        can verify a scoped combination, so a green field-level run says nothing about these.
    */
    static buildRecordTypeScopeViewModels(recordTypeSpecDetails: IRecordTypePicklistDependencySpecDetail[],
                                            generatedNames: IPicklistDependencyGeneratedNames = EMPTY_GENERATED_NAMES): IPicklistDependencyRecordTypeScopeViewModel[] {

        return [...recordTypeSpecDetails]
            .sort((firstSpecDetail, secondSpecDetail) => firstSpecDetail.recordTypeDeveloperName.localeCompare(secondSpecDetail.recordTypeDeveloperName))
            .map(recordTypeSpecDetail => ({
                recordTypeDeveloperName: recordTypeSpecDetail.recordTypeDeveloperName,
                specMethodName: generatedNames.specMethodNamesByFieldKey[
                    PicklistDependencyManifestService.buildFieldKey(
                        recordTypeSpecDetail.objectApiName,
                        recordTypeSpecDetail.fieldApiName,
                        recordTypeSpecDetail.recordTypeDeveloperName
                    )
                ] ?? '',
                declaredValues: this.buildDeclaredValuesByExpectations(recordTypeSpecDetail),
                combinations: this.buildCombinationViewModels(recordTypeSpecDetail),
                status: 'unknown' as PicklistDependencyCheckStatus,
                failureCount: 0
            }));

    }

    static countRecordTypeCombinations(nodes: IPicklistDependencyNodeViewModel[]): number {

        return nodes.reduce((combinationCount, node) => {

            const scopedCombinationCount = node.recordTypeScopes.reduce(
                (scopeCombinationCount, recordTypeScope) => scopeCombinationCount + recordTypeScope.combinations.length,
                0
            );

            return combinationCount + scopedCombinationCount + this.countRecordTypeCombinations(node.downstreamNodes);

        }, 0);

    }

    static countNodes(nodes: IPicklistDependencyNodeViewModel[]): number {
        return nodes.reduce((nodeCount, node) => nodeCount + 1 + this.countNodes(node.downstreamNodes), 0);
    }

    static countCombinations(nodes: IPicklistDependencyNodeViewModel[]): number {
        return nodes.reduce((combinationCount, node) => combinationCount + node.combinations.length + this.countCombinations(node.downstreamNodes), 0);
    }

    static flattenNodes(nodes: IPicklistDependencyNodeViewModel[]): IPicklistDependencyNodeViewModel[] {

        let flattenedNodes: IPicklistDependencyNodeViewModel[] = [];

        const visitNode = (node: IPicklistDependencyNodeViewModel) => {
            flattenedNodes.push(node);
            node.downstreamNodes.forEach(visitNode);
        };

        nodes.forEach(visitNode);

        return flattenedNodes;

    }

    /*
        Applies one object's parsed failures down its graph, and reports which of them found nowhere
        to land.

        A failure naming a controlling value marks that combination; one without names the field as a
        whole (LOOKUP_ERROR, CONTROLLING_FIELD_MISMATCH, UPSTREAM_FAILURE, CIRCULAR_DEPENDENCY all
        arrive that way). A failure naming a field or combination this metadata no longer describes
        can be applied to nothing, and is RETURNED rather than discarded -- discarding it was what
        let a drifted combination render green while its Apex message disappeared.

        Every failure matching a combination is kept, not just the first: the validator raises
        MISSING_VALUES and FORBIDDEN_VALUES_PRESENT independently for the same controlling value, and
        showing one of the two hides a real drift fact.
    */
    static applyFailuresToNodes(nodes: IPicklistDependencyNodeViewModel[],
                                    parsedFailures: IParsedPicklistDependencyFailure[],
                                    objectRan: boolean): IParsedPicklistDependencyFailure[] {

        const allNodes = this.flattenNodes(nodes);
        let appliedFailures = new Set<IParsedPicklistDependencyFailure>();

        allNodes.forEach(node => {

            const failuresForAnyScopeOfField = parsedFailures.filter(
                parsedFailure => parsedFailure.objectApiName === node.objectApiName && parsedFailure.fieldApiName === node.fieldApiName
            );

            /*
                A failure naming a record type belongs to that scope, not to the field-level rows. Left
                in this list it would attribute to the field-level combination with the same
                controlling value and read as drift in a spec the run never evaluated.
            */
            const failuresForField = failuresForAnyScopeOfField.filter(parsedFailure => parsedFailure.recordTypeDeveloperName === undefined);

            let nodeFailureCount = 0;

            node.combinations.forEach(combination => {

                let combinationFailures: IPicklistDependencyFailureDetailViewModel[] = [];

                failuresForField.forEach(parsedFailure => {

                    if ( parsedFailure.controllingValueAndMessage === undefined ) {
                        return;
                    }

                    const failureMessage = this.extractFailureMessageForControllingValue(
                        parsedFailure.controllingValueAndMessage,
                        combination.controllingValue
                    );

                    if ( failureMessage === undefined ) {
                        return;
                    }

                    combinationFailures.push({ kind: parsedFailure.kind, message: failureMessage });
                    appliedFailures.add(parsedFailure);

                });

                combination.failures = combinationFailures;

                if ( combinationFailures.length > 0 ) {
                    combination.status = 'failed';
                    nodeFailureCount += combinationFailures.length;
                    return;
                }

                combination.status = objectRan ? 'passed' : 'unknown';

            });

            const fieldLevelFailures = failuresForField.filter(parsedFailure => parsedFailure.fieldLevelMessage !== undefined);

            node.fieldLevelFailures = fieldLevelFailures.map(parsedFailure => {
                appliedFailures.add(parsedFailure);
                return { kind: parsedFailure.kind, message: parsedFailure.fieldLevelMessage };
            });

            nodeFailureCount += node.fieldLevelFailures.length;

            /*
                Grouped once per node rather than re-scanned per scope. A field carrying many record
                types and an object reporting many failures multiply otherwise, and this runs twice
                per object -- once for the dry run that asks whether every failure can be placed.
            */
            let failuresByRecordTypeDeveloperName: Record<string, IParsedPicklistDependencyFailure[]> = {};
            failuresForAnyScopeOfField.forEach(parsedFailure => {

                if ( parsedFailure.recordTypeDeveloperName === undefined ) {
                    return;
                }

                const recordTypeDeveloperName = parsedFailure.recordTypeDeveloperName;
                failuresByRecordTypeDeveloperName[recordTypeDeveloperName] = failuresByRecordTypeDeveloperName[recordTypeDeveloperName] || [];
                failuresByRecordTypeDeveloperName[recordTypeDeveloperName].push(parsedFailure);

            });

            node.recordTypeScopes.forEach(recordTypeScope => {

                const failuresForScope = failuresByRecordTypeDeveloperName[recordTypeScope.recordTypeDeveloperName] || [];

                let scopeFailureCount = 0;

                recordTypeScope.combinations.forEach(combination => {

                    let combinationFailures: IPicklistDependencyFailureDetailViewModel[] = [];

                    failuresForScope.forEach(parsedFailure => {

                        if ( parsedFailure.controllingValueAndMessage === undefined ) {
                            return;
                        }

                        const failureMessage = this.extractFailureMessageForControllingValue(
                            parsedFailure.controllingValueAndMessage,
                            combination.controllingValue
                        );

                        if ( failureMessage === undefined ) {
                            return;
                        }

                        combinationFailures.push({ kind: parsedFailure.kind, message: failureMessage });
                        appliedFailures.add(parsedFailure);

                    });

                    combination.failures = combinationFailures;

                    /*
                        A scoped combination that was not named goes to "unknown" rather than
                        "passed" even when the object ran. The run validates SDTPLDSpecs.all(), which
                        holds the field-level specs only -- calling these passed would report a scope
                        nothing checked as verified.
                    */
                    combination.status = combinationFailures.length > 0 ? 'failed' : 'unknown';
                    scopeFailureCount += combinationFailures.length;

                });

                recordTypeScope.failureCount = scopeFailureCount;
                recordTypeScope.status = scopeFailureCount > 0 ? 'failed' : 'unknown';
                nodeFailureCount += scopeFailureCount;

            });

            node.failureCount = nodeFailureCount;

            if ( nodeFailureCount > 0 ) {
                node.status = 'failed';
            } else if ( objectRan ) {
                node.status = 'passed';
            } else {
                node.status = 'unknown';
            }

        });

        return parsedFailures.filter(parsedFailure => !appliedFailures.has(parsedFailure));

    }

    static buildUnattributedFailureMessage(parsedFailure: IParsedPicklistDependencyFailure): string {

        const recordTypeScope = parsedFailure.recordTypeDeveloperName ? ` [${parsedFailure.recordTypeDeveloperName}]` : '';
        const failureScope = `${parsedFailure.objectApiName}.${parsedFailure.fieldApiName}${recordTypeScope}`;
        const failureDetail = parsedFailure.controllingValueAndMessage ?? parsedFailure.fieldLevelMessage ?? '';

        return `${parsedFailure.kind} — ${failureScope}${parsedFailure.controllingValueAndMessage !== undefined ? ' @ ' : ': '}${failureDetail}`;

    }

    static groupSpecDetailsByObjectApiName(specDetails: IPicklistDependencySpecDetail[]): Record<string, IPicklistDependencySpecDetail[]> {

        let specDetailsByObjectApiName: Record<string, IPicklistDependencySpecDetail[]> = {};

        specDetails.forEach(specDetail => {
            specDetailsByObjectApiName[specDetail.objectApiName] = specDetailsByObjectApiName[specDetail.objectApiName] || [];
            specDetailsByObjectApiName[specDetail.objectApiName].push(specDetail);
        });

        return specDetailsByObjectApiName;

    }

    /*
        The whole view model: dependency structure from local source metadata, with the most recent
        check overlaid onto it when one exists.

        An object whose test method failed but whose failures cannot ALL be tied to a combination
        keeps every combination at "unknown" and surfaces the unattributable text instead. Marking
        them all failed would overstate a drift that touched one combination, and marking them
        passed would report green for a combination the org may well have broken -- neither is a
        claim the loaded artifact supports. Attribution is therefore decided BEFORE the statuses are
        assigned: a failure that lands nowhere has to be able to hold the whole object back.
    */
    static buildExplorerViewModel(objectsDirectoryPath: string,
                                    specDetails: IPicklistDependencySpecDetail[],
                                    skippedFieldWarnings: string[],
                                    resultsLoad: IPicklistDependencyResultsLoad,
                                    recordTypeSpecDetails: IRecordTypePicklistDependencySpecDetail[] = [],
                                    explorerContext: IPicklistDependencyExplorerContext = this.buildMetadataPreviewContext()): IPicklistDependencyExplorerViewModel {

        const distinctObjectApiNames = PicklistDependencyTestService.getDistinctObjectApiNames(specDetails);
        const testMethodNamesByObjectApiName = PicklistDependencyTestService.buildTestMethodNamesByObjectApiName(distinctObjectApiNames);
        const specDetailsByObjectApiName = this.groupSpecDetailsByObjectApiName(specDetails);

        /*
            Grouped with the same helper as the field-level details. A scoped detail is always derived
            from a field-level one, so every group here has an object above it -- an entry for an
            object with no field-level specs would simply never be read, rather than misplacing a row.
        */
        const recordTypeSpecDetailsByObjectApiName = this.groupSpecDetailsByObjectApiName(recordTypeSpecDetails) as Record<string, IRecordTypePicklistDependencySpecDetail[]>;

        const skippedFieldViewModelsByObjectApiName = this.groupSkippedFieldViewModelsByObjectApiName(explorerContext.skippedFields);

        let methodOutcomesByMethodName: Record<string, IPicklistDependencyResultsMethodOutcome> = {};
        ( resultsLoad.results?.methodOutcomes || [] ).forEach(methodOutcome => {
            methodOutcomesByMethodName[methodOutcome.methodName] = methodOutcome;
        });

        const objects: IPicklistDependencyObjectViewModel[] = distinctObjectApiNames.map(objectApiName => {

            const objectSpecDetails = specDetailsByObjectApiName[objectApiName] || [];
            const objectRecordTypeSpecDetails = recordTypeSpecDetailsByObjectApiName[objectApiName] || [];
            const generatedNames = explorerContext.generatedNamesByObjectApiName[objectApiName] ?? EMPTY_GENERATED_NAMES;

            const rootNodes = this.buildNodesByObjectSpecDetails(
                objectsDirectoryPath,
                objectApiName,
                objectSpecDetails,
                objectRecordTypeSpecDetails,
                generatedNames
            );

            const testMethodName = testMethodNamesByObjectApiName[objectApiName];
            const methodOutcome = methodOutcomesByMethodName[testMethodName];

            const parsedFailures = methodOutcome && !methodOutcome.passed
                ? this.parseFailureLines(methodOutcome.message)
                : [];

            /*
                A dry run first, purely to learn whether every failure can be placed. Its status
                assignments are discarded by the second pass below -- what it is being asked is
                "does anything land nowhere", which cannot be known without attempting the match.
            */
            const unattributedFailures = this.applyFailuresToNodes(rootNodes, parsedFailures, true);

            const failureIsUnattributable = !!( methodOutcome && !methodOutcome.passed
                                                    && ( parsedFailures.length === 0 || unattributedFailures.length > 0 ) );

            const objectRan = !!methodOutcome && !failureIsUnattributable;

            this.applyFailuresToNodes(rootNodes, parsedFailures, objectRan);

            const attributedFailureCount = this.flattenNodes(rootNodes)
                .reduce((failureCount, node) => failureCount + node.failureCount, 0);

            let objectStatus: PicklistDependencyCheckStatus = 'unknown';
            if ( methodOutcome ) {
                objectStatus = methodOutcome.passed ? 'passed' : 'failed';
            }

            let unattributedFailureMessages: string[] = [];
            if ( failureIsUnattributable ) {

                unattributedFailureMessages = unattributedFailures.length > 0
                    ? unattributedFailures.map(unattributedFailure => this.buildUnattributedFailureMessage(unattributedFailure))
                    : [methodOutcome.message ?? ''];

            }

            return {
                objectApiName: objectApiName,
                rootNodes: rootNodes,
                dependentFieldCount: this.countNodes(rootNodes),
                combinationCount: this.countCombinations(rootNodes),
                recordTypeCombinationCount: this.countRecordTypeCombinations(rootNodes),
                status: objectStatus,
                failureCount: attributedFailureCount,
                testMethodName: testMethodName,
                generatedClassName: generatedNames.generatedClassName,
                generatedClassFilePath: explorerContext.generatedClassFilePathsByObjectApiName[objectApiName] ?? '',
                skippedFields: skippedFieldViewModelsByObjectApiName[objectApiName] ?? [],
                unattributedFailureMessages: unattributedFailureMessages
            };

        });

        /*
            An object that produced NO specs at all but did produce a skip is still an object the
            reader needs to see -- it is precisely the case where the panel would otherwise render
            nothing and imply the object has no dependent picklists.
        */
        const objectApiNamesWithSkipsOnly = Object.keys(skippedFieldViewModelsByObjectApiName)
            .filter(objectApiName => !distinctObjectApiNames.includes(objectApiName))
            .sort();

        const skipOnlyObjects: IPicklistDependencyObjectViewModel[] = objectApiNamesWithSkipsOnly.map(objectApiName => ({
            objectApiName: objectApiName,
            rootNodes: [],
            dependentFieldCount: 0,
            combinationCount: 0,
            recordTypeCombinationCount: 0,
            status: 'unknown' as PicklistDependencyCheckStatus,
            failureCount: 0,
            testMethodName: '',
            generatedClassName: '',
            generatedClassFilePath: '',
            skippedFields: skippedFieldViewModelsByObjectApiName[objectApiName],
            unattributedFailureMessages: []
        }));

        const allObjects = objects.concat(skipOnlyObjects);

        const runSummary: IPicklistDependencyRunSummary | undefined = ( resultsLoad.state === 'loaded' && resultsLoad.results )
            ? {
                targetOrg: resultsLoad.results.targetOrg,
                ranAt: resultsLoad.results.ranAt,
                passed: resultsLoad.results.passed,
                failureCount: resultsLoad.results.failureCount,
                methodsRun: resultsLoad.results.methodsRun,
                resultsFilePath: resultsLoad.resultsFilePath ?? ''
            }
            : undefined;

        return {
            scannedObjectsDirectoryPath: objectsDirectoryPath,
            objects: allObjects,
            dependentFieldCount: allObjects.reduce((fieldCount, objectViewModel) => fieldCount + objectViewModel.dependentFieldCount, 0),
            combinationCount: allObjects.reduce((combinationCount, objectViewModel) => combinationCount + objectViewModel.combinationCount, 0),
            recordTypeCombinationCount: allObjects.reduce(
                (recordTypeCombinationCount, objectViewModel) => recordTypeCombinationCount + objectViewModel.recordTypeCombinationCount,
                0
            ),
            runLoadState: resultsLoad.state,
            runSummary: runSummary,
            runLoadMessage: resultsLoad.message,
            skippedFieldWarnings: [...skippedFieldWarnings],
            modelSource: explorerContext.modelSource,
            manifestLoadState: explorerContext.manifestLoadState,
            manifestLoadMessage: explorerContext.manifestLoadMessage,
            manifestFreshness: explorerContext.manifestFreshness,
            manifestFreshnessMessage: explorerContext.manifestFreshnessMessage,
            manifestFilePath: explorerContext.manifestFilePath,
            generatedAt: explorerContext.generatedAt,
            generatorVersion: explorerContext.generatorVersion,
            aggregatorClassName: explorerContext.aggregatorClassName,
            specsTestClassName: explorerContext.specsTestClassName,
            classesDirectoryPath: explorerContext.classesDirectoryPath
        };

    }

    /*
        The context for a model built WITHOUT a manifest.

        Every generated name is empty and the source is "metadataPreview", which is the truthful
        description of that model: the structure is real, and nothing whatsoever asserts it.
    */
    static buildMetadataPreviewContext(manifestLoad?: IPicklistDependencyManifestLoad): IPicklistDependencyExplorerContext {

        return {
            modelSource: 'metadataPreview',
            manifestLoadState: manifestLoad?.state ?? 'noManifestFound',
            manifestLoadMessage: manifestLoad?.message ?? '',
            manifestFreshness: 'fresh',
            manifestFreshnessMessage: '',
            manifestFilePath: manifestLoad?.manifestFilePath ?? '',
            generatedAt: '',
            generatorVersion: '',
            aggregatorClassName: '',
            specsTestClassName: '',
            classesDirectoryPath: '',
            generatedNamesByObjectApiName: {},
            generatedClassFilePathsByObjectApiName: {},
            skippedFields: []
        };

    }

    static buildContextByManifest(manifest: IPicklistDependencyManifest,
                                    manifestLoad: IPicklistDependencyManifestLoad,
                                    freshnessResult: IPicklistDependencyManifestFreshnessResult): IPicklistDependencyExplorerContext {

        let generatedNamesByObjectApiName: Record<string, IPicklistDependencyGeneratedNames> = {};
        let generatedClassFilePathsByObjectApiName: Record<string, string> = {};

        manifest.objects.forEach(manifestObject => {

            let specMethodNamesByFieldKey: Record<string, string> = {};

            manifestObject.fields.forEach(manifestField => {
                const fieldKey = PicklistDependencyManifestService.buildFieldKey(manifestObject.objectApiName, manifestField.fieldApiName);
                specMethodNamesByFieldKey[fieldKey] = manifestField.specMethodName;
            });

            manifestObject.recordTypeScopedFields.forEach(manifestRecordTypeScopedField => {
                const fieldKey = PicklistDependencyManifestService.buildFieldKey(
                    manifestObject.objectApiName,
                    manifestRecordTypeScopedField.fieldApiName,
                    manifestRecordTypeScopedField.recordTypeDeveloperName
                );
                specMethodNamesByFieldKey[fieldKey] = manifestRecordTypeScopedField.specMethodName;
            });

            generatedNamesByObjectApiName[manifestObject.objectApiName] = {
                generatedClassName: manifestObject.generatedClassName,
                specMethodNamesByFieldKey: specMethodNamesByFieldKey
            };

            generatedClassFilePathsByObjectApiName[manifestObject.objectApiName] = manifestObject.generatedClassFilePath;

        });

        return {
            modelSource: 'manifest',
            manifestLoadState: manifestLoad.state,
            manifestLoadMessage: manifestLoad.message,
            manifestFreshness: freshnessResult.freshness,
            manifestFreshnessMessage: freshnessResult.message,
            manifestFilePath: manifestLoad.manifestFilePath ?? '',
            generatedAt: manifest.generatedAt,
            generatorVersion: manifest.generatorVersion,
            aggregatorClassName: manifest.aggregatorClassName,
            specsTestClassName: manifest.specsTestClassName,
            classesDirectoryPath: manifest.classesDirectoryPath,
            generatedNamesByObjectApiName: generatedNamesByObjectApiName,
            generatedClassFilePathsByObjectApiName: generatedClassFilePathsByObjectApiName,
            skippedFields: manifest.skippedFields
        };

    }

    static groupSkippedFieldViewModelsByObjectApiName(skippedFields: IPicklistDependencySkippedField[]): Record<string, IPicklistDependencySkippedFieldViewModel[]> {

        let skippedFieldViewModelsByObjectApiName: Record<string, IPicklistDependencySkippedFieldViewModel[]> = {};

        skippedFields.forEach(skippedField => {

            const objectApiName = skippedField.objectApiName;
            skippedFieldViewModelsByObjectApiName[objectApiName] = skippedFieldViewModelsByObjectApiName[objectApiName] || [];

            skippedFieldViewModelsByObjectApiName[objectApiName].push({
                /*
                    Empty rather than a placeholder where the skip is about a record type file
                    rather than one field. The panel renders the record type name in that case, and
                    inventing a field name here would put a field on screen that does not exist.
                */
                fieldApiName: skippedField.fieldApiName ?? '',
                recordTypeDeveloperName: skippedField.recordTypeDeveloperName ?? '',
                warning: skippedField.warning
            });

        });

        return skippedFieldViewModelsByObjectApiName;

    }

    /*
        The whole view model, sourced from the spec manifest rather than from a fresh walk of the
        source metadata.

        This is the path the panel takes whenever a manifest exists, and it is what makes the
        panel's promise true: every row here was emitted into the generated Apex by the same run
        that wrote this manifest, so a node on screen always corresponds to a spec method that
        exists. The structure builder underneath is the same one the preview path uses -- the
        manifest carries the model, not a rendering of it, so there is no second implementation of
        the graph logic to drift.
    */
    static buildExplorerViewModelByManifest(manifestLoad: IPicklistDependencyManifestLoad,
                                                objectsDirectoryPath: string,
                                                resultsLoad: IPicklistDependencyResultsLoad,
                                                freshnessResult: IPicklistDependencyManifestFreshnessResult): IPicklistDependencyExplorerViewModel {

        const manifest = manifestLoad.manifest;

        if ( !manifest ) {
            throw new Error('A picklist dependency explorer view model cannot be built from a manifest load that carries no manifest.');
        }

        const manifestSpecDetails = PicklistDependencyManifestService.buildSpecDetailsByManifest(manifest);
        const explorerContext = this.buildContextByManifest(manifest, manifestLoad, freshnessResult);

        return this.buildExplorerViewModel(
            /*
                The directory the manifest was RECORDED against, not the one configured now. The two
                differing is what the staleness banner reports, and rendering paths from the current
                configuration under specs generated from another directory would produce reveal
                targets that do not correspond to the specs on screen.
            */
            manifest.objectsDirectoryPath || objectsDirectoryPath,
            manifestSpecDetails.specDetails,
            manifest.skippedFieldWarnings,
            resultsLoad,
            manifestSpecDetails.recordTypeSpecDetails,
            explorerContext
        );

    }

    /*
        Every ".field-meta.xml" the model can ask the extension host to reveal. The webview is the
        one part of this feature that renders untrusted-by-construction content, so the reveal
        handler matches the requested path against this set rather than trusting the path posted
        back to it -- a panel that could open any path on disk would be a hole regardless of how
        the message got there.
    */
    static collectSourceFilePaths(viewModel: IPicklistDependencyExplorerViewModel): string[] {

        let sourceFilePaths: string[] = [];

        viewModel.objects.forEach(objectViewModel => {
            this.flattenNodes(objectViewModel.rootNodes).forEach(node => sourceFilePaths.push(node.sourceFilePath));
        });

        return sourceFilePaths;

    }

    /*
        Escaped for HTML text and attribute contexts alike. Picklist values, api names and Apex
        failure messages all reach the panel unmodified from metadata an admin controls, so none of
        it is interpolated raw. The JSON payload takes the same treatment below.
    */
    static escapeHtml(value: string): string {

        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

    }

    /*
        Neutralises the characters that can end a <script> block early, for any JSON literal being
        placed inside one. The escapes are JSON's own, so the text still parses to the identical
        value -- a picklist value of "</script>" reads back as "</script>" and simply cannot close
        the element it is sitting in on the way there.
    */
    static escapeJsonForScriptBlock(jsonText: string): string {

        return jsonText
            .replace(/</g, '\\u003c')
            .replace(/>/g, '\\u003e')
            .replace(/&/g, '\\u0026');

    }

    /*
        The model is handed to the panel script as JSON inside a <script type="application/json">
        block rather than as a JS literal, so nothing in it is ever evaluated -- and it is escaped
        above so it cannot close that block either.
    */
    static buildEmbeddedModelJson(viewModel: IPicklistDependencyExplorerViewModel): string {

        return this.escapeJsonForScriptBlock(JSON.stringify(viewModel));

    }

    /*
        form-action and base-uri are named explicitly because neither falls back to default-src.
        Everything else the panel could fetch -- img, connect, font, media, frame, worker -- does
        fall back, and so is already denied by default-src 'none'.
    */
    static buildContentSecurityPolicy(nonce: string): string {

        return `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; form-action 'none'; base-uri 'none';`;

    }

    /*
        From the crypto RNG rather than Math.random. The nonce is what lets the CSP deny every
        script but this extension's own, so it should not depend on there being no injection
        primitive to spend a predicted value on -- that is the property the CSP exists to provide
        independently.
    */
    static buildNonce(): string {

        /*
            48 bytes rather than 24: base64 yields "+", "/" and "=" which are stripped so the value
            is safe unquoted in the CSP header, and 24 bytes can fall short of 32 characters once
            they are removed.
        */
        return crypto.randomBytes(48).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 32);

    }

    static buildEmptyStateMessage(viewModel: IPicklistDependencyExplorerViewModel): string {

        /*
            An empty panel has two quite different causes, and telling them apart is the difference
            between "you have nothing to check" and "you have not generated yet". The manifest state
            is what separates them, so the message is keyed off it rather than off the empty list.
        */
        if ( viewModel.modelSource === 'metadataPreview' && viewModel.manifestLoadState !== 'loaded' ) {
            return `${viewModel.manifestLoadMessage} No dependent picklists were found in "${viewModel.scannedObjectsDirectoryPath}" either, so there would be nothing to generate. A picklist becomes generatable once its field metadata declares a "controllingField" and the "valueSettings" markup that maps controlling values to dependent values.`;
        }

        if ( viewModel.modelSource === 'manifest' ) {
            return `The picklist dependency spec manifest at "${viewModel.manifestFilePath}" declares no generated specs. Re-run "Salesforce Treecipe: Generate Picklist Dependency Tests" against a metadata directory that declares dependent picklists.`;
        }

        return `No dependent picklists were found in "${viewModel.scannedObjectsDirectoryPath}". A picklist appears here once its field metadata declares a "controllingField" and the "valueSettings" markup that maps controlling values to dependent values.`;

    }

    /*
        The shell only. Every colour is a VS Code theme variable, so the panel follows the active
        light, dark or high contrast theme without the extension having to know which is active, and
        the structure itself is rendered by the inline script from the embedded model.
    */
    static buildWebviewHtml(viewModel: IPicklistDependencyExplorerViewModel, nonce: string): string {

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${this.buildContentSecurityPolicy(nonce)}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Picklist Dependency Explorer</title>
<style nonce="${nonce}">
    body {
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--vscode-foreground);
        background-color: var(--vscode-editor-background);
        padding: 0 1rem 2rem 1rem;
    }
    h1 { font-size: 1.3rem; margin-bottom: 0.25rem; }
    .runBanner {
        border: 1px solid var(--vscode-panel-border);
        border-left-width: 4px;
        padding: 0.6rem 0.8rem;
        margin: 0.75rem 0 1rem 0;
    }
    .runBanner.passed { border-left-color: var(--vscode-testing-iconPassed); }
    .runBanner.failed { border-left-color: var(--vscode-testing-iconFailed); }
    .runBanner.unknown { border-left-color: var(--vscode-testing-iconQueued); }
    .muted { color: var(--vscode-descriptionForeground); }
    .objectSection { margin-bottom: 1.5rem; }
    .objectHeading { font-size: 1.05rem; font-weight: 600; margin-bottom: 0.25rem; }
    /* THE LEFT RULE AND ELBOW ARE WHAT DRAW A CHAIN AS ONE CONNECTED GRAPH RATHER THAN REPEATED ROWS */
    .nodeChildren {
        margin-left: 0.9rem;
        padding-left: 1rem;
        border-left: 1px solid var(--vscode-panel-border);
    }
    .node { margin: 0.5rem 0; }
    .nodeHeading {
        display: flex;
        align-items: baseline;
        gap: 0.5rem;
        flex-wrap: wrap;
    }
    .nodeChildren > .node > .nodeHeading::before {
        content: "\\21b3";
        color: var(--vscode-descriptionForeground);
        margin-right: 0.25rem;
    }
    .fieldName { font-weight: 600; }
    .combination {
        border: 1px solid var(--vscode-panel-border);
        border-left-width: 3px;
        padding: 0.4rem 0.6rem;
        margin: 0.3rem 0 0.3rem 1rem;
        cursor: pointer;
    }
    .combination:hover { background-color: var(--vscode-list-hoverBackground); }
    .combination.passed { border-left-color: var(--vscode-testing-iconPassed); }
    .combination.failed { border-left-color: var(--vscode-testing-iconFailed); }
    .combination.unknown { border-left-color: var(--vscode-testing-iconQueued); }
    .statusBadge {
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        border: 1px solid var(--vscode-panel-border);
        padding: 0 0.35rem;
    }
    .statusBadge.passed { color: var(--vscode-testing-iconPassed); }
    .statusBadge.failed { color: var(--vscode-testing-iconFailed); }
    .statusBadge.unknown { color: var(--vscode-descriptionForeground); }
    .valueList { margin: 0.2rem 0; }
    .valueLabel { color: var(--vscode-descriptionForeground); margin-right: 0.35rem; }
    .value {
        display: inline-block;
        border: 1px solid var(--vscode-panel-border);
        padding: 0 0.3rem;
        margin: 0.1rem 0.2rem 0.1rem 0;
    }
    .value.forbidden { text-decoration: line-through; color: var(--vscode-descriptionForeground); }
    .recordTypeScopes { margin: 0.4rem 0 0.2rem 1rem; }
    .recordTypeScope {
        border: 1px dashed var(--vscode-panel-border);
        padding: 0.35rem 0.5rem;
        margin: 0.3rem 0;
    }
    .recordTypeScopeHeading {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
        cursor: pointer;
    }
    .recordTypeName { font-weight: 600; }
    .combination.unavailable { border-left-style: dashed; }
    .scopeNote { font-size: 0.85rem; color: var(--vscode-descriptionForeground); margin: 0.2rem 0 0.3rem 0; }
    .failureDetail {
        margin-top: 0.35rem;
        padding: 0.35rem 0.5rem;
        background-color: var(--vscode-textCodeBlock-background);
        white-space: pre-wrap;
        font-family: var(--vscode-editor-font-family);
        font-size: 0.85em;
    }
    .sourceDetail { margin-top: 0.4rem; }
    .sourcePath {
        font-family: var(--vscode-editor-font-family);
        font-size: 0.85em;
        color: var(--vscode-descriptionForeground);
        word-break: break-all;
    }
    button {
        color: var(--vscode-button-foreground);
        background-color: var(--vscode-button-background);
        border: none;
        padding: 0.25rem 0.6rem;
        margin-top: 0.3rem;
        cursor: pointer;
        font-family: inherit;
        font-size: 0.85em;
    }
    button:hover { background-color: var(--vscode-button-hoverBackground); }
    .warningList { border-left: 3px solid var(--vscode-testing-iconQueued); padding-left: 0.75rem; }
    .emptyState { padding: 1rem; border: 1px dashed var(--vscode-panel-border); }
    .specOrigin { font-family: var(--vscode-editor-font-family); font-size: 0.8rem; color: var(--vscode-descriptionForeground); margin: 0.1rem 0 0.3rem 0; }
    .provenanceBanner { padding: 0.6rem 0.75rem; margin-bottom: 0.6rem; border-left: 3px solid var(--vscode-panel-border); }
    .provenanceBanner.stale { border-left-color: var(--vscode-testing-iconQueued); }
    .provenanceBanner.preview { border-left-color: var(--vscode-testing-iconQueued); }
    .skippedField { border-left: 3px solid var(--vscode-testing-iconQueued); padding-left: 0.75rem; margin: 0.35rem 0; }
    .skippedBadge { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-testing-iconQueued); margin-left: 0.5rem; }
    .hidden { display: none; }
</style>
</head>
<body>
<h1>Picklist Dependency Explorer</h1>
<div class="muted">Scanned <span class="sourcePath">${this.escapeHtml(viewModel.scannedObjectsDirectoryPath)}</span></div>
<div id="explorerRoot"></div>
<script id="explorerModel" type="application/json" nonce="${nonce}">${this.buildEmbeddedModelJson(viewModel)}</script>
<script nonce="${nonce}">
(function () {

    const vscodeApi = acquireVsCodeApi();
    const explorerModel = JSON.parse(document.getElementById('explorerModel').textContent);
    const explorerRoot = document.getElementById('explorerRoot');

    function createElement(tagName, className, textContent) {
        const element = document.createElement(tagName);
        if (className) { element.className = className; }
        if (textContent !== undefined) { element.textContent = textContent; }
        return element;
    }

    function appendStatusBadge(parentElement, status) {
        parentElement.appendChild(createElement('span', 'statusBadge ' + status, status === 'unknown' ? 'not checked' : status));
    }

    function appendValueList(parentElement, labelText, values, valueClassName) {

        if (!values.length) { return; }

        const valueListElement = createElement('div', 'valueList');
        valueListElement.appendChild(createElement('span', 'valueLabel', labelText));
        values.forEach(function (value) {
            valueListElement.appendChild(createElement('span', valueClassName, value));
        });
        parentElement.appendChild(valueListElement);

    }

    /*
        Derived here rather than carried in the model. Sending the complement per controlling value
        made the payload the product of the two picklists' sizes; the declared list plus each
        allowed list is their sum, and yields exactly the same rendering.
    */
    function buildForbiddenValues(declaredValues, combination) {

        // AN UNAVAILABLE CONTROLLING VALUE ASSERTS NOTHING ABOUT VALUES -- SEE THE SERVICE'S buildForbiddenValues
        if (combination.controllingValueUnavailable) { return []; }

        if (!combination.hasForbiddenAssertion) { return []; }

        const allowedValues = new Set(combination.allowedValues);
        return declaredValues.filter(function (declaredValue) { return !allowedValues.has(declaredValue); });

    }

    function appendFailureDetails(parentElement, failures) {
        failures.forEach(function (failure) {
            parentElement.appendChild(createElement('div', 'failureDetail', failure.kind + '\\n' + failure.message));
        });
    }

    function buildCombinationElement(node, combination, declaredValues) {

        const unavailableClass = combination.controllingValueUnavailable ? ' unavailable' : '';
        const combinationElement = createElement('div', 'combination ' + combination.status + unavailableClass);

        const combinationHeading = createElement('div');
        combinationHeading.appendChild(createElement('span', 'fieldName', node.controllingFieldApiName + ' = ' + combination.controllingValue));
        appendStatusBadge(combinationHeading, combination.status);
        combinationElement.appendChild(combinationHeading);

        if (combination.controllingValueUnavailable) {
            /*
                Not the same statement as "unlocks nothing". This controlling value is not selectable
                at all under this scope, which is what expectUnavailable asserts -- rendering it as an
                empty unlock list would read as a value that exists and offers nothing.
            */
            combinationElement.appendChild(createElement('div', 'valueList muted', 'not available under this record type'));
        } else if (combination.allowedValues.length) {
            appendValueList(combinationElement, 'unlocks', combination.allowedValues, 'value');
        } else {
            combinationElement.appendChild(createElement('div', 'valueList muted', 'unlocks nothing'));
        }

        appendValueList(combinationElement, 'must not unlock', buildForbiddenValues(declaredValues, combination), 'value forbidden');
        appendFailureDetails(combinationElement, combination.failures);

        const sourceDetailElement = createElement('div', 'sourceDetail hidden');
        sourceDetailElement.appendChild(createElement('div', 'sourcePath', node.sourceFilePath));

        const revealButton = createElement('button', undefined, 'Reveal in Explorer');
        revealButton.addEventListener('click', function (clickEvent) {
            clickEvent.stopPropagation();
            vscodeApi.postMessage({ command: 'revealFieldSource', sourceFilePath: node.sourceFilePath });
        });
        sourceDetailElement.appendChild(revealButton);

        combinationElement.appendChild(sourceDetailElement);

        combinationElement.addEventListener('click', function () {
            sourceDetailElement.classList.toggle('hidden');
        });

        return combinationElement;

    }

    function buildRecordTypeScopeElement(node, recordTypeScope) {

        const scopeElement = createElement('div', 'recordTypeScope');

        const scopeHeading = createElement('div', 'recordTypeScopeHeading');
        scopeHeading.appendChild(createElement('span', 'recordTypeName', 'record type: ' + recordTypeScope.recordTypeDeveloperName));
        scopeHeading.appendChild(createElement('span', 'muted', recordTypeScope.combinations.length + ' combination(s)'));
        appendStatusBadge(scopeHeading, recordTypeScope.status);
        scopeElement.appendChild(scopeHeading);

        if (recordTypeScope.specMethodName) {
            scopeElement.appendChild(createElement('div', 'specOrigin',
                'asserted by ' + node.generatedClassName + '.' + recordTypeScope.specMethodName + '()'));
        }

        const scopeBodyElement = createElement('div', 'hidden');
        scopeElement.appendChild(scopeBodyElement);

        /*
            A scope's rows are built on first expand rather than at load. Every record type repeats
            its field's combinations, so building them all up front multiplies the panel's element
            count by the number of record types before anyone has asked to see one -- and scopes are
            collapsed by default, so most are never opened. Collapsing alone saves layout, not the
            elements themselves.
        */
        let scopeBodyBuilt = false;

        const buildScopeBody = function () {

            /*
                Said on every scope rather than once at the top of the panel: these rows sit beside
                field-level rows that a green run really does verify, and a reader scrolling to one of
                them should not have to remember a note from elsewhere to know the difference.
            */
            scopeBodyElement.appendChild(createElement(
                'div',
                'scopeNote',
                'Generated from source metadata and deployed with the contract, but not asserted by the check: '
                    + 'Apex describe returns picklist values without record type filtering.'
            ));

            recordTypeScope.combinations.forEach(function (combination) {
                scopeBodyElement.appendChild(buildCombinationElement(node, combination, recordTypeScope.declaredValues));
            });

        };

        scopeHeading.addEventListener('click', function () {

            if (!scopeBodyBuilt) {
                buildScopeBody();
                scopeBodyBuilt = true;
            }

            scopeBodyElement.classList.toggle('hidden');

        });

        return scopeElement;

    }

    function buildNodeElement(node) {

        const nodeElement = createElement('div', 'node');

        const nodeHeading = createElement('div', 'nodeHeading');
        nodeHeading.appendChild(createElement('span', 'fieldName', node.fieldApiName));
        nodeHeading.appendChild(createElement('span', 'muted', 'controlled by ' + node.controllingFieldApiName));
        appendStatusBadge(nodeHeading, node.status);
        nodeElement.appendChild(nodeHeading);

        /*
            The generated method that asserts this node, named on the row itself. Absent only in a
            metadata preview, where no generated code asserts it and naming one would be a lie.
        */
        if (node.specMethodName) {
            nodeElement.appendChild(createElement('div', 'specOrigin',
                'asserted by ' + node.generatedClassName + '.' + node.specMethodName + '()'));
        }

        appendFailureDetails(nodeElement, node.fieldLevelFailures);

        node.combinations.forEach(function (combination) {
            nodeElement.appendChild(buildCombinationElement(node, combination, node.declaredValues));
        });

        if (node.recordTypeScopes.length) {

            const recordTypeScopesElement = createElement('div', 'recordTypeScopes');

            node.recordTypeScopes.forEach(function (recordTypeScope) {
                recordTypeScopesElement.appendChild(buildRecordTypeScopeElement(node, recordTypeScope));
            });

            nodeElement.appendChild(recordTypeScopesElement);

        }

        if (node.downstreamNodes.length) {
            const childrenElement = createElement('div', 'nodeChildren');
            node.downstreamNodes.forEach(function (downstreamNode) {
                childrenElement.appendChild(buildNodeElement(downstreamNode));
            });
            nodeElement.appendChild(childrenElement);
        }

        return nodeElement;

    }

    /*
        What the reader is looking at, before anything else on the panel.

        The distinction this banner carries is the whole point of the manifest: rows sourced from a
        manifest ARE what the generated tests assert, and rows sourced from a metadata preview are
        asserted by nothing at all. Rendering both the same way and letting the reader assume would
        undo the guarantee the artifact exists to provide.
    */
    function renderProvenanceBanner() {

        const isPreview = explorerModel.modelSource === 'metadataPreview';
        const isStale = explorerModel.manifestFreshness !== 'fresh';

        const bannerElement = createElement('div',
            'provenanceBanner' + (isPreview ? ' preview' : (isStale ? ' stale' : '')));

        if (isPreview) {

            bannerElement.appendChild(createElement('div', 'fieldName', 'Preview from metadata — not generated'));
            bannerElement.appendChild(createElement('div', 'muted',
                'These rows were read from your source metadata. No Apex specs have been generated for them, '
                    + 'so nothing asserts any combination below and no check can have run against them. '
                    + 'Run "Salesforce Treecipe: Generate Picklist Dependency Tests" to generate the specs.'));

            if (explorerModel.manifestLoadMessage) {
                bannerElement.appendChild(createElement('div', 'muted', explorerModel.manifestLoadMessage));
            }

            explorerRoot.appendChild(bannerElement);
            return;

        }

        bannerElement.appendChild(createElement('div', 'fieldName',
            isStale
                ? 'Generated specs — your metadata has changed since they were generated'
                : 'Generated specs'));

        if (isStale) {
            bannerElement.appendChild(createElement('div', undefined, explorerModel.manifestFreshnessMessage));
        }

        bannerElement.appendChild(createElement('div', 'muted',
            'Generated at ' + explorerModel.generatedAt + ' by Treecipe ' + explorerModel.generatorVersion
                + ' — asserted by ' + explorerModel.specsTestClassName + '.cls'));
        bannerElement.appendChild(createElement('div', 'sourcePath', explorerModel.manifestFilePath));

        explorerRoot.appendChild(bannerElement);

    }

    function renderRunBanner() {

        const bannerStatus = explorerModel.runSummary
            ? (explorerModel.runSummary.passed ? 'passed' : 'failed')
            : 'unknown';

        const bannerElement = createElement('div', 'runBanner ' + bannerStatus);

        if (explorerModel.runSummary) {

            const runSummary = explorerModel.runSummary;
            bannerElement.appendChild(createElement('div', 'fieldName',
                'Last check ' + (runSummary.passed ? 'passed' : 'failed') + ' against ' + runSummary.targetOrg));
            bannerElement.appendChild(createElement('div', 'muted',
                'Ran at ' + runSummary.ranAt + ' — ' + runSummary.methodsRun + ' method(s), ' + runSummary.failureCount + ' failure(s)'));
            bannerElement.appendChild(createElement('div', 'sourcePath', runSummary.resultsFilePath));

        } else {
            bannerElement.appendChild(createElement('div', undefined, explorerModel.runLoadMessage));
        }

        explorerRoot.appendChild(bannerElement);

    }

    function renderSkippedFieldWarnings() {

        if (!explorerModel.skippedFieldWarnings.length) { return; }

        const warningsElement = createElement('div', 'warningList');
        warningsElement.appendChild(createElement('div', 'fieldName',
            explorerModel.skippedFieldWarnings.length
                + ' item(s) were skipped and are asserted by nothing — each is also listed under its object below'));
        explorerModel.skippedFieldWarnings.forEach(function (skippedFieldWarning) {
            warningsElement.appendChild(createElement('div', 'muted', skippedFieldWarning));
        });
        explorerRoot.appendChild(warningsElement);

    }

    function renderObjects() {

        if (!explorerModel.objects.length) {
            explorerRoot.appendChild(createElement('div', 'emptyState', ${this.escapeJsonForScriptBlock(JSON.stringify(this.buildEmptyStateMessage(viewModel)))}));
            return;
        }

        explorerRoot.appendChild(createElement('div', 'muted',
            explorerModel.objects.length + ' object(s), ' + explorerModel.dependentFieldCount
                + ' dependent picklist(s), ' + explorerModel.combinationCount + ' combination(s)'
                + (explorerModel.recordTypeCombinationCount
                    ? ' + ' + explorerModel.recordTypeCombinationCount + ' record-type-scoped'
                    : '')));

        explorerModel.objects.forEach(function (objectViewModel) {

            const objectElement = createElement('div', 'objectSection');

            const objectHeading = createElement('div', 'objectHeading');
            objectHeading.appendChild(createElement('span', undefined, objectViewModel.objectApiName));
            appendStatusBadge(objectHeading, objectViewModel.status);
            objectElement.appendChild(objectHeading);

            if (objectViewModel.generatedClassName) {
                objectElement.appendChild(createElement('div', 'specOrigin',
                    objectViewModel.generatedClassName + '.cls'
                        + (objectViewModel.testMethodName ? ' — test method ' + objectViewModel.testMethodName + '()' : '')));
            }

            /*
                Rendered BEFORE the nodes rather than after them. A skipped field is the one thing on
                this panel that no assertion covers, and putting it below a long list of green rows
                is how it gets missed.
            */
            objectViewModel.skippedFields.forEach(function (skippedField) {

                const skippedElement = createElement('div', 'skippedField');

                const skippedHeading = createElement('div', 'nodeHeading');
                const skippedLabel = skippedField.fieldApiName
                    || (skippedField.recordTypeDeveloperName
                        ? 'record type ' + skippedField.recordTypeDeveloperName
                        : 'this object');
                skippedHeading.appendChild(createElement('span', 'fieldName', skippedLabel));
                skippedHeading.appendChild(createElement('span', 'skippedBadge', 'not asserted'));
                skippedElement.appendChild(skippedHeading);

                skippedElement.appendChild(createElement('div', 'muted', skippedField.warning));

                objectElement.appendChild(skippedElement);

            });

            if (objectViewModel.unattributedFailureMessages.length) {
                objectElement.appendChild(createElement('div', 'failureDetail',
                    'This object\\'s check reported failures that could not be tied to a specific combination below, '
                        + 'so those combinations are shown as not checked rather than passed.\\n\\n'
                        + objectViewModel.unattributedFailureMessages.join('\\n')));
            }

            objectViewModel.rootNodes.forEach(function (rootNode) {
                objectElement.appendChild(buildNodeElement(rootNode));
            });

            explorerRoot.appendChild(objectElement);

        });

    }

    renderProvenanceBanner();
    renderRunBanner();
    renderSkippedFieldWarnings();
    renderObjects();

}());
</script>
</body>
</html>
`;

    }

}
