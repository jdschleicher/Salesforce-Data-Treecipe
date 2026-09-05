import { GlobalValueSetSingleton } from '../GlobalValueSetSingleton/GlobalValueSetSingleton';
import { RecipeService } from '../RecipeService/RecipeService';
import { RecordTypeService } from '../RecordTypeService/RecordTypeService';
import { RecordTypeWrapper } from '../RecordTypeService/RecordTypesWrapper';
import { XmlFileProcessor } from '../XMLProcessingService/XmlFileProcessor';
import { XMLFieldDetail } from '../XMLProcessingService/XMLFieldDetail';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export interface IPicklistDependencyExpectation {
    controllingValue: string;
    // AN EMPTY LIST INDICATES THE CONTROLLING VALUE UNLOCKS NOTHING AND SO EMITS "expectNone"
    dependentValues: string[];
    /*
        Values the dependent field declares that this controlling value does NOT unlock. Emitted
        as expectNotAllowed, which is what catches a value drifting INTO a combination -- the
        positive expectAtLeast line only catches one going missing.

        Optional because a hand built expectation -- a test, or a caller assembling a spec detail
        directly -- is entitled to assert only the positive half. The generator always populates it.
    */
    forbiddenValues?: string[];
    /*
        Set only on a record-type-scoped expectation for a controlling value the record type does
        not assign at all. Such a value is ABSENT under that record type rather than present and
        empty, and the two are different assertions: expectNone requires the value to exist, so
        emitting it here would fail against exactly the metadata that is correct. Emitted as
        expectUnavailable instead.
    */
    controllingValueUnavailable?: boolean;
    /*
        Set by the PARSER when the spec stated its dependent list exhaustively -- expectNone, which
        claims the controlling value unlocks nothing, and expectExactly, which claims it unlocks
        precisely these.

        Writeback needs it because an empty dependentValues list is otherwise indistinguishable from
        a controlling value the spec never mentioned, and those two mean opposite things: silence is
        "no claim, leave the metadata alone", while expectNone is "remove everything". Without the
        flag the strictly stronger statement is the one that does nothing.

        The generator never sets it -- it emits expectAtLeast plus a complement -- so this changes
        nothing about generation.
    */
    dependentValuesAreExhaustive?: boolean;
}

export interface IPicklistDependencySpecDetail {
    objectApiName: string;
    fieldApiName: string;
    controllingFieldApiName: string;
    expectations: IPicklistDependencyExpectation[];
    /*
        Set when this field's controlling field is ITSELF a dependent picklist, and names it.
        A controlling field always lives on the same object, so the dependsOn call the generator
        emits from this is always to a sibling method in the same per-object class.
    */
    upstreamFieldApiName?: string;
    /*
        Set only on a record-type-scoped detail, where it narrows the same (object, field) pair to
        the combinations one record type actually exposes. Declared optional on the base so a single
        emission path covers both kinds -- IRecordTypePicklistDependencySpecDetail requires it.
    */
    recordTypeDeveloperName?: string;
}

/*
    The field-level expectations of one dependent picklist, narrowed to a single record type: the
    controlling values that record type assigns intersected with the bones, and per controlling
    value the unlocked values intersected with what the record type assigns to the dependent field.
*/
export interface IRecordTypePicklistDependencySpecDetail extends IPicklistDependencySpecDetail {
    recordTypeDeveloperName: string;
}

/*
    What a global-value-set-backed dependent picklist resolved to.

    declaredDependentValues is undefined when the named global value set could not be read at all,
    which is the one case where the field cannot be specced and is skipped.
*/
/*
    A warning carrying the reason it was raised, so a caller recording it as a skipped field does
    not have to infer one from the sentence.
*/
export interface IPicklistDependencySkipWarning {
    warning: string;
    reason: PicklistDependencySkipReason;
}

export interface IGlobalValueSetDependentValueResolution {
    declaredDependentValues?: string[];
    controllingValueToPicklistOptions: Record<string, string[]>;
    warnings: IPicklistDependencySkipWarning[];
}

/*
    One thing the generator declined to spec, carried as identity rather than only as prose.

    The warning text alone reads perfectly well in a notification, but it is not something a panel
    can group under the object it belongs to without scraping it -- and recovering structure by
    regex from a free-text message is precisely the coupling the spec manifest exists to remove.
    The message is kept alongside the identity rather than rebuilt from it, so what the user reads
    in the panel is the same sentence the command reported.
*/
/*
    Why the generator declined, as identity the caller can group by.

    "unknown" is reachable only from a manifest written before this field existed, or one hand
    edited to a reason this version does not define. It is carried rather than dropped: the warning
    text is still perfectly readable, and losing the entry entirely would understate what the run
    left out.
*/
export type PicklistDependencySkipReason = 'invalidApiName'
                                            | 'noValueSettings'
                                            | 'globalValueSetNotFound'
                                            | 'valueNotDeclaredInGlobalValueSet'
                                            | 'recordTypeXmlUnparseable'
                                            | 'recordTypeMissingDeveloperName'
                                            | 'recordTypePicklistMarkupUnreadable'
                                            | 'recordTypeInvalidDeveloperName'
                                            | 'recordTypeAssignsNoValues'
                                            | 'unknown';

/*
    What actually happened to the metadata, which is NOT the same question as why.

    Most of these reasons do not skip a field at all. Field-level specs are built by
    buildSpecDetailsByObjectFieldDetails and are unaffected by anything that goes wrong reading a
    recordTypes sibling, so EVERY record type reason costs only the scoped spec while the
    field-level one stands; an undeclared global value set value is likewise DROPPED from a spec
    that is still generated. Reporting any of them as "skipped" sends a reader looking for a field
    that was in fact specced -- the aggregate warning this replaces already took care to say so in
    prose, and this is that distinction made structural.

    outcomeUnknown is what a reason this version does not define gets. Its outcome is genuinely not
    known -- such a row could have been any of the other three -- and picking the most common one
    would be inventing a claim about a run rather than reporting it.
*/
export type PicklistDependencySkipOutcome = 'fieldSkipped' | 'valuesDropped' | 'recordTypeScopeSkipped' | 'outcomeUnknown';

export interface IPicklistDependencySkippedField {
    objectApiName: string;
    // ABSENT WHERE THE SKIP IS ABOUT A RECORD TYPE FILE RATHER THAN ABOUT ONE FIELD
    fieldApiName?: string;
    recordTypeDeveloperName?: string;
    warning: string;
    reason: PicklistDependencySkipReason;
}

export interface IPicklistDependencyCollectionResult {
    specDetails: IPicklistDependencySpecDetail[];
    recordTypeSpecDetails: IRecordTypePicklistDependencySpecDetail[];
    skippedFieldWarnings: string[];
    /*
        The same skips as skippedFieldWarnings, with the object and field they concern. Both are
        carried: the warnings drive the notifications the command already shows, and these drive the
        panel rows. They are appended in lockstep so neither can report a skip the other does not.
    */
    skippedFields: IPicklistDependencySkippedField[];
    /*
        Set when the caller asked to stop mid-walk. A cancelled result is PARTIAL by definition, so
        callers must not treat its emptiness as "this project has no dependent picklists" -- the one
        reading of it that would silently delete a user's generated classes.
    */
    cancelled?: boolean;
}

/*
    How a long-running generation phase reports itself, deliberately free of any vscode type.

    The command owns the progress UI; this service owns the work. Keeping the port to two plain
    functions means the walk and the write can be tested for the counts they report and the point
    they stop at, without standing up a withProgress double for every case.
*/
export interface IPicklistDependencyGenerationProgress {
    report(message: string): void;
    isCancellationRequested(): boolean;
}

/*
    The two parts of a parsed RecordType file this service reads. xml2js gives every element as an
    array, and RecordTypeService owns the shape of the picklistValues entries -- typing them here
    would duplicate a contract that lives there.
*/
export interface IParsedRecordTypeXmlDetail {
    fullName?: string[];
    picklistValues?: unknown[];
}

export interface IRecordTypeCollectionResult {
    recordTypeWrappers: RecordTypeWrapper[];
    skippedRecordTypeWarnings: string[];
    skippedFields: IPicklistDependencySkippedField[];
}

export interface IRecordTypeSpecDetailBuildResult {
    recordTypeSpecDetails: IRecordTypePicklistDependencySpecDetail[];
    skippedFieldWarnings: string[];
    skippedFields: IPicklistDependencySkippedField[];
}

export interface ISpecsClassWriteResult {
    aggregatorClassFilePath: string;
    perObjectClassFilePathsByObjectApiName: Record<string, string>;
    removedStaleClassFilePaths: string[];
}

export type PlannedSpecsFileChangeType = 'added' | 'changed' | 'unchanged';

export interface IPlannedSpecsFile {
    filePath: string;
    proposedContent: string;
    changeType: PlannedSpecsFileChangeType;
    /*
        The object whose specs this file carries, or undefined for the aggregator and the test
        class, which are not about any one object. What the pre-write report groups by.
    */
    objectApiName?: string;
}

/*
    What regenerating WOULD do, resolved against what is on disk, before anything is written.

    The generated classes are meant to be committed and reviewed as a diff -- that is the whole
    point of emitting them deterministically -- and a blind overwrite defeats it: the workflow the
    specs exist for is "edit the expectation you intend, watch it go red, fix the org", and that
    only survives if the run that would replace a hand edit says so first.
*/
export interface ISpecsChangePlan {
    plannedFiles: IPlannedSpecsFile[];
    // GENERATED CLASSES FOR OBJECTS THIS RUN NO LONGER PRODUCES, NAMED RATHER THAN DELETED SILENTLY
    staleClassFilePaths: string[];
    hasChanges: boolean;
}

export interface IMergedTestSuiteContent {
    /*
        Undefined means WRITE NOTHING. The only way to leave a file whose content could not be read
        exactly as it is, is not to write it -- so the absence of content is the instruction.
    */
    content?: string;
    /*
        True when the file already on disk could not be read as an ApexTestSuite. "content" is then
        that file's EXACT existing content, so writing it back is a no-op and the user's file
        survives -- the caller reports the warning rather than replacing what it cannot understand.
    */
    isExistingFileUnparseable: boolean;
    /*
        True when a file IS there but could not be read at all -- a permissions failure, or a lock
        held by another process. Distinct from "no file yet", which is the ordinary first run.
        Collapsing the two would answer an unreadable file by writing a fresh one over it, dropping
        every member the user had registered: the same silent deletion the unparseable branch exists
        to prevent, reached through a different door.
    */
    isExistingFileUnreadable: boolean;
}

export interface IFrameworkScaffoldResult {
    scaffoldedClassNames: string[];
    // FRAMEWORK CLASSES NEITHER ALREADY IN THE WORKSPACE NOR AVAILABLE TO COPY FROM THE EXTENSION
    unavailableClassNames: string[];
}

/*
    Everything a successful generation run reports, as data. The toast and the summary document are
    both built from ONE of these so they cannot describe the same run differently.
*/
export interface IPicklistDependencyGenerationSummaryDetail {
    specCount: number;
    perObjectClassCount: number;
    specsClassName: string;
    specsTestClassName: string;
    testSuiteName: string;
    classesDirectoryPath: string;
    manifestFilePath: string;
    recordTypeSpecCount: number;
    scaffoldedClassNames: string[];
    // BASE NAMES RATHER THAN FULL PATHS: THE DIRECTORY IS ALREADY ITS OWN BULLET
    removedStaleClassFileNames: string[];
}

// THE "category" EVERY COMMAND IN package.json DECLARES, SO THE DOCUMENT NAMES WHAT THE PALETTE SHOWS
export const TREECIPE_COMMAND_PALETTE_PREFIX = 'Salesforce Treecipe';

/*
    Absolute rather than relative: the summary document is written into the USER's workspace, so a
    repository-relative path would resolve against their tree and land nowhere. The anchors are
    GitHub's slugs for the guide's headings -- a heading renamed there has to be renamed here, which
    is what the test asserting these links exist is for.
*/
const PICKLIST_DEPENDENCY_DOCS_BASE_URL = 'https://github.com/jdschleicher/Salesforce-Data-Treecipe/blob/main/docs';
export const PICKLIST_DEPENDENCY_IN_ORG_GUIDE_RUNNING_THE_TESTS_URL = `${PICKLIST_DEPENDENCY_DOCS_BASE_URL}/PICKLIST-DEPENDENCY-IN-ORG-GUIDE.md#5-running-the-tests-inside-the-org`;
export const PICKLIST_DEPENDENCY_IN_ORG_GUIDE_TRIGGERING_A_FAILURE_URL = `${PICKLIST_DEPENDENCY_DOCS_BASE_URL}/PICKLIST-DEPENDENCY-IN-ORG-GUIDE.md#7-triggering-a-failure-on-purpose`;
export const PICKLIST_DEPENDENCY_IN_ORG_GUIDE_FIXING_A_FAILURE_URL = `${PICKLIST_DEPENDENCY_DOCS_BASE_URL}/PICKLIST-DEPENDENCY-IN-ORG-GUIDE.md#8-fixing-a-real-failure`;
export const PICKLIST_DEPENDENCY_TECHNICAL_DESIGN_URL = `${PICKLIST_DEPENDENCY_DOCS_BASE_URL}/PICKLIST-DEPENDENCY-TECHNICAL-DESIGN.md`;

export class PicklistDependencyTestService {

    /*
        The "SDT" prefix marks every class this command writes into a user's package directory as
        Salesforce Data Treecipe's rather than theirs, and removes any chance of colliding with a
        PicklistDependencySpecs of their own. The aggregator, the per-object classes and the test
        class all derive from it, so they move together.
    */
    private static specsClassName = 'SDTPLDSpecs';

    /*
        A sibling of manifest.json under the treecipe specs folder, never inside a package directory:
        a stray markdown file there is not valid Salesforce metadata and would ride into
        "sf project deploy" and fail the deploy it describes.
    */
    private static generationSummaryFileName = 'generation-summary.md';

    /*
        Salesforce caps an ApexClass name at 40 characters. The per-object classes are the only
        generated names that embed a variable-length api name, so they are the only ones that can
        breach it -- and the earlier "SDTPicklistDependencySpecs_" prefix spent 27 of the 40 before
        the object name began, leaving 13 and failing the deploy for almost any custom object.
        "PLD" is picklist-dependency abbreviated, which buys back 15 characters for the part of the
        name that actually identifies the class.
    */
    private static maximumApexClassNameLength = 40;

    /*
        Class names this command generated under its previous naming, checked for so a user
        upgrading from 2.12.x-2.14.x is told what to delete rather than silently ending up with
        two frameworks deployed side by side.
    */
    private static legacySpecsClassNames: string[] = [
        'SFTreecipePicklistDependencySpecs',
        'SFTreecipePicklistDependencySpecsTest'
    ];

    private static legacyFrameworkDirectoryName = 'PicklistDependencyFramework';

    // SOURCE FORMAT PUTS RECORD TYPES IN A SIBLING OF THE OBJECT'S "fields" DIRECTORY
    private static recordTypesDirectoryName = 'recordTypes';

    /*
        The runtime classes the generated SDTPLDSpecs.cls depends on. Their source lives in
        apexPicklistDependencyFramework/, ships in the vsix via negation entries in .vscodeignore,
        and is scaffolded into the user's package directory when missing, otherwise the generated
        file would not compile in their org.
    */
    private static frameworkClassNames: string[] = [
        'ISDTPicklistDependencySource',
        'SDTPicklistDependencySpec',
        'SDTPicklistDependencySnapshot',
        'SDTPicklistDependencyReport',
        'SDTPicklistDependencyValidator',
        'SDTSchemaPicklistDependencySource'
    ];

    /*
        Salesforce object and field API names are letters, numbers and underscores only -- the
        namespace, "__c" and "__e" suffixes all stay within that set. Nothing upstream enforces
        this though: a field api name is a raw XML <fullName> text node and an object api name is
        a directory name on disk, so both are validated here rather than assumed.
    */
    private static salesforceApiNamePattern = /^[A-Za-z0-9_]+$/;

    static isValidSalesforceApiName(apiName: string): boolean {
        return typeof apiName === 'string' && this.salesforceApiNamePattern.test(apiName);
    }

    /*
        What each reason cost the run, and the phrase the summary counts it under.

        Held in ONE table rather than as a switch at each reporting site: the panel, the manifest and
        the end-of-run summary all group by reason, and a reason that meant "skipped" in one place
        and "dropped" in another would be describing two different runs.
    */
    private static skipOutcomeAndLabelByReason: Record<PicklistDependencySkipReason, { outcome: PicklistDependencySkipOutcome, label: string }> = {
        invalidApiName: { outcome: 'fieldSkipped', label: 'invalid api name' },
        noValueSettings: { outcome: 'fieldSkipped', label: 'no "valueSettings" markup' },
        globalValueSetNotFound: { outcome: 'fieldSkipped', label: 'global value set not found' },
        valueNotDeclaredInGlobalValueSet: { outcome: 'valuesDropped', label: 'values the global value set does not declare' },
        recordTypeXmlUnparseable: { outcome: 'recordTypeScopeSkipped', label: 'record type XML could not be parsed' },
        recordTypeMissingDeveloperName: { outcome: 'recordTypeScopeSkipped', label: 'record type has no developer name' },
        recordTypePicklistMarkupUnreadable: { outcome: 'recordTypeScopeSkipped', label: 'record type picklist markup could not be read' },
        recordTypeInvalidDeveloperName: { outcome: 'recordTypeScopeSkipped', label: 'record type developer name is not a valid api name' },
        recordTypeAssignsNoValues: { outcome: 'recordTypeScopeSkipped', label: 'record type assigns no values to the field' },
        unknown: { outcome: 'outcomeUnknown', label: 'reason not recorded' }
    };

    static getSkipOutcomeByReason(reason: PicklistDependencySkipReason): PicklistDependencySkipOutcome {
        return (this.skipOutcomeAndLabelByReason[reason] ?? this.skipOutcomeAndLabelByReason.unknown).outcome;
    }

    static getSkipLabelByReason(reason: PicklistDependencySkipReason): string {
        return (this.skipOutcomeAndLabelByReason[reason] ?? this.skipOutcomeAndLabelByReason.unknown).label;
    }

    static isRecognisedSkipReason(reason: unknown): reason is PicklistDependencySkipReason {
        return typeof reason === 'string' && Object.prototype.hasOwnProperty.call(this.skipOutcomeAndLabelByReason, reason);
    }

