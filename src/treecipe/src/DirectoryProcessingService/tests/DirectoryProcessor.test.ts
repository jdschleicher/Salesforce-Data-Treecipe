import { ConfigurationService } from "../../ConfigurationService/ConfigurationService";
import { DirectoryProcessor } from "../DirectoryProcessor";

import * as vscode from 'vscode';
import { MockDirectoryService } from "./MockObjectsDirectory/MockDirectoryService";
import { ObjectInfoWrapper } from "../../ObjectInfoWrapper/ObjectInfoWrapper";
import { SnowfakeryFakerService } from "../../FakerService/SnowfakeryFakerService/SnowfakeryFakerService";


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

    test('should read directory contents', async () => {

      const jsonMockedDirectoryStructure = MockDirectoryService.getVSCodeFileTypeMockedDirectories();
      const emptyDirectory = [
        [ 'empty', vscode.FileType.File ]
      ];

      const mockReadDirectory = jest.fn()
                                  .mockResolvedValueOnce(jsonMockedDirectoryStructure) // First call returns directories
                                  .mockResolvedValueOnce(emptyDirectory); // Second call returns empty, simulating base case
    
  
      jest.spyOn(vscode.workspace.fs, 'readDirectory').mockImplementation(mockReadDirectory);
      jest.spyOn(vscode.window, 'showWarningMessage').mockImplementation();
      jest.spyOn(ConfigurationService, 'getFakerImplementationByExtensionConfigSelection').mockImplementation(() => new SnowfakeryFakerService());

      let directoryProcessor = new DirectoryProcessor();
      let objectInfoWrapper = new ObjectInfoWrapper();
      const uri = vscode.Uri.file('/fake/path');


      const result = await directoryProcessor.processDirectory(uri, objectInfoWrapper);
      
      expect(result).toEqual(objectInfoWrapper); // Expected result matches mock
      expect(mockReadDirectory).toHaveBeenCalledWith(uri); 
      expect(mockReadDirectory).toHaveBeenCalledTimes(10); 

    });
    
  });


  
});

