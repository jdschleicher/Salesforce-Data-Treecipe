import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { faker } from '@faker-js/faker';

/*
    Golden test of the generation commands (#571): treecipe.generateTreecipe on the mock metadata,
    then treecipe.runFakerByRecipe on every recipe it wrote, each run through the command activate()
    registers. Every file they write is compared byte for byte with tests/golden/ -- so a later move
    of a service (#572, #574, #575) can show that a user gets exactly what they got before.

    Only vscode is mocked: workspace.fs reads the real disk, configuration is an in-memory settings
    store, and every notification is recorded. Nothing reaches an org, the network or the snowfakery
    CLI, which is why the snowfakery run compares what generation writes and stops there.

    Run with UPDATE_GOLDEN=1 to rewrite the expected files, and say in the PR what a user now gets
    differently.
*/

type DirectoryEntry = [string, number];

/*
    readDirectory lists in the file system's order on a real machine, and today that order reaches the
    output: listing the same folders in reverse renumbers the relationship trees and reorders fields.
    Listed sorted here, so these expected files hold on every machine.
*/
const mockDirectoryListing = {
    order(directoryEntries: DirectoryEntry[]): DirectoryEntry[] {
        return [...directoryEntries].sort(([firstName], [secondName]) => ( firstName < secondName ? -1 : ( firstName > secondName ? 1 : 0 ) ));
    }
};

const mockVscodeHost = {
    workspaceRootPath: '',
    settings: new Map<string, unknown>(),
    registeredCommands: new Map<string, (...commandArguments: unknown[]) => unknown>(),
    notifications: [] as { kind: string; message: string }[]
};

jest.mock('vscode', () => {

    const realFs = jest.requireActual('fs');
    const realPath = jest.requireActual('path');
    const toUri = (fsPath: string) => ({ fsPath: fsPath, path: fsPath, scheme: 'file', toString: () => `file://${fsPath}` });
    const disposable = () => ({ dispose: () => undefined });
    const noEvent = () => disposable();
    const recordNotification = (kind: string) => async (message: string, ...notificationOptions: unknown[]) => {
        mockVscodeHost.notifications.push({ kind, message });
        // RUN FAKER'S MODAL ASKS BEFORE IT GENERATES; THE GOLDEN RUN ANSWERS AS A USER WHO CLICKED "Generate Data"
        return notificationOptions.includes('Generate Data') ? 'Generate Data' : undefined;
    };

    class EventEmitter {
        event = noEvent;
        fire() { return undefined; }
        dispose() { return undefined; }
    }

    class TreeItem {
        constructor(public label: string, public collapsibleState?: number) {}
    }

    class ThemeIcon {
        constructor(public id: string) {}
    }

    return {
        workspace: {
            get workspaceFolders() {
                return [{ uri: toUri(mockVscodeHost.workspaceRootPath), name: 'goldenWorkspace', index: 0 }];
            },
            getConfiguration: () => ({
                get: (settingKey: string) => mockVscodeHost.settings.get(settingKey),
                inspect: (settingKey: string) => ({ key: settingKey, workspaceValue: mockVscodeHost.settings.get(settingKey) }),
                update: async (settingKey: string, settingValue: unknown) => { mockVscodeHost.settings.set(settingKey, settingValue); }
            }),
            fs: {
                readDirectory: async (directoryUri: { fsPath: string }) => {
                    const directoryEntries = realFs.readdirSync(directoryUri.fsPath, { withFileTypes: true })
                        .map((entry: { name: string; isDirectory: () => boolean }) => [entry.name, entry.isDirectory() ? 2 : 1]);
                    return mockDirectoryListing.order(directoryEntries);
                },
                readFile: async (fileUri: { fsPath: string }) => realFs.readFileSync(fileUri.fsPath),
                stat: async (fileUri: { fsPath: string }) => {
                    const fileStat = realFs.statSync(fileUri.fsPath);
                    return { type: fileStat.isDirectory() ? 2 : 1, ctime: 0, mtime: 0, size: fileStat.size };
                }
            },
            onDidChangeConfiguration: noEvent,
            onDidChangeWorkspaceFolders: noEvent,
            createFileSystemWatcher: () => ({ onDidCreate: noEvent, onDidChange: noEvent, onDidDelete: noEvent, dispose: () => undefined })
        },
        window: {
            showInformationMessage: recordNotification('information'),
            showWarningMessage: recordNotification('warning'),
            showErrorMessage: recordNotification('error'),
            withProgress: async (_progressOptions: unknown, task: (progress: unknown, token: unknown) => Promise<unknown>) => task(
                { report: () => undefined },
                { isCancellationRequested: false, onCancellationRequested: noEvent }
            ),
            createStatusBarItem: () => ({ show: () => undefined, hide: () => undefined, dispose: () => undefined }),
            createOutputChannel: () => ({ appendLine: () => undefined, append: () => undefined, show: () => undefined, clear: () => undefined, dispose: () => undefined }),
            registerTreeDataProvider: disposable
        },
        commands: {
            registerCommand: (commandId: string, commandHandler: (...commandArguments: unknown[]) => unknown) => {
                mockVscodeHost.registeredCommands.set(commandId, commandHandler);
                return disposable();
            },
            // A COMMAND activate() REGISTERED RUNS; ANY OTHER (setContext, markdown.showPreview) IS VS CODE'S OWN AND DOES NOTHING HERE
            executeCommand: async (commandId: string, ...commandArguments: unknown[]) => mockVscodeHost.registeredCommands.get(commandId)?.(...commandArguments)
        },
        Uri: {
            file: toUri,
            parse: (uriText: string) => toUri(uriText.replace(/^file:\/\//, '')),
            joinPath: (baseUri: { fsPath: string }, ...pathSegments: string[]) => toUri(realPath.join(baseUri.fsPath, ...pathSegments))
        },
        EventEmitter,
        TreeItem,
        ThemeIcon,
        TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
        StatusBarAlignment: { Left: 1, Right: 2 },
        ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
        ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
        FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 }
    };

}, { virtual: true });

import * as vscode from 'vscode';
import { activate } from '../../../../extension';
import { buildUnifiedDiff } from './UnifiedDiff';

const MOCK_METADATA_DIRECTORY_PATH = path.resolve(__dirname, '../../DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory');
const GOLDEN_DIRECTORY_PATH = path.join(__dirname, 'golden');
const IS_UPDATING_GOLDEN_FILES = process.env.UPDATE_GOLDEN === '1';

// THE CLOCK EVERY RUN READS; ITS TIMESTAMPS IN FILE NAMES AND FILE TEXT BECOME {TIMESTAMP}
const FIXED_RUN_INSTANT = new Date('2026-01-02T03:04:05.000Z');
const FIXED_FOLDER_TIMESTAMP = '2026-01-02T03-04-05';
const FAKER_SEED = 571;

// ONLY Date IS FAKED: GENERATION AWAITS REAL FILE WRITES AND PROMISES, WHICH NEED REAL TIMERS
type RealTimerAPI = 'hrtime' | 'nextTick' | 'performance' | 'queueMicrotask' | 'requestAnimationFrame' | 'cancelAnimationFrame'
    | 'requestIdleCallback' | 'cancelIdleCallback' | 'setImmediate' | 'clearImmediate' | 'setInterval' | 'clearInterval' | 'setTimeout' | 'clearTimeout';
const REAL_TIMER_APIS: RealTimerAPI[] = ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
    'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'];

