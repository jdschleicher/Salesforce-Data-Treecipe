import { ConfigurationService } from "../ConfigurationService/ConfigurationService";
import { DirectoryProcessor } from "../DirectoryProcessingService/DirectoryProcessor";
import { ErrorHandlingService } from "../ErrorHandlingService/ErrorHandlingService";
import { ObjectInfoWrapper } from "../ObjectInfoWrapper/ObjectInfoWrapper";
import { VSCodeWorkspaceService } from "../VSCodeWorkspace/VSCodeWorkspaceService";

import * as fs from 'fs';
import * as vscode from 'vscode';
import { SnowfakeryIntegrationService } from "../SnowfakeryIntegrationService/SnowfakeryIntegrationService";

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
            
            }
          
            const isoDateTimestamp = new Date().toISOString().split(".")[0].replace(/:/g,"-"); // expecting '2024-11-25T16-24-15'
            const recipeFileName = `recipe-${isoDateTimestamp}.yaml`;

            // ensure dedicated directory for generated recipes exists
            const generatedRecipesFolderName = ConfigurationService.getGeneratedRecipesDefaultFolderName();
            const expectedGeneratedRecipesFolderPath = `${workspaceRoot}/treecipe/${generatedRecipesFolderName}`;
            if (!fs.existsSync(expectedGeneratedRecipesFolderPath)) {
                fs.mkdirSync(expectedGeneratedRecipesFolderPath);
            }

            const outputFilePath = `${workspaceRoot}/treecipe/${generatedRecipesFolderName}/${recipeFileName}`;
            fs.writeFile(outputFilePath, objectsInfoWrapper.combinedRecipes, (err) => {
                if (err) {
                    throw new Error('an error occurred when parsing objects directory and generating a recipe yaml file.');
                } else {
                    vscode.window.showInformationMessage('Treecipe YAML generated successfully');
                }
            });

        } catch (error) {

            const commandName = 'generateRecipeFromConfigurationDetail';
            ErrorHandlingService.handleCapturedError(error, commandName);
            
        }
      
    }

    async insertDataSetBySelectedDirectory() {


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
        
        try {
            
            /*
              - configurationservice? get user input for:
                 1. data set within directory to insert
                 2. expected target org alias
                 3. all or none
             -. confirm authentication
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