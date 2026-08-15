import { RecipeService } from '../RecipeService/RecipeService';
import { XmlFileProcessor } from '../XMLProcessingService/XmlFileProcessor';
import { XMLFieldDetail } from '../XMLProcessingService/XMLFieldDetail';
import {
    IPicklistDependencyExpectation,
    IPicklistDependencySpecCollectionResult,
    IPicklistDependencySpecDetail
} from './PicklistDependencySpecDetail';

import * as fs from 'fs';
import * as path from 'path';

export class PicklistDependencyTestService {

    private static apexSpecsClassName = 'PicklistDependencySpecs';

    /*
        Apex classes the generated specs file compiles against. StubPicklistDependencySource is
        deliberately absent -- it exists only for the framework's own Apex tests, so scaffolding it
        into a user's org would deploy test scaffolding they never asked for.
    */
    private static frameworkClassNames: string[] = [
        'IPicklistDependencySource',
        'PicklistDependencySnapshot',
        'PicklistDependencyReport',
        'PicklistDependencySpec',
        'PicklistDependencyValidator',
        'SchemaPicklistDependencySource'
    ];

    static getApexSpecsClassName(): string {
        return this.apexSpecsClassName;
    }

    static getApexSpecsClassFileName(): string {
        return `${this.apexSpecsClassName}.cls`;
    }

    static getApexSpecsClassMetaFileName(): string {
        return `${this.apexSpecsClassName}.cls-meta.xml`;
    }

    static getFrameworkClassNames(): string[] {
        return [...this.frameworkClassNames];
    }

    static async collectSpecDetailsByObjectsDirectory(objectsDirectoryPath: string): Promise<IPicklistDependencySpecCollectionResult> {

        const collectionResult: IPicklistDependencySpecCollectionResult = {
            specDetails: [],
            skippedFieldWarnings: []
        };

        if ( !(fs.existsSync(objectsDirectoryPath)) ) {
            throw new Error(`Unable to find the configured Salesforce objects directory: ${objectsDirectoryPath}`);
        }

        await this.collectSpecDetailsByDirectory(objectsDirectoryPath, collectionResult);

        return collectionResult;

    }

    private static async collectSpecDetailsByDirectory(directoryPath: string, collectionResult: IPicklistDependencySpecCollectionResult): Promise<void> {

        // SORTED SO REGENERATING AGAINST AN UNCHANGED DIRECTORY PRODUCES A BYTE-IDENTICAL FILE
        const directoryEntries = fs.readdirSync(directoryPath, { withFileTypes: true })
                                    .filter(directoryEntry => directoryEntry.isDirectory())
                                    .sort((firstEntry, secondEntry) => firstEntry.name.localeCompare(secondEntry.name));

        for ( const directoryEntry of directoryEntries ) {

            const fullEntryPath = path.join(directoryPath, directoryEntry.name);

            if ( directoryEntry.name === 'fields' ) {

                const objectApiName = path.basename(directoryPath);
                await this.collectSpecDetailsByFieldsDirectory(objectApiName, fullEntryPath, collectionResult);

            } else {

                await this.collectSpecDetailsByDirectory(fullEntryPath, collectionResult);

            }

        }

    }

    static async collectSpecDetailsByFieldsDirectory(objectApiName: string,
                                                        fieldsDirectoryPath: string,
                                                        collectionResult: IPicklistDependencySpecCollectionResult): Promise<void> {

        const fieldFileNames = fs.readdirSync(fieldsDirectoryPath, { withFileTypes: true })
                                    .filter(directoryEntry => directoryEntry.isFile() && path.extname(directoryEntry.name).toLowerCase() === '.xml')
                                    .map(directoryEntry => directoryEntry.name)
                                    .sort((firstFileName, secondFileName) => firstFileName.localeCompare(secondFileName));

        const fieldApiNameToXMLFieldDetail: Record<string, XMLFieldDetail> = {};
        for ( const fieldFileName of fieldFileNames ) {

            const fieldXmlContent = fs.readFileSync(path.join(fieldsDirectoryPath, fieldFileName), 'utf8');
            const xmlFieldDetail = await XmlFileProcessor.processXmlFieldContent(fieldXmlContent, fieldFileName);
            fieldApiNameToXMLFieldDetail[xmlFieldDetail.apiName] = xmlFieldDetail;

        }

        const dependentFieldApiNames = Object.keys(fieldApiNameToXMLFieldDetail)
                                            .filter(fieldApiName => fieldApiNameToXMLFieldDetail[fieldApiName].controllingField)
                                            .sort((firstApiName, secondApiName) => firstApiName.localeCompare(secondApiName));

        for ( const dependentFieldApiName of dependentFieldApiNames ) {

            const dependentFieldDetail = fieldApiNameToXMLFieldDetail[dependentFieldApiName];
            const controllingFieldDetail = fieldApiNameToXMLFieldDetail[dependentFieldDetail.controllingField];

            const specDetail = this.buildSpecDetail(objectApiName, dependentFieldDetail, controllingFieldDetail);

            if ( specDetail === null ) {

                collectionResult.skippedFieldWarnings.push(
                    `${objectApiName}.${dependentFieldApiName} declares controlling field "${dependentFieldDetail.controllingField}" but has no "valueSettings" markup -- no expectations could be generated for it.`
                );

            } else {

                collectionResult.specDetails.push(specDetail);

            }

        }

    }

