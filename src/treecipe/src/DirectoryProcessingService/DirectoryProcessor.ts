import { XmlFileProcessor } from '../XMLProcessingService/XmlFileProcessor';
import { RecipeService } from '../RecipeService/RecipeService';
import { FieldInfo } from '../ObjectInfoWrapper/FieldInfo';
import { XMLFieldDetail } from '../XMLProcessingService/XMLFieldDetail';
import { ObjectInfoWrapper } from '../ObjectInfoWrapper/ObjectInfoWrapper';
import { ConfigurationService } from '../ConfigurationService/ConfigurationService';
import { RecordTypeService } from '../RecordTypeService/RecordTypeService';

import * as vscode from 'vscode';
import * as path from 'path';
import { RecordTypeWrapper } from '../RecordTypeService/RecordTypesWrapper';
import { RecipeFileOutput, RelationshipService } from '../RelationshipService/RelationshipService';
import { writeFileSync } from 'fs';

export class DirectoryProcessor {

  private recipeService: RecipeService;
  private relationshipService: RelationshipService;
  constructor() {
    const selectedDataFakerService = ConfigurationService.getFakerImplementationByExtensionConfigSelection();
    this.recipeService = new RecipeService(selectedDataFakerService);

    this.relationshipService = new RelationshipService();
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
  
            const recordTypeApiToRecordTypeWrapperMap = await RecordTypeService.getRecordTypeToApiFieldToRecordTypeWrapper(fullPath.path);
            const salesforceOOTBFakerMappings:Record<string, Record<string, string>> = this.recipeService.getOOTBExpectedObjectToFakerValueMappings();

            if (!(objectInfoWrapper.ObjectToObjectInfoMap[objectName].FullRecipe)) {
              /// if initial yaml recipe structure ( - object: Account ) doesn't exist yet for this object, 
              // make it, so processed fields can be added on
              objectInfoWrapper.ObjectToObjectInfoMap[objectName].FullRecipe = this.recipeService.initiateRecipeByObjectName(objectName, recordTypeApiToRecordTypeWrapperMap, salesforceOOTBFakerMappings);
            }

            if (!(objectInfoWrapper.ObjectToObjectInfoMap[objectName].RelationshipDetail)) {

              objectInfoWrapper.ObjectToObjectInfoMap[objectName].RelationshipDetail = this.relationshipService.buildNewRelationshipDetail(objectName);

            }

         
            let fieldsInfo: FieldInfo[] = await this.processFieldsDirectory(fullPath, 
                                                                              objectName, 
                                                                              recordTypeApiToRecordTypeWrapperMap,
                                                                              salesforceOOTBFakerMappings
                                                                            );
            objectInfoWrapper.ObjectToObjectInfoMap[objectName].Fields = fieldsInfo;
  
            fieldsInfo.forEach((fieldDetail) => {
  
              objectInfoWrapper.ObjectToObjectInfoMap[objectName].FullRecipe = this.recipeService.appendFieldRecipeToObjectRecipe(
                objectInfoWrapper.ObjectToObjectInfoMap[objectName].FullRecipe,
                fieldDetail.recipeValue,
                fieldDetail.fieldName
              );

            });
  
            objectInfoWrapper.CombinedRecipes += objectInfoWrapper.ObjectToObjectInfoMap[objectName].FullRecipe;
            objectInfoWrapper.CombinedRecipes += "\n";
  
            if ( recordTypeApiToRecordTypeWrapperMap !== undefined && Object.keys(recordTypeApiToRecordTypeWrapperMap).length > 0 ) {
              // if there are keys in the recordTypeMap, add them to the objectsInfoWrapper
              objectInfoWrapper.ObjectToObjectInfoMap[objectName].RecordTypesMap = recordTypeApiToRecordTypeWrapperMap;

            }

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
        recordTypeApiToRecordTypeWrapperMap: Record<string, RecordTypeWrapper>,
        salesforceOOTBFakerMappings: Record<string, Record<string, string>>
      ): Promise<FieldInfo[]> {

    /* 
      - vscode.workspace.fs.readDirectory returns Tuple of type <FileName, and FileType enum -- click into readDirectory method to see more
      - the variable names are intended to convey and support at-a-glance understanding w/out having to click through
      - for additional details like what brought this detailed breakdown about and performance advantages see chatgpt discussion here: https://chatgpt.com/share/6772ab2f-76c8-800a-a60a-893985a8d264
    */
    const vsCodeDirectoryTuples = await vscode.workspace.fs.readDirectory(directoryPathUri);

    let fieldInfoDetails: FieldInfo[] = [];
    for (const [fileName, directoryItemTypeEnum] of vsCodeDirectoryTuples) {

      if ( XmlFileProcessor.isXMLFileType(fileName, directoryItemTypeEnum) && !this.isInMappingsOfOotbSalesforceFields(fileName, associatedObjectName, salesforceOOTBFakerMappings) ) {

        const fieldUri = vscode.Uri.joinPath(directoryPathUri, fileName);
        const fieldXmlContentUriData = await vscode.workspace.fs.readFile(fieldUri);
        const fieldXmlContent = Buffer.from(fieldXmlContentUriData).toString('utf8');

        let fieldInfo = await this.buildFieldInfoByXMLContent(fieldXmlContent, 
                                                              associatedObjectName, 
                                                              recordTypeApiToRecordTypeWrapperMap,
                                                              fileName
                                                            );
        fieldInfoDetails.push(fieldInfo);

      }

    }

    return fieldInfoDetails;

  }

