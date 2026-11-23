import * as fs from 'fs';
import * as os from 'os';
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
            parse: (uriText: string) => toUri(uriText.replace(/^file:\/\//, '')),
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
import { RecordTypeSelection } from '../../RecordTypeService/RecordTypeSelection';
import { RelationshipService } from '../../RelationshipService/RelationshipService';
import { PythonTestHarness } from '../../RecipeYamlScalar/tests/mocks/PythonTestHarness';

/*
    #705: Quote.AccountId is written as the Opportunity block the quote belongs to (#680). With
    Opportunity written as one block per record type, that is the block the quote is nested under
    (faker-js) or the one its OpportunityId reference() names (child copies); a flat Quote with no
    copy names the first block. This runs the real pipeline in every tree writer and pins each Quote.
*/

const OBJECTS_PATH = path.join(__dirname, 'mocks', 'QuoteOpportunityRecordTypesSalesforceMetadataDirectory', 'objects');
const ENTERPRISE = 'Opportunity_Enterprise_NickName';
const SMB = 'Opportunity_SMB_NickName';

type LoadedObjectRecipe = { object: string; nickname: string; fields: Record<string, unknown> | null; friends?: LoadedObjectRecipe[] };
type WrittenQuote = { nickname: string; nestedUnder: string | undefined; OpportunityId: unknown; AccountId: unknown };

const collectWrittenQuotes = (objectRecipes: LoadedObjectRecipe[], nestedUnder?: string): WrittenQuote[] =>
    objectRecipes.flatMap(objectRecipe => [
        ...( objectRecipe.object === 'Quote'
            ? [{ nickname: objectRecipe.nickname, nestedUnder: nestedUnder, OpportunityId: objectRecipe.fields?.OpportunityId, AccountId: objectRecipe.fields?.AccountId }]
            : [] ),
        ...collectWrittenQuotes(objectRecipe.friends ?? [], objectRecipe.object === 'Opportunity' ? objectRecipe.nickname : nestedUnder)
    ]);

const snowfakeryReference = (opportunityNickname: string) => `Opportunity_Reference_\${{reference(${opportunityNickname}).id}}`;

// A REFERENCE ID TODO IS A YAML COMMENT, SO THE FLAT QUOTE'S OpportunityId LOADS AS null
describe.each([
    ['faker-js nested', () => new FakerJSRecipeFakerService(), false, [
        { nickname: 'Quote_NickName', nestedUnder: ENTERPRISE, OpportunityId: ENTERPRISE, AccountId: `${ENTERPRISE}.AccountId` }
    ]],
    ['faker-js nested with child copies', () => new FakerJSRecipeFakerService(), true, [
        { nickname: 'Quote_NickName', nestedUnder: ENTERPRISE, OpportunityId: ENTERPRISE, AccountId: `${ENTERPRISE}.AccountId` },
        { nickname: 'Quote_Opportunity_SMB_NickName', nestedUnder: SMB, OpportunityId: SMB, AccountId: `${SMB}.AccountId` }
    ]],
    ['flat snowfakery', () => new SnowfakeryRecipeFakerService(), false, [
        { nickname: 'Quote_NickName', nestedUnder: undefined, OpportunityId: null, AccountId: `${ENTERPRISE}.AccountId` }
    ]],
    ['flat snowfakery with child copies', () => new SnowfakeryRecipeFakerService(), true, [
        { nickname: 'Quote_NickName', nestedUnder: undefined, OpportunityId: snowfakeryReference(ENTERPRISE), AccountId: `${ENTERPRISE}.AccountId` },
        { nickname: 'Quote_Opportunity_SMB_NickName', nestedUnder: undefined, OpportunityId: snowfakeryReference(SMB), AccountId: `${SMB}.AccountId` }
    ]]
] as const)('Quote.AccountId with Opportunity record type blocks, %s writer (#705)', (writerName, createFakerService: () => IRecipeFakerService, isChildTreeCopiedPerRecordTypeBlock, expectedQuotes) => {

    beforeEach(() => {
        jest.spyOn(RecipeFakerServiceFactory, 'getFakerImplementationByExtensionConfigSelection').mockImplementation(createFakerService);
        jest.spyOn(ConfigurationService, 'getCustomRelationshipMappings').mockReturnValue({});
        jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue([]);
    });

    const generateRecipeContents = async (objectsPath: string) => {
        const recordTypeSelection = new RecordTypeSelection([['Opportunity', ['Enterprise', 'SMB']]], isChildTreeCopiedPerRecordTypeBlock);
        const objectInfoWrapper = await new DirectoryProcessor().processAllObjectsAndRelationships(vscode.Uri.file(objectsPath), undefined, recordTypeSelection);
        return objectInfoWrapper.RecipeFiles.map(recipeFile => recipeFile.content);
    };

    test('each Quote names the Opportunity block its own OpportunityId belongs to', async () => {

        const recipeContents = await generateRecipeContents(OBJECTS_PATH);
        const writtenQuotes = collectWrittenQuotes(recipeContents.flatMap(recipeContent => yaml.load(recipeContent) as LoadedObjectRecipe[]));

        expect(writtenQuotes).toEqual(expectedQuotes);

    });

    if ( writerName === 'flat snowfakery' ) {

        test('the flat Quote\'s OpportunityId stays a REFERENCE ID TODO that lists both blocks', async () => {

            const [quoteRecipeContent] = (await generateRecipeContents(OBJECTS_PATH)).filter(recipeContent => recipeContent.includes('object: Quote'));

            expect(quoteRecipeContent).toMatch(new RegExp(`^ +OpportunityId: ${RelationshipService.referenceIdRequiredTodo}$`, 'm'));
            expect(quoteRecipeContent).toContain(`OpportunityId can reference any record type block of Opportunity: ${ENTERPRISE}, ${SMB}`);

        });

    }

    test('every generated file loads as YAML', async () => {

        const recipeContents = await generateRecipeContents(OBJECTS_PATH);

        expect(recipeContents.length).toBeGreaterThan(0);
        recipeContents.forEach(recipeContent => expect(() => yaml.load(recipeContent)).not.toThrow());

    });

    PythonTestHarness.testRequiringModules('yaml')('every generated file loads with PyYAML, as snowfakery reads it', async () => {

        const recipeContents = await generateRecipeContents(OBJECTS_PATH);
        const pyYamlLoadedQuotes = collectWrittenQuotes((PythonTestHarness.loadWithPyYaml(recipeContents) as LoadedObjectRecipe[][]).flat());

        expect(pyYamlLoadedQuotes).toEqual(expectedQuotes);

    });

    test('with no Opportunity folder, Quote.AccountId names the default Opportunity nickname and generation does not fail', async () => {

        const objectsPathWithoutOpportunity = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-705-'));
        try {
            ['Account', 'Quote'].forEach(objectApiName =>
                fs.cpSync(path.join(OBJECTS_PATH, objectApiName), path.join(objectsPathWithoutOpportunity, objectApiName), { recursive: true }));

            const writtenQuotes = collectWrittenQuotes((await generateRecipeContents(objectsPathWithoutOpportunity)).flatMap(recipeContent => yaml.load(recipeContent) as LoadedObjectRecipe[]));

            expect(writtenQuotes).toHaveLength(1);
            expect(writtenQuotes[0].AccountId).toBe('Opportunity_NickName.AccountId');
        } finally {
            fs.rmSync(objectsPathWithoutOpportunity, { recursive: true, force: true });
        }

    });

});
