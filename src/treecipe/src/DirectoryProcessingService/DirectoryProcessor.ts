import { XmlFileProcessor } from '../XMLProcessingService/XmlFileProcessor';
import { RecipeService } from '../RecipeService/RecipeService';
import { FieldInfo } from '../ObjectInfoWrapper/FieldInfo';
import { XMLFieldDetail } from '../XMLProcessingService/XMLFieldDetail';
import { ObjectInfoWrapper } from '../ObjectInfoWrapper/ObjectInfoWrapper';
import { ConfigurationService } from '../ConfigurationService/ConfigurationService';
import { RecordTypeService } from '../RecordTypeService/RecordTypeService';

import * as fs from 'fs';
import * as vscode from 'vscode';
import * as path from 'path';
import { RecordTypeWrapper } from '../RecordTypeService/RecordTypesWrapper';
import { RelationshipService } from '../RelationshipService/RelationshipService';
import { VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';

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

              if (fieldDetail.type === 'Lookup' 
                    || fieldDetail.type === 'MasterDetail' 
                    || fieldDetail.type === 'Hiearchy') {

                  let parentReferenceApiName = null;
                  if ( fieldDetail.referenceTo ) {

                     parentReferenceApiName = fieldDetail.referenceTo;

                  } else {

                    const ootbLookupReferenceToObjectApiNameMap:Record<string, string> = {
                        "AccountId": "Account"
                    };

                    parentReferenceApiName = ootbLookupReferenceToObjectApiNameMap[fieldDetail.fieldName];

                  }

                  if ( parentReferenceApiName ) {

                    if (!(objectInfoWrapper.ObjectToObjectInfoMap[parentReferenceApiName])) {

                        objectInfoWrapper.addKeyToObjectInfoMap(parentReferenceApiName);

                        objectInfoWrapper.ObjectToObjectInfoMap[parentReferenceApiName].RelationshipDetail = this.relationshipService.buildNewRelationshipDetail(parentReferenceApiName);

                    } else if ( !(objectInfoWrapper.ObjectToObjectInfoMap[parentReferenceApiName].RelationshipDetail) ) {

                        objectInfoWrapper.ObjectToObjectInfoMap[parentReferenceApiName].RelationshipDetail = this.relationshipService.buildNewRelationshipDetail(parentReferenceApiName);

                    }

                    if ( !(objectInfoWrapper.ObjectToObjectInfoMap[parentReferenceApiName].RelationshipDetail.childObjectToFieldReferences[objectName]) ) {
                      
                        objectInfoWrapper.ObjectToObjectInfoMap[parentReferenceApiName].RelationshipDetail.childObjectToFieldReferences[objectName] = [];

                    }
                    objectInfoWrapper.ObjectToObjectInfoMap[parentReferenceApiName].RelationshipDetail.childObjectToFieldReferences[objectName].push(fieldDetail.fieldName);

                    if ( !(objectInfoWrapper.ObjectToObjectInfoMap[objectName].RelationshipDetail.parentObjectToFieldReferences[parentReferenceApiName]) ) {
                      
                        objectInfoWrapper.ObjectToObjectInfoMap[objectName].RelationshipDetail.parentObjectToFieldReferences[parentReferenceApiName] = [];

                    }
                    objectInfoWrapper.ObjectToObjectInfoMap[objectName].RelationshipDetail.parentObjectToFieldReferences[parentReferenceApiName].push(fieldDetail.fieldName);

                  }
                  
              }


            });
  
            // objectInfoWrapper.CombinedRecipes += objectInfoWrapper.ObjectToObjectInfoMap[objectName].FullRecipe;
            // objectInfoWrapper.CombinedRecipes += "\n";
  
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

  async processAllObjectsAndRelationships(directoryPathUri: vscode.Uri): Promise<ObjectInfoWrapper> {
    
    const objectInfoWrapper = new ObjectInfoWrapper(); 
    
    await this.processDirectory(directoryPathUri, objectInfoWrapper);
  
    objectInfoWrapper.RelationshipTrees = this.relationshipService.buildRelationshipTrees(objectInfoWrapper);

    const recipeFiles = this.relationshipService.generateSeparateRecipeFiles(objectInfoWrapper);
    
    objectInfoWrapper.RecipeFiles = recipeFiles;
      
    // const json = JSON.stringify(objectInfoWrapper, null, 2);
    // const filePath = "./wrappers.json";
    // writeFileSync(filePath, json, "utf-8");
    // console.log(`Wrappers exported to ${filePath}`);
 
    return objectInfoWrapper;

  }

  // NEW: Generate and save recipe files to disk
  async saveRecipeFiles(objectInfoWrapper: ObjectInfoWrapper, outputDirectory: vscode.Uri): Promise<void> {
    const recipeFiles = objectInfoWrapper.RecipeFiles;
    
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


  async createRecipeFilesInSubdirectory(objectsInfoWrapper: ObjectInfoWrapper,
                                          workspaceRoot): Promise<void> {

      // ensure dedicated directory for generated recipes exists
      const generatedRecipesFolderName = ConfigurationService.getGeneratedRecipesDefaultFolderName();
      const expectedGeneratedRecipesFolderPath = `${workspaceRoot}/treecipe/${generatedRecipesFolderName}`;
      if (!fs.existsSync(expectedGeneratedRecipesFolderPath)) {
          fs.mkdirSync(expectedGeneratedRecipesFolderPath);
      }

      const isoDateTimestamp = VSCodeWorkspaceService.getNowIsoDateTimestamp();
      let timestampedRecipeGenerationFolder = '';
      const isFakerJSServiceSelected = ( ConfigurationService.getSelectedDataFakerServiceConfig() === 'faker-js' 
                                            ? true
                                            : false );

      // THE BELOW CONDITIONAL ADJUSTS HOW RECIPE FILE GETS GENERATED TO INCLUDE A SPECIAL FAKERJS INDICATOR OF THE SELECTED FAKER SERVICE IS 'faker-js' 
      // WITH THIS INDICATOR IN THE RECIPE FILE NAME, THIS WILL PREVENT A FAKER-JS TRYING TO BE PROCESSED
      // WHEN THE SELECTED FAKER SERVICE IS CONFIGURED FOR 'snowfakery'
      let recipePrefix = '';
      if (isFakerJSServiceSelected) {

          recipePrefix = 'recipe-fakerjs';

      } else {

          recipePrefix = `recipe`;

      }

      timestampedRecipeGenerationFolder = `${expectedGeneratedRecipesFolderPath}/${recipePrefix}-${isoDateTimestamp}`;
      fs.mkdirSync(timestampedRecipeGenerationFolder);

      const recipeFilesToCreate = objectsInfoWrapper.RecipeFiles;
      for ( const recipeFile of recipeFilesToCreate ) {

          let treecipeTopToBottomLevelName = '';

          if (recipeFile.objects.length === 1) {
              const onlyObjectInTreecipe = recipeFile.objects.at(0);
              treecipeTopToBottomLevelName = `${onlyObjectInTreecipe}-ONLY`;

          } else {
            
              const topLevelObjectInRecipe = recipeFile.objects.at(0);
              const bottomLevelObjectRecipe = recipeFile.objects.at(-1);
              treecipeTopToBottomLevelName = `${topLevelObjectInRecipe}-${bottomLevelObjectRecipe}`;

          }

          const recipeFileName = `${recipePrefix}--${treecipeTopToBottomLevelName}-${isoDateTimestamp}.yml`;

          const treecipeTopToBottomFolder = `${timestampedRecipeGenerationFolder}/${treecipeTopToBottomLevelName}`;
          fs.mkdirSync(treecipeTopToBottomFolder);

          const outputFilePath = `${treecipeTopToBottomFolder}/${recipeFileName}`;

          fs.writeFile(outputFilePath, recipeFile.content, (err) => {
              
            if (err) {
                  throw new Error('an error occurred when parsing objects directory and generating a recipe yaml file.');
            } else {
                  vscode.window.showInformationMessage('Treecipe YAML generated successfully');
            }
              
          });

      }

      const objectsInfoWrapperFileName = `treecipeObjectsWrapper-${isoDateTimestamp}.json`;
      const filePathOfOjectsInfoWrapperJson = `${timestampedRecipeGenerationFolder}/${objectsInfoWrapperFileName}`;
      const objectsInfoWrapperJson = JSON.stringify(objectsInfoWrapper, null, 2);
      fs.writeFile(filePathOfOjectsInfoWrapperJson, objectsInfoWrapperJson, (err) => {
          if (err) {
              throw new Error(`an error occurred when attempting to create the "${objectsInfoWrapperFileName}" file.`);
          } else {
              vscode.window.showInformationMessage('treecipeObjectsWrapper JSON file generated successfully');
          }
      });

  }


}





