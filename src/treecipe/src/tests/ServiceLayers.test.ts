import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as ts from 'typescript';

/*
    The one rule (#570): a folder under src/treecipe/src imports only its own layer or a lower one,
    and never in a cycle. CLAUDE.md states the rule and points here; this table is the only copy.
*/
export const SERVICE_LAYERS: Readonly<Record<string, number>> = {

    // 0 -- LEAF: IMPORTS NO OTHER SERVICE
    CockpitKit: 0,
    DatasetInsertAttemptService: 0,
    DatasetSourceService: 0,
    InsertFailureTriage: 0,
    RecipeFieldConstraint: 0,
    RecipeWriter: 0,
    RecipeYamlScalar: 0,
    RunArtifacts: 0,
    RunFakerConfirmation: 0,
    SalesforceApiName: 0,
    SfdxProjectService: 0,
    ValueSetService: 0,

    // 1 -- PLATFORM
    ConfigurationService: 1,
    ErrorHandlingService: 1,
    SalesforceCli: 1,
    SalesforceOrgService: 1,
    VSCodeWorkspace: 1,

    // 2 -- METADATA MODEL
    GlobalValueSetSingleton: 2,
    ObjectInfoWrapper: 2,
    RecordTypeSelectionService: 2,
    RecordTypeService: 2,
    ValidationRuleAnalyzerService: 2,
    XMLProcessingService: 2,

    // 3 -- GENERATION AND INSERT
    CollectionsApiService: 3,
    DirectoryProcessingService: 3,
    FakerRecipeProcessor: 3,
    MermaidService: 3,
    'RecipeFakerService.ts': 3,
    RecipeService: 3,
    RelationshipService: 3,
    ScratchOrgService: 3,
    SOQLTemplateService: 3,

    // 4 -- FEATURES
    PicklistDependencyCheckService: 4,
    PicklistDependencyExplorerService: 4,
    PicklistDependencyManifestService: 4,
    PicklistDependencyMetadataWriterService: 4,
    PicklistDependencyTestService: 4,
    RecipeCockpitService: 4,
    TreecipeSideBarService: 4,

    // 5 -- COMMANDS
    ExtensionCommandService: 5,
    'src/extension.ts': 5

};

/*
    Every import the rule refuses today, as "importing file → imported file", each with the slice of
    #570 that removes it. The list only shrinks: a new violation fails, and so does an entry that no
    longer happens or is no longer a violation. Paths are named from src/treecipe/src.

    Both remaining entries are same-layer imports that close a cycle no upward import explains; one edge per
    cycle is listed, and #575 removes the cycle.
*/
export const KNOWN_LAYER_VIOLATIONS: readonly string[] = [

    // #575: THE METADATA MODEL CYCLE AND THE CONFIGURATION / WORKSPACE PAIR
    'ObjectInfoWrapper/ObjectInfo.ts → RecordTypeService/RecordTypesWrapper.ts', // #575
    'VSCodeWorkspace/VSCodeWorkspaceService.ts → ConfigurationService/ConfigurationService.ts' // #575

];

export interface IServiceImport {
    importingFile: string;
    importedFile: string;
}

const SERVICES_DIRECTORY_PATH = path.resolve(__dirname, '..');
const EXTENSION_ENTRY_POINT_PATH = path.resolve(SERVICES_DIRECTORY_PATH, '../../extension.ts');

// tests/ AND mocks/ ARE NOT SHIPPED CODE, SO A TEST MAY IMPORT ANY LAYER
const EXEMPT_DIRECTORY_NAMES = new Set(['tests', 'mocks']);

function listServiceSourceFilePaths(directoryPath: string): string[] {

    return fs.readdirSync(directoryPath, { withFileTypes: true }).flatMap(entry => {

        const entryPath = path.join(directoryPath, entry.name);

        if ( entry.isDirectory() ) {
            return EXEMPT_DIRECTORY_NAMES.has(entry.name) ? [] : listServiceSourceFilePaths(entryPath);
        }

        return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [entryPath] : [];

    });

}

function toServicePath(filePath: string): string {

    return filePath === EXTENSION_ENTRY_POINT_PATH
        ? 'src/extension.ts'
        : path.relative(SERVICES_DIRECTORY_PATH, filePath).split(path.sep).join('/');

}

export function toServiceFolder(servicePath: string): string {
    return servicePath === 'src/extension.ts' ? servicePath : servicePath.split('/')[0];
}

