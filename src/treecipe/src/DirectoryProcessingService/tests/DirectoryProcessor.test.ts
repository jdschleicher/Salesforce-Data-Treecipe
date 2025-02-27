import { ConfigurationService } from "../../ConfigurationService/ConfigurationService";
import { DirectoryProcessor } from "../DirectoryProcessor";

import * as vscode from 'vscode';
import { MockDirectoryService } from "./MockObjectsDirectory/MockDirectoryService";
import { ObjectInfoWrapper } from "../../ObjectInfoWrapper/ObjectInfoWrapper";
import { SnowfakeryFakerService } from "../../FakerService/SnowfakeryFakerService/SnowfakeryFakerService";
import { XMLMarkupMockService } from "../../XMLProcessingService/tests/mocks/XMLMarkupMockService";
import { MockVSCodeWorkspaceService } from "../../VSCodeWorkspace/tests/mocks/MockVSCodeWorkspaceService";


jest.mock('vscode', () => ({
  workspace: {
      workspaceFolders: undefined,
      fs: { 
          readDirectory: jest.fn(),
          readFile: jest.fn()
      }
  },
  Uri: {
      file: (path: string) => ({ fsPath: path }),
      joinPath: jest.fn().mockImplementation((baseUri, ...pathSegments) => ({
        fsPath: `${baseUri.fsPath}/${pathSegments.join('/')}`.replace(/\/+/g, '/'), // Ensure no double slashes
      }))
  },
  window: {
      showWarningMessage: jest.fn(),
      showQuickPick: jest.fn()
  },
  ThemeIcon: jest.fn().mockImplementation(
      (name) => ({ id: name })
  ),
  FileType: {
      Directory: 2,
      File: 1,
      SymbolicLink: 64
  }

}), { virtual: true });

