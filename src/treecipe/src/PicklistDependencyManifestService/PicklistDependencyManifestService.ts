import {
    IPicklistDependencyCollectionResult,
    IPicklistDependencyExpectation,
    IPicklistDependencySkippedField,
    IPicklistDependencySpecDetail,
    IRecordTypePicklistDependencySpecDetail,
    PicklistDependencyTestService
} from '../PicklistDependencyTestService/PicklistDependencyTestService';

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/*
    One expectation as the manifest records it: the spec detail's own expectation, plus a stable key
    naming the combination.

    What makes the manifest an ATTRIBUTION TARGET rather than a description is that the combinations
    failures are matched against are built FROM it. Before that, a failure line was matched against
    combinations the panel had just re-derived from source XML, so a metadata edit between
    generation and panel-open silently moved what a failure appeared to be about. Sourced from the
    manifest, a failure either names a combination the specs declared or is surfaced as
    unattributed -- there is no third outcome where it lands on the wrong row.

    The key materializes that identity as one string so a row can be named and linked to. See
    buildCombinationKey for what does and does not currently read it.
*/
export interface IPicklistDependencyManifestExpectation {
    combinationKey: string;
    controllingValue: string;
    dependentValues: string[];
    forbiddenValues?: string[];
    controllingValueUnavailable?: boolean;
}

export interface IPicklistDependencyManifestField {
    fieldApiName: string;
    controllingFieldApiName: string;
    upstreamFieldApiName?: string;
    // THE GENERATED APEX METHOD THAT RETURNS THIS FIELD'S SPEC, SO A PANEL ROW NAMES THE CODE ASSERTING IT
    specMethodName: string;
    expectations: IPicklistDependencyManifestExpectation[];
}

export interface IPicklistDependencyManifestRecordTypeScopedField extends IPicklistDependencyManifestField {
    recordTypeDeveloperName: string;
}

export interface IPicklistDependencyManifestObject {
    objectApiName: string;
    generatedClassName: string;
    generatedClassFilePath: string;
    testMethodName: string;
    fields: IPicklistDependencyManifestField[];
    recordTypeScopedFields: IPicklistDependencyManifestRecordTypeScopedField[];
}

/*
    Everything the Explorer needs to render the specs that were generated, written by the generate
    command from the same in-memory model that produced the Apex, in the same run.
*/
export interface IPicklistDependencyManifest {
    manifestVersion: number;
    generatedAt: string;
    generatorVersion: string;
    objectsDirectoryPath: string;
    classesDirectoryPath: string;
    aggregatorClassName: string;
    specsTestClassName: string;
    /*
        The Apex test suite the generated test class is registered in, and the file that declares
        it. Recorded so the check command and anything else asking "how do I run these" reads one
        name written by the run that generated them, rather than recomputing it and being right only
        until the generator changes.
    */
    testSuiteName: string;
    testSuiteFilePath: string;
    /*
        A digest over every source file that could contribute a spec -- relative path, mtime and
        size. Deliberately NOT a hash of the collected model: recomputing that would cost the parse
        walk the manifest exists to avoid, and the question being asked is only "could this have
        changed since generation", which a stat walk answers.
    */
    sourceFingerprint: string;
    objects: IPicklistDependencyManifestObject[];
    skippedFieldWarnings: string[];
    /*
        The same skips as skippedFieldWarnings, carrying the object and field each concerns so the
        panel can render one as a row under its object -- "this field was skipped, nothing asserts
        it" -- rather than leaving it absent and indistinguishable from a field with no dependency.
    */
    skippedFields: IPicklistDependencySkippedField[];
}

/*
    Why the manifest could not be loaded. Both non-loaded states are ordinary, actionable outcomes
    rather than errors -- the panel renders an empty state naming the generate command either way.
*/
export type PicklistDependencyManifestLoadState = 'loaded' | 'noManifestFound' | 'unreadableManifest';

export interface IPicklistDependencyManifestLoad {
    state: PicklistDependencyManifestLoadState;
    message: string;
    manifest?: IPicklistDependencyManifest;
    manifestFilePath?: string;
}

/*
    "stale" is deliberately one state with a reason rather than a severity scale. Both reasons mean
    the same thing to a reader -- what is on screen may not be what the org was asked about -- and
    both carry the same next step, which is to regenerate.

    "pendingCheck" is the state a model carries while the freshness walk has not run yet. It exists
    because the walk is stat-per-file over the whole objects directory and now happens AFTER the
    panel paints, so there is a window where the answer is genuinely not known. Reusing "fresh" for
    that window would have the provenance banner assert the specs still match metadata nothing has
    looked at -- the same class of claim the three-state status guarantee exists to prevent one row
    lower down.
*/
export type PicklistDependencyManifestFreshness = 'fresh' | 'staleObjectsDirectory' | 'staleMetadata' | 'pendingCheck';

// FROZEN: IT IS PASSED INTO MODEL BUILDS AS THE PENDING ANSWER, AND ONE CALLER MUTATING IT WOULD CHANGE EVERY LATER OPEN
export const PICKLIST_DEPENDENCY_MANIFEST_FRESHNESS_PENDING: Readonly<IPicklistDependencyManifestFreshnessResult> = Object.freeze({
    freshness: 'pendingCheck' as PicklistDependencyManifestFreshness,
    message: ''
});

