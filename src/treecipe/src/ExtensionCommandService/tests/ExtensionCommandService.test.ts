import * as fs from 'fs';

import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as vscode from 'vscode';

jest.mock('vscode', () => ({
    workspace: {
        workspaceFolders: undefined,
        getConfiguration: jest.fn().mockReturnValue({ get: jest.fn(), update: jest.fn() }),
        fs: { readDirectory: jest.fn(), readFile: jest.fn() }
    },
    Uri: {
        file: (filePath: string) => ({ fsPath: filePath }),
        joinPath: jest.fn()
    },
    window: {
        showWarningMessage: jest.fn(),
        showInformationMessage: jest.fn(),
        showQuickPick: jest.fn(),
        showTextDocument: jest.fn(),
        createOutputChannel: jest.fn(),
        /*
            Runs the task immediately with a never-cancelled token, so the tests exercise the real
            body of the progress callback rather than a stub standing in for it.
        */
        withProgress: jest.fn().mockImplementation((_progressOptions, task) => task(
            { report: jest.fn() },
            { isCancellationRequested: false, onCancellationRequested: jest.fn() }
        )),
        createWebviewPanel: jest.fn()
    },
    commands: { registerCommand: jest.fn(), executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    ProgressLocation: { Notification: 15, Window: 10, SourceControl: 1 },
    ConfigurationTarget: { Workspace: 2 },
    FileType: { Directory: 2, File: 1, SymbolicLink: 64 }
}), { virtual: true });

jest.mock('@salesforce/core', () => ({
    AuthInfo: { listAllAuthorizations: jest.fn() },
    Org: { create: jest.fn() }
}));

import { AuthInfo } from '@salesforce/core';

import { ExtensionCommandService, RUN_AGAINST_ORG_ACTION_LABEL, PICKLIST_DEPENDENCY_EXPLORER_VIEW_TYPE } from "../ExtensionCommandService";
import { ConfigurationService } from "../../ConfigurationService/ConfigurationService";
import { ErrorHandlingService } from "../../ErrorHandlingService/ErrorHandlingService";
import { PicklistDependencyTestService, IPicklistDependencySpecDetail } from "../../PicklistDependencyTestService/PicklistDependencyTestService";
import { PicklistDependencyCheckService } from "../../PicklistDependencyCheckService/PicklistDependencyCheckService";
import { VSCodeWorkspaceService } from "../../VSCodeWorkspace/VSCodeWorkspaceService";
import { PicklistDependencyExplorerService } from "../../PicklistDependencyExplorerService/PicklistDependencyExplorerService";

describe('ExtensionCommandService', () => {

    describe('generatePicklistDependencyTests', () => {

        const extensionPath = '/extension';
        const workspaceRoot = '/workspace';
        const classesDirectoryPath = '/workspace/force-app/main/default/classes';
        const specsClassFilePath = `${classesDirectoryPath}/SDTPLDSpecs.cls`;
        const perObjectSpecsClassFilePath = `${classesDirectoryPath}/SDTPLDSpecs_Dependency_Example_c.cls`;

        const specDetail: IPicklistDependencySpecDetail = {
            objectApiName: 'Dependency_Example__c',
            fieldApiName: 'Neighborhood__c',
            controllingFieldApiName: 'City__c',
            expectations: [{ controllingValue: 'cle', dependentValues: ['ohiocity'] }]
        };

        const specsTestClassFilePath = `${classesDirectoryPath}/SDTPLDSpecsTest.cls`;

        let extensionCommandService: ExtensionCommandService;
        let writeSpecsClassFilesSpy: jest.SpyInstance;
        let writeSpecsTestClassFilesSpy: jest.SpyInstance;
        let handleCapturedErrorSpy: jest.SpyInstance;

        function stubCollectionResult(specDetails: IPicklistDependencySpecDetail[], skippedFieldWarnings: string[] = []) {
            jest.spyOn(PicklistDependencyTestService, 'collectSpecDetailsByObjectsDirectory')
                .mockResolvedValue({ specDetails, skippedFieldWarnings });
        }

        beforeEach(() => {

            /*
                The jest.fn instances inside the vscode module factory are created once for the
                module, so restoreMocks does not clear them -- without this, calls and queued
                resolved values leak from one test into the next. clearAllMocks covers every mock
                in the factory rather than only the two this suite currently asserts on.
            */
            jest.clearAllMocks();

            extensionCommandService = new ExtensionCommandService();

            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue(workspaceRoot);
            jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);
            jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);
            jest.spyOn(ConfigurationService, 'getObjectsPathFromTreecipeJSONConfiguration').mockReturnValue('./force-app/main/default/objects');

            jest.spyOn(PicklistDependencyTestService, 'resolveDefaultPackageDirectoryPath').mockReturnValue('/workspace/force-app');
            jest.spyOn(PicklistDependencyTestService, 'getClassesDirectoryPath').mockReturnValue(classesDirectoryPath);
            jest.spyOn(PicklistDependencyTestService, 'getSpecsClassFilePath').mockReturnValue(specsClassFilePath);
            jest.spyOn(PicklistDependencyTestService, 'getSpecsTestClassFilePath').mockReturnValue(specsTestClassFilePath);
            jest.spyOn(PicklistDependencyTestService, 'getSourceApiVersion').mockReturnValue('64.0');
            jest.spyOn(PicklistDependencyTestService, 'scaffoldMissingFrameworkClasses')
                .mockReturnValue({ scaffoldedClassNames: [], unavailableClassNames: [] });

            writeSpecsClassFilesSpy = jest.spyOn(PicklistDependencyTestService, 'writeSpecsClassFiles').mockReturnValue({
                aggregatorClassFilePath: specsClassFilePath,
                perObjectClassFilePathsByObjectApiName: { 'Dependency_Example__c': perObjectSpecsClassFilePath },
                removedStaleClassFilePaths: []
            });
            jest.spyOn(PicklistDependencyTestService, 'detectLegacyGeneratedArtifacts').mockReturnValue([]);
            writeSpecsTestClassFilesSpy = jest.spyOn(PicklistDependencyTestService, 'writeSpecsTestClassFiles').mockReturnValue(specsTestClassFilePath);
            handleCapturedErrorSpy = jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);

            // THE OBJECTS DIRECTORY EXISTS AND NOTHING HAS BEEN GENERATED YET UNLESS A TEST SAYS OTHERWISE
            jest.spyOn(fs, 'existsSync').mockImplementation((checkedPath: any) => {
                return String(checkedPath).includes('objects');
            });

            /*
                Generation now OFFERS to run against an org. Declining is the default here so the
                existing generation assertions stay about generation, and the tests that care about
                the continuation opt into it explicitly.
            */
            (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([
                { username: 'dev@example.com', aliases: ['devHub'] }
            ]);

        });

        test('given dependent picklists found, writes the specs class and reports the destination', async () => {

            stubCollectionResult([specDetail]);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            /*
                The collected spec details are handed to the writer, which owns turning them into one
                class per object. Asserting on the details rather than on emitted markup keeps this
                test about the command's wiring; the emitted Apex is asserted where it is built.
            */
            expect(writeSpecsClassFilesSpy).toHaveBeenCalledWith(
                classesDirectoryPath,
                [specDetail],
                '64.0'
            );
            expect(handleCapturedErrorSpy).not.toHaveBeenCalled();

            const informationMessage = (vscode.window.showInformationMessage as jest.Mock).mock.calls[0][0];
            expect(informationMessage).toContain('1 picklist dependency spec(s)');
            expect(informationMessage).toContain('1 per-object class(es)');
            expect(informationMessage).toContain(classesDirectoryPath);

        });

        test('given a workspace carrying classes from an earlier version, warns naming what to delete', async () => {

            stubCollectionResult([specDetail]);

            const legacyFrameworkDirectoryPath = `${classesDirectoryPath}/PicklistDependencyFramework`;
            jest.spyOn(PicklistDependencyTestService, 'detectLegacyGeneratedArtifacts').mockReturnValue([legacyFrameworkDirectoryPath]);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            const warningMessages = (VSCodeWorkspaceService.showWarningMessage as jest.Mock).mock.calls.map(warningCall => String(warningCall[0]));
            const legacyWarning = warningMessages.find(warningMessage => warningMessage.includes(legacyFrameworkDirectoryPath));

            expect(legacyWarning).toBeDefined();
            expect(legacyWarning).toContain('SFTreecipePicklistDependencySpecs');
            expect(handleCapturedErrorSpy).not.toHaveBeenCalled();

        });

        test('given no legacy classes, does not warn about them', async () => {

            stubCollectionResult([specDetail]);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            const warningMessages = (VSCodeWorkspaceService.showWarningMessage as jest.Mock).mock.calls.map(warningCall => String(warningCall[0]));

            expect(warningMessages.some(warningMessage => warningMessage.includes('earlier Treecipe version'))).toBeFalse();

        });

        test('given stale per-object classes removed, names them in the generation summary', async () => {

            stubCollectionResult([specDetail]);

            jest.spyOn(PicklistDependencyTestService, 'writeSpecsClassFiles').mockReturnValue({
                aggregatorClassFilePath: specsClassFilePath,
                perObjectClassFilePathsByObjectApiName: { 'Dependency_Example__c': perObjectSpecsClassFilePath },
                removedStaleClassFilePaths: [`${classesDirectoryPath}/SDTPLDSpecs_Retired_Object_c.cls`]
            });

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            const informationMessage = (vscode.window.showInformationMessage as jest.Mock).mock.calls[0][0];

            expect(informationMessage).toContain('SDTPLDSpecs_Retired_Object_c.cls');
            expect(informationMessage).toContain('no longer declaring a dependent picklist');

        });

        test('given dependent picklists found, also writes the IsTest class that asserts the specs', async () => {

            stubCollectionResult([specDetail]);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            expect(writeSpecsTestClassFilesSpy).toHaveBeenCalledWith(
                classesDirectoryPath,
                expect.stringContaining('@IsTest'),
                '64.0'
            );

            const emittedTestClassBody = writeSpecsTestClassFilesSpy.mock.calls[0][1];
            expect(emittedTestClassBody).toContain('private class SDTPLDSpecsTest {');
            expect(emittedTestClassBody).toContain('static void Dependency_Example_c_picklistDependenciesMatchSourceMetadata()');
            expect(emittedTestClassBody).toContain('static void specRegistryIsNotEmpty()');

            expect((vscode.window.showInformationMessage as jest.Mock).mock.calls[0][0]).toContain('SDTPLDSpecsTest.cls');

        });

        test('after generating, offers to deploy and run against an org', async () => {

            stubCollectionResult([specDetail]);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            const offerCall = (vscode.window.showInformationMessage as jest.Mock).mock.calls[0];
            expect(offerCall[0]).toContain('Deploy and run them against an org now?');
            expect(offerCall[1]).toBe(RUN_AGAINST_ORG_ACTION_LABEL);

        });

        test('given the offer is dismissed, generation still stands and nothing is deployed', async () => {

            stubCollectionResult([specDetail]);
            const deploySpy = jest.spyOn(PicklistDependencyCheckService, 'deployPicklistDependencyClasses');
            const runSpy = jest.spyOn(PicklistDependencyCheckService, 'runPicklistDependencyTests');

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            expect(writeSpecsClassFilesSpy).toHaveBeenCalled();
            expect(deploySpy).not.toHaveBeenCalled();
            expect(runSpy).not.toHaveBeenCalled();
            expect(handleCapturedErrorSpy).not.toHaveBeenCalled();

        });

        test('given the offer is accepted, deploys and runs without asking whether the class is already there', async () => {

            stubCollectionResult([specDetail]);
            (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(RUN_AGAINST_ORG_ACTION_LABEL);
            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue('Deploy and Run');

            jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedTargetOrg').mockResolvedValue('devHub');
            jest.spyOn(VSCodeWorkspaceService, 'showPicklistDependencyCheckReport').mockImplementation(() => undefined);
            jest.spyOn(PicklistDependencyCheckService, 'writeCheckResultArtifacts').mockReturnValue('/workspace/treecipe/PicklistDependencyResults/check-devHub-x');

            const isDeployedSpy = jest.spyOn(PicklistDependencyCheckService, 'isSpecsTestClassDeployedInOrg');

            // GENERATION JUST WROTE THESE CLASSES, SO THEY ARE ON DISK BY DEFINITION
            jest.spyOn(PicklistDependencyCheckService, 'assertDeployableClassesExist')
                .mockReturnValue([`${classesDirectoryPath}/SDTPLDSpecsTest.cls`]);

            const deploySpy = jest.spyOn(PicklistDependencyCheckService, 'deployPicklistDependencyClasses')
                .mockResolvedValue('Deployed 8 component(s) to the target org.');
            const runSpy = jest.spyOn(PicklistDependencyCheckService, 'runPicklistDependencyTests')
                .mockResolvedValue({ passed: true, failureCount: 0, methodOutcomes: [{ methodName: 'specRegistryIsNotEmpty', passed: true }] });

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            expect(deploySpy).toHaveBeenCalledWith(classesDirectoryPath, 'devHub', expect.any(Function));
            expect(runSpy).toHaveBeenCalledWith('devHub', expect.any(Function));

            /*
                The classes were just rewritten, so the org copy is stale by definition -- checking
                whether the test class is "already deployed" would run yesterday's contract.
            */
            expect(isDeployedSpy).not.toHaveBeenCalled();

        });

        test('given the offer is accepted but no org is picked, deploys nothing', async () => {

            stubCollectionResult([specDetail]);
            (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(RUN_AGAINST_ORG_ACTION_LABEL);
            jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedTargetOrg').mockResolvedValue(undefined);

            const deploySpy = jest.spyOn(PicklistDependencyCheckService, 'deployPicklistDependencyClasses');

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            expect(writeSpecsClassFilesSpy).toHaveBeenCalled();
            expect(deploySpy).not.toHaveBeenCalled();

        });

        test('given zero dependent picklists, writes neither the specs class nor the test class', async () => {

            stubCollectionResult([]);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            expect(writeSpecsClassFilesSpy).not.toHaveBeenCalled();
            expect(writeSpecsTestClassFilesSpy).not.toHaveBeenCalled();

        });

        test('given zero dependent picklists, shows an informational message and writes nothing', async () => {

            stubCollectionResult([]);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            expect(writeSpecsClassFilesSpy).not.toHaveBeenCalled();
            expect((vscode.window.showInformationMessage as jest.Mock).mock.calls[0][0]).toContain('No dependent picklists were found');

        });

        test('given a missing objects directory, reports an actionable error and writes nothing', async () => {

            stubCollectionResult([specDetail]);
            jest.spyOn(fs, 'existsSync').mockReturnValue(false);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            expect(writeSpecsClassFilesSpy).not.toHaveBeenCalled();
            expect(handleCapturedErrorSpy).toHaveBeenCalled();

            const capturedError = handleCapturedErrorSpy.mock.calls[0][0];
            expect(capturedError.message).toContain('No objects directory found');
            expect(handleCapturedErrorSpy.mock.calls[0][1]).toBe('generatePicklistDependencyTests');

        });

        test('given an existing specs class and a declined overwrite prompt, writes nothing', async () => {

            stubCollectionResult([specDetail]);
            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
                expect.stringContaining('already exist'),
                { modal: true },
                'Overwrite'
            );
            expect(writeSpecsClassFilesSpy).not.toHaveBeenCalled();

        });

        test('given an existing specs class and a confirmed overwrite, writes the file', async () => {

            stubCollectionResult([specDetail]);
            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue('Overwrite');

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            expect(writeSpecsClassFilesSpy).toHaveBeenCalled();

        });

        test('given framework classes that could not be supplied, warns that the generated class will not compile', async () => {

            stubCollectionResult([specDetail]);
            jest.spyOn(PicklistDependencyTestService, 'scaffoldMissingFrameworkClasses')
                .mockReturnValue({ scaffoldedClassNames: [], unavailableClassNames: ['SDTPicklistDependencySpec', 'SDTPicklistDependencyValidator'] });

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            const warningMessages = (VSCodeWorkspaceService.showWarningMessage as jest.Mock).mock.calls.map(call => call[0]);
            const unavailableWarning = warningMessages.find(message => message.includes('will not compile'));

            expect(unavailableWarning).toBeDefined();
            expect(unavailableWarning).toContain('PicklistDependencySpec');

        });

        test('given scaffolded framework classes, names them in the success message', async () => {

            stubCollectionResult([specDetail]);
            jest.spyOn(PicklistDependencyTestService, 'scaffoldMissingFrameworkClasses')
                .mockReturnValue({ scaffoldedClassNames: ['PicklistDependencySpec'], unavailableClassNames: [] });

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            expect((vscode.window.showInformationMessage as jest.Mock).mock.calls[0][0]).toContain('Also scaffolded');

        });

        /*
            A managed package declaring dependent picklists without valueSettings can produce many
            skips, and VS Code shows notifications one at a time.
        */
        test('given more skipped fields than the notification cap, shows three then one aggregate', async () => {

            const skippedFieldWarnings = Array.from({ length: 10 }, (unusedValue, index) => `skipped field ${index}`);
            stubCollectionResult([specDetail], skippedFieldWarnings);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            const warningMessages = (VSCodeWorkspaceService.showWarningMessage as jest.Mock).mock.calls.map(call => call[0]);

            expect(warningMessages).toHaveLength(4);
            expect(warningMessages.slice(0, 3)).toEqual(['skipped field 0', 'skipped field 1', 'skipped field 2']);
            expect(warningMessages[3]).toContain('7 more dependent picklist field(s) were skipped');

        });

        test('given fewer skipped fields than the cap, shows each one and no aggregate', async () => {

            stubCollectionResult([specDetail], ['only skipped field']);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            const warningMessages = (VSCodeWorkspaceService.showWarningMessage as jest.Mock).mock.calls.map(call => call[0]);

            expect(warningMessages).toEqual(['only skipped field']);

        });

        test('given no workspace, reports the error rather than throwing out of the command', async () => {

            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue(undefined);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            expect(handleCapturedErrorSpy).toHaveBeenCalled();
            expect(writeSpecsClassFilesSpy).not.toHaveBeenCalled();

        });

        test('given package directory resolution failure, routes the actionable error and writes nothing', async () => {

            stubCollectionResult([specDetail]);
            jest.spyOn(PicklistDependencyTestService, 'resolveDefaultPackageDirectoryPath').mockImplementation(() => {
                throw new Error('No "sfdx-project.json" found at "/workspace/sfdx-project.json".');
            });

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            expect(writeSpecsClassFilesSpy).not.toHaveBeenCalled();
            expect(handleCapturedErrorSpy.mock.calls[0][0].message).toContain('sfdx-project.json');

        });

    });

    describe('initiateTreecipeConfigurationSetup', () => {

        test('given a successful setup, delegates to ConfigurationService and reports no error', async () => {

            const createConfigurationFileSpy = jest.spyOn(ConfigurationService, 'createTreecipeJSONConfigurationFile').mockResolvedValue(undefined);
            const handleCapturedErrorSpy = jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);

            await new ExtensionCommandService().initiateTreecipeConfigurationSetup();

            expect(createConfigurationFileSpy).toHaveBeenCalled();
            expect(handleCapturedErrorSpy).not.toHaveBeenCalled();

        });

        test('given a failure, routes it through ErrorHandlingService under the command name', async () => {

            jest.spyOn(ConfigurationService, 'createTreecipeJSONConfigurationFile').mockRejectedValue(new Error('setup blew up'));
            const handleCapturedErrorSpy = jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);

            await new ExtensionCommandService().initiateTreecipeConfigurationSetup();

            expect(handleCapturedErrorSpy).toHaveBeenCalled();
            expect(handleCapturedErrorSpy.mock.calls[0][1]).toBe('initiateTreecipeConfigurationSetup');

        });

    });

    describe('changeFakerImplementationService', () => {

        test('given a selected faker service, persists it to both the extension config and the treecipe config file', async () => {

            jest.spyOn(VSCodeWorkspaceService, 'promptForFakerServiceImplementation').mockResolvedValue('faker-js');
            const setExtensionConfigValueSpy = jest.spyOn(ConfigurationService, 'setExtensionConfigValue').mockImplementation(() => undefined);
            jest.spyOn(ConfigurationService, 'getTreecipeConfigurationDetail').mockReturnValue({
                salesforceObjectsPath: './force-app/main/default/objects',
                dataFakerService: 'snowfakery'
            });
            const updateTreecipeConfigFileSpy = jest.spyOn(ConfigurationService, 'updateTreecipeConfigFile').mockResolvedValue(undefined);
            const handleCapturedErrorSpy = jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);

            await new ExtensionCommandService().changeFakerImplementationService();

            expect(setExtensionConfigValueSpy).toHaveBeenCalledWith('selectedFakerService', 'faker-js');
            expect(updateTreecipeConfigFileSpy).toHaveBeenCalledWith(
                expect.objectContaining({ dataFakerService: 'faker-js' })
            );
            expect(handleCapturedErrorSpy).not.toHaveBeenCalled();

        });

        test('given a failure reading the treecipe config, routes it through ErrorHandlingService', async () => {

            jest.spyOn(VSCodeWorkspaceService, 'promptForFakerServiceImplementation').mockResolvedValue('faker-js');
            jest.spyOn(ConfigurationService, 'setExtensionConfigValue').mockImplementation(() => undefined);
            jest.spyOn(ConfigurationService, 'getTreecipeConfigurationDetail').mockImplementation(() => {
                throw new Error('missing treecipe configuration setup');
            });
            const handleCapturedErrorSpy = jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);

            await new ExtensionCommandService().changeFakerImplementationService();

            expect(handleCapturedErrorSpy).toHaveBeenCalled();
            expect(handleCapturedErrorSpy.mock.calls[0][1]).toBe('changeFakerImplementationService');

        });

    });

    describe('runPicklistDependencyCheck', () => {

        const workspaceRoot = '/workspace';
        const classesDirectoryPath = '/workspace/force-app/main/default/classes';

        const authenticatedOrgDetail = {
            targetOrgIdentifier: 'devHub',
            username: 'dev@example.com',
            alias: 'devHub'
        };

        const passingCheckOutcome = {
            passed: true,
            failureCount: 0,
            methodOutcomes: [{ methodName: 'specRegistryIsNotEmpty', passed: true }]
        };

        const failingCheckOutcome = {
            passed: false,
            failureCount: 1,
            methodOutcomes: [
                { methodName: 'Account_picklistDependenciesMatchSourceMetadata', passed: false, message: 'drift' }
            ]
        };

        let extensionCommandService: ExtensionCommandService;
        let handleCapturedErrorSpy: jest.SpyInstance;
        let runPicklistDependencyTestsSpy: jest.SpyInstance;
        let deployPicklistDependencyClassesSpy: jest.SpyInstance;
        let showReportSpy: jest.SpyInstance;

        beforeEach(() => {

            jest.clearAllMocks();

            extensionCommandService = new ExtensionCommandService();

            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue(workspaceRoot);
            jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);
            showReportSpy = jest.spyOn(VSCodeWorkspaceService, 'showPicklistDependencyCheckReport').mockImplementation(() => undefined);

            jest.spyOn(PicklistDependencyTestService, 'resolveDefaultPackageDirectoryPath').mockReturnValue('/workspace/force-app');
            jest.spyOn(PicklistDependencyTestService, 'getClassesDirectoryPath').mockReturnValue(classesDirectoryPath);

            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([
                { username: 'dev@example.com', aliases: ['devHub'] }
            ]);

            jest.spyOn(PicklistDependencyCheckService, 'isSpecsTestClassDeployedInOrg').mockResolvedValue(true);

            /*
                These scenarios all assume generation has already run. The deploy path now asserts
                that before building its confirmation, so that a workspace with nothing to send gets
                an actionable error instead of an approval dialog offering zero files.
            */
            jest.spyOn(PicklistDependencyCheckService, 'assertDeployableClassesExist')
                .mockReturnValue([`${classesDirectoryPath}/SDTPLDSpecsTest.cls`]);

            runPicklistDependencyTestsSpy = jest.spyOn(PicklistDependencyCheckService, 'runPicklistDependencyTests')
                .mockResolvedValue(passingCheckOutcome);
            deployPicklistDependencyClassesSpy = jest.spyOn(PicklistDependencyCheckService, 'deployPicklistDependencyClasses')
                .mockResolvedValue('Deployed 8 component(s) to the target org.');

            jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedTargetOrg')
                .mockResolvedValue(authenticatedOrgDetail.targetOrgIdentifier);

            // STUBBED BY DEFAULT SO THE SUITE NEVER WRITES TO A REAL TREECIPE DIRECTORY
            jest.spyOn(PicklistDependencyCheckService, 'writeCheckResultArtifacts')
                .mockReturnValue('/workspace/treecipe/PicklistDependencyResults/check-devHub-2026-08-16T14-22-08');

            handleCapturedErrorSpy = jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);

        });

        test('given a completed run, writes the result artifacts into the treecipe directory', async () => {

            const writeCheckResultArtifactsSpy = jest.spyOn(PicklistDependencyCheckService, 'writeCheckResultArtifacts')
                .mockReturnValue('/workspace/treecipe/PicklistDependencyResults/check-devHub-2026-08-16T14-22-08');

            await extensionCommandService.runPicklistDependencyCheck();

            expect(writeCheckResultArtifactsSpy).toHaveBeenCalledWith(
                expect.stringContaining('treecipe/PicklistDependencyResults'),
                'devHub',
                expect.any(String),
                passingCheckOutcome
            );

            // THE USER IS TOLD WHERE THE ARTIFACTS LANDED, NOT LEFT TO GO LOOKING
            expect((vscode.window.showInformationMessage as jest.Mock).mock.calls[0][0])
                .toContain('check-devHub-2026-08-16T14-22-08');

        });

        test('given a cancelled run, writes no artifacts', async () => {

            const writeCheckResultArtifactsSpy = jest.spyOn(PicklistDependencyCheckService, 'writeCheckResultArtifacts');
            jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedTargetOrg').mockResolvedValue(undefined);

            await extensionCommandService.runPicklistDependencyCheck();

            expect(writeCheckResultArtifactsSpy).not.toHaveBeenCalled();

        });

        test('given a deployed test class and passing tests, reports the result and shows the report', async () => {

            await extensionCommandService.runPicklistDependencyCheck();

            expect(runPicklistDependencyTestsSpy).toHaveBeenCalledWith('devHub', expect.any(Function));
            expect(showReportSpy).toHaveBeenCalled();
            expect((vscode.window.showInformationMessage as jest.Mock).mock.calls[0][0]).toContain('passed');
            expect(handleCapturedErrorSpy).not.toHaveBeenCalled();

        });

        test('given failing tests, warns rather than reporting success', async () => {

            runPicklistDependencyTestsSpy.mockResolvedValue(failingCheckOutcome);

            await extensionCommandService.runPicklistDependencyCheck();

            expect(showReportSpy).toHaveBeenCalled();
            expect(VSCodeWorkspaceService.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('failed'));

        });

        test('given no authenticated orgs, warns and never shows an empty quick pick', async () => {

            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([]);

            await extensionCommandService.runPicklistDependencyCheck();

            expect(VSCodeWorkspaceService.promptForAuthenticatedTargetOrg).not.toHaveBeenCalled();
            expect(runPicklistDependencyTestsSpy).not.toHaveBeenCalled();
            expect((vscode.window.showWarningMessage as jest.Mock).mock.calls[0][0]).toContain('No authenticated Salesforce orgs');

        });

        test('given a dismissed org quick pick, exits silently and runs nothing', async () => {

            jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedTargetOrg').mockResolvedValue(undefined);

            await extensionCommandService.runPicklistDependencyCheck();

            expect(runPicklistDependencyTestsSpy).not.toHaveBeenCalled();
            expect(deployPicklistDependencyClassesSpy).not.toHaveBeenCalled();
            expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
            expect(handleCapturedErrorSpy).not.toHaveBeenCalled();

        });

        test('given a missing test class and a declined deploy prompt, deploys nothing and runs nothing', async () => {

            jest.spyOn(PicklistDependencyCheckService, 'isSpecsTestClassDeployedInOrg').mockResolvedValue(false);
            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);

            await extensionCommandService.runPicklistDependencyCheck();

            expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
                expect.stringContaining('was not found in "devHub"'),
                { modal: true },
                'Deploy and Run'
            );
            expect(deployPicklistDependencyClassesSpy).not.toHaveBeenCalled();
            expect(runPicklistDependencyTestsSpy).not.toHaveBeenCalled();
            expect((vscode.window.showInformationMessage as jest.Mock).mock.calls[0][0]).toContain('Nothing was deployed');

        });

        test('given a missing test class and a confirmed deploy, deploys then runs the check', async () => {

            jest.spyOn(PicklistDependencyCheckService, 'isSpecsTestClassDeployedInOrg').mockResolvedValue(false);
            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue('Deploy and Run');

            await extensionCommandService.runPicklistDependencyCheck();

            expect(deployPicklistDependencyClassesSpy).toHaveBeenCalledWith(classesDirectoryPath, 'devHub', expect.any(Function));
            expect(runPicklistDependencyTestsSpy).toHaveBeenCalledWith('devHub', expect.any(Function));

        });

        /*
            The confirmation lists the files that will be sent, so a workspace where generation never
            ran must fail BEFORE the modal. Otherwise the user approves a dialog offering zero files
            and only then learns they needed to run Generate first.
        */
        test('given no generated classes on disk, refuses before showing the deploy confirmation', async () => {

            jest.spyOn(PicklistDependencyCheckService, 'isSpecsTestClassDeployedInOrg').mockResolvedValue(false);

            jest.spyOn(PicklistDependencyCheckService, 'assertDeployableClassesExist').mockImplementation(() => {
                throw new Error('No picklist dependency classes were found in "/workspace/classes". Run "Generate Picklist Dependency Tests" first, then run the command again.');
            });

            const handleCapturedErrorSpy = jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);
            (vscode.window.showWarningMessage as jest.Mock).mockClear();

            await extensionCommandService.runPicklistDependencyCheck();

            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
            expect(deployPicklistDependencyClassesSpy).not.toHaveBeenCalled();
            expect(runPicklistDependencyTestsSpy).not.toHaveBeenCalled();

            const reportedError = handleCapturedErrorSpy.mock.calls[0][0] as Error;
            expect(reportedError.message).toContain('Generate Picklist Dependency Tests');

        });

        test('given the Salesforce CLI is unavailable, routes the error through ErrorHandlingService', async () => {

            runPicklistDependencyTestsSpy.mockRejectedValue(new Error('The Salesforce CLI ("sf") is not installed or not on PATH.'));

            await extensionCommandService.runPicklistDependencyCheck();

            expect(handleCapturedErrorSpy).toHaveBeenCalled();
            expect(handleCapturedErrorSpy.mock.calls[0][0].message).toContain('not installed or not on PATH');
            expect(handleCapturedErrorSpy.mock.calls[0][1]).toBe('runPicklistDependencyCheck');

        });

    });


    describe('openPicklistDependencyExplorer', () => {

        const workspaceRoot = '/workspace';
        const objectsDirectoryPath = '/workspace/force-app/main/default/objects';
        const stateFieldSourceFilePath = `${objectsDirectoryPath}/Chain_Example__c/fields/State__c.field-meta.xml`;

        const chainSpecDetail: IPicklistDependencySpecDetail = {
            objectApiName: 'Chain_Example__c',
            fieldApiName: 'State__c',
            controllingFieldApiName: 'Country__c',
            expectations: [{ controllingValue: 'USA', dependentValues: ['Ohio'], forbiddenValues: ['Ontario'] }]
        };

        let extensionCommandService: ExtensionCommandService;
        let handleCapturedErrorSpy: jest.SpyInstance;
        let createdWebviewPanel: any;
        let receivedMessageHandler: (panelMessage: any) => Promise<void>;

        beforeEach(() => {

            extensionCommandService = new ExtensionCommandService();

            /*
                These live on the module factory rather than on a spy, so restoreMocks does not
                reach them and their call history would otherwise carry between tests.
            */
            (vscode.window.createWebviewPanel as jest.Mock).mockClear();
            (vscode.commands.executeCommand as jest.Mock).mockClear();

            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue(workspaceRoot);
            jest.spyOn(ConfigurationService, 'getObjectsPathFromTreecipeJSONConfiguration')
                .mockReturnValue('./force-app/main/default/objects');
            jest.spyOn(fs, 'existsSync').mockReturnValue(true);

            jest.spyOn(PicklistDependencyTestService, 'collectSpecDetailsByObjectsDirectory')
                .mockResolvedValue({ specDetails: [chainSpecDetail], skippedFieldWarnings: [] });

            handleCapturedErrorSpy = jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);

            createdWebviewPanel = {
                webview: {
                    html: '',
                    onDidReceiveMessage: jest.fn().mockImplementation(messageHandler => {
                        receivedMessageHandler = messageHandler;
                    })
                }
            };

            (vscode.window.createWebviewPanel as jest.Mock).mockReturnValue(createdWebviewPanel);
            (vscode.commands.executeCommand as jest.Mock).mockResolvedValue(undefined);

        });

        test('given collected dependencies, opens a scripted webview panel carrying the rendered model', async () => {

            jest.spyOn(PicklistDependencyExplorerService, 'loadLatestResults')
                .mockReturnValue({ state: 'noResultsFound', message: 'no check has been run' });

            await extensionCommandService.openPicklistDependencyExplorer();

            expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
                PICKLIST_DEPENDENCY_EXPLORER_VIEW_TYPE,
                'Picklist Dependency Explorer',
                vscode.ViewColumn.One,
                { enableScripts: true, retainContextWhenHidden: true }
            );

            expect(createdWebviewPanel.webview.html).toContain('Picklist Dependency Explorer');
            expect(createdWebviewPanel.webview.html).toContain(`default-src 'none'`);
            expect(createdWebviewPanel.webview.html).toContain('State__c');
            expect(handleCapturedErrorSpy).not.toHaveBeenCalled();

        });

        test('given a results folder, reads the latest run from the configured treecipe results path', async () => {

            const loadLatestResultsSpy = jest.spyOn(PicklistDependencyExplorerService, 'loadLatestResults')
                .mockReturnValue({ state: 'noResultsFound', message: 'no check has been run' });

            await extensionCommandService.openPicklistDependencyExplorer();

            expect(loadLatestResultsSpy).toHaveBeenCalledWith(
                expect.stringContaining('treecipe')
            );
            expect(loadLatestResultsSpy.mock.calls[0][0]).toContain('PicklistDependencyResults');

        });

        test('given a reveal message naming a field the model contains, reveals and opens that field file', async () => {

            jest.spyOn(PicklistDependencyExplorerService, 'loadLatestResults')
                .mockReturnValue({ state: 'noResultsFound', message: 'no check has been run' });

            const openFileInEditorSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);

            await extensionCommandService.openPicklistDependencyExplorer();

            await receivedMessageHandler({ command: 'revealFieldSource', sourceFilePath: stateFieldSourceFilePath });

            expect(vscode.commands.executeCommand).toHaveBeenCalledWith('revealInExplorer', { fsPath: stateFieldSourceFilePath });
            expect(openFileInEditorSpy).toHaveBeenCalledWith(stateFieldSourceFilePath);

        });

        /*
            The panel is the one surface this feature exposes to content it did not author, so a
            posted path the model never named must not reach the editor at all.
        */
        test('given a reveal message naming a path the model never produced, opens nothing', async () => {

            jest.spyOn(PicklistDependencyExplorerService, 'loadLatestResults')
                .mockReturnValue({ state: 'noResultsFound', message: 'no check has been run' });

            const openFileInEditorSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);

            await extensionCommandService.openPicklistDependencyExplorer();

            await receivedMessageHandler({ command: 'revealFieldSource', sourceFilePath: '/etc/passwd' });

            expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
            expect(openFileInEditorSpy).not.toHaveBeenCalled();

        });

        test('given a message that is not a reveal request, opens nothing', async () => {

            jest.spyOn(PicklistDependencyExplorerService, 'loadLatestResults')
                .mockReturnValue({ state: 'noResultsFound', message: 'no check has been run' });

            const openFileInEditorSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);

            await extensionCommandService.openPicklistDependencyExplorer();

            await receivedMessageHandler({ command: 'somethingElse', sourceFilePath: stateFieldSourceFilePath });

            expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
            expect(openFileInEditorSpy).not.toHaveBeenCalled();

        });

        test('given the field file has since been deleted, warns rather than opening a missing path', async () => {

            jest.spyOn(PicklistDependencyExplorerService, 'loadLatestResults')
                .mockReturnValue({ state: 'noResultsFound', message: 'no check has been run' });

            const openFileInEditorSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);
            const showWarningMessageSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);

            await extensionCommandService.openPicklistDependencyExplorer();

            (fs.existsSync as unknown as jest.Mock).mockReturnValue(false);

            await receivedMessageHandler({ command: 'revealFieldSource', sourceFilePath: stateFieldSourceFilePath });

            expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining('no longer exists'));
            expect(openFileInEditorSpy).not.toHaveBeenCalled();

        });

        test('given no dependent picklists at all, still opens the panel with the empty state', async () => {

            jest.spyOn(PicklistDependencyTestService, 'collectSpecDetailsByObjectsDirectory')
                .mockResolvedValue({ specDetails: [], skippedFieldWarnings: [] });
            jest.spyOn(PicklistDependencyExplorerService, 'loadLatestResults')
                .mockReturnValue({ state: 'noResultsFound', message: 'no check has been run' });

            await extensionCommandService.openPicklistDependencyExplorer();

            expect(vscode.window.createWebviewPanel).toHaveBeenCalled();
            expect(createdWebviewPanel.webview.html).toContain('No dependent picklists were found in');
            expect(handleCapturedErrorSpy).not.toHaveBeenCalled();

        });

        test('given no objects directory on disk, routes the error through ErrorHandlingService', async () => {

            (fs.existsSync as unknown as jest.Mock).mockReturnValue(false);

            await extensionCommandService.openPicklistDependencyExplorer();

            expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
            expect(handleCapturedErrorSpy).toHaveBeenCalled();
            expect(handleCapturedErrorSpy.mock.calls[0][0].message).toContain('No objects directory found');
            expect(handleCapturedErrorSpy.mock.calls[0][1]).toBe('openPicklistDependencyExplorer');

        });

        test('given no workspace, routes the error through ErrorHandlingService', async () => {

            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue(undefined);

            await extensionCommandService.openPicklistDependencyExplorer();

            expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
            expect(handleCapturedErrorSpy.mock.calls[0][1]).toBe('openPicklistDependencyExplorer');

        });

    });

});
