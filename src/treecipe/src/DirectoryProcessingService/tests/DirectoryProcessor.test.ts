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


describe('Shared DirectoryProcessor Testign Context', () => {

  describe('getLastSegmentFromPath', () => {

    test('given expected directory path segments, returns expected api name at end of path', () => {

      jest.spyOn(ConfigurationService, 'getExtensionConfigValue').mockReturnValue('snowfakery');
      
      const expectedObjectApiName = 'objectApiName';
      let mockObjectsDirectoryPath = `src/treecipe/src/DirectoryProcessingService/tests/MockObjectsDirectory/objects/${expectedObjectApiName}`;   
      
      let directoryProcessor = new DirectoryProcessor();
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
      jest.spyOn(ConfigurationService, 'getFakerImplementationByExtensionConfigSelection').mockImplementation(() => new SnowfakeryFakerService());

      let directoryProcessor = new DirectoryProcessor();
      let objectInfoWrapper = new ObjectInfoWrapper();
      const uri = vscode.Uri.file('/fake/path');

      const result = await directoryProcessor.processDirectory(uri, objectInfoWrapper);
    
      expect(result).toEqual(objectInfoWrapper);  // the objectInfoWrapper for this test should be nothing but initialized
      expect(mockReadDirectory).toHaveBeenCalledWith(uri); 
      expect(mockReadDirectory).toHaveBeenCalledTimes(10); 

    });

  });

  describe('buildFieldInfoByXMLContent', () => {                  

    test('given mocked field picklist xml content, returns expected field info object', async() => {

      jest.spyOn(ConfigurationService, 'getFakerImplementationByExtensionConfigSelection').mockImplementation(() => new SnowfakeryFakerService());
      let directoryProcessor = new DirectoryProcessor();

      const picklistXmlContent = XMLMarkupMockService.getPicklistFieldTypeXMLMarkup();
      const fakeObjectApiName = 'Demming';
      let actualFieldInfo = await directoryProcessor.buildFieldInfoByXMLContent(picklistXmlContent, fakeObjectApiName);

      const expectedFieldInfo = XMLMarkupMockService.getPicklistXMLFieldDetail();
      expectedFieldInfo.apiName = fakeObjectApiName;
      const expectedRecipeInfo = "${{ random_choice('cle','eastlake','madison','mentor','wickliffe','willoughby') }}";
    
      expect(actualFieldInfo).toEqual(expectedFieldInfo);
    
    });

  
  });


  
});

