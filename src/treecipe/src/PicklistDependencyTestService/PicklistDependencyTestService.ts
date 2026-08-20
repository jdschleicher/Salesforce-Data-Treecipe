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

export interface IFrameworkScaffoldResult {
    scaffoldedClassNames: string[];
    // FRAMEWORK CLASSES NEITHER ALREADY IN THE WORKSPACE NOR AVAILABLE TO COPY FROM THE EXTENSION
    unavailableClassNames: string[];
}

export class PicklistDependencyTestService {

    /*
        Prefixed so the class this command writes into a user's package directory is obviously not
        theirs, and cannot collide with an existing SFTreecipePicklistDependencySpecs of their own. The test
        class name derives from it, so both move together.
    */
    private static specsClassName = 'SFTreecipePicklistDependencySpecs';

    /*
        The runtime classes the generated SFTreecipePicklistDependencySpecs.cls depends on. These ship in the
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

        for ( const [entryName, entryType] of directoryEntries ) {

            // A BITMASK CHECK SO A SYMLINKED OBJECT DIRECTORY ("Directory | SymbolicLink") IS STILL WALKED
            const isDirectoryEntry = ( (entryType & vscode.FileType.Directory) !== 0 );
            if ( !isDirectoryEntry ) {
                continue;
            }

            const childDirectoryUri = vscode.Uri.joinPath(objectsDirectoryUri, entryName);

            /*
                Results are concatenated rather than spread into push -- a spread passes every
                element as a call argument, which throws once an accumulated subtree exceeds the
                engine's argument limit.
            */
            if ( entryName === 'fields' ) {

                const objectApiName = path.basename(objectsDirectoryUri.fsPath);
                const fieldDetails = await this.getFieldDetailsByFieldsDirectory(childDirectoryUri);
                const objectResult = this.buildSpecDetailsByObjectFieldDetails(objectApiName, fieldDetails);

                collectedResult.specDetails = collectedResult.specDetails.concat(objectResult.specDetails);
                collectedResult.skippedFieldWarnings = collectedResult.skippedFieldWarnings.concat(objectResult.skippedFieldWarnings);

            } else {

                const nestedResult = await this.collectSpecDetailsByObjectsDirectory(childDirectoryUri, visitedDirectoryPaths);
                collectedResult.specDetails = collectedResult.specDetails.concat(nestedResult.specDetails);
                collectedResult.skippedFieldWarnings = collectedResult.skippedFieldWarnings.concat(nestedResult.skippedFieldWarnings);

            }

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

    /*
        One Apex method name per (object, field) scenario.

        Apex identifiers may not contain two consecutive underscores, so runs are collapsed exactly as
        they are for the generated test methods -- every custom api name ends in "__c". The "specFor"
        prefix keeps the identifier valid whatever the api name starts with, including a digit, and
        reads as a factory at the call site inside all().
    */
    static buildSpecMethodName(objectApiName: string, fieldApiName: string): string {

        const collapse = (apiName: string) => apiName.replace(/_{2,}/g, '_');

        return `specFor_${collapse(objectApiName)}_${collapse(fieldApiName)}`;

    }

