import { ConfigurationService } from "../../ConfigurationService/ConfigurationService";
import { DirectoryProcessor } from "../DirectoryProcessor";

import * as vscode from 'vscode';
import { MockDirectoryService } from "./mocks/MockSalesforceMetadataDirectory/MockDirectoryService";
import { ObjectInfoWrapper } from "../../ObjectInfoWrapper/ObjectInfoWrapper";
import { SnowfakeryRecipeFakerService } from "../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService";
import { FakerJSRecipeFakerService } from "../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService";
import { RecipeService } from "../../RecipeService/RecipeService";
import * as yaml from 'js-yaml';
import { XMLMarkupMockService } from "../../XMLProcessingService/tests/mocks/XMLMarkupMockService";
import { MockVSCodeWorkspaceService } from "../../VSCodeWorkspace/tests/mocks/MockVSCodeWorkspaceService";
import { RecordTypeService } from "../../RecordTypeService/RecordTypeService";
import { FieldInfo } from "../../ObjectInfoWrapper/FieldInfo";


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
  window: {
      showWarningMessage: jest.fn(),
      showQuickPick: jest.fn()
  },
  ThemeIcon: jest.fn().mockImplementation(
      (name) => ({ id: name })
  ),
  FileType: {
      Directory: 2,
      File: 1,
      SymbolicLink: 64
  }

}), { virtual: true });