describe('Shared DirectoryProcessor Snowfakery FakerService Implementation Testign Context', () => {


  let directoryProcessor: DirectoryProcessor;
  
  beforeEach(() => {
  
    jest.spyOn(ConfigurationService, 'getFakerImplementationByExtensionConfigSelection')
      .mockImplementation(() => new SnowfakeryFakerService());
  
    directoryProcessor = new DirectoryProcessor();
  
  });

  describe('getLastSegmentFromPath', () => {

    test('given expected directory path segments, returns expected api name at end of path', () => {
      
      const expectedObjectApiName = 'objectApiName';
      let mockObjectsDirectoryPath = `src/treecipe/src/DirectoryProcessingService/tests/MockObjectsDirectory/objects/${expectedObjectApiName}`;   
      
      let actualLastPathSegmentValue = directoryProcessor.getLastSegmentFromPath(mockObjectsDirectoryPath);
      
      expect(actualLastPathSegmentValue).toEqual(expectedObjectApiName);
    
    });
  
  });

  describe('processDirectory', () => {

    test('given mocked directory structure with expected count of 10 fake paths, recursive function gets called 10 times', async () => {

      const jsonMockedDirectoryStructure = MockDirectoryService.getVSCodeFileTypeMockedDirectories();

      const mockReadDirectory = jest.fn().mockResolvedValueOnce(jsonMockedDirectoryStructure);
  
      jest.spyOn(vscode.workspace.fs, 'readDirectory').mockImplementation(mockReadDirectory);
      jest.spyOn(vscode.window, 'showWarningMessage').mockImplementation();

      let objectInfoWrapper = new ObjectInfoWrapper();
      const uri = vscode.Uri.file('/fake/path');

      const result = await directoryProcessor.processDirectory(uri, objectInfoWrapper);
    
      expect(result).toEqual(objectInfoWrapper);  // the objectInfoWrapper for this test should be nothing but initialized
      expect(mockReadDirectory).toHaveBeenCalledWith(uri); 
      expect(mockReadDirectory).toHaveBeenCalledTimes(10); 

    });

  });

  describe('buildFieldInfoByXMLContent', () => {                  

    test('given mocked text xml content, returns expected field info object', async() => {

      jest.spyOn(ConfigurationService, 'getFakerImplementationByExtensionConfigSelection').mockImplementation(() => new SnowfakeryFakerService());

      const textXMLContent = XMLMarkupMockService.getTextFieldTypeXMLMarkup();
      const fakeObjectApiName = 'Demming';
      const recordTypeNameByRecordTypeNameToXMLMarkup = {};
      let actualFieldInfo = await directoryProcessor.buildFieldInfoByXMLContent(textXMLContent, fakeObjectApiName, recordTypeNameByRecordTypeNameToXMLMarkup);

      const expectedFieldInfo = XMLMarkupMockService.getTextXMLFieldDetail();
    
      // ENSURE LABEL AND FIELD API NAME ARE AS EXPECTED, OTHER VALIDATION FUNCTIONALITY HANDLES RECIPE VALUE ASSIGNMENTS
      expect(actualFieldInfo.fieldLabel).toEqual(expectedFieldInfo.fieldLabel); 
      expect(actualFieldInfo.fieldName).toEqual(expectedFieldInfo.apiName);

    });

  });

  describe('processFieldsDirectory', () => {

      test('given expected mock to return non-xml files, nested directories enum types, and xml files, expected count of fieldInfo returned', async () => {

        // THIS TEST COMPLETELY MOCKS OUT XML MARKUP TO FOCUS ON FIELD RESULTS 
        const mockedDirectory = MockDirectoryService.getMockedReadDirectorWithExpectedFoldersAndInvalidXMLFileExtensions();
        const expectedFakeDirectoryItems = 22;
        const expectedXMLFileTypesInDirectory = 19;

        jest.spyOn(vscode.workspace.fs, 'readDirectory').mockImplementation(() => 
          Promise.resolve(mockedDirectory)
        );

        // this is used to ensure the mock is returning the expected result to avoid any type of effects from the mock changing in another test
        expect(mockedDirectory.length).toBe(expectedFakeDirectoryItems);
        
        const mockedUri:vscode.Uri = MockVSCodeWorkspaceService.getFakeVSCodeUri();
        jest.spyOn(vscode.Uri, "joinPath").mockReturnValue(mockedUri);

        jest.spyOn(vscode.workspace.fs, 'readFile').mockReturnValue(
          Promise.resolve(Buffer.from('fake xml markup'))
        );

        jest.spyOn(vscode.workspace.fs, 'readFile').mockReturnValue(
          Promise.resolve(Buffer.from('fake xml markup'))
        );

        const mockedBuffer:any = 'dont care text';
        jest.spyOn(Buffer, 'from').mockReturnValue(mockedBuffer);

        const fakeFieldXMLInfo:any = XMLMarkupMockService.getRichTextAreaXMLFieldDetail();
        jest.spyOn(directoryProcessor, 'buildFieldInfoByXMLContent').mockReturnValue(fakeFieldXMLInfo);
        
        const fakeUri = vscode.Uri.file('/fake/fields/fakepath');
        const fakeObjectName = 'dont worry about me';
        const fakeRecordTypeNameByRecordTypeNameToXMLMarkup = {};
        const salesforceOOTBMappings = {};
        const processedFileInfoDetails = await directoryProcessor.processFieldsDirectory(fakeUri, 
                                                                                          fakeObjectName, 
                                                                                          fakeRecordTypeNameByRecordTypeNameToXMLMarkup,
                                                                                          salesforceOOTBMappings);

        expect(processedFileInfoDetails.length).toBe(expectedXMLFileTypesInDirectory);

      });
          
  });

  describe('isInMappingsOfOotbSalesforceFields', () => {

    test('given expected file name and associated object name, returns true if in mappings of ootb salesforce fields', () => {
      
      const fakeFieldApiName = 'fakeField';
      const fakeFileName = `${fakeFieldApiName}.field-meta.xml`;
      const fakeAssociatedObjectName = 'fakeObject';
      const fakeSalesforceOOTBMappings = {
        [fakeAssociatedObjectName]: {
          'fakeField': 'some value'
        }
      };

      const result = directoryProcessor.isInMappingsOfOotbSalesforceFields(fakeFileName, fakeAssociatedObjectName, fakeSalesforceOOTBMappings);
    
      expect(result).toBe(true);

    });

    test('given expected file name and associated object name, returns false if not in mappings of ootb salesforce fields', () => {
     
      const fakeFieldApiName = 'fakeField';
      const fakeFileName = `${fakeFieldApiName}.field-meta.xml`;
      const fakeAssociatedObjectName = 'fakeObject';
      const fakeSalesforceOOTBMappings = {
        [fakeAssociatedObjectName]: {
          'someOtherField': 'some value'
        }
      };

      const result = directoryProcessor.isInMappingsOfOotbSalesforceFields(fakeFileName, fakeAssociatedObjectName, fakeSalesforceOOTBMappings);
    
      expect(result).toBe(false);

    });

    test('given expected mapping and expected object key name not in mapping, returns false if not in mappings of ootb salesforce object keys', () => {
      
      const fakeFieldApiName = 'fakeField';
      const fakeFileName = `${fakeFieldApiName}.field-meta.xml`;
      const objectNotInMappings = 'fakeObject';
      const fakeSalesforceOOTBMappings = {
        'Account': {
          'someOtherField': 'some value'
        }
      };

      const result = directoryProcessor.isInMappingsOfOotbSalesforceFields(fakeFileName, objectNotInMappings, fakeSalesforceOOTBMappings);
    
      expect(result).toBe(false);

    });

  });


});


