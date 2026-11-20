import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
jest.mock('vscode', () => ({
    workspace: { workspaceFolders: undefined, getConfiguration: jest.fn().mockReturnValue({ get: jest.fn(), update: jest.fn(), inspect: jest.fn() }) },
    env: { openExternal: jest.fn() },
    window: { createWebviewPanel: jest.fn(), showWarningMessage: jest.fn(), showInformationMessage: jest.fn(), showErrorMessage: jest.fn() },
    commands: { registerCommand: jest.fn(), executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ProgressLocation: { Notification: 15, Window: 10 },
    ConfigurationTarget: { Workspace: 2 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }), parse: (uriValue: string) => ({ toString: () => uriValue }) }
}), { virtual: true });
import * as RecipeCockpitServiceModule from '../RecipeCockpitService';
import {
    IRecipeCockpitPanelMessage,
    IRecipeCockpitPanelState,
    RecipeCockpitService
} from '../RecipeCockpitService';
import { RecipeCockpitQueryHost } from '../RecipeCockpitQueryHost';
import { RecipeCockpitTroubleshootingHost } from '../RecipeCockpitTroubleshootingHost';
import * as RecipeCockpitDatasetsHostModule from '../RecipeCockpitDatasetsHost';
import * as RecipeCockpitAdapterHostModule from '../RecipeCockpitAdapterHost';
import * as RecipeCockpitAdapterMetadataModule from '../RecipeCockpitAdapterMetadata';
import * as RecipeCockpitAdapterRecordsModule from '../RecipeCockpitAdapterRecords';
import * as RecipeCockpitAdapterStateModule from '../RecipeCockpitAdapterState';
import * as RecipeCockpitRecordLinksHostModule from '../RecipeCockpitRecordLinksHost';
import * as RecipeCockpitRecordLinksModule from '../RecipeCockpitRecordLinks';
import {
    RECIPE_COCKPIT_ADAPTER_ACTION_KINDS,
    RECIPE_COCKPIT_ADAPTER_COMMANDS,
    RecipeCockpitAdapterHost
} from '../RecipeCockpitAdapterHost';
import {
    RECIPE_COCKPIT_RECORD_LINKS_ACTION_KINDS,
    RECIPE_COCKPIT_RECORD_LINKS_COMMANDS,
    RecipeCockpitRecordLinksHost
} from '../RecipeCockpitRecordLinksHost';
import {
    RECIPE_COCKPIT_DATASETS_ACTION_KINDS,
    RECIPE_COCKPIT_DATASETS_COMMANDS,
    RecipeCockpitDatasetsHost
} from '../RecipeCockpitDatasetsHost';
import * as RecipeCockpitQueryHostModule from '../RecipeCockpitQueryHost';
import * as RecipeCockpitTroubleshootingHostModule from '../RecipeCockpitTroubleshootingHost';
import * as RecipeCockpitTroubleshootingRunsModule from '../RecipeCockpitTroubleshootingRuns';
import * as RecipeCockpitTroubleshootingViewsModule from '../RecipeCockpitTroubleshootingViews';
import {
    RECIPE_COCKPIT_QUERY_ACTION_KINDS,
    RECIPE_COCKPIT_QUERY_COMMANDS
} from '../RecipeCockpitQueryHost';
import {
    RECIPE_COCKPIT_TROUBLESHOOTING_ACTION_KINDS,
    RECIPE_COCKPIT_TROUBLESHOOTING_COMMANDS
} from '../RecipeCockpitTroubleshootingHost';

const SOURCE_ROOT = path.join(__dirname, '..', '..', '..', '..');
const COCKPIT_FOLDER = path.join(__dirname, '..');
const HUB_FILE_NAME = 'RecipeCockpitService.ts';

/*
    What the hub still takes from one of a tab's pure modules: the names it imports and the members
    it reads through them, exactly, and why. A slice that moves a use out shortens the list; a use
    the hub keeps as a service every tab shares says so.
*/
interface IHubUseStillOwed {
    pureModuleFileName: string;
    importedNames: string[];
    members: string[];
    owedBy: string;
}

interface ITabHost {
    tabName: string;
    hostClassName: string;
    // THE FILES THE TAB'S HOST HALF IS, IN LOAD ORDER: THE FIRST HOLDS ITS ROUTER AND EXECUTOR, AND EACH LOADS ONLY THE ONES AFTER IT
    hostFileNames: string[];
    hostModules: Record<string, unknown>[];
    commands: readonly string[];
    actionKinds: readonly string[];
    routePanelMessage: (panelMessage: IRecipeCockpitPanelMessage, panelState: IRecipeCockpitPanelState) => unknown;
    // A PURE MODULE ONLY THIS TAB'S HOST MAY IMPORT, OF THE HOSTS AND THE HUB
    pureModuleFileNames: string[];
    hubUsesStillOwed: IHubUseStillOwed[];
    // ANOTHER TAB'S HOST THAT MAY IMPORT ONE OF THIS TAB'S PURE MODULES TOO: EXACTLY WHICH NAMES AND MEMBERS, AND WHY
    sharedWithHosts?: { pureModuleFileName: string; hostFileName: string; importedNames: string[]; members: string[]; reason: string }[];
    // ANOTHER TAB'S HOST FILE ONE OF THIS TAB'S FILES LOADS AT RUN TIME, AND WHY
    loadsOtherHosts?: { fileName: string; otherHostFileName: string; reason: string }[];
}

