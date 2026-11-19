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
import * as RecipeCockpitQueryHostModule from '../RecipeCockpitQueryHost';
import {
    RECIPE_COCKPIT_QUERY_ACTION_KINDS,
    RECIPE_COCKPIT_QUERY_COMMANDS
} from '../RecipeCockpitQueryHost';

const SOURCE_ROOT = path.join(__dirname, '..', '..', '..', '..');
const COCKPIT_FOLDER = path.join(__dirname, '..');
const HUB_FILE_NAME = 'RecipeCockpitService.ts';

interface ITabHost {
    tabName: string;
    hostClassName: string;
    hostFileName: string;
    hostModule: Record<string, unknown>;
    commands: readonly string[];
    actionKinds: readonly string[];
    // A PURE MODULE ONLY THIS TAB'S HOST MAY IMPORT, OF THE HOSTS AND THE HUB
    pureModuleFileNames: string[];
    // WHAT THE HUB STILL TAKES FROM THOSE MODULES FOR A TAB NOT MOVED YET, AND THE SLICE THAT MOVES IT; EMPTIED AS THE SLICES LAND
    hubUsesStillOwed: { importedNames: string[]; members: string[]; movedBy: string };
}

/*
    One row per tab whose host half is out of the hub (#566). A tab's panel commands and action
    kinds have a case in its host and nowhere else, so a reader looking for what a Query message does
    opens one file; and the hub never runs a host's work for it, only hands the message over.
*/
const TAB_HOSTS: ITabHost[] = [
    {
        tabName: 'Query',
        hostClassName: 'RecipeCockpitQueryHost',
        hostFileName: 'RecipeCockpitQueryHost.ts',
        hostModule: RecipeCockpitQueryHostModule,
        commands: RECIPE_COCKPIT_QUERY_COMMANDS,
        actionKinds: RECIPE_COCKPIT_QUERY_ACTION_KINDS,
        pureModuleFileNames: ['RecipeCockpitQuery.ts'],
        hubUsesStillOwed: {
            importedNames: ['IRecipeCockpitPreviewRecordLinks', 'RECIPE_COCKPIT_QUERY_CONNECTION_FAILED_ADVICE', 'RECIPE_COCKPIT_QUERY_RECORD_CAP', 'RECIPE_COCKPIT_QUERY_VALUE_BUDGET', 'RecipeCockpitQuery'],
            members: ['buildPreview', 'countValues', 'fetchQueryRecords'],
            movedBy: '#668, the Treecipe Adapter host: its load, update and restore read through the same pages and preview'
        }
    }
];

const HOST_FILE_NAMES = TAB_HOSTS.map(tabHost => tabHost.hostFileName);

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

const stringLiterals = (sourceFile: ts.SourceFile): string[] => {
    const literals: string[] = [];
    visit(sourceFile, node => {
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
const hubFilePath = path.join(COCKPIT_FOLDER, HUB_FILE_NAME);

describe('Recipe Cockpit tab hosts (#566)', () => {

    describe.each(TAB_HOSTS)('the $tabName tab', tabHost => {

        const hostFilePath = path.join(COCKPIT_FOLDER, tabHost.hostFileName);

        test('has a case for each of its commands and action kinds in its host', () => {

            const hostLabels = caseLabels(parse(hostFilePath));

            expect([...tabHost.commands, ...tabHost.actionKinds].filter(ownedName => !hostLabels.includes(ownedName))).toEqual([]);

        });

        // NOT ONLY A case: AN if ON THE COMMAND OR A LOOKUP TABLE NAMES IT AS A STRING TOO
        test('names its commands and action kinds nowhere outside its host', () => {

            const ownedNames = new Set([...tabHost.commands, ...tabHost.actionKinds]);
            const strayNames = hostSideFiles
                .filter(filePath => filePath !== hostFilePath)
                .flatMap(filePath => stringLiterals(parse(filePath)).filter(literal => ownedNames.has(literal)).map(literal => `${path.relative(SOURCE_ROOT, filePath)}: '${literal}'`));

            expect(strayNames).toEqual([]);

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

            const pureModulePaths = tabHost.pureModuleFileNames.map(fileName => path.join(COCKPIT_FOLDER, fileName));
            const strayImports: string[] = [];
            const hubImportedNames: string[] = [];

            hostSideFiles.forEach(filePath => {
                const sourceFile = parse(filePath);
                const fileName = path.basename(filePath);
                importsOf(sourceFile)
                    .filter(importDeclaration => pureModulePaths.includes(resolvedImportPath(sourceFile, importDeclaration)))
                    .forEach(importDeclaration => {
                        if ( filePath === hubFilePath ) {
                            // A NAMESPACE OR DEFAULT IMPORT WOULD HIDE WHICH NAMES THE HUB USES, SO ONLY NAMED IMPORTS COUNT AS OWED
                            const importClause = importDeclaration.importClause;
                            if ( importClause?.name || ( importClause?.namedBindings && !ts.isNamedImports(importClause.namedBindings) ) ) {
                                strayImports.push(`${HUB_FILE_NAME}: ${importDeclaration.getText()}`);
                            }
                            hubImportedNames.push(...importedNames(importDeclaration));
                        } else if ( HOST_FILE_NAMES.includes(fileName) && fileName !== tabHost.hostFileName ) {
                            strayImports.push(fileName);
                        }
                    });
            });

            const hubMembers = new Set<string>();
            visit(parse(hubFilePath), node => {
                if ( ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && hubImportedNames.includes(node.expression.text) ) {
                    hubMembers.add(node.name.text);
                }
            });

            expect(strayImports).toEqual([]);
            // EXACT, SO AN ENTRY LEFT AFTER ITS SLICE MOVED THE USE OUT FAILS RATHER THAN STAYING ALLOWED
            expect([...hubImportedNames].sort()).toEqual([...tabHost.hubUsesStillOwed.importedNames].sort());
            expect([...hubMembers].sort()).toEqual([...tabHost.hubUsesStillOwed.members].sort());

        });

        test('never loads the hub, directly or through another module, so the hub it is imported by never loads half-built', () => {

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

        test('writes each import of several names one name per line', () => {

            const sourceFile = parse(hostFilePath);
            const crowdedImports = importsOf(sourceFile)
                .filter(importDeclaration => importedNames(importDeclaration).length > 1)
                .filter(importDeclaration => importDeclaration.getText().split('\n').length !== importedNames(importDeclaration).length + 2);

            expect(crowdedImports.map(importDeclaration => importDeclaration.getText())).toEqual([]);

        });

        test('is not re-exported by the hub: a test or a module reads a moved name from its host', () => {

            const reExportedNames = Object.keys(tabHost.hostModule).filter(exportedName => exportedName in RecipeCockpitServiceModule);
            // TYPES LEAVE NO RUNTIME NAME, SO AN export ... from THE HOST IS LOOKED FOR IN THE HUB'S SOURCE TOO
            const hubSource = parse(hubFilePath);
            const reExportsFromHost = hubSource.statements
                .filter(ts.isExportDeclaration)
                .filter(exportDeclaration => isRelativeSpecifier(exportDeclaration.moduleSpecifier) && resolvedImportPath(hubSource, exportDeclaration) === hostFilePath)
                .map(exportDeclaration => exportDeclaration.getText());

            expect(reExportedNames).toEqual([]);
            expect(reExportsFromHost).toEqual([]);

        });

    });

});
