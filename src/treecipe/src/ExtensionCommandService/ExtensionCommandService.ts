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
import { PicklistDependencyTestService, ISpecsChangePlan, IPlannedSpecsFile, IPicklistDependencySpecDetail } from "../PicklistDependencyTestService/PicklistDependencyTestService";
import { PicklistDependencyCheckService, PicklistDependencyDeployReason } from "../PicklistDependencyCheckService/PicklistDependencyCheckService";
import { PicklistDependencyExplorerService, IPicklistDependencyExplorerViewModel } from "../PicklistDependencyExplorerService/PicklistDependencyExplorerService";
import { PicklistDependencyManifestService } from "../PicklistDependencyManifestService/PicklistDependencyManifestService";
import { PicklistDependencyMetadataWriterService } from "../PicklistDependencyMetadataWriterService/PicklistDependencyMetadataWriterService";

import { AuthInfo } from '@salesforce/core';

import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as vscode from 'vscode';
import path = require("path");

// SHARED WITH THE TESTS SO THE BUTTON LABEL CANNOT DRIFT FROM WHAT IS ASSERTED
export const RUN_AGAINST_ORG_ACTION_LABEL = 'Deploy and Run Against Org';

// SHARED WITH THE TESTS SO THE PANEL'S VIEW TYPE CANNOT DRIFT FROM WHAT IS ASSERTED
export const PICKLIST_DEPENDENCY_EXPLORER_VIEW_TYPE = 'treecipe.picklistDependencyExplorer';

// SHARED WITH THE TESTS SO THE OPT IN LABEL CANNOT DRIFT FROM WHAT IS ASSERTED
export const PREVIEW_FROM_METADATA_ACTION_LABEL = 'Preview from metadata (not generated)';

// SHARED WITH THE TESTS SO THESE LABELS CANNOT DRIFT FROM WHAT IS ASSERTED
export const UPDATE_METADATA_ACTION_LABEL = 'Update Metadata';
export const DEPLOY_UPDATED_METADATA_ACTION_LABEL = 'Deploy to Org';

/*
    Everything the explorer webview can post back, as ONE shape with every field optional.

    Typed here rather than inline so each handler below states which fields its command requires and
    the compiler holds it to them. Nothing in this shape is trusted: every value is checked against
    an allow-list built from the rendered model before it reaches the file system or the clipboard.
*/
interface IPicklistDependencyExplorerPanelMessage {
    command?: string;
    sourceFilePath?: string;
    specFilePath?: string;
    reportFilePath?: string;
    methodName?: string;
    combinationKey?: string;
}

interface IPicklistDependencyGenerationResult {
    classesDirectoryPath: string;
    specsClassFilePath: string;
    specCount: number;
    generationSummary: string;
    manifestFilePath: string;
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
                const pathToSalesforceMetadataParentDirectory = VSCodeWorkspaceService.getParentPath(fullPathToObjectsDirectory);
                let globalValueSetSingleton = GlobalValueSetSingleton.getInstance();

                /*
                    Awaited: the walk below reads these sets, so starting it first is a race that
                    empties every global-value-set-backed picklist in the generated recipe whenever
                    the read loses.

                    The directory-level notice is suppressed, matching the picklist dependency paths.
                    Most projects have no global value sets and nothing is missing for them, while a
                    field that DOES need one already generates a TODO naming that field exactly --
                    strictly more useful than a toast on every run. Note this notice never actually
                    appeared before: the call returned at its guard without reaching the check.
                */
                const isMissingGlobalValueSetsDirectoryWarningShown = false;
                await globalValueSetSingleton.initialize(pathToSalesforceMetadataParentDirectory, isMissingGlobalValueSetsDirectoryWarningShown);

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

