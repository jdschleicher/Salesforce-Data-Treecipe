import { ConfigurationService, TreecipeConfigDetail } from "../ConfigurationService/ConfigurationService";
import { DirectoryProcessor } from "../DirectoryProcessingService/DirectoryProcessor";
import { ErrorHandlingService } from "../ErrorHandlingService/ErrorHandlingService";
import { ObjectInfoWrapper } from "../ObjectInfoWrapper/ObjectInfoWrapper";
import { VSCodeWorkspaceService } from "../VSCodeWorkspace/VSCodeWorkspaceService";
import { CollectionsApiService } from "../CollectionsApiService/CollectionsApiService";
import { RecordTypeService } from "../RecordTypeService/RecordTypeService";
import { IFakerRecipeProcessor } from "../FakerRecipeProcessor/IFakerRecipeProcessor";
import { GlobalValueSetSingleton } from "../GlobalValueSetSingleton/GlobalValueSetSingleton";


import * as fs from 'fs';
import * as vscode from 'vscode';
import path = require("path");

export class ExtensionCommandService {
    
    async initiateTreecipeConfigurationSetup() {

        try {

            await ConfigurationService.createTreecipeJSONConfigurationFile();

        } catch(error) {

            const commandName = 'initiateTreecipeConfigurationSetup';
            ErrorHandlingService.handleCapturedError(error, commandName);

        }

    }

    async runFakerGenerationByRecipeFile() {

        try {
            
            const expectedGeneratedRecipesFolderPath = ConfigurationService.getGeneratedRecipesFolderPath();
            const vsCodeQuickPickItemPromptLabel = 'Select recipe file to process';
            const selectedRecipeFilePathNameQuickPickItem:vscode.QuickPickItem  = await VSCodeWorkspaceService.promptForDirectoryToGenerateQuickItemsForFileSelection(expectedGeneratedRecipesFolderPath, vsCodeQuickPickItemPromptLabel);
            if (!selectedRecipeFilePathNameQuickPickItem) {
                return;
            }
            const recipeFullFileNamePath = selectedRecipeFilePathNameQuickPickItem.detail;
            
            let fakerRecipeProcessor:IFakerRecipeProcessor = ConfigurationService.getFakerRecipeProcessorByExtensionConfigSelection();

            const fakerJsonResult:string = await fakerRecipeProcessor.generateFakeDataBySelectedRecipeFile(recipeFullFileNamePath) as string;

            const isoDateTimestamp = VSCodeWorkspaceService.getNowIsoDateTimestamp();
            const uniqueTimeStampedFakeDataSetsFolderName = VSCodeWorkspaceService.createFakeDatasetsTimeStampedFolderName(isoDateTimestamp);
            const fullPathToUniqueTimeStampedFakeDataSetsFolder = VSCodeWorkspaceService.createUniqueTimeStampedFakeDataSetsFolderName(uniqueTimeStampedFakeDataSetsFolderName);

            const mappedSObjectApiToRecords = fakerRecipeProcessor.transformFakerJsonDataToCollectionApiFormattedFilesBySObject(fakerJsonResult);

            const directoryToStoreCollectionDatasetFiles = ConfigurationService.getDatasetFilesForCollectionsApiFolderName();
            const fullPathToStoreDatasetFiles = `${fullPathToUniqueTimeStampedFakeDataSetsFolder}/${directoryToStoreCollectionDatasetFiles}`;
            fs.mkdirSync(fullPathToStoreDatasetFiles);

            mappedSObjectApiToRecords.forEach((collectionsApiContent, sobjectApiName) => {
                CollectionsApiService.createCollectionsApiFile(
                    sobjectApiName, 
                    collectionsApiContent, 
                    fullPathToStoreDatasetFiles
                );
            });
            
            const baseArtifactsFoldername = ConfigurationService.getBaseArtifactsFolderName();
            const fullPathToBaseArtifactsFolder = `${fullPathToUniqueTimeStampedFakeDataSetsFolder}/${baseArtifactsFoldername}`;
            fs.mkdirSync(fullPathToBaseArtifactsFolder);
            fs.copyFileSync(recipeFullFileNamePath, `${fullPathToBaseArtifactsFolder}/originalRecipe-${selectedRecipeFilePathNameQuickPickItem.label}`);

            /* 
                The below lines get the timestamped parent recipe folder 
                in order to traverse through and get all other artifacts files to use in
                data generation and inserts commands
            */
            const selectedRecipeParentDirectory = path.dirname(recipeFullFileNamePath);
            if ( path.basename(selectedRecipeParentDirectory) !== "GeneratedRecipes" ) {
                const filesWithinSelecteRecipeFolder = fs.readdirSync(selectedRecipeParentDirectory, { withFileTypes: true });
                const expectedObjectsInfoWrapperNamePrefix = ConfigurationService.getTreecipeObjectsWrapperName();
                const matchingTreecipeObjectsWrapperFile = filesWithinSelecteRecipeFolder.find(file => 
                    file.isFile() && file.name.startsWith(expectedObjectsInfoWrapperNamePrefix)
                );
    
                if (matchingTreecipeObjectsWrapperFile) {
                    const fullTreecipeObjectsWrapperPath = path.join(selectedRecipeParentDirectory, matchingTreecipeObjectsWrapperFile.name);
                    fs.copyFileSync(fullTreecipeObjectsWrapperPath, `${fullPathToBaseArtifactsFolder}/originalTreecipeWrapper-${matchingTreecipeObjectsWrapperFile.name}`);
                } 
            }
       

        } catch(error) {

            const commandName = 'runFakerGenerationByRecipeFile';
            ErrorHandlingService.handleCapturedError(error, commandName);

        }

    }

