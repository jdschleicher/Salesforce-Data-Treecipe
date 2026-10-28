import * as fs from 'fs';
import * as path from 'path';

import * as matchers from 'jest-extended';
expect.extend(matchers);

/*
    Org work goes through SalesforceOrgService.getConnection (@salesforce/core), not the sf CLI
    (#496). Every place that still starts an sf process is listed here by file and method, and #496's
    slices remove entries as they replace them. A NEW call site fails this suite: it needs a reason in
    its issue, and its entry added here in the same change. A removed one fails too, so the list is
    always exactly what the code does.
*/
const REMAINING_SALESFORCE_CLI_CALL_SITES = [
    'PicklistDependencyCheckService/PicklistDependencyCheckService.ts#deployPicklistDependencyClasses',
    'PicklistDependencyCheckService/PicklistDependencyCheckService.ts#deploySourcePaths',
    'PicklistDependencyCheckService/PicklistDependencyCheckService.ts#runPicklistDependencyTests',
    'RecipeCockpitService/RecipeCockpitService.ts#performAdapterChildPrepare',
    'RecipeCockpitService/RecipeCockpitService.ts#performAdapterMetadataRetrieve',
    'RecipeCockpitService/RecipeCockpitService.ts#performMetadataDeploy',
    'RecipeCockpitService/RecipeCockpitService.ts#performMetadataRetrieve',
    'RecipeCockpitService/RecipeCockpitService.ts#performMetadataRetrieve',
    'RecipeCockpitService/RecipeCockpitService.ts#performPermissionSetAssign',
    'RecipeCockpitService/RecipeCockpitService.ts#runCancellableCli',
    'SalesforceOrgService/SalesforceOrgService.ts#runOrgDisplayCommand',
    'SalesforceOrgService/SalesforceOrgService.ts#runOrgListCommand',
    'ScratchOrgService/ScratchOrgService.ts#resolveOrgOpenUrl',
    'ScratchOrgService/ScratchOrgService.ts#runScratchOrgSetup'
];

// runSalesforceCli starts the process; snowfakery is a Python program, not the Salesforce CLI
const CHILD_PROCESS_FILES = [
    'FakerRecipeProcessor/SnowfakeryRecipeProcessor/SnowfakeryRecipeProcessor.ts',
    'PicklistDependencyCheckService/PicklistDependencyCheckService.ts'
];

const SERVICES_DIRECTORY_PATH = path.resolve(__dirname, '../..');

// ALL OF src/, extension.ts INCLUDED; PATHS ARE NAMED FROM THE SERVICES FOLDER
const SOURCE_ROOT_PATH = path.resolve(SERVICES_DIRECTORY_PATH, '../..');

const STATIC_METHOD_PATTERN = /^\s*(?:private |public |protected )?static (?:async )?(\w+)\s*[(<]/;

// A CALL, SPACED OR NOT, OR A REFERENCE HANDED ON THROUGH bind/call/apply; A COMMENT NAMING THE METHOD IS NEITHER
const SALESFORCE_CLI_CALL_PATTERN = /\b(?:runSalesforceCli|runCancellableCli)\s*(?:\(|\.\s*(?:bind|call|apply)\b)/g;

function listSourceFilePaths(directoryPath: string): string[] {

    return fs.readdirSync(directoryPath, { withFileTypes: true }).flatMap(entry => {

        const entryPath = path.join(directoryPath, entry.name);

        if ( entry.isDirectory() ) {
            return entry.name === 'tests' ? [] : listSourceFilePaths(entryPath);
        }

        return entry.name.endsWith('.ts') ? [entryPath] : [];

    });

}

function toServiceRelativePath(filePath: string): string {
    return path.relative(SERVICES_DIRECTORY_PATH, filePath).split(path.sep).join('/');
}

function readSourceFiles(): { relativePath: string; sourceText: string }[] {

    return listSourceFilePaths(SOURCE_ROOT_PATH).map(filePath => ({
        relativePath: toServiceRelativePath(filePath),
        sourceText: fs.readFileSync(filePath, 'utf8')
    }));

}

function findSalesforceCliCallSites(relativePath: string, sourceText: string): string[] {

    const lines = sourceText.split(/\r?\n/);

    return lines.flatMap((line, lineIndex) => {

        // A METHOD'S OWN DECLARATION IS NOT A CALL
        if ( STATIC_METHOD_PATTERN.test(line) ) {
            return [];
        }

        const callCount = (line.match(SALESFORCE_CLI_CALL_PATTERN) ?? []).length;

        if ( callCount === 0 ) {
            return [];
        }

        let enclosingMethodName = '<outside a static method>';

        for ( let searchIndex = lineIndex; searchIndex >= 0; searchIndex-- ) {
            const methodMatch = lines[searchIndex].match(STATIC_METHOD_PATTERN);
            if ( methodMatch ) {
                enclosingMethodName = methodMatch[1];
                break;
            }
        }

        return Array.from({ length: callCount }, () => `${relativePath}#${enclosingMethodName}`);

    });

}

describe('shouldStartTheSalesforceCliOnlyWhereEpic496HasNotReplacedIt', () => {

    const sourceFiles = readSourceFiles();

    it('shouldReadTheServiceSourcesItGuards', () => {

        expect(sourceFiles.map(sourceFile => sourceFile.relativePath)).toIncludeAllMembers([
            'PicklistDependencyCheckService/PicklistDependencyCheckService.ts',
            'SalesforceOrgService/SalesforceOrgService.ts',
            '../../extension.ts'
        ]);

    });

    it('shouldListEverySalesforceCliCallSiteAndNoOther', () => {

        const callSites = sourceFiles
            .flatMap(sourceFile => findSalesforceCliCallSites(sourceFile.relativePath, sourceFile.sourceText))
            .sort();

        expect(callSites).toEqual([...REMAINING_SALESFORCE_CLI_CALL_SITES].sort());

    });

    it('shouldStartProcessesOnlyThroughTheGuardedFiles', () => {

        const childProcessFiles = sourceFiles
            .filter(sourceFile => /from ['"](?:node:)?child_process['"]|require\(['"](?:node:)?child_process['"]\)/.test(sourceFile.sourceText))
            .map(sourceFile => sourceFile.relativePath)
            .sort();

        expect(childProcessFiles).toEqual([...CHILD_PROCESS_FILES].sort());

    });

    /*
        jsforce is a devDependency: the packaged-paths check fails a build whose shipped code requires
        it. The connection @salesforce/core hands back is the jsforce API that ships.
    */
    it('shouldNeverImportJsforceDirectly', () => {

        const jsforceImporters = sourceFiles
            .filter(sourceFile => /from\s*['"](?:@jsforce\/)?jsforce[^'"]*['"]|(?:require|import)\s*\(\s*['"](?:@jsforce\/)?jsforce[^'"]*['"]\s*\)/.test(sourceFile.sourceText))
            .map(sourceFile => sourceFile.relativePath);

        expect(jsforceImporters).toBeEmpty();

    });

});
