import { XMLFieldDetail } from "../../XMLProcessingService/XMLFieldDetail";
import { XmlFileProcessor } from "../XmlFileProcessor";
import { XMLMarkupMockService } from "./mocks/XMLMarkupMockService";
import * as xml2js from 'xml2js';

jest.mock('vscode', () => ({
    FileType: {
        Directory: 2,
        File: 1,
        SymbolicLink: 64
    }
}), { virtual: true });

describe('extractPickListDetailsFromXMLValueTag',() => {
    
    test('given expected picklist xml markup, returns expected IPickList array', async () => {

        const xmlPicklistMarkup = XMLMarkupMockService.getPicklistFieldTypeXMLMarkup();

        let expectedPicklistFieldXML: any;
        const parseString = xml2js.parseString;
        parseString(xmlPicklistMarkup, function (err, result) {
            console.dir(result);
            expectedPicklistFieldXML = result;
        });

        const xmlPicklistValueSet: any[] = expectedPicklistFieldXML.CustomField.valueSet[0];
        const actualPicklistDetail = XmlFileProcessor.extractPickListDetailsFromXMLValueTag(xmlPicklistValueSet);
        const expectedPicklistOptionDetails = XMLMarkupMockService.getIPicklistValuesForPickllist__c();

        expect(actualPicklistDetail.length).toBe(expectedPicklistOptionDetails.length);
        actualPicklistDetail.forEach((picklistOption, index) => {
            expect(picklistOption.picklistOptionApiName).toBe(expectedPicklistOptionDetails[index].picklistOptionApiName); 
        });
    });

    test('given test expected picklist xml markup, returns expected IPickList array', async () => {

        // const xmlPicklistMarkup = XMLMarkupMockService.getTestdependentPicklistFieldTypeWithIsActiveTagsXMLMarkup();
        const xmlPicklistMarkup = XMLMarkupMockService.getDependentPicklistFieldTypeWithIsActiveTagsXMLMarkup();

        let expectedPicklistFieldXML: any;
        const parseString = xml2js.parseString;
        parseString(xmlPicklistMarkup, function (err, result) {
            console.dir(result);
            expectedPicklistFieldXML = result;
        });

        const xmlPicklistValueSet: any[] = expectedPicklistFieldXML.CustomField.valueSet[0];
        const actualPicklistDetail = XmlFileProcessor.extractPickListDetailsFromXMLValueTag(xmlPicklistValueSet);
        
        const expectedPicklistFieldDetails = XMLMarkupMockService.getIPicklistValuesForPickllist__c();

        expect(actualPicklistDetail.length).toBe(expectedPicklistFieldDetails.length);
        actualPicklistDetail.forEach((picklistOption, index) => {
            expect(picklistOption.picklistOptionApiName).toBe(expectedPicklistFieldDetails[index].picklistOptionApiName); 
        });
        
    });

    test('given global value set picklist xml markup, returns expected IPickList array', async () => {

        const xmlPicklistMarkup = XMLMarkupMockService.getGlobalValueSetXMLMarkup();

        let expectedPicklistFieldXML: any;
        const parseString = xml2js.parseString;
        parseString(xmlPicklistMarkup, function (err, result) {
            console.dir(result);
            expectedPicklistFieldXML = result;
        });

        const xmlPicklistValueSet: any[] = expectedPicklistFieldXML.CustomField.valueSet[0];
        const actualPicklistDetail = XmlFileProcessor.extractPickListDetailsFromXMLValueTag(xmlPicklistValueSet);
        
        const expectedPicklistOptionFieldDetails = XMLMarkupMockService.getIPicklistValuesForPickllist__c();

        expect(actualPicklistDetail.length).toBe(expectedPicklistOptionFieldDetails.length);
        actualPicklistDetail.forEach((picklistOption, index) => {
            expect(picklistOption.picklistOptionApiName).toBe(expectedPicklistOptionFieldDetails[index].picklistOptionApiName); 
        });
        
    });

});

