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

const resolvedImportPath = (sourceFile: ts.SourceFile, importDeclaration: ts.ImportDeclaration): string =>
    path.resolve(path.dirname(sourceFile.fileName), `${(importDeclaration.moduleSpecifier as ts.StringLiteral).text}.ts`);

const importedNames = (importDeclaration: ts.ImportDeclaration): string[] => {
    const namedBindings = importDeclaration.importClause?.namedBindings;
    return namedBindings && ts.isNamedImports(namedBindings) ? namedBindings.elements.map(importSpecifier => importSpecifier.name.text) : [];
};

const hostSideFiles = listHostSideFiles(SOURCE_ROOT).concat([path.join(SOURCE_ROOT, 'extension.ts')].filter(filePath => fs.existsSync(filePath)));

describe('Recipe Cockpit tab hosts (#566)', () => {

    describe.each(TAB_HOSTS)('the $tabName tab', tabHost => {

        const hostFilePath = path.join(COCKPIT_FOLDER, tabHost.hostFileName);

        test('has a case for each of its commands and action kinds in its host', () => {

            const hostLabels = caseLabels(parse(hostFilePath));

            expect([...tabHost.commands, ...tabHost.actionKinds].filter(ownedName => !hostLabels.includes(ownedName))).toEqual([]);

        });

        test('has no case for its commands or action kinds outside its host', () => {

            const ownedNames = new Set([...tabHost.commands, ...tabHost.actionKinds]);
            const strayCases = hostSideFiles
                .filter(filePath => filePath !== hostFilePath)
                .flatMap(filePath => caseLabels(parse(filePath)).filter(label => ownedNames.has(label)).map(label => `${path.relative(SOURCE_ROOT, filePath)}: case '${label}'`));

            expect(strayCases).toEqual([]);

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
                        if ( filePath === path.join(COCKPIT_FOLDER, HUB_FILE_NAME) ) {
                            hubImportedNames.push(...importedNames(importDeclaration));
                        } else if ( HOST_FILE_NAMES.includes(fileName) && fileName !== tabHost.hostFileName ) {
                            strayImports.push(fileName);
                        }
                    });
            });

            const hubMembers = new Set<string>();
            visit(parse(path.join(COCKPIT_FOLDER, HUB_FILE_NAME)), node => {
                if ( ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && hubImportedNames.includes(node.expression.text) ) {
                    hubMembers.add(node.name.text);
                }
            });

            expect(strayImports).toEqual([]);
            expect(hubImportedNames.filter(importedName => !tabHost.hubUsesStillOwed.importedNames.includes(importedName))).toEqual([]);
            expect([...hubMembers].filter(member => !tabHost.hubUsesStillOwed.members.includes(member))).toEqual([]);

        });

        test('imports the hub only for its types, so the hub it is imported by never loads half-built', () => {

            const sourceFile = parse(hostFilePath);
            const runtimeHubImports = importsOf(sourceFile)
                .filter(importDeclaration => resolvedImportPath(sourceFile, importDeclaration) === path.join(COCKPIT_FOLDER, HUB_FILE_NAME))
                .filter(importDeclaration => !importDeclaration.importClause?.isTypeOnly);

            expect(runtimeHubImports.map(importDeclaration => importDeclaration.getText())).toEqual([]);

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

            expect(reExportedNames).toEqual([]);

        });

    });

});