    /*
        Collapsing can map two distinct scenarios onto one identifier, and two Apex methods with the
        same name will not compile, so later collisions take a numeric suffix.
    */
    static buildSpecMethodNamesBySpecDetail(specDetails: IPicklistDependencySpecDetail[]): string[] {

        let usedMethodNames = new Set<string>();

        return specDetails.map(specDetail => {

            const baseMethodName = this.buildSpecMethodName(specDetail.objectApiName, specDetail.fieldApiName);

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

    static buildSpecsApexClassBody(specDetails: IPicklistDependencySpecDetail[]): string {

        const specMethodNames = this.buildSpecMethodNamesBySpecDetail(specDetails);

        /*
            One method per scenario rather than one long list literal. Each dependency becomes
            individually addressable -- readable on its own, referenced by name from a hand written
            test, and tightened to expectExactly without picking through a single expression.
        */
        const specMethods = specDetails.map((specDetail, specDetailIndex) => {

            const specStatement = this.buildSpecStatement(specDetail)
                .split('\n')
                .map(statementLine => statementLine.replace(/^ {8}/, '        '))
                .join('\n');

            return `    // ${specDetail.objectApiName}.${specDetail.fieldApiName} controlled by ${specDetail.controllingFieldApiName}
    public static PicklistDependencySpec ${specMethodNames[specDetailIndex]}() {
        return ${specStatement.trim()};
    }`;

        }).join('\n\n');

        const specsListMarkup = ( specDetails.length === 0 )
            ? `        return new List<PicklistDependencySpec>();`
            : `        return new List<PicklistDependencySpec>{\n${specMethodNames.map(specMethodName => `            ${specMethodName}()`).join(',\n')}\n        };`;

        const specMethodsBlock = ( specDetails.length === 0 ) ? '' : `\n${specMethods}\n`;

        return `/**
 * GENERATED FILE -- regenerating overwrites it.
 *
 * Created by the Salesforce Data Treecipe "Generate Picklist Dependency Tests" command from
 * the picklist dependency configuration in local source metadata.
 *
 * Each dependent picklist gets its own method, and all() returns the collection of them. A single
 * scenario can therefore be read, referenced from a hand written test, or tightened on its own.
 *
 * Every value is emitted as expectAtLeast: the combinations present in source metadata must
 * still exist in the org, and values the org has added since are tolerated. Tightening a line
 * to expectExactly is a deliberate edit by the spec owner and will be lost on regeneration.
 */
public class ${this.specsClassName} {
${specMethodsBlock}
    public static List<PicklistDependencySpec> all() {
${specsListMarkup}
    }
}
`;

    }

    static buildSpecStatement(specDetail: IPicklistDependencySpecDetail): string {

        /*
            Api names are validated before a spec is built, so escaping them is a no-op for every
            name that reaches here. It is applied anyway so that emission stays safe on its own
            terms rather than depending on a caller having validated first.
        */
        const objectApiName = this.escapeApexStringLiteral(specDetail.objectApiName);
        const fieldApiName = this.escapeApexStringLiteral(specDetail.fieldApiName);
        const controllingFieldApiName = this.escapeApexStringLiteral(specDetail.controllingFieldApiName);

        let specStatement = `            PicklistDependencySpec.forField('${objectApiName}', '${fieldApiName}')`;
        specStatement += `\n                .controlledBy('${controllingFieldApiName}')`;

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

        The generated SFTreecipePicklistDependencySpecs.cls and SFTreecipePicklistDependencySpecsTest.cls deliberately do
        NOT live here: those are the user's contract, expected to be read and sometimes hand-tightened,
        so they stay at the classes root where a developer would look for them.
    */
    private static frameworkDirectoryName = 'PicklistDependencyFramework';

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
        SchemaPicklistDependencySource is what binds the limit -- and a failure names the object in
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
 * SchemaPicklistDependencySource return the same result they would outside a test.
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
                + 'Re-run the "Generate Picklist Dependency Tests" command.'
        );
    }

    private static void assertNoPicklistDependencyFailuresForObject(String objectApiName) {

        List<PicklistDependencySpec> specsForObject = new List<PicklistDependencySpec>();
        for (PicklistDependencySpec spec : ${this.specsClassName}.all()) {
            if (spec.objectApiName == objectApiName) {
                specsForObject.add(spec);
            }
        }

        Assert.isFalse(
            specsForObject.isEmpty(),
            'No specs found for "' + objectApiName + '". This class is generated from the spec '
                + 'registry, so the two are out of sync -- regenerate them together.'
        );

        PicklistDependencyValidator validator =
            new PicklistDependencyValidator(new SchemaPicklistDependencySource());

        List<PicklistDependencyValidator.Failure> failures = validator.validate(specsForObject);

        Assert.isTrue(failures.isEmpty(), buildFailureMessage(objectApiName, failures));

    }

    private static String buildFailureMessage(String objectApiName, List<PicklistDependencyValidator.Failure> failures) {

        List<String> failureLines = new List<String>();
        failureLines.add(
            'Picklist dependency drift on ' + objectApiName + ' -- '
                + failures.size() + ' combination(s) no longer match local source metadata:'
        );

        for (PicklistDependencyValidator.Failure failure : failures) {
            failureLines.add('  - ' + failure.toLine());
        }

        return String.join(failureLines, '\\n');

    }

}
`;

    }

    static writeSpecsClassFiles(classesDirectoryPath: string, apexClassBody: string, apiVersion: string): string {

        fs.mkdirSync(classesDirectoryPath, { recursive: true });

        const specsClassFilePath = this.getSpecsClassFilePath(classesDirectoryPath);
        fs.writeFileSync(specsClassFilePath, apexClassBody);
        fs.writeFileSync(`${specsClassFilePath}-meta.xml`, this.buildApexClassMetaXml(apiVersion));

        return specsClassFilePath;

    }

    static writeSpecsTestClassFiles(classesDirectoryPath: string, apexTestClassBody: string, apiVersion: string): string {

        fs.mkdirSync(classesDirectoryPath, { recursive: true });

        const specsTestClassFilePath = this.getSpecsTestClassFilePath(classesDirectoryPath);
        fs.writeFileSync(specsTestClassFilePath, apexTestClassBody);
        fs.writeFileSync(`${specsTestClassFilePath}-meta.xml`, this.buildApexClassMetaXml(apiVersion));

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

        const shippedFrameworkClassesPath = path.join(extensionPath, 'force-app', 'main', 'default', 'classes', this.frameworkDirectoryName);

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
