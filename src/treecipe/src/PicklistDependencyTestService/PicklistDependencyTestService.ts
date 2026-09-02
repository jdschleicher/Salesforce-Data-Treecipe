import { GlobalValueSetSingleton } from '../GlobalValueSetSingleton/GlobalValueSetSingleton';
import { RecipeService } from '../RecipeService/RecipeService';
import { RecordTypeService } from '../RecordTypeService/RecordTypeService';
import { RecordTypeWrapper } from '../RecordTypeService/RecordTypesWrapper';
import { XmlFileProcessor } from '../XMLProcessingService/XmlFileProcessor';
import { XMLFieldDetail } from '../XMLProcessingService/XMLFieldDetail';

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
export interface IGlobalValueSetDependentValueResolution {
    declaredDependentValues?: string[];
    controllingValueToPicklistOptions: Record<string, string[]>;
    warnings: string[];
}

export interface IPicklistDependencyCollectionResult {
    specDetails: IPicklistDependencySpecDetail[];
    recordTypeSpecDetails: IRecordTypePicklistDependencySpecDetail[];
    skippedFieldWarnings: string[];
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
}

export interface IRecordTypeSpecDetailBuildResult {
    recordTypeSpecDetails: IRecordTypePicklistDependencySpecDetail[];
    skippedFieldWarnings: string[];
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

export interface IFrameworkScaffoldResult {
    scaffoldedClassNames: string[];
    // FRAMEWORK CLASSES NEITHER ALREADY IN THE WORKSPACE NOR AVAILABLE TO COPY FROM THE EXTENSION
    unavailableClassNames: string[];
}

export class PicklistDependencyTestService {

    /*
        The "SDT" prefix marks every class this command writes into a user's package directory as
        Salesforce Data Treecipe's rather than theirs, and removes any chance of colliding with a
        PicklistDependencySpecs of their own. The aggregator, the per-object classes and the test
        class all derive from it, so they move together.
    */
    private static specsClassName = 'SDTPLDSpecs';

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
    */
    static async collectSpecDetailsByObjectsDirectory(objectsDirectoryUri: vscode.Uri,
                                                        visitedDirectoryPaths: Set<string> = new Set()): Promise<IPicklistDependencyCollectionResult> {

        let collectedResult: IPicklistDependencyCollectionResult = {
            specDetails: [],
            recordTypeSpecDetails: [],
            skippedFieldWarnings: []
        };

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

            }

            return collectedResult;

        }

        for ( const childDirectoryName of childDirectoryNames ) {

            const childDirectoryUri = vscode.Uri.joinPath(objectsDirectoryUri, childDirectoryName);

            const nestedResult = await this.collectSpecDetailsByObjectsDirectory(childDirectoryUri, visitedDirectoryPaths);
            collectedResult.specDetails = collectedResult.specDetails.concat(nestedResult.specDetails);
            collectedResult.recordTypeSpecDetails = collectedResult.recordTypeSpecDetails.concat(nestedResult.recordTypeSpecDetails);
            collectedResult.skippedFieldWarnings = collectedResult.skippedFieldWarnings.concat(nestedResult.skippedFieldWarnings);

        }