describe('Shared DirectoryProcessor Snowfakery FakerService Implementation Testign Context', () => {


  let directoryProcessor: DirectoryProcessor;
  
  beforeEach(() => {
  
    jest.spyOn(ConfigurationService, 'getFakerImplementationByExtensionConfigSelection')
      .mockImplementation(() => new SnowfakeryRecipeFakerService());
  
    directoryProcessor = new DirectoryProcessor();
  
  });

  describe('getLastSegmentFromPath', () => {

    test('given expected directory path segments, returns expected api name at end of path', () => {
      
      const expectedObjectApiName = 'objectApiName';
      let mockObjectsDirectoryPath = `src/treecipe/src/DirectoryProcessingService/tests/MockSalesforceMetadataDirectory/objects/${expectedObjectApiName}`;   
      
      let actualLastPathSegmentValue = directoryProcessor.getLastSegmentFromPath(mockObjectsDirectoryPath);
      
      expect(actualLastPathSegmentValue).toEqual(expectedObjectApiName);
    
    });
  
  });

  describe('processDirectory', () => {

    test('given mocked directory structure with expected count of 10 fake paths, recursive function gets called 10 times', async () => {

      const jsonMockedDirectoryStructure = MockDirectoryService.getVSCodeFileTypeMockedObjectDirectories();

      const mockReadDirectory = jest.fn().mockResolvedValueOnce(jsonMockedDirectoryStructure);
  
      jest.spyOn(vscode.workspace.fs, 'readDirectory').mockImplementation(mockReadDirectory);
      jest.spyOn(vscode.window, 'showWarningMessage').mockImplementation();

      let objectInfoWrapper = new ObjectInfoWrapper();
      const uri = vscode.Uri.file('/fake/path');

      const result = await directoryProcessor.processDirectory(uri, objectInfoWrapper);
    
      expect(result).toEqual(objectInfoWrapper);  // the objectInfoWrapper for this test should be nothing but initialized
      expect(mockReadDirectory).toHaveBeenCalledWith(uri); 
      expect(mockReadDirectory).toHaveBeenCalledTimes(10); 

    });

  });

  describe('object child directory pruning', () => {

    /*
        Once a directory is known to contain "fields" it is an object directory, and its other
        children cannot contribute anything downstream. This prunes them -- which changes recipe
        generation for every user, so the behaviour is pinned here rather than argued in a comment.
    */

    const objectsRootPath = '/fake/objects';
    const objectDirectoryPath = `${objectsRootPath}/Example__c`;

    function mockObjectDirectoryWithSiblingsOfFields() {

      return jest.fn().mockImplementation((directoryUri: any) => {

        switch ( directoryUri.fsPath ) {

          case objectsRootPath:
            return Promise.resolve([['Example__c', vscode.FileType.Directory]]);

          case objectDirectoryPath:
            return Promise.resolve([
              ['fields', vscode.FileType.Directory],
              ['listViews', vscode.FileType.Directory],
              ['recordTypes', vscode.FileType.Directory],
              ['compactLayouts', vscode.FileType.Directory],
              ['Example__c.object-meta.xml', vscode.FileType.File]
            ]);

          default:
            return Promise.resolve([]);

        }

      });

    }

    beforeEach(() => {
      jest.spyOn(vscode.window, 'showWarningMessage').mockImplementation();
      jest.spyOn(RecordTypeService, 'getRecordTypeToApiFieldToRecordTypeWrapper').mockResolvedValue({} as any);
    });

    test('given an object directory containing fields, sibling child directories are never read', async () => {

      const mockReadDirectory = mockObjectDirectoryWithSiblingsOfFields();
      jest.spyOn(vscode.workspace.fs, 'readDirectory').mockImplementation(mockReadDirectory);

      await directoryProcessor.processDirectory(vscode.Uri.file(objectsRootPath), new ObjectInfoWrapper());

      const readDirectoryPaths = mockReadDirectory.mock.calls.map(([directoryUri]: any) => directoryUri.fsPath);

      expect(readDirectoryPaths).toContain(`${objectDirectoryPath}/fields`);
      expect(readDirectoryPaths).not.toContain(`${objectDirectoryPath}/listViews`);
      expect(readDirectoryPaths).not.toContain(`${objectDirectoryPath}/compactLayouts`);

    });

    /*
        The pruning is only safe because RecordTypeService reaches record types from the FIELDS path
        rather than relying on the walk to find the recordTypes directory. If that ever stops being
        true, pruning silently drops record type driven picklist values from every recipe.
    */
    test('given record types are pruned from the walk, they are still resolved from the fields path', async () => {

      const mockReadDirectory = mockObjectDirectoryWithSiblingsOfFields();
      jest.spyOn(vscode.workspace.fs, 'readDirectory').mockImplementation(mockReadDirectory);

      const recordTypeLookupSpy = jest.spyOn(RecordTypeService, 'getRecordTypeToApiFieldToRecordTypeWrapper')
        .mockResolvedValue({} as any);

      await directoryProcessor.processDirectory(vscode.Uri.file(objectsRootPath), new ObjectInfoWrapper());

      const readDirectoryPaths = mockReadDirectory.mock.calls.map(([directoryUri]: any) => directoryUri.fsPath);

      expect(readDirectoryPaths).not.toContain(`${objectDirectoryPath}/recordTypes`);
      expect(recordTypeLookupSpy).toHaveBeenCalledTimes(1);

    });

    test('given the object is registered, the pruned walk still names it from the parent directory', async () => {

      jest.spyOn(vscode.workspace.fs, 'readDirectory').mockImplementation(mockObjectDirectoryWithSiblingsOfFields());

      const objectInfoWrapper = new ObjectInfoWrapper();
      await directoryProcessor.processDirectory(vscode.Uri.file(objectsRootPath), objectInfoWrapper);

      expect(Object.keys(objectInfoWrapper.ObjectToObjectInfoMap)).toContain('Example__c');

    });

    // WITHOUT A FIELDS DIRECTORY THERE IS NOTHING TO PRUNE AGAINST, SO THE WALK MUST STILL DESCEND
    test('given a directory with no fields child, every child directory is still walked', async () => {

      const nestedRootPath = '/fake/nested';

      const mockReadDirectory = jest.fn().mockImplementation((directoryUri: any) => {

        if ( directoryUri.fsPath === nestedRootPath ) {
          return Promise.resolve([
            ['firstChild', vscode.FileType.Directory],
            ['secondChild', vscode.FileType.Directory]
          ]);
        }

        return Promise.resolve([]);

      });

      jest.spyOn(vscode.workspace.fs, 'readDirectory').mockImplementation(mockReadDirectory);
      jest.spyOn(vscode.window, 'showWarningMessage').mockImplementation();

      await directoryProcessor.processDirectory(vscode.Uri.file(nestedRootPath), new ObjectInfoWrapper());

      const readDirectoryPaths = mockReadDirectory.mock.calls.map(([directoryUri]: any) => directoryUri.fsPath);

      expect(readDirectoryPaths).toContain(`${nestedRootPath}/firstChild`);
      expect(readDirectoryPaths).toContain(`${nestedRootPath}/secondChild`);

    });

  });

  describe('buildFieldInfoByXMLContent', () => {                  

    test('given mocked text xml content, returns expected field info object', async() => {

      const textXMLContent = XMLMarkupMockService.getTextFieldTypeXMLMarkup();
      const fakeObjectApiName = 'Demming';
      const recordTypeNameByRecordTypeNameToXMLMarkup = {};
      const fakeFieldApiName = 'fakeField';
      let actualFieldInfo = await directoryProcessor.buildFieldInfoByXMLContent(textXMLContent, fakeObjectApiName, recordTypeNameByRecordTypeNameToXMLMarkup, fakeFieldApiName);

      const expectedFieldInfo = XMLMarkupMockService.getTextXMLFieldDetail();
    
      // ENSURE LABEL AND FIELD API NAME ARE AS EXPECTED, OTHER VALIDATION FUNCTIONALITY HANDLES RECIPE VALUE ASSIGNMENTS
      expect(actualFieldInfo.fieldLabel).toEqual(expectedFieldInfo.fieldLabel); 
      expect(actualFieldInfo.fieldName).toEqual(expectedFieldInfo.apiName);

    });

  });

  describe('processFieldsDirectory', () => {

      test('given expected mock to return non-xml files, nested directories enum types, and xml files, expected count of fieldInfo returned', async () => {

        // THIS TEST COMPLETELY MOCKS OUT XML MARKUP TO FOCUS ON FIELD RESULTS 
        const mockedDirectory = MockDirectoryService.getMockedReadDirectorWithExpectedFoldersAndInvalidXMLFileExtensions();
        const expectedFakeDirectoryItems = 22;
        const expectedXMLFileTypesInDirectory = 19;

        jest.spyOn(vscode.workspace.fs, 'readDirectory').mockImplementation(() => 
          Promise.resolve(mockedDirectory)
        );

        // this is used to ensure the mock is returning the expected result to avoid any type of effects from the mock changing in another test
        expect(mockedDirectory.length).toBe(expectedFakeDirectoryItems);
        
        const mockedUri:vscode.Uri = MockVSCodeWorkspaceService.getFakeVSCodeUri();
        jest.spyOn(vscode.Uri, "joinPath").mockReturnValue(mockedUri);

        jest.spyOn(vscode.workspace.fs, 'readFile').mockReturnValue(
          Promise.resolve(Buffer.from('fake xml markup'))
        );

        const mockedBuffer:any = 'dont care text';
        jest.spyOn(Buffer, 'from').mockReturnValue(mockedBuffer);

        const fakeFieldXMLInfo:any = XMLMarkupMockService.getRichTextAreaXMLFieldDetail();
        jest.spyOn(directoryProcessor, 'buildFieldInfoByXMLContent').mockReturnValue(fakeFieldXMLInfo);
        
        const fakeUri = vscode.Uri.file('/fake/fields/fakepath');
        const fakeObjectName = 'dont worry about me';
        const fakeRecordTypeNameByRecordTypeNameToXMLMarkup = {};
        const salesforceOOTBMappings = {};
        const processedFileInfoDetails = await directoryProcessor.processFieldsDirectory(fakeUri, 
                                                                                          fakeObjectName, 
                                                                                          fakeRecordTypeNameByRecordTypeNameToXMLMarkup,
                                                                                          salesforceOOTBMappings);

        expect(processedFileInfoDetails.length).toBe(expectedXMLFileTypesInDirectory);

      });
          
  });

  describe('processFieldsDirectory compound address expansion', () => {

    const mockSingleFieldFileDirectory = (fieldFileName: string, xmlMarkup: string) => {

      jest.spyOn(vscode.workspace.fs, 'readDirectory').mockImplementation(
        () => Promise.resolve([[fieldFileName, vscode.FileType.File]]) as any
      );
      jest.spyOn(vscode.Uri, 'joinPath').mockReturnValue(MockVSCodeWorkspaceService.getFakeVSCodeUri());
      jest.spyOn(vscode.workspace.fs, 'readFile').mockImplementation(
        () => Promise.resolve(Buffer.from(xmlMarkup)) as any
      );

    };

    test('given an Address field file, the walk yields the five component fields and no line for the compound field', async () => {

      mockSingleFieldFileDirectory('Site_Address__c.field-meta.xml', XMLMarkupMockService.getCompoundAddressFieldTypeXMLMarkup());
      jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue([]);

      const fieldInfoDetails = await directoryProcessor.processFieldsDirectory(
        vscode.Uri.file('/fake/Store__c/fields'),
        'Store__c',
        {},
        {}
      );

      expect(fieldInfoDetails.map(fieldInfo => fieldInfo.fieldName)).toEqual([
        'Site_Address__Street__s',
        'Site_Address__City__s',
        'Site_Address__State__s',
        'Site_Address__PostalCode__s',
        'Site_Address__Country__s'
      ]);

    });

    test('given an Address field file, each component carries the snowfakery recipe value for its component', async () => {

      mockSingleFieldFileDirectory('Site_Address__c.field-meta.xml', XMLMarkupMockService.getCompoundAddressFieldTypeXMLMarkup());
      jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue([]);

      const fieldInfoDetails = await directoryProcessor.processFieldsDirectory(
        vscode.Uri.file('/fake/Store__c/fields'),
        'Store__c',
        {},
        {}
      );

      const componentApiNameToRecipeValue = Object.fromEntries(
        fieldInfoDetails.map(fieldInfo => [fieldInfo.fieldName, fieldInfo.recipeValue])
      );

      expect(componentApiNameToRecipeValue['Site_Address__Street__s']).toBe('${{fake.street_address}}');
      expect(componentApiNameToRecipeValue['Site_Address__City__s']).toBe('${{fake.city}}');
      expect(componentApiNameToRecipeValue['Site_Address__State__s']).toBe('${{fake.state}}');
      expect(componentApiNameToRecipeValue['Site_Address__PostalCode__s']).toBe('${{fake.zipcode}}');
      expect(componentApiNameToRecipeValue['Site_Address__Country__s']).toBe('${{fake.country}}');

    });

    /*
      Directory order decides whether a component's own field file is read before or after the
      compound field. Expansion therefore runs after the walk, and this asserts BOTH orders so a
      future change back to inline expansion fails here rather than shipping a duplicate recipe key.
    */
    const buildOrderedDirectoryMock = (fieldFileNames: string[]) => {

      const fieldFileNameToXmlMarkup: Record<string, string> = {
        'Address.field-meta.xml': `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Address</fullName>
    <label>Address</label>
    <type>Address</type>
</CustomField>`,
        'Street.field-meta.xml': `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Street</fullName>
    <label>Street</label>
    <length>255</length>
    <type>Text</type>
</CustomField>`
      };

      jest.spyOn(vscode.workspace.fs, 'readDirectory').mockImplementation(
        () => Promise.resolve(fieldFileNames.map(fieldFileName => [fieldFileName, vscode.FileType.File])) as any
      );
      jest.spyOn(vscode.Uri, 'joinPath').mockImplementation(
        (baseUri: any, ...pathSegments: string[]) => ({ fsPath: `${baseUri.fsPath}/${pathSegments.join('/')}` }) as any
      );
      jest.spyOn(vscode.workspace.fs, 'readFile').mockImplementation(
        (fieldUri: any) => {
          const fieldFileName = fieldUri.fsPath.split('/').pop();
          return Promise.resolve(Buffer.from(fieldFileNameToXmlMarkup[fieldFileName])) as any;
        }
      );

    };

    test.each([
      ['component field file first', ['Street.field-meta.xml', 'Address.field-meta.xml']],
      ['compound field file first', ['Address.field-meta.xml', 'Street.field-meta.xml']]
    ])('given %s, Street is emitted exactly once', async (_orderDescription, fieldFileNames) => {

      buildOrderedDirectoryMock(fieldFileNames as string[]);
      jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue([]);

      const fieldInfoDetails = await directoryProcessor.processFieldsDirectory(
        vscode.Uri.file('/fake/Asset/fields'),
        'Asset',
        {},
        {}
      );

      const emittedFieldApiNames = fieldInfoDetails.map(fieldInfo => fieldInfo.fieldName);

      expect(emittedFieldApiNames.filter(fieldApiName => fieldApiName === 'Street').length).toBe(1);
      expect(emittedFieldApiNames.sort()).toEqual(['City', 'Country', 'PostalCode', 'State', 'Street']);

    });

    test('given a Text field file, the walk still yields exactly one field and does not expand it', async () => {

      mockSingleFieldFileDirectory('Text__c.field-meta.xml', XMLMarkupMockService.getTextFieldTypeXMLMarkup());
      jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue([]);

      const fieldInfoDetails = await directoryProcessor.processFieldsDirectory(
        vscode.Uri.file('/fake/Store__c/fields'),
        'Store__c',
        {},
        {}
      );

      expect(fieldInfoDetails.length).toBe(1);
      expect(fieldInfoDetails[0].fieldName).toBe('Text__c');

    });

    /*
      The only signal a typeless compound address field leaves is its api name, so this is the case
      the configured list exists for -- the same file expands or does not purely on config.
    */
    test('given a Text field file named in customCompoundAddressFields, the walk expands it into components', async () => {

      mockSingleFieldFileDirectory('Text__c.field-meta.xml', XMLMarkupMockService.getTextFieldTypeXMLMarkup());
      jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue(['Store__c.Text__c']);

      const fieldInfoDetails = await directoryProcessor.processFieldsDirectory(
        vscode.Uri.file('/fake/Store__c/fields'),
        'Store__c',
        {},
        {}
      );

      expect(fieldInfoDetails.map(fieldInfo => fieldInfo.fieldName)).toEqual([
        'Text__Street__s',
        'Text__City__s',
        'Text__State__s',
        'Text__PostalCode__s',
        'Text__Country__s'
      ]);

    });

  });

  describe('processFieldsDirectory compound geolocation expansion', () => {

    const mockSingleFieldFileDirectory = (fieldFileName: string, xmlMarkup: string) => {

      jest.spyOn(vscode.workspace.fs, 'readDirectory').mockImplementation(
        () => Promise.resolve([[fieldFileName, vscode.FileType.File]]) as any
      );
      jest.spyOn(vscode.Uri, 'joinPath').mockReturnValue(MockVSCodeWorkspaceService.getFakeVSCodeUri());
      jest.spyOn(vscode.workspace.fs, 'readFile').mockImplementation(
        () => Promise.resolve(Buffer.from(xmlMarkup)) as any
      );

    };

    const processStoreLocationFieldsDirectory = async (xmlMarkup: string, fieldFileName = 'Store_Location__c.field-meta.xml') => {

      mockSingleFieldFileDirectory(fieldFileName, xmlMarkup);
      jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue([]);

      return await directoryProcessor.processFieldsDirectory(
        vscode.Uri.file('/fake/Store__c/fields'),
        'Store__c',
        {},
        {}
      );

    };

    test('given a Location field file, the walk yields the two component fields and no line for the compound field', async () => {

      const fieldInfoDetails = await processStoreLocationFieldsDirectory(XMLMarkupMockService.getCompoundGeolocationFieldTypeXMLMarkup());

      expect(fieldInfoDetails.map(fieldInfo => fieldInfo.fieldName)).toEqual([
        'Store_Location__Latitude__s',
        'Store_Location__Longitude__s'
      ]);
      expect(fieldInfoDetails.map(fieldInfo => fieldInfo.fieldName)).not.toContain('Store_Location__c');

    });

    test('given a Location field file, each component carries the snowfakery recipe value for its component', async () => {

      const fieldInfoDetails = await processStoreLocationFieldsDirectory(XMLMarkupMockService.getCompoundGeolocationFieldTypeXMLMarkup());

      const componentApiNameToRecipeValue = Object.fromEntries(
        fieldInfoDetails.map(fieldInfo => [fieldInfo.fieldName, fieldInfo.recipeValue])
      );

      expect(componentApiNameToRecipeValue).toEqual({
        'Store_Location__Latitude__s': '${{fake.latitude}}',
        'Store_Location__Longitude__s': '${{fake.longitude}}'
      });

    });

    /*
      <displayLocationInDecimal> controls how the ORG DISPLAYS a coordinate -- degrees/minutes/seconds
      when false -- while the API accepts decimal degrees either way. The generated recipe therefore
      must not vary with it, which is asserted here rather than left to follow from the tag going
      unread.
    */
    test('given displayLocationInDecimal false, the generated components are identical to the decimal case', async () => {

      const decimalFieldInfoDetails = await processStoreLocationFieldsDirectory(XMLMarkupMockService.getCompoundGeolocationFieldTypeXMLMarkup());
      const degreesFieldInfoDetails = await processStoreLocationFieldsDirectory(XMLMarkupMockService.getCompoundGeolocationDisplayedInDegreesFieldTypeXMLMarkup());

      const asComponentLines = (fieldInfoDetails: FieldInfo[]) => fieldInfoDetails.map(
        fieldInfo => `${fieldInfo.fieldName}: ${fieldInfo.recipeValue}`
      );

      expect(asComponentLines(degreesFieldInfoDetails)).toEqual(asComponentLines(decimalFieldInfoDetails));

    });

    /*
      Nothing but <type> decides expansion. A Text field named "Location__c" is an ordinary text field
      and has to stay one recipe line.
    */
    test('given a Text field merely named Location__c, the walk yields the single unexpanded text line', async () => {

      const fieldInfoDetails = await processStoreLocationFieldsDirectory(
        XMLMarkupMockService.getTextFieldNamedLikeGeolocationXMLMarkup(),
        'Location__c.field-meta.xml'
      );

      expect(fieldInfoDetails.map(fieldInfo => fieldInfo.fieldName)).toEqual(['Location__c']);
      expect(fieldInfoDetails[0].recipeValue).toBe('${{fake.text(max_nb_chars=255)}}');

    });

    /*
      The gist link stood in for an expansion that now happens, so no walk may still emit it.
    */
    test('given a Location field file, no generated recipe value carries the one pager gist link', async () => {

      const fieldInfoDetails = await processStoreLocationFieldsDirectory(XMLMarkupMockService.getCompoundGeolocationFieldTypeXMLMarkup());

      fieldInfoDetails.forEach((fieldInfo) => {
        expect(fieldInfo.recipeValue).not.toContain('gist.github.com/jdschleicher/4abfd188a933598833285ee76e560445');
      });

    });

  });

  describe('isCompoundGeolocationField', () => {

    test('given a field whose xml type is Location, returns true', () => {

      const compoundGeolocationFieldInfo: any = { fieldName: 'Store_Location__c', type: 'Location' };

      expect(directoryProcessor.isCompoundGeolocationField(compoundGeolocationFieldInfo)).toBe(true);

    });

    test('given a Text field merely named like a geolocation, returns false', () => {

      const textFieldInfo: any = { fieldName: 'Location__c', type: 'Text' };

      expect(directoryProcessor.isCompoundGeolocationField(textFieldInfo)).toBe(false);

    });

    test('given a compound Address field, returns false', () => {

      const compoundAddressFieldInfo: any = { fieldName: 'Site_Address__c', type: 'Address' };

      expect(directoryProcessor.isCompoundGeolocationField(compoundAddressFieldInfo)).toBe(false);

    });

    test('given a field with no type at all, does not throw', () => {

      const typelessFieldInfo: any = {};

      expect(() => directoryProcessor.isCompoundGeolocationField(typelessFieldInfo)).not.toThrow();
      expect(directoryProcessor.isCompoundGeolocationField(typelessFieldInfo)).toBe(false);

    });

    test('given no field info at all, does not throw', () => {

      expect(() => directoryProcessor.isCompoundGeolocationField(undefined as any)).not.toThrow();
      expect(directoryProcessor.isCompoundGeolocationField(undefined as any)).toBe(false);
      expect(directoryProcessor.isCompoundGeolocationField(null as any)).toBe(false);

    });

  });

  describe('isCompoundAddressField', () => {

    test('given a field whose xml type is Address, returns true', () => {

      const compoundAddressFieldInfo: any = { fieldName: 'Site_Address__c', type: 'Address' };

      expect(directoryProcessor.isCompoundAddressField(compoundAddressFieldInfo, 'Store__c')).toBe(true);

    });

    test('given a Text field merely named like an address, returns false', () => {

      const textFieldInfo: any = { fieldName: 'Address__c', type: 'Text' };
      jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue([]);

      expect(directoryProcessor.isCompoundAddressField(textFieldInfo, 'Store__c')).toBe(false);

    });

    /*
      A compound address field file carrying no <type> tag has already parsed as AUTO_GENERATED, so
      the configured list is the only signal left -- it has to win over the parsed type.
    */
    test('given a field named in customCompoundAddressFields for its object, returns true regardless of its parsed type', () => {

      const configuredFieldInfo: any = { fieldName: 'Legacy_Address__c', type: 'Text' };
      jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue(['Store__c.Legacy_Address__c']);

      expect(directoryProcessor.isCompoundAddressField(configuredFieldInfo, 'Store__c')).toBe(true);

    });

    /*
      A field api name repeats across objects. A bare-name config would make one object's entry
      expand the identically named field on every other object into five bogus component lines.
    */
    test('given the same field name on a DIFFERENT object than the config names, returns false', () => {

      const configuredFieldInfo: any = { fieldName: 'Legacy_Address__c', type: 'Text' };
      jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue(['Store__c.Legacy_Address__c']);

      expect(directoryProcessor.isCompoundAddressField(configuredFieldInfo, 'Site__c')).toBe(false);

    });

    test('given a bare field api name in config rather than an object-qualified key, returns false', () => {

      const configuredFieldInfo: any = { fieldName: 'Legacy_Address__c', type: 'Text' };
      jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue(['Legacy_Address__c']);

      expect(directoryProcessor.isCompoundAddressField(configuredFieldInfo, 'Store__c')).toBe(false);

    });

    test('given no associated object name, returns false rather than matching on the bare field name', () => {

      const configuredFieldInfo: any = { fieldName: 'Legacy_Address__c', type: 'Text' };
      jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue(['Store__c.Legacy_Address__c']);

      expect(directoryProcessor.isCompoundAddressField(configuredFieldInfo, undefined as any)).toBe(false);

    });

    test('given a field with no type at all, does not throw', () => {

      const typelessFieldInfo: any = {};
      jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue([]);

      expect(() => directoryProcessor.isCompoundAddressField(typelessFieldInfo, 'Store__c')).not.toThrow();
      expect(directoryProcessor.isCompoundAddressField(typelessFieldInfo, 'Store__c')).toBe(false);

    });

    test('given ConfigurationService throwing, degrades to the xml type signal rather than failing the walk', () => {

      const compoundAddressFieldInfo: any = { fieldName: 'Legacy_Address__c', type: 'Text' };
      jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockImplementation(() => {
        throw new Error('no treecipe config file');
      });

      expect(directoryProcessor.isCompoundAddressField(compoundAddressFieldInfo, 'Store__c')).toBe(false);

    });

  });

  describe('buildCompoundComponentFieldInfos', () => {

    test('given a custom compound address field, returns one FieldInfo per component and none for the compound field itself', () => {

      const compoundAddressFieldInfo: any = { fieldName: 'Site_Address__c', fieldLabel: 'Site Address', type: 'Address' };

      const componentFieldInfos = directoryProcessor.buildCompoundComponentFieldInfos(compoundAddressFieldInfo, 'Store__c', {});

      expect(componentFieldInfos.map(componentFieldInfo => componentFieldInfo.fieldName)).toEqual([
        'Site_Address__Street__s',
        'Site_Address__City__s',
        'Site_Address__State__s',
        'Site_Address__PostalCode__s',
        'Site_Address__Country__s'
      ]);

      expect(componentFieldInfos.map(componentFieldInfo => componentFieldInfo.fieldName)).not.toContain('Site_Address__c');

    });

    test('every returned component carries the associated object name and a recipe value', () => {

      const compoundAddressFieldInfo: any = { fieldName: 'Site_Address__c', fieldLabel: 'Site Address', type: 'Address' };

      const componentFieldInfos = directoryProcessor.buildCompoundComponentFieldInfos(compoundAddressFieldInfo, 'Store__c', {});

      componentFieldInfos.forEach((componentFieldInfo) => {
        expect(componentFieldInfo.objectName).toBe('Store__c');
        expect(componentFieldInfo.recipeValue).toBeTruthy();
      });

    });

    /*
      Account already emits BillingStreet/BillingCity/... from the OOTB static mappings, so expanding
      a BillingAddress field file on top of them would put duplicate keys in the same object recipe.
    */
    test('given components already named in the object OOTB mappings, emits nothing rather than duplicate recipe lines', () => {

      const compoundAddressFieldInfo: any = { fieldName: 'BillingAddress', fieldLabel: 'Billing Address', type: 'Address' };
      const salesforceOOTBFakerMappings = {
        'Account': {
          'BillingStreet': 'already mapped',
          'BillingCity': 'already mapped',
          'BillingState': 'already mapped',
          'BillingPostalCode': 'already mapped',
          'BillingCountry': 'already mapped'
        }
      };

      const componentFieldInfos = directoryProcessor.buildCompoundComponentFieldInfos(compoundAddressFieldInfo, 'Account', salesforceOOTBFakerMappings);

      expect(componentFieldInfos).toEqual([]);

    });

    test('given only SOME components already in the OOTB mappings, emits exactly the components that are missing', () => {

      const compoundAddressFieldInfo: any = { fieldName: 'BillingAddress', fieldLabel: 'Billing Address', type: 'Address' };
      const salesforceOOTBFakerMappings = {
        'Account': {
          'BillingStreet': 'already mapped',
          'BillingCity': 'already mapped'
        }
      };

      const componentFieldInfos = directoryProcessor.buildCompoundComponentFieldInfos(compoundAddressFieldInfo, 'Account', salesforceOOTBFakerMappings);

      expect(componentFieldInfos.map(componentFieldInfo => componentFieldInfo.fieldName)).toEqual([
        'BillingState',
        'BillingPostalCode',
        'BillingCountry'
      ]);

    });

    /*
      Asset is in the OOTB mappings but names NO address components, so its bare "Address" compound
      field expands to Street/City/... -- exactly the names a retrieved Street.field-meta.xml would
      already have contributed. Two "Street:" keys in one object recipe is invalid YAML intent.
    */
    test('given a component that the object already has as its own field file, drops it rather than emitting a duplicate key', () => {

      const compoundAddressFieldInfo: any = { fieldName: 'Address', fieldLabel: 'Address', type: 'Address' };
      const alreadyProcessedFieldInfos: any = [
        { fieldName: 'Street' },
        { fieldName: 'PostalCode' }
      ];

      const componentFieldInfos = directoryProcessor.buildCompoundComponentFieldInfos(
        compoundAddressFieldInfo,
        'Asset',
        { 'Asset': { 'Name': 'already mapped' } },
        alreadyProcessedFieldInfos
      );

      expect(componentFieldInfos.map(componentFieldInfo => componentFieldInfo.fieldName)).toEqual([
        'City',
        'State',
        'Country'
      ]);

    });

    test('given no already-processed fields, the sibling guard drops nothing', () => {

      const compoundAddressFieldInfo: any = { fieldName: 'Address', fieldLabel: 'Address', type: 'Address' };

      const componentFieldInfos = directoryProcessor.buildCompoundComponentFieldInfos(
        compoundAddressFieldInfo,
        'Asset',
        {},
        []
      );

      expect(componentFieldInfos.length).toBe(5);

    });

    test('given an object with no OOTB mappings entry, emits every component', () => {

      const compoundAddressFieldInfo: any = { fieldName: 'Site_Address__c', fieldLabel: 'Site Address', type: 'Address' };

      const componentFieldInfos = directoryProcessor.buildCompoundComponentFieldInfos(compoundAddressFieldInfo, 'Store__c', { 'Account': { 'BillingStreet': 'x' } });

      expect(componentFieldInfos.length).toBe(5);

    });

  });

  describe('isInMappingsOfOotbSalesforceFields', () => {

    test('given expected file name and associated object name, returns true if in mappings of ootb salesforce fields', () => {
      
      const fakeFieldApiName = 'fakeField';
      const fakeFileName = `${fakeFieldApiName}.field-meta.xml`;
      const fakeAssociatedObjectName = 'fakeObject';
      const fakeSalesforceOOTBMappings = {
        [fakeAssociatedObjectName]: {
          'fakeField': 'some value'
        }
      };

      const result = directoryProcessor.isInMappingsOfOotbSalesforceFields(fakeFileName, fakeAssociatedObjectName, fakeSalesforceOOTBMappings);
    
      expect(result).toBe(true);

    });

    test('given expected file name and associated object name, returns false if not in mappings of ootb salesforce fields', () => {
     
      const fakeFieldApiName = 'fakeField';
      const fakeFileName = `${fakeFieldApiName}.field-meta.xml`;
      const fakeAssociatedObjectName = 'fakeObject';
      const fakeSalesforceOOTBMappings = {
        [fakeAssociatedObjectName]: {
          'someOtherField': 'some value'
        }
      };

      const result = directoryProcessor.isInMappingsOfOotbSalesforceFields(fakeFileName, fakeAssociatedObjectName, fakeSalesforceOOTBMappings);
    
      expect(result).toBe(false);

    });

    test('given expected mapping and expected object key name not in mapping, returns false if not in mappings of ootb salesforce object keys', () => {
      
      const fakeFieldApiName = 'fakeField';
      const fakeFileName = `${fakeFieldApiName}.field-meta.xml`;
      const objectNotInMappings = 'fakeObject';
      const fakeSalesforceOOTBMappings = {
        'Account': {
          'someOtherField': 'some value'
        }
      };

      const result = directoryProcessor.isInMappingsOfOotbSalesforceFields(fakeFileName, objectNotInMappings, fakeSalesforceOOTBMappings);
    
      expect(result).toBe(false);

    });

  });

  /*
      The memoized accessor is what puts a user's treecipe.config.json mappings in front of every
      Lookup field missing a referenceTo tag. It is read once per processed directory rather than
      once per field, and a workspace with no config file at all still has to process normally --
      so the throw is swallowed into an empty map rather than aborting the walk.
  */
  describe('getCustomRelationshipMappings', () => {

    const readCustomRelationshipMappings = (processor: DirectoryProcessor): Record<string, string> => {
      return processor['getCustomRelationshipMappings']();
    };

    test('given a config file with custom relationship mappings, the configured mappings are returned', () => {

      const expectedMappings = {
        "CustomObject__c.Primary_Contact__c": "Contact"
      };

      jest.spyOn(ConfigurationService, 'getCustomRelationshipMappings')
        .mockReturnValue(expectedMappings);

      const actualMappings = readCustomRelationshipMappings(directoryProcessor);

      expect(actualMappings).toEqual(expectedMappings);

    });

    test('given repeated reads while processing a directory, the configuration file is only read once', () => {

      const configurationSpy = jest.spyOn(ConfigurationService, 'getCustomRelationshipMappings')
        .mockReturnValue({ "CustomObject__c.Primary_Contact__c": "Contact" });

      readCustomRelationshipMappings(directoryProcessor);
      readCustomRelationshipMappings(directoryProcessor);
      readCustomRelationshipMappings(directoryProcessor);

      expect(configurationSpy).toHaveBeenCalledTimes(1);

    });

    test('given a missing treecipe configuration file, an empty map is returned rather than the error propagating', () => {

      jest.spyOn(ConfigurationService, 'getCustomRelationshipMappings')
        .mockImplementation(() => {
          throw new Error('Missing treecipe configuration setup at expected path of: /fake/path -- or unknown failure');
        });

      const actualMappings = readCustomRelationshipMappings(directoryProcessor);

      expect(actualMappings).toEqual({});

    });

    test('given a missing treecipe configuration file, the failed read is not retried on every field', () => {

      const configurationSpy = jest.spyOn(ConfigurationService, 'getCustomRelationshipMappings')
        .mockImplementation(() => {
          throw new Error('Missing treecipe configuration setup at expected path of: /fake/path -- or unknown failure');
        });

      readCustomRelationshipMappings(directoryProcessor);
      readCustomRelationshipMappings(directoryProcessor);

      expect(configurationSpy).toHaveBeenCalledTimes(1);

    });

    /*
        The tests above pin the accessor. This one pins the CALL SITE, which is the part that
        carries the cost: the read sits inside a per-field forEach inside the recursive object
        walk, so moving it back out of the accessor -- or calling ConfigurationService directly at
        line 130 -- would restore a synchronous existsSync + readFileSync + JSON.parse per
        unresolved lookup field while every accessor test above still passed.
    */
    test('given a walk over multiple objects each with unresolved lookup fields, the configuration is read once for the whole walk', async () => {

      const objectsRootPath = '/fake/multi-object/objects';
      const objectApiNames = ['First_Example__c', 'Second_Example__c', 'Third_Example__c'];

      jest.spyOn(vscode.window, 'showWarningMessage').mockImplementation();
      jest.spyOn(RecordTypeService, 'getRecordTypeToApiFieldToRecordTypeWrapper').mockResolvedValue({} as any);

      // own joinPath rather than the ambient module mock -- an earlier test pins it to a fixed uri
      jest.spyOn(vscode.Uri, 'joinPath').mockImplementation((baseUri: any, ...segments: string[]) => ({
        fsPath: `${baseUri.fsPath}/${segments.join('/')}`,
        path: `${baseUri.fsPath}/${segments.join('/')}`
      }) as any);

      jest.spyOn(vscode.workspace.fs, 'readDirectory').mockImplementation((directoryUri: any) => {

        if (directoryUri.fsPath === objectsRootPath) {
          return Promise.resolve(
            objectApiNames.map(objectApiName => [objectApiName, vscode.FileType.Directory])
          ) as any;
        }

        const isObjectDirectory = objectApiNames.some(
          objectApiName => directoryUri.fsPath === `${objectsRootPath}/${objectApiName}`
        );

        if (isObjectDirectory) {
          return Promise.resolve([['fields', vscode.FileType.Directory]]) as any;
        }

        return Promise.resolve([]) as any;

      });

      // every object contributes lookup fields with no referenceTo -- the branch that consults the config
      jest.spyOn(directoryProcessor, 'processFieldsDirectory').mockImplementation((_fieldsUri, objectName) => {

        const unresolvedLookupFields = [
          new FieldInfo(objectName, 'Primary_Contact__c', 'Primary Contact', 'Lookup'),
          new FieldInfo(objectName, 'Secondary_Contact__c', 'Secondary Contact', 'Lookup'),
          new FieldInfo(objectName, 'Owning_Account__c', 'Owning Account', 'MasterDetail')
        ];

        return Promise.resolve(unresolvedLookupFields);

      });

      const configurationSpy = jest.spyOn(ConfigurationService, 'getCustomRelationshipMappings')
        .mockReturnValue({ "First_Example__c.Primary_Contact__c": "Contact" });

      await directoryProcessor.processDirectory(vscode.Uri.file(objectsRootPath), new ObjectInfoWrapper());

      // 3 objects x 3 unresolved lookup fields = 9 resolution attempts, 1 configuration read
      expect(configurationSpy).toHaveBeenCalledTimes(1);

    });

    test('given separate DirectoryProcessor instances, each reads its own configuration rather than sharing a cached map', () => {

      const configurationSpy = jest.spyOn(ConfigurationService, 'getCustomRelationshipMappings')
        .mockReturnValue({ "CustomObject__c.Primary_Contact__c": "Contact" });

      // the enclosing beforeEach spy on the faker service selection is still live here
      readCustomRelationshipMappings(directoryProcessor);
      readCustomRelationshipMappings(new DirectoryProcessor());

      expect(configurationSpy).toHaveBeenCalledTimes(2);

    });

  });


});


