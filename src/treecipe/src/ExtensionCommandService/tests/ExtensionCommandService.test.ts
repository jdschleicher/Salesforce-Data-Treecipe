import * as vscode from 'vscode';
import { ExtensionCommandService } from '../ExtensionCommandService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { ConfigurationService } from '../../ConfigurationService/ConfigurationService';
import { GlobalValueSetSingleton } from '../../GlobalValueSetSingleton/GlobalValueSetSingleton';
import { DirectoryProcessor } from '../../DirectoryProcessingService/DirectoryProcessor';
import { ObjectInfoWrapper } from '../../ObjectInfoWrapper/ObjectInfoWrapper';
import { RecipeFileOutput } from '../../RelationshipService/RelationshipService';

jest.mock('vscode', () => ({
    workspace: {
        workspaceFolders: undefined,
        fs: {
            readDirectory: jest.fn()
        }
    },
    Uri: {
        file: jest.fn().mockImplementation((path: string) => ({ fsPath: path }))
    },
    window: {
        withProgress: jest.fn(),
        showWarningMessage: jest.fn(),
        showErrorMessage: jest.fn(),
        showInformationMessage: jest.fn()
    },
    ProgressLocation: {
        Notification: 15
    }
}), { virtual: true });

jest.mock('../../DirectoryProcessingService/DirectoryProcessor');

describe('ExtensionCommandService', () => {

    describe('generateRecipeFromConfigurationDetail', () => {

        let service: ExtensionCommandService;
        let mockProgress: { report: jest.Mock };
        let mockToken: { isCancellationRequested: boolean };
        let mockProcessorInstance: {
            processAllObjectsAndRelationships: jest.Mock;
            createRecipeFilesInSubdirectory: jest.Mock;
        };

        const mockWorkspaceRoot = '/mock/workspace';
        const mockRelativePath = './force-app/main/default/objects';
        const mockParentPath = '/mock/workspace/force-app/main/default';

        beforeEach(() => {
            service = new ExtensionCommandService();
            mockProgress = { report: jest.fn() };
            mockToken = { isCancellationRequested: false };

            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue(mockWorkspaceRoot);
            jest.spyOn(ConfigurationService, 'getObjectsPathFromTreecipeJSONConfiguration').mockReturnValue(mockRelativePath);
            jest.spyOn(VSCodeWorkspaceService, 'getParentPath').mockReturnValue(mockParentPath);

            const mockGvsInstance = { initialize: jest.fn() };
            jest.spyOn(GlobalValueSetSingleton, 'getInstance').mockReturnValue(mockGvsInstance as any);

            const mockWrapper = new ObjectInfoWrapper();
            mockWrapper.RecipeFiles = [];

            mockProcessorInstance = {
                processAllObjectsAndRelationships: jest.fn().mockResolvedValue(mockWrapper),
                createRecipeFilesInSubdirectory: jest.fn().mockResolvedValue(undefined)
            };

            (DirectoryProcessor as jest.MockedClass<typeof DirectoryProcessor>).mockImplementation(
                () => mockProcessorInstance as any
            );

            (vscode.window.withProgress as jest.Mock).mockImplementation(
                async (_options: any, callback: any) => {
                    await callback(mockProgress, mockToken);
                }
            );
        });

        test('calls vscode.window.withProgress with ProgressLocation.Notification and cancellable true', async () => {
            await service.generateRecipeFromConfigurationDetail();

            expect(vscode.window.withProgress).toHaveBeenCalledWith(
                expect.objectContaining({
                    location: vscode.ProgressLocation.Notification,
                    cancellable: true
                }),
                expect.any(Function)
            );
        });

        test('calls vscode.window.withProgress with Generating Treecipe title', async () => {
            await service.generateRecipeFromConfigurationDetail();

            expect(vscode.window.withProgress).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: 'Generating Treecipe...'
                }),
                expect.any(Function)
            );
        });

        test('reports Reading configuration phase at start', async () => {
            await service.generateRecipeFromConfigurationDetail();

            expect(mockProgress.report).toHaveBeenCalledWith(
                expect.objectContaining({ message: 'Reading configuration...' })
            );
        });

        test('reports Processing Salesforce object metadata phase before directory walk', async () => {
            await service.generateRecipeFromConfigurationDetail();

            expect(mockProgress.report).toHaveBeenCalledWith(
                expect.objectContaining({ message: 'Processing Salesforce object metadata...' })
            );
        });

        test('reports Building relationship trees phase after directory walk completes', async () => {
            await service.generateRecipeFromConfigurationDetail();

            expect(mockProgress.report).toHaveBeenCalledWith(
                expect.objectContaining({ message: 'Building relationship trees...' })
            );
        });

        test('passes progress token and total file count to createRecipeFilesInSubdirectory', async () => {
            const recipeFile: RecipeFileOutput = {
                fileName: 'recipe--Account-ONLY.yml',
                content: '- object: Account',
                objectCount: 1,
                maxLevel: 0,
                objects: ['Account']
            };
            const mockWrapperWithFiles = new ObjectInfoWrapper();
            mockWrapperWithFiles.RecipeFiles = [recipeFile];

            mockProcessorInstance.processAllObjectsAndRelationships.mockResolvedValue(mockWrapperWithFiles);

            await service.generateRecipeFromConfigurationDetail();

            expect(mockProcessorInstance.createRecipeFilesInSubdirectory).toHaveBeenCalledWith(
                mockWrapperWithFiles,
                mockWorkspaceRoot,
                mockProgress,
                mockToken,
                1
            );
        });

        test('progress report calls happen in correct order: config, metadata, trees', async () => {
            await service.generateRecipeFromConfigurationDetail();

            const reportCalls = mockProgress.report.mock.calls.map((call: any[]) => call[0].message);

            const configIndex = reportCalls.indexOf('Reading configuration...');
            const metadataIndex = reportCalls.indexOf('Processing Salesforce object metadata...');
            const treesIndex = reportCalls.indexOf('Building relationship trees...');

            expect(configIndex).toBeLessThan(metadataIndex);
            expect(metadataIndex).toBeLessThan(treesIndex);
        });

    });

});