type GoldenFiles = Map<string, string>;

interface IGoldenRun {
    runName: string;
    selectedFakerService: 'faker-js' | 'snowfakery';
    isFakeDataGenerated: boolean;
}

// faker-js NESTS EVERY CHILD UNDER ITS PARENT'S friends: (#46) -- THERE IS NO FLAT faker-js RECIPE, SO THIS RUN IS THE NESTED ONE
const GOLDEN_RUNS: IGoldenRun[] = [
    { runName: 'faker-js', selectedFakerService: 'faker-js', isFakeDataGenerated: true },
    { runName: 'snowfakery', selectedFakerService: 'snowfakery', isFakeDataGenerated: false }
];

const toForwardSlashPath = (filePath: string) => filePath.split(path.sep).join('/');

function listFilesBelow(directoryPath: string): string[] {

    if ( !fs.existsSync(directoryPath) ) {
        return [];
    }

    return fs.readdirSync(directoryPath, { withFileTypes: true }).flatMap(entry => {
        const entryPath = path.join(directoryPath, entry.name);
        return entry.isDirectory() ? listFilesBelow(entryPath) : [entryPath];
    }).sort();

}

function normalizeRunText(runText: string): string {

    return runText
        .split(mockVscodeHost.workspaceRootPath).join('{WORKSPACE}')
        .split(FIXED_FOLDER_TIMESTAMP).join('{TIMESTAMP}')
        .split(FIXED_RUN_INSTANT.toISOString()).join('{TIMESTAMP}');

}

function fillGoldenWorkspace(workspaceRootPath: string, goldenRun: IGoldenRun) {

    fs.cpSync(MOCK_METADATA_DIRECTORY_PATH, path.join(workspaceRootPath, 'force-app', 'main', 'default'), { recursive: true });
    fs.mkdirSync(path.join(workspaceRootPath, 'treecipe'));
    fs.writeFileSync(path.join(workspaceRootPath, 'treecipe', 'treecipe.config.json'), JSON.stringify({
        salesforceObjectsPath: './force-app/main/default/objects',
        dataFakerService: goldenRun.selectedFakerService
    }, null, 4));

}