describe('processXmlFieldContent', () => {
    
    test('given expected Picklist xml markup, returns expected picklist XMLFieldDetail', async () => {

        const xmlPicklistMarkup = XMLMarkupMockService.getPicklistFieldTypeXMLMarkup();
        const fakeFieldName = 'Picklist__c.field-meta.xml';
        const actualPicklistXMLFieldDetail:XMLFieldDetail = await await XmlFileProcessor.processXmlFieldContent(xmlPicklistMarkup, fakeFieldName);
        const expectedXMLPicklistXMLFieldDetail:XMLFieldDetail = XMLMarkupMockService.getPicklistXMLFieldDetail();

        expect(actualPicklistXMLFieldDetail).toEqual(expectedXMLPicklistXMLFieldDetail);

    });

    test('given expected Multi-Select Picklist xml markup, returns expected picklist XMLFieldDetail', async () => {

        const xmlMultiSelectPicklistMarkup = XMLMarkupMockService.getMultiSelectPicklistFieldTypeXMLMarkup();
        const fakeFieldName = 'MultiSelectPicklist__c.field-meta.xml';
        const actualMultiSelectPicklistDetail = await XmlFileProcessor.processXmlFieldContent(xmlMultiSelectPicklistMarkup, fakeFieldName);
        const expectedXMLMultiSelectPicklistXMLFieldDetail = XMLMarkupMockService.getMultiSelectPicklistXMLFieldDetail();

        expect(actualMultiSelectPicklistDetail).toEqual(expectedXMLMultiSelectPicklistXMLFieldDetail);

    });

    test('given expected Dependent Picklist xml markup, returns expected Dependent picklist XMLFieldDetail', async () => {

        const xmlDependentPicklistMarkup = XMLMarkupMockService.getDependentPicklistFieldTypeXMLMarkup();
        const fakeFieldName = 'DependentPicklist__c.field-meta.xml';
        const actualDependentPicklistDetail = await XmlFileProcessor.processXmlFieldContent(xmlDependentPicklistMarkup, fakeFieldName);
        const expectedXMLDependentPicklistXMLFieldDetail = XMLMarkupMockService.getDependentPicklistXMLFieldDetail();

        expect(expectedXMLDependentPicklistXMLFieldDetail).toEqual(actualDependentPicklistDetail);

    });

    test('given expected "Text" field type xml markup, returns expected text XMLFieldDetail', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getTextFieldTypeXMLMarkup();
        const fakeFieldName = 'Text__c.field-meta.xml';
        const actualTextDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup, fakeFieldName);
        const expectedXMLFieldXMLFieldDetail = XMLMarkupMockService.getTextXMLFieldDetail();

        expect(actualTextDetail).toEqual(expectedXMLFieldXMLFieldDetail);

    });

    test('given expected "Checkbox" field type xml markup, returns expected Checkbox XMLFieldDetail', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getCheckboxFieldTypeXMLMarkup();
        const fakeFieldName = 'Checkbox.field-meta.xml';
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup, fakeFieldName);
        const expectedXMLCheckboxFieldXMLFieldDetail = XMLMarkupMockService.getCheckboxFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLCheckboxFieldXMLFieldDetail);

    });

    test('given expected "Currency" field type xml markup, returns expected Currency XMLFieldDetail', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getCurrencyFieldTypeXMLMarkup();
        const fakeFieldName = 'Currency__c.field-meta.xml';
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup, fakeFieldName);
        const expectedXMLCurrencyFieldXMLFieldDetail = XMLMarkupMockService.getCurrencyFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLCurrencyFieldXMLFieldDetail);

    });

    test('given expected "Date" field type xml markup, returns expected Date XMLFieldDetail', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getDateFieldTypeXMLMarkup();
        const fakeFieldName = 'Date__c.field-meta.xml';
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup, fakeFieldName);
        const expectedXMLDateFieldXMLFieldDetail = XMLMarkupMockService.getDateFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLDateFieldXMLFieldDetail);

    });

    test('given expected "DateTime" field type xml markup, returns expected DateTime XMLFieldDetail', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getDateTimeFieldTypeXMLMarkup();
        const fakeFieldName = 'DateTime__c.field-meta.xml';
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup, fakeFieldName);
        const expectedXMLDateTimeFieldXMLFieldDetail = XMLMarkupMockService.getDateTimeFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLDateTimeFieldXMLFieldDetail);

    });

    test('given expected "Email" field type xml markup, returns expected Email XMLFieldDetail', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getEmailFieldTypeXMLMarkup();
        const fakeFieldName = 'Email__c.field-meta.xml';
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup, fakeFieldName);
        const expectedXMLEmailFieldXMLFieldDetail = XMLMarkupMockService.getEmailXMLFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLEmailFieldXMLFieldDetail);

    });

    test('given expected "Lookup" field type xml markup, returns expected Lookup XMLFieldDetail', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getLookupFieldTypeXMLMarkup();
        const fakeFieldName = 'Lookup__c.field-meta.xml';
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup, fakeFieldName);
        const expectedXMLLookupFieldXMLFieldDetail = XMLMarkupMockService.getLookupXMLFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLLookupFieldXMLFieldDetail);

    });

    test('given expected Formula field with "Number" field type xml markup, returns expected Formula XMLFieldDetail', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getFormulaFieldTypeXMLMarkup();
        const fakeFieldName = 'Formula__c.field-meta.xml';
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup, fakeFieldName);
        const expectedXMLFormulaFieldXMLFieldDetail = XMLMarkupMockService.getFormulaXMLFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLFormulaFieldXMLFieldDetail);

    });


    test('given expected "Geolocation" field type xml markup, returns expected Geolocation XMLFieldDetail', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getGeolocationFieldTypeXMLMarkup();
        const fakeFieldName = 'Geolocation__c.field-meta.xml';
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup, fakeFieldName);
        const expectedXMLGeolocationFieldXMLFieldDetail = XMLMarkupMockService.getGeolocationXMLFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLGeolocationFieldXMLFieldDetail);

    });

    test('given expected "Number" field type xml markup, returns expected Number XMLFieldDetail', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getNumberFieldTypeXMLMarkup();
        const fakeFieldName = 'Number__c.field-meta.xml';
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup, fakeFieldName);
        const expectedXMLNumberFieldXMLFieldDetail = XMLMarkupMockService.getNumberXMLFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLNumberFieldXMLFieldDetail);

    });
    
    test('given expected "Phone" field type xml markup, returns expected Phone XMLFieldDetail', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getPhoneFieldTypeXMLMarkup();
        const fakeFieldName = 'Phone__c.field-meta.xml';
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup, fakeFieldName);
        const expectedXMLPhoneFieldXMLFieldDetail = XMLMarkupMockService.getPhoneXMLFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLPhoneFieldXMLFieldDetail);

    });

    test('given expected "Phone" field type xml markup, returns expected Phone XMLFieldDetail', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getPhoneFieldTypeXMLMarkup();
        const fakeFieldName = 'Phone__c.field-meta.xml';
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup, fakeFieldName);
        const expectedXMLPhoneFieldXMLFieldDetail = XMLMarkupMockService.getPhoneXMLFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLPhoneFieldXMLFieldDetail);

    });

    test('given expected "LongTextArea" field type xml markup, returns expected LongTextArea XMLFieldDetail', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getLongTextAreaFieldTypeXMLMarkup();
        const fakeFieldName = 'LongTextArea__c.field-meta.xml';
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup, fakeFieldName);
        const expectedXMLLongTextAreaFieldXMLFieldDetail = XMLMarkupMockService.getLongTextAreaXMLFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLLongTextAreaFieldXMLFieldDetail);

    });

    test('given expected "RichTextArea" html field type xml markup, returns expected RichTextArea XMLFieldDetail', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getRichTextAreaFieldTypeXMLMarkup();
        const fakeFieldName = 'RichTextArea__c.field-meta.xml';
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup, fakeFieldName);
        const expectedXMLRichTextAreaFieldXMLFieldDetail = XMLMarkupMockService.getRichTextAreaXMLFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLRichTextAreaFieldXMLFieldDetail);

    });

    test('given expected "Time" field type xml markup, returns expected Time XMLFieldDetail', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getTimeFieldTypeXMLMarkup();
        const fakeFieldName = 'Time__c.field-meta.xml';
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup, fakeFieldName);
        const expectedXMLTimeFieldXMLFieldDetail = XMLMarkupMockService.getTimeXMLFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLTimeFieldXMLFieldDetail);

    });


    test('given expected "Url" field type xml markup, returns expected Url XMLFieldDetail', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getUrlFieldTypeXMLMarkup();
        const fakeFieldName = 'Url__c.field-meta.xml';
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup, fakeFieldName);
        const expectedXMLUrlFieldXMLFieldDetail = XMLMarkupMockService.getUrlXMLFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLUrlFieldXMLFieldDetail);

    });

    test('given expected "MasterDetail" field type xml markup, returns expected MasterDetail XMLFieldDetail', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getMasterDetailFieldTypeXMLMarkup();
        const fakeFieldName = 'MasterDetail__c.field-meta.xml';
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup, fakeFieldName);
        const expectedXMLMasterDetailFieldXMLFieldDetail = XMLMarkupMockService.getMasterDetailXMLFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLMasterDetailFieldXMLFieldDetail);

    });


});

