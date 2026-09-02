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
import { PicklistDependencyCheckService, PicklistDependencyDeployReason } from "../PicklistDependencyCheckService/PicklistDependencyCheckService";
import { PicklistDependencyExplorerService, IPicklistDependencyExplorerViewModel } from "../PicklistDependencyExplorerService/PicklistDependencyExplorerService";

import { AuthInfo } from '@salesforce/core';

import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as vscode from 'vscode';
import path = require("path");

// SHARED WITH THE TESTS SO THE BUTTON LABEL CANNOT DRIFT FROM WHAT IS ASSERTED
export const RUN_AGAINST_ORG_ACTION_LABEL = 'Deploy and Run Against Org';

// SHARED WITH THE TESTS SO THE PANEL'S VIEW TYPE CANNOT DRIFT FROM WHAT IS ASSERTED
export const PICKLIST_DEPENDENCY_EXPLORER_VIEW_TYPE = 'treecipe.picklistDependencyExplorer';

interface IPicklistDependencyGenerationResult {
    classesDirectoryPath: string;
    specsClassFilePath: string;
    specCount: number;
    generationSummary: string;
}

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

    /*
        Shared by the generate command and the end to end command. Returns undefined when there is
        nothing to generate or the user declined an overwrite, both of which are already reported --
        callers stop quietly rather than reporting a second time.
    */
    private async generatePicklistDependencyClasses(extensionPath: string, workspaceRoot: string): Promise<IPicklistDependencyGenerationResult | undefined> {

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
            return undefined;
        }

        const packageDirectoryPath = PicklistDependencyTestService.resolveDefaultPackageDirectoryPath(workspaceRoot);
        const classesDirectoryPath = PicklistDependencyTestService.getClassesDirectoryPath(packageDirectoryPath);
        PicklistDependencyTestService.assertClassesDirectoryContainedInWorkspace(classesDirectoryPath, workspaceRoot);

        const specsClassFilePath = PicklistDependencyTestService.getSpecsClassFilePath(classesDirectoryPath);
        const specsClassName = PicklistDependencyTestService.getSpecsClassName();
        const specsTestClassFilePath = PicklistDependencyTestService.getSpecsTestClassFilePath(classesDirectoryPath);
        const specsTestClassName = PicklistDependencyTestService.getSpecsTestClassName();

        // EVERY GENERATED FILE IS CONSIDERED SO A HAND EDITED meta xml CANNOT BE REPLACED WITHOUT A PROMPT
        const existingGeneratedFilePaths = [
            specsClassFilePath,
            `${specsClassFilePath}-meta.xml`,
            specsTestClassFilePath,
            `${specsTestClassFilePath}-meta.xml`
        ].filter(
            generatedFilePath => fs.existsSync(generatedFilePath)
        );

        if ( existingGeneratedFilePaths.length > 0 ) {

            const confirmedOverwriteSelection = await vscode.window.showWarningMessage(
                `${existingGeneratedFilePaths.map(existingFilePath => `"${path.basename(existingFilePath)}"`).join(' and ')} already exist(s) in "${classesDirectoryPath}". Regenerating overwrites them, and any spec lines tightened to "expectExactly" by hand will be lost.`,
                { modal: true },
                'Overwrite'
            );

            if ( confirmedOverwriteSelection !== 'Overwrite' ) {
                return undefined;
            }

        }

        const sourceApiVersion = PicklistDependencyTestService.getSourceApiVersion(workspaceRoot);

        const specsClassWriteResult = PicklistDependencyTestService.writeSpecsClassFiles(
            classesDirectoryPath,
            collectionResult.specDetails,
            sourceApiVersion
        );

        PicklistDependencyTestService.writeSpecsTestClassFiles(
            classesDirectoryPath,
            PicklistDependencyTestService.buildSpecsTestApexClassBody(collectionResult.specDetails),
            sourceApiVersion
        );

        const frameworkScaffoldResult = PicklistDependencyTestService.scaffoldMissingFrameworkClasses(extensionPath, classesDirectoryPath);

        /*
            The generated specs class does not compile without the framework, so a class that could
            not be supplied is surfaced rather than leaving the user with a file that silently fails
            to deploy.
        */
        if ( frameworkScaffoldResult.unavailableClassNames.length > 0 ) {
            VSCodeWorkspaceService.showWarningMessage(`${specsClassName}.cls was generated, but the required framework class(es) ${frameworkScaffoldResult.unavailableClassNames.join(', ')} could not be added to "${classesDirectoryPath}" and are not already present. The generated class will not compile until they are added from the Salesforce Data Treecipe repository.`);
        }

        const perObjectClassCount = Object.keys(specsClassWriteResult.perObjectClassFilePathsByObjectApiName).length;

        let generationSummary = `Generated ${collectionResult.specDetails.length} picklist dependency spec(s) across ${perObjectClassCount} per-object class(es), aggregated by ${specsClassName}.cls and asserted by ${specsTestClassName}.cls, in "${classesDirectoryPath}".`;
        if ( frameworkScaffoldResult.scaffoldedClassNames.length > 0 ) {
            generationSummary += ` Also scaffolded the required framework class(es): ${frameworkScaffoldResult.scaffoldedClassNames.join(', ')}.`;
        }
        if ( specsClassWriteResult.removedStaleClassFilePaths.length > 0 ) {
            generationSummary += ` Removed ${specsClassWriteResult.removedStaleClassFilePaths.length} generated class(es) for object(s) no longer declaring a dependent picklist: ${specsClassWriteResult.removedStaleClassFilePaths.map(staleFilePath => path.basename(staleFilePath)).join(', ')}.`;
        }

        /*
            Surfaced after generation rather than before it: the new classes are written either way,
            and the warning is about cleaning up what an earlier version left behind.
        */
        const legacyArtifactPaths = PicklistDependencyTestService.detectLegacyGeneratedArtifacts(classesDirectoryPath);
        if ( legacyArtifactPaths.length > 0 ) {
            VSCodeWorkspaceService.showWarningMessage(PicklistDependencyTestService.buildLegacyArtifactWarning(legacyArtifactPaths));
        }

        return {
            classesDirectoryPath,
            specsClassFilePath,
            specCount: collectionResult.specDetails.length,
            generationSummary
        };

    }

    /*
        Returns undefined both when no org is authenticated and when the quick pick is dismissed. The
        first case is reported here, because an empty picker would leave the user with nothing to
        select and no indication that authentication is what is missing.
    */
    private async promptForPicklistDependencyTargetOrg(): Promise<string | undefined> {

        const allAuthorizations = await AuthInfo.listAllAuthorizations();
        const authenticatedOrgDetails = PicklistDependencyCheckService.buildAuthenticatedOrgDetails(allAuthorizations);

        if ( authenticatedOrgDetails.length === 0 ) {
            vscode.window.showWarningMessage('No authenticated Salesforce orgs were found. Authorize one with "sf org login web" and run the command again.');
            return undefined;
        }

        return await VSCodeWorkspaceService.promptForAuthenticatedTargetOrg(authenticatedOrgDetails);

    }

    /*
        Deploys when needed, runs the generated tests, then reports to the output channel, a summary
        notification and an artifact folder.

        alwaysDeploy is what separates the two callers. The check command deploys only when the test
        class is absent, so an unchanged registry is not redeployed on every run. The end to end
        command has just rewritten those classes, so the org copy is stale by definition and a
        conditional deploy would run yesterday's contract against today's metadata.
    */
    private async deployRunAndReportPicklistDependencyCheck(targetOrgIdentifier: string,
                                                            workspaceRoot: string,
                                                            classesDirectoryPath: string,
                                                            alwaysDeploy: boolean) {

        const checkOutcome = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Picklist Dependency Check',
            cancellable: true
        }, async (progress, cancellationToken) => {

            const registerCancellation = (killChildProcess: () => void) => {
                cancellationToken.onCancellationRequested(() => killChildProcess());
            };

            let deployRequired = alwaysDeploy;

            // ALWAYS-DEPLOY ARRIVES HERE BECAUSE THE CLASSES WERE JUST REWRITTEN, NOT BECAUSE THE ORG WAS ASKED
            let deployReason: PicklistDependencyDeployReason = 'specsClassesJustRegenerated';

            if ( !deployRequired ) {

                progress.report({ message: `Checking ${targetOrgIdentifier} for the generated test class...` });
                deployRequired = !(await PicklistDependencyCheckService.isSpecsTestClassDeployedInOrg(targetOrgIdentifier));
                deployReason = 'specsTestClassAbsentFromOrg';

                if ( cancellationToken.isCancellationRequested ) {
                    return undefined;
                }

            }

            if ( deployRequired ) {

                /*
                    Validated before the confirmation is built, because the confirmation lists the
                    files that will be sent. A workspace where generation never ran would otherwise
                    show an approval dialog offering zero files, and only produce the actionable
                    "run Generate first" error once the user had approved it.
                */
                PicklistDependencyCheckService.assertDeployableClassesExist(classesDirectoryPath);

                const confirmedDeploySelection = await vscode.window.showWarningMessage(
                    PicklistDependencyCheckService.buildDeployConfirmationMessage(classesDirectoryPath, targetOrgIdentifier, deployReason),
                    { modal: true },
                    'Deploy and Run'
                );

                if ( confirmedDeploySelection !== 'Deploy and Run' ) {
                    vscode.window.showInformationMessage('Picklist dependency check cancelled. Nothing was deployed.');
                    return undefined;
                }

                progress.report({ message: `Deploying picklist dependency classes to ${targetOrgIdentifier}...` });

                const deploySummary = await PicklistDependencyCheckService.deployPicklistDependencyClasses(
                    classesDirectoryPath,
                    targetOrgIdentifier,
                    registerCancellation
                );

                vscode.window.showInformationMessage(deploySummary);

            }

            if ( cancellationToken.isCancellationRequested ) {
                return undefined;
            }

            progress.report({ message: `Running ${PicklistDependencyCheckService.getSpecsTestClassName()} against ${targetOrgIdentifier}...` });

            return await PicklistDependencyCheckService.runPicklistDependencyTests(targetOrgIdentifier, registerCancellation);

        });

        // UNDEFINED MEANS THE USER CANCELLED OR DECLINED THE DEPLOY, BOTH OF WHICH ALREADY REPORTED
        if ( !checkOutcome ) {
            return;
        }

        const report = PicklistDependencyCheckService.buildOutputChannelReport(targetOrgIdentifier, checkOutcome);
        VSCodeWorkspaceService.showPicklistDependencyCheckReport(report);

        /*
            The output channel is cleared on every run, so the results are also written to the
            treecipe directory -- a run that found drift leaves something committable and
            diffable behind rather than only an on screen report.
        */
        const isoDateTimestamp = VSCodeWorkspaceService.getNowIsoDateTimestamp();
        const resultsFolderPath = `${workspaceRoot}/${ConfigurationService.getPicklistDependencyResultsFolderPath()}`;

        const runResultsFolderPath = PicklistDependencyCheckService.writeCheckResultArtifacts(
            resultsFolderPath,
            targetOrgIdentifier,
            isoDateTimestamp,
            checkOutcome
        );

        const resultSummaryMessage = PicklistDependencyCheckService.buildResultSummaryMessage(checkOutcome);
        const summaryWithArtifactPath = `${resultSummaryMessage} Results written to "${runResultsFolderPath}".`;

        if ( checkOutcome.passed ) {
            vscode.window.showInformationMessage(summaryWithArtifactPath);
        } else {
            VSCodeWorkspaceService.showWarningMessage(summaryWithArtifactPath);
        }

    }

    /*
        Generates the contract, then OFFERS to run it against an org in the same invocation.

        The offer comes after generation rather than before it. Generating is the useful half on its
        own -- a user reviewing what changed, or working without an org to hand, wants the files and
        nothing else -- so the run is opt in and dismissing the prompt leaves a completed generation
        rather than a cancelled command.
    */
    async generatePicklistDependencyTests(extensionPath: string) {

        try {

            const workspaceRoot = VSCodeWorkspaceService.getWorkspaceRoot();
            if ( !workspaceRoot ) {
                throw new Error('There doesn\'t seem to be any folders or a workspace in this VSCode Window.');
            }

            const generationResult = await this.generatePicklistDependencyClasses(extensionPath, workspaceRoot);
            if ( !generationResult ) {
                return;
            }

            await VSCodeWorkspaceService.openFileInEditor(generationResult.specsClassFilePath);

            const runAgainstOrgSelection = await vscode.window.showInformationMessage(
                `${generationResult.generationSummary} Deploy and run them against an org now?`,
                RUN_AGAINST_ORG_ACTION_LABEL
            );

            if ( runAgainstOrgSelection !== RUN_AGAINST_ORG_ACTION_LABEL ) {
                return;
            }

            const targetOrgIdentifier = await this.promptForPicklistDependencyTargetOrg();
            if ( !targetOrgIdentifier ) {
                return;
            }

            // ALWAYS DEPLOYS: THE CLASSES WERE JUST REWRITTEN, SO THE ORG COPY IS STALE BY DEFINITION
            await this.deployRunAndReportPicklistDependencyCheck(
                targetOrgIdentifier,
                workspaceRoot,
                generationResult.classesDirectoryPath,
                true
            );

        } catch(error) {

            const commandName = 'generatePicklistDependencyTests';
            ErrorHandlingService.handleCapturedError(error, commandName);

        }

    }

    async runPicklistDependencyCheck() {

        try {

            const workspaceRoot = VSCodeWorkspaceService.getWorkspaceRoot();
            if ( !workspaceRoot ) {
                throw new Error('There doesn\'t seem to be any folders or a workspace in this VSCode Window.');
            }

            const targetOrgIdentifier = await this.promptForPicklistDependencyTargetOrg();
            if ( !targetOrgIdentifier ) {
                return;
            }

            const packageDirectoryPath = PicklistDependencyTestService.resolveDefaultPackageDirectoryPath(workspaceRoot);
            const classesDirectoryPath = PicklistDependencyTestService.getClassesDirectoryPath(packageDirectoryPath);
            PicklistDependencyTestService.assertClassesDirectoryContainedInWorkspace(classesDirectoryPath, workspaceRoot);

            await this.deployRunAndReportPicklistDependencyCheck(
                targetOrgIdentifier,
                workspaceRoot,
                classesDirectoryPath,
                false
            );

        } catch(error) {

            const commandName = 'runPicklistDependencyCheck';
            ErrorHandlingService.handleCapturedError(error, commandName);

        }

    }

    /*
        Reads local source metadata and the most recent persisted check, and renders both in a
        webview panel.

        A webview rather than a served page: the panel needs no port, no runtime dependency and no
        second process, and it inherits the user's theme for free. The content security policy below
        allows only the nonced inline style and script this extension emits, so the panel cannot
        reach the network even if a picklist value tried to make it.
    */
    async openPicklistDependencyExplorer() {

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

            const resultsFolderPath = path.join(workspaceRoot, ConfigurationService.getPicklistDependencyResultsFolderPath());
            const resultsLoad = PicklistDependencyExplorerService.loadLatestResults(resultsFolderPath);

            const explorerViewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                fullPathToObjectsDirectory,
                collectionResult.specDetails,
                collectionResult.skippedFieldWarnings,
                resultsLoad
            );

            this.showPicklistDependencyExplorerPanel(explorerViewModel);

        } catch(error) {

            const commandName = 'openPicklistDependencyExplorer';
            ErrorHandlingService.handleCapturedError(error, commandName);

        }

    }

    private showPicklistDependencyExplorerPanel(explorerViewModel: IPicklistDependencyExplorerViewModel) {

        const explorerPanel = vscode.window.createWebviewPanel(
            PICKLIST_DEPENDENCY_EXPLORER_VIEW_TYPE,
            'Picklist Dependency Explorer',
            vscode.ViewColumn.One,
            /*
                No localResourceRoots are granted. Everything the panel renders is inlined into the
                html, so the panel has no reason to load a file from disk -- and enableScripts is
                what the nonced inline script needs, not a resource grant.
            */
            { enableScripts: true, retainContextWhenHidden: true }
        );

        const nonce = PicklistDependencyExplorerService.buildNonce();
        explorerPanel.webview.html = PicklistDependencyExplorerService.buildWebviewHtml(explorerViewModel, nonce);

        /*
            The panel may only reveal a field file the model it was built from actually names. The
            posted path is matched against that set rather than being validated as a path, so a
            message arriving from anywhere else cannot make the extension host open an arbitrary
            file on the user's disk.
        */
        const revealableSourceFilePaths = new Set(PicklistDependencyExplorerService.collectSourceFilePaths(explorerViewModel));

        explorerPanel.webview.onDidReceiveMessage(async (panelMessage: { command?: string; sourceFilePath?: string }) => {

            if ( panelMessage?.command !== 'revealFieldSource' || !panelMessage.sourceFilePath ) {
                return;
            }

            if ( !revealableSourceFilePaths.has(panelMessage.sourceFilePath) ) {
                return;
            }

            if ( !fs.existsSync(panelMessage.sourceFilePath) ) {
                VSCodeWorkspaceService.showWarningMessage(`The field metadata file "${panelMessage.sourceFilePath}" no longer exists. Re-open the explorer to rebuild it from the current metadata.`);
                return;
            }

            const fieldSourceUri = vscode.Uri.file(panelMessage.sourceFilePath);
            await vscode.commands.executeCommand('revealInExplorer', fieldSourceUri);
            await VSCodeWorkspaceService.openFileInEditor(panelMessage.sourceFilePath);

        });

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
