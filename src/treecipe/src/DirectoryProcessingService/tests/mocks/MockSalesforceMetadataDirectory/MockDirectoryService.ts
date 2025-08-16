import * as vscode from 'vscode';
import * as fs from 'fs';

export class MockDirectoryService {

  static getExpectedMockSalesforceMetadataTypesDirectory() {
    
    const expectedSalesforceMetadataDirectories = `[
        {
          "name": "objects",
          "parentPath": "src/treecipe/src/DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory/objects",
          "path": "src/treecipe/src/DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory/objects"
        },
        {
          "name": "globalValueSets",
          "parentPath": "src/treecipe/src/DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory/objects",
          "path": "src/treecipe/src/DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory/objects"
        }
    ]`;

    return expectedSalesforceMetadataDirectories;

  }

  static getExpectedMockObjectDirectoryStructure() {

        // THE FORMATTING OF THIS EXPECTED DIRECTORIES IS AN EXACT MATCH TO HOW JSON.stringify WILL OUTPUT A DIRECTORY
        // IT MAY BE AN ISSUE IN FUTURE ITERATIONS AND MAY MAKE SENSE TO USE THIS AND PERFORM WHITE SPACE REMOVAL TO FOCUS ON MATCHING 
        // THE CONTENT ONLY
        const expectedMockDirectories = `[
  {
    "name": "Case",
    "parentPath": "src/treecipe/src/DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory/objects",
    "path": "src/treecipe/src/DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory/objects"
  },
  {
    "name": "Example_Everything__c",
    "parentPath": "src/treecipe/src/DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory/objects",
    "path": "src/treecipe/src/DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory/objects"
  },
  {
    "name": "Manufacturing_Event__e",
    "parentPath": "src/treecipe/src/DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory/objects",
    "path": "src/treecipe/src/DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory/objects"
  },
  {
    "name": "MasterDetailMadness__c",
    "parentPath": "src/treecipe/src/DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory/objects",
    "path": "src/treecipe/src/DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory/objects"
  },
  {
    "name": "MegaMapMadness__c",
    "parentPath": "src/treecipe/src/DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory/objects",
    "path": "src/treecipe/src/DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory/objects"
  },
  {
    "name": "Order_Item__c",
    "parentPath": "src/treecipe/src/DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory/objects",
    "path": "src/treecipe/src/DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory/objects"
  },
  {
    "name": "Order__c",
    "parentPath": "src/treecipe/src/DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory/objects",
    "path": "src/treecipe/src/DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory/objects"
  },
  {
    "name": "Product_Family__c",
    "parentPath": "src/treecipe/src/DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory/objects",
    "path": "src/treecipe/src/DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory/objects"
  },
  {
    "name": "Product__c",
    "parentPath": "src/treecipe/src/DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory/objects",
    "path": "src/treecipe/src/DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory/objects"
  }
]`;
      
    return expectedMockDirectories;
    
  }

  static getVSCodeFileTypeMockedDirectories() {

      const rawData = JSON.parse(this.getExpectedMockObjectDirectoryStructure());
      const mockFileDirectories = rawData.map(entry => [
          entry.name,
          vscode.FileType.Directory
      ]);
      return mockFileDirectories;
  }
  
