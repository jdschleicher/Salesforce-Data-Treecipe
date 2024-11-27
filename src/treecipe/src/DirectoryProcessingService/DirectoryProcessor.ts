import { XmlFileProcessor } from '../XMLProcessingService/XmlFileProcessor';
import { RecipeService } from '../RecipeService/RecipeService';
import { FieldInfo } from '../ObjectInfoWrapper/FieldInfo';
import { XMLFieldDetail } from '../XMLProcessingService/XMLFieldDetail';
import { ObjectInfoWrapper } from '../ObjectInfoWrapper/ObjectInfoWrapper';
import { ConfigurationService } from '../ConfigurationService/ConfigurationService';

import * as vscode from 'vscode';
import * as path from 'path';
import { IFakerService } from '../FakerService/IFakerService';

export class DirectoryProcessor {

  private recipeService: RecipeService;
  constructor() {
    const selectedDataFakerService = ConfigurationService.getFakerImplementationByConfigurationSelection();
    this.recipeService = new RecipeService(selectedDataFakerService);
  }

  async processDirectory(directoryPathUri: vscode.Uri, objectInfoWrapper: ObjectInfoWrapper): Promise<ObjectInfoWrapper> {

    const entries = await vscode.workspace.fs.readDirectory(directoryPathUri);


    for (const [entryName, entryType] of entries) {

      const fullPath = vscode.Uri.joinPath(directoryPathUri, entryName);

      if (entryType === vscode.FileType.Directory) {

        if (entryName === 'fields') {

          let parentObjectdirectoryPathUri = directoryPathUri.fsPath;
          let objectName = this.getLastSegmentFromPath(parentObjectdirectoryPathUri);
          objectInfoWrapper.addKeyToObjectInfoMap(objectName);

          let fieldsInfo: FieldInfo[] = await this.processFieldsDirectory(fullPath, objectName );
          objectInfoWrapper.objectToObjectInfoMap[objectName].fields = fieldsInfo;

          if (!(objectInfoWrapper.objectToObjectInfoMap[objectName].fullRecipe)) {
            objectInfoWrapper.objectToObjectInfoMap[objectName].fullRecipe = this.recipeService.initiateRecipeByObjectName(objectName);
          }

          fieldsInfo.forEach((fieldDetail) => {

            objectInfoWrapper.objectToObjectInfoMap[objectName].fullRecipe = this.recipeService.appendFieldRecipeToObjectRecipe(
              objectInfoWrapper.objectToObjectInfoMap[objectName].fullRecipe,
              fieldDetail.recipeValue,
              fieldDetail.fieldName
            );

          });

          objectInfoWrapper.combinedRecipes += objectInfoWrapper.objectToObjectInfoMap[objectName].fullRecipe;
          objectInfoWrapper.combinedRecipes += "\n";

        } else {
          await this.processDirectory(fullPath, objectInfoWrapper);
        }
      }

    }

    return objectInfoWrapper;

  }

  async processFieldsDirectory(directoryPathUri: vscode.Uri, associatedObjectName: string): Promise<FieldInfo[]> {

    const files = await vscode.workspace.fs.readDirectory(directoryPathUri);

    let fieldInfoDetails: FieldInfo[] = [];
    for (const [fileName, fileType] of files) {

      if (fileType === vscode.FileType.File && path.extname(fileName).toLowerCase() === '.xml') {

        const fieldUri = vscode.Uri.joinPath(directoryPathUri, fileName);
        const xmlContentUriData = await vscode.workspace.fs.readFile(fieldUri);
        const xmlContent = Buffer.from(xmlContentUriData).toString('utf8');

        let fieldXMLDetail: XMLFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlContent);
        let recipeValue = this.recipeService.getRecipeFakeValueByXMLFieldDetail(fieldXMLDetail);
        // let recipeValue = "";

        let fieldInfo = FieldInfo.create(
          associatedObjectName,
          fieldXMLDetail.apiName,
          fieldXMLDetail.fieldLabel,
          fieldXMLDetail.fieldType,
          fieldXMLDetail.picklistValues,
          fieldXMLDetail.controllingField,
          fieldXMLDetail.referenceTo,
          recipeValue
        );

        fieldInfoDetails.push(fieldInfo);

      }

    }

    return fieldInfoDetails;

  }

  getLastSegmentFromPath(path: string): string {
    const segments = path.split('/');
    return segments[segments.length - 1];
  }

}



