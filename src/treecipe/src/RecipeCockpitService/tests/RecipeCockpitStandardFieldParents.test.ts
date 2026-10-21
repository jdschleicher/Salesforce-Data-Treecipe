import * as path from 'path';
import * as yaml from 'js-yaml';

/*
    #400: a standard lookup or hierarchy field with no <referenceTo> (Account.ParentId, Case.ContactId)
    takes its parent from StandardFieldParentReferenceMap. Runs Generate Treecipe's real pipeline
    over a fixture of such fields with each backend, then asks the Recipe Cockpit's own readers what
    the card offers -- Wire lookup (#151) and Add parent (#294) -- from what was written.
*/
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
import { DirectoryProcessor } from '../../DirectoryProcessingService/DirectoryProcessor';
import { IRecipeFakerService } from '../../RecipeFakerService.ts/IRecipeFakerService';
import { FakerJSRecipeFakerService } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { ObjectInfoWrapper } from '../../ObjectInfoWrapper/ObjectInfoWrapper';
import { RelationshipService } from '../../RelationshipService/RelationshipService';
import { RecipeCockpitService } from '../RecipeCockpitService';
import { ILookupWiringContext, IRecipeFilterLookup, RecipeCockpitRecipeWriter } from '../RecipeCockpitRecipeWriter';

const STANDARD_FIELD_PARENT_OBJECTS_PATH = path.join(__dirname, '..', '..', 'DirectoryProcessingService', 'tests', 'mocks', 'StandardFieldParentSalesforceMetadataDirectory', 'objects');

type LoadedObjectRecipe = { object: string; nickname: string; fields: Record<string, unknown> | null; friends?: LoadedObjectRecipe[] };

const flattenObjectRecipes = (objectRecipes: LoadedObjectRecipe[]): LoadedObjectRecipe[] =>
    objectRecipes.flatMap(objectRecipe => [objectRecipe, ...flattenObjectRecipes(objectRecipe.friends ?? [])]);

async function generate(createFakerService: () => IRecipeFakerService): Promise<ObjectInfoWrapper> {

    jest.spyOn(ConfigurationService, 'getFakerImplementationByExtensionConfigSelection').mockImplementation(createFakerService);
    jest.spyOn(ConfigurationService, 'getCustomRelationshipMappings').mockReturnValue({});
    jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue([]);

    return new DirectoryProcessor().processAllObjectsAndRelationships(vscode.Uri.file(STANDARD_FIELD_PARENT_OBJECTS_PATH));

}

// WHAT THE COCKPIT READS FROM THE OBJECTS WRAPPER IT WRITES: A JSON ROUND TRIP, THEN ITS OWN LOOKUP READER AND THE RELATIONSHIP LEVELS
function buildWiringContext(objectInfoWrapper: ObjectInfoWrapper): ILookupWiringContext {

    const wrapperObjects = JSON.parse(JSON.stringify(objectInfoWrapper.ObjectToObjectInfoMap)) as Record<string, { RelationshipDetail?: { level?: number } }>;
    const parentLookupsByObjectApiName = new Map<string, IRecipeFilterLookup[]>();
    const levelsByObjectApiName = new Map<string, number>();

    Object.entries(wrapperObjects).forEach(([objectApiName, wrapperObject]) => {
        parentLookupsByObjectApiName.set(objectApiName, RecipeCockpitService.readParentLookups(wrapperObject.RelationshipDetail));
        if ( typeof wrapperObject.RelationshipDetail?.level === 'number' ) {
            levelsByObjectApiName.set(objectApiName, wrapperObject.RelationshipDetail.level);
        }
    });

    return { parentLookupsByObjectApiName, levelsByObjectApiName };

}