function resolveImportedFilePath(importingFilePath: string, importSpecifier: string): string {

    const resolvedPath = path.resolve(path.dirname(importingFilePath), importSpecifier);
    const candidatePaths = [resolvedPath, `${resolvedPath}.ts`, path.join(resolvedPath, 'index.ts')];
    return candidatePaths.find(candidatePath => fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) ?? resolvedPath;

}

// EVERY RELATIVE IMPORT, RE-EXPORT, require AND import() -- A TYPE-ONLY import type COUNTS, SINCE IT STILL TIES THE FOLDERS TOGETHER
export function readServiceImports(sourceFilePaths: string[]): IServiceImport[] {

    return sourceFilePaths.flatMap(sourceFilePath => {

        const sourceText = fs.readFileSync(sourceFilePath, 'utf8');
        const importedFiles = ts.preProcessFile(sourceText, true, true).importedFiles;

        return importedFiles
            .filter(importedFile => importedFile.fileName.startsWith('.'))
            .map(importedFile => ({
                importingFile: toServicePath(sourceFilePath),
                importedFile: toServicePath(resolveImportedFilePath(sourceFilePath, importedFile.fileName))
            }));

    });

}

export const formatServiceImport = (serviceImport: IServiceImport): string => `${serviceImport.importingFile} → ${serviceImport.importedFile}`;

export function findUpwardImports(serviceImports: IServiceImport[], serviceLayers: Readonly<Record<string, number>>): IServiceImport[] {

    return serviceImports.filter(serviceImport => {
        const importingLayer = serviceLayers[toServiceFolder(serviceImport.importingFile)];
        const importedLayer = serviceLayers[toServiceFolder(serviceImport.importedFile)];
        return importingLayer !== undefined && importedLayer !== undefined && importedLayer > importingLayer;
    });

}

export function describeUpwardImport(serviceImport: IServiceImport, serviceLayers: Readonly<Record<string, number>>): string {

    const importingFolder = toServiceFolder(serviceImport.importingFile);
    const importedFolder = toServiceFolder(serviceImport.importedFile);
    return `${serviceImport.importingFile} (${importingFolder}, layer ${serviceLayers[importingFolder]}) imports `
        + `${serviceImport.importedFile} (${importedFolder}, layer ${serviceLayers[importedFolder]}), a higher layer. `
        + 'Move the shared code down to a layer both can import, or ask for a layer change in SERVICE_LAYERS.';

}

/*
    Folder-level cycles (Tarjan's strongly connected components), with every listed violation taken
    out first: a cycle a listed edge explains is already on its way out.
*/
export function findFolderCycles(serviceImports: IServiceImport[]): string[][] {

    const importedFoldersByFolder = new Map<string, Set<string>>();
    serviceImports.forEach(serviceImport => {
        const importingFolder = toServiceFolder(serviceImport.importingFile);
        const importedFolder = toServiceFolder(serviceImport.importedFile);
        if ( importingFolder !== importedFolder ) {
            if ( !importedFoldersByFolder.has(importingFolder) ) {
                importedFoldersByFolder.set(importingFolder, new Set());
            }
            importedFoldersByFolder.get(importingFolder).add(importedFolder);
        }
    });

    const visitOrderByFolder = new Map<string, number>();
    const lowestReachableByFolder = new Map<string, number>();
    const folderStack: string[] = [];
    const foldersOnStack = new Set<string>();
    const folderCycles: string[][] = [];

    const visitFolder = (folder: string) => {

        visitOrderByFolder.set(folder, visitOrderByFolder.size);
        lowestReachableByFolder.set(folder, visitOrderByFolder.get(folder));
        folderStack.push(folder);
        foldersOnStack.add(folder);

        for ( const importedFolder of [...(importedFoldersByFolder.get(folder) ?? [])].sort() ) {
            if ( !visitOrderByFolder.has(importedFolder) ) {
                visitFolder(importedFolder);
                lowestReachableByFolder.set(folder, Math.min(lowestReachableByFolder.get(folder), lowestReachableByFolder.get(importedFolder)));
            } else if ( foldersOnStack.has(importedFolder) ) {
                lowestReachableByFolder.set(folder, Math.min(lowestReachableByFolder.get(folder), visitOrderByFolder.get(importedFolder)));
            }
        }

        if ( lowestReachableByFolder.get(folder) === visitOrderByFolder.get(folder) ) {
            const cycleFolders: string[] = [];
            let cycleFolder: string;
            do {
                cycleFolder = folderStack.pop();
                foldersOnStack.delete(cycleFolder);
                cycleFolders.push(cycleFolder);
            } while ( cycleFolder !== folder );
            if ( cycleFolders.length > 1 ) {
                folderCycles.push(cycleFolders.sort());
            }
        }

    };

    [...importedFoldersByFolder.keys()].sort().forEach(folder => {
        if ( !visitOrderByFolder.has(folder) ) {
            visitFolder(folder);
        }
    });

    return folderCycles;

}

