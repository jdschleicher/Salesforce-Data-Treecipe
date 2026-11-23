import * as path from 'path';
import * as vscode from 'vscode';
import type { Connection } from '@salesforce/core';
import { ConfigurationService } from '../ConfigurationService/ConfigurationService';
import { RecipeYamlScalar } from '../RecipeYamlScalar/RecipeYamlScalar';
import {
    IAuthenticatedOrgDetail,
    ISalesforceCliInvocationResult,
    SalesforceCli
} from '../SalesforceCli/SalesforceCli';
import { SalesforceOrgService } from '../SalesforceOrgService/SalesforceOrgService';
import {
    SCRATCH_ORG_DEPLOY_MAX_BUFFER_BYTES,
    ScratchOrgService
} from '../ScratchOrgService/ScratchOrgService';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';
import { VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';
import {
    IMetadataDeployComponent,
    RecipeCockpitMetadataDeploy
} from './RecipeCockpitMetadataDeploy';
import { RecipeCockpitMetadataDeployPackage } from './RecipeCockpitMetadataDeployPackage';
import { METADATA_RETRIEVE_TIMEOUT_MILLISECONDS } from './RecipeCockpitMetadataRetrieve';
import {
    IMetadataRetrieveConnection,
    METADATA_RETRIEVE_METHOD_SETTING,
    MetadataRetrieveDestination,
    RecipeCockpitMetadataRetrievePackage
} from './RecipeCockpitMetadataRetrievePackage';
import { PERMISSION_SET_MAX_BUFFER_BYTES } from './RecipeCockpitPermissionSetAssign';
import type { RecipeCockpitService } from './RecipeCockpitService';
import {
    IRecipeCockpitHubForTreecipeDataOrgs,
    RecipeCockpitTreecipeDataOrgs
} from './RecipeCockpitTreecipeDataOrgs';
import type {
    IRecipeCockpitDataOrgSelection,
    IRecipeCockpitPanelCancellation,
    IRecipeCockpitPanelState
} from './RecipeCockpitViewModel';

// WHAT resolveSelectedReadOrg READS OF THE HUB: THE PANEL IT WAS CLICKED IN, THE SELECTION'S HOLDERS, AND WHAT THE ORG PROMPT READS
export type IRecipeCockpitHubForOrgRuns = Readonly<Pick<typeof RecipeCockpitService,
    'isSelectionHeldByPromptOrUpdater' |
    'recipeCockpitPanel' |
    'recipeCockpitPanelState'>> & IRecipeCockpitHubForTreecipeDataOrgs;

export class RecipeCockpitOrgRuns {

    /*
        The org an action that only READS runs against (a query, #439; a retrieve, #480): the Target
        Org Manager selection as it is at the click, of any type, unless no connection could be
        opened to it. With none it asks once over the dropdown's own listing, holding the selection
        under the flag named while it asks, and the pick becomes the selection.
    */
    static async resolveSelectedReadOrg(hub: IRecipeCockpitHubForOrgRuns, cockpitPanel: vscode.WebviewPanel,
                                                    panelState: IRecipeCockpitPanelState,
                                                    refusalPrefix: string,
                                                    placeholder: string,
                                                    busyRefusal: string,
                                                    connectionFailedAdvice: string,
                                                    promptFlag: 'isQueryOrgPromptOpen' | 'isOrgPromptOpen'): Promise<IAuthenticatedOrgDetail | undefined> {

        const usableSelectedOrg = (dataOrgSelection: IRecipeCockpitDataOrgSelection) => {
            if ( dataOrgSelection.isConnectionFailed ) {
                VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(`${refusalPrefix}: ${RecipeCockpitTreecipeDataOrgs.buildDataOrgLabel(dataOrgSelection.orgDetail)} could not be connected to. ${connectionFailedAdvice}`));
                return undefined;
            }
            return dataOrgSelection.orgDetail;
        };

        if ( panelState.dataOrgSelection ) {
            return usableSelectedOrg(panelState.dataOrgSelection);
        }

        const clickedRecipeDataMessage = panelState.recipeDataMessage;

        if ( !clickedRecipeDataMessage ) {
            return undefined;
        }

        if ( panelState.insertStateMessage
                || hub.isSelectionHeldByPromptOrUpdater(panelState)
                || panelState.scratchOrgStateMessage?.isRunning
                || panelState.permissionSetAssignStateMessage?.isRunning
                || panelState.metadataDeployStateMessage?.isRunning ) {
            VSCodeWorkspaceService.showWarningMessage(busyRefusal);
            return undefined;
        }

        const isClickStillCurrent = () => hub.recipeCockpitPanel === cockpitPanel
                                            && hub.recipeCockpitPanelState === panelState
                                            && panelState.recipeDataMessage === clickedRecipeDataMessage;

        let isOrgSelected = false;
        panelState[promptFlag] = true;
        try {
            isOrgSelected = await RecipeCockpitTreecipeDataOrgs.promptAndSelectDataOrg(hub, cockpitPanel, panelState, clickedRecipeDataMessage, isClickStillCurrent,
                placeholder, refusalPrefix);
        } finally {
            panelState[promptFlag] = false;
        }

        return isOrgSelected && panelState.dataOrgSelection ? panelState.dataOrgSelection.orgDetail : undefined;

    }

    // sfdx-project.json's sourceApiVersion, ONLY IN THE SHAPE A package.xml TAKES; THE CLI CHOOSES WHEN THERE IS NONE
    static readSourceApiVersion(workspaceRoot: string): string | undefined {

        try {
            return RecipeCockpitMetadataDeploy.readApiVersion(SfdxProjectService.readSfdxProjectJson(SfdxProjectService.getSfdxProjectFilePath(workspaceRoot)).sourceApiVersion);
        } catch {
            return undefined;
        }

    }

    static describeThrown(thrownValue: unknown): string {

        return String(( thrownValue as Error | undefined )?.message ?? thrownValue);

    }

    /*
        A retrieve, the CLI's or jsforce's as the metadataRetrieveMethod setting says (#506), behind a
        cancellable progress. Both answer in the CLI's --json shape, so what reads a retrieve reads
        either. jsforce writes nothing until the org's zip is read, so a cancel or a timeout before then
        writes nothing at all (isNothingWritten); the CLI's cancel kills its process, whatever it wrote.
    */
    static async runCancellableRetrieve(progressTitle: string,
                                                cliArguments: string[],
                                                workspaceRoot: string,
                                                jsforceRetrieve: { orgUsername: string; components: IMetadataDeployComponent[]; destination: MetadataRetrieveDestination },
                                                panelCancellation?: IRecipeCockpitPanelCancellation): Promise<{ invocation: ISalesforceCliInvocationResult; isCancelled: boolean; isNothingWritten?: boolean; payload: Record<string, unknown> | undefined }> {

        if ( RecipeCockpitMetadataRetrievePackage.readRetrieveMethod(ConfigurationService.getExtensionConfigValue(METADATA_RETRIEVE_METHOD_SETTING)) === 'cli' ) {
            const cliRun = await this.runCancellableCli(progressTitle, cliArguments, METADATA_RETRIEVE_TIMEOUT_MILLISECONDS, workspaceRoot, SCRATCH_ORG_DEPLOY_MAX_BUFFER_BYTES, panelCancellation);
            return { ...cliRun, payload: ScratchOrgService.readCliJsonPayload(cliRun.invocation) };
        }

        const answered = (payload: Record<string, unknown>) => ({ invocation: { stdout: '', stderr: '', exitCode: payload.status === 0 ? 0 : 1 }, isCancelled: false, payload: payload });
        const cancelled = { invocation: { stdout: '', stderr: '', exitCode: null }, isCancelled: true, isNothingWritten: true, payload: undefined };

        return await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: progressTitle,
            cancellable: true
        }, async (_progress, cancellationToken) => {

            const isCancellationRequested = () => cancellationToken.isCancellationRequested || panelCancellation?.isRequested === true;

            let retrieveConnection: Connection;
            try {
                retrieveConnection = await SalesforceOrgService.getConnection(jsforceRetrieve.orgUsername);
            } catch (connectionError) {
                return answered({ status: 1, name: 'ConnectionError', message: `could not connect to the org: ${RecipeCockpitMetadataDeployPackage.describeError(connectionError)}` });
            }

            let retrieveRequest: Record<string, unknown>;
            try {
                retrieveRequest = RecipeCockpitMetadataRetrievePackage.buildRetrieveRequest(jsforceRetrieve.components, this.readSourceApiVersion(workspaceRoot) ?? retrieveConnection.getApiVersion());
            } catch (requestError) {
                return answered({ status: 1, message: this.describeThrown(requestError) });
            }

            const metadataConnection: IMetadataRetrieveConnection = {
                metadata: {
                    retrieve: request => retrieveConnection.metadata.retrieve(request),
                    checkRetrieveStatus: asyncProcessId => retrieveConnection.metadata.checkRetrieveStatus(asyncProcessId)
                }
            };
            const retrieveRun = await RecipeCockpitMetadataRetrievePackage.runRetrieve(metadataConnection, retrieveRequest, { isCancellationRequested: isCancellationRequested, timeoutMilliseconds: METADATA_RETRIEVE_TIMEOUT_MILLISECONDS });

            if ( retrieveRun.kind === 'cancelled' ) {
                return cancelled;
            }
            if ( retrieveRun.kind === 'timedOut' ) {
                return { invocation: { stdout: '', stderr: '', exitCode: null, timedOut: true }, isCancelled: false, isNothingWritten: true, payload: undefined };
            }
            if ( retrieveRun.kind === 'failed' ) {
                return answered({ status: 1, message: retrieveRun.failureMessage, ...( retrieveRun.retrieveId ? { retrieveId: retrieveRun.retrieveId } : {} ) });
            }

            const { retrieveId, result } = retrieveRun;
            if ( result.success !== true && result.success !== 'true' ) {
                return answered(RecipeCockpitMetadataRetrievePackage.toCliShapedPayload(retrieveId, result, [], jsforceRetrieve.components));
            }

            try {
                const zipBuffer = RecipeCockpitMetadataRetrievePackage.readZipFile(result);
                if ( !zipBuffer ) {
                    throw new Error('The org answered the retrieve with no zip, so nothing was written.');
                }
                const sourceFiles = await RecipeCockpitMetadataRetrievePackage.convertToSourceFiles(RecipeCockpitMetadataRetrievePackage.readZip(zipBuffer), jsforceRetrieve.components, isCancellationRequested);
                // THE LAST POINT A CANCEL WRITES NOTHING: ONCE WRITING STARTS, EVERY FILE IS WRITTEN
                if ( !sourceFiles || isCancellationRequested() ) {
                    return cancelled;
                }
                const fileResponses = await RecipeCockpitMetadataRetrievePackage.writeSourceFiles(workspaceRoot, jsforceRetrieve.destination, sourceFiles);
                return answered(RecipeCockpitMetadataRetrievePackage.toCliShapedPayload(retrieveId, result, fileResponses, jsforceRetrieve.components));
            } catch (convertError) {
                return answered({ status: 1, message: this.describeThrown(convertError), retrieveId: retrieveId });
            }

        });

    }

    // ONE CLI RUN IN PROJECT MODE BEHIND A CANCELLABLE PROGRESS NOTIFICATION; A CANCEL KILLS THE PROCESS TREE
    static async runCancellableCli(progressTitle: string,
                                            cliArguments: string[],
                                            timeoutMilliseconds: number,
                                            workspaceRoot: string,
                                            maxBufferBytes: number = PERMISSION_SET_MAX_BUFFER_BYTES,
                                            panelCancellation?: IRecipeCockpitPanelCancellation): Promise<{ invocation: ISalesforceCliInvocationResult; isCancelled: boolean }> {

        let isCancelled = false;

        const invocation = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: progressTitle,
            cancellable: true
        }, async (_progress, cancellationToken) => {

            let killCurrentProcess: (() => void) | undefined;
            const cancel = () => {
                isCancelled = true;
                killCurrentProcess?.();
            };
            cancellationToken.onCancellationRequested(cancel);
            if ( panelCancellation ) {
                panelCancellation.onRequested = cancel;
            }

            return await SalesforceCli.runSalesforceCli(
                cliArguments,
                (killChildProcess: () => void) => {
                    killCurrentProcess = killChildProcess;
                    if ( cancellationToken.isCancellationRequested || panelCancellation?.isRequested ) {
                        isCancelled = true;
                        killChildProcess();
                    }
                },
                timeoutMilliseconds,
                { workingDirectoryPath: path.resolve(workspaceRoot), maxBufferBytes: maxBufferBytes }
            );

        });

        return { invocation: invocation, isCancelled: isCancelled };

    }

}