        /*
            A dependent picklist can take its values from a GLOBAL value set, whose values live
            beside the objects directory rather than in the field file. Spec generation reads them
            from this singleton, so it is initialized here for the same reason recipe generation
            initializes it -- the sets may have changed since the window opened.
        */
        const isMissingGlobalValueSetsDirectoryWarningShown = false;
        const pathToSalesforceMetadataParentDirectory = VSCodeWorkspaceService.getParentPath(fullPathToObjectsDirectory);
        await GlobalValueSetSingleton.getInstance().initialize(pathToSalesforceMetadataParentDirectory, isMissingGlobalValueSetsDirectoryWarningShown);

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
            /*
                The suppressed entries are a mix of reasons, and not all of them are skips: an
                undeclared valueSettings value is DROPPED from a spec that is still generated. The
                wording therefore names the list rather than claiming every entry was skipped, which
                sent a reader looking for a field that was in fact specced.
            */
            VSCodeWorkspaceService.showWarningMessage(`...and ${remainingSkippedFieldCount} more picklist dependency warning(s). Reasons include an invalid api name, no "valueSettings" markup, a record type that assigns no values to the field, a global value set that could not be found, and values a global value set does not declare.`);
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

        const sourceApiVersion = PicklistDependencyTestService.getSourceApiVersion(workspaceRoot);
        const specsTestClassBody = PicklistDependencyTestService.buildSpecsTestApexClassBody(collectionResult.specDetails);

        /*
            Resolved before anything is written, so the run can be cancelled with the generated
            files exactly as they were. The generated classes are meant to be committed and edited
            -- declare the dependency you intend, watch the test go red, fix the org -- and that
            workflow does not survive a regeneration that silently replaces the edit.
        */
        const specsChangePlan = PicklistDependencyTestService.buildSpecsChangePlan(
            classesDirectoryPath,
            collectionResult.specDetails,
            sourceApiVersion,
            collectionResult.recordTypeSpecDetails,
            specsTestClassBody
        );

        const confirmedRegeneration = await this.confirmPicklistDependencySpecsChangePlan(specsChangePlan, classesDirectoryPath);

        if ( !confirmedRegeneration ) {
            return undefined;
        }

        /*
            The plan built for the preview is handed to the writer rather than rebuilt, so what was
            shown in the diff is literally what gets written -- and every object's Apex body is
            constructed once per run instead of twice.
        */
        const specsClassWriteResult = PicklistDependencyTestService.writeSpecsClassFiles(
            classesDirectoryPath,
            collectionResult.specDetails,
            sourceApiVersion,
            collectionResult.recordTypeSpecDetails,
            specsChangePlan
        );

        PicklistDependencyTestService.writeSpecsTestClassFiles(
            classesDirectoryPath,
            specsTestClassBody,
            sourceApiVersion
        );

        /*
            Written from the SAME collectionResult the Apex above was emitted from, in the same run,
            after the write the user approved. That is the whole point of the artifact: the Explorer
            reads this instead of re-walking the source XML at panel-open time, so the panel and the
            generated specs cannot be two derivations of metadata that has moved between them.

            It goes under the treecipe directory rather than beside the .cls files: a stray json in a
            package directory is not valid Salesforce metadata and would ride into "sf project
            deploy" and fail the deploy it describes.
        */
        const specsFolderPath = path.join(workspaceRoot, ConfigurationService.getPicklistDependencySpecsFolderPath());

        const manifest = PicklistDependencyManifestService.buildManifest(
            collectionResult,
            fullPathToObjectsDirectory,
            classesDirectoryPath,
            PicklistDependencyManifestService.getGeneratorVersion(extensionPath),
            VSCodeWorkspaceService.getNowIsoDateTimestamp(),
            PicklistDependencyManifestService.buildSourceFingerprint(fullPathToObjectsDirectory)
        );

        const manifestFilePath = PicklistDependencyManifestService.writeManifest(specsFolderPath, manifest);

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

