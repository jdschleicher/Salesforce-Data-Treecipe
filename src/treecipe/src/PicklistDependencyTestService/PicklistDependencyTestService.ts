import { RecipeService } from '../RecipeService/RecipeService';
import { XmlFileProcessor } from '../XMLProcessingService/XmlFileProcessor';
import { XMLFieldDetail } from '../XMLProcessingService/XMLFieldDetail';

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export interface IPicklistDependencyExpectation {
    controllingValue: string;
    // AN EMPTY LIST INDICATES THE CONTROLLING VALUE UNLOCKS NOTHING AND SO EMITS "expectNone"
    dependentValues: string[];
}

export interface IPicklistDependencySpecDetail {
    objectApiName: string;
    fieldApiName: string;
    controllingFieldApiName: string;
    expectations: IPicklistDependencyExpectation[];
}

export interface IPicklistDependencyCollectionResult {
    specDetails: IPicklistDependencySpecDetail[];
    skippedFieldWarnings: string[];
}

export class PicklistDependencyTestService {

    private static specsClassName = 'PicklistDependencySpecs';

    /*
        The runtime classes the generated PicklistDependencySpecs.cls depends on. These ship in the
        vsix via negation entries in .vscodeignore and are scaffolded into the user's package
        directory when missing, otherwise the generated file would not compile in their org.
    */
    private static frameworkClassNames: string[] = [
        'IPicklistDependencySource',
        'PicklistDependencySpec',
        'PicklistDependencySnapshot',
        'PicklistDependencyReport',
        'PicklistDependencyValidator',
        'SchemaPicklistDependencySource'
    ];

    static getSpecsClassName(): string {
        return this.specsClassName;
    }

    static getFrameworkClassNames(): string[] {
        return [...this.frameworkClassNames];
    }

    static async collectSpecDetailsByObjectsDirectory(objectsDirectoryUri: vscode.Uri): Promise<IPicklistDependencyCollectionResult> {

        let collectedResult: IPicklistDependencyCollectionResult = {
            specDetails: [],
            skippedFieldWarnings: []
        };

        const directoryEntries = await vscode.workspace.fs.readDirectory(objectsDirectoryUri);
        if ( !directoryEntries || directoryEntries.length === 0 ) {
            return collectedResult;
        }

        for ( const [entryName, entryType] of directoryEntries ) {

            if ( entryType !== vscode.FileType.Directory ) {
                continue;
            }

            const childDirectoryUri = vscode.Uri.joinPath(objectsDirectoryUri, entryName);

            if ( entryName === 'fields' ) {

                const objectApiName = path.basename(objectsDirectoryUri.fsPath);
                const fieldDetails = await this.getFieldDetailsByFieldsDirectory(childDirectoryUri);
                const objectResult = this.buildSpecDetailsByObjectFieldDetails(objectApiName, fieldDetails);

                collectedResult.specDetails.push(...objectResult.specDetails);
                collectedResult.skippedFieldWarnings.push(...objectResult.skippedFieldWarnings);

            } else {

                const nestedResult = await this.collectSpecDetailsByObjectsDirectory(childDirectoryUri);
                collectedResult.specDetails.push(...nestedResult.specDetails);
                collectedResult.skippedFieldWarnings.push(...nestedResult.skippedFieldWarnings);

            }

        }

        return collectedResult;

    }

    static async getFieldDetailsByFieldsDirectory(fieldsDirectoryUri: vscode.Uri): Promise<XMLFieldDetail[]> {

        const fieldDirectoryEntries = await vscode.workspace.fs.readDirectory(fieldsDirectoryUri);

        let fieldDetails: XMLFieldDetail[] = [];
        for ( const [fileName, directoryItemTypeEnum] of fieldDirectoryEntries ) {

            if ( !XmlFileProcessor.isXMLFileType(fileName, directoryItemTypeEnum) ) {
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

            const controllingValueToPicklistOptions = RecipeService.buildControllingValueToPicklistOptions(fieldDetail);

            if ( Object.keys(controllingValueToPicklistOptions).length === 0 ) {

                skippedFieldWarnings.push(`No "valueSettings" markup found for dependent picklist "${objectApiName}.${fieldDetail.apiName}" controlled by "${fieldDetail.controllingField}" -- no spec was generated for this field.`);
                return;

            }

            const controllingFieldDetail = fieldDetailByApiName[fieldDetail.controllingField];
            const expectations = this.buildExpectations(controllingValueToPicklistOptions, controllingFieldDetail);

            specDetails.push({
                objectApiName: objectApiName,
                fieldApiName: fieldDetail.apiName,
                controllingFieldApiName: fieldDetail.controllingField,
                expectations: expectations
            });

        });

        return { specDetails, skippedFieldWarnings };

    }