export function describeFolderCycle(cycleFolders: string[], serviceImports: IServiceImport[]): string {

    const cycleFolderSet = new Set(cycleFolders);
    const importsInCycle = serviceImports
        .filter(serviceImport => {
            const importingFolder = toServiceFolder(serviceImport.importingFile);
            const importedFolder = toServiceFolder(serviceImport.importedFile);
            return importingFolder !== importedFolder && cycleFolderSet.has(importingFolder) && cycleFolderSet.has(importedFolder);
        })
        .map(formatServiceImport)
        .sort();

    return `Folders ${cycleFolders.join(', ')} import each other in a cycle, through:\n    ${importsInCycle.join('\n    ')}\n`
        + 'Move the code both sides share into a lower layer so the imports run one way.';

}

/*
    An entry stays only while it is still a violation: an import that still happens and is still
    upward, or a same-layer import whose two folders are still in one cycle of the whole graph.
*/
export function findStaleViolations(serviceImports: IServiceImport[], knownViolations: readonly string[], serviceLayers: Readonly<Record<string, number>>): string[] {

    const importsThatHappen = new Set(serviceImports.map(formatServiceImport));
    const upwardImports = new Set(findUpwardImports(serviceImports, serviceLayers).map(formatServiceImport));
    const cycleIndexByFolder = new Map<string, number>();
    findFolderCycles(serviceImports).forEach((cycleFolders, cycleIndex) => cycleFolders.forEach(cycleFolder => cycleIndexByFolder.set(cycleFolder, cycleIndex)));

    return knownViolations.flatMap(knownViolation => {

        if ( !importsThatHappen.has(knownViolation) ) {
            return [`"${knownViolation}" no longer happens: delete it from KNOWN_LAYER_VIOLATIONS.`];
        }

        const [importingFile, importedFile] = knownViolation.split(' → ');
        const importingCycle = cycleIndexByFolder.get(toServiceFolder(importingFile));
        const isInCycle = importingCycle !== undefined && importingCycle === cycleIndexByFolder.get(toServiceFolder(importedFile));

        return upwardImports.has(knownViolation) || isInCycle
            ? []
            : [`"${knownViolation}" is no longer upward or in a cycle: delete it from KNOWN_LAYER_VIOLATIONS.`];

    });

}

const SERVICE_SOURCE_FILE_PATHS = [...listServiceSourceFilePaths(SERVICES_DIRECTORY_PATH), EXTENSION_ENTRY_POINT_PATH];
const SERVICE_IMPORTS = readServiceImports(SERVICE_SOURCE_FILE_PATHS);
const KNOWN_LAYER_VIOLATION_SET = new Set(KNOWN_LAYER_VIOLATIONS);

