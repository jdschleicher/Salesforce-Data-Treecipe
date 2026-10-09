import { XmlFileProcessor } from '../XMLProcessingService/XmlFileProcessor';
import { RecipeService } from '../RecipeService/RecipeService';
import { FakerJSRecipeFakerService } from '../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { RecipeYamlScalar } from '../RecipeFakerService.ts/RecipeYamlScalar/RecipeYamlScalar';
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
import { SOQLTemplateService } from '../SOQLTemplateService/SOQLTemplateService';
import { MermaidService } from '../MermaidService/MermaidService';

export interface IGeneratedRecipeRun {
  runFolderPath: string;
  // ONE PER RELATIONSHIP TREE, IN RecipeFiles ORDER
  recipeFilePaths: string[];
}

/*
    How Generate Treecipe reports its progress, deliberately free of any vscode type -- the same
    two-function shape as IPicklistDependencyGenerationProgress, so the walk is tested for what it
    reports and where it stops without a withProgress double (#216).
*/
export interface IRecipeGenerationProgress {
  report(message: string): void;
  isCancellationRequested(): boolean;
}

// THE TOP-LEVEL DIRECTORIES OF THE CONFIGURED OBJECTS PATH, COUNTED ONCE SO "N OF M" HAS ITS TOTAL BEFORE THE WALK DESCENDS
interface IRecipeGenerationScanCount {
  scanned: number;
  total: number;
}

export class RecipeGenerationCancelledError extends Error {

  constructor() {
    super('Generate Treecipe was cancelled.');
    this.name = 'RecipeGenerationCancelledError';
  }

}

export class DirectoryProcessor {

  private recipeService: RecipeService;
  private relationshipService: RelationshipService;
  private customRelationshipMappings: Record<string, string> | undefined;
  private customCompoundAddressFields: string[] | undefined;
  // THE SERVICE THAT WRITES EVERY OBJECT'S RECIPE DECIDES WHETHER THE TREE NESTS ITS CHILDREN UNDER friends: (#46)
  private isFakerJSServiceSelected: boolean;
  constructor() {
    const selectedDataFakerService = ConfigurationService.getFakerImplementationByExtensionConfigSelection();
    this.isFakerJSServiceSelected = selectedDataFakerService instanceof FakerJSRecipeFakerService;
    this.recipeService = new RecipeService(selectedDataFakerService);
    this.relationshipService = new RelationshipService();
  }

  private getCustomRelationshipMappings(): Record<string, string> {

    if (this.customRelationshipMappings !== undefined) {
      return this.customRelationshipMappings;
    }

    try {
      this.customRelationshipMappings = ConfigurationService.getCustomRelationshipMappings();
    } catch {
      this.customRelationshipMappings = {};
    }

    return this.customRelationshipMappings;

  }

  private getCustomCompoundAddressFields(): string[] {

    if (this.customCompoundAddressFields !== undefined) {
      return this.customCompoundAddressFields;
    }

    try {
      this.customCompoundAddressFields = ConfigurationService.getCustomCompoundAddressFields();
    } catch {
      this.customCompoundAddressFields = [];
    }

    return this.customCompoundAddressFields;

  }

  isCompoundAddressField(fieldInfo: FieldInfo, associatedObjectName: string): boolean {

    const compoundAddressFieldType = 'address';
    if ( fieldInfo?.type?.toLowerCase() === compoundAddressFieldType ) {
      return true;
    }

    /*
      A compound address field file can carry no <type> tag at all, in which case it has already
      parsed as AUTO_GENERATED and no metadata signal is left to key on -- the configured list is
      the only way such a field can be recognised.

      Keyed by object AND field, like customRelationshipMappings: a field api name repeats across
      objects, so a bare name would make "Legacy_Address__c" on one object silently replace the
      identically named field on every other object with five bogus component lines.
    */
    if ( !fieldInfo?.fieldName || !associatedObjectName ) {
      return false;
    }

    const objectQualifiedFieldKey = `${associatedObjectName}.${fieldInfo.fieldName}`;
    return this.getCustomCompoundAddressFields().includes(objectQualifiedFieldKey);

  }