describe.each([
    ['faker-js', () => new FakerJSRecipeFakerService(), true],
    ['snowfakery', () => new SnowfakeryRecipeFakerService(), false]
] as const)('standard field parents (#400) in the Recipe Cockpit, with the %s backend', (unusedBackend, createFakerService, isNestingBackend) => {

    let objectInfoWrapper: ObjectInfoWrapper;
    let accountTreeRecipe: string;
    let wiringContext: ILookupWiringContext;

    beforeAll(async () => {
        objectInfoWrapper = await generate(createFakerService);
        accountTreeRecipe = objectInfoWrapper.RecipeFiles.find(recipeFile => recipeFile.objects.includes('Account')).content;
        wiringContext = buildWiringContext(objectInfoWrapper);
    });

    test('the card lists every mapped field as a lookup to its standard parent, the Hierarchy ParentId included', () => {

        expect(wiringContext.parentLookupsByObjectApiName.get('Account')).toEqual([{ fieldApiName: 'ParentId', parentObjectApiName: 'Account' }]);
        expect([...wiringContext.parentLookupsByObjectApiName.get('Case')].sort((first, second) => ( first.fieldApiName < second.fieldApiName ? -1 : 1 ))).toEqual([
            { fieldApiName: 'AccountId', parentObjectApiName: 'Account' },
            { fieldApiName: 'ContactId', parentObjectApiName: 'Contact' },
            { fieldApiName: 'ParentId', parentObjectApiName: 'Case' }
        ]);

    });

    test('a Hierarchy field the map does not name (User.ManagerId) records no lookup and keeps its old value', () => {

        expect(wiringContext.parentLookupsByObjectApiName.get('User')).toEqual([]);

        const userRecipe = objectInfoWrapper.RecipeFiles.find(recipeFile => recipeFile.objects.includes('User')).content;
        expect(userRecipe).toContain('ManagerId: "### TODO -- FieldType Not Handled -- hierarchy does not exist in this programs Salesforce field map."');

    });

    test('Account.ParentId and Case.ParentId are self-lookups: an iteration wired to the record above for faker-js, a TODO for snowfakery', () => {

        const objectRecipes = flattenObjectRecipes(yaml.load(accountTreeRecipe) as LoadedObjectRecipe[]);
        const parentIdsByObject = (objectApiName: string) => objectRecipes
            .filter(objectRecipe => objectRecipe.object === objectApiName)
            .map(objectRecipe => [objectRecipe.nickname, objectRecipe.fields?.ParentId ?? null]);

        expect(parentIdsByObject('Account')).toEqual(isNestingBackend
            ? [['Account_NickName', null], ['Account_child_NickName', 'Account_NickName']]
            : [['Account_NickName', null]]);
        expect(parentIdsByObject('Case')).toEqual(isNestingBackend
            ? [['Case_NickName', null], ['Case_child_NickName', 'Case_NickName']]
            : [['Case_NickName', null]]);

    });

    test('Wire lookup offers a mapped lookup to a parent the tree inserts first, and never a self-lookup\'s top record, as for any Lookup', () => {

        const wirings = RecipeCockpitRecipeWriter.listLookupWirings(accountTreeRecipe, wiringContext);
        const wiredFields = wirings.map(wiring => `${wiring.objectApiName}.${wiring.fieldApiName}`);

        expect(wiredFields).not.toContain('Account.ParentId');
        expect(wiredFields).not.toContain('Case.ParentId');
        if ( isNestingBackend ) {
            // NESTED UNDER Account, SO GENERATION ALREADY WIRED IT
            expect(accountTreeRecipe).toMatch(/^ +AccountId: Account_NickName$/m);
            expect(wiredFields).not.toContain('Case.AccountId');
        } else {
            expect(wirings.find(wiring => wiring.fieldApiName === 'AccountId')).toMatchObject({ objectApiName: 'Case', parentObjectApiNames: ['Account'], candidateNicknames: ['Account_NickName'] });
        }

    });

    test('Add parent offers Contact for Case.ContactId, whose parent the recipe does not write', () => {

        const templateObjectApiNames = new Set(Object.keys(RecipeCockpitService.getParentObjectTemplates(isNestingBackend ? 'faker-js' : 'snowfakery')));
        const additions = RecipeCockpitRecipeWriter.listAddableParentObjects(accountTreeRecipe, wiringContext, templateObjectApiNames);

        // A faker-js Case IS WRITTEN TWICE (ITS SELF-LOOKUP ITERATION), AND EACH OCCURRENCE IS OFFERED BY ITS NICKNAME, AS FOR ANY LOOKUP
        expect(additions.filter(addition => addition.fieldApiName === 'ContactId')).toEqual(isNestingBackend
            ? [
                { objectApiName: 'Case', objectNickname: 'Case_NickName', fieldApiName: 'ContactId', parentObjectApiName: 'Contact' },
                { objectApiName: 'Case', objectNickname: 'Case_child_NickName', fieldApiName: 'ContactId', parentObjectApiName: 'Contact' }
            ]
            : [{ objectApiName: 'Case', fieldApiName: 'ContactId', parentObjectApiName: 'Contact' }]);
        expect(accountTreeRecipe).toMatch(new RegExp(`^ +ContactId: ${RelationshipService.referenceIdRequiredTodo}( -- Contact)?$`, 'm'));

    });

});
