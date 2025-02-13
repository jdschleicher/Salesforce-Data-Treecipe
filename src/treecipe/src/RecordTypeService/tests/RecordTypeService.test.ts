import { RecordTypeService } from "../../RecordTypeService/RecordTypeService";
import * as fs from 'fs';

import * as vscode from 'vscode';
import * as xml2js from 'xml2js';
import * as path from 'path';
import { MockRecordTypeService } from "./MockRecordTypeService";
import { Connection } from "@salesforce/core";

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
            const actualOneRecTypeResults = await RecordTypeService.getRecordTypeToApiFieldToRecordTypeWrapper(mockAssociatedFieldsDirectoryPath);

            const mockBaseObjectPath = '/mock/path/to';
            const mockRecordTypesPath = `${mockBaseObjectPath}/recordTypes`;
            expect(fs.existsSync).toHaveBeenCalledWith(mockRecordTypesPath);
            expect(vscode.workspace.fs.readDirectory).toHaveBeenCalledWith(vscode.Uri.parse(mockRecordTypesPath));
            expect(vscode.workspace.fs.readFile).toHaveBeenCalledWith(vscode.Uri.joinPath(vscode.Uri.parse(mockRecordTypesPath), mockRecordTypeFileName));
            expect(xml2js.parseString).toHaveBeenCalledWith(mockRecordTypeXMLContent, expect.any(Function));
           
            const expectedRecordTypeToRecordTypeWrapperMap = MockRecordTypeService.getMultipleRecordTypeToFieldToRecordTypeWrapperMap();
            // const expectedRecordTypeToRecordTypeWrapperMap = { OneRecType: expectedRecordTypeFieldToPicklistValuesMap };
            expect(actualOneRecTypeResults.OneRecType).toEqual(
                expectedRecordTypeToRecordTypeWrapperMap.OneRecType
            );
        
        });

    });

    describe('getRecordTypeIdsByConnection', () => {

        test('given mocked Connection instance and mocked query funtcion, should query record type IDs for given object API names', async () => {   
            const mockedConnectionWithMockedQueryReturn = {
                query: jest.fn(),
            } as unknown as jest.Mocked<Connection>;
            
            const mockRecordTypes:any = MockRecordTypeService.getFakeRecordTypeByIdsQueryResults();     
            mockedConnectionWithMockedQueryReturn.query.mockResolvedValue(mockRecordTypes);

            const doesntMatterObjectNames = ['Account', 'Contact'];
            const result = await RecordTypeService.getRecordTypeIdsByConnection(
                mockedConnectionWithMockedQueryReturn,
                doesntMatterObjectNames
            );
   
            expect(result).toEqual(mockRecordTypes);
          
        });

    });

});
