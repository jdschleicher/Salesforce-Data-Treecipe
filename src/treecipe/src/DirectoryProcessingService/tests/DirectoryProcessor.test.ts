import { ConfigurationService } from "../../ConfigurationService/ConfigurationService";
import { DirectoryProcessor } from "../DirectoryProcessor";

jest.mock('vscode', () => ({
  workspace: {
      workspaceFolders: undefined
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
    
    describe('given expected didddrectory of mock objects, returns expected folder structure', () => {
  
      test('given expected directory path segments, returns expected api name at end of path', () => {

        jest.spyOn(ConfigurationService, 'getExtensionConfigValue').mockReturnValue('snowfakery');
        
        const expectedObjectApiName = 'objectApiName';
        let mockObjectsDirectoryPath = `src/treecipe/src/DirectoryProcessingService/tests/MockObjectsDirectory/objects/${expectedObjectApiName}`;   
        
        let directoryProcessor = new DirectoryProcessor();
        let actualLastPathSegmentValue = directoryProcessor.getLastSegmentFromPath(mockObjectsDirectoryPath);
        
        expect(actualLastPathSegmentValue).toEqual(expectedObjectApiName);
      
      });
    
    });
  
});

