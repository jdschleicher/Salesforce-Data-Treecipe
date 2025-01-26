import { RecordTypeService } from "../../RecordTypeService/RecordTypeService";
import * as fs from 'fs';

import * as vscode from 'vscode';
import * as xml2js from 'xml2js';
import * as path from 'path';
import { MockRecordTypeService } from "./MockRecordTypeService";

jest.mock('fs');
jest.mock('path');
jest.mock('xml2js');

jest.mock('vscode', () => ({
    workspace: {
        fs: { 
            readDirectory: jest.fn(),
            readFile: jest.fn()
        }
    },
    Uri: {
        joinPath: jest.fn(),
        parse: jest.fn()
    },
    FileType: {
        Directory: 2,
        File: 1
    }
}), { virtual: true });

describe('RecordTypeService Shared Instance Tests', () => {

    describe('getRecordTypeMarkupMap', () => {

        test('given expected mock xml markup content and expected xml converted object expectd markup is returned and mocked functions are called with expected arguments', async () => {


            (fs.existsSync as jest.Mock).mockReturnValue(true);

            const fileTypeEnum = 1;
            const mockRecordTypeFileName = 'TestRecordType.xml';
            (vscode.workspace.fs.readDirectory as jest.Mock).mockResolvedValue([[mockRecordTypeFileName, fileTypeEnum]]);

            const mockRecordTypeXMLContent = MockRecordTypeService.getRecordTypeOneRecTypeXMLContent();
            (vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(Buffer.from(mockRecordTypeXMLContent));

            const mockRecordTypeXML = MockRecordTypeService.getRecordTypeMockOneRecTypeAsObject();
            (xml2js.parseString as jest.Mock).mockImplementation((content, callback) => callback(null, mockRecordTypeXML));
            (path.extname as jest.Mock).mockReturnValue('.xml');

            const mockAssociatedFieldsDirectoryPath = '/mock/path/to/fields';
            const result = await RecordTypeService.getRecordTypeMarkupMap(mockAssociatedFieldsDirectoryPath);


            const mockBaseObjectPath = '/mock/path/to';
            const mockRecordTypesPath = `${mockBaseObjectPath}/recordTypes`;
            expect(fs.existsSync).toHaveBeenCalledWith(mockRecordTypesPath);
            expect(vscode.workspace.fs.readDirectory).toHaveBeenCalledWith(vscode.Uri.parse(mockRecordTypesPath));
            expect(vscode.workspace.fs.readFile).toHaveBeenCalledWith(vscode.Uri.joinPath(vscode.Uri.parse(mockRecordTypesPath), mockRecordTypeFileName));
            expect(xml2js.parseString).toHaveBeenCalledWith(mockRecordTypeXMLContent, expect.any(Function));
           
            const expectedRecordTypeFieldToPicklistValuesMap = MockRecordTypeService.getOneRecTypeFieldToPicklistValuesMap();
            const expectedRecordTypeToXMLMarkupMap = { OneRecType: expectedRecordTypeFieldToPicklistValuesMap };
            expect(result).toEqual(
                expectedRecordTypeToXMLMarkupMap
            );
        
        });

    });

});
