import * as fs from 'fs';
import { MockDirectoryService } from './MockDirectoryService';

describe('Confirm Mock Structure Consistent', () => {

    it('given expected directory of mock objects, returns expected folder structure', async() => {
    
      let mockObjectsDirectoryPath = 'src/treecipe/src/DirectoryProcessingService/tests/MockObjectsDirectory/objects';   
  
      let expectedJSONMockDirectoriesStructure = MockDirectoryService.getExpectedMockDirectoryStructure();

      let actualMockDirectoriesStructure = fs.readdirSync(mockObjectsDirectoryPath, {
        withFileTypes: true,
        recursive: false
      });

      const actualJSONMockDirectoriesStructure = JSON.stringify(actualMockDirectoriesStructure, null, 2);
      expect(expectedJSONMockDirectoriesStructure).toEqual(actualJSONMockDirectoriesStructure);
    
    });
  
});