  async buildFieldInfoByXMLContent(xmlContent: string, 
                                    associatedObjectName: string,
                                    recordTypeApiToRecordTypeWrapperMap: Record<string, RecordTypeWrapper>,
                                    xmlFieldFileName: string
                                  ):Promise<FieldInfo> {

    let fieldXMLDetail: XMLFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlContent, xmlFieldFileName);
    let recipeValue = this.getRecipeValueByFieldXMLDetail(fieldXMLDetail, recordTypeApiToRecordTypeWrapperMap);                                                        

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

  getRecipeValueByFieldXMLDetail(fieldXMLDetail: XMLFieldDetail, recordTypeApiToRecordTypeWrapperMap: Record<string, RecordTypeWrapper>): string {
    let recipeValue = null;
    if ( fieldXMLDetail.fieldType === 'AUTO_GENERATED' ) {

      recipeValue = this.recipeService.getRecipeValueWithMissingXMLDetailByFieldApiName();

    } else {

      recipeValue = this.recipeService.getRecipeFakeValueByXMLFieldDetail(fieldXMLDetail, recordTypeApiToRecordTypeWrapperMap);
    
    }
    
    return recipeValue;
  
  }

  isInMappingsOfOotbSalesforceFields(fileName: string, associatedObjectName: string, salesforceOOTBFakerMappings: Record<string, Record<string, string>>):boolean {

    // IF FILE NAME INCLUDES OOTB SALESFORCE FIELD ALREADY IN OOTB MAPPINGS WE DO NOT WANT TO PROCESS IT AS ANOTHER FIELD FOR THE RECIPE
    const expectedFieldFileNameExtension = '.field-meta.xml';
    const trimmedFileNameToCaptureOOTBFieldApiName = fileName.replace(expectedFieldFileNameExtension, '');
    const parsedSalesforceFieldFileNameInOOTBMappings:boolean = ( (associatedObjectName in salesforceOOTBFakerMappings) && salesforceOOTBFakerMappings[associatedObjectName].hasOwnProperty(trimmedFileNameToCaptureOOTBFieldApiName) );
    return parsedSalesforceFieldFileNameInOOTBMappings;

  }

  // NEW: Method to call after all objects have been processed
  async processAllObjectsAndRelationships(directoryPathUri: vscode.Uri): Promise<ObjectInfoWrapper> {
    // Initialize the wrapper
    const objectInfoWrapper = new ObjectInfoWrapper(); // Assuming this exists
    
    // Process all directories and objects first
    await this.processDirectory(directoryPathUri, objectInfoWrapper);
    
    // Now process all relationships in one comprehensive pass
    this.relationshipService.processAllRelationships(objectInfoWrapper);
    
    const json = JSON.stringify(objectInfoWrapper, null, 2);
    const filePath = "./wrappers.json";

    writeFileSync(filePath, json, "utf-8");

    console.log(`Wrappers exported to ${filePath}`);

    // Generate ordered recipe structure for Snowfakery
    // const orderedRecipes = this.relationshipService.getOrderedObjectsForRecipes(objectInfoWrapper);
    
    // // Print relationship hierarchy for debugging
    // console.log('Recipe Generation Order:');
    // console.log(this.relationshipService.printRelationshipHierarchy(objectInfoWrapper));
    
    // // Generate separate recipe files for each relationship tree
    // const recipeFiles = this.relationshipService.generateSeparateRecipeFiles(objectInfoWrapper);
    
    // console.log(`Generated ${recipeFiles.length} separate recipe files:`);
    // recipeFiles.forEach(file => {
    //   console.log(`  - ${file.fileName} (${file.objectCount} objects, max level: ${file.maxLevel})`);
    // });
    
    // // Store ordered recipes in the wrapper for later use
    // objectInfoWrapper.OrderedRecipes = orderedRecipes;
    // objectInfoWrapper.RecipeFiles = recipeFiles;
    
    return objectInfoWrapper;
  }