const SHARED_RETRIEVE_RUNNER = 'runCancellableRetrieve, the one retrieve runner the Troubleshooting tab and the Treecipe Adapter share, stays in the hub';

/*
    One row per tab whose host half is out of the hub (#566). A tab's panel commands and action
    kinds have a case in its host and nowhere else, so a reader looking for what a Query message does
    opens one file; and the hub never runs a host's work for it, only hands the message over.
*/
const TAB_HOSTS: ITabHost[] = [
    {
        tabName: 'Query',
        hostClassName: 'RecipeCockpitQueryHost',
        hostFileNames: ['RecipeCockpitQueryHost.ts'],
        loadsOtherHosts: [
            { fileName: 'RecipeCockpitQueryHost.ts', otherHostFileName: 'RecipeCockpitRecordLinks.ts', reason: 'a query preview\'s rows link the records they show (#556)' }
        ],
        hostModules: [RecipeCockpitQueryHostModule],
        commands: RECIPE_COCKPIT_QUERY_COMMANDS,
        actionKinds: RECIPE_COCKPIT_QUERY_ACTION_KINDS,
        routePanelMessage: (panelMessage, panelState) => RecipeCockpitQueryHost.routePanelMessage(panelMessage, panelState),
        pureModuleFileNames: ['RecipeCockpitQuery.ts'],
        hubUsesStillOwed: [],
        sharedWithHosts: [
            {
                pureModuleFileName: 'RecipeCockpitQuery.ts',
                hostFileName: 'RecipeCockpitAdapterHost.ts',
                importedNames: ['IRecipeCockpitPreviewRecordLinks'],
                members: [],
                reason: 'an Adapter preview posts the same record links a query preview does'
            },
            {
                pureModuleFileName: 'RecipeCockpitQuery.ts',
                hostFileName: 'RecipeCockpitAdapterMetadata.ts',
                importedNames: ['RecipeCockpitQuery'],
                members: ['buildPreview'],
                reason: 'Add to data set previews its child records with the same preview'
            },
            {
                pureModuleFileName: 'RecipeCockpitQuery.ts',
                hostFileName: 'RecipeCockpitAdapterRecords.ts',
                importedNames: ['RECIPE_COCKPIT_QUERY_CONNECTION_FAILED_ADVICE', 'RECIPE_COCKPIT_QUERY_RECORD_CAP', 'RECIPE_COCKPIT_QUERY_VALUE_BUDGET', 'RecipeCockpitQuery'],
                members: ['buildPreview', 'countValues', 'fetchQueryRecords'],
                reason: 'the Adapter\'s load, update and restore read records through the same pages, limits and preview'
            }
        ]
    },
    {
        tabName: 'Troubleshooting',
        hostClassName: 'RecipeCockpitTroubleshootingHost',
        hostFileNames: ['RecipeCockpitTroubleshootingHost.ts', 'RecipeCockpitTroubleshootingRuns.ts', 'RecipeCockpitTroubleshootingViews.ts'],
        hostModules: [RecipeCockpitTroubleshootingHostModule, RecipeCockpitTroubleshootingRunsModule, RecipeCockpitTroubleshootingViewsModule],
        commands: RECIPE_COCKPIT_TROUBLESHOOTING_COMMANDS,
        actionKinds: RECIPE_COCKPIT_TROUBLESHOOTING_ACTION_KINDS,
        routePanelMessage: (panelMessage, panelState) => RecipeCockpitTroubleshootingHost.routePanelMessage(panelMessage, panelState, RecipeCockpitService),
        pureModuleFileNames: [
            'RecipeCockpitMetadataDeploy.ts',
            'RecipeCockpitMetadataDeployPackage.ts',
            'RecipeCockpitMetadataRetrieve.ts',
            'RecipeCockpitMetadataRetrievePackage.ts',
            'RecipeCockpitPermissionSetAssign.ts',
            'RecipeCockpitPermissionSetGenerate.ts',
            'RecipeCockpitRunHistory.ts',
            'RecipeCockpitValidationRuleList.ts',
            'RecipeCockpitRemovedTodoStore.ts'
        ],
        hubUsesStillOwed: [
            {
                pureModuleFileName: 'RecipeCockpitMetadataDeploy.ts',
                importedNames: ['IMetadataDeployComponent', 'IMetadataDeployObject', 'RecipeCockpitMetadataDeploy'],
                members: ['readApiVersion', 'toManifestRelativePath', 'writePackageXml'],
                owedBy: '#669 (Get latest object detail); readApiVersion is readSourceApiVersion\'s, which every retrieve reads'
            },
            {
                pureModuleFileName: 'RecipeCockpitMetadataDeployPackage.ts',
                importedNames: ['RecipeCockpitMetadataDeployPackage'],
                members: ['describeError'],
                owedBy: SHARED_RETRIEVE_RUNNER
            },
            {
                pureModuleFileName: 'RecipeCockpitMetadataRetrieve.ts',
                importedNames: ['METADATA_RETRIEVE_TIMEOUT_MILLISECONDS'],
                members: [],
                owedBy: SHARED_RETRIEVE_RUNNER
            },
            {
                pureModuleFileName: 'RecipeCockpitMetadataRetrievePackage.ts',
                importedNames: ['IMetadataRetrieveConnection', 'METADATA_RETRIEVE_METHOD_SETTING', 'MetadataRetrieveDestination', 'RecipeCockpitMetadataRetrievePackage'],
                members: ['buildRetrieveRequest', 'convertToSourceFiles', 'readRetrieveMethod', 'readZip', 'readZipFile', 'runRetrieve', 'toCliShapedPayload', 'writeSourceFiles'],
                owedBy: SHARED_RETRIEVE_RUNNER
            },
            {
                pureModuleFileName: 'RecipeCockpitPermissionSetAssign.ts',
                importedNames: ['PERMISSION_SET_MAX_BUFFER_BYTES'],
                members: [],
                owedBy: 'runCancellableCli\'s default output buffer: the one CLI runner every tab shares stays in the hub'
            },
            {
                pureModuleFileName: 'RecipeCockpitPermissionSetGenerate.ts',
                importedNames: ['RecipeCockpitPermissionSetGenerate'],
                members: ['resolveDefaultPackageDirectoryPath'],
                owedBy: '#669 (Get latest object detail)'
            },
            {
                pureModuleFileName: 'RecipeCockpitValidationRuleList.ts',
                importedNames: ['RecipeCockpitValidationRuleList'],
                members: ['buildRuleSourceKey', 'resolveRuleSourceFilePaths'],
                owedBy: 'the hub builds the model\'s rule links and promotes their allow-list, which only the hub does'
            },
            {
                pureModuleFileName: 'RecipeCockpitRemovedTodoStore.ts',
                importedNames: ['IRemovedTodoFileRead', 'RecipeCockpitRemovedTodoStore'],
                members: ['addEntry', 'buildFilePath', 'isSameEntry', 'parse', 'removeEntry', 'serialize'],
                owedBy: '#669: removing and restoring a TODO writes the recipe, and the model reads the removed list'
            }
        ],
        sharedWithHosts: [
            {
                pureModuleFileName: 'RecipeCockpitMetadataDeploy.ts',
                hostFileName: 'RecipeCockpitAdapterMetadata.ts',
                importedNames: ['RecipeCockpitMetadataDeploy'],
                members: ['describeCappedList', 'toManifestRelativePath', 'writePackageXml'],
                reason: 'the Adapter\'s retrieve and child write the same package.xml, and its apply lists files the same way'
            },
            {
                pureModuleFileName: 'RecipeCockpitPermissionSetGenerate.ts',
                hostFileName: 'RecipeCockpitAdapterMetadata.ts',
                importedNames: ['RecipeCockpitPermissionSetGenerate'],
                members: ['resolveDefaultPackageDirectoryPath'],
                reason: 'Apply retrieved files writes into the same default package directory'
            },
            {
                pureModuleFileName: 'RecipeCockpitRunHistory.ts',
                hostFileName: 'RecipeCockpitDatasetsHost.ts',
                importedNames: ['RUN_HISTORY_STEP_LABELS', 'RecipeCockpitRunHistory', 'RunHistoryRowStatus'],
                members: ['formatTimeLabel'],
                reason: 'a data set row\'s insert journey (#471) lists the same Troubleshooting steps, with the same labels and times'
            }
        ]
    },
    {
        tabName: 'Previously Used Data Sets',
        hostClassName: 'RecipeCockpitDatasetsHost',
        hostFileNames: ['RecipeCockpitDatasetsHost.ts'],
        hostModules: [RecipeCockpitDatasetsHostModule],
        commands: RECIPE_COCKPIT_DATASETS_COMMANDS,
        actionKinds: RECIPE_COCKPIT_DATASETS_ACTION_KINDS,
        routePanelMessage: (panelMessage, panelState) => RecipeCockpitDatasetsHost.routePanelMessage(panelMessage, panelState, RecipeCockpitService),
        pureModuleFileNames: ['RecipeCockpitDatasetJourney.ts', 'RecipeCockpitTreeHistory.ts'],
        hubUsesStillOwed: [
            {
                pureModuleFileName: 'RecipeCockpitTreeHistory.ts',
                importedNames: ['IRecipeCockpitTreeDatasetViewModel', 'IRecipeCockpitTreeHistoryTargets', 'IRecipeCockpitTreeHistoryViewModel', 'RecipeCockpitTreeHistory'],
                members: ['buildEmptyTargets', 'buildTreeHistories', 'buildUnmatchedDatasetsNotice'],
                owedBy: 'the hub builds the model, its data set rows and the allow-lists they are drawn from'
            }
        ]
    },
    {
        tabName: 'Treecipe Adapter',
        hostClassName: 'RecipeCockpitAdapterHost',
        hostFileNames: ['RecipeCockpitAdapterHost.ts', 'RecipeCockpitAdapterMetadata.ts', 'RecipeCockpitAdapterRecords.ts', 'RecipeCockpitAdapterState.ts'],
        hostModules: [RecipeCockpitAdapterHostModule, RecipeCockpitAdapterMetadataModule, RecipeCockpitAdapterRecordsModule, RecipeCockpitAdapterStateModule],
        commands: RECIPE_COCKPIT_ADAPTER_COMMANDS,
        actionKinds: RECIPE_COCKPIT_ADAPTER_ACTION_KINDS,
        routePanelMessage: (panelMessage, panelState) => RecipeCockpitAdapterHost.routePanelMessage(panelMessage, panelState, RecipeCockpitService),
        pureModuleFileNames: ['RecipeCockpitTreeUpdaterQuery.ts', 'RecipeCockpitRecordUpdate.ts', 'RecipeCockpitOrgChangeDetection.ts', 'RecipeCockpitAdaptedDataset.ts'],
        loadsOtherHosts: [
            { fileName: 'RecipeCockpitAdapterRecords.ts', otherHostFileName: 'RecipeCockpitDatasetsHost.ts', reason: 'a landed update adds its adapted data set to Previously Used Data Sets (#448)' },
            { fileName: 'RecipeCockpitAdapterRecords.ts', otherHostFileName: 'RecipeCockpitRecordLinks.ts', reason: 'a loaded or updated preview\'s rows link the records they show (#556)' }
        ],
        hubUsesStillOwed: [
            {
                pureModuleFileName: 'RecipeCockpitTreeUpdaterQuery.ts',
                importedNames: ['RECIPE_COCKPIT_UPDATER_WHERE_MAX_LENGTH'],
                members: [],
                owedBy: '#670: the reader\'s place keeps a card\'s WHERE text to the same limit'
            },
            {
                pureModuleFileName: 'RecipeCockpitRecordUpdate.ts',
                importedNames: ['IUpdateSnapshotObject'],
                members: [],
                owedBy: '#669: buildOrgOnlyFieldsResult, which the Adapter reads through the hub, is shared with Get latest object detail'
            },
            {
                pureModuleFileName: 'RecipeCockpitOrgChangeDetection.ts',
                importedNames: ['IOrgNewFieldDetail', 'RecipeCockpitOrgChangeDetection'],
                members: ['buildPackageXmlFilePath', 'buildRetrieveArguments', 'buildStagingFolderPath', 'copyMetadataFiles', 'makeStagingFolder', 'readRetrieveSucceeded', 'toOutputDirectoryArgument'],
                owedBy: '#669: Get latest object detail stages and copies through the same retrieve, and offerStagedField is shared with it'
            },
            {
                pureModuleFileName: 'RecipeCockpitAdaptedDataset.ts',
                importedNames: ['RecipeCockpitAdaptedDataset'],
                members: ['isAdaptedRecipeFileName'],
                owedBy: 'the hub lists a run\'s recipes when it loads the model, and leaves an adapted recipe out'
            }
        ]
    },
    {
        tabName: 'record links',
        hostClassName: 'RecipeCockpitRecordLinksHost',
        hostFileNames: ['RecipeCockpitRecordLinksHost.ts', 'RecipeCockpitRecordLinks.ts'],
        hostModules: [RecipeCockpitRecordLinksHostModule, RecipeCockpitRecordLinksModule],
        commands: RECIPE_COCKPIT_RECORD_LINKS_COMMANDS,
        actionKinds: RECIPE_COCKPIT_RECORD_LINKS_ACTION_KINDS,
        routePanelMessage: (panelMessage, panelState) => RecipeCockpitRecordLinksHost.routePanelMessage(panelMessage, panelState, RecipeCockpitService),
        pureModuleFileNames: [],
        hubUsesStillOwed: [],
        loadsOtherHosts: [
            { fileName: 'RecipeCockpitRecordLinksHost.ts', otherHostFileName: 'RecipeCockpitQueryHost.ts', reason: 'a query preview\'s row is opened from the result the Query host holds' },
            { fileName: 'RecipeCockpitRecordLinksHost.ts', otherHostFileName: 'RecipeCockpitAdapterState.ts', reason: 'a loaded preview\'s row is opened from the records the Adapter holds' }
        ]
    }
];

