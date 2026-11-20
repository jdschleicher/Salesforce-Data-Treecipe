import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

jest.mock('vscode', () => ({
    window: { createWebviewPanel: jest.fn(), withProgress: jest.fn(), showWarningMessage: jest.fn(), showInformationMessage: jest.fn(), showInputBox: jest.fn() },
    commands: { executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    ProgressLocation: { Notification: 15 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }) }
}), { virtual: true });

import { RecipeCockpitService } from '../RecipeCockpitService';
import { RecipeCockpitCustomTreecipe } from '../RecipeCockpitCustomTreecipe';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { SfdxProjectService } from '../../SfdxProjectService/SfdxProjectService';
import { answerInPanelConfirmationsThroughWarningMock } from './RecipeCockpitConfirmationAnswers';

const FIXTURE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'historyWorkspace');
const RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const SOURCE_TREE_KEY = 'Account-thru-OtherChildObject__c';
const SOURCE_RECIPE_FILE_NAME = `recipe--${SOURCE_TREE_KEY}-2026-09-20T10-00-00.yml`;
const CUSTOM_FOLDER_NAME = `custom-${SOURCE_TREE_KEY}`;

const buildWorkspaceState = () => {
    const storedValues = new Map<string, unknown>();
    return {
        storedValues,
        get: jest.fn((key: string) => storedValues.get(key)) as jest.Mock,
        update: jest.fn((key: string, value: unknown) => {
            if ( value === undefined ) { storedValues.delete(key); } else { storedValues.set(key, JSON.parse(JSON.stringify(value))); }
            return Promise.resolve();
        }) as jest.Mock
    };
};

answerInPanelConfirmationsThroughWarningMock();

