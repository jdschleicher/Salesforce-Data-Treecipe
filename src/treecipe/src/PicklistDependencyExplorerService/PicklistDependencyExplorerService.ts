import {
    IPicklistDependencySpecDetail,
    PicklistDependencyTestService
} from '../PicklistDependencyTestService/PicklistDependencyTestService';

import * as fs from 'fs';
import * as path from 'path';

/*
    A combination is either confirmed good, confirmed drifted, or not covered by the run that was
    loaded. "unknown" is a distinct state on purpose: a check that has not run, or a failure whose
    message could not be attributed to a combination, must never render as a green tick -- the
    panel would then report a dependency as verified when nothing verified it.
*/
export type PicklistDependencyCheckStatus = 'passed' | 'failed' | 'unknown';

/*
    Why the panel has no results to overlay, which the empty states are keyed off. "noResultsFound"
    and "unreadableResults" are both non-error states -- the structure still renders either way.
*/
export type PicklistDependencyRunLoadState = 'loaded' | 'noResultsFound' | 'unreadableResults';

export interface IPicklistDependencyCombinationViewModel {
    controllingValue: string;
    allowedValues: string[];
    forbiddenValues: string[];
    status: PicklistDependencyCheckStatus;
    failureKind?: string;
    failureMessage?: string;
}

export interface IPicklistDependencyNodeViewModel {
    objectApiName: string;
    fieldApiName: string;
    controllingFieldApiName: string;
    // ABSOLUTE PATH TO THE ".field-meta.xml" THAT GENERATED THIS NODE, FOR THE REVEAL ACTION
    sourceFilePath: string;
    combinations: IPicklistDependencyCombinationViewModel[];
    // FIELDS CONTROLLED BY THIS ONE, WHICH IS WHAT MAKES A CHAIN A GRAPH RATHER THAN REPEATED ROWS
    downstreamNodes: IPicklistDependencyNodeViewModel[];
    status: PicklistDependencyCheckStatus;
    failureCount: number;
    // SET WHEN THE VALIDATOR REPORTED A FAILURE AGAINST THE FIELD RATHER THAN AGAINST ONE COMBINATION
    fieldLevelFailureKind?: string;
    fieldLevelFailureMessage?: string;
}

export interface IPicklistDependencyObjectViewModel {
    objectApiName: string;
    rootNodes: IPicklistDependencyNodeViewModel[];
    dependentFieldCount: number;
    combinationCount: number;
    status: PicklistDependencyCheckStatus;
    failureCount: number;
    /*
        The generated Apex test method that covers this object. Held so a reader can tie a panel row
        back to the line in results.json, and so an object present in the metadata but absent from
        the loaded run is distinguishable from one that ran and passed.
    */
    testMethodName: string;
    // THE FAILURE MESSAGE AS APEX WROTE IT, KEPT WHEN NO COMBINATION COULD BE ATTRIBUTED
    unattributedFailureMessage?: string;
}

export interface IPicklistDependencyRunSummary {
    targetOrg: string;
    ranAt: string;
    passed: boolean;
    failureCount: number;
    methodsRun: number;
    resultsFilePath: string;
}

export interface IPicklistDependencyExplorerViewModel {
    scannedObjectsDirectoryPath: string;
    objects: IPicklistDependencyObjectViewModel[];
    dependentFieldCount: number;
    combinationCount: number;
    runLoadState: PicklistDependencyRunLoadState;
    runSummary?: IPicklistDependencyRunSummary;
    // WHY A RUN COULD NOT BE LOADED, IN WORDS A READER CAN ACT ON
    runLoadMessage: string;
    skippedFieldWarnings: string[];
}

export interface IParsedPicklistDependencyFailure {
    objectApiName: string;
    fieldApiName: string;
    // ABSENT FOR A FAILURE THE VALIDATOR RAISED AGAINST THE WHOLE FIELD RATHER THAN ONE COMBINATION
    controllingValue?: string;
    kind: string;
    message: string;
}

export interface IPicklistDependencyResultsMethodOutcome {
    methodName: string;
    passed: boolean;
    message?: string;
}

export interface IPicklistDependencyResultsFile {
    targetOrg: string;
    ranAt: string;
    passed: boolean;
    failureCount: number;
    methodsRun: number;
    methodOutcomes: IPicklistDependencyResultsMethodOutcome[];
}

export interface IPicklistDependencyResultsLoad {
    state: PicklistDependencyRunLoadState;
    message: string;
    results?: IPicklistDependencyResultsFile;
    resultsFilePath?: string;
}

export class PicklistDependencyExplorerService {

    static getResultsFileName(): string {
        return 'results.json';
    }