const HOST_FILE_NAMES = TAB_HOSTS.flatMap(tabHost => tabHost.hostFileNames);

// EVERY FILE THE EXTENSION HOST RUNS: NOT A TEST, NOT THE PANEL (A BROWSER BUNDLE) AND NOT A GENERATED FILE
const listHostSideFiles = (directoryPath: string): string[] => fs.readdirSync(directoryPath, { withFileTypes: true }).flatMap(directoryEntry => {
    const entryPath = path.join(directoryPath, directoryEntry.name);
    if ( directoryEntry.isDirectory() ) {
        return directoryEntry.name === 'tests' || directoryEntry.name === 'panel' ? [] : listHostSideFiles(entryPath);
    }
    return entryPath.endsWith('.ts') && !entryPath.endsWith('.generated.ts') ? [entryPath] : [];
});

const parse = (filePath: string): ts.SourceFile => ts.createSourceFile(filePath, fs.readFileSync(filePath, 'utf-8'), ts.ScriptTarget.Latest, true);

const visit = (node: ts.Node, onNode: (node: ts.Node) => void) => {
    onNode(node);
    ts.forEachChild(node, childNode => visit(childNode, onNode));
};

const caseLabels = (sourceFile: ts.SourceFile): string[] => {
    const labels: string[] = [];
    visit(sourceFile, node => {
        if ( ts.isCaseClause(node) && ts.isStringLiteral(node.expression) ) {
            labels.push(node.expression.text);
        }
    });
    return labels;
};