    /*
        Controlling values that unlock dependent values come from the dependent field's own
        <valueSettings>. Controlling values that unlock nothing are only discoverable by diffing
        against the controlling field's own picklist values, which live in its sibling field file.
    */
    static buildExpectations(controllingValueToPicklistOptions: Record<string, string[]>,
                                controllingFieldDetail: XMLFieldDetail | undefined): IPicklistDependencyExpectation[] {

        let expectations: IPicklistDependencyExpectation[] = Object.entries(controllingValueToPicklistOptions).map(
            ([controllingValue, dependentValues]) => ({ controllingValue, dependentValues })
        );

        if ( !controllingFieldDetail || !controllingFieldDetail.picklistValues ) {
            return expectations;
        }

        controllingFieldDetail.picklistValues.forEach(controllingPicklistOption => {

            const controllingValue = controllingPicklistOption.picklistOptionApiName;
            if ( controllingValue in controllingValueToPicklistOptions ) {
                return;
            }

            expectations.push({ controllingValue: controllingValue, dependentValues: [] });

        });

        return expectations;

    }

    static escapeApexStringLiteral(value: string): string {

        return value
            .replace(/\\/g, '\\\\')
            .replace(/'/g, `\\'`)
            .replace(/\r\n|\r|\n/g, '\\n');

    }

    static buildSpecsApexClassBody(specDetails: IPicklistDependencySpecDetail[]): string {

        const specStatements = specDetails.map(specDetail => this.buildSpecStatement(specDetail)).join(',\n');

        const specsListMarkup = ( specDetails.length === 0 )
            ? `        return new List<PicklistDependencySpec>();`
            : `        return new List<PicklistDependencySpec>{\n${specStatements}\n        };`;

        return `/**
 * GENERATED FILE -- do not add specs by hand above the generated block.
 *
 * Created by the Salesforce Data Treecipe "Generate Picklist Dependency Tests" command from
 * the picklist dependency configuration in local source metadata. Regenerating overwrites
 * this file.
 *
 * Every line is emitted as expectAtLeast: the combinations present in source metadata must
 * still exist in the org, and values the org has added since are tolerated. Tightening a line
 * to expectExactly is a deliberate edit by the spec owner and will be lost on regeneration.
 */
public class ${this.specsClassName} {

    public static List<PicklistDependencySpec> all() {
${specsListMarkup}
    }
}
`;

    }

    static buildSpecStatement(specDetail: IPicklistDependencySpecDetail): string {

        // API NAMES ARE EMITTED VERBATIM -- ONLY PICKLIST VALUES ARE USER-AUTHORED FREE TEXT NEEDING ESCAPING
        let specStatement = `            PicklistDependencySpec.forField('${specDetail.objectApiName}', '${specDetail.fieldApiName}')`;
        specStatement += `\n                .controlledBy('${specDetail.controllingFieldApiName}')`;

        specDetail.expectations.forEach(expectation => {

            const escapedControllingValue = this.escapeApexStringLiteral(expectation.controllingValue);

            if ( expectation.dependentValues.length === 0 ) {

                specStatement += `\n                .expectNone('${escapedControllingValue}')`;

            } else {

                const joinedDependentValues = expectation.dependentValues
                    .map(dependentValue => `'${this.escapeApexStringLiteral(dependentValue)}'`)
                    .join(', ');
                specStatement += `\n                .expectAtLeast('${escapedControllingValue}', new List<String>{ ${joinedDependentValues} })`;

            }

        });

        return specStatement;

    }

    static resolveDefaultPackageDirectoryPath(workspaceRoot: string): string {

        const sfdxProjectFilePath = path.join(workspaceRoot, 'sfdx-project.json');

        if ( !fs.existsSync(sfdxProjectFilePath) ) {
            throw new Error(`No "sfdx-project.json" found at "${sfdxProjectFilePath}". The Generate Picklist Dependency Tests command writes Apex into a Salesforce DX package directory -- open a DX project, or add an "sfdx-project.json" with a default packageDirectories entry, and run the command again.`);
        }

        const sfdxProjectJson = JSON.parse(fs.readFileSync(sfdxProjectFilePath, 'utf-8'));
        const packageDirectories = sfdxProjectJson?.packageDirectories;

        if ( !Array.isArray(packageDirectories) || packageDirectories.length === 0 ) {
            throw new Error(`No "packageDirectories" entries found in "${sfdxProjectFilePath}". Add a package directory marked as the default and run the command again.`);
        }

        const defaultPackageDirectory = packageDirectories.find(packageDirectory => packageDirectory?.default === true) ?? packageDirectories[0];

        if ( !defaultPackageDirectory?.path ) {
            throw new Error(`The resolved package directory in "${sfdxProjectFilePath}" has no "path" value. Add a "path" to the default packageDirectories entry and run the command again.`);
        }

        return path.join(workspaceRoot, defaultPackageDirectory.path);

    }

    static getSourceApiVersion(workspaceRoot: string): string {

        const sfdxProjectFilePath = path.join(workspaceRoot, 'sfdx-project.json');
        const defaultApiVersion = '64.0';

        if ( !fs.existsSync(sfdxProjectFilePath) ) {
            return defaultApiVersion;
        }

        const sfdxProjectJson = JSON.parse(fs.readFileSync(sfdxProjectFilePath, 'utf-8'));
        return sfdxProjectJson?.sourceApiVersion ?? defaultApiVersion;

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

    static getSpecsClassFilePath(classesDirectoryPath: string): string {
        return path.join(classesDirectoryPath, `${this.specsClassName}.cls`);
    }

    static writeSpecsClassFiles(classesDirectoryPath: string, apexClassBody: string, apiVersion: string): string {

        fs.mkdirSync(classesDirectoryPath, { recursive: true });

        const specsClassFilePath = this.getSpecsClassFilePath(classesDirectoryPath);
        fs.writeFileSync(specsClassFilePath, apexClassBody);
        fs.writeFileSync(`${specsClassFilePath}-meta.xml`, this.buildApexClassMetaXml(apiVersion));

        return specsClassFilePath;

    }

    /*
        Copies only the framework classes the workspace is missing so a user who has already
        deployed or customized them keeps their copy.
    */
    static scaffoldMissingFrameworkClasses(extensionPath: string, classesDirectoryPath: string): string[] {

        const shippedFrameworkClassesPath = path.join(extensionPath, 'force-app', 'main', 'default', 'classes');

        if ( !fs.existsSync(shippedFrameworkClassesPath) ) {
            return [];
        }

        fs.mkdirSync(classesDirectoryPath, { recursive: true });

        let scaffoldedClassNames: string[] = [];
        this.frameworkClassNames.forEach(frameworkClassName => {

            const targetClassFilePath = path.join(classesDirectoryPath, `${frameworkClassName}.cls`);
            if ( fs.existsSync(targetClassFilePath) ) {
                return;
            }

            const sourceClassFilePath = path.join(shippedFrameworkClassesPath, `${frameworkClassName}.cls`);
            if ( !fs.existsSync(sourceClassFilePath) ) {
                return;
            }

            fs.copyFileSync(sourceClassFilePath, targetClassFilePath);
            fs.copyFileSync(`${sourceClassFilePath}-meta.xml`, `${targetClassFilePath}-meta.xml`);
            scaffoldedClassNames.push(frameworkClassName);

        });

        return scaffoldedClassNames;

    }

}