  // NEW: Generate and save recipe files to disk
  async saveRecipeFiles(objectInfoWrapper: ObjectInfoWrapper, outputDirectory: vscode.Uri): Promise<void> {
    const recipeFiles = objectInfoWrapper.RecipeFiles || 
      this.relationshipService.generateSeparateRecipeFiles(objectInfoWrapper);

    for (const recipeFile of recipeFiles) {
      const filePath = vscode.Uri.joinPath(outputDirectory, recipeFile.fileName);
      const fileContent = Buffer.from(recipeFile.content, 'utf8');
      
      try {
        await vscode.workspace.fs.writeFile(filePath, fileContent);
        console.log(`Saved recipe file: ${recipeFile.fileName}`);
      } catch (error) {
        console.error(`Failed to save recipe file ${recipeFile.fileName}:`, error);
      }
    }
  }

  // NEW: Get properly ordered combined recipes (replaces your current CombinedRecipes)
  getCombinedRecipesInOrder(objectInfoWrapper: ObjectInfoWrapper): string {
    const orderedRecipes = objectInfoWrapper.OrderedRecipes || 
      this.relationshipService.getOrderedObjectsForRecipes(objectInfoWrapper);

    return orderedRecipes.relationshipTrees
      .map(tree => tree.combinedRecipe)
      .join('\n' + '='.repeat(80) + '\n\n');
  }

  async createRecipeFiles(recipeFiles: RecipeFileOutput[], outputDirectory: vscode.Uri): Promise<void> {
  console.log(`Creating ${recipeFiles.length} recipe.yaml files...`);
  
  for (const recipeFile of recipeFiles) {
    const filePath = vscode.Uri.joinPath(outputDirectory, recipeFile.fileName);
    const fileContent = Buffer.from(recipeFile.content, 'utf8');
    
    try {
      await vscode.workspace.fs.writeFile(filePath, fileContent);
      vscode.window.showInformationMessage(`Created recipe file: ${recipeFile.fileName}`);
      console.log(`✓ Created ${recipeFile.fileName} with ${recipeFile.objectCount} objects (${recipeFile.objects.join(', ')})`);
    } catch (error) {
      console.error(`✗ Failed to create recipe file ${recipeFile.fileName}:`, error);
      vscode.window.showErrorMessage(`Failed to create recipe file: ${recipeFile.fileName}`);
    }
  }

  // Show summary
  const totalObjects = recipeFiles.reduce((sum, file) => sum + file.objectCount, 0);
  const summaryMessage = `Successfully created ${recipeFiles.length} recipe files with ${totalObjects} total objects`;
  vscode.window.showInformationMessage(summaryMessage);
  console.log(`\n${summaryMessage}`);
}

// NEW: Alternative method to create files in a recipes subdirectory
async createRecipeFilesInSubdirectory(objectInfoWrapper: ObjectInfoWrapper, baseOutputDirectory: vscode.Uri): Promise<void> {
  // Create a 'recipes' subdirectory
  const recipesDirectory = vscode.Uri.joinPath(baseOutputDirectory, 'recipes');
  
  try {
    await vscode.workspace.fs.createDirectory(recipesDirectory);
  } catch (error) {
    // Directory might already exist, that's OK
  }

  const recipeFiles = objectInfoWrapper.RecipeFiles || 
    this.relationshipService.generateSeparateRecipeFiles(objectInfoWrapper);

  await this.createRecipeFiles(recipeFiles, recipesDirectory);
}


}