const importsOf = (sourceFile: ts.SourceFile): ts.ImportDeclaration[] => sourceFile.statements.filter(ts.isImportDeclaration);

const resolvedImportPath = (sourceFile: ts.SourceFile, importDeclaration: ts.ImportDeclaration | ts.ExportDeclaration): string =>
    path.resolve(path.dirname(sourceFile.fileName), `${(importDeclaration.moduleSpecifier as ts.StringLiteral).text}.ts`);

const isRelativeSpecifier = (moduleSpecifier: ts.Expression | undefined): moduleSpecifier is ts.StringLiteral =>
    moduleSpecifier !== undefined && ts.isStringLiteral(moduleSpecifier) && moduleSpecifier.text.startsWith('.');

// EVERY FILE IN src/ A MODULE LOADS AT RUN TIME: import, export ... from, require() AND import(), BUT NO import type OR export type
const runtimeImportPaths = (sourceFile: ts.SourceFile): string[] => {
    const loadedPaths: string[] = [];
    visit(sourceFile, node => {
        if ( ( ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly )
                || ( ts.isExportDeclaration(node) && !node.isTypeOnly ) ) {
            if ( isRelativeSpecifier(node.moduleSpecifier) ) {
                loadedPaths.push(resolvedImportPath(sourceFile, node));
            }
        } else if ( ts.isCallExpression(node)
                && ( node.expression.kind === ts.SyntaxKind.ImportKeyword || ( ts.isIdentifier(node.expression) && node.expression.text === 'require' ) )
                && isRelativeSpecifier(node.arguments[0]) ) {
            loadedPaths.push(path.resolve(path.dirname(sourceFile.fileName), `${(node.arguments[0] as ts.StringLiteral).text}.ts`));
        }
    });
    return loadedPaths.filter(loadedPath => fs.existsSync(loadedPath));
};

