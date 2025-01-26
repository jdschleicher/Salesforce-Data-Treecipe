import { XmlFileProcessor } from '../XMLProcessingService/XmlFileProcessor';
import { RecipeService } from '../RecipeService/RecipeService';
import { FieldInfo } from '../ObjectInfoWrapper/FieldInfo';
import { XMLFieldDetail } from '../XMLProcessingService/XMLFieldDetail';
import { ObjectInfoWrapper } from '../ObjectInfoWrapper/ObjectInfoWrapper';
import { ConfigurationService } from '../ConfigurationService/ConfigurationService';
import { RecordTypeService } from '../RecordTypeService/RecordTypeService';

import * as vscode from 'vscode';
import * as path from 'path';

export class DirectoryProcessor {

  private recipeService: RecipeService;
  constructor() {
    const selectedDataFakerService = ConfigurationService.getFakerImplementationByExtensionConfigSelection();
    this.recipeService = new RecipeService(selectedDataFakerService);
  }

  async processDirectory(directoryPathUri: vscode.Uri, objectInfoWrapper: ObjectInfoWrapper): Promise<ObjectInfoWrapper> {

    const entries = await vscode.workspace.fs.readDirectory(directoryPathUri);
    if (entries === undefined || entries.length === 0) {
      // base case for recursion -- prevents empty directories causing null reference errors
      vscode.window.showWarningMessage('No entries found in directory: ' + directoryPathUri.fsPath);

    } else {

      for (const [entryName, entryType] of entries) {

        const fullPath = vscode.Uri.joinPath(directoryPathUri, entryName);
  
        if (entryType === vscode.FileType.Directory) {
  
          if (entryName === 'fields') {
  
            let parentObjectdirectoryPathUri = directoryPathUri.fsPath;
            let objectName = this.getLastSegmentFromPath(parentObjectdirectoryPathUri);
            objectInfoWrapper.addKeyToObjectInfoMap(objectName);
  
            const recordTypeToPicklistFieldsToAvailablePicklistValuesMap = await RecordTypeService.getRecordTypeMarkupMap(fullPath.path);
            let fieldsInfo: FieldInfo[] = await this.processFieldsDirectory(fullPath, objectName, recordTypeToPicklistFieldsToAvailablePicklistValuesMap );
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

    }

    return objectInfoWrapper;

  }

  async processFieldsDirectory(
        directoryPathUri: vscode.Uri, 
        associatedObjectName: string,
        recordTypeToPicklistFieldsToAvailablePicklistValuesMap: Record<string, Record<string, string[]>> 
      ): Promise<FieldInfo[]> {

    /* 
      - vscode.workspace.fs.readDirectory returns Tuple of type <FileName, and FileType enum -- click into readDirectory method to see more
      - the variable names are intended to convey and support at-a-glance understanding w/out having to click through
      - for additional details like what brought this detailed breakdown about and performance advantages see chatgpt discussion here: https://chatgpt.com/share/6772ab2f-76c8-800a-a60a-893985a8d264
    */
    const vsCodeDirectoryTuples = await vscode.workspace.fs.readDirectory(directoryPathUri);

    let fieldInfoDetails: FieldInfo[] = [];
    for (const [fileName, directoryItemTypeEnum] of vsCodeDirectoryTuples) {

      if ( XmlFileProcessor.isXMLFileType(fileName, directoryItemTypeEnum) ) {

        const fieldUri = vscode.Uri.joinPath(directoryPathUri, fileName);
        const fieldXmlContentUriData = await vscode.workspace.fs.readFile(fieldUri);
        const fieldXmlContent = Buffer.from(fieldXmlContentUriData).toString('utf8');

        let fieldInfo = await this.buildFieldInfoByXMLContent(fieldXmlContent, associatedObjectName, recordTypeToPicklistFieldsToAvailablePicklistValuesMap);
        fieldInfoDetails.push(fieldInfo);

      }

    }

    return fieldInfoDetails;

  }

  async buildFieldInfoByXMLContent(xmlContent: string, 
                                    associatedObjectName: string,
                                    recordTypeToPicklistFieldsToAvailablePicklistValuesMap: Record<string, Record<string, string[]>>
                                  ):Promise<FieldInfo> {

    let fieldXMLDetail: XMLFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlContent);
    let recipeValue = this.getRecipeValueByFieldXMLDetail(fieldXMLDetail, recordTypeToPicklistFieldsToAvailablePicklistValuesMap);                                                        

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
  
    return fieldInfo;

  }

  getLastSegmentFromPath(filePath: string): string {
    return path.basename(filePath);
  }

  getRecipeValueByFieldXMLDetail(fieldXMLDetail: XMLFieldDetail, recordTypeToPicklistFieldsToAvailablePicklistValuesMap: Record<string, Record<string, string[]>>): string {
    let recipeValue = null;
    if ( fieldXMLDetail.fieldType === 'AUTO_GENERATED' ) {

      recipeValue = 'TODO -- REMOVE THIS LINE - NO TYPE IN XML MARKUP - THIS FIELD\'S VALUE MAY BE AUTO GENERATED BY SALESFORCE'; 

    } else {

      recipeValue = this.recipeService.getRecipeFakeValueByXMLFieldDetail(fieldXMLDetail, recordTypeToPicklistFieldsToAvailablePicklistValuesMap);
    
    }
    
    return recipeValue;
  
  }

}