describe('isXMLFileType', () => {

    test('given expected xml file extension and valid filetype enum, returns true', () => {

        const validXMLFileExtensionName = 'Checkbox__c.field-meta.xml';
        const expectedVSCodeFileTypeEnum = 1;
        const isXMLFileType:boolean = XmlFileProcessor.isXMLFileType(validXMLFileExtensionName, expectedVSCodeFileTypeEnum);
        expect(isXMLFileType).toBeTruthy();

    });

    test('given expected INVALID xml file extension and valid filetype enum, returns true', () => {

        const invalidXMLFileExtensionName = 'noxmlextensionhere.notme';
        const expectedVSCodeFileTypeEnum = 1;
        const isXMLFileType:boolean = XmlFileProcessor.isXMLFileType(invalidXMLFileExtensionName, expectedVSCodeFileTypeEnum);
        expect(isXMLFileType).toBeFalsy();
        
    });

    test('given expected valid xml file extension and INVALID filetype enum, returns true', () => {

        const validXMLFileExtensionName = 'Checkbox__c.field-meta.xml';
        const directoryTypeEnum = 2;
        const isXMLFileType:boolean = XmlFileProcessor.isXMLFileType(validXMLFileExtensionName, directoryTypeEnum);
        expect(isXMLFileType).toBeFalsy();
        
    });

    test('given expected INVALID xml file extension and INVALID filetype enum, returns true', () => {

        const invalidXMLFileExtensionName = 'noxmlextensionhere.notme';
        const directoryTypeEnum = 2;
        const isXMLFileType:boolean = XmlFileProcessor.isXMLFileType(invalidXMLFileExtensionName, directoryTypeEnum);
        expect(isXMLFileType).toBeFalsy();
        
    });

});