    /*
        One sentence per outcome, each naming its reasons and their counts.

        Reported once at the END of a run rather than as a toast per warning, which fired up to four
        times before the user knew whether generation had even succeeded. The three outcomes are kept
        apart because they are not the same news: a dropped value still leaves a spec behind, and a
        record type that assigns nothing still leaves the field-level spec covering the field. Rolling
        them into one "skipped" count would overstate what the run declined to do.

        Returns an empty string when nothing was skipped, so a caller can append it unconditionally.
    */
    static buildSkippedFieldSummary(skippedFields: IPicklistDependencySkippedField[]): string {

        if ( skippedFields.length === 0 ) {
            return '';
        }

        const summarySentenceByOutcome: Record<PicklistDependencySkipOutcome, (count: number, reasonBreakdown: string) => string> = {
            fieldSkipped: (count, reasonBreakdown) => `${count} field(s) skipped (${reasonBreakdown}).`,
            valuesDropped: (count, reasonBreakdown) => `${count} field(s) had values dropped from a spec that was still generated (${reasonBreakdown}).`,
            recordTypeScopeSkipped: (count, reasonBreakdown) => `${count} record-type-scoped combination(s) skipped, with the field-level spec still generated (${reasonBreakdown}).`,
            // SAYS IT HAS NO EXPLANATION RATHER THAN OFFERING A PLAUSIBLE ONE
            outcomeUnknown: (count, reasonBreakdown) => `${count} warning(s) whose reason this version does not recognise, so what they cost is not known (${reasonBreakdown}).`
        };

        // INSERTION ORDER IS THE REPORTING ORDER, SO THE SENTENCES READ THE SAME WAY ON EVERY RUN
        const outcomeReportingOrder: PicklistDependencySkipOutcome[] = ['fieldSkipped', 'valuesDropped', 'recordTypeScopeSkipped', 'outcomeUnknown'];

        let countByReasonByOutcome: Record<string, Record<string, number>> = {};

        skippedFields.forEach(skippedField => {

            const reason = this.isRecognisedSkipReason(skippedField.reason) ? skippedField.reason : 'unknown';
            const outcome = this.getSkipOutcomeByReason(reason);

            countByReasonByOutcome[outcome] = countByReasonByOutcome[outcome] || {};
            countByReasonByOutcome[outcome][reason] = (countByReasonByOutcome[outcome][reason] || 0) + 1;

        });

        let summarySentences: string[] = [];

        outcomeReportingOrder.forEach(outcome => {

            const countByReason = countByReasonByOutcome[outcome];
            if ( !countByReason ) {
                return;
            }

            const reasonBreakdown = Object.keys(countByReason)
                .sort((firstReason, secondReason) => countByReason[secondReason] - countByReason[firstReason]
                                                        || this.compareForEmission(firstReason, secondReason))
                .map(reason => `${countByReason[reason]} ${this.getSkipLabelByReason(reason as PicklistDependencySkipReason)}`)
                .join(', ');

            const outcomeCount = Object.keys(countByReason).reduce((runningTotal, reason) => runningTotal + countByReason[reason], 0);

            summarySentences.push(summarySentenceByOutcome[outcome](outcomeCount, reasonBreakdown));

        });

        return summarySentences.join(' ');

    }

    /*
        Everything the end of a successful generation run has to say, as data rather than as a
        sentence. The prose is built from this in one place below, so the toast and the summary
        document cannot describe the same run differently.
    */
    static buildGenerationSummaryDocumentFilePath(specsFolderPath: string): string {
        return path.join(specsFolderPath, this.generationSummaryFileName);
    }

    static getGenerationSummaryFileName(): string {
        return this.generationSummaryFileName;
    }

