
import { ConfigurationService } from '../ConfigurationService/ConfigurationService';
import { ObjectInfoWrapper } from '../domain/entities/ObjectInfoWrapper';
import { processDirectory } from '../infrastructure/fileSystem/DirectoryProcessor';

import * as fs from 'fs';

import * as vscode from 'vscode';
import { VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';



function getTimestamp(): string {
  const now = new Date();
  const formattedDate = now
    .toISOString()
    .replace(/T/, '_') // Replace 'T' with an underscore
    .replace(/:/g, '-') // Replace ':' with hyphens
    .split('.')[0]; // Remove milliseconds
  return formattedDate;
}


export async function main() {

  const workspaceRoot = await VSCodeWorkspaceService.getWorkspaceRoot();
  let objectsInfoWrapper = new ObjectInfoWrapper();

  if (workspaceRoot) {
    const relativePathToObjectsDirectory = await ConfigurationService.getObjectsPathFromConfiguration();
    const pathWithoutRelativeSyntax = relativePathToObjectsDirectory.split("./")[1];
    const fullPathToObjectsDirectory = `${workspaceRoot}/${pathWithoutRelativeSyntax}`;
    const objectsTargetUri = vscode.Uri.file(fullPathToObjectsDirectory);
    objectsInfoWrapper = await processDirectory(objectsTargetUri, objectsInfoWrapper);
    vscode.window.showInformationMessage('Directory processing completed');
  }



  const outputFilePath = `${workspaceRoot}/ouptut.yaml`;
  fs.writeFile(outputFilePath, objectsInfoWrapper.combinedRecipes, (err) => {
      if (err) {
          console.error('Error writing file', err);
      } else {
          console.log('Data written to file successfully');
      }
  });

}
