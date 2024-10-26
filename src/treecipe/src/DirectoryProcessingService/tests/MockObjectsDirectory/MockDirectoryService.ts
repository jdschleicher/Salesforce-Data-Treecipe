
export class MockDirectoryService {


    static getExpectedMockDirectoryStructure() {

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

}