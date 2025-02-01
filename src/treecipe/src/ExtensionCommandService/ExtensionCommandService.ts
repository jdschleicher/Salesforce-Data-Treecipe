import { ConfigurationService } from "../ConfigurationService/ConfigurationService";
import { DirectoryProcessor } from "../DirectoryProcessingService/DirectoryProcessor";
import { ErrorHandlingService } from "../ErrorHandlingService/ErrorHandlingService";
import { ObjectInfoWrapper } from "../ObjectInfoWrapper/ObjectInfoWrapper";
import { VSCodeWorkspaceService } from "../VSCodeWorkspace/VSCodeWorkspaceService";

import * as fs from 'fs';
import * as vscode from 'vscode';
import { SnowfakeryIntegrationService } from "../SnowfakeryIntegrationService/SnowfakeryIntegrationService";
import { CollectionsApiService } from "../CollectionsApiService/CollectionsApiService";

export class ExtensionCommandService {
    
    async initiateTreecipeConfigurationSetup() {

        try {

            await ConfigurationService.createTreecipeJSONConfigurationFile();

        } catch(error) {

            const commandName = 'initiateTreecipeConfigurationSetup';
            ErrorHandlingService.handleCapturedError(error, commandName);

        }

    }

    async runSnowfakeryGenerationByRecipeFile() {

        try {
            
            const selectedRecipeQuickPickItem = await SnowfakeryIntegrationService.selectSnowfakeryRecipeFileToProcess();
            if (!selectedRecipeQuickPickItem) {
                return;
            }
            const recipeFullFileNamePath = selectedRecipeQuickPickItem.detail;
            const snowfakeryJsonResult = await SnowfakeryIntegrationService.runSnowfakeryFakeDataGenerationBySelectedRecipeFile(recipeFullFileNamePath);

            const fullPathToUniqueTimeStampedFakeDataSetsFolder = SnowfakeryIntegrationService.createUniqueTimeStampedFakeDataSetsFolderName();

            SnowfakeryIntegrationService.transformSnowfakeryJsonDataToCollectionApiFormattedFilesBySObject(snowfakeryJsonResult, fullPathToUniqueTimeStampedFakeDataSetsFolder);
            fs.copyFileSync(recipeFullFileNamePath, `${fullPathToUniqueTimeStampedFakeDataSetsFolder}/originFile-${selectedRecipeQuickPickItem.label}`);

        } catch(error) {

            const commandName = 'runSnowfakeryGenerationByRecipeFile';
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
          
            const isoDateTimestamp = new Date().toISOString().split(".")[0].replace(/:/g,"-"); // expecting '2024-11-25T16-24-15'
            
            const recipeFileName = `recipe-${isoDateTimestamp}.yaml`;

            // ensure dedicated directory for generated recipes exists
            const generatedRecipesFolderName = ConfigurationService.getGeneratedRecipesDefaultFolderName();
            const expectedGeneratedRecipesFolderPath = `${workspaceRoot}/treecipe/${generatedRecipesFolderName}`;
            if (!fs.existsSync(expectedGeneratedRecipesFolderPath)) {
                fs.mkdirSync(expectedGeneratedRecipesFolderPath);
            }

            const timestampedRecipeGenerationFolder = `${expectedGeneratedRecipesFolderPath}/recipe-${isoDateTimestamp}`;
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

            const selectedDataSetDirectoryToInsert = await CollectionsApiService.promptForDataSetObjectsPathVSCodeQuickItems();
            if (!selectedDataSetDirectoryToInsert) {
                return;
            }

            const targetOrgAlias = await CollectionsApiService.getExpectedSalesforceOrgToInsertAgainst();
            if (!targetOrgAlias) {
                return;
            }

            const allOrNonePreference = await CollectionsApiService.promptForAllOrNoneInsertDecision();
            if (!allOrNonePreference) {
                return;
            }

            const aliasAuthenticationConnection = await CollectionsApiService.getConnectionFromAlias(targetOrgAlias);



    
        } catch(error) {

            const commandName = 'insertDataSetBySelectedDirectory';
            ErrorHandlingService.handleCapturedError(error, commandName);

        }
        
        try {
            
            /*
              - configurationservice? get user input for:
                 1. data set within directory to insert
                 2. expected target org alias
                 3. all or none
             -. confirm authentication/hanlde authentication issue
            - get record types 
            - insert data 
                - insert 
                - upsert
                - keep track of ids
                - all or none
              -    
            */
          
        } catch(error) {

            const commandName = 'insertDataSetBySelectedDirectory';
            ErrorHandlingService.handleCapturedError(error, commandName);

        }

    }

}