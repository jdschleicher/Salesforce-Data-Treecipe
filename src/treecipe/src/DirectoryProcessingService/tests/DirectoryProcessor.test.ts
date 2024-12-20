import { ConfigurationService } from "../../ConfigurationService/ConfigurationService";
import { DirectoryProcessor } from "../DirectoryProcessor";

import * as vscode from 'vscode';
import { MockDirectoryService } from "./MockObjectsDirectory/MockDirectoryService";


jest.mock('vscode', () => ({
  workspace: {
      workspaceFolders: undefined,
      fs: { 
          readDirectory: jest.fn()
      }
  },
  Uri: {
      file: (path: string) => ({ fsPath: path })
  },
  window: {
      showErrorMessage: jest.fn(),
      showQuickPick: jest.fn()
  },
  ThemeIcon: jest.fn().mockImplementation(
      (name) => ({ id: name })
  )

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

      const mockReadDirectory = jest.fn();

      beforeEach(() => {
        // Clear mock before each test
        mockReadDirectory.mockReset();
      });

      it('should read directory contents', async () => {
        const mockFiles = [
          ['file1.txt', 1],  // FileType.File
          ['folder1', 2],    // FileType.Directory
          ['link1', 64]      // FileType.SymbolicLink
        ];
        mockReadDirectory.mockResolvedValue(mockFiles);
    
        // Example usage:
        const uri = vscode.Uri.file('/test/path');

        jest.spyOn(vscode.workspace.fs, 'readDirectory').mockImplementation(mockReadDirectory);

        const result = await vscode.workspace.fs.readDirectory(uri);
        
        expect(result).toEqual(mockFiles);
        expect(mockReadDirectory).toHaveBeenCalledWith(uri);
      });
      
  });


  
});

