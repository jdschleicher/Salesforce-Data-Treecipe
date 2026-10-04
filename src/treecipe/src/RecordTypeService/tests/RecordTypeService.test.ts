import { RecordTypeService } from "../../RecordTypeService/RecordTypeService";
import { RecipeService } from "../../RecipeService/RecipeService";

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
  
        test('given mocked record type detail with expected picklist, fullname, and developer name structures, returns expected record type api to record type wrapper map', async () => {
  
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

    describe('getRecordTypeToApiFieldToRecordTypeWrapper order (#166)', () => {

        const buildRecordTypeXMLDetail = (developerName: string, active?: string) => ({
            fullName: [developerName],
            ...( active === undefined ? {} : { active: [active] } ),
            label: [developerName]
        });

        const recordTypeXMLDetailByFileName: Record<string, any> = {
            'Gamma.recordType-meta.xml': buildRecordTypeXMLDetail('Gamma', 'true'),
            'alpha.recordType-meta.xml': buildRecordTypeXMLDetail('alpha', 'true'),
            'Beta.recordType-meta.xml': buildRecordTypeXMLDetail('Beta', 'false'),
            'Zulu.recordType-meta.xml': buildRecordTypeXMLDetail('Zulu'),
            'A_b.recordType-meta.xml': buildRecordTypeXMLDetail('A_b', 'true'),
            'AB.recordType-meta.xml': buildRecordTypeXMLDetail('AB', 'true')
        };
        // CODE UNIT ORDER: UPPERCASE BEFORE "_" BEFORE LOWERCASE, WHICH localeCompare WOULD NOT GIVE
        const expectedDeveloperNameOrder = ['AB', 'A_b', 'Beta', 'Gamma', 'Zulu', 'alpha'];

        const loadWithListing = async (fileTuples: [string, number][]) => {

            jest.spyOn(RecordTypeService, 'getExpectedRecordTypesPathByFieldsDirectoryPath').mockReturnValue('/mock/path/to/recordTypes');
            jest.spyOn(RecordTypeService, 'getRecordTypeTuplesFromExpectedRecordTypesDirectory').mockResolvedValue(fileTuples);
            jest.spyOn(RecordTypeService, 'getRecordTypeDetailFromRecordTypeFile').mockImplementation(async (fileName: string) => recordTypeXMLDetailByFileName[fileName]);
            return RecordTypeService.getRecordTypeToApiFieldToRecordTypeWrapper('/mock/path/to/fields');

        };

        afterEach(() => {
            delete recordTypeXMLDetailByFileName['Duplicate_1.recordType-meta.xml'];
            delete recordTypeXMLDetailByFileName['Duplicate_2.recordType-meta.xml'];
        });

        const fileTypeEnum = 1;
        const sortedFileTuples: [string, number][] = Object.keys(recordTypeXMLDetailByFileName).sort().map(fileName => [fileName, fileTypeEnum]);

        test('given the listing in any order, returns record types by developer name in code unit order', async () => {

            const sortedResult = await loadWithListing(sortedFileTuples);
            const reversedResult = await loadWithListing([...sortedFileTuples].reverse());
            const unsortedResult = await loadWithListing(Object.keys(recordTypeXMLDetailByFileName).map(fileName => [fileName, fileTypeEnum]));

            expect(Object.keys(sortedResult)).toEqual(expectedDeveloperNameOrder);
            expect(Object.keys(reversedResult)).toEqual(expectedDeveloperNameOrder);
            expect(Object.keys(unsortedResult)).toEqual(expectedDeveloperNameOrder);
            expect(reversedResult).toEqual(sortedResult);

        });

        test('never compares with localeCompare', async () => {

            const localeCompareSpy = jest.spyOn(String.prototype, 'localeCompare');

            await loadWithListing([...sortedFileTuples].reverse());

            expect(localeCompareSpy).not.toHaveBeenCalled();

        });

        test('reads Active from <active>, counting a missing tag as active', async () => {

            const result = await loadWithListing(sortedFileTuples);

            expect(Object.fromEntries(Object.entries(result).map(([developerName, wrapper]) => [developerName, wrapper.Active]))).toEqual({
                AB: true, A_b: true, Beta: false, Gamma: true, Zulu: true, alpha: true
            });

        });

        test('given two files with one developer name, the same file wins whatever the listing order', async () => {

            recordTypeXMLDetailByFileName['Duplicate_1.recordType-meta.xml'] = { ...buildRecordTypeXMLDetail('Duplicate', 'false'), picklistValues: [{ picklist: ['First__c'], values: [{ fullName: ['One'] }] }] };
            recordTypeXMLDetailByFileName['Duplicate_2.recordType-meta.xml'] = { ...buildRecordTypeXMLDetail('Duplicate', 'true'), picklistValues: [{ picklist: ['Second__c'], values: [{ fullName: ['Two'] }] }] };
            const duplicateTuples: [string, number][] = [['Duplicate_1.recordType-meta.xml', fileTypeEnum], ['Duplicate_2.recordType-meta.xml', fileTypeEnum]];

            const forwardResult = await loadWithListing(duplicateTuples);
            const reversedResult = await loadWithListing([...duplicateTuples].reverse());

            expect(forwardResult).toEqual(reversedResult);
            expect(forwardResult.Duplicate.PicklistFieldSectionsToPicklistDetail).toEqual({ Second__c: ['Two'] });

        });

        test('still ignores a file that is not XML', async () => {

            const result = await loadWithListing([['README.md', fileTypeEnum], ['Gamma.recordType-meta.xml', fileTypeEnum], ['nested', 2]]);

            expect(Object.keys(result)).toEqual(['Gamma']);
            expect(RecordTypeService.getRecordTypeDetailFromRecordTypeFile).toHaveBeenCalledTimes(1);

        });

        test('given a record type named __proto__, keeps it as an own key for the api-name partition to refuse, and leaves the map prototype alone', async () => {

            recordTypeXMLDetailByFileName['Duplicate_1.recordType-meta.xml'] = buildRecordTypeXMLDetail('__proto__', 'true');

            const result = await loadWithListing([['Duplicate_1.recordType-meta.xml', fileTypeEnum], ['Gamma.recordType-meta.xml', fileTypeEnum]]);

            expect(Object.keys(result)).toEqual(['Gamma', '__proto__']);
            expect(Object.getPrototypeOf(result)).toBeNull();
            expect(RecipeService.partitionRecordTypesByWritableDeveloperName(result).skippedRecordTypeDeveloperNames).toEqual(['__proto__']);

        });

        test('given an empty or missing recordTypes directory, returns an empty map', async () => {

            expect(await loadWithListing([])).toEqual({});

        });

    });

    describe('isActiveByXMLDetail', () => {

        test.each([
            ['"true"', { active: ['true'] }, true],
            ['"false"', { active: ['false'] }, false],
            ['" FALSE " with whitespace', { active: [' FALSE '] }, false],
            ['a boolean false', { active: [false] }, false],
            ['a boolean true', { active: [true] }, true],
            ['no <active> tag', {}, true],
            ['an empty <active> tag', { active: [''] }, true],
            ['no detail at all', undefined, true],
            ['nested markup', { active: [{ nested: ['false'] }] }, true],
            ['nested markup with a toString child, which String() would throw on', { active: [{ toString: ['x'] }] }, true]
        ])('given %s, returns %p', (unusedDescription, recordTypeXMLDetail, expectedActive) => {

            expect(RecordTypeService.isActiveByXMLDetail(recordTypeXMLDetail)).toBe(expectedActive);

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
