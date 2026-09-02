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
  },
  window: {
      showWarningMessage: jest.fn()
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
            const mimicIsCalledFromExtensionCommandOfGenerateRecipe = true;
            await globalValueSetSingleton.initialize(uri.fsPath, mimicIsCalledFromExtensionCommandOfGenerateRecipe);

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

            const jsonUpdatedMockedSalesforceMetadataDirectoryStructure = MockDirectoryService.getVSCodeFileTypeUpdatedMockedGlobalValueSetFiles();
            const updatedMockReadDirectory = jest.fn().mockResolvedValueOnce(jsonUpdatedMockedSalesforceMetadataDirectoryStructure);
            jest.spyOn(vscode.workspace.fs, 'readDirectory').mockImplementation(updatedMockReadDirectory);


            await globalValueSetSingleton.initialize(uri.fsPath, mimicIsCalledFromExtensionCommandOfGenerateRecipe);

            const updatedPicklistApiNameToValues = globalValueSetSingleton.getPicklistValueMaps();

            expect(Object.keys(updatedPicklistApiNameToValues).length).toBe(3);

        });

    });

    describe("a missing globalValueSets directory", () => {

        test("given a caller that does not want the notice, clears the sets without warning the user", async () => {

            jest.spyOn(fs, 'existsSync').mockReturnValue(false);
            const showWarningMessageSpy = jest.spyOn(vscode.window, 'showWarningMessage');

            const globalValueSetSingleton = GlobalValueSetSingleton.getInstance();

            const mimicIsCalledFromExtensionCommand = true;
            const isMissingDirectoryWarningShown = false;
            await globalValueSetSingleton.initialize('./no/global/value/sets', mimicIsCalledFromExtensionCommand, isMissingDirectoryWarningShown);

            expect(globalValueSetSingleton.getPicklistValueMaps()).toBeNull();
            expect(showWarningMessageSpy).not.toHaveBeenCalled();

        });

        test("given a caller that does want the notice, warns and names the directory it looked in", async () => {

            jest.spyOn(fs, 'existsSync').mockReturnValue(false);
            const showWarningMessageSpy = jest.spyOn(vscode.window, 'showWarningMessage');

            const mimicIsCalledFromExtensionCommand = true;
            await GlobalValueSetSingleton.getInstance().initialize('./no/global/value/sets', mimicIsCalledFromExtensionCommand);

            expect(showWarningMessageSpy).toHaveBeenCalledWith('No GlobalValueSets found in directory: ./no/global/value/sets/globalValueSets/');

        });

    });

    /*
        Reading the sets is supplementary to every command that does it, so a failure here must cost
        the sets and nothing else. Awaited from a command body, an unguarded throw would abort the
        whole run over metadata a field-level skip warning already explains.
    */
    describe("a globalValueSets directory that cannot be read", () => {

        test("given a directory listing that throws, leaves the sets empty rather than throwing at the caller", async () => {

            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(vscode.workspace.fs, 'readDirectory').mockRejectedValue(new Error('EACCES'));

            const globalValueSetSingleton = GlobalValueSetSingleton.getInstance();

            await expect(globalValueSetSingleton.initialize('./unreadable', true)).resolves.toBeUndefined();
            expect(globalValueSetSingleton.getPicklistValueMaps()).toBeNull();

        });

        test("given one malformed set file, keeps every other set rather than losing them all", async () => {

            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(vscode.workspace.fs, 'readDirectory').mockResolvedValue([
                ['Broken.globalValueSet-meta.xml', vscode.FileType.File],
                ['Planets.globalValueSet-meta.xml', vscode.FileType.File]
            ] as any);

            const globalValueSetSingleton = GlobalValueSetSingleton.getInstance();

            jest.spyOn(globalValueSetSingleton, 'getGlobalValueSetPicklistXMLFileContent')
                .mockImplementation(async (uri, fileName) => {
                    if ( fileName === 'Broken.globalValueSet-meta.xml' ) {
                        return '<GlobalValueSet><customValue><notFullName>x</notFullName></customValue></GlobalValueSet>';
                    }
                    return XMLMarkupMockService.getPlanetsGlobalValueSetXMLFileContent();
                });

            await globalValueSetSingleton.initialize('./partly-broken', true);

            const picklistValuesByGlobalValueSetName = globalValueSetSingleton.getPicklistValueMaps();
            expect(picklistValuesByGlobalValueSetName['Planets']).toBeTruthy();

        });

        test("given a set file with no customValue children, skips it without throwing", async () => {

            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(vscode.workspace.fs, 'readDirectory')
                .mockResolvedValue([['Empty.globalValueSet-meta.xml', vscode.FileType.File]] as any);

            const globalValueSetSingleton = GlobalValueSetSingleton.getInstance();

            jest.spyOn(globalValueSetSingleton, 'getGlobalValueSetPicklistXMLFileContent')
                .mockResolvedValue('<?xml version="1.0" encoding="UTF-8"?><GlobalValueSet><masterLabel>Empty</masterLabel></GlobalValueSet>');

            await expect(globalValueSetSingleton.initialize('./empty-set', true)).resolves.toBeUndefined();

        });

    });

    /*
        An INACTIVE value cannot be selected in any org. Left in the universe it becomes an
        expectNone line for a controlling value the org's describe never returns, which the validator
        reports as UNKNOWN_CONTROLLING_VALUE -- a generated spec that must fail against correct
        metadata.
    */
    describe("inactive global value set values", () => {

        test("given an inactive customValue, leaves it out of the set's usable values", async () => {

            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(vscode.workspace.fs, 'readDirectory')
                .mockResolvedValue([['Territories.globalValueSet-meta.xml', vscode.FileType.File]] as any);

            const globalValueSetSingleton = GlobalValueSetSingleton.getInstance();

            jest.spyOn(globalValueSetSingleton, 'getGlobalValueSetPicklistXMLFileContent')
                .mockResolvedValue(`<?xml version="1.0" encoding="UTF-8"?>
<GlobalValueSet xmlns="http://soap.sforce.com/2006/04/metadata">
    <customValue>
        <fullName>Still_Active</fullName>
        <isActive>true</isActive>
        <label>Still Active</label>
    </customValue>
    <customValue>
        <fullName>Retired</fullName>
        <isActive>false</isActive>
        <label>Retired</label>
    </customValue>
    <customValue>
        <fullName>No_Markup_Means_Active</fullName>
        <label>No Markup Means Active</label>
    </customValue>
    <masterLabel>Territories</masterLabel>
</GlobalValueSet>`);

            await globalValueSetSingleton.initialize('./territories', true);

            expect(globalValueSetSingleton.getPicklistValueMaps()['Territories'])
                .toEqual(['Still_Active', 'No_Markup_Means_Active']);

        });

    });

    /*
        Both names are registered, so two sets collide when one's masterLabel equals another's file
        name. Last-write-wins would hand a field the WRONG value universe with directory order
        deciding which -- a silent wrong answer rather than a visible failure.
    */
    describe("a masterLabel that collides with another set's full name", () => {

        test("given a collision, the set that owns the name as its full name wins", async () => {

            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(vscode.workspace.fs, 'readDirectory').mockResolvedValue([
                ['Zone_Values.globalValueSet-meta.xml', vscode.FileType.File],
                ['Other_Set.globalValueSet-meta.xml', vscode.FileType.File]
            ] as any);

            const globalValueSetSingleton = GlobalValueSetSingleton.getInstance();

            jest.spyOn(globalValueSetSingleton, 'getGlobalValueSetPicklistXMLFileContent')
                .mockImplementation(async (uri, fileName) => {
                    if ( fileName === 'Zone_Values.globalValueSet-meta.xml' ) {
                        return '<?xml version="1.0"?><GlobalValueSet><customValue><fullName>owned</fullName></customValue><masterLabel>Zone Values</masterLabel></GlobalValueSet>';
                    }
                    // THIS SET'S LABEL IS THE OTHER SET'S FULL NAME
                    return '<?xml version="1.0"?><GlobalValueSet><customValue><fullName>impostor</fullName></customValue><masterLabel>Zone_Values</masterLabel></GlobalValueSet>';
                });

            await globalValueSetSingleton.initialize('./colliding', true);

            expect(globalValueSetSingleton.getPicklistValueMaps()['Zone_Values']).toEqual(['owned']);

        });

    });

    describe("getGlobalValueSetFullNameByFileName", () => {

        test("given a source format global value set file name, returns the full name a field references it by", () => {

            expect(GlobalValueSetSingleton.getGlobalValueSetFullNameByFileName('SDT_Territory_Values.globalValueSet-meta.xml'))
                .toBe('SDT_Territory_Values');

        });

        test("given a file name without the source format suffix, falls back to everything before the first dot", () => {

            expect(GlobalValueSetSingleton.getGlobalValueSetFullNameByFileName('CLEGlobal.xml')).toBe('CLEGlobal');

        });

        test("given no file name, returns an empty name rather than throwing", () => {

            expect(GlobalValueSetSingleton.getGlobalValueSetFullNameByFileName(undefined)).toBe('');

        });

    });

    /*
        A field points at a global value set by FULL NAME, which in source format is the file name.
        The only name inside the file is masterLabel, an admin editable display label -- keying by it
        alone left a set whose label had ever been renamed unreachable from the field referencing it.
    */
    describe("addGlobalValueSetUnderEveryNameItIsReferencedBy", () => {

        test("given a global value set whose masterLabel differs from its full name, resolves under both names", async () => {

            const globalValueSetSingleton = GlobalValueSetSingleton.getInstance();

            const renamedGlobalValueSetXMLContent = `<?xml version="1.0" encoding="UTF-8"?>
<GlobalValueSet xmlns="http://soap.sforce.com/2006/04/metadata">
    <customValue>
        <fullName>north</fullName>
        <default>false</default>
        <label>north</label>
    </customValue>
    <masterLabel>Renamed Territory Label</masterLabel>
    <sorted>false</sorted>
</GlobalValueSet>`;

            jest.spyOn(vscode.workspace.fs, 'readDirectory')
                .mockResolvedValue([['SDT_Territory_Values.globalValueSet-meta.xml', vscode.FileType.File]] as any);
            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(globalValueSetSingleton, 'getGlobalValueSetPicklistXMLFileContent')
                .mockResolvedValue(renamedGlobalValueSetXMLContent);

            const mimicIsCalledFromExtensionCommandOfGenerateRecipe = true;
            await globalValueSetSingleton.initialize('./any/metadata/parent', mimicIsCalledFromExtensionCommandOfGenerateRecipe);

            const picklistValuesByGlobalValueSetName = globalValueSetSingleton.getPicklistValueMaps();

            expect(picklistValuesByGlobalValueSetName['SDT_Territory_Values']).toEqual(['north']);
            expect(picklistValuesByGlobalValueSetName['Renamed Territory Label']).toEqual(['north']);

        });

        test("given a global value set file with no masterLabel, still registers it under its full name", async () => {

            const globalValueSetSingleton = GlobalValueSetSingleton.getInstance();

            const noMasterLabelXMLContent = `<?xml version="1.0" encoding="UTF-8"?>
<GlobalValueSet xmlns="http://soap.sforce.com/2006/04/metadata">
    <customValue>
        <fullName>north</fullName>
        <default>false</default>
        <label>north</label>
    </customValue>
    <sorted>false</sorted>
</GlobalValueSet>`;

            jest.spyOn(vscode.workspace.fs, 'readDirectory')
                .mockResolvedValue([['SDT_Territory_Values.globalValueSet-meta.xml', vscode.FileType.File]] as any);
            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(globalValueSetSingleton, 'getGlobalValueSetPicklistXMLFileContent')
                .mockResolvedValue(noMasterLabelXMLContent);

            const mimicIsCalledFromExtensionCommandOfGenerateRecipe = true;
            await globalValueSetSingleton.initialize('./any/metadata/parent', mimicIsCalledFromExtensionCommandOfGenerateRecipe);

            expect(Object.keys(globalValueSetSingleton.getPicklistValueMaps())).toEqual(['SDT_Territory_Values']);

        });

        test("given a global value set whose masterLabel matches its full name, registers it once", async () => {

            const globalValueSetSingleton = GlobalValueSetSingleton.getInstance();

            const cleGlobalValueSetXMLContent = XMLMarkupMockService.getCLEGlobalValueSetXMLMarkup();

            jest.spyOn(vscode.workspace.fs, 'readDirectory')
                .mockResolvedValue([['CLEGlobal.globalValueSet-meta.xml', vscode.FileType.File]] as any);
            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(globalValueSetSingleton, 'getGlobalValueSetPicklistXMLFileContent')
                .mockResolvedValue(cleGlobalValueSetXMLContent);

            const mimicIsCalledFromExtensionCommandOfGenerateRecipe = true;
            await globalValueSetSingleton.initialize('./any/metadata/parent', mimicIsCalledFromExtensionCommandOfGenerateRecipe);

            expect(Object.keys(globalValueSetSingleton.getPicklistValueMaps())).toEqual(['CLEGlobal']);

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
