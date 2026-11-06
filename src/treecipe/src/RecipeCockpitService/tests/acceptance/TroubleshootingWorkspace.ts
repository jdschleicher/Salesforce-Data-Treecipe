import * as fs from 'fs';
import * as path from 'path';
import { RecipeCockpitJourney } from './RecipeCockpitJourney';
import { IFakeCliAnswer } from './RecipeCockpitJourneyFakes';
import { expectEqual, fileChangesSince } from './TreecipeTabWorkspace';

export { expectEqual, fileChangesSince };

/*
    The workspace #579's Troubleshooting journeys open, and what the org and the sf CLI answer there.

    treeWorkspace's run, with metadataDeployWorkspace's sfdx project copied over it as the cockpit's
    unit suites do (the Account tree's custom fields, validation rules, record types and two
    permission sets, one the tree's SDT_ set), and troubleshootingConfigOverlay's treecipe.config.json,
    without which the Validation Rules sub-tab cannot read the project's rules.
*/

export const TROUBLESHOOTING_FIXTURE = 'treeWorkspace';
export const TROUBLESHOOTING_OVERLAYS = ['metadataDeployWorkspace', 'troubleshootingConfigOverlay'];
export const TROUBLESHOOTING_TREE_NAME = 'Account-thru-OtherChildObject__c';
export const SANDBOX_ORG_LABEL = 'qa';
export const SANDBOX_USERNAME = 'qa@example.com.qa';
export const ORG_PICKER_NAME = 'Salesforce org the generated data goes to';

const RUN_FOLDER = 'treecipe/GeneratedRecipes/recipe-2026-09-20T10-00-00';
export const ORG_OPERATIONS_FOLDER = `${RUN_FOLDER}/${TROUBLESHOOTING_TREE_NAME}/RunArtifacts/OrgOperations/${SANDBOX_USERNAME}`;
export const ACCOUNT_VALIDATION_RULES_FOLDER = 'force-app/main/default/objects/Account/validationRules';

// WHAT THE TREE'S FIELD DEPLOY SENDS, AS THE CONFIRMATION LISTS IT
export const DEPLOYED_FIELD_NAMES = ['Account.Annual_Budget__c', 'Account.Rating__c', 'Account.Sub_Rating__c', 'OtherChildObject__c.Contact__c', 'OtherChildObject__c.Ratio__c', 'OtherChildObject__c.Score__c'];

// sf project deploy start --json, AS THE CLI ANSWERS A DEPLOY THAT LANDED AND ONE WHOSE COMPONENT FAILED
export const DEPLOY_SUCCEEDED_RESULT = { id: '0Af000000000001AAA', done: true, status: 'Succeeded', success: true, numberComponentsDeployed: 7, details: { componentSuccesses: [{ fullName: 'package.xml' }, { fullName: 'Account.Rating__c' }], componentFailures: [] } };
export const DEPLOY_SUCCEEDED_ANSWER: IFakeCliAnswer = { stdout: JSON.stringify({ status: 0, result: DEPLOY_SUCCEEDED_RESULT }), exitCode: 0 };
export const DEPLOY_COMPONENT_FAILED_ANSWER: IFakeCliAnswer = {
    stdout: JSON.stringify({ status: 1, result: { id: '0Af000000000002AAA', done: true, status: 'Failed', success: false, numberComponentsDeployed: 6, details: { componentFailures: [{ fullName: 'Account.Rating__c', componentType: 'CustomField', problem: 'Value set Account_Ratings not found', problemType: 'Error' }] } } }),
    exitCode: 1
};

// THE VALIDATION RULES THE ORG HOLDS, AS metadata.list ANSWERS: ONE ALSO IN THE PROJECT, ONE NEW, ONE ON AN OBJECT OUTSIDE THE TREE
export const ORG_VALIDATION_RULES = [
    { fullName: 'Account.Budget_Not_Negative', type: 'ValidationRule', fileName: 'objects/Account.object' },
    { fullName: 'Account.Name_Required', type: 'ValidationRule', fileName: 'objects/Account.object' },
    { fullName: 'Lead.Some_Lead_Rule', type: 'ValidationRule', fileName: 'objects/Lead.object' }
];

