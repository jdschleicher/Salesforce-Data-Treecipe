import { XMLFieldDetail } from "../../XMLProcessingService/XMLFieldDetail";
import { XmlFileProcessor } from "../XmlFileProcessor";
import { XMLMarkupMockService } from "./mocks/XMLMarkupMockService";
import * as xml2js from 'xml2js';


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
        const expectedPicklistFieldDetails = XMLMarkupMockService.getIPicklistValuesForPickllist__c();

        expect(actualPicklistDetail.length).toBe(expectedPicklistFieldDetails.length);
        actualPicklistDetail.forEach((item, index) => {
            expect(item.fullName).toBe(expectedPicklistFieldDetails[index].fullName); 
        });
    });

});

describe('processXmlFieldContent', () => {
    
    test('given expected Picklist xml markup, returns expected picklist XMLFieldDetail', async () => {

        const xmlPicklistMarkup = XMLMarkupMockService.getPicklistFieldTypeXMLMarkup();
        const actualPicklistXMLFieldDetail:XMLFieldDetail = await await XmlFileProcessor.processXmlFieldContent(xmlPicklistMarkup);
        const expectedXMLPicklistXMLFieldDetail:XMLFieldDetail = XMLMarkupMockService.getPicklistXMLFieldDetail();

        expect(actualPicklistXMLFieldDetail).toEqual(expectedXMLPicklistXMLFieldDetail);

    });

    test('given expected Multi-Select Picklist xml markup, returns expected picklist XMLFieldDetail', async () => {

        const xmlMultiSelectPicklistMarkup = XMLMarkupMockService.getMultiSelectPicklistFieldTypeXMLMarkup();
        const actualMultiSelectPicklistDetail = await XmlFileProcessor.processXmlFieldContent(xmlMultiSelectPicklistMarkup);
        const expectedXMLMultiSelectPicklistXMLFieldDetail = XMLMarkupMockService.getMultiSelectPicklistXMLFieldDetail();

        expect(actualMultiSelectPicklistDetail).toEqual(expectedXMLMultiSelectPicklistXMLFieldDetail);

    });

    test('given expected Dependent Picklist xml markup, returns expected Dependent picklist XMLFieldDetail', async () => {

        const xmlDependentPicklistMarkup = XMLMarkupMockService.getDependentPicklistFieldTypeXMLMarkup();
        const actualDependentPicklistDetail = await XmlFileProcessor.processXmlFieldContent(xmlDependentPicklistMarkup);
        const expectedXMLDependentPicklistXMLFieldDetail = XMLMarkupMockService.getDependentPicklistXMLFieldDetail();

        expect(expectedXMLDependentPicklistXMLFieldDetail).toEqual(actualDependentPicklistDetail);

    });

    test('given expected "Text" field type xml markup, returns expected text XMLFieldDetail', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getTextFieldTypeXMLMarkup();
        const actualTextDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup);
        const expectedXMLFieldXMLFieldDetail = XMLMarkupMockService.getTextXMLFieldDetail();

        expect(actualTextDetail).toEqual(expectedXMLFieldXMLFieldDetail);

    });

    test('given expected "Checkbox" field type xml markup, returns expected Checkbox XMLFieldDetail', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getCheckboxFieldTypeXMLMarkup();
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup);
        const expectedXMLCheckboxFieldXMLFieldDetail = XMLMarkupMockService.getCheckboxFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLCheckboxFieldXMLFieldDetail);

    });

    test('given expected "Currency" field type xml markup, returns expected Currency XMLFieldDetail', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getCurrencyFieldTypeXMLMarkup();
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup);
        const expectedXMLCurrencyFieldXMLFieldDetail = XMLMarkupMockService.getCurrencyFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLCurrencyFieldXMLFieldDetail);

    });

    test('given expected "Date" field type xml markup, returns expected Date XMLFieldDetail', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getDateFieldTypeXMLMarkup();
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup);
        const expectedXMLDateFieldXMLFieldDetail = XMLMarkupMockService.getDateFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLDateFieldXMLFieldDetail);

    });

    test('given expected "DateTime" field type xml markup, returns expected DateTime XMLFieldDetail', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getDateTimeFieldTypeXMLMarkup();
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup);
        const expectedXMLDateTimeFieldXMLFieldDetail = XMLMarkupMockService.getDateTimeFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLDateTimeFieldXMLFieldDetail);

    });

    test('given expected "Email" field type xml markup, returns expected Email XMLFieldDetail', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getEmailFieldTypeXMLMarkup();
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup);
        const expectedXMLEmailFieldXMLFieldDetail = XMLMarkupMockService.getEmailXMLFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLEmailFieldXMLFieldDetail);

    });

    test('given expected "Lookup" field type xml markup, returns expected Lookup XMLFieldDetail', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getLookupFieldTypeXMLMarkup();
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup);
        const expectedXMLLookupFieldXMLFieldDetail = XMLMarkupMockService.getLookupXMLFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLLookupFieldXMLFieldDetail);

    });

    test('given expected Formula field with "Number" field type xml markup, returns expected Formula XMLFieldDetail', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getFormulaFieldTypeXMLMarkup();
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup);
        const expectedXMLFormulaFieldXMLFieldDetail = XMLMarkupMockService.getFormulaXMLFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLFormulaFieldXMLFieldDetail);

    });


    test('given expected "Geolocation" field type xml markup, returns expected Geolocation XMLFieldDetail', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getGeolocationFieldTypeXMLMarkup();
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup);
        const expectedXMLGeolocationFieldXMLFieldDetail = XMLMarkupMockService.getGeolocationXMLFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLGeolocationFieldXMLFieldDetail);

    });

    test('given expected "Number" field type xml markup, returns expected Number XMLFieldDetail', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getNumberFieldTypeXMLMarkup();
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup);
        const expectedXMLNumberFieldXMLFieldDetail = XMLMarkupMockService.getNumberXMLFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLNumberFieldXMLFieldDetail);

    });
    
    test('given expected "Phone" field type xml markup, returns expected Phone XMLFieldDetail', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getPhoneFieldTypeXMLMarkup();
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup);
        const expectedXMLPhoneFieldXMLFieldDetail = XMLMarkupMockService.getPhoneXMLFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLPhoneFieldXMLFieldDetail);

    });

    test('given expected "Phone" field type xml markup, returns expected Phone XMLFieldDetail', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getPhoneFieldTypeXMLMarkup();
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup);
        const expectedXMLPhoneFieldXMLFieldDetail = XMLMarkupMockService.getPhoneXMLFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLPhoneFieldXMLFieldDetail);

    });

    test('given expected "LongTextArea" field type xml markup, returns expected LongTextArea XMLFieldDetail', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getLongTextAreaFieldTypeXMLMarkup();
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup);
        const expectedXMLLongTextAreaFieldXMLFieldDetail = XMLMarkupMockService.getLongTextAreaXMLFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLLongTextAreaFieldXMLFieldDetail);

    });

    test('given expected "RichTextArea" field type xml markup, returns expected RichTextArea XMLFieldDetail', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getRichTextAreaFieldTypeXMLMarkup();
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup);
        const expectedXMLRichTextAreaFieldXMLFieldDetail = XMLMarkupMockService.getRichTextAreaXMLFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLRichTextAreaFieldXMLFieldDetail);

    });

    test('given expected "Time" field type xml markup, returns expected Time XMLFieldDetail', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getTimeFieldTypeXMLMarkup();
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup);
        const expectedXMLTimeFieldXMLFieldDetail = XMLMarkupMockService.getTimeXMLFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLTimeFieldXMLFieldDetail);

    });


    test('given expected "Url" field type xml markup, returns expected Url XMLFieldDetail', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getUrlFieldTypeXMLMarkup();
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup);
        const expectedXMLUrlFieldXMLFieldDetail = XMLMarkupMockService.getUrlXMLFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLUrlFieldXMLFieldDetail);

    });

    test('given expected "MasterDetail" field type xml markup, returns expected MasterDetail XMLFieldDetail', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getMasterDetailFieldTypeXMLMarkup();
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup);
        const expectedXMLMasterDetailFieldXMLFieldDetail = XMLMarkupMockService.getMasterDetailXMLFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLMasterDetailFieldXMLFieldDetail);

    });

});