        let generationSummary = `Generated ${collectionResult.specDetails.length} picklist dependency spec(s) across ${perObjectClassCount} per-object class(es), aggregated by ${specsClassName}.cls and asserted by ${specsTestClassName}.cls, in "${classesDirectoryPath}". The Picklist Dependency Explorer reads "${manifestFilePath}" to render exactly these specs.`;
        if ( collectionResult.recordTypeSpecDetails.length > 0 ) {
            // THE RECORD TYPE SCOPED SPECS ARE NOT IN all(), SO THE SUMMARY SAYS WHERE THEY ARE INSTEAD OF LEAVING THEM UNMENTIONED
            generationSummary += ` Also generated ${collectionResult.recordTypeSpecDetails.length} record-type-scoped spec(s), aggregated by ${specsClassName}.allRecordTypeScoped(). These are not asserted by ${specsTestClassName}.cls: Schema describe returns picklist values without record type filtering, so they need a record-type-aware ISDTPicklistDependencySource.`;
        }
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
            generationSummary,
            manifestFilePath
        };

    }

    /*
        Returns undefined both when no org is authenticated and when the quick pick is dismissed. The
        first case is reported here, because an empty picker would leave the user with nothing to
        select and no indication that authentication is what is missing.
    */
    /*
        Whether to go ahead with a regeneration, given what it would do.

        Returns true without prompting when the plan changes nothing: regenerating from unchanged
        metadata is a no-op now that emission is deterministic, and a modal asking permission to
        rewrite files with their own content is noise that trains the user to click through.
    */
    private async confirmPicklistDependencySpecsChangePlan(specsChangePlan: ISpecsChangePlan, classesDirectoryPath: string): Promise<boolean> {

        /*
            Two runs need no prompt: one that changes nothing (regenerating from unchanged metadata
            is a no-op now that emission is deterministic), and one that only adds files, which
            takes nothing away to review.
        */
        if ( !specsChangePlan.hasChanges || !PicklistDependencyTestService.planReplacesExistingContent(specsChangePlan) ) {
            return true;
        }

        const changeReport = PicklistDependencyTestService.buildSpecsChangeReport(specsChangePlan);

        // A NEW FILE HAS NO ON DISK SIDE TO COMPARE AGAINST, SO ONLY WHAT WOULD BE REPLACED IS OFFERED
        const diffableFiles = specsChangePlan.plannedFiles.filter(plannedFile => plannedFile.changeType === 'changed');

        const promptMessage = `Regenerating picklist dependency specs in "${classesDirectoryPath}" will:\n\n${changeReport}\n\nCommitted files are best reviewed as a diff afterwards; anything uncommitted is replaced.`;

        let hasOpenedDiff = false;

        while ( true ) {

            const canOfferDiff = diffableFiles.length > 0 && ( !hasOpenedDiff || diffableFiles.length > 1 );
            const diffActionLabel = hasOpenedDiff ? 'Show Another Diff' : 'Show Diff';
            const promptActions = canOfferDiff ? ['Generate', diffActionLabel] : ['Generate'];

            /*
                Modal ONLY until a diff has been opened.

                A VS Code modal blocks the whole workbench, so re-showing one over the diff editor
                would make the diff unreadable: the user would have to dismiss the dialog to look at
                what they just asked to see, and dismissing cancels the run. Once a diff is open the
                confirmation continues as a notification, which leaves the editor interactive while
                still carrying the same two choices.
            */
            const selectedAction = hasOpenedDiff
                ? await vscode.window.showWarningMessage(
                    `Review the diff, then choose. ${changeReport.split('\n')[0]}`, ...promptActions
                )
                : await vscode.window.showWarningMessage(promptMessage, { modal: true }, ...promptActions);

            if ( selectedAction === 'Generate' ) {
                return true;
            }

            if ( selectedAction !== diffActionLabel ) {
                // DISMISSED OR CANCELLED -- NOTHING IS WRITTEN
                return false;
            }

            await this.showPicklistDependencySpecsDiff(diffableFiles);
            hasOpenedDiff = true;

        }

    }

    private async showPicklistDependencySpecsDiff(diffableFiles: IPlannedSpecsFile[]) {

        let fileToDiff = diffableFiles[0];

        if ( diffableFiles.length > 1 ) {

            const selectedFileItem = await vscode.window.showQuickPick(
                diffableFiles.map(diffableFile => ({
                    label: path.basename(diffableFile.filePath),
                    description: diffableFile.objectApiName,
                    detail: diffableFile.filePath
                })),
                { placeHolder: 'Select the generated file to compare against what would be written', ignoreFocusOut: true }
            );

            if ( !selectedFileItem ) {
                return;
            }

            fileToDiff = diffableFiles.find(diffableFile => diffableFile.filePath === selectedFileItem.detail);

        }

        await VSCodeWorkspaceService.showDiffForProposedContent(
            fileToDiff.filePath,
            fileToDiff.proposedContent,
            `${path.basename(fileToDiff.filePath)} (on disk) ↔ (would be generated)`
        );

    }

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

    /*
        Writes the intent a developer declared in the generated Apex specs back into source metadata.

        This runs OPPOSITE to Generate. Generate reads metadata and emits Apex; this reads the Apex
        -- including whatever the developer edited into it -- and reconciles the metadata to match.
        It is the half that closes the loop the picklist dependency check opens: the check tells you
        "cle no longer unlocks plant", the spec is where you declare that it should, and until now
        translating that back into valueSettings was a hand transpose across blocks the failure
        message does not point at.

        Nothing is written before the user sees what would change. The report is shown first and
        declining leaves every file untouched, because rewriting a developer's source metadata is
        not something to do on an assumption about what they meant.
    */
    async updatePicklistDependencyMetadata() {

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

            const packageDirectoryPath = PicklistDependencyTestService.resolveDefaultPackageDirectoryPath(workspaceRoot);
            const classesDirectoryPath = PicklistDependencyTestService.getClassesDirectoryPath(packageDirectoryPath);
            PicklistDependencyTestService.assertClassesDirectoryContainedInWorkspace(classesDirectoryPath, workspaceRoot);

            const writebackResult = this.buildPicklistDependencyWritebackResult(classesDirectoryPath, fullPathToObjectsDirectory);

            if ( !writebackResult ) {
                return;
            }

            const changeReport = PicklistDependencyMetadataWriterService.buildWritebackReport(writebackResult);

            if ( writebackResult.plans.length === 0 ) {

                /*
                    Nothing to write is a SUCCESS, not a failure, and the two reasons for it read
                    very differently to someone who just edited a spec expecting a change: either
                    the metadata already says what the Apex does, or every field that would have
                    changed was refused.
                */
                const nothingToWriteMessage = writebackResult.refusals.length > 0
                    ? `No field metadata was changed. ${writebackResult.refusals.length} field(s) were skipped -- see the report for why.`
                    : 'The picklist dependency metadata already matches the generated Apex specs. Nothing to update.';

                vscode.window.showInformationMessage(nothingToWriteMessage);
                VSCodeWorkspaceService.showPicklistDependencyCheckReport(changeReport);
                return;

            }

            const confirmedUpdate = await vscode.window.showWarningMessage(
                `Update ${writebackResult.plans.length} field metadata file(s) to match the generated Apex specs?\n\n${changeReport}`,
                { modal: true },
                UPDATE_METADATA_ACTION_LABEL
            );

            if ( confirmedUpdate !== UPDATE_METADATA_ACTION_LABEL ) {
                vscode.window.showInformationMessage('Picklist dependency metadata update cancelled. No files were changed.');
                return;
            }

            const writtenFilePaths = PicklistDependencyMetadataWriterService.writeFieldWritebackPlans(writebackResult.plans, fullPathToObjectsDirectory);

            VSCodeWorkspaceService.showPicklistDependencyCheckReport(changeReport);

            /*
                The working tree is now changed whatever happens next, so the offer says so. A
                writeback that produced a deployable change and then said nothing would leave the
                user unsure whether they still have to do something.
            */
            const deploySelection = await vscode.window.showInformationMessage(
                `Updated ${writtenFilePaths.length} field metadata file(s). These changes are in your working tree now. Deploy them to an org so the picklist dependency check can go green?`,
                DEPLOY_UPDATED_METADATA_ACTION_LABEL
            );

            if ( deploySelection !== DEPLOY_UPDATED_METADATA_ACTION_LABEL ) {
                vscode.window.showInformationMessage(`${writtenFilePaths.length} field metadata file(s) were updated and NOT deployed. Review the changes and deploy them when ready.`);
                return;
            }

            const targetOrgIdentifier = await this.promptForPicklistDependencyTargetOrg();
            if ( !targetOrgIdentifier ) {
                vscode.window.showInformationMessage(`The field metadata changes are still in your working tree and were not deployed.`);
                return;
            }

            await this.deployUpdatedPicklistDependencyMetadata(writtenFilePaths, targetOrgIdentifier);

        } catch(error) {

            const commandName = 'updatePicklistDependencyMetadata';
            ErrorHandlingService.handleCapturedError(error, commandName);

        }

    }

    /*
        Reads every generated per-object class, parses the specs back out, and resolves what each
        field file would become. Returns undefined when there is nothing to reconcile, having said
        why -- callers stop quietly rather than reporting a second time.
    */
    private buildPicklistDependencyWritebackResult(classesDirectoryPath: string, fullPathToObjectsDirectory: string) {

        if ( !fs.existsSync(classesDirectoryPath) ) {
            vscode.window.showInformationMessage(`No generated picklist dependency specs were found in "${classesDirectoryPath}". Run "Salesforce Treecipe: Generate Picklist Dependency Tests" first, then edit a spec to declare the dependency you intend.`);
            return undefined;
        }

        const perObjectClassFileNames = fs.readdirSync(classesDirectoryPath)
            .filter(fileName => PicklistDependencyTestService.isPerObjectSpecsClassFileName(fileName));

        if ( perObjectClassFileNames.length === 0 ) {
            vscode.window.showInformationMessage(`No generated picklist dependency spec classes were found in "${classesDirectoryPath}". Run "Salesforce Treecipe: Generate Picklist Dependency Tests" first.`);
            return undefined;
        }

        let specDetails: IPicklistDependencySpecDetail[] = [];

        perObjectClassFileNames.forEach(perObjectClassFileName => {

            const perObjectClassFilePath = path.join(classesDirectoryPath, perObjectClassFileName);
            const apexClassBody = fs.readFileSync(perObjectClassFilePath, 'utf-8');

            const parsedSpecDetails = PicklistDependencyTestService.parseSpecDetailsByApexClassBody(apexClassBody);

            /*
                A class that declares a factory call but yields no spec did not parse, and writeback
                must not treat that as "this object has no dependencies" -- it would silently skip
                fields the developer edited. Named so the user can look at the file.
            */
            if ( parsedSpecDetails.length === 0 && apexClassBody.includes('SDTPicklistDependencySpec.forField') ) {
                throw new Error(`"${perObjectClassFilePath}" contains picklist dependency specs that could not be parsed. Nothing was written. Check that its spec methods are unmodified Apex, or regenerate them with "Generate Picklist Dependency Tests".`);
            }

            specDetails = specDetails.concat(parsedSpecDetails);

        });

        if ( specDetails.length === 0 ) {
            vscode.window.showInformationMessage('The generated picklist dependency specs declare no field-level dependencies to write back.');
            return undefined;
        }

        const fieldFilePathsByFieldKey = this.buildFieldFilePathsByFieldKey(specDetails, fullPathToObjectsDirectory);

        return PicklistDependencyMetadataWriterService.buildWritebackResult(
            specDetails,
            fieldFilePathsByFieldKey,
            fieldFilePath => fs.readFileSync(fieldFilePath, 'utf-8')
        );

    }

    /*
        Keyed by OBJECT and field, never by field alone.

        A run reconciles every per-object spec class at once, and "Status__c" on Account and on Case
        are different fields with the same api name. Keyed by the bare name they collide, and one
        object's dependency metadata is written into the other object's file while its own is never
        written at all -- silently, because the report names what was planned rather than what landed.

        Both the CONTROLLING and the dependent field of each spec are mapped: writeback may add a
        controlling value to the controlling field's own file, so its path has to be resolvable too.
    */
    private buildFieldFilePathsByFieldKey(specDetails: IPicklistDependencySpecDetail[],
                                            fullPathToObjectsDirectory: string): Record<string, string> {

        let fieldFilePathsByFieldKey: Record<string, string> = Object.create(null);

        const mapFieldFilePath = (objectApiName: string, fieldApiName: string) => {

            const fieldFilePath = path.join(
                fullPathToObjectsDirectory, objectApiName, 'fields', `${fieldApiName}.field-meta.xml`
            );

            if ( fs.existsSync(fieldFilePath) ) {
                fieldFilePathsByFieldKey[PicklistDependencyMetadataWriterService.buildFieldKey(objectApiName, fieldApiName)] = fieldFilePath;
            }

        };

        specDetails.forEach(specDetail => {
            mapFieldFilePath(specDetail.objectApiName, specDetail.fieldApiName);
            mapFieldFilePath(specDetail.objectApiName, specDetail.controllingFieldApiName);
        });

        return fieldFilePathsByFieldKey;

    }

    private async deployUpdatedPicklistDependencyMetadata(writtenFilePaths: string[], targetOrgIdentifier: string) {

        const deploySummary = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Update Picklist Dependency Metadata',
            cancellable: true
        }, async (progress, cancellationToken) => {

            const registerCancellation = (killChildProcess: () => void) => {
                cancellationToken.onCancellationRequested(() => killChildProcess());
            };

            progress.report({ message: `Deploying ${writtenFilePaths.length} field metadata file(s) to ${targetOrgIdentifier}...` });

            return await PicklistDependencyCheckService.deploySourcePaths(writtenFilePaths, targetOrgIdentifier, registerCancellation);

        });

        vscode.window.showInformationMessage(`${deploySummary} Run "Salesforce Treecipe: Run Picklist Dependency Check" to confirm the specs now pass.`);

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

            const resultsFolderPath = path.join(workspaceRoot, ConfigurationService.getPicklistDependencyResultsFolderPath());
            const specsFolderPath = path.join(workspaceRoot, ConfigurationService.getPicklistDependencySpecsFolderPath());

            /*
                The manifest is read FIRST, and the source metadata is not walked at all when one
                exists. That is the point of the artifact: the panel renders the specs that were
                generated and run, rather than a second derivation from metadata that may have moved
                since. Reading it is a single file read, so it needs no progress notification.
            */
            const manifestLoad = PicklistDependencyManifestService.loadManifest(specsFolderPath);

            if ( manifestLoad.state === 'loaded' && manifestLoad.manifest ) {

                const explorerViewModel = await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: 'Picklist Dependency Explorer',
                    cancellable: false
                }, async (progress) => {

                    /*
                        Staleness is a stat walk over the objects directory, not a parse of it -- it
                        answers "could this have changed since generation", which is all the banner
                        claims. It still touches every field file, so it is reported like the scan it
                        replaced rather than left looking inert on a large org.
                    */
                    progress.report({ message: 'Checking whether the generated specs still match your metadata...' });
                    const freshnessResult = PicklistDependencyManifestService.resolveManifestFreshness(
                        manifestLoad.manifest,
                        fullPathToObjectsDirectory
                    );

                    progress.report({ message: 'Loading the most recent picklist dependency check results...' });
                    const resultsLoad = PicklistDependencyExplorerService.loadLatestResults(resultsFolderPath);

                    progress.report({ message: 'Building the dependency view...' });
                    return PicklistDependencyExplorerService.buildExplorerViewModelByManifest(
                        manifestLoad,
                        fullPathToObjectsDirectory,
                        resultsLoad,
                        freshnessResult,
                        workspaceRoot
                    );

                });

                this.showPicklistDependencyExplorerPanel(explorerViewModel);
                return;

            }

            /*
                No manifest, or one that could not be read. Both are reported with the generate
                command named, and the metadata scan the panel used to do unconditionally is offered
                as an EXPLICIT action rather than performed silently -- 3.1.0's "no setup required"
                property is kept, but honestly: every row it produces is banner-marked un-asserted.
            */
            const previewFromMetadataSelection = await vscode.window.showInformationMessage(
                manifestLoad.message,
                PREVIEW_FROM_METADATA_ACTION_LABEL
            );

            if ( previewFromMetadataSelection !== PREVIEW_FROM_METADATA_ACTION_LABEL ) {
                return;
            }

            const objectsTargetUri = vscode.Uri.file(fullPathToObjectsDirectory);

            // THE PREVIEW READS THE SAME SPEC DETAILS THE GENERATE COMMAND DOES, SO IT NEEDS THE SAME GLOBAL VALUE SETS
            const isMissingGlobalValueSetsDirectoryWarningShown = false;
            const pathToSalesforceMetadataParentDirectory = VSCodeWorkspaceService.getParentPath(fullPathToObjectsDirectory);
            await GlobalValueSetSingleton.getInstance().initialize(pathToSalesforceMetadataParentDirectory, isMissingGlobalValueSetsDirectoryWarningShown);

            /*
                Walking a real org's objects directory parses every field file and takes seconds, so
                it runs under a progress notification rather than leaving the command looking inert.
                The check command already reports its long phase the same way.
            */
            const previewViewModel = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Picklist Dependency Explorer',
                cancellable: false
            }, async (progress) => {

                progress.report({ message: `Scanning ${fullPathToObjectsDirectory} for dependent picklists...` });
                const collectionResult = await PicklistDependencyTestService.collectSpecDetailsByObjectsDirectory(objectsTargetUri);

                progress.report({ message: 'Loading the most recent picklist dependency check results...' });
                const resultsLoad = PicklistDependencyExplorerService.loadLatestResults(resultsFolderPath);

                progress.report({ message: 'Building the dependency view...' });

                const previewContext = PicklistDependencyExplorerService.buildMetadataPreviewContext(manifestLoad);
                previewContext.skippedFields = collectionResult.skippedFields;

                return PicklistDependencyExplorerService.buildExplorerViewModel(
                    fullPathToObjectsDirectory,
                    collectionResult.specDetails,
                    collectionResult.skippedFieldWarnings,
                    resultsLoad,
                    collectionResult.recordTypeSpecDetails,
                    previewContext
                );

            });

            this.showPicklistDependencyExplorerPanel(previewViewModel);

        } catch(error) {

            const commandName = 'openPicklistDependencyExplorer';
            ErrorHandlingService.handleCapturedError(error, commandName);

        }

    }

    /*
        One panel for the whole window, reused across invocations.

        Creating a new panel each time stacked a duplicate tab per run, and every one of them held
        its own parsed copy of the model alive. The reference is cleared in onDidDispose so a closed
        panel is not revealed after the fact.
    */
    private static picklistDependencyExplorerPanel: vscode.WebviewPanel | undefined;

    /*
        The message listener registered for the panel's CURRENT model. Re-running the command
        re-renders the panel against freshly scanned metadata, and a listener left over from the
        previous render would still be answering reveal messages from its own stale allow-list.
    */
    private static picklistDependencyExplorerMessageSubscription: vscode.Disposable | undefined;

    private showPicklistDependencyExplorerPanel(explorerViewModel: IPicklistDependencyExplorerViewModel) {

        const existingExplorerPanel = ExtensionCommandService.picklistDependencyExplorerPanel;

        const explorerPanel = existingExplorerPanel
            ?? vscode.window.createWebviewPanel(
                PICKLIST_DEPENDENCY_EXPLORER_VIEW_TYPE,
                'Picklist Dependency Explorer',
                vscode.ViewColumn.One,
                /*
                    localResourceRoots is set EMPTY rather than omitted. Omitting it does not deny
                    the grant -- VS Code then defaults to the extension directory plus every open
                    workspace folder. Everything the panel renders is inlined into the html, so it
                    needs no file access at all, and enableScripts is what the nonced inline script
                    requires rather than a resource grant.

                    retainContextWhenHidden is deliberately NOT set: the panel's state is entirely
                    derived from the model, so a hidden panel costs nothing to rebuild and holding
                    a full DOM per hidden tab is what VS Code warns against.
                */
                { enableScripts: true, localResourceRoots: [] }
            );

        ExtensionCommandService.picklistDependencyExplorerPanel = explorerPanel;

        if ( !existingExplorerPanel ) {

            explorerPanel.onDidDispose(() => {
                ExtensionCommandService.picklistDependencyExplorerMessageSubscription?.dispose();
                ExtensionCommandService.picklistDependencyExplorerMessageSubscription = undefined;
                ExtensionCommandService.picklistDependencyExplorerPanel = undefined;
            });

        }

        const nonce = PicklistDependencyExplorerService.buildNonce();
        explorerPanel.webview.html = PicklistDependencyExplorerService.buildWebviewHtml(explorerViewModel, nonce);

        /*
            One allow-list per panel command, each built from the model this render was built from.

            Every one of them matches the posted value against what the model NAMES rather than
            validating it as a path, so a message arriving from anywhere else cannot make the
            extension host open an arbitrary file on the user's disk. The spec and report lists are
            keyed on the file AND the method together, so a legitimate file cannot be combined with
            a method name of the sender's choosing either.
        */
        const revealableSourceFilePaths = new Set(PicklistDependencyExplorerService.collectSourceFilePaths(explorerViewModel));
        const openableSpecTargets = new Set(PicklistDependencyExplorerService.collectOpenableSpecTargets(explorerViewModel));
        const openableRunReportTargets = new Set(PicklistDependencyExplorerService.collectOpenableRunReportTargets(explorerViewModel));
        const copyableCombinationKeys = new Set(PicklistDependencyExplorerService.collectCombinationKeys(explorerViewModel));

        ExtensionCommandService.picklistDependencyExplorerMessageSubscription?.dispose();

        ExtensionCommandService.picklistDependencyExplorerMessageSubscription = explorerPanel.webview.onDidReceiveMessage(async (panelMessage: IPicklistDependencyExplorerPanelMessage) => {

            if ( panelMessage?.command === 'revealFieldSource' && panelMessage.sourceFilePath ) {

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

                return;

            }

            if ( panelMessage?.command === 'openSpecMethod' && panelMessage.specFilePath && panelMessage.methodName ) {

                const openTargetKey = PicklistDependencyExplorerService.buildOpenTargetKey(panelMessage.specFilePath, panelMessage.methodName);

                if ( !openableSpecTargets.has(openTargetKey) ) {
                    return;
                }

                if ( !fs.existsSync(panelMessage.specFilePath) ) {
                    VSCodeWorkspaceService.showWarningMessage(`The generated class "${panelMessage.specFilePath}" no longer exists. Re-run "Salesforce Treecipe: Generate Picklist Dependency Tests" to write it again.`);
                    return;
                }

                const specClassContent = fs.readFileSync(panelMessage.specFilePath, 'utf-8');
                const specMethodLineNumber = PicklistDependencyExplorerService.findApexMethodDeclarationLineNumber(specClassContent, panelMessage.methodName);

                await VSCodeWorkspaceService.openFileInEditor(panelMessage.specFilePath, specMethodLineNumber);

                return;

            }

            if ( panelMessage?.command === 'openRunReport' && panelMessage.reportFilePath && panelMessage.methodName ) {

                const openTargetKey = PicklistDependencyExplorerService.buildOpenTargetKey(panelMessage.reportFilePath, panelMessage.methodName);

                if ( !openableRunReportTargets.has(openTargetKey) ) {
                    return;
                }

                if ( !fs.existsSync(panelMessage.reportFilePath) ) {
                    VSCodeWorkspaceService.showWarningMessage(`The check report "${panelMessage.reportFilePath}" no longer exists. Re-run "Salesforce Treecipe: Run Picklist Dependency Check" to write a new run.`);
                    return;
                }

                const runReportContent = fs.readFileSync(panelMessage.reportFilePath, 'utf-8');
                const runReportEntryLineNumber = PicklistDependencyExplorerService.findRunReportEntryLineNumber(runReportContent, panelMessage.methodName);

                await VSCodeWorkspaceService.openFileInEditor(panelMessage.reportFilePath, runReportEntryLineNumber);

                return;

            }

            if ( panelMessage?.command === 'copyCombinationReference' && panelMessage.combinationKey ) {

                if ( !copyableCombinationKeys.has(panelMessage.combinationKey) ) {
                    return;
                }

                await VSCodeWorkspaceService.copyTextToClipboard(panelMessage.combinationKey);
                VSCodeWorkspaceService.showInformationMessage(`Copied "${panelMessage.combinationKey}". Paste it into the explorer's find box to come back to this combination.`);

            }

        });

        explorerPanel.reveal(vscode.ViewColumn.One);

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
