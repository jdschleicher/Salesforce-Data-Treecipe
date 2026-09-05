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
import { PicklistDependencyTestService, ISpecsChangePlan, IPlannedSpecsFile, IPicklistDependencySpecDetail, IPicklistDependencySkippedField, IPicklistDependencyGenerationProgress, IPicklistDependencyGenerationSummaryDetail } from "../PicklistDependencyTestService/PicklistDependencyTestService";
import { PicklistDependencyCheckService, PicklistDependencyDeployReason } from "../PicklistDependencyCheckService/PicklistDependencyCheckService";
import {
    PicklistDependencyExplorerService,
    IPicklistDependencyExplorerViewModel,
    IPicklistDependencyExplorerRenderMessage,
    IPicklistDependencyExplorerLoadPhaseMessage,
    IPicklistDependencyExplorerFreshnessMessage,
    IPicklistDependencyExplorerLoadFailedMessage,
    PicklistDependencyExplorerHostMessage,
    PICKLIST_DEPENDENCY_EXPLORER_LOAD_PHASES
} from "../PicklistDependencyExplorerService/PicklistDependencyExplorerService";
import {
    PicklistDependencyManifestService,
    IPicklistDependencyManifestFreshnessResult,
    PICKLIST_DEPENDENCY_MANIFEST_FRESHNESS_PENDING
} from "../PicklistDependencyManifestService/PicklistDependencyManifestService";
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
export const VIEW_GENERATION_WARNING_DETAILS_ACTION_LABEL = 'View Details';

// SHARED WITH THE TESTS SO THESE LABELS CANNOT DRIFT FROM WHAT IS ASSERTED
export const VIEW_GENERATION_SUMMARY_ACTION_LABEL = 'View Summary';
export const OPEN_PICKLIST_DEPENDENCY_EXPLORER_ACTION_LABEL = 'Open Explorer';

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
    /*
        ONE line. The document below is what carries the run in full -- this is what a toast can show
        without truncating, and what the end to end command appends its own question to.
    */
    generationSummary: string;
    /*
        Undefined when the document could not be written, which is a report failing rather than the
        run failing. Every caller treats it as "there is nothing to open", never as an error.
    */
    generationSummaryFilePath?: string;
    manifestFilePath: string;
    /*
        Carried out of generation rather than reported inside it, so the command can fold the skips
        into the SAME message that announces what was generated.
    */
    skippedFields: IPicklistDependencySkippedField[];
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
        Runs one generation phase behind a cancellable progress notification.

        Notification rather than the status bar, which is where this started. ProgressLocation.Window
        "supports neither cancellation nor discrete progress" (vscode.d.ts): it renders no cancel
        button, so the token it hands you never fires. Cancelling the walk is the more useful of the
        two, so the location that can actually offer it wins, and it puts this command in line with
        the check and the writeback rather than apart from them.

        The port handed to the service is deliberately narrow -- two plain functions, no vscode type
        -- so what the walk reports and where it stops are testable without a withProgress double.
    */
    private async runWithPicklistDependencyGenerationProgress<TPhaseResult>(
                        initialMessage: string,
                        runPhase: (generationProgress: IPicklistDependencyGenerationProgress) => Promise<TPhaseResult>): Promise<TPhaseResult> {

        return await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Generate Picklist Dependency Tests',
            cancellable: true
        }, async (progress, cancellationToken) => {

            progress.report({ message: initialMessage });

            const generationProgress: IPicklistDependencyGenerationProgress = {
                report: (message: string) => progress.report({ message }),
                isCancellationRequested: () => cancellationToken.isCancellationRequested
            };

            return await runPhase(generationProgress);

        });

    }

    /*
        tsconfig sets "strict": false, so a catch binding is implicitly any and reading .message off
        it compiles. A thrown null or undefined would then throw AGAIN inside the catch, which is
        exactly where the surrounding blocks are trying to keep a failure from escalating -- a
        report that could not be written would report the whole run as failed.
    */
    private describeCaughtError(caughtError: unknown): string {
        return caughtError instanceof Error ? caughtError.message : String(caughtError);
    }

    /*
        Every warning the run raised, one per line, for the output channel behind "View details".
    */
    private buildPicklistDependencyWarningReport(skippedFields: IPicklistDependencySkippedField[]): string {

        const reportLines = skippedFields.map(skippedField => `- ${skippedField.warning}`);

        return [
            'PICKLIST DEPENDENCY GENERATION WARNINGS',
            '',
            PicklistDependencyTestService.buildSkippedFieldSummary(skippedFields),
            '',
            ...reportLines
        ].join('\n');

    }

    /*
        The single end-of-run report.

        Warnings used to fire as up to four separate toasts DURING the walk, before the user knew
        whether generation had even succeeded. They are held to the end and grouped by reason
        instead, so what arrives is one message about a finished run rather than a stream of
        interruptions about a running one.
    */
    private async showPicklistDependencyGenerationSummary(summaryMessage: string,
                                                            skippedFields: IPicklistDependencySkippedField[]) {

        if ( skippedFields.length === 0 ) {
            vscode.window.showInformationMessage(summaryMessage);
            return;
        }

        const viewWarningDetailsSelection = await vscode.window.showWarningMessage(
            `${summaryMessage} ${PicklistDependencyTestService.buildSkippedFieldSummary(skippedFields)}`,
            VIEW_GENERATION_WARNING_DETAILS_ACTION_LABEL
        );

        if ( viewWarningDetailsSelection === VIEW_GENERATION_WARNING_DETAILS_ACTION_LABEL ) {
            VSCodeWorkspaceService.showPicklistDependencyCheckReport(this.buildPicklistDependencyWarningReport(skippedFields));
        }

    }

    /*
        Shared by the generate command and the end to end command. Returns undefined when there is
        nothing to generate or the user declined an overwrite, both of which are already reported --
        callers stop quietly rather than reporting a second time.

        The run is in three parts for a reason the shape makes easy to miss: read, ASK, write. The
        confirmation sits between two progress scopes rather than inside one, because it is the point
        at which the user decides whether the write happens at all -- and a spinner is not something
        to leave running behind a question about whether to proceed.
    */
    private async generatePicklistDependencyClasses(extensionPath: string, workspaceRoot: string): Promise<IPicklistDependencyGenerationResult | undefined> {

        const relativePathToObjectsDirectory = ConfigurationService.getObjectsPathFromTreecipeJSONConfiguration();
        const pathWithoutRelativeSyntax = relativePathToObjectsDirectory.split("./")[1];
        const fullPathToObjectsDirectory = `${workspaceRoot}/${pathWithoutRelativeSyntax}`;

        if ( !fs.existsSync(fullPathToObjectsDirectory) ) {
            throw new Error(`No objects directory found at "${fullPathToObjectsDirectory}". Check the "salesforceObjectsPath" value in treecipe.config.json, or re-run "Initiate Configuration File", and run the command again.`);
        }

        const objectsTargetUri = vscode.Uri.file(fullPathToObjectsDirectory);

        const packageDirectoryPath = PicklistDependencyTestService.resolveDefaultPackageDirectoryPath(workspaceRoot);
        const classesDirectoryPath = PicklistDependencyTestService.getClassesDirectoryPath(packageDirectoryPath);
        PicklistDependencyTestService.assertClassesDirectoryContainedInWorkspace(classesDirectoryPath, workspaceRoot);

        /*
            The suite is written to a sibling of the classes directory, which is a second set of path
            segments that resolveDefaultPackageDirectoryPath never saw. Checked here for the reason
            the classes path is: writeFileSync follows a symlink wherever it points.
        */
        const testSuitesDirectoryPath = PicklistDependencyTestService.getTestSuitesDirectoryPath(classesDirectoryPath);
        PicklistDependencyTestService.assertTestSuitesDirectoryContainedInWorkspace(testSuitesDirectoryPath, workspaceRoot);

        const specsClassFilePath = PicklistDependencyTestService.getSpecsClassFilePath(classesDirectoryPath);
        const specsClassName = PicklistDependencyTestService.getSpecsClassName();
        const specsTestClassFilePath = PicklistDependencyTestService.getSpecsTestClassFilePath(classesDirectoryPath);
        const specsTestClassName = PicklistDependencyTestService.getSpecsTestClassName();

        const sourceApiVersion = PicklistDependencyTestService.getSourceApiVersion(workspaceRoot);

        /*
            Reading and planning share one scope. Both run before anything is written, so cancelling
            anywhere in here leaves the generated files exactly as they were -- which is what lets
            this half be cancellable without any question about what to do with a partial write.
        */
        const collectionPhaseResult = await this.runWithPicklistDependencyGenerationProgress(
            'Reading picklist dependency metadata...',
            async (generationProgress) => {

                /*
                    A dependent picklist can take its values from a GLOBAL value set, whose values live
                    beside the objects directory rather than in the field file. Spec generation reads them
                    from this singleton, so it is initialized here for the same reason recipe generation
                    initializes it -- the sets may have changed since the window opened.
                */
                const isMissingGlobalValueSetsDirectoryWarningShown = false;
                const pathToSalesforceMetadataParentDirectory = VSCodeWorkspaceService.getParentPath(fullPathToObjectsDirectory);
                await GlobalValueSetSingleton.getInstance().initialize(pathToSalesforceMetadataParentDirectory, isMissingGlobalValueSetsDirectoryWarningShown);

                const collectionResult = await PicklistDependencyTestService.collectSpecDetailsByObjectsDirectory(
                    objectsTargetUri, new Set(), generationProgress
                );

                /*
                    Returned as one shape or the other rather than as optional fields, so the caller
                    cannot reach for a plan that a cancelled or empty run never built.
                */
                if ( collectionResult.cancelled || collectionResult.specDetails.length === 0 ) {
                    return { collectionResult, plannedGeneration: undefined };
                }

                generationProgress.report(`Resolving what would change for ${collectionResult.specDetails.length} spec(s)...`);

                const specsTestClassBody = PicklistDependencyTestService.buildSpecsTestApexClassBody(collectionResult.specDetails);

                /*
                    Merged with whatever suite is already on disk, once, so the same content is both
                    previewed and written. A suite is a grouping a team curates -- a member someone
                    added by hand is kept rather than reset away by a regeneration.
                */
                const mergedTestSuiteContent = PicklistDependencyTestService.buildTestSuiteContentByClassesDirectory(classesDirectoryPath);

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
                    specsTestClassBody,
                    mergedTestSuiteContent.content
                );

                return { collectionResult, plannedGeneration: { specsChangePlan, specsTestClassBody, mergedTestSuiteContent } };

            }
        );

        const collectionResult = collectionPhaseResult.collectionResult;

        /*
            A cancelled walk is reported on its own terms. Its result is partial by construction, so
            it must never fall through to the "no dependent picklists were found" message below --
            that would report an empty project to someone who simply stopped the run.
        */
        if ( collectionResult.cancelled ) {
            vscode.window.showInformationMessage('Picklist dependency spec generation cancelled. No files were changed.');
            return undefined;
        }

        if ( collectionResult.specDetails.length === 0 ) {

            /*
                The skips are folded into this one message rather than reported separately. "Nothing
                was found" and "17 fields were skipped" are the same news when every candidate was
                skipped, and showing them as two toasts invites reading them as two problems.
            */
            await this.showPicklistDependencyGenerationSummary(
                `No dependent picklists were found in "${fullPathToObjectsDirectory}". No Apex spec file was written.`,
                collectionResult.skippedFields
            );
            return undefined;

        }

        const plannedGeneration = collectionPhaseResult.plannedGeneration;

        /*
            Unreachable: the phase returns a plan for exactly the runs this point is reached on. It is
            checked rather than asserted away so a later early-return inside that phase becomes a
            reported stop rather than "undefined" spliced into the summary.
        */
        if ( !plannedGeneration ) {
            vscode.window.showWarningMessage('Picklist dependency spec generation could not resolve what would change. Nothing was written.');
            return undefined;
        }

        const { specsChangePlan, specsTestClassBody, mergedTestSuiteContent } = plannedGeneration;

        const confirmedRegeneration = await this.confirmPicklistDependencySpecsChangePlan(specsChangePlan, classesDirectoryPath);

        if ( !confirmedRegeneration ) {

            /*
                Declining the overwrite is the one path where the skips are most worth having: the
                user is deciding whether this generation is worth taking, and before the warnings
                were rolled up they fired ahead of this prompt and so were seen. Reporting them here
                keeps that.
            */
            await this.showPicklistDependencyGenerationSummary(
                'Picklist dependency specs were not regenerated, so no files were changed.',
                collectionResult.skippedFields
            );
            return undefined;

        }

        const writePhaseResult = await this.runWithPicklistDependencyGenerationProgress(
            `Writing ${collectionResult.specDetails.length} picklist dependency spec(s)...`,
            async (generationProgress) => {

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
                    specsChangePlan,
                    generationProgress
                );

                PicklistDependencyTestService.writeSpecsTestClassFiles(
                    classesDirectoryPath,
                    specsTestClassBody,
                    sourceApiVersion
                );

                /*
                    An unparseable existing suite arrives here as its own exact content, so this is a
                    no-op in that case and the user's file survives untouched. The warning below is
                    what tells them it happened.
                */
                PicklistDependencyTestService.writeSpecsTestSuiteFile(
                    classesDirectoryPath,
                    mergedTestSuiteContent.content
                );

                generationProgress.report('Writing the spec manifest...');

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

                generationProgress.report('Adding any missing framework classes...');

                const frameworkScaffoldResult = PicklistDependencyTestService.scaffoldMissingFrameworkClasses(extensionPath, classesDirectoryPath);

                return { specsClassWriteResult, manifestFilePath, frameworkScaffoldResult };

            }
        );

        const { specsClassWriteResult, manifestFilePath, frameworkScaffoldResult } = writePhaseResult;

        const perObjectClassCount = Object.keys(specsClassWriteResult.perObjectClassFilePathsByObjectApiName).length;

        /*
            The run as DATA, so the one line the toast gets and the document that carries the run in
            full are built from the same facts rather than assembled twice.
        */
        const generationSummaryDetail: IPicklistDependencyGenerationSummaryDetail = {
            specCount: collectionResult.specDetails.length,
            perObjectClassCount,
            specsClassName,
            specsTestClassName,
            testSuiteName: PicklistDependencyTestService.getTestSuiteName(),
            classesDirectoryPath,
            manifestFilePath,
            recordTypeSpecCount: collectionResult.recordTypeSpecDetails.length,
            scaffoldedClassNames: frameworkScaffoldResult.scaffoldedClassNames,
            removedStaleClassFileNames: specsClassWriteResult.removedStaleClassFilePaths.map(staleFilePath => path.basename(staleFilePath))
        };

        const generationSummary = PicklistDependencyTestService.buildGenerationSummaryToastMessage(generationSummaryDetail);

        /*
            The one thing here that is NOT part of the run report: a missing framework class means the
            generated Apex will not compile at all. Appending that to a success message, as an
            information toast VS Code truncates, would drop a blocker to the bottom of two sentences
            of good news -- so it keeps its own warning, which is what it had before the roll-up.
        */
        if ( frameworkScaffoldResult.unavailableClassNames.length > 0 ) {
            VSCodeWorkspaceService.showWarningMessage(`${specsClassName}.cls was generated, but the required framework class(es) ${frameworkScaffoldResult.unavailableClassNames.join(', ')} could not be added to "${classesDirectoryPath}" and are not already present. The generated class will not compile until they are added from the Salesforce Data Treecipe repository.`);
        }

        /*
            The document is a REPORT ON a finished write, not a step of it: the Apex, the suite and
            the manifest are all on disk by now, and a workspace that will not take one more markdown
            file has not undone any of that. So a failure here warns about the report and leaves the
            run reporting the success it actually had.
        */
        let generationSummaryFilePath: string | undefined;
        try {

            /*
                Derived from the manifest that was just written rather than re-resolved from the
                configuration. "The summary is a sibling of the manifest" is load bearing -- a stray
                file in a package directory breaks "sf project deploy" -- and building the path a
                second way makes that hold only while two expressions happen to agree.
            */
            generationSummaryFilePath = PicklistDependencyTestService.writeGenerationSummaryDocument(
                path.dirname(manifestFilePath),
                PicklistDependencyTestService.buildGenerationSummaryMarkdown(generationSummaryDetail)
            );

        } catch (summaryDocumentError) {

            VSCodeWorkspaceService.showWarningMessage(
                `The picklist dependency specs were generated, but the summary document could not be written (${this.describeCaughtError(summaryDocumentError)}). `
                + `Nothing that was generated is affected -- the Apex, the test suite and the manifest are all written.`
            );

        }

        /*
            Surfaced after generation rather than before it: the new classes are written either way,
            and the warning is about cleaning up what an earlier version left behind.
        */
        /*
            Kept as its own warning rather than folded into the run report: the suite is what "Run
            Picklist Dependency Check" invokes, so a suite this could not register the tests in means
            the check will not find them. That is a blocker, not a footnote on a success message.
        */
        if ( mergedTestSuiteContent.isExistingFileUnparseable ) {
            VSCodeWorkspaceService.showWarningMessage(
                PicklistDependencyTestService.buildUnparseableTestSuiteWarning(
                    PicklistDependencyTestService.getTestSuiteFilePath(classesDirectoryPath)
                )
            );
        }
        if ( mergedTestSuiteContent.isExistingFileUnreadable ) {
            VSCodeWorkspaceService.showWarningMessage(
                PicklistDependencyTestService.buildUnreadableTestSuiteWarning(
                    PicklistDependencyTestService.getTestSuiteFilePath(classesDirectoryPath)
                )
            );
        }

        const legacyArtifactPaths = PicklistDependencyTestService.detectLegacyGeneratedArtifacts(classesDirectoryPath);
        if ( legacyArtifactPaths.length > 0 ) {
            VSCodeWorkspaceService.showWarningMessage(PicklistDependencyTestService.buildLegacyArtifactWarning(legacyArtifactPaths));
        }

        return {
            classesDirectoryPath,
            specsClassFilePath,
            specCount: collectionResult.specDetails.length,
            generationSummary,
            generationSummaryFilePath,
            manifestFilePath,
            skippedFields: collectionResult.skippedFields
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

                progress.report({ message: `Checking ${targetOrgIdentifier} for the generated test suite...` });
                deployRequired = !(await PicklistDependencyCheckService.isSpecsTestSuiteDeployedInOrg(targetOrgIdentifier));
                deployReason = 'specsTestSuiteAbsentFromOrg';

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
        Puts the deploy offer, with everything the run has to show alongside it.

        Reading what just happened does not cost the deploy offer -- showing the summary and stopping
        would make "View Summary" a choice between understanding the run and finishing it, which is
        the same reason "View Details" has always re-offered. So each inspect action is handled and
        the offer is put again, and each is offered ONCE, which is what makes the loop terminate:
        every pass either ends the run or spends an action, and there are at most three.
    */
    private async offerPicklistDependencyRunAgainstOrg(generationCompleteMessage: string,
                                                        generationResult: IPicklistDependencyGenerationResult): Promise<string | undefined> {

        const inspectActionHandlerByLabel: Record<string, () => Promise<void>> = {};

        // NO DOCUMENT MEANS NO BUTTON: THE SUMMARY WRITE IS ALLOWED TO HAVE FAILED WITHOUT FAILING THE RUN
        if ( generationResult.generationSummaryFilePath ) {
            const generationSummaryFilePath = generationResult.generationSummaryFilePath;
            inspectActionHandlerByLabel[VIEW_GENERATION_SUMMARY_ACTION_LABEL] = async () => {
                await VSCodeWorkspaceService.showMarkdownPreview(generationSummaryFilePath);
            };
        }

        inspectActionHandlerByLabel[OPEN_PICKLIST_DEPENDENCY_EXPLORER_ACTION_LABEL] = async () => {
            await vscode.commands.executeCommand('treecipe.openPicklistDependencyExplorer');
        };

        if ( generationResult.skippedFields.length > 0 ) {
            inspectActionHandlerByLabel[VIEW_GENERATION_WARNING_DETAILS_ACTION_LABEL] = async () => {
                VSCodeWorkspaceService.showPicklistDependencyCheckReport(
                    this.buildPicklistDependencyWarningReport(generationResult.skippedFields)
                );
            };
        }

        let offerMessage = generationCompleteMessage;

        while ( true ) {

            const offeredActionLabels = [RUN_AGAINST_ORG_ACTION_LABEL, ...Object.keys(inspectActionHandlerByLabel)];

            const selection = await vscode.window.showInformationMessage(offerMessage, ...offeredActionLabels);

            const selectedInspectActionHandler = selection ? inspectActionHandlerByLabel[selection] : undefined;
            if ( !selectedInspectActionHandler ) {
                return selection;
            }

            /*
                Opening what the run produced is subject to the SAME rule as writing it: the Apex,
                the suite and the manifest are already on disk, so a markdown preview that will not
                open (the built-in markdown extension disabled) or an explorer that throws is a
                failed VIEW of a successful generation. Unguarded, that rejection would leave the
                command's catch reporting a completed run as an error -- and would silently drop the
                deploy offer with it.
            */
            try {
                await selectedInspectActionHandler();
            } catch (inspectActionError) {
                VSCodeWorkspaceService.showWarningMessage(
                    `"${selection}" could not be opened (${this.describeCaughtError(inspectActionError)}). `
                    + `The generated picklist dependency specs are unaffected.`
                );
            }

            delete inspectActionHandlerByLabel[selection as string];

            offerMessage = 'Deploy the generated picklist dependency specs and run them against an org now?';

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

            /*
                Opened after the spec class, so the run report is what the user is left looking at:
                the class answers "what did it write", the summary answers "what do I do now".

                Guarded for the same reason the button that re-opens it is: a preview that will not
                open is a failed view of a generation that succeeded, and must not turn one into the
                other. Silent here rather than a warning -- the toast that follows carries "View
                Summary", so the document is still one click away and a second interruption before
                the run has even been reported would be noise.
            */
            if ( generationResult.generationSummaryFilePath ) {
                try {
                    await VSCodeWorkspaceService.showMarkdownPreview(generationResult.generationSummaryFilePath);
                } catch {
                    // THE "View Summary" BUTTON BELOW IS THE RECOVERY, SO THIS NEEDS NO REPORT OF ITS OWN
                }
            }

            /*
                ONE message closes the run: what was generated, what was skipped and why, and the
                offer to run it. The skips used to arrive as their own toasts partway through the
                walk; folding them in here is what makes this the report of a finished run rather
                than the last of several interruptions during a running one.
            */
            const skippedFieldSummary = PicklistDependencyTestService.buildSkippedFieldSummary(generationResult.skippedFields);
            const generationCompleteMessage = skippedFieldSummary
                ? `${generationResult.generationSummary} ${skippedFieldSummary} Deploy and run them against an org now?`
                : `${generationResult.generationSummary} Deploy and run them against an org now?`;

            const runAgainstOrgSelection = await this.offerPicklistDependencyRunAgainstOrg(generationCompleteMessage, generationResult);

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

            /*
                The check derives the same testSuites sibling to put the suite in the deploy, so the
                containment the generate command applies before WRITING there is applied here before
                the path is read and sent to an org.
            */
            PicklistDependencyTestService.assertTestSuitesDirectoryContainedInWorkspace(
                PicklistDependencyTestService.getTestSuitesDirectoryPath(classesDirectoryPath), workspaceRoot
            );

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
                The panel is opened BEFORE any of the work, and says what it is doing while the work
                happens.

                It used to be created only once a finished model existed, which meant every phase
                below -- the manifest parse most of all -- ran against a window showing nothing at
                all. Nothing here needs the model: the shell is static, so opening it first costs a
                document assignment and buys the whole load a place to report itself.
            */
            const explorerPanel = this.openPicklistDependencyExplorerShell();
            const explorerLoadStatusItem = VSCodeWorkspaceService.createStatusBarPhaseItem(
                ExtensionCommandService.buildPicklistDependencyExplorerStatusText(
                    PICKLIST_DEPENDENCY_EXPLORER_LOAD_PHASES.readingManifest
                )
            );

            try {

                await this.reportPicklistDependencyExplorerPhase(
                    explorerPanel,
                    explorerLoadStatusItem,
                    PICKLIST_DEPENDENCY_EXPLORER_LOAD_PHASES.readingManifest
                );

                /*
                    The manifest is read FIRST, and the source metadata is not walked at all when one
                    exists. That is the point of the artifact: the panel renders the specs that were
                    generated and run, rather than a second derivation from metadata that may have
                    moved since.
                */
                const manifestLoad = PicklistDependencyManifestService.loadManifest(specsFolderPath);

                if ( manifestLoad.state === 'loaded' && manifestLoad.manifest ) {

                    /*
                        Results are loaded BEFORE the model is built, and deliberately so.

                        They were measured at single-digit milliseconds -- the whole overlay, load and
                        failure attribution together, is under 1% of an open -- so deferring them buys
                        nothing, and it would cost something real: applyModelLimits keeps a FAILING
                        combination over a passing one, and it cannot do that against statuses that
                        have not been applied yet. A row the ceiling dropped for lack of a status is a
                        row a failure then has nowhere to land on.
                    */
                    await this.reportPicklistDependencyExplorerPhase(
                        explorerPanel,
                        explorerLoadStatusItem,
                        PICKLIST_DEPENDENCY_EXPLORER_LOAD_PHASES.loadingResults
                    );
                    const resultsLoad = PicklistDependencyExplorerService.loadLatestResults(resultsFolderPath);

                    await this.reportPicklistDependencyExplorerPhase(
                        explorerPanel,
                        explorerLoadStatusItem,
                        PICKLIST_DEPENDENCY_EXPLORER_LOAD_PHASES.buildingView
                    );
                    const explorerViewModel = PicklistDependencyExplorerService.buildExplorerViewModelByManifest(
                        manifestLoad,
                        fullPathToObjectsDirectory,
                        resultsLoad,
                        PICKLIST_DEPENDENCY_MANIFEST_FRESHNESS_PENDING,
                        workspaceRoot
                    );

                    this.renderPicklistDependencyExplorerModel(
                        explorerPanel,
                        explorerViewModel,
                        PICKLIST_DEPENDENCY_EXPLORER_LOAD_PHASES.checkingFreshness
                    );

                    /*
                        The paint has to actually LEAVE the host before the walk starts. Without this
                        the post is still sitting in VS Code's outgoing batch when the stat walk
                        begins, and "after the first paint" would be true of the source order and
                        false of anything the reader sees.
                    */
                    await ExtensionCommandService.yieldToExtensionHost();

                    /*
                        Staleness is a stat walk over the objects directory, not a parse of it -- it
                        answers "could this have changed since generation", which is all the banner
                        claims. It touches every field file, so on a large or network-mounted org it
                        is the slowest phase here, and it runs AFTER the structure is on screen: the
                        banner it feeds is a caveat about what the reader is already looking at, not
                        a precondition for showing it to them.
                    */
                    const freshnessResult = PicklistDependencyManifestService.resolveManifestFreshness(
                        manifestLoad.manifest,
                        fullPathToObjectsDirectory
                    );

                    this.applyPicklistDependencyExplorerFreshness(explorerPanel, freshnessResult);
                    return;

                }

                /*
                    No manifest, or one that could not be read. Both are reported with the generate
                    command named, and the metadata scan the panel used to do unconditionally is
                    offered as an EXPLICIT action rather than performed silently -- 3.1.0's "no setup
                    required" property is kept, but honestly: every row it produces is banner-marked
                    un-asserted.
                */
                const previewFromMetadataSelection = await vscode.window.showInformationMessage(
                    manifestLoad.message,
                    PREVIEW_FROM_METADATA_ACTION_LABEL
                );

                if ( previewFromMetadataSelection !== PREVIEW_FROM_METADATA_ACTION_LABEL ) {

                    /*
                        Declining leaves no panel, which is what it did before the shell was opened
                        up front -- a tab the reader just refused is clutter, and the message that
                        offered the scan already named the command that produces a manifest.

                        The panel is only on screen at all here for the manifest read, and a workspace
                        with no manifest fails that on the existsSync, so what is disposed is a panel
                        that was visible for a moment rather than one that showed anything.
                    */
                    explorerPanel.dispose();
                    return;

                }

                const objectsTargetUri = vscode.Uri.file(fullPathToObjectsDirectory);

                // THE PREVIEW READS THE SAME SPEC DETAILS THE GENERATE COMMAND DOES, SO IT NEEDS THE SAME GLOBAL VALUE SETS
                const isMissingGlobalValueSetsDirectoryWarningShown = false;
                const pathToSalesforceMetadataParentDirectory = VSCodeWorkspaceService.getParentPath(fullPathToObjectsDirectory);
                await GlobalValueSetSingleton.getInstance().initialize(pathToSalesforceMetadataParentDirectory, isMissingGlobalValueSetsDirectoryWarningShown);

                /*
                    Walking a real org's objects directory parses every field file and takes seconds.
                    It reports into the same panel banner and status bar entry as every other phase
                    rather than into a notification of its own -- the panel is open and in front of
                    the reader by this point, which was not true when this branch was written.
                */
                await this.reportPicklistDependencyExplorerPhase(
                    explorerPanel,
                    explorerLoadStatusItem,
                    PICKLIST_DEPENDENCY_EXPLORER_LOAD_PHASES.scanningMetadata
                );
                const collectionResult = await PicklistDependencyTestService.collectSpecDetailsByObjectsDirectory(objectsTargetUri);

                // THE SCAN TAKES SECONDS, AND A TAB CLOSED ACROSS IT LEAVES NOTHING TO RENDER INTO
                if ( !ExtensionCommandService.isPicklistDependencyExplorerPanelLive(explorerPanel) ) {
                    return;
                }

                await this.reportPicklistDependencyExplorerPhase(
                    explorerPanel,
                    explorerLoadStatusItem,
                    PICKLIST_DEPENDENCY_EXPLORER_LOAD_PHASES.loadingResults
                );
                const resultsLoad = PicklistDependencyExplorerService.loadLatestResults(resultsFolderPath);

                await this.reportPicklistDependencyExplorerPhase(
                    explorerPanel,
                    explorerLoadStatusItem,
                    PICKLIST_DEPENDENCY_EXPLORER_LOAD_PHASES.buildingView
                );

                const previewContext = PicklistDependencyExplorerService.buildMetadataPreviewContext(manifestLoad);
                previewContext.skippedFields = collectionResult.skippedFields;

                const previewViewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                    fullPathToObjectsDirectory,
                    collectionResult.specDetails,
                    collectionResult.skippedFieldWarnings,
                    resultsLoad,
                    collectionResult.recordTypeSpecDetails,
                    previewContext
                );

                // A PREVIEW HAS NO MANIFEST TO BE STALE AGAINST, SO NOTHING FOLLOWS THE RENDER AND THE STATUS LINE CLEARS WITH IT
                this.renderPicklistDependencyExplorerModel(explorerPanel, previewViewModel, '');

            } finally {
                explorerLoadStatusItem.dispose();
            }

        } catch(error) {

            /*
                The panel opens before the work now, so a failure has somewhere visible to land: a
                panel left showing the phase it died in would report a load still in progress
                forever. The notification the handler raises stays the primary report -- this is the
                same message put where the reader is already looking.
            */
            this.failPicklistDependencyExplorerLoad(
                ExtensionCommandService.picklistDependencyExplorerPanel,
                `The Picklist Dependency Explorer could not finish loading: ${error?.message ?? error}`
            );

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
        The message listener registered for the panel. One per panel rather than one per render: the
        allow-lists it checks against live in the render state below and are replaced whenever a
        model is rendered, so the listener always answers from the model currently on screen without
        being torn down and rebuilt to say so.
    */
    private static picklistDependencyExplorerMessageSubscription: vscode.Disposable | undefined;

    /*
        Everything the panel needs to be restored from, held by the host.

        The panel is not retained when hidden, so revealing it reloads the document and it asks for
        its content again. Answering from here is what makes a reveal cost a postMessage rather than
        a re-read of the manifest and a rebuild of the model -- and it is why the freshness answer,
        which arrives late, survives a reveal instead of being re-walked.
    */
    private static picklistDependencyExplorerRenderMessage: IPicklistDependencyExplorerRenderMessage | undefined;
    private static picklistDependencyExplorerFreshnessMessage: IPicklistDependencyExplorerFreshnessMessage | undefined;
    private static picklistDependencyExplorerLoadPhaseMessage: string = '';

    /*
        Whether the panel has announced it is listening.

        Every host message is STORED first and posted only once this is true. A webview that has not
        finished loading drops what is posted to it, and the panel is created before any of the work,
        so the early phases are always posted into that window -- storing them means the handshake
        replays them rather than the reader losing the first thing the panel had to say.

        It is also what keeps the protocol idempotent: without it the eager post and the handshake
        replay both deliver, and the panel renders the whole model twice.
    */
    private static picklistDependencyExplorerIsPanelReady: boolean = false;

    // A FAILURE IS REPLAYED AS A FAILURE, NOT AS THE PHASE IT DIED IN -- SEE failPicklistDependencyExplorerLoad
    private static picklistDependencyExplorerLoadFailedMessage: IPicklistDependencyExplorerLoadFailedMessage | undefined;

    /*
        One allow-list per panel command, each built from the model currently rendered.

        Every one of them matches the posted value against what the model NAMES rather than
        validating it as a path, so a message arriving from anywhere else cannot make the extension
        host open an arbitrary file on the user's disk. The spec and report lists are keyed on the
        file AND the method together, so a legitimate file cannot be combined with a method name of
        the sender's choosing either.

        They start EMPTY and are only filled when a model is rendered. The panel now exists before
        any model does, and in that window every action is refused -- there is nothing on screen for
        one to have come from.
    */
    private static picklistDependencyExplorerRevealableSourceFilePaths: Set<string> = new Set();
    private static picklistDependencyExplorerOpenableSpecTargets: Set<string> = new Set();
    private static picklistDependencyExplorerOpenableRunReportTargets: Set<string> = new Set();
    private static picklistDependencyExplorerCopyableCombinationKeys: Set<string> = new Set();

    /*
        Opens (or reveals) the panel with its static shell, before any of the load has run.

        Re-running the command resets the shell and the render state: the previous model is no longer
        what the workspace holds, and leaving it on screen under a fresh load's status line would
        have the panel showing one org's structure while reporting another's progress.
    */
    private openPicklistDependencyExplorerShell(): vscode.WebviewPanel {

        const existingExplorerPanel = ExtensionCommandService.picklistDependencyExplorerPanel;

        const explorerPanel = existingExplorerPanel
            ?? vscode.window.createWebviewPanel(
                PICKLIST_DEPENDENCY_EXPLORER_VIEW_TYPE,
                'Picklist Dependency Explorer',
                vscode.ViewColumn.One,
                /*
                    localResourceRoots is set EMPTY rather than omitted. Omitting it does not deny
                    the grant -- VS Code then defaults to the extension directory plus every open
                    workspace folder. The panel loads no file of any kind: its shell is inline and
                    its model arrives over postMessage, and enableScripts is what the nonced inline
                    script requires rather than a resource grant.

                    retainContextWhenHidden is deliberately NOT set: the panel's state is entirely
                    derived from the model, so a hidden panel costs nothing to rebuild -- the host
                    holds the model and re-posts it on the reload a reveal triggers -- and holding a
                    full DOM per hidden tab is what VS Code warns against.
                */
                { enableScripts: true, localResourceRoots: [] }
            );

        ExtensionCommandService.picklistDependencyExplorerPanel = explorerPanel;
        ExtensionCommandService.picklistDependencyExplorerRenderMessage = undefined;
        ExtensionCommandService.picklistDependencyExplorerFreshnessMessage = undefined;
        ExtensionCommandService.picklistDependencyExplorerLoadFailedMessage = undefined;
        ExtensionCommandService.picklistDependencyExplorerLoadPhaseMessage = '';
        ExtensionCommandService.picklistDependencyExplorerIsPanelReady = false;
        ExtensionCommandService.picklistDependencyExplorerRevealableSourceFilePaths = new Set();
        ExtensionCommandService.picklistDependencyExplorerOpenableSpecTargets = new Set();
        ExtensionCommandService.picklistDependencyExplorerOpenableRunReportTargets = new Set();
        ExtensionCommandService.picklistDependencyExplorerCopyableCombinationKeys = new Set();

        if ( !existingExplorerPanel ) {

            explorerPanel.onDidDispose(() => {
                ExtensionCommandService.picklistDependencyExplorerMessageSubscription?.dispose();
                ExtensionCommandService.picklistDependencyExplorerMessageSubscription = undefined;
                ExtensionCommandService.picklistDependencyExplorerPanel = undefined;
                ExtensionCommandService.picklistDependencyExplorerRenderMessage = undefined;
                ExtensionCommandService.picklistDependencyExplorerFreshnessMessage = undefined;
                ExtensionCommandService.picklistDependencyExplorerLoadFailedMessage = undefined;
                ExtensionCommandService.picklistDependencyExplorerIsPanelReady = false;
                ExtensionCommandService.picklistDependencyExplorerRevealableSourceFilePaths = new Set();
                ExtensionCommandService.picklistDependencyExplorerOpenableSpecTargets = new Set();
                ExtensionCommandService.picklistDependencyExplorerOpenableRunReportTargets = new Set();
                ExtensionCommandService.picklistDependencyExplorerCopyableCombinationKeys = new Set();
            });

        }

        const nonce = PicklistDependencyExplorerService.buildNonce();
        explorerPanel.webview.html = PicklistDependencyExplorerService.buildWebviewShellHtml(nonce);

        this.registerPicklistDependencyExplorerMessageSubscription(explorerPanel);

        explorerPanel.reveal(vscode.ViewColumn.One);

        return explorerPanel;

    }

    /*
        Posts to the panel only once it has said it is listening; everything is stored either way.

        The one place that decides this, so no post site has to remember the rule.
    */
    private static postToPicklistDependencyExplorerPanel(explorerPanel: vscode.WebviewPanel,
                                                            hostMessage: PicklistDependencyExplorerHostMessage) {

        if ( !ExtensionCommandService.isPicklistDependencyExplorerPanelLive(explorerPanel) ) {
            return;
        }

        if ( !ExtensionCommandService.picklistDependencyExplorerIsPanelReady ) {
            return;
        }

        explorerPanel.webview.postMessage(hostMessage);

    }

    /*
        Whether the panel this load is reporting into is still the panel the window has.

        onDidDispose clears the reference, so a tab closed mid-load stops matching -- and the load,
        which now has awaits in it and so can outlive the tab, has something to check. Posting to a
        disposed webview throws, and that throw would reach the error handler and offer the user a
        "report this to GitHub" dialog for the ordinary act of closing a tab.
    */
    private static isPicklistDependencyExplorerPanelLive(explorerPanel: vscode.WebviewPanel): boolean {

        return ExtensionCommandService.picklistDependencyExplorerPanel === explorerPanel;

    }

    // ONE FORMAT FOR THE STATUS BAR PHASE, SO THE ITEM READS THE SAME WHEN IT IS CREATED AS WHEN IT IS UPDATED
    private static buildPicklistDependencyExplorerStatusText(phaseMessage: string): string {

        return `$(sync~spin) Explorer: ${phaseMessage}`;

    }

    /*
        Hands the extension host's event loop back a turn.

        Without this the whole open is ONE synchronous turn: VS Code batches webview posts and status
        bar writes and flushes them when the turn ends, so every phase this command reports would
        arrive at once, after the work they describe had already finished. The panel would open and
        narrate nothing. It is also what lets the panel's "ready" be received while the load is still
        running, rather than only after it.
    */
    private static async yieldToExtensionHost(): Promise<void> {

        return new Promise<void>(resolveYield => setImmediate(resolveYield));

    }

    // THE CURRENT PHASE, IN THE PANEL AND IN THE STATUS BAR, SO IT IS LEGIBLE WHETHER OR NOT THE PANEL HAS FOCUS
    private async reportPicklistDependencyExplorerPhase(explorerPanel: vscode.WebviewPanel,
                                                    explorerLoadStatusItem: vscode.StatusBarItem,
                                                    phaseMessage: string) {

        ExtensionCommandService.picklistDependencyExplorerLoadPhaseMessage = phaseMessage;
        explorerLoadStatusItem.text = ExtensionCommandService.buildPicklistDependencyExplorerStatusText(phaseMessage);

        const loadPhaseMessage: IPicklistDependencyExplorerLoadPhaseMessage = { command: 'loadPhase', message: phaseMessage };
        ExtensionCommandService.postToPicklistDependencyExplorerPanel(explorerPanel, loadPhaseMessage);

        await ExtensionCommandService.yieldToExtensionHost();

    }

    /*
        Hands the panel a model to draw, and rebuilds the allow-lists from it in the same step.

        The two belong together: a model on screen whose targets are not in the allow-lists has
        buttons that silently do nothing, and allow-lists outliving the model they came from is the
        stale-permission bug the per-render listener used to prevent.
    */
    private renderPicklistDependencyExplorerModel(explorerPanel: vscode.WebviewPanel,
                                                    explorerViewModel: IPicklistDependencyExplorerViewModel,
                                                    remainingPhaseMessage: string) {

        if ( !ExtensionCommandService.isPicklistDependencyExplorerPanelLive(explorerPanel) ) {
            return;
        }

        const renderMessage = PicklistDependencyExplorerService.buildRenderModelMessage(explorerViewModel, remainingPhaseMessage);

        ExtensionCommandService.picklistDependencyExplorerRenderMessage = renderMessage;
        ExtensionCommandService.picklistDependencyExplorerLoadPhaseMessage = remainingPhaseMessage;

        ExtensionCommandService.picklistDependencyExplorerRevealableSourceFilePaths =
            new Set(PicklistDependencyExplorerService.collectSourceFilePaths(explorerViewModel));
        ExtensionCommandService.picklistDependencyExplorerOpenableSpecTargets =
            new Set(PicklistDependencyExplorerService.collectOpenableSpecTargets(explorerViewModel));
        ExtensionCommandService.picklistDependencyExplorerOpenableRunReportTargets =
            new Set(PicklistDependencyExplorerService.collectOpenableRunReportTargets(explorerViewModel));
        ExtensionCommandService.picklistDependencyExplorerCopyableCombinationKeys =
            new Set(PicklistDependencyExplorerService.collectCombinationKeys(explorerViewModel));

        /*
            A model belongs to ONE load, and so does the freshness answer. Clearing it here stops a
            previous load's answer being replayed onto this model on the next reveal, which would
            banner a fresh manifest as stale or the reverse.
        */
        ExtensionCommandService.picklistDependencyExplorerFreshnessMessage = undefined;

        ExtensionCommandService.postToPicklistDependencyExplorerPanel(explorerPanel, renderMessage);

    }

    /*
        The staleness answer, once the walk that produces it has finished.

        Kept on the stored render message as well as posted, so the reload a reveal triggers gets the
        resolved answer rather than the pending one the model was built with.
    */
    private applyPicklistDependencyExplorerFreshness(explorerPanel: vscode.WebviewPanel,
                                                        freshnessResult: IPicklistDependencyManifestFreshnessResult) {

        const freshnessMessage: IPicklistDependencyExplorerFreshnessMessage = {
            command: 'applyFreshness',
            freshness: freshnessResult.freshness,
            message: freshnessResult.message
        };

        ExtensionCommandService.picklistDependencyExplorerFreshnessMessage = freshnessMessage;
        ExtensionCommandService.picklistDependencyExplorerLoadPhaseMessage = '';

        const renderMessage = ExtensionCommandService.picklistDependencyExplorerRenderMessage;

        if ( renderMessage ) {

            /*
                REPLACED rather than mutated. That message has already been handed to postMessage,
                and editing an object after posting it is a race whose outcome depends on when the
                webview host serializes -- the replay copy is a different object precisely so what
                was sent and what is held for a reveal cannot disagree.
            */
            ExtensionCommandService.picklistDependencyExplorerRenderMessage = {
                ...renderMessage,
                message: '',
                model: {
                    ...renderMessage.model,
                    manifestFreshness: freshnessResult.freshness,
                    manifestFreshnessMessage: freshnessResult.message
                }
            };

        }

        ExtensionCommandService.postToPicklistDependencyExplorerPanel(explorerPanel, freshnessMessage);

    }

    // WHY THE PANEL IS SHOWING NOTHING, IN THE PANEL ITSELF -- A LOAD THAT ENDED HAS TO STOP LOOKING LIKE ONE STILL RUNNING
    private failPicklistDependencyExplorerLoad(explorerPanel: vscode.WebviewPanel | undefined, failureMessage: string) {

        if ( !explorerPanel ) {
            return;
        }

        ExtensionCommandService.picklistDependencyExplorerLoadPhaseMessage = failureMessage;

        /*
            Held as a FAILURE rather than as a phase line, so a reveal after the load died comes back
            saying it died. Replaying it as a phase would have the panel report a load still running
            that nothing is going to finish.
        */
        const loadFailedMessage: IPicklistDependencyExplorerLoadFailedMessage = { command: 'loadFailed', message: failureMessage };
        ExtensionCommandService.picklistDependencyExplorerLoadFailedMessage = loadFailedMessage;

        ExtensionCommandService.postToPicklistDependencyExplorerPanel(explorerPanel, loadFailedMessage);

    }

    private registerPicklistDependencyExplorerMessageSubscription(explorerPanel: vscode.WebviewPanel) {

        ExtensionCommandService.picklistDependencyExplorerMessageSubscription?.dispose();

        ExtensionCommandService.picklistDependencyExplorerMessageSubscription = explorerPanel.webview.onDidReceiveMessage(async (panelMessage: IPicklistDependencyExplorerPanelMessage) => {

            /*
                The panel announcing it has loaded -- on first open, and again on every reveal after
                it was hidden, because the document is rebuilt each time. Everything the host holds
                is replayed in the order it was first sent, so the panel comes back in the state it
                was in rather than in the state a fresh load would leave it.
            */
            if ( panelMessage?.command === 'ready' ) {

                ExtensionCommandService.picklistDependencyExplorerIsPanelReady = true;

                const renderMessage = ExtensionCommandService.picklistDependencyExplorerRenderMessage;

                if ( renderMessage ) {
                    explorerPanel.webview.postMessage(renderMessage);
                }

                const freshnessMessage = ExtensionCommandService.picklistDependencyExplorerFreshnessMessage;

                if ( freshnessMessage ) {
                    explorerPanel.webview.postMessage(freshnessMessage);
                }

                /*
                    A failure outranks both. It is replayed even when a model was rendered first --
                    the structure on screen is still worth showing, and the reader still has to be
                    told the load behind it did not finish.
                */
                const loadFailedMessage = ExtensionCommandService.picklistDependencyExplorerLoadFailedMessage;

                if ( loadFailedMessage ) {
                    explorerPanel.webview.postMessage(loadFailedMessage);
                    return;
                }

                /*
                    No answer and no failure, so the phase line is replayed instead -- a reveal in the
                    middle of a load has to come back still saying what it is waiting for. A render
                    message carries its own trailing phase, so this is only for the window before one.
                */
                if ( !renderMessage && !freshnessMessage && ExtensionCommandService.picklistDependencyExplorerLoadPhaseMessage ) {

                    const loadPhaseMessage: IPicklistDependencyExplorerLoadPhaseMessage = {
                        command: 'loadPhase',
                        message: ExtensionCommandService.picklistDependencyExplorerLoadPhaseMessage
                    };
                    explorerPanel.webview.postMessage(loadPhaseMessage);

                }

                return;

            }

            if ( panelMessage?.command === 'revealFieldSource' && panelMessage.sourceFilePath ) {

                if ( !ExtensionCommandService.picklistDependencyExplorerRevealableSourceFilePaths.has(panelMessage.sourceFilePath) ) {
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

                if ( !ExtensionCommandService.picklistDependencyExplorerOpenableSpecTargets.has(openTargetKey) ) {
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

                if ( !ExtensionCommandService.picklistDependencyExplorerOpenableRunReportTargets.has(openTargetKey) ) {
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

                if ( !ExtensionCommandService.picklistDependencyExplorerCopyableCombinationKeys.has(panelMessage.combinationKey) ) {
                    return;
                }

                await VSCodeWorkspaceService.copyTextToClipboard(panelMessage.combinationKey);
                VSCodeWorkspaceService.showInformationMessage(`Copied "${panelMessage.combinationKey}". Paste it into the explorer's find box to come back to this combination.`);

            }

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