export interface IPicklistDependencyManifestFreshnessResult {
    freshness: PicklistDependencyManifestFreshness;
    message: string;
}

export interface IPicklistDependencyManifestSpecDetails {
    specDetails: IPicklistDependencySpecDetail[];
    recordTypeSpecDetails: IRecordTypePicklistDependencySpecDetail[];
}

export class PicklistDependencyManifestService {

    /*
        Bumped only when a manifest written by an older version can no longer be read as written.
        An unrecognised version is reported like a malformed file rather than parsed hopefully --
        rendering a v1 manifest against v2 assumptions is exactly the silent disagreement between
        the panel and the Apex that this artifact exists to eliminate.
    */
    private static currentManifestVersion = 2;

    static getManifestVersion(): number {
        return this.currentManifestVersion;
    }

    static getManifestFileName(): string {
        return 'manifest.json';
    }

    static getManifestFilePath(specsFolderPath: string): string {
        return path.join(specsFolderPath, this.getManifestFileName());
    }

    /*
        The extension's own version, read from the package manifest it ships with.

        Recorded so a manifest written by an older extension is identifiable after the fact -- a
        report of "the panel shows something the Apex does not" is answerable only if the artifact
        says which generator wrote it. A version that cannot be read is not worth failing a
        generation over, so it degrades to "unknown".
    */
    static getGeneratorVersion(extensionPath: string): string {

        try {

            const packageJsonFilePath = path.join(extensionPath, 'package.json');
            const parsedPackageJson = JSON.parse(fs.readFileSync(packageJsonFilePath, 'utf-8'));

            return typeof parsedPackageJson?.version === 'string' ? parsedPackageJson.version : 'unknown';

        } catch {
            return 'unknown';
        }

    }

    /*
        The stable identity of one combination.

        Composed from exactly the tuple attribution matches on -- object, field, record type scope,
        controlling value -- and shaped to match the failure lines SDTPicklistDependencyValidator
        emits, "Object.Field" and "Object.Field [RecordType]".

        applyFailuresToNodes compares that tuple directly rather than looking this string up, so the
        key is not itself the matching mechanism today: it is the identity the match is defined by,
        materialized on every combination so the panel can name, link and deep-link a row by
        something stable. Keeping the two in one function is what stops them diverging the moment
        anything does key off the string.
    */
    static buildCombinationKey(objectApiName: string,
                                fieldApiName: string,
                                controllingValue: string,
                                recordTypeDeveloperName?: string): string {

        const recordTypeScopeSegment = recordTypeDeveloperName ? ` [${recordTypeDeveloperName}]` : '';
        return `${objectApiName}.${fieldApiName}${recordTypeScopeSegment} @ ${controllingValue}`;

    }

    static buildFieldKey(objectApiName: string, fieldApiName: string, recordTypeDeveloperName?: string): string {

        const recordTypeScopeSegment = recordTypeDeveloperName ? ` [${recordTypeDeveloperName}]` : '';
        return `${objectApiName}.${fieldApiName}${recordTypeScopeSegment}`;

    }

    static buildManifestExpectations(specDetail: IPicklistDependencySpecDetail): IPicklistDependencyManifestExpectation[] {

        return specDetail.expectations.map((expectation: IPicklistDependencyExpectation) => {

            let manifestExpectation: IPicklistDependencyManifestExpectation = {
                combinationKey: this.buildCombinationKey(
                    specDetail.objectApiName,
                    specDetail.fieldApiName,
                    expectation.controllingValue,
                    specDetail.recordTypeDeveloperName
                ),
                controllingValue: expectation.controllingValue,
                dependentValues: [...expectation.dependentValues]
            };

            /*
                Both optional flags are carried only when set, rather than normalised to defaults.
                An expectation that never declared a forbidden list asserts only the positive half,
                and the panel renders no complement for it -- writing an empty array here would turn
                that into a claim that the controlling value unlocks everything.
            */
            if ( Array.isArray(expectation.forbiddenValues) ) {
                manifestExpectation.forbiddenValues = [...expectation.forbiddenValues];
            }

            if ( expectation.controllingValueUnavailable ) {
                manifestExpectation.controllingValueUnavailable = true;
            }

            return manifestExpectation;

        });

    }

