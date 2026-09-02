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
import { PicklistDependencyTestService, ISpecsChangePlan, IPlannedSpecsFile } from "../PicklistDependencyTestService/PicklistDependencyTestService";
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
            generationSummary
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

            // THE EXPLORER READS THE SAME SPEC DETAILS THE GENERATE COMMAND DOES, SO IT NEEDS THE SAME GLOBAL VALUE SETS
            const isMissingGlobalValueSetsDirectoryWarningShown = false;
            const pathToSalesforceMetadataParentDirectory = VSCodeWorkspaceService.getParentPath(fullPathToObjectsDirectory);
            await GlobalValueSetSingleton.getInstance().initialize(pathToSalesforceMetadataParentDirectory, isMissingGlobalValueSetsDirectoryWarningShown);

            /*
                Walking a real org's objects directory parses every field file and takes seconds, so
                it runs under a progress notification rather than leaving the command looking inert.
                The check command already reports its long phase the same way.
            */
            const explorerViewModel = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Picklist Dependency Explorer',
                cancellable: false
            }, async (progress) => {

                progress.report({ message: `Scanning ${fullPathToObjectsDirectory} for dependent picklists...` });
                const collectionResult = await PicklistDependencyTestService.collectSpecDetailsByObjectsDirectory(objectsTargetUri);

                progress.report({ message: 'Loading the most recent picklist dependency check results...' });
                const resultsFolderPath = path.join(workspaceRoot, ConfigurationService.getPicklistDependencyResultsFolderPath());
                const resultsLoad = PicklistDependencyExplorerService.loadLatestResults(resultsFolderPath);

                progress.report({ message: 'Building the dependency view...' });
                return PicklistDependencyExplorerService.buildExplorerViewModel(
                    fullPathToObjectsDirectory,
                    collectionResult.specDetails,
                    collectionResult.skippedFieldWarnings,
                    resultsLoad,
                    collectionResult.recordTypeSpecDetails
                );

            });

            this.showPicklistDependencyExplorerPanel(explorerViewModel);

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
            The panel may only reveal a field file the model it was built from actually names. The
            posted path is matched against that set rather than being validated as a path, so a
            message arriving from anywhere else cannot make the extension host open an arbitrary
            file on the user's disk.
        */
        const revealableSourceFilePaths = new Set(PicklistDependencyExplorerService.collectSourceFilePaths(explorerViewModel));

        ExtensionCommandService.picklistDependencyExplorerMessageSubscription?.dispose();

        ExtensionCommandService.picklistDependencyExplorerMessageSubscription = explorerPanel.webview.onDidReceiveMessage(async (panelMessage: { command?: string; sourceFilePath?: string }) => {

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