export function buildValidationRuleXml(ruleName: string, errorConditionFormula: string): string {
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<ValidationRule xmlns="http://soap.sforce.com/2006/04/metadata">',
        `    <fullName>${ruleName}</fullName>`,
        '    <active>true</active>',
        `    <errorConditionFormula>${errorConditionFormula}</errorConditionFormula>`,
        `    <errorMessage>${ruleName} failed in the org.</errorMessage>`,
        '</ValidationRule>',
        ''
    ].join('\n');
}

/*
    sf project retrieve start --json for the two Account rules: as the real CLI does, it writes them in
    source format and lists them -- the cockpit writes nothing itself on this path, so the files the
    reader then reads are the CLI's.
*/
export function answerValidationRuleRetrieve(journey: RecipeCockpitJourney): IFakeCliAnswer {
    const rulesFolderPath = path.join(journey.workspaceRoot, ...ACCOUNT_VALIDATION_RULES_FOLDER.split('/'));
    const retrievedRules = [
        { ruleName: 'Budget_Not_Negative', formula: 'Annual_Budget__c &lt; 0', state: 'Changed' },
        { ruleName: 'Name_Required', formula: 'ISBLANK(Name)', state: 'Created' }
    ];
    const files = retrievedRules.map(retrievedRule => {
        const filePath = path.join(rulesFolderPath, `${retrievedRule.ruleName}.validationRule-meta.xml`);
        fs.writeFileSync(filePath, buildValidationRuleXml(retrievedRule.ruleName, retrievedRule.formula));
        return { fullName: `Account.${retrievedRule.ruleName}`, type: 'ValidationRule', state: retrievedRule.state, filePath: filePath };
    });
    return { stdout: JSON.stringify({ status: 0, result: { success: true, files: files } }), exitCode: 0 };
}

export async function openTroubleshootingJourney(settings: Record<string, unknown> = {}): Promise<RecipeCockpitJourney> {
    const journey = new RecipeCockpitJourney();
    Object.entries(settings).forEach(([settingName, settingValue]) => journey.settings.set(settingName, settingValue));
    return journey.open(TROUBLESHOOTING_FIXTURE, { overlays: TROUBLESHOOTING_OVERLAYS });
}

// THE ORG DROPDOWN APPEARS ONCE "Choose org…" HAS LISTED THE ORGS
export async function chooseOrg(journey: RecipeCockpitJourney, orgLabel: string): Promise<void> {
    await journey.click('button', 'Choose org…');
    await journey.pickOrg(orgLabel);
}

export async function openTroubleshootingSubTab(journey: RecipeCockpitJourney, subTabName: string | RegExp): Promise<void> {
    await journey.openTab('Troubleshooting');
    await journey.click('tab', subTabName);
}

export function confirmationLines(journey: RecipeCockpitJourney): string[] {
    const screen = journey.screen();
    const confirmations = [...screen.findAll('dialog'), ...screen.findAll('alertdialog')];
    if ( confirmations.length !== 1 ) {
        throw new Error(`expected one confirmation on screen, but ${confirmations.length} are.`);
    }
    return screen.lines(confirmations[0]);
}

// A RUN FILE'S NAME CARRIES THE CLOCK (yyyyMMdd-HHmmss-…), SO IT IS FOUND AMONG THE FILES WRITTEN, NOT NAMED
export function writtenFileMatching(journey: RecipeCockpitJourney, fileChangeCountBefore: number, relativePathPattern: RegExp): string {
    const matches = journey.fileChanges.slice(fileChangeCountBefore)
        .filter(fileChange => fileChange.change === 'written' && relativePathPattern.test(fileChange.relativePath))
        .map(fileChange => fileChange.relativePath);
    if ( matches.length !== 1 ) {
        throw new Error(`expected one written file matching ${relativePathPattern}, but found ${JSON.stringify(matches)} among ${JSON.stringify(fileChangesSince(journey, fileChangeCountBefore))}.`);
    }
    return matches[0];
}

export function readWorkspaceFile(journey: RecipeCockpitJourney, relativePath: string): string {
    return fs.readFileSync(path.join(journey.workspaceRoot, ...relativePath.split('/')), 'utf8');
}

// THE HISTORY SUB-TAB'S ROWS, NEWEST FIRST, EACH AS ITS CELLS' TEXT
export function historyRows(journey: RecipeCockpitJourney): string[][] {
    const screen = journey.screen();
    const historyPanel = screen.get('tabpanel', 'History');
    return screen.findAll('row', undefined, historyPanel)
        .map(row => screen.findAll('cell', undefined, row).map(cell => cell.name))
        .filter(cells => cells.length > 0);
}
