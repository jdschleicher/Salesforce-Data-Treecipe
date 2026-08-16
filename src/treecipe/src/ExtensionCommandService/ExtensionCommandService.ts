import { ConfigurationService, TreecipeConfigDetail } from "../ConfigurationService/ConfigurationService";
import { DirectoryProcessor } from "../DirectoryProcessingService/DirectoryProcessor";
import { ErrorHandlingService } from "../ErrorHandlingService/ErrorHandlingService";
import { ObjectInfoWrapper } from "../ObjectInfoWrapper/ObjectInfoWrapper";
import { VSCodeWorkspaceService } from "../VSCodeWorkspace/VSCodeWorkspaceService";
import { CollectionsApiService } from "../CollectionsApiService/CollectionsApiService";
import { RecordTypeService } from "../RecordTypeService/RecordTypeService";
import { IFakerRecipeProcessor } from "../FakerRecipeProcessor/IFakerRecipeProcessor";
import { FakerJSRecipeProcessor } from "../FakerRecipeProcessor/FakerJSRecipeProcessor/FakerJSRecipeProcessor";
import { GlobalValueSetSingleton } from "../GlobalValueSetSingleton/GlobalValueSetSingleton";
import { PicklistDependencyTestService } from "../PicklistDependencyTestService/PicklistDependencyTestService";

import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as vscode from 'vscode';
import path = require("path");

export class ExtensionCommandService {
    
    async initiateTreecipeConfigurationSetup() {

        try {

            await ConfigurationService.createTreecipeJSONConfigurationFile();

        } catch(error) {

            const commandName = 'initiateTreecipeConfigurationSetup';
            ErrorHandlingService.handleCapturedError(error, commandName);

        }

    }

