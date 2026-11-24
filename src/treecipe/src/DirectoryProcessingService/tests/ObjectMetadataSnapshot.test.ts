import * as path from 'path';

/*
    One click's recipe builds share one read of the object metadata (#702). vscode is a read-only
    stand-in over the real file system, as in DirectoryProcessor.generatedRecipeYaml.test.ts.
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
                            .map((entry: { name: string; isDirectory: () => boolean }) => [entry.name, entry.isDirectory() ? 2 : 1]);
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
import { FakerJSRecipeFakerService } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { IRecipeFakerService } from '../../RecipeFakerService.ts/IRecipeFakerService';
import { RecordTypeSelection } from '../../RecordTypeService/RecordTypeSelection';
import { RecordTypeService } from '../../RecordTypeService/RecordTypeService';
import { RelationshipService } from '../../RelationshipService/RelationshipService';
import { XmlFileProcessor } from '../../XMLProcessingService/XmlFileProcessor';
import { ValidationRuleAnalyzerService } from '../../ValidationRuleAnalyzerService/ValidationRuleAnalyzerService';
import { DirectoryProcessor } from '../DirectoryProcessor';
import { ObjectMetadataSnapshot } from '../ObjectMetadataSnapshot';

const MOCK_OBJECTS_PATH = path.join(__dirname, 'mocks', 'MockSalesforceMetadataDirectory', 'objects');
const VALIDATION_RULE_OBJECTS_PATH = path.join(__dirname, 'mocks', 'ValidationRuleSalesforceMetadataDirectory', 'objects');

const BACKENDS: Array<[string, () => IRecipeFakerService]> = [
    ['faker-js', () => new FakerJSRecipeFakerService()],
    ['snowfakery', () => new SnowfakeryRecipeFakerService()]
];

describe.each(BACKENDS)('DirectoryProcessor with an ObjectMetadataSnapshot, %s (#702)', (_backendName, createFakerService) => {

    beforeEach(() => {
        jest.spyOn(RecipeFakerServiceFactory, 'getFakerImplementationByExtensionConfigSelection').mockImplementation(createFakerService);
        jest.spyOn(ConfigurationService, 'getCustomRelationshipMappings').mockReturnValue({});
        jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue([]);
        // A RELATIONSHIP TREE'S ID CARRIES THE CLOCK, SO TWO WALKS ARE COMPARED AT ONE INSTANT
        jest.spyOn(Date, 'now').mockReturnValue(1795515483900);
    });

    // THE SELECTIONS ONE CLICK BUILDS: THE FOLDED RECIPE, THEN ONE SET PER RECORD TYPE
    const CLICK_SELECTIONS = [
        new RecordTypeSelection([['Example_Everything__c', ['OneRecType', 'TwoRecType']]], true),
        new RecordTypeSelection([['Example_Everything__c', ['OneRecType']]], true),
        new RecordTypeSelection([['Example_Everything__c', ['TwoRecType']]], true)
    ];

    const walkFresh = (recordTypeSelection: RecordTypeSelection, treeFolderName?: string) =>
        new DirectoryProcessor().processAllObjectsAndRelationships(vscode.Uri.file(MOCK_OBJECTS_PATH), undefined, recordTypeSelection, treeFolderName);

    it('writes every recipe file byte for byte as a walk that reads the metadata itself', async () => {

        const sharedProcessor = new DirectoryProcessor(new ObjectMetadataSnapshot());

        for ( const recordTypeSelection of CLICK_SELECTIONS ) {
            const fromSnapshot = await sharedProcessor.processAllObjectsAndRelationships(vscode.Uri.file(MOCK_OBJECTS_PATH), undefined, recordTypeSelection);
            const fromFiles = await walkFresh(recordTypeSelection);
            expect(fromSnapshot.RecipeFiles).toEqual(fromFiles.RecipeFiles);
            expect(fromSnapshot.ObjectToObjectInfoMap).toEqual(fromFiles.ObjectToObjectInfoMap);
        }

    });

    it('reads and parses each field file, record type folder and directory once however many walks share it', async () => {

        const readFileSpy = jest.spyOn(vscode.workspace.fs, 'readFile');
        const readDirectorySpy = jest.spyOn(vscode.workspace.fs, 'readDirectory');
        const parseSpy = jest.spyOn(XmlFileProcessor, 'processXmlFieldContent');
        const recordTypeSpy = jest.spyOn(RecordTypeService, 'getRecordTypeToApiFieldToRecordTypeWrapper');
        const sharedProcessor = new DirectoryProcessor(new ObjectMetadataSnapshot());

        await sharedProcessor.processAllObjectsAndRelationships(vscode.Uri.file(MOCK_OBJECTS_PATH), undefined, CLICK_SELECTIONS[0]);
        const firstWalkCounts = [readFileSpy, readDirectorySpy, parseSpy, recordTypeSpy].map(callSpy => callSpy.mock.calls.length);
        for ( const recordTypeSelection of CLICK_SELECTIONS.slice(1) ) {
            await sharedProcessor.processAllObjectsAndRelationships(vscode.Uri.file(MOCK_OBJECTS_PATH), undefined, recordTypeSelection);
        }

        expect(parseSpy.mock.calls.length).toBeGreaterThan(0);
        expect([readFileSpy, readDirectorySpy, parseSpy, recordTypeSpy].map(callSpy => callSpy.mock.calls.length)).toEqual(firstWalkCounts);
        const readFilePaths = readFileSpy.mock.calls.map(([fileUri]) => fileUri.fsPath);
        expect(new Set(readFilePaths).size).toBe(readFilePaths.length);

    });

    it('hands each walk its own copy of a field\'s parsed detail, so a walk cannot change what the next one reads', async () => {

        const metadataSnapshot = new ObjectMetadataSnapshot();
        const parsedDetail = await DirectoryProcessor.parseFieldXmlContent(
            '<?xml version="1.0" encoding="UTF-8"?><CustomField xmlns="http://soap.sforce.com/2006/04/metadata"><fullName>ParentId</fullName><type>Hierarchy</type></CustomField>',
            'ParentId.field-meta.xml');
        const read = jest.fn().mockResolvedValue(parsedDetail);

        const firstCopy = await metadataSnapshot.readFieldXmlDetail('/objects/Account/fields/ParentId.field-meta.xml', read);
        firstCopy.referenceTo = 'Account';
        const secondCopy = await metadataSnapshot.readFieldXmlDetail('/objects/Account/fields/ParentId.field-meta.xml', read);

        expect(read).toHaveBeenCalledTimes(1);
        expect(secondCopy.referenceTo).toBeUndefined();
        expect(Object.getPrototypeOf(secondCopy)).toBe(Object.getPrototypeOf(parsedDetail));

    });

    it('reads an object\'s validation rules once, and builds their recipe as a fresh walk does', async () => {

        const analyzeSpy = jest.spyOn(ValidationRuleAnalyzerService, 'analyzeValidationRuleXml');
        const sharedProcessor = new DirectoryProcessor(new ObjectMetadataSnapshot());

        const firstWalk = await sharedProcessor.processAllObjectsAndRelationships(vscode.Uri.file(VALIDATION_RULE_OBJECTS_PATH));
        const analyzedCount = analyzeSpy.mock.calls.length;
        const secondWalk = await sharedProcessor.processAllObjectsAndRelationships(vscode.Uri.file(VALIDATION_RULE_OBJECTS_PATH));

        expect(analyzedCount).toBeGreaterThan(0);
        expect(analyzeSpy.mock.calls.length).toBe(analyzedCount);
        expect(secondWalk.RecipeFiles).toEqual(firstWalk.RecipeFiles);
        expect(secondWalk.RecipeFiles).toEqual((await new DirectoryProcessor().processAllObjectsAndRelationships(vscode.Uri.file(VALIDATION_RULE_OBJECTS_PATH))).RecipeFiles);

    });

    it('builds the named tree\'s recipe alone, byte for byte and under the same file name as a full run', async () => {

        const fullRun = await walkFresh(CLICK_SELECTIONS[0]);
        expect(fullRun.RecipeFiles.length).toBeGreaterThan(1);

        for ( const fullRunRecipeFile of fullRun.RecipeFiles ) {
            const treeFolderName = RelationshipService.buildRecipeTreeFolderName(fullRunRecipeFile.objects);
            const oneTreeRun = await walkFresh(CLICK_SELECTIONS[0], treeFolderName);
            expect(oneTreeRun.RecipeFiles).toEqual(fullRun.RecipeFiles.filter(recipeFile => RelationshipService.buildRecipeTreeFolderName(recipeFile.objects) === treeFolderName));
            expect(oneTreeRun.RelationshipTrees).toEqual(fullRun.RelationshipTrees);
        }

    });

    it('builds no recipe for a tree the metadata does not build', async () => {

        expect((await walkFresh(CLICK_SELECTIONS[0], 'Account-thru-Gone__c')).RecipeFiles).toEqual([]);

    });

});