  /*
    <type>Location</type> is the whole signal, with no configured-list counterpart to the one
    isCompoundAddressField carries: a Geolocation field always declares its type in source metadata,
    so there is no typeless case for config to rescue.
  */
  isCompoundGeolocationField(fieldInfo: FieldInfo): boolean {

    const compoundGeolocationFieldType = 'location';
    return fieldInfo?.type?.toLowerCase() === compoundGeolocationFieldType;

  }

  /*
    Returns one FieldInfo per writable component and NONE for the compound field itself, which is why
    an empty array is a valid result: on an object whose OOTB mappings already name every component
    (Account's BillingStreet/BillingCity/...) the compound field contributes nothing rather than a
    second set of the same recipe lines.

    Address and Geolocation differ only in which component recipes they expand to -- the two reasons
    a component is dropped are the same for both, so the dedupe below stays in one place rather than
    once per compound type.

    A component is dropped for either of two reasons, and both produce the same duplicate key in the
    object recipe if missed: the OOTB mappings already emit it, or the object HAS that component as
    its own field file. The second is why Asset matters -- it is in the OOTB mappings but names no
    address components, so its bare "Address" compound field expands to Street/City/... and collides
    with any Street.field-meta.xml retrieved alongside it.
  */
  buildCompoundComponentFieldInfos(compoundFieldInfo: FieldInfo,
                                    associatedObjectName: string,
                                    salesforceOOTBFakerMappings: Record<string, Record<string, string>>,
                                    alreadyProcessedFieldInfos: FieldInfo[] = []
                                  ): FieldInfo[] {

    const ootbFieldApiNamesForObject = salesforceOOTBFakerMappings?.[associatedObjectName] ?? {};
    const alreadyProcessedFieldApiNames = new Set(alreadyProcessedFieldInfos.map(fieldInfo => fieldInfo?.fieldName));
    const compoundComponentRecipes = this.isCompoundGeolocationField(compoundFieldInfo)
      ? this.recipeService.buildCompoundGeolocationComponentRecipes(compoundFieldInfo.fieldName)
      : this.recipeService.buildCompoundAddressComponentRecipes(compoundFieldInfo.fieldName);

    return compoundComponentRecipes
      .filter((componentRecipe) => !Object.prototype.hasOwnProperty.call(ootbFieldApiNamesForObject, componentRecipe.componentApiName))
      .filter((componentRecipe) => !alreadyProcessedFieldApiNames.has(componentRecipe.componentApiName))
      .map((componentRecipe) => FieldInfo.create(
        associatedObjectName,
        componentRecipe.componentApiName,
        `${compoundFieldInfo.fieldLabel} ${componentRecipe.componentKey}`,
        'Text',
        null,
        null,
        null,
        componentRecipe.recipeValue
      ));

  }

  static throwIfCancellationRequested(generationProgress?: IRecipeGenerationProgress): void {

    if ( generationProgress?.isCancellationRequested() ) {
      throw new RecipeGenerationCancelledError();
    }

  }