const stringLiterals = (node: ts.Node): string[] => {
    const literals: string[] = [];
    visit(node, node => {
        if ( ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ) {
            literals.push(node.text);
        }
    });
    return literals;
};

const importedNames = (importDeclaration: ts.ImportDeclaration): string[] => {
    const namedBindings = importDeclaration.importClause?.namedBindings;
    return namedBindings && ts.isNamedImports(namedBindings) ? namedBindings.elements.map(importSpecifier => importSpecifier.name.text) : [];
};

const hostSideFiles = listHostSideFiles(SOURCE_ROOT);

// THE HOST-FREE FILES A panel/ MODULE IMPORTS: THE PANEL'S OWN WORDS, WHICH NAME THE COMMANDS IT POSTS
const listPanelImportedFiles = (directoryPath: string): string[] => fs.readdirSync(directoryPath, { withFileTypes: true }).flatMap(directoryEntry => {
    const entryPath = path.join(directoryPath, directoryEntry.name);
    if ( directoryEntry.isDirectory() ) {
        return directoryEntry.name === 'tests' ? [] : listPanelImportedFiles(entryPath);
    }
    if ( !entryPath.endsWith('.ts') || !entryPath.split(path.sep).includes('panel') ) {
        return [];
    }
    const panelSource = parse(entryPath);
    return importsOf(panelSource)
        .filter(importDeclaration => isRelativeSpecifier(importDeclaration.moduleSpecifier))
        .map(importDeclaration => resolvedImportPath(panelSource, importDeclaration))
        .filter(importedPath => !importedPath.split(path.sep).includes('panel'));
});
const panelImportedFiles = new Set(listPanelImportedFiles(SOURCE_ROOT));
const hubFilePath = path.join(COCKPIT_FOLDER, HUB_FILE_NAME);

