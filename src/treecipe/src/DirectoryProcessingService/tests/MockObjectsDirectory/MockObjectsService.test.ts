import * as fs from 'fs';
import { MockDirectoryService } from './MockDirectoryService';

jest.mock('vscode', () => ({
    
  window: {
      showErrorMessage: jest.fn().mockResolvedValue((message, ...buttons) => {
          return Promise.resolve(buttons);
      }),
  },
  env: {
      openExternal: jest.fn(),
  },
  Uri: {
      parse: jest.fn((url) => ({ url })),
  },
  commands: {
      executeCommand: jest.fn(),
  },
}), { virtual: true });


describe('Confirm Mock Structure Consistent', () => {

    test('given expected directory of mock objects, returns expected folder structure', async() => {
    
      let mockObjectsDirectoryPath = 'src/treecipe/src/DirectoryProcessingService/tests/MockObjectsDirectory/objects';   
  
      let expectedJSONMockDirectoriesStructure = MockDirectoryService.getExpectedMockDirectoryStructure();

      let actualMockDirectoriesStructure = fs.readdirSync(mockObjectsDirectoryPath, {
        withFileTypes: true,
        recursive: false
      });

      const actualJSONMockDirectoriesStructure = JSON.stringify(actualMockDirectoriesStructure, ["name", "parentPath", "path"], 2);
      expect(expectedJSONMockDirectoriesStructure).toEqual(actualJSONMockDirectoriesStructure);
    
    });
  
});


