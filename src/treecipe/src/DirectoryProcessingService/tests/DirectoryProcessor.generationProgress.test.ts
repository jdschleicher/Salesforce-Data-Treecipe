import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import * as matchers from 'jest-extended';
expect.extend(matchers);

/*
    #216. Generate Treecipe reports which phase it is in and how far through the objects it is, and
    stops when the user cancels. The walk is driven over a real temporary objects directory through a
    read-only vscode stand-in, as in DirectoryProcessor.hostileObjectNames.test.ts; its listing is
    SORTED so the order of the reported objects does not depend on the file system.
*/
jest.mock('vscode', () => {
    const realFs = jest.requireActual('fs');
    const realPath = jest.requireActual('path');
    const toUri = (fsPath: string) => ({ fsPath: fsPath, path: fsPath });
    return {
        workspace: {
            workspaceFolders: undefined,
            fs: {
                readDirectory: jest.fn(async (directoryUri: { fsPath: string }) => {
                    try {
                        return realFs.readdirSync(directoryUri.fsPath, { withFileTypes: true })
                            .sort((first: { name: string }, second: { name: string }) => (first.name < second.name ? -1 : first.name > second.name ? 1 : 0))
                            .map((entry: { name: string; isDirectory: () => boolean }) => [entry.name, entry.isDirectory() ? 2 : 1]);
                    } catch {
                        return [];
                    }
                }),
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
import { DirectoryProcessor, IRecipeGenerationProgress, RecipeGenerationCancelledError } from '../DirectoryProcessor';
import { GlobalValueSetSingleton } from '../../GlobalValueSetSingleton/GlobalValueSetSingleton';
import { IRecipeFakerService } from '../../RecipeFakerService.ts/IRecipeFakerService';
import { FakerJSRecipeFakerService } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';

const OBJECT_API_NAMES = ['Account', 'Contact', 'Opportunity'];

const buildFieldXml = (fieldApiName: string, fieldType: string, referenceTo?: string): string =>
`<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>${fieldApiName}</fullName>
    <label>${fieldApiName}</label>
${referenceTo ? `    <referenceTo>${referenceTo}</referenceTo>\n` : ''}${fieldType === 'Text' ? '    <length>80</length>\n' : ''}    <type>${fieldType}</type>
</CustomField>
`;

function writeObject(objectsPath: string, objectApiName: string, fieldXmlByFileName: Record<string, string>): void {

    const fieldsPath = path.join(objectsPath, objectApiName, 'fields');
    fs.mkdirSync(fieldsPath, { recursive: true });
    Object.entries(fieldXmlByFileName).forEach(([fileName, fieldXml]) => fs.writeFileSync(path.join(fieldsPath, fileName), fieldXml));

}

function writeMetadata(metadataPath: string): void {

    const objectsPath = path.join(metadataPath, 'objects');
    fs.mkdirSync(path.join(metadataPath, 'globalValueSets'), { recursive: true });
    writeObject(objectsPath, 'Account', { 'Ordinary__c.field-meta.xml': buildFieldXml('Ordinary__c', 'Text') });
    writeObject(objectsPath, 'Contact', {
        'Ordinary__c.field-meta.xml': buildFieldXml('Ordinary__c', 'Text'),
        'AccountLookup__c.field-meta.xml': buildFieldXml('AccountLookup__c', 'Lookup', 'Account')
    });
    writeObject(objectsPath, 'Opportunity', {
        'Ordinary__c.field-meta.xml': buildFieldXml('Ordinary__c', 'Text'),
        'AccountLookup__c.field-meta.xml': buildFieldXml('AccountLookup__c', 'Lookup', 'Account')
    });

}

function mockConfiguration(createFakerService: () => IRecipeFakerService) {

    jest.spyOn(ConfigurationService, 'getFakerImplementationByExtensionConfigSelection').mockImplementation(createFakerService);
    jest.spyOn(ConfigurationService, 'getCustomRelationshipMappings').mockReturnValue({});
    jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue([]);

}

class RecordingGenerationProgress implements IRecipeGenerationProgress {

    readonly reportedMessages: string[] = [];
    private isCancelled = false;

    constructor(private readonly cancelWhenReported?: string) {}

    report(message: string): void {
        this.reportedMessages.push(message);
        if ( message === this.cancelWhenReported ) {
            this.isCancelled = true;
        }
    }

    isCancellationRequested(): boolean {
        return this.isCancelled;
    }

}

let metadataPath: string;
let emptyMetadataPath: string;

beforeAll(() => {
    metadataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-generation-progress-'));
    emptyMetadataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-generation-progress-empty-'));
    writeMetadata(metadataPath);
    fs.mkdirSync(path.join(emptyMetadataPath, 'objects'), { recursive: true });
});

afterAll(() => {
    fs.rmSync(metadataPath, { recursive: true, force: true });
    fs.rmSync(emptyMetadataPath, { recursive: true, force: true });
});

describe.each([
    ['faker-js', () => new FakerJSRecipeFakerService()],
    ['snowfakery', () => new SnowfakeryRecipeFakerService()]
] as const)('Generate Treecipe progress with the %s backend', (unusedBackend, createFakerService) => {

    beforeEach(async () => {
        mockConfiguration(createFakerService);
        await GlobalValueSetSingleton.getInstance().initialize(metadataPath);
    });

    const objectsUri = () => vscode.Uri.file(path.join(metadataPath, 'objects'));

    test('reports every phase in order, naming each object with its place among the top-level directories', async () => {

        const generationProgress = new RecordingGenerationProgress();

        await new DirectoryProcessor().processAllObjectsAndRelationships(objectsUri(), generationProgress);

        expect(generationProgress.reportedMessages).toEqual([
            'Scanning objects…',
            'Scanning objects (0 of 3)',
            'Scanning Account (1 of 3)',
            'Scanning Contact (2 of 3)',
            'Scanning Opportunity (3 of 3)',
            'Building relationship trees…'
        ]);

    });

    test('given a progress port, generates exactly what a run without one generates', async () => {

        const withoutProgress = await new DirectoryProcessor().processAllObjectsAndRelationships(objectsUri());
        const withProgress = await new DirectoryProcessor().processAllObjectsAndRelationships(objectsUri(), new RecordingGenerationProgress());

        expect(Object.keys(withProgress.ObjectToObjectInfoMap)).toEqual(OBJECT_API_NAMES);
        expect(withProgress.RecipeFiles).toEqual(withoutProgress.RecipeFiles);
        // A TREE'S treeId CARRIES THE TIME IT WAS BUILT, SO IT IS THE ONE PART TWO RUNS CANNOT SHARE
        const withoutTreeIds = (relationshipTrees: unknown[]) => relationshipTrees.map(relationshipTree => ({ ...(relationshipTree as object), treeId: undefined }));
        expect(withoutTreeIds(withProgress.RelationshipTrees)).toEqual(withoutTreeIds(withoutProgress.RelationshipTrees));

    });

    test('given a cancel while an object is scanned, descends into no further directory and rejects as cancelled', async () => {

        const generationProgress = new RecordingGenerationProgress('Scanning Account (1 of 3)');
        const readDirectorySpy = vscode.workspace.fs.readDirectory as jest.Mock;
        readDirectorySpy.mockClear();

        await expect(new DirectoryProcessor().processAllObjectsAndRelationships(objectsUri(), generationProgress))
            .rejects.toBeInstanceOf(RecipeGenerationCancelledError);

        expect(generationProgress.reportedMessages).not.toContain('Scanning Contact (2 of 3)');
        expect(generationProgress.reportedMessages).not.toContain('Building relationship trees…');
        const listedDirectoryNames = readDirectorySpy.mock.calls.map(([directoryUri]) => path.basename(directoryUri.fsPath));
        expect(listedDirectoryNames).not.toContain('Contact');
        expect(listedDirectoryNames).not.toContain('Opportunity');

    });

    test('given a cancel while the relationship trees are built, rejects as cancelled rather than returning a run to write', async () => {

        const generationProgress = new RecordingGenerationProgress('Building relationship trees…');

        await expect(new DirectoryProcessor().processAllObjectsAndRelationships(objectsUri(), generationProgress))
            .rejects.toBeInstanceOf(RecipeGenerationCancelledError);

    });

    test('given an objects directory with no object folders, reports 0 of 0 and completes', async () => {

        const generationProgress = new RecordingGenerationProgress();

        const objectInfoWrapper = await new DirectoryProcessor().processAllObjectsAndRelationships(
            vscode.Uri.file(path.join(emptyMetadataPath, 'objects')),
            generationProgress
        );

        expect(Object.keys(objectInfoWrapper.ObjectToObjectInfoMap)).toEqual([]);
        expect(generationProgress.reportedMessages).toEqual([
            'Scanning objects…',
            'Scanning objects (0 of 0)',
            'Building relationship trees…'
        ]);

    });

    test('given the configured path is itself one object directory, counts it as one object', async () => {

        const generationProgress = new RecordingGenerationProgress();

        await new DirectoryProcessor().processAllObjectsAndRelationships(
            vscode.Uri.file(path.join(metadataPath, 'objects', 'Account')),
            generationProgress
        );

        expect(generationProgress.reportedMessages).toContain('Scanning Account (1 of 1)');

    });

});

describe('DirectoryProcessor.throwIfCancellationRequested', () => {

    test('given no progress port, never throws', () => {
        expect(() => DirectoryProcessor.throwIfCancellationRequested(undefined)).not.toThrow();
    });

    test('given a cancelled port, throws a RecipeGenerationCancelledError', () => {
        const cancelledProgress: IRecipeGenerationProgress = { report: () => undefined, isCancellationRequested: () => true };
        expect(() => DirectoryProcessor.throwIfCancellationRequested(cancelledProgress)).toThrow(RecipeGenerationCancelledError);
    });

});