  async processDirectory(directoryPathUri: vscode.Uri,
                          objectInfoWrapper: ObjectInfoWrapper,
                          generationProgress?: IRecipeGenerationProgress,
                          scanCount?: IRecipeGenerationScanCount): Promise<ObjectInfoWrapper> {

    DirectoryProcessor.throwIfCancellationRequested(generationProgress);

    const isTopLevelOfScan = generationProgress !== undefined && scanCount === undefined;
    const entries = await vscode.workspace.fs.readDirectory(directoryPathUri);
    if (entries === undefined || entries.length === 0) {
      // base case for recursion -- prevents empty directories causing null reference errors
      vscode.window.showWarningMessage('No entries found in directory: ' + directoryPathUri.fsPath);
      if ( isTopLevelOfScan ) {
        generationProgress.report('Scanning objects (0 of 0)');
      }

    } else {

      /*
        Nothing downstream consumes listViews, webLinks, compactLayouts or any other object child
        type -- only "fields" is read. Record types ARE used, but RecordTypeService navigates to them
        from the fields directory path rather than relying on this walk finding them.

        So once a directory is known to contain "fields" it is an object directory, and descending
        into its other children reads directories that cannot contribute anything. Filtering here
        rather than deny-listing the type names means no maintenance when Salesforce adds another.
      */
      const containsFieldsDirectory = entries.some(
        ([entryName, entryType]) => entryType === vscode.FileType.Directory && entryName === 'fields'
      );

      if ( isTopLevelOfScan ) {
        // A CONFIGURED PATH THAT IS ITSELF AN OBJECT DIRECTORY IS ONE OBJECT, WHATEVER ELSE SITS BESIDE ITS fields
        const total = containsFieldsDirectory
                        ? 1
                        : entries.filter(([, entryType]) => entryType === vscode.FileType.Directory).length;
        scanCount = { scanned: 0, total: total };
        generationProgress.report(`Scanning objects (0 of ${total})`);
      }

      for (const [entryName, entryType] of entries) {

        const fullPath = vscode.Uri.joinPath(directoryPathUri, entryName);
  
        if (entryType === vscode.FileType.Directory) {

          if (containsFieldsDirectory && entryName !== 'fields') {
            continue;
          }

          DirectoryProcessor.throwIfCancellationRequested(generationProgress);
          if ( isTopLevelOfScan ) {
            scanCount.scanned++;
          }
  
          if (entryName === 'fields') {
  
            let parentObjectdirectoryPathUri = directoryPathUri.fsPath;
            let objectName = this.getLastSegmentFromPath(parentObjectdirectoryPathUri);
            if ( !objectInfoWrapper.addKeyToObjectInfoMap(objectName) ) {
              // A DIRECTORY NAME THAT IS NOT AN API NAME IS NOT AN OBJECT -- processAllObjectsAndRelationships WARNS ABOUT IT ONCE THE WALK ENDS (#164)
              continue;
            }

            if ( generationProgress ) {
              generationProgress.report(`Scanning ${DirectoryProcessor.escapeForNotification(objectName)} (${scanCount.scanned} of ${scanCount.total})`);
            }
  
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

         
            const { writableRecordTypeApiToRecordTypeWrapperMap } = RecipeService.partitionRecordTypesByWritableDeveloperName(recordTypeApiToRecordTypeWrapperMap);
            let fieldsInfo: FieldInfo[] = await this.processFieldsDirectory(fullPath, 
                                                                              objectName, 
                                                                              writableRecordTypeApiToRecordTypeWrapperMap,
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
                  if (fieldDetail.referenceTo) {

                    parentReferenceApiName = fieldDetail.referenceTo;

                  } else {

                    const customRelationshipMappings = this.getCustomRelationshipMappings();
                    parentReferenceApiName = this.relationshipService.resolveParentReferenceForField(
                      objectName,
                      fieldDetail.fieldName,
                      customRelationshipMappings
                    );

                  }

                  if ( parentReferenceApiName ) {
                    objectInfoWrapper.ObjectToObjectInfoMap = this.relationshipService.buildBidirectionalChildAndParentRelationshipReferences(fieldDetail, objectInfoWrapper, objectName, parentReferenceApiName);
                  }

              }


            });
  
  
            if ( recordTypeApiToRecordTypeWrapperMap !== undefined && Object.keys(recordTypeApiToRecordTypeWrapperMap).length > 0 ) {
              // if there are keys in the recordTypeMap, add them to the objectsInfoWrapper
              objectInfoWrapper.ObjectToObjectInfoMap[objectName].RecordTypesMap = recordTypeApiToRecordTypeWrapperMap;

            }

          } else {
  
            await this.processDirectory(fullPath, objectInfoWrapper, generationProgress, scanCount);
  
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
    let compoundFieldInfos: FieldInfo[] = [];
    for (const [fileName, directoryItemTypeEnum] of vsCodeDirectoryTuples) {

      if ( XmlFileProcessor.isSalesforceFieldMetadataFile(fileName, directoryItemTypeEnum) && !this.isInMappingsOfOotbSalesforceFields(fileName, associatedObjectName, salesforceOOTBFakerMappings) ) {

        const fieldUri = vscode.Uri.joinPath(directoryPathUri, fileName);
        const fieldXmlContentUriData = await vscode.workspace.fs.readFile(fieldUri);
        const fieldXmlContent = Buffer.from(fieldXmlContentUriData).toString('utf8');

        let fieldInfo = await this.buildFieldInfoByXMLContent(fieldXmlContent, 
                                                              associatedObjectName, 
                                                              recordTypeApiToRecordTypeWrapperMap,
                                                              fileName
                                                            );

        if ( this.isCompoundAddressField(fieldInfo, associatedObjectName) || this.isCompoundGeolocationField(fieldInfo) ) {

          compoundFieldInfos.push(fieldInfo);

        } else {

          fieldInfoDetails.push(fieldInfo);

        }

      }

    }

    /*
      Expansion runs AFTER the walk so a component can be checked against every field file the object
      actually has rather than only the ones read so far -- directory order decides whether a
      component's own field file is seen before or after the compound field, and a duplicate recipe
      key is invalid either way.
    */
    compoundFieldInfos.forEach((compoundFieldInfo) => {

      const compoundComponentFieldInfos = this.buildCompoundComponentFieldInfos(compoundFieldInfo,
                                                                                associatedObjectName,
                                                                                salesforceOOTBFakerMappings,
                                                                                fieldInfoDetails
                                                                              );
      fieldInfoDetails.push(...compoundComponentFieldInfos);

    });

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

    FieldInfo.applyFieldSize(fieldInfo, fieldXMLDetail);
  
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

  async processAllObjectsAndRelationships(directoryPathUri: vscode.Uri, generationProgress?: IRecipeGenerationProgress): Promise<ObjectInfoWrapper> {
    
    const objectInfoWrapper = new ObjectInfoWrapper(); 

    generationProgress?.report('Scanning objects…');
    await this.processDirectory(directoryPathUri, objectInfoWrapper, generationProgress);

    DirectoryProcessor.throwIfCancellationRequested(generationProgress);
    this.warnOfSkippedObjectApiNames(objectInfoWrapper);

    generationProgress?.report('Building relationship trees…');
    objectInfoWrapper.RelationshipTrees = this.relationshipService.buildRelationshipTrees(objectInfoWrapper);

    // ONLY faker-js RECIPES NEST CHILDREN UNDER friends: AND WIRE THEIR LOOKUPS (#46) -- A SNOWFAKERY RECIPE IS WRITTEN FLAT, AS BEFORE
    const recipeFiles = this.relationshipService.generateSeparateRecipeFiles(objectInfoWrapper, this.isFakerJSServiceSelected);
    
    objectInfoWrapper.RecipeFiles = recipeFiles;

    DirectoryProcessor.throwIfCancellationRequested(generationProgress);
    return objectInfoWrapper;

  }

  static readonly maximumSkippedObjectApiNamesInWarning = 20;

  static escapeForNotification(name: string): string {

    return RecipeYamlScalar.escapeForNotification(name);

  }

  warnOfSkippedObjectApiNames(objectInfoWrapper: ObjectInfoWrapper): void {

    const skippedObjectApiNames = objectInfoWrapper.SkippedObjectApiNames ?? [];
    if ( skippedObjectApiNames.length === 0 ) {
      return;
    }

    const maximumNames = DirectoryProcessor.maximumSkippedObjectApiNamesInWarning;
    const quotedObjectApiNames = skippedObjectApiNames
      .slice(0, maximumNames)
      .map(skippedObjectApiName => `"${DirectoryProcessor.escapeForNotification(skippedObjectApiName)}"`)
      .join(', ');
    const unlistedNamesNote = skippedObjectApiNames.length > maximumNames
      ? ` and ${skippedObjectApiNames.length - maximumNames} more`
      : '';
    vscode.window.showWarningMessage(`Treecipe skipped ${skippedObjectApiNames.length} object name(s) that are not valid Salesforce api names (letters, digits and underscores, starting with a letter): ${quotedObjectApiNames}${unlistedNamesNote}. No recipe is written for an object directory with such a name, and no relationship is recorded for a referenceTo or relationship mapping naming one; rename it and regenerate.`);

  }

  /*
      Every write is awaited, so the run is on disk when the promise resolves and a failed write
      rejects it -- a throw inside an fs.writeFile callback reached nothing, and the command
      reported success over a missing file. The caller reports the run once; nothing here notifies.
  */
  async createRecipeFilesInSubdirectory(objectsInfoWrapper: ObjectInfoWrapper,
                                          workspaceRoot: string): Promise<IGeneratedRecipeRun> {

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

      const recipeFilePaths: string[] = [];
      const pendingFileWrites: Promise<void>[] = [];

      const recipeFilesToCreate = objectsInfoWrapper.RecipeFiles;
      for ( const recipeFile of recipeFilesToCreate ) {

          const treecipeTopToBottomLevelName = RelationshipService.buildRecipeTreeFolderName(recipeFile.objects);

          const recipeFileName = `${recipePrefix}--${treecipeTopToBottomLevelName}-${isoDateTimestamp}.yml`;

          const treecipeTopToBottomFolder = `${timestampedRecipeGenerationFolder}/${treecipeTopToBottomLevelName}`;
          fs.mkdirSync(treecipeTopToBottomFolder);

          const outputFilePath = `${treecipeTopToBottomFolder}/${recipeFileName}`;
          recipeFilePaths.push(outputFilePath);
          pendingFileWrites.push(DirectoryProcessor.writeGeneratedFile(outputFilePath, recipeFile.content, 'an error occurred when parsing objects directory and generating a recipe yaml file.'));

          const soqlTemplateFileName = `soql-sosl-templates--${treecipeTopToBottomLevelName}-${isoDateTimestamp}.md`;
          const soqlTemplateFilePath = `${treecipeTopToBottomFolder}/${soqlTemplateFileName}`;
          const soqlTemplateContent = SOQLTemplateService.generateSOQLTemplateMarkdownForTree(objectsInfoWrapper, recipeFile.objects, isoDateTimestamp);
          pendingFileWrites.push(DirectoryProcessor.writeGeneratedFile(soqlTemplateFilePath, soqlTemplateContent, `an error occurred when attempting to create the "${soqlTemplateFileName}" file.`));

          const mermaidErdFileName = `mermaid-erd--${treecipeTopToBottomLevelName}-${isoDateTimestamp}.md`;
          const mermaidErdFilePath = `${treecipeTopToBottomFolder}/${mermaidErdFileName}`;
          const mermaidErdContent = MermaidService.generateMermaidMarkdownForTree(objectsInfoWrapper, recipeFile.objects, isoDateTimestamp);
          pendingFileWrites.push(DirectoryProcessor.writeGeneratedFile(mermaidErdFilePath, mermaidErdContent, `an error occurred when attempting to create the "${mermaidErdFileName}" file.`));

      }

      const objectsInfoWrapperFileName = `treecipeObjectsWrapper-${isoDateTimestamp}.json`;
      const filePathOfOjectsInfoWrapperJson = `${timestampedRecipeGenerationFolder}/${objectsInfoWrapperFileName}`;
      const objectsInfoWrapperJson = JSON.stringify(objectsInfoWrapper, null, 2);
      pendingFileWrites.push(DirectoryProcessor.writeGeneratedFile(filePathOfOjectsInfoWrapperJson, objectsInfoWrapperJson, `an error occurred when attempting to create the "${objectsInfoWrapperFileName}" file.`));

      // SETTLED BEFORE A FAILURE IS RAISED: Promise.all REJECTS ON THE FIRST ONE WHILE THE REST ARE STILL WRITING, AND THE COCKPIT'S Regenerate RELOADS THE RUN AS SOON AS THE COMMAND SETTLES
      const settledFileWrites = await Promise.allSettled(pendingFileWrites);
      const failedFileWrite = settledFileWrites.find((settledFileWrite): settledFileWrite is PromiseRejectedResult => settledFileWrite.status === 'rejected');
      if ( failedFileWrite ) {
          throw failedFileWrite.reason;
      }

      return {
          runFolderPath: timestampedRecipeGenerationFolder,
          recipeFilePaths: recipeFilePaths
      };

  }

  private static async writeGeneratedFile(filePath: string, content: string, failureMessage: string): Promise<void> {

      try {
          await fs.promises.writeFile(filePath, content);
      } catch (writeError) {
          // A NODE fs ERROR NAMES THE ABSOLUTE PATH, AND THE WORKSPACE ROOT'S FOLDER NAME IS NOT AN API NAME -- THE MESSAGE IS SHOWN IN A NOTIFICATION
          const writeErrorDetail = writeError instanceof Error ? writeError.message : String(writeError);
          throw new Error(`${failureMessage} ${DirectoryProcessor.escapeForNotification(writeErrorDetail)}`);
      }

  }

}





