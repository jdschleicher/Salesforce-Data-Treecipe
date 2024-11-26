import { ConfigurationService } from "../ConfigurationService/ConfigurationService";
import { DirectoryProcessor } from "../DirectoryProcessingService/DirectoryProcessor";
import { ObjectInfoWrapper } from "../ObjectInfoWrapper/ObjectInfoWrapper";
import { VSCodeWorkspaceService } from "../VSCodeWorkspace/VSCodeWorkspaceService";

import * as fs from 'fs';
import * as vscode from 'vscode';

export class ExtensionCommandService {

    async generateRecipeFromConfigurationDetail() {

        const workspaceRoot = await VSCodeWorkspaceService.getWorkspaceRoot();
        let objectsInfoWrapper = new ObjectInfoWrapper();
      
        if (workspaceRoot) {
          const relativePathToObjectsDirectory = ConfigurationService.getObjectsPathFromConfiguration();
          const pathWithoutRelativeSyntax = relativePathToObjectsDirectory.split("./")[1];
          const fullPathToObjectsDirectory = `${workspaceRoot}/${pathWithoutRelativeSyntax}`;
          const objectsTargetUri = vscode.Uri.file(fullPathToObjectsDirectory);
          objectsInfoWrapper = await DirectoryProcessor.processDirectory(objectsTargetUri, objectsInfoWrapper);
          vscode.window.showInformationMessage('Directory processing completed');
        }
      
        const isoDateTimestamp = new Date().toISOString().split(".")[0].replace(/:/g,"-"); // expecting '2024-11-25T16-24-15'
        const recipeFileName = `recipe-${isoDateTimestamp}.yaml`;
        const outputFilePath = `${workspaceRoot}/treecipe/${recipeFileName}`;
        fs.writeFile(outputFilePath, objectsInfoWrapper.combinedRecipes, (err) => {
            if (err) {
                console.error('Error writing file', err);
            } else {
                console.log('Data written to file successfully');
            }
        });
      
    }



}