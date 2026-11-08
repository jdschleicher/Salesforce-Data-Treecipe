import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigurationService } from '../../ConfigurationService/ConfigurationService';
import { DirectoryProcessor } from '../DirectoryProcessor';
import { FakerJSRecipeFakerService } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';

jest.mock('vscode', () => ({
    workspace: {
        workspaceFolders: undefined,
        openTextDocument: jest.fn((uri) => Promise.resolve({ uri })),
        fs: { readDirectory: jest.fn(), readFile: jest.fn() }
    },
    Uri: { file: (fsPath: string) => ({ fsPath }) },
    window: {
        showWarningMessage: jest.fn(),
        showErrorMessage: jest.fn(),
        showTextDocument: jest.fn().mockResolvedValue({})
    },
    FileType: { Directory: 2, File: 1, SymbolicLink: 64 }
}), { virtual: true });

// A FIELD FILE A USER LEFT HALF-EDITED: THE CLOSING TAGS ARE MISSING
const MALFORMED_FIELD_XML = `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Broken__c</fullName
    <type>Text`;

/*
    What a user sees when Generate Treecipe meets a field file it cannot parse, asserted where they
    see it: one warning naming the capture file, the file written under the workspace and opened.
    #574 moves which service writes the capture; nothing here may change when it does.
*/
describe('DirectoryProcessor -- a malformed field file reaches the user as one captured error', () => {

    let workspaceRoot: string;

    beforeEach(() => {

        workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-malformed-field-'));
        (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [{ uri: { fsPath: workspaceRoot } }];
        jest.spyOn(ConfigurationService, 'getFakerImplementationByExtensionConfigSelection').mockImplementation(() => new FakerJSRecipeFakerService());
        jest.spyOn(ConfigurationService, 'getCustomRelationshipMappings').mockReturnValue({});

    });

    afterEach(() => {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
    });

    test('rejects naming the file, writes one capture file, warns once and opens it', async () => {

        const directoryProcessor = new DirectoryProcessor();

        await expect(directoryProcessor.buildFieldInfoByXMLContent(MALFORMED_FIELD_XML, 'Account', {}, 'Broken__c.field-meta.xml'))
            .rejects.toMatchObject({ name: 'XMLFieldProcessorError', message: expect.stringContaining('Error processing XML file: Broken__c.field-meta.xml') });
        await new Promise(resolve => setTimeout(resolve, 20));

        const errorsFolderPath = path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes', 'RecipeGenerationErrors');
        const captureFileNames = fs.readdirSync(errorsFolderPath);
        expect(captureFileNames).toHaveLength(1);
        expect(captureFileNames[0]).toMatch(/^generateRecipeError_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/);

        const capturedError = JSON.parse(fs.readFileSync(path.join(errorsFolderPath, captureFileNames[0]), 'utf-8'));
        expect(capturedError.name).toBe('XMLFieldProcessorError');

        expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
        expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(`XMLFileProcessor error captured in file: ${captureFileNames[0]}`);
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
        expect(vscode.workspace.openTextDocument).toHaveBeenCalledTimes(1);
        expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith({ fsPath: `${workspaceRoot}/treecipe/GeneratedRecipes/RecipeGenerationErrors/${captureFileNames[0]}` });

    });

});
