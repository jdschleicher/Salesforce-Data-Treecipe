import { MockDirectoryService } from "../../DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory/MockDirectoryService";
import { GlobalValueSetSingleton } from "../GlobalValueSetSingleton";

import * as vscode from 'vscode';


jest.mock('vscode', () => ({
//   workspace: {
//       workspaceFolders: undefined,
//       fs: { 
//           readDirectory: jest.fn(),
//           readFile: jest.fn()
//       }
//   },
//   Uri: {
//       file: (path: string) => ({ fsPath: path }),
//       joinPath: jest.fn().mockImplementation((baseUri, ...pathSegments) => ({
//         fsPath: `${baseUri.fsPath}/${pathSegments.join('/')}`.replace(/\/+/g, '/'), // Ensure no double slashes
//       }))
//   },
//   window: {
//       showWarningMessage: jest.fn(),
//       showQuickPick: jest.fn()
//   },
//   ThemeIcon: jest.fn().mockImplementation(
//       (name) => ({ id: name })
//   ),
  FileType: {
      Directory: 2,
      File: 1,
      SymbolicLink: 64
  }

}), { virtual: true });

describe("Shared GlobalValueSetSingletonService Tests", () => {

    describe("initialize", () => {

        test("given expected 'globalValueSets' directory with expected globalValueSet markup files, sets expected globalValueSet initialization values and 'isInitialized' property is set to true", () => {


            const jsonMockedSalesforceMetadataDirectoryStructure = MockDirectoryService.getVSCodeFileTypeMockedSalesforceMetadataTypeDirectories();
            const mockReadDirectory = jest.fn().mockResolvedValueOnce(jsonMockedSalesforceMetadataDirectoryStructure);
        
           
            const gvsSingleton = GlobalValueSetSingleton.getInstance();
            gvsSingleton.initialize();

            const picklistApiNameToValues = gvsSingleton.getPicklistValueMaps();
            expect(picklistApiNameToValues.length).toBe(2);
            
        });

    });

    // describe("getInstance", () => {

    //     test("given getInstance is called, expected instance of GlobalValueSetSingleton is set", () => {

    //         let globalValueSetSingleton = GlobalValueSetSingleton.getInstance();
    //         expect(globalValueSetSingleton).toBeInstanceOf(GlobalValueSetSingleton);
        
    //     });

    // });
    
});