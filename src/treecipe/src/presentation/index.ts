
import { ObjectInfoWrapper } from '../domain/entities/ObjectInfoWrapper';
import { processDirectory } from '../infrastructure/fileSystem/DirectoryProcessor';

import * as fs from 'fs';

import * as vscode from 'vscode';


function getWorkspaceUri(): vscode.Uri | undefined {
  
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
      vscode.window.showErrorMessage('No workspace folder is open');
      return undefined;
  }
  return workspaceFolders[0].uri;

}

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

  const workspaceUri = getWorkspaceUri();
  let objectsInfoWrapper = new ObjectInfoWrapper();

  if (workspaceUri) {
    // Use a known existing directory relative to the workspace root
    const targetUri = vscode.Uri.joinPath(workspaceUri, '/main/default/objects');
    objectsInfoWrapper = await processDirectory(targetUri, objectsInfoWrapper);
    vscode.window.showInformationMessage('Directory processing completed');
  }

  // const folderName = getTimestamp();


  fs.writeFile('output.yaml', objectsInfoWrapper.combinedRecipes, (err) => {
      if (err) {
          console.error('Error writing file', err);
      } else {
          console.log('Data written to file successfully');
      }
  });

}
