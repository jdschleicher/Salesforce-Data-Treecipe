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

// FOLDER-LEVEL CYCLES (TARJAN'S STRONGLY CONNECTED COMPONENTS)
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
    Webview panel code (#565, #637) lives in a panel/ folder inside a service folder and is bundled by
    esbuild.panel.js into a script that runs in the webview, not the extension host. It is a layer
    below 0: a panel module imports only other panel modules and host-free files, so no vscode, Node
    module or host service ever reaches the webview. A host-free file imports nothing, or only other
    host-free files by a relative path (#639: the Troubleshooting constants import a type from
    RecipeCockpitPanelConstants.ts). It may sit in any folder, beside the host code that also reads it (#638).
*/
export const PANEL_DIRECTORY_NAME = 'panel';

export interface IPanelImport {
    importingFile: string;
    importSpecifier: string;
    importedFile: string | null;
    isImportedFileHostFree: boolean;
}

export const isPanelModule = (servicePath: string): boolean => servicePath.split('/').slice(0, -1).includes(PANEL_DIRECTORY_NAME);

// EVERY FILE IT IMPORTS, AND EVERY FILE THOSE IMPORT, IS A FILE IN THIS TREE: NO PACKAGE, NO NODE MODULE, NO vscode
export function isHostFreeFile(filePath: string, filesOnPath: Set<string> = new Set()): boolean {

    if ( !fs.existsSync(filePath) ) { return false; }
    if ( filesOnPath.has(filePath) ) { return true; }
    filesOnPath.add(filePath);

    return ts.preProcessFile(fs.readFileSync(filePath, 'utf8'), true, true).importedFiles.every(importedFile =>
        importedFile.fileName.startsWith('.') && isHostFreeFile(resolveImportedFilePath(filePath, importedFile.fileName), filesOnPath));

}

export function readPanelImports(sourceFilePaths: string[]): IPanelImport[] {

    return sourceFilePaths.filter(sourceFilePath => isPanelModule(toServicePath(sourceFilePath))).flatMap(sourceFilePath =>
        ts.preProcessFile(fs.readFileSync(sourceFilePath, 'utf8'), true, true).importedFiles.map(importedFile => {
            if ( !importedFile.fileName.startsWith('.') ) {
                return { importingFile: toServicePath(sourceFilePath), importSpecifier: importedFile.fileName, importedFile: null, isImportedFileHostFree: false };
            }
            const importedFilePath = resolveImportedFilePath(sourceFilePath, importedFile.fileName);
            return { importingFile: toServicePath(sourceFilePath), importSpecifier: importedFile.fileName, importedFile: toServicePath(importedFilePath), isImportedFileHostFree: isHostFreeFile(importedFilePath) };
        }));

}

export function describePanelImportViolations(panelImports: IPanelImport[], serviceLayers: Readonly<Record<string, number>>): string[] {

    return panelImports
        .filter(panelImport => {
            if ( panelImport.importedFile === null ) { return true; }
            if ( isPanelModule(panelImport.importedFile) ) { return false; }
            return serviceLayers[toServiceFolder(panelImport.importedFile)] === undefined || !panelImport.isImportedFileHostFree;
        })
        .map(panelImport => `${panelImport.importingFile} is webview panel code and imports '${panelImport.importSpecifier}'. `
            + 'A panel module may import only other panel/ modules and host-free files, which import nothing or only other host-free files: '
            + 'move the value it needs into such a file, or pass it in a message from the host.');

}

const SERVICE_SOURCE_FILE_PATHS = [...listServiceSourceFilePaths(SERVICES_DIRECTORY_PATH), EXTENSION_ENTRY_POINT_PATH];
const SERVICE_IMPORTS = readServiceImports(SERVICE_SOURCE_FILE_PATHS);

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

    test('no import reaches a higher layer', () => {

        const upwardImports = findUpwardImports(SERVICE_IMPORTS, SERVICE_LAYERS);
        expect(upwardImports.map(serviceImport => describeUpwardImport(serviceImport, SERVICE_LAYERS))).toEqual([]);

    });

    test('no folders import each other in a cycle', () => {

        const folderCycles = findFolderCycles(SERVICE_IMPORTS);
        expect(folderCycles.map(cycleFolders => describeFolderCycle(cycleFolders, SERVICE_IMPORTS))).toEqual([]);

    });

    test('webview panel modules import only panel modules and host-free files (#637, #638, #639)', () => {

        const panelImports = readPanelImports(SERVICE_SOURCE_FILE_PATHS);

        expect(panelImports.map(panelImport => panelImport.importingFile)).toContain('RecipeCockpitService/panel/RecipeCockpitPanel.ts');
        expect(describePanelImportViolations(panelImports, SERVICE_LAYERS)).toEqual([]);

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

        test('a panel module importing vscode, a Node module, a host service or a file with imports is refused, and the message says what to do', () => {

            const panelImport = (importSpecifier: string, importedFile: string | null, isImportedFileHostFree = false): IPanelImport =>
                ({ importingFile: 'CockpitKit/panel/CockpitConfirmDialogPanel.ts', importSpecifier, importedFile, isImportedFileHostFree });

            const refusedImports = [
                panelImport('vscode', null),
                panelImport('crypto', null),
                panelImport('../../RecipeCockpitService/RecipeCockpitService', 'RecipeCockpitService/RecipeCockpitService.ts', false),
                panelImport('../CockpitConfirmDialog', 'CockpitKit/CockpitConfirmDialog.ts', false)
            ];
            const allowedImports = [
                panelImport('../CockpitConfirmLabels', 'CockpitKit/CockpitConfirmLabels.ts', true),
                panelImport('../RecipeCockpitPanelConstants', 'RecipeCockpitService/RecipeCockpitPanelConstants.ts', true),
                panelImport('./CockpitConfirmDialogPanel', 'RecipeCockpitService/panel/CockpitConfirmDialogPanel.ts', false)
            ];

            expect(describePanelImportViolations([...refusedImports, ...allowedImports], SERVICE_LAYERS)).toHaveLength(refusedImports.length);
            expect(describePanelImportViolations([panelImport('crypto', null)], SERVICE_LAYERS)).toEqual([
                "CockpitKit/panel/CockpitConfirmDialogPanel.ts is webview panel code and imports 'crypto'. "
                + 'A panel module may import only other panel/ modules and host-free files, which import nothing or only other host-free files: '
                + 'move the value it needs into such a file, or pass it in a message from the host.'
            ]);
            expect(isPanelModule('CockpitKit/panel/CockpitConfirmDialogPanel.ts')).toBe(true);
            expect(isPanelModule('CockpitKit/CockpitConfirmDialog.ts')).toBe(false);

        });

        test('a host-free file may import other host-free files, and no file that reaches a package, Node module or vscode (#639)', () => {

            const servicePathOf = (servicePath: string) => path.join(SERVICES_DIRECTORY_PATH, servicePath);

            expect(isHostFreeFile(servicePathOf('RecipeCockpitService/RecipeCockpitTroubleshootingConstants.ts'))).toBe(true);
            expect(isHostFreeFile(servicePathOf('RecipeWriter/RecipeCockpitRecipeWriter.ts'))).toBe(true);
            expect(isHostFreeFile(servicePathOf('CockpitKit/CockpitConfirmDialog.ts'))).toBe(false);
            expect(isHostFreeFile(servicePathOf('RecipeCockpitService/RecipeCockpitRunHistory.ts'))).toBe(false);
            expect(isHostFreeFile(servicePathOf('RecipeCockpitService/NoSuchFile.ts'))).toBe(false);

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