    /*
        The manifest, built from the SAME collection result the Apex is emitted from.

        Spec method names come from PicklistDependencyTestService rather than being recomputed here,
        for the same reason: two derivations of a name that must match is the disagreement this
        feature removes, not one to reintroduce a layer down.
    */
    static buildManifest(collectionResult: IPicklistDependencyCollectionResult,
                            objectsDirectoryPath: string,
                            classesDirectoryPath: string,
                            generatorVersion: string,
                            generatedAt: string,
                            sourceFingerprint: string): IPicklistDependencyManifest {

        /*
            The object set is the UNION of both kinds, which is what writeSpecsClassFiles emits
            classes for. Taking it from the field-level details alone would leave an object that
            produced only record-type-scoped specs with a generated .cls and no manifest entry at
            all -- the panel would not render an object whose Apex exists, which is the disagreement
            this artifact exists to prevent. The two sides of a parity contract have to agree about
            which objects they are describing, not only about the names within one.
        */
        const distinctObjectApiNames = PicklistDependencyTestService.getDistinctObjectApiNames(
            [...collectionResult.specDetails, ...collectionResult.recordTypeSpecDetails]
        );
        const perObjectClassNamesByObjectApiName = PicklistDependencyTestService.buildPerObjectSpecsClassNamesByObjectApiName(distinctObjectApiNames);
        const testMethodNamesByObjectApiName = PicklistDependencyTestService.buildTestMethodNamesByObjectApiName(distinctObjectApiNames);

        const specDetailsByObjectApiName = PicklistDependencyTestService.groupSpecDetailsByObjectApiName(collectionResult.specDetails);
        const recordTypeSpecDetailsByObjectApiName = PicklistDependencyTestService
            .groupSpecDetailsByObjectApiName(collectionResult.recordTypeSpecDetails) as Record<string, IRecordTypePicklistDependencySpecDetail[]>;

        const objects: IPicklistDependencyManifestObject[] = distinctObjectApiNames.map(objectApiName => {

            const objectSpecDetails = specDetailsByObjectApiName[objectApiName] || [];
            const objectRecordTypeSpecDetails = recordTypeSpecDetailsByObjectApiName[objectApiName] || [];

            /*
                Named over BOTH kinds in one pass, exactly as the Apex emitter does. Uniqueness has
                to hold across the whole class, so naming the two groups separately would produce a
                manifest whose method names are not the ones in the file it describes.
            */
            const allSpecDetails: IPicklistDependencySpecDetail[] = [...objectSpecDetails, ...objectRecordTypeSpecDetails];
            const allSpecMethodNames = PicklistDependencyTestService.buildSpecMethodNamesBySpecDetail(allSpecDetails);

            const perObjectClassName = perObjectClassNamesByObjectApiName[objectApiName];

            const fields: IPicklistDependencyManifestField[] = objectSpecDetails.map((specDetail, specDetailIndex) => {

                let manifestField: IPicklistDependencyManifestField = {
                    fieldApiName: specDetail.fieldApiName,
                    controllingFieldApiName: specDetail.controllingFieldApiName,
                    specMethodName: allSpecMethodNames[specDetailIndex],
                    expectations: this.buildManifestExpectations(specDetail)
                };

                if ( specDetail.upstreamFieldApiName ) {
                    manifestField.upstreamFieldApiName = specDetail.upstreamFieldApiName;
                }

                return manifestField;

            });

            const recordTypeScopedFields: IPicklistDependencyManifestRecordTypeScopedField[] =
                objectRecordTypeSpecDetails.map((recordTypeSpecDetail, recordTypeSpecDetailIndex) => {

                    let manifestRecordTypeScopedField: IPicklistDependencyManifestRecordTypeScopedField = {
                        fieldApiName: recordTypeSpecDetail.fieldApiName,
                        controllingFieldApiName: recordTypeSpecDetail.controllingFieldApiName,
                        recordTypeDeveloperName: recordTypeSpecDetail.recordTypeDeveloperName,
                        specMethodName: allSpecMethodNames[objectSpecDetails.length + recordTypeSpecDetailIndex],
                        expectations: this.buildManifestExpectations(recordTypeSpecDetail)
                    };

                    if ( recordTypeSpecDetail.upstreamFieldApiName ) {
                        manifestRecordTypeScopedField.upstreamFieldApiName = recordTypeSpecDetail.upstreamFieldApiName;
                    }

                    return manifestRecordTypeScopedField;

                });

            return {
                objectApiName: objectApiName,
                generatedClassName: perObjectClassName,
                generatedClassFilePath: PicklistDependencyTestService.getPerObjectSpecsClassFilePath(classesDirectoryPath, perObjectClassName),
                testMethodName: testMethodNamesByObjectApiName[objectApiName],
                fields: fields,
                recordTypeScopedFields: recordTypeScopedFields
            };

        });

        return {
            manifestVersion: this.currentManifestVersion,
            generatedAt: generatedAt,
            generatorVersion: generatorVersion,
            objectsDirectoryPath: objectsDirectoryPath,
            classesDirectoryPath: classesDirectoryPath,
            aggregatorClassName: PicklistDependencyTestService.getSpecsClassName(),
            specsTestClassName: PicklistDependencyTestService.getSpecsTestClassName(),
            testSuiteName: PicklistDependencyTestService.getTestSuiteName(),
            testSuiteFilePath: PicklistDependencyTestService.getTestSuiteFilePath(classesDirectoryPath),
            sourceFingerprint: sourceFingerprint,
            objects: objects,
            /*
                Carried so the panel can say "this field was skipped, nothing asserts it" rather
                than omitting it. A field absent from both the Apex and the panel is indistinguishable
                from one that has no dependency at all, which is the more dangerous of the two.
            */
            skippedFieldWarnings: [...collectionResult.skippedFieldWarnings],
            skippedFields: collectionResult.skippedFields.map(skippedField => ({ ...skippedField }))
        };

    }