describe('RecipeCockpitService, "Customize and create new recipe" (#677)', () => {

    let workspaceRoot: string;
    let runFolderPath: string;
    let receivedMessageHandler: (panelMessage: any) => Promise<void>;
    let disposeHandler: (() => void) | undefined;
    let postedPanelMessages: any[];

    const lastPosted = (command: string) => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === command);
    const drawLatestModel = async () => {
        const recipeDataMessage = lastPosted('recipeData');
        await receivedMessageHandler({ command: 'rendered', renderSequence: recipeDataMessage.renderSequence });
        return recipeDataMessage;
    };
    const openAndDraw = async () => {
        await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, buildWorkspaceState());
        await receivedMessageHandler({ command: 'ready' });
        return drawLatestModel();
    };
    const removal = (overrides: Record<string, unknown> = {}) => ({ removedObjectApiNames: [], removedFields: [], outOfRunObjectApiNames: [], ...overrides });

    beforeEach(() => {
        workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-treecipe-'));
        fs.cpSync(FIXTURE_WORKSPACE_ROOT, workspaceRoot, { recursive: true });
        runFolderPath = path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes', RUN_FOLDER_NAME);
        RecipeCockpitService.selectedCustomTreeFolderNameByRunFolderName.clear();
        postedPanelMessages = [];
        (vscode.window.showInformationMessage as jest.Mock).mockReset().mockResolvedValue(undefined);
        (vscode.window.showWarningMessage as jest.Mock).mockClear();
        (vscode.window.createWebviewPanel as jest.Mock).mockImplementation(() => ({
            reveal: jest.fn(),
            dispose: jest.fn(),
            onDidDispose: jest.fn().mockImplementation((handler: () => void) => { disposeHandler = handler; return { dispose: jest.fn() }; }),
            webview: {
                html: '',
                postMessage: jest.fn().mockImplementation((hostMessage: any) => { postedPanelMessages.push(hostMessage); return Promise.resolve(true); }),
                onDidReceiveMessage: jest.fn().mockImplementation((messageHandler: (panelMessage: any) => Promise<void>) => {
                    receivedMessageHandler = messageHandler;
                    return { dispose: jest.fn() };
                })
            }
        }));
        jest.spyOn(VSCodeWorkspaceService, 'createStatusBarPhaseItem').mockImplementation((initialMessage: string) => ({ text: initialMessage, dispose: jest.fn() }) as any);
    });

    afterEach(() => {
        disposeHandler?.();
        disposeHandler = undefined;
        RecipeCockpitService.selectedCustomTreeFolderNameByRunFolderName.clear();
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
    });

    describe('previewCustomTreecipe', () => {

        it('answers the card\'s own cascade for the removals, and where Save would write', async () => {

            const recipeDataMessage = await openAndDraw();

            await receivedMessageHandler({
                command: 'previewCustomTreecipe', treeKey: SOURCE_TREE_KEY, renderSequence: recipeDataMessage.renderSequence, previewSequence: 4,
                ...removal({ removedFields: [{ objectApiName: 'Contact', fieldApiName: 'AccountId' }], outOfRunObjectApiNames: ['Account'] })
            });

            const preview = lastPosted('customTreecipePreview');
            expect(preview).toMatchObject({
                treeKey: SOURCE_TREE_KEY,
                previewSequence: 4,
                keptObjectCount: 1,
                objectCount: 3,
                folderName: CUSTOM_FOLDER_NAME
            });
            expect(preview.objectSelection.exclusions).toEqual([
                { objectApiName: 'Contact', kind: 'autoExcluded', removedLookupFieldApiName: 'AccountId' },
                { objectApiName: 'OtherChildObject__c', kind: 'autoExcluded', excludedParentObjectApiName: 'Contact' }
            ]);
            expect(preview.outOfRunExclusions).toEqual([{ objectApiName: 'Account', kind: 'excluded' }]);

        });

        it.each([
            ['an object the card does not draw', removal({ removedObjectApiNames: ['Opportunity'] })],
            ['a field the card does not draw', removal({ removedFields: [{ objectApiName: 'Contact', fieldApiName: 'Email' }] })],
            ['a field that is not a record', removal({ removedFields: ['Contact.AccountId'] })],
            ['a list that is not a list', removal({ outOfRunObjectApiNames: 'Account' })]
        ])('answers nothing for %s', async (_, postedRemoval) => {

            const recipeDataMessage = await openAndDraw();

            await receivedMessageHandler({ command: 'previewCustomTreecipe', treeKey: SOURCE_TREE_KEY, renderSequence: recipeDataMessage.renderSequence, previewSequence: 1, ...postedRemoval });

            expect(lastPosted('customTreecipePreview')).toBeUndefined();

        });

        it.each([
            ['a preview sequence that is not a whole number', { command: 'previewCustomTreecipe', previewSequence: -1 }],
            ['a save name longer than 80 characters', { command: 'saveCustomTreecipe', name: 'x'.repeat(81) }],
            ['a card with no recipe of its own', { command: 'previewCustomTreecipe', previewSequence: 1, treeKey: 'Account-thru-Contact' }]
        ])('routes nothing for %s', (_, postedFields) => {

            const panelState = {
                recipeDataMessage: { renderSequence: 2, recipe: { trees: [] } },
                treeHistoryAllowLists: { nameableTreeKeys: new Set([SOURCE_TREE_KEY, 'Account-thru-Contact']), selectableObjectKeys: new Set(), selectableFieldKeys: new Set() },
                treeHistoryTargets: { runFakerRecipeFilePathsByTreeKey: new Map([[SOURCE_TREE_KEY, '/recipe.yml']]) }
            } as any;

            expect(RecipeCockpitService.routePanelMessage({ treeKey: SOURCE_TREE_KEY, renderSequence: 2, ...removal(), ...postedFields } as any, panelState)).toBeUndefined();

        });

        it('answers nothing for a model the panel has not drawn', async () => {

            const recipeDataMessage = await openAndDraw();

            await receivedMessageHandler({ command: 'previewCustomTreecipe', treeKey: SOURCE_TREE_KEY, renderSequence: recipeDataMessage.renderSequence + 1, previewSequence: 1, ...removal() });

            expect(lastPosted('customTreecipePreview')).toBeUndefined();

        });

    });

    describe('saveCustomTreecipe', () => {

        it('writes custom-<tree> beside the source with the filtered recipe and customTreecipe.json, leaves the source as it was, and opens the custom tree', async () => {

            const sourceRecipeFilePath = path.join(runFolderPath, SOURCE_TREE_KEY, SOURCE_RECIPE_FILE_NAME);
            const sourceRecipeBefore = fs.readFileSync(sourceRecipeFilePath);
            const recipeDataMessage = await openAndDraw();

            await receivedMessageHandler({
                command: 'saveCustomTreecipe', treeKey: SOURCE_TREE_KEY, renderSequence: recipeDataMessage.renderSequence, name: ' Accounts only ',
                ...removal({ removedFields: [{ objectApiName: 'Contact', fieldApiName: 'AccountId' }, { objectApiName: 'Account', fieldApiName: 'Legacy_Code__c' }] })
            });

            const customFolderPath = path.join(runFolderPath, CUSTOM_FOLDER_NAME);
            const customFileNames = fs.readdirSync(customFolderPath).sort();
            expect(customFileNames).toHaveLength(2);
            expect(customFileNames[0]).toBe('customTreecipe.json');
            expect(customFileNames[1]).toMatch(new RegExp(`^recipe--${CUSTOM_FOLDER_NAME}-\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}\\.yml$`));

            const customRecipeText = fs.readFileSync(path.join(customFolderPath, customFileNames[1]), 'utf8');
            expect(customRecipeText).toContain('- object: Account');
            expect(customRecipeText).not.toContain('- object: Contact');
            expect(customRecipeText).not.toContain('- object: OtherChildObject__c');
            expect(customRecipeText).not.toMatch(/^\s+Legacy_Code__c:/m);
            expect(customRecipeText).toContain('    Name: ${{fake.Company}}');

            expect(RecipeCockpitCustomTreecipe.readDefinition(fs.readFileSync(path.join(customFolderPath, 'customTreecipe.json'), 'utf8'))).toMatchObject({
                sourceRunFolderName: RUN_FOLDER_NAME,
                sourceTreeFolderName: SOURCE_TREE_KEY,
                sourceRecipeFileName: SOURCE_RECIPE_FILE_NAME,
                originalTreeFolderName: SOURCE_TREE_KEY,
                removedObjectApiNames: [],
                removedFields: [{ objectApiName: 'Contact', fieldApiNames: ['AccountId'] }, { objectApiName: 'Account', fieldApiNames: ['Legacy_Code__c'] }],
                name: 'Accounts only'
            });
            expect(fs.readFileSync(sourceRecipeFilePath)).toEqual(sourceRecipeBefore);
            expect(fs.readdirSync(path.join(runFolderPath, SOURCE_TREE_KEY))).toEqual([SOURCE_RECIPE_FILE_NAME]);

            expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
            expect((vscode.window.showInformationMessage as jest.Mock).mock.calls[0][0]).toContain(`Saved ${CUSTOM_FOLDER_NAME}`);

            const customModel = lastPosted('recipeData').recipe;
            expect(customModel.selectedRunFolderName).toBe(RUN_FOLDER_NAME);
            expect(customModel.selectedCustomTreeFolderName).toBe(CUSTOM_FOLDER_NAME);
            expect(customModel.runs).toContainEqual(expect.objectContaining({ runFolderName: RUN_FOLDER_NAME, customTreeFolderName: CUSTOM_FOLDER_NAME }));
            expect(customModel.trees.map((tree: any) => [tree.folderName, tree.customCopyOf, tree.customName])).toEqual([[CUSTOM_FOLDER_NAME, SOURCE_TREE_KEY, 'Accounts only']]);
            expect(customModel.objects.map((objectViewModel: any) => objectViewModel.objectApiName)).toEqual(['Account']);
            expect(customModel.objects[0].recipeFilePath).toContain(CUSTOM_FOLDER_NAME);

        });

        it('customizes a custom tree again under its original\'s name, -2, never custom-custom-', async () => {

            let recipeDataMessage = await openAndDraw();
            await receivedMessageHandler({
                command: 'saveCustomTreecipe', treeKey: SOURCE_TREE_KEY, renderSequence: recipeDataMessage.renderSequence, name: '',
                ...removal({ removedObjectApiNames: ['OtherChildObject__c'] })
            });
            recipeDataMessage = await drawLatestModel();
            expect(recipeDataMessage.recipe.selectedCustomTreeFolderName).toBe(CUSTOM_FOLDER_NAME);

            await receivedMessageHandler({
                command: 'saveCustomTreecipe', treeKey: CUSTOM_FOLDER_NAME, renderSequence: recipeDataMessage.renderSequence, name: '',
                ...removal({ removedFields: [{ objectApiName: 'Account', fieldApiName: 'Legacy_Code__c' }] })
            });

            const secondCopyFolderPath = path.join(runFolderPath, `${CUSTOM_FOLDER_NAME}-2`);
            expect(RecipeCockpitCustomTreecipe.readDefinition(fs.readFileSync(path.join(secondCopyFolderPath, 'customTreecipe.json'), 'utf8'))).toMatchObject({
                sourceTreeFolderName: CUSTOM_FOLDER_NAME,
                originalTreeFolderName: SOURCE_TREE_KEY
            });
            const secondRecipeText = fs.readFileSync(path.join(secondCopyFolderPath, fs.readdirSync(secondCopyFolderPath).find(fileName => fileName.endsWith('.yml')) as string), 'utf8');
            expect(secondRecipeText).toContain('- object: Contact');
            expect(secondRecipeText).not.toContain('- object: OtherChildObject__c');
            expect(secondRecipeText).not.toMatch(/^\s+Legacy_Code__c:/m);
            expect(lastPosted('recipeData').recipe.selectedCustomTreeFolderName).toBe(`${CUSTOM_FOLDER_NAME}-2`);

        });

        it('carries the card\'s record counts into the copy', async () => {

            const workspaceState = buildWorkspaceState();
            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            let recipeDataMessage = await drawLatestModel();
            await receivedMessageHandler({ command: 'setObjectCount', treeKey: SOURCE_TREE_KEY, objectApiName: 'Account', count: 7, renderSequence: recipeDataMessage.renderSequence });
            recipeDataMessage = await drawLatestModel();

            await receivedMessageHandler({
                command: 'saveCustomTreecipe', treeKey: SOURCE_TREE_KEY, renderSequence: recipeDataMessage.renderSequence, name: '',
                ...removal({ removedObjectApiNames: ['OtherChildObject__c'] })
            });

            const customFolderPath = path.join(runFolderPath, CUSTOM_FOLDER_NAME);
            const customRecipeText = fs.readFileSync(path.join(customFolderPath, fs.readdirSync(customFolderPath).find(fileName => fileName.endsWith('.yml')) as string), 'utf8');
            expect(customRecipeText).toMatch(/- object: Account\n {2}nickname: Account_NickName\n {2}count: 7\n/);

        });

        it('refuses a copy with nothing removed, and writes nothing', async () => {

            const recipeDataMessage = await openAndDraw();

            await receivedMessageHandler({ command: 'saveCustomTreecipe', treeKey: SOURCE_TREE_KEY, renderSequence: recipeDataMessage.renderSequence, name: '', ...removal() });

            expect(fs.existsSync(path.join(runFolderPath, CUSTOM_FOLDER_NAME))).toBeFalse();
            expect((vscode.window.showWarningMessage as jest.Mock).mock.calls.at(-1)?.[0]).toContain('nothing was removed');

        });

        it.each([
            ['a name over two lines', { name: 'two\nlines', ...removal({ removedObjectApiNames: ['OtherChildObject__c'] }) }, 'the name must be one line'],
            ['every object removed', { name: '', ...removal({ removedObjectApiNames: ['Account'] }) }, 'every object was removed']
        ])('refuses %s, and writes nothing', async (_, postedSave, expectedReason) => {

            const recipeDataMessage = await openAndDraw();

            await receivedMessageHandler({ command: 'saveCustomTreecipe', treeKey: SOURCE_TREE_KEY, renderSequence: recipeDataMessage.renderSequence, ...postedSave });

            expect(fs.existsSync(path.join(runFolderPath, CUSTOM_FOLDER_NAME))).toBeFalse();
            expect((vscode.window.showWarningMessage as jest.Mock).mock.calls.at(-1)?.[0]).toContain(expectedReason);

        });

        it('opens the new recipe from the notification\'s button', async () => {

            (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Open recipe');
            const openResultFileSpy = jest.spyOn(VSCodeWorkspaceService, 'openWorkspaceResultFile').mockResolvedValue(undefined as any);
            const recipeDataMessage = await openAndDraw();

            await receivedMessageHandler({
                command: 'saveCustomTreecipe', treeKey: SOURCE_TREE_KEY, renderSequence: recipeDataMessage.renderSequence, name: '',
                ...removal({ removedObjectApiNames: ['OtherChildObject__c'] })
            });
            await new Promise(resolve => setImmediate(resolve));

            expect(openResultFileSpy).toHaveBeenCalledWith(expect.stringContaining(path.join(CUSTOM_FOLDER_NAME, `recipe--${CUSTOM_FOLDER_NAME}-`)), workspaceRoot, expect.any(String));

        });

        describe('refuses, writes nothing and names why, when', () => {

            const saveOtherChildRemoved = async () => {
                const recipeDataMessage = await openAndDraw();
                await receivedMessageHandler({
                    command: 'saveCustomTreecipe', treeKey: SOURCE_TREE_KEY, renderSequence: recipeDataMessage.renderSequence, name: '',
                    ...removal({ removedObjectApiNames: ['OtherChildObject__c'] })
                });
            };
            const lastWarning = () => (vscode.window.showWarningMessage as jest.Mock).mock.calls.at(-1)?.[0];

            it('the source recipe cannot be read', async () => {
                const readFileSync = fs.readFileSync;
                jest.spyOn(fs, 'readFileSync').mockImplementation(((filePath: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
                    if ( String(filePath).endsWith(SOURCE_RECIPE_FILE_NAME) && RecipeCockpitService.recipeCockpitPanelState.isPanelReady ) {
                        throw Object.assign(new Error('locked'), { code: 'EBUSY' });
                    }
                    return (readFileSync as (...args: unknown[]) => unknown)(filePath, ...rest);
                }) as typeof fs.readFileSync);
                await saveOtherChildRemoved();
                expect(lastWarning()).toContain('could not be read: EBUSY.');
                expect(fs.existsSync(path.join(runFolderPath, CUSTOM_FOLDER_NAME))).toBeFalse();
            });

            it('the run folder cannot be listed', async () => {
                const recipeDataMessage = await openAndDraw();
                const readdirSync = fs.readdirSync;
                jest.spyOn(fs, 'readdirSync').mockImplementation(((folderPath: fs.PathLike, ...rest: unknown[]) => {
                    if ( String(folderPath) === runFolderPath ) {
                        throw Object.assign(new Error('denied'), { code: 'EACCES' });
                    }
                    return (readdirSync as (...args: unknown[]) => unknown)(folderPath, ...rest);
                }) as typeof fs.readdirSync);
                await receivedMessageHandler({ command: 'previewCustomTreecipe', treeKey: SOURCE_TREE_KEY, renderSequence: recipeDataMessage.renderSequence, previewSequence: 2, ...removal({ removedObjectApiNames: ['OtherChildObject__c'] }) });
                expect(lastPosted('customTreecipePreview')).toMatchObject({ refusal: expect.stringContaining('could not be read: EACCES.') });
                expect(lastPosted('customTreecipePreview').folderName).toBeUndefined();
                await receivedMessageHandler({ command: 'saveCustomTreecipe', treeKey: SOURCE_TREE_KEY, renderSequence: recipeDataMessage.renderSequence, name: '', ...removal({ removedObjectApiNames: ['OtherChildObject__c'] }) });
                expect(lastWarning()).toContain('could not be read: EACCES.');
            });

            it('the filtered copy is refused', async () => {
                jest.spyOn(RecipeCockpitService, 'buildRunFakerFilteredRecipe').mockReturnValue({ refusalMessage: 'a recipe line no longer reads back.' });
                await saveOtherChildRemoved();
                expect(lastWarning()).toContain('a recipe line no longer reads back.');
            });

            it.each([
                ['the source recipe is outside the workspace', (candidatePath: string) => candidatePath.endsWith(SOURCE_RECIPE_FILE_NAME), 'is not inside this workspace'],
                ['the run folder is outside the workspace', (candidatePath: string) => candidatePath === runFolderPath, 'is not inside this workspace'],
                ['the new folder resolves outside the workspace', (candidatePath: string) => candidatePath.endsWith(CUSTOM_FOLDER_NAME), 'Nothing was left behind']
            ])('%s', async (_, isOutside, expectedReason) => {
                const isPathContainedInWorkspace = SfdxProjectService.isPathContainedInWorkspace;
                const recipeDataMessage = await openAndDraw();
                jest.spyOn(SfdxProjectService, 'isPathContainedInWorkspace').mockImplementation((candidatePath: string, root: string) => (
                    isOutside(candidatePath) ? false : isPathContainedInWorkspace.call(SfdxProjectService, candidatePath, root)
                ));
                await receivedMessageHandler({
                    command: 'saveCustomTreecipe', treeKey: SOURCE_TREE_KEY, renderSequence: recipeDataMessage.renderSequence, name: '',
                    ...removal({ removedObjectApiNames: ['OtherChildObject__c'] })
                });
                expect(lastWarning()).toContain(expectedReason);
                expect(fs.existsSync(path.join(runFolderPath, CUSTOM_FOLDER_NAME))).toBeFalse();
            });

        });

        it('starts a reused folder name clean: no selection, count or name of a custom tree deleted by hand', async () => {

            const workspaceState = buildWorkspaceState();
            await RecipeCockpitService.writeTreeSelections(workspaceState as any, {
                excludedObjectApiNamesByFolderName: new Map([[CUSTOM_FOLDER_NAME, new Set(['Contact'])]]),
                excludedFieldApiNamesByFolderName: new Map([[CUSTOM_FOLDER_NAME, new Map([['Account', new Set(['Legacy_Code__c'])]])]]),
                objectCountsByFolderName: new Map([[CUSTOM_FOLDER_NAME, new Map([['Account', 9]])]]),
                fixedValuesByFolderName: new Map(),
                validationRulesOffByFolderName: new Map()
            } as any);
            const stalePreferences = RecipeCockpitService.readTreePreferences(workspaceState as any);
            stalePreferences.customNamesByFolderName.set(CUSTOM_FOLDER_NAME, 'Old name');
            await RecipeCockpitService.writeTreePreferences(workspaceState as any, stalePreferences);
            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            const recipeDataMessage = await drawLatestModel();

            await receivedMessageHandler({
                command: 'saveCustomTreecipe', treeKey: SOURCE_TREE_KEY, renderSequence: recipeDataMessage.renderSequence, name: '',
                ...removal({ removedObjectApiNames: ['OtherChildObject__c'] })
            });

            const treeSelections = RecipeCockpitService.readTreeSelections(workspaceState as any);
            expect(treeSelections.excludedObjectApiNamesByFolderName.has(CUSTOM_FOLDER_NAME)).toBeFalse();
            expect(treeSelections.excludedFieldApiNamesByFolderName.has(CUSTOM_FOLDER_NAME)).toBeFalse();
            expect(treeSelections.objectCountsByFolderName.has(CUSTOM_FOLDER_NAME)).toBeFalse();
            expect(RecipeCockpitService.readTreePreferences(workspaceState as any).customNamesByFolderName.has(CUSTOM_FOLDER_NAME)).toBeFalse();

        });

        it('leaves a folder it did not make when another save made it first', async () => {

            const recipeDataMessage = await openAndDraw();
            const mkdirSync = fs.mkdirSync;
            jest.spyOn(fs, 'mkdirSync').mockImplementation(((folderPath: fs.PathLike, ...rest: unknown[]) => {
                if ( String(folderPath).endsWith(CUSTOM_FOLDER_NAME) ) {
                    (mkdirSync as (...args: unknown[]) => unknown)(folderPath, ...rest);
                    throw Object.assign(new Error('exists'), { code: 'EEXIST' });
                }
                return (mkdirSync as (...args: unknown[]) => unknown)(folderPath, ...rest);
            }) as typeof fs.mkdirSync);

            await receivedMessageHandler({
                command: 'saveCustomTreecipe', treeKey: SOURCE_TREE_KEY, renderSequence: recipeDataMessage.renderSequence, name: '',
                ...removal({ removedObjectApiNames: ['OtherChildObject__c'] })
            });

            expect(fs.existsSync(path.join(runFolderPath, CUSTOM_FOLDER_NAME))).toBeTrue();
            expect((vscode.window.showWarningMessage as jest.Mock).mock.calls.at(-1)?.[0]).toContain('could not be written');

        });

        it('takes the folder back out when a write fails, and says so once', async () => {

            const recipeDataMessage = await openAndDraw();
            const writeFileSync = fs.writeFileSync;
            jest.spyOn(fs, 'writeFileSync').mockImplementation(((filePath: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
                if ( String(filePath).endsWith('customTreecipe.json') ) {
                    throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
                }
                return (writeFileSync as (...args: unknown[]) => void)(filePath, ...rest);
            }) as typeof fs.writeFileSync);

            await receivedMessageHandler({
                command: 'saveCustomTreecipe', treeKey: SOURCE_TREE_KEY, renderSequence: recipeDataMessage.renderSequence, name: '',
                ...removal({ removedObjectApiNames: ['OtherChildObject__c'] })
            });

            expect(fs.existsSync(path.join(runFolderPath, CUSTOM_FOLDER_NAME))).toBeFalse();
            expect((vscode.window.showWarningMessage as jest.Mock).mock.calls.at(-1)?.[0]).toContain('Nothing was left behind');
            expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();

        });

    });

    describe('planCustomTreecipeLocation', () => {

        it('refuses a card whose recipe is not in a tree folder of its own', () => {

            expect(RecipeCockpitService.planCustomTreecipeLocation(path.join(runFolderPath, 'Lead-ONLY', 'recipe--Lead-ONLY.yml'), { folderName: SOURCE_TREE_KEY } as any))
                .toEqual({ refusal: 'its recipe recipe--Lead-ONLY.yml is not in a tree folder of its own.' });

        });

        it('refuses once every copy number of the original is taken', () => {

            const readdirSync = fs.readdirSync;
            const takenFolderNames = [CUSTOM_FOLDER_NAME, ...Array.from({ length: 998 }, (_, index) => `${CUSTOM_FOLDER_NAME}-${index + 2}`)];
            jest.spyOn(fs, 'readdirSync').mockImplementation(((folderPath: fs.PathLike, ...rest: unknown[]) => (
                String(folderPath) === runFolderPath ? takenFolderNames : (readdirSync as (...args: unknown[]) => unknown)(folderPath, ...rest)
            )) as typeof fs.readdirSync);

            expect(RecipeCockpitService.planCustomTreecipeLocation(path.join(runFolderPath, SOURCE_TREE_KEY, SOURCE_RECIPE_FILE_NAME), { folderName: SOURCE_TREE_KEY } as any))
                .toEqual({ refusal: `${RUN_FOLDER_NAME} already holds every custom copy number of ${SOURCE_TREE_KEY}. Remove one you no longer need.` });

        });

    });

    describe('readCustomTreecipeDefinition', () => {

        it('does not read a customTreecipe.json over 64 KB', () => {

            const treeFolderPath = path.join(runFolderPath, CUSTOM_FOLDER_NAME);
            fs.mkdirSync(treeFolderPath);
            fs.writeFileSync(path.join(treeFolderPath, 'customTreecipe.json'), RecipeCockpitCustomTreecipe.buildDefinitionText({
                version: 1, sourceRunFolderName: RUN_FOLDER_NAME, sourceTreeFolderName: SOURCE_TREE_KEY, sourceRecipeFileName: SOURCE_RECIPE_FILE_NAME,
                originalTreeFolderName: SOURCE_TREE_KEY, removedObjectApiNames: [], removedFields: [], outOfRunObjectApiNames: [], savedAt: '2026-11-20T22:24:09.000Z'
            }).replace('{', '{' + ' '.repeat(65 * 1024)));

            expect(RecipeCockpitService.readCustomTreecipeDefinition(treeFolderPath)).toBeUndefined();

        });

    });

    describe('loading a run with a custom tree', () => {

        it('leaves the custom folder out of the run, lists it under the run in the picker, and switches between the two', async () => {

            fs.mkdirSync(path.join(runFolderPath, CUSTOM_FOLDER_NAME));
            fs.writeFileSync(
                path.join(runFolderPath, CUSTOM_FOLDER_NAME, `recipe--${CUSTOM_FOLDER_NAME}-2026-11-20T22-24-09.yml`),
                fs.readFileSync(path.join(runFolderPath, SOURCE_TREE_KEY, SOURCE_RECIPE_FILE_NAME), 'utf8').replace(/- object: OtherChildObject__c[\s\S]*$/, '')
            );

            const runModel = (await openAndDraw()).recipe;
            expect(runModel.selectedCustomTreeFolderName).toBeUndefined();
            expect(runModel.trees.map((tree: any) => tree.folderName)).toEqual([SOURCE_TREE_KEY, 'Lead-ONLY']);
            expect(runModel.objects.find((objectViewModel: any) => objectViewModel.objectApiName === 'Account').recipeFilePath).toContain(SOURCE_TREE_KEY + path.sep);
            const customEntryIndex = runModel.runs.findIndex((run: any) => run.customTreeFolderName === CUSTOM_FOLDER_NAME);
            expect(runModel.runs[customEntryIndex - 1]).toEqual({ runFolderName: RUN_FOLDER_NAME, label: expect.any(String) });
            expect(runModel.runs[customEntryIndex].label).toBe(`${runModel.runs[customEntryIndex - 1].label} · ${CUSTOM_FOLDER_NAME}`);

            await receivedMessageHandler({ command: 'selectRun', runFolderName: RUN_FOLDER_NAME, customTreeFolderName: CUSTOM_FOLDER_NAME });
            const customModel = (await drawLatestModel()).recipe;
            expect(customModel.trees.map((tree: any) => [tree.folderName, tree.customCopyOf])).toEqual([[CUSTOM_FOLDER_NAME, SOURCE_TREE_KEY]]);
            expect(customModel.trees[0].objects.map((treeObject: any) => treeObject.objectApiName)).toEqual(['Account', 'Contact']);

            await receivedMessageHandler({ command: 'selectRun', runFolderName: RUN_FOLDER_NAME });
            expect((await drawLatestModel()).recipe.trees.map((tree: any) => tree.folderName)).toEqual([SOURCE_TREE_KEY, 'Lead-ONLY']);

        });

        it('loads a custom tree whose customTreecipe.json does not read back, naming its original from the folder', async () => {

            fs.mkdirSync(path.join(runFolderPath, `${CUSTOM_FOLDER_NAME}-3`, 'customTreecipe.json'), { recursive: true });
            fs.writeFileSync(
                path.join(runFolderPath, `${CUSTOM_FOLDER_NAME}-3`, `recipe--${CUSTOM_FOLDER_NAME}-3-2026-11-20T22-24-09.yml`),
                fs.readFileSync(path.join(runFolderPath, SOURCE_TREE_KEY, SOURCE_RECIPE_FILE_NAME), 'utf8')
            );
            await openAndDraw();

            await receivedMessageHandler({ command: 'selectRun', runFolderName: RUN_FOLDER_NAME, customTreeFolderName: `${CUSTOM_FOLDER_NAME}-3` });

            expect((await drawLatestModel()).recipe.trees.map((tree: any) => [tree.folderName, tree.customCopyOf])).toEqual([[`${CUSTOM_FOLDER_NAME}-3`, SOURCE_TREE_KEY]]);

        });

        it('leaves out a custom folder it cannot read, and loads the run', async () => {

            fs.mkdirSync(path.join(runFolderPath, CUSTOM_FOLDER_NAME));
            const readdirSync = fs.readdirSync;
            jest.spyOn(fs, 'readdirSync').mockImplementation(((folderPath: fs.PathLike, ...rest: unknown[]) => {
                if ( String(folderPath).endsWith(CUSTOM_FOLDER_NAME) ) {
                    throw Object.assign(new Error('denied'), { code: 'EACCES' });
                }
                return (readdirSync as (...args: unknown[]) => unknown)(folderPath, ...rest);
            }) as typeof fs.readdirSync);

            const runModel = (await openAndDraw()).recipe;

            expect(runModel.trees.map((tree: any) => tree.folderName)).toEqual([SOURCE_TREE_KEY, 'Lead-ONLY']);
            expect(runModel.runs.filter((run: any) => run.customTreeFolderName)).toEqual([]);

        });

        it('refuses a custom tree the picker never listed', async () => {

            await openAndDraw();
            const postedBefore = postedPanelMessages.length;

            await receivedMessageHandler({ command: 'selectRun', runFolderName: RUN_FOLDER_NAME, customTreeFolderName: CUSTOM_FOLDER_NAME });
            await receivedMessageHandler({ command: 'selectRun', runFolderName: RUN_FOLDER_NAME, customTreeFolderName: 7 });

            expect(postedPanelMessages.slice(postedBefore).filter(hostMessage => hostMessage.command === 'recipeData')).toEqual([]);

        });

    });

});