    /*
        A value read out of Salesforce metadata rendered as literal text.

        Api names, class names and paths all reach this document from XML the extension does not
        control, and markdown has no escaping inside a code span -- only a longer fence. So the fence
        is grown past the longest backtick run in the value, and a value that starts or ends with a
        backtick is padded, which is what CommonMark requires for the span to close where it should.
        Anything else lets a crafted value end the span early and restructure the document around it.
    */
    static formatAsMarkdownInlineCode(value: string): string {

        /*
            A LINE BREAK ends the code span whatever the fence is -- a blank line ends the paragraph
            the span lives in, so a value carrying one becomes markup for everything after it. It is
            rendered as its escape sequence rather than collapsed to a space, so the document still
            shows what the value actually contains instead of quietly redrawing it as something
            tidier that never existed in the metadata.
        */
        const singleLineValue = value.replace(/\r\n|\r|\n/g, '\\n');

        const backtickRuns: string[] = singleLineValue.match(/`+/g) ?? [];
        const longestBacktickRunLength = backtickRuns.reduce((longest, backtickRun) => Math.max(longest, backtickRun.length), 0);
        const fence = '`'.repeat(longestBacktickRunLength + 1);

        const needsPadding = singleLineValue.startsWith('`') || singleLineValue.endsWith('`');
        const paddedValue = needsPadding ? ` ${singleLineValue} ` : singleLineValue;

        return `${fence}${paddedValue}${fence}`;

    }

    /*
        The one line the toast gets.

        A VS Code notification is a single run of unformatted text that truncates, so it carries the
        two counts and nothing else. Everything the run has to report lives in the document the
        "View Summary" button opens -- which is the whole reason this is no longer five concatenated
        sentences competing for the same line.
    */
    static buildGenerationSummaryToastMessage(summaryDetail: IPicklistDependencyGenerationSummaryDetail): string {

        return `Generated ${summaryDetail.specCount} picklist dependency spec(s) across ${summaryDetail.perObjectClassCount} per-object class(es).`;

    }

    /*
        The run report, as bullets.

        Two sections, because a finished run raises two different questions: what did it just write,
        and what do I do with it. The optional bullets are omitted entirely rather than rendered as
        "0" -- a run that scaffolded nothing has nothing to say about scaffolding, and a zero row
        reads as a thing that failed rather than a thing that did not apply.

        The walkthroughs are LINKED rather than reproduced. They carry the mermaid diagrams for
        running the tests and reading a failure, and a second copy here would be a second derivation
        to keep in sync -- the same reason the Explorer reads the manifest instead of re-walking XML.
    */
    static buildGenerationSummaryMarkdown(summaryDetail: IPicklistDependencyGenerationSummaryDetail): string {

        const asCode = (value: string) => this.formatAsMarkdownInlineCode(value);

        const whatHappenedBullets = [
            `Generated **${summaryDetail.specCount}** picklist dependency spec(s) across **${summaryDetail.perObjectClassCount}** per-object class(es).`,
            `Aggregated by ${asCode(`${summaryDetail.specsClassName}.cls`)} and asserted by ${asCode(`${summaryDetail.specsTestClassName}.cls`)}.`,
            `Written to ${asCode(summaryDetail.classesDirectoryPath)}.`,
            `Registered in the ${asCode(summaryDetail.testSuiteName)} Apex test suite -- what \`Run Picklist Dependency Check\` and \`sf apex run test --suite-names\` invoke.`,
            `The Picklist Dependency Explorer reads ${asCode(summaryDetail.manifestFilePath)} to render exactly these specs.`
        ];

        if ( summaryDetail.recordTypeSpecCount > 0 ) {
            whatHappenedBullets.push(
                `Also generated **${summaryDetail.recordTypeSpecCount}** record-type-scoped spec(s), aggregated by `
                + `${asCode(`${summaryDetail.specsClassName}.allRecordTypeScoped()`)}. These are **not** asserted by `
                + `${asCode(`${summaryDetail.specsTestClassName}.cls`)}: Schema describe returns picklist values without record type `
                + `filtering, so they need a record-type-aware ${asCode('ISDTPicklistDependencySource')}.`
            );
        }

        if ( summaryDetail.scaffoldedClassNames.length > 0 ) {
            whatHappenedBullets.push(
                `Scaffolded the required framework class(es): ${summaryDetail.scaffoldedClassNames.map(asCode).join(', ')}.`
            );
        }

        if ( summaryDetail.removedStaleClassFileNames.length > 0 ) {
            whatHappenedBullets.push(
                `Removed **${summaryDetail.removedStaleClassFileNames.length}** generated class(es) for object(s) no longer declaring a `
                + `dependent picklist: ${summaryDetail.removedStaleClassFileNames.map(asCode).join(', ')}.`
            );
        }

        const whatToDoNextBullets = [
            `**Open the Picklist Dependency Explorer** -- run ${asCode(`${TREECIPE_COMMAND_PALETTE_PREFIX}: Open Picklist Dependency Explorer`)} `
                + `from the Command Palette to see every combination these specs assert, and the result of the last check against an org.`,
            `**Review the generated Apex as a diff** before deploying it. The classes in ${asCode(summaryDetail.classesDirectoryPath)} are `
                + `meant to be committed and reviewed -- they are the contract, and a change to them is a change to what your org is held to.`,
            `**Deploy and run the specs against an org** -- run ${asCode(`${TREECIPE_COMMAND_PALETTE_PREFIX}: Run Picklist Dependency Check`)}, `
                + `or from the org itself: [Running the tests inside the org](${PICKLIST_DEPENDENCY_IN_ORG_GUIDE_RUNNING_THE_TESTS_URL}).`,
            `**Prove the gate actually works** by breaking a dependency on purpose: `
                + `[Triggering a failure on purpose](${PICKLIST_DEPENDENCY_IN_ORG_GUIDE_TRIGGERING_A_FAILURE_URL}).`,
            `**When something fails**, the guide walks through deciding whether the org or the source is right: `
                + `[Fixing a real failure](${PICKLIST_DEPENDENCY_IN_ORG_GUIDE_FIXING_A_FAILURE_URL}).`,
            `For how the generated Apex works end to end, see the `
                + `[Technical Design](${PICKLIST_DEPENDENCY_TECHNICAL_DESIGN_URL}).`
        ];

        return [
            '# Picklist Dependency Generation Summary',
            '',
            '## What happened',
            '',
            ...whatHappenedBullets.map(bullet => `- ${bullet}`),
            '',
            '## What to do next',
            '',
            ...whatToDoNextBullets.map(bullet => `- ${bullet}`),
            '',
            '---',
            '',
            `Regenerated by ${TREECIPE_COMMAND_PALETTE_PREFIX}: Generate Picklist Dependency Tests. This file is overwritten on every run.`,
            ''
        ].join('\n');

    }

    static writeGenerationSummaryDocument(specsFolderPath: string, summaryDocumentContent: string): string {

        const summaryDocumentFilePath = this.buildGenerationSummaryDocumentFilePath(specsFolderPath);

        fs.mkdirSync(specsFolderPath, { recursive: true });
        fs.writeFileSync(summaryDocumentFilePath, summaryDocumentContent);

        return summaryDocumentFilePath;

    }

    static getSpecsClassName(): string {
        return this.specsClassName;
    }

    static getFrameworkClassNames(): string[] {
        return [...this.frameworkClassNames];
    }

    /*
        visitedDirectoryPaths guards the recursion. Symlinked directories are walked (see the
        bitmask check below), so a link pointing back up the tree -- "objects/Thing__c/loop"
        resolving to "objects" -- would otherwise recurse until the stack is exhausted.

        The cancellation check is per DIRECTORY rather than per top-level object: an objects
        directory is commonly one flat level of hundreds, so checking only between roots would leave
        cancel unresponsive for exactly the tree that takes long enough to want cancelling.

        A cancelled walk returns what it had, flagged. It does not throw: the partial result still
        names the fields it read, and the caller needs to say how far it got.
    */
    static async collectSpecDetailsByObjectsDirectory(objectsDirectoryUri: vscode.Uri,
                                                        visitedDirectoryPaths: Set<string> = new Set(),
                                                        generationProgress?: IPicklistDependencyGenerationProgress,
                                                        discoveredFieldCountByReference: { count: number } = { count: 0 }): Promise<IPicklistDependencyCollectionResult> {

        let collectedResult: IPicklistDependencyCollectionResult = {
            specDetails: [],
            recordTypeSpecDetails: [],
            skippedFieldWarnings: [],
            skippedFields: []
        };

        if ( generationProgress?.isCancellationRequested() ) {
            collectedResult.cancelled = true;
            return collectedResult;
        }

        const currentDirectoryPath = this.getRealDirectoryPath(objectsDirectoryUri.fsPath);
        if ( visitedDirectoryPaths.has(currentDirectoryPath) ) {
            return collectedResult;
        }
        visitedDirectoryPaths.add(currentDirectoryPath);

        const directoryEntries = await vscode.workspace.fs.readDirectory(objectsDirectoryUri);
        if ( !directoryEntries || directoryEntries.length === 0 ) {
            return collectedResult;
        }

        // A BITMASK CHECK SO A SYMLINKED OBJECT DIRECTORY ("Directory | SymbolicLink") IS STILL WALKED
        const childDirectoryNames = directoryEntries
            .filter(([, entryType]) => (entryType & vscode.FileType.Directory) !== 0)
            .map(([entryName]) => entryName);

        /*
            A directory containing "fields" IS an object directory, so its other children are
            metadata types that cannot hold fields -- recordTypes, listViews, webLinks,
            compactLayouts and the rest. Descending into them read directories that could never
            contribute a spec: on the fixture tree alone that was 43 directories visited to reach
            the 15 holding fields.

            Stopping here rather than deny-listing the known type names means no maintenance when
            Salesforce adds another child type, and it also pins the object api name to the
            directory that actually holds the fields -- a "fields" folder found deeper in the tree
            would otherwise be attributed to whatever directory happened to contain it.
        */
        const objectFieldsDirectoryName = childDirectoryNames.find(childDirectoryName => childDirectoryName === 'fields');

        if ( objectFieldsDirectoryName ) {

            const objectApiName = path.basename(objectsDirectoryUri.fsPath);
            const fieldsDirectoryUri = vscode.Uri.joinPath(objectsDirectoryUri, objectFieldsDirectoryName);

            const fieldDetails = await this.getFieldDetailsByFieldsDirectory(fieldsDirectoryUri);
            const objectResult = this.buildSpecDetailsByObjectFieldDetails(objectApiName, fieldDetails);

            /*
                Results are concatenated rather than spread into push -- a spread passes every
                element as a call argument, which throws once an accumulated subtree exceeds the
                engine's argument limit.
            */
            collectedResult.specDetails = collectedResult.specDetails.concat(objectResult.specDetails);
            collectedResult.skippedFieldWarnings = collectedResult.skippedFieldWarnings.concat(objectResult.skippedFieldWarnings);
            collectedResult.skippedFields = collectedResult.skippedFields.concat(objectResult.skippedFields);

            /*
                A GROWING count, not a fraction. Nothing at this point knows how many dependent
                picklists the tree holds -- that is what this walk is establishing -- and rendering a
                denominator it would have to invent is worse than rendering none: it would move
                backwards the moment the guess was low.
            */
            discoveredFieldCountByReference.count += objectResult.specDetails.length;
            generationProgress?.report(`${discoveredFieldCountByReference.count} dependent picklist field(s) found so far, reading ${objectApiName}...`);

            /*
                Record types are a SIBLING of the fields directory, so they are read here rather than
                in the recursion: this is the one point in the walk that has both the object api name
                and the specs the record types narrow.
            */
            const objectHasRecordTypesDirectory = childDirectoryNames.some(childDirectoryName => childDirectoryName === this.recordTypesDirectoryName);

            if ( objectHasRecordTypesDirectory && objectResult.specDetails.length > 0 ) {

                const recordTypeCollectionResult = await this.getRecordTypeWrappersByObjectDirectory(objectsDirectoryUri, objectApiName);
                const recordTypeResult = this.buildRecordTypeSpecDetails(objectResult.specDetails, recordTypeCollectionResult.recordTypeWrappers);

                collectedResult.recordTypeSpecDetails = collectedResult.recordTypeSpecDetails.concat(recordTypeResult.recordTypeSpecDetails);
                collectedResult.skippedFieldWarnings = collectedResult.skippedFieldWarnings
                    .concat(recordTypeCollectionResult.skippedRecordTypeWarnings)
                    .concat(recordTypeResult.skippedFieldWarnings);
                collectedResult.skippedFields = collectedResult.skippedFields
                    .concat(recordTypeCollectionResult.skippedFields)
                    .concat(recordTypeResult.skippedFields);

            }

            return collectedResult;

        }

        for ( const childDirectoryName of childDirectoryNames ) {

            const childDirectoryUri = vscode.Uri.joinPath(objectsDirectoryUri, childDirectoryName);

            const nestedResult = await this.collectSpecDetailsByObjectsDirectory(
                childDirectoryUri, visitedDirectoryPaths, generationProgress, discoveredFieldCountByReference
            );
            collectedResult.specDetails = collectedResult.specDetails.concat(nestedResult.specDetails);
            collectedResult.recordTypeSpecDetails = collectedResult.recordTypeSpecDetails.concat(nestedResult.recordTypeSpecDetails);
            collectedResult.skippedFieldWarnings = collectedResult.skippedFieldWarnings.concat(nestedResult.skippedFieldWarnings);
            collectedResult.skippedFields = collectedResult.skippedFields.concat(nestedResult.skippedFields);

            /*
                Propagated rather than re-checked at the top of the next iteration: a subtree that
                stopped because of cancellation must not have its siblings walked, and the flag is
                what tells the caller the result it is holding is partial.
            */
            if ( nestedResult.cancelled ) {
                collectedResult.cancelled = true;
                return collectedResult;
            }

        }

        return collectedResult;

    }

    /*
        Resolved through symlinks so two paths reaching the same directory compare equal.

        A directory that does not exist yet cannot be resolved at all, and returning its lexical
        path would silently skip symlink resolution for the whole path -- so a symlinked ANCESTOR
        would satisfy a containment check that exists to catch exactly that. This is not a corner
        case: the testSuites directory is guaranteed absent on a first run, which would make the
        unresolved branch the normal one for it.

        So the nearest EXISTING ancestor is resolved instead, and the not-yet-created segments are
        re-appended to it. Against a mocked or virtual filesystem nothing resolves, the recursion
        reaches the root and the lexical path is rebuilt unchanged, which is what keeps the walk
        working there.
    */
    static getRealDirectoryPath(directoryPath: string): string {
        return SfdxProjectService.getRealDirectoryPath(directoryPath);
    }

    static async getFieldDetailsByFieldsDirectory(fieldsDirectoryUri: vscode.Uri): Promise<XMLFieldDetail[]> {

        const fieldDirectoryEntries = await vscode.workspace.fs.readDirectory(fieldsDirectoryUri);

        let fieldDetails: XMLFieldDetail[] = [];
        for ( const [fileName, directoryItemTypeEnum] of fieldDirectoryEntries ) {

            /*
                Requires the full ".field-meta.xml" suffix rather than any ".xml". A fields directory
                can hold a hand-saved copy or an export carrying CustomField markup, and matching on
                the extension alone generated specs for fields that do not exist in the org.
            */
            if ( !XmlFileProcessor.isSalesforceFieldMetadataFile(fileName, directoryItemTypeEnum) ) {
                continue;
            }

            const fieldUri = vscode.Uri.joinPath(fieldsDirectoryUri, fileName);
            const fieldXmlContentUriData = await vscode.workspace.fs.readFile(fieldUri);
            const fieldXmlContent = Buffer.from(fieldXmlContentUriData).toString('utf8');

            const fieldDetail = await XmlFileProcessor.processXmlFieldContent(fieldXmlContent, fileName);
            fieldDetails.push(fieldDetail);

        }

        return fieldDetails;

    }

    static buildSpecDetailsByObjectFieldDetails(objectApiName: string, fieldDetails: XMLFieldDetail[]): IPicklistDependencyCollectionResult {

        let specDetails: IPicklistDependencySpecDetail[] = [];
        let skippedFieldWarnings: string[] = [];
        let skippedFields: IPicklistDependencySkippedField[] = [];

        /*
            Appended in lockstep so the prose list and the structured list can never disagree about
            what was skipped -- one call site, not two that have to be kept in step by hand.
        */
        const recordSkippedField = (warning: string,
                                        reason: PicklistDependencySkipReason,
                                        fieldApiName?: string,
                                        recordTypeDeveloperName?: string) => {
            skippedFieldWarnings.push(warning);
            skippedFields.push({ objectApiName, fieldApiName, recordTypeDeveloperName, warning, reason });
        };

        const fieldDetailByApiName: Record<string, XMLFieldDetail> = {};
        fieldDetails.forEach(fieldDetail => {
            fieldDetailByApiName[fieldDetail.apiName] = fieldDetail;
        });

        fieldDetails.forEach(fieldDetail => {

            if ( !fieldDetail.controllingField ) {
                return;
            }

            /*
                An api name that is not a plain Salesforce identifier cannot match a real org field,
                and emitting it would splice unvetted text into an Apex string literal. Skipping is
                both the safe and the honest result.
            */
            const apiNamesToValidate = [objectApiName, fieldDetail.apiName, fieldDetail.controllingField];
            // findIndex rather than find: an invalid entry could itself be undefined, which find cannot distinguish from "nothing matched"
            const invalidApiNameIndex = apiNamesToValidate.findIndex(apiName => !this.isValidSalesforceApiName(apiName));

            if ( invalidApiNameIndex !== -1 ) {

                const invalidApiName = apiNamesToValidate[invalidApiNameIndex];
                recordSkippedField(
                    `Skipped dependent picklist "${objectApiName}.${fieldDetail.apiName}": the api name "${invalidApiName}" is not a valid Salesforce api name (letters, numbers and underscores only). No spec was generated for this field.`,
                    'invalidApiName',
                    fieldDetail.apiName
                );
                return;

            }

            let controllingValueToPicklistOptions = RecipeService.buildControllingValueToPicklistOptions(fieldDetail);

            if ( Object.keys(controllingValueToPicklistOptions).length === 0 ) {

                recordSkippedField(
                    `No "valueSettings" markup found for dependent picklist "${objectApiName}.${fieldDetail.apiName}" controlled by "${fieldDetail.controllingField}" -- no spec was generated for this field.`,
                    'noValueSettings',
                    fieldDetail.apiName
                );
                return;

            }

            /*
                A dependent picklist backed by a GLOBAL value set declares its values in that set
                rather than in its own file, so the universe the forbidden complement is taken
                against has to be read from there. Without it the universe is only the values
                carrying valueSettings, and every value the set declares that nothing unlocks --
                exactly the values that belong in every complement -- would go unasserted.
            */
            let declaredDependentValues = this.buildDeclaredDependentValues(fieldDetail);

            if ( fieldDetail.globalValueSetName ) {

                const globalValueSetResolution = this.resolveGlobalValueSetDependentValues(objectApiName, fieldDetail, controllingValueToPicklistOptions);
                globalValueSetResolution.warnings.forEach(globalValueSetWarning => recordSkippedField(
                    globalValueSetWarning.warning, globalValueSetWarning.reason, fieldDetail.apiName
                ));

                if ( !globalValueSetResolution.declaredDependentValues ) {
                    return;
                }

                declaredDependentValues = globalValueSetResolution.declaredDependentValues;
                controllingValueToPicklistOptions = globalValueSetResolution.controllingValueToPicklistOptions;

            }

            const controllingFieldDetail = fieldDetailByApiName[fieldDetail.controllingField];

            /*
                The controlling field can be global-value-set-backed too, and then ITS declared
                values are not in its field file either. They are what the "unlocks nothing" sweep
                reads, so without resolving them a controlling value that unlocks nothing gets no
                expectNone -- the mirror of the dependent side, and reachable through the same
                metadata.
            */
            const declaredControllingValues = this.buildDeclaredValuesByFieldDetail(controllingFieldDetail);

            const expectations = this.buildExpectations(controllingValueToPicklistOptions, declaredDependentValues, declaredControllingValues);

            /*
                A controlling field that is itself dependent makes this a link in a chain rather than
                a root. Only a controlling field that survived the api name validation above can be
                linked, since the emitted dependsOn call names its generated spec method.
            */
            const controllingFieldIsItselfDependent = !!( controllingFieldDetail
                                                            && controllingFieldDetail.controllingField
                                                            && this.isValidSalesforceApiName(controllingFieldDetail.apiName) );

            specDetails.push({
                objectApiName: objectApiName,
                fieldApiName: fieldDetail.apiName,
                controllingFieldApiName: fieldDetail.controllingField,
                expectations: expectations,
                upstreamFieldApiName: controllingFieldIsItselfDependent ? controllingFieldDetail.apiName : undefined
            });

        });

        /*
            Sorted HERE rather than at emission so that one order reaches every consumer -- the
            per-object Apex class, the generated test class and the Explorer all read this list, and
            three independent sorts would be three chances to drift.

            The walk that produced these follows vscode.workspace.fs.readDirectory, which is
            filesystem order, so without this two developers regenerating from identical metadata
            get different bytes. See compareForEmission for why the comparison is what it is.
        */
        specDetails.sort((firstSpecDetail, secondSpecDetail) => this.compareForEmission(firstSpecDetail.fieldApiName, secondSpecDetail.fieldApiName));

        return { specDetails, recordTypeSpecDetails: [], skippedFieldWarnings, skippedFields };

    }

    /*
        Reads the record types declared alongside an object's fields directory.

        A record type file that cannot be parsed, or that carries no <fullName>, is reported and
        skipped rather than aborting the run: the field-level specs for the object are already built
        at this point, and losing all of them to one malformed sibling file would be a worse outcome
        than generating without that record type.

        Wrappers come back sorted by developer name so the emitted methods keep a stable order
        whatever order the filesystem lists the directory in.
    */
    static async getRecordTypeWrappersByObjectDirectory(objectDirectoryUri: vscode.Uri,
                                                        objectApiName: string): Promise<IRecordTypeCollectionResult> {

        const recordTypesDirectoryUri = vscode.Uri.joinPath(objectDirectoryUri, this.recordTypesDirectoryName);

        let recordTypeWrappers: RecordTypeWrapper[] = [];
        let skippedRecordTypeWarnings: string[] = [];
        let skippedFields: IPicklistDependencySkippedField[] = [];

        const recordSkippedRecordType = (warning: string,
                                            reason: PicklistDependencySkipReason,
                                            recordTypeDeveloperName?: string) => {
            skippedRecordTypeWarnings.push(warning);
            skippedFields.push({ objectApiName, recordTypeDeveloperName, warning, reason });
        };

        const recordTypeDirectoryEntries = await vscode.workspace.fs.readDirectory(recordTypesDirectoryUri);

        for ( const [fileName, directoryItemTypeEnum] of recordTypeDirectoryEntries ) {

            if ( !XmlFileProcessor.isSalesforceRecordTypeMetadataFile(fileName, directoryItemTypeEnum) ) {
                continue;
            }

            const recordTypeUri = vscode.Uri.joinPath(recordTypesDirectoryUri, fileName);
            const recordTypeContentUriData = await vscode.workspace.fs.readFile(recordTypeUri);
            const recordTypeXmlContent = Buffer.from(recordTypeContentUriData).toString('utf8');

            let recordTypeXmlDetail: IParsedRecordTypeXmlDetail;

            try {
                recordTypeXmlDetail = RecordTypeService.convertRecordTypeXMLContentToXMLDetailObject(recordTypeXmlContent);
            } catch {
                /*
                    The parser embeds the ENTIRE file in its exception message, and this warning is
                    shown to the user as a notification, so the file name is reported and the message
                    is not. What the parser would have added is "this file is not well-formed XML",
                    which the wording below already says.
                */
                recordSkippedRecordType(`Skipped record type file "${fileName}" under "${objectApiName}": its XML could not be parsed. Fix the markup in that file to have its record type scoped specs generated.`, 'recordTypeXmlUnparseable');
                continue;
            }

            const parsedRecordTypeDeveloperName = recordTypeXmlDetail?.fullName?.[0];

            /*
                The TYPE is checked, not just the presence: nested markup under <fullName> parses to
                an object rather than a string, and an object is truthy, so a presence check alone
                would carry it into the wrapper and fail later at the sort below.
            */
            if ( typeof parsedRecordTypeDeveloperName !== 'string' || parsedRecordTypeDeveloperName.trim() === '' ) {
                recordSkippedRecordType(`Skipped record type file "${fileName}" under "${objectApiName}": no usable RecordType "fullName" markup was found, so the record type has no developer name to scope specs by.`, 'recordTypeMissingDeveloperName');
                continue;
            }

            /*
                Wrapper construction is guarded rather than trusted. Building the picklist sections
                indexes into the markup -- a <picklistValues> block missing its <picklist> child
                throws a TypeError from RecordTypeService rather than returning something empty --
                and unguarded that would unwind the whole walk, losing every object's specs to one
                malformed sibling file. These messages come from the runtime, not from the file, so
                they are safe to show.
            */
            try {
                recordTypeWrappers.push(RecordTypeService.initiateRecordTypeWrapperByXMLDetail(recordTypeXmlDetail, parsedRecordTypeDeveloperName));
            } catch (error) {
                recordSkippedRecordType(
                    `Skipped record type "${parsedRecordTypeDeveloperName}" under "${objectApiName}": its picklist assignment markup could not be read (${error.message}). No record-type-scoped specs were generated for it.`,
                    'recordTypePicklistMarkupUnreadable',
                    parsedRecordTypeDeveloperName
                );
            }

        }

        /*
            This ordering reaches the emitted bytes -- it is the order recordTypeSpecs() lists its
            methods in -- so it uses the same host-independent comparison as every other emission
            sort. It was localeCompare until 3.4.0, which made the generated file depend on the
            host's ICU locale data.
        */
        recordTypeWrappers.sort((firstWrapper, secondWrapper) => this.compareForEmission(firstWrapper.DeveloperName, secondWrapper.DeveloperName));

        return { recordTypeWrappers, skippedRecordTypeWarnings, skippedFields };

    }

    /*
        Narrows already-built field-level specs to the combinations each record type actually exposes.

        The field-level spec is the "bones" -- what the dependent field's <valueSettings> declare --
        and a record type assigns its own subset of values to the controlling and dependent fields on
        top of them. Deriving from the bones rather than re-reading the field XML is what guarantees
        a record-type spec can only ever be a SUBSET of the field-level one, which is the property
        that makes the two safe to assert side by side.

        A field the record type does not mention at all is treated as unassigned for that record type
        rather than as "everything assigned": that is what the recipe generator already does with the
        same markup (see FakerJSRecipeFakerService), and assuming the opposite would assert a contract
        the metadata never stated. Such a combination is skipped with a warning.
    */
    static buildRecordTypeSpecDetails(specDetails: IPicklistDependencySpecDetail[],
                                        recordTypeWrappers: RecordTypeWrapper[]): IRecordTypeSpecDetailBuildResult {

        let recordTypeSpecDetails: IRecordTypePicklistDependencySpecDetail[] = [];
        let skippedFieldWarnings: string[] = [];
        let skippedFields: IPicklistDependencySkippedField[] = [];

        const recordSkippedField = (warning: string,
                                        reason: PicklistDependencySkipReason,
                                        objectApiName: string,
                                        fieldApiName?: string,
                                        recordTypeDeveloperName?: string) => {
            skippedFieldWarnings.push(warning);
            skippedFields.push({ objectApiName, fieldApiName, recordTypeDeveloperName, warning, reason });
        };

        /*
            The object api name is taken from the specs being narrowed rather than passed in: every
            spec detail reaching here belongs to one object by construction, and a record type file
            that named a different one would be describing specs this call was not given.
        */
        const objectApiNameForRecordTypes = specDetails.length > 0 ? specDetails[0].objectApiName : '';

        recordTypeWrappers.forEach(recordTypeWrapper => {

            const recordTypeDeveloperName = recordTypeWrapper.DeveloperName;

            /*
                The developer name is embedded in an Apex string literal and in the generated method
                name, so it goes through the same gate the object and field api names do.
            */
            if ( !this.isValidSalesforceApiName(recordTypeDeveloperName) ) {
                recordSkippedField(
                    `Skipped record type "${recordTypeDeveloperName}": the developer name is not a valid Salesforce api name (letters, numbers and underscores only). No record-type-scoped specs were generated for it.`,
                    'recordTypeInvalidDeveloperName',
                    objectApiNameForRecordTypes,
                    undefined,
                    recordTypeDeveloperName
                );
                return;
            }

            const picklistValuesByFieldApiName = recordTypeWrapper.PicklistFieldSectionsToPicklistDetail ?? {};

            let recordTypeSpecDetailsForRecordType: IRecordTypePicklistDependencySpecDetail[] = [];

            specDetails.forEach(specDetail => {

                const recordTypeControllingValues = this.getAssignedPicklistValues(picklistValuesByFieldApiName[specDetail.controllingFieldApiName]);
                const recordTypeDependentValues = this.getAssignedPicklistValues(picklistValuesByFieldApiName[specDetail.fieldApiName]);

                const unassignedFieldApiName = !recordTypeControllingValues
                    ? specDetail.controllingFieldApiName
                    : ( !recordTypeDependentValues ? specDetail.fieldApiName : undefined );

                if ( unassignedFieldApiName ) {
                    recordSkippedField(
                        `Skipped record type "${recordTypeDeveloperName}" for dependent picklist "${specDetail.objectApiName}.${specDetail.fieldApiName}": the record type assigns no values to "${unassignedFieldApiName}", so no combination is reachable through it. The field-level spec still covers this field.`,
                        'recordTypeAssignsNoValues',
                        specDetail.objectApiName,
                        specDetail.fieldApiName,
                        recordTypeDeveloperName
                    );
                    return;
                }

                recordTypeSpecDetailsForRecordType.push({
                    objectApiName: specDetail.objectApiName,
                    fieldApiName: specDetail.fieldApiName,
                    controllingFieldApiName: specDetail.controllingFieldApiName,
                    expectations: this.buildRecordTypeExpectations(specDetail.expectations, recordTypeControllingValues, recordTypeDependentValues),
                    upstreamFieldApiName: specDetail.upstreamFieldApiName,
                    recordTypeDeveloperName: recordTypeDeveloperName
                });

            });

            /*
                A chain link is only kept where the controlling field ALSO produced a spec for this
                same record type -- the emitted dependsOn names a sibling method, and the upstream
                method does not exist when that field was skipped above.
            */
            const scopedFieldKeys = new Set(recordTypeSpecDetailsForRecordType.map(
                recordTypeSpecDetail => `${recordTypeSpecDetail.objectApiName}.${recordTypeSpecDetail.fieldApiName}`
            ));

            recordTypeSpecDetailsForRecordType.forEach(recordTypeSpecDetail => {

                if ( recordTypeSpecDetail.upstreamFieldApiName
                        && !scopedFieldKeys.has(`${recordTypeSpecDetail.objectApiName}.${recordTypeSpecDetail.upstreamFieldApiName}`) ) {
                    recordTypeSpecDetail.upstreamFieldApiName = undefined;
                }

            });

            recordTypeSpecDetails = recordTypeSpecDetails.concat(recordTypeSpecDetailsForRecordType);

        });

        return { recordTypeSpecDetails, skippedFieldWarnings, skippedFields };

    }

    /*
        The values a record type assigns to one field, or undefined when it usefully assigns none.

        The entries come from xml2js walking markup that nothing has validated: a <values> element
        with no <fullName> yields undefined and one carrying nested markup yields an object. Left in,
        they reach the Apex string escaper as non-strings and throw mid-write, after earlier objects'
        class files have already been written. Filtering here means an unusable entry costs that one
        value, and a field with nothing usable left takes the same "not assigned by this record type"
        path as a field the record type never mentions.
    */
    static getAssignedPicklistValues(assignedPicklistValues: unknown): string[] | undefined {

        if ( !Array.isArray(assignedPicklistValues) ) {
            return undefined;
        }

        const usablePicklistValues = assignedPicklistValues.filter(
            (assignedPicklistValue): assignedPicklistValue is string => typeof assignedPicklistValue === 'string'
        );

        return usablePicklistValues.length > 0 ? usablePicklistValues : undefined;

    }

    /*
        One record type's view of a field-level expectation set.

        The two empty cases are NOT the same assertion, and conflating them emits a spec that must
        fail. A controlling value the record type does not assign is ABSENT under that record type,
        so it becomes expectUnavailable; one the record type does assign but whose unlocked values it
        assigns none of is present and empty, which is expectNone. expectNone requires the value to
        exist -- emitting it for an unassigned value would report a failure against exactly the
        metadata that is correct.

        The forbidden complement is taken against the values the RECORD TYPE assigns rather than every
        value the field declares: a value the record type does not expose at all is already
        unreachable through it, so naming it would assert something about the field rather than about
        this record type.
    */
    static buildRecordTypeExpectations(expectations: IPicklistDependencyExpectation[],
                                        recordTypeControllingValues: string[],
                                        recordTypeDependentValues: string[]): IPicklistDependencyExpectation[] {

        const assignedControllingValues = new Set(recordTypeControllingValues);
        const distinctAssignedDependentValues = [...new Set(recordTypeDependentValues)];
        const assignedDependentValues = new Set(distinctAssignedDependentValues);

        return expectations.map(expectation => {

            if ( !assignedControllingValues.has(expectation.controllingValue) ) {
                return {
                    controllingValue: expectation.controllingValue,
                    dependentValues: [],
                    forbiddenValues: [],
                    controllingValueUnavailable: true
                };
            }

            const dependentValues = expectation.dependentValues.filter(dependentValue => assignedDependentValues.has(dependentValue));

            // AN EMPTY LIST EMITS expectNone, WHICH ALREADY ASSERTS MORE THAN ANY COMPLEMENT COULD
            if ( dependentValues.length === 0 ) {
                return { controllingValue: expectation.controllingValue, dependentValues: [], forbiddenValues: [] };
            }

            const allowedValues = new Set(dependentValues);
            const forbiddenValues = distinctAssignedDependentValues.filter(assignedValue => !allowedValues.has(assignedValue));

            /*
                dependentValues is filtered from an already sorted list and so is still sorted, but
                the complement is taken against the record type's assigned values, whose order is
                the order the record type markup lists them in.
            */
            return {
                controllingValue: expectation.controllingValue,
                dependentValues,
                forbiddenValues: this.sortValuesForEmission(forbiddenValues)
            };

        });

    }

    /*
        The values a global value set declares, or undefined when the set is not available.

        Reads the singleton the recipe pipeline already populates rather than the globalValueSets
        directory directly, so one read of that directory serves both commands. Undefined covers
        both "no globalValueSets directory was read" and "that directory has no such set" -- the
        caller cannot tell a spec apart from an unspeccable field on either, so both are the same
        answer here.
    */
    static getGlobalValueSetPicklistValues(globalValueSetName: string): string[] | undefined {

        if ( !globalValueSetName ) {
            return undefined;
        }

        const picklistValuesByGlobalValueSetName = GlobalValueSetSingleton.getInstance().getPicklistValueMaps();

        if ( !picklistValuesByGlobalValueSetName ) {
            return undefined;
        }

        const globalValueSetPicklistValues = picklistValuesByGlobalValueSetName[globalValueSetName];

        return Array.isArray(globalValueSetPicklistValues) ? globalValueSetPicklistValues : undefined;

    }

    /*
        Resolves a global-value-set-backed dependent picklist against the set it names.

        Two things can be wrong with such a field, and they are answered differently:

        1. The named set cannot be read -- it is not in the project, or the globalValueSets
           directory was never retrieved. Its declared values are then unknowable, and a spec built
           without them would assert a complement of nothing while reading as though it covered the
           field. The field is skipped and the reason is reported.

        2. A valueSettings entry names a value the set does not declare -- most often a value an
           admin removed from the set without cleaning up the field. That value does not exist in
           any org the spec would run against, so asserting it would generate a spec that must fail
           for a reason the spec cannot fix. It is dropped from the expectations and reported. A
           controlling value left unlocking nothing keeps its place and becomes expectNone, which
           is what the metadata now says about it.
    */
    static resolveGlobalValueSetDependentValues(objectApiName: string,
                                                    fieldDetail: XMLFieldDetail,
                                                    controllingValueToPicklistOptions: Record<string, string[]>): IGlobalValueSetDependentValueResolution {

        let warnings: IPicklistDependencySkipWarning[] = [];

        const globalValueSetName = fieldDetail.globalValueSetName;
        const declaredDependentValues = this.getGlobalValueSetPicklistValues(globalValueSetName);

        if ( !declaredDependentValues ) {

            warnings.push({
                warning: `Skipped dependent picklist "${objectApiName}.${fieldDetail.apiName}": its values come from the global value set "${globalValueSetName}", which was not found in the project's "globalValueSets" directory. Retrieve that global value set and run the command again to have this field specced.`,
                reason: 'globalValueSetNotFound'
            });
            return { declaredDependentValues: undefined, controllingValueToPicklistOptions, warnings };

        }

        const declaredDependentValueSet = new Set(declaredDependentValues);

        let undeclaredValueNames = new Set<string>();
        let filteredControllingValueToPicklistOptions: Record<string, string[]> = {};

        Object.entries(controllingValueToPicklistOptions).forEach(([controllingValue, dependentValues]) => {

            dependentValues.forEach(dependentValue => {

                if ( !declaredDependentValueSet.has(dependentValue) ) {
                    undeclaredValueNames.add(dependentValue);
                }

            });

            filteredControllingValueToPicklistOptions[controllingValue] = dependentValues.filter(
                dependentValue => declaredDependentValueSet.has(dependentValue)
            );

        });

        if ( undeclaredValueNames.size > 0 ) {

            const sortedUndeclaredValueNames = [...undeclaredValueNames].sort();
            warnings.push({
                warning: `Dependent picklist "${objectApiName}.${fieldDetail.apiName}" has "valueSettings" for ${sortedUndeclaredValueNames.map(undeclaredValueName => `"${undeclaredValueName}"`).join(', ')}, which the global value set "${globalValueSetName}" does not declare. Those values were left out of the generated spec -- no org exposes them, so asserting them would fail for a reason the spec cannot fix.`,
                reason: 'valueNotDeclaredInGlobalValueSet'
            });

        }

        return { declaredDependentValues, controllingValueToPicklistOptions: filteredControllingValueToPicklistOptions, warnings };

    }

    /*
        Every value a field declares, wherever they live -- the global value set it names when it
        names one, and its own markup otherwise. A global-value-set-backed field falls back to its
        own values when the set cannot be read, which for a field whose values are only its
        valueSettings is a partial list rather than a wrong one.
    */
    static buildDeclaredValuesByFieldDetail(fieldDetail: XMLFieldDetail | undefined): string[] {

        if ( !fieldDetail ) {
            return [];
        }

        if ( fieldDetail.globalValueSetName ) {

            const globalValueSetPicklistValues = this.getGlobalValueSetPicklistValues(fieldDetail.globalValueSetName);
            if ( globalValueSetPicklistValues ) {
                return globalValueSetPicklistValues;
            }

        }

        return this.buildDeclaredDependentValues(fieldDetail);

    }

    /*
        Every value the dependent field declares, which is the universe a forbidden list is the
        complement against. A value carrying no <valueSettings> entry at all is unreachable under
        every controlling value, and so belongs in every complement -- taking the universe from the
        declared values rather than from the valueSettings map is what makes that fall out.
    */
    static buildDeclaredDependentValues(dependentFieldDetail: XMLFieldDetail | undefined): string[] {

        if ( !dependentFieldDetail || !dependentFieldDetail.picklistValues ) {
            return [];
        }

        return dependentFieldDetail.picklistValues.map(picklistOption => picklistOption.picklistOptionApiName);

    }

    /*
        Controlling values that unlock dependent values come from the dependent field's own
        <valueSettings>. Controlling values that unlock nothing are only discoverable by diffing
        against the values the CONTROLLING field declares.

        Both declared value universes are passed in rather than read from an XMLFieldDetail here,
        because where they live depends on the field: a locally defined picklist declares them in
        its own markup and a global-value-set-backed one declares them in the set it names. Taking
        them as lists keeps this a pure function of what it is given -- see
        buildDeclaredValuesByFieldDetail, which is what resolves either shape.

        Each controlling value that unlocks something also gets the complement of what it unlocks,
        emitted as expectNotAllowed. expectAtLeast alone cannot catch a value drifting INTO a
        combination, and switching the generator to expectExactly would instead fire on any value
        an admin legitimately adds to the field after generation.

        A controlling value that unlocks nothing gets no complement: expectNone already asserts that
        it unlocks nothing at all, which is strictly stronger than naming each value it must not
        unlock.
    */
    static buildExpectations(controllingValueToPicklistOptions: Record<string, string[]>,
                                declaredDependentValues: string[],
                                declaredControllingValues: string[]): IPicklistDependencyExpectation[] {

        let expectations: IPicklistDependencyExpectation[] = Object.entries(controllingValueToPicklistOptions).map(
            ([controllingValue, dependentValues]) => {

                const allowedValues = new Set(dependentValues);
                const forbiddenValues = declaredDependentValues.filter(declaredValue => !allowedValues.has(declaredValue));

                return {
                    controllingValue,
                    dependentValues: this.sortValuesForEmission(dependentValues),
                    forbiddenValues: this.sortValuesForEmission(forbiddenValues)
                };

            }
        );

        declaredControllingValues.forEach(controllingValue => {

            if ( controllingValue in controllingValueToPicklistOptions ) {
                return;
            }

            expectations.push({ controllingValue: controllingValue, dependentValues: [], forbiddenValues: [] });

        });

        /*
            Two orders are erased here. Object.entries follows the insertion order of the
            valueSettings markup, and the sweep above appends the controlling values that unlock
            nothing after it -- so a value moving between those two groups reordered the whole
            emitted block. Sorting also keeps the two groups interleaved by name rather than
            segregated, which is how a reader looks a controlling value up.
        */
        expectations.sort((firstExpectation, secondExpectation) => this.compareForEmission(firstExpectation.controllingValue, secondExpectation.controllingValue));

        return expectations;

    }

    /*
        The one comparison every ordering that reaches the emitted bytes goes through.

        Code unit order, deliberately NOT localeCompare: localeCompare's result depends on the
        host's ICU locale data, so the same metadata could emit different bytes on two machines --
        the exact portability problem the sorting exists to remove.
    */
    static compareForEmission(firstValue: string, secondValue: string): number {
        return ( firstValue < secondValue ) ? -1 : ( firstValue > secondValue ) ? 1 : 0;
    }

    /*
        A copy, sorted. The forbidden list is the complement of what a controlling value unlocks,
        taken in declaration order, so inserting one value into the middle of a picklist shifted
        that value's position in EVERY forbidden list in the file -- a one value change arriving as
        a diff across every combination. Sorted, the same edit touches only the lines that actually
        changed.

        Sorting a copy rather than in place matters: dependentValues is handed straight out of the
        controllingValueToPicklistOptions map, which the caller may still read.
    */
    static sortValuesForEmission(values: string[]): string[] {
        return [...values].sort((firstValue, secondValue) => this.compareForEmission(firstValue, secondValue));
    }

    static escapeApexStringLiteral(value: string): string {

        return value
            .replace(/\\/g, '\\\\')
            .replace(/'/g, `\\'`)
            .replace(/\r\n|\r|\n/g, '\\n');

    }

    /*
        One Apex method name per (object, field) scenario.

        Apex identifiers may not contain two consecutive underscores, so runs are collapsed exactly as
        they are for the generated test methods -- every custom api name ends in "__c". The "specFor"
        prefix keeps the identifier valid whatever the api name starts with, including a digit, and
        reads as a factory at the call site inside all().
    */
    /*
        Neutralised for an Apex comment.

        Picklist values are admin controlled text. A value carrying a newline would end the line
        comment and leave the rest of the value as code, and one carrying a block comment terminator
        would close the class header early. Neither is producible through the Salesforce UI, which
        is exactly why nothing else in the pipeline would catch it.
    */
    static escapeApexComment(value: string): string {

        return String(value)
            .replace(/[\r\n]+/g, ' ')
            .replace(/\*\//g, '* /');

    }

    /*
        How many values one plain-language comment line names before it summarises the rest.

        The comment is a summary, not a second copy of the assertions -- those sit directly beneath
        it with every value. An uncapped line on a two hundred value picklist produces a comment
        nobody reads, which is the opposite of what emitting it is for.
    */
    private static maximumCommentedValueCount = 12;

    static buildCommentedValueList(values: string[]): string {

        const escapedValues = values.map(value => this.escapeApexComment(value));

        if ( escapedValues.length <= this.maximumCommentedValueCount ) {
            return escapedValues.join(', ');
        }

        const namedValues = escapedValues.slice(0, this.maximumCommentedValueCount);
        const remainingValueCount = escapedValues.length - this.maximumCommentedValueCount;

        return `${namedValues.join(', ')} ...and ${remainingValueCount} more`;

    }

    /*
        One combination in the words a reader would use for it, rather than in the builder calls
        that assert it. Reading the generated spec is meant to beat clicking through the Salesforce
        dependency matrix, and that only holds if the file says what the dependency IS above the
        lines that say how it is checked.
    */
    static buildCombinationCommentLine(expectation: IPicklistDependencyExpectation, recordTypeDeveloperName?: string): string {

        const controllingValue = this.escapeApexComment(expectation.controllingValue);

        if ( expectation.controllingValueUnavailable ) {
            return `     *   "${controllingValue}" is not available under record type ${this.escapeApexComment(recordTypeDeveloperName ?? '')}`;
        }

        if ( expectation.dependentValues.length === 0 ) {
            return `     *   "${controllingValue}" unlocks nothing`;
        }

        const unlockedValuesMarkup = this.buildCommentedValueList(expectation.dependentValues);

        if ( !expectation.forbiddenValues || expectation.forbiddenValues.length === 0 ) {
            return `     *   "${controllingValue}" unlocks ${unlockedValuesMarkup}`;
        }

        const forbiddenValuesMarkup = this.buildCommentedValueList(expectation.forbiddenValues);

        return `     *   "${controllingValue}" unlocks ${unlockedValuesMarkup} -- and must not unlock ${forbiddenValuesMarkup}`;

    }

    static buildSpecMethodComment(specDetail: IPicklistDependencySpecDetail): string {

        const fieldApiName = this.escapeApexComment(specDetail.fieldApiName);
        const controllingFieldApiName = this.escapeApexComment(specDetail.controllingFieldApiName);

        const recordTypeScopeSentence = specDetail.recordTypeDeveloperName
            ? `\n     * Narrowed to what record type ${this.escapeApexComment(specDetail.recordTypeDeveloperName)} assigns.`
            : '';

        const upstreamSentence = specDetail.upstreamFieldApiName
            ? `\n     * ${controllingFieldApiName} is itself a dependent picklist, so this spec chains off it.`
            : '';

        const combinationCommentLines = specDetail.expectations
            .map(expectation => this.buildCombinationCommentLine(expectation, specDetail.recordTypeDeveloperName))
            .join('\n');

        const combinationsBlock = specDetail.expectations.length === 0
            ? ''
            : `\n     *\n     * Combinations:\n${combinationCommentLines}`;

        return `    /**
     * ${fieldApiName} depends on ${controllingFieldApiName}.${recordTypeScopeSentence}${upstreamSentence}${combinationsBlock}
     */`;

    }

    /*
        The object's dependent picklists named up front, so the top of the file answers "what does
        this class cover" without reading every method signature below it.
    */
    static buildDependentFieldSummaryLines(specDetails: IPicklistDependencySpecDetail[]): string {

        return specDetails
            .map(specDetail => ` *   ${this.escapeApexComment(specDetail.fieldApiName)} depends on ${this.escapeApexComment(specDetail.controllingFieldApiName)}`)
            .join('\n');

    }

    static buildSpecMethodName(objectApiName: string, fieldApiName: string, recordTypeDeveloperName?: string): string {

        /*
            A record type scoped method sits beside the field-level one for the same field, so the
            developer name is what separates them. Apex class names are capped at 40 characters and
            method names are not, so the longer identifier is spelled out rather than truncated.
        */
        const assembledMethodName = recordTypeDeveloperName
            ? `specFor_${objectApiName}_${fieldApiName}_recordType_${recordTypeDeveloperName}`
            : `specFor_${objectApiName}_${fieldApiName}`;

        /*
            Every name reaching here is validated by the caller, so both steps below are no-ops for
            real api names. They are applied anyway for the same reason buildSpecStatement escapes
            already-validated names: an identifier is a sink that no escaping protects, so it stays
            safe on its own terms rather than depending on a caller having validated first.

            The collapse runs over the ASSEMBLED name rather than per segment -- collapsing each part
            first still leaves a pair spanning the join, where a name ending or beginning with an
            underscore meets the separator, and Apex rejects two underscores in a row.
        */
        return assembledMethodName.replace(/[^A-Za-z0-9_]/g, '').replace(/_{2,}/g, '_');

    }

    /*
        Collapsing can map two distinct scenarios onto one identifier, and two Apex methods with the
        same name will not compile, so later collisions take a numeric suffix.
    */
    static buildSpecMethodNamesBySpecDetail(specDetails: IPicklistDependencySpecDetail[]): string[] {

        let usedMethodNames = new Set<string>();

        return specDetails.map(specDetail => {

            const baseMethodName = this.buildSpecMethodName(specDetail.objectApiName, specDetail.fieldApiName, specDetail.recordTypeDeveloperName);

            let uniqueMethodName = baseMethodName;
            let collisionSuffix = 2;
            while ( usedMethodNames.has(uniqueMethodName) ) {
                uniqueMethodName = `${baseMethodName}_${collisionSuffix}`;
                collisionSuffix++;
            }

            usedMethodNames.add(uniqueMethodName);
            return uniqueMethodName;

        });

    }

    /*
        One spec class per object rather than one for the whole org. A registry covering every
        dependent picklist in a real org is not something anyone reads; per object it is, and a
        regeneration touching one object no longer rewrites a file the diff for every other object
        also lands in.

        Splitting per FIELD was considered and rejected: it multiplies files by the number of
        dependent picklists for no gain in readability, and would separate a chained picklist from
        the field that controls it.
    */
    static buildPerObjectSpecsClassName(objectApiName: string): string {

        const collapsedUnderscores = objectApiName.replace(/_{2,}/g, '_');
        const identifierSafeObjectApiName = /^[0-9]/.test(collapsedUnderscores) ? `object${collapsedUnderscores}` : collapsedUnderscores;

        const classNamePrefix = `${this.specsClassName}_`;
        const candidateClassName = `${classNamePrefix}${identifierSafeObjectApiName}`;

        if ( candidateClassName.length <= this.maximumApexClassNameLength ) {
            return candidateClassName;
        }

        /*
            A custom object api name can itself reach 40 characters, so no prefix short enough to be
            readable guarantees a legal name. The overflow is truncated and given a digest of the
            FULL api name, which keeps the result unique and -- unlike a positional suffix -- stable
            across runs. An unstable name would orphan the previously generated class in the org.
        */
        const objectApiNameDigest = crypto.createHash('sha256').update(objectApiName).digest('hex').slice(0, 6);
        const truncatedLength = this.maximumApexClassNameLength - classNamePrefix.length - objectApiNameDigest.length - 1;

        // A TRAILING UNDERSCORE WOULD MEET THE SEPARATOR AND FORM THE "__" APEX FORBIDS IN AN IDENTIFIER
        const truncatedObjectApiName = identifierSafeObjectApiName.slice(0, truncatedLength).replace(/_+$/, '');

        return `${classNamePrefix}${truncatedObjectApiName}_${objectApiNameDigest}`;

    }

    /*
        Two object api names can collapse to one identifier ("Foo__c" and "Foo_c"), and two Apex
        classes with the same name will not deploy, so later collisions take a numeric suffix. The
        common case -- no collision -- keeps the unsuffixed name a reader expects.
    */
    static buildPerObjectSpecsClassNamesByObjectApiName(objectApiNames: string[]): Record<string, string> {

        let classNamesByObjectApiName: Record<string, string> = {};
        let usedClassNames = new Set<string>();

        objectApiNames.forEach(objectApiName => {

            const baseClassName = this.buildPerObjectSpecsClassName(objectApiName);

            let uniqueClassName = baseClassName;
            let collisionSuffix = 2;
            while ( usedClassNames.has(uniqueClassName) ) {
                uniqueClassName = `${baseClassName}_${collisionSuffix}`;
                collisionSuffix++;
            }

            usedClassNames.add(uniqueClassName);
            classNamesByObjectApiName[objectApiName] = uniqueClassName;

        });

        return classNamesByObjectApiName;

    }

    static getDistinctObjectApiNames(specDetails: IPicklistDependencySpecDetail[]): string[] {
        return [...new Set(specDetails.map(specDetail => specDetail.objectApiName))].sort();
    }

    static groupSpecDetailsByObjectApiName(specDetails: IPicklistDependencySpecDetail[]): Record<string, IPicklistDependencySpecDetail[]> {

        let specDetailsByObjectApiName: Record<string, IPicklistDependencySpecDetail[]> = {};

        specDetails.forEach(specDetail => {
            specDetailsByObjectApiName[specDetail.objectApiName] = specDetailsByObjectApiName[specDetail.objectApiName] || [];
            specDetailsByObjectApiName[specDetail.objectApiName].push(specDetail);
        });

        return specDetailsByObjectApiName;

    }

    static buildPerObjectSpecsApexClassBody(objectApiName: string,
                                                perObjectClassName: string,
                                                specDetails: IPicklistDependencySpecDetail[],
                                                recordTypeSpecDetails: IRecordTypePicklistDependencySpecDetail[] = []): string {

        /*
            Names are assigned over BOTH kinds in one pass. Uniqueness has to hold across the whole
            class -- a record type called after a field could otherwise collapse onto a field-level
            method name -- and two Apex methods with the same name will not compile.
        */
        const allSpecDetails: IPicklistDependencySpecDetail[] = [...specDetails, ...recordTypeSpecDetails];
        const allSpecMethodNames = this.buildSpecMethodNamesBySpecDetail(allSpecDetails);

        const specMethodNames = allSpecMethodNames.slice(0, specDetails.length);
        const recordTypeSpecMethodNames = allSpecMethodNames.slice(specDetails.length);

        /*
            A controlling field always lives on the same object as the field it controls, so the spec
            a dependsOn names is always a sibling method in this same class and needs no qualifier.
        */
        let specMethodNameByFieldApiName: Record<string, string> = {};
        specDetails.forEach((specDetail, specDetailIndex) => {
            specMethodNameByFieldApiName[specDetail.fieldApiName] = specMethodNames[specDetailIndex];
        });

        /*
            A field naming ITSELF as its controlling field resolves to its own method, and emitting
            the dependsOn would make the spec call itself. Source metadata can declare that -- a
            picklist whose controllingField is the picklist -- and the Explorer already treats such
            a field as a root rather than nesting it under itself, so without this the panel would
            draw a root while the class it names contained a self-recursive spec.
        */
        const resolveUpstreamSpecMethodName = (specDetail: IPicklistDependencySpecDetail,
                                                specMethodNamesByKey: Record<string, string>,
                                                upstreamKey: string | undefined): string | undefined => {

            if ( !specDetail.upstreamFieldApiName || specDetail.upstreamFieldApiName === specDetail.fieldApiName ) {
                return undefined;
            }

            return upstreamKey === undefined ? undefined : specMethodNamesByKey[upstreamKey];

        };

        // A RECORD TYPE SCOPED SPEC CHAINS TO THE UPSTREAM SPEC FOR THE SAME RECORD TYPE, NOT TO THE FIELD-LEVEL ONE
        let recordTypeSpecMethodNameByScopedFieldKey: Record<string, string> = {};
        recordTypeSpecDetails.forEach((recordTypeSpecDetail, recordTypeSpecDetailIndex) => {
            const scopedFieldKey = `${recordTypeSpecDetail.recordTypeDeveloperName}.${recordTypeSpecDetail.fieldApiName}`;
            recordTypeSpecMethodNameByScopedFieldKey[scopedFieldKey] = recordTypeSpecMethodNames[recordTypeSpecDetailIndex];
        });

        const buildSpecMethodMarkup = (specDetail: IPicklistDependencySpecDetail, specMethodName: string, upstreamSpecMethodName?: string) => {

            const specStatement = this.buildSpecStatement(specDetail, upstreamSpecMethodName);

            /*
                The comment is built from the SAME spec detail the statement below it is built from,
                so the plain language description and the assertions cannot drift apart -- there is
                no second source for either to be derived from.
            */
            return `${this.buildSpecMethodComment(specDetail)}
    public static SDTPicklistDependencySpec ${specMethodName}() {
        return ${specStatement.trim()};
    }`;

        };

        const specMethods = specDetails.map((specDetail, specDetailIndex) => {

            const upstreamSpecMethodName = resolveUpstreamSpecMethodName(
                specDetail,
                specMethodNameByFieldApiName,
                specDetail.upstreamFieldApiName
            );

            return buildSpecMethodMarkup(specDetail, specMethodNames[specDetailIndex], upstreamSpecMethodName);

        }).join('\n\n');

        const recordTypeSpecMethods = recordTypeSpecDetails.map((recordTypeSpecDetail, recordTypeSpecDetailIndex) => {

            const upstreamSpecMethodName = resolveUpstreamSpecMethodName(
                recordTypeSpecDetail,
                recordTypeSpecMethodNameByScopedFieldKey,
                recordTypeSpecDetail.upstreamFieldApiName
                    ? `${recordTypeSpecDetail.recordTypeDeveloperName}.${recordTypeSpecDetail.upstreamFieldApiName}`
                    : undefined
            );

            return buildSpecMethodMarkup(recordTypeSpecDetail, recordTypeSpecMethodNames[recordTypeSpecDetailIndex], upstreamSpecMethodName);

        }).join('\n\n');

        const specsListMarkup = ( specDetails.length === 0 )
            ? `        return new List<SDTPicklistDependencySpec>();`
            : `        return new List<SDTPicklistDependencySpec>{\n${specMethodNames.map(specMethodName => `            ${specMethodName}()`).join(',\n')}\n        };`;

        const specMethodsBlock = ( specDetails.length === 0 ) ? '' : `\n${specMethods}\n`;

        /*
            Everything record type scoped is emitted ONLY when the object has record type
            assignments to scope by, so an object without a recordTypes directory keeps exactly the
            class body it had before record type support existed.
        */
        const recordTypeSpecMethodsBlock = ( recordTypeSpecDetails.length === 0 )
            ? ''
            : `\n${recordTypeSpecMethods}\n
    /**
     * The record type scoped specs for ${objectApiName}, kept out of all() because no source that
     * ships with the framework can verify them: Schema describe returns picklist values without
     * record type filtering, so SDTSchemaPicklistDependencySource rejects a record type scoped spec
     * rather than answering it with field-level data. Pass these to a validator built on a record
     * type aware ISDTPicklistDependencySource.
     */
    public static List<SDTPicklistDependencySpec> recordTypeSpecs() {
        return new List<SDTPicklistDependencySpec>{\n${recordTypeSpecMethodNames.map(recordTypeSpecMethodName => `            ${recordTypeSpecMethodName}()`).join(',\n')}\n        };
    }
`;

        const recordTypeHeaderMarkup = ( recordTypeSpecDetails.length === 0 )
            ? ''
            : `
 *
 * recordTypeSpecs() narrows those combinations to what each record type under ${objectApiName}
 * assigns. A controlling value the record type does not assign becomes expectUnavailable -- under
 * that record type the value is absent, not empty, and expectNone would demand it exist. One the
 * record type does assign but whose unlocked values it assigns none of becomes expectNone, which
 * is exactly that assertion. A field the record type does not mention at all is treated as
 * unassigned rather than as fully assigned, so that combination is left out entirely and reported
 * as a skipped field when the specs are generated.`;

        return `/**
 * GENERATED FILE -- commit it, and review each regeneration as a diff.
 *
 * Picklist dependency specs for ${objectApiName}, created by the Salesforce Data Treecipe
 * "Generate Picklist Dependency Tests" command from local source metadata.
 *
 * Dependent picklists on ${objectApiName}:
${this.buildDependentFieldSummaryLines(specDetails)}
 *
 * Each dependent picklist gets its own method, and all() returns the collection of them.
 * ${this.specsClassName}.all() aggregates this class together with the other objects'.
 *
 * Emission is deterministic -- spec methods ordered by field api name, expectations by controlling
 * value, and every value list sorted -- so regenerating from unchanged metadata rewrites this file
 * byte for byte identically, and a real metadata change arrives as a diff of only the lines that
 * changed. Edit an expectation to declare the dependency you INTEND, watch the test go red, and fix
 * the org metadata until it goes green; regeneration then shows your edit as a diff to keep or
 * revert per hunk, rather than silently replacing it.
 *
 * Every combination is asserted twice: expectAtLeast for the values the controlling value must
 * unlock, and expectNotAllowed for the values it must not. The pair catches a value both
 * disappearing from a combination and drifting into one, while still tolerating a value an admin
 * adds to the field in the org after generation. Adding a value to an expectAtLeast list without
 * removing it from that controlling value's expectNotAllowed list makes the spec unsatisfiable;
 * the validator reports that as CONTRADICTORY_EXPECTATION rather than as org
 * drift.${recordTypeHeaderMarkup}
 */
public class ${perObjectClassName} {
${specMethodsBlock}
    public static List<SDTPicklistDependencySpec> all() {
${specsListMarkup}
    }
${recordTypeSpecMethodsBlock}}
`;

    }

    /*
        The aggregator is the one name the generated test class and any hand written caller depend
        on, so it stays stable while the per-object classes behind it come and go with the metadata.
    */
    static buildAggregatorSpecsApexClassBody(classNamesByObjectApiName: Record<string, string>,
                                                objectApiNamesWithRecordTypeSpecs: string[] = []): string {

        const objectApiNames = Object.keys(classNamesByObjectApiName).sort();

        /*
            Only the objects that actually emitted a recordTypeSpecs() method are aggregated -- the
            per-object classes emit it only where there is something to scope, so calling it
            unconditionally would name a method that does not exist on most of them.
        */
        const recordTypeScopedObjectApiNames = objectApiNames.filter(
            objectApiName => objectApiNamesWithRecordTypeSpecs.includes(objectApiName)
        );

        const recordTypeAggregationMarkup = ( recordTypeScopedObjectApiNames.length === 0 )
            ? ''
            : `
    /**
     * The record type scoped specs, aggregated separately from all() because no source shipped with
     * the framework can verify them -- Schema describe is record type blind, so
     * SDTSchemaPicklistDependencySource rejects them rather than answering with field-level data.
     * Pass these to a validator built on a record type aware ISDTPicklistDependencySource.
     */
    public static List<SDTPicklistDependencySpec> allRecordTypeScoped() {
        List<SDTPicklistDependencySpec> recordTypeScopedSpecs = new List<SDTPicklistDependencySpec>();
${recordTypeScopedObjectApiNames.map(objectApiName => `        recordTypeScopedSpecs.addAll(${classNamesByObjectApiName[objectApiName]}.recordTypeSpecs());`).join('\n')}
        return recordTypeScopedSpecs;
    }
`;

        const aggregationMarkup = ( objectApiNames.length === 0 )
            ? `        return new List<SDTPicklistDependencySpec>();`
            : `        List<SDTPicklistDependencySpec> specs = new List<SDTPicklistDependencySpec>();\n`
                + objectApiNames.map(objectApiName => `        specs.addAll(${classNamesByObjectApiName[objectApiName]}.all());`).join('\n')
                + `\n        return specs;`;

        const perObjectClassLines = objectApiNames.length === 0
            ? ' * No object in the scanned metadata declares a dependent picklist.'
            : objectApiNames.map(objectApiName => ` *   - ${objectApiName}: ${classNamesByObjectApiName[objectApiName]}`).join('\n');

        return `/**
 * GENERATED FILE -- regenerating overwrites it.
 *
 * Aggregates the per-object picklist dependency spec classes the Salesforce Data Treecipe
 * "Generate Picklist Dependency Tests" command emits:
 *
${perObjectClassLines}
 *
 * Callers depend on this class rather than on the per-object ones, so a class appearing or
 * disappearing as metadata changes does not ripple outwards.
 */
public class ${this.specsClassName} {

    public static List<SDTPicklistDependencySpec> all() {
${aggregationMarkup}
    }
${recordTypeAggregationMarkup}}
`;

    }

    static buildSpecStatement(specDetail: IPicklistDependencySpecDetail, upstreamSpecMethodName?: string): string {

        /*
            Api names are validated before a spec is built, so escaping them is a no-op for every
            name that reaches here. It is applied anyway so that emission stays safe on its own
            terms rather than depending on a caller having validated first.
        */
        const objectApiName = this.escapeApexStringLiteral(specDetail.objectApiName);
        const fieldApiName = this.escapeApexStringLiteral(specDetail.fieldApiName);
        const controllingFieldApiName = this.escapeApexStringLiteral(specDetail.controllingFieldApiName);

        let specStatement = specDetail.recordTypeDeveloperName
            ? `            SDTPicklistDependencySpec.forRecordType('${objectApiName}', '${fieldApiName}', '${this.escapeApexStringLiteral(specDetail.recordTypeDeveloperName)}')`
            : `            SDTPicklistDependencySpec.forField('${objectApiName}', '${fieldApiName}')`;

        specStatement += `\n                .controlledBy('${controllingFieldApiName}')`;

        if ( upstreamSpecMethodName ) {
            specStatement += `\n                .dependsOn(${upstreamSpecMethodName}())`;
        }

        const buildValueListMarkup = (values: string[]) => values
            .map(value => `'${this.escapeApexStringLiteral(value)}'`)
            .join(', ');

        specDetail.expectations.forEach(expectation => {

            const escapedControllingValue = this.escapeApexStringLiteral(expectation.controllingValue);

            /*
                Checked before the empty case below: an unavailable controlling value also has no
                dependent values, and expectNone would assert that it exists.
            */
            if ( expectation.controllingValueUnavailable ) {

                specStatement += `\n                .expectUnavailable('${escapedControllingValue}')`;
                return;

            }

            if ( expectation.dependentValues.length === 0 ) {

                specStatement += `\n                .expectNone('${escapedControllingValue}')`;
                return;

            }

            specStatement += `\n                .expectAtLeast('${escapedControllingValue}', new List<String>{ ${buildValueListMarkup(expectation.dependentValues)} })`;

            /*
                An empty complement means the controlling value unlocks everything the field
                declares, so there is nothing it must not unlock and the line would assert nothing.
            */
            if ( expectation.forbiddenValues && expectation.forbiddenValues.length > 0 ) {
                specStatement += `\n                .expectNotAllowed('${escapedControllingValue}', new List<String>{ ${buildValueListMarkup(expectation.forbiddenValues)} })`;
            }

        });

        return specStatement;

    }

    /*
        The inverse of escapeApexStringLiteral.

        Order matters and is the reverse of escaping: the backslash unescape runs LAST, so a value
        that legitimately contains a backslash followed by a quote is not mistaken for an escaped
        quote. Doing it in the other order would turn "\\'" -- an escaped backslash then a quote
        delimiter -- into a literal quote and swallow the string's own terminator.
    */
    static unescapeApexStringLiteral(value: string): string {

        let unescapedValue = '';

        for ( let characterIndex = 0; characterIndex < value.length; characterIndex++ ) {

            const currentCharacter = value[characterIndex];

            if ( currentCharacter !== '\\' || characterIndex === value.length - 1 ) {
                unescapedValue += currentCharacter;
                continue;
            }

            const escapedCharacter = value[characterIndex + 1];
            characterIndex++;

            if ( escapedCharacter === 'n' ) {
                unescapedValue += '\n';
                continue;
            }

            // A BACKSLASH BEFORE ANYTHING ELSE ESCAPED THAT CHARACTER LITERALLY -- QUOTE OR BACKSLASH ALIKE
            unescapedValue += escapedCharacter;

        }

        return unescapedValue;

    }

    /*
        Every Apex string literal in one argument list, in order.

        Scanned character by character rather than matched with a regex, because a picklist value may
        contain an escaped quote -- "Bob\'s Diner" -- and a regex for '([^']*)' terminates on it. The
        escape is what a naive split gets wrong, and picklist values carrying apostrophes are the
        common case, not the exotic one.
    */
    static parseApexStringLiterals(argumentMarkup: string): string[] {

        let literals: string[] = [];
        let currentLiteral = '';
        let isInsideLiteral = false;

        for ( let characterIndex = 0; characterIndex < argumentMarkup.length; characterIndex++ ) {

            const currentCharacter = argumentMarkup[characterIndex];

            if ( !isInsideLiteral ) {

                if ( currentCharacter === `'` ) {
                    isInsideLiteral = true;
                    currentLiteral = '';
                }

                continue;

            }

            if ( currentCharacter === '\\' && characterIndex < argumentMarkup.length - 1 ) {
                currentLiteral += currentCharacter + argumentMarkup[characterIndex + 1];
                characterIndex++;
                continue;
            }

            if ( currentCharacter === `'` ) {
                literals.push(this.unescapeApexStringLiteral(currentLiteral));
                isInsideLiteral = false;
                continue;
            }

            currentLiteral += currentCharacter;

        }