    static buildSpecDetail(objectApiName: string,
                            dependentFieldDetail: XMLFieldDetail,
                            controllingFieldDetail: XMLFieldDetail | undefined): IPicklistDependencySpecDetail | null {

        const controllingValueToPicklistOptions = RecipeService.buildControllingValueToPicklistOptions(dependentFieldDetail);

        if ( Object.keys(controllingValueToPicklistOptions).length === 0 ) {
            return null;
        }

        const expectations = this.buildExpectations(controllingValueToPicklistOptions, controllingFieldDetail);

        return {
            objectApiName: objectApiName,
            fieldApiName: dependentFieldDetail.apiName,
            controllingFieldApiName: dependentFieldDetail.controllingField,
            expectations: expectations
        };

    }

    /*
        A controlling value that unlocks nothing has no <valueSettings> entry, so it is absent from
        controllingValueToPicklistOptions entirely. Recovering it -- and emitting expectNone for it --
        requires the controlling field's own value set, which is why the controlling field's XML detail
        is read alongside the dependent field's.

        When the controlling field cannot be resolved locally (a global value set, a standard value set,
        or a controlling field defined outside the parsed directory) only the values the dependent field
        actually names are asserted. That is a narrower contract, never a wrong one.
    */
    static buildExpectations(controllingValueToPicklistOptions: Record<string, string[]>,
                                controllingFieldDetail: XMLFieldDetail | undefined): IPicklistDependencyExpectation[] {

        const expectations: IPicklistDependencyExpectation[] = [];
        const controllingValuesAlreadyExpected = new Set<string>();

        const controllingFieldPicklistValues = controllingFieldDetail?.picklistValues ?? [];
        controllingFieldPicklistValues.forEach(controllingPicklistOption => {

            const controllingValue = controllingPicklistOption.picklistOptionApiName;
            controllingValuesAlreadyExpected.add(controllingValue);

            expectations.push({
                controllingValue: controllingValue,
                dependentValues: controllingValueToPicklistOptions[controllingValue] ?? []
            });

        });

        // A valueSettings entry naming a controlling value the controlling field no longer declares is
        // still asserted -- dropping it would silently shrink the contract exactly where drift lives.
        Object.keys(controllingValueToPicklistOptions).forEach(controllingValue => {

            if ( controllingValuesAlreadyExpected.has(controllingValue) ) {
                return;
            }

            expectations.push({
                controllingValue: controllingValue,
                dependentValues: controllingValueToPicklistOptions[controllingValue]
            });

        });

        return expectations;

    }

