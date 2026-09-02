import {
    PicklistDependencyExplorerService,
    IPicklistDependencyResultsLoad,
    IPicklistDependencyExplorerViewModel
} from "../PicklistDependencyExplorerService";

import { IPicklistDependencySpecDetail } from "../../PicklistDependencyTestService/PicklistDependencyTestService";

import * as fs from 'fs';
import * as path from 'path';

import * as matchers from 'jest-extended';
expect.extend(matchers);

jest.mock('vscode', () => ({}), { virtual: true });

const mockResultsDirectoryPath = path.join(__dirname, 'mocks', 'MockPicklistDependencyResults');
const mockMalformedResultsDirectoryPath = path.join(__dirname, 'mocks', 'MockMalformedResults');
const mockResultsWithoutOutcomesDirectoryPath = path.join(__dirname, 'mocks', 'MockResultsWithoutOutcomes');

const mockObjectsDirectoryPath = path.join('/workspace', 'force-app', 'main', 'default', 'objects');

function buildChainExampleSpecDetails(): IPicklistDependencySpecDetail[] {

    return [
        {
            objectApiName: 'Chain_Example__c',
            fieldApiName: 'State__c',
            controllingFieldApiName: 'Country__c',
            expectations: [
                { controllingValue: 'USA', dependentValues: ['Ohio', 'Texas'], forbiddenValues: ['Ontario'] },
                { controllingValue: 'Canada', dependentValues: ['Ontario'], forbiddenValues: ['Ohio', 'Texas'] }
            ]
        },
        {
            objectApiName: 'Chain_Example__c',
            fieldApiName: 'City__c',
            controllingFieldApiName: 'State__c',
            upstreamFieldApiName: 'State__c',
            expectations: [
                { controllingValue: 'Ohio', dependentValues: ['Columbus'], forbiddenValues: ['Austin', 'Toronto'] },
                { controllingValue: 'Texas', dependentValues: ['Austin'], forbiddenValues: ['Columbus', 'Toronto'] },
                { controllingValue: 'Ontario', dependentValues: [], forbiddenValues: [] }
            ]
        }
    ];

}

function buildNoResultsLoad(): IPicklistDependencyResultsLoad {
    return { state: 'noResultsFound', message: 'no check has been run' };
}

function buildViewModelWithLatestMockRun(specDetails: IPicklistDependencySpecDetail[]): IPicklistDependencyExplorerViewModel {

    const resultsLoad = PicklistDependencyExplorerService.loadLatestResults(mockResultsDirectoryPath);
    return PicklistDependencyExplorerService.buildExplorerViewModel(mockObjectsDirectoryPath, specDetails, [], resultsLoad);

}