describe('Recipe Cockpit tab hosts (#566)', () => {

    describe.each(TAB_HOSTS)('the $tabName tab', tabHost => {

        const hostFilePaths = tabHost.hostFileNames.map(fileName => path.join(COCKPIT_FOLDER, fileName));

        test('has a case for each of its commands and action kinds in its host', () => {

            const hostLabels = caseLabels(parse(hostFilePaths[0]));

            expect([...tabHost.commands, ...tabHost.actionKinds].filter(ownedName => !hostLabels.includes(ownedName))).toEqual([]);

        });

        // NOT ONLY A case: AN if ON THE COMMAND OR A LOOKUP TABLE NAMES IT AS A STRING TOO
        test('names its commands and action kinds nowhere outside its host', () => {

            const ownedNames = new Set([...tabHost.commands, ...tabHost.actionKinds]);
            const strayNames = hostSideFiles
                .filter(filePath => !hostFilePaths.includes(filePath) && !panelImportedFiles.has(filePath))
                .flatMap(filePath => stringLiterals(parse(filePath)).filter(literal => ownedNames.has(literal)).map(literal => `${path.relative(SOURCE_ROOT, filePath)}: '${literal}'`));

            expect(strayNames).toEqual([]);

        });

        // A FILE THE PANEL IMPORTS MAY NAME A COMMAND IN A TABLE THE PANEL POSTS FROM; ONLY THE TAB'S HOST MAY READ THAT TABLE
        test('has its command tables read by no host-side file but its host', () => {

            const ownedNames = new Set([...tabHost.commands, ...tabHost.actionKinds]);
            const commandTables = new Set<string>();
            panelImportedFiles.forEach(filePath => {
                parse(filePath).statements.filter(ts.isVariableStatement).forEach(variableStatement => {
                    variableStatement.declarationList.declarations.forEach(declaration => {
                        if ( ts.isIdentifier(declaration.name) && declaration.initializer && stringLiterals(declaration.initializer).some(literal => ownedNames.has(literal)) ) {
                            commandTables.add(declaration.name.text);
                        }
                    });
                });
            });

            const strayReads: string[] = [];
            hostSideFiles.filter(filePath => !hostFilePaths.includes(filePath) && !panelImportedFiles.has(filePath)).forEach(filePath => {
                visit(parse(filePath), node => {
                    if ( ts.isIdentifier(node) && commandTables.has(node.text)
                            && !ts.isImportSpecifier(node.parent) && !ts.isExportSpecifier(node.parent) ) {
                        strayReads.push(`${path.relative(SOURCE_ROOT, filePath)}: ${node.text}`);
                    }
                });
            });

            expect(strayReads).toEqual([]);

        });

        // THE HUB TYPE IS THE TAB'S WHOLE DEPENDENCE ON THE HUB: A NAME NO FILE OF THE TAB READS, OR ONE READ BUT NOT LISTED, FAILS
        test('lists in its hub type exactly the hub members its files read', () => {

            const hubTypeNames = new Set<string>();
            visit(parse(hostFilePaths[0]), node => {
                if ( ts.isTypeAliasDeclaration(node) && node.name.text.startsWith('IRecipeCockpitHubFor') ) {
                    visit(node.type, typeNode => {
                        if ( ts.isLiteralTypeNode(typeNode) && ts.isStringLiteral(typeNode.literal) ) {
                            hubTypeNames.add(typeNode.literal.text);
                        }
                    });
                }
            });
            const readNames = new Set<string>();
            hostFilePaths.forEach(filePath => visit(parse(filePath), node => {
                if ( ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'hub' ) {
                    readNames.add(node.name.text);
                }
            }));

            expect([...hubTypeNames].sort()).toEqual([...readNames].sort());

        });

        // ITS ROUTER ANSWERS ONLY THE COMMANDS IT OWNS: ANOTHER TAB'S, OR ONE NO TAB OWNS, IS ANSWERED WITH NOTHING
        test('routes nothing for a command it does not own', () => {

            const panelState = RecipeCockpitService.buildInitialPanelState('');
            const otherTabsCommands = TAB_HOSTS.filter(otherTabHost => otherTabHost !== tabHost).flatMap(otherTabHost => otherTabHost.commands);

            [...otherTabsCommands, 'notACockpitCommand'].forEach(command => {
                expect(tabHost.routePanelMessage({ command: command }, panelState)).toBeUndefined();
            });

        });

        test('is handed its messages by the hub\'s router and executor', () => {

            const hubCalls = new Set<string>();
            visit(parse(hubFilePath), node => {
                if ( ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
                        && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === tabHost.hostClassName ) {
                    hubCalls.add(node.expression.name.text);
                }
            });

            expect(['routePanelMessage', 'executePanelAction'].filter(handOver => !hubCalls.has(handOver))).toEqual([]);

        });

        test('is the only host its pure modules are imported by, and the hub takes from them only what another tab still owes', () => {

            const strayImports: string[] = [];
            const hubUses: Omit<IHubUseStillOwed, 'owedBy'>[] = [];
            const hubSource = parse(hubFilePath);

            tabHost.pureModuleFileNames.forEach(pureModuleFileName => {
                const pureModulePath = path.join(COCKPIT_FOLDER, pureModuleFileName);
                const hubImportedNames: string[] = [];
                hostSideFiles.forEach(filePath => {
                    const sourceFile = parse(filePath);
                    const fileName = path.basename(filePath);
                    importsOf(sourceFile)
                        .filter(importDeclaration => resolvedImportPath(sourceFile, importDeclaration) === pureModulePath)
                        .forEach(importDeclaration => {
                            if ( filePath === hubFilePath ) {
                                // A NAMESPACE OR DEFAULT IMPORT WOULD HIDE WHICH NAMES THE HUB USES, SO ONLY NAMED IMPORTS COUNT AS OWED
                                const importClause = importDeclaration.importClause;
                                if ( importClause?.name || ( importClause?.namedBindings && !ts.isNamedImports(importClause.namedBindings) ) ) {
                                    strayImports.push(`${HUB_FILE_NAME}: ${importDeclaration.getText()}`);
                                }
                                hubImportedNames.push(...importedNames(importDeclaration));
                            } else if ( HOST_FILE_NAMES.includes(fileName) && !tabHost.hostFileNames.includes(fileName)
                                    && !( tabHost.sharedWithHosts ?? [] ).some(sharedWith => sharedWith.pureModuleFileName === pureModuleFileName && sharedWith.hostFileName === fileName) ) {
                                strayImports.push(`${fileName}: ${pureModuleFileName}`);
                            }
                        });
                });
                const hubMembers = new Set<string>();
                visit(hubSource, node => {
                    if ( ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && hubImportedNames.includes(node.expression.text) ) {
                        hubMembers.add(node.name.text);
                    }
                });
                if ( hubImportedNames.length > 0 ) {
                    hubUses.push({ pureModuleFileName: pureModuleFileName, importedNames: [...hubImportedNames].sort(), members: [...hubMembers].sort() });
                }
            });

            expect(strayImports).toEqual([]);
            // EXACT, SO AN ENTRY LEFT AFTER ITS SLICE MOVED THE USE OUT FAILS RATHER THAN STAYING ALLOWED
            expect(hubUses).toEqual(tabHost.hubUsesStillOwed.map(({ pureModuleFileName, importedNames: owedNames, members }) => ({
                pureModuleFileName: pureModuleFileName,
                importedNames: [...owedNames].sort(),
                members: [...members].sort()
            })));

        });

        // A SHARED MODULE IS TAKEN EXACTLY AS LISTED: A NEW NAME OR MEMBER FAILS, AND SO DOES AN ALLOWANCE NO IMPORT USES ANY MORE
        ( tabHost.sharedWithHosts ?? [] ).forEach(sharedWith => test(`shares ${sharedWith.pureModuleFileName} with ${sharedWith.hostFileName} exactly as listed`, () => {

            const sharingHostSource = parse(path.join(COCKPIT_FOLDER, sharedWith.hostFileName));
            const sharedModulePath = path.join(COCKPIT_FOLDER, sharedWith.pureModuleFileName);
            const takenNames = importsOf(sharingHostSource)
                .filter(importDeclaration => resolvedImportPath(sharingHostSource, importDeclaration) === sharedModulePath)
                .flatMap(importDeclaration => importedNames(importDeclaration));
            const takenMembers = new Set<string>();
            visit(sharingHostSource, node => {
                if ( ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && takenNames.includes(node.expression.text) ) {
                    takenMembers.add(node.name.text);
                }
            });

            expect([...takenNames].sort()).toEqual([...sharedWith.importedNames].sort());
            expect([...takenMembers].sort()).toEqual([...sharedWith.members].sort());

        }));

        test.each(tabHost.hostFileNames)('%s never loads the hub, directly or through another module, so the hub it is imported by never loads half-built', hostFileName => {

            const hostFilePath = path.join(COCKPIT_FOLDER, hostFileName);
            const loadedFrom = new Map<string, string>([[hostFilePath, '']]);
            const pendingPaths = [hostFilePath];
            while ( pendingPaths.length > 0 ) {
                const loadingPath = pendingPaths.shift() as string;
                runtimeImportPaths(parse(loadingPath))
                    .filter(loadedPath => !loadedFrom.has(loadedPath))
                    .forEach(loadedPath => {
                        loadedFrom.set(loadedPath, loadingPath);
                        pendingPaths.push(loadedPath);
                    });
            }

            const hubLoadChain: string[] = [];
            for ( let chainPath = hubFilePath; loadedFrom.has(chainPath) && chainPath !== ''; chainPath = loadedFrom.get(chainPath) as string ) {
                hubLoadChain.unshift(path.basename(chainPath));
            }

            expect(hubLoadChain).toEqual([]);

        });

        test.each(tabHost.hostFileNames)('%s loads only its own files listed after it, and another tab\'s host only as listed', hostFileName => {

            const hostFileIndex = tabHost.hostFileNames.indexOf(hostFileName);
            const loadedHostFileNames = runtimeImportPaths(parse(path.join(COCKPIT_FOLDER, hostFileName)))
                .filter(loadedPath => path.dirname(loadedPath) === COCKPIT_FOLDER && HOST_FILE_NAMES.includes(path.basename(loadedPath)))
                .map(loadedPath => path.basename(loadedPath));

            const ownFilesLoadedOutOfOrder = loadedHostFileNames.filter(loadedFileName => tabHost.hostFileNames.includes(loadedFileName)
                && tabHost.hostFileNames.indexOf(loadedFileName) <= hostFileIndex);
            const otherHostsLoaded = loadedHostFileNames.filter(loadedFileName => !tabHost.hostFileNames.includes(loadedFileName));
            const otherHostsListed = ( tabHost.loadsOtherHosts ?? [] ).filter(loadsOther => loadsOther.fileName === hostFileName).map(loadsOther => loadsOther.otherHostFileName);

            expect(ownFilesLoadedOutOfOrder).toEqual([]);
            expect([...new Set(otherHostsLoaded)].sort()).toEqual([...otherHostsListed].sort());

        });

        test('has its classes\' state written only by its own files', () => {

            const tabClassNames = tabHost.hostModules.flatMap(hostModule => Object.entries(hostModule))
                .filter(([, exportedValue]) => typeof exportedValue === 'function')
                .map(([exportedName]) => exportedName);
            const isTabClassMember = (node: ts.Node) => ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && tabClassNames.includes(node.expression.text);

            const writesFromOutside: string[] = [];
            hostSideFiles.filter(filePath => !hostFilePaths.includes(filePath)).forEach(filePath => {
                visit(parse(filePath), node => {
                    const isAssignment = ts.isBinaryExpression(node)
                        && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
                        && isTabClassMember(node.left);
                    const isIncrement = ( ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node) )
                        && ( node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken )
                        && isTabClassMember(node.operand);
                    if ( isAssignment || isIncrement ) {
                        writesFromOutside.push(`${path.basename(filePath)}: ${node.getText()}`);
                    }
                });
            });

            expect(writesFromOutside).toEqual([]);

        });

        test.each(tabHost.hostFileNames)('%s writes each import of several names one name per line', hostFileName => {

            const sourceFile = parse(path.join(COCKPIT_FOLDER, hostFileName));
            const crowdedImports = importsOf(sourceFile)
                .filter(importDeclaration => importedNames(importDeclaration).length > 1)
                .filter(importDeclaration => importDeclaration.getText().split('\n').length !== importedNames(importDeclaration).length + 2);

            expect(crowdedImports.map(importDeclaration => importDeclaration.getText())).toEqual([]);

        });

        test('is not re-exported by the hub: a test or a module reads a moved name from its host', () => {

            const reExportedNames = tabHost.hostModules.flatMap(hostModule => Object.keys(hostModule)).filter(exportedName => exportedName in RecipeCockpitServiceModule);
            // TYPES LEAVE NO RUNTIME NAME, SO AN export ... from THE HOST IS LOOKED FOR IN THE HUB'S SOURCE TOO
            const hubSource = parse(hubFilePath);
            const reExportsFromHost = hubSource.statements
                .filter(ts.isExportDeclaration)
                .filter(exportDeclaration => isRelativeSpecifier(exportDeclaration.moduleSpecifier) && hostFilePaths.includes(resolvedImportPath(hubSource, exportDeclaration)))
                .map(exportDeclaration => exportDeclaration.getText());

            expect(reExportedNames).toEqual([]);
            expect(reExportsFromHost).toEqual([]);

        });

    });

});
