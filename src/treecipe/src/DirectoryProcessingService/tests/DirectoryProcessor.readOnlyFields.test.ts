import * as path from 'path';
import * as yaml from 'js-yaml';

jest.mock('vscode', () => {
    const realFs = jest.requireActual('fs');
    const realPath = jest.requireActual('path');
    const toUri = (fsPath: string) => ({ fsPath: fsPath, path: fsPath });
    return {
        workspace: {
            workspaceFolders: undefined,
            fs: {
                readDirectory: async (directoryUri: { fsPath: string }) => {
                    try {
                        return realFs.readdirSync(directoryUri.fsPath, { withFileTypes: true })
                            .map((entry: { name: string; isDirectory: () => boolean }) => [entry.name, entry.isDirectory() ? 2 : 1])
                            .sort(([first]: [string], [second]: [string]) => ( first < second ? -1 : ( first > second ? 1 : 0 ) ));
                    } catch {
                        return [];
                    }
                },
                readFile: async (fileUri: { fsPath: string }) => realFs.readFileSync(fileUri.fsPath)
            }
        },
        Uri: {
            file: toUri,
            joinPath: (baseUri: { fsPath: string }, ...segments: string[]) => toUri(realPath.join(baseUri.fsPath, ...segments))
        },
        window: { showWarningMessage: jest.fn(), showInformationMessage: jest.fn(), showErrorMessage: jest.fn() },
        FileType: { Directory: 2, File: 1, SymbolicLink: 64 },
        ThemeIcon: jest.fn()
    };
}, { virtual: true });

import * as vscode from 'vscode';
import { ConfigurationService } from '../../ConfigurationService/ConfigurationService';
import { RecipeFakerServiceFactory } from '../../FakerRecipeProcessor/RecipeFakerServiceFactory';
import { DirectoryProcessor } from '../DirectoryProcessor';
import { IRecipeFakerService } from '../../RecipeFakerService.ts/IRecipeFakerService';
import { FakerJSRecipeFakerService } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { ObjectInfoWrapper } from '../../ObjectInfoWrapper/ObjectInfoWrapper';
import { FieldInfo } from '../../ObjectInfoWrapper/FieldInfo';

/*
    #685: a field Salesforce calculates or sets itself is written "READ ONLY -- <reason>" in both
    backends' recipes, never as a faker expression: a <formula> field whatever its <type>, a roll-up
    summary, an auto number, and a standard field ReadOnlyFields names when the project has its file.
*/

const READ_ONLY_OBJECTS_PATH = path.join(__dirname, 'mocks', 'ReadOnlyFieldsSalesforceMetadataDirectory', 'objects');

type LoadedObjectRecipe = { object: string; nickname: string; fields: Record<string, unknown> | null; friends?: LoadedObjectRecipe[] };

const flattenObjectRecipes = (objectRecipes: LoadedObjectRecipe[]): LoadedObjectRecipe[] =>
    objectRecipes.flatMap(objectRecipe => [objectRecipe, ...flattenObjectRecipes(objectRecipe.friends ?? [])]);