  static getMockedReadDirectorWithExpectedFoldersAndInvalidXMLFileExtensions() {
    
    const mockedFiles: [string, vscode.FileType][] = [
      ["Checkbox__c.field-meta.xml", vscode.FileType.File],
      ["Currency__c.field-meta.xml", vscode.FileType.File],
      ["DateTime__c.field-meta.xml", vscode.FileType.File],
      ["Date__c.field-meta.xml", vscode.FileType.File],
      ["DependentPicklist__c.field-meta.xml", vscode.FileType.File],
      ["Email__c.field-meta.xml", vscode.FileType.File],
      ["Example_Everything_Lookup__c.field-meta.xml", vscode.FileType.File],
      ["Formula__c.field-meta.xml", vscode.FileType.File],
      ["Geolocation__c.field-meta.xml", vscode.FileType.File],
      ["MultiPicklist__c.field-meta.xml", vscode.FileType.File],
      ["Number__c.field-meta.xml", vscode.FileType.File],
      ["Percent__c.field-meta.xml", vscode.FileType.File],
      ["Phone__c.field-meta.xml", vscode.FileType.File],
      ["Picklist__c.field-meta.xml", vscode.FileType.File],
      ["TextAreaRich__c.field-meta.xml", vscode.FileType.File],
      ["Text_Area_Long__c.field-meta.xml", vscode.FileType.File],
      ["Text__c.field-meta.xml", vscode.FileType.File],
      ["Time__c.field-meta.xml", vscode.FileType.File],
      ["Url__c.field-meta.xml", vscode.FileType.File],
      ["Url__c.field-meta.notme", vscode.FileType.File],
      ["NestedFolderIam.field-meta.xml", vscode.FileType.Directory],
      ["README.md", vscode.FileType.File],
    ];
    return mockedFiles;

  }

  static getMockedDirectoriesWithDatSetItemsIncluded() {

    const subStringToIdentifyDirectoryAsDataSetDirectory = 'dataset-';
    const fakeDataSetDirectories: any[] = [
      { 
          name: `${subStringToIdentifyDirectoryAsDataSetDirectory}foldernameone/rest-ofdirectoryname`, 
          isDirectory: () => true,
          path: 'theworkspaceroot/andotherthings'
      }, 
      { 
          name: 'other', // expected to not be in returned quickpick items
          isDirectory: () => true,
          path: 'theworkspaceroot/andotherthings'
      }, 
      { 
          name: `${subStringToIdentifyDirectoryAsDataSetDirectory}abc/anotherone-rest-ofdirectoryname`, 
          isDirectory: () => true,
          path: 'theworkspaceroot/andotherthings'
      },
      { 
        name: `${subStringToIdentifyDirectoryAsDataSetDirectory}-fff-fakerjs/anotherone-rest-ofdirectoryname`, 
        isDirectory: () => true,
        path: 'theworkspaceroot/andotherthings'
      },
      { 
        name: `${subStringToIdentifyDirectoryAsDataSetDirectory}fakerjs-test/anotherone-rest-ofdirectoryname`, 
        isDirectory: () => true,
        path: 'theworkspaceroot/andotherthings'
      },    
      { 
        name: `${subStringToIdentifyDirectoryAsDataSetDirectory}fakerjs-testtwo/anotherone-rest-ofdirectoryname`, 
        isDirectory: () => true,
        path: 'theworkspaceroot/andotherthings'
      } 

    ];  

    return fakeDataSetDirectories as fs.Dirent[];

  }

  static getReaddirMockImplBySetOfMockedDirents(mockedDirents) {

      type DirentOptions = { withFileTypes: true };
      type StringOptions = { withFileTypes?: false };
  
      function readdirMockImpl(path: fs.PathLike, options: DirentOptions): Promise<fs.Dirent[]>;

      function readdirMockImpl(path: fs.PathLike, options?: StringOptions): Promise<string[]>;
      
      function readdirMockImpl(
                      path: fs.PathLike,
                      options?: DirentOptions | StringOptions
                  ): Promise<string[] | fs.Dirent[]> {

          const matching = mockedDirents.filter(dirent => dirent.path === path);

          if (options?.withFileTypes) {
              return Promise.resolve(matching); // ✅ Dirent[]
          } else {
              return Promise.resolve(matching.map(d => d.name)); // ✅ string[]
          }
          
      }

      return readdirMockImpl;

  };

  static createMockedDirent(
      name: string,
      path: string,
      type: 'file' | 'dir'
    ): fs.Dirent {
      
    return Object.assign(new fs.Dirent(), {
      name: name,
      isFile: () => type === 'file',
      isDirectory: () => type === 'dir',
      path: path,
    });
      
  }

}