describe('PicklistDependencyExplorerService', () => {

    describe('getResultsFolderTimestamp', () => {

        it('given a check folder name, returns the trailing iso timestamp', () => {

            const actualTimestamp = PicklistDependencyExplorerService.getResultsFolderTimestamp('check-devHub-2026-08-20T09-01-33');

            expect(actualTimestamp).toBe('2026-08-20T09-01-33');

        });

        it('given an org identifier containing hyphens, still anchors the timestamp at the end of the name', () => {

            const actualTimestamp = PicklistDependencyExplorerService.getResultsFolderTimestamp('check-my-scratch-org-01-2026-08-20T09-01-33');

            expect(actualTimestamp).toBe('2026-08-20T09-01-33');

        });

        it('given a folder name the check command did not write, returns undefined', () => {

            const actualTimestamp = PicklistDependencyExplorerService.getResultsFolderTimestamp('notACheckFolder');

            expect(actualTimestamp).toBeUndefined();

        });

    });

    describe('findLatestResultsFilePath', () => {

        it('given several run folders, returns the results file from the most recent timestamp', () => {

            const actualResultsFilePath = PicklistDependencyExplorerService.findLatestResultsFilePath(mockResultsDirectoryPath);

            expect(actualResultsFilePath).toBe(
                path.join(mockResultsDirectoryPath, 'check-devHub-2026-08-20T09-01-33', 'results.json')
            );

        });

        /*
            The stray file and the run folder holding only a report.md are both in the fixture tree
            on purpose: that folder carries the NEWEST timestamp, so this resolves to the 08-20 run
            only if a folder with no results.json is skipped rather than picked and then failed on.
        */
        it('given a run folder with no results file and a stray file beside it, skips both and returns the newest usable run', () => {

            const actualResultsFilePath = PicklistDependencyExplorerService.findLatestResultsFilePath(mockResultsDirectoryPath);

            expect(actualResultsFilePath).not.toContain('2026-08-25T11-11-11');
            expect(actualResultsFilePath).toContain('check-devHub-2026-08-20T09-01-33');

        });

        it('given a results directory that does not exist, returns undefined rather than throwing', () => {

            const actualResultsFilePath = PicklistDependencyExplorerService.findLatestResultsFilePath(
                path.join(__dirname, 'mocks', 'ThisDirectoryDoesNotExist')
            );

            expect(actualResultsFilePath).toBeUndefined();

        });

    });

    describe('loadLatestResults', () => {

        it('given a valid results file, loads the run detail', () => {

            const actualResultsLoad = PicklistDependencyExplorerService.loadLatestResults(mockResultsDirectoryPath);

            expect(actualResultsLoad.state).toBe('loaded');
            expect(actualResultsLoad.results.targetOrg).toBe('devHub');
            expect(actualResultsLoad.results.passed).toBe(false);
            expect(actualResultsLoad.results.methodOutcomes).toHaveLength(3);

        });

        it('given no results directory, reports the "no check has been run" state naming the directory scanned', () => {

            const missingResultsDirectoryPath = path.join(__dirname, 'mocks', 'ThisDirectoryDoesNotExist');

            const actualResultsLoad = PicklistDependencyExplorerService.loadLatestResults(missingResultsDirectoryPath);

            expect(actualResultsLoad.state).toBe('noResultsFound');
            expect(actualResultsLoad.message).toContain(missingResultsDirectoryPath);
            expect(actualResultsLoad.results).toBeUndefined();

        });

        it('given a malformed results file, reports a readable message rather than throwing', () => {

            const actualResultsLoad = PicklistDependencyExplorerService.loadLatestResults(mockMalformedResultsDirectoryPath);

            expect(actualResultsLoad.state).toBe('unreadableResults');
            expect(actualResultsLoad.message).toContain('could not be read as JSON');
            expect(actualResultsLoad.results).toBeUndefined();

        });

        /*
            A results.json can be well formed JSON carrying an outcomes list and still have had a
            field mangled by whatever edited it. Every field is read defensively for that reason, so
            a single bad value degrades to a placeholder rather than rendering "undefined" in the
            panel banner or throwing on the way there.
        */
        it('given a results file whose fields carry the wrong types, falls back rather than surfacing undefined', () => {

            jest.spyOn(PicklistDependencyExplorerService, 'findLatestResultsFilePath')
                .mockReturnValue('/workspace/treecipe/PicklistDependencyResults/check-devHub-2026-08-20T09-01-33/results.json');

            jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
                targetOrg: 42,
                ranAt: null,
                passed: 'yes',
                failureCount: 'one',
                // THE NULL ENTRY IS DELIBERATE -- A HOLE IN THE LIST MUST NOT THROW ON THE WAY TO THE PANEL
                methodOutcomes: [{ methodName: 7, passed: 'true', message: 12 }, null]
            }));

            const actualResultsLoad = PicklistDependencyExplorerService.loadLatestResults('/workspace/treecipe/PicklistDependencyResults');

            expect(actualResultsLoad.state).toBe('loaded');
            expect(actualResultsLoad.results.targetOrg).toBe('unknown org');
            expect(actualResultsLoad.results.ranAt).toBe('unknown time');
            expect(actualResultsLoad.results.passed).toBe(false);
            expect(actualResultsLoad.results.failureCount).toBe(0);
            expect(actualResultsLoad.results.methodsRun).toBe(2);
            expect(actualResultsLoad.results.methodOutcomes[0].methodName).toBe('unknown');
            expect(actualResultsLoad.results.methodOutcomes[0].passed).toBe(false);
            expect(actualResultsLoad.results.methodOutcomes[0].message).toBeUndefined();
            expect(actualResultsLoad.results.methodOutcomes[1].methodName).toBe('unknown');
            expect(actualResultsLoad.results.methodOutcomes[1].passed).toBe(false);

        });

        it('given a results file that parses to null, reports it as unreadable', () => {

            jest.spyOn(PicklistDependencyExplorerService, 'findLatestResultsFilePath')
                .mockReturnValue('/workspace/treecipe/PicklistDependencyResults/check-devHub-2026-08-20T09-01-33/results.json');
            jest.spyOn(fs, 'readFileSync').mockReturnValue('null');

            const actualResultsLoad = PicklistDependencyExplorerService.loadLatestResults('/workspace/treecipe/PicklistDependencyResults');

            expect(actualResultsLoad.state).toBe('unreadableResults');

        });

        it('given a results file with no methodOutcomes list, reports it as unreadable', () => {

            const actualResultsLoad = PicklistDependencyExplorerService.loadLatestResults(mockResultsWithoutOutcomesDirectoryPath);

            expect(actualResultsLoad.state).toBe('unreadableResults');
            expect(actualResultsLoad.message).toContain('methodOutcomes');

        });

    });

    describe('parseFailureLines', () => {

        it('given an apex assertion message, parses each failure line into its kind, scope and message', () => {

            const assertionMessage = 'System.AssertException: Assertion Failed: Picklist dependency drift on Chain_Example__c -- 2 combination(s) no longer match local source metadata:\n'
                + '  - MISSING_VALUES — Chain_Example__c.State__c @ USA: expected value(s) not unlocked in the org: Texas\n'
                + '  - FORBIDDEN_VALUES_PRESENT — Chain_Example__c.City__c @ Ohio: value(s) unlocked that local metadata forbids: Toronto';

            const actualFailures = PicklistDependencyExplorerService.parseFailureLines(assertionMessage);

            expect(actualFailures).toHaveLength(2);
            expect(actualFailures[0]).toEqual({
                objectApiName: 'Chain_Example__c',
                fieldApiName: 'State__c',
                controllingValue: 'USA',
                kind: 'MISSING_VALUES',
                message: 'expected value(s) not unlocked in the org: Texas'
            });
            expect(actualFailures[1].kind).toBe('FORBIDDEN_VALUES_PRESENT');
            expect(actualFailures[1].controllingValue).toBe('Ohio');

        });

        it('given a failure line with no controlling value, parses it as a field level failure', () => {

            const assertionMessage = '  - LOOKUP_ERROR — Chain_Example__c.State__c: Source returned no snapshot for this field';

            const actualFailures = PicklistDependencyExplorerService.parseFailureLines(assertionMessage);

            expect(actualFailures).toHaveLength(1);
            expect(actualFailures[0].controllingValue).toBeUndefined();
            expect(actualFailures[0].kind).toBe('LOOKUP_ERROR');

        });

        it('given no message at all, returns no failures', () => {

            expect(PicklistDependencyExplorerService.parseFailureLines(undefined)).toEqual([]);

        });

        it('given a message carrying nothing that matches the failure line shape, returns no failures', () => {

            const actualFailures = PicklistDependencyExplorerService.parseFailureLines('System.LimitException: Apex CPU time limit exceeded');

            expect(actualFailures).toEqual([]);

        });

    });

    describe('buildFieldSourceFilePath', () => {

        it('given an object and field api name, builds the source format field metadata path', () => {

            const actualSourceFilePath = PicklistDependencyExplorerService.buildFieldSourceFilePath(
                mockObjectsDirectoryPath, 'Chain_Example__c', 'State__c'
            );

            expect(actualSourceFilePath).toBe(
                path.join(mockObjectsDirectoryPath, 'Chain_Example__c', 'fields', 'State__c.field-meta.xml')
            );

        });

    });

    describe('buildNodesByObjectSpecDetails', () => {

        it('given a chained dependency, nests the downstream field under its controlling field rather than repeating it as a root', () => {

            const specDetails = buildChainExampleSpecDetails();

            const actualRootNodes = PicklistDependencyExplorerService.buildNodesByObjectSpecDetails(
                mockObjectsDirectoryPath, 'Chain_Example__c', specDetails
            );

            expect(actualRootNodes).toHaveLength(1);
            expect(actualRootNodes[0].fieldApiName).toBe('State__c');
            expect(actualRootNodes[0].downstreamNodes).toHaveLength(1);
            expect(actualRootNodes[0].downstreamNodes[0].fieldApiName).toBe('City__c');
            expect(actualRootNodes[0].downstreamNodes[0].downstreamNodes).toEqual([]);

        });

        it('given an upstream field absent from the collected specs, treats the dependent field as a root', () => {

            const specDetails: IPicklistDependencySpecDetail[] = [
                {
                    objectApiName: 'Chain_Example__c',
                    fieldApiName: 'City__c',
                    controllingFieldApiName: 'State__c',
                    upstreamFieldApiName: 'State__c',
                    expectations: [{ controllingValue: 'Ohio', dependentValues: ['Columbus'], forbiddenValues: [] }]
                }
            ];

            const actualRootNodes = PicklistDependencyExplorerService.buildNodesByObjectSpecDetails(
                mockObjectsDirectoryPath, 'Chain_Example__c', specDetails
            );

            expect(actualRootNodes).toHaveLength(1);
            expect(actualRootNodes[0].fieldApiName).toBe('City__c');

        });

        it('given spec details naming each other as upstream, terminates rather than recursing without end', () => {

            const specDetails: IPicklistDependencySpecDetail[] = [
                {
                    objectApiName: 'Loop_Example__c',
                    fieldApiName: 'First__c',
                    controllingFieldApiName: 'Second__c',
                    upstreamFieldApiName: 'Second__c',
                    expectations: [{ controllingValue: 'A', dependentValues: ['B'], forbiddenValues: [] }]
                },
                {
                    objectApiName: 'Loop_Example__c',
                    fieldApiName: 'Second__c',
                    controllingFieldApiName: 'First__c',
                    upstreamFieldApiName: 'First__c',
                    expectations: [{ controllingValue: 'B', dependentValues: ['A'], forbiddenValues: [] }]
                }
            ];

            const actualRootNodes = PicklistDependencyExplorerService.buildNodesByObjectSpecDetails(
                mockObjectsDirectoryPath, 'Loop_Example__c', specDetails
            );

            /*
                Every field is nested under the other, so neither is a root and the object renders as
                empty. What matters is that the walk RETURNS -- a cycle must not hang the panel.
            */
            expect(actualRootNodes).toEqual([]);

        });

        it('given a spec detail with no forbidden values, renders an empty forbidden list rather than undefined', () => {

            const specDetails: IPicklistDependencySpecDetail[] = [
                {
                    objectApiName: 'Dependency_Example__c',
                    fieldApiName: 'City__c',
                    controllingFieldApiName: 'State__c',
                    expectations: [{ controllingValue: 'Ohio', dependentValues: ['Columbus'] }]
                }
            ];

            const actualRootNodes = PicklistDependencyExplorerService.buildNodesByObjectSpecDetails(
                mockObjectsDirectoryPath, 'Dependency_Example__c', specDetails
            );

            expect(actualRootNodes[0].combinations[0].forbiddenValues).toEqual([]);

        });

    });

    describe('buildExplorerViewModel', () => {

        it('given no results at all, renders the structure with every combination marked not checked', () => {

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath, buildChainExampleSpecDetails(), [], buildNoResultsLoad()
            );

            expect(actualViewModel.runLoadState).toBe('noResultsFound');
            expect(actualViewModel.runSummary).toBeUndefined();
            expect(actualViewModel.objects).toHaveLength(1);
            expect(actualViewModel.objects[0].status).toBe('unknown');
            expect(actualViewModel.objects[0].rootNodes[0].status).toBe('unknown');
            expect(actualViewModel.objects[0].rootNodes[0].combinations[0].status).toBe('unknown');

        });

        it('given no dependent picklists, renders an empty object list and still names the scanned directory', () => {

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath, [], [], buildNoResultsLoad()
            );

            expect(actualViewModel.objects).toEqual([]);
            expect(actualViewModel.dependentFieldCount).toBe(0);
            expect(actualViewModel.combinationCount).toBe(0);
            expect(actualViewModel.scannedObjectsDirectoryPath).toBe(mockObjectsDirectoryPath);
            expect(PicklistDependencyExplorerService.buildEmptyStateMessage(actualViewModel)).toContain(mockObjectsDirectoryPath);

        });

        it('given the most recent run, overlays each failing combination with its kind and message', () => {

            const actualViewModel = buildViewModelWithLatestMockRun(buildChainExampleSpecDetails());

            expect(actualViewModel.runLoadState).toBe('loaded');
            expect(actualViewModel.runSummary.targetOrg).toBe('devHub');
            expect(actualViewModel.runSummary.passed).toBe(false);

            const chainObjectViewModel = actualViewModel.objects[0];
            expect(chainObjectViewModel.status).toBe('failed');
            expect(chainObjectViewModel.failureCount).toBe(2);

            const stateNode = chainObjectViewModel.rootNodes[0];
            const failedUsaCombination = stateNode.combinations.find(combination => combination.controllingValue === 'USA');
            expect(failedUsaCombination.status).toBe('failed');
            expect(failedUsaCombination.failureKind).toBe('MISSING_VALUES');
            expect(failedUsaCombination.failureMessage).toContain('Texas');

            const passedCanadaCombination = stateNode.combinations.find(combination => combination.controllingValue === 'Canada');
            expect(passedCanadaCombination.status).toBe('passed');
            expect(passedCanadaCombination.failureKind).toBeUndefined();

        });

        it('given a failing combination on a chained field, overlays it on the nested node', () => {

            const actualViewModel = buildViewModelWithLatestMockRun(buildChainExampleSpecDetails());

            const cityNode = actualViewModel.objects[0].rootNodes[0].downstreamNodes[0];

            expect(cityNode.fieldApiName).toBe('City__c');
            expect(cityNode.status).toBe('failed');

            const failedOhioCombination = cityNode.combinations.find(combination => combination.controllingValue === 'Ohio');
            expect(failedOhioCombination.status).toBe('failed');
            expect(failedOhioCombination.failureKind).toBe('FORBIDDEN_VALUES_PRESENT');
            expect(failedOhioCombination.forbiddenValues).toContain('Toronto');

        });

        it('given an object the run covered and passed, marks every combination passed', () => {

            const dependencyExampleSpecDetails: IPicklistDependencySpecDetail[] = [
                {
                    objectApiName: 'Dependency_Example__c',
                    fieldApiName: 'City__c',
                    controllingFieldApiName: 'State__c',
                    expectations: [{ controllingValue: 'Ohio', dependentValues: ['Columbus'], forbiddenValues: ['Austin'] }]
                }
            ];

            const actualViewModel = buildViewModelWithLatestMockRun(dependencyExampleSpecDetails);

            expect(actualViewModel.objects[0].status).toBe('passed');
            expect(actualViewModel.objects[0].rootNodes[0].status).toBe('passed');
            expect(actualViewModel.objects[0].rootNodes[0].combinations[0].status).toBe('passed');

        });

        it('given an object absent from the loaded run, leaves it not checked rather than claiming it passed', () => {

            const unrelatedSpecDetails: IPicklistDependencySpecDetail[] = [
                {
                    objectApiName: 'Never_Checked__c',
                    fieldApiName: 'City__c',
                    controllingFieldApiName: 'State__c',
                    expectations: [{ controllingValue: 'Ohio', dependentValues: ['Columbus'], forbiddenValues: [] }]
                }
            ];

            const actualViewModel = buildViewModelWithLatestMockRun(unrelatedSpecDetails);

            expect(actualViewModel.objects[0].status).toBe('unknown');
            expect(actualViewModel.objects[0].rootNodes[0].combinations[0].status).toBe('unknown');

        });

        it('given a failed run whose message names no combination, keeps the combinations not checked and surfaces the raw message', () => {

            const unattributableResultsLoad: IPicklistDependencyResultsLoad = {
                state: 'loaded',
                message: '',
                resultsFilePath: '/workspace/treecipe/PicklistDependencyResults/check-devHub-2026-08-20T09-01-33/results.json',
                results: {
                    targetOrg: 'devHub',
                    ranAt: '2026-08-20T09-01-33',
                    passed: false,
                    failureCount: 1,
                    methodsRun: 1,
                    methodOutcomes: [
                        {
                            methodName: 'Chain_Example_c_picklistDependenciesMatchSourceMetadata',
                            passed: false,
                            message: 'System.LimitException: Apex CPU time limit exceeded'
                        }
                    ]
                }
            };

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath, buildChainExampleSpecDetails(), [], unattributableResultsLoad
            );

            const chainObjectViewModel = actualViewModel.objects[0];
            expect(chainObjectViewModel.status).toBe('failed');
            expect(chainObjectViewModel.unattributedFailureMessage).toContain('Apex CPU time limit exceeded');
            expect(chainObjectViewModel.rootNodes[0].status).toBe('unknown');
            expect(chainObjectViewModel.rootNodes[0].combinations[0].status).toBe('unknown');

        });

        it('given a field level failure with no controlling value, attaches it to the field rather than to a combination', () => {

            const fieldLevelFailureResultsLoad: IPicklistDependencyResultsLoad = {
                state: 'loaded',
                message: '',
                resultsFilePath: '/workspace/results.json',
                results: {
                    targetOrg: 'devHub',
                    ranAt: '2026-08-20T09-01-33',
                    passed: false,
                    failureCount: 1,
                    methodsRun: 1,
                    methodOutcomes: [
                        {
                            methodName: 'Chain_Example_c_picklistDependenciesMatchSourceMetadata',
                            passed: false,
                            message: '  - CONTROLLING_FIELD_MISMATCH — Chain_Example__c.State__c: the org reports Region__c as the controlling field'
                        }
                    ]
                }
            };

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath, buildChainExampleSpecDetails(), [], fieldLevelFailureResultsLoad
            );

            const stateNode = actualViewModel.objects[0].rootNodes[0];
            expect(stateNode.status).toBe('failed');
            expect(stateNode.fieldLevelFailureKind).toBe('CONTROLLING_FIELD_MISMATCH');
            expect(stateNode.fieldLevelFailureMessage).toContain('Region__c');
            expect(stateNode.combinations.every(combination => combination.status === 'passed')).toBe(true);

        });

        it('given skipped field warnings, carries them into the model so the panel can say what is not shown', () => {

            const skippedFieldWarnings = ['No "valueSettings" markup found for dependent picklist "Chain_Example__c.Region__c"'];

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath, buildChainExampleSpecDetails(), skippedFieldWarnings, buildNoResultsLoad()
            );

            expect(actualViewModel.skippedFieldWarnings).toEqual(skippedFieldWarnings);

        });

        it('counts nested chain nodes and their combinations in the totals', () => {

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath, buildChainExampleSpecDetails(), [], buildNoResultsLoad()
            );

            expect(actualViewModel.dependentFieldCount).toBe(2);
            expect(actualViewModel.combinationCount).toBe(5);

        });

        it('names the generated apex test method that covers each object', () => {

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath, buildChainExampleSpecDetails(), [], buildNoResultsLoad()
            );

            expect(actualViewModel.objects[0].testMethodName).toBe('Chain_Example_c_picklistDependenciesMatchSourceMetadata');

        });

    });

    describe('collectSourceFilePaths', () => {

        it('given a chained model, collects the source path of every node including nested ones', () => {

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath, buildChainExampleSpecDetails(), [], buildNoResultsLoad()
            );

            const actualSourceFilePaths = PicklistDependencyExplorerService.collectSourceFilePaths(actualViewModel);

            expect(actualSourceFilePaths).toEqual([
                path.join(mockObjectsDirectoryPath, 'Chain_Example__c', 'fields', 'State__c.field-meta.xml'),
                path.join(mockObjectsDirectoryPath, 'Chain_Example__c', 'fields', 'City__c.field-meta.xml')
            ]);

        });

    });

    describe('escapeHtml', () => {

        it('escapes every character that could break out of an html text or attribute context', () => {

            const actualEscapedValue = PicklistDependencyExplorerService.escapeHtml(`<img src="x" onerror='alert(1)'> & done`);

            expect(actualEscapedValue).toBe('&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt; &amp; done');

        });

    });

    describe('buildEmbeddedModelJson', () => {

        it('given a picklist value carrying markup, escapes it so it cannot close the embedded json block', () => {

            const specDetails: IPicklistDependencySpecDetail[] = [
                {
                    objectApiName: 'Dependency_Example__c',
                    fieldApiName: 'City__c',
                    controllingFieldApiName: 'State__c',
                    expectations: [
                        { controllingValue: '</script><script>alert(1)</script>', dependentValues: ['Columbus'], forbiddenValues: [] }
                    ]
                }
            ];

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath, specDetails, [], buildNoResultsLoad()
            );

            const actualEmbeddedJson = PicklistDependencyExplorerService.buildEmbeddedModelJson(actualViewModel);

            expect(actualEmbeddedJson).not.toContain('</script>');
            expect(actualEmbeddedJson).not.toContain('<');
            expect(JSON.parse(actualEmbeddedJson).objects[0].rootNodes[0].combinations[0].controllingValue)
                .toBe('</script><script>alert(1)</script>');

        });

    });

    describe('buildContentSecurityPolicy', () => {

        it('allows only the nonced inline style and script and no remote content at all', () => {

            const actualContentSecurityPolicy = PicklistDependencyExplorerService.buildContentSecurityPolicy('testNonce');

            expect(actualContentSecurityPolicy).toContain(`default-src 'none'`);
            expect(actualContentSecurityPolicy).toContain(`style-src 'nonce-testNonce'`);
            expect(actualContentSecurityPolicy).toContain(`script-src 'nonce-testNonce'`);
            expect(actualContentSecurityPolicy).not.toContain('http');

        });

    });

    describe('buildNonce', () => {

        it('builds a distinct alphanumeric nonce on each call', () => {

            const firstNonce = PicklistDependencyExplorerService.buildNonce();
            const secondNonce = PicklistDependencyExplorerService.buildNonce();

            expect(firstNonce).toMatch(/^[A-Za-z0-9]{32}$/);
            expect(firstNonce).not.toBe(secondNonce);

        });

    });

    describe('buildWebviewHtml', () => {

        it('given a built model, emits a themed shell carrying the model and the content security policy', () => {

            const actualViewModel = buildViewModelWithLatestMockRun(buildChainExampleSpecDetails());

            const actualWebviewHtml = PicklistDependencyExplorerService.buildWebviewHtml(actualViewModel, 'testNonce');

            expect(actualWebviewHtml).toContain('Content-Security-Policy');
            expect(actualWebviewHtml).toContain(`default-src 'none'`);
            expect(actualWebviewHtml).toContain('var(--vscode-editor-background)');
            expect(actualWebviewHtml).toContain('<script id="explorerModel" type="application/json" nonce="testNonce">');
            expect(actualWebviewHtml).toContain('acquireVsCodeApi');
            expect(actualWebviewHtml).toContain('revealFieldSource');

        });

        it('given no dependent picklists, carries the empty state naming the scanned directory into the shell', () => {

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath, [], [], buildNoResultsLoad()
            );

            const actualWebviewHtml = PicklistDependencyExplorerService.buildWebviewHtml(actualViewModel, 'testNonce');

            expect(actualWebviewHtml).toContain('No dependent picklists were found in');
            expect(actualWebviewHtml).toContain(mockObjectsDirectoryPath);

        });

        it('given a scanned directory path carrying markup, escapes it into the header', () => {

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                '/workspace/<script>alert(1)</script>', [], [], buildNoResultsLoad()
            );

            const actualWebviewHtml = PicklistDependencyExplorerService.buildWebviewHtml(actualViewModel, 'testNonce');

            expect(actualWebviewHtml).not.toContain('<script>alert(1)</script>');
            expect(actualWebviewHtml).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');

        });

    });

});
