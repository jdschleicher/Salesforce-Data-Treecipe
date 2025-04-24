import { ConfigurationService, TreecipeConfigDetail } from "../ConfigurationService/ConfigurationService";
import { DirectoryProcessor } from "../DirectoryProcessingService/DirectoryProcessor";
import { ErrorHandlingService } from "../ErrorHandlingService/ErrorHandlingService";
import { ObjectInfoWrapper } from "../ObjectInfoWrapper/ObjectInfoWrapper";
import { VSCodeWorkspaceService } from "../VSCodeWorkspace/VSCodeWorkspaceService";
import { CollectionsApiService } from "../CollectionsApiService/CollectionsApiService";
import { RecordTypeService } from "../RecordTypeService/RecordTypeService";
import { IFakerRecipeProcessor } from "../FakerRecipeProcessor/IFakerRecipeProcessor";


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
              const objectsTargetUri = vscode.Uri.file(fullPathToObjectsDirectory);
              const directoryProcessor = new DirectoryProcessor();
              objectsInfoWrapper = await directoryProcessor.processDirectory(objectsTargetUri, objectsInfoWrapper);
            
            } else {
                throw new Error('There doesn\'t seem to be any folders or a workspace in this VSCode Window.');
            }

            // ensure dedicated directory for generated recipes exists
            const generatedRecipesFolderName = ConfigurationService.getGeneratedRecipesDefaultFolderName();
            const expectedGeneratedRecipesFolderPath = `${workspaceRoot}/treecipe/${generatedRecipesFolderName}`;
            if (!fs.existsSync(expectedGeneratedRecipesFolderPath)) {
                fs.mkdirSync(expectedGeneratedRecipesFolderPath);
            }

            const isoDateTimestamp = VSCodeWorkspaceService.getNowIsoDateTimestamp();
            let recipeFileName = '';
            let timestampedRecipeGenerationFolder = '';
            const selectedDataFakerService = ConfigurationService.getSelectedDataFakerServiceConfig();
            // THE BELOW CONDITIONAL ADJUSTS HOW RECIPE FILE GETS GENERATED TO INCLUDE A SPECIAL FAKERJS INDICATOR OF THE SELECTED FAKER SERVICE IS 'faker-js' 
            // WITH THIS INDICATOR IN THE RECIPE FILE NAME, THIS WILL PREVENT A FAKER-JS TRYING TO BE PROCESSED
            // WHEN THE SELECTED FAKER SERVICE IS CONFIGURED FOR 'snowfakery'
            if (selectedDataFakerService === 'faker-js') {

                const fakerjsRecipeIndicator = 'recipe-fakerjs';
                recipeFileName = `${fakerjsRecipeIndicator}-${isoDateTimestamp}.yaml`;
                timestampedRecipeGenerationFolder = `${expectedGeneratedRecipesFolderPath}/${fakerjsRecipeIndicator}-${isoDateTimestamp}`;

            } else {

                recipeFileName = `recipe-${isoDateTimestamp}.yaml`;
                timestampedRecipeGenerationFolder = `${expectedGeneratedRecipesFolderPath}/recipe-${isoDateTimestamp}`;

            }
            
            fs.mkdirSync(timestampedRecipeGenerationFolder);

            const outputFilePath = `${timestampedRecipeGenerationFolder}/${recipeFileName}`;
            fs.writeFile(outputFilePath, objectsInfoWrapper.CombinedRecipes, (err) => {
                if (err) {
                    throw new Error('an error occurred when parsing objects directory and generating a recipe yaml file.');
                } else {
                    vscode.window.showInformationMessage('Treecipe YAML generated successfully');
                }
            });

            const objectsInfoWrapperFileName = `treecipeObjectsWrapper-${isoDateTimestamp}.json`;
            const filePathOfOjectsInfoWrapperJson = `${timestampedRecipeGenerationFolder}/${objectsInfoWrapperFileName}`;
            const objectsInfoWrapperJson = JSON.stringify(objectsInfoWrapper, null, 2);
            fs.writeFile(filePathOfOjectsInfoWrapperJson, objectsInfoWrapperJson, (err) => {
                if (err) {
                    throw new Error('an error occurred when attempting to create the "treecipeObjectsWrapper-DateTime.json" file.');
                } else {
                    vscode.window.showInformationMessage('treecipeObjectsWrapper JSON file generated successfully');
                }
            });

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