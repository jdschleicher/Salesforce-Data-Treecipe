import * as path from 'path';
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
        createWebviewPanel: jest.fn(),
        /*
            The explorer reports its load phase here as well as in the panel, so a load stays legible
            while the panel does not have focus. The item is the caller's to dispose, and these tests
            assert that it is.
        */
        createStatusBarItem: jest.fn().mockImplementation(() => ({ text: '', show: jest.fn(), dispose: jest.fn() }))
    },
    commands: { registerCommand: jest.fn(), executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ProgressLocation: { Notification: 15, Window: 10, SourceControl: 1 },
    ConfigurationTarget: { Workspace: 2 },
    FileType: { Directory: 2, File: 1, SymbolicLink: 64 }
}), { virtual: true });

jest.mock('@salesforce/core', () => ({
    AuthInfo: { listAllAuthorizations: jest.fn() },
    Org: { create: jest.fn() }
}));

import { AuthInfo } from '@salesforce/core';

import { ExtensionCommandService, RUN_AGAINST_ORG_ACTION_LABEL, PICKLIST_DEPENDENCY_EXPLORER_VIEW_TYPE, PREVIEW_FROM_METADATA_ACTION_LABEL, UPDATE_METADATA_ACTION_LABEL, DEPLOY_UPDATED_METADATA_ACTION_LABEL, VIEW_GENERATION_WARNING_DETAILS_ACTION_LABEL, VIEW_GENERATION_SUMMARY_ACTION_LABEL, OPEN_PICKLIST_DEPENDENCY_EXPLORER_ACTION_LABEL } from "../ExtensionCommandService";
import { ConfigurationService } from "../../ConfigurationService/ConfigurationService";
import { ErrorHandlingService } from "../../ErrorHandlingService/ErrorHandlingService";
import { GlobalValueSetSingleton } from "../../GlobalValueSetSingleton/GlobalValueSetSingleton";
import { PicklistDependencyTestService, IPicklistDependencySpecDetail, IRecordTypePicklistDependencySpecDetail, IPicklistDependencySkippedField } from "../../PicklistDependencyTestService/PicklistDependencyTestService";
import { PicklistDependencyCheckService } from "../../PicklistDependencyCheckService/PicklistDependencyCheckService";
import { VSCodeWorkspaceService } from "../../VSCodeWorkspace/VSCodeWorkspaceService";
import {
    PicklistDependencyExplorerService,
    IPicklistDependencyExplorerViewModel,
    PICKLIST_DEPENDENCY_EXPLORER_LOAD_PHASES
} from "../../PicklistDependencyExplorerService/PicklistDependencyExplorerService";
import { PicklistDependencyManifestService } from "../../PicklistDependencyManifestService/PicklistDependencyManifestService";
import { PicklistDependencyMetadataWriterService } from "../../PicklistDependencyMetadataWriterService/PicklistDependencyMetadataWriterService";
import { DirectoryProcessor } from "../../DirectoryProcessingService/DirectoryProcessor";
import { FakerJSRecipeFakerService } from "../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService";

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
        const manifestFilePath = `${workspaceRoot}/treecipe/PicklistDependencySpecs/manifest.json`;

        let extensionCommandService: ExtensionCommandService;
        let writeSpecsClassFilesSpy: jest.SpyInstance;
        let writeSpecsTestClassFilesSpy: jest.SpyInstance;
        let writeSpecsTestSuiteFileSpy: jest.SpyInstance;
        let writeManifestSpy: jest.SpyInstance;
        let writeGenerationSummaryDocumentSpy: jest.SpyInstance;
        let handleCapturedErrorSpy: jest.SpyInstance;

        const generationSummaryFilePath = `${workspaceRoot}/treecipe/PicklistDependencySpecs/generation-summary.md`;

        /*
            The run report moved OUT of the toast and into this document, so what the run has to say
            is asserted where it is now written. The builder that produces it is the real one -- only
            the write is stubbed, for the same reason every other writer in this describe is.
        */
        function getWrittenGenerationSummaryMarkdown(): string {
            return String(writeGenerationSummaryDocumentSpy.mock.calls[0][1]);
        }

        function stubCollectionResult(specDetails: IPicklistDependencySpecDetail[],
                                        skippedFieldWarnings: string[] = [],
                                        recordTypeSpecDetails: IRecordTypePicklistDependencySpecDetail[] = [],
                                        skippedFields: IPicklistDependencySkippedField[] = []) {
            jest.spyOn(PicklistDependencyTestService, 'collectSpecDetailsByObjectsDirectory')
                .mockResolvedValue({ specDetails, recordTypeSpecDetails, skippedFieldWarnings, skippedFields });
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
            writeSpecsTestSuiteFileSpy = jest.spyOn(PicklistDependencyTestService, 'writeSpecsTestSuiteFile')
                .mockReturnValue('/workspace/force-app/main/default/testSuites/SDTPicklistDependencyTests.testSuite-meta.xml');

            /*
                Stubbed for the same reason every other writer here is: this describe drives the real
                command against a workspace root that does not exist on disk, so an unstubbed write
                would be a genuine filesystem write to "/workspace". That throws for any user who
                cannot create a directory at the filesystem root -- which is every CI runner, while
                passing locally for anyone running as root. The failure then lands in the command's
                catch and every later assertion in this describe sees a call that never happened.
            */
            writeManifestSpy = jest.spyOn(PicklistDependencyManifestService, 'writeManifest').mockReturnValue(manifestFilePath);
            writeGenerationSummaryDocumentSpy = jest.spyOn(PicklistDependencyTestService, 'writeGenerationSummaryDocument')
                .mockReturnValue(generationSummaryFilePath);
            jest.spyOn(VSCodeWorkspaceService, 'showMarkdownPreview').mockResolvedValue(undefined);
            jest.spyOn(PicklistDependencyManifestService, 'buildSourceFingerprint').mockReturnValue('stub-fingerprint');
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

        /*
            A dependent picklist can take its values from a GLOBAL value set, whose values live in a
            "globalValueSets" sibling of the objects directory rather than in the field file. Only
            recipe generation used to read them, so spec generation saw such a field as having no
            declared values at all.
        */
        /*
            Asserted on the singleton's RESULTING STATE rather than on initialize's argument tuple.
            The first version of this test mocked initialize away and asserted the arguments it was
            called with -- which locked in a second argument of false, the value that makes
            initialize return before doing any work. It could never have failed on the bug it was
            written to cover. What matters is that the sets are actually loaded by the time specs
            are collected, so that is what is asserted.
        */
        test('given the generate command, actually loads the global value sets beside the objects directory', async () => {

            stubCollectionResult([specDetail]);

            const globalValueSetSingleton = GlobalValueSetSingleton.getInstance();

            /*
                A REAL globalValueSets DIRECTORY HOLDING ONE SET, READ THROUGH THE SAME CALL THE
                COMMAND MAKES. Scoped with "Once" and a path-aware existsSync: the vscode module
                factory's jest.fn instances are shared for the whole file and the suite's
                beforeEach only clears CALLS, not implementations, so an unscoped mockResolvedValue
                here leaks into every later test.
            */
            jest.spyOn(fs, 'existsSync').mockImplementation((checkedPath: any) => {
                const checkedPathText = String(checkedPath);
                return checkedPathText.includes('objects') || checkedPathText.includes('globalValueSets');
            });
            (vscode.workspace.fs.readDirectory as jest.Mock).mockResolvedValueOnce([
                ['SDT_Territory_Values.globalValueSet-meta.xml', 1]
            ]);
            jest.spyOn(globalValueSetSingleton, 'getGlobalValueSetPicklistXMLFileContent').mockResolvedValue(`<?xml version="1.0" encoding="UTF-8"?>
<GlobalValueSet xmlns="http://soap.sforce.com/2006/04/metadata">
    <customValue>
        <fullName>Territory_North</fullName>
        <default>false</default>
        <label>Territory North</label>
    </customValue>
    <masterLabel>SDT Territory Values</masterLabel>
</GlobalValueSet>`);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            const picklistValuesByGlobalValueSetName = globalValueSetSingleton.getPicklistValueMaps();

            expect(picklistValuesByGlobalValueSetName).toBeTruthy();
            expect(picklistValuesByGlobalValueSetName['SDT_Territory_Values']).toEqual(['Territory_North']);

        });

        test('given record type scoped specs collected, hands them to the writer and says where they live', async () => {

            const recordTypeSpecDetail: IRecordTypePicklistDependencySpecDetail = {
                objectApiName: 'Dependency_Example__c',
                fieldApiName: 'Neighborhood__c',
                controllingFieldApiName: 'City__c',
                recordTypeDeveloperName: 'Cleveland_Only',
                expectations: [{ controllingValue: 'cle', dependentValues: ['ohiocity'], forbiddenValues: [] }]
            };

            stubCollectionResult([specDetail], [], [recordTypeSpecDetail]);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            /*
                The fifth argument is the plan built for the pre-write preview. Passing it is what
                makes "what was previewed is what gets written" structural rather than a property of
                the plan builder happening to be pure -- and it stops every object's Apex body being
                built a second time.
            */
            expect(writeSpecsClassFilesSpy).toHaveBeenCalledWith(
                classesDirectoryPath,
                [specDetail],
                '64.0',
                [recordTypeSpecDetail],
                expect.objectContaining({ plannedFiles: expect.any(Array), staleClassFilePaths: expect.any(Array) }),
                expect.objectContaining({ report: expect.any(Function), isCancellationRequested: expect.any(Function) })
            );

            /*
                The scoped specs are deployable but not asserted by the generated test class, so the
                summary has to say so -- otherwise a user would reasonably read a green check run as
                covering them.
            */
            const generationSummaryMarkdown = getWrittenGenerationSummaryMarkdown();
            expect(generationSummaryMarkdown).toContain('**1** record-type-scoped spec(s)');
            expect(generationSummaryMarkdown).toContain('allRecordTypeScoped()');
            expect(generationSummaryMarkdown).toContain('**not** asserted by');

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
                '64.0',
                [],
                expect.objectContaining({ plannedFiles: expect.any(Array), staleClassFilePaths: expect.any(Array) }),
                expect.objectContaining({ report: expect.any(Function), isCancellationRequested: expect.any(Function) })
            );
            expect(handleCapturedErrorSpy).not.toHaveBeenCalled();

            /*
                The counts are the one thing short enough for a toast that truncates; the destination
                is reported in the document, which is why it is asserted there.
            */
            const informationMessage = (vscode.window.showInformationMessage as jest.Mock).mock.calls[0][0];
            expect(informationMessage).toContain('1 picklist dependency spec(s)');
            expect(informationMessage).toContain('1 per-object class(es)');

            expect(getWrittenGenerationSummaryMarkdown()).toContain(classesDirectoryPath);

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

            const generationSummaryMarkdown = getWrittenGenerationSummaryMarkdown();

            expect(generationSummaryMarkdown).toContain('SDTPLDSpecs_Retired_Object_c.cls');
            expect(generationSummaryMarkdown).toContain('no longer declaring a');

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

            expect(getWrittenGenerationSummaryMarkdown()).toContain('SDTPLDSpecsTest.cls');

        });

        test('given dependent picklists found, registers the test class in the generated Apex test suite', async () => {

            stubCollectionResult([specDetail]);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            expect(writeSpecsTestSuiteFileSpy).toHaveBeenCalledWith(
                classesDirectoryPath,
                expect.stringContaining('<testClassName>SDTPLDSpecsTest</testClassName>')
            );

            const emittedTestSuiteContent = writeSpecsTestSuiteFileSpy.mock.calls[0][1];
            expect(emittedTestSuiteContent).toContain('<ApexTestSuite xmlns="http://soap.sforce.com/2006/04/metadata">');

            // THE SUITE IS THE HANDLE A PIPELINE ADDRESSES, SO THE RUN REPORT HAS TO NAME IT
            expect(getWrittenGenerationSummaryMarkdown()).toContain('SDTPicklistDependencyTests');

        });

        /*
            A suite is a grouping a team curates. Resetting it to just the generated member on every
            regeneration would silently delete whatever else they had registered in it.
        */
        test('given a suite already carrying a hand added member, keeps it rather than resetting the file', async () => {

            stubCollectionResult([specDetail]);

            jest.spyOn(PicklistDependencyTestService, 'buildTestSuiteContentByClassesDirectory')
                .mockReturnValue({
                    content: PicklistDependencyTestService.buildTestSuiteXml(['SDTPLDSpecsTest', 'TeamOwnedPicklistTest']),
                    isExistingFileUnparseable: false,
                    isExistingFileUnreadable: false
                });

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            const emittedTestSuiteContent = writeSpecsTestSuiteFileSpy.mock.calls[0][1];

            expect(emittedTestSuiteContent).toContain('<testClassName>TeamOwnedPicklistTest</testClassName>');
            expect(emittedTestSuiteContent).toContain('<testClassName>SDTPLDSpecsTest</testClassName>');

        });

        test('given a suite file it cannot read, warns that the tests are not registered rather than replacing it', async () => {

            stubCollectionResult([specDetail]);

            jest.spyOn(PicklistDependencyTestService, 'buildTestSuiteContentByClassesDirectory')
                .mockReturnValue({ content: 'not a suite at all', isExistingFileUnparseable: true, isExistingFileUnreadable: false });

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            // THE FILE IS WRITTEN BACK AS ITSELF, WHICH THE CONTENT COMPARISON MAKES A NO-OP
            expect(writeSpecsTestSuiteFileSpy).toHaveBeenCalledWith(classesDirectoryPath, 'not a suite at all');

            expect(VSCodeWorkspaceService.showWarningMessage).toHaveBeenCalledWith(
                expect.stringContaining('NOT registered')
            );

        });

        test('after generating, offers to deploy and run against an org', async () => {

            stubCollectionResult([specDetail]);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            const offerCall = (vscode.window.showInformationMessage as jest.Mock).mock.calls[0];
            expect(offerCall[0]).toContain('Deploy and run them against an org now?');
            expect(offerCall[1]).toBe(RUN_AGAINST_ORG_ACTION_LABEL);

        });

        test('offers the summary and the explorer alongside the deploy offer', async () => {

            stubCollectionResult([specDetail]);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            const offerCall = (vscode.window.showInformationMessage as jest.Mock).mock.calls[0];

            // THE DEPLOY OFFER STAYS THE PRIMARY ACTION -- THE NEW BUTTONS ARE ADDED AFTER IT, NOT AHEAD OF IT
            expect(offerCall[1]).toBe(RUN_AGAINST_ORG_ACTION_LABEL);
            expect(offerCall).toContain(VIEW_GENERATION_SUMMARY_ACTION_LABEL);
            expect(offerCall).toContain(OPEN_PICKLIST_DEPENDENCY_EXPLORER_ACTION_LABEL);

        });

        test('given the summary document could not be written, offers no button for it and still reports the run', async () => {

            stubCollectionResult([specDetail]);
            writeGenerationSummaryDocumentSpy.mockImplementation(() => {
                throw new Error('EACCES: permission denied');
            });

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            const offerCall = (vscode.window.showInformationMessage as jest.Mock).mock.calls[0];

            expect(offerCall[0]).toContain('Generated 1 picklist dependency spec(s)');
            expect(offerCall).not.toContain(VIEW_GENERATION_SUMMARY_ACTION_LABEL);

            /*
                The Apex, the suite and the manifest were all written before this failed, so the run
                is a success that could not write its own report -- not a failed generation.
            */
            expect(handleCapturedErrorSpy).not.toHaveBeenCalled();
            expect(writeSpecsClassFilesSpy).toHaveBeenCalled();

            const warningMessages = (VSCodeWorkspaceService.showWarningMessage as jest.Mock).mock.calls.map(warningCall => String(warningCall[0]));
            expect(warningMessages.some(warningMessage => warningMessage.includes('summary document could not be written'))).toBeTrue();

        });

        test('given View Summary chosen, opens the document in preview and puts the deploy offer again', async () => {

            stubCollectionResult([specDetail]);
            (vscode.window.showInformationMessage as jest.Mock)
                .mockResolvedValueOnce(VIEW_GENERATION_SUMMARY_ACTION_LABEL)
                .mockResolvedValue(undefined);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            expect(VSCodeWorkspaceService.showMarkdownPreview).toHaveBeenCalledWith(generationSummaryFilePath);

            /*
                Reading the run does not cost the deploy offer -- it is put again rather than the
                command ending on the click that opened the document.
            */
            const followUpOfferCall = (vscode.window.showInformationMessage as jest.Mock).mock.calls[1];
            expect(followUpOfferCall[0]).toContain('Deploy the generated picklist dependency specs');
            expect(followUpOfferCall).toContain(RUN_AGAINST_ORG_ACTION_LABEL);

            // OFFERED ONCE: THE FOLLOW UP CANNOT RE-OPEN WHAT WAS JUST OPENED, WHICH IS WHAT ENDS THE LOOP
            expect(followUpOfferCall).not.toContain(VIEW_GENERATION_SUMMARY_ACTION_LABEL);

        });

        test('given Open Explorer chosen, runs the explorer command and puts the deploy offer again', async () => {

            stubCollectionResult([specDetail]);
            (vscode.window.showInformationMessage as jest.Mock)
                .mockResolvedValueOnce(OPEN_PICKLIST_DEPENDENCY_EXPLORER_ACTION_LABEL)
                .mockResolvedValue(undefined);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            expect(vscode.commands.executeCommand).toHaveBeenCalledWith('treecipe.openPicklistDependencyExplorer');

            const followUpOfferCall = (vscode.window.showInformationMessage as jest.Mock).mock.calls[1];
            expect(followUpOfferCall).toContain(RUN_AGAINST_ORG_ACTION_LABEL);

        });

        test('given the summary read first, the deploy still runs when it is then accepted', async () => {

            stubCollectionResult([specDetail]);
            (vscode.window.showInformationMessage as jest.Mock)
                .mockResolvedValueOnce(VIEW_GENERATION_SUMMARY_ACTION_LABEL)
                .mockResolvedValue(RUN_AGAINST_ORG_ACTION_LABEL);
            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue('Deploy and Run');

            jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedTargetOrg').mockResolvedValue('devHub');
            jest.spyOn(VSCodeWorkspaceService, 'showPicklistDependencyCheckReport').mockImplementation(() => undefined);
            jest.spyOn(PicklistDependencyCheckService, 'writeCheckResultArtifacts').mockReturnValue('/workspace/treecipe/PicklistDependencyResults/check-devHub-x');
            jest.spyOn(PicklistDependencyCheckService, 'assertDeployableClassesExist')
                .mockReturnValue([`${classesDirectoryPath}/SDTPLDSpecsTest.cls`]);

            const deploySpy = jest.spyOn(PicklistDependencyCheckService, 'deployPicklistDependencyClasses')
                .mockResolvedValue('Deployed 8 component(s) to the target org.');
            jest.spyOn(PicklistDependencyCheckService, 'runPicklistDependencyTests')
                .mockResolvedValue({ passed: true, failureCount: 0, methodOutcomes: [{ methodName: 'specRegistryIsNotEmpty', passed: true }] });

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            expect(deploySpy).toHaveBeenCalled();

        });

        /*
            The warnings keep their own path: a skipped field is not part of the success report, and
            folding it into the summary document would be the roll-up rolled back up.
        */
        test('given skipped fields, still offers View Details beside the new buttons', async () => {

            stubCollectionResult([specDetail], [], [], [
                {
                    objectApiName: 'Dependency_Example__c',
                    fieldApiName: 'Thing__c',
                    warning: 'Skipped "Thing__c": no valueSettings.',
                    reason: 'noValueSettings' as any
                }
            ]);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            const offerCall = (vscode.window.showInformationMessage as jest.Mock).mock.calls[0];

            expect(offerCall).toContain(VIEW_GENERATION_WARNING_DETAILS_ACTION_LABEL);
            expect(offerCall).toContain(VIEW_GENERATION_SUMMARY_ACTION_LABEL);
            expect(offerCall[0]).toContain('field(s) skipped');

        });

        test('writes the summary document beside the manifest, never into a package directory', async () => {

            stubCollectionResult([specDetail]);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            const writtenSpecsFolderPath = String(writeGenerationSummaryDocumentSpy.mock.calls[0][0]);

            expect(writtenSpecsFolderPath).toContain(path.join('treecipe', 'PicklistDependencySpecs'));
            expect(writtenSpecsFolderPath).not.toContain('force-app');

        });

        /*
            The document is opened on a successful run, not only when the button is clicked -- the
            run report is what the user is left looking at once generation finishes.
        */
        test('opens the summary document after generating, without waiting for the button', async () => {

            stubCollectionResult([specDetail]);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            expect(VSCodeWorkspaceService.showMarkdownPreview).toHaveBeenCalledWith(generationSummaryFilePath);

            // THE SPEC CLASS FIRST, THEN THE SUMMARY, SO THE REPORT IS WHAT ENDS UP IN FRONT
            const openClassCallOrder = (VSCodeWorkspaceService.openFileInEditor as jest.Mock).mock.invocationCallOrder[0];
            const openSummaryCallOrder = (VSCodeWorkspaceService.showMarkdownPreview as jest.Mock).mock.invocationCallOrder[0];
            expect(openClassCallOrder).toBeLessThan(openSummaryCallOrder);

        });

        test('given no summary document was written, opens nothing and still reports the run', async () => {

            stubCollectionResult([specDetail]);
            writeGenerationSummaryDocumentSpy.mockImplementation(() => {
                throw new Error('EACCES: permission denied');
            });

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            expect(VSCodeWorkspaceService.showMarkdownPreview).not.toHaveBeenCalled();
            expect(handleCapturedErrorSpy).not.toHaveBeenCalled();

        });

        /*
            A preview that will not open -- the built-in markdown extension disabled -- is a failed
            VIEW of a generation that succeeded. Unguarded, the rejection would reach the command's
            catch and report a completed run as an error.
        */
        test('given the summary preview cannot open, the run is still reported as a success', async () => {

            stubCollectionResult([specDetail]);
            (VSCodeWorkspaceService.showMarkdownPreview as jest.Mock).mockRejectedValue(new Error('command not found'));

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            expect(handleCapturedErrorSpy).not.toHaveBeenCalled();
            expect(writeSpecsClassFilesSpy).toHaveBeenCalled();

            // THE DEPLOY OFFER STILL ARRIVES: A FAILED OPEN MUST NOT SWALLOW THE REST OF THE RUN
            expect((vscode.window.showInformationMessage as jest.Mock).mock.calls[0][0])
                .toContain('Deploy and run them against an org now?');

        });

        test('given an inspect action throws, warns and puts the deploy offer again rather than failing the command', async () => {

            stubCollectionResult([specDetail]);
            (vscode.window.showInformationMessage as jest.Mock)
                .mockResolvedValueOnce(OPEN_PICKLIST_DEPENDENCY_EXPLORER_ACTION_LABEL)
                .mockResolvedValue(undefined);
            /*
                Scoped with "Once": the jest.fn instances in the vscode module factory are created
                for the whole module and clearAllMocks clears CALLS, not implementations, so an
                unscoped rejection here leaks into every later test that opens a diff.
            */
            (vscode.commands.executeCommand as jest.Mock).mockRejectedValueOnce(new Error('explorer unavailable'));

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            expect(handleCapturedErrorSpy).not.toHaveBeenCalled();

            const warningMessages = (VSCodeWorkspaceService.showWarningMessage as jest.Mock).mock.calls.map(warningCall => String(warningCall[0]));
            expect(warningMessages.some(warningMessage => warningMessage.includes('could not be opened'))).toBeTrue();

            // THE OFFER IS PUT AGAIN, SO A FAILED VIEW DOES NOT COST THE DEPLOY
            const followUpOfferCall = (vscode.window.showInformationMessage as jest.Mock).mock.calls[1];
            expect(followUpOfferCall).toContain(RUN_AGAINST_ORG_ACTION_LABEL);

        });

        /*
            A catch binding is implicitly any under this tsconfig, so reading .message off a thrown
            non-Error would throw again INSIDE the catch -- escalating exactly the failure the block
            exists to contain.
        */
        test('given a non-Error thrown by the summary write, still contains it rather than failing the run', async () => {

            stubCollectionResult([specDetail]);
            writeGenerationSummaryDocumentSpy.mockImplementation(() => {
                // eslint-disable-next-line no-throw-literal
                throw 'disk gone';
            });

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            expect(handleCapturedErrorSpy).not.toHaveBeenCalled();

            const warningMessages = (VSCodeWorkspaceService.showWarningMessage as jest.Mock).mock.calls.map(warningCall => String(warningCall[0]));
            expect(warningMessages.some(warningMessage => warningMessage.includes('disk gone'))).toBeTrue();

        });

        test('writes the summary document as a sibling of the manifest it just wrote', async () => {

            stubCollectionResult([specDetail]);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            const writtenSummaryFolderPath = String(writeGenerationSummaryDocumentSpy.mock.calls[0][0]);
            const writtenManifestFilePath = String(writeManifestSpy.mock.results[0].value);

            expect(writtenSummaryFolderPath).toBe(path.dirname(writtenManifestFilePath));

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

        /*
            The manifest is the artifact the Explorer reads, so a generation that wrote the Apex and
            not the manifest would leave the panel describing the previous run's specs. Asserting the
            write happens -- and lands under treecipe/ rather than in the package directory, where a
            stray json breaks "sf project deploy" -- is what pins that down.
        */
        test('writes the spec manifest under the treecipe directory, from the same run as the Apex', async () => {

            stubCollectionResult([specDetail]);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            expect(writeManifestSpy).toHaveBeenCalled();

            const [specsFolderPathArgument, manifestArgument] = writeManifestSpy.mock.calls[0];

            expect(specsFolderPathArgument).toContain('treecipe');
            expect(specsFolderPathArgument).toContain('PicklistDependencySpecs');
            expect(specsFolderPathArgument).not.toContain('classes');

            expect(manifestArgument.objects).toHaveLength(1);
            expect(manifestArgument.objects[0].objectApiName).toBe('Dependency_Example__c');

        });

        test('given the offer is accepted, deploys and runs without asking whether the class is already there', async () => {

            stubCollectionResult([specDetail]);
            (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(RUN_AGAINST_ORG_ACTION_LABEL);
            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue('Deploy and Run');

            jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedTargetOrg').mockResolvedValue('devHub');
            jest.spyOn(VSCodeWorkspaceService, 'showPicklistDependencyCheckReport').mockImplementation(() => undefined);
            jest.spyOn(PicklistDependencyCheckService, 'writeCheckResultArtifacts').mockReturnValue('/workspace/treecipe/PicklistDependencyResults/check-devHub-x');

            const isDeployedSpy = jest.spyOn(PicklistDependencyCheckService, 'isSpecsTestSuiteDeployedInOrg');

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

        /*
            The pre-write report replaced a blanket "these files already exist" modal. The
            difference that matters: the old prompt fired on the mere PRESENCE of generated files,
            so it fired on runs that would have written identical bytes, and it could not say what
            was about to change. These tests pin the new gate -- something is actually lost -- and
            the escape hatches out of it.
        */
        function stubExistingGeneratedFilesWithContent(existingFileContent: string) {

            jest.spyOn(fs, 'existsSync').mockImplementation((checkedPath: any) => !String(checkedPath).includes('globalValueSets'));

            // THE CLASSES DIRECTORY NOW READS AS PRESENT, SO THE STALE CLASS SWEEP ACTUALLY LISTS IT
            jest.spyOn(fs, 'readdirSync').mockReturnValue([] as any);

            jest.spyOn(fs, 'readFileSync').mockImplementation((readPath: any, ...readArguments: any[]) => {

                const readPathText = String(readPath);
                if ( readPathText.includes('classes') && (readPathText.endsWith('.cls') || readPathText.endsWith('-meta.xml')) ) {
                    return existingFileContent;
                }

                return (jest.requireActual('fs') as typeof fs).readFileSync(readPath, ...readArguments);

            });

        }

        test('given generated specs that would be replaced and a cancelled prompt, writes nothing', async () => {

            stubCollectionResult([specDetail]);
            stubExistingGeneratedFilesWithContent('// A HAND EDITED SPEC THAT REGENERATION WOULD REPLACE');
            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
                expect.stringContaining('Overwritten:'),
                { modal: true },
                'Generate',
                'Show Diff'
            );
            expect(writeSpecsClassFilesSpy).not.toHaveBeenCalled();

        });

        test('given generated specs that would be replaced and a confirmed prompt, writes the file', async () => {

            stubCollectionResult([specDetail]);
            stubExistingGeneratedFilesWithContent('// A HAND EDITED SPEC THAT REGENERATION WOULD REPLACE');
            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue('Generate');

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            expect(writeSpecsClassFilesSpy).toHaveBeenCalled();

        });

        test('given nothing on disk yet, writes without prompting at all', async () => {

            // THE SUITE DEFAULT ALREADY MEANS "THE OBJECTS DIRECTORY EXISTS, NOTHING IS GENERATED YET"
            stubCollectionResult([specDetail]);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            const modalPrompts = (vscode.window.showWarningMessage as jest.Mock).mock.calls.filter(
                call => call[1] && call[1].modal
            );

            expect(modalPrompts).toHaveLength(0);
            expect(writeSpecsClassFilesSpy).toHaveBeenCalled();

        });

        test('given generated files already matching this metadata, neither prompts nor shows a diff', async () => {

            stubCollectionResult([specDetail]);

            /*
                The plan is built from the same functions the writer uses, so handing back exactly
                what would be written is what "unchanged" means. Reading it out of the plan rather
                than restating the Apex keeps this test about the no-op guarantee.
            */
            const proposedContentByFilePath: Record<string, string> = {};
            const realBuildPlannedSpecsFile = PicklistDependencyTestService.buildPlannedSpecsFile.bind(PicklistDependencyTestService);
            jest.spyOn(PicklistDependencyTestService, 'buildPlannedSpecsFile').mockImplementation(
                (filePath: string, proposedContent: string, objectApiName?: string) => {
                    proposedContentByFilePath[filePath] = proposedContent;
                    return { ...realBuildPlannedSpecsFile(filePath, proposedContent, objectApiName), changeType: 'unchanged' as const };
                }
            );

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            const modalPrompts = (vscode.window.showWarningMessage as jest.Mock).mock.calls.filter(
                call => call[1] && call[1].modal
            );

            expect(modalPrompts).toHaveLength(0);
            expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith('vscode.diff', expect.anything(), expect.anything(), expect.anything());
            expect(Object.keys(proposedContentByFilePath).length).toBeGreaterThan(0);

        });

        test('given a request to see the diff, opens it against the file on disk and then still asks', async () => {

            stubCollectionResult([specDetail]);
            stubExistingGeneratedFilesWithContent('// A HAND EDITED SPEC THAT REGENERATION WOULD REPLACE');

            (vscode.window.showWarningMessage as jest.Mock)
                .mockResolvedValueOnce('Show Diff')
                .mockResolvedValueOnce('Generate');
            (vscode.window.showQuickPick as jest.Mock).mockImplementation(async (quickPickItems: any[]) => quickPickItems[0]);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            const diffCall = (vscode.commands.executeCommand as jest.Mock).mock.calls.find(call => call[0] === 'vscode.diff');
            expect(diffCall).toBeDefined();

            // THE ON DISK FILE IS THE LEFT HAND SIDE, SO THE DIFF READS AS "WHAT WOULD CHANGE"
            expect(diffCall[1].fsPath).toContain('classes');

            // ASKING FOR THE DIFF IS NOT A DECISION -- THE PROMPT COMES BACK, AND ONLY THEN IS ANYTHING WRITTEN
            expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(2);
            expect(writeSpecsClassFilesSpy).toHaveBeenCalled();

        });

        /*
            A VS Code modal blocks the entire workbench. The first version of the Show Diff loop
            re-showed a MODAL prompt straight after opening the diff, which meant the user could not
            read the diff without dismissing the dialog -- and dismissing cancels the run. The
            feature was unusable in a single pass, and the test above did not catch it because the
            mock answered 'Generate' on the second call regardless of how it was asked.
        */
        test('given a diff was opened, the follow up prompt is not modal so the diff stays readable', async () => {

            stubCollectionResult([specDetail]);
            stubExistingGeneratedFilesWithContent('// A HAND EDITED SPEC THAT REGENERATION WOULD REPLACE');

            (vscode.window.showWarningMessage as jest.Mock)
                .mockResolvedValueOnce('Show Diff')
                .mockResolvedValueOnce('Generate');
            (vscode.window.showQuickPick as jest.Mock).mockImplementation(async (quickPickItems: any[]) => quickPickItems[0]);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            const promptCalls = (vscode.window.showWarningMessage as jest.Mock).mock.calls;

            // THE FIRST ASK IS A DESTRUCTIVE ACTION CONFIRMATION, WHICH SHOULD STILL INTERRUPT
            expect(promptCalls[0][1]).toEqual({ modal: true });

            /*
                The second carries its actions as plain arguments with no options object, which is
                a notification rather than a modal -- the editor behind it stays interactive.
            */
            expect(promptCalls[1].slice(1)).toEqual(['Generate', 'Show Another Diff']);
            expect(promptCalls[1].some((promptArgument: any) => promptArgument && promptArgument.modal)).toBe(false);

        });

        test('given only one file would be replaced, does not offer a second diff of the same file', async () => {

            stubCollectionResult([specDetail]);

            // ONLY THE AGGREGATOR DIFFERS, SO THERE IS EXACTLY ONE DIFFABLE FILE
            const aggregatorClassFileName = path.basename(specsClassFilePath);
            jest.spyOn(fs, 'existsSync').mockImplementation((checkedPath: any) => !String(checkedPath).includes('globalValueSets'));
            jest.spyOn(fs, 'readdirSync').mockReturnValue([] as any);
            jest.spyOn(PicklistDependencyTestService, 'buildPlannedSpecsFile').mockImplementation(
                (filePath: string, proposedContent: string, objectApiName?: string) => ({
                    filePath,
                    proposedContent,
                    objectApiName,
                    changeType: path.basename(filePath) === aggregatorClassFileName ? 'changed' as const : 'unchanged' as const
                })
            );

            (vscode.window.showWarningMessage as jest.Mock)
                .mockResolvedValueOnce('Show Diff')
                .mockResolvedValueOnce('Generate');

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            const promptCalls = (vscode.window.showWarningMessage as jest.Mock).mock.calls;

            // THERE IS NOTHING ELSE TO COMPARE, SO THE SECOND ASK IS DECIDE ONLY
            expect(promptCalls[1].slice(1)).toEqual(['Generate']);

        });

        test('given only the meta xml would change, still reports what is being overwritten', async () => {

            stubCollectionResult([specDetail]);

            // AN sourceApiVersion BUMP CHANGES THE meta xml AND NOTHING ELSE
            jest.spyOn(fs, 'existsSync').mockImplementation((checkedPath: any) => !String(checkedPath).includes('globalValueSets'));
            jest.spyOn(fs, 'readdirSync').mockReturnValue([] as any);
            jest.spyOn(PicklistDependencyTestService, 'buildPlannedSpecsFile').mockImplementation(
                (filePath: string, proposedContent: string, objectApiName?: string) => ({
                    filePath,
                    proposedContent,
                    objectApiName,
                    changeType: filePath.endsWith('-meta.xml') ? 'changed' as const : 'unchanged' as const
                })
            );
            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            const promptMessage = (vscode.window.showWarningMessage as jest.Mock).mock.calls[0][0];

            /*
                Both report lists filter the meta xml out, so a meta-only change used to produce an
                empty report -- a confirmation dialog with a blank body asking the user to approve
                something it declined to name.
            */
            expect(promptMessage).toContain('-meta.xml');
            expect(promptMessage).not.toContain('will:\n\n\n');

        });

        test('given a stale per-object class, names it in the report before deleting it', async () => {

            stubCollectionResult([specDetail]);
            stubExistingGeneratedFilesWithContent('// A HAND EDITED SPEC THAT REGENERATION WOULD REPLACE');
            jest.spyOn(PicklistDependencyTestService, 'findStalePerObjectSpecsClassFilePaths')
                .mockReturnValue([`${classesDirectoryPath}/SDTPLDRetiredObjectSpecs.cls`]);
            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            const promptMessage = (vscode.window.showWarningMessage as jest.Mock).mock.calls[0][0];

            expect(promptMessage).toContain('SDTPLDRetiredObjectSpecs.cls');
            expect(promptMessage).toContain('Deleted');
            expect(writeSpecsClassFilesSpy).not.toHaveBeenCalled();

        });

        /*
            A missing framework class means the generated Apex will not compile at all. That is not
            part of the run report, and appending it to a success message as an information toast
            VS Code truncates would bury a blocker under two sentences of good news.
        */
        test('given framework classes that could not be supplied, keeps its own warning rather than burying it in the summary', async () => {

            stubCollectionResult([specDetail]);
            jest.spyOn(PicklistDependencyTestService, 'scaffoldMissingFrameworkClasses')
                .mockReturnValue({ scaffoldedClassNames: [], unavailableClassNames: ['SDTPicklistDependencySpec', 'SDTPicklistDependencyValidator'] });

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            const warningMessages = (VSCodeWorkspaceService.showWarningMessage as jest.Mock).mock.calls.map(call => String(call[0]));
            const unavailableWarning = warningMessages.find(warningMessage => warningMessage.includes('will not compile'));

            expect(unavailableWarning).toBeDefined();
            expect(unavailableWarning).toContain('SDTPicklistDependencySpec');

        });

        test('given scaffolded framework classes, names them in the run report', async () => {

            stubCollectionResult([specDetail]);
            jest.spyOn(PicklistDependencyTestService, 'scaffoldMissingFrameworkClasses')
                .mockReturnValue({ scaffoldedClassNames: ['PicklistDependencySpec'], unavailableClassNames: [] });

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            expect(getWrittenGenerationSummaryMarkdown()).toContain('Scaffolded the required framework class(es)');

        });

        /*
            A managed package declaring dependent picklists without valueSettings can produce many
            skips. They used to arrive as up to four toasts DURING the walk, before the user knew
            whether generation had succeeded; they are now one grouped line on the finished run.
        */
        test('given many skipped fields, reports them once at the end grouped by reason rather than as toasts during the run', async () => {

            const skippedFields: IPicklistDependencySkippedField[] = [
                ...Array.from({ length: 7 }, (unusedValue, index): IPicklistDependencySkippedField => ({
                    objectApiName: 'Dependency_Example__c',
                    fieldApiName: `NoSettings_${index}__c`,
                    warning: `skipped field ${index}`,
                    reason: 'noValueSettings'
                })),
                {
                    objectApiName: 'Dependency_Example__c',
                    fieldApiName: 'BadName__c',
                    warning: 'invalid api name',
                    reason: 'invalidApiName'
                }
            ];

            stubCollectionResult([specDetail], skippedFields.map(skippedField => skippedField.warning), [], skippedFields);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            // NOT ONE TOAST PER WARNING -- THE WHOLE POINT OF THE ROLL UP
            expect(VSCodeWorkspaceService.showWarningMessage as jest.Mock).not.toHaveBeenCalled();

            const informationMessage = (vscode.window.showInformationMessage as jest.Mock).mock.calls[0][0];

            expect(informationMessage).toContain('8 field(s) skipped');
            expect(informationMessage).toContain('7 no "valueSettings" markup');
            expect(informationMessage).toContain('1 invalid api name');

        });

        /*
            The distinction the aggregate warning this replaces took care to make in prose, now made
            structurally: neither of these cost the field its spec, so neither may be counted as a
            skipped field.
        */
        test('given a dropped global value set value and a record type that assigns none, counts each apart from skipped fields', async () => {

            const skippedFields: IPicklistDependencySkippedField[] = [
                {
                    objectApiName: 'Dependency_Example__c',
                    fieldApiName: 'Neighborhood__c',
                    warning: 'values the global value set does not declare',
                    reason: 'valueNotDeclaredInGlobalValueSet'
                },
                {
                    objectApiName: 'Dependency_Example__c',
                    fieldApiName: 'Neighborhood__c',
                    recordTypeDeveloperName: 'Retail',
                    warning: 'record type assigns no values',
                    reason: 'recordTypeAssignsNoValues'
                }
            ];

            stubCollectionResult([specDetail], skippedFields.map(skippedField => skippedField.warning), [], skippedFields);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            const informationMessage = (vscode.window.showInformationMessage as jest.Mock).mock.calls[0][0];

            expect(informationMessage).toContain('1 field(s) had values dropped from a spec that was still generated');
            expect(informationMessage).toContain('1 record-type-scoped combination(s) skipped');
            expect(informationMessage).not.toContain('field(s) skipped (');

        });

        test('given skipped fields, offers View Details and writes every warning to the report channel', async () => {

            const skippedFields: IPicklistDependencySkippedField[] = [{
                objectApiName: 'Dependency_Example__c',
                fieldApiName: 'NoSettings__c',
                warning: 'no valueSettings markup on NoSettings__c',
                reason: 'noValueSettings'
            }];

            stubCollectionResult([specDetail], ['no valueSettings markup on NoSettings__c'], [], skippedFields);
            jest.spyOn(VSCodeWorkspaceService, 'showPicklistDependencyCheckReport').mockImplementation(() => undefined);
            (vscode.window.showInformationMessage as jest.Mock).mockResolvedValueOnce(VIEW_GENERATION_WARNING_DETAILS_ACTION_LABEL);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            expect((vscode.window.showInformationMessage as jest.Mock).mock.calls[0]).toContain(VIEW_GENERATION_WARNING_DETAILS_ACTION_LABEL);

            const reportedWarnings = (VSCodeWorkspaceService.showPicklistDependencyCheckReport as jest.Mock).mock.calls[0][0];
            expect(reportedWarnings).toContain('no valueSettings markup on NoSettings__c');

            /*
                Reading the warnings must not cost the deploy offer -- it is put again once the
                report is open, so "View Details" is not a choice between understanding the run and
                finishing it.
            */
            const secondMessage = (vscode.window.showInformationMessage as jest.Mock).mock.calls[1][0];
            expect(secondMessage).toContain('Deploy the generated picklist dependency specs');

        });

        test('given no skipped fields, offers no View Details action', async () => {

            stubCollectionResult([specDetail]);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            expect((vscode.window.showInformationMessage as jest.Mock).mock.calls[0])
                .not.toContain(VIEW_GENERATION_WARNING_DETAILS_ACTION_LABEL);

        });

        /*
            Notification, NOT the status bar. ProgressLocation.Window "supports neither cancellation
            nor discrete progress" per vscode.d.ts -- it renders no cancel button, so cancelling the
            walk would be unreachable behind it however well the token were plumbed.
        */
        test('runs behind a cancellable notification progress, the only location that can offer cancel', async () => {

            stubCollectionResult([specDetail]);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            const generationProgressCalls = (vscode.window.withProgress as jest.Mock).mock.calls
                .filter(progressCall => progressCall[0].title === 'Generate Picklist Dependency Tests');

            expect(generationProgressCalls.length).toBeGreaterThan(0);
            generationProgressCalls.forEach(progressCall => {
                expect(progressCall[0].location).toBe(vscode.ProgressLocation.Notification);
                expect(progressCall[0].cancellable).toBe(true);
            });

        });

        /*
            Read, ASK, write -- in three parts, so the confirmation is not competing with a spinner
            over whether the write it is asking about should happen.
        */
        test('puts the change plan confirmation between the read and the write, not inside either', async () => {

            stubCollectionResult([specDetail]);

            let callSequence: string[] = [];

            (vscode.window.withProgress as jest.Mock).mockImplementation(async (progressOptions, task) => {
                if ( progressOptions.title === 'Generate Picklist Dependency Tests' ) {
                    callSequence.push('progressScope');
                }
                return await task(
                    { report: jest.fn() },
                    { isCancellationRequested: false, onCancellationRequested: jest.fn() }
                );
            });

            jest.spyOn(PicklistDependencyTestService, 'planReplacesExistingContent').mockReturnValue(true);
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation(async () => {
                callSequence.push('confirmation');
                return 'Generate';
            });

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            expect(callSequence).toEqual(['progressScope', 'confirmation', 'progressScope']);

        });

        test('given the walk cancelled, writes nothing and says nothing was changed', async () => {

            jest.spyOn(PicklistDependencyTestService, 'collectSpecDetailsByObjectsDirectory').mockResolvedValue({
                specDetails: [],
                recordTypeSpecDetails: [],
                skippedFieldWarnings: [],
                skippedFields: [],
                cancelled: true
            });

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            expect(writeSpecsClassFilesSpy).not.toHaveBeenCalled();

            const informationMessage = (vscode.window.showInformationMessage as jest.Mock).mock.calls[0][0];
            expect(informationMessage).toContain('cancelled');
            expect(informationMessage).toContain('No files were changed');

            /*
                A cancelled walk is PARTIAL by construction, so it must never fall through to the
                empty-project message -- that would report an empty project to someone who simply
                stopped the run.
            */
            expect(informationMessage).not.toContain('No dependent picklists were found');

        });

        /*
            The write is not cancellable, so there is no partial-write state to reconcile: the
            manifest is always written from the same run that emitted the classes beside it. This is
            the invariant that replaced a per-file cancel check the runtime could never have honoured.
        */
        test('writes the manifest from the same run that wrote the classes, with no cancellable window between them', async () => {

            stubCollectionResult([specDetail]);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            expect(writeSpecsClassFilesSpy).toHaveBeenCalled();
            expect(writeManifestSpy).toHaveBeenCalled();

            // THE WRITE PHASE TAKES THE PORT FOR PROGRESS ONLY -- NOTHING BETWEEN THE TWO CAN STOP IT
            const writeSpecsCallOrder = writeSpecsClassFilesSpy.mock.invocationCallOrder[0];
            const writeManifestCallOrder = writeManifestSpy.mock.invocationCallOrder[0];
            expect(writeManifestCallOrder).toBeGreaterThan(writeSpecsCallOrder);

        });

        /*
            The one path where the skips are most worth having: the user is deciding whether this
            generation is worth taking. Before the roll-up these fired ahead of the prompt and so
            were seen -- reporting them here is what keeps that.
        */
        test('given the change plan declined, still reports what was skipped', async () => {

            const skippedFields: IPicklistDependencySkippedField[] = [{
                objectApiName: 'Dependency_Example__c',
                fieldApiName: 'NoSettings__c',
                warning: 'no valueSettings markup',
                reason: 'noValueSettings'
            }];

            stubCollectionResult([specDetail], ['no valueSettings markup'], [], skippedFields);
            jest.spyOn(PicklistDependencyTestService, 'planReplacesExistingContent').mockReturnValue(true);
            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            expect(writeSpecsClassFilesSpy).not.toHaveBeenCalled();

            const warningMessages = (vscode.window.showWarningMessage as jest.Mock).mock.calls.map(warningCall => String(warningCall[0]));
            const declinedSummary = warningMessages.find(warningMessage => warningMessage.includes('were not regenerated'));

            expect(declinedSummary).toContain('1 field(s) skipped');

        });

        test('given no dependent picklists but fields that were skipped, folds the skips into the one message', async () => {

            const skippedFields: IPicklistDependencySkippedField[] = [{
                objectApiName: 'Dependency_Example__c',
                fieldApiName: 'NoSettings__c',
                warning: 'no valueSettings markup',
                reason: 'noValueSettings'
            }];

            stubCollectionResult([], ['no valueSettings markup'], [], skippedFields);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            const warningMessage = (vscode.window.showWarningMessage as jest.Mock).mock.calls[0][0];

            expect(warningMessage).toContain('No dependent picklists were found');
            expect(warningMessage).toContain('1 field(s) skipped');

        });

        test('given no dependent picklists and nothing skipped, reports only that none were found', async () => {

            stubCollectionResult([]);

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            const informationMessage = (vscode.window.showInformationMessage as jest.Mock).mock.calls[0][0];

            expect(informationMessage).toContain('No dependent picklists were found');
            expect(writeSpecsClassFilesSpy).not.toHaveBeenCalled();

        });

        /*
            The progress wrapper must not swallow a throw -- an unwritable classes directory has to
            reach the same error handler it did before generation reported progress at all.
        */
        test('given a throw inside the progress scope, still routes it through ErrorHandlingService', async () => {

            jest.spyOn(PicklistDependencyTestService, 'collectSpecDetailsByObjectsDirectory')
                .mockRejectedValue(new Error('objects directory could not be read'));

            await extensionCommandService.generatePicklistDependencyTests(extensionPath);

            expect(handleCapturedErrorSpy).toHaveBeenCalledWith(expect.any(Error), 'generatePicklistDependencyTests');

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

    /*
        generateRecipeFromConfigurationDetail had NO coverage at all, which is why a call that never
        loaded the global value sets survived here after the same bug was found and fixed on three
        other call sites. Both tests below assert what the command ACHIEVES rather than which
        arguments it passed on, because an argument-tuple assertion is exactly what failed to catch
        this elsewhere.
    */
    describe('generateRecipeFromConfigurationDetail', () => {

        const workspaceRoot = '/workspace';

        const territoryGlobalValueSetXml = `<?xml version="1.0" encoding="UTF-8"?>
<GlobalValueSet xmlns="http://soap.sforce.com/2006/04/metadata">
    <customValue>
        <fullName>Territory_North</fullName>
        <label>Territory North</label>
    </customValue>
    <masterLabel>SDT Territory Values</masterLabel>
</GlobalValueSet>`;

        let extensionCommandService: ExtensionCommandService;

        beforeEach(() => {

            jest.clearAllMocks();

            /*
                The singleton is module level and survives every test in this file. Without this reset
                these tests pass on state a SIBLING test left behind: the ordering assertion below was
                satisfied by a leftover map even with the await removed, which made it incapable of
                failing on the defect it exists to catch.
            */
            (GlobalValueSetSingleton.getInstance() as any).globalValueSets = undefined;

            extensionCommandService = new ExtensionCommandService();

            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue(workspaceRoot);
            jest.spyOn(ConfigurationService, 'getObjectsPathFromTreecipeJSONConfiguration')
                .mockReturnValue('./force-app/main/default/objects');
            jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);

            /*
                The DirectoryProcessor CONSTRUCTOR resolves the configured faker service and throws
                when there is no configuration, which would abort the command immediately after the
                global value sets load -- silently, since the command catches. Stubbed so the run
                actually reaches the walk these tests are about.
            */
            jest.spyOn(ConfigurationService, 'getFakerImplementationByExtensionConfigSelection')
                .mockReturnValue(new FakerJSRecipeFakerService());

            jest.spyOn(DirectoryProcessor.prototype, 'createRecipeFilesInSubdirectory').mockResolvedValue(undefined as any);

            // A REAL globalValueSets DIRECTORY HOLDING ONE SET, READ THROUGH THE SAME CALL THE COMMAND MAKES
            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            // "Once" NOT "mockResolvedValue": the vscode factory's jest.fn is shared file-wide and clearAllMocks does not clear implementations
            (vscode.workspace.fs.readDirectory as jest.Mock).mockResolvedValueOnce([
                ['SDT_Territory_Values.globalValueSet-meta.xml', 1]
            ]);
            jest.spyOn(GlobalValueSetSingleton.getInstance(), 'getGlobalValueSetPicklistXMLFileContent')
                .mockResolvedValue(territoryGlobalValueSetXml);

        });

        test('given the recipe command, loads the global value sets beside the objects directory', async () => {

            const processAllObjectsSpy = jest.spyOn(DirectoryProcessor.prototype, 'processAllObjectsAndRelationships')
                .mockResolvedValue({} as any);

            await extensionCommandService.generateRecipeFromConfigurationDetail();

            const picklistValuesByGlobalValueSetName = GlobalValueSetSingleton.getInstance().getPicklistValueMaps();

            expect(picklistValuesByGlobalValueSetName).toBeTruthy();
            expect(picklistValuesByGlobalValueSetName['SDT_Territory_Values']).toEqual(['Territory_North']);

            // THE COMMAND MUST HAVE RUN TO COMPLETION -- THE COMMAND BODY CATCHES, SO AN ABORTED RUN IS OTHERWISE INVISIBLE
            expect(processAllObjectsSpy).toHaveBeenCalled();

        });

        /*
            The missing await is a SEPARATE defect from the flag, and correcting the flag alone would
            leave it: the walk could still start before the sets finished loading. Asserting the final
            state cannot see that race, so this captures what the singleton held at the moment the walk
            began -- the only point where the ordering is observable.
        */
        test('given the recipe command, finishes loading the sets before the objects walk begins', async () => {

            /*
                A set name of its OWN, distinct from the sibling test's. Sharing one meant a leftover
                map satisfied this assertion whether or not the load had finished, so it could not
                fail on a missing await.
            */
            (vscode.workspace.fs.readDirectory as jest.Mock).mockReset();
            (vscode.workspace.fs.readDirectory as jest.Mock).mockResolvedValueOnce([
                ['SDT_Region_Values.globalValueSet-meta.xml', 1]
            ]);
            jest.spyOn(GlobalValueSetSingleton.getInstance(), 'getGlobalValueSetPicklistXMLFileContent')
                .mockResolvedValue(`<?xml version="1.0" encoding="UTF-8"?>
<GlobalValueSet xmlns="http://soap.sforce.com/2006/04/metadata">
    <customValue>
        <fullName>Region_West</fullName>
        <label>Region West</label>
    </customValue>
    <masterLabel>SDT Region Values</masterLabel>
</GlobalValueSet>`);

            let globalValueSetsAtTheMomentTheWalkBegan: Record<string, string[]> | null | undefined;

            jest.spyOn(DirectoryProcessor.prototype, 'processAllObjectsAndRelationships')
                .mockImplementation(async () => {
                    globalValueSetsAtTheMomentTheWalkBegan = GlobalValueSetSingleton.getInstance().getPicklistValueMaps();
                    return {} as any;
                });

            await extensionCommandService.generateRecipeFromConfigurationDetail();

            expect(globalValueSetsAtTheMomentTheWalkBegan).toBeTruthy();
            expect(globalValueSetsAtTheMomentTheWalkBegan['SDT_Region_Values']).toEqual(['Region_West']);

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

            jest.spyOn(PicklistDependencyCheckService, 'isSpecsTestSuiteDeployedInOrg').mockResolvedValue(true);

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

            jest.spyOn(PicklistDependencyCheckService, 'isSpecsTestSuiteDeployedInOrg').mockResolvedValue(false);
            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);

            await extensionCommandService.runPicklistDependencyCheck();

            expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
                expect.stringContaining('does not exist, or no longer contains'),
                { modal: true },
                'Deploy and Run'
            );
            expect(deployPicklistDependencyClassesSpy).not.toHaveBeenCalled();
            expect(runPicklistDependencyTestsSpy).not.toHaveBeenCalled();
            expect((vscode.window.showInformationMessage as jest.Mock).mock.calls[0][0]).toContain('Nothing was deployed');

        });

        test('given a missing test class and a confirmed deploy, deploys then runs the check', async () => {

            jest.spyOn(PicklistDependencyCheckService, 'isSpecsTestSuiteDeployedInOrg').mockResolvedValue(false);
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

            jest.spyOn(PicklistDependencyCheckService, 'isSpecsTestSuiteDeployedInOrg').mockResolvedValue(false);

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

        const manifestFilePath = '/workspace/treecipe/PicklistDependencySpecs/manifest.json';

        function buildStubManifest(specDetails: IPicklistDependencySpecDetail[] = [chainSpecDetail],
                                    recordTypeSpecDetails: IRecordTypePicklistDependencySpecDetail[] = [],
                                    skippedFields: IPicklistDependencySkippedField[] = []) {

            return PicklistDependencyManifestService.buildManifest(
                { specDetails, recordTypeSpecDetails, skippedFieldWarnings: skippedFields.map(skippedField => skippedField.warning), skippedFields },
                objectsDirectoryPath,
                '/workspace/force-app/main/default/classes',
                '9.9.9',
                '2026-01-01T00:00:00Z',
                'stub-fingerprint'
            );

        }

        function stubLoadedManifest(manifest = buildStubManifest()) {

            jest.spyOn(PicklistDependencyManifestService, 'loadManifest')
                .mockReturnValue({ state: 'loaded', message: '', manifest, manifestFilePath });

            jest.spyOn(PicklistDependencyManifestService, 'resolveManifestFreshness')
                .mockReturnValue({ freshness: 'fresh', message: '' });

        }

        let extensionCommandService: ExtensionCommandService;
        let handleCapturedErrorSpy: jest.SpyInstance;
        let createdWebviewPanel: any;
        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let registeredDisposeHandler: () => void;
        const registeredMessageSubscriptions: { dispose: jest.Mock }[] = [];
        const postedPanelMessages: any[] = [];

        /*
            Turned off by the few tests that need to observe the window BEFORE the panel is listening
            -- what the host stores, and what it refuses to act on, while nothing is on screen yet.
        */
        let isPanelReadyAutoAnnounced = true;

        // THE MODEL THE PANEL WAS LAST TOLD TO RENDER, WHICH IS WHAT "RENDERED" MEANS NOW THAT IT IS POSTED
        function getRenderedViewModel(): IPicklistDependencyExplorerViewModel {

            const renderMessages = postedPanelMessages.filter(postedMessage => postedMessage.command === 'renderModel');
            return renderMessages[renderMessages.length - 1]?.model;

        }

        // WHAT A REVEAL WOULD BE ANSWERED WITH: THE HOST'S OWN COPY, WHICH THE LATE FRESHNESS ANSWER UPDATES
        function getReplayRenderMessage(): any {

            return (ExtensionCommandService as any).picklistDependencyExplorerRenderMessage;

        }

        function getPostedPhaseMessages(): string[] {

            return postedPanelMessages
                .filter(postedMessage => postedMessage.command === 'loadPhase')
                .map(postedMessage => postedMessage.message);

        }

        beforeEach(() => {

            extensionCommandService = new ExtensionCommandService();

            /*
                These live on the module factory rather than on a spy, so restoreMocks does not
                reach them and their call history would otherwise carry between tests.
            */
            (vscode.window.createWebviewPanel as jest.Mock).mockClear();
            (vscode.commands.executeCommand as jest.Mock).mockClear();

            // THE PREVIEW OPT IN IS OFFERED THROUGH THIS ONE, SO ITS CALL HISTORY WOULD CARRY BETWEEN TESTS TOO
            (vscode.window.showInformationMessage as jest.Mock).mockClear();
            (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);

            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue(workspaceRoot);
            jest.spyOn(ConfigurationService, 'getObjectsPathFromTreecipeJSONConfiguration')
                .mockReturnValue('./force-app/main/default/objects');
            jest.spyOn(fs, 'existsSync').mockReturnValue(true);

            jest.spyOn(PicklistDependencyTestService, 'collectSpecDetailsByObjectsDirectory')
                .mockResolvedValue({ specDetails: [chainSpecDetail], recordTypeSpecDetails: [], skippedFieldWarnings: [], skippedFields: [] });

            /*
                The manifest is the panel's normal source now, so it is stubbed for every test here
                and overridden by the few that assert the no-manifest paths. It is built through the
                real buildManifest rather than hand written, so these tests exercise the same shape
                the generate command writes rather than one that could drift from it.
            */
            stubLoadedManifest();

            handleCapturedErrorSpy = jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);

            postedPanelMessages.length = 0;
            isPanelReadyAutoAnnounced = true;

            createdWebviewPanel = {
                reveal: jest.fn(),
                dispose: jest.fn(),
                onDidDispose: jest.fn().mockImplementation(disposeHandler => {
                    registeredDisposeHandler = disposeHandler;
                    return { dispose: jest.fn() };
                }),
                webview: {
                    html: '',
                    /*
                        The model reaches the panel through here now rather than through the html, so
                        what was posted IS the render. Tests that used to read the document read this.
                    */
                    postMessage: jest.fn().mockImplementation((hostMessage: any) => {
                        postedPanelMessages.push(hostMessage);
                        return Promise.resolve(true);
                    }),
                    /*
                        A real webview announces itself once its document has loaded, and the host
                        posts nothing until it does. The fake does the same on the next turn of the
                        event loop, so these tests exercise the handshake rather than a host that
                        posts into the void -- the load yields between phases, so this lands mid-load
                        exactly as it does in a window.
                    */
                    onDidReceiveMessage: jest.fn().mockImplementation(messageHandler => {
                        receivedMessageHandler = messageHandler;
                        const messageSubscription = { dispose: jest.fn() };
                        registeredMessageSubscriptions.push(messageSubscription);
                        if (isPanelReadyAutoAnnounced) {
                            setImmediate(() => messageHandler({ command: 'ready' }));
                        }
                        return messageSubscription;
                    })
                }
            };

            registeredMessageSubscriptions.length = 0;

            /*
                The panel is held on the class so it can be reused across invocations, which means it
                also survives between tests unless it is cleared.
            */
            (ExtensionCommandService as any).picklistDependencyExplorerPanel = undefined;
            (ExtensionCommandService as any).picklistDependencyExplorerMessageSubscription = undefined;
            (ExtensionCommandService as any).picklistDependencyExplorerRenderMessage = undefined;
            (ExtensionCommandService as any).picklistDependencyExplorerFreshnessMessage = undefined;
            (ExtensionCommandService as any).picklistDependencyExplorerLoadPhaseMessage = '';
            (ExtensionCommandService as any).picklistDependencyExplorerLoadFailedMessage = undefined;
            (ExtensionCommandService as any).picklistDependencyExplorerIsPanelReady = false;

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
                { enableScripts: true, localResourceRoots: [] }
            );

            expect(createdWebviewPanel.webview.html).toContain('Picklist Dependency Explorer');
            expect(createdWebviewPanel.webview.html).toContain(`default-src 'none'`);

            // THE STRUCTURE IS POSTED, NOT EMBEDDED -- THE DOCUMENT IS A SHELL THAT KNOWS NOTHING ABOUT THIS ORG
            expect(createdWebviewPanel.webview.html).not.toContain('State__c');
            expect(getRenderedViewModel().objects[0].rootNodes[0].fieldApiName).toBe('State__c');

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

        /*
            Slice 3 of #83: a failed combination links to the code that generated it and to the run
            entry that reported it. Each handler below is gated by its OWN allow-list, built from the
            model this render was built from -- a file the model names cannot be combined with a
            method name the model never named.
        */
        test('given an open spec method message the model names, opens the generated class at the declaration', async () => {

            jest.spyOn(PicklistDependencyExplorerService, 'loadLatestResults')
                .mockReturnValue({ state: 'noResultsFound', message: 'no check has been run' });

            const openFileInEditorSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);

            jest.spyOn(fs, 'readFileSync').mockReturnValue(
                'public class SDTChainExampleSpecs {\n\n    public static SDTPicklistDependencySpec specForState() {\n    }\n}'
            );

            await extensionCommandService.openPicklistDependencyExplorer();

            const renderedViewModel = getRenderedViewModel();

            const objectViewModel = renderedViewModel.objects[0];
            const specMethodName = objectViewModel.rootNodes[0].specMethodName;

            await receivedMessageHandler({
                command: 'openSpecMethod',
                specFilePath: objectViewModel.generatedClassFilePath,
                methodName: specMethodName
            });

            expect(openFileInEditorSpy).toHaveBeenCalledWith(objectViewModel.generatedClassFilePath, expect.any(Number));

        });

        test('given an open spec method message pairing a real file with a method the model never named, opens nothing', async () => {

            jest.spyOn(PicklistDependencyExplorerService, 'loadLatestResults')
                .mockReturnValue({ state: 'noResultsFound', message: 'no check has been run' });

            const openFileInEditorSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);

            await extensionCommandService.openPicklistDependencyExplorer();

            const renderedViewModel = getRenderedViewModel();

            await receivedMessageHandler({
                command: 'openSpecMethod',
                specFilePath: renderedViewModel.objects[0].generatedClassFilePath,
                methodName: 'deleteEverything'
            });

            expect(openFileInEditorSpy).not.toHaveBeenCalled();

        });

        test('given an open run report message the model names, opens the report at that method entry', async () => {

            const reportFilePath = '/workspace/treecipe/PicklistDependencyResults/check-devHub-2026-09-03T09-00-00/report.md';

            jest.spyOn(PicklistDependencyExplorerService, 'loadLatestResults')
                .mockReturnValue({
                    state: 'loaded',
                    message: '',
                    resultsFilePath: '/workspace/treecipe/PicklistDependencyResults/check-devHub-2026-09-03T09-00-00/results.json',
                    results: {
                        targetOrg: 'devHub',
                        ranAt: '2026-09-03T09:00:00Z',
                        passed: true,
                        failureCount: 0,
                        methodsRun: 1,
                        methodOutcomes: []
                    }
                });

            const openFileInEditorSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);

            await extensionCommandService.openPicklistDependencyExplorer();

            const renderedViewModel = getRenderedViewModel();

            const testMethodName = renderedViewModel.objects[0].testMethodName;

            jest.spyOn(fs, 'readFileSync').mockReturnValue(`# Picklist Dependency Check\n\n### ${testMethodName}\n`);

            await receivedMessageHandler({
                command: 'openRunReport',
                reportFilePath: renderedViewModel.runSummary.reportFilePath,
                methodName: testMethodName
            });

            expect(renderedViewModel.runSummary.reportFilePath).toBe(reportFilePath);
            expect(openFileInEditorSpy).toHaveBeenCalledWith(reportFilePath, 3);

        });

        test('given an open run report message naming a file the model never named, opens nothing', async () => {

            jest.spyOn(PicklistDependencyExplorerService, 'loadLatestResults')
                .mockReturnValue({ state: 'noResultsFound', message: 'no check has been run' });

            const openFileInEditorSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);

            await extensionCommandService.openPicklistDependencyExplorer();

            await receivedMessageHandler({
                command: 'openRunReport',
                reportFilePath: '/etc/passwd',
                methodName: 'anything'
            });

            expect(openFileInEditorSpy).not.toHaveBeenCalled();

        });

        test('given a copy reference message naming a combination the model declares, copies exactly that key', async () => {

            jest.spyOn(PicklistDependencyExplorerService, 'loadLatestResults')
                .mockReturnValue({ state: 'noResultsFound', message: 'no check has been run' });

            const copyTextToClipboardSpy = jest.spyOn(VSCodeWorkspaceService, 'copyTextToClipboard').mockResolvedValue(undefined);
            jest.spyOn(VSCodeWorkspaceService, 'showInformationMessage').mockImplementation(() => undefined);

            await extensionCommandService.openPicklistDependencyExplorer();

            await receivedMessageHandler({ command: 'copyCombinationReference', combinationKey: 'Chain_Example__c.State__c @ USA' });

            expect(copyTextToClipboardSpy).toHaveBeenCalledWith('Chain_Example__c.State__c @ USA');

        });

        test('given a copy reference message naming a combination the model never declared, copies nothing', async () => {

            jest.spyOn(PicklistDependencyExplorerService, 'loadLatestResults')
                .mockReturnValue({ state: 'noResultsFound', message: 'no check has been run' });

            const copyTextToClipboardSpy = jest.spyOn(VSCodeWorkspaceService, 'copyTextToClipboard').mockResolvedValue(undefined);

            await extensionCommandService.openPicklistDependencyExplorer();

            await receivedMessageHandler({ command: 'copyCombinationReference', combinationKey: 'Anything__c.Else__c @ Whatever' });

            expect(copyTextToClipboardSpy).not.toHaveBeenCalled();

        });

        test('given the generated class has since been deleted, warns rather than opening a missing path', async () => {

            jest.spyOn(PicklistDependencyExplorerService, 'loadLatestResults')
                .mockReturnValue({ state: 'noResultsFound', message: 'no check has been run' });

            const openFileInEditorSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);
            const showWarningMessageSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);

            await extensionCommandService.openPicklistDependencyExplorer();

            const renderedViewModel = getRenderedViewModel();

            (fs.existsSync as unknown as jest.Mock).mockReturnValue(false);

            await receivedMessageHandler({
                command: 'openSpecMethod',
                specFilePath: renderedViewModel.objects[0].generatedClassFilePath,
                methodName: renderedViewModel.objects[0].rootNodes[0].specMethodName
            });

            expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining('no longer exists'));
            expect(openFileInEditorSpy).not.toHaveBeenCalled();

        });

        test('given a manifest carrying record type scopes, renders them from the manifest rather than from metadata', async () => {

            const recordTypeSpecDetail: IRecordTypePicklistDependencySpecDetail = {
                objectApiName: 'Chain_Example__c',
                fieldApiName: 'State__c',
                controllingFieldApiName: 'Country__c',
                recordTypeDeveloperName: 'North_America',
                expectations: [{ controllingValue: 'USA', dependentValues: ['Ohio'], forbiddenValues: [] }]
            };

            stubLoadedManifest(buildStubManifest([chainSpecDetail], [recordTypeSpecDetail]));

            jest.spyOn(PicklistDependencyExplorerService, 'loadLatestResults')
                .mockReturnValue({ state: 'noResultsFound', message: 'no check has been run' });

            const collectSpecDetailsSpy = jest.spyOn(PicklistDependencyTestService, 'collectSpecDetailsByObjectsDirectory');

            await extensionCommandService.openPicklistDependencyExplorer();

            expect(getRenderedViewModel().objects[0].rootNodes[0].recordTypeScopes[0].recordTypeDeveloperName)
                .toBe('North_America');

            // THE POINT OF THE MANIFEST: THE OPEN PATH DOES NOT RE-WALK THE SOURCE XML AT ALL
            expect(collectSpecDetailsSpy).not.toHaveBeenCalled();

        });

        /*
            The open path reads the manifest and stops. Proving the scan does not happen is the
            acceptance criterion itself -- a panel that still re-derived from metadata would render
            the same rows here and pass every other assertion in this file.
        */
        test('given a manifest, never re-walks the source metadata to build the panel', async () => {

            jest.spyOn(PicklistDependencyExplorerService, 'loadLatestResults')
                .mockReturnValue({ state: 'noResultsFound', message: 'no check has been run' });

            const collectSpecDetailsSpy = jest.spyOn(PicklistDependencyTestService, 'collectSpecDetailsByObjectsDirectory');

            await extensionCommandService.openPicklistDependencyExplorer();

            expect(collectSpecDetailsSpy).not.toHaveBeenCalled();
            expect(getRenderedViewModel().objects[0].rootNodes[0].fieldApiName).toBe('State__c');

        });

        test('given a manifest, every node names the generated class and spec method that asserts it', async () => {

            jest.spyOn(PicklistDependencyExplorerService, 'loadLatestResults')
                .mockReturnValue({ state: 'noResultsFound', message: 'no check has been run' });

            await extensionCommandService.openPicklistDependencyExplorer();

            const specMethodName = PicklistDependencyTestService.buildSpecMethodName('Chain_Example__c', 'State__c');
            const testMethodName = PicklistDependencyTestService.buildTestMethodNameByObjectApiName('Chain_Example__c');

            const renderedObjectViewModel = getRenderedViewModel().objects[0];

            expect(renderedObjectViewModel.rootNodes[0].specMethodName).toBe(specMethodName);
            expect(renderedObjectViewModel.testMethodName).toBe(testMethodName);

        });

        test('given a manifest recorded against changed metadata, renders a staleness banner naming the generate command', async () => {

            jest.spyOn(PicklistDependencyExplorerService, 'loadLatestResults')
                .mockReturnValue({ state: 'noResultsFound', message: 'no check has been run' });

            jest.spyOn(PicklistDependencyManifestService, 'resolveManifestFreshness')
                .mockReturnValue({
                    freshness: 'staleMetadata',
                    message: 'The object metadata has changed since these specs were generated. Run "Salesforce Treecipe: Generate Picklist Dependency Tests" to regenerate.'
                });

            await extensionCommandService.openPicklistDependencyExplorer();

            /*
                The staleness answer arrives AFTER the panel has painted, because the walk that
                produces it stats every file under the objects directory. It is posted as its own
                message, and the model the host holds is updated with it so a reveal comes back with
                the resolved answer rather than the pending one it was rendered with.
            */
            const postedFreshnessMessage = postedPanelMessages.filter(postedMessage => postedMessage.command === 'applyFreshness').pop();

            expect(postedFreshnessMessage.freshness).toBe('staleMetadata');
            expect(postedFreshnessMessage.message).toContain('Generate Picklist Dependency Tests');

            /*
                The model was PAINTED before the walk ran, so what it carried at that moment is
                "pendingCheck" -- not "fresh". Reusing fresh for the window before the answer exists
                would have the banner assert agreement with metadata nothing had looked at yet.
            */
            expect(getRenderedViewModel().manifestFreshness).toBe('pendingCheck');

            // AND THE ANSWER IS FOLDED INTO WHAT A REVEAL REPLAYS, SO IT SURVIVES THE PANEL BEING HIDDEN
            expect(getReplayRenderMessage().model.manifestFreshness).toBe('staleMetadata');

            // NEVER SILENTLY RE-DERIVED: A STALE MANIFEST IS STILL THE MANIFEST, BANNERED
            expect(PicklistDependencyTestService.collectSpecDetailsByObjectsDirectory).not.toHaveBeenCalled();

        });

        test('given no manifest and the preview declined, leaves no panel behind', async () => {

            jest.spyOn(PicklistDependencyManifestService, 'loadManifest')
                .mockReturnValue({ state: 'noManifestFound', message: 'no manifest was found' });

            (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);

            await extensionCommandService.openPicklistDependencyExplorer();

            /*
                The shell is opened before the manifest is read, so that the read has somewhere to
                report itself -- but declining the scan still ends with nothing on screen. Nothing was
                ever rendered into it: a workspace with no manifest fails the read on the existsSync.
            */
            expect(createdWebviewPanel.dispose).toHaveBeenCalled();
            expect(postedPanelMessages.filter(postedMessage => postedMessage.command === 'renderModel')).toHaveLength(0);
            expect(PicklistDependencyTestService.collectSpecDetailsByObjectsDirectory).not.toHaveBeenCalled();
            expect(handleCapturedErrorSpy).not.toHaveBeenCalled();

        });

        test('given no manifest and the preview accepted, scans metadata and banners every row un-asserted', async () => {

            jest.spyOn(PicklistDependencyManifestService, 'loadManifest')
                .mockReturnValue({ state: 'noManifestFound', message: 'no manifest was found' });
            jest.spyOn(PicklistDependencyExplorerService, 'loadLatestResults')
                .mockReturnValue({ state: 'noResultsFound', message: 'no check has been run' });

            (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(PREVIEW_FROM_METADATA_ACTION_LABEL);

            await extensionCommandService.openPicklistDependencyExplorer();

            expect(PicklistDependencyTestService.collectSpecDetailsByObjectsDirectory).toHaveBeenCalled();
            expect(getRenderedViewModel().objects[0].rootNodes[0].fieldApiName).toBe('State__c');
            expect(getRenderedViewModel().modelSource).toBe('metadataPreview');

        });

        /*
            Handled exactly as an unreadable results.json is: a readable message and the structure
            the user CAN be offered, never a blank panel and never a silent fall back that would
            render un-asserted rows as though specs existed for them.
        */
        test('given a malformed manifest, reports it and offers the metadata preview rather than blanking', async () => {

            jest.spyOn(PicklistDependencyManifestService, 'loadManifest')
                .mockReturnValue({
                    state: 'unreadableManifest',
                    message: 'the manifest could not be read as JSON',
                    manifestFilePath: manifestFilePath
                });
            jest.spyOn(PicklistDependencyExplorerService, 'loadLatestResults')
                .mockReturnValue({ state: 'noResultsFound', message: 'no check has been run' });

            (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(PREVIEW_FROM_METADATA_ACTION_LABEL);

            await extensionCommandService.openPicklistDependencyExplorer();

            expect((vscode.window.showInformationMessage as jest.Mock).mock.calls[0][0])
                .toContain('could not be read as JSON');
            expect(getRenderedViewModel().modelSource).toBe('metadataPreview');
            expect(handleCapturedErrorSpy).not.toHaveBeenCalled();

        });

        test('given no dependent picklists at all, the preview still opens the panel with the empty state', async () => {

            jest.spyOn(PicklistDependencyManifestService, 'loadManifest')
                .mockReturnValue({ state: 'noManifestFound', message: 'no manifest was found' });

            jest.spyOn(PicklistDependencyTestService, 'collectSpecDetailsByObjectsDirectory')
                .mockResolvedValue({ specDetails: [], recordTypeSpecDetails: [], skippedFieldWarnings: [], skippedFields: [] });
            jest.spyOn(PicklistDependencyExplorerService, 'loadLatestResults')
                .mockReturnValue({ state: 'noResultsFound', message: 'no check has been run' });

            (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(PREVIEW_FROM_METADATA_ACTION_LABEL);

            await extensionCommandService.openPicklistDependencyExplorer();

            expect(vscode.window.createWebviewPanel).toHaveBeenCalled();
            expect(postedPanelMessages.filter(postedMessage => postedMessage.command === 'renderModel').pop().emptyStateMessage)
                .toContain('No dependent picklists were found in');
            expect(handleCapturedErrorSpy).not.toHaveBeenCalled();

        });

        test('given a manifest carrying a skipped field, renders it as not asserted rather than omitting it', async () => {

            const skippedField: IPicklistDependencySkippedField = {
                objectApiName: 'Chain_Example__c',
                fieldApiName: 'Unspecced__c',
                warning: 'No "valueSettings" markup found for dependent picklist "Chain_Example__c.Unspecced__c" controlled by "Country__c" -- no spec was generated for this field.',
                reason: 'noValueSettings'
            };

            stubLoadedManifest(buildStubManifest([chainSpecDetail], [], [skippedField]));

            jest.spyOn(PicklistDependencyExplorerService, 'loadLatestResults')
                .mockReturnValue({ state: 'noResultsFound', message: 'no check has been run' });

            await extensionCommandService.openPicklistDependencyExplorer();

            const renderedSkippedField = getRenderedViewModel().objects[0].skippedFields[0];

            expect(renderedSkippedField.fieldApiName).toBe('Unspecced__c');
            expect(renderedSkippedField.warning).toContain('valueSettings');

        });

        test('given no objects directory on disk, routes the error through ErrorHandlingService', async () => {

            (fs.existsSync as unknown as jest.Mock).mockReturnValue(false);

            await extensionCommandService.openPicklistDependencyExplorer();

            expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
            expect(handleCapturedErrorSpy).toHaveBeenCalled();
            expect(handleCapturedErrorSpy.mock.calls[0][0].message).toContain('No objects directory found');
            expect(handleCapturedErrorSpy.mock.calls[0][1]).toBe('openPicklistDependencyExplorer');

        });


        test('given the command is run twice, reuses the one panel and reveals it rather than stacking tabs', async () => {

            jest.spyOn(PicklistDependencyExplorerService, 'loadLatestResults')
                .mockReturnValue({ state: 'noResultsFound', message: 'no check has been run' });

            await extensionCommandService.openPicklistDependencyExplorer();
            await extensionCommandService.openPicklistDependencyExplorer();

            expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
            expect(createdWebviewPanel.reveal).toHaveBeenCalledTimes(2);

        });

        /*
            The second render builds a fresh allow-list. A listener left over from the first would
            still be answering reveal messages against the paths it captured, so it is disposed.
        */
        test('given the command is run twice, disposes the previous message listener', async () => {

            jest.spyOn(PicklistDependencyExplorerService, 'loadLatestResults')
                .mockReturnValue({ state: 'noResultsFound', message: 'no check has been run' });

            await extensionCommandService.openPicklistDependencyExplorer();
            await extensionCommandService.openPicklistDependencyExplorer();

            expect(registeredMessageSubscriptions).toHaveLength(2);
            expect(registeredMessageSubscriptions[0].dispose).toHaveBeenCalled();
            expect(registeredMessageSubscriptions[1].dispose).not.toHaveBeenCalled();

        });

        test('given the panel is closed, drops the reference so the next run creates a new one', async () => {

            jest.spyOn(PicklistDependencyExplorerService, 'loadLatestResults')
                .mockReturnValue({ state: 'noResultsFound', message: 'no check has been run' });

            await extensionCommandService.openPicklistDependencyExplorer();
            registeredDisposeHandler();
            await extensionCommandService.openPicklistDependencyExplorer();

            expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(2);

        });

        test('reports every phase into the panel and the status bar rather than leaving the command looking inert', async () => {

            jest.spyOn(PicklistDependencyExplorerService, 'loadLatestResults')
                .mockReturnValue({ state: 'noResultsFound', message: 'no check has been run' });

            const statusBarPhaseItem = { text: '', show: jest.fn(), dispose: jest.fn() };
            (vscode.window.createStatusBarItem as jest.Mock).mockReturnValue(statusBarPhaseItem);

            await extensionCommandService.openPicklistDependencyExplorer();

            expect(getPostedPhaseMessages()).toEqual([
                PICKLIST_DEPENDENCY_EXPLORER_LOAD_PHASES.readingManifest,
                PICKLIST_DEPENDENCY_EXPLORER_LOAD_PHASES.loadingResults,
                PICKLIST_DEPENDENCY_EXPLORER_LOAD_PHASES.buildingView
            ]);

            // THE PANEL PAINTS BEFORE THE FRESHNESS WALK, AND CARRIES THAT PHASE WITH IT
            const renderMessage = postedPanelMessages.filter(postedMessage => postedMessage.command === 'renderModel').pop();
            expect(renderMessage.message).toBe(PICKLIST_DEPENDENCY_EXPLORER_LOAD_PHASES.checkingFreshness);

            expect(statusBarPhaseItem.show).toHaveBeenCalled();
            expect(statusBarPhaseItem.dispose).toHaveBeenCalled();

        });

        test('paints the structure before the freshness walk runs, so the slowest phase is not blocking the first paint', async () => {

            jest.spyOn(PicklistDependencyExplorerService, 'loadLatestResults')
                .mockReturnValue({ state: 'noResultsFound', message: 'no check has been run' });

            const phaseOrder: string[] = [];

            (createdWebviewPanel.webview.postMessage as jest.Mock).mockImplementation((hostMessage: any) => {
                phaseOrder.push(hostMessage.command);
                postedPanelMessages.push(hostMessage);
                return Promise.resolve(true);
            });

            jest.spyOn(PicklistDependencyManifestService, 'resolveManifestFreshness')
                .mockImplementation(() => {
                    phaseOrder.push('resolveManifestFreshness');
                    return { freshness: 'fresh', message: '' };
                });

            await extensionCommandService.openPicklistDependencyExplorer();

            expect(phaseOrder.indexOf('renderModel')).toBeLessThan(phaseOrder.indexOf('resolveManifestFreshness'));

        });

        test('given a panel reload after being hidden, replays the model and the freshness answer without rebuilding either', async () => {

            jest.spyOn(PicklistDependencyExplorerService, 'loadLatestResults')
                .mockReturnValue({ state: 'noResultsFound', message: 'no check has been run' });

            const resolveManifestFreshnessSpy = jest.spyOn(PicklistDependencyManifestService, 'resolveManifestFreshness')
                .mockReturnValue({ freshness: 'staleMetadata', message: 'metadata has changed' });

            const buildExplorerViewModelByManifestSpy = jest.spyOn(PicklistDependencyExplorerService, 'buildExplorerViewModelByManifest');

            await extensionCommandService.openPicklistDependencyExplorer();

            const buildCallCountAfterOpen = buildExplorerViewModelByManifestSpy.mock.calls.length;
            const freshnessCallCountAfterOpen = resolveManifestFreshnessSpy.mock.calls.length;
            postedPanelMessages.length = 0;

            /*
                retainContextWhenHidden is deliberately off, so revealing a hidden panel reloads the
                document and it asks for its content again. The host answers from what it holds --
                nothing is re-read, re-built, or re-walked.
            */
            await receivedMessageHandler({ command: 'ready' });

            expect(postedPanelMessages.map(postedMessage => postedMessage.command)).toEqual(['renderModel', 'applyFreshness']);
            expect(postedPanelMessages[0].model.objects[0].rootNodes[0].fieldApiName).toBe('State__c');
            expect(postedPanelMessages[1].freshness).toBe('staleMetadata');

            expect(buildExplorerViewModelByManifestSpy).toHaveBeenCalledTimes(buildCallCountAfterOpen);
            expect(resolveManifestFreshnessSpy).toHaveBeenCalledTimes(freshnessCallCountAfterOpen);

        });

        test('given a load that failed, a reveal comes back saying it failed rather than reporting a load still running', async () => {

            jest.spyOn(PicklistDependencyManifestService, 'loadManifest')
                .mockImplementation(() => {
                    throw new Error('manifest read exploded');
                });

            await extensionCommandService.openPicklistDependencyExplorer();

            postedPanelMessages.length = 0;
            await receivedMessageHandler({ command: 'ready' });

            const replayedMessage = postedPanelMessages[0];

            expect(replayedMessage.command).toBe('loadFailed');
            expect(replayedMessage.message).toContain('could not finish loading');

        });

        test('given a mid-load reveal before any model exists, replays the phase it is still on', async () => {

            isPanelReadyAutoAnnounced = false;

            jest.spyOn(PicklistDependencyExplorerService, 'loadLatestResults')
                .mockReturnValue({ state: 'noResultsFound', message: 'no check has been run' });

            await extensionCommandService.openPicklistDependencyExplorer();

            /*
                Nothing was posted while the panel was not listening -- it was all stored. The first
                thing it receives on announcing itself is the state the load had reached.
            */
            expect(postedPanelMessages).toHaveLength(0);

            (ExtensionCommandService as any).picklistDependencyExplorerRenderMessage = undefined;
            (ExtensionCommandService as any).picklistDependencyExplorerFreshnessMessage = undefined;
            (ExtensionCommandService as any).picklistDependencyExplorerLoadPhaseMessage =
                PICKLIST_DEPENDENCY_EXPLORER_LOAD_PHASES.buildingView;

            await receivedMessageHandler({ command: 'ready' });

            expect(postedPanelMessages[0].command).toBe('loadPhase');
            expect(postedPanelMessages[0].message).toBe(PICKLIST_DEPENDENCY_EXPLORER_LOAD_PHASES.buildingView);

        });

        test('posts the model exactly once per open, never both eagerly and again on the handshake', async () => {

            jest.spyOn(PicklistDependencyExplorerService, 'loadLatestResults')
                .mockReturnValue({ state: 'noResultsFound', message: 'no check has been run' });

            await extensionCommandService.openPicklistDependencyExplorer();

            /*
                A webview drops what is posted before it loads, so the host stores every message and
                posts on the handshake. Doing BOTH would deliver the model twice and re-render the
                whole panel for nothing -- at this org's size that is a second full serialization of
                the payload.
            */
            const renderMessages = postedPanelMessages.filter(postedMessage => postedMessage.command === 'renderModel');

            expect(renderMessages).toHaveLength(1);

        });

        test('given the panel closed part way through the metadata preview scan, posts nothing and raises no error', async () => {

            jest.spyOn(PicklistDependencyManifestService, 'loadManifest')
                .mockReturnValue({ state: 'noManifestFound', message: 'no manifest was found' });

            (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(PREVIEW_FROM_METADATA_ACTION_LABEL);

            jest.spyOn(PicklistDependencyExplorerService, 'loadLatestResults')
                .mockReturnValue({ state: 'noResultsFound', message: 'no check has been run' });

            /*
                The scan takes seconds and the command now awaits it, so the tab can be closed across
                it -- which was impossible before the panel was opened first. Posting into a disposed
                webview throws, and that throw would reach the error handler and offer to file a
                GitHub issue for the ordinary act of closing a tab.
            */
            jest.spyOn(PicklistDependencyTestService, 'collectSpecDetailsByObjectsDirectory')
                .mockImplementation(async () => {
                    registeredDisposeHandler();
                    return { specDetails: [chainSpecDetail], recordTypeSpecDetails: [], skippedFieldWarnings: [], skippedFields: [] };
                });

            await extensionCommandService.openPicklistDependencyExplorer();

            expect(postedPanelMessages.filter(postedMessage => postedMessage.command === 'renderModel')).toHaveLength(0);
            expect(handleCapturedErrorSpy).not.toHaveBeenCalled();

        });

        test('given the panel closed before the model was built, renders nothing into it and posts nothing', async () => {

            jest.spyOn(PicklistDependencyExplorerService, 'loadLatestResults')
                .mockImplementation(() => {
                    registeredDisposeHandler();
                    return { state: 'noResultsFound', message: 'no check has been run' };
                });

            await extensionCommandService.openPicklistDependencyExplorer();

            expect(postedPanelMessages.filter(postedMessage => postedMessage.command === 'renderModel')).toHaveLength(0);
            expect((ExtensionCommandService as any).picklistDependencyExplorerRenderMessage).toBeUndefined();
            expect(handleCapturedErrorSpy).not.toHaveBeenCalled();

        });

        test('given the panel closed while the freshness walk was running, posts no answer into it', async () => {

            jest.spyOn(PicklistDependencyExplorerService, 'loadLatestResults')
                .mockReturnValue({ state: 'noResultsFound', message: 'no check has been run' });

            jest.spyOn(PicklistDependencyManifestService, 'resolveManifestFreshness')
                .mockImplementation(() => {
                    registeredDisposeHandler();
                    return { freshness: 'staleMetadata', message: 'metadata has changed' };
                });

            await extensionCommandService.openPicklistDependencyExplorer();

            expect(postedPanelMessages.filter(postedMessage => postedMessage.command === 'applyFreshness')).toHaveLength(0);
            expect(handleCapturedErrorSpy).not.toHaveBeenCalled();

        });

        test('given a second open, does not replay the previous load freshness answer onto the new model', async () => {

            jest.spyOn(PicklistDependencyExplorerService, 'loadLatestResults')
                .mockReturnValue({ state: 'noResultsFound', message: 'no check has been run' });

            const resolveManifestFreshnessSpy = jest.spyOn(PicklistDependencyManifestService, 'resolveManifestFreshness')
                .mockReturnValue({ freshness: 'staleMetadata', message: 'metadata has changed' });

            await extensionCommandService.openPicklistDependencyExplorer();

            resolveManifestFreshnessSpy.mockImplementation(() => {
                throw new Error('the second load never gets its answer');
            });

            await extensionCommandService.openPicklistDependencyExplorer();

            postedPanelMessages.length = 0;
            await receivedMessageHandler({ command: 'ready' });

            // THE FIRST LOAD'S "STALE" MUST NOT BANNER THE SECOND LOAD'S MODEL
            expect(postedPanelMessages.filter(postedMessage => postedMessage.command === 'applyFreshness')).toHaveLength(0);

        });

        test('given a panel action before any model has been rendered, refuses it', async () => {

            jest.spyOn(PicklistDependencyManifestService, 'loadManifest')
                .mockImplementation(() => {
                    throw new Error('manifest read exploded');
                });

            const openFileInEditorSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);

            await extensionCommandService.openPicklistDependencyExplorer();

            /*
                The panel exists before any model does, and every allow-list is built FROM a model.
                In that window there is nothing on screen an action could have come from, so each one
                is refused -- the allow-lists start empty rather than starting permissive.
            */
            await receivedMessageHandler({ command: 'revealFieldSource', sourceFilePath: stateFieldSourceFilePath });
            await receivedMessageHandler({ command: 'openSpecMethod', specFilePath: '/workspace/anything.cls', methodName: 'specForState' });

            expect(openFileInEditorSpy).not.toHaveBeenCalled();
            expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith('revealInExplorer', expect.anything());

        });

        test('given no workspace, routes the error through ErrorHandlingService', async () => {

            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue(undefined);

            await extensionCommandService.openPicklistDependencyExplorer();

            expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
            expect(handleCapturedErrorSpy.mock.calls[0][1]).toBe('openPicklistDependencyExplorer');

        });

    });

    /*
        The writeback command. It runs OPPOSITE to Generate, and it is the only command in this
        extension that rewrites a developer's source metadata -- so the thing worth pinning down is
        that nothing reaches disk before the user has seen what would change and agreed to it.
    */
    describe('updatePicklistDependencyMetadata', () => {

        const workspaceRoot = '/workspace';
        const objectsDirectoryPath = '/workspace/force-app/main/default/objects';
        const classesDirectoryPath = '/workspace/force-app/main/default/classes';
        const fieldFilePath = `${objectsDirectoryPath}/Dependency_Example__c/fields/Neighborhood__c.field-meta.xml`;

        const fieldFileContent = `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Neighborhood__c</fullName>
    <valueSet>
        <controllingField>City__c</controllingField>
        <valueSetDefinition>
            <value>
                <fullName>ohiocity</fullName>
                <default>false</default>
                <label>ohiocity</label>
            </value>
            <value>
                <fullName>tremont</fullName>
                <default>false</default>
                <label>tremont</label>
            </value>
        </valueSetDefinition>
        <valueSettings>
            <controllingFieldValue>cle</controllingFieldValue>
            <valueName>ohiocity</valueName>
        </valueSettings>
    </valueSet>
</CustomField>
`;

        /*
            The CONTROLLING field's own file. Writeback reads it to check that every controlling
            value the specs name is a value this picklist actually offers, so a mock returning the
            dependent field's markup for it would make "cle" look undeclared.
        */
        const controllingFieldFileContent = `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>City__c</fullName>
    <valueSet>
        <valueSetDefinition>
            <value>
                <fullName>cle</fullName>
                <default>false</default>
                <label>cle</label>
            </value>
        </valueSetDefinition>
    </valueSet>
</CustomField>
`;

        const apexClassBody = `public class SDTPLDSpecs_Dependency_Example_c {
    public static SDTPicklistDependencySpec specFor_Dependency_Example_c_Neighborhood_c() {
        return SDTPicklistDependencySpec.forField('Dependency_Example__c', 'Neighborhood__c')
                .controlledBy('City__c')
                .expectAtLeast('cle', new List<String>{ 'ohiocity', 'tremont' });
    }
}`;

        let extensionCommandService: ExtensionCommandService;
        let handleCapturedErrorSpy: jest.SpyInstance;
        let writeFileSyncSpy: jest.SpyInstance;

        beforeEach(() => {

            extensionCommandService = new ExtensionCommandService();

            (vscode.window.showInformationMessage as jest.Mock).mockClear();
            (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);
            (vscode.window.showWarningMessage as jest.Mock).mockClear();
            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);

            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue(workspaceRoot);
            jest.spyOn(ConfigurationService, 'getObjectsPathFromTreecipeJSONConfiguration')
                .mockReturnValue('./force-app/main/default/objects');
            jest.spyOn(VSCodeWorkspaceService, 'showPicklistDependencyCheckReport').mockImplementation(() => undefined);

            jest.spyOn(PicklistDependencyTestService, 'resolveDefaultPackageDirectoryPath').mockReturnValue('/workspace/force-app/main/default');
            jest.spyOn(PicklistDependencyTestService, 'getClassesDirectoryPath').mockReturnValue(classesDirectoryPath);
            jest.spyOn(PicklistDependencyTestService, 'assertClassesDirectoryContainedInWorkspace').mockImplementation(() => undefined);

            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'readdirSync').mockReturnValue(['SDTPLDSpecs_Dependency_Example_c.cls'] as any);
            jest.spyOn(fs, 'readFileSync').mockImplementation((readPath: any) => {

                if ( String(readPath).endsWith('.cls') ) {
                    return apexClassBody as any;
                }

                return ( String(readPath).includes('City__c') ? controllingFieldFileContent : fieldFileContent ) as any;

            });

            /*
                The write sink resolves both paths before writing, to refuse a field file that is a
                symlink out of the objects directory. Identity here is what a tree with no symlinks
                resolves to, so the containment check still runs against these fake paths.
            */
            jest.spyOn(fs, 'realpathSync').mockImplementation((resolvedPath: any) => String(resolvedPath) as any);

            // THE ONE CALL THAT TOUCHES A DEVELOPER'S METADATA -- STUBBED SO NO TEST EVER WRITES ONE
            writeFileSyncSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);

            handleCapturedErrorSpy = jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);

        });

        it('shows what would change and writes nothing until the user agrees', async () => {

            await extensionCommandService.updatePicklistDependencyMetadata();

            const confirmationMessage = (vscode.window.showWarningMessage as jest.Mock).mock.calls[0][0];

            expect(confirmationMessage).toContain('cle unlocks tremont');
            expect(writeFileSyncSpy).not.toHaveBeenCalled();
            expect(handleCapturedErrorSpy).not.toHaveBeenCalled();

        });

        it('given the update declined, writes nothing and says so', async () => {

            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);

            await extensionCommandService.updatePicklistDependencyMetadata();

            expect(writeFileSyncSpy).not.toHaveBeenCalled();
            expect((vscode.window.showInformationMessage as jest.Mock).mock.calls.flat().join(' '))
                .toContain('No files were changed');

        });

        it('given the update accepted, writes the transposed metadata', async () => {

            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(UPDATE_METADATA_ACTION_LABEL);

            await extensionCommandService.updatePicklistDependencyMetadata();

            expect(writeFileSyncSpy).toHaveBeenCalledTimes(1);

            const [writtenPath, writtenContent] = writeFileSyncSpy.mock.calls[0];

            expect(writtenPath).toBe(fieldFilePath);

            // THE TRANSPOSE LANDED ON THE tremont BLOCK, WHICH THE FAILURE MESSAGE WOULD NOT HAVE POINTED AT
            expect(writtenContent).toContain('<valueName>tremont</valueName>');

        });

        it('given the deploy declined, leaves the working tree changed and says so explicitly', async () => {

            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(UPDATE_METADATA_ACTION_LABEL);
            (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);

            await extensionCommandService.updatePicklistDependencyMetadata();

            expect(writeFileSyncSpy).toHaveBeenCalled();
            expect((vscode.window.showInformationMessage as jest.Mock).mock.calls.flat().join(' '))
                .toContain('NOT deployed');

        });

        it('given the deploy accepted, deploys exactly the files it wrote', async () => {

            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(UPDATE_METADATA_ACTION_LABEL);
            (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(DEPLOY_UPDATED_METADATA_ACTION_LABEL);

            jest.spyOn(ExtensionCommandService.prototype as any, 'promptForPicklistDependencyTargetOrg').mockResolvedValue('devHub');
            const deploySpy = jest.spyOn(PicklistDependencyCheckService, 'deploySourcePaths').mockResolvedValue('Deployed 1 component(s) to the target org.');

            await extensionCommandService.updatePicklistDependencyMetadata();

            expect(deploySpy).toHaveBeenCalledWith([fieldFilePath], 'devHub', expect.any(Function));

        });

        /*
            The spec asserts "cle unlocks tremont", and the controlling field above declares only
            "cle" -- so the dependent field's write is fine, but nothing is missing on the
            controlling side. Naming a controlling value the picklist does NOT offer is the case
            that has to reach its own file.
        */
        it('given a spec naming a controlling value the controlling field does not declare, writes that field too', async () => {

            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(UPDATE_METADATA_ACTION_LABEL);

            jest.spyOn(PicklistDependencyTestService, 'parseSpecDetailsByApexClassBody').mockReturnValue([{
                objectApiName: 'Dependency_Example__c',
                fieldApiName: 'Neighborhood__c',
                controllingFieldApiName: 'City__c',
                expectations: [{ controllingValue: 'madison', dependentValues: ['ohiocity'] }]
            }]);

            await extensionCommandService.updatePicklistDependencyMetadata();

            const writtenControllingFieldCall = writeFileSyncSpy.mock.calls
                .find(writeCall => String(writeCall[0]).includes('City__c'));

            expect(writtenControllingFieldCall).toBeDefined();
            expect(String(writtenControllingFieldCall[1])).toContain('<fullName>madison</fullName>');

            // AND THE DEPENDENT FIELD IS STILL WRITTEN IN THE SAME RUN
            expect(writeFileSyncSpy.mock.calls.some(writeCall => String(writeCall[0]).includes('Neighborhood__c'))).toBe(true);

        });

        it('given the apex and metadata already agreeing, reports already in sync and writes nothing', async () => {

            jest.spyOn(fs, 'readFileSync').mockImplementation((readPath: any) =>
                String(readPath).endsWith('.cls')
                    ? apexClassBody.replace(`, 'tremont'`, '') as any
                    : fieldFileContent as any);

            await extensionCommandService.updatePicklistDependencyMetadata();

            expect(writeFileSyncSpy).not.toHaveBeenCalled();
            expect((vscode.window.showInformationMessage as jest.Mock).mock.calls.flat().join(' '))
                .toContain('already matches');

        });

        /*
            A class that declares specs but yields none did not parse. Treating that as "no
            dependencies" would silently skip the fields the developer edited -- the exact opposite
            of what they asked for.
        */
        it('given a spec class that cannot be parsed, aborts naming the file and writes nothing', async () => {

            jest.spyOn(fs, 'readFileSync').mockImplementation((readPath: any) =>
                String(readPath).endsWith('.cls')
                    ? `public class X { SDTPicklistDependencySpec.forField('Bad Name!', 'Nope') }` as any
                    : fieldFileContent as any);

            await extensionCommandService.updatePicklistDependencyMetadata();

            expect(writeFileSyncSpy).not.toHaveBeenCalled();
            expect(handleCapturedErrorSpy).toHaveBeenCalled();

            const capturedError = handleCapturedErrorSpy.mock.calls[0][0];
            expect(capturedError.message).toContain('could not be parsed');
            expect(capturedError.message).toContain('Nothing was written');

        });

        it('given no generated spec classes, names the generate command and writes nothing', async () => {

            jest.spyOn(fs, 'readdirSync').mockReturnValue([] as any);

            await extensionCommandService.updatePicklistDependencyMetadata();

            expect(writeFileSyncSpy).not.toHaveBeenCalled();
            expect((vscode.window.showInformationMessage as jest.Mock).mock.calls.flat().join(' '))
                .toContain('Generate Picklist Dependency Tests');

        });

        it('given no workspace, routes the error through ErrorHandlingService', async () => {

            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue(undefined);

            await extensionCommandService.updatePicklistDependencyMetadata();

            expect(handleCapturedErrorSpy).toHaveBeenCalled();
            expect(writeFileSyncSpy).not.toHaveBeenCalled();

        });

    });

});