    async generateRecipeFromConfigurationDetail() {

        try {

            let objectsInfoWrapper = new ObjectInfoWrapper();
            const workspaceRoot = VSCodeWorkspaceService.getWorkspaceRoot();

            if (workspaceRoot) {
            
                const relativePathToObjectsDirectory = ConfigurationService.getObjectsPathFromTreecipeJSONConfiguration();
                const pathWithoutRelativeSyntax = relativePathToObjectsDirectory.split("./")[1];
                const fullPathToObjectsDirectory = `${workspaceRoot}/${pathWithoutRelativeSyntax}`;
                
                /* 
                -- initialize globalvaluesets singleton --
                 at this point in the extension commands, where a command is entered to generate a reciipe, we should retrieve the globalvaluesets 
                 as there could be changes that have taken place throughout the vscode instance of the user
                */
                const isGlobalValuesInitializedOnExtensionStartUpOverride = false;
                const pathToSalesforceMetadataParentDirectory = VSCodeWorkspaceService.getParentPath(fullPathToObjectsDirectory);
                let globalValueSetSingleton = GlobalValueSetSingleton.getInstance();
                globalValueSetSingleton.initialize(pathToSalesforceMetadataParentDirectory, isGlobalValuesInitializedOnExtensionStartUpOverride);

                const directoryProcessor = new DirectoryProcessor();
                const objectsTargetUri = vscode.Uri.file(fullPathToObjectsDirectory);
                // objectsInfoWrapper = await directoryProcessor.processDirectory(objectsTargetUri, objectsInfoWrapper);
            
                const result = await directoryProcessor.processAllObjectsAndRelationships(objectsTargetUri);

                // Get properly ordered recipes instead of your current CombinedRecipes
                // const orderedCombinedRecipes = directoryProcessor.getCombinedRecipesInOrder(result);

                // Save separate recipe files
                // await directoryProcessor.saveRecipeFiles(result, objectsTargetUri);

    

                await directoryProcessor.createRecipeFilesInSubdirectory(result, objectsTargetUri, workspaceRoot);


            } else {
                throw new Error('There doesn\'t seem to be any folders or a workspace in this VSCode Window.');
            }

          

        } catch (error) {

            const commandName = 'generateRecipeFromConfigurationDetail';
            ErrorHandlingService.handleCapturedError(error, commandName);
            
        }
      
    }

    async insertDataSetBySelectedDirectory() {

        try {

            const selectedDataSetDirectoryToInsert:vscode.QuickPickItem = await CollectionsApiService.promptForDataSetObjectsPathVSCodeQuickItems();
            
            if (!selectedDataSetDirectoryToInsert) {
                return;
            }

            const targetOrgAlias = await CollectionsApiService.getExpectedSalesforceOrgToInsertAgainst();
            if (!targetOrgAlias) {
                return;
            }

            const allOrNoneSelection:boolean = await CollectionsApiService.promptForAllOrNoneInsertDecision();
            if (allOrNoneSelection === undefined) {
                return;
            }
            
            const aliasAuthenticationConnection = await CollectionsApiService.getConnectionFromAlias(targetOrgAlias);

            const selectedDataSetFullDirectoryPath = selectedDataSetDirectoryToInsert.detail;
            const datasetChildFoldersToFilesMap = await CollectionsApiService.getDataSetChildDirectoriesNameToFilesMap(selectedDataSetFullDirectoryPath);
            
            const treecipeObjectWrapperDetail = await CollectionsApiService.getTreecipeObjectsWrapperDetailByDataSetDirectoriesToFilesMap(datasetChildFoldersToFilesMap);
            
            const objectApiNamesToGetRecordTypeInfoFrom = Object.keys(treecipeObjectWrapperDetail.ObjectToObjectInfoMap);

            const recordTypeDetailFromOrg = await RecordTypeService.getRecordTypeIdsByConnection(aliasAuthenticationConnection, objectApiNamesToGetRecordTypeInfoFrom);

            await CollectionsApiService.upsertDataSetToSelectedOrg(selectedDataSetFullDirectoryPath,
                                                                    datasetChildFoldersToFilesMap, 
                                                                    recordTypeDetailFromOrg, 
                                                                    aliasAuthenticationConnection,
                                                                    allOrNoneSelection);                  

        } catch(error) {

            const commandName = 'insertDataSetBySelectedDirectory';
            ErrorHandlingService.handleCapturedError(error, commandName);

        }
        
    }

    async changeFakerImplementationService() {

        try {

            let selectedDataFakerService = await VSCodeWorkspaceService.promptForFakerServiceImplementation();
            ConfigurationService.setExtensionConfigValue('selectedFakerService', selectedDataFakerService);
            
            const existingTreecipeConfigDetail:TreecipeConfigDetail = ConfigurationService.getTreecipeConfigurationDetail();
            existingTreecipeConfigDetail.dataFakerService = selectedDataFakerService;
            await ConfigurationService.updateTreecipeConfigFile(existingTreecipeConfigDetail);
            
        } catch(error) {

            const commandName = 'changeFakerImplementationService';
            ErrorHandlingService.handleCapturedError(error, commandName);

        }

       

	}

}