/*
  Every other walk test in this file runs the SNOWFAKERY implementation, which is how a faker-js
  emission bug reached review unnoticed: the geolocation values were asserted as map strings and as
  FieldInfo shapes, and neither of those is the artifact. This suite walks the same directory under
  the FAKER-JS implementation and parses what the walk would put in a recipe file.
*/
describe('DirectoryProcessor FakerJS FakerService Implementation compound geolocation expansion', () => {

  let fakerJSDirectoryProcessor: DirectoryProcessor;
  let fakerJSRecipeService: RecipeService;

  beforeEach(() => {

    jest.spyOn(ConfigurationService, 'getFakerImplementationByExtensionConfigSelection')
      .mockImplementation(() => new FakerJSRecipeFakerService());
    jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue([]);

    fakerJSDirectoryProcessor = new DirectoryProcessor();
    fakerJSRecipeService = new RecipeService(new FakerJSRecipeFakerService());

  });

  const walkStoreLocationFieldsDirectory = async (): Promise<FieldInfo[]> => {

    jest.spyOn(vscode.workspace.fs, 'readDirectory').mockImplementation(
      () => Promise.resolve([['Store_Location__c.field-meta.xml', vscode.FileType.File]]) as any
    );
    jest.spyOn(vscode.Uri, 'joinPath').mockReturnValue(MockVSCodeWorkspaceService.getFakeVSCodeUri());
    jest.spyOn(vscode.workspace.fs, 'readFile').mockImplementation(
      () => Promise.resolve(Buffer.from(XMLMarkupMockService.getCompoundGeolocationFieldTypeXMLMarkup())) as any
    );

    return await fakerJSDirectoryProcessor.processFieldsDirectory(
      vscode.Uri.file('/fake/Store__c/fields'),
      'Store__c',
      {},
      {}
    );

  };

  test('the walk yields the two component fields and no line for the compound field', async () => {

    const fieldInfoDetails = await walkStoreLocationFieldsDirectory();

    expect(fieldInfoDetails.map(fieldInfo => fieldInfo.fieldName)).toEqual([
      'Store_Location__Latitude__s',
      'Store_Location__Longitude__s'
    ]);

  });

  test('each component carries the faker-js coordinate expression with its bounds', async () => {

    const fieldInfoDetails = await walkStoreLocationFieldsDirectory();

    expect(fieldInfoDetails[0].recipeValue).toContain('faker.location.latitude');
    expect(fieldInfoDetails[0].recipeValue).toContain('min: -90');
    expect(fieldInfoDetails[1].recipeValue).toContain('faker.location.longitude');
    expect(fieldInfoDetails[1].recipeValue).toContain('min: -180');

  });

  /*
    The artifact, not the shape. FakerJSRecipeProcessor calls yaml.load() over the whole recipe file,
    so a component value that is not a valid YAML scalar does not break its own line -- it makes every
    field on every object in the file unreadable.
  */
  test('the object recipe the walk produces is parseable YAML', async () => {

    const fieldInfoDetails = await walkStoreLocationFieldsDirectory();

    let objectRecipe = `- object: Store__c\n  nickname: Store__c_NickName\n  count: 1\n  fields:`;
    fieldInfoDetails.forEach((fieldInfo) => {
      objectRecipe = fakerJSRecipeService.appendFieldRecipeToObjectRecipe(objectRecipe, fieldInfo.recipeValue, fieldInfo.fieldName);
    });

    const parsedObjectRecipes = yaml.load(objectRecipe) as any[];

    expect(Object.keys(parsedObjectRecipes[0].fields)).toEqual([
      'Store_Location__Latitude__s',
      'Store_Location__Longitude__s'
    ]);
    expect(String(parsedObjectRecipes[0].fields['Store_Location__Latitude__s']).trim())
      .toBe('${{faker.location.latitude({ min: -90, max: 90 })}}');

  });

});