    /*
        Rebuilds the spec details the Explorer's view model builder consumes.

        The manifest carries the model rather than a rendering of it, so the panel is not a second
        implementation of the structure logic -- it feeds the same builder the same shapes, and the
        generated-name enrichment happens on top of the nodes that builder returns.
    */
    static buildSpecDetailsByManifest(manifest: IPicklistDependencyManifest): IPicklistDependencyManifestSpecDetails {

        let specDetails: IPicklistDependencySpecDetail[] = [];
        let recordTypeSpecDetails: IRecordTypePicklistDependencySpecDetail[] = [];

        manifest.objects.forEach(manifestObject => {

            manifestObject.fields.forEach(manifestField => {

                specDetails.push({
                    objectApiName: manifestObject.objectApiName,
                    fieldApiName: manifestField.fieldApiName,
                    controllingFieldApiName: manifestField.controllingFieldApiName,
                    upstreamFieldApiName: manifestField.upstreamFieldApiName,
                    expectations: this.buildExpectationsByManifestExpectations(manifestField.expectations)
                });

            });

            manifestObject.recordTypeScopedFields.forEach(manifestRecordTypeScopedField => {

                recordTypeSpecDetails.push({
                    objectApiName: manifestObject.objectApiName,
                    fieldApiName: manifestRecordTypeScopedField.fieldApiName,
                    controllingFieldApiName: manifestRecordTypeScopedField.controllingFieldApiName,
                    upstreamFieldApiName: manifestRecordTypeScopedField.upstreamFieldApiName,
                    recordTypeDeveloperName: manifestRecordTypeScopedField.recordTypeDeveloperName,
                    expectations: this.buildExpectationsByManifestExpectations(manifestRecordTypeScopedField.expectations)
                });

            });

        });

        return { specDetails, recordTypeSpecDetails };

    }

    static buildExpectationsByManifestExpectations(manifestExpectations: IPicklistDependencyManifestExpectation[]): IPicklistDependencyExpectation[] {

        return manifestExpectations.map(manifestExpectation => {

            let expectation: IPicklistDependencyExpectation = {
                controllingValue: manifestExpectation.controllingValue,
                dependentValues: [...manifestExpectation.dependentValues]
            };

            if ( Array.isArray(manifestExpectation.forbiddenValues) ) {
                expectation.forbiddenValues = [...manifestExpectation.forbiddenValues];
            }

            if ( manifestExpectation.controllingValueUnavailable ) {
                expectation.controllingValueUnavailable = true;
            }

            return expectation;

        });

    }

    static serializeManifest(manifest: IPicklistDependencyManifest): string {
        return `${JSON.stringify(manifest, null, 4)}\n`;
    }

    /*
        Whether a manifest already on disk describes exactly what this run would write.

        Compared with generatedAt taken from the existing file, because that field is the one thing
        guaranteed to differ on every run and is not part of what the manifest DESCRIBES. Everything
        else -- the specs, and the fingerprint the staleness banner is keyed off -- is compared
        literally, so a run that only touched a file's mtime still rewrites and clears the banner
        it would otherwise raise against specs the user just regenerated.
    */
    static manifestMatchesExistingContent(manifest: IPicklistDependencyManifest, existingManifestContent: string): boolean {

        let existingManifestRecord: Record<string, unknown> | null;

        try {
            existingManifestRecord = JSON.parse(existingManifestContent) as Record<string, unknown> | null;
        } catch {
            return false;
        }

        if ( !existingManifestRecord || typeof existingManifestRecord.generatedAt !== 'string' ) {
            return false;
        }

        const manifestWithExistingTimestamp: IPicklistDependencyManifest = {
            ...manifest,
            generatedAt: existingManifestRecord.generatedAt
        };

        return this.serializeManifest(manifestWithExistingTimestamp) === existingManifestContent;

    }

    /*
        Skips the write when the manifest on disk already says exactly this.

        The generated artifacts are meant to be committed and reviewed as a diff -- that is what
        deterministic emission bought in 3.4.0 -- and a manifest rewritten with a new timestamp on
        every run would put a change in every regeneration commit whether or not anything changed,
        which is the noise that property exists to remove.
    */
    static writeManifest(specsFolderPath: string, manifest: IPicklistDependencyManifest): string {

        const manifestFilePath = this.getManifestFilePath(specsFolderPath);

        if ( fs.existsSync(manifestFilePath) ) {

            try {

                const existingManifestContent = fs.readFileSync(manifestFilePath, 'utf-8');

                if ( this.manifestMatchesExistingContent(manifest, existingManifestContent) ) {
                    return manifestFilePath;
                }

            } catch {
                // AN UNREADABLE EXISTING MANIFEST IS SIMPLY REPLACED BY THE ONE THIS RUN BUILT
            }

        }

        if ( !fs.existsSync(specsFolderPath) ) {
            fs.mkdirSync(specsFolderPath, { recursive: true });
        }

        fs.writeFileSync(manifestFilePath, this.serializeManifest(manifest));

        return manifestFilePath;

    }

    /*
        Every non-loaded outcome names the generate command, because that is the single action that
        resolves all of them. A malformed manifest reports the parse failure rather than a blank
        panel, matching how an unreadable results.json is handled.
    */
    static loadManifest(specsFolderPath: string): IPicklistDependencyManifestLoad {

        const manifestFilePath = this.getManifestFilePath(specsFolderPath);

        if ( !fs.existsSync(manifestFilePath) ) {
            return {
                state: 'noManifestFound',
                message: `No picklist dependency specs have been generated yet -- no manifest was found at "${manifestFilePath}". Run "Salesforce Treecipe: Generate Picklist Dependency Tests" to generate the Apex specs and the manifest that describes them.`
            };
        }

        let parsedManifestContent: unknown;

        try {
            parsedManifestContent = JSON.parse(fs.readFileSync(manifestFilePath, 'utf-8'));
        } catch (error) {
            return {
                state: 'unreadableManifest',
                message: `The picklist dependency spec manifest at "${manifestFilePath}" could not be read as JSON (${error.message}). Re-run "Salesforce Treecipe: Generate Picklist Dependency Tests" to replace it.`,
                manifestFilePath: manifestFilePath
            };
        }

        return this.buildManifestLoadByParsedContent(parsedManifestContent, manifestFilePath);

    }