        return collectedResult;

    }

    /*
        Resolved through symlinks so two paths reaching the same directory compare equal. Falls
        back to the given path when it cannot be resolved, which keeps the walk working against a
        mocked or virtual filesystem.
    */
    static getRealDirectoryPath(directoryPath: string): string {

        try {
            return fs.realpathSync(directoryPath);
        } catch {
            return path.resolve(directoryPath);
        }

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
                skippedFieldWarnings.push(`Skipped dependent picklist "${objectApiName}.${fieldDetail.apiName}": the api name "${invalidApiName}" is not a valid Salesforce api name (letters, numbers and underscores only). No spec was generated for this field.`);
                return;

            }

            let controllingValueToPicklistOptions = RecipeService.buildControllingValueToPicklistOptions(fieldDetail);

            if ( Object.keys(controllingValueToPicklistOptions).length === 0 ) {

                skippedFieldWarnings.push(`No "valueSettings" markup found for dependent picklist "${objectApiName}.${fieldDetail.apiName}" controlled by "${fieldDetail.controllingField}" -- no spec was generated for this field.`);
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
                skippedFieldWarnings = skippedFieldWarnings.concat(globalValueSetResolution.warnings);

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

        return { specDetails, recordTypeSpecDetails: [], skippedFieldWarnings };

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
                skippedRecordTypeWarnings.push(`Skipped record type file "${fileName}" under "${objectApiName}": its XML could not be parsed. Fix the markup in that file to have its record type scoped specs generated.`);
                continue;
            }

            const parsedRecordTypeDeveloperName = recordTypeXmlDetail?.fullName?.[0];

            /*
                The TYPE is checked, not just the presence: nested markup under <fullName> parses to
                an object rather than a string, and an object is truthy, so a presence check alone
                would carry it into the wrapper and fail later at the sort below.
            */
            if ( typeof parsedRecordTypeDeveloperName !== 'string' || parsedRecordTypeDeveloperName.trim() === '' ) {
                skippedRecordTypeWarnings.push(`Skipped record type file "${fileName}" under "${objectApiName}": no usable RecordType "fullName" markup was found, so the record type has no developer name to scope specs by.`);
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
                skippedRecordTypeWarnings.push(`Skipped record type "${parsedRecordTypeDeveloperName}" under "${objectApiName}": its picklist assignment markup could not be read (${error.message}). No record-type-scoped specs were generated for it.`);
            }

        }

        /*
            This ordering reaches the emitted bytes -- it is the order recordTypeSpecs() lists its
            methods in -- so it uses the same host-independent comparison as every other emission
            sort. It was localeCompare until 3.4.0, which made the generated file depend on the
            host's ICU locale data.
        */
        recordTypeWrappers.sort((firstWrapper, secondWrapper) => this.compareForEmission(firstWrapper.DeveloperName, secondWrapper.DeveloperName));

        return { recordTypeWrappers, skippedRecordTypeWarnings };

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

        recordTypeWrappers.forEach(recordTypeWrapper => {

            const recordTypeDeveloperName = recordTypeWrapper.DeveloperName;

            /*
                The developer name is embedded in an Apex string literal and in the generated method
                name, so it goes through the same gate the object and field api names do.
            */
            if ( !this.isValidSalesforceApiName(recordTypeDeveloperName) ) {
                skippedFieldWarnings.push(`Skipped record type "${recordTypeDeveloperName}": the developer name is not a valid Salesforce api name (letters, numbers and underscores only). No record-type-scoped specs were generated for it.`);
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
                    skippedFieldWarnings.push(`Skipped record type "${recordTypeDeveloperName}" for dependent picklist "${specDetail.objectApiName}.${specDetail.fieldApiName}": the record type assigns no values to "${unassignedFieldApiName}", so no combination is reachable through it. The field-level spec still covers this field.`);
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

        return { recordTypeSpecDetails, skippedFieldWarnings };

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

        let warnings: string[] = [];

        const globalValueSetName = fieldDetail.globalValueSetName;
        const declaredDependentValues = this.getGlobalValueSetPicklistValues(globalValueSetName);

        if ( !declaredDependentValues ) {

            warnings.push(`Skipped dependent picklist "${objectApiName}.${fieldDetail.apiName}": its values come from the global value set "${globalValueSetName}", which was not found in the project's "globalValueSets" directory. Retrieve that global value set and run the command again to have this field specced.`);
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
            warnings.push(`Dependent picklist "${objectApiName}.${fieldDetail.apiName}" has "valueSettings" for ${sortedUndeclaredValueNames.map(undeclaredValueName => `"${undeclaredValueName}"`).join(', ')}, which the global value set "${globalValueSetName}" does not declare. Those values were left out of the generated spec -- no org exposes them, so asserting them would fail for a reason the spec cannot fix.`);

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

        // A RECORD TYPE SCOPED SPEC CHAINS TO THE UPSTREAM SPEC FOR THE SAME RECORD TYPE, NOT TO THE FIELD-LEVEL ONE
        let recordTypeSpecMethodNameByScopedFieldKey: Record<string, string> = {};
        recordTypeSpecDetails.forEach((recordTypeSpecDetail, recordTypeSpecDetailIndex) => {
            const scopedFieldKey = `${recordTypeSpecDetail.recordTypeDeveloperName}.${recordTypeSpecDetail.fieldApiName}`;
            recordTypeSpecMethodNameByScopedFieldKey[scopedFieldKey] = recordTypeSpecMethodNames[recordTypeSpecDetailIndex];
        });

        const buildSpecMethodMarkup = (specDetail: IPicklistDependencySpecDetail, specMethodName: string, upstreamSpecMethodName?: string) => {

            const specStatement = this.buildSpecStatement(specDetail, upstreamSpecMethodName);
            const recordTypeScopeComment = specDetail.recordTypeDeveloperName ? ` for record type ${specDetail.recordTypeDeveloperName}` : '';

            return `    // ${specDetail.objectApiName}.${specDetail.fieldApiName} controlled by ${specDetail.controllingFieldApiName}${recordTypeScopeComment}
    public static SDTPicklistDependencySpec ${specMethodName}() {
        return ${specStatement.trim()};
    }`;

        };

        const specMethods = specDetails.map((specDetail, specDetailIndex) => {

            const upstreamSpecMethodName = specDetail.upstreamFieldApiName
                ? specMethodNameByFieldApiName[specDetail.upstreamFieldApiName]
                : undefined;

            return buildSpecMethodMarkup(specDetail, specMethodNames[specDetailIndex], upstreamSpecMethodName);

        }).join('\n\n');

        const recordTypeSpecMethods = recordTypeSpecDetails.map((recordTypeSpecDetail, recordTypeSpecDetailIndex) => {

            const upstreamSpecMethodName = recordTypeSpecDetail.upstreamFieldApiName
                ? recordTypeSpecMethodNameByScopedFieldKey[`${recordTypeSpecDetail.recordTypeDeveloperName}.${recordTypeSpecDetail.upstreamFieldApiName}`]
                : undefined;

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

    static getSfdxProjectFilePath(workspaceRoot: string): string {
        return path.join(workspaceRoot, 'sfdx-project.json');
    }

    static readSfdxProjectJson(sfdxProjectFilePath: string): any {

        const sfdxProjectFileContent = fs.readFileSync(sfdxProjectFilePath, 'utf-8');

        try {
            return JSON.parse(sfdxProjectFileContent);
        } catch (error) {
            throw new Error(`Could not parse "${sfdxProjectFilePath}" as JSON: ${error.message}. Fix the file and run the command again.`);
        }

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

        const realPath = this.getRealDirectoryPath(resolvedPath);
        const realWorkspaceRoot = this.getRealDirectoryPath(resolvedWorkspaceRoot);

        const isContained = (candidatePath: string, rootPath: string) => (
            candidatePath === rootPath || candidatePath.startsWith(rootPath + path.sep)
        );

        return isContained(resolvedPath, resolvedWorkspaceRoot) && isContained(realPath, realWorkspaceRoot);

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
                                    specsTestClassBody?: string): ISpecsChangePlan {

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

        const addedClassFiles = changedFiles.filter(changedFile => changedFile.changeType === 'added' && !changedFile.filePath.endsWith('-meta.xml'));
        const updatedClassFiles = changedFiles.filter(changedFile => changedFile.changeType === 'changed' && !changedFile.filePath.endsWith('-meta.xml'));

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
    static writePlannedSpecsFiles(plannedFiles: IPlannedSpecsFile[]): string[] {

        let writtenFilePaths: string[] = [];

        plannedFiles.forEach(plannedFile => {

            if ( plannedFile.changeType === 'unchanged' ) {
                return;
            }

            fs.writeFileSync(plannedFile.filePath, plannedFile.proposedContent);
            writtenFilePaths.push(plannedFile.filePath);

        });

        return writtenFilePaths;

    }

    static writeSpecsClassFiles(classesDirectoryPath: string,
                                    specDetails: IPicklistDependencySpecDetail[],
                                    apiVersion: string,
                                    recordTypeSpecDetails: IRecordTypePicklistDependencySpecDetail[] = [],
                                    previewedChangePlan?: ISpecsChangePlan): ISpecsClassWriteResult {

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
        const specsClassPlannedFiles = changePlan.plannedFiles.filter(
            plannedFile => plannedFile.filePath !== specsTestClassFilePath
                            && plannedFile.filePath !== `${specsTestClassFilePath}-meta.xml`
        );

        this.writePlannedSpecsFiles(specsClassPlannedFiles);

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
