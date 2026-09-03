import {
    PicklistDependencyExplorerService,
    IPicklistDependencyResultsLoad,
    IPicklistDependencyExplorerViewModel,
    IPicklistDependencyCombinationViewModel,
    PicklistDependencyCheckStatus,
    DEFAULT_PICKLIST_DEPENDENCY_EXPLORER_MODEL_LIMITS,
    PICKLIST_DEPENDENCY_EXPLORER_EXPAND_ALL_OBJECT_LIMIT
} from "../PicklistDependencyExplorerService";

import {
    IPicklistDependencyCollectionResult,
    IPicklistDependencySpecDetail,
    IPicklistDependencySkippedField,
    IRecordTypePicklistDependencySpecDetail,
    PicklistDependencyTestService
} from "../../PicklistDependencyTestService/PicklistDependencyTestService";

import {
    IPicklistDependencyManifestLoad,
    PicklistDependencyManifestService
} from "../../PicklistDependencyManifestService/PicklistDependencyManifestService";

import * as fs from 'fs';
import * as path from 'path';

import * as matchers from 'jest-extended';
expect.extend(matchers);

jest.mock('vscode', () => ({}), { virtual: true });

const mockResultsDirectoryPath = path.join(__dirname, 'mocks', 'MockPicklistDependencyResults');
const mockMalformedResultsDirectoryPath = path.join(__dirname, 'mocks', 'MockMalformedResults');
const mockResultsWithoutOutcomesDirectoryPath = path.join(__dirname, 'mocks', 'MockResultsWithoutOutcomes');
const mockResultsWithReportDirectoryPath = path.join(__dirname, 'mocks', 'MockResultsWithReport');

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

