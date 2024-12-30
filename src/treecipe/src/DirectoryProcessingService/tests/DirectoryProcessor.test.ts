import { ConfigurationService } from "../../ConfigurationService/ConfigurationService";
import { DirectoryProcessor } from "../DirectoryProcessor";

import * as vscode from 'vscode';
import { MockDirectoryService } from "./MockObjectsDirectory/MockDirectoryService";
import { ObjectInfoWrapper } from "../../ObjectInfoWrapper/ObjectInfoWrapper";
import { SnowfakeryFakerService } from "../../FakerService/SnowfakeryFakerService/SnowfakeryFakerService";
import { XMLMarkupMockService } from "../../XMLProcessingService/tests/mocks/XMLMarkupMockService";


jest.mock('vscode', () => ({
  workspace: {
      workspaceFolders: undefined,
      fs: { 
          readDirectory: jest.fn()
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
      let actualFieldInfo = await directoryProcessor.buildFieldInfoByXMLContent(textXMLContent, fakeObjectApiName);

      const expectedFieldInfo = XMLMarkupMockService.getTextXMLFieldDetail();
    
      // ENSURE LABEL AND FIELD API NAME ARE AS EXPECTED, OTHER VALIDATION FUNCTIONALITY HANDLES RECIPE VALUE ASSIGNMENTS
      expect(actualFieldInfo.fieldLabel).toEqual(expectedFieldInfo.fieldLabel); 
      expect(actualFieldInfo.fieldName).toEqual(expectedFieldInfo.apiName);

    });

  });


  describe('isXMLFileType', () => {

    test('given expected xml file extension and filetype enum, returns true', () => {

      // const isXMLFileType:boolean = directoryProcessor.isXMLFileType();
      // expect(isXMLFileType).toBeTruthy();
    });

  });

  describe('processFieldsDirectory', () => {
    

      /*

        1. mock out interface implementation for faker servie
        2. mock out readDirectory to return files with expected structure in which some would have .xml extension
          2-a. need to confirm is file type an actual file as there could be nested directories and this is our basecase for field xml file processing recursively
        3. mock out vscode.Uri.joinPath ( see if there is way to use expected mocked details from readDirectory to make fieldUri)
        4. mock out xmlContent for readFile based on some sort of map from expectec directory types 
           4-a ? - may make this the focus for the next line for buffer.from to string as that is what gives us the actual xmlContent that we can mock
        
        5. buildFieldInfoByXMLContent
        
        asserts--- 
        1. assert - expected fieldInfoDetails???? 
         - count of fieldInfoDetails array

      */
        
      // mockReadDirectory = jest.fn().mockResolvedValue(mockedFields);
      // jest.spyOn(vscode.workspace.fs, 'readDirectory').mockImplementation(mockReadDirectory);
      // jest.spyOn(vscode.workspace.fs, 'readFile').mockImplementation(() => 
      //     Promise.resolve(Buffer.from(XMLMarkupMockService.getTextFieldTypeXMLMarkup()))
      // );
      // test('given expected directory containing 5 file types and 2 folder types, ', () => {




      // });
  
      // test('processes all fields in directory and updates object wrapper', async () => {
      //     const uri = vscode.Uri.file('/fake/fields/path');
      //     const fakeObjectName = 'FakeObject__c';
      //     const result = await directoryProcessor.processFieldsDirectory(uri, fakeObjectName);
  
      //     expect(mockReadDirectory).toHaveBeenCalledWith(uri);
      //     expect(result.length).toBe(3); // Expecting 3 field files processed
      //     expect(result).toBeDefined();
      //     expect(result).toContainEqual(
      //         expect.objectContaining({
      //             fieldName: expect.any(String),
      //             fieldType: expect.any(String)
      //         })
      //     );
      // });
  
      // afterEach(() => {
      //     jest.clearAllMocks();
      // });
          
  });




});


// });