/*
    What the commands wrote, keyed by a path that names no time and no machine:
    GeneratedRecipes/<every file of the run folder> and, for faker-js,
    FakeDataSets/<tree folder>/collectionsApi-<Object>.json for the data set made from that tree's recipe.
*/
async function runGenerationCommands(goldenRun: IGoldenRun): Promise<GoldenFiles> {

    const workspaceRootPath = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `treecipe-golden-${goldenRun.runName}-`)));
    mockVscodeHost.workspaceRootPath = workspaceRootPath;
    mockVscodeHost.settings = new Map<string, unknown>([['selectedFakerService', goldenRun.selectedFakerService]]);
    mockVscodeHost.registeredCommands.clear();
    mockVscodeHost.notifications = [];

    const goldenFiles: GoldenFiles = new Map();

    try {

        fillGoldenWorkspace(workspaceRootPath, goldenRun);
        await activate({ subscriptions: [], workspaceState: { get: () => undefined, update: async () => undefined } } as unknown as vscode.ExtensionContext);
        await vscode.commands.executeCommand('treecipe.generateTreecipe');

        const generatedRecipesPath = path.join(workspaceRootPath, 'treecipe', 'GeneratedRecipes');
        const [runFolderName] = fs.readdirSync(generatedRecipesPath);
        const runFolderPath = path.join(generatedRecipesPath, runFolderName);
        const runFilePaths = listFilesBelow(runFolderPath);

        runFilePaths.forEach(runFilePath => {
            goldenFiles.set(normalizeRunText(`GeneratedRecipes/${toForwardSlashPath(path.relative(generatedRecipesPath, runFilePath))}`), normalizeRunText(fs.readFileSync(runFilePath, 'utf8')));
        });

        if ( goldenRun.isFakeDataGenerated ) {

            for ( const recipeFilePath of runFilePaths.filter(runFilePath => runFilePath.endsWith('.yml')) ) {

                faker.seed(FAKER_SEED);
                const datasetFolderPath = await vscode.commands.executeCommand<string | undefined>('treecipe.runFakerByRecipe', recipeFilePath);
                const treeFolderName = path.basename(path.dirname(recipeFilePath));

                // A RUN THAT WROTE NO DATA SET WOULD OTHERWISE LET UPDATE_GOLDEN=1 DROP ITS EXPECTED FILES UNNOTICED
                expect({ recipeFilePath, datasetFolderPath }).toEqual({ recipeFilePath, datasetFolderPath: expect.any(String) });

                listFilesBelow(path.join(datasetFolderPath, 'DatasetFilesForCollectionsApi')).forEach(collectionsApiFilePath => {
                    goldenFiles.set(`FakeDataSets/${treeFolderName}/${path.basename(collectionsApiFilePath)}`, normalizeRunText(fs.readFileSync(collectionsApiFilePath, 'utf8')));
                });

            }

        }

        // A RUN THAT REPORTED A FAILURE IS NOT A GOLDEN RUN, WHATEVER IT WROTE
        expect(mockVscodeHost.notifications.filter(notification => notification.kind === 'error')).toEqual([]);

    } finally {
        fs.rmSync(workspaceRootPath, { recursive: true, force: true });
    }

    return goldenFiles;

}

function readGoldenFiles(runName: string): GoldenFiles {

    const goldenRunPath = path.join(GOLDEN_DIRECTORY_PATH, runName);
    return new Map(listFilesBelow(goldenRunPath).map(goldenFilePath => [
        toForwardSlashPath(path.relative(goldenRunPath, goldenFilePath)),
        fs.readFileSync(goldenFilePath, 'utf8')
    ]));

}

function writeGoldenFiles(runName: string, goldenFiles: GoldenFiles) {

    const goldenRunPath = path.join(GOLDEN_DIRECTORY_PATH, runName);
    fs.rmSync(goldenRunPath, { recursive: true, force: true });
    goldenFiles.forEach((fileText, goldenFileName) => {
        const goldenFilePath = path.join(goldenRunPath, ...goldenFileName.split('/'));
        fs.mkdirSync(path.dirname(goldenFilePath), { recursive: true });
        fs.writeFileSync(goldenFilePath, fileText);
    });

}