    /*
        Validation is structural only: the manifest names the objects and fields the panel renders,
        so a shape that cannot be walked is reported rather than rendered half way. Entries are
        normalised through the same coercions results.json uses, so one malformed field inside an
        otherwise readable manifest costs that field rather than the whole panel.
    */
    static buildManifestLoadByParsedContent(parsedManifestContent: unknown, manifestFilePath: string): IPicklistDependencyManifestLoad {

        const manifestRecord = parsedManifestContent as Record<string, unknown> | null;

        if ( !manifestRecord || typeof manifestRecord !== 'object' || !Array.isArray(manifestRecord.objects) ) {
            return {
                state: 'unreadableManifest',
                message: `The picklist dependency spec manifest at "${manifestFilePath}" is missing the "objects" list, so no generated specs could be read from it. Re-run "Salesforce Treecipe: Generate Picklist Dependency Tests" to replace it.`,
                manifestFilePath: manifestFilePath
            };
        }

        const manifestVersion = typeof manifestRecord.manifestVersion === 'number' ? manifestRecord.manifestVersion : 0;

        if ( manifestVersion !== this.currentManifestVersion ) {
            return {
                state: 'unreadableManifest',
                message: `The picklist dependency spec manifest at "${manifestFilePath}" was written in format version ${manifestVersion}, and this version of Salesforce Data Treecipe reads version ${this.currentManifestVersion}. Re-run "Salesforce Treecipe: Generate Picklist Dependency Tests" to replace it.`,
                manifestFilePath: manifestFilePath
            };
        }

        const objects: IPicklistDependencyManifestObject[] = manifestRecord.objects
            .map((objectEntry: unknown) => this.buildManifestObjectByEntry(objectEntry))
            .filter((manifestObject): manifestObject is IPicklistDependencyManifestObject => manifestObject !== undefined);

        return {
            state: 'loaded',
            message: '',
            manifestFilePath: manifestFilePath,
            manifest: {
                manifestVersion: manifestVersion,
                generatedAt: typeof manifestRecord.generatedAt === 'string' ? manifestRecord.generatedAt : 'unknown time',
                generatorVersion: typeof manifestRecord.generatorVersion === 'string' ? manifestRecord.generatorVersion : 'unknown',
                objectsDirectoryPath: typeof manifestRecord.objectsDirectoryPath === 'string' ? manifestRecord.objectsDirectoryPath : '',
                classesDirectoryPath: typeof manifestRecord.classesDirectoryPath === 'string' ? manifestRecord.classesDirectoryPath : '',
                aggregatorClassName: typeof manifestRecord.aggregatorClassName === 'string' ? manifestRecord.aggregatorClassName : '',
                specsTestClassName: typeof manifestRecord.specsTestClassName === 'string' ? manifestRecord.specsTestClassName : '',
                testSuiteName: typeof manifestRecord.testSuiteName === 'string' ? manifestRecord.testSuiteName : '',
                testSuiteFilePath: typeof manifestRecord.testSuiteFilePath === 'string' ? manifestRecord.testSuiteFilePath : '',
                sourceFingerprint: typeof manifestRecord.sourceFingerprint === 'string' ? manifestRecord.sourceFingerprint : '',
                objects: objects,
                skippedFieldWarnings: Array.isArray(manifestRecord.skippedFieldWarnings)
                    ? manifestRecord.skippedFieldWarnings.filter((warning: unknown): warning is string => typeof warning === 'string')
                    : [],
                skippedFields: Array.isArray(manifestRecord.skippedFields)
                    ? manifestRecord.skippedFields
                        .map((skippedFieldEntry: unknown) => this.buildSkippedFieldByEntry(skippedFieldEntry))
                        .filter((skippedField): skippedField is IPicklistDependencySkippedField => skippedField !== undefined)
                    : []
            }
        };

    }

