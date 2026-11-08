import * as vscode from 'vscode';
import { PicklistDependencyTestService } from '../PicklistDependencyTestService';
import { ErrorHandlingService } from '../../ErrorHandlingService/ErrorHandlingService';

jest.mock('vscode', () => ({
    workspace: {
        workspaceFolders: undefined,
        fs: { readDirectory: jest.fn(), readFile: jest.fn() }
    },
    Uri: {
        file: (filePath: string) => ({ fsPath: filePath }),
        joinPath: jest.fn((baseUri, ...pathSegments) => ({ fsPath: `${baseUri.fsPath}/${pathSegments.join('/')}` }))
    },
    window: { showWarningMessage: jest.fn(), showErrorMessage: jest.fn() },
    FileType: { Directory: 2, File: 1, SymbolicLink: 64 }
}), { virtual: true });

// A FIELD FILE A USER LEFT HALF-EDITED: THE CLOSING TAGS ARE MISSING
const MALFORMED_FIELD_XML = `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Broken__c</fullName
    <type>Picklist`;

describe('PicklistDependencyTestService -- a malformed field file is captured once and rethrown (#574)', () => {

    test('getFieldDetailsByFieldsDirectory writes the same capture Generate Treecipe does, then rejects', async () => {

        (vscode.workspace.fs.readDirectory as jest.Mock).mockResolvedValue([['Broken__c.field-meta.xml', vscode.FileType.File]]);
        (vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(Buffer.from(MALFORMED_FIELD_XML, 'utf8'));
        const captureSpy = jest.spyOn(ErrorHandlingService, 'createGenerateRecipeErrorCaptureFile').mockImplementation(() => undefined);

        await expect(PicklistDependencyTestService.getFieldDetailsByFieldsDirectory(vscode.Uri.file('/project/objects/Account/fields')))
            .rejects.toMatchObject({ name: 'XMLFieldProcessorError', message: expect.stringContaining('Broken__c.field-meta.xml') });

        expect(captureSpy).toHaveBeenCalledTimes(1);
        expect(captureSpy).toHaveBeenCalledWith(expect.objectContaining({ name: 'XMLFieldProcessorError' }), 'XMLFileProcessor.processXmlFieldContent');

    });

});