    async runFakerGenerationByRecipeFile() {

        try {
            
            const expectedGeneratedRecipesFolderPath = ConfigurationService.getGeneratedRecipesFolderPath();
            const vsCodeQuickPickItemPromptLabel = 'Select recipe file to process';
            const selectedRecipeFilePathNameQuickPickItem:vscode.QuickPickItem  = await VSCodeWorkspaceService.promptForDirectoryToGenerateQuickItemsForFileSelection(expectedGeneratedRecipesFolderPath, vsCodeQuickPickItemPromptLabel);
            if (!selectedRecipeFilePathNameQuickPickItem) {
                return;
            }
            const recipeFullFileNamePath = selectedRecipeFilePathNameQuickPickItem.detail;

            const recipeYamlContent = fs.readFileSync(recipeFullFileNamePath, 'utf8');
            const parsedRecipeYaml = yaml.load(recipeYamlContent) as any[];
            const dataStructureSummary = FakerJSRecipeProcessor.buildRecipeDataStructureSummary(parsedRecipeYaml);

            const confirmed = await vscode.window.showInformationMessage(
                dataStructureSummary,
                { modal: true },
                'Generate Data'
            );

            if (confirmed !== 'Generate Data') {
                return;
            }

            let fakerRecipeProcessor:IFakerRecipeProcessor = ConfigurationService.getFakerRecipeProcessorByExtensionConfigSelection();

            const fakerJsonResult:string = await fakerRecipeProcessor.generateFakeDataBySelectedRecipeFile(recipeFullFileNamePath) as string;

            const isoDateTimestamp = VSCodeWorkspaceService.getNowIsoDateTimestamp();
            const uniqueTimeStampedFakeDataSetsFolderName = VSCodeWorkspaceService.createFakeDatasetsTimeStampedFolderName(isoDateTimestamp);
            const fullPathToUniqueTimeStampedFakeDataSetsFolder = VSCodeWorkspaceService.createUniqueTimeStampedFakeDataSetsFolderName(uniqueTimeStampedFakeDataSetsFolderName);

            const mappedSObjectApiToRecords = fakerRecipeProcessor.transformFakerJsonDataToCollectionApiFormattedFilesBySObject(fakerJsonResult);

            const directoryToStoreCollectionDatasetFiles = ConfigurationService.getDatasetFilesForCollectionsApiFolderName();
            const fullPathToStoreDatasetFiles = `${fullPathToUniqueTimeStampedFakeDataSetsFolder}/${directoryToStoreCollectionDatasetFiles}`;
            fs.mkdirSync(fullPathToStoreDatasetFiles);

            mappedSObjectApiToRecords.forEach((collectionsApiContent, sobjectApiName) => {
                CollectionsApiService.createCollectionsApiFile(
                    sobjectApiName, 
                    collectionsApiContent, 
                    fullPathToStoreDatasetFiles
                );
            });
            
            const baseArtifactsFoldername = ConfigurationService.getBaseArtifactsFolderName();
            const fullPathToBaseArtifactsFolder = `${fullPathToUniqueTimeStampedFakeDataSetsFolder}/${baseArtifactsFoldername}`;
            fs.mkdirSync(fullPathToBaseArtifactsFolder);
            fs.copyFileSync(recipeFullFileNamePath, `${fullPathToBaseArtifactsFolder}/originalRecipe-${selectedRecipeFilePathNameQuickPickItem.label}`);

            /* 
                The below lines get the timestamped parent recipe folder 
                in order to traverse through and get all other artifacts files to use in
                data generation and inserts commands
                
                Since recipe files are now in subdirectories (e.g., GeneratedRecipes/RelationshipTree1/recipe.yaml),
                we need to go up one level from the recipe's immediate parent to find the treecipe wrapper
            */
            const selectedRecipeParentDirectory = path.dirname(recipeFullFileNamePath);
            if ( path.basename(selectedRecipeParentDirectory) !== "GeneratedRecipes" ) {
                // Go up one directory level to find the treecipe wrapper file
                const directoryToSearchForWrapper = path.join(selectedRecipeParentDirectory, '..');
                const filesWithinSelecteRecipeFolder = fs.readdirSync(directoryToSearchForWrapper, { withFileTypes: true });
                const expectedObjectsInfoWrapperNamePrefix = ConfigurationService.getTreecipeObjectsWrapperName();
                const matchingTreecipeObjectsWrapperFile = filesWithinSelecteRecipeFolder.find(file => 
                    file.isFile() && file.name.startsWith(expectedObjectsInfoWrapperNamePrefix)
                );
    
                if ( matchingTreecipeObjectsWrapperFile ) {
                    const fullTreecipeObjectsWrapperPath = path.join(directoryToSearchForWrapper, matchingTreecipeObjectsWrapperFile.name);
                    fs.copyFileSync(fullTreecipeObjectsWrapperPath, `${fullPathToBaseArtifactsFolder}/originalTreecipeWrapper-${matchingTreecipeObjectsWrapperFile.name}`);
                } else {
                    throw new Error('Selected directory doesnt have an expected OriginalTreecipeWrapper file');
                }
            }
       

        } catch(error) {

            const commandName = 'runFakerGenerationByRecipeFile';
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
                
                /* 
                -- initialize globalvaluesets singleton --
                 at this point in the extension commands, where a command is entered to generate a reciipe, we should retrieve the globalvaluesets 
                 as there could be changes that have taken place throughout the vscode instance of the user
                */
                const isGlobalValuesInitializedOnExtensionStartUpOverride = false;
                const pathToSalesforceMetadataParentDirectory = VSCodeWorkspaceService.getParentPath(fullPathToObjectsDirectory);
                let globalValueSetSingleton = GlobalValueSetSingleton.getInstance();
                globalValueSetSingleton.initialize(pathToSalesforceMetadataParentDirectory, isGlobalValuesInitializedOnExtensionStartUpOverride);

                const directoryProcessor = new DirectoryProcessor();
                const objectsTargetUri = vscode.Uri.file(fullPathToObjectsDirectory);
            
                const result = await directoryProcessor.processAllObjectsAndRelationships(objectsTargetUri);

                await directoryProcessor.createRecipeFilesInSubdirectory(result, workspaceRoot);


            } else {
                throw new Error('There doesn\'t seem to be any folders or a workspace in this VSCode Window.');
            }

          

        } catch (error) {

            const commandName = 'generateRecipeFromConfigurationDetail';
            ErrorHandlingService.handleCapturedError(error, commandName);
            
        }
      
    }

    async generatePicklistDependencyTests(extensionPath: string) {

        try {

            const workspaceRoot = VSCodeWorkspaceService.getWorkspaceRoot();
            if ( !workspaceRoot ) {
                throw new Error('There doesn\'t seem to be any folders or a workspace in this VSCode Window.');
            }

            const relativePathToObjectsDirectory = ConfigurationService.getObjectsPathFromTreecipeJSONConfiguration();
            const pathWithoutRelativeSyntax = relativePathToObjectsDirectory.split("./")[1];
            const fullPathToObjectsDirectory = `${workspaceRoot}/${pathWithoutRelativeSyntax}`;

            if ( !fs.existsSync(fullPathToObjectsDirectory) ) {
                throw new Error(`No objects directory found at "${fullPathToObjectsDirectory}". Check the "salesforceObjectsPath" value in treecipe.config.json, or re-run "Initiate Configuration File", and run the command again.`);
            }

            const objectsTargetUri = vscode.Uri.file(fullPathToObjectsDirectory);

            const collectionResult = await PicklistDependencyTestService.collectSpecDetailsByObjectsDirectory(objectsTargetUri);

            /*
                A field with a controlling field but no value settings is reported and skipped, it does
                not abort the run. Only the first few are shown individually so a misconfigured org
                cannot bury the user in notifications.
            */
            const maximumIndividualWarningsToShow = 3;
            collectionResult.skippedFieldWarnings.slice(0, maximumIndividualWarningsToShow).forEach(skippedFieldWarning => {
                VSCodeWorkspaceService.showWarningMessage(skippedFieldWarning);
            });

            const remainingSkippedFieldCount = collectionResult.skippedFieldWarnings.length - maximumIndividualWarningsToShow;
            if ( remainingSkippedFieldCount > 0 ) {
                // THE SUPPRESSED SKIPS MAY BE A MIX OF INVALID API NAMES AND MISSING VALUE SETTINGS, SO NO SINGLE REASON IS CLAIMED
                VSCodeWorkspaceService.showWarningMessage(`...and ${remainingSkippedFieldCount} more dependent picklist field(s) were skipped. Each was skipped either for an invalid api name or for having no "valueSettings" markup.`);
            }

            if ( collectionResult.specDetails.length === 0 ) {
                vscode.window.showInformationMessage(`No dependent picklists were found in "${fullPathToObjectsDirectory}". No Apex spec file was written.`);
                return;
            }

            const packageDirectoryPath = PicklistDependencyTestService.resolveDefaultPackageDirectoryPath(workspaceRoot);
            const classesDirectoryPath = PicklistDependencyTestService.getClassesDirectoryPath(packageDirectoryPath);
            const specsClassFilePath = PicklistDependencyTestService.getSpecsClassFilePath(classesDirectoryPath);
            const specsClassName = PicklistDependencyTestService.getSpecsClassName();

            // BOTH GENERATED FILES ARE CONSIDERED SO A HAND EDITED meta xml CANNOT BE REPLACED WITHOUT A PROMPT
            const existingGeneratedFilePaths = [specsClassFilePath, `${specsClassFilePath}-meta.xml`].filter(
                generatedFilePath => fs.existsSync(generatedFilePath)
            );

            if ( existingGeneratedFilePaths.length > 0 ) {

                const confirmedOverwriteSelection = await vscode.window.showWarningMessage(
                    `${existingGeneratedFilePaths.map(existingFilePath => `"${path.basename(existingFilePath)}"`).join(' and ')} already exist(s) in "${classesDirectoryPath}". Regenerating overwrites them, and any spec lines tightened to "expectExactly" by hand will be lost.`,
                    { modal: true },
                    'Overwrite'
                );

                if ( confirmedOverwriteSelection !== 'Overwrite' ) {
                    return;
                }

            }

            const apexClassBody = PicklistDependencyTestService.buildSpecsApexClassBody(collectionResult.specDetails);
            const sourceApiVersion = PicklistDependencyTestService.getSourceApiVersion(workspaceRoot);
            PicklistDependencyTestService.writeSpecsClassFiles(classesDirectoryPath, apexClassBody, sourceApiVersion);

            const frameworkScaffoldResult = PicklistDependencyTestService.scaffoldMissingFrameworkClasses(extensionPath, classesDirectoryPath);

            /*
                The generated specs class does not compile without the framework, so a class that could
                not be supplied is surfaced rather than leaving the user with a file that silently fails
                to deploy.
            */
            if ( frameworkScaffoldResult.unavailableClassNames.length > 0 ) {
                VSCodeWorkspaceService.showWarningMessage(`${specsClassName}.cls was generated, but the required framework class(es) ${frameworkScaffoldResult.unavailableClassNames.join(', ')} could not be added to "${classesDirectoryPath}" and are not already present. The generated class will not compile until they are added from the Salesforce Data Treecipe repository.`);
            }

            let generationSummary = `Generated ${specsClassName}.cls with ${collectionResult.specDetails.length} picklist dependency spec(s) in "${classesDirectoryPath}".`;
            if ( frameworkScaffoldResult.scaffoldedClassNames.length > 0 ) {
                generationSummary += ` Also scaffolded the required framework class(es): ${frameworkScaffoldResult.scaffoldedClassNames.join(', ')}.`;
            }
            vscode.window.showInformationMessage(generationSummary);

            await VSCodeWorkspaceService.openFileInEditor(specsClassFilePath);

        } catch(error) {

            const commandName = 'generatePicklistDependencyTests';
            ErrorHandlingService.handleCapturedError(error, commandName);

        }

    }

    async insertDataSetBySelectedDirectory() {

        try {

            const selectedDataSetDirectoryToInsert:vscode.QuickPickItem = await CollectionsApiService.promptForDataSetObjectsPathVSCodeQuickItems();
            
            if (!selectedDataSetDirectoryToInsert) {
                return;
            }

            const targetOrgAlias = await CollectionsApiService.getExpectedSalesforceOrgToInsertAgainst();
            if (!targetOrgAlias) {
                return;
            }

            const allOrNoneSelection:boolean = await CollectionsApiService.promptForAllOrNoneInsertDecision();
            if (allOrNoneSelection === undefined) {
                return;
            }
            
            const aliasAuthenticationConnection = await CollectionsApiService.getConnectionFromAlias(targetOrgAlias);

            const selectedDataSetFullDirectoryPath = selectedDataSetDirectoryToInsert.detail;
            const datasetChildFoldersToFilesMap = await CollectionsApiService.getDataSetChildDirectoriesNameToFilesMap(selectedDataSetFullDirectoryPath);
            
            const treecipeObjectWrapperDetail = await CollectionsApiService.getTreecipeObjectsWrapperDetailByDataSetDirectoriesToFilesMap(datasetChildFoldersToFilesMap);
            
            const objectApiNamesToGetRecordTypeInfoFrom = Object.keys(treecipeObjectWrapperDetail.ObjectToObjectInfoMap);

            const recordTypeDetailFromOrg = await RecordTypeService.getRecordTypeIdsByConnection(aliasAuthenticationConnection, objectApiNamesToGetRecordTypeInfoFrom);

            await CollectionsApiService.upsertDataSetToSelectedOrg(selectedDataSetFullDirectoryPath,
                                                                    datasetChildFoldersToFilesMap, 
                                                                    recordTypeDetailFromOrg, 
                                                                    aliasAuthenticationConnection,
                                                                    allOrNoneSelection);                  

        } catch(error) {

            const commandName = 'insertDataSetBySelectedDirectory';
            ErrorHandlingService.handleCapturedError(error, commandName);

        }
        
    }

    async changeFakerImplementationService() {

        try {

            let selectedDataFakerService = await VSCodeWorkspaceService.promptForFakerServiceImplementation();
            ConfigurationService.setExtensionConfigValue('selectedFakerService', selectedDataFakerService);
            
            const existingTreecipeConfigDetail:TreecipeConfigDetail = ConfigurationService.getTreecipeConfigurationDetail();
            existingTreecipeConfigDetail.dataFakerService = selectedDataFakerService;
            await ConfigurationService.updateTreecipeConfigFile(existingTreecipeConfigDetail);
            
        } catch(error) {

            const commandName = 'changeFakerImplementationService';
            ErrorHandlingService.handleCapturedError(error, commandName);

        }

       

	}

}