    /*
        An object entry without an api name names nothing and cannot be rendered, so it is dropped
        rather than shown as an unnamed row. Everything else about it degrades to an empty value.
    */
    static buildManifestObjectByEntry(objectEntry: unknown): IPicklistDependencyManifestObject | undefined {

        const objectRecord = objectEntry as Record<string, unknown> | null;

        /*
            The api name is held to the same gate the generator applies before emitting anything.

            Dropping the entry here rather than downstream is what keeps a hand-edited manifest from
            taking the whole command with it: buildFieldSourceFilePath throws on a name outside this
            shape, and an entry that reached it would abort the Explorer into the error handler --
            surfacing the edited string in a pre-filled issue template -- instead of rendering the
            objects that are perfectly readable. Every other malformed entry is already dropped;
            this one was the exception.
        */
        if ( !objectRecord
                || typeof objectRecord.objectApiName !== 'string'
                || !PicklistDependencyTestService.isValidSalesforceApiName(objectRecord.objectApiName) ) {
            return undefined;
        }

        const objectApiName = objectRecord.objectApiName;

        const fields = Array.isArray(objectRecord.fields)
            ? objectRecord.fields
                .map((fieldEntry: unknown) => this.buildManifestFieldByEntry(fieldEntry, objectApiName))
                .filter((manifestField): manifestField is IPicklistDependencyManifestField => manifestField !== undefined)
            : [];

        const recordTypeScopedFields = Array.isArray(objectRecord.recordTypeScopedFields)
            ? objectRecord.recordTypeScopedFields
                .map((fieldEntry: unknown) => this.buildManifestRecordTypeScopedFieldByEntry(fieldEntry, objectApiName))
                .filter((manifestField): manifestField is IPicklistDependencyManifestRecordTypeScopedField => manifestField !== undefined)
            : [];

        return {
            objectApiName: objectApiName,
            generatedClassName: typeof objectRecord.generatedClassName === 'string' ? objectRecord.generatedClassName : '',
            generatedClassFilePath: typeof objectRecord.generatedClassFilePath === 'string' ? objectRecord.generatedClassFilePath : '',
            testMethodName: typeof objectRecord.testMethodName === 'string' ? objectRecord.testMethodName : '',
            fields: fields,
            recordTypeScopedFields: recordTypeScopedFields
        };

    }

    static buildManifestFieldByEntry(fieldEntry: unknown, objectApiName: string): IPicklistDependencyManifestField | undefined {

        const fieldRecord = fieldEntry as Record<string, unknown> | null;

        // SAME GATE AS THE OBJECT ABOVE, FOR THE SAME REASON
        if ( !fieldRecord
                || typeof fieldRecord.fieldApiName !== 'string'
                || !PicklistDependencyTestService.isValidSalesforceApiName(fieldRecord.fieldApiName) ) {
            return undefined;
        }

        // HOISTED SO THE NARROWED TYPE SURVIVES INTO THE CLOSURE BELOW RATHER THAN NEEDING A CAST
        const fieldApiName = fieldRecord.fieldApiName;

        let manifestField: IPicklistDependencyManifestField = {
            fieldApiName: fieldApiName,
            controllingFieldApiName: typeof fieldRecord.controllingFieldApiName === 'string' ? fieldRecord.controllingFieldApiName : '',
            specMethodName: typeof fieldRecord.specMethodName === 'string' ? fieldRecord.specMethodName : '',
            expectations: Array.isArray(fieldRecord.expectations)
                ? fieldRecord.expectations
                    .map((expectationEntry: unknown) => this.buildManifestExpectationByEntry(
                        expectationEntry,
                        objectApiName,
                        fieldApiName,
                        typeof fieldRecord.recordTypeDeveloperName === 'string' ? fieldRecord.recordTypeDeveloperName : undefined
                    ))
                    .filter((manifestExpectation): manifestExpectation is IPicklistDependencyManifestExpectation => manifestExpectation !== undefined)
                : []
        };

        if ( typeof fieldRecord.upstreamFieldApiName === 'string' && fieldRecord.upstreamFieldApiName.length > 0 ) {
            manifestField.upstreamFieldApiName = fieldRecord.upstreamFieldApiName;
        }

        return manifestField;

    }

    static buildManifestRecordTypeScopedFieldByEntry(fieldEntry: unknown,
                                                        objectApiName: string): IPicklistDependencyManifestRecordTypeScopedField | undefined {

        const fieldRecord = fieldEntry as Record<string, unknown> | null;

        if ( !fieldRecord || typeof fieldRecord.recordTypeDeveloperName !== 'string' || fieldRecord.recordTypeDeveloperName.length === 0 ) {
            return undefined;
        }

        const manifestField = this.buildManifestFieldByEntry(fieldEntry, objectApiName);

        if ( !manifestField ) {
            return undefined;
        }

        return {
            ...manifestField,
            recordTypeDeveloperName: fieldRecord.recordTypeDeveloperName
        };

    }

    /*
        The combination key is REBUILT from the entry rather than trusted as written.

        A key read straight from the file is attacker-controlled in the same sense every other
        metadata-derived string here is -- an edited manifest could point a failure at a combination
        it does not describe. Rebuilding it from the object, field and controlling value the entry
        itself declares means the key can only ever name the row it sits on.
    */
    static buildManifestExpectationByEntry(expectationEntry: unknown,
                                            objectApiName: string,
                                            fieldApiName: string,
                                            recordTypeDeveloperName?: string): IPicklistDependencyManifestExpectation | undefined {

        const expectationRecord = expectationEntry as Record<string, unknown> | null;

        if ( !expectationRecord || typeof expectationRecord.controllingValue !== 'string' ) {
            return undefined;
        }

        const controllingValue = expectationRecord.controllingValue;

        let manifestExpectation: IPicklistDependencyManifestExpectation = {
            combinationKey: this.buildCombinationKey(objectApiName, fieldApiName, controllingValue, recordTypeDeveloperName),
            controllingValue: controllingValue,
            dependentValues: Array.isArray(expectationRecord.dependentValues)
                ? expectationRecord.dependentValues.filter((dependentValue: unknown): dependentValue is string => typeof dependentValue === 'string')
                : []
        };

        if ( Array.isArray(expectationRecord.forbiddenValues) ) {
            manifestExpectation.forbiddenValues = expectationRecord.forbiddenValues
                .filter((forbiddenValue: unknown): forbiddenValue is string => typeof forbiddenValue === 'string');
        }

        if ( expectationRecord.controllingValueUnavailable === true ) {
            manifestExpectation.controllingValueUnavailable = true;
        }

        return manifestExpectation;

    }

