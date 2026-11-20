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

        it('refuses a custom tree the picker never listed', async () => {

            await openAndDraw();
            const postedBefore = postedPanelMessages.length;

            await receivedMessageHandler({ command: 'selectRun', runFolderName: RUN_FOLDER_NAME, customTreeFolderName: CUSTOM_FOLDER_NAME });
            await receivedMessageHandler({ command: 'selectRun', runFolderName: RUN_FOLDER_NAME, customTreeFolderName: 7 });

            expect(postedPanelMessages.slice(postedBefore).filter(hostMessage => hostMessage.command === 'recipeData')).toEqual([]);

        });

    });

});
