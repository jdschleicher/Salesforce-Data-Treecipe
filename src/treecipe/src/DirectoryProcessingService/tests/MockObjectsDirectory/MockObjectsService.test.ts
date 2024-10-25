import * as fs from 'fs';

describe('Confirm Mock Structure Consistent', () => {

    it('given expected directory of mock objects, returns expected folder structure', async() => {
    
      let mockObjectsDirectoryPath = 'src/application/services/tests/mocks/MockObjectsDirectory/objects';   
  
      let expectedJSONMockDirectoriesStructure = getExpectedMockDirectoryStructure();

      let actualMockDirectoriesStructure = fs.readdirSync(mockObjectsDirectoryPath, {
        withFileTypes: true,
        recursive: false
      });

      const actualJSONMockDirectoriesStructure = JSON.stringify(actualMockDirectoriesStructure, null, 2);
      expect(expectedJSONMockDirectoriesStructure).toEqual(actualJSONMockDirectoriesStructure);
    
    });
  
});

function getExpectedMockDirectoryStructure() {

  // THE FORMATTING OF THIS EXPECTED DIRECTORIES IS AN EXACT MATCH TO HOW JSON.stringify WILL OUTPUT A DIRECTORY
  // IT MAY BE AN ISSUE IN FUTURE ITERATIONS AND MAY MAKE SENSE TO USE THIS AND PERFORM WHITE SPACE REMOVAL TO FOCUS ON MATCHING 
  // THE CONTENT ONLY
    const expectedMockDirectories = `[
  {
    "name": "Case",
    "parentPath": "src/application/services/tests/mocks/MockObjectsDirectory/objects",
    "path": "src/application/services/tests/mocks/MockObjectsDirectory/objects"
  },
  {
    "name": "Example_Everything__c",
    "parentPath": "src/application/services/tests/mocks/MockObjectsDirectory/objects",
    "path": "src/application/services/tests/mocks/MockObjectsDirectory/objects"
  },
  {
    "name": "Manufacturing_Event__e",
    "parentPath": "src/application/services/tests/mocks/MockObjectsDirectory/objects",
    "path": "src/application/services/tests/mocks/MockObjectsDirectory/objects"
  },
  {
    "name": "MasterDetailMadness__c",
    "parentPath": "src/application/services/tests/mocks/MockObjectsDirectory/objects",
    "path": "src/application/services/tests/mocks/MockObjectsDirectory/objects"
  },
  {
    "name": "MegaMapMadness__c",
    "parentPath": "src/application/services/tests/mocks/MockObjectsDirectory/objects",
    "path": "src/application/services/tests/mocks/MockObjectsDirectory/objects"
  },
  {
    "name": "Order_Item__c",
    "parentPath": "src/application/services/tests/mocks/MockObjectsDirectory/objects",
    "path": "src/application/services/tests/mocks/MockObjectsDirectory/objects"
  },
  {
    "name": "Order__c",
    "parentPath": "src/application/services/tests/mocks/MockObjectsDirectory/objects",
    "path": "src/application/services/tests/mocks/MockObjectsDirectory/objects"
  },
  {
    "name": "Product_Family__c",
    "parentPath": "src/application/services/tests/mocks/MockObjectsDirectory/objects",
    "path": "src/application/services/tests/mocks/MockObjectsDirectory/objects"
  },
  {
    "name": "Product__c",
    "parentPath": "src/application/services/tests/mocks/MockObjectsDirectory/objects",
    "path": "src/application/services/tests/mocks/MockObjectsDirectory/objects"
  }
]`;


  return expectedMockDirectories;

}