    /*
        The run folder name is "check-{org}-{timestamp}" and the org identifier can itself contain
        hyphens, so the timestamp is anchored at the END of the name rather than split out by
        position. VSCodeWorkspaceService writes it as an ISO string with the colons replaced, which
        is fixed width and therefore sorts chronologically as plain text.
    */
    private static resultsFolderTimestampPattern = /-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})$/;

    static getResultsFolderTimestamp(resultsFolderName: string): string | undefined {

        const timestampMatch = this.resultsFolderTimestampPattern.exec(resultsFolderName);
        return timestampMatch ? timestampMatch[1] : undefined;

    }

    /*
        The most recent run folder holding a results.json.

        Ordering is by the timestamp in the folder name rather than by mtime: every file in a fresh
        clone carries the checkout time, which would make the "most recent" run arbitrary for anyone
        who committed their check artifacts. A folder whose name carries no parseable timestamp is
        skipped rather than guessed at -- it was not written by the check command.
    */
    static findLatestResultsFilePath(resultsFolderPath: string): string | undefined {

        if ( !fs.existsSync(resultsFolderPath) ) {
            return undefined;
        }

        let latestTimestamp: string | undefined;
        let latestResultsFilePath: string | undefined;

        const resultsFolderEntries = fs.readdirSync(resultsFolderPath, { withFileTypes: true });

        resultsFolderEntries.forEach(resultsFolderEntry => {

            if ( !resultsFolderEntry.isDirectory() ) {
                return;
            }

            const runFolderTimestamp = this.getResultsFolderTimestamp(resultsFolderEntry.name);
            if ( !runFolderTimestamp ) {
                return;
            }

            const candidateResultsFilePath = path.join(resultsFolderPath, resultsFolderEntry.name, this.getResultsFileName());
            if ( !fs.existsSync(candidateResultsFilePath) ) {
                return;
            }

            if ( latestTimestamp === undefined || runFolderTimestamp > latestTimestamp ) {
                latestTimestamp = runFolderTimestamp;
                latestResultsFilePath = candidateResultsFilePath;
            }

        });

        return latestResultsFilePath;

    }

    /*
        A results.json that cannot be read is reported as a state rather than thrown. The dependency
        STRUCTURE is readable without any run at all, so a corrupt artifact must degrade the overlay
        and nothing else -- throwing here would leave the user with a blank panel and no way to see
        the dependencies the file has nothing to do with.
    */
    static loadLatestResults(resultsFolderPath: string): IPicklistDependencyResultsLoad {

        const latestResultsFilePath = this.findLatestResultsFilePath(resultsFolderPath);

        if ( !latestResultsFilePath ) {
            return {
                state: 'noResultsFound',
                message: `No picklist dependency check has been run yet -- no run results were found in "${resultsFolderPath}". Run "Salesforce Treecipe: Run Picklist Dependency Check" to overlay pass/fail state on the structure below.`
            };
        }

        let parsedResultsFileContent: any;

        try {
            parsedResultsFileContent = JSON.parse(fs.readFileSync(latestResultsFilePath, 'utf-8'));
        } catch (error) {
            return {
                state: 'unreadableResults',
                message: `The most recent check results at "${latestResultsFilePath}" could not be read as JSON (${error.message}). The dependency structure below is shown without pass/fail state -- re-run the picklist dependency check to replace the file.`,
                resultsFilePath: latestResultsFilePath
            };
        }

        // A FILE THAT PARSES BUT CARRIES NO OUTCOMES IS AS UNUSABLE AS ONE THAT DOES NOT PARSE, AND IS REPORTED THE SAME WAY
        if ( !parsedResultsFileContent || !Array.isArray(parsedResultsFileContent.methodOutcomes) ) {
            return {
                state: 'unreadableResults',
                message: `The most recent check results at "${latestResultsFilePath}" are missing the "methodOutcomes" list, so no pass/fail state could be overlaid. Re-run the picklist dependency check to replace the file.`,
                resultsFilePath: latestResultsFilePath
            };
        }

        const methodOutcomes: IPicklistDependencyResultsMethodOutcome[] = parsedResultsFileContent.methodOutcomes.map(
            (methodOutcome: any) => ({
                methodName: typeof methodOutcome?.methodName === 'string' ? methodOutcome.methodName : 'unknown',
                passed: methodOutcome?.passed === true,
                message: typeof methodOutcome?.message === 'string' ? methodOutcome.message : undefined
            })
        );

        return {
            state: 'loaded',
            message: '',
            resultsFilePath: latestResultsFilePath,
            results: {
                targetOrg: typeof parsedResultsFileContent.targetOrg === 'string' ? parsedResultsFileContent.targetOrg : 'unknown org',
                ranAt: typeof parsedResultsFileContent.ranAt === 'string' ? parsedResultsFileContent.ranAt : 'unknown time',
                passed: parsedResultsFileContent.passed === true,
                failureCount: typeof parsedResultsFileContent.failureCount === 'number' ? parsedResultsFileContent.failureCount : 0,
                methodsRun: typeof parsedResultsFileContent.methodsRun === 'number' ? parsedResultsFileContent.methodsRun : methodOutcomes.length,
                methodOutcomes: methodOutcomes
            }
        };

    }

    /*
        Pulls the per-combination failures out of an Apex assertion message.

        The generated test class joins SDTPicklistDependencyValidator.Failure.toLine() output, whose
        shape is "KIND — Object.Field @ ControllingValue: message". The message reaching results.json
        is that text wrapped in whatever the CLI adds around a failed assertion, so every line is
        scanned rather than the message being parsed as a whole.

        Both an em dash and a plain hyphen are accepted as the separator: the Apex emits an em dash,
        but a message that has been through a lossy encoding on its way out of the org should still
        attribute rather than silently degrade the whole object to "unknown".
    */
    private static failureLinePattern = /^\s*(?:-\s*)?([A-Z][A-Z0-9_]*)\s+(?:—|--|-)\s+([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)(?:\s+@\s+(.+?))?\s*:\s*(.*)$/;

    static parseFailureLines(assertionMessage: string | undefined): IParsedPicklistDependencyFailure[] {

        if ( !assertionMessage ) {
            return [];
        }

        let parsedFailures: IParsedPicklistDependencyFailure[] = [];

        assertionMessage.split(/\r\n|\r|\n/).forEach(messageLine => {

            const failureLineMatch = this.failureLinePattern.exec(messageLine);
            if ( !failureLineMatch ) {
                return;
            }

            const [, failureKind, objectApiName, fieldApiName, controllingValue, failureMessage] = failureLineMatch;

            parsedFailures.push({
                objectApiName: objectApiName,
                fieldApiName: fieldApiName,
                controllingValue: controllingValue ? controllingValue.trim() : undefined,
                kind: failureKind,
                message: failureMessage.trim()
            });

        });

        return parsedFailures;

    }

    /*
        The ".field-meta.xml" that produced a spec. Derived from the scanned objects directory rather
        than recorded during collection, which keeps the collection service read-only -- source format
        fixes the layout as "<objects>/<Object>/fields/<Field>.field-meta.xml", so nothing is guessed.
    */
    static buildFieldSourceFilePath(objectsDirectoryPath: string, objectApiName: string, fieldApiName: string): string {
        return path.join(objectsDirectoryPath, objectApiName, 'fields', `${fieldApiName}.field-meta.xml`);
    }

    static buildCombinationViewModels(specDetail: IPicklistDependencySpecDetail): IPicklistDependencyCombinationViewModel[] {

        return specDetail.expectations.map(expectation => ({
            controllingValue: expectation.controllingValue,
            allowedValues: [...expectation.dependentValues],
            forbiddenValues: expectation.forbiddenValues ? [...expectation.forbiddenValues] : [],
            status: 'unknown' as PicklistDependencyCheckStatus
        }));

    }

    /*
        Assembles one object's dependent fields into a connected graph.

        A spec whose controlling field is itself a dependent picklist carries upstreamFieldApiName,
        so the chain is already described -- this turns those links into containment, which is what
        lets the panel draw a chain once instead of repeating the same controlling field on every
        flat row beneath it.

        visitedFieldApiNames guards the descent. A spec pair that names each other as upstream is
        not producible by the generator, but the view model is also built from hand-assembled spec
        details in tests and by any future caller, and an unguarded walk would not return.
    */
    static buildNodesByObjectSpecDetails(objectsDirectoryPath: string,
                                            objectApiName: string,
                                            objectSpecDetails: IPicklistDependencySpecDetail[]): IPicklistDependencyNodeViewModel[] {

        let downstreamSpecDetailsByUpstreamFieldApiName: Record<string, IPicklistDependencySpecDetail[]> = {};
        const specDetailFieldApiNames = new Set(objectSpecDetails.map(specDetail => specDetail.fieldApiName));

        objectSpecDetails.forEach(specDetail => {

            /*
                An upstream field naming a spec that is not in this object's collection cannot be
                nested under anything, so the spec is treated as a root. That happens when the
                upstream field was skipped for an invalid api name or missing valueSettings.
            */
            if ( !specDetail.upstreamFieldApiName || !specDetailFieldApiNames.has(specDetail.upstreamFieldApiName) ) {
                return;
            }

            const upstreamFieldApiName = specDetail.upstreamFieldApiName;
            downstreamSpecDetailsByUpstreamFieldApiName[upstreamFieldApiName] = downstreamSpecDetailsByUpstreamFieldApiName[upstreamFieldApiName] || [];
            downstreamSpecDetailsByUpstreamFieldApiName[upstreamFieldApiName].push(specDetail);

        });

        const nestedFieldApiNames = new Set(
            Object.values(downstreamSpecDetailsByUpstreamFieldApiName)
                .reduce((allDownstream: IPicklistDependencySpecDetail[], downstreamSpecDetails) => allDownstream.concat(downstreamSpecDetails), [])
                .map(specDetail => specDetail.fieldApiName)
        );

        const buildNode = (specDetail: IPicklistDependencySpecDetail,
                            visitedFieldApiNames: Set<string>): IPicklistDependencyNodeViewModel => {

            const alreadyVisitedFieldApiNames = new Set(visitedFieldApiNames);
            alreadyVisitedFieldApiNames.add(specDetail.fieldApiName);

            const downstreamSpecDetails = (downstreamSpecDetailsByUpstreamFieldApiName[specDetail.fieldApiName] || [])
                .filter(downstreamSpecDetail => !alreadyVisitedFieldApiNames.has(downstreamSpecDetail.fieldApiName));

            return {
                objectApiName: specDetail.objectApiName,
                fieldApiName: specDetail.fieldApiName,
                controllingFieldApiName: specDetail.controllingFieldApiName,
                sourceFilePath: this.buildFieldSourceFilePath(objectsDirectoryPath, specDetail.objectApiName, specDetail.fieldApiName),
                combinations: this.buildCombinationViewModels(specDetail),
                downstreamNodes: downstreamSpecDetails.map(downstreamSpecDetail => buildNode(downstreamSpecDetail, alreadyVisitedFieldApiNames)),
                status: 'unknown',
                failureCount: 0
            };

        };

        return objectSpecDetails
            .filter(specDetail => !nestedFieldApiNames.has(specDetail.fieldApiName))
            .map(specDetail => buildNode(specDetail, new Set<string>()));

    }

    static countNodes(nodes: IPicklistDependencyNodeViewModel[]): number {
        return nodes.reduce((nodeCount, node) => nodeCount + 1 + this.countNodes(node.downstreamNodes), 0);
    }

    static countCombinations(nodes: IPicklistDependencyNodeViewModel[]): number {
        return nodes.reduce((combinationCount, node) => combinationCount + node.combinations.length + this.countCombinations(node.downstreamNodes), 0);
    }

    /*
        Applies one object's parsed failures down its graph.

        A failure naming a controlling value marks that combination; one without names the field as a
        whole (LOOKUP_ERROR, CONTROLLING_FIELD_MISMATCH, UPSTREAM_FAILURE, CIRCULAR_DEPENDENCY all
        arrive that way). Everything the object's run covered and no failure named is passed --
        which is only sound because the caller withholds this entirely when the run failed with
        nothing attributable.
    */
    static applyFailuresToNodes(nodes: IPicklistDependencyNodeViewModel[],
                                    parsedFailures: IParsedPicklistDependencyFailure[],
                                    objectRan: boolean): number {

        let appliedFailureCount = 0;

        nodes.forEach(node => {

            const failuresForField = parsedFailures.filter(
                parsedFailure => parsedFailure.objectApiName === node.objectApiName && parsedFailure.fieldApiName === node.fieldApiName
            );

            let nodeFailureCount = 0;

            node.combinations.forEach(combination => {

                const failureForCombination = failuresForField.find(
                    parsedFailure => parsedFailure.controllingValue === combination.controllingValue
                );

                if ( failureForCombination ) {

                    combination.status = 'failed';
                    combination.failureKind = failureForCombination.kind;
                    combination.failureMessage = failureForCombination.message;
                    nodeFailureCount++;
                    return;

                }

                combination.status = objectRan ? 'passed' : 'unknown';

            });

            const fieldLevelFailure = failuresForField.find(parsedFailure => parsedFailure.controllingValue === undefined);

            if ( fieldLevelFailure ) {

                node.fieldLevelFailureKind = fieldLevelFailure.kind;
                node.fieldLevelFailureMessage = fieldLevelFailure.message;
                nodeFailureCount++;

            }

            const downstreamFailureCount = this.applyFailuresToNodes(node.downstreamNodes, parsedFailures, objectRan);

            node.failureCount = nodeFailureCount;

            if ( nodeFailureCount > 0 ) {
                node.status = 'failed';
            } else if ( objectRan ) {
                node.status = 'passed';
            } else {
                node.status = 'unknown';
            }

            appliedFailureCount += nodeFailureCount + downstreamFailureCount;

        });

        return appliedFailureCount;

    }

    /*
        The whole view model: dependency structure from local source metadata, with the most recent
        check overlaid onto it when one exists.

        An object whose test method failed but whose message yielded no attributable failure line
        keeps every combination at "unknown" and surfaces the raw Apex message instead. Marking them
        all failed would overstate a drift that touched one combination, and marking them passed
        would report green for a combination the org may well have broken -- neither is a claim the
        loaded artifact supports.
    */
    static buildExplorerViewModel(objectsDirectoryPath: string,
                                    specDetails: IPicklistDependencySpecDetail[],
                                    skippedFieldWarnings: string[],
                                    resultsLoad: IPicklistDependencyResultsLoad): IPicklistDependencyExplorerViewModel {

        const distinctObjectApiNames = PicklistDependencyTestService.getDistinctObjectApiNames(specDetails);
        const testMethodNamesByObjectApiName = PicklistDependencyTestService.buildTestMethodNamesByObjectApiName(distinctObjectApiNames);

        let methodOutcomesByMethodName: Record<string, IPicklistDependencyResultsMethodOutcome> = {};
        ( resultsLoad.results?.methodOutcomes || [] ).forEach(methodOutcome => {
            methodOutcomesByMethodName[methodOutcome.methodName] = methodOutcome;
        });

        const objects: IPicklistDependencyObjectViewModel[] = distinctObjectApiNames.map(objectApiName => {

            const objectSpecDetails = specDetails.filter(specDetail => specDetail.objectApiName === objectApiName);
            const rootNodes = this.buildNodesByObjectSpecDetails(objectsDirectoryPath, objectApiName, objectSpecDetails);

            const testMethodName = testMethodNamesByObjectApiName[objectApiName];
            const methodOutcome = methodOutcomesByMethodName[testMethodName];

            const parsedFailures = methodOutcome && !methodOutcome.passed
                ? this.parseFailureLines(methodOutcome.message)
                : [];

            const failureIsUnattributable = !!( methodOutcome && !methodOutcome.passed && parsedFailures.length === 0 );
            const objectRan = !!methodOutcome && !failureIsUnattributable;

            const attributedFailureCount = this.applyFailuresToNodes(rootNodes, parsedFailures, objectRan);

            let objectStatus: PicklistDependencyCheckStatus = 'unknown';
            if ( methodOutcome ) {
                objectStatus = methodOutcome.passed ? 'passed' : 'failed';
            }

            return {
                objectApiName: objectApiName,
                rootNodes: rootNodes,
                dependentFieldCount: this.countNodes(rootNodes),
                combinationCount: this.countCombinations(rootNodes),
                status: objectStatus,
                failureCount: attributedFailureCount,
                testMethodName: testMethodName,
                unattributedFailureMessage: failureIsUnattributable ? methodOutcome.message : undefined
            };

        });

        const runSummary: IPicklistDependencyRunSummary | undefined = ( resultsLoad.state === 'loaded' && resultsLoad.results )
            ? {
                targetOrg: resultsLoad.results.targetOrg,
                ranAt: resultsLoad.results.ranAt,
                passed: resultsLoad.results.passed,
                failureCount: resultsLoad.results.failureCount,
                methodsRun: resultsLoad.results.methodsRun,
                resultsFilePath: resultsLoad.resultsFilePath
            }
            : undefined;

        return {
            scannedObjectsDirectoryPath: objectsDirectoryPath,
            objects: objects,
            dependentFieldCount: objects.reduce((fieldCount, objectViewModel) => fieldCount + objectViewModel.dependentFieldCount, 0),
            combinationCount: objects.reduce((combinationCount, objectViewModel) => combinationCount + objectViewModel.combinationCount, 0),
            runLoadState: resultsLoad.state,
            runSummary: runSummary,
            runLoadMessage: resultsLoad.message,
            skippedFieldWarnings: [...skippedFieldWarnings]
        };

    }

    /*
        Every ".field-meta.xml" the model can ask the extension host to reveal. The webview is the
        one part of this feature that renders untrusted-by-construction content, so the reveal
        handler matches the requested path against this set rather than trusting the path posted
        back to it -- a panel that could open any path on disk would be a hole regardless of how
        the message got there.
    */
    static collectSourceFilePaths(viewModel: IPicklistDependencyExplorerViewModel): string[] {

        const collectFromNodes = (nodes: IPicklistDependencyNodeViewModel[]): string[] =>
            nodes.reduce((sourceFilePaths: string[], node) => sourceFilePaths.concat([node.sourceFilePath], collectFromNodes(node.downstreamNodes)), []);

        return viewModel.objects.reduce((sourceFilePaths: string[], objectViewModel) => sourceFilePaths.concat(collectFromNodes(objectViewModel.rootNodes)), []);

    }

    /*
        Escaped for HTML text and attribute contexts alike. Picklist values, api names and Apex
        failure messages all reach the panel unmodified from metadata an admin controls, so none of
        it is interpolated raw. The JSON payload takes the same treatment below.
    */
    static escapeHtml(value: string): string {

        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

    }

    /*
        Neutralises the characters that can end a <script> block early, for any JSON literal being
        placed inside one. The escapes are JSON's own, so the text still parses to the identical
        value -- a picklist value of "</script>" reads back as "</script>" and simply cannot close
        the element it is sitting in on the way there.
    */
    static escapeJsonForScriptBlock(jsonText: string): string {

        return jsonText
            .replace(/</g, '\\u003c')
            .replace(/>/g, '\\u003e')
            .replace(/&/g, '\\u0026');

    }

    /*
        The model is handed to the panel script as JSON inside a <script type="application/json">
        block rather than as a JS literal, so nothing in it is ever evaluated -- and it is escaped
        above so it cannot close that block either.
    */
    static buildEmbeddedModelJson(viewModel: IPicklistDependencyExplorerViewModel): string {

        return this.escapeJsonForScriptBlock(JSON.stringify(viewModel));

    }

    static buildContentSecurityPolicy(nonce: string): string {

        return `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';`;

    }

    static buildNonce(): string {

        const nonceCharacters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

        let nonce = '';
        for ( let nonceCharacterIndex = 0; nonceCharacterIndex < 32; nonceCharacterIndex++ ) {
            nonce += nonceCharacters.charAt(Math.floor(Math.random() * nonceCharacters.length));
        }

        return nonce;

    }

    static buildEmptyStateMessage(viewModel: IPicklistDependencyExplorerViewModel): string {

        return `No dependent picklists were found in "${viewModel.scannedObjectsDirectoryPath}". A picklist appears here once its field metadata declares a "controllingField" and the "valueSettings" markup that maps controlling values to dependent values.`;

    }

    /*
        The shell only. Every colour is a VS Code theme variable, so the panel follows the active
        light, dark or high contrast theme without the extension having to know which is active, and
        the structure itself is rendered by the inline script from the embedded model.
    */
    static buildWebviewHtml(viewModel: IPicklistDependencyExplorerViewModel, nonce: string): string {

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${this.buildContentSecurityPolicy(nonce)}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Picklist Dependency Explorer</title>
<style nonce="${nonce}">
    body {
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--vscode-foreground);
        background-color: var(--vscode-editor-background);
        padding: 0 1rem 2rem 1rem;
    }
    h1 { font-size: 1.3rem; margin-bottom: 0.25rem; }
    .runBanner {
        border: 1px solid var(--vscode-panel-border);
        border-left-width: 4px;
        padding: 0.6rem 0.8rem;
        margin: 0.75rem 0 1rem 0;
    }
    .runBanner.passed { border-left-color: var(--vscode-testing-iconPassed); }
    .runBanner.failed { border-left-color: var(--vscode-testing-iconFailed); }
    .runBanner.unknown { border-left-color: var(--vscode-testing-iconQueued); }
    .muted { color: var(--vscode-descriptionForeground); }
    .objectSection { margin-bottom: 1.5rem; }
    .objectHeading { font-size: 1.05rem; font-weight: 600; margin-bottom: 0.25rem; }
    /* THE LEFT RULE AND ELBOW ARE WHAT DRAW A CHAIN AS ONE CONNECTED GRAPH RATHER THAN REPEATED ROWS */
    .nodeChildren {
        margin-left: 0.9rem;
        padding-left: 1rem;
        border-left: 1px solid var(--vscode-panel-border);
    }
    .node { margin: 0.5rem 0; }
    .nodeHeading {
        display: flex;
        align-items: baseline;
        gap: 0.5rem;
        flex-wrap: wrap;
    }
    .nodeChildren > .node > .nodeHeading::before {
        content: "\\21b3";
        color: var(--vscode-descriptionForeground);
        margin-right: 0.25rem;
    }
    .fieldName { font-weight: 600; }
    .combination {
        border: 1px solid var(--vscode-panel-border);
        border-left-width: 3px;
        padding: 0.4rem 0.6rem;
        margin: 0.3rem 0 0.3rem 1rem;
        cursor: pointer;
    }
    .combination:hover { background-color: var(--vscode-list-hoverBackground); }
    .combination.passed { border-left-color: var(--vscode-testing-iconPassed); }
    .combination.failed { border-left-color: var(--vscode-testing-iconFailed); }
    .combination.unknown { border-left-color: var(--vscode-testing-iconQueued); }
    .statusBadge {
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        border: 1px solid var(--vscode-panel-border);
        padding: 0 0.35rem;
    }
    .statusBadge.passed { color: var(--vscode-testing-iconPassed); }
    .statusBadge.failed { color: var(--vscode-testing-iconFailed); }
    .statusBadge.unknown { color: var(--vscode-descriptionForeground); }
    .valueList { margin: 0.2rem 0; }
    .valueLabel { color: var(--vscode-descriptionForeground); margin-right: 0.35rem; }
    .value {
        display: inline-block;
        border: 1px solid var(--vscode-panel-border);
        padding: 0 0.3rem;
        margin: 0.1rem 0.2rem 0.1rem 0;
    }
    .value.forbidden { text-decoration: line-through; color: var(--vscode-descriptionForeground); }
    .failureDetail {
        margin-top: 0.35rem;
        padding: 0.35rem 0.5rem;
        background-color: var(--vscode-textCodeBlock-background);
        white-space: pre-wrap;
        font-family: var(--vscode-editor-font-family);
        font-size: 0.85em;
    }
    .sourceDetail { margin-top: 0.4rem; }
    .sourcePath {
        font-family: var(--vscode-editor-font-family);
        font-size: 0.85em;
        color: var(--vscode-descriptionForeground);
        word-break: break-all;
    }
    button {
        color: var(--vscode-button-foreground);
        background-color: var(--vscode-button-background);
        border: none;
        padding: 0.25rem 0.6rem;
        margin-top: 0.3rem;
        cursor: pointer;
        font-family: inherit;
        font-size: 0.85em;
    }
    button:hover { background-color: var(--vscode-button-hoverBackground); }
    .warningList { border-left: 3px solid var(--vscode-testing-iconQueued); padding-left: 0.75rem; }
    .emptyState { padding: 1rem; border: 1px dashed var(--vscode-panel-border); }
    .hidden { display: none; }
</style>
</head>
<body>
<h1>Picklist Dependency Explorer</h1>
<div class="muted">Scanned <span class="sourcePath">${this.escapeHtml(viewModel.scannedObjectsDirectoryPath)}</span></div>
<div id="explorerRoot"></div>
<script id="explorerModel" type="application/json" nonce="${nonce}">${this.buildEmbeddedModelJson(viewModel)}</script>
<script nonce="${nonce}">
(function () {

    const vscodeApi = acquireVsCodeApi();
    const explorerModel = JSON.parse(document.getElementById('explorerModel').textContent);
    const explorerRoot = document.getElementById('explorerRoot');

    function createElement(tagName, className, textContent) {
        const element = document.createElement(tagName);
        if (className) { element.className = className; }
        if (textContent !== undefined) { element.textContent = textContent; }
        return element;
    }

    function appendStatusBadge(parentElement, status) {
        parentElement.appendChild(createElement('span', 'statusBadge ' + status, status === 'unknown' ? 'not checked' : status));
    }

    function appendValueList(parentElement, labelText, values, valueClassName) {

        if (!values.length) { return; }

        const valueListElement = createElement('div', 'valueList');
        valueListElement.appendChild(createElement('span', 'valueLabel', labelText));
        values.forEach(function (value) {
            valueListElement.appendChild(createElement('span', valueClassName, value));
        });
        parentElement.appendChild(valueListElement);

    }

    function buildCombinationElement(node, combination) {

        const combinationElement = createElement('div', 'combination ' + combination.status);

        const combinationHeading = createElement('div');
        combinationHeading.appendChild(createElement('span', 'fieldName', node.controllingFieldApiName + ' = ' + combination.controllingValue));
        appendStatusBadge(combinationHeading, combination.status);
        combinationElement.appendChild(combinationHeading);

        if (combination.allowedValues.length) {
            appendValueList(combinationElement, 'unlocks', combination.allowedValues, 'value');
        } else {
            combinationElement.appendChild(createElement('div', 'valueList muted', 'unlocks nothing'));
        }

        appendValueList(combinationElement, 'must not unlock', combination.forbiddenValues, 'value forbidden');

        if (combination.status === 'failed') {
            combinationElement.appendChild(
                createElement('div', 'failureDetail', combination.failureKind + '\\n' + combination.failureMessage)
            );
        }

        const sourceDetailElement = createElement('div', 'sourceDetail hidden');
        sourceDetailElement.appendChild(createElement('div', 'sourcePath', node.sourceFilePath));

        const revealButton = createElement('button', undefined, 'Reveal in Explorer');
        revealButton.addEventListener('click', function (clickEvent) {
            clickEvent.stopPropagation();
            vscodeApi.postMessage({ command: 'revealFieldSource', sourceFilePath: node.sourceFilePath });
        });
        sourceDetailElement.appendChild(revealButton);

        combinationElement.appendChild(sourceDetailElement);

        combinationElement.addEventListener('click', function () {
            sourceDetailElement.classList.toggle('hidden');
        });

        return combinationElement;

    }

    function buildNodeElement(node) {

        const nodeElement = createElement('div', 'node');

        const nodeHeading = createElement('div', 'nodeHeading');
        nodeHeading.appendChild(createElement('span', 'fieldName', node.fieldApiName));
        nodeHeading.appendChild(createElement('span', 'muted', 'controlled by ' + node.controllingFieldApiName));
        appendStatusBadge(nodeHeading, node.status);
        nodeElement.appendChild(nodeHeading);

        if (node.fieldLevelFailureMessage) {
            nodeElement.appendChild(
                createElement('div', 'failureDetail', node.fieldLevelFailureKind + '\\n' + node.fieldLevelFailureMessage)
            );
        }

        node.combinations.forEach(function (combination) {
            nodeElement.appendChild(buildCombinationElement(node, combination));
        });

        if (node.downstreamNodes.length) {
            const childrenElement = createElement('div', 'nodeChildren');
            node.downstreamNodes.forEach(function (downstreamNode) {
                childrenElement.appendChild(buildNodeElement(downstreamNode));
            });
            nodeElement.appendChild(childrenElement);
        }

        return nodeElement;

    }

    function renderRunBanner() {

        const bannerStatus = explorerModel.runSummary
            ? (explorerModel.runSummary.passed ? 'passed' : 'failed')
            : 'unknown';

        const bannerElement = createElement('div', 'runBanner ' + bannerStatus);

        if (explorerModel.runSummary) {

            const runSummary = explorerModel.runSummary;
            bannerElement.appendChild(createElement('div', 'fieldName',
                'Last check ' + (runSummary.passed ? 'passed' : 'failed') + ' against ' + runSummary.targetOrg));
            bannerElement.appendChild(createElement('div', 'muted',
                'Ran at ' + runSummary.ranAt + ' — ' + runSummary.methodsRun + ' method(s), ' + runSummary.failureCount + ' failure(s)'));
            bannerElement.appendChild(createElement('div', 'sourcePath', runSummary.resultsFilePath));

        } else {
            bannerElement.appendChild(createElement('div', undefined, explorerModel.runLoadMessage));
        }

        explorerRoot.appendChild(bannerElement);

    }

    function renderSkippedFieldWarnings() {

        if (!explorerModel.skippedFieldWarnings.length) { return; }

        const warningsElement = createElement('div', 'warningList');
        warningsElement.appendChild(createElement('div', 'fieldName',
            explorerModel.skippedFieldWarnings.length + ' field(s) were skipped and are not shown below'));
        explorerModel.skippedFieldWarnings.forEach(function (skippedFieldWarning) {
            warningsElement.appendChild(createElement('div', 'muted', skippedFieldWarning));
        });
        explorerRoot.appendChild(warningsElement);

    }

    function renderObjects() {

        if (!explorerModel.objects.length) {
            explorerRoot.appendChild(createElement('div', 'emptyState', ${this.escapeJsonForScriptBlock(JSON.stringify(this.buildEmptyStateMessage(viewModel)))}));
            return;
        }

        explorerRoot.appendChild(createElement('div', 'muted',
            explorerModel.objects.length + ' object(s), ' + explorerModel.dependentFieldCount
                + ' dependent picklist(s), ' + explorerModel.combinationCount + ' combination(s)'));

        explorerModel.objects.forEach(function (objectViewModel) {

            const objectElement = createElement('div', 'objectSection');

            const objectHeading = createElement('div', 'objectHeading');
            objectHeading.appendChild(createElement('span', undefined, objectViewModel.objectApiName));
            appendStatusBadge(objectHeading, objectViewModel.status);
            objectElement.appendChild(objectHeading);

            if (objectViewModel.unattributedFailureMessage) {
                objectElement.appendChild(createElement('div', 'failureDetail',
                    'This object\\'s check failed, but no individual combination could be identified from the failure message, so the combinations below are shown as not checked.\\n\\n'
                        + objectViewModel.unattributedFailureMessage));
            }

            objectViewModel.rootNodes.forEach(function (rootNode) {
                objectElement.appendChild(buildNodeElement(rootNode));
            });

            explorerRoot.appendChild(objectElement);

        });

    }

    renderRunBanner();
    renderSkippedFieldWarnings();
    renderObjects();

}());
</script>
</body>
</html>
`;

    }

}