    /*
        A skip entry with no object to file it under cannot be rendered as a row, and one with no
        warning has nothing to say, so both are dropped rather than shown as an empty row. The
        warning is the reason the entry exists at all.
    */
    static buildSkippedFieldByEntry(skippedFieldEntry: unknown): IPicklistDependencySkippedField | undefined {

        const skippedFieldRecord = skippedFieldEntry as Record<string, unknown> | null;

        if ( !skippedFieldRecord
                || typeof skippedFieldRecord.objectApiName !== 'string'
                || skippedFieldRecord.objectApiName.length === 0
                || typeof skippedFieldRecord.warning !== 'string'
                || skippedFieldRecord.warning.length === 0 ) {
            return undefined;
        }

        /*
            A manifest written before this field existed carries no reason, and a hand-edited one can
            carry a string this version does not define. Both degrade to "unknown" rather than
            dropping the entry: the warning text is still exactly what the run reported, and losing
            the row entirely would understate what generation left out -- which is the one thing the
            skipped-field list exists to prevent.
        */
        let skippedField: IPicklistDependencySkippedField = {
            objectApiName: skippedFieldRecord.objectApiName,
            warning: skippedFieldRecord.warning,
            reason: PicklistDependencyTestService.isRecognisedSkipReason(skippedFieldRecord.reason)
                        ? skippedFieldRecord.reason
                        : 'unknown'
        };

        if ( typeof skippedFieldRecord.fieldApiName === 'string' && skippedFieldRecord.fieldApiName.length > 0 ) {
            skippedField.fieldApiName = skippedFieldRecord.fieldApiName;
        }

        if ( typeof skippedFieldRecord.recordTypeDeveloperName === 'string' && skippedFieldRecord.recordTypeDeveloperName.length > 0 ) {
            skippedField.recordTypeDeveloperName = skippedFieldRecord.recordTypeDeveloperName;
        }

        return skippedField;

    }

    private static fieldFileSuffix = '.field-meta.xml';

    private static recordTypeFileSuffix = '.recordType-meta.xml';

    private static objectFieldsDirectoryName = 'fields';

    private static objectRecordTypesDirectoryName = 'recordTypes';