        return literals;

    }

    /*
        Every Apex comment replaced by spaces of the same length, so offsets are unchanged.

        Without this a single apostrophe in a comment -- "// don't touch this one", which is exactly
        what a hand annotated spec file contains -- flips the literal-parity toggle every scanner
        here depends on. The terminating semicolon then reads as being inside a string, the statement
        is never closed, and the whole spec is dropped with no diagnostic at all. Silently losing a
        spec is the worst outcome available to writeback: it would reconcile metadata against an
        intent the developer wrote and the parser never saw.

        String literals are tracked while blanking, so a picklist value containing "//" or "/*" is
        left alone. Newlines inside a block comment are preserved so line based indexing still holds.
    */
    static blankApexComments(apexClassBody: string): string {

        let blankedCharacters: string[] = [];
        let isInsideLiteral = false;
        let characterIndex = 0;

        while ( characterIndex < apexClassBody.length ) {

            const currentCharacter = apexClassBody[characterIndex];
            const nextCharacter = apexClassBody[characterIndex + 1];

            if ( isInsideLiteral ) {

                blankedCharacters.push(currentCharacter);

                if ( currentCharacter === '\\' && characterIndex < apexClassBody.length - 1 ) {
                    blankedCharacters.push(nextCharacter);
                    characterIndex += 2;
                    continue;
                }

                if ( currentCharacter === `'` ) {
                    isInsideLiteral = false;
                }

                characterIndex++;
                continue;

            }

            if ( currentCharacter === `'` ) {
                isInsideLiteral = true;
                blankedCharacters.push(currentCharacter);
                characterIndex++;
                continue;
            }

            if ( currentCharacter === '/' && nextCharacter === '/' ) {

                while ( characterIndex < apexClassBody.length && apexClassBody[characterIndex] !== '\n' ) {
                    blankedCharacters.push(' ');
                    characterIndex++;
                }

                continue;

            }

            if ( currentCharacter === '/' && nextCharacter === '*' ) {

                const commentEndIndex = apexClassBody.indexOf('*/', characterIndex + 2);
                // AN UNTERMINATED BLOCK COMMENT RUNS TO END OF FILE, WHICH IS HOW A COMPILER READS IT TOO
                const blankUntilIndex = commentEndIndex === -1 ? apexClassBody.length : commentEndIndex + 2;

                while ( characterIndex < blankUntilIndex ) {
                    blankedCharacters.push(apexClassBody[characterIndex] === '\n' ? '\n' : ' ');
                    characterIndex++;
                }

                continue;

            }

            blankedCharacters.push(currentCharacter);
            characterIndex++;

        }

        return blankedCharacters.join('');

    }

    /*
        A generated class body read back into the spec details it declares.

        This is the inverse of buildSpecStatement, and it lives beside it deliberately: writeback
        exists so a hand EDITED spec can be pushed into metadata, which means the intent it reads is
        whatever the developer left in the .cls rather than anything the generator produced. Emission
        and parsing drifting apart would silently reconcile metadata against a spec nobody wrote, so
        the two stay in one file and one round-trip test holds them together.

        Only field-level specs are returned. A record-type-scoped spec narrows what a record type
        exposes rather than what the field declares, and writing that back into valueSettings would
        assert the narrowing on every record type -- so those are recognised and skipped rather than
        misapplied.
    */
    static parseSpecDetailsByApexClassBody(apexClassBody: string, objectApiName?: string): IPicklistDependencySpecDetail[] {

        let specDetails: IPicklistDependencySpecDetail[] = [];

        // COMMENTS CARRY NOTHING THE PARSER NEEDS, AND CARRY APOSTROPHES THAT BREAK IT -- SEE blankApexComments
        const specMethodBodies = this.collectSpecMethodBodies(this.blankApexComments(apexClassBody));

        specMethodBodies.forEach(specMethodBody => {

            const specDetail = this.parseSpecDetailByStatement(specMethodBody);

            if ( !specDetail ) {
                return;
            }

            /*
                Recognised and dropped rather than never parsed, so a malformed scoped spec is still
                a parse failure the caller hears about instead of markup silently skipped.
            */
            if ( specDetail.recordTypeDeveloperName !== undefined ) {
                return;
            }

            // A CALLER RECONCILING ONE OBJECT IGNORES A CLASS THAT TURNS OUT TO DESCRIBE ANOTHER
            if ( objectApiName !== undefined && specDetail.objectApiName !== objectApiName ) {
                return;
            }

            specDetails.push(specDetail);

        });

        this.applyUpstreamFieldApiNames(specDetails);

        return specDetails;

    }

    /*
        The chain links, restored by derivation rather than by reading the emitted dependsOn.

        dependsOn names a spec METHOD, and buildSpecMethodName is deliberately lossy -- it strips
        characters an identifier cannot carry, collapses runs of underscores, and appends a numeric
        suffix on collision -- so the field it came from cannot be recovered from the identifier.
        Reconstructing the invariant instead is exact: upstreamFieldApiName means "this field's
        controlling field is ITSELF a dependent picklist", and the parsed set says which fields are
        dependent. A hand written class that omits the dependsOn still gets the link, and one that
        names a method for a field the class no longer specs does not get a broken one.

        Scoped per object, because a controlling field always lives on the same object as the field
        it controls. A field naming ITSELF as its controlling field is left unlinked, matching the
        generator's own guard -- source metadata can declare that, and a spec chained to itself is
        not a chain.
    */
    static applyUpstreamFieldApiNames(specDetails: IPicklistDependencySpecDetail[]) {

        const dependentFieldKeys = new Set(specDetails.map(
            specDetail => `${specDetail.objectApiName}.${specDetail.fieldApiName}`
        ));

        specDetails.forEach(specDetail => {

            const controllingFieldIsItselfDependent =
                specDetail.controllingFieldApiName !== specDetail.fieldApiName
                && dependentFieldKeys.has(`${specDetail.objectApiName}.${specDetail.controllingFieldApiName}`);

            specDetail.upstreamFieldApiName = controllingFieldIsItselfDependent
                ? specDetail.controllingFieldApiName
                : undefined;

        });

    }

    private static specFactoryCallPattern = /SDTPicklistDependencySpec\s*\.\s*(forField|forRecordType)\s*\(/g;

    /*
        Each spec statement, from its factory call to the semicolon that ends it.

        Sliced on the factory call rather than on method boundaries so a hand written class that does
        not follow the generator's one-spec-per-method layout still parses -- writeback reads files
        people have edited, and insisting on the emitted shape would reject exactly the edits the
        command exists to act on.
    */
    static collectSpecMethodBodies(apexClassBody: string): string[] {

        let specStatements: string[] = [];
        let factoryCallMatch: RegExpExecArray | null;

        const factoryCallPattern = new RegExp(this.specFactoryCallPattern.source, 'g');

        while ( ( factoryCallMatch = factoryCallPattern.exec(apexClassBody) ) !== null ) {

            const statementStartIndex = factoryCallMatch.index;
            const statementEndIndex = this.findStatementEndIndex(apexClassBody, statementStartIndex);

            /*
                A statement with no terminating semicolon outside a literal is unclosed, and every
                later factory match would re-scan to end of file looking for one. Stopping here
                bounds that to a single scan rather than one per remaining statement.
            */
            if ( statementEndIndex === -1 ) {
                break;
            }

            specStatements.push(apexClassBody.slice(statementStartIndex, statementEndIndex));

        }

        return specStatements;

    }

    /*
        The semicolon that ends a statement, skipping any that sits inside a string literal.

        A picklist value containing a semicolon is perfectly legal and would otherwise cut the
        statement in half, losing every expectation after it.
    */
    static findStatementEndIndex(apexClassBody: string, statementStartIndex: number): number {

        let isInsideLiteral = false;

        for ( let characterIndex = statementStartIndex; characterIndex < apexClassBody.length; characterIndex++ ) {

            const currentCharacter = apexClassBody[characterIndex];

            if ( isInsideLiteral && currentCharacter === '\\' ) {
                characterIndex++;
                continue;
            }

            if ( currentCharacter === `'` ) {
                isInsideLiteral = !isInsideLiteral;
                continue;
            }

            if ( !isInsideLiteral && currentCharacter === ';' ) {
                return characterIndex;
            }

        }

        return -1;

    }

    private static builderCallPattern = /\.\s*(controlledBy|expectAtLeast|expectNotAllowed|expectExactly|expectNone|expectUnavailable)\s*\(/g;

    static parseSpecDetailByStatement(specStatement: string): IPicklistDependencySpecDetail | undefined {

        const factoryCallPattern = new RegExp(this.specFactoryCallPattern.source);
        const factoryCallMatch = factoryCallPattern.exec(specStatement);

        if ( !factoryCallMatch ) {
            return undefined;
        }

        const factoryArgumentEndIndex = this.findCallArgumentEndIndex(specStatement, factoryCallMatch.index + factoryCallMatch[0].length - 1);

        if ( factoryArgumentEndIndex === -1 ) {
            return undefined;
        }

        const factoryArguments = this.parseApexStringLiterals(
            specStatement.slice(factoryCallMatch.index + factoryCallMatch[0].length, factoryArgumentEndIndex)
        );

        const isRecordTypeScoped = factoryCallMatch[1] === 'forRecordType';
        const requiredArgumentCount = isRecordTypeScoped ? 3 : 2;

        if ( factoryArguments.length < requiredArgumentCount ) {
            return undefined;
        }

        /*
            The api names are held to the same gate the generator applies before emitting them.

            A .cls is a hand-edited file -- that is the entire premise of writeback -- so these two
            strings are untrusted input, and they are the two that decide which file on disk gets
            written. Every other path in this pipeline validates them before letting them reach a
            path join; without it here, a spec declaring forField('../../../..', 'anything') would
            produce a detail that flows toward a file path unchecked. Refusing at extraction keeps
            the check in front of every consumer rather than relying on each one to remember.
        */
        const parsedApiNames = [factoryArguments[0], factoryArguments[1]];

        if ( isRecordTypeScoped ) {
            parsedApiNames.push(factoryArguments[2]);
        }

        if ( parsedApiNames.some(parsedApiName => !this.isValidSalesforceApiName(parsedApiName)) ) {
            return undefined;
        }

        let specDetail: IPicklistDependencySpecDetail = {
            objectApiName: factoryArguments[0],
            fieldApiName: factoryArguments[1],
            controllingFieldApiName: '',
            expectations: []
        };

        if ( isRecordTypeScoped ) {
            specDetail.recordTypeDeveloperName = factoryArguments[2];
        }

        /*
            Expectations are accumulated by controlling value rather than appended, because
            expectAtLeast and expectNotAllowed are two calls describing ONE combination -- the
            positive half and its complement -- and the spec detail carries them as one expectation.
        */
        /*
            Null prototyped because the keys are picklist values, which are metadata an admin
            controls. A controlling value of "constructor" makes an ordinary object literal answer
            true to an "in" check and hand back Object.prototype.constructor, which then gets mutated
            as though it were an expectation -- so both expectations vanish and the global Object is
            damaged on the way past.
        */
        let expectationsByControllingValue: Record<string, IPicklistDependencyExpectation> = Object.create(null);
        let controllingValueOrder: string[] = [];

        const resolveExpectation = (controllingValue: string): IPicklistDependencyExpectation => {

            if ( !( controllingValue in expectationsByControllingValue ) ) {
                expectationsByControllingValue[controllingValue] = { controllingValue, dependentValues: [] };
                controllingValueOrder.push(controllingValue);
            }

            return expectationsByControllingValue[controllingValue];

        };

        const builderCallPattern = new RegExp(this.builderCallPattern.source, 'g');
        let builderCallMatch: RegExpExecArray | null;

        while ( ( builderCallMatch = builderCallPattern.exec(specStatement) ) !== null ) {

            const argumentStartIndex = builderCallMatch.index + builderCallMatch[0].length;
            const argumentEndIndex = this.findCallArgumentEndIndex(specStatement, argumentStartIndex - 1);

            if ( argumentEndIndex === -1 ) {
                continue;
            }

            const callArguments = this.parseApexStringLiterals(specStatement.slice(argumentStartIndex, argumentEndIndex));

            if ( callArguments.length === 0 ) {
                continue;
            }

            const builderCallName = builderCallMatch[1];

            if ( builderCallName === 'controlledBy' ) {

                // THE CONTROLLING FIELD NAMES A FILE TOO -- THE WRITEBACK MAY ADD A VALUE TO IT
                if ( !this.isValidSalesforceApiName(callArguments[0]) ) {
                    return undefined;
                }

                specDetail.controllingFieldApiName = callArguments[0];
                continue;

            }

            const expectation = resolveExpectation(callArguments[0]);
            const listedValues = callArguments.slice(1);

            switch ( builderCallName ) {

                case 'expectAtLeast':
                    // "AT LEAST" IS A FLOOR, NOT A COMPLETE LIST, SO IT ADDS WITHOUT REMOVING
                    expectation.dependentValues = listedValues;
                    break;

                case 'expectExactly':
                    /*
                        "Exactly" is a complete list, so writeback must be able to remove what is not
                        in it. Read as the same positive half as expectAtLeast plus the exhaustive
                        flag -- the two calls differ for the validator in what the ORG may add beyond
                        the list, and differ here in whether the METADATA may keep anything else.
                    */
                    expectation.dependentValues = listedValues;
                    expectation.dependentValuesAreExhaustive = true;
                    break;

                case 'expectNotAllowed':
                    expectation.forbiddenValues = listedValues;
                    break;

                case 'expectNone':
                    // A CLAIM THAT THIS CONTROLLING VALUE UNLOCKS NOTHING -- EXHAUSTIVELY EMPTY, NOT SILENT
                    expectation.dependentValues = [];
                    expectation.dependentValuesAreExhaustive = true;
                    break;

                case 'expectUnavailable':
                    expectation.controllingValueUnavailable = true;
                    expectation.dependentValues = [];
                    break;

            }

        }

        if ( specDetail.controllingFieldApiName === '' ) {
            return undefined;
        }

        specDetail.expectations = controllingValueOrder.map(controllingValue => expectationsByControllingValue[controllingValue]);

        return specDetail;

    }

    /*
        The closing parenthesis of a call whose opening parenthesis sits at openParenthesisIndex.

        Depth counted, and parentheses inside string literals ignored, so an argument list carrying a
        nested "new List<String>{ ... }" or a picklist value containing a bracket still ends where
        the call actually ends.
    */
    static findCallArgumentEndIndex(specStatement: string, openParenthesisIndex: number): number {

        let parenthesisDepth = 0;
        let isInsideLiteral = false;

        for ( let characterIndex = openParenthesisIndex; characterIndex < specStatement.length; characterIndex++ ) {

            const currentCharacter = specStatement[characterIndex];

            if ( isInsideLiteral && currentCharacter === '\\' ) {
                characterIndex++;
                continue;
            }

            if ( currentCharacter === `'` ) {
                isInsideLiteral = !isInsideLiteral;
                continue;
            }

            if ( isInsideLiteral ) {
                continue;
            }

            if ( currentCharacter === '(' ) {
                parenthesisDepth++;
                continue;
            }

            if ( currentCharacter === ')' ) {

                parenthesisDepth--;

                if ( parenthesisDepth === 0 ) {
                    return characterIndex;
                }

            }

        }

        return -1;

    }

    static getSfdxProjectFilePath(workspaceRoot: string): string {
        return SfdxProjectService.getSfdxProjectFilePath(workspaceRoot);
    }

    static readSfdxProjectJson(sfdxProjectFilePath: string): any {
        return SfdxProjectService.readSfdxProjectJson(sfdxProjectFilePath);
    }

    static resolveDefaultPackageDirectoryPath(workspaceRoot: string): string {

        const sfdxProjectFilePath = this.getSfdxProjectFilePath(workspaceRoot);

        if ( !fs.existsSync(sfdxProjectFilePath) ) {
            throw new Error(`No "sfdx-project.json" found at "${sfdxProjectFilePath}". The Generate Picklist Dependency Tests command writes Apex into a Salesforce DX package directory -- open a DX project, or add an "sfdx-project.json" with a default packageDirectories entry, and run the command again.`);
        }

        const sfdxProjectJson = this.readSfdxProjectJson(sfdxProjectFilePath);
        const packageDirectories = sfdxProjectJson?.packageDirectories;

        if ( !Array.isArray(packageDirectories) || packageDirectories.length === 0 ) {
            throw new Error(`No "packageDirectories" entries found in "${sfdxProjectFilePath}". Add a package directory marked as the default and run the command again.`);
        }

        const defaultPackageDirectory = packageDirectories.find(packageDirectory => packageDirectory?.default === true) ?? packageDirectories[0];

        if ( !defaultPackageDirectory?.path ) {
            throw new Error(`The resolved package directory in "${sfdxProjectFilePath}" has no "path" value. Add a "path" to the default packageDirectories entry and run the command again.`);
        }

        /*
            The package directory path comes from a workspace file, so it is confirmed to stay
            inside the workspace before anything is written to it. path.join would quietly
            normalize a "../.." path into a location outside the folder the user opened.
        */
        if ( path.isAbsolute(defaultPackageDirectory.path) ) {
            throw new Error(`The package directory "${defaultPackageDirectory.path}" in "${sfdxProjectFilePath}" is an absolute path. Use a path relative to the project root and run the command again.`);
        }

        const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
        const resolvedPackageDirectoryPath = path.resolve(resolvedWorkspaceRoot, defaultPackageDirectory.path);

        if ( !this.isPathContainedInWorkspace(resolvedPackageDirectoryPath, resolvedWorkspaceRoot) ) {
            throw new Error(`The package directory "${defaultPackageDirectory.path}" in "${sfdxProjectFilePath}" resolves to "${resolvedPackageDirectoryPath}", which is outside the workspace. Use a package directory inside the project and run the command again.`);
        }

        return resolvedPackageDirectoryPath;

    }

    /*
        A package directory of "." is legal in sfdx-project.json and resolves to the workspace root
        itself, so the root is treated as contained. Symlinks are resolved on both sides where they
        exist, otherwise a link inside the workspace pointing outside it would satisfy a plain
        string comparison. The trailing separator stops "/work-evil" matching a "/work" root.
    */
    static isPathContainedInWorkspace(resolvedPath: string, resolvedWorkspaceRoot: string): boolean {
        return SfdxProjectService.isPathContainedInWorkspace(
            resolvedPath,
            resolvedWorkspaceRoot,
            (directoryPath: string) => this.getRealDirectoryPath(directoryPath)
        );
    }

    static getSourceApiVersion(workspaceRoot: string): string {

        const sfdxProjectFilePath = this.getSfdxProjectFilePath(workspaceRoot);
        const defaultApiVersion = '64.0';

        if ( !fs.existsSync(sfdxProjectFilePath) ) {
            return defaultApiVersion;
        }

        const sfdxProjectJson = this.readSfdxProjectJson(sfdxProjectFilePath);
        const sourceApiVersion = sfdxProjectJson?.sourceApiVersion;

        // THE VERSION IS INTERPOLATED INTO GENERATED XML, SO ONLY A PLAIN VERSION NUMBER IS ACCEPTED
        if ( typeof sourceApiVersion !== 'string' || !(/^\d+\.\d+$/.test(sourceApiVersion)) ) {
            return defaultApiVersion;
        }

        return sourceApiVersion;

    }

    static buildApexClassMetaXml(apiVersion: string): string {

        return `<?xml version="1.0" encoding="UTF-8"?>
<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>${apiVersion}</apiVersion>
    <status>Active</status>
</ApexClass>
`;

    }

    static getClassesDirectoryPath(packageDirectoryPath: string): string {
        return path.join(packageDirectoryPath, 'main', 'default', 'classes');
    }

    /*
        The framework runtime classes are scaffolded into their own directory rather than loose among
        the user's Apex. Salesforce resolves ApexClass by the enclosing "classes" directory and walks
        nested folders, so a subdirectory deploys identically while keeping six files the user did not
        write clearly separated from the ones they did -- and making them removable in one action.

        The generated SDTPLDSpecs.cls and SDTPLDSpecsTest.cls deliberately do
        NOT live here: those are the user's contract, expected to be read and sometimes hand-tightened,
        so they stay at the classes root where a developer would look for them.
    */
    private static frameworkDirectoryName = 'SDTPicklistDependencyFramework';

    static getFrameworkDirectoryName(): string {
        return this.frameworkDirectoryName;
    }

    static getFrameworkDirectoryPath(classesDirectoryPath: string): string {
        return path.join(classesDirectoryPath, this.frameworkDirectoryName);
    }

    /*
        resolveDefaultPackageDirectoryPath contains the package directory itself, but the classes path
        is built by appending "main/default/classes" to it and those segments are never re-checked.
        Any of them can be a symlink pointing outside the workspace -- writeFileSync follows symlinks,
        so without this a repository could steer generated files, whose picklist values are partly
        attacker controlled, to an arbitrary location on disk.

        Called at the point of use rather than inside the write helpers so the check sees the same
        path the caller is about to write to.
    */
    static assertClassesDirectoryContainedInWorkspace(classesDirectoryPath: string, workspaceRoot: string) {

        const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
        const resolvedClassesDirectoryPath = path.resolve(classesDirectoryPath);

        if ( !this.isPathContainedInWorkspace(resolvedClassesDirectoryPath, resolvedWorkspaceRoot) ) {
            throw new Error(`The classes directory "${resolvedClassesDirectoryPath}" resolves outside the workspace. A path segment is most likely a symlink pointing elsewhere. Fix the project layout and run the command again.`);
        }

    }

    static getSpecsClassFilePath(classesDirectoryPath: string): string {
        return path.join(classesDirectoryPath, `${this.specsClassName}.cls`);
    }

    static getSpecsTestClassName(): string {
        return `${this.specsClassName}Test`;
    }

    static getSpecsTestClassFilePath(classesDirectoryPath: string): string {
        return path.join(classesDirectoryPath, `${this.getSpecsTestClassName()}.cls`);
    }

    /*
        The suite groups the generated test class under one name a CI pipeline, "sf apex run test
        --suite-names" and Setup can all address. Its value is the stable handle rather than the
        member count: the suite survives any later change to how the generated classes are named or
        split, where a hard-coded class name in someone's pipeline does not.

        SDT-prefixed for the same reason every generated Apex class is -- it is written into a
        user's package directory and must not collide with a suite they already maintain.
    */
    private static testSuiteName = 'SDTPicklistDependencyTests';

    private static testSuitesDirectoryName = 'testSuites';

    private static testSuiteFileSuffix = '.testSuite-meta.xml';

    static getTestSuiteName(): string {
        return this.testSuiteName;
    }

    /*
        Derived from the CLASSES directory rather than from the package directory, so the two cannot
        drift apart. Both live under the same "main/default" metadata root, which makes testSuites
        the sibling of classes -- expressing it that way means a change to where classes are written
        moves the suite with it, instead of leaving a second copy of "main/default" to be updated
        separately and silently forgotten.
    */
    static getTestSuitesDirectoryPath(classesDirectoryPath: string): string {
        return path.join(path.dirname(classesDirectoryPath), this.testSuitesDirectoryName);
    }

    static getTestSuiteFilePath(classesDirectoryPath: string): string {
        return path.join(
            this.getTestSuitesDirectoryPath(classesDirectoryPath),
            `${this.testSuiteName}${this.testSuiteFileSuffix}`
        );
    }

    /*
        The same containment check the classes directory gets, for the same reason: the suite path is
        built by appending directory segments that are never re-checked, and writeFileSync follows a
        symlink wherever it points.
    */
    static assertTestSuitesDirectoryContainedInWorkspace(testSuitesDirectoryPath: string, workspaceRoot: string) {

        const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
        const resolvedTestSuitesDirectoryPath = path.resolve(testSuitesDirectoryPath);

        if ( !this.isPathContainedInWorkspace(resolvedTestSuitesDirectoryPath, resolvedWorkspaceRoot) ) {
            throw new Error(`The test suites directory "${resolvedTestSuitesDirectoryPath}" resolves outside the workspace. A path segment is most likely a symlink pointing elsewhere. Fix the project layout and run the command again.`);
        }

    }

    /*
        The members this command owns, and the only ones it will ever add. Everything else found in
        an existing suite file belongs to whoever put it there.
    */
    static getGeneratedTestSuiteClassNames(): string[] {
        return [this.getSpecsTestClassName()];
    }

    /*
        Reads the members out of an existing suite file, or returns undefined when the file is not a
        suite this can safely rewrite.

        Matched with a regular expression rather than parsed with xml2js because every caller in the
        emission path -- buildSpecsChangePlan, writePlannedSpecsFiles -- is synchronous by design,
        and xml2js offers no synchronous parse. Making the change plan async to read one flat list of
        element values would turn the whole write path async for no gain in what is actually
        understood about the file.

        undefined is deliberately distinct from an empty array: an empty suite is a valid file with
        no members, whereas undefined means "this does not look like an ApexTestSuite" and the
        caller must leave it alone rather than replace it.
    */
    static parseTestSuiteClassNames(testSuiteFileContent: string): string[] | undefined {

        if ( !/<ApexTestSuite[\s>]/.test(testSuiteFileContent) ) {
            return undefined;
        }

        /*
            Comments and CDATA are removed before anything is counted or read. The pattern below has
            no XML context, so without this a member a user deliberately COMMENTED OUT would be read
            as live and silently restored on the next regeneration -- the opposite of what commenting
            it out asked for.
        */
        const membershipMarkup = testSuiteFileContent
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');

        /*
            Every occurrence of the element is counted, then matched. If the two disagree the file
            holds a member written in a form this cannot read -- an attribute, a self-closing tag, an
            unclosed element -- and the whole file is declared unreadable rather than rewritten.

            This is the difference between the guard and the reader being equally strict. The "is
            this a suite" test above is deliberately loose, so without this count a legally formed
            member the reader misses would parse as ABSENT and then be dropped from the merged file
            -- silently, and with the unparseable escape hatch never firing because the loose guard
            had already said the file was fine. Dropping a member is the one outcome the merge
            exists to prevent, so a disagreement resolves to "leave it alone and warn".
        */
        const declaredElementCount = (membershipMarkup.match(/<testClassName[\s/>]/g) || []).length;

        const testClassNamePattern = /<testClassName\s*>([^<]*)<\/testClassName\s*>/g;

        let testClassNames: string[] = [];
        let matchedElementCount = 0;
        let testClassNameMatch: RegExpExecArray | null;

        while ( (testClassNameMatch = testClassNamePattern.exec(membershipMarkup)) !== null ) {

            matchedElementCount++;

            const testClassName = this.unescapeXmlText(testClassNameMatch[1]).trim();

            // AN EMPTY ELEMENT IS A MATCHED ELEMENT THAT NAMES NOBODY, NOT AN UNREADABLE ONE
            if ( testClassName.length > 0 ) {
                testClassNames.push(testClassName);
            }

        }

        if ( matchedElementCount !== declaredElementCount ) {
            return undefined;
        }

        return testClassNames;

    }

    static buildTestSuiteXml(testClassNames: string[]): string {

        const testClassNameElements = testClassNames
            .map(testClassName => `    <testClassName>${this.escapeXmlText(testClassName)}</testClassName>`)
            .join('\n');

        return `<?xml version="1.0" encoding="UTF-8"?>
<ApexTestSuite xmlns="http://soap.sforce.com/2006/04/metadata">
${testClassNameElements}
</ApexTestSuite>
`;

    }

    static escapeXmlText(value: string): string {

        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

    }

    /*
        The inverse of escapeXmlText, and it has to exist for the pair to round trip. A member read
        back as raw markup and then re-escaped on write grows an entity every regeneration --
        "A&amp;B" becomes "A&amp;amp;B" becomes "A&amp;amp;amp;B" -- which would make a file this
        command claims is byte-for-byte stable change on every run.

        "&amp;" is decoded LAST, so an escaped entity in the source ("&amp;amp;lt;") decodes to the
        literal text it stood for rather than being decoded twice.
    */
    static unescapeXmlText(value: string): string {

        return value
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&amp;/g, '&');

    }

    /*
        The suite content a regeneration should write, merged with whatever is already on disk.

        A suite is a grouping a team curates, not a file this command owns outright: someone may
        well have added their own picklist-adjacent test class to it, and a regeneration that reset
        the file to just the generated member would silently delete that. So the generated members
        are UNIONED in and nothing else is removed -- the same rule the metadata writeback follows,
        where silence in the generated model is never read as an instruction to delete.

        Members are sorted so that regenerating an unchanged project reproduces the file byte for
        byte, which is what keeps the suite out of every source-control diff.
    */
    static buildMergedTestSuiteContent(existingTestSuiteFileContent?: string): IMergedTestSuiteContent {

        const generatedTestSuiteClassNames = this.getGeneratedTestSuiteClassNames();

        if ( existingTestSuiteFileContent === undefined ) {
            return {
                content: this.buildTestSuiteXml(this.sortValuesForEmission(generatedTestSuiteClassNames)),
                isExistingFileUnparseable: false,
                isExistingFileUnreadable: false
            };
        }

        const existingTestClassNames = this.parseTestSuiteClassNames(existingTestSuiteFileContent);

        /*
            An unreadable file keeps its exact content. Rewriting it would destroy whatever the user
            has there, and the one thing worse than a missing suite is a suite that quietly replaced
            a hand-maintained file the command could not understand.
        */
        if ( existingTestClassNames === undefined ) {
            return {
                content: existingTestSuiteFileContent,
                isExistingFileUnparseable: true,
                isExistingFileUnreadable: false
            };
        }

        const mergedTestClassNames = [...new Set([...existingTestClassNames, ...generatedTestSuiteClassNames])];

        return {
            content: this.buildTestSuiteXml(this.sortValuesForEmission(mergedTestClassNames)),
            isExistingFileUnparseable: false,
            isExistingFileUnreadable: false
        };

    }

    /*
        Reads the suite already on disk, if any, and resolves what should replace it. Kept separate
        from buildMergedTestSuiteContent so that merging stays a pure function of its input and can
        be tested without a filesystem.
    */
    static buildTestSuiteContentByClassesDirectory(classesDirectoryPath: string): IMergedTestSuiteContent {

        const testSuiteFilePath = this.getTestSuiteFilePath(classesDirectoryPath);

        let existingTestSuiteFileContent: string | undefined;

        try {
            existingTestSuiteFileContent = fs.readFileSync(testSuiteFilePath, 'utf-8');
        } catch ( readError ) {

            /*
                Only ENOENT means there is no suite yet. Any other failure means a file IS there and
                could not be read, and answering that by generating a fresh one would overwrite
                whatever it held.
            */
            if ( (readError as NodeJS.ErrnoException)?.code !== 'ENOENT' ) {
                return { isExistingFileUnparseable: false, isExistingFileUnreadable: true };
            }

            existingTestSuiteFileContent = undefined;

        }

        return this.buildMergedTestSuiteContent(existingTestSuiteFileContent);

    }

    static buildUnreadableTestSuiteWarning(testSuiteFilePath: string): string {

        return `The Apex test suite at "${testSuiteFilePath}" exists but could not be read, so it has been left exactly as it is. `
            + `The generated picklist dependency tests are NOT registered in it, and "Run Picklist Dependency Check" will not find the suite until this is fixed. `
            + `Check the file's permissions, or whether another process is holding it open, and run "Generate Picklist Dependency Tests" again.`;

    }

    static buildUnparseableTestSuiteWarning(testSuiteFilePath: string): string {

        return `The Apex test suite at "${testSuiteFilePath}" could not be read as an ApexTestSuite file, so it has been left exactly as it is. `
            + `The generated picklist dependency tests are NOT registered in it, and "Run Picklist Dependency Check" will not find the suite until this is fixed. `
            + `Repair the file, or delete it and run "Generate Picklist Dependency Tests" again to have it rewritten.`;

    }

    /*
        Builds the Apex method name that covers one object.

        Apex identifiers may NOT contain two consecutive underscores -- that sequence is reserved for
        namespace and custom-object suffixes -- so a raw api name cannot be used. Every custom object
        ends in "__c", which means embedding the name verbatim produced a class that failed to deploy
        with "Invalid character in identifier" for every custom object in the registry. Standard
        objects happened to work, which is exactly why this survived a live deploy check.

        Runs of underscores are collapsed rather than the suffix being stripped, so "Foo__c" and
        "Foo__e" stay distinguishable as "Foo_c" and "Foo_e". The api name is embedded at all -- as
        opposed to an index -- so a failing method names the object it covers in the test results.

        Collapsing can make two distinct api names collide ("Foo__c" and "Foo_c" both yield "Foo_c"),
        so callers generating a whole class must disambiguate. buildSpecsTestApexClassBody does.
    */
    static buildTestMethodNameByObjectApiName(objectApiName: string): string {

        const collapsedUnderscores = objectApiName.replace(/_{2,}/g, '_');
        const identifierSafeObjectApiName = /^[0-9]/.test(collapsedUnderscores) ? `object${collapsedUnderscores}` : collapsedUnderscores;

        return `${identifierSafeObjectApiName}_picklistDependenciesMatchSourceMetadata`;

    }

    /*
        Assigns one unique method name per object api name, in the order given.

        Two api names can collapse to the same identifier, and two methods with the same name will not
        compile. A numeric suffix is appended to later collisions rather than the first, so the common
        case -- no collision at all -- produces the unsuffixed name a reader expects.
    */
    static buildTestMethodNamesByObjectApiName(objectApiNames: string[]): Record<string, string> {

        let methodNamesByObjectApiName: Record<string, string> = {};
        let usedMethodNames = new Set<string>();

        objectApiNames.forEach(objectApiName => {

            const baseMethodName = this.buildTestMethodNameByObjectApiName(objectApiName);

            let uniqueMethodName = baseMethodName;
            let collisionSuffix = 2;
            while ( usedMethodNames.has(uniqueMethodName) ) {
                uniqueMethodName = `${baseMethodName}_${collisionSuffix}`;
                collisionSuffix++;
            }

            usedMethodNames.add(uniqueMethodName);
            methodNamesByObjectApiName[objectApiName] = uniqueMethodName;

        });

        return methodNamesByObjectApiName;

    }

    /*
        A test method per object rather than one for the whole registry. Each method gets its own
        transaction and so its own CPU and heap budget, which matters because the describe work in
        SDTSchemaPicklistDependencySource is what binds the limit -- and a failure names the object in
        the test results without the message having to be read.
    */
    static buildSpecsTestApexClassBody(specDetails: IPicklistDependencySpecDetail[]): string {

        const distinctObjectApiNames = [...new Set(specDetails.map(specDetail => specDetail.objectApiName))].sort();

        const testMethodNamesByObjectApiName = this.buildTestMethodNamesByObjectApiName(distinctObjectApiNames);

        const testMethods = distinctObjectApiNames.map(objectApiName => {

            // THE API NAME IS PASSED AS A STRING LITERAL, SO IT KEEPS ITS EXACT SUFFIX FOR THE DESCRIBE
            const escapedObjectApiName = this.escapeApexStringLiteral(objectApiName);

            return `    @IsTest
    static void ${testMethodNamesByObjectApiName[objectApiName]}() {
        assertNoPicklistDependencyFailuresForObject('${escapedObjectApiName}');
    }`;

        }).join('\n\n');

        return `/**
 * GENERATED FILE -- regenerating overwrites it.
 *
 * Created by the Salesforce Data Treecipe "Generate Picklist Dependency Tests" command. Asserts
 * that every picklist dependency captured from local source metadata still exists in the org this
 * test runs against.
 *
 * These assertions read the org's REAL metadata. Schema describe is not isolated by @IsTest, so no
 * @TestSetup data and no SeeAllData are involved -- the describe calls in
 * SDTSchemaPicklistDependencySource return the same result they would outside a test.
 *
 * A failure here means an admin has rewired or removed a dependency that local source metadata
 * still claims exists. Regenerate the specs if the org is now correct, or fix the org if it is not.
 */
@IsTest
private class ${this.getSpecsTestClassName()} {

${testMethods}

    /**
     * An empty registry must never pass. Without this the class would report green while asserting
     * nothing at all, which is the same failure mode the EMPTY result marker exists to prevent in
     * the anonymous Apex entry point.
     */
    @IsTest
    static void specRegistryIsNotEmpty() {
        Assert.isFalse(
            ${this.specsClassName}.all().isEmpty(),
            'No picklist dependency specs are registered, so this run verified nothing. '
                + 'Re-run the Generate Picklist Dependency Tests command.'
        );
    }

    private static void assertNoPicklistDependencyFailuresForObject(String objectApiName) {

        List<SDTPicklistDependencySpec> specsForObject = new List<SDTPicklistDependencySpec>();
        for (SDTPicklistDependencySpec spec : ${this.specsClassName}.all()) {
            if (spec.objectApiName == objectApiName) {
                specsForObject.add(spec);
            }
        }

        Assert.isFalse(
            specsForObject.isEmpty(),
            'No specs found for ' + objectApiName + '. This class is generated from the spec '
                + 'registry, so the two are out of sync -- regenerate them together.'
        );

        SDTPicklistDependencyValidator validator =
            new SDTPicklistDependencyValidator(new SDTSchemaPicklistDependencySource());

        List<SDTPicklistDependencyValidator.Failure> failures = validator.validate(specsForObject);

        Assert.isTrue(failures.isEmpty(), buildFailureMessage(objectApiName, failures));

    }

    private static String buildFailureMessage(String objectApiName, List<SDTPicklistDependencyValidator.Failure> failures) {

        List<String> failureLines = new List<String>();
        failureLines.add(
            'Picklist dependency drift on ' + objectApiName + ' -- '
                + failures.size() + ' combination(s) no longer match local source metadata:'
        );

        for (SDTPicklistDependencyValidator.Failure failure : failures) {
            failureLines.add('  - ' + failure.toLine());
        }

        return String.join(failureLines, '\\n');

    }

}
`;

    }

    static getPerObjectSpecsClassFilePath(classesDirectoryPath: string, perObjectClassName: string): string {
        return path.join(classesDirectoryPath, `${perObjectClassName}.cls`);
    }

    /*
        Matches the per-object classes this command emits and nothing else. The underscore is what
        keeps SDTPLDSpecsTest.cls out of it -- deleting the generated test class as though it were a
        stale per-object class would break the check command on the next run.
    */
    private static perObjectSpecsClassFilePattern = /^SDTPLDSpecs_[A-Za-z0-9_]+\.cls$/;

    static isPerObjectSpecsClassFileName(fileName: string): boolean {
        return this.perObjectSpecsClassFilePattern.test(fileName);
    }

    /*
        An object losing its last dependent picklist, or being renamed, leaves behind a per-object
        class the regenerated aggregator no longer calls. Left on disk it still deploys, so the org
        keeps asserting a contract the source metadata no longer describes. Only files matching the
        generated-class pattern and absent from this run are removed.
    */
    static removeStalePerObjectSpecsClassFiles(classesDirectoryPath: string, currentClassNames: string[]): string[] {

        const staleClassFilePaths = this.findStalePerObjectSpecsClassFilePaths(classesDirectoryPath, currentClassNames);

        staleClassFilePaths.forEach(staleClassFilePath => {
            fs.rmSync(staleClassFilePath, { force: true });
            fs.rmSync(`${staleClassFilePath}-meta.xml`, { force: true });
        });

        return staleClassFilePaths;

    }

    /*
        The same set removeStalePerObjectSpecsClassFiles deletes, without deleting it. Split out so
        the pre-write report can NAME a class about to be removed: an object losing its last
        dependent picklist and an object whose metadata simply was not read this run look identical
        on disk, and only the user can tell them apart.

        Sorted so the report reads the same on every machine, for the same reason emission is.
    */
    static findStalePerObjectSpecsClassFilePaths(classesDirectoryPath: string, currentClassNames: string[]): string[] {

        if ( !fs.existsSync(classesDirectoryPath) ) {
            return [];
        }

        const currentClassFileNames = new Set(currentClassNames.map(className => `${className}.cls`));

        return fs.readdirSync(classesDirectoryPath)
            .filter(fileName => this.isPerObjectSpecsClassFileName(fileName) && !currentClassFileNames.has(fileName))
            .sort()
            .map(fileName => path.join(classesDirectoryPath, fileName));

    }

    /*
        Classified against what is on disk RIGHT NOW, so that a file whose proposed content matches
        byte for byte is reported as unchanged and then skipped at write time. Skipping it is not
        just cosmetic: rewriting identical bytes still moves the file's mtime, which is what a
        watcher, a build cache or an incremental deploy keys off.

        A file that exists but cannot be read falls through as 'changed' rather than raising -- the
        write that follows fails loudly and with a better message than a read here could give, and
        reporting it as a change is the safer of the two wrong answers.
    */
    static buildPlannedSpecsFile(filePath: string, proposedContent: string, objectApiName?: string): IPlannedSpecsFile {

        let changeType: PlannedSpecsFileChangeType = 'added';

        if ( fs.existsSync(filePath) ) {

            let existingContent: string | undefined;

            try {
                existingContent = fs.readFileSync(filePath, 'utf-8');
            } catch {
                existingContent = undefined;
            }

            changeType = ( existingContent !== undefined
                            && this.normalizeLineEndingsForComparison(existingContent) === this.normalizeLineEndingsForComparison(proposedContent) )
                            ? 'unchanged'
                            : 'changed';

        }

        return { filePath, proposedContent, changeType, objectApiName };

    }

    /*
        Compared without line endings so the no-op guarantee survives a CRLF working tree.

        Emission always produces LF. On Windows, git's default core.autocrlf=true checks these
        files out as CRLF, so a raw byte comparison would call every class "overwritten" on every
        run -- turning the feature that exists to make regeneration quiet into a permanent false
        alarm for every Windows contributor.

        Only the COMPARISON is normalized. A file whose sole difference is its line endings is left
        exactly as it is on disk rather than being rewritten to LF, which would be the same churn
        from the other direction.
    */
    static normalizeLineEndingsForComparison(content: string): string {
        return content.replace(/\r\n/g, '\n');
    }

    /*
        Everything a regeneration would write, with its content resolved but nothing written.

        The test class body is taken as a parameter rather than built here because the caller
        already builds it, and building it twice would be two chances for the planned content and
        the written content to differ -- which is the one thing a preview must never do.
    */
    static buildSpecsChangePlan(classesDirectoryPath: string,
                                    specDetails: IPicklistDependencySpecDetail[],
                                    apiVersion: string,
                                    recordTypeSpecDetails: IRecordTypePicklistDependencySpecDetail[] = [],
                                    specsTestClassBody?: string,
                                    testSuiteContent?: string): ISpecsChangePlan {

        const objectApiNames = this.getDistinctObjectApiNames([...specDetails, ...recordTypeSpecDetails]);
        const classNamesByObjectApiName = this.buildPerObjectSpecsClassNamesByObjectApiName(objectApiNames);
        const apexClassMetaXml = this.buildApexClassMetaXml(apiVersion);

        /*
            Grouped once rather than filtered inside the loop below, which walked the whole list per
            object and so cost objects x specs. On an org where every object has a dependent
            picklist that is quadratic in the same number.
        */
        const specDetailsByObjectApiName = this.groupSpecDetailsByObjectApiName(specDetails);
        const recordTypeSpecDetailsByObjectApiName = this.groupSpecDetailsByObjectApiName(recordTypeSpecDetails);

        let plannedFiles: IPlannedSpecsFile[] = [];
        let objectApiNamesWithRecordTypeSpecs: string[] = [];

        objectApiNames.forEach(objectApiName => {

            const perObjectClassName = classNamesByObjectApiName[objectApiName];
            const specDetailsForObject = specDetailsByObjectApiName[objectApiName] || [];
            const recordTypeSpecDetailsForObject = (recordTypeSpecDetailsByObjectApiName[objectApiName] || []) as IRecordTypePicklistDependencySpecDetail[];

            if ( recordTypeSpecDetailsForObject.length > 0 ) {
                objectApiNamesWithRecordTypeSpecs.push(objectApiName);
            }

            const perObjectClassBody = this.buildPerObjectSpecsApexClassBody(
                objectApiName, perObjectClassName, specDetailsForObject, recordTypeSpecDetailsForObject
            );
            const perObjectClassFilePath = this.getPerObjectSpecsClassFilePath(classesDirectoryPath, perObjectClassName);

            plannedFiles.push(this.buildPlannedSpecsFile(perObjectClassFilePath, perObjectClassBody, objectApiName));
            plannedFiles.push(this.buildPlannedSpecsFile(`${perObjectClassFilePath}-meta.xml`, apexClassMetaXml, objectApiName));

        });

        const aggregatorClassFilePath = this.getSpecsClassFilePath(classesDirectoryPath);
        plannedFiles.push(this.buildPlannedSpecsFile(
            aggregatorClassFilePath,
            this.buildAggregatorSpecsApexClassBody(classNamesByObjectApiName, objectApiNamesWithRecordTypeSpecs)
        ));
        plannedFiles.push(this.buildPlannedSpecsFile(`${aggregatorClassFilePath}-meta.xml`, apexClassMetaXml));

        if ( specsTestClassBody !== undefined ) {

            const specsTestClassFilePath = this.getSpecsTestClassFilePath(classesDirectoryPath);
            plannedFiles.push(this.buildPlannedSpecsFile(specsTestClassFilePath, specsTestClassBody));
            plannedFiles.push(this.buildPlannedSpecsFile(`${specsTestClassFilePath}-meta.xml`, apexClassMetaXml));

        }

        /*
            The suite is planned like everything else so a run that changes nothing reports it as
            unchanged instead of rewriting it. Its content arrives already merged with what is on
            disk, for the reason the test class body does: resolving it twice is two chances for the
            previewed content and the written content to disagree.
        */
        if ( testSuiteContent !== undefined ) {
            plannedFiles.push(this.buildPlannedSpecsFile(this.getTestSuiteFilePath(classesDirectoryPath), testSuiteContent));
        }

        const staleClassFilePaths = this.findStalePerObjectSpecsClassFilePaths(
            classesDirectoryPath,
            objectApiNames.map(objectApiName => classNamesByObjectApiName[objectApiName])
        );

        const hasChanges = plannedFiles.some(plannedFile => plannedFile.changeType !== 'unchanged')
                            || staleClassFilePaths.length > 0;

        return { plannedFiles, staleClassFilePaths, hasChanges };

    }

    /*
        Whether the plan would destroy anything already on disk -- replace a file's content, or
        delete a stale class. A plan that only ADDS files takes nothing away, so there is nothing to
        review and nothing to lose by proceeding; asking anyway is the prompt fatigue that gets
        every later prompt clicked through without reading.
    */
    static planReplacesExistingContent(changePlan: ISpecsChangePlan): boolean {

        return changePlan.plannedFiles.some(plannedFile => plannedFile.changeType === 'changed')
                || changePlan.staleClassFilePaths.length > 0;

    }

    /*
        A single line per object saying what regenerating does to it, plus the classes it removes.
        Kept here rather than in the command so the wording is testable without a vscode window.
    */
    static buildSpecsChangeReport(changePlan: ISpecsChangePlan): string {

        const changedFiles = changePlan.plannedFiles.filter(plannedFile => plannedFile.changeType !== 'unchanged');

        if ( changedFiles.length === 0 && changePlan.staleClassFilePaths.length === 0 ) {
            return 'No changes: the generated specs already match this metadata.';
        }

        let reportLines: string[] = [];

        /*
            Filtered on the ".cls-meta.xml" sidecar specifically rather than on "-meta.xml", which
            the generated test suite's own file name also ends with. Excluding every "-meta.xml"
            dropped the suite from the report entirely -- it is the artifact, not a sidecar beside
            one -- so a run whose only change was the suite reported nothing.
        */
        const addedClassFiles = changedFiles.filter(changedFile => changedFile.changeType === 'added' && !this.isApexClassSidecarFilePath(changedFile.filePath));
        const updatedClassFiles = changedFiles.filter(changedFile => changedFile.changeType === 'changed' && !this.isApexClassSidecarFilePath(changedFile.filePath));

        if ( addedClassFiles.length > 0 ) {
            reportLines.push(`New: ${addedClassFiles.map(addedFile => path.basename(addedFile.filePath)).join(', ')}`);
        }

        if ( updatedClassFiles.length > 0 ) {
            reportLines.push(`Overwritten: ${updatedClassFiles.map(updatedFile => path.basename(updatedFile.filePath)).join(', ')}`);
        }

        if ( changePlan.staleClassFilePaths.length > 0 ) {
            reportLines.push(`Deleted (no dependent picklist in this metadata): ${changePlan.staleClassFilePaths.map(staleFilePath => path.basename(staleFilePath)).join(', ')}`);
        }

        /*
            Both lists above filter the meta xml out, because naming a -meta.xml beside every class
            doubles the report without telling the reader anything. When the meta xml is the ONLY
            thing changing -- which is what a sourceApiVersion bump produces -- that filtering left
            the report empty, and the user got a confirmation dialog with a blank body.
        */
        if ( reportLines.length === 0 ) {
            reportLines.push(`Overwritten: ${changedFiles.map(changedFile => path.basename(changedFile.filePath)).join(', ')}`);
        }

        return reportLines.join('\n');

    }

    /*
        Only what actually differs is written. Returns the paths touched, which is what a caller
        reports -- an empty result means the run was a genuine no-op rather than that it failed.
    */
    /*
        Reports progress but takes no cancellation token, and that is deliberate.

        Every call in this loop is synchronous, so the extension host thread never yields and a
        cancellation token could not flip part way through however often it were polled: the only
        cancel such a check can observe is one requested before the loop began. A per-file check
        would read as responsiveness the runtime cannot deliver.

        Leaving the write uninterruptible is also what keeps the generated classes and the manifest
        a matched pair. A half-written set with no manifest describing it is a state nothing
        downstream can detect -- freshness is computed from the OBJECTS directory, which a write
        does not touch -- so the honest design is not to create it. Cancellation lives on the walk,
        which awaits the filesystem per directory and is the larger cost anyway.
    */
    static writePlannedSpecsFiles(plannedFiles: IPlannedSpecsFile[],
                                    generationProgress?: IPicklistDependencyGenerationProgress,
                                    specCountByObjectApiName: Record<string, number> = {},
                                    totalSpecCount: number = 0): string[] {

        let writtenFilePaths: string[] = [];
        let writtenSpecCount = 0;

        /*
            The planned set no longer lives in a single directory -- the test suite goes to a
            testSuites sibling that may not exist yet -- so the directory is created per file rather
            than once up front. It is remembered, though: without this every one of the hundreds of
            classes an org produces would repeat the same mkdir for the same directory inside a loop
            that already cannot yield, to no effect after the first.
        */
        let createdDirectoryPaths = new Set<string>();

        for ( const plannedFile of plannedFiles ) {

            if ( plannedFile.changeType !== 'unchanged' ) {

                const plannedFileDirectoryPath = path.dirname(plannedFile.filePath);

                if ( !createdDirectoryPaths.has(plannedFileDirectoryPath) ) {
                    fs.mkdirSync(plannedFileDirectoryPath, { recursive: true });
                    createdDirectoryPaths.add(plannedFileDirectoryPath);
                }

                fs.writeFileSync(plannedFile.filePath, plannedFile.proposedContent);
                writtenFilePaths.push(plannedFile.filePath);

            }

            /*
                Counted for written and unchanged alike, and reported outside the write branch: on a
                re-run where most classes are already correct -- the common case -- reporting only
                what was rewritten would leave the message stalled at its first value.

                Only a file that actually carries specs moves the count, so the -meta.xml beside each
                class does not re-report the fraction its .cls just reported.
            */
            const plannedFileSpecCount = this.getPlannedFileSpecCount(plannedFile, specCountByObjectApiName);
            if ( plannedFileSpecCount === 0 ) {
                continue;
            }

            writtenSpecCount += plannedFileSpecCount;

            if ( totalSpecCount > 0 ) {
                generationProgress?.report(`writing spec ${writtenSpecCount}/${totalSpecCount}...`);
            }

        }

        return writtenFilePaths;

    }

    /*
        How many specs a planned file accounts for. Only the .cls carries them: the -meta.xml beside
        it is the same object's file, and counting both would double every object's contribution and
        run the reported total past the real one.
    */
    private static getPlannedFileSpecCount(plannedFile: IPlannedSpecsFile,
                                            specCountByObjectApiName: Record<string, number>): number {

        if ( !plannedFile.objectApiName || this.isApexClassSidecarFilePath(plannedFile.filePath) ) {
            return 0;
        }

        return specCountByObjectApiName[plannedFile.objectApiName] ?? 0;

    }

    /*
        The "<name>.cls-meta.xml" written beside every generated Apex class. Named as its own idea
        because "ends with -meta.xml" is true of Salesforce metadata files generally, the generated
        test suite among them.
    */
    static isApexClassSidecarFilePath(filePath: string): boolean {
        return filePath.endsWith('.cls-meta.xml');
    }

    static writeSpecsClassFiles(classesDirectoryPath: string,
                                    specDetails: IPicklistDependencySpecDetail[],
                                    apiVersion: string,
                                    recordTypeSpecDetails: IRecordTypePicklistDependencySpecDetail[] = [],
                                    previewedChangePlan?: ISpecsChangePlan,
                                    generationProgress?: IPicklistDependencyGenerationProgress): ISpecsClassWriteResult {

        fs.mkdirSync(classesDirectoryPath, { recursive: true });

        /*
            Both lists feed the object set. A scoped detail is always derived from a field-level one
            today, so the union is the same set -- but writeSpecsClassFiles is public and callable
            directly, and silently dropping a caller's scoped details would be the wrong failure.

            A caller that already built a plan passes it back rather than having it rebuilt. That
            saves constructing every object's Apex body a second time -- the dominant cost of a run,
            and measurably so on an org with hundreds of objects -- and it makes "what was previewed
            is what gets written" structural rather than a property of buildSpecsChangePlan being
            pure. Omitting it stays supported so this remains callable on its own.
        */
        const changePlan = previewedChangePlan
                            ?? this.buildSpecsChangePlan(classesDirectoryPath, specDetails, apiVersion, recordTypeSpecDetails);

        /*
            A previewed plan may also carry the test class, which writeSpecsTestClassFiles owns.
            Writing it here would be harmless -- same content, and the later call would find it
            unchanged -- but it would put a file this method does not report in its result.
        */
        const specsTestClassFilePath = this.getSpecsTestClassFilePath(classesDirectoryPath);
        const testSuiteFilePath = this.getTestSuiteFilePath(classesDirectoryPath);
        const specsClassPlannedFiles = changePlan.plannedFiles.filter(
            plannedFile => plannedFile.filePath !== specsTestClassFilePath
                            && plannedFile.filePath !== `${specsTestClassFilePath}-meta.xml`
                            && plannedFile.filePath !== testSuiteFilePath
        );

        const specDetailsByObjectApiNameForProgress = this.groupSpecDetailsByObjectApiName(specDetails);
        let specCountByObjectApiName: Record<string, number> = {};
        Object.keys(specDetailsByObjectApiNameForProgress).forEach(objectApiNameForProgress => {
            specCountByObjectApiName[objectApiNameForProgress] = specDetailsByObjectApiNameForProgress[objectApiNameForProgress].length;
        });

        this.writePlannedSpecsFiles(
            specsClassPlannedFiles, generationProgress, specCountByObjectApiName, specDetails.length
        );

        const objectApiNames = this.getDistinctObjectApiNames([...specDetails, ...recordTypeSpecDetails]);
        const classNamesByObjectApiName = this.buildPerObjectSpecsClassNamesByObjectApiName(objectApiNames);

        let perObjectClassFilePathsByObjectApiName: Record<string, string> = {};
        objectApiNames.forEach(objectApiName => {
            perObjectClassFilePathsByObjectApiName[objectApiName] = this.getPerObjectSpecsClassFilePath(
                classesDirectoryPath, classNamesByObjectApiName[objectApiName]
            );
        });

        const removedStaleClassFilePaths = this.removeStalePerObjectSpecsClassFiles(
            classesDirectoryPath,
            objectApiNames.map(objectApiName => classNamesByObjectApiName[objectApiName])
        );

        return {
            aggregatorClassFilePath: this.getSpecsClassFilePath(classesDirectoryPath),
            perObjectClassFilePathsByObjectApiName,
            removedStaleClassFilePaths
        };

    }

    /*
        Versions 2.12.x-2.14.x wrote an unprefixed framework directory and SFTreecipe-prefixed spec
        classes. Both still compile and still deploy, so a user upgrading in place would end up with
        two copies of the framework in their org under different names. Nothing is deleted here --
        these are files in the user's package directory that may well be committed and deployed, and
        removing them is their call to make, not this command's.
    */
    static detectLegacyGeneratedArtifacts(classesDirectoryPath: string): string[] {

        let legacyArtifactPaths: string[] = [];

        const legacyFrameworkDirectoryPath = path.join(classesDirectoryPath, this.legacyFrameworkDirectoryName);
        if ( fs.existsSync(legacyFrameworkDirectoryPath) ) {
            legacyArtifactPaths.push(legacyFrameworkDirectoryPath);
        }

        this.legacySpecsClassNames.forEach(legacySpecsClassName => {

            const legacySpecsClassFilePath = path.join(classesDirectoryPath, `${legacySpecsClassName}.cls`);
            if ( fs.existsSync(legacySpecsClassFilePath) ) {
                legacyArtifactPaths.push(legacySpecsClassFilePath);
            }

        });

        return legacyArtifactPaths;

    }

    static buildLegacyArtifactWarning(legacyArtifactPaths: string[]): string {

        const legacyOrgClassNames = [
            ...this.legacySpecsClassNames,
            'IPicklistDependencySource',
            'PicklistDependencySpec',
            'PicklistDependencySnapshot',
            'PicklistDependencyReport',
            'PicklistDependencyValidator',
            'SchemaPicklistDependencySource'
        ];

        return `Picklist dependency classes from an earlier Treecipe version are still in this project: ${legacyArtifactPaths.join(', ')}. `
            + `They have been left in place. Delete them locally, and delete these classes from any org they were deployed to, `
            + `so the renamed SDT classes do not sit alongside a second copy of the framework: ${legacyOrgClassNames.join(', ')}.`;

    }

    static writeSpecsTestClassFiles(classesDirectoryPath: string, apexTestClassBody: string, apiVersion: string): string {

        fs.mkdirSync(classesDirectoryPath, { recursive: true });

        const specsTestClassFilePath = this.getSpecsTestClassFilePath(classesDirectoryPath);

        // SKIPS A FILE ALREADY CARRYING THIS EXACT CONTENT, FOR THE MTIME REASON IN buildPlannedSpecsFile
        this.writePlannedSpecsFiles([
            this.buildPlannedSpecsFile(specsTestClassFilePath, apexTestClassBody),
            this.buildPlannedSpecsFile(`${specsTestClassFilePath}-meta.xml`, this.buildApexClassMetaXml(apiVersion))
        ]);

        return specsTestClassFilePath;

    }

    /*
        Writes the merged suite content resolved earlier in the run.

        Takes the content rather than resolving it, so the file written is literally the one the
        change plan previewed. An unparseable existing file arrives here as its own exact content,
        which makes this a no-op for that case without needing to know why.
    */
    static writeSpecsTestSuiteFile(classesDirectoryPath: string, testSuiteContent?: string): string | undefined {

        if ( testSuiteContent === undefined ) {
            return undefined;
        }

        const testSuiteFilePath = this.getTestSuiteFilePath(classesDirectoryPath);

        // SKIPS A FILE ALREADY CARRYING THIS EXACT CONTENT, FOR THE MTIME REASON IN buildPlannedSpecsFile
        this.writePlannedSpecsFiles([
            this.buildPlannedSpecsFile(testSuiteFilePath, testSuiteContent)
        ]);

        return testSuiteFilePath;

    }

    /*
        Copies only the framework classes the workspace is missing so a user who has already
        deployed or customized them keeps their copy. Anything that could not be supplied is
        reported back rather than swallowed -- the generated specs class does not compile without
        the framework, so silently skipping a class would hand the user a broken file with no
        indication of why.
    */
    static scaffoldMissingFrameworkClasses(extensionPath: string, classesDirectoryPath: string): IFrameworkScaffoldResult {

        const shippedFrameworkClassesPath = path.join(extensionPath, 'apexPicklistDependencyFramework', this.frameworkDirectoryName);

        let scaffoldedClassNames: string[] = [];
        let unavailableClassNames: string[] = [];

        const shippedFrameworkClassesExist = fs.existsSync(shippedFrameworkClassesPath);

        const frameworkDirectoryPath = this.getFrameworkDirectoryPath(classesDirectoryPath);

        fs.mkdirSync(classesDirectoryPath, { recursive: true });
        fs.mkdirSync(frameworkDirectoryPath, { recursive: true });

        this.frameworkClassNames.forEach(frameworkClassName => {

            const targetClassFilePath = path.join(frameworkDirectoryPath, `${frameworkClassName}.cls`);

            /*
                A copy already sitting at the classes root is honoured too. Earlier versions scaffolded
                there, so re-running the command after an upgrade must not deploy the same class twice
                under two paths -- Salesforce would reject the duplicate ApexClass.
            */
            const legacyClassFilePath = path.join(classesDirectoryPath, `${frameworkClassName}.cls`);

            if ( fs.existsSync(targetClassFilePath) || fs.existsSync(legacyClassFilePath) ) {
                return;
            }

            const sourceClassFilePath = path.join(shippedFrameworkClassesPath, `${frameworkClassName}.cls`);
            const sourceMetaFilePath = `${sourceClassFilePath}-meta.xml`;

            // BOTH FILES ARE CHECKED UP FRONT SO A MISSING META XML CANNOT LEAVE AN ORPHANED CLASS FILE BEHIND
            if ( !shippedFrameworkClassesExist || !fs.existsSync(sourceClassFilePath) || !fs.existsSync(sourceMetaFilePath) ) {
                unavailableClassNames.push(frameworkClassName);
                return;
            }

            fs.copyFileSync(sourceClassFilePath, targetClassFilePath);
            fs.copyFileSync(sourceMetaFilePath, `${targetClassFilePath}-meta.xml`);
            scaffoldedClassNames.push(frameworkClassName);

        });

        return { scaffoldedClassNames, unavailableClassNames };

    }

}
