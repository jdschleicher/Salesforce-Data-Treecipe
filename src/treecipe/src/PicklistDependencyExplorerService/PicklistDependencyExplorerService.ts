import {
    IPicklistDependencySkippedField,
    IPicklistDependencySpecDetail,
    IRecordTypePicklistDependencySpecDetail,
    PicklistDependencySkipReason,
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

/*
    A failure kind restated as a likely cause and a next step, in the words of someone who
    administers the org rather than someone who reads the validator.

    Carried ALONGSIDE the Apex kind and message and never instead of them. The kind is what
    SDTPicklistDependencyValidator actually reported, and is the string a reader greps the framework
    source for; the triage is this extension's reading of it. Replacing one with the other would
    leave the panel describing a failure in words that appear nowhere else in the toolchain.
*/
export interface IPicklistDependencyFailureTriage {
    likelyCause: string;
    nextStep: string;
}

export interface IPicklistDependencyFailureDetailViewModel {
    kind: string;
    message: string;
    /*
        Present ONLY for a kind this version does not recognise, whose triage text names the kind
        and so cannot be shared. Every recognised kind is looked up in the model's
        failureTriageByKind instead: the triage is two sentences of prose, and inlining it on every
        failure made the panel's payload grow with the org's drift rather than with its size.
    */
    triage?: IPicklistDependencyFailureTriage;
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
    // COMBINATIONS DROPPED BY THE RENDERING CEILING, NEVER ONES THE CHECK REPORTED A FAILURE FOR
    truncatedCombinationCount: number;
    // SEE IPicklistDependencyNodeViewModel.declaredValuesTruncated
    declaredValuesTruncated: boolean;
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
    /*
        Everything about this node the panel's find box matches against, lowercased once here rather
        than rebuilt per keystroke in the webview. Held in the model so the matching rule is a tested
        service concern and the panel is left with an "indexOf" -- the filter logic does not become a
        second implementation living only inside a script string.
    */
    searchText: string;
    // COMBINATIONS AND SCOPES DROPPED BY THE RENDERING CEILING, FAILING ONES LAST -- SEE applyModelLimits
    truncatedCombinationCount: number;
    truncatedRecordTypeScopeCount: number;
    /*
        The declared value list was capped, so the panel must NOT draw the "must not unlock"
        complement against it: a complement of a partial universe understates what the spec forbids,
        which is a false claim rather than a shorter one. The panel says so instead.
    */
    declaredValuesTruncated: boolean;
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
    /*
        Carried alongside the prose so a row can be grouped or filtered by what actually happened
        without scraping the sentence. Degraded to "unknown" by the manifest loader rather than
        dropped, so every row has one.
    */
    reason: PicklistDependencySkipReason;
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
    // THE FIND BOX HAYSTACK FOR THIS OBJECT AND EVERY NODE BENEATH IT -- SEE IPicklistDependencyNodeViewModel.searchText
    searchText: string;
    /*
        Dependent picklists dropped by the rendering ceiling, counted as FIELDS rather than as root
        chains: a chain is dropped whole, because half a chain drawn as a graph is a lie about what
        controls what.
    */
    truncatedNodeCount: number;
}

export interface IPicklistDependencyRunSummary {
    targetOrg: string;
    ranAt: string;
    passed: boolean;
    failureCount: number;
    methodsRun: number;
    resultsFilePath: string;
    /*
        The human-readable "report.md" written beside results.json by the same run, so a failed
        combination can link to the entry that reported it. Empty when the run folder holds no
        report -- an artifact written by an older version, or one that was pruned.
    */
    reportFilePath: string;
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
    /*
        Objects dropped by the rendering ceiling. The counts above are NOT reduced by it: they
        describe what the manifest declares, and the notices below describe what is on screen.
        Collapsing the two would leave a truncated panel quietly reporting a smaller org.
    */
    truncatedObjectCount: number;
    // WHAT THE CEILING DROPPED, IN WORDS, RENDERED AT THE TOP OF THE PANEL. EMPTY WHEN NOTHING WAS DROPPED.
    truncationNotices: string[];
    /*
        Combinations the check reported a failure for that the TOTAL budget still could not fit.

        Held apart from every other truncation count because it is the one drop the panel would
        rather not make: past this point the run report is the complete record and the panel is not,
        which the notice says in those words.
    */
    truncatedFailedCombinationCount: number;
    /*
        The triage prose, once per failure KIND rather than once per failure. The panel looks a
        failure's kind up in here; a kind absent from it carries its own inline triage.
    */
    failureTriageByKind: Record<string, IPicklistDependencyFailureTriage>;
}

/*
    What the host sends the panel. The panel sends back only the four action commands it always has,
    plus "ready" -- see IPicklistDependencyExplorerPanelMessage.

    These exist because the model is no longer serialized into the panel's html. A message shape is
    the contract that replaced that document, so it is typed here beside the model it carries rather
    than assembled ad hoc at each post site.
*/
export interface IPicklistDependencyExplorerRenderMessage {
    command: 'renderModel';
    model: IPicklistDependencyExplorerViewModel;
    emptyStateMessage: string;
    // THE STATUS LINE TO LEAVE ON SCREEN AFTER RENDERING -- EMPTY ONCE NOTHING IS STILL LOADING
    message: string;
}

export interface IPicklistDependencyExplorerLoadPhaseMessage {
    command: 'loadPhase';
    message: string;
}

export interface IPicklistDependencyExplorerFreshnessMessage {
    command: 'applyFreshness';
    freshness: PicklistDependencyManifestFreshness;
    message: string;
}

export interface IPicklistDependencyExplorerLoadFailedMessage {
    command: 'loadFailed';
    message: string;
}

export type PicklistDependencyExplorerHostMessage = IPicklistDependencyExplorerRenderMessage
                                                        | IPicklistDependencyExplorerLoadPhaseMessage
                                                        | IPicklistDependencyExplorerFreshnessMessage
                                                        | IPicklistDependencyExplorerLoadFailedMessage;

/*
    The phases an open reports, in the order they run. Named here so the panel banner, the status bar
    item and the tests all say the same words -- three copies of "Building the dependency view..."
    is how a phase gets renamed in one place and not the others.
*/
export const PICKLIST_DEPENDENCY_EXPLORER_LOAD_PHASES = {
    readingManifest: 'Reading the generated spec manifest…',
    loadingResults: 'Loading the most recent picklist dependency check results…',
    buildingView: 'Building the dependency view…',
    checkingFreshness: 'Checking whether the generated specs still match your metadata…',
    scanningMetadata: 'Scanning your object metadata for dependent picklists…'
};

/*
    What the panel will render before it starts dropping rows.

    An unbounded payload was the ceiling before this existed: the model is serialized into the html
    in full, so a large org's panel was a multi-megabyte document whose size nothing stated. These
    are deliberately generous -- they are a backstop against a pathological org, not a page size --
    and the rule that decides what survives them is fixed: a combination, scope or object the check
    reported a failure for is never the thing dropped.
*/
export interface IPicklistDependencyExplorerModelLimits {
    maxObjects: number;
    maxNodesPerObject: number;
    maxCombinationsPerNode: number;
    maxRecordTypeScopesPerNode: number;
    /*
        The bound that actually bounds the payload.

        The per-axis caps above shape the panel -- no one field dominating, no one object running
        away -- but their PRODUCT is not a size: 250 objects x 25 fields x 200 combinations is
        millions of rows, so caps alone left the embedded json as large as the org happened to be.
        This is the total, across every object, field and record type scope, and it is the number
        the measured payload figures in the changelog are derived from.
    */
    maxRenderedCombinations: number;
    /*
        The value UNIVERSE one field may render.

        Measured its way onto this list: capping combinations alone still left a ~20MB payload,
        because declaredValues holds every value the field declares and grows with the picklist
        rather than with how many combinations survived the budget. It is the third axis, and it was
        the dominant term once the other two were bounded.
    */
    maxDeclaredValuesPerNode: number;
}

/*
    Measured rather than guessed: at roughly 350 bytes of serialized json per rendered combination,
    20,000 combinations is an embedded model of about 7MB, against the 17MB an unbounded large org
    produced before any ceiling existed. See CHANGELOG 3.6.0 for the measurement table.
*/
export const DEFAULT_PICKLIST_DEPENDENCY_EXPLORER_MODEL_LIMITS: IPicklistDependencyExplorerModelLimits = {
    maxObjects: 250,
    maxNodesPerObject: 25,
    maxCombinationsPerNode: 200,
    maxRecordTypeScopesPerNode: 25,
    maxRenderedCombinations: 20000,
    maxDeclaredValuesPerNode: 200
};

/*
    How many objects "Expand all" will open at once.

    Expanding is what builds an object's rows, so an unguarded "expand all" is the 1.8M element
    render this ceiling exists to prevent -- offered as a button rather than reached by accident.
    Past this the panel says so and asks for a narrower filter instead of freezing.
*/
export const PICKLIST_DEPENDENCY_EXPLORER_EXPAND_ALL_OBJECT_LIMIT = 25;

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
    /*
        The generated test method per object, as the MANIFEST recorded it.

        Read rather than re-derived, because this name is what the run outcome is looked up by: a
        re-derivation would be a second derivation of exactly the kind this artifact exists to
        remove, and the two inputs are not identical -- the manifest's name was computed from the
        pre-serialization object set, and a re-derivation would use the set rebuilt through the
        parse boundary. Those differ the moment an entry is dropped on load, and a shifted
        collision suffix would attribute one object's pass or fail to another.
    */
    testMethodNamesByObjectApiName: Record<string, string>;
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

    /*
        Every FailureKind SDTPicklistDependencyValidator can raise, restated as a cause and a step.

        Keyed by the enum name the Apex emits rather than by anything re-derived here, so a kind the
        framework stops raising simply stops being looked up, and a kind it starts raising falls
        through to the default below instead of being silently explained as something else. The two
        hand-edit kinds -- CONTRADICTORY_EXPECTATION and CIRCULAR_DEPENDENCY -- say so explicitly:
        pointing an admin at the org for a spec no org can satisfy is the most expensive wrong turn
        this panel could send someone on.
    */
    private static failureTriageByKind: Record<string, IPicklistDependencyFailureTriage> = {
        MISSING_VALUES: {
            likelyCause: 'A value this controlling value used to unlock is no longer valid for it in the org. Usually the value was unassigned from the dependent field, or the dependency matrix was re-drawn for this controlling value.',
            nextStep: 'Open Setup > Object Manager > this field > Field Dependencies, select the controlling value named below, and re-tick the missing values -- or, if the org is now correct, re-run "Salesforce Treecipe: Generate Picklist Dependency Tests" to re-baseline the spec.'
        },
        UNEXPECTED_VALUES: {
            likelyCause: 'The org unlocks values this combination\'s exact expectation does not list. Values were added to the dependency matrix for this controlling value after the spec was generated.',
            nextStep: 'Compare the values below against the field dependency matrix in Setup. Untick them there if the addition was unintended, or re-generate the specs to accept the org as the new baseline.'
        },
        FORBIDDEN_VALUES_PRESENT: {
            likelyCause: 'A value the spec asserts this controlling value must NOT unlock is now reachable through it. The dependency was widened in the org -- this is the direction that silently lets bad data in.',
            nextStep: 'Untick the values below for this controlling value in Setup > Field Dependencies, or re-generate the specs if widening the dependency was deliberate.'
        },
        UNKNOWN_CONTROLLING_VALUE: {
            likelyCause: 'The controlling value itself no longer exists on the controlling field -- it was renamed, deactivated, or deleted. Nothing about the dependent values could be checked, because there is no controlling value to check them under.',
            nextStep: 'Check the controlling field\'s value set in Setup against the values the message below lists as present in the org. A rename needs the spec re-generated; a deactivation needs the value reactivated or the dependency retired.'
        },
        UNEXPECTED_CONTROLLING_VALUE: {
            likelyCause: 'A controlling value the spec asserts is unreachable under this record type is now available. The record type was widened to assign it, or the value was added to the record type\'s picklist.',
            nextStep: 'Check this record type\'s picklist value assignment for the controlling field in Setup. Re-generate the specs if the record type was meant to be widened.'
        },
        CONTROLLING_FIELD_MISMATCH: {
            likelyCause: 'The dependent field is now controlled by a different field than the spec declares. The dependency was re-pointed at another controlling field in the org, which invalidates every combination for this field at once.',
            nextStep: 'Confirm the intended controlling field in Setup > Field Dependencies, then re-run the generate command so the spec targets the field the org actually uses. Nothing under this field is verified until it is re-pointed.'
        },
        CONTRADICTORY_EXPECTATION: {
            likelyCause: 'The spec requires and forbids the same value under one controlling value, so no org can satisfy it. This is a hand edit to generated Apex rather than org drift -- the generator emits the forbidden list as the complement of the expected one, and the two cannot overlap in generated output.',
            nextStep: 'Edit the generated spec method and remove the values below from either the expected list or the not-allowed list -- or re-run the generate command to replace the hand edit. Do not change the org: nothing in it caused this.'
        },
        UPSTREAM_FAILURE: {
            likelyCause: 'This combination was not evaluated at all. The controlling field is itself a dependent picklist, and its own spec failed first, so anything reported here would be an echo of that break rather than a fact about this field.',
            nextStep: 'Fix the upstream spec named in the message below and re-run the check. This row stays unverified until the upstream one passes.'
        },
        CIRCULAR_DEPENDENCY: {
            likelyCause: 'The dependsOn chain loops back on itself, so the spec cannot be validated. Salesforce cannot express a cyclic picklist dependency, which makes this a hand edit to the generated dependsOn wiring rather than something the org did.',
            nextStep: 'Open the generated spec method and remove the dependsOn link that closes the loop, or re-run the generate command to replace the hand edit.'
        },
        LOOKUP_ERROR: {
            likelyCause: 'The describe call for this field failed in the target org. The field or object may not exist there, may not be deployed yet, or may not be visible to the user the check ran as.',
            nextStep: 'Confirm the object and field are deployed to the target org and readable by the running user, then re-run "Salesforce Treecipe: Run Picklist Dependency Check". The Apex message below carries the org\'s own error text.'
        }
    };

    /*
        The triage for a kind, or an honest default for one this version has never heard of.

        A kind with no entry is NOT explained away: the default says so, and points at the raw
        message, which is the only thing that can still be trusted about a failure the panel does
        not recognise.
    */
    static buildFailureTriage(failureKind: string): IPicklistDependencyFailureTriage {

        return this.failureTriageByKind[failureKind] ?? {
            likelyCause: `This version of the Explorer has no explanation for a "${failureKind}" failure -- it was raised by a picklist dependency framework newer or older than the panel.`,
            nextStep: 'Read the Apex message below, which is reported exactly as the check received it, and re-run "Salesforce Treecipe: Generate Picklist Dependency Tests" so the deployed framework and this extension are the same version.'
        };

    }

    /*
        A failure detail carries its triage INLINE only when the kind is one this version does not
        recognise -- that text names the kind, so it cannot be shared. Every recognised kind is
        resolved through the model's failureTriageByKind, which holds each prose pair once.
    */
    static buildFailureDetailViewModel(failureKind: string, failureMessage: string): IPicklistDependencyFailureDetailViewModel {

        if ( this.failureTriageByKind[failureKind] ) {
            return { kind: failureKind, message: failureMessage };
        }

        return {
            kind: failureKind,
            message: failureMessage,
            triage: this.buildFailureTriage(failureKind)
        };

    }

    // THE SHARED PROSE THE PANEL LOOKS A RECOGNISED KIND UP IN, COPIED SO THE PRIVATE MAP IS NOT HANDED OUT
    static buildFailureTriageByKind(): Record<string, IPicklistDependencyFailureTriage> {

        return { ...this.failureTriageByKind };

    }

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

            const nodeViewModel: IPicklistDependencyNodeViewModel = {
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
                ),
                searchText: '',
                truncatedCombinationCount: 0,
                truncatedRecordTypeScopeCount: 0,
                declaredValuesTruncated: false
            };

            // ASSIGNED AFTER CONSTRUCTION BECAUSE IT IS BUILT FROM THE NODE'S OWN SCOPES, WHICH ARE BUILT ABOVE
            nodeViewModel.searchText = this.buildNodeSearchText(nodeViewModel);

            return nodeViewModel;

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
                failureCount: 0,
                truncatedCombinationCount: 0,
                declaredValuesTruncated: false
            }));

    }

    /*
        The haystack the panel's find box matches one node against.

        Lowercased once here rather than per keystroke in the webview, and built from the names a
        reader would actually type: the field, what controls it, the object it belongs to, the
        generated method that asserts it, and every record type that narrows it. Downstream nodes
        are deliberately absent -- each is its own row with its own haystack, and folding a child's
        names into its parent would make a parent match a search for a field it merely controls.
    */
    static buildNodeSearchText(node: IPicklistDependencyNodeViewModel): string {

        const searchableValues = [
            node.objectApiName,
            node.fieldApiName,
            node.controllingFieldApiName,
            node.generatedClassName,
            node.specMethodName,
            ...node.recordTypeScopes.map(recordTypeScope => recordTypeScope.recordTypeDeveloperName),
            ...node.recordTypeScopes.map(recordTypeScope => recordTypeScope.specMethodName)
        ];

        return searchableValues.filter(searchableValue => !!searchableValue).join(' ').toLowerCase();

    }

    /*
        The haystack for a whole object section, which is what the find box hides or shows.

        It includes every node beneath the object, so searching for a FIELD name reaches the object
        holding it rather than requiring the reader to know which object that was -- which is the
        whole point of the box. Skipped fields are in it too: a field that was skipped is the one
        thing on the panel nothing asserts, and it must not become unfindable as well.
    */
    static buildObjectSearchText(objectViewModel: IPicklistDependencyObjectViewModel): string {

        const searchableValues = [
            objectViewModel.objectApiName,
            objectViewModel.generatedClassName,
            objectViewModel.testMethodName,
            ...this.flattenNodes(objectViewModel.rootNodes).map(node => node.searchText),
            ...objectViewModel.skippedFields.map(skippedField => skippedField.fieldApiName),
            ...objectViewModel.skippedFields.map(skippedField => skippedField.recordTypeDeveloperName)
        ];

        return searchableValues.filter(searchableValue => !!searchableValue).join(' ').toLowerCase();

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

                    combinationFailures.push(this.buildFailureDetailViewModel(parsedFailure.kind, failureMessage));
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
                return this.buildFailureDetailViewModel(parsedFailure.kind, parsedFailure.fieldLevelMessage);
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

                        combinationFailures.push(this.buildFailureDetailViewModel(parsedFailure.kind, failureMessage));
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

        /*
            The UNION of both kinds, mirroring the object set the manifest and the Apex writer use.
            An object that produced only record-type-scoped specs still has a generated class and a
            manifest entry, so it has to reach the panel rather than being dropped for having no
            field-level spec to key off.
        */
        const distinctObjectApiNames = PicklistDependencyTestService.getDistinctObjectApiNames(
            [...specDetails, ...recordTypeSpecDetails]
        );

        /*
            Derived ONLY as the fallback for a metadata preview, which has no manifest to read from
            and no generated test class for the name to refer to either. Whenever a manifest is the
            source, the name it recorded wins -- see IPicklistDependencyExplorerContext.
        */
        const derivedTestMethodNamesByObjectApiName = PicklistDependencyTestService.buildTestMethodNamesByObjectApiName(distinctObjectApiNames);
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

            const testMethodName = explorerContext.testMethodNamesByObjectApiName[objectApiName]
                                        ?? derivedTestMethodNamesByObjectApiName[objectApiName];
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
                unattributedFailureMessages: unattributedFailureMessages,
                searchText: '',
                truncatedNodeCount: 0
            };

        });

        objects.forEach(objectViewModel => {
            objectViewModel.searchText = this.buildObjectSearchText(objectViewModel);
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
            unattributedFailureMessages: [],
            truncatedNodeCount: 0,
            searchText: [objectApiName, ...skippedFieldViewModelsByObjectApiName[objectApiName].map(skippedField => skippedField.fieldApiName)]
                            .filter(searchableValue => !!searchableValue)
                            .join(' ')
                            .toLowerCase()
        }));

        const allObjects = objects.concat(skipOnlyObjects);

        const runSummary: IPicklistDependencyRunSummary | undefined = ( resultsLoad.state === 'loaded' && resultsLoad.results )
            ? {
                targetOrg: resultsLoad.results.targetOrg,
                ranAt: resultsLoad.results.ranAt,
                passed: resultsLoad.results.passed,
                failureCount: resultsLoad.results.failureCount,
                methodsRun: resultsLoad.results.methodsRun,
                resultsFilePath: resultsLoad.resultsFilePath ?? '',
                reportFilePath: this.resolveRunReportFilePath(resultsLoad.resultsFilePath ?? '')
            }
            : undefined;

        const explorerViewModel: IPicklistDependencyExplorerViewModel = {
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
            classesDirectoryPath: explorerContext.classesDirectoryPath,
            truncatedObjectCount: 0,
            truncationNotices: [],
            truncatedFailedCombinationCount: 0,
            failureTriageByKind: this.buildFailureTriageByKind()
        };

        /*
            The ceiling is applied HERE rather than at render time, and after every count above has
            been taken. The counts then keep describing the org while the panel describes what it is
            showing, and the two are reconciled by the notices the ceiling writes.
        */
        return this.applyModelLimits(explorerViewModel);

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
            // A PREVIEW HAS NO GENERATED TEST CLASS, SO THESE ARE DERIVED RATHER THAN READ -- SEE buildExplorerViewModel
            testMethodNamesByObjectApiName: {},
            skippedFields: []
        };

    }

    /*
        A path read from the manifest that the extension host may be asked to OPEN, or empty.

        The manifest is a json file on disk that a hand edit -- or a commit from someone else --
        controls, and loadManifest accepts these paths as bare strings. Every one of them that
        becomes an openable target has to be brought back inside the workspace first, exactly as
        resolveRenderableObjectsDirectoryPath already does for the objects directory: an allow-list
        is only as trustworthy as the text it was built from, and "the model named it" stops being
        a safety property once the model can name anything on the disk.

        Returning EMPTY rather than falling back to a guess is what makes this safe by default
        downstream: an object with no generated class file path contributes no spec target and
        renders no "Open spec method" button, which is already how a metadata preview behaves.
    */
    static resolveOpenableManifestFilePath(manifestFilePath: string, workspaceRoot?: string): string {

        if ( !manifestFilePath ) {
            return '';
        }

        /*
            No workspace to check against. Callers rendering a panel always pass one -- the command
            throws before this point without it -- so this is the test-only path, and the honest
            answer there is the path as recorded rather than a silent empty.
        */
        if ( !workspaceRoot ) {
            return manifestFilePath;
        }

        const isContainedInWorkspace = PicklistDependencyTestService.isPathContainedInWorkspace(
            path.resolve(manifestFilePath),
            path.resolve(workspaceRoot)
        );

        return isContainedInWorkspace ? manifestFilePath : '';

    }

    static buildContextByManifest(manifest: IPicklistDependencyManifest,
                                    manifestLoad: IPicklistDependencyManifestLoad,
                                    freshnessResult: IPicklistDependencyManifestFreshnessResult,
                                    workspaceRoot?: string): IPicklistDependencyExplorerContext {

        let generatedNamesByObjectApiName: Record<string, IPicklistDependencyGeneratedNames> = {};
        let generatedClassFilePathsByObjectApiName: Record<string, string> = {};
        let testMethodNamesByObjectApiName: Record<string, string> = {};

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

            generatedClassFilePathsByObjectApiName[manifestObject.objectApiName] = this.resolveOpenableManifestFilePath(
                manifestObject.generatedClassFilePath,
                workspaceRoot
            );
            testMethodNamesByObjectApiName[manifestObject.objectApiName] = manifestObject.testMethodName;

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
            classesDirectoryPath: this.resolveOpenableManifestFilePath(manifest.classesDirectoryPath, workspaceRoot),
            generatedNamesByObjectApiName: generatedNamesByObjectApiName,
            generatedClassFilePathsByObjectApiName: generatedClassFilePathsByObjectApiName,
            testMethodNamesByObjectApiName: testMethodNamesByObjectApiName,
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
                warning: skippedField.warning,
                reason: PicklistDependencyTestService.isRecognisedSkipReason(skippedField.reason) ? skippedField.reason : 'unknown'
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
                                                freshnessResult: IPicklistDependencyManifestFreshnessResult,
                                                workspaceRoot?: string): IPicklistDependencyExplorerViewModel {

        const manifest = manifestLoad.manifest;

        if ( !manifest ) {
            throw new Error('A picklist dependency explorer view model cannot be built from a manifest load that carries no manifest.');
        }

        const manifestSpecDetails = PicklistDependencyManifestService.buildSpecDetailsByManifest(manifest);
        const explorerContext = this.buildContextByManifest(manifest, manifestLoad, freshnessResult, workspaceRoot);

        return this.buildExplorerViewModel(
            this.resolveRenderableObjectsDirectoryPath(manifest.objectsDirectoryPath, objectsDirectoryPath, workspaceRoot),
            manifestSpecDetails.specDetails,
            manifest.skippedFieldWarnings,
            resultsLoad,
            manifestSpecDetails.recordTypeSpecDetails,
            explorerContext
        );

    }

    /*
        Which objects directory the rendered node paths are built under.

        Normally the directory the manifest was RECORDED against, not the one configured now: the
        two differing is what the staleness banner reports, and building paths from the current
        configuration under specs generated elsewhere would produce reveal targets that do not
        correspond to the specs on screen.

        But the manifest is a json file on disk, and this is the only string in it that reaches the
        filesystem. Every node's sourceFilePath is built under it, and those paths become the
        allow-list the panel's reveal handler trusts -- so a manifest committed into a repo someone
        clones could otherwise seed that list with an absolute path anywhere on their machine and
        have a click open it. The api names below it are already gated to letters, numbers and
        underscores, which forces the shape of the suffix; this gates the prefix, so the guarantee
        the allow-list rests on is about a real directory rather than an attacker-named one.

        Falling back to the configured directory rather than refusing outright keeps an out-of-tree
        manifest readable: the structure it declares is still shown, and only the reveal targets are
        brought back inside the workspace.
    */
    static resolveRenderableObjectsDirectoryPath(manifestObjectsDirectoryPath: string,
                                                    configuredObjectsDirectoryPath: string,
                                                    workspaceRoot?: string): string {

        if ( !manifestObjectsDirectoryPath ) {
            return configuredObjectsDirectoryPath;
        }

        // NO WORKSPACE TO CHECK AGAINST -- CALLERS THAT HAVE ONE ALWAYS PASS IT, AND TESTS THAT DO NOT ARE NOT RENDERING A PANEL
        if ( !workspaceRoot ) {
            return manifestObjectsDirectoryPath;
        }

        const isContainedInWorkspace = PicklistDependencyTestService.isPathContainedInWorkspace(
            path.resolve(manifestObjectsDirectoryPath),
            path.resolve(workspaceRoot)
        );

        return isContainedInWorkspace ? manifestObjectsDirectoryPath : configuredObjectsDirectoryPath;

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
        Keeps at most "cap" items, and never drops one the caller marked as retained.

        Retained items are taken FIRST and the remainder fills what is left, but the result is
        returned in the caller's original order rather than with the retained ones hoisted -- a
        combination list that reorders itself once an org drifts is a list a reader can no longer
        scan against the field it came from. When the retained items alone exceed the cap they are
        all kept anyway: the cap exists to bound a pathological render, and dropping a reported
        failure to honour it would break the one promise the panel makes.
    */
    static selectWithinCap<TItem>(items: TItem[], cap: number, isRetained: (item: TItem) => boolean): TItem[] {

        if ( cap <= 0 || items.length <= cap ) {
            return items;
        }

        let selectedItemIndexes = new Set<number>();

        items.forEach((item, itemIndex) => {
            if ( isRetained(item) ) {
                selectedItemIndexes.add(itemIndex);
            }
        });

        items.forEach((item, itemIndex) => {

            if ( selectedItemIndexes.has(itemIndex) || selectedItemIndexes.size >= cap ) {
                return;
            }

            selectedItemIndexes.add(itemIndex);

        });

        return items.filter((item, itemIndex) => selectedItemIndexes.has(itemIndex));

    }

    /*
        Brings the model under a stated ceiling, and says in words what it dropped.

        The payload is serialized into the panel html in full, so before this existed the panel's
        size was whatever the org happened to be -- around 17MB of embedded JSON for a large one,
        with no number anywhere saying so. Truncation is preferred to a silently enormous document,
        but only on the axis that costs nothing to lose: anything the check reported a failure for,
        and any object carrying a skipped field, is retained regardless of the cap.

        Nothing here changes a status. A dropped row is ABSENT and counted in a notice, never
        rendered as something it was not -- the three-state guarantee holds under the ceiling exactly
        as it holds under a filter.
    */
    static applyModelLimits(viewModel: IPicklistDependencyExplorerViewModel,
                                limits: IPicklistDependencyExplorerModelLimits = DEFAULT_PICKLIST_DEPENDENCY_EXPLORER_MODEL_LIMITS): IPicklistDependencyExplorerViewModel {

        let truncationNotices: string[] = [];

        const declaredObjectCount = viewModel.objects.length;

        viewModel.objects = this.selectWithinCap(
            viewModel.objects,
            limits.maxObjects,
            objectViewModel => objectViewModel.status === 'failed'
                                || objectViewModel.failureCount > 0
                                || objectViewModel.unattributedFailureMessages.length > 0
                                || objectViewModel.skippedFields.length > 0
        );

        /*
            Accumulated rather than assigned. Nothing calls this twice today, but the total budget
            below makes a second tightening pass a reasonable thing to do, and a counter that
            overwrote the first pass would under-report what is missing from the panel -- which is
            the exact failure mode the counts exist to prevent.
        */
        const truncatedObjectCount = declaredObjectCount - viewModel.objects.length;
        viewModel.truncatedObjectCount += truncatedObjectCount;

        if ( truncatedObjectCount > 0 ) {
            truncationNotices.push(
                `Showing ${viewModel.objects.length} of ${declaredObjectCount} objects. `
                    + `${truncatedObjectCount} object(s) with no reported failure and no skipped field are not rendered, `
                    + 'so they cannot be found with the filter above either. '
                    + 'Every object the check reported on, and every object carrying a skipped field, is shown. '
                    + 'Generate against a narrower objects directory to bring the rest onto the panel.'
            );
        }

        let truncatedCombinationCount = 0;
        let truncatedRecordTypeScopeCount = 0;
        let truncatedNodeCount = 0;

        const isFailedCombination = (combination: IPicklistDependencyCombinationViewModel) =>
            combination.status === 'failed' || combination.failures.length > 0;

        viewModel.objects.forEach(objectViewModel => {

            /*
                Whole ROOT chains are dropped rather than individual nodes. A chain is drawn by
                containment, and rendering a downstream field without the field that controls it
                would misstate the dependency rather than merely shorten the list.
            */
            const declaredNodeCount = this.countNodes(objectViewModel.rootNodes);

            objectViewModel.rootNodes = this.selectWithinCap(
                objectViewModel.rootNodes,
                limits.maxNodesPerObject,
                rootNode => this.flattenNodes([rootNode]).some(node => node.status === 'failed' || node.failureCount > 0)
            );

            const objectTruncatedNodeCount = declaredNodeCount - this.countNodes(objectViewModel.rootNodes);
            objectViewModel.truncatedNodeCount += objectTruncatedNodeCount;
            truncatedNodeCount += objectTruncatedNodeCount;

            this.flattenNodes(objectViewModel.rootNodes).forEach(node => {

                if ( node.declaredValues.length > limits.maxDeclaredValuesPerNode ) {
                    node.declaredValues = node.declaredValues.slice(0, limits.maxDeclaredValuesPerNode);
                    node.declaredValuesTruncated = true;
                }

                const declaredCombinationCount = node.combinations.length;
                node.combinations = this.selectWithinCap(node.combinations, limits.maxCombinationsPerNode, isFailedCombination);
                node.truncatedCombinationCount += declaredCombinationCount - node.combinations.length;
                truncatedCombinationCount += declaredCombinationCount - node.combinations.length;

                const declaredRecordTypeScopeCount = node.recordTypeScopes.length;
                node.recordTypeScopes = this.selectWithinCap(
                    node.recordTypeScopes,
                    limits.maxRecordTypeScopesPerNode,
                    recordTypeScope => recordTypeScope.status === 'failed' || recordTypeScope.failureCount > 0
                );
                node.truncatedRecordTypeScopeCount += declaredRecordTypeScopeCount - node.recordTypeScopes.length;
                truncatedRecordTypeScopeCount += declaredRecordTypeScopeCount - node.recordTypeScopes.length;

                node.recordTypeScopes.forEach(recordTypeScope => {

                    if ( recordTypeScope.declaredValues.length > limits.maxDeclaredValuesPerNode ) {
                        recordTypeScope.declaredValues = recordTypeScope.declaredValues.slice(0, limits.maxDeclaredValuesPerNode);
                        recordTypeScope.declaredValuesTruncated = true;
                    }

                    const declaredScopeCombinationCount = recordTypeScope.combinations.length;
                    recordTypeScope.combinations = this.selectWithinCap(recordTypeScope.combinations, limits.maxCombinationsPerNode, isFailedCombination);
                    recordTypeScope.truncatedCombinationCount += declaredScopeCombinationCount - recordTypeScope.combinations.length;
                    truncatedCombinationCount += declaredScopeCombinationCount - recordTypeScope.combinations.length;

                });

            });

        });

        const totalBudgetResult = this.applyTotalCombinationBudget(viewModel, limits.maxRenderedCombinations);
        truncatedCombinationCount += totalBudgetResult.truncatedCombinationCount;

        if ( truncatedNodeCount > 0 ) {
            truncationNotices.push(
                `${truncatedNodeCount} dependent picklist(s) are not rendered: no object shows more than `
                    + `${limits.maxNodesPerObject} at once. Every chain the check reported a failure in is shown.`
            );
        }

        if ( truncatedCombinationCount > 0 ) {
            truncationNotices.push(
                `${truncatedCombinationCount} combination(s) are not rendered, against a panel total of `
                    + `${limits.maxRenderedCombinations} and a per-field limit of ${limits.maxCombinationsPerNode}. `
                    + 'Combinations the check reported a failure for are kept ahead of every passing one.'
            );
        }

        if ( truncatedRecordTypeScopeCount > 0 ) {
            truncationNotices.push(
                `${truncatedRecordTypeScopeCount} record type scope(s) are not rendered: no field shows more than `
                    + `${limits.maxRecordTypeScopesPerNode} at once. Every scope the check reported a failure for is shown.`
            );
        }

        /*
            Said separately and last, because it is the only drop that costs the reader something
            the panel cannot give back: past the total budget even a reported failure is not on
            screen, and the run report is then the complete record while the panel is not.
        */
        if ( totalBudgetResult.truncatedFailedCombinationCount > 0 ) {
            viewModel.truncatedFailedCombinationCount += totalBudgetResult.truncatedFailedCombinationCount;
            truncationNotices.push(
                `${totalBudgetResult.truncatedFailedCombinationCount} combination(s) the check reported a FAILURE for are not `
                    + `rendered either: there are more failures than the panel's total of ${limits.maxRenderedCombinations} rows can hold. `
                    + 'The run report beside results.json lists every one of them -- treat it, not this panel, as the complete record of this run.'
            );
        }

        viewModel.truncationNotices = viewModel.truncationNotices.concat(truncationNotices);

        return viewModel;

    }

    /*
        Brings the TOTAL number of rendered combinations under one budget, across every object,
        field and record type scope.

        This is what makes the ceiling a size rather than a shape. The per-axis caps above bound
        each axis independently, and their product is millions of rows -- so before this existed a
        drifted org still serialized a payload as large as the org, which is the condition the
        ceiling was introduced to remove.

        Failing combinations fill the budget FIRST, in document order, so a failure is never dropped
        in favour of a passing row. Past the budget they are dropped too and counted separately: an
        unbounded payload is worse for the reader than a bounded one that says what is missing and
        where the complete list lives.
    */
    static applyTotalCombinationBudget(viewModel: IPicklistDependencyExplorerViewModel,
                                        maxRenderedCombinations: number): { truncatedCombinationCount: number; truncatedFailedCombinationCount: number } {

        if ( maxRenderedCombinations <= 0 ) {
            return { truncatedCombinationCount: 0, truncatedFailedCombinationCount: 0 };
        }

        type CombinationHolder = { combinations: IPicklistDependencyCombinationViewModel[] };

        let combinationHolders: CombinationHolder[] = [];

        viewModel.objects.forEach(objectViewModel => {
            this.flattenNodes(objectViewModel.rootNodes).forEach(node => {
                combinationHolders.push(node);
                node.recordTypeScopes.forEach(recordTypeScope => combinationHolders.push(recordTypeScope));
            });
        });

        const isFailedCombination = (combination: IPicklistDependencyCombinationViewModel) =>
            combination.status === 'failed' || combination.failures.length > 0;

        const renderedCombinationCount = combinationHolders.reduce(
            (combinationCount, combinationHolder) => combinationCount + combinationHolder.combinations.length,
            0
        );

        if ( renderedCombinationCount <= maxRenderedCombinations ) {
            return { truncatedCombinationCount: 0, truncatedFailedCombinationCount: 0 };
        }

        const failedCombinationCount = combinationHolders.reduce(
            (combinationCount, combinationHolder) => combinationCount + combinationHolder.combinations.filter(isFailedCombination).length,
            0
        );

        /*
            Two budgets rather than one pass: how many FAILING rows fit, and how much is left over
            for the rest. Spending the remainder on passing rows only after every failure that fits
            has been placed is what keeps "a failure is never dropped for a passing row" true
            without needing to reorder anything on screen.
        */
        let failedBudgetRemaining = Math.min(failedCombinationCount, maxRenderedCombinations);
        let passingBudgetRemaining = maxRenderedCombinations - failedBudgetRemaining;

        let truncatedCombinationCount = 0;
        let truncatedFailedCombinationCount = 0;

        combinationHolders.forEach(combinationHolder => {

            let keptCombinations: IPicklistDependencyCombinationViewModel[] = [];

            combinationHolder.combinations.forEach(combination => {

                if ( isFailedCombination(combination) ) {

                    if ( failedBudgetRemaining > 0 ) {
                        failedBudgetRemaining--;
                        keptCombinations.push(combination);
                        return;
                    }

                    truncatedFailedCombinationCount++;
                    truncatedCombinationCount++;
                    return;

                }

                if ( passingBudgetRemaining > 0 ) {
                    passingBudgetRemaining--;
                    keptCombinations.push(combination);
                    return;
                }

                truncatedCombinationCount++;

            });

            combinationHolder.combinations = keptCombinations;

        });

        return {
            truncatedCombinationCount: truncatedCombinationCount,
            truncatedFailedCombinationCount: truncatedFailedCombinationCount
        };

    }

    /*
        The "report.md" the same run wrote beside its results.json, when it wrote one.

        Resolved from the results path rather than searched for, because the two are written into
        the same run folder in one call -- and returned empty rather than guessed at when the file
        is not there, so the panel offers the link only where following it would land somewhere.
    */
    static resolveRunReportFilePath(resultsFilePath: string): string {

        if ( !resultsFilePath ) {
            return '';
        }

        const runReportFilePath = path.join(path.dirname(resultsFilePath), 'report.md');

        return fs.existsSync(runReportFilePath) ? runReportFilePath : '';

    }

    /*
        One allow-list entry: a file the panel may open, paired with the method inside it the panel
        may scroll to. The pair is the unit rather than the path alone, so a panel message cannot
        combine a legitimate file with a method name of its own choosing and have the host go
        looking for it.
    */
    static buildOpenTargetKey(filePath: string, methodName: string): string {
        return `${filePath}::${methodName}`;
    }

    /*
        Every generated spec method the model names, keyed by the class file it lives in. An object
        whose class file path is unknown -- every object in a metadata preview -- contributes
        nothing, which is correct: no generated code asserts it, so there is nothing to open.
    */
    static collectOpenableSpecTargets(viewModel: IPicklistDependencyExplorerViewModel): string[] {

        let openableSpecTargets: string[] = [];

        viewModel.objects.forEach(objectViewModel => {

            if ( !objectViewModel.generatedClassFilePath ) {
                return;
            }

            this.flattenNodes(objectViewModel.rootNodes).forEach(node => {

                if ( node.specMethodName ) {
                    openableSpecTargets.push(this.buildOpenTargetKey(objectViewModel.generatedClassFilePath, node.specMethodName));
                }

                node.recordTypeScopes.forEach(recordTypeScope => {

                    if ( recordTypeScope.specMethodName ) {
                        openableSpecTargets.push(this.buildOpenTargetKey(objectViewModel.generatedClassFilePath, recordTypeScope.specMethodName));
                    }

                });

            });

        });

        return openableSpecTargets;

    }

    /*
        Every run report entry the model names. There is exactly one report file, so the pair is
        what constrains this: the panel may scroll to the entry for an object the model rendered,
        and to nothing else in the file.
    */
    static collectOpenableRunReportTargets(viewModel: IPicklistDependencyExplorerViewModel): string[] {

        const runReportFilePath = viewModel.runSummary?.reportFilePath;

        if ( !runReportFilePath ) {
            return [];
        }

        return viewModel.objects
            .filter(objectViewModel => !!objectViewModel.testMethodName)
            .map(objectViewModel => this.buildOpenTargetKey(runReportFilePath, objectViewModel.testMethodName));

    }

    /*
        Every combination key the model declares, which is what the panel may ask to be copied. A
        key is metadata-derived text and reaches the clipboard verbatim, so it is matched against
        this set rather than trusted -- the panel cannot make the host copy something it never
        rendered.
    */
    static collectCombinationKeys(viewModel: IPicklistDependencyExplorerViewModel): string[] {

        let combinationKeys: string[] = [];

        viewModel.objects.forEach(objectViewModel => {

            this.flattenNodes(objectViewModel.rootNodes).forEach(node => {

                node.combinations.forEach(combination => combinationKeys.push(combination.combinationKey));

                node.recordTypeScopes.forEach(recordTypeScope => {
                    recordTypeScope.combinations.forEach(combination => combinationKeys.push(combination.combinationKey));
                });

            });

        });

        return combinationKeys;

    }

    /*
        The 1-based line a generated Apex method is DECLARED on, or 0 when the file does not declare
        it.

        A generated class names each spec method twice -- once where it is declared and once in the
        aggregate that returns them all -- so the first textual hit is as likely to be the call site
        as the declaration. A line opening with a modifier or an annotation is taken as the
        declaration; the first hit is the fallback, which still lands the reader inside the right
        class rather than nowhere.
    */
    static findApexMethodDeclarationLineNumber(apexClassContent: string, methodName: string): number {

        if ( !apexClassContent || !methodName ) {
            return 0;
        }

        const apexClassLines = apexClassContent.split(/\r?\n/);
        let firstMentionLineNumber = 0;

        for ( let lineIndex = 0; lineIndex < apexClassLines.length; lineIndex++ ) {

            const apexClassLine = apexClassLines[lineIndex];

            if ( apexClassLine.indexOf(`${methodName}(`) === -1 ) {
                continue;
            }

            if ( firstMentionLineNumber === 0 ) {
                firstMentionLineNumber = lineIndex + 1;
            }

            if ( /^\s*(?:@|public\b|private\b|protected\b|global\b|static\b|testmethod\b)/i.test(apexClassLine) ) {
                return lineIndex + 1;
            }

        }

        return firstMentionLineNumber;

    }

    /*
        The 1-based line the run report describes a test method on, or 0 when it describes none.

        "report.md" names a method twice: once in the methods table and once as a "### " heading
        under the failure detail. The heading is preferred because it is the entry that carries the
        message, and the table row is the fallback for a run where the method passed and no heading
        was written.
    */
    static findRunReportEntryLineNumber(runReportContent: string, methodName: string): number {

        if ( !runReportContent || !methodName ) {
            return 0;
        }

        const runReportLines = runReportContent.split(/\r?\n/);
        let methodsTableLineNumber = 0;

        for ( let lineIndex = 0; lineIndex < runReportLines.length; lineIndex++ ) {

            const runReportLine = runReportLines[lineIndex];

            if ( runReportLine.trim() === `### ${methodName}` ) {
                return lineIndex + 1;
            }

            if ( methodsTableLineNumber === 0 && runReportLine.indexOf(`\`${methodName}\``) !== -1 ) {
                methodsTableLineNumber = lineIndex + 1;
            }

        }

        return methodsTableLineNumber;

    }

    /*
        The message that hands the panel a model to render.

        The model no longer passes through html at all: it is posted to the webview and arrives as a
        structured value, so there is no script block for a picklist value of "</script>" to close
        and no markup for one to inject into. That is why the escaping this class used to do on the
        way into the document is gone rather than merely unused -- the document it protected does not
        carry metadata any more, and every node the panel builds is written through textContent.

        The empty-state message travels with the model because it is prose ABOUT the model that the
        service composes: deriving it a second time inside the panel script would be the parallel
        derivation this feature keeps removing.
    */
    static buildRenderModelMessage(viewModel: IPicklistDependencyExplorerViewModel,
                                        loadStatusMessage: string = ''): IPicklistDependencyExplorerRenderMessage {

        return {
            command: 'renderModel',
            model: viewModel,
            emptyStateMessage: this.buildEmptyStateMessage(viewModel),
            message: loadStatusMessage
        };

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
        The shell only, and it no longer carries the model.

        Every colour is a VS Code theme variable, so the panel follows the active light, dark or high
        contrast theme without the extension having to know which is active, and the structure itself
        is rendered by the inline script.

        The model used to be serialized into a script block in this document, which meant the panel
        could not exist until the model did: the tab stayed blank through the manifest parse and the
        model build, and the whole payload was re-parsed out of the html on every reveal (the panel
        is deliberately not retained when hidden). The shell is now independent of the model and is
        set the moment the command runs, so the panel appears immediately and says what it is doing;
        the model arrives over postMessage, which is also what lets a reveal be answered from the
        host's copy rather than by re-serializing a multi-megabyte document.

        Nothing in here is derived from metadata, so nothing in here needs escaping. What arrives
        later is written through textContent by createElement, never through innerHTML -- the panel's
        "renders no unescaped metadata" property is now carried by the DOM api rather than by
        escaping into a script block.
    */
    static buildWebviewShellHtml(nonce: string): string {

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
    .objectHeading {
        font-size: 1.05rem;
        font-weight: 600;
        margin-bottom: 0.25rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
        cursor: pointer;
    }
    .objectHeading:hover { background-color: var(--vscode-list-hoverBackground); }
    .disclosure {
        font-family: var(--vscode-editor-font-family);
        color: var(--vscode-descriptionForeground);
        width: 1ch;
    }
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
    .combination.focused { outline: 2px solid var(--vscode-focusBorder); }
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
    /* NESTED INSIDE .recordTypeGroup, WHICH ALREADY CARRIES THE INDENT AND THE RULE */
    .recordTypeScopes { margin: 0.2rem 0; }
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
    /* THE TRIAGE SITS BENEATH THE APEX TEXT, NEVER IN PLACE OF IT -- SEE IPicklistDependencyFailureTriage */
    .triage {
        border-left: 3px solid var(--vscode-testing-iconFailed);
        padding: 0.3rem 0.6rem;
        margin: 0 0 0.35rem 0;
    }
    .triageLine { margin: 0.15rem 0; }
    .triageLabel { font-weight: 600; margin-right: 0.35rem; }
    .sourceDetail { margin-top: 0.4rem; }
    .actions { display: flex; gap: 0.4rem; flex-wrap: wrap; }
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
    .toolbar {
        display: flex;
        align-items: flex-end;
        gap: 0.75rem;
        flex-wrap: wrap;
        padding: 0.5rem 0 0.75rem 0;
        border-bottom: 1px solid var(--vscode-panel-border);
        margin-bottom: 0.75rem;
        position: sticky;
        top: 0;
        background-color: var(--vscode-editor-background);
        z-index: 1;
    }
    .toolbarField { display: flex; flex-direction: column; gap: 0.15rem; }
    .toolbarLabel { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground); }
    .toolbar input, .toolbar select {
        color: var(--vscode-input-foreground);
        background-color: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
        padding: 0.2rem 0.35rem;
        font-family: inherit;
        font-size: inherit;
    }
    .toolbar input { min-width: 22rem; }
    .matchCount { flex-basis: 100%; color: var(--vscode-descriptionForeground); font-size: 0.85em; }
    .warningList { border-left: 3px solid var(--vscode-testing-iconQueued); padding-left: 0.75rem; }
    .truncationNotice {
        border-left: 3px solid var(--vscode-testing-iconQueued);
        padding: 0.3rem 0.75rem;
        margin: 0.25rem 0;
        color: var(--vscode-descriptionForeground);
        font-size: 0.9em;
    }
    .emptyState { padding: 1rem; border: 1px dashed var(--vscode-panel-border); }
    /*
        The phase the load is in, above the structure rather than inside it. It is the only thing on
        screen before the model arrives, and it is removed -- not just emptied -- once the last phase
        resolves, so a loaded panel carries no residue of how it got there.
    */
    .loadStatus {
        padding: 0.6rem 0.75rem;
        margin-bottom: 0.6rem;
        border-left: 3px solid var(--vscode-testing-iconQueued);
        color: var(--vscode-descriptionForeground);
    }
    .specOrigin { font-family: var(--vscode-editor-font-family); font-size: 0.8rem; color: var(--vscode-descriptionForeground); margin: 0.1rem 0 0.3rem 0; }
    .provenanceBanner { padding: 0.6rem 0.75rem; margin-bottom: 0.6rem; border-left: 3px solid var(--vscode-panel-border); }
    .provenanceBanner.stale { border-left-color: var(--vscode-testing-iconQueued); }
    .provenanceBanner.preview { border-left-color: var(--vscode-testing-iconQueued); }
    .skippedField { border-left: 3px solid var(--vscode-testing-iconQueued); padding-left: 0.75rem; margin: 0.35rem 0; }
    .skippedBadge { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-testing-iconQueued); margin-left: 0.5rem; }
    /*
        The forbidden complement is the longest thing on a row and the least often read: a field
        with a 40 value picklist forbids 36 of them under every controlling value. Collapsed, its
        summary still states the count, so the row says how much it is holding back.
    */
    .valueListSummary { cursor: pointer; display: flex; align-items: baseline; gap: 0.35rem; }
    .valueListSummary:hover { text-decoration: underline; }
    .valueListValues { margin-top: 0.1rem; }
    .valueCount { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
    .recordTypeGroup {
        border-left: 2px solid var(--vscode-panel-border);
        margin: 0.5rem 0 0.2rem 1rem;
        padding-left: 0.6rem;
    }
    .recordTypeGroupHeading {
        display: flex;
        align-items: baseline;
        gap: 0.4rem;
        flex-wrap: wrap;
        cursor: pointer;
        padding: 0.15rem 0;
    }
    .recordTypeGroupHeading:hover { background-color: var(--vscode-list-hoverBackground); }
    .recordTypeGroupLabel {
        font-weight: 600;
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }
    .tableOfContents {
        border: 1px solid var(--vscode-panel-border);
        padding: 0.4rem 0.6rem 0.5rem 0.6rem;
        margin-bottom: 0.75rem;
    }
    .tableOfContentsHeading {
        display: flex;
        align-items: baseline;
        gap: 0.4rem;
        cursor: pointer;
        font-weight: 600;
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }
    .tableOfContentsGroupLabel {
        color: var(--vscode-descriptionForeground);
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin: 0.4rem 0 0.1rem 0;
    }
    .tocEntry {
        display: flex;
        align-items: baseline;
        gap: 0.4rem;
        flex-wrap: wrap;
        cursor: pointer;
        padding: 0.12rem 0.3rem 0.12rem 0.75rem;
    }
    .tocEntry:hover { background-color: var(--vscode-list-hoverBackground); }
    .hidden { display: none; }
</style>
</head>
<body>
<h1>Picklist Dependency Explorer</h1>
<div id="scannedPath" class="muted hidden">Scanned <span id="scannedPathValue" class="sourcePath"></span></div>
<div id="loadStatus" class="loadStatus">Opening the Picklist Dependency Explorer…</div>
<div id="explorerRoot"></div>
<script nonce="${nonce}">
(function () {

    const vscodeApi = acquireVsCodeApi();
    const explorerRoot = document.getElementById('explorerRoot');
    const loadStatusElement = document.getElementById('loadStatus');
    const scannedPathElement = document.getElementById('scannedPath');
    const scannedPathValueElement = document.getElementById('scannedPathValue');

    /*
        Assigned when the host posts the model. Everything below reads it, and nothing below runs
        before it exists -- renderPanel is the only caller of the render functions, and it is called
        only from the renderModel message.
    */
    let explorerModel;
    let emptyStateMessage = '';

    const EXPAND_ALL_OBJECT_LIMIT = ${PICKLIST_DEPENDENCY_EXPLORER_EXPAND_ALL_OBJECT_LIMIT};

    /*
        One record per object section. An object's ROWS are not built until it is expanded, so what
        the panel holds at load is this list and a heading each -- the pathological org measured in
        #80 built every row of every record type up front, which is where the element count came
        from. Filtering runs against the model on these records rather than against the DOM, so it
        costs the same whether an object has been expanded or not.
    */
    let objectSectionRecords = [];

    let filterText = '';
    let filterStatus = 'all';
    /*
        A pasted combination reference addresses ONE row, and the row it addresses does not match the
        reference as ordinary search text -- the key carries a controlling value no field name
        contains. Node filtering is suspended while one is active, or the deep link would scroll to a
        row its own query had just hidden.
    */
    let isDeepLinkActive = false;
    let matchCountElement;
    let focusedCombinationElement;

    /*
        The panel's named sections, in the order they were rendered, each with the element the table
        of contents scrolls to. Registered by the renderer that builds a section rather than listed
        up front: a section the panel did not render must not appear in its contents, and the
        renderer is the only place that knows whether it did.
    */
    let panelSectionRecords = [];

    function registerPanelSection(labelText, sectionElement) {
        panelSectionRecords.push({ label: labelText, element: sectionElement });
    }

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
        The same list behind a disclosure, for the one value list that is long by construction.

        A combination's forbidden set is the COMPLEMENT of what it unlocks, so it grows as the
        field's picklist grows while the unlock list stays short -- the values a reader came for
        were being pushed off screen by the values they did not. The summary carries the count, so
        a collapsed row still states how many values it is holding, and the count is taken from the
        rendered list rather than computed a second way.

        startExpanded is the failed row: it opens with its detail already showing for the same
        reason, and the forbidden set is what a MISSING_VALUES or EXTRA_VALUES failure is about.
    */
    function appendCollapsibleValueList(parentElement, labelText, values, valueClassName, startExpanded) {

        if (!values.length) { return; }

        const valueListElement = createElement('div', 'valueList');

        const summaryElement = createElement('div', 'valueListSummary');
        const disclosureElement = createElement('span', 'disclosure', startExpanded ? '▾' : '▸');
        summaryElement.appendChild(disclosureElement);
        summaryElement.appendChild(createElement('span', 'valueLabel', labelText));
        summaryElement.appendChild(createElement('span', 'valueCount', '(' + values.length + ')'));
        valueListElement.appendChild(summaryElement);

        const valuesElement = createElement('div', 'valueListValues' + (startExpanded ? '' : ' hidden'));
        values.forEach(function (value) {
            valuesElement.appendChild(createElement('span', valueClassName, value));
        });
        valueListElement.appendChild(valuesElement);

        /*
            Stopped here rather than allowed to bubble: the combination row's own click toggles its
            source detail, so without this, opening the forbidden list would also open the actions
            block underneath it.
        */
        summaryElement.addEventListener('click', function (clickEvent) {
            clickEvent.stopPropagation();
            valuesElement.classList.toggle('hidden');
            disclosureElement.textContent = valuesElement.classList.contains('hidden') ? '▸' : '▾';
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

    function appendTriage(parentElement, triage) {

        if (!triage) { return; }

        const triageElement = createElement('div', 'triage');

        const likelyCauseElement = createElement('div', 'triageLine');
        likelyCauseElement.appendChild(createElement('span', 'triageLabel', 'Likely cause'));
        likelyCauseElement.appendChild(createElement('span', undefined, triage.likelyCause));
        triageElement.appendChild(likelyCauseElement);

        const nextStepElement = createElement('div', 'triageLine');
        nextStepElement.appendChild(createElement('span', 'triageLabel', 'Next step'));
        nextStepElement.appendChild(createElement('span', undefined, triage.nextStep));
        triageElement.appendChild(nextStepElement);

        parentElement.appendChild(triageElement);

    }

    /*
        The Apex kind and message FIRST, the plain-language reading beneath it. A reader who already
        knows what MISSING_VALUES means should not have to scroll past a paragraph to find the values
        it names, and a reader who does not should not have to look the kind up elsewhere.
    */
    /*
        A recognised kind's triage lives once in the model, keyed by kind; only an unrecognised kind
        carries its own, because that text names the kind. Looked up here rather than inlined per
        failure so the payload grows with the org's SIZE rather than with its drift.
    */
    function resolveTriage(failure) {
        return failure.triage || explorerModel.failureTriageByKind[failure.kind];
    }

    function appendFailureDetails(parentElement, failures) {
        failures.forEach(function (failure) {
            parentElement.appendChild(createElement('div', 'failureDetail', failure.kind + '\\n' + failure.message));
            appendTriage(parentElement, resolveTriage(failure));
        });
    }

    function appendTruncationNotice(parentElement, truncatedCount, itemLabel) {

        if (!truncatedCount) { return; }

        parentElement.appendChild(createElement('div', 'truncationNotice',
            truncatedCount + ' ' + itemLabel + ' not shown at this panel\\'s rendering limit. '
                + 'Every one the check reported a failure for is shown.'));

    }

    function buildCombinationElement(node, objectViewModel, combination, declaredValues, declaredValuesTruncated, specMethodName, sectionRecord) {

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

        /*
            The complement is drawn only against a COMPLETE declared list. Where the ceiling capped
            that universe, a complement of it would understate what the spec forbids -- a false
            claim rather than a shorter one -- so the row says the list is not shown instead.
        */
        if (declaredValuesTruncated) {
            combinationElement.appendChild(createElement('div', 'valueList muted',
                'must not unlock: not shown — this field declares more values than the panel renders, '
                    + 'and a complement of a partial list would understate what the spec forbids'));
        } else {
            appendCollapsibleValueList(
                combinationElement,
                'must not unlock',
                buildForbiddenValues(declaredValues, combination),
                'value forbidden',
                combination.status === 'failed'
            );
        }
        appendFailureDetails(combinationElement, combination.failures);

        const detailElement = createElement('div', 'sourceDetail');
        detailElement.appendChild(createElement('div', 'sourcePath', node.sourceFilePath));

        const actionsElement = createElement('div', 'actions');

        const revealButton = createElement('button', undefined, 'Reveal in Explorer');
        revealButton.addEventListener('click', function (clickEvent) {
            clickEvent.stopPropagation();
            vscodeApi.postMessage({ command: 'revealFieldSource', sourceFilePath: node.sourceFilePath });
        });
        actionsElement.appendChild(revealButton);

        /*
            Offered only where the model NAMES the generated code. A metadata preview names none of
            it, and a button that opened nothing would suggest a spec exists for a row nothing
            asserts -- the exact confusion the provenance banner exists to prevent.
        */
        if (specMethodName && objectViewModel.generatedClassFilePath) {

            const specMethodButton = createElement('button', undefined, 'Open spec method');
            specMethodButton.addEventListener('click', function (clickEvent) {
                clickEvent.stopPropagation();
                vscodeApi.postMessage({
                    command: 'openSpecMethod',
                    specFilePath: objectViewModel.generatedClassFilePath,
                    methodName: specMethodName
                });
            });
            actionsElement.appendChild(specMethodButton);

        }

        const runReportFilePath = explorerModel.runSummary ? explorerModel.runSummary.reportFilePath : '';

        if (runReportFilePath && objectViewModel.testMethodName) {

            const runReportButton = createElement('button', undefined, 'Open run report entry');
            runReportButton.addEventListener('click', function (clickEvent) {
                clickEvent.stopPropagation();
                vscodeApi.postMessage({
                    command: 'openRunReport',
                    reportFilePath: runReportFilePath,
                    methodName: objectViewModel.testMethodName
                });
            });
            actionsElement.appendChild(runReportButton);

        }

        /*
            The combination key is the panel's address for one row: pasting it back into the find box
            above reopens exactly this combination, in this object, under this record type. It is the
            same key the manifest recorded and failures are attributed by, so it is stable across
            re-renders in a way a scroll position is not.
        */
        const copyReferenceButton = createElement('button', undefined, 'Copy reference');
        copyReferenceButton.addEventListener('click', function (clickEvent) {
            clickEvent.stopPropagation();
            vscodeApi.postMessage({ command: 'copyCombinationReference', combinationKey: combination.combinationKey });
        });
        actionsElement.appendChild(copyReferenceButton);

        detailElement.appendChild(actionsElement);
        combinationElement.appendChild(detailElement);

        /*
            A FAILED combination opens with its detail already showing. It is the row the reader came
            for, and the links to the spec method and the run entry are what turns "what broke" into
            "where do I go" -- putting them behind a click on a row already marked failed is a step
            with nothing on the other side of it.
        */
        if (combination.status !== 'failed') {
            detailElement.classList.add('hidden');
        }

        combinationElement.addEventListener('click', function () {
            detailElement.classList.toggle('hidden');
        });

        sectionRecord.combinationElementsByKey[combination.combinationKey.toLowerCase()] = combinationElement;

        return combinationElement;

    }

    function buildRecordTypeScopeElement(node, objectViewModel, recordTypeScope, sectionRecord, revealRecordTypeGroup) {

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

            if (scopeBodyBuilt) { return; }
            scopeBodyBuilt = true;

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
                scopeBodyElement.appendChild(buildCombinationElement(
                    node,
                    objectViewModel,
                    combination,
                    recordTypeScope.declaredValues,
                    recordTypeScope.declaredValuesTruncated,
                    recordTypeScope.specMethodName,
                    sectionRecord
                ));
            });

            appendTruncationNotice(scopeBodyElement, recordTypeScope.truncatedCombinationCount, 'combination(s) in this scope are');

        };

        /*
            BUILDS AND SHOWS THE SCOPE, FOR A DEEP LINK THAT LANDS INSIDE IT RATHER THAN ON A FIELD LEVEL ROW.
            The GROUP is opened too: the scopes live inside a collapsed disclosure, so revealing only
            the scope body would scroll the panel to a row inside a hidden parent.
        */
        sectionRecord.scopeRevealers.push(function () {
            revealRecordTypeGroup();
            buildScopeBody();
            scopeBodyElement.classList.remove('hidden');
        });

        scopeHeading.addEventListener('click', function () {
            buildScopeBody();
            scopeBodyElement.classList.toggle('hidden');
        });

        return scopeElement;

    }

    /*
        Every record type that narrows this field, under ONE labelled disclosure rather than appended
        flat beneath the field level rows.

        The separation is the point. A field level combination is asserted by the generated check; a
        record-type-scoped one is not, and running them together as siblings made a reader work out
        which kind of row they were reading from the wording of a note. It is also where the volume
        is -- every record type repeats the whole field's combinations.

        The header carries NO passed/unknown status badge. Apex describe returns picklist values
        without record type filtering, so nothing in the shipped framework verifies a scoped row; a
        green badge over the group would assert exactly what each scope's note exists to deny. A
        failed count is different -- it is a statement about scopes a run DID report against.
    */
    function buildRecordTypeGroupElement(node, objectViewModel, sectionRecord) {

        const groupElement = createElement('div', 'recordTypeGroup');

        const failedScopeCount = node.recordTypeScopes.filter(function (recordTypeScope) {
            return recordTypeScope.status === 'failed';
        }).length;

        const headingElement = createElement('div', 'recordTypeGroupHeading');
        const disclosureElement = createElement('span', 'disclosure', '▸');
        headingElement.appendChild(disclosureElement);
        headingElement.appendChild(createElement('span', 'recordTypeGroupLabel',
            'Record Types (' + node.recordTypeScopes.length + ')'));

        if (failedScopeCount) {
            headingElement.appendChild(createElement('span', 'statusBadge failed', failedScopeCount + ' failed'));
        }

        groupElement.appendChild(headingElement);

        /*
            OUTSIDE the collapsible body, directly under the header that would otherwise misstate it.

            The header states the count of scopes the panel RENDERS. Where the ceiling dropped some,
            that number is not the field's record type count, and a notice explaining the difference
            is no use behind a click the reader has no reason to make -- they would be looking at
            "Record Types (25)" with nothing to suggest there were 40. A dropped row is counted in a
            notice the reader can SEE, which is the whole of the invariant; the panel-level aggregate
            is not a substitute, because it does not name this field.
        */
        appendTruncationNotice(groupElement, node.truncatedRecordTypeScopeCount, 'record type scope(s) are');

        const groupBodyElement = createElement('div', 'recordTypeScopes hidden');

        /*
            Who opened the group, not just whether it is open.

            The find box fires on every keystroke, and a substring match on a PREFIX of the query can
            name a record type the finished query does not: typing "Status__c" matches "Master" on
            its first letter. Reopening on every keystroke and never closing would leave the reader
            looking at exactly the wall of record type headings this group exists to collapse, opened
            by a query that no longer matches anything.

            So a group the FILTER opened, the filter closes again when its match lapses. And the
            moment the reader touches a group at all -- opening it, closing it, or following a pasted
            reference into it -- the filter stops managing that group entirely, in BOTH directions:
            reopening one they just shut is the same kind of wrong as leaving one open that no longer
            matches.
        */
        let isReaderManaged = false;
        let isOpenedByFilter = false;

        // GUARDED SO A KEYSTROKE THAT CHANGES NOTHING WRITES NOTHING -- applyFilter RUNS THESE PER NODE
        const openGroup = function () {

            if (!groupBodyElement.classList.contains('hidden')) { return; }

            groupBodyElement.classList.remove('hidden');
            disclosureElement.textContent = '▾';

        };

        const closeGroup = function () {

            if (groupBodyElement.classList.contains('hidden')) { return; }

            groupBodyElement.classList.add('hidden');
            disclosureElement.textContent = '▸';

        };

        // THE READER'S OWN REVEAL: A CLICK, OR A DEEP LINK THEY PASTED. THE FILTER MAY NOT UNDO IT.
        const revealRecordTypeGroup = function () {
            isReaderManaged = true;
            openGroup();
        };

        const applyRecordTypeFilterMatch = function (isRecordTypeMatch) {

            if (isReaderManaged) { return; }

            if (isRecordTypeMatch) {
                isOpenedByFilter = true;
                openGroup();
                return;
            }

            if (!isOpenedByFilter) { return; }

            isOpenedByFilter = false;
            closeGroup();

        };

        /*
            The scope HEADINGS are built here, as they always were -- it is the scope BODIES that are
            lazy. Opening the group therefore builds nothing: it reveals headings that already exist,
            and each one still builds its own rows on first expand.
        */
        node.recordTypeScopes.forEach(function (recordTypeScope) {
            groupBodyElement.appendChild(buildRecordTypeScopeElement(
                node, objectViewModel, recordTypeScope, sectionRecord, revealRecordTypeGroup));
        });

        headingElement.addEventListener('click', function () {

            if (groupBodyElement.classList.contains('hidden')) {
                revealRecordTypeGroup();
                return;
            }

            // CLOSING IT IS THE READER'S TOO: THE NEXT KEYSTROKE MUST NOT REOPEN WHAT THEY JUST SHUT
            isReaderManaged = true;
            isOpenedByFilter = false;
            closeGroup();

        });

        groupElement.appendChild(groupBodyElement);

        return {
            element: groupElement,
            reveal: revealRecordTypeGroup,
            applyFilterMatch: applyRecordTypeFilterMatch
        };

    }

    function buildNodeElement(node, objectViewModel, sectionRecord) {

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
            nodeElement.appendChild(buildCombinationElement(node, objectViewModel, combination, node.declaredValues, node.declaredValuesTruncated, node.specMethodName, sectionRecord));
        });

        appendTruncationNotice(nodeElement, node.truncatedCombinationCount, 'combination(s) are');

        /*
            The group's own reveal, held on the node record so a find-box query naming a record type
            can open the disclosure holding it. Without it, searching a record type name would filter
            the panel down to the node that has it and then show nothing of what was searched for.
        */
        let revealRecordTypeGroup;
        let applyRecordTypeGroupFilterMatch;
        let recordTypeSearchText = '';

        if (node.recordTypeScopes.length) {

            const recordTypeGroup = buildRecordTypeGroupElement(node, objectViewModel, sectionRecord);
            revealRecordTypeGroup = recordTypeGroup.reveal;
            applyRecordTypeGroupFilterMatch = recordTypeGroup.applyFilterMatch;
            nodeElement.appendChild(recordTypeGroup.element);

            /*
                Lowercased ONCE here, not per keystroke.

                applyFilter runs on every input event across every built node record, and built
                objects accumulate over a session -- they are never un-built. Lowercasing each scope
                name inside that loop allocated a fresh string per scope per keystroke, which measured
                27ms per keystroke at 250 built objects against 1.4ms before this panel had the
                filter at all. Names do not change after the model is built, so the haystack does not
                either.

                Joined on a NEWLINE rather than a space so one indexOf is exactly equivalent to
                testing each name separately: a record type developer name is [A-Za-z0-9_], and the
                find box is an <input type="search"> whose value can never contain a newline, so no
                query can match across the join. A space separator would not hold -- "foo bar" could
                match the tail of one name and the head of the next.
            */
            recordTypeSearchText = node.recordTypeScopes
                .map(function (recordTypeScope) { return recordTypeScope.recordTypeDeveloperName; })
                .join('\n')
                .toLowerCase();

        }

        if (node.downstreamNodes.length) {
            const childrenElement = createElement('div', 'nodeChildren');
            node.downstreamNodes.forEach(function (downstreamNode) {
                childrenElement.appendChild(buildNodeElement(downstreamNode, objectViewModel, sectionRecord));
            });
            nodeElement.appendChild(childrenElement);
        }

        sectionRecord.nodeRecords.push({
            node: node,
            element: nodeElement,
            revealRecordTypeGroup: revealRecordTypeGroup,
            applyRecordTypeGroupFilterMatch: applyRecordTypeGroupFilterMatch,
            recordTypeSearchText: recordTypeSearchText
        });

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
        /*
            Pending is NOT stale. The walk that answers this has not run yet, so the banner says it
            is checking rather than reporting either answer -- claiming "fresh" here would assert
            agreement with metadata nothing has looked at, and claiming "stale" would send a reader
            to regenerate over a difference that may not exist.
        */
        const isPendingFreshness = explorerModel.manifestFreshness === 'pendingCheck';
        const isStale = !isPendingFreshness && explorerModel.manifestFreshness !== 'fresh';

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

            registerPanelSection('Preview from metadata', bannerElement);
            explorerRoot.appendChild(bannerElement);
            return;

        }

        let provenanceHeading = 'Generated specs';
        if (isStale) {
            provenanceHeading = 'Generated specs — your metadata has changed since they were generated';
        } else if (isPendingFreshness) {
            provenanceHeading = 'Generated specs — checking whether they still match your metadata…';
        }

        bannerElement.appendChild(createElement('div', 'fieldName', provenanceHeading));

        if (isStale) {
            bannerElement.appendChild(createElement('div', undefined, explorerModel.manifestFreshnessMessage));
        }

        bannerElement.appendChild(createElement('div', 'muted',
            'Generated at ' + explorerModel.generatedAt + ' by Treecipe ' + explorerModel.generatorVersion
                + ' — asserted by ' + explorerModel.specsTestClassName + '.cls'));
        bannerElement.appendChild(createElement('div', 'sourcePath', explorerModel.manifestFilePath));

        registerPanelSection(isStale ? 'Generated specs — stale' : 'Generated specs', bannerElement);
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

        registerPanelSection('Last check', bannerElement);
        explorerRoot.appendChild(bannerElement);

    }

    /*
        What the rendering ceiling dropped, at the top rather than beside the rows that survived it.
        A reader who cannot find a field needs to know the panel is not showing everything before
        they conclude the field has no dependency.
    */
    function renderTruncationNotices() {

        if (!explorerModel.truncationNotices.length) { return; }

        const noticesElement = createElement('div');

        explorerModel.truncationNotices.forEach(function (truncationNotice) {
            noticesElement.appendChild(createElement('div', 'truncationNotice', truncationNotice));
        });

        registerPanelSection('Rendering limits', noticesElement);
        explorerRoot.appendChild(noticesElement);

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
        registerPanelSection('Not asserted', warningsElement);
        explorerRoot.appendChild(warningsElement);

    }

    function buildObjectBody(sectionRecord) {

        if (sectionRecord.built) { return; }
        sectionRecord.built = true;

        const objectViewModel = sectionRecord.objectViewModel;
        const bodyElement = sectionRecord.bodyElement;

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

            bodyElement.appendChild(skippedElement);

        });

        if (objectViewModel.unattributedFailureMessages.length) {
            bodyElement.appendChild(createElement('div', 'failureDetail',
                'This object\\'s check reported failures that could not be tied to a specific combination below, '
                    + 'so those combinations are shown as not checked rather than passed.\\n\\n'
                    + objectViewModel.unattributedFailureMessages.join('\\n')));
        }

        objectViewModel.rootNodes.forEach(function (rootNode) {
            bodyElement.appendChild(buildNodeElement(rootNode, objectViewModel, sectionRecord));
        });

        appendTruncationNotice(bodyElement, objectViewModel.truncatedNodeCount, 'dependent picklist(s) on this object are');

    }

    function expandObject(sectionRecord) {

        buildObjectBody(sectionRecord);
        sectionRecord.bodyElement.classList.remove('hidden');
        sectionRecord.disclosureElement.textContent = '▾';
        applyNodeFilter(sectionRecord);

    }

    function collapseObject(sectionRecord) {

        sectionRecord.bodyElement.classList.add('hidden');
        sectionRecord.disclosureElement.textContent = '▸';

    }

    function buildObjectSectionRecord(objectViewModel) {

        const sectionElement = createElement('div', 'objectSection');

        const sectionRecord = {
            objectViewModel: objectViewModel,
            sectionElement: sectionElement,
            bodyElement: createElement('div', 'objectBody hidden'),
            disclosureElement: createElement('span', 'disclosure', '▸'),
            built: false,
            nodeRecords: [],
            scopeRevealers: [],
            /*
                Object.create(null) rather than {}: the keys are metadata-derived text, and a bare
                object literal makes "__proto__" and "constructor" mean something other than a key.
                buildCombinationKey's format happens to make that unreachable today, but that is an
                invariant in another file rather than a property of this lookup.
            */
            combinationElementsByKey: Object.create(null),
            // SET WHEN THE CONTENTS IS BUILT, WHICH HAPPENS AFTER EVERY SECTION RECORD EXISTS
            tableOfContentsEntryElement: undefined
        };

        const objectHeading = createElement('div', 'objectHeading');
        objectHeading.appendChild(sectionRecord.disclosureElement);
        objectHeading.appendChild(createElement('span', undefined, objectViewModel.objectApiName));
        objectHeading.appendChild(createElement('span', 'muted',
            objectViewModel.dependentFieldCount + ' dependent picklist(s), ' + objectViewModel.combinationCount + ' combination(s)'
                + (objectViewModel.recordTypeCombinationCount ? ' + ' + objectViewModel.recordTypeCombinationCount + ' record-type-scoped' : '')));
        appendStatusBadge(objectHeading, objectViewModel.status);

        if (objectViewModel.skippedFields.length) {
            objectHeading.appendChild(createElement('span', 'skippedBadge', objectViewModel.skippedFields.length + ' not asserted'));
        }

        objectHeading.addEventListener('click', function () {

            if (sectionRecord.bodyElement.classList.contains('hidden')) {
                expandObject(sectionRecord);
                return;
            }

            collapseObject(sectionRecord);

        });

        sectionElement.appendChild(objectHeading);

        if (objectViewModel.generatedClassName) {
            sectionElement.appendChild(createElement('div', 'specOrigin',
                objectViewModel.generatedClassName + '.cls'
                    + (objectViewModel.testMethodName ? ' — test method ' + objectViewModel.testMethodName + '()' : '')));
        }

        sectionElement.appendChild(sectionRecord.bodyElement);

        return sectionRecord;

    }

    function objectMatchesFilter(objectViewModel) {

        if (filterStatus !== 'all' && objectViewModel.status !== filterStatus) { return false; }

        if (!filterText) { return true; }

        return objectViewModel.searchText.indexOf(filterText) !== -1;

    }

    /*
        A node stays visible when it matches OR when anything beneath it does. A chain is drawn by
        containment, so hiding a parent whose child matches would take the matching row off the panel
        along with it.

        Filtering only ever toggles visibility. No status is recomputed here, and none is inferred
        from a row being hidden: an unverified combination stays unverified whether or not the filter
        is showing it.
    */
    function nodeMatchesFilter(node, isObjectNameMatch) {

        const textMatches = isObjectNameMatch || !filterText || node.searchText.indexOf(filterText) !== -1;
        const statusMatches = filterStatus === 'all' || node.status === filterStatus;

        if (textMatches && statusMatches) { return true; }

        for (let downstreamIndex = 0; downstreamIndex < node.downstreamNodes.length; downstreamIndex++) {
            if (nodeMatchesFilter(node.downstreamNodes[downstreamIndex], isObjectNameMatch)) { return true; }
        }

        return false;

    }

    function showEveryNode(sectionRecord) {

        sectionRecord.nodeRecords.forEach(function (nodeRecord) {
            nodeRecord.element.classList.remove('hidden');
        });

    }

    function applyNodeFilter(sectionRecord) {

        if (!sectionRecord.built) { return; }

        if (isDeepLinkActive) {
            showEveryNode(sectionRecord);
            return;
        }

        const isObjectNameMatch = !filterText
            || sectionRecord.objectViewModel.objectApiName.toLowerCase().indexOf(filterText) !== -1;

        sectionRecord.nodeRecords.forEach(function (nodeRecord) {
            nodeRecord.element.classList.toggle('hidden', !nodeMatchesFilter(nodeRecord.node, isObjectNameMatch));
            applyRecordTypeGroupFilter(nodeRecord);
        });

    }

    /*
        A query naming a RECORD TYPE opens the group holding it, and stops naming it closes that
        group again.

        Record type names are part of a node's search text, so such a query already filters the panel
        down to the right field -- and then leaves the thing that was searched for behind a collapsed
        disclosure. The reverse matters just as much: a substring match on a PREFIX of the query names
        record types the finished query does not, so opening without ever closing would leave a wall
        of headings opened by a query that no longer matches. The group itself decides what to do with
        the match -- a group the reader has touched is no longer the filter's to manage.

        This still only toggles visibility. No status is recomputed, and none is inferred from a group
        being open or shut.
    */
    function applyRecordTypeGroupFilter(nodeRecord) {

        if (!nodeRecord.applyRecordTypeGroupFilterMatch) { return; }

        // ONE indexOf AGAINST A HAYSTACK LOWERCASED AT BUILD TIME -- SEE buildNodeElement
        const isRecordTypeMatch = !!filterText
            && nodeRecord.recordTypeSearchText.indexOf(filterText) !== -1;

        nodeRecord.applyRecordTypeGroupFilterMatch(isRecordTypeMatch);

    }

    /*
        A pasted combination reference, resolved to the object that declares it.

        The key is "Object.Field [RecordType] @ ControllingValue", so the object name is everything
        before the first dot and the " @ " is what distinguishes a reference from someone typing a
        field name. Guarded on that separator so an ordinary search never walks the model looking for
        a key that was never pasted.
    */
    function resolveCombinationDeepLinkRecord(queryText) {

        if (queryText.indexOf(' @ ') === -1) { return undefined; }

        const objectApiNameSeparatorIndex = queryText.indexOf('.');
        if (objectApiNameSeparatorIndex === -1) { return undefined; }

        const objectApiName = queryText.slice(0, objectApiNameSeparatorIndex);

        return objectSectionRecords.filter(function (sectionRecord) {
            return sectionRecord.objectViewModel.objectApiName.toLowerCase() === objectApiName;
        })[0];

    }

    function focusCombination(sectionRecord, combinationKey) {

        expandObject(sectionRecord);

        // A REFERENCE CAN NAME A RECORD TYPE SCOPED ROW, WHICH IS NOT BUILT UNTIL ITS SCOPE IS OPENED
        sectionRecord.scopeRevealers.forEach(function (revealScopeBody) { revealScopeBody(); });

        const combinationElement = sectionRecord.combinationElementsByKey[combinationKey];
        if (!combinationElement) { return; }

        if (focusedCombinationElement) { focusedCombinationElement.classList.remove('focused'); }

        combinationElement.classList.add('focused');
        focusedCombinationElement = combinationElement;
        combinationElement.scrollIntoView({ block: 'center' });

    }

    function applyFilter() {

        const deepLinkRecord = resolveCombinationDeepLinkRecord(filterText);

        // SET BEFORE ANY SECTION IS TOUCHED: applyNodeFilter READS IT, AND expandObject CALLS THAT
        isDeepLinkActive = !!deepLinkRecord;

        let visibleSectionRecords = [];

        objectSectionRecords.forEach(function (sectionRecord) {

            const isVisible = deepLinkRecord
                ? sectionRecord === deepLinkRecord
                : objectMatchesFilter(sectionRecord.objectViewModel);

            sectionRecord.sectionElement.classList.toggle('hidden', !isVisible);

            if (sectionRecord.tableOfContentsEntryElement) {
                sectionRecord.tableOfContentsEntryElement.classList.toggle('hidden', !isVisible);
            }

            if (isVisible) { visibleSectionRecords.push(sectionRecord); }

            applyNodeFilter(sectionRecord);

        });

        if (deepLinkRecord) {
            focusCombination(deepLinkRecord, filterText);
        } else if (visibleSectionRecords.length === 1 && (filterText || filterStatus !== 'all')) {
            // ONE MATCH IS AN ANSWER, NOT A LIST -- OPENING IT IS WHAT MAKES A NAMED FIELD REACHABLE WITHOUT SCROLLING
            expandObject(visibleSectionRecords[0]);
        }

        matchCountElement.textContent = visibleSectionRecords.length + ' of ' + objectSectionRecords.length
            + ' object(s) shown' + (deepLinkRecord ? ' — showing the object that declares the pasted reference' : '');

    }

    function expandAllVisibleObjects() {

        const visibleSectionRecords = objectSectionRecords.filter(function (sectionRecord) {
            return !sectionRecord.sectionElement.classList.contains('hidden');
        });

        /*
            Expanding is what BUILDS an object's rows, so an unbounded "expand all" is the render
            this panel's ceiling exists to prevent. Past the limit it says so rather than freezing.
        */
        if (visibleSectionRecords.length > EXPAND_ALL_OBJECT_LIMIT) {
            matchCountElement.textContent = visibleSectionRecords.length + ' object(s) shown — more than the '
                + EXPAND_ALL_OBJECT_LIMIT + ' this panel will expand at once. Filter to fewer objects first.';
            return;
        }

        visibleSectionRecords.forEach(expandObject);

    }

    function renderToolbar() {

        const toolbarElement = createElement('div', 'toolbar');

        const findFieldElement = createElement('label', 'toolbarField');
        findFieldElement.appendChild(createElement('span', 'toolbarLabel', 'Find object or field'));

        const findInputElement = document.createElement('input');
        findInputElement.type = 'search';
        findInputElement.placeholder = 'object, field, record type, or a pasted combination reference';
        findInputElement.addEventListener('input', function () {
            filterText = findInputElement.value.trim().toLowerCase();
            applyFilter();
        });
        findFieldElement.appendChild(findInputElement);
        toolbarElement.appendChild(findFieldElement);

        const statusFieldElement = createElement('label', 'toolbarField');
        statusFieldElement.appendChild(createElement('span', 'toolbarLabel', 'Status'));

        const statusSelectElement = document.createElement('select');
        [['all', 'any status'], ['failed', 'failed'], ['passed', 'passed'], ['unknown', 'not checked']].forEach(function (statusOption) {
            const statusOptionElement = document.createElement('option');
            statusOptionElement.value = statusOption[0];
            statusOptionElement.textContent = statusOption[1];
            statusSelectElement.appendChild(statusOptionElement);
        });
        statusSelectElement.addEventListener('change', function () {
            filterStatus = statusSelectElement.value;
            applyFilter();
        });
        statusFieldElement.appendChild(statusSelectElement);
        toolbarElement.appendChild(statusFieldElement);

        const expandAllButton = createElement('button', undefined, 'Expand all');
        expandAllButton.addEventListener('click', expandAllVisibleObjects);
        toolbarElement.appendChild(expandAllButton);

        const collapseAllButton = createElement('button', undefined, 'Collapse all');
        collapseAllButton.addEventListener('click', function () {
            objectSectionRecords.forEach(collapseObject);
        });
        toolbarElement.appendChild(collapseAllButton);

        matchCountElement = createElement('div', 'matchCount');
        toolbarElement.appendChild(matchCountElement);

        explorerRoot.appendChild(toolbarElement);

    }

    /*
        Jumping to an object the reader NAMED opens it and shows every one of its nodes, including the
        nodes the active query was hiding: naming the object outranks the query WITHIN it.

        What it deliberately does not do is un-hide the object itself. The retired toolbar select
        listed every object unconditionally, so it could reach one the filter had hidden; the contents
        lists what the panel is showing, so a hidden object has no entry to click in the first place.
        That is the trade the contents makes -- it can never give a second, disagreeing account of
        what is on screen -- and widening the query is how you reach an object it is excluding.
    */
    function jumpToObject(sectionRecord) {

        expandObject(sectionRecord);
        showEveryNode(sectionRecord);
        sectionRecord.sectionElement.scrollIntoView({ block: 'start' });

    }

    /*
        The shape of the panel, before scrolling it.

        Built from the RENDERED model and nothing else: every section entry comes from what a
        renderer registered, and every object entry addresses an object by the api name already on
        screen -- so the contents can name nothing the panel is not showing, and introduces no path
        and no allow-list entry of its own.

        Object entries follow the filter. A contents listing an object the filter has hidden is a
        second account of what is on screen, and the two would disagree the moment anyone typed.
    */
    function renderTableOfContents(tableOfContentsElement) {

        const headingElement = createElement('div', 'tableOfContentsHeading');
        const disclosureElement = createElement('span', 'disclosure', '▾');
        headingElement.appendChild(disclosureElement);
        headingElement.appendChild(createElement('span', undefined, 'Contents'));
        tableOfContentsElement.appendChild(headingElement);

        const bodyElement = createElement('div');
        tableOfContentsElement.appendChild(bodyElement);

        headingElement.addEventListener('click', function () {
            bodyElement.classList.toggle('hidden');
            disclosureElement.textContent = bodyElement.classList.contains('hidden') ? '▸' : '▾';
        });

        if (panelSectionRecords.length) {

            bodyElement.appendChild(createElement('div', 'tableOfContentsGroupLabel', 'Sections'));

            panelSectionRecords.forEach(function (panelSectionRecord) {

                const entryElement = createElement('div', 'tocEntry');
                entryElement.appendChild(createElement('span', undefined, panelSectionRecord.label));
                entryElement.addEventListener('click', function () {
                    panelSectionRecord.element.scrollIntoView({ block: 'start' });
                });

                bodyElement.appendChild(entryElement);

            });

        }

        bodyElement.appendChild(createElement('div', 'tableOfContentsGroupLabel',
            'Objects (' + objectSectionRecords.length + ')'));

        objectSectionRecords.forEach(function (sectionRecord) {

            const objectViewModel = sectionRecord.objectViewModel;

            const entryElement = createElement('div', 'tocEntry');
            entryElement.appendChild(createElement('span', 'fieldName', objectViewModel.objectApiName));
            entryElement.appendChild(createElement('span', 'muted',
                objectViewModel.dependentFieldCount + ' dependent picklist(s), '
                    + objectViewModel.combinationCount + ' combination(s)'));
            appendStatusBadge(entryElement, objectViewModel.status);

            if (objectViewModel.skippedFields.length) {
                entryElement.appendChild(createElement('span', 'skippedBadge',
                    objectViewModel.skippedFields.length + ' not asserted'));
            }

            entryElement.addEventListener('click', function () { jumpToObject(sectionRecord); });

            sectionRecord.tableOfContentsEntryElement = entryElement;
            bodyElement.appendChild(entryElement);

        });

    }

    function renderObjects() {

        if (!explorerModel.objects.length) {
            explorerRoot.appendChild(createElement('div', 'emptyState', emptyStateMessage));
            return;
        }

        explorerRoot.appendChild(createElement('div', 'muted',
            explorerModel.objects.length + ' object(s), ' + explorerModel.dependentFieldCount
                + ' dependent picklist(s), ' + explorerModel.combinationCount + ' combination(s)'
                + (explorerModel.recordTypeCombinationCount
                    ? ' + ' + explorerModel.recordTypeCombinationCount + ' record-type-scoped'
                    : '')));

        renderToolbar();

        /*
            Placed under the toolbar now and filled once the object sections exist: the contents
            entries hold the section records they scroll to, rather than looking an object up by name
            at click time.
        */
        const tableOfContentsElement = createElement('div', 'tableOfContents');
        explorerRoot.appendChild(tableOfContentsElement);

        explorerModel.objects.forEach(function (objectViewModel) {
            const sectionRecord = buildObjectSectionRecord(objectViewModel);
            objectSectionRecords.push(sectionRecord);
            explorerRoot.appendChild(sectionRecord.sectionElement);
        });

        renderTableOfContents(tableOfContentsElement);

        applyFilter();

    }

    /*
        Everything the panel draws, from a model that has just arrived.

        Called on every renderModel message rather than once at load: the panel is not retained when
        hidden, so a reveal reloads this document and asks the host for the model again, and a
        re-render has to leave no trace of the previous one. Every piece of render state lives in the
        variables reset here -- a section record left behind would have the find box counting objects
        that are no longer on screen.
    */
    function renderPanel(renderedModel, renderedEmptyStateMessage) {

        explorerModel = renderedModel;
        emptyStateMessage = renderedEmptyStateMessage || '';

        explorerRoot.textContent = '';
        objectSectionRecords = [];
        panelSectionRecords = [];
        focusedCombinationElement = undefined;
        isDeepLinkActive = false;
        filterText = '';
        filterStatus = 'all';

        scannedPathValueElement.textContent = explorerModel.scannedObjectsDirectoryPath;
        scannedPathElement.classList.remove('hidden');

        renderProvenanceBanner();
        renderRunBanner();
        renderTruncationNotices();
        renderSkippedFieldWarnings();
        renderObjects();

    }

    /*
        The freshness answer, which arrives AFTER the panel has painted because the walk that
        produces it stats every file under the objects directory.

        The banner is re-rendered in place rather than patched: it is the one element whose whole
        wording changes with the answer -- a stale manifest reads differently from a fresh one at the
        heading, not just in an appended sentence.
    */
    function applyFreshness(freshness, freshnessMessage) {

        if (!explorerModel) { return; }

        explorerModel.manifestFreshness = freshness;
        explorerModel.manifestFreshnessMessage = freshnessMessage;

        const previousBannerElement = document.querySelector('.provenanceBanner');
        if (!previousBannerElement) { return; }

        /*
            Rebuilt into the same position rather than appended at the bottom, where the reader is no
            longer looking. renderProvenanceBanner appends to explorerRoot, so the new banner is moved
            over the old one and the old one removed.
        */
        renderProvenanceBanner();
        const rebuiltBannerElement = explorerRoot.lastElementChild;
        explorerRoot.insertBefore(rebuiltBannerElement, previousBannerElement);
        previousBannerElement.remove();

    }

    function setLoadStatus(statusMessage) {

        if (!statusMessage) {
            loadStatusElement.classList.add('hidden');
            return;
        }

        loadStatusElement.textContent = statusMessage;
        loadStatusElement.classList.remove('hidden');

    }

    window.addEventListener('message', function (messageEvent) {

        const hostMessage = messageEvent.data;
        if (!hostMessage) { return; }

        if (hostMessage.command === 'loadPhase') {
            setLoadStatus(hostMessage.message);
            return;
        }

        if (hostMessage.command === 'renderModel') {
            renderPanel(hostMessage.model, hostMessage.emptyStateMessage);
            setLoadStatus(hostMessage.message);
            return;
        }

        if (hostMessage.command === 'applyFreshness') {
            applyFreshness(hostMessage.freshness, hostMessage.message);
            setLoadStatus('');
            return;
        }

        if (hostMessage.command === 'loadFailed') {
            setLoadStatus(hostMessage.message);
        }

    });

    /*
        Posted on every load of this document, not only the first.

        A reveal after the panel was hidden reloads it from scratch, and the host answers "ready"
        with whatever it currently holds -- so the model is restored from the host's copy rather than
        rebuilt from the manifest, and a panel that has already resolved its freshness comes back
        with that answer rather than re-walking the objects directory.
    */
    vscodeApi.postMessage({ command: 'ready' });

}());
</script>
</body>
</html>
`;

    }

}