    /*
        Every source file that could contribute a spec, as "relativePath|mtimeMs|size" lines.

        Stat only -- no file is opened. The walk stops descending at a directory holding "fields",
        exactly as collectSpecDetailsByObjectsDirectory does and for the same reason: that directory
        IS an object directory, so its other children are metadata types that cannot hold a field --
        listViews, compactLayouts, webLinks and the rest -- and the record types that narrow a
        dependency are read from the recordTypes sibling rather than from below them.

        Skipping them is not an optimisation of the answer, it is an optimisation of the walk: the
        entries those directories could contribute are none, so the digest is byte for byte the same
        either way. Without the stop, roughly seven in ten of the directories visited on a real org
        cannot contain a spec-contributing file at all.
    */
    static collectSourceFingerprintEntries(objectsDirectoryPath: string): string[] {

        let fingerprintEntries: string[] = [];
        let visitedDirectoryPaths = new Set<string>();

        const collectFileEntry = (entryPath: string) => {

            try {

                const entryStats = fs.statSync(entryPath);
                const relativeEntryPath = path.relative(objectsDirectoryPath, entryPath).split(path.sep).join('/');

                fingerprintEntries.push(`${relativeEntryPath}|${entryStats.mtimeMs}|${entryStats.size}`);

            } catch {
                // A FILE THAT VANISHED BETWEEN READDIR AND STAT IS SIMPLY NOT PART OF THIS FINGERPRINT
            }

        };

        /*
            Directory entries with symlinks resolved to what they actually are.

            A symlink is not asked whether it is a directory -- Dirent reports the LINK, not its
            target, so a symlinked ".field-meta.xml" answers false to isDirectory() and, treated as a
            directory, would be handed to readdirSync, throw ENOTDIR, and drop out of the fingerprint
            entirely. That is a staleness blind spot rather than a crash: edits to that field would
            never move the digest. stat follows the link and answers about the target.
        */
        const readResolvedDirectoryEntries = (directoryPath: string) => {

            let directoryEntries: fs.Dirent[];

            try {
                directoryEntries = fs.readdirSync(directoryPath, { withFileTypes: true });
            } catch {
                // AN UNREADABLE DIRECTORY CONTRIBUTES NOTHING RATHER THAN FAILING THE WHOLE FINGERPRINT
                return [];
            }

            return directoryEntries.map(directoryEntry => {

                const entryPath = path.join(directoryPath, directoryEntry.name);

                let isDirectoryEntry = directoryEntry.isDirectory();

                if ( directoryEntry.isSymbolicLink() ) {

                    try {
                        isDirectoryEntry = fs.statSync(entryPath).isDirectory();
                    } catch {
                        // A BROKEN SYMLINK IS NEITHER A DIRECTORY TO DESCEND NOR A FILE TO DIGEST
                        return undefined;
                    }

                }

                return { entryName: directoryEntry.name, entryPath, isDirectoryEntry };

            }).filter((resolvedEntry): resolvedEntry is { entryName: string; entryPath: string; isDirectoryEntry: boolean } => resolvedEntry !== undefined);

        };

        const isSpecContributingFileName = (fileName: string) => fileName.endsWith(this.fieldFileSuffix)
                                                                    || fileName.endsWith(this.recordTypeFileSuffix);

        const collectEntriesByDirectory = (directoryPath: string) => {

            const realDirectoryPath = PicklistDependencyTestService.getRealDirectoryPath(directoryPath);
            if ( visitedDirectoryPaths.has(realDirectoryPath) ) {
                return;
            }
            visitedDirectoryPaths.add(realDirectoryPath);

            const resolvedEntries = readResolvedDirectoryEntries(directoryPath);

            const childDirectoryNames = resolvedEntries
                .filter(resolvedEntry => resolvedEntry.isDirectoryEntry)
                .map(resolvedEntry => resolvedEntry.entryName);

            /*
                A directory holding "fields" is an object directory. Only its fields and recordTypes
                children can carry a file this digest is about, so the rest of the object's metadata
                is not descended into.
            */
            if ( childDirectoryNames.includes(this.objectFieldsDirectoryName) ) {

                [this.objectFieldsDirectoryName, this.objectRecordTypesDirectoryName].forEach(contributingDirectoryName => {

                    if ( !childDirectoryNames.includes(contributingDirectoryName) ) {
                        return;
                    }

                    const contributingDirectoryPath = path.join(directoryPath, contributingDirectoryName);

                    readResolvedDirectoryEntries(contributingDirectoryPath).forEach(resolvedEntry => {

                        if ( resolvedEntry.isDirectoryEntry || !isSpecContributingFileName(resolvedEntry.entryName) ) {
                            return;
                        }

                        collectFileEntry(resolvedEntry.entryPath);

                    });

                });

                return;

            }

            resolvedEntries.forEach(resolvedEntry => {

                if ( resolvedEntry.isDirectoryEntry ) {
                    collectEntriesByDirectory(resolvedEntry.entryPath);
                    return;
                }

                if ( !isSpecContributingFileName(resolvedEntry.entryName) ) {
                    return;
                }

                collectFileEntry(resolvedEntry.entryPath);

            });

        };

        collectEntriesByDirectory(objectsDirectoryPath);

        return fingerprintEntries.sort();

    }

    static buildSourceFingerprint(objectsDirectoryPath: string): string {

        const fingerprintEntries = this.collectSourceFingerprintEntries(objectsDirectoryPath);

        return crypto.createHash('sha256').update(fingerprintEntries.join('\n')).digest('hex');

    }

    /*
        Whether what the manifest describes can still be trusted to describe the metadata on disk.

        The objects directory is compared first and reported separately: a manifest recorded against
        a DIFFERENT directory is not stale metadata, it is a manifest about something else entirely,
        and telling a reader their metadata changed would send them looking for an edit they never
        made.

        A fingerprint mismatch is reported as possible drift rather than as certain drift. Touching
        a file without editing it moves its mtime, so the check can say "regenerate to be sure" but
        never "this specific thing changed" -- and a banner that overstates is one users learn to
        dismiss.
    */
    static resolveManifestFreshness(manifest: IPicklistDependencyManifest,
                                        objectsDirectoryPath: string): IPicklistDependencyManifestFreshnessResult {

        if ( this.normalizeDirectoryPathForComparison(manifest.objectsDirectoryPath)
                !== this.normalizeDirectoryPathForComparison(objectsDirectoryPath) ) {

            return {
                freshness: 'staleObjectsDirectory',
                message: `These specs were generated from "${manifest.objectsDirectoryPath}", but the configured objects directory is now "${objectsDirectoryPath}". What is shown below describes the directory the specs were generated from. Run "Salesforce Treecipe: Generate Picklist Dependency Tests" to regenerate against the configured directory.`
            };

        }

        const currentSourceFingerprint = this.buildSourceFingerprint(objectsDirectoryPath);

        if ( manifest.sourceFingerprint.length > 0 && manifest.sourceFingerprint !== currentSourceFingerprint ) {

            return {
                freshness: 'staleMetadata',
                message: `The object metadata in "${objectsDirectoryPath}" has changed since these specs were generated on ${manifest.generatedAt}. What is shown below is what the generated Apex asserts, which may no longer match your metadata. Run "Salesforce Treecipe: Generate Picklist Dependency Tests" to regenerate.`
            };

        }

        return { freshness: 'fresh', message: '' };

    }

    /*
        Compared as resolved paths so "./force-app/../force-app/main/default/objects" and the
        directory it names do not read as two different scans. Case is left alone: a case-insensitive
        compare would call two genuinely different directories equal on the platforms where that is
        not true.
    */
    static normalizeDirectoryPathForComparison(directoryPath: string): string {

        if ( !directoryPath ) {
            return '';
        }

        return path.resolve(directoryPath).split(path.sep).join('/').replace(/\/+$/, '');

    }

}