describe('ServiceLayers -- a folder imports only its own layer or a lower one, never in a cycle (#570)', () => {

    test('every folder under src/treecipe/src has a layer', () => {

        const serviceFolders = fs.readdirSync(SERVICES_DIRECTORY_PATH, { withFileTypes: true })
            .filter(entry => entry.isDirectory() && !EXEMPT_DIRECTORY_NAMES.has(entry.name))
            .map(entry => entry.name);

        const foldersWithoutLayer = serviceFolders.filter(serviceFolder => SERVICE_LAYERS[serviceFolder] === undefined);
        expect(foldersWithoutLayer.map(serviceFolder => `src/treecipe/src/${serviceFolder} has no layer: add it to SERVICE_LAYERS in src/treecipe/src/tests/ServiceLayers.test.ts.`)).toEqual([]);

        const layersWithoutFolder = Object.keys(SERVICE_LAYERS).filter(serviceFolder => serviceFolder !== 'src/extension.ts' && !serviceFolders.includes(serviceFolder));
        expect(layersWithoutFolder.map(serviceFolder => `SERVICE_LAYERS names ${serviceFolder}, which is not a folder under src/treecipe/src: remove or rename its entry.`)).toEqual([]);

        // A FILE OUTSIDE ANY FOLDER HAS NO LAYER, SO NO IMPORT OF IT OR FROM IT COULD BE CHECKED
        const filesOutsideFolders = fs.readdirSync(SERVICES_DIRECTORY_PATH, { withFileTypes: true })
            .filter(entry => entry.isFile() && entry.name.endsWith('.ts'))
            .map(entry => `src/treecipe/src/${entry.name} is not in a service folder: move it into the folder of the layer it belongs to.`);
        expect(filesOutsideFolders).toEqual([]);

    });

    test('every import resolves to a file under src/treecipe/src or src/extension.ts', () => {

        const importsOutsideServices = SERVICE_IMPORTS.filter(serviceImport => SERVICE_LAYERS[toServiceFolder(serviceImport.importedFile)] === undefined);
        expect(importsOutsideServices.map(formatServiceImport)).toEqual([]);

    });

    test('no import reaches a higher layer unless KNOWN_LAYER_VIOLATIONS lists it', () => {

        const newUpwardImports = findUpwardImports(SERVICE_IMPORTS, SERVICE_LAYERS)
            .filter(serviceImport => !KNOWN_LAYER_VIOLATION_SET.has(formatServiceImport(serviceImport)));

        expect(newUpwardImports.map(serviceImport => describeUpwardImport(serviceImport, SERVICE_LAYERS))).toEqual([]);

    });

    test('no folder-level import cycle remains once the listed violations are taken out', () => {

        const unlistedImports = SERVICE_IMPORTS.filter(serviceImport => !KNOWN_LAYER_VIOLATION_SET.has(formatServiceImport(serviceImport)));
        const folderCycles = findFolderCycles(unlistedImports);

        expect(folderCycles.map(cycleFolders => describeFolderCycle(cycleFolders, unlistedImports))).toEqual([]);

    });

    // 27 BEFORE #572, 15 BEFORE #574; WHAT REMAINS IS #575'S: ObjectInfoWrapper, RecordTypeService, XMLProcessingService
    const MOST_FOLDERS_IN_ONE_CYCLE = 3;

    test(`no cycle in the whole import graph, listed violations included, holds more than ${MOST_FOLDERS_IN_ONE_CYCLE} folders`, () => {

        const oversizedCycles = findFolderCycles(SERVICE_IMPORTS)
            .filter(cycleFolders => cycleFolders.length > MOST_FOLDERS_IN_ONE_CYCLE)
            .map(cycleFolders => `${cycleFolders.length} folders import each other in a cycle (${cycleFolders.join(', ')}), more than ${MOST_FOLDERS_IN_ONE_CYCLE}: `
                + 'a new import has joined two folders the layers keep apart. Move the shared code into a lower layer.');

        expect(oversizedCycles).toEqual([]);

    });

    test('ExtensionCommandService and RecipeCockpitService are not in one cycle (#572)', () => {

        const commandAndCockpitCycles = findFolderCycles(SERVICE_IMPORTS)
            .filter(cycleFolders => cycleFolders.includes('ExtensionCommandService') && cycleFolders.includes('RecipeCockpitService'));

        expect(commandAndCockpitCycles).toEqual([]);

    });

    test('every entry in KNOWN_LAYER_VIOLATIONS is still a violation, so the list only shrinks', () => {

        expect(findStaleViolations(SERVICE_IMPORTS, KNOWN_LAYER_VIOLATIONS, SERVICE_LAYERS)).toEqual([]);
        expect(new Set(KNOWN_LAYER_VIOLATIONS).size).toBe(KNOWN_LAYER_VIOLATIONS.length);

    });

    describe('the checks themselves', () => {

        const writeScratchSource = (scratchDirectoryPath: string, relativePath: string, sourceText: string) => {
            const filePath = path.join(scratchDirectoryPath, relativePath);
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, sourceText);
            return filePath;
        };

        test('a type-only import, a re-export, require and import() each count as an import', () => {

            const sourceText = [
                "import type { IPicklistValue } from '../ObjectInfoWrapper/FieldInfo';",
                "export * from '../SalesforceApiName/SalesforceApiName';",
                "const relationshipService = require('../RelationshipService/RelationshipService');",
                "void import('../ErrorHandlingService/ErrorHandlingService');",
                "import * as yaml from 'js-yaml';"
            ].join('\n');
            const importedFiles = ts.preProcessFile(sourceText, true, true).importedFiles.map(importedFile => importedFile.fileName);

            expect(importedFiles.filter(importedFile => importedFile.startsWith('.'))).toEqual([
                '../ObjectInfoWrapper/FieldInfo',
                '../SalesforceApiName/SalesforceApiName',
                '../RelationshipService/RelationshipService',
                '../ErrorHandlingService/ErrorHandlingService'
            ]);

        });

        test('tests/ and mocks/ are skipped', () => {

            const shippedSourceFiles = SERVICE_SOURCE_FILE_PATHS.map(toServicePath);
            expect(shippedSourceFiles.filter(servicePath => /(^|\/)(tests|mocks)\//.test(servicePath))).toEqual([]);
            expect(shippedSourceFiles).toContain('XMLProcessingService/XmlFileProcessor.ts');
            expect(shippedSourceFiles).toContain('src/extension.ts');

        });

        test('an upward import names both files and both layers, and what to do', () => {

            const upwardImport = { importingFile: 'XMLProcessingService/XmlFileProcessor.ts', importedFile: 'RecipeService/RecipeService.ts' };

            expect(findUpwardImports([upwardImport], SERVICE_LAYERS)).toEqual([upwardImport]);
            expect(describeUpwardImport(upwardImport, SERVICE_LAYERS)).toBe(
                'XMLProcessingService/XmlFileProcessor.ts (XMLProcessingService, layer 2) imports RecipeService/RecipeService.ts (RecipeService, layer 3), a higher layer. '
                + 'Move the shared code down to a layer both can import, or ask for a layer change in SERVICE_LAYERS.'
            );

        });

        test('a same-layer cycle is found and lists the imports that close it', () => {

            const cycleImports = [
                { importingFile: 'RecipeService/RecipeService.ts', importedFile: 'RelationshipService/RelationshipService.ts' },
                { importingFile: 'RelationshipService/RelationshipService.ts', importedFile: 'MermaidService/MermaidService.ts' },
                { importingFile: 'MermaidService/MermaidService.ts', importedFile: 'RecipeService/RecipeService.ts' },
                { importingFile: 'RecipeService/RecipeService.ts', importedFile: 'CockpitKit/CockpitKit.ts' }
            ];

            const folderCycles = findFolderCycles(cycleImports);
            expect(folderCycles).toEqual([['MermaidService', 'RecipeService', 'RelationshipService']]);
            expect(describeFolderCycle(folderCycles[0], cycleImports)).toContain('RelationshipService/RelationshipService.ts → MermaidService/MermaidService.ts');
            expect(findFolderCycles(cycleImports.slice(1))).toEqual([]);

        });

        test('an entry that still happens but is no longer upward or in a cycle is stale', () => {

            const upwardImport = { importingFile: 'XMLProcessingService/XmlFileProcessor.ts', importedFile: 'RecipeService/RecipeService.ts' };
            const cycleImport = { importingFile: 'ObjectInfoWrapper/ObjectInfo.ts', importedFile: 'RecordTypeService/RecordTypesWrapper.ts' };
            const cycleReturnImport = { importingFile: 'RecordTypeService/RecordTypeService.ts', importedFile: 'ObjectInfoWrapper/FieldInfo.ts' };
            const knownViolations = [formatServiceImport(upwardImport), formatServiceImport(cycleImport)];

            expect(findStaleViolations([upwardImport, cycleImport, cycleReturnImport], knownViolations, SERVICE_LAYERS)).toEqual([]);

            // THE OTHER EDGE OF THE CYCLE IS GONE, AND THE UPWARD IMPORT'S FOLDER MOVED UP A LAYER
            expect(findStaleViolations([upwardImport, cycleImport], knownViolations, { ...SERVICE_LAYERS, XMLProcessingService: 3 })).toEqual([
                '"XMLProcessingService/XmlFileProcessor.ts → RecipeService/RecipeService.ts" is no longer upward or in a cycle: delete it from KNOWN_LAYER_VIOLATIONS.',
                '"ObjectInfoWrapper/ObjectInfo.ts → RecordTypeService/RecordTypesWrapper.ts" is no longer upward or in a cycle: delete it from KNOWN_LAYER_VIOLATIONS.'
            ]);

            expect(findStaleViolations([], knownViolations.slice(0, 1), SERVICE_LAYERS)).toEqual([
                '"XMLProcessingService/XmlFileProcessor.ts → RecipeService/RecipeService.ts" no longer happens: delete it from KNOWN_LAYER_VIOLATIONS.'
            ]);

        });

        test('imports are read from real files, resolved to the imported file', () => {

            const scratchDirectoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-service-layers-'));
            try {
                writeScratchSource(scratchDirectoryPath, 'SalesforceApiName/SalesforceApiName.ts', 'export class SalesforceApiName {}');
                const importingFilePath = writeScratchSource(scratchDirectoryPath, 'XMLProcessingService/XmlFileProcessor.ts', "import type { SalesforceApiName } from '../SalesforceApiName/SalesforceApiName';");

                const [serviceImport] = readServiceImports([importingFilePath]);
                expect(path.basename(serviceImport.importedFile)).toBe('SalesforceApiName.ts');
            } finally {
                fs.rmSync(scratchDirectoryPath, { recursive: true, force: true });
            }

        });

    });

});
