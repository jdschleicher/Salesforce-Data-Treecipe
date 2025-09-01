import { MockDirectoryService } from "../../DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory/MockDirectoryService";
import { XMLMarkupMockService } from "../../XMLProcessingService/tests/mocks/XMLMarkupMockService";
import { GlobalValueSetSingleton } from "../GlobalValueSetSingleton";

import * as vscode from 'vscode';
import * as fs from 'fs';

jest.mock('vscode', () => ({
  workspace: {
      workspaceFolders: undefined,
      fs: { 
          readDirectory: jest.fn(),
          readFile: jest.fn()
      }
  },
  Uri: {
      file: (path: string) => ({ fsPath: path }),
      joinPath: jest.fn().mockImplementation((baseUri, ...pathSegments) => ({
        fsPath: `${baseUri.fsPath}/${pathSegments.join('/')}`.replace(/\/+/g, '/'), // Ensure no double slashes
      }))
  },
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

        test("given expected 'globalValueSets' directory with expected globalValueSet markup files, sets expected globalValueSet initialization values and 'isInitialized' property is set to true", async() => {

            const jsonMockedSalesforceMetadataDirectoryStructure = MockDirectoryService.getVSCodeFileTypeMockedGlobalValueSetFiles();
            const mockReadDirectory = jest.fn().mockResolvedValueOnce(jsonMockedSalesforceMetadataDirectoryStructure);
            jest.spyOn(vscode.workspace.fs, 'readDirectory').mockImplementation(mockReadDirectory);
            jest.spyOn(fs, 'existsSync').mockReturnValue(true);

            const expectedValueSetMap = {
                'CLEGlobal': Promise.resolve(
                    ["guardians", "cavs", "browns", "monsters", "crunch"]
                ),
                'Planets': Promise.resolve(
                    ["world", "earth", "planet", "mars", "venus", "neptune", "saturn"]
                )
            };
     
            const globalValueSetSingleton = GlobalValueSetSingleton.getInstance();

            jest.spyOn(globalValueSetSingleton, 'getPicklistValuesFromGlobalValueSetXML')
                .mockImplementation(async (globalValueSetURI, globalValueSetFileName) => {
            
                return expectedValueSetMap[globalValueSetFileName] || Promise.resolve(null);
            });

            const uri = vscode.Uri.file('./src/treecipe/src/DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory');
            await globalValueSetSingleton.initialize(uri.fsPath);

            const picklistApiNameToValues = globalValueSetSingleton.getPicklistValueMaps();
            expect(Object.keys(picklistApiNameToValues).length).toBe(2);
            
        });

    });

    describe("extractGlobalValueSetPicklistValuesFromXMLFileContent", () => {

        test("given expected globalValueSet xml content, returns expected list of picklist values", () => {
            
            const globalValueSetPicklistValuesXMLContent = XMLMarkupMockService.getGlobalValueSetXMLMarkup();
            const globalValueSetSingleton = GlobalValueSetSingleton.getInstance();

            const picklistValules:string[] = globalValueSetSingleton.extractGlobalValueSetPicklistValuesFromXMLFileContent(globalValueSetPicklistValuesXMLContent);

            const expectedPicklistValues = ["guardians", "cavs", "browns", "monsters", "crunch"];
            expect(picklistValules.length).toBe(expectedPicklistValues.length);
            expect(picklistValules).toEqual(expectedPicklistValues);

        });

    });
    
});