/*
    The Chain_Example__c specs as the North_America record type narrows them: it assigns only Ohio
    and Ontario of the three states, and only Columbus and Toronto of the four cities, so Texas is
    unreachable through it entirely.
*/
function buildChainExampleRecordTypeSpecDetails(): IRecordTypePicklistDependencySpecDetail[] {

    return [
        {
            objectApiName: 'Chain_Example__c',
            fieldApiName: 'State__c',
            controllingFieldApiName: 'Country__c',
            recordTypeDeveloperName: 'North_America',
            expectations: [
                { controllingValue: 'USA', dependentValues: ['Ohio'], forbiddenValues: ['Ontario'] },
                { controllingValue: 'Canada', dependentValues: ['Ontario'], forbiddenValues: ['Ohio'] }
            ]
        },
        {
            objectApiName: 'Chain_Example__c',
            fieldApiName: 'City__c',
            controllingFieldApiName: 'State__c',
            upstreamFieldApiName: 'State__c',
            recordTypeDeveloperName: 'North_America',
            expectations: [
                { controllingValue: 'Ohio', dependentValues: ['Columbus'], forbiddenValues: ['Toronto'] },
                { controllingValue: 'Texas', dependentValues: [], forbiddenValues: [], controllingValueUnavailable: true },
                { controllingValue: 'Ontario', dependentValues: ['Toronto'], forbiddenValues: ['Columbus'] }
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
                kind: 'MISSING_VALUES',
                controllingValueAndMessage: 'USA: expected value(s) not unlocked in the org: Texas'
            });
            expect(actualFailures[1].kind).toBe('FORBIDDEN_VALUES_PRESENT');
            expect(actualFailures[1].controllingValueAndMessage).toBe('Ohio: value(s) unlocked that local metadata forbids: Toronto');

        });

        it('given a failure line with no controlling value, parses it as a field level failure', () => {

            const assertionMessage = '  - LOOKUP_ERROR — Chain_Example__c.State__c: Source returned no snapshot for this field';

            const actualFailures = PicklistDependencyExplorerService.parseFailureLines(assertionMessage);

            expect(actualFailures).toHaveLength(1);
            expect(actualFailures[0].controllingValueAndMessage).toBeUndefined();
            expect(actualFailures[0].fieldLevelMessage).toBe('Source returned no snapshot for this field');
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

        /*
            The reveal allow-list is built from this function, so it enforces the api name shape
            itself rather than relying on the caller that happens to validate first.
        */
        it('given an api name that could escape the objects directory, throws rather than building the path', () => {

            expect(() => PicklistDependencyExplorerService.buildFieldSourceFilePath(
                mockObjectsDirectoryPath, '..', 'State__c'
            )).toThrow('letters, numbers and underscores only');

            expect(() => PicklistDependencyExplorerService.buildFieldSourceFilePath(
                mockObjectsDirectoryPath, 'Chain_Example__c', '../../../../etc/passwd'
            )).toThrow('letters, numbers and underscores only');

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
                What matters first is that the walk RETURNS -- a cycle must not hang the panel. It
                must also not swallow the fields: every member is reachable from a root, promoted
                where the cycle left it rootless, and each appears exactly once.
            */
            expect(PicklistDependencyExplorerService.countNodes(actualRootNodes)).toBe(2);
            expect(PicklistDependencyExplorerService.flattenNodes(actualRootNodes).map(node => node.fieldApiName).sort())
                .toEqual(['First__c', 'Second__c']);

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

            expect(actualRootNodes[0].combinations[0].hasForbiddenAssertion).toBe(false);
            expect(PicklistDependencyExplorerService.buildForbiddenValues(
                actualRootNodes[0].declaredValues, actualRootNodes[0].combinations[0]
            )).toEqual([]);

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
            expect(failedUsaCombination.failures).toHaveLength(1);
            expect(failedUsaCombination.failures[0].kind).toBe('MISSING_VALUES');
            expect(failedUsaCombination.failures[0].message).toContain('Texas');

            const passedCanadaCombination = stateNode.combinations.find(combination => combination.controllingValue === 'Canada');
            expect(passedCanadaCombination.status).toBe('passed');
            expect(passedCanadaCombination.failures).toEqual([]);

        });

        it('given a failing combination on a chained field, overlays it on the nested node', () => {

            const actualViewModel = buildViewModelWithLatestMockRun(buildChainExampleSpecDetails());

            const cityNode = actualViewModel.objects[0].rootNodes[0].downstreamNodes[0];

            expect(cityNode.fieldApiName).toBe('City__c');
            expect(cityNode.status).toBe('failed');

            const failedOhioCombination = cityNode.combinations.find(combination => combination.controllingValue === 'Ohio');
            expect(failedOhioCombination.status).toBe('failed');
            expect(failedOhioCombination.failures[0].kind).toBe('FORBIDDEN_VALUES_PRESENT');
            expect(PicklistDependencyExplorerService.buildForbiddenValues(
                cityNode.declaredValues, failedOhioCombination
            )).toContain('Toronto');

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
            expect(chainObjectViewModel.unattributedFailureMessages.join('\n')).toContain('Apex CPU time limit exceeded');
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
            expect(stateNode.fieldLevelFailures).toHaveLength(1);
            expect(stateNode.fieldLevelFailures[0].kind).toBe('CONTROLLING_FIELD_MISMATCH');
            expect(stateNode.fieldLevelFailures[0].message).toContain('Region__c');
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


    /*
        Every case below is a defect found in review against the first implementation of this
        service, kept as a regression test rather than only fixed. All three shared one failure
        mode: a combination the org had actually broken rendered as a green tick.
    */
    describe('record type scoped combinations', () => {

        function buildViewModelWithRecordTypeScopes(): IPicklistDependencyExplorerViewModel {

            return PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath,
                buildChainExampleSpecDetails(),
                [],
                buildNoResultsLoad(),
                buildChainExampleRecordTypeSpecDetails()
            );

        }

        test('given record type scoped details, nests one scope per record type under the field it narrows', () => {

            const viewModel = buildViewModelWithRecordTypeScopes();

            const stateNode = viewModel.objects[0].rootNodes[0];
            expect(stateNode.fieldApiName).toBe('State__c');
            expect(stateNode.recordTypeScopes.map(recordTypeScope => recordTypeScope.recordTypeDeveloperName)).toEqual(['North_America']);

            // THE CHAIN STILL NESTS, AND THE DOWNSTREAM FIELD CARRIES ITS OWN SCOPE
            const cityNode = stateNode.downstreamNodes[0];
            expect(cityNode.fieldApiName).toBe('City__c');
            expect(cityNode.recordTypeScopes).toHaveLength(1);

        });

        test('given a record type that assigns a subset, the scope narrows what the field-level rows show', () => {

            const viewModel = buildViewModelWithRecordTypeScopes();

            const stateNode = viewModel.objects[0].rootNodes[0];
            const fieldLevelUsa = stateNode.combinations.find(combination => combination.controllingValue === 'USA');
            const scopedUsa = stateNode.recordTypeScopes[0].combinations.find(combination => combination.controllingValue === 'USA');

            expect(fieldLevelUsa.allowedValues).toEqual(['Ohio', 'Texas']);
            expect(scopedUsa.allowedValues).toEqual(['Ohio']);

            // THE SCOPE'S UNIVERSE IS WHAT THE RECORD TYPE ASSIGNS, NOT WHAT THE FIELD DECLARES
            expect(stateNode.declaredValues).toIncludeSameMembers(['Ohio', 'Texas', 'Ontario']);
            expect(stateNode.recordTypeScopes[0].declaredValues).toIncludeSameMembers(['Ohio', 'Ontario']);

        });

        test('given an unavailable controlling value, marks it rather than showing it as unlocking nothing', () => {

            const viewModel = buildViewModelWithRecordTypeScopes();

            const cityNode = viewModel.objects[0].rootNodes[0].downstreamNodes[0];
            const scopedTexas = cityNode.recordTypeScopes[0].combinations.find(combination => combination.controllingValue === 'Texas');

            expect(scopedTexas.controllingValueUnavailable).toBeTrue();
            expect(scopedTexas.allowedValues).toBeEmpty();

            // THE FIELD-LEVEL ROW FOR THE SAME VALUE IS A DIFFERENT ASSERTION AND MUST NOT BE MARKED
            const fieldLevelOntario = cityNode.combinations.find(combination => combination.controllingValue === 'Ontario');
            expect(fieldLevelOntario.controllingValueUnavailable).toBeFalse();

        });

        test('counts scoped combinations apart from the ones the check actually verifies', () => {

            const viewModel = buildViewModelWithRecordTypeScopes();

            expect(viewModel.combinationCount).toBe(5);
            expect(viewModel.recordTypeCombinationCount).toBe(5);
            expect(viewModel.objects[0].recordTypeCombinationCount).toBe(5);

            // WITHOUT SCOPED DETAILS NOTHING CHANGES FOR AN OBJECT THAT HAS NO RECORD TYPES
            const withoutScopes = buildViewModelWithLatestMockRun(buildChainExampleSpecDetails());
            expect(withoutScopes.recordTypeCombinationCount).toBe(0);
            expect(withoutScopes.objects[0].rootNodes[0].recordTypeScopes).toBeEmpty();

        });

        /*
            The run validates SDTPLDSpecs.all(), which holds the field-level specs only. Marking a
            scoped combination "passed" off the back of that would report a scope nothing checked as
            verified -- the exact failure mode the describe source refuses a scoped spec to avoid.
        */
        test('given a passing field level run, leaves scoped combinations unknown rather than claiming they passed', () => {

            const resultsLoad = PicklistDependencyExplorerService.loadLatestResults(mockResultsDirectoryPath);

            const viewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath,
                buildChainExampleSpecDetails(),
                [],
                resultsLoad,
                buildChainExampleRecordTypeSpecDetails()
            );

            const stateNode = viewModel.objects[0].rootNodes[0];
            const scopedStatuses = stateNode.recordTypeScopes[0].combinations.map(combination => combination.status);

            expect(scopedStatuses.every(status => status === 'unknown')).toBeTrue();
            expect(stateNode.recordTypeScopes[0].status).toBe('unknown');

        });

    });

    describe('buildForbiddenValues for an unavailable controlling value', () => {

        /*
            The emitted Apex for this case is a bare expectUnavailable line -- it asserts nothing
            about values. Complementing its empty allowed list against the scope's declared values
            would render the whole universe struck through, which is what an expectNone row shows,
            and would display an assertion the generated spec does not contain.
        */
        test('given an unavailable combination, renders no must-not-unlock list', () => {

            const forbiddenValues = PicklistDependencyExplorerService.buildForbiddenValues(
                ['Cleveland', 'Toronto'],
                {
                    combinationKey: 'Chain_Example__c.City__c @ Texas',
                    controllingValue: 'Texas',
                    allowedValues: [],
                    hasForbiddenAssertion: true,
                    controllingValueUnavailable: true,
                    status: 'unknown',
                    failures: []
                }
            );

            expect(forbiddenValues).toBeEmpty();

        });

        test('given a combination that unlocks nothing but IS available, still renders the complement', () => {

            const forbiddenValues = PicklistDependencyExplorerService.buildForbiddenValues(
                ['Cleveland', 'Toronto'],
                {
                    combinationKey: 'Chain_Example__c.City__c @ Ohio',
                    controllingValue: 'Ohio',
                    allowedValues: [],
                    hasForbiddenAssertion: true,
                    controllingValueUnavailable: false,
                    status: 'unknown',
                    failures: []
                }
            );

            expect(forbiddenValues).toEqual(['Cleveland', 'Toronto']);

        });

    });

    describe('record type scope sorting and field level scoping', () => {

        test('given record types in reverse order, lists a field\'s scopes by developer name', () => {

            const recordTypeSpecDetails: IRecordTypePicklistDependencySpecDetail[] = [
                {
                    objectApiName: 'Chain_Example__c',
                    fieldApiName: 'State__c',
                    controllingFieldApiName: 'Country__c',
                    recordTypeDeveloperName: 'Zeta_Region',
                    expectations: [{ controllingValue: 'USA', dependentValues: ['Ohio'], forbiddenValues: [] }]
                },
                {
                    objectApiName: 'Chain_Example__c',
                    fieldApiName: 'State__c',
                    controllingFieldApiName: 'Country__c',
                    recordTypeDeveloperName: 'Alpha_Region',
                    expectations: [{ controllingValue: 'Canada', dependentValues: ['Ontario'], forbiddenValues: [] }]
                }
            ];

            const scopes = PicklistDependencyExplorerService.buildRecordTypeScopeViewModels(recordTypeSpecDetails);

            expect(scopes.map(scope => scope.recordTypeDeveloperName)).toEqual(['Alpha_Region', 'Zeta_Region']);

        });

        /*
            A field-level failure carries no controlling value, so it must not be matched against a
            scoped combination -- and a scoped FIELD-level failure belongs to its scope's rows rather
            than to the field's.
        */
        test('given a record type scoped field level failure, does not attribute it to a scoped combination', () => {

            const assertionMessage = '  - CONTROLLING_FIELD_MISMATCH — Chain_Example__c.State__c [North_America]: '
                + 'Spec declares controlling field Country__c but the org has Region__c';

            const resultsLoad: IPicklistDependencyResultsLoad = {
                state: 'loaded',
                message: 'loaded',
                resultsFilePath: '/workspace/treecipe/PicklistDependencyResults/check/results.json',
                results: {
                    targetOrg: 'devOrg',
                    ranAt: '2026-09-02T09:00:00Z',
                    passed: false,
                    failureCount: 1,
                    methodsRun: 1,
                    methodOutcomes: [{
                        methodName: 'Chain_Example_c_picklistDependenciesMatchSourceMetadata',
                        passed: false,
                        message: assertionMessage
                    }]
                }
            };

            const viewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath,
                buildChainExampleSpecDetails(),
                [],
                resultsLoad,
                buildChainExampleRecordTypeSpecDetails()
            );

            const stateNode = viewModel.objects[0].rootNodes[0];

            // NOT ON THE FIELD, WHOSE OWN SPEC THE RUN DID NOT REPORT AGAINST
            expect(stateNode.fieldLevelFailures).toBeEmpty();

            // AND NOT SILENTLY MATCHED ONTO A SCOPED COMBINATION EITHER -- IT NAMES NO CONTROLLING VALUE
            const scopedCombinationFailures = stateNode.recordTypeScopes[0].combinations
                .reduce((failureCount, combination) => failureCount + combination.failures.length, 0);
            expect(scopedCombinationFailures).toBe(0);

            expect(viewModel.objects[0].unattributedFailureMessages).toHaveLength(1);
            expect(viewModel.objects[0].unattributedFailureMessages[0]).toContain('[North_America]');

        });

    });

    describe('record type scoped failure attribution', () => {

        test('parses the record type out of a scoped failure line', () => {

            const parsedFailures = PicklistDependencyExplorerService.parseFailureLines(
                '  - MISSING_VALUES — Chain_Example__c.State__c [North_America] @ USA: Expected values no longer valid: [Ohio]'
            );

            expect(parsedFailures).toHaveLength(1);
            expect(parsedFailures[0].recordTypeDeveloperName).toBe('North_America');
            expect(parsedFailures[0].fieldApiName).toBe('State__c');
            expect(parsedFailures[0].controllingValueAndMessage).toBe('USA: Expected values no longer valid: [Ohio]');

        });

        test('leaves a field level failure line unscoped', () => {

            const parsedFailures = PicklistDependencyExplorerService.parseFailureLines(
                '  - MISSING_VALUES — Chain_Example__c.State__c @ USA: Expected values no longer valid: [Ohio]'
            );

            expect(parsedFailures[0].recordTypeDeveloperName).toBeUndefined();
            expect(parsedFailures[0].controllingValueAndMessage).toBe('USA: Expected values no longer valid: [Ohio]');

        });

        /*
            A scoped failure landing on the field-level row would report drift in a spec the run
            never evaluated, and would do it on the row a reader trusts most.
        */
        test('attributes a scoped failure to its record type rather than to the field level row', () => {

            const assertionMessage = 'Picklist dependency drift on Chain_Example__c -- 1 combination(s):\n'
                + '  - MISSING_VALUES — Chain_Example__c.State__c [North_America] @ USA: Expected values no longer valid: [Ohio]';

            const resultsLoad: IPicklistDependencyResultsLoad = {
                state: 'loaded',
                message: 'loaded',
                resultsFilePath: '/workspace/treecipe/PicklistDependencyResults/check/results.json',
                results: {
                    targetOrg: 'devOrg',
                    ranAt: '2026-09-02T09:00:00Z',
                    passed: false,
                    failureCount: 1,
                    methodsRun: 1,
                    methodOutcomes: [{
                        methodName: 'Chain_Example_c_picklistDependenciesMatchSourceMetadata',
                        passed: false,
                        message: assertionMessage
                    }]
                }
            };

            const viewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath,
                buildChainExampleSpecDetails(),
                [],
                resultsLoad,
                buildChainExampleRecordTypeSpecDetails()
            );

            const stateNode = viewModel.objects[0].rootNodes[0];

            const scopedUsa = stateNode.recordTypeScopes[0].combinations.find(combination => combination.controllingValue === 'USA');
            expect(scopedUsa.status).toBe('failed');
            expect(scopedUsa.failures).toHaveLength(1);
            expect(scopedUsa.failures[0].kind).toBe('MISSING_VALUES');

            const fieldLevelUsa = stateNode.combinations.find(combination => combination.controllingValue === 'USA');
            expect(fieldLevelUsa.status).not.toBe('failed');
            expect(fieldLevelUsa.failures).toBeEmpty();

            // AND THE FAILURE IS NOT LEFT LOOKING UNPLACEABLE, WHICH WOULD HOLD THE OBJECT AT UNKNOWN
            expect(viewModel.objects[0].unattributedFailureMessages).toBeEmpty();

        });

        test('given a scoped failure naming a record type the metadata no longer declares, reports it with its scope', () => {

            const assertionMessage = '  - MISSING_VALUES — Chain_Example__c.State__c [Deleted_Record_Type] @ USA: Expected values no longer valid: [Ohio]';

            const resultsLoad: IPicklistDependencyResultsLoad = {
                state: 'loaded',
                message: 'loaded',
                resultsFilePath: '/workspace/treecipe/PicklistDependencyResults/check/results.json',
                results: {
                    targetOrg: 'devOrg',
                    ranAt: '2026-09-02T09:00:00Z',
                    passed: false,
                    failureCount: 1,
                    methodsRun: 1,
                    methodOutcomes: [{
                        methodName: 'Chain_Example_c_picklistDependenciesMatchSourceMetadata',
                        passed: false,
                        message: assertionMessage
                    }]
                }
            };

            const viewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath,
                buildChainExampleSpecDetails(),
                [],
                resultsLoad,
                buildChainExampleRecordTypeSpecDetails()
            );

            expect(viewModel.objects[0].unattributedFailureMessages).toHaveLength(1);
            expect(viewModel.objects[0].unattributedFailureMessages[0]).toContain('[Deleted_Record_Type]');

        });

    });

    describe('failure attribution regressions', () => {

        function buildColonValuedSpecDetails(): IPicklistDependencySpecDetail[] {

            return [
                {
                    objectApiName: 'Account',
                    fieldApiName: 'Sub_Type__c',
                    controllingFieldApiName: 'Type__c',
                    expectations: [
                        { controllingValue: 'Tier 1: Premium', dependentValues: ['Gold'], forbiddenValues: ['Basic'] },
                        { controllingValue: 'Tier 2', dependentValues: ['Basic'], forbiddenValues: ['Gold'] }
                    ]
                }
            ];
        }

        function buildAccountResultsLoad(assertionMessage: string): IPicklistDependencyResultsLoad {

            return {
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
                        { methodName: 'Account_picklistDependenciesMatchSourceMetadata', passed: false, message: assertionMessage }
                    ]
                }
            };
        }

        /*
            A Salesforce picklist value may contain ": ", so splitting the failure line at the first
            colon attributed the failure to a controlling value that does not exist -- and the
            unmatched failure was then dropped, leaving the genuinely drifted combination green.
        */
        it('given a controlling value containing a colon, attributes the failure to the right combination', () => {

            const assertionMessage = '  - MISSING_VALUES — Account.Sub_Type__c @ Tier 1: Premium: expected value(s) not unlocked in the org: Gold';

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath, buildColonValuedSpecDetails(), [], buildAccountResultsLoad(assertionMessage)
            );

            const subTypeNode = actualViewModel.objects[0].rootNodes[0];
            const premiumCombination = subTypeNode.combinations.find(combination => combination.controllingValue === 'Tier 1: Premium');

            expect(premiumCombination.status).toBe('failed');
            expect(premiumCombination.failures[0].kind).toBe('MISSING_VALUES');
            expect(premiumCombination.failures[0].message).toBe('expected value(s) not unlocked in the org: Gold');
            expect(actualViewModel.objects[0].unattributedFailureMessages).toEqual([]);

        });

        /*
            The regression that mattered most: a parsed failure matching no combination was neither
            applied nor reported, so the object showed as failed while every combination under it
            showed as passed and the Apex message vanished from the panel entirely.
        */
        it('given a failure naming a combination this metadata no longer describes, holds the combinations at not checked and surfaces the message', () => {

            const assertionMessage = '  - MISSING_VALUES — Account.Sub_Type__c @ Tier 3 Retired: expected value(s) not unlocked in the org: Platinum';

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath, buildColonValuedSpecDetails(), [], buildAccountResultsLoad(assertionMessage)
            );

            const accountObject = actualViewModel.objects[0];

            expect(accountObject.status).toBe('failed');
            expect(accountObject.rootNodes[0].status).toBe('unknown');
            expect(accountObject.rootNodes[0].combinations.every(combination => combination.status === 'unknown')).toBe(true);

            const unattributedText = accountObject.unattributedFailureMessages.join('\n');
            expect(unattributedText).toContain('Tier 3 Retired');
            expect(unattributedText).toContain('Platinum');

            // THE MESSAGE MUST ALSO SURVIVE INTO THE RENDERED SHELL, WHICH IS WHERE IT WAS PREVIOUSLY LOST
            expect(PicklistDependencyExplorerService.buildWebviewHtml(actualViewModel, 'testNonce')).toContain('Platinum');

        });

        /*
            SDTPicklistDependencyValidator raises MISSING_VALUES and FORBIDDEN_VALUES_PRESENT
            independently for the same controlling value, so taking only the first hid a real
            drift fact.
        */
        it('given two failure kinds on one combination, keeps both rather than only the first', () => {

            const assertionMessage = '  - MISSING_VALUES — Account.Sub_Type__c @ Tier 2: expected value(s) not unlocked in the org: Basic\n'
                + '  - FORBIDDEN_VALUES_PRESENT — Account.Sub_Type__c @ Tier 2: value(s) unlocked that local metadata forbids: Gold';

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath, buildColonValuedSpecDetails(), [], buildAccountResultsLoad(assertionMessage)
            );

            const tierTwoCombination = actualViewModel.objects[0].rootNodes[0].combinations
                .find(combination => combination.controllingValue === 'Tier 2');

            expect(tierTwoCombination.failures).toHaveLength(2);
            expect(tierTwoCombination.failures.map(failure => failure.kind))
                .toEqual(['MISSING_VALUES', 'FORBIDDEN_VALUES_PRESENT']);
            expect(actualViewModel.objects[0].failureCount).toBe(2);

            const actualWebviewHtml = PicklistDependencyExplorerService.buildWebviewHtml(actualViewModel, 'testNonce');
            expect(actualWebviewHtml).toContain('FORBIDDEN_VALUES_PRESENT');
            expect(actualWebviewHtml).toContain('MISSING_VALUES');

        });

        it('given a mutual upstream cycle, still shows both fields rather than rendering the object empty', () => {

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

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath, specDetails, [], buildNoResultsLoad()
            );

            // ONE MEMBER IS PROMOTED TO A ROOT AND THE OTHER HANGS BENEATH IT, SO BOTH ARE SHOWN EXACTLY ONCE
            expect(actualViewModel.dependentFieldCount).toBe(2);
            expect(PicklistDependencyExplorerService.flattenNodes(actualViewModel.objects[0].rootNodes)
                .map(node => node.fieldApiName).sort()).toEqual(['First__c', 'Second__c']);

        });

        it('given a field naming itself as upstream, treats it as a root rather than losing it', () => {

            const specDetails: IPicklistDependencySpecDetail[] = [
                {
                    objectApiName: 'Self_Example__c',
                    fieldApiName: 'Only__c',
                    controllingFieldApiName: 'Only__c',
                    upstreamFieldApiName: 'Only__c',
                    expectations: [{ controllingValue: 'A', dependentValues: ['B'], forbiddenValues: [] }]
                }
            ];

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath, specDetails, [], buildNoResultsLoad()
            );

            expect(actualViewModel.objects[0].rootNodes).toHaveLength(1);
            expect(actualViewModel.objects[0].rootNodes[0].fieldApiName).toBe('Only__c');
            expect(actualViewModel.objects[0].rootNodes[0].downstreamNodes).toEqual([]);

        });

    });

    describe('extractFailureMessageForControllingValue', () => {

        it('given a tail whose controlling value contains a colon, splits on the declared value rather than the first colon', () => {

            const actualMessage = PicklistDependencyExplorerService.extractFailureMessageForControllingValue(
                'Tier 1: Premium: expected value(s) not unlocked: Gold', 'Tier 1: Premium'
            );

            expect(actualMessage).toBe('expected value(s) not unlocked: Gold');

        });

        it('given a tail for a different controlling value, returns undefined so the caller can report it unattributed', () => {

            const actualMessage = PicklistDependencyExplorerService.extractFailureMessageForControllingValue(
                'Tier 3: something drifted', 'Tier 2'
            );

            expect(actualMessage).toBeUndefined();

        });

        it('given a tail that is exactly the controlling value, returns an empty message rather than undefined', () => {

            expect(PicklistDependencyExplorerService.extractFailureMessageForControllingValue('Tier 2', 'Tier 2')).toBe('');

        });

    });

    describe('buildDeclaredValuesByExpectations / buildForbiddenValues', () => {

        it('reconstructs the declared value set from the allowed and forbidden halves', () => {

            const specDetail: IPicklistDependencySpecDetail = {
                objectApiName: 'Chain_Example__c',
                fieldApiName: 'City__c',
                controllingFieldApiName: 'State__c',
                expectations: [
                    { controllingValue: 'Ohio', dependentValues: ['Columbus'], forbiddenValues: ['Austin', 'Toronto'] },
                    { controllingValue: 'Texas', dependentValues: ['Austin'], forbiddenValues: ['Columbus', 'Toronto'] }
                ]
            };

            expect(PicklistDependencyExplorerService.buildDeclaredValuesByExpectations(specDetail))
                .toEqual(['Columbus', 'Austin', 'Toronto']);

        });

        /*
            The payload optimisation is only sound if the derived complement is identical to the
            forbidden list the generator would have emitted, so that equivalence is asserted rather
            than assumed.
        */
        it('derives exactly the forbidden list the spec detail declared', () => {

            const specDetail: IPicklistDependencySpecDetail = {
                objectApiName: 'Chain_Example__c',
                fieldApiName: 'City__c',
                controllingFieldApiName: 'State__c',
                expectations: [
                    { controllingValue: 'Ohio', dependentValues: ['Columbus'], forbiddenValues: ['Austin', 'Toronto'] },
                    { controllingValue: 'Texas', dependentValues: ['Austin'], forbiddenValues: ['Columbus', 'Toronto'] },
                    { controllingValue: 'Ontario', dependentValues: [], forbiddenValues: ['Columbus', 'Austin', 'Toronto'] }
                ]
            };

            const declaredValues = PicklistDependencyExplorerService.buildDeclaredValuesByExpectations(specDetail);
            const combinations = PicklistDependencyExplorerService.buildCombinationViewModels(specDetail);

            combinations.forEach((combination, combinationIndex) => {
                expect(PicklistDependencyExplorerService.buildForbiddenValues(declaredValues, combination).sort())
                    .toEqual([...specDetail.expectations[combinationIndex].forbiddenValues].sort());
            });

        });

        /*
            The embedded payload was the product of the two picklists' sizes before the complement
            moved to the panel. This pins the linear shape so it cannot silently regress.
        */
        it('keeps the embedded payload linear in picklist size rather than quadratic', () => {

            const controllingValueCount = 40;
            const dependentValueCount = 120;

            const declaredValues = Array.from({ length: dependentValueCount }, (_, valueIndex) => `Dependent_Value_${valueIndex}`);
            const expectations = Array.from({ length: controllingValueCount }, (_, controllingIndex) => {
                const allowedValues = declaredValues.filter((_, valueIndex) => valueIndex % controllingValueCount === controllingIndex);
                const allowedValueSet = new Set(allowedValues);
                return {
                    controllingValue: `Controlling_Value_${controllingIndex}`,
                    dependentValues: allowedValues,
                    forbiddenValues: declaredValues.filter(declaredValue => !allowedValueSet.has(declaredValue))
                };
            });

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath,
                [{ objectApiName: 'Big__c', fieldApiName: 'Dependent__c', controllingFieldApiName: 'Controlling__c', expectations }],
                [],
                buildNoResultsLoad()
            );

            const embeddedJsonLength = PicklistDependencyExplorerService.buildEmbeddedModelJson(actualViewModel).length;

            /*
                Quadratic would be ~40 x 120 = 4800 value strings. Linear is ~120 declared plus the
                120 spread across the allowed lists, so well under 400 -- the bound below sits
                between the two and would have failed against the previous implementation.
            */
            expect(embeddedJsonLength).toBeLessThan(30000);

        });

    });

    describe('record type scoped payload shape', () => {

        /*
            The scoped path adds a legitimate factor of R -- one scope per record type -- and that is
            real data. What it must NOT do is reintroduce the controlling x dependent product the
            complement optimisation removed: a scope carries its declared values once and each of its
            combinations carries only what that controlling value unlocks.
        */
        it('keeps a record type scope linear in picklist size, like the field level payload', () => {

            const controllingValueCount = 40;
            const dependentValueCount = 120;

            const declaredValues = Array.from({ length: dependentValueCount }, (unusedValue, valueIndex) => `Dependent_Value_${valueIndex}`);

            const buildExpectations = () => Array.from({ length: controllingValueCount }, (unusedValue, controllingIndex) => {
                const allowedValues = declaredValues.filter((unusedDeclaredValue, valueIndex) => valueIndex % controllingValueCount === controllingIndex);
                const allowedValueSet = new Set(allowedValues);
                return {
                    controllingValue: `Controlling_Value_${controllingIndex}`,
                    dependentValues: allowedValues,
                    forbiddenValues: declaredValues.filter(declaredValue => !allowedValueSet.has(declaredValue))
                };
            });

            const specDetail: IPicklistDependencySpecDetail = {
                objectApiName: 'Big__c',
                fieldApiName: 'Dependent__c',
                controllingFieldApiName: 'Controlling__c',
                expectations: buildExpectations()
            };

            const recordTypeSpecDetail: IRecordTypePicklistDependencySpecDetail = {
                objectApiName: 'Big__c',
                fieldApiName: 'Dependent__c',
                controllingFieldApiName: 'Controlling__c',
                recordTypeDeveloperName: 'Big_Record_Type',
                expectations: buildExpectations()
            };

            const fieldLevelOnlyJsonLength = PicklistDependencyExplorerService.buildEmbeddedModelJson(
                PicklistDependencyExplorerService.buildExplorerViewModel(mockObjectsDirectoryPath, [specDetail], [], buildNoResultsLoad())
            ).length;

            const withOneScopeJsonLength = PicklistDependencyExplorerService.buildEmbeddedModelJson(
                PicklistDependencyExplorerService.buildExplorerViewModel(
                    mockObjectsDirectoryPath, [specDetail], [], buildNoResultsLoad(), [recordTypeSpecDetail]
                )
            ).length;

            /*
                One scope repeating the whole field costs about one field's worth again. Quadratic
                would be ~40 x 120 value strings inside the scope alone, so the bound below sits
                between the two: comfortably above 2x linear, far under the product.
            */
            expect(withOneScopeJsonLength).toBeLessThan(fieldLevelOnlyJsonLength * 3);
            expect(withOneScopeJsonLength).toBeLessThan(60000);

        });

        /*
            An unavailable controlling value asserts nothing about the dependent field, so it must
            stay a small stub. Carrying a per-value complement for it would put the product back into
            the payload -- and into the DOM the panel builds from it.
        */
        it('keeps an unavailable controlling value from carrying the whole declared set', () => {

            const dependentValueCount = 120;
            const declaredValues = Array.from({ length: dependentValueCount }, (unusedValue, valueIndex) => `Dependent_Value_${valueIndex}`);

            const recordTypeSpecDetail: IRecordTypePicklistDependencySpecDetail = {
                objectApiName: 'Big__c',
                fieldApiName: 'Dependent__c',
                controllingFieldApiName: 'Controlling__c',
                recordTypeDeveloperName: 'Sparse_Record_Type',
                expectations: [
                    { controllingValue: 'Assigned', dependentValues: declaredValues, forbiddenValues: [] },
                    ...Array.from({ length: 39 }, (unusedValue, controllingIndex) => ({
                        controllingValue: `Unassigned_${controllingIndex}`,
                        dependentValues: [],
                        forbiddenValues: [],
                        controllingValueUnavailable: true
                    }))
                ]
            };

            const viewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath,
                [{
                    objectApiName: 'Big__c',
                    fieldApiName: 'Dependent__c',
                    controllingFieldApiName: 'Controlling__c',
                    expectations: [{ controllingValue: 'Assigned', dependentValues: declaredValues, forbiddenValues: [] }]
                }],
                [],
                buildNoResultsLoad(),
                [recordTypeSpecDetail]
            );

            const scope = viewModel.objects[0].rootNodes[0].recordTypeScopes[0];

            scope.combinations
                .filter(combination => combination.controllingValueUnavailable)
                .forEach(combination => {
                    expect(combination.allowedValues).toBeEmpty();
                    expect(PicklistDependencyExplorerService.buildForbiddenValues(scope.declaredValues, combination)).toBeEmpty();
                });

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
            // NEITHER FALLS BACK TO default-src, SO BOTH ARE NAMED EXPLICITLY
            expect(actualContentSecurityPolicy).toContain(`form-action 'none'`);
            expect(actualContentSecurityPolicy).toContain(`base-uri 'none'`);
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

        it('given record type scoped combinations, carries them and their caveat into the shell', () => {

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath,
                buildChainExampleSpecDetails(),
                [],
                buildNoResultsLoad(),
                buildChainExampleRecordTypeSpecDetails()
            );

            const actualWebviewHtml = PicklistDependencyExplorerService.buildWebviewHtml(actualViewModel, 'testNonce');

            expect(actualWebviewHtml).toContain('North_America');
            expect(actualWebviewHtml).toContain('buildRecordTypeScopeElement');
            expect(actualWebviewHtml).toContain('not available under this record type');

            /*
                A scope's rows are built on first expand. Every record type repeats its field's
                combinations, so building them at load multiplies the panel's element count by the
                record type count before a reader has opened anything.
            */
            expect(actualWebviewHtml).toContain('scopeBodyBuilt');
            expect(actualWebviewHtml).toContain('buildScopeBody');

            // THE PANEL MUST SAY WHY A SCOPED ROW NEVER GOES GREEN, BESIDE THE ROWS THEMSELVES
            expect(actualWebviewHtml).toContain('not asserted by the check');

            /*
                A record type developer name reaches the panel through the same embedded JSON as
                every other model value, so the escaping that protects the rest protects it too.
            */
            expect(actualWebviewHtml).toContain('type="application/json"');

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

    /*
        The manifest-driven path: the panel renders the specs that were generated, not a fresh
        derivation from source metadata. Every test here builds its manifest through the real
        buildManifest so the shapes under test are the ones the generate command writes.
    */
    describe('buildExplorerViewModelByManifest', () => {

        const manifestFilePath = '/workspace/treecipe/PicklistDependencySpecs/manifest.json';

        function buildCollectionResult(overrides: Partial<IPicklistDependencyCollectionResult> = {}): IPicklistDependencyCollectionResult {

            return {
                specDetails: buildChainExampleSpecDetails(),
                recordTypeSpecDetails: [],
                skippedFieldWarnings: [],
                skippedFields: [],
                ...overrides
            };

        }

        function buildManifestLoad(collectionResult: IPicklistDependencyCollectionResult = buildCollectionResult()): IPicklistDependencyManifestLoad {

            const manifest = PicklistDependencyManifestService.buildManifest(
                collectionResult,
                mockObjectsDirectoryPath,
                '/workspace/force-app/main/default/classes',
                '3.5.0',
                '2026-09-03T12:00:00Z',
                'fingerprint-abc'
            );

            return { state: 'loaded', message: '', manifest, manifestFilePath };

        }

        const freshResult = { freshness: 'fresh' as const, message: '' };

        it('marks the model as manifest sourced, so the panel can promise what it renders is asserted', () => {

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModelByManifest(
                buildManifestLoad(), mockObjectsDirectoryPath, buildNoResultsLoad(), freshResult
            );

            expect(actualViewModel.modelSource).toBe('manifest');
            expect(actualViewModel.manifestFilePath).toBe(manifestFilePath);
            expect(actualViewModel.generatedAt).toBe('2026-09-03T12:00:00Z');
            expect(actualViewModel.generatorVersion).toBe('3.5.0');

        });

        it('renders exactly the objects and fields the manifest declares', () => {

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModelByManifest(
                buildManifestLoad(), mockObjectsDirectoryPath, buildNoResultsLoad(), freshResult
            );

            expect(actualViewModel.objects).toHaveLength(1);
            expect(actualViewModel.objects[0].objectApiName).toBe('Chain_Example__c');
            expect(actualViewModel.dependentFieldCount).toBe(2);

        });

        it('names the generated class and spec method on every node', () => {

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModelByManifest(
                buildManifestLoad(), mockObjectsDirectoryPath, buildNoResultsLoad(), freshResult
            );

            const objectViewModel = actualViewModel.objects[0];
            expect(objectViewModel.generatedClassName)
                .toBe(PicklistDependencyTestService.buildPerObjectSpecsClassName('Chain_Example__c'));
            expect(objectViewModel.testMethodName)
                .toBe(PicklistDependencyTestService.buildTestMethodNameByObjectApiName('Chain_Example__c'));

            const allNodes = PicklistDependencyExplorerService.flattenNodes(objectViewModel.rootNodes);
            expect(allNodes.length).toBeGreaterThan(0);

            allNodes.forEach(node => {
                expect(node.specMethodName).not.toBe('');
                expect(node.generatedClassName).toBe(objectViewModel.generatedClassName);
            });

        });

        it('gives every combination the stable key the manifest recorded for it', () => {

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModelByManifest(
                buildManifestLoad(), mockObjectsDirectoryPath, buildNoResultsLoad(), freshResult
            );

            const stateNode = PicklistDependencyExplorerService.flattenNodes(actualViewModel.objects[0].rootNodes)
                .find(node => node.fieldApiName === 'State__c');

            expect(stateNode.combinations.map(combination => combination.combinationKey)).toEqual([
                'Chain_Example__c.State__c @ USA',
                'Chain_Example__c.State__c @ Canada'
            ]);

        });

        it('keeps a record type scoped combination key distinct from the field level one', () => {

            const manifestLoad = buildManifestLoad(buildCollectionResult({
                recordTypeSpecDetails: buildChainExampleRecordTypeSpecDetails()
            }));

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModelByManifest(
                manifestLoad, mockObjectsDirectoryPath, buildNoResultsLoad(), freshResult
            );

            const stateNode = PicklistDependencyExplorerService.flattenNodes(actualViewModel.objects[0].rootNodes)
                .find(node => node.fieldApiName === 'State__c');

            const scopedKeys = stateNode.recordTypeScopes[0].combinations.map(combination => combination.combinationKey);

            scopedKeys.forEach(scopedKey => expect(scopedKey).toContain('['));
            expect(scopedKeys).not.toContain('Chain_Example__c.State__c @ USA');

        });

        it('renders a skipped field as its own row under its object rather than omitting it', () => {

            const skippedField: IPicklistDependencySkippedField = {
                objectApiName: 'Chain_Example__c',
                fieldApiName: 'Unspecced__c',
                warning: 'No "valueSettings" markup found for dependent picklist "Chain_Example__c.Unspecced__c"'
            };

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModelByManifest(
                buildManifestLoad(buildCollectionResult({ skippedFields: [skippedField], skippedFieldWarnings: [skippedField.warning] })),
                mockObjectsDirectoryPath,
                buildNoResultsLoad(),
                freshResult
            );

            const objectViewModel = actualViewModel.objects[0];
            expect(objectViewModel.skippedFields).toHaveLength(1);
            expect(objectViewModel.skippedFields[0].fieldApiName).toBe('Unspecced__c');
            expect(objectViewModel.skippedFields[0].warning).toContain('valueSettings');

        });

        /*
            An object whose every dependent picklist was skipped produces no specs at all. Dropping
            it would render an empty panel that reads as "this object has no dependent picklists",
            which is the opposite of what happened.
        */
        it('given an object with only skips and no specs, still renders the object', () => {

            const skippedField: IPicklistDependencySkippedField = {
                objectApiName: 'Only_Skips__c',
                fieldApiName: 'Broken__c',
                warning: 'No "valueSettings" markup found for dependent picklist "Only_Skips__c.Broken__c"'
            };

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModelByManifest(
                buildManifestLoad(buildCollectionResult({ skippedFields: [skippedField], skippedFieldWarnings: [skippedField.warning] })),
                mockObjectsDirectoryPath,
                buildNoResultsLoad(),
                freshResult
            );

            const skipOnlyObject = actualViewModel.objects.find(objectViewModel => objectViewModel.objectApiName === 'Only_Skips__c');

            expect(skipOnlyObject).toBeDefined();
            expect(skipOnlyObject.rootNodes).toBeEmpty();
            expect(skipOnlyObject.skippedFields).toHaveLength(1);

        });

        it('carries the staleness verdict and its message onto the model', () => {

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModelByManifest(
                buildManifestLoad(),
                mockObjectsDirectoryPath,
                buildNoResultsLoad(),
                { freshness: 'staleMetadata', message: 'metadata changed since generation' }
            );

            expect(actualViewModel.manifestFreshness).toBe('staleMetadata');
            expect(actualViewModel.manifestFreshnessMessage).toBe('metadata changed since generation');

        });

        /*
            The manifest is a json file on disk and objectsDirectoryPath is the only string in it
            that reaches the filesystem -- every node's sourceFilePath is built under it, and those
            become the allow-list the reveal handler trusts. A manifest committed into a cloned repo
            must not be able to seed that list with a path outside the workspace.
        */
        it('given a manifest naming an objects directory outside the workspace, falls back to the configured one', () => {

            const manifestLoad = buildManifestLoad();
            manifestLoad.manifest.objectsDirectoryPath = '/etc/somewhere-else/objects';

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModelByManifest(
                manifestLoad, mockObjectsDirectoryPath, buildNoResultsLoad(), freshResult, '/workspace'
            );

            expect(actualViewModel.scannedObjectsDirectoryPath).toBe(mockObjectsDirectoryPath);

            PicklistDependencyExplorerService.collectSourceFilePaths(actualViewModel).forEach(sourceFilePath => {
                expect(sourceFilePath.startsWith('/etc')).toBe(false);
            });

        });

        it('given a manifest naming an objects directory inside the workspace, renders paths under it', () => {

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModelByManifest(
                buildManifestLoad(), mockObjectsDirectoryPath, buildNoResultsLoad(), freshResult, '/workspace'
            );

            expect(actualViewModel.scannedObjectsDirectoryPath).toBe(mockObjectsDirectoryPath);

        });

        /*
            The test method the run outcome is looked up by comes from the manifest rather than being
            re-derived. Re-deriving it is the second derivation this whole artifact exists to remove,
            and the two inputs differ the moment an entry is dropped at the parse boundary.
        */
        it('looks up the run outcome by the test method name the manifest recorded', () => {

            const manifestLoad = buildManifestLoad();
            manifestLoad.manifest.objects[0].testMethodName = 'aDeliberatelyDifferentTestMethodName';

            const resultsLoad = {
                state: 'loaded' as const,
                message: '',
                resultsFilePath: '/workspace/treecipe/PicklistDependencyResults/run/results.json',
                results: {
                    targetOrg: 'test-org',
                    ranAt: '2026-09-03T13:00:00Z',
                    passed: true,
                    failureCount: 0,
                    methodsRun: 1,
                    methodOutcomes: [{ methodName: 'aDeliberatelyDifferentTestMethodName', passed: true }]
                }
            };

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModelByManifest(
                manifestLoad, mockObjectsDirectoryPath, resultsLoad, freshResult
            );

            expect(actualViewModel.objects[0].testMethodName).toBe('aDeliberatelyDifferentTestMethodName');

            // THE RUN WAS ACTUALLY MATCHED, RATHER THAN THE OBJECT FALLING BACK TO "NOT CHECKED"
            expect(actualViewModel.objects[0].status).toBe('passed');

        });

        it('given a manifest load with no manifest, refuses rather than rendering an empty panel', () => {

            expect(() => PicklistDependencyExplorerService.buildExplorerViewModelByManifest(
                { state: 'unreadableManifest', message: 'broken' },
                mockObjectsDirectoryPath,
                buildNoResultsLoad(),
                freshResult
            )).toThrow('carries no manifest');

        });

        /*
            The three-state guarantee, held through the manifest path. A failure that names a
            combination the manifest does not declare must not be forced onto a row that looks
            similar -- the object goes to "unknown" and the text is surfaced unattributed.
        */
        it('given a failure naming a combination the manifest never declared, holds the object at unknown', () => {

            const testMethodName = PicklistDependencyTestService.buildTestMethodNameByObjectApiName('Chain_Example__c');

            const resultsLoad = {
                state: 'loaded' as const,
                message: '',
                resultsFilePath: '/workspace/treecipe/PicklistDependencyResults/run/results.json',
                results: {
                    targetOrg: 'test-org',
                    ranAt: '2026-09-03T13:00:00Z',
                    passed: false,
                    failureCount: 1,
                    methodsRun: 1,
                    methodOutcomes: [{
                        methodName: testMethodName,
                        passed: false,
                        message: 'MISSING_VALUES — Chain_Example__c.Nonexistent__c @ Mars: nothing here'
                    }]
                }
            };

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModelByManifest(
                buildManifestLoad(), mockObjectsDirectoryPath, resultsLoad, freshResult
            );

            const objectViewModel = actualViewModel.objects[0];

            expect(objectViewModel.unattributedFailureMessages).not.toBeEmpty();

            PicklistDependencyExplorerService.flattenNodes(objectViewModel.rootNodes).forEach(node => {
                node.combinations.forEach(combination => expect(combination.status).toBe('unknown'));
            });

        });

        it('given a failure naming a combination the manifest DOES declare, attributes it to that row', () => {

            const testMethodName = PicklistDependencyTestService.buildTestMethodNameByObjectApiName('Chain_Example__c');

            const resultsLoad = {
                state: 'loaded' as const,
                message: '',
                resultsFilePath: '/workspace/treecipe/PicklistDependencyResults/run/results.json',
                results: {
                    targetOrg: 'test-org',
                    ranAt: '2026-09-03T13:00:00Z',
                    passed: false,
                    failureCount: 1,
                    methodsRun: 1,
                    methodOutcomes: [{
                        methodName: testMethodName,
                        passed: false,
                        message: 'MISSING_VALUES — Chain_Example__c.State__c @ USA: Ohio is no longer available'
                    }]
                }
            };

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModelByManifest(
                buildManifestLoad(), mockObjectsDirectoryPath, resultsLoad, freshResult
            );

            const stateNode = PicklistDependencyExplorerService.flattenNodes(actualViewModel.objects[0].rootNodes)
                .find(node => node.fieldApiName === 'State__c');

            const usaCombination = stateNode.combinations.find(combination => combination.controllingValue === 'USA');

            expect(usaCombination.status).toBe('failed');
            expect(usaCombination.combinationKey).toBe('Chain_Example__c.State__c @ USA');
            expect(actualViewModel.objects[0].unattributedFailureMessages).toBeEmpty();

        });

    });

    describe('metadata preview context', () => {

        it('marks a model built without a manifest as a preview, with no generated names on it', () => {

            const previewContext = PicklistDependencyExplorerService.buildMetadataPreviewContext();

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath,
                buildChainExampleSpecDetails(),
                [],
                buildNoResultsLoad(),
                [],
                previewContext
            );

            expect(actualViewModel.modelSource).toBe('metadataPreview');

            PicklistDependencyExplorerService.flattenNodes(actualViewModel.objects[0].rootNodes).forEach(node => {
                expect(node.specMethodName).toBe('');
                expect(node.generatedClassName).toBe('');
            });

        });

        /*
            A skipped field's warning is built from metadata the extension does not control -- it
            embeds the object and field api names straight from the XML -- so it reaches the panel
            on the same footing as a picklist value, and goes through the same escaping.
        */
        it('given a skipped field warning carrying markup, escapes it into the panel', () => {

            const manifest = PicklistDependencyManifestService.buildManifest(
                {
                    specDetails: buildChainExampleSpecDetails(),
                    recordTypeSpecDetails: [],
                    skippedFieldWarnings: ['<script>alert(1)</script>'],
                    skippedFields: [{
                        objectApiName: 'Chain_Example__c',
                        fieldApiName: 'Broken__c',
                        warning: '<script>alert(1)</script>'
                    }]
                },
                mockObjectsDirectoryPath,
                '/workspace/force-app/main/default/classes',
                '3.5.0',
                '2026-09-03T12:00:00Z',
                'fingerprint-abc'
            );

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModelByManifest(
                { state: 'loaded', message: '', manifest, manifestFilePath: '/workspace/treecipe/PicklistDependencySpecs/manifest.json' },
                mockObjectsDirectoryPath,
                buildNoResultsLoad(),
                { freshness: 'fresh', message: '' }
            );

            const actualWebviewHtml = PicklistDependencyExplorerService.buildWebviewHtml(actualViewModel, 'testNonce');

            expect(actualWebviewHtml).not.toContain('<script>alert(1)</script>');

        });

        it('renders the preview banner saying nothing asserts the rows below', () => {

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath,
                buildChainExampleSpecDetails(),
                [],
                buildNoResultsLoad(),
                [],
                PicklistDependencyExplorerService.buildMetadataPreviewContext()
            );

            const actualWebviewHtml = PicklistDependencyExplorerService.buildWebviewHtml(actualViewModel, 'testNonce');

            expect(actualWebviewHtml).toContain('Preview from metadata');
            expect(actualWebviewHtml).toContain('nothing asserts any combination below');

        });

    });


    /*
        Slice 3 of #83: a failure states a likely cause and a next step in the reader's terms.

        Every kind is covered on purpose. A kind with no entry falls through to a default that SAYS
        it has none -- the one thing the panel must never do is invent an explanation for a failure
        it does not recognise.
    */
    describe('buildFailureTriage', () => {

        const everyValidatorFailureKind = [
            'MISSING_VALUES',
            'UNEXPECTED_VALUES',
            'FORBIDDEN_VALUES_PRESENT',
            'UNKNOWN_CONTROLLING_VALUE',
            'UNEXPECTED_CONTROLLING_VALUE',
            'CONTROLLING_FIELD_MISMATCH',
            'CONTRADICTORY_EXPECTATION',
            'UPSTREAM_FAILURE',
            'CIRCULAR_DEPENDENCY',
            'LOOKUP_ERROR'
        ];

        it('given every kind SDTPicklistDependencyValidator can raise, states a cause and a next step for each', () => {

            everyValidatorFailureKind.forEach(failureKind => {

                const actualTriage = PicklistDependencyExplorerService.buildFailureTriage(failureKind);

                expect(actualTriage.likelyCause).not.toBeEmpty();
                expect(actualTriage.nextStep).not.toBeEmpty();

            });

        });

        it('explains each kind differently, so the triage carries information the kind name does not', () => {

            const distinctLikelyCauses = new Set(
                everyValidatorFailureKind.map(failureKind => PicklistDependencyExplorerService.buildFailureTriage(failureKind).likelyCause)
            );

            expect(distinctLikelyCauses.size).toBe(everyValidatorFailureKind.length);

        });

        /*
            The most expensive wrong turn this panel could send someone on is into Setup for a spec
            no org can satisfy, so both hand-edit kinds have to name the spec rather than the org.
        */
        it('given a kind no org state can cause, points at the generated spec rather than at the org', () => {

            const contradictionTriage = PicklistDependencyExplorerService.buildFailureTriage('CONTRADICTORY_EXPECTATION');
            const circularTriage = PicklistDependencyExplorerService.buildFailureTriage('CIRCULAR_DEPENDENCY');

            expect(contradictionTriage.likelyCause).toContain('hand edit');
            expect(contradictionTriage.nextStep).toContain('Do not change the org');
            expect(circularTriage.likelyCause).toContain('hand edit');

        });

        it('given a kind this version has never seen, says so and points at the raw Apex message', () => {

            const actualTriage = PicklistDependencyExplorerService.buildFailureTriage('SOME_FUTURE_KIND');

            expect(actualTriage.likelyCause).toContain('SOME_FUTURE_KIND');
            expect(actualTriage.likelyCause).toContain('no explanation');
            expect(actualTriage.nextStep).toContain('Apex message');

        });

    });

    describe('failure detail view models', () => {

        function buildFailingResultsLoad(assertionMessage: string): IPicklistDependencyResultsLoad {

            return {
                state: 'loaded',
                message: '',
                resultsFilePath: '/workspace/treecipe/PicklistDependencyResults/run/results.json',
                results: {
                    targetOrg: 'test-org',
                    ranAt: '2026-09-03T13:00:00Z',
                    passed: false,
                    failureCount: 1,
                    methodsRun: 1,
                    methodOutcomes: [{
                        methodName: PicklistDependencyTestService.buildTestMethodNameByObjectApiName('Chain_Example__c'),
                        passed: false,
                        message: assertionMessage
                    }]
                }
            };

        }

        it('carries the triage ALONGSIDE the Apex kind and message rather than in place of them', () => {

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath,
                buildChainExampleSpecDetails(),
                [],
                buildFailingResultsLoad('MISSING_VALUES — Chain_Example__c.State__c @ USA: Expected values no longer valid: [Ohio]')
            );

            const stateNode = PicklistDependencyExplorerService.flattenNodes(actualViewModel.objects[0].rootNodes)
                                    .find(node => node.fieldApiName === 'State__c');
            const usaFailure = stateNode.combinations.find(combination => combination.controllingValue === 'USA').failures[0];

            expect(usaFailure.kind).toBe('MISSING_VALUES');
            expect(usaFailure.message).toContain('Expected values no longer valid');
            expect(usaFailure.triage.likelyCause).toBe(PicklistDependencyExplorerService.buildFailureTriage('MISSING_VALUES').likelyCause);

        });

        it('carries the triage on a field level failure too, which is where the least readable kinds land', () => {

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath,
                buildChainExampleSpecDetails(),
                [],
                buildFailingResultsLoad('LOOKUP_ERROR — Chain_Example__c.State__c: Source returned no snapshot for this field')
            );

            const stateNode = PicklistDependencyExplorerService.flattenNodes(actualViewModel.objects[0].rootNodes)
                                    .find(node => node.fieldApiName === 'State__c');

            expect(stateNode.fieldLevelFailures[0].kind).toBe('LOOKUP_ERROR');
            expect(stateNode.fieldLevelFailures[0].triage.nextStep).toContain('readable by the running user');

        });

    });

    /*
        Slice 1 of #83: the find box matches against text the SERVICE builds, so the rule lives here
        under test rather than only inside the panel's script string.
    */
    describe('search text', () => {

        it('given a node, matches on the field, what controls it, and every record type that narrows it', () => {

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath,
                buildChainExampleSpecDetails(),
                [],
                buildNoResultsLoad(),
                buildChainExampleRecordTypeSpecDetails()
            );

            const stateNode = PicklistDependencyExplorerService.flattenNodes(actualViewModel.objects[0].rootNodes)
                                    .find(node => node.fieldApiName === 'State__c');

            expect(stateNode.searchText).toContain('state__c');
            expect(stateNode.searchText).toContain('country__c');
            expect(stateNode.searchText).toContain('north_america');

        });

        /*
            Searching for a field has to reach the object holding it -- a reader who knows the field
            name and not the object is exactly who the box is for.
        */
        it('given an object, matches on a field nested deep in its chain', () => {

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath,
                buildChainExampleSpecDetails(),
                [],
                buildNoResultsLoad()
            );

            expect(actualViewModel.objects[0].searchText).toContain('city__c');

        });

        it('given a node, does NOT fold a downstream field name into its parent', () => {

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath,
                buildChainExampleSpecDetails(),
                [],
                buildNoResultsLoad()
            );

            const stateNode = actualViewModel.objects[0].rootNodes.find(node => node.fieldApiName === 'State__c');

            expect(stateNode.searchText).not.toContain('city__c');

        });

        it('given an object whose every field was skipped, still matches on the object name', () => {

            const skippedField = {
                objectApiName: 'Skipped_Only__c',
                fieldApiName: 'Broken__c',
                recordTypeDeveloperName: '',
                warning: 'no valueSettings markup'
            };

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath,
                [],
                [skippedField.warning],
                buildNoResultsLoad(),
                [],
                { ...PicklistDependencyExplorerService.buildMetadataPreviewContext(), skippedFields: [skippedField] }
            );

            expect(actualViewModel.objects[0].searchText).toContain('skipped_only__c');
            expect(actualViewModel.objects[0].searchText).toContain('broken__c');

        });

    });

    /*
        Slice 2 of #83: a stated ceiling instead of an unbounded payload.
    */
    describe('selectWithinCap', () => {

        it('given fewer items than the cap, returns them untouched', () => {

            const items = ['a', 'b', 'c'];

            expect(PicklistDependencyExplorerService.selectWithinCap(items, 10, () => false)).toBe(items);

        });

        it('given more items than the cap, keeps the retained ones and fills the rest in declared order', () => {

            const items = ['a', 'b', 'c', 'd', 'e'];

            const actualItems = PicklistDependencyExplorerService.selectWithinCap(items, 2, item => item === 'e');

            expect(actualItems).toEqual(['a', 'e']);

        });

        /*
            The cap bounds a pathological render. Dropping a reported failure to honour it would
            break the only promise the panel makes, so the retained set is a floor rather than a
            budget.
        */
        it('given more retained items than the cap, keeps every one of them anyway', () => {

            const items = ['a', 'b', 'c', 'd', 'e'];

            const actualItems = PicklistDependencyExplorerService.selectWithinCap(items, 2, item => item !== 'a');

            expect(actualItems).toEqual(['b', 'c', 'd', 'e']);

        });

    });

    describe('applyModelLimits', () => {

        function buildManyObjectSpecDetails(objectCount: number): IPicklistDependencySpecDetail[] {

            let specDetails: IPicklistDependencySpecDetail[] = [];

            for ( let objectIndex = 0; objectIndex < objectCount; objectIndex++ ) {
                specDetails.push({
                    objectApiName: `Object_${objectIndex}__c`,
                    fieldApiName: 'State__c',
                    controllingFieldApiName: 'Country__c',
                    expectations: [
                        { controllingValue: 'USA', dependentValues: ['Ohio'], forbiddenValues: [] },
                        { controllingValue: 'Canada', dependentValues: ['Ontario'], forbiddenValues: [] },
                        { controllingValue: 'Mexico', dependentValues: ['Jalisco'], forbiddenValues: [] }
                    ]
                });
            }

            return specDetails;

        }

        function buildUncappedViewModel(objectCount: number): IPicklistDependencyExplorerViewModel {

            return PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath,
                buildManyObjectSpecDetails(objectCount),
                [],
                buildNoResultsLoad()
            );

        }

        it('given more objects than the ceiling allows, renders the ceiling and says how many it dropped', () => {

            const actualViewModel = PicklistDependencyExplorerService.applyModelLimits(
                buildUncappedViewModel(8),
                { maxObjects: 3, maxCombinationsPerNode: 200, maxRecordTypeScopesPerNode: 25 }
            );

            expect(actualViewModel.objects).toHaveLength(3);
            expect(actualViewModel.truncatedObjectCount).toBe(5);
            expect(actualViewModel.truncationNotices[0]).toContain('Showing 3 of 8 objects');

        });

        it('never drops an object the check reported a failure for, however far down the list it sits', () => {

            let viewModel = buildUncappedViewModel(8);
            viewModel.objects[7].status = 'failed';
            viewModel.objects[7].failureCount = 1;

            const actualViewModel = PicklistDependencyExplorerService.applyModelLimits(
                viewModel,
                { maxObjects: 2, maxCombinationsPerNode: 200, maxRecordTypeScopesPerNode: 25 }
            );

            expect(actualViewModel.objects.map(objectViewModel => objectViewModel.objectApiName)).toContain('Object_7__c');

        });

        it('never drops a combination the check reported a failure for', () => {

            let viewModel = buildUncappedViewModel(1);
            const lastCombination = viewModel.objects[0].rootNodes[0].combinations[2];
            lastCombination.status = 'failed';
            lastCombination.failures = [PicklistDependencyExplorerService.buildFailureDetailViewModel('MISSING_VALUES', 'Ohio is gone')];

            const actualViewModel = PicklistDependencyExplorerService.applyModelLimits(
                viewModel,
                { maxObjects: 250, maxCombinationsPerNode: 1, maxRecordTypeScopesPerNode: 25 }
            );

            const renderedControllingValues = actualViewModel.objects[0].rootNodes[0].combinations
                                                    .map(combination => combination.controllingValue);

            expect(renderedControllingValues).toEqual(['Mexico']);
            expect(actualViewModel.objects[0].rootNodes[0].truncatedCombinationCount).toBe(2);
            expect(actualViewModel.truncationNotices.join(' ')).toContain('combination(s) are not rendered');

        });

        /*
            The counts describe the org; the notices describe the panel. Reducing the counts to match
            what survived would leave a truncated panel quietly reporting a smaller org than the one
            the manifest declares.
        */
        it('leaves the declared counts alone, so a truncated panel does not report a smaller org', () => {

            const uncappedViewModel = buildUncappedViewModel(8);
            const declaredCombinationCount = uncappedViewModel.combinationCount;

            const actualViewModel = PicklistDependencyExplorerService.applyModelLimits(
                uncappedViewModel,
                { maxObjects: 2, maxCombinationsPerNode: 1, maxRecordTypeScopesPerNode: 25 }
            );

            expect(actualViewModel.combinationCount).toBe(declaredCombinationCount);
            expect(actualViewModel.dependentFieldCount).toBe(8);

        });

        /*
            The three-state guarantee under the ceiling: a row is either rendered as what it is, or
            absent and counted. Nothing is re-labelled on the way through.
        */
        it('changes no status: a surviving combination reports exactly what it reported before', () => {

            let viewModel = buildUncappedViewModel(4);
            viewModel.objects[0].rootNodes[0].combinations[0].status = 'passed';
            viewModel.objects[1].rootNodes[0].combinations[0].status = 'failed';

            let statusesBeforeByKey: Record<string, PicklistDependencyCheckStatus> = {};
            viewModel.objects.forEach(objectViewModel => {
                objectViewModel.rootNodes[0].combinations.forEach((combination: IPicklistDependencyCombinationViewModel) => {
                    statusesBeforeByKey[combination.combinationKey] = combination.status;
                });
            });

            const actualViewModel = PicklistDependencyExplorerService.applyModelLimits(
                viewModel,
                { maxObjects: 3, maxCombinationsPerNode: 2, maxRecordTypeScopesPerNode: 25 }
            );

            actualViewModel.objects.forEach(objectViewModel => {
                objectViewModel.rootNodes[0].combinations.forEach((combination: IPicklistDependencyCombinationViewModel) => {
                    expect(combination.status).toBe(statusesBeforeByKey[combination.combinationKey]);
                });
            });

        });

        it('given a field carrying more record type scopes than the ceiling allows, caps them and says so', () => {

            let recordTypeSpecDetails: IRecordTypePicklistDependencySpecDetail[] = [];

            for ( let recordTypeIndex = 0; recordTypeIndex < 5; recordTypeIndex++ ) {
                recordTypeSpecDetails.push({
                    objectApiName: 'Object_0__c',
                    fieldApiName: 'State__c',
                    controllingFieldApiName: 'Country__c',
                    recordTypeDeveloperName: `Record_Type_${recordTypeIndex}`,
                    expectations: [{ controllingValue: 'USA', dependentValues: ['Ohio'], forbiddenValues: [] }]
                });
            }

            const viewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath,
                buildManyObjectSpecDetails(1),
                [],
                buildNoResultsLoad(),
                recordTypeSpecDetails
            );

            const actualViewModel = PicklistDependencyExplorerService.applyModelLimits(
                viewModel,
                { maxObjects: 250, maxCombinationsPerNode: 200, maxRecordTypeScopesPerNode: 2 }
            );

            expect(actualViewModel.objects[0].rootNodes[0].recordTypeScopes).toHaveLength(2);
            expect(actualViewModel.objects[0].rootNodes[0].truncatedRecordTypeScopeCount).toBe(3);
            expect(actualViewModel.truncationNotices.join(' ')).toContain('record type scope(s) are not rendered');

        });

        it('given a model inside every limit, drops nothing and writes no notice', () => {

            const actualViewModel = PicklistDependencyExplorerService.applyModelLimits(
                buildUncappedViewModel(3),
                DEFAULT_PICKLIST_DEPENDENCY_EXPLORER_MODEL_LIMITS
            );

            expect(actualViewModel.objects).toHaveLength(3);
            expect(actualViewModel.truncatedObjectCount).toBe(0);
            expect(actualViewModel.truncationNotices).toBeEmpty();

        });

    });

    describe('resolveRunReportFilePath', () => {

        it('given a run folder that also wrote a report, returns the report beside the results', () => {

            const resultsFilePath = PicklistDependencyExplorerService.findLatestResultsFilePath(mockResultsWithReportDirectoryPath);

            expect(PicklistDependencyExplorerService.resolveRunReportFilePath(resultsFilePath))
                .toBe(path.join(path.dirname(resultsFilePath), 'report.md'));

        });

        it('given a run folder that wrote no report, returns empty rather than a path that opens nothing', () => {

            const resultsFilePath = PicklistDependencyExplorerService.findLatestResultsFilePath(mockResultsDirectoryPath);

            expect(PicklistDependencyExplorerService.resolveRunReportFilePath(resultsFilePath)).toBe('');

        });

        it('given no results file at all, returns empty', () => {

            expect(PicklistDependencyExplorerService.resolveRunReportFilePath('')).toBe('');

        });

        it('carries the report path onto the run summary the panel renders', () => {

            const resultsLoad = PicklistDependencyExplorerService.loadLatestResults(mockResultsWithReportDirectoryPath);

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath,
                buildChainExampleSpecDetails(),
                [],
                resultsLoad
            );

            expect(actualViewModel.runSummary.reportFilePath).toContain('report.md');

        });

    });

    /*
        Slice 3 of #83: a failed combination links to the code that generated it and to the run entry
        that reported it. Each allow-list pairs the FILE with the METHOD, so a legitimate file cannot
        be combined with a method name of the sender's choosing.
    */
    describe('openable targets', () => {

        function buildManifestSourcedViewModel(resultsLoad: IPicklistDependencyResultsLoad = buildNoResultsLoad()): IPicklistDependencyExplorerViewModel {

            const manifest = PicklistDependencyManifestService.buildManifest(
                {
                    specDetails: buildChainExampleSpecDetails(),
                    recordTypeSpecDetails: buildChainExampleRecordTypeSpecDetails(),
                    skippedFieldWarnings: [],
                    skippedFields: []
                },
                mockObjectsDirectoryPath,
                '/workspace/force-app/main/default/classes',
                '3.5.0',
                '2026-09-03T12:00:00Z',
                'fingerprint-abc'
            );

            return PicklistDependencyExplorerService.buildExplorerViewModelByManifest(
                { state: 'loaded', message: '', manifest, manifestFilePath: '/workspace/treecipe/PicklistDependencySpecs/manifest.json' },
                mockObjectsDirectoryPath,
                resultsLoad,
                { freshness: 'fresh', message: '' }
            );

        }

        it('pairs each generated spec method with the class file it is declared in', () => {

            const actualViewModel = buildManifestSourcedViewModel();
            const objectViewModel = actualViewModel.objects[0];
            const stateNode = PicklistDependencyExplorerService.flattenNodes(objectViewModel.rootNodes)
                                    .find(node => node.fieldApiName === 'State__c');

            const actualTargets = PicklistDependencyExplorerService.collectOpenableSpecTargets(actualViewModel);

            expect(actualTargets).toContain(
                PicklistDependencyExplorerService.buildOpenTargetKey(objectViewModel.generatedClassFilePath, stateNode.specMethodName)
            );

        });

        it('includes the record type scoped spec methods, which is where a scoped failure points', () => {

            const actualViewModel = buildManifestSourcedViewModel();
            const objectViewModel = actualViewModel.objects[0];
            const scopedMethodName = PicklistDependencyExplorerService.flattenNodes(objectViewModel.rootNodes)
                                        .find(node => node.fieldApiName === 'State__c')
                                        .recordTypeScopes[0].specMethodName;

            expect(PicklistDependencyExplorerService.collectOpenableSpecTargets(actualViewModel)).toContain(
                PicklistDependencyExplorerService.buildOpenTargetKey(objectViewModel.generatedClassFilePath, scopedMethodName)
            );

        });

        /*
            A metadata preview is asserted by nothing, so it names no generated code -- and offering
            a link into a class that does not exist would contradict the banner above it.
        */
        it('given a metadata preview, offers no spec target at all', () => {

            const previewViewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath,
                buildChainExampleSpecDetails(),
                [],
                buildNoResultsLoad(),
                [],
                PicklistDependencyExplorerService.buildMetadataPreviewContext()
            );

            expect(PicklistDependencyExplorerService.collectOpenableSpecTargets(previewViewModel)).toBeEmpty();

        });

        it('given a run that wrote a report, pairs the report with each object test method it names', () => {

            const resultsLoad = PicklistDependencyExplorerService.loadLatestResults(mockResultsWithReportDirectoryPath);
            const actualViewModel = buildManifestSourcedViewModel(resultsLoad);

            expect(PicklistDependencyExplorerService.collectOpenableRunReportTargets(actualViewModel)).toContain(
                PicklistDependencyExplorerService.buildOpenTargetKey(
                    actualViewModel.runSummary.reportFilePath,
                    actualViewModel.objects[0].testMethodName
                )
            );

        });

        it('given no run at all, offers no run report target', () => {

            expect(PicklistDependencyExplorerService.collectOpenableRunReportTargets(buildManifestSourcedViewModel())).toBeEmpty();

        });

        it('collects every combination key the model declares, scoped rows included', () => {

            const actualCombinationKeys = PicklistDependencyExplorerService.collectCombinationKeys(buildManifestSourcedViewModel());

            expect(actualCombinationKeys).toContain('Chain_Example__c.State__c @ USA');
            expect(actualCombinationKeys).toContain('Chain_Example__c.State__c [North_America] @ USA');

        });

    });

    describe('findApexMethodDeclarationLineNumber', () => {

        const generatedClassContent = [
            'public class SDTChainExamplePicklistDependencySpecs {',
            '',
            '    public static List<SDTPicklistDependencySpec> all() {',
            '        return new List<SDTPicklistDependencySpec>{ specForState() };',
            '    }',
            '',
            '    public static SDTPicklistDependencySpec specForState() {',
            '        return new SDTPicklistDependencySpec();',
            '    }',
            '}'
        ].join('\n');

        /*
            A generated class names each spec method twice -- at its declaration and inside all().
            Landing the reader on the aggregate line would put them one scroll from the thing they
            asked to see, every time.
        */
        it('given a method named at both its declaration and a call site, returns the declaration line', () => {

            expect(PicklistDependencyExplorerService.findApexMethodDeclarationLineNumber(generatedClassContent, 'specForState')).toBe(7);

        });

        it('given a method the class does not declare, returns 0 so the file simply opens at the top', () => {

            expect(PicklistDependencyExplorerService.findApexMethodDeclarationLineNumber(generatedClassContent, 'specForNothing')).toBe(0);

        });

        it('given an empty class or no method name, returns 0', () => {

            expect(PicklistDependencyExplorerService.findApexMethodDeclarationLineNumber('', 'specForState')).toBe(0);
            expect(PicklistDependencyExplorerService.findApexMethodDeclarationLineNumber(generatedClassContent, '')).toBe(0);

        });

    });

    describe('findRunReportEntryLineNumber', () => {

        const runReportContent = fs.readFileSync(
            path.join(mockResultsWithReportDirectoryPath, 'check-devHub-2026-09-03T09-00-00', 'report.md'),
            'utf-8'
        );

        it('given a method the report has a failure entry for, returns the heading line rather than the table row', () => {

            const actualLineNumber = PicklistDependencyExplorerService.findRunReportEntryLineNumber(
                runReportContent,
                'chainExamplePicklistDependenciesStillHold'
            );

            expect(runReportContent.split('\n')[actualLineNumber - 1].trim())
                .toBe('### chainExamplePicklistDependenciesStillHold');

        });

        it('given a method that only appears in the methods table, falls back to that row', () => {

            const passingReportContent = [
                '# Picklist Dependency Check',
                '',
                '| Outcome | Method |',
                '|---------|--------|',
                '| PASS | `chainExamplePicklistDependenciesStillHold` |'
            ].join('\n');

            expect(PicklistDependencyExplorerService.findRunReportEntryLineNumber(
                passingReportContent,
                'chainExamplePicklistDependenciesStillHold'
            )).toBe(5);

        });

        it('given a method the report never names, returns 0', () => {

            expect(PicklistDependencyExplorerService.findRunReportEntryLineNumber(runReportContent, 'someOtherMethod')).toBe(0);

        });

    });

    describe('buildWebviewHtml navigation and triage wiring', () => {

        function buildRenderedHtml(): string {

            const actualViewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath,
                buildChainExampleSpecDetails(),
                [],
                buildNoResultsLoad(),
                buildChainExampleRecordTypeSpecDetails()
            );

            return PicklistDependencyExplorerService.buildWebviewHtml(actualViewModel, 'testNonce');

        }

        it('renders the find box, the status filter, the jump list and the expand controls', () => {

            const actualWebviewHtml = buildRenderedHtml();

            expect(actualWebviewHtml).toContain('Find object or field');
            expect(actualWebviewHtml).toContain('Jump to object');
            expect(actualWebviewHtml).toContain('Expand all');
            expect(actualWebviewHtml).toContain('Collapse all');
            expect(actualWebviewHtml).toContain('not checked');

        });

        it('bounds "expand all" by the stated object limit rather than building every row', () => {

            expect(buildRenderedHtml()).toContain(
                'const EXPAND_ALL_OBJECT_LIMIT = ' + PICKLIST_DEPENDENCY_EXPLORER_EXPAND_ALL_OBJECT_LIMIT
            );

        });

        it('posts each new panel action under its own command name', () => {

            const actualWebviewHtml = buildRenderedHtml();

            expect(actualWebviewHtml).toContain("command: 'openSpecMethod'");
            expect(actualWebviewHtml).toContain("command: 'openRunReport'");
            expect(actualWebviewHtml).toContain("command: 'copyCombinationReference'");
            expect(actualWebviewHtml).toContain("command: 'revealFieldSource'");

        });

        it('labels the triage on screen so the Apex kind is never the only wording a reader gets', () => {

            const actualWebviewHtml = buildRenderedHtml();

            expect(actualWebviewHtml).toContain('Likely cause');
            expect(actualWebviewHtml).toContain('Next step');

        });

        /*
            Nothing about the panel's security posture may move with this feature: no external
            resource, the nonced inline style and script only, and the same escaping on every
            metadata-derived value.
        */
        it('keeps the content security policy and its nonce exactly as they were', () => {

            const actualWebviewHtml = buildRenderedHtml();

            expect(actualWebviewHtml).toContain(
                `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-testNonce'; script-src 'nonce-testNonce'; form-action 'none'; base-uri 'none';">`
            );
            expect(actualWebviewHtml).not.toContain('https://');

        });

        /*
            A pasted reference is the one query whose target does NOT match it as search text -- the
            key carries a controlling value no field name contains. Suspending node filtering while
            one is active is what stops the deep link scrolling to a row its own query just hid.
        */
        it('suspends node filtering while a pasted combination reference is active', () => {

            const actualWebviewHtml = buildRenderedHtml();

            expect(actualWebviewHtml).toContain('isDeepLinkActive = !!deepLinkRecord');
            expect(actualWebviewHtml).toContain('if (isDeepLinkActive) {');
            expect(actualWebviewHtml).toContain('showEveryNode(sectionRecord);');

        });

        it('renders every truncation notice the ceiling wrote', () => {

            let viewModel = PicklistDependencyExplorerService.buildExplorerViewModel(
                mockObjectsDirectoryPath,
                buildChainExampleSpecDetails(),
                [],
                buildNoResultsLoad()
            );

            viewModel = PicklistDependencyExplorerService.applyModelLimits(
                viewModel,
                { maxObjects: 250, maxCombinationsPerNode: 1, maxRecordTypeScopesPerNode: 25 }
            );

            const actualWebviewHtml = PicklistDependencyExplorerService.buildWebviewHtml(viewModel, 'testNonce');

            expect(actualWebviewHtml).toContain('combination(s) are not rendered');
            expect(actualWebviewHtml).toContain('renderTruncationNotices');

        });

    });


});