describe.each([
    ['faker-js', () => new FakerJSRecipeFakerService()],
    ['snowfakery', () => new SnowfakeryRecipeFakerService()]
] as const)('read-only fields (#685) with the %s backend', (unusedBackend, createFakerService: () => IRecipeFakerService) => {

    let objectInfoWrapper: ObjectInfoWrapper;
    let fieldsByObjectApiName: Map<string, Record<string, unknown>>;

    beforeAll(async () => {
        jest.spyOn(RecipeFakerServiceFactory, 'getFakerImplementationByExtensionConfigSelection').mockImplementation(createFakerService);
        jest.spyOn(ConfigurationService, 'getCustomRelationshipMappings').mockReturnValue({});
        jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue([]);
        objectInfoWrapper = await new DirectoryProcessor().processAllObjectsAndRelationships(vscode.Uri.file(READ_ONLY_OBJECTS_PATH));
        const objectRecipes = objectInfoWrapper.RecipeFiles.flatMap(recipeFile => flattenObjectRecipes(yaml.load(recipeFile.content) as LoadedObjectRecipe[]));
        fieldsByObjectApiName = new Map(objectRecipes.map(objectRecipe => [objectRecipe.object, objectRecipe.fields ?? {}]));
    });

    const fieldInfoOf = (objectApiName: string, fieldApiName: string) =>
        objectInfoWrapper.ObjectToObjectInfoMap[objectApiName].Fields.find(fieldInfo => fieldInfo.fieldName === fieldApiName);

    test.each([
        ['Total__c', 'READ ONLY -- formula'],
        ['Line_Count__c', 'READ ONLY -- roll-up summary'],
        ['Gizmo_Number__c', 'READ ONLY -- auto number']
    ])('Gizmo__c.%s is written as "%s"', (fieldApiName, expectedRecipeValue) => {

        expect(fieldsByObjectApiName.get('Gizmo__c')[fieldApiName]).toBe(expectedRecipeValue);

    });

    test('a formula field keeps its formula and reason for the Recipe Cockpit, and a validation rule naming it is not applied to it', () => {

        const totalFieldInfo = fieldInfoOf('Gizmo__c', 'Total__c');

        expect(totalFieldInfo).toMatchObject({ readOnlyReason: 'formula', formula: 'Price__c * Quantity__c', recipeValue: 'READ ONLY -- formula' });
        expect(totalFieldInfo).not.toHaveProperty('validationRuleConstraints');
        expect(objectInfoWrapper.ObjectToObjectInfoMap.Gizmo__c.ValidationRulesNotApplied).toEqual([{
            ruleName: 'Total_Cap',
            reason: 'Total__c is read only (formula): Salesforce sets its value, so a rule cannot shape it and the insert never sends it'
        }]);

    });

    test('an ordinary field is still a faker expression with no read-only data, and its own validation rule still applies', () => {

        const quantityFieldInfo = fieldInfoOf('Gizmo__c', 'Quantity__c');
        const notesFieldInfo = fieldInfoOf('Gizmo__c', 'Notes__c');

        expect(String(fieldsByObjectApiName.get('Gizmo__c').Quantity__c)).toContain('{{');
        expect(quantityFieldInfo.validationRuleConstraints?.length).toBeGreaterThan(0);
        [quantityFieldInfo, notesFieldInfo].forEach(fieldInfo => {
            expect(fieldInfo).not.toHaveProperty('readOnlyReason');
            expect(fieldInfo).not.toHaveProperty('formula');
        });

    });

    test('the standard read-only fields the project pulled down are written "READ ONLY -- set by Salesforce", even with no <type>', () => {

        const opportunityFields = fieldsByObjectApiName.get('Opportunity');

        expect(opportunityFields.ExpectedRevenue).toBe('READ ONLY -- set by Salesforce');
        expect(opportunityFields.IsWon).toBe('READ ONLY -- set by Salesforce');
        expect(fieldInfoOf('Opportunity', 'ExpectedRevenue').readOnlyReason).toBe('set by Salesforce');

    });

    test('a standard read-only field the project did not pull down is not added by the built-in mappings', () => {

        expect(fieldsByObjectApiName.get('Opportunity')).not.toHaveProperty('ForecastCategory');
        expect(objectInfoWrapper.RecipeFiles.map(recipeFile => recipeFile.content).join('\n')).not.toMatch(/^ +ForecastCategory:/m);

    });

});

describe('DirectoryProcessor.buildReadOnlyFieldRuleNotAppliedReason (#685)', () => {

    test('names only a read-only field the rule references, matching its name case-insensitively', () => {

        jest.spyOn(RecipeFakerServiceFactory, 'getFakerImplementationByExtensionConfigSelection').mockImplementation(() => new FakerJSRecipeFakerService());
        const directoryProcessor = new DirectoryProcessor();
        const readOnlyFieldInfo = Object.assign(new FieldInfo('Gizmo__c', 'Total__c', 'Total', 'Currency'), { readOnlyReason: 'formula' as const });
        const namelessFieldInfo = Object.assign(new FieldInfo('Gizmo__c', undefined, 'Nameless', 'Currency'), { readOnlyReason: 'formula' as const });
        const ordinaryFieldInfo = new FieldInfo('Gizmo__c', 'Quantity__c', 'Quantity', 'Number');

        expect(directoryProcessor.buildReadOnlyFieldRuleNotAppliedReason('total__c', [namelessFieldInfo, ordinaryFieldInfo, readOnlyFieldInfo])).toContain('Total__c is read only (formula)');
        expect(directoryProcessor.buildReadOnlyFieldRuleNotAppliedReason('Quantity__c', [namelessFieldInfo, ordinaryFieldInfo, readOnlyFieldInfo])).toBeUndefined();

    });

});

