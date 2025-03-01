import { RecordTypeService } from "../../RecordTypeService/RecordTypeService";

import { MockRecordTypeService } from "./MockRecordTypeService";
import { MockCollectionsApiService } from "../../CollectionsApiService/tests/mocks/MockCollectionsApiService";
import { MockVSCodeWorkspaceService } from "../../VSCodeWorkspace/tests/mocks/MockVSCodeWorkspaceService";

import * as fs from 'fs';
import * as vscode from 'vscode';
import * as xml2js from 'xml2js';

jest.mock('fs');
jest.mock('xml2js');

jest.mock('vscode', () => ({
    workspace: {
        fs: { 
            readDirectory: jest.fn(),
            readFile: jest.fn(),
            existsSync: jest.fn()
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

    describe('getRecordTypeToApiFieldToRecordTypeWrapper', () => {

        beforeEach(() => {
  
            const fakeRecordTypesPath = '/mock/path/to/recordTypes';
            jest.spyOn(RecordTypeService, 'getExpectedRecordTypesPathByFieldsDirectoryPath').mockReturnValue(fakeRecordTypesPath);
          
            const mockUri = MockVSCodeWorkspaceService.getFakeVSCodeUri();
            (vscode.Uri.parse as jest.Mock).mockReturnValue(mockUri);
            
            const fileTypeEnum = 1;
            const mockRecordTypeFileName = 'TestRecordType.xml';
            jest.spyOn(RecordTypeService, 'getRecordTypeTuplesFromExpectedRecordTypesDirectory').mockResolvedValue(
                [[mockRecordTypeFileName, fileTypeEnum]]
            );
    
        });
  
        test('given mocked record type detail with expected picklist, fullname, and developern name structures, returns expected record type api to record type wrapper map', async () => {
  
            const expectedRecordTypeXMLDetail = MockRecordTypeService.getRecordTypeMockOneRecTypeAsObject();
            jest.spyOn(RecordTypeService, 'getRecordTypeDetailFromRecordTypeFile').mockResolvedValue(expectedRecordTypeXMLDetail.RecordType);
            
            const mockAssociatedFieldsDirectoryPath = '/mock/path/to/fields';
            const actualOneRecTypeResults = await RecordTypeService.getRecordTypeToApiFieldToRecordTypeWrapper(mockAssociatedFieldsDirectoryPath);

            const expectedRecordTypeApiNameToRecordTypeWrapperMap = MockRecordTypeService.getMultipleRecordTypeToFieldToRecordTypeWrapperMap();
            expect(actualOneRecTypeResults.OneRecType).toEqual(
                expectedRecordTypeApiNameToRecordTypeWrapperMap.OneRecType
            );
        
        });

        test('given mocked record type detail with NO PICKLIST structures, returns expected record type api to record type wrapper map', async () => {
  
            const expectedNoPicklistRecordTypeXMLDetail = MockRecordTypeService.getRecordTypeWithoutPicklistDetail();
            jest.spyOn(RecordTypeService, 'getRecordTypeDetailFromRecordTypeFile').mockResolvedValue(expectedNoPicklistRecordTypeXMLDetail.RecordType);
            
            const mockAssociatedFieldsDirectoryPath = '/mock/path/to/fields';
            const actualOneRecTypeResults = await RecordTypeService.getRecordTypeToApiFieldToRecordTypeWrapper(mockAssociatedFieldsDirectoryPath);

            const expectedRecordTypeApiNameToRecordTypeWrapperMap = MockRecordTypeService.getEmptyPicklistRecordTypeWrapperMap();
            expect(actualOneRecTypeResults.NoPicklistOneRecType).toEqual(
                expectedRecordTypeApiNameToRecordTypeWrapperMap.NoPicklistOneRecType
            );
        
        });

    });

    describe('getRecordTypeIdsByConnection', () => {

        test('given mocked Connection instance and mocked query funtcion, should query record type IDs for given object API names', async () => {   
            
            const mockedConnection = MockCollectionsApiService.getMockedSalesforceCoreConnection();
            
            const mockRecordTypes:any = MockRecordTypeService.getFakeRecordTypeByIdsQueryResults();     
            mockedConnection.query.mockResolvedValue(mockRecordTypes);

            const doesntMatterObjectNames = ['Account', 'Contact'];
            const result = await RecordTypeService.getRecordTypeIdsByConnection(
                mockedConnection,
                doesntMatterObjectNames
            );
   
            expect(result).toEqual(mockRecordTypes);
          
        });

    });

    describe('convertRecordTypeXMLContentToXMLDetailObject', () => {    

        test('given mocked xml2js parseString function, should convert XML to object', async () => {   
            
            const mockRecordTypeXMLContent = MockRecordTypeService.getRecordTypeOneRecTypeXMLContent();
            const mockRecordTypeXMLDetail = MockRecordTypeService.getRecordTypeMockOneRecTypeAsObject();
            (xml2js.parseString as jest.Mock).mockImplementation(
                (content, callback) => callback(null, mockRecordTypeXMLDetail)
            );

            const actualRecordTypeXMLDetail = RecordTypeService.convertRecordTypeXMLContentToXMLDetailObject(mockRecordTypeXMLContent);
   
            expect(actualRecordTypeXMLDetail).toEqual(mockRecordTypeXMLDetail.RecordType);
          
        });

    });

    describe('initiateRecordTypeWrapperByXMLDetail', () => {
        
        test('given XML Record Typ detail with expected picklist structures, should create expected RecordTypeWrapper', async () => {   
            
            const mockRecordTypeXMLDetail = MockRecordTypeService.getRecordTypeMockOneRecTypeAsObject();
            const mockRecordTypeApiName = 'OneRecType';
            const actualRecordTypeWrapper = RecordTypeService.initiateRecordTypeWrapperByXMLDetail(mockRecordTypeXMLDetail.RecordType, mockRecordTypeApiName);
   
            const expectedRecordTypeWrapper = MockRecordTypeService.getSingleRecTypeWrapper();
            expect(actualRecordTypeWrapper).toEqual(expectedRecordTypeWrapper);
          
        });

    });

    describe('getExpectedRecordTypesPathByFieldsDirectoryPath', () => {

        test('given expected fields directory path, should return expected record types path', async () => {   
            
            const mockAssociatedFieldsDirectoryPath = '/mock/path/to/fields';
            const actualRecordTypesPath = RecordTypeService.getExpectedRecordTypesPathByFieldsDirectoryPath(mockAssociatedFieldsDirectoryPath);
            const expectedRecordTypesPath = '/mock/path/to/recordTypes';
            expect(actualRecordTypesPath).toEqual(expectedRecordTypesPath);
        
        });

    });

    describe('getRecordTypeTuplesFromExpectedRecordTypesDirectory', () => {

       test('given mocked record types directory, should return expected record type file tuples', async () => {
            
            const mockRecordTypesDirectory = '/mock/path/to/recordTypes';
            
            const mockRecordTypeFileName = 'TestRecordType.xml';
            const fileTypeEnum = 1;

            const mockUri = MockVSCodeWorkspaceService.getFakeVSCodeUri();
            (vscode.Uri.parse as jest.Mock).mockReturnValue(mockUri);

            (vscode.workspace.fs.readDirectory as jest.Mock).mockResolvedValue([[mockRecordTypeFileName, fileTypeEnum]]);
            (fs.existsSync as jest.Mock).mockResolvedValue(true);

            const actualRecordTypeTuples = await RecordTypeService.getRecordTypeTuplesFromExpectedRecordTypesDirectory(mockRecordTypesDirectory);
            const expectedRecordTypeTuples = [[mockRecordTypeFileName, fileTypeEnum]];
            expect(actualRecordTypeTuples).toEqual(expectedRecordTypeTuples);
        
        });

        test('given mocked record types directory that does not exist, should return empty array', async () => {
            
            const mockRecordTypesDirectory = '/other/path/to/recordTypes';
            
            jest.spyOn(fs, 'existsSync').mockReturnValue(false);

            const recordTypeTuplesResults = await RecordTypeService.getRecordTypeTuplesFromExpectedRecordTypesDirectory(mockRecordTypesDirectory);
            let expectedEmptyRecordTypeFileTuples:[string, number][] = [];
            expect(recordTypeTuplesResults).toEqual(expectedEmptyRecordTypeFileTuples);

        });

    });


});
