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

            const cleGlobalValueSetXMLContent = XMLMarkupMockService.getCLEGlobalValueSetXMLMarkup();
            const planetsGlobalValueSetXMLContent = XMLMarkupMockService.getPlanetsGlobalValueSetXMLFileContent();

            const expectedGlobalValueSetFileNameToPicklistValuesSetMap = {
                'CLEGlobal.globalValueSet-meta.xml': Promise.resolve(
                    cleGlobalValueSetXMLContent
                ),
                'Planets.globalValueSet-meta.xml': Promise.resolve(
                    planetsGlobalValueSetXMLContent
                )
            };
     
            const globalValueSetSingleton = GlobalValueSetSingleton.getInstance();

            jest.spyOn(globalValueSetSingleton, 'getGlobalValueSetPicklistXMLFileContent')
                .mockImplementation(async (globalValueSetURI, globalValueSetFileName) => {
            
                return expectedGlobalValueSetFileNameToPicklistValuesSetMap[globalValueSetFileName] || Promise.resolve(null);
            });

            const uri = vscode.Uri.file('./src/treecipe/src/DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory');
            await globalValueSetSingleton.initialize(uri.fsPath);

            const picklistApiNameToValues = globalValueSetSingleton.getPicklistValueMaps();
            expect(Object.keys(picklistApiNameToValues).length).toBe(2);

            const extraUpdatedCLEGlobalValueSetXMLContent = XMLMarkupMockService.getOneEXTRACLEGlobalValueSetXMLMarkup();
            const updatedExpectedGlobalValueSetFileNameToPicklistValuesSetMap = {
                'CLEGlobal.globalValueSet-meta.xml': Promise.resolve(
                    cleGlobalValueSetXMLContent
                ),
                'Planets.globalValueSet-meta.xml': Promise.resolve(
                    planetsGlobalValueSetXMLContent
                ),
                'ExtraUpdatedCaptainsCLEGlobal.globalValueSet-meta.xml': Promise.resolve(
                    extraUpdatedCLEGlobalValueSetXMLContent
                )
            };

            jest.spyOn(globalValueSetSingleton, 'getGlobalValueSetPicklistXMLFileContent')
                .mockImplementation(async (globalValueSetURI, globalValueSetFileName) => {
            
                return updatedExpectedGlobalValueSetFileNameToPicklistValuesSetMap[globalValueSetFileName] || Promise.resolve(null);
            });

            await globalValueSetSingleton.initialize(uri.fsPath);

            const updatedPicklistApiNameToValues = globalValueSetSingleton.getPicklistValueMaps();
            expect(Object.keys(updatedPicklistApiNameToValues).length).toBe(3);

        });

    });

    describe("extractGlobalValueSetPicklistValuesFromXMLFileContent", () => {

        test("given expected globalValueSet xml content, returns expected list of picklist values", () => {
            
            const mockedParseCLEGlobalValueSet = XMLMarkupMockService.getParseStringCLEGlobalValueSetMock();
            const globalValueSetSingleton = GlobalValueSetSingleton.getInstance();

            const picklistValues:string[] = globalValueSetSingleton.extractGlobalValueSetPicklistValuesFromXMLFileContent(mockedParseCLEGlobalValueSet);

            const expectedPicklistValues = ["guardians", "cavs", "browns", "monsters", "crunch"];
            expect(picklistValues.length).toBe(expectedPicklistValues.length);
            expect(picklistValues).toEqual(expectedPicklistValues);

        });

    });
    
});
