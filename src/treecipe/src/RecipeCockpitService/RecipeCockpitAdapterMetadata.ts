import * as path from 'path';
import * as vscode from 'vscode';
import {
    RECIPE_COCKPIT_ADAPTER_APPLY_NOTHING_REASON,
    RECIPE_COCKPIT_ADAPTER_CHILD_NO_PARENTS_REASON
} from './RecipeCockpitAdapterConstants';
import { RecipeCockpitPermissionSetGenerate } from './RecipeCockpitPermissionSetGenerate';
import { RecipeCockpitMetadataDeploy } from './RecipeCockpitMetadataDeploy';
import { RecipeYamlScalar } from '../RecipeYamlScalar/RecipeYamlScalar';
import { FakerJSRecipeFakerService } from '../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';
import { ScratchOrgService } from '../ScratchOrgService/ScratchOrgService';
import { VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';
import { RECIPE_COCKPIT_RUN_ARTIFACTS_FOLDER_NAME } from '../RunArtifacts/RecipeCockpitRunArtifacts';
import {
    IOrgFieldFileCopy,
    IOrgNewFieldDetail,
    IOrgObjectChanges,
    IOrgStagedFieldDetail,
    ORG_CHANGE_RETRIEVE_OPERATION_NAME,
    RecipeCockpitOrgChangeDetection
} from './RecipeCockpitOrgChangeDetection';
import { RecipeService } from '../RecipeService/RecipeService';
import type {
    IRecipeCockpitAdapterChildBlockMessage,
    IRecipeCockpitAdapterChildFieldViewModel,
    IRecipeCockpitAdapterMetadataChangesMessage,
    IRecipeCockpitAdapterOrgOnlyField,
    IRecipeCockpitHubForAdapterTab,
    IRecipeCockpitUpdaterLoadStateMessage
} from './RecipeCockpitAdapterHost';
import {
    RECIPE_COCKPIT_ADAPTER_ORG_ONLY_FIXED_VALUE_NOTE} from './RecipeCockpitAdapterRecords';
import { RecipeCockpitAdapterState } from './RecipeCockpitAdapterState';
// TYPES ONLY: THE HUB IMPORTS THIS FILE'S TAB, AND A HOST NEVER LOADS THE HUB'S CODE
import type {
    IRecipeCockpitPanelState,
    IRecipeCockpitRecipeViewModel,
    IRecipeCockpitTreeViewModel,
    RecipeCockpitPanelAction
} from './RecipeCockpitViewModel';
import { RecipeCockpitTreecipeDataOrgs } from './RecipeCockpitTreecipeDataOrgs';
import { RecipeCockpitUntrustedValue } from './RecipeCockpitUntrustedValue';
import { RecipeCockpitDrawnModel } from './RecipeCockpitDrawnModel';

/*
    The Treecipe Adapter's metadata runs (#445, #447; moved out of the hub by #668): Retrieve latest
    metadata into a staging folder, Apply retrieved files into the project, the fields only the org
    holds, and Add to data set's child block, prepared and generated.
*/

export const RECIPE_COCKPIT_ADAPTER_RETRIEVE_ORG_PLACEHOLDER = 'Select the sandbox or scratch org to retrieve the latest metadata from';
export const RECIPE_COCKPIT_ADAPTER_CHILD_PARENT_LOOKUP_REASON_PREFIX = 'set per record to a loaded ';
export const RECIPE_COCKPIT_ADAPTER_CHILD_OTHER_LOOKUP_REASON = 'a lookup to another object: left out of the block';
export const RECIPE_COCKPIT_ADAPTER_APPLY_CONFIRM_LABEL = 'Apply files';
export const RECIPE_COCKPIT_ADAPTER_APPLY_BUSY_REFUSAL = 'Nothing was applied: a metadata deploy, a retrieve, a recipe write or a generation is running. Try again when it ends.';
export const RECIPE_COCKPIT_ADAPTER_ORG_ONLY_NO_RECIPE_REASON = 'this card has no single recipe file to read its faker backend from, so no value can be generated';

export class RecipeCockpitAdapterMetadata {

    /*
        What the Treecipe Adapter offers for each field only the org holds (#446): a NEW field (no
        project file) that the card's model does not list either. Its staged file is read as
        Generate Treecipe reads a field file -- type, sizes, picklist values, controlling field,
        lookup -- and locked by the Updater's own rule, a formula and a lookup the staged file names
        included. An unlocked one is offered the expression the recipe's OWN backend writes for its
        type (RecipeService.getOrgOnlyFieldExpression), or, when it writes none or the backend is
        not known, a fixed value only, with a note. The offer rides on the posted field change; the
        field models stay on the host for the router and the executors.
    */
    static offerAdapterOrgOnlyFields(hub: IRecipeCockpitHubForAdapterTab, recipe: IRecipeCockpitRecipeViewModel,
                                     tree: IRecipeCockpitTreeViewModel,
                                     objectChanges: readonly IOrgObjectChanges[],
                                     newFields: readonly IOrgNewFieldDetail[],
                                     fakerService: 'faker-js' | 'snowfakery' | undefined): { objects: IOrgObjectChanges[]; orgOnlyFields: Map<string, IRecipeCockpitAdapterOrgOnlyField> } {

        const recipeService = fakerService === undefined
            ? undefined
            : new RecipeService(fakerService === 'faker-js' ? new FakerJSRecipeFakerService() : new SnowfakeryRecipeFakerService());
        const newFieldsByKey = new Map(newFields.map(newField => [`${newField.objectApiName}\n${newField.fieldApiName.toLowerCase()}`, newField] as const));
        const orgOnlyFields = new Map<string, IRecipeCockpitAdapterOrgOnlyField>();

        const objects = objectChanges.map(objectChange => {

            const modelFieldNames = new Set(( recipe.objects.find(object => object.objectApiName === objectChange.objectApiName)?.fields ?? [] ).map(field => field.fieldApiName.toLowerCase()));

            return {
                ...objectChange,
                fieldChanges: objectChange.fieldChanges.map(fieldChange => {

                    const newField = newFieldsByKey.get(`${objectChange.objectApiName}\n${fieldChange.fieldApiName.toLowerCase()}`);

                    if ( fieldChange.status !== 'new' || modelFieldNames.has(fieldChange.fieldApiName.toLowerCase()) || !newField ) {
                        return fieldChange;
                    }

                    const { fieldViewModel, lockReason, expression } = hub.offerStagedField(
                        newField,
                        fieldChange.fieldApiName,
                        candidateViewModel => RecipeCockpitAdapterState.findUpdaterFieldLockReason(tree, objectChange.objectApiName, candidateViewModel)
                            // GENERATE VALUES NEEDS THE CARD'S RECIPE, SO A CARD WITHOUT ONE OFFERS NOTHING TO FILL
                            ?? ( fakerService === undefined ? RECIPE_COCKPIT_ADAPTER_ORG_ONLY_NO_RECIPE_REASON : undefined ),
                        recipeService
                    );

                    orgOnlyFields.set(`${objectChange.objectApiName}\n${fieldChange.fieldApiName}`, {
                        objectApiName: objectChange.objectApiName,
                        fieldViewModel: fieldViewModel,
                        picklistValues: [...newField.picklistValues],
                        ...( lockReason !== undefined ? { lockReason: lockReason } : {} ),
                        ...( expression !== undefined ? { expression: expression } : {} )
                    });

                    return {
                        ...fieldChange,
                        orgOnly: {
                            fieldTypeWithSize: fieldViewModel.fieldTypeWithSize,
                            ...( lockReason !== undefined ? { lockReason: lockReason } : {} ),
                            ...( expression !== undefined ? { expression: expression } : {} ),
                            ...( lockReason === undefined && expression === undefined ? { note: RECIPE_COCKPIT_ADAPTER_ORG_ONLY_FIXED_VALUE_NOTE } : {} )
                        }
                    };

                })
            };

        });

        return { objects: objects, orgOnlyFields: orgOnlyFields };

    }

    /*
        "Retrieve latest metadata" (#445): one run per window, sharing the load's lock. The org is the
        Target Org Manager selection once it answered it is a sandbox, or, with none, the load's own
        prompt. The objects are retrieved as CustomObject members into a STAGING folder under
        the tree's RunArtifacts/OrgOperations -- never a package directory -- and compared with the project's field
        files. What is posted is names and one-line differences; the staged files stay on the host
        for a later Apply. How it went is ONE notification.
    */
    static async retrieveAdapterMetadataFromPanel(hub: IRecipeCockpitHubForAdapterTab, cockpitPanel: vscode.WebviewPanel,
                                                          panelState: IRecipeCockpitPanelState,
                                                          retrieveAction: Extract<RecipeCockpitPanelAction, { kind: 'retrieveAdapterMetadata' }>) {

        const notRunning: IRecipeCockpitUpdaterLoadStateMessage = { command: 'updaterLoadState', isRunning: false, treeKey: retrieveAction.treeKey };

        if ( RecipeCockpitAdapterState.isUpdaterLoadInFlight ) {
            hub.postToPanel(cockpitPanel, RecipeCockpitAdapterState.updaterLoadRunStateMessage ?? notRunning);
            return;
        }

        RecipeCockpitAdapterState.isUpdaterLoadInFlight = true;
        RecipeCockpitAdapterState.setUpdaterLoadState(hub, { command: 'updaterLoadState', isRunning: true, treeKey: retrieveAction.treeKey, runKind: 'retrieve' });

        try {
            await this.performAdapterMetadataRetrieve(hub, cockpitPanel, panelState, retrieveAction);
        } finally {
            RecipeCockpitAdapterState.isUpdaterLoadInFlight = false;
            RecipeCockpitAdapterState.setUpdaterLoadState(hub, notRunning);
        }

    }

    private static async performAdapterMetadataRetrieve(hub: IRecipeCockpitHubForAdapterTab, cockpitPanel: vscode.WebviewPanel,
                                                        panelState: IRecipeCockpitPanelState,
                                                        retrieveAction: Extract<RecipeCockpitPanelAction, { kind: 'retrieveAdapterMetadata' }>) {

        const { treeKey, renderSequence, objectApiNames } = retrieveAction;
        const workspaceRoot = panelState.workspaceRoot;
        const clickedRecipeDataMessage = panelState.recipeDataMessage;
        const isClickStillCurrent = () => hub.recipeCockpitPanel === cockpitPanel
                                            && hub.recipeCockpitPanelState === panelState
                                            && panelState.recipeDataMessage === clickedRecipeDataMessage;
        const tree = clickedRecipeDataMessage?.recipe.trees.find(recipeTree => recipeTree.treeKey === treeKey);
        const warn = (warningText: string) => VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(warningText));

        if ( !clickedRecipeDataMessage || clickedRecipeDataMessage.renderSequence !== renderSequence || !tree?.folderName ) {
            return;
        }

        // AN UNDEPLOYABLE PROJECT OPENS NO PROMPT: ITS PACKAGE DIRECTORIES ARE WHAT THE ORG'S FILES ARE COMPARED WITH
        let packageDirectoryPaths: string[];
        try {
            packageDirectoryPaths = SfdxProjectService.resolveDeployablePackageDirectoryPaths(workspaceRoot);
        } catch (projectError) {
            warn(`Nothing was retrieved: ${RecipeCockpitUntrustedValue.describeThrown(projectError)}`);
            return;
        }

        if ( retrieveAction.isOrgPrompted ) {
            let isSandboxSelected = false;
            panelState.isUpdaterOrgPromptOpen = true;
            try {
                isSandboxSelected = await RecipeCockpitTreecipeDataOrgs.promptAndSelectDataOrg(hub, cockpitPanel, panelState, clickedRecipeDataMessage, isClickStillCurrent,
                    RECIPE_COCKPIT_ADAPTER_RETRIEVE_ORG_PLACEHOLDER, 'Nothing was retrieved', 'the Treecipe Adapter reads only from a sandbox or scratch org');
            } finally {
                panelState.isUpdaterOrgPromptOpen = false;
            }
            if ( !isSandboxSelected ) {
                return;
            }
        }

        const dataOrgSelection = panelState.dataOrgSelection;

        if ( !isClickStillCurrent() || dataOrgSelection?.orgTypeDetail?.isSandbox !== true ) {
            return;
        }

        const orgUsername = dataOrgSelection.orgDetail.username;
        // NO PARENTHESES: A NOTIFICATION ESCAPES THEM
        const orgLabel = dataOrgSelection.orgDetail.alias ? `${dataOrgSelection.orgDetail.alias} · ${orgUsername}` : orgUsername;
        const treeTitle = tree.customName ?? tree.title;
        const runArtifactsLocation = hub.resolveTreeRunArtifactsLocation(workspaceRoot, clickedRecipeDataMessage.recipe, tree);
        let retrieveArguments: string[];
        let stagingFolderPath: string | undefined;
        try {
            const packageXml = RecipeCockpitOrgChangeDetection.buildObjectRetrievePackageXml(objectApiNames, hub.readSourceApiVersion(workspaceRoot));
            const plannedStagingFolderPath = runArtifactsLocation ? RecipeCockpitOrgChangeDetection.buildStagingFolderPath(runArtifactsLocation, orgUsername, new Date()) : undefined;
            stagingFolderPath = runArtifactsLocation && plannedStagingFolderPath ? RecipeCockpitOrgChangeDetection.makeStagingFolder(runArtifactsLocation, plannedStagingFolderPath) : undefined;
            const writtenPackageXmlFilePath = runArtifactsLocation && stagingFolderPath
                ? RecipeCockpitMetadataDeploy.writePackageXml(runArtifactsLocation, RecipeCockpitOrgChangeDetection.buildPackageXmlFilePath(stagingFolderPath), packageXml)
                : undefined;
            if ( !stagingFolderPath || !writtenPackageXmlFilePath ) {
                warn(`Nothing was retrieved: the staging folder could not be made under the tree's ${RECIPE_COCKPIT_RUN_ARTIFACTS_FOLDER_NAME} folder in this workspace.`);
                return;
            }
            retrieveArguments = RecipeCockpitOrgChangeDetection.buildRetrieveArguments(
                RecipeCockpitMetadataDeploy.toManifestRelativePath(workspaceRoot, writtenPackageXmlFilePath),
                RecipeCockpitOrgChangeDetection.toOutputDirectoryArgument(workspaceRoot, stagingFolderPath),
                orgUsername
            );
        } catch (argumentError) {
            warn(`Nothing was retrieved: ${RecipeCockpitUntrustedValue.describeThrown(argumentError)}`);
            return;
        }

        const retrieveRun = await hub.runCancellableRetrieve(
            RecipeYamlScalar.escapeForNotification(`Recipe Cockpit: retrieving the latest metadata of ${treeTitle} from ${orgLabel}`),
            retrieveArguments,
            workspaceRoot,
            { orgUsername: orgUsername, components: objectApiNames.map(objectApiName => ({ type: 'CustomObject', member: objectApiName })), destination: { kind: 'staging', stagingFolderPath: stagingFolderPath } }
        );

        // THE STAGING FOLDER IS THE ONLY PLACE IT WRITES, SO A CANCEL CHANGED NOTHING IN THE PROJECT
        if ( retrieveRun.isCancelled ) {
            warn(`The retrieve of the latest metadata of ${treeTitle} from ${orgLabel} was cancelled. Nothing in the project changed.`);
            return;
        }

        const retrievePayload = retrieveRun.payload;
        const retrieveOutputFilePath = retrieveRun.invocation.spawnError || retrieveRun.invocation.isOutputTooLarge
            ? undefined
            : runArtifactsLocation && ScratchOrgService.writeOrgOperationResult(workspaceRoot, orgUsername, ORG_CHANGE_RETRIEVE_OPERATION_NAME, retrieveRun.invocation, new Date(), retrievePayload, runArtifactsLocation);
        const retrieveRead = RecipeCockpitOrgChangeDetection.readRetrieveSucceeded(retrieveRun.invocation, retrievePayload);

        // A FAILED RETRIEVE KEEPS WHAT THE LAST ONE MARKED ON SCREEN
        if ( 'failureMessage' in retrieveRead ) {
            hub.showMetadataRetrieveNotification('warning', `The latest metadata of ${treeTitle} could not be retrieved from ${orgLabel}: ${retrieveRead.failureMessage}`, retrieveOutputFilePath, workspaceRoot, false);
            return;
        }

        const detectedChanges = await RecipeCockpitOrgChangeDetection.detectFieldChangesWithNewFields(workspaceRoot, packageDirectoryPaths, stagingFolderPath, objectApiNames);
        const orgOnlyOffer = this.offerAdapterOrgOnlyFields(hub, clickedRecipeDataMessage.recipe, tree, detectedChanges.objectChanges, detectedChanges.newFields, hub.readTreeFakerService(panelState, treeKey));
        const objectChanges = orgOnlyOffer.objects;
        const orgContext = await RecipeCockpitAdapterState.readAdapterOrgContext(orgUsername, objectApiNames);
        objectChanges.forEach(objectChange => {
            const newChildObjects = orgContext.newChildObjectsByObject.get(objectChange.objectApiName);
            if ( newChildObjects ) {
                objectChange.newChildObjects = newChildObjects.childObjects;
                objectChange.moreNewChildObjectCount = newChildObjects.moreCount;
            }
        });

        if ( !isClickStillCurrent() ) {
            warn(`The latest metadata of ${treeTitle} was retrieved, but the run on screen changed meanwhile, so nothing was marked. Retrieve it again.`);
            return;
        }

        const changesMessage: IRecipeCockpitAdapterMetadataChangesMessage = {
            command: 'adapterMetadataChanges',
            renderSequence: renderSequence,
            treeKey: treeKey,
            orgLabel: orgLabel,
            objects: objectChanges,
            hints: orgContext.hints,
            ...( orgContext.childObjectsNote ? { childObjectsNote: orgContext.childObjectsNote } : {} )
        };
        panelState.adapterMetadataChangesMessage = changesMessage;
        panelState.adapterRetrieveStagingFolderPath = stagingFolderPath;
        panelState.adapterOrgOnlyFields = orgOnlyOffer.orgOnlyFields;
        hub.postToPanel(cockpitPanel, changesMessage);

        this.showAdapterRetrieveNotification(hub, objectChanges, treeTitle, orgLabel, retrieveOutputFilePath, workspaceRoot);

    }

    /*
        "Add to data set" (#447), first half: the new child object's metadata retrieved on its own
        from the sandbox the parent records came from, into a NEW staging folder under
        the tree's RunArtifacts/OrgOperations -- never a package directory -- and every field its files hold offered
        as the Adapter offers a field only the org holds (#446): the expression the recipe's own
        backend writes for its type, a fixed value only, or why it is locked. The lookup to the
        parent is locked, since each record's is a loaded parent's Id. Shares the load's lock.
    */
    static async prepareAdapterChildFromPanel(hub: IRecipeCockpitHubForAdapterTab, cockpitPanel: vscode.WebviewPanel,
                                                      panelState: IRecipeCockpitPanelState,
                                                      prepareAction: Extract<RecipeCockpitPanelAction, { kind: 'prepareAdapterChild' }>) {

        const notRunning: IRecipeCockpitUpdaterLoadStateMessage = { command: 'updaterLoadState', isRunning: false, treeKey: prepareAction.treeKey, runKind: 'prepareChild' };

        if ( RecipeCockpitAdapterState.isUpdaterLoadInFlight ) {
            hub.postToPanel(cockpitPanel, RecipeCockpitAdapterState.updaterLoadRunStateMessage ?? notRunning);
            return;
        }

        RecipeCockpitAdapterState.isUpdaterLoadInFlight = true;
        // A NEW CHILD REPLACES THE LAST ONE, AND THE RECORDS GENERATED FOR THAT ONE GO WITH IT (#722)
        const replacedChildObjectApiName = RecipeCockpitAdapterState.heldAdapterChild?.childObjectApiName;
        if ( replacedChildObjectApiName !== undefined ) {
            RecipeCockpitAdapterState.heldUpdaterNewRecords?.byObjectApiName.delete(replacedChildObjectApiName);
            panelState.updaterNewRecordsMessages = panelState.updaterNewRecordsMessages?.filter(newRecordsMessage => newRecordsMessage.objectApiName !== replacedChildObjectApiName);
        }
        RecipeCockpitAdapterState.heldAdapterChild = undefined;
        panelState.adapterChildBlockMessage = undefined;
        RecipeCockpitAdapterState.setUpdaterLoadState(hub, { command: 'updaterLoadState', isRunning: true, treeKey: prepareAction.treeKey, runKind: 'prepareChild' });

        try {
            await this.performAdapterChildPrepare(hub, cockpitPanel, panelState, prepareAction);
        } finally {
            RecipeCockpitAdapterState.isUpdaterLoadInFlight = false;
            RecipeCockpitAdapterState.setUpdaterLoadState(hub, notRunning);
        }

    }

    private static async performAdapterChildPrepare(hub: IRecipeCockpitHubForAdapterTab, cockpitPanel: vscode.WebviewPanel,
                                                    panelState: IRecipeCockpitPanelState,
                                                    prepareAction: Extract<RecipeCockpitPanelAction, { kind: 'prepareAdapterChild' }>) {

        const { treeKey, renderSequence, parentObjectApiName, childObjectApiName, lookupFieldApiName } = prepareAction;
        const workspaceRoot = panelState.workspaceRoot;
        const clickedRecipeDataMessage = panelState.recipeDataMessage;
        const heldRecords = RecipeCockpitAdapterState.heldUpdaterRecords;
        const orgDetail = panelState.dataOrgSelection?.orgDetail;
        const refuse = (reason: string) => VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(`${childObjectApiName} was not added: ${reason}`));

        // THE ROUTER CHECKED ALL OF THIS; A SCREEN THAT CHANGED SINCE IS ANSWERED WITH NOTHING
        const tree = clickedRecipeDataMessage?.recipe.trees.find(recipeTree => recipeTree.treeKey === treeKey);

        if ( !clickedRecipeDataMessage || clickedRecipeDataMessage.renderSequence !== renderSequence || !tree || !heldRecords || orgDetail?.username !== heldRecords.orgUsername ) {
            return;
        }

        const isClickStillCurrent = () => hub.recipeCockpitPanel === cockpitPanel
                                            && hub.recipeCockpitPanelState === panelState
                                            && panelState.recipeDataMessage === clickedRecipeDataMessage
                                            && RecipeCockpitAdapterState.heldUpdaterRecords === heldRecords
                                            && panelState.dataOrgSelection?.orgDetail.username === heldRecords.orgUsername;

        const fakerService = hub.readTreeFakerService(panelState, treeKey);
        if ( !fakerService ) {
            refuse('this card has no single recipe file to read its faker backend from.');
            return;
        }

        // THE RETRIEVE RUNS IN PROJECT MODE, SO AN UNDEPLOYABLE PROJECT STARTS NO PROCESS
        try {
            SfdxProjectService.resolveDeployablePackageDirectoryPaths(workspaceRoot);
        } catch (projectError) {
            refuse(RecipeCockpitUntrustedValue.describeThrown(projectError));
            return;
        }

        const orgUsername = heldRecords.orgUsername;
        const orgLabel = orgDetail.alias ? `${orgDetail.alias} · ${orgUsername}` : orgUsername;
        const runArtifactsLocation = hub.resolveTreeRunArtifactsLocation(workspaceRoot, clickedRecipeDataMessage.recipe, tree);
        let retrieveArguments: string[];
        let stagingFolderPath: string | undefined;
        try {
            const packageXml = RecipeCockpitOrgChangeDetection.buildObjectRetrievePackageXml([childObjectApiName], hub.readSourceApiVersion(workspaceRoot));
            const plannedStagingFolderPath = runArtifactsLocation ? RecipeCockpitOrgChangeDetection.buildStagingFolderPath(runArtifactsLocation, orgUsername, new Date()) : undefined;
            stagingFolderPath = runArtifactsLocation && plannedStagingFolderPath ? RecipeCockpitOrgChangeDetection.makeStagingFolder(runArtifactsLocation, plannedStagingFolderPath) : undefined;
            const writtenPackageXmlFilePath = runArtifactsLocation && stagingFolderPath
                ? RecipeCockpitMetadataDeploy.writePackageXml(runArtifactsLocation, RecipeCockpitOrgChangeDetection.buildPackageXmlFilePath(stagingFolderPath), packageXml)
                : undefined;
            if ( !stagingFolderPath || !writtenPackageXmlFilePath ) {
                refuse(`the staging folder could not be made under the tree's ${RECIPE_COCKPIT_RUN_ARTIFACTS_FOLDER_NAME} folder in this workspace.`);
                return;
            }
            retrieveArguments = RecipeCockpitOrgChangeDetection.buildRetrieveArguments(
                RecipeCockpitMetadataDeploy.toManifestRelativePath(workspaceRoot, writtenPackageXmlFilePath),
                RecipeCockpitOrgChangeDetection.toOutputDirectoryArgument(workspaceRoot, stagingFolderPath),
                orgUsername
            );
        } catch (argumentError) {
            refuse(RecipeCockpitUntrustedValue.describeThrown(argumentError));
            return;
        }

        const retrieveRun = await hub.runCancellableRetrieve(
            RecipeYamlScalar.escapeForNotification(`Recipe Cockpit: retrieving the metadata of ${childObjectApiName} from ${orgLabel}`),
            retrieveArguments,
            workspaceRoot,
            { orgUsername: orgUsername, components: [{ type: 'CustomObject', member: childObjectApiName }], destination: { kind: 'staging', stagingFolderPath: stagingFolderPath } }
        );

        if ( retrieveRun.isCancelled ) {
            refuse('its retrieve was cancelled. Nothing in the project changed.');
            return;
        }

        const retrievePayload = retrieveRun.payload;
        const retrieveOutputFilePath = retrieveRun.invocation.spawnError || retrieveRun.invocation.isOutputTooLarge
            ? undefined
            : runArtifactsLocation && ScratchOrgService.writeOrgOperationResult(workspaceRoot, orgUsername, ORG_CHANGE_RETRIEVE_OPERATION_NAME, retrieveRun.invocation, new Date(), retrievePayload, runArtifactsLocation);
        const retrieveRead = RecipeCockpitOrgChangeDetection.readRetrieveSucceeded(retrieveRun.invocation, retrievePayload);

        if ( 'failureMessage' in retrieveRead ) {
            hub.showMetadataRetrieveNotification('warning', `${childObjectApiName} was not added: its metadata could not be retrieved from ${orgLabel}: ${retrieveRead.failureMessage}`, retrieveOutputFilePath, workspaceRoot, false);
            return;
        }

        const stagedObject = await RecipeCockpitOrgChangeDetection.readStagedObjectFields(workspaceRoot, stagingFolderPath, childObjectApiName);

        if ( !stagedObject.isRetrieved ) {
            refuse(`${orgLabel} returned no metadata for it.`);
            return;
        }

        if ( !isClickStillCurrent() ) {
            refuse('the run, the records or the org on screen changed while its metadata was retrieved. Add it again.');
            return;
        }

        const offer = this.offerAdapterChildFields(hub, stagedObject.fields, parentObjectApiName, childObjectApiName, lookupFieldApiName, tree, fakerService);
        // A RECORD THE ORG ANSWERED WITH NO Id IS NO PARENT, NEVER THE TEXT "undefined"
        const parentRecordIds = ( heldRecords.recordsByObjectApiName.get(parentObjectApiName) ?? [] )
            .map(record => RecipeCockpitDrawnModel.readRecordFieldValue(record, 'Id'))
            .filter((recordId): recordId is string => typeof recordId === 'string' && recordId !== '');

        if ( parentRecordIds.length === 0 ) {
            refuse(RECIPE_COCKPIT_ADAPTER_CHILD_NO_PARENTS_REASON);
            return;
        }

        RecipeCockpitAdapterState.heldAdapterChild = {
            resultKey: heldRecords.resultKey,
            treeKey: treeKey,
            parentObjectApiName: parentObjectApiName,
            childObjectApiName: childObjectApiName,
            lookupFieldApiName: lookupFieldApiName,
            parentRecordIds: parentRecordIds,
            fakerService: fakerService,
            fields: offer.offeredFields
        };

        const blockMessage: IRecipeCockpitAdapterChildBlockMessage = {
            command: 'adapterChildBlock',
            renderSequence: renderSequence,
            treeKey: treeKey,
            parentObjectApiName: parentObjectApiName,
            childObjectApiName: childObjectApiName,
            lookupFieldApiName: lookupFieldApiName,
            parentRecordCount: parentRecordIds.length,
            orgLabel: orgLabel,
            fakerService: fakerService,
            fields: offer.fieldViewModels,
            unreadableFieldCount: stagedObject.unreadableFieldCount
        };
        panelState.adapterChildBlockMessage = blockMessage;
        hub.postToPanel(cockpitPanel, blockMessage);

        const unreadableText = stagedObject.unreadableFieldCount > 0
            ? ` ${stagedObject.unreadableFieldCount} field ${stagedObject.unreadableFieldCount === 1 ? 'file' : 'files'} could not be read and ${stagedObject.unreadableFieldCount === 1 ? 'is' : 'are'} left out.`
            : '';
        VSCodeWorkspaceService.showInformationMessage(RecipeYamlScalar.escapeForNotification(
            `Retrieved ${childObjectApiName} from ${orgLabel}: ${offer.fieldViewModels.length} ${offer.fieldViewModels.length === 1 ? 'field' : 'fields'}.${unreadableText} Set the count and the fields on the Treecipe Adapter tab, then generate a preview.`
        ));

    }

    /*
        Each staged field of a new child object (#447) as the Adapter offers it: the lookup to the
        parent locked (each record's is a loaded parent's Id), any other lookup locked, and every
        other field by the rule a field only the org holds is offered by (#446), with the recipe's
        own backend. Name first, then the order the files were read in.
    */
    static offerAdapterChildFields(hub: IRecipeCockpitHubForAdapterTab, stagedFields: readonly IOrgStagedFieldDetail[],
                                   parentObjectApiName: string,
                                   childObjectApiName: string,
                                   lookupFieldApiName: string,
                                   tree: IRecipeCockpitTreeViewModel,
                                   fakerService: 'faker-js' | 'snowfakery'): { fieldViewModels: IRecipeCockpitAdapterChildFieldViewModel[]; offeredFields: Map<string, IRecipeCockpitAdapterOrgOnlyField> } {

        const recipeService = new RecipeService(fakerService === 'faker-js' ? new FakerJSRecipeFakerService() : new SnowfakeryRecipeFakerService());
        const fieldViewModels: IRecipeCockpitAdapterChildFieldViewModel[] = [];
        const offeredFields = new Map<string, IRecipeCockpitAdapterOrgOnlyField>();

        stagedFields.forEach(stagedField => {

            const isParentLookup = stagedField.fieldApiName.toLowerCase() === lookupFieldApiName.toLowerCase();
            const fixedLockReason = isParentLookup
                ? `${RECIPE_COCKPIT_ADAPTER_CHILD_PARENT_LOOKUP_REASON_PREFIX}${parentObjectApiName} Id`
                : stagedField.referenceTo !== '' && !stagedField.isFormula ? RECIPE_COCKPIT_ADAPTER_CHILD_OTHER_LOOKUP_REASON : undefined;
            const offered = hub.offerStagedField(
                fixedLockReason === undefined ? stagedField : { ...stagedField, referenceTo: '', isFormula: false },
                stagedField.fieldApiName,
                fieldViewModel => fixedLockReason ?? RecipeCockpitAdapterState.findUpdaterFieldLockReason(tree, childObjectApiName, fieldViewModel),
                fixedLockReason === undefined ? recipeService : undefined
            );

            offeredFields.set(stagedField.fieldApiName, {
                objectApiName: childObjectApiName,
                fieldViewModel: offered.fieldViewModel,
                picklistValues: [...stagedField.picklistValues],
                ...( offered.lockReason !== undefined ? { lockReason: offered.lockReason } : {} ),
                ...( offered.expression !== undefined ? { expression: offered.expression } : {} )
            });
            fieldViewModels.push({
                fieldApiName: stagedField.fieldApiName,
                fieldLabel: stagedField.fieldLabel,
                fieldTypeWithSize: offered.fieldViewModel.fieldTypeWithSize,
                isRequired: stagedField.isRequired,
                ...( offered.lockReason !== undefined ? { lockReason: offered.lockReason } : {} ),
                ...( offered.expression !== undefined ? { expression: offered.expression } : {} ),
                ...( offered.lockReason === undefined && offered.expression === undefined ? { note: RECIPE_COCKPIT_ADAPTER_ORG_ONLY_FIXED_VALUE_NOTE } : {} )
            });

        });

        return { fieldViewModels: fieldViewModels, offeredFields: offeredFields };

    }

    static async applyAdapterRetrievedFilesFromPanel(hub: IRecipeCockpitHubForAdapterTab, cockpitPanel: vscode.WebviewPanel,
                                                             panelState: IRecipeCockpitPanelState,
                                                             applyAction: Extract<RecipeCockpitPanelAction, { kind: 'applyAdapterRetrievedFiles' }>) {

        const notRunning: IRecipeCockpitUpdaterLoadStateMessage = { command: 'updaterLoadState', isRunning: false, treeKey: applyAction.treeKey };

        if ( RecipeCockpitAdapterState.isUpdaterLoadInFlight ) {
            hub.postToPanel(cockpitPanel, RecipeCockpitAdapterState.updaterLoadRunStateMessage ?? notRunning);
            return;
        }

        RecipeCockpitAdapterState.isUpdaterLoadInFlight = true;
        RecipeCockpitAdapterState.setUpdaterLoadState(hub, { command: 'updaterLoadState', isRunning: true, treeKey: applyAction.treeKey, runKind: 'apply' });

        try {
            await this.performAdapterRetrievedFilesApply(hub, cockpitPanel, panelState, applyAction);
        } finally {
            RecipeCockpitAdapterState.isUpdaterLoadInFlight = false;
            RecipeCockpitAdapterState.setUpdaterLoadState(hub, notRunning);
        }

    }

    /*
        "Apply retrieved files to project" (#445): the copies are planned from the files as they are
        NOW, listed in one destructive confirmation, planned AGAIN after it and refused when they
        differ, then written. Cancel writes nothing. The marks are read again afterwards, and
        Generate Treecipe is offered, since it is what turns the files into the recipe.
    */
    private static async performAdapterRetrievedFilesApply(hub: IRecipeCockpitHubForAdapterTab, cockpitPanel: vscode.WebviewPanel,
                                                            panelState: IRecipeCockpitPanelState,
                                                            applyAction: Extract<RecipeCockpitPanelAction, { kind: 'applyAdapterRetrievedFiles' }>) {

        const workspaceRoot = panelState.workspaceRoot;
        const changesMessage = panelState.adapterMetadataChangesMessage;
        const stagingFolderPath = panelState.adapterRetrieveStagingFolderPath;
        const warn = (warningText: string) => VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(warningText));
        const isClickStillCurrent = () => hub.recipeCockpitPanel === cockpitPanel
                                            && hub.recipeCockpitPanelState === panelState
                                            && panelState.adapterMetadataChangesMessage === changesMessage
                                            && panelState.adapterRetrieveStagingFolderPath === stagingFolderPath;

        if ( !changesMessage || !stagingFolderPath || changesMessage.treeKey !== applyAction.treeKey || changesMessage.renderSequence !== applyAction.renderSequence ) {
            return;
        }

        const objectApiNames = changesMessage.objects.map(objectChanges => objectChanges.objectApiName);
        let packageDirectoryPaths: string[];
        let defaultPackageDirectoryPath: string;
        try {
            packageDirectoryPaths = SfdxProjectService.resolveDeployablePackageDirectoryPaths(workspaceRoot);
            defaultPackageDirectoryPath = RecipeCockpitPermissionSetGenerate.resolveDefaultPackageDirectoryPath(workspaceRoot);
        } catch (projectError) {
            warn(`Nothing was applied: ${RecipeCockpitUntrustedValue.describeThrown(projectError)}`);
            return;
        }

        const planCopies = () => RecipeCockpitOrgChangeDetection.planFieldFileCopies(workspaceRoot, packageDirectoryPaths, defaultPackageDirectoryPath, stagingFolderPath, objectApiNames);
        const describePlan = (fieldFileCopies: readonly IOrgFieldFileCopy[]) => fieldFileCopies
            .map(fieldFileCopy => `${fieldFileCopy.status}\n${fieldFileCopy.stagedFilePath}\n${fieldFileCopy.targetFilePath}`)
            .join('\n');
        const fieldFileCopies = await planCopies();

        if ( fieldFileCopies.length === 0 ) {
            VSCodeWorkspaceService.showInformationMessage(`Nothing was applied: ${RECIPE_COCKPIT_ADAPTER_APPLY_NOTHING_REASON}`);
            return;
        }

        const toRelativePath = (filePath: string) => path.relative(path.resolve(workspaceRoot), filePath).split(path.sep).join('/');
        const overwrites = fieldFileCopies.filter(fieldFileCopy => fieldFileCopy.status === 'changed');
        const additions = fieldFileCopies.filter(fieldFileCopy => fieldFileCopy.status === 'new');
        const chosenLabel = await hub.confirmInPanel(
            `Apply ${fieldFileCopies.length === 1 ? '1 field file' : `${fieldFileCopies.length} field files`} retrieved from ${changesMessage.orgLabel} to this project?`,
            {
                summary: [`${[
                    ...( overwrites.length > 0 ? [`${overwrites.length} overwritten with the org's version`] : [] ),
                    ...( additions.length > 0 ? [`${additions.length} added`] : [] )
                ].join(', ')}.`, 'Nothing is deployed, and the recipe changes only when Generate Treecipe runs.'],
                ...( overwrites.length > 0 ? { warnings: ['A project file overwritten here is not kept anywhere else: commit or stash it first if you need it.'] } : {} ),
                sections: [
                    { title: 'Overwritten with the org\'s version', count: overwrites.length, lines: overwrites.length > 0 ? [RecipeCockpitMetadataDeploy.describeCappedList(overwrites.map(fieldFileCopy => toRelativePath(fieldFileCopy.targetFilePath)))] : [] },
                    { title: 'Added', count: additions.length, lines: additions.length > 0 ? [RecipeCockpitMetadataDeploy.describeCappedList(additions.map(fieldFileCopy => toRelativePath(fieldFileCopy.targetFilePath)))] : [] }
                ],
                isDestructive: true
            },
            RECIPE_COCKPIT_ADAPTER_APPLY_CONFIRM_LABEL
        );

        if ( chosenLabel !== RECIPE_COCKPIT_ADAPTER_APPLY_CONFIRM_LABEL || !isClickStillCurrent() ) {
            return;
        }

        if ( hub.isApplyHeldByAnotherRun(panelState) ) {
            warn(RECIPE_COCKPIT_ADAPTER_APPLY_BUSY_REFUSAL);
            return;
        }

        const confirmedPlan = describePlan(fieldFileCopies);
        const currentCopies = await planCopies();
        if ( describePlan(currentCopies) !== confirmedPlan || !isClickStillCurrent() ) {
            warn('Nothing was applied: the project or the retrieved files changed while the confirmation was open. Apply again to see what it would write now.');
            return;
        }

        const copyResult = RecipeCockpitOrgChangeDetection.copyFieldFiles(workspaceRoot, currentCopies);

        // THE MARKS ARE READ AGAIN FROM THE FILES; THE HINTS AND CHILD OBJECTS ARE THE ORG'S AND STAY AS THE RETRIEVE READ THEM
        const remarkedChanges = await RecipeCockpitOrgChangeDetection.detectFieldChangesWithNewFields(workspaceRoot, packageDirectoryPaths, stagingFolderPath, objectApiNames);
        const remarkedTree = panelState.recipeDataMessage?.renderSequence === changesMessage.renderSequence
            ? panelState.recipeDataMessage.recipe.trees.find(recipeTree => recipeTree.treeKey === changesMessage.treeKey)
            : undefined;
        if ( isClickStillCurrent() && remarkedTree && panelState.recipeDataMessage ) {
            // A FIELD APPLIED HAS A PROJECT FILE NOW, SO IT IS NO LONGER OFFERED AS ONLY THE ORG'S (#446) UNTIL GENERATE TREECIPE LISTS IT
            const remarkedOffer = this.offerAdapterOrgOnlyFields(hub, panelState.recipeDataMessage.recipe, remarkedTree, remarkedChanges.objectChanges, remarkedChanges.newFields, hub.readTreeFakerService(panelState, changesMessage.treeKey));
            const remarkedObjects = remarkedOffer.objects;
            const previousObjectsByName = new Map(changesMessage.objects.map(objectChanges => [objectChanges.objectApiName, objectChanges] as const));
            const updatedChangesMessage: IRecipeCockpitAdapterMetadataChangesMessage = {
                ...changesMessage,
                objects: remarkedObjects.map(objectChanges => {
                    const previousObject = previousObjectsByName.get(objectChanges.objectApiName);
                    return previousObject?.newChildObjects
                        ? { ...objectChanges, newChildObjects: previousObject.newChildObjects, moreNewChildObjectCount: previousObject.moreNewChildObjectCount }
                        : objectChanges;
                })
            };
            panelState.adapterMetadataChangesMessage = updatedChangesMessage;
            panelState.adapterOrgOnlyFields = remarkedOffer.orgOnlyFields;
            hub.postToPanel(cockpitPanel, updatedChangesMessage);
        }

        const copiedText = `Applied ${copyResult.copiedCount === 1 ? '1 field file' : `${copyResult.copiedCount} field files`} retrieved from ${changesMessage.orgLabel} to this project.`;
        const failureText = copyResult.failures.length > 0
            ? ` ${copyResult.failures.length === 1 ? '1 file was' : `${copyResult.failures.length} files were`} not written: ${copyResult.failures.join('; ')}.`
            : '';
        const nextText = copyResult.copiedCount > 0 ? ' Run Generate Treecipe to write them into the recipe. Nothing was deployed.' : ' Nothing was deployed.';

        hub.showMetadataRetrieveNotification(copyResult.failures.length > 0 ? 'warning' : 'information', `${copiedText}${failureText}${nextText}`, undefined, workspaceRoot, copyResult.copiedCount > 0);

    }

    private static showAdapterRetrieveNotification(hub: IRecipeCockpitHubForAdapterTab, objectChanges: readonly IOrgObjectChanges[],
                                                   treeTitle: string,
                                                   orgLabel: string,
                                                   retrieveOutputFilePath: string | undefined,
                                                   workspaceRoot: string) {

        const plural = (count: number, singular: string, many: string) => `${count} ${count === 1 ? singular : many}`;
        const retrievedCount = objectChanges.filter(objectChange => objectChange.isRetrieved).length;
        const notRetrieved = objectChanges.filter(objectChange => !objectChange.isRetrieved).map(objectChange => objectChange.objectApiName);
        const newCount = objectChanges.reduce((total, objectChange) => total + objectChange.fieldChanges.filter(fieldChange => fieldChange.status === 'new').length, 0);
        const changedCount = objectChanges.reduce((total, objectChange) => total + objectChange.fieldChanges.filter(fieldChange => fieldChange.status === 'changed').length, 0);
        const unreadableCount = objectChanges.reduce((total, objectChange) => total + objectChange.unreadableFieldCount, 0);

        const foundText = newCount + changedCount === 0
            ? 'No field is new or changed against this project.'
            : `${plural(newCount, 'field is', 'fields are')} new and ${plural(changedCount, 'field', 'fields')} changed in the org against this project; the Treecipe Adapter tab marks them.`;
        const notRetrievedText = notRetrieved.length > 0 ? ` ${orgLabel} did not return ${notRetrieved.join(', ')}.` : '';
        const unreadableText = unreadableCount > 0 ? ` ${plural(unreadableCount, 'field file', 'field files')} could not be read, so ${unreadableCount === 1 ? 'it was' : 'they were'} not compared.` : '';
        const notificationText = `Retrieved the latest metadata of ${plural(retrievedCount, 'object', 'objects')} of ${treeTitle} from ${orgLabel}. ${foundText}${notRetrievedText}${unreadableText} Nothing in the project changed.`;

        hub.showMetadataRetrieveNotification(notRetrievedText || unreadableText ? 'warning' : 'information', notificationText,
            notRetrievedText || unreadableText ? retrieveOutputFilePath : undefined, workspaceRoot, false);

    }

}