export function compareWithGoldenFiles(runName: string, expectedFiles: GoldenFiles, generatedFiles: GoldenFiles): string[] {

    const fileNames = [...new Set([...expectedFiles.keys(), ...generatedFiles.keys()])].sort();

    return fileNames.flatMap(goldenFileName => {
        const expectedText = expectedFiles.get(goldenFileName);
        const generatedText = generatedFiles.get(goldenFileName);
        if ( expectedText === undefined ) {
            return [`golden/${runName}/${goldenFileName} is written now but has no expected file.`];
        }
        if ( generatedText === undefined ) {
            return [`golden/${runName}/${goldenFileName} is expected but was not written.`];
        }
        return expectedText === generatedText ? [] : [buildUnifiedDiff(`${runName}/${goldenFileName}`, expectedText, generatedText)];
    });

}

const failOnGoldenMismatch = (mismatchReports: string[]) => {
    if ( mismatchReports.length > 0 ) {
        throw new Error(`${mismatchReports.length} generated file(s) differ from tests/golden/. If the change is intended, run with UPDATE_GOLDEN=1 and say in the PR what a user now gets differently.\n\n${mismatchReports.join('\n\n')}`);
    }
};

describe('Generate Treecipe and Run Faker by Recipe write exactly the golden files (#571)', () => {

    beforeEach(() => {
        jest.useFakeTimers({ now: FIXED_RUN_INSTANT, doNotFake: REAL_TIMER_APIS });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test.each(GOLDEN_RUNS)('$runName', async (goldenRun) => {

        const generatedFiles = await runGenerationCommands(goldenRun);

        if ( IS_UPDATING_GOLDEN_FILES ) {
            writeGoldenFiles(goldenRun.runName, generatedFiles);
        }

        expect(generatedFiles.size).toBeGreaterThan(0);
        failOnGoldenMismatch(compareWithGoldenFiles(goldenRun.runName, readGoldenFiles(goldenRun.runName), generatedFiles));

    }, 120000);

    // A NEW TEMP WORKSPACE, A NEW ACTIVATION AND THE SAME SEED: NOTHING CARRIED OVER FROM THE FIRST RUN MAY CHANGE A BYTE
    test('a second faker-js run in a row writes the same files as the first', async () => {

        const firstRunFiles = await runGenerationCommands(GOLDEN_RUNS[0]);
        const secondRunFiles = await runGenerationCommands(GOLDEN_RUNS[0]);

        failOnGoldenMismatch(compareWithGoldenFiles(GOLDEN_RUNS[0].runName, firstRunFiles, secondRunFiles));

    }, 120000);

    describe('the comparison itself', () => {

        test('a changed line is reported as a unified diff naming the file and the line', () => {

            const expectedFiles: GoldenFiles = new Map([['GeneratedRecipes/tree/recipe.yml', 'one\ntwo\nthree\nfour\n']]);
            const generatedFiles: GoldenFiles = new Map([['GeneratedRecipes/tree/recipe.yml', 'one\ntwo\nTHREE\nfour\n']]);

            expect(compareWithGoldenFiles('faker-js', expectedFiles, generatedFiles)).toEqual([[
                '--- golden/faker-js/GeneratedRecipes/tree/recipe.yml',
                '+++ generated/faker-js/GeneratedRecipes/tree/recipe.yml',
                '@@ line 1 (first change at line 3) @@',
                ' one',
                ' two',
                '-three',
                '+THREE',
                ' four',
                ' '
            ].join('\n')]);

        });

        test('a file rewritten past the alignment limit is shown as every old line out and every new line in', () => {

            const expectedText = Array.from({ length: 2001 }, (_, lineIndex) => `old ${lineIndex}`).join('\n');
            const actualText = Array.from({ length: 2001 }, (_, lineIndex) => `new ${lineIndex}`).join('\n');
            const diffLines = buildUnifiedDiff('faker-js/large.json', expectedText, actualText).split('\n');

            expect(diffLines.slice(2, 4)).toEqual(['@@ line 1 (first change at line 1) @@', '-old 0']);
            expect(diffLines[2 + 2001]).toBe('-old 2000');
            expect(diffLines[2 + 2002]).toBe('+new 0');
            expect(diffLines).toHaveLength(3 + 4002);

        });

        test('a line ending is a difference', () => {

            const mismatchReports = compareWithGoldenFiles('snowfakery', new Map([['a.md', 'line\n']]), new Map([['a.md', 'line\r\n']]));
            expect(mismatchReports).toHaveLength(1);
            expect(mismatchReports[0]).toContain('first change at line 1');

        });

        test('a missing and an extra file are each named', () => {

            expect(compareWithGoldenFiles('faker-js', new Map([['gone.yml', 'x']]), new Map([['new.yml', 'x']]))).toEqual([
                'golden/faker-js/gone.yml is expected but was not written.',
                'golden/faker-js/new.yml is written now but has no expected file.'
            ]);

        });

    });

});
