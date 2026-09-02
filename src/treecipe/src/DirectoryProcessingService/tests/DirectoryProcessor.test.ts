import { ConfigurationService } from "../../ConfigurationService/ConfigurationService";
import { DirectoryProcessor } from "../DirectoryProcessor";

import * as vscode from 'vscode';
import { MockDirectoryService } from "./mocks/MockSalesforceMetadataDirectory/MockDirectoryService";
import { ObjectInfoWrapper } from "../../ObjectInfoWrapper/ObjectInfoWrapper";
import { SnowfakeryRecipeFakerService } from "../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService";
import { XMLMarkupMockService } from "../../XMLProcessingService/tests/mocks/XMLMarkupMockService";
import { MockVSCodeWorkspaceService } from "../../VSCodeWorkspace/tests/mocks/MockVSCodeWorkspaceService";
import { RecordTypeService } from "../../RecordTypeService/RecordTypeService";


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
      .mockImplementation(() => new SnowfakeryRecipeFakerService());
  
    directoryProcessor = new DirectoryProcessor();
  
  });

  describe('getLastSegmentFromPath', () => {

    test('given expected directory path segments, returns expected api name at end of path', () => {
      
      const expectedObjectApiName = 'objectApiName';
      let mockObjectsDirectoryPath = `src/treecipe/src/DirectoryProcessingService/tests/MockSalesforceMetadataDirectory/objects/${expectedObjectApiName}`;   
      
      let actualLastPathSegmentValue = directoryProcessor.getLastSegmentFromPath(mockObjectsDirectoryPath);
      
      expect(actualLastPathSegmentValue).toEqual(expectedObjectApiName);
    
    });
  
  });

  describe('processDirectory', () => {

    test('given mocked directory structure with expected count of 10 fake paths, recursive function gets called 10 times', async () => {

      const jsonMockedDirectoryStructure = MockDirectoryService.getVSCodeFileTypeMockedObjectDirectories();

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

  describe('object child directory pruning', () => {

    /*
        Once a directory is known to contain "fields" it is an object directory, and its other
        children cannot contribute anything downstream. This prunes them -- which changes recipe
        generation for every user, so the behaviour is pinned here rather than argued in a comment.
    */

    const objectsRootPath = '/fake/objects';
    const objectDirectoryPath = `${objectsRootPath}/Example__c`;

    function mockObjectDirectoryWithSiblingsOfFields() {

      return jest.fn().mockImplementation((directoryUri: any) => {

        switch ( directoryUri.fsPath ) {

          case objectsRootPath:
            return Promise.resolve([['Example__c', vscode.FileType.Directory]]);

          case objectDirectoryPath:
            return Promise.resolve([
              ['fields', vscode.FileType.Directory],
              ['listViews', vscode.FileType.Directory],
              ['recordTypes', vscode.FileType.Directory],
              ['compactLayouts', vscode.FileType.Directory],
              ['Example__c.object-meta.xml', vscode.FileType.File]
            ]);

          default:
            return Promise.resolve([]);

        }

      });

    }

    beforeEach(() => {
      jest.spyOn(vscode.window, 'showWarningMessage').mockImplementation();
      jest.spyOn(RecordTypeService, 'getRecordTypeToApiFieldToRecordTypeWrapper').mockResolvedValue({} as any);
    });

    test('given an object directory containing fields, sibling child directories are never read', async () => {

      const mockReadDirectory = mockObjectDirectoryWithSiblingsOfFields();
      jest.spyOn(vscode.workspace.fs, 'readDirectory').mockImplementation(mockReadDirectory);

      await directoryProcessor.processDirectory(vscode.Uri.file(objectsRootPath), new ObjectInfoWrapper());

      const readDirectoryPaths = mockReadDirectory.mock.calls.map(([directoryUri]: any) => directoryUri.fsPath);

      expect(readDirectoryPaths).toContain(`${objectDirectoryPath}/fields`);
      expect(readDirectoryPaths).not.toContain(`${objectDirectoryPath}/listViews`);
      expect(readDirectoryPaths).not.toContain(`${objectDirectoryPath}/compactLayouts`);

    });

    /*
        The pruning is only safe because RecordTypeService reaches record types from the FIELDS path
        rather than relying on the walk to find the recordTypes directory. If that ever stops being
        true, pruning silently drops record type driven picklist values from every recipe.
    */
    test('given record types are pruned from the walk, they are still resolved from the fields path', async () => {

      const mockReadDirectory = mockObjectDirectoryWithSiblingsOfFields();
      jest.spyOn(vscode.workspace.fs, 'readDirectory').mockImplementation(mockReadDirectory);

      const recordTypeLookupSpy = jest.spyOn(RecordTypeService, 'getRecordTypeToApiFieldToRecordTypeWrapper')
        .mockResolvedValue({} as any);

      await directoryProcessor.processDirectory(vscode.Uri.file(objectsRootPath), new ObjectInfoWrapper());

      const readDirectoryPaths = mockReadDirectory.mock.calls.map(([directoryUri]: any) => directoryUri.fsPath);

      expect(readDirectoryPaths).not.toContain(`${objectDirectoryPath}/recordTypes`);
      expect(recordTypeLookupSpy).toHaveBeenCalledTimes(1);

    });

    test('given the object is registered, the pruned walk still names it from the parent directory', async () => {

      jest.spyOn(vscode.workspace.fs, 'readDirectory').mockImplementation(mockObjectDirectoryWithSiblingsOfFields());

      const objectInfoWrapper = new ObjectInfoWrapper();
      await directoryProcessor.processDirectory(vscode.Uri.file(objectsRootPath), objectInfoWrapper);

      expect(Object.keys(objectInfoWrapper.ObjectToObjectInfoMap)).toContain('Example__c');

    });

    // WITHOUT A FIELDS DIRECTORY THERE IS NOTHING TO PRUNE AGAINST, SO THE WALK MUST STILL DESCEND
    test('given a directory with no fields child, every child directory is still walked', async () => {

      const nestedRootPath = '/fake/nested';

      const mockReadDirectory = jest.fn().mockImplementation((directoryUri: any) => {

        if ( directoryUri.fsPath === nestedRootPath ) {
          return Promise.resolve([
            ['firstChild', vscode.FileType.Directory],
            ['secondChild', vscode.FileType.Directory]
          ]);
        }

        return Promise.resolve([]);

      });

      jest.spyOn(vscode.workspace.fs, 'readDirectory').mockImplementation(mockReadDirectory);
      jest.spyOn(vscode.window, 'showWarningMessage').mockImplementation();

      await directoryProcessor.processDirectory(vscode.Uri.file(nestedRootPath), new ObjectInfoWrapper());

      const readDirectoryPaths = mockReadDirectory.mock.calls.map(([directoryUri]: any) => directoryUri.fsPath);

      expect(readDirectoryPaths).toContain(`${nestedRootPath}/firstChild`);
      expect(readDirectoryPaths).toContain(`${nestedRootPath}/secondChild`);

    });

  });

  describe('buildFieldInfoByXMLContent', () => {                  

    test('given mocked text xml content, returns expected field info object', async() => {

      const textXMLContent = XMLMarkupMockService.getTextFieldTypeXMLMarkup();
      const fakeObjectApiName = 'Demming';
      const recordTypeNameByRecordTypeNameToXMLMarkup = {};
      const fakeFieldApiName = 'fakeField';
      let actualFieldInfo = await directoryProcessor.buildFieldInfoByXMLContent(textXMLContent, fakeObjectApiName, recordTypeNameByRecordTypeNameToXMLMarkup, fakeFieldApiName);

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