    static escapeApexStringLiteral(value: string): string {

        // BACKSLASH FIRST -- ESCAPING IT AFTER THE QUOTE WOULD DOUBLE THE BACKSLASH THE QUOTE ESCAPE ADDS
        return value
                .replace(/\\/g, '\\\\')
                .replace(/'/g, "\\'")
                .replace(/\r/g, '\\r')
                .replace(/\n/g, '\\n')
                .replace(/\t/g, '\\t');

    }

    static generateApexSpecsClassContent(specDetails: IPicklistDependencySpecDetail[]): string {

        const specStatements = specDetails.map(specDetail => this.buildSpecStatement(specDetail));

        const specsClassBody = specStatements.length === 0
                                ? `        return new List<PicklistDependencySpec>();`
                                : `        return new List<PicklistDependencySpec>{\n${specStatements.join(',\n')}\n        };`;

        return `/**
 * GENERATED FILE -- produced by the Treecipe "Generate Picklist Dependency Tests" command.
 *
 * Every expectation below was derived from the "valueSettings" markup in your source object
 * metadata. Re-run the command to regenerate; manual edits to all() are overwritten.
 *
 * expectAtLeast asserts the source combination still exists in the org and tolerates values the
 * org has added since. Tightening a line to expectExactly is a deliberate edit by the spec owner
 * and will not survive regeneration.
 *
 * Run the check with: npm run picklist-dependency-check
 */
public class ${this.apexSpecsClassName} {

    public static List<PicklistDependencySpec> all() {

${specsClassBody}

    }
}
`;

    }

    private static buildSpecStatement(specDetail: IPicklistDependencySpecDetail): string {

        const specLines: string[] = [
            `            PicklistDependencySpec.forField('${this.escapeApexStringLiteral(specDetail.objectApiName)}', '${this.escapeApexStringLiteral(specDetail.fieldApiName)}')`,
            `                .controlledBy('${this.escapeApexStringLiteral(specDetail.controllingFieldApiName)}')`
        ];

        specDetail.expectations.forEach(expectation => {

            const escapedControllingValue = this.escapeApexStringLiteral(expectation.controllingValue);

            if ( expectation.dependentValues.length === 0 ) {

                specLines.push(`                .expectNone('${escapedControllingValue}')`);

            } else {

                const escapedDependentValues = expectation.dependentValues
                                                    .map(dependentValue => `'${this.escapeApexStringLiteral(dependentValue)}'`)
                                                    .join(', ');
                specLines.push(`                .expectAtLeast('${escapedControllingValue}', new List<String>{ ${escapedDependentValues} })`);

            }

        });

        return specLines.join('\n');

    }

    static getApexClassMetaContent(sourceApiVersion: string): string {

        return `<?xml version="1.0" encoding="UTF-8"?>
<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>${sourceApiVersion}</apiVersion>
    <status>Active</status>
</ApexClass>
`;

    }

    /*
        The published .vsix excludes force-app/**, so the framework classes the generated file compiles
        against are shipped as extension assets under resources/apex and copied into the workspace on
        demand. Walking up from __dirname rather than hard-coding a depth keeps this working from both
        src (jest) and out (packaged extension).
    */
    static getFrameworkAssetsDirectoryPath(): string {

        const maximumDirectoryLevelsToWalkUp = 6;
        let candidateDirectoryPath = __dirname;

        for ( let directoryLevel = 0; directoryLevel <= maximumDirectoryLevelsToWalkUp; directoryLevel++ ) {

            const candidateAssetsPath = path.join(candidateDirectoryPath, 'resources', 'apex');
            if ( fs.existsSync(candidateAssetsPath) ) {
                return candidateAssetsPath;
            }

            const parentDirectoryPath = path.dirname(candidateDirectoryPath);
            if ( parentDirectoryPath === candidateDirectoryPath ) {
                break;
            }
            candidateDirectoryPath = parentDirectoryPath;

        }

        throw new Error('Unable to locate the bundled Apex picklist dependency framework assets (expected a "resources/apex" directory within the extension).');

    }

    /*
        Existing files are left untouched: a user who has tightened or customised a framework class
        should not have that overwritten as a side effect of regenerating their specs.
    */
    static scaffoldFrameworkClasses(classesDirectoryPath: string): string[] {

        const frameworkAssetsDirectoryPath = this.getFrameworkAssetsDirectoryPath();
        const scaffoldedFileNames: string[] = [];

        this.frameworkClassNames.forEach(frameworkClassName => {

            [`${frameworkClassName}.cls`, `${frameworkClassName}.cls-meta.xml`].forEach(frameworkFileName => {

                const destinationFilePath = path.join(classesDirectoryPath, frameworkFileName);
                if ( fs.existsSync(destinationFilePath) ) {
                    return;
                }

                const sourceFilePath = path.join(frameworkAssetsDirectoryPath, frameworkFileName);
                if ( !(fs.existsSync(sourceFilePath)) ) {
                    return;
                }

                fs.copyFileSync(sourceFilePath, destinationFilePath);
                scaffoldedFileNames.push(frameworkFileName);

            });

        });

        return scaffoldedFileNames;

    }

}
