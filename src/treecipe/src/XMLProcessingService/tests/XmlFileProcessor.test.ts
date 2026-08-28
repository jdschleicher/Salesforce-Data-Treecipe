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
        const expectedPicklistOptionDetails = XMLMarkupMockService.getIPicklistValuesForPicklist__c();

        expect(actualPicklistDetail.length).toBe(expectedPicklistOptionDetails.length);
        actualPicklistDetail.forEach((picklistOption, index) => {
            expect(picklistOption.picklistOptionApiName).toBe(expectedPicklistOptionDetails[index].picklistOptionApiName); 
        });

    });

    test('given expected dependent picklist xml markup, returns expected IPickList array', async () => {

        const xmlPicklistMarkup = XMLMarkupMockService.getDependentPicklistFieldTypeXMLMarkup();

        let expectedPicklistFieldXML: any;
        const parseString = xml2js.parseString;
        parseString(xmlPicklistMarkup, function (err, result) {
            expectedPicklistFieldXML = result;
        });

        const xmlPicklistValueSet: any[] = expectedPicklistFieldXML.CustomField.valueSet[0];
        const actualPicklistDetail = XmlFileProcessor.extractPickListDetailsFromXMLValueTag(xmlPicklistValueSet);
        
        const expectedPicklistFieldDetails = XMLMarkupMockService.getIPicklistValuesForDependentPickllist__c();
        expect(actualPicklistDetail.length).toBe(expectedPicklistFieldDetails.length);

        actualPicklistDetail.forEach((picklistOption, index) => {
            expect(picklistOption.picklistOptionApiName).toBe(expectedPicklistFieldDetails[index].picklistOptionApiName); 
        });

        // THE BELOW ASSERTS ARE USED TO ENSURE THE PICKLIST DETAIL CAPTURES MARKUP LIKLE "isActive" AND SCENARIOS WHERE PICKLIST VALUE OPTIONS HAVE ZERO CONTROLLING FIELD CONFIGURATIONS FROM THE EXPECTED PARENT PICKLIST
        let countOfNullControllingPicklistOptions = expectedPicklistFieldDetails?.filter( 
            (picklistOptionDetail) => picklistOptionDetail.controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection === null
        );
        const expectedHardCodedCountOfNullControllingPicklistOptions = 0;
        expect(countOfNullControllingPicklistOptions.length).toBe(expectedHardCodedCountOfNullControllingPicklistOptions);


        let countOfIsNotActivePicklistOptions = expectedPicklistFieldDetails?.filter( 
            (picklistOptionDetail) => picklistOptionDetail.isActive === false
        );
        const expectedHardCodedCountOfIsNotActiveOptions = 0;
        expect(countOfIsNotActivePicklistOptions.length).toBe(expectedHardCodedCountOfIsNotActiveOptions);

        
    });

    test('given expected dependent picklist with isActive xml markup, returns expected IPickList array', async () => {

        const xmlPicklistMarkup = XMLMarkupMockService.getDependentPicklistFieldTypeWithIsActiveTagsXMLMarkup();

        let expectedPicklistFieldXML: any;
        const parseString = xml2js.parseString;
        parseString(xmlPicklistMarkup, function (err, result) {
            expectedPicklistFieldXML = result;
        });

        const xmlPicklistValueSet: any[] = expectedPicklistFieldXML.CustomField.valueSet[0];
        const actualPicklistDetail = XmlFileProcessor.extractPickListDetailsFromXMLValueTag(xmlPicklistValueSet);
        
        const expectedPicklistFieldDetails = XMLMarkupMockService.getIPicklistValuesWithIsActiveConfigDependentPickllist__c();
        expect(actualPicklistDetail.length).toBe(expectedPicklistFieldDetails.length);

        actualPicklistDetail.forEach((picklistOption, index) => {
            expect(picklistOption.picklistOptionApiName).toBe(expectedPicklistFieldDetails[index].picklistOptionApiName); 
        });

        // THE BELOW ASSERTS ARE USED TO ENSURE THE PICKLIST DETAIL CAPTURES MARKUP LIKLE "isActive" AND SCENARIOS WHERE PICKLIST VALUE OPTIONS HAVE ZERO CONTROLLING FIELD CONFIGURATIONS FROM THE EXPECTED PARENT PICKLIST
        let countOfNullControllingPicklistOptions = expectedPicklistFieldDetails?.filter( 
            (picklistOptionDetail) => picklistOptionDetail.controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection === null
        );
        const expectedHardCodedCountOfNullControllingPicklistOptions = 2;
        expect(countOfNullControllingPicklistOptions.length).toBe(expectedHardCodedCountOfNullControllingPicklistOptions);

        let countOfIsNotActivePicklistOptions = expectedPicklistFieldDetails?.filter( 
            (picklistOptionDetail) => picklistOptionDetail.isActive === false
        );
        const expectedHardCodedCountOfIsNotActiveOptions = 2;
        expect(countOfIsNotActivePicklistOptions.length).toBe(expectedHardCodedCountOfIsNotActiveOptions);

        
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

    test('given expected Dependent Picklist with isActive tags in xml markup, returns expected Dependent picklist XMLFieldDetail', async () => {

        const xmlExpectedDependentPicklistMarkup = XMLMarkupMockService.getDependentPicklistFieldTypeWithIsActiveTagsXMLMarkup();
        const fakeFieldName = 'DependentPicklist__c.field-meta.xml';
        const actualDependentPicklistDetail = await XmlFileProcessor.processXmlFieldContent(xmlExpectedDependentPicklistMarkup, fakeFieldName);
        const expectedXMLDependentPicklistXMLFieldDetail:XMLFieldDetail = XMLMarkupMockService.getExpectedIsActiveDependentPicklistXMLDetail();

        expect(actualDependentPicklistDetail).toEqual(expectedXMLDependentPicklistXMLFieldDetail);
    });


    test('given expected Global Value Set xml markup, returns expected picklist XMLFieldDetail', async () => {

        const xmlGlobalPicklistMarkup = XMLMarkupMockService.getGlobalValueSetFieldXMLMarkup();
        const fakeFieldName = 'GlobalPicklist__c.field-meta.xml';
        const actualGlobalPicklistDetail = await XmlFileProcessor.processXmlFieldContent(xmlGlobalPicklistMarkup, fakeFieldName);
        const expectedGlobalPicklistDetail = XMLMarkupMockService.getPicklistFieldSetToGlobalPicklistXMLFieldDetail();

        expect(actualGlobalPicklistDetail).toEqual(expectedGlobalPicklistDetail);

    });

    test('given expected Standard Value Set xml markup, returns expected picklist XMLFieldDetail', async () => {

        const xmlStandardValueSetMarkup = XMLMarkupMockService.getStandardValueSetLeadSourceXMLMarkup();
        const fakeFieldName = 'LeadSource.field-meta.xml';
        const actualDependentPicklistDetail = await XmlFileProcessor.processXmlFieldContent(xmlStandardValueSetMarkup, fakeFieldName);
        const expectedXMLDependentPicklistXMLFieldDetail = XMLMarkupMockService.getExpectedStandardValueSetLeadSourcePicklistXMLFieldDetail();

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

    test('given text field with length XML tag, parses length property correctly', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getTextFieldTypeWithLengthXMLMarkup();
        const fakeFieldName = 'TextWithLength__c.field-meta.xml';
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup, fakeFieldName);
        const expectedXMLFieldDetail = XMLMarkupMockService.getTextXMLFieldDetailWithLength();

        expect(actualFieldDetail).toEqual(expectedXMLFieldDetail);
        expect(actualFieldDetail.length).toBe(50);

    });

    test('given number field with precision and scale XML tags, parses properties correctly', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getNumberFieldTypeXMLMarkup();
        const fakeFieldName = 'Number__c.field-meta.xml';
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup, fakeFieldName);
        const expectedXMLFieldDetail = XMLMarkupMockService.getNumberXMLFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLFieldDetail);
        expect(actualFieldDetail.precision).toBe(18);
        expect(actualFieldDetail.scale).toBe(0);

    });

    test('given currency field with precision and scale XML tags, parses properties correctly', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getCurrencyFieldTypeXMLMarkup();
        const fakeFieldName = 'Currency__c.field-meta.xml';
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup, fakeFieldName);
        const expectedXMLFieldDetail = XMLMarkupMockService.getCurrencyFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLFieldDetail);
        expect(actualFieldDetail.precision).toBe(18);
        expect(actualFieldDetail.scale).toBe(2);

    });

    test('given percent field with precision and scale XML tags, parses properties correctly', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getPercentFieldTypeXMLMarkup();
        const fakeFieldName = 'Percent__c.field-meta.xml';
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup, fakeFieldName);
        const expectedXMLFieldDetail = XMLMarkupMockService.getPercentXMLFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLFieldDetail);
        expect(actualFieldDetail.precision).toBe(5);
        expect(actualFieldDetail.scale).toBe(2);

    });

    test('given field without precision/scale/length XML tags, does not set properties', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getEmailFieldTypeXMLMarkup();
        const fakeFieldName = 'Email__c.field-meta.xml';
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup, fakeFieldName);
        const expectedXMLFieldDetail = XMLMarkupMockService.getEmailXMLFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLFieldDetail);
        expect(actualFieldDetail.precision).toBeUndefined();
        expect(actualFieldDetail.scale).toBeUndefined();
        expect(actualFieldDetail.length).toBeUndefined();

    });

    test('given long textarea field with length XML tag, parses length property correctly', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getLongTextAreaFieldTypeXMLMarkup();
        const fakeFieldName = 'LongTextArea__c.field-meta.xml';
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup, fakeFieldName);
        const expectedXMLFieldDetail = XMLMarkupMockService.getLongTextAreaXMLFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLFieldDetail);
        expect(actualFieldDetail.length).toBe(131072);

    });

    test('given rich text area field with length XML tag, parses length property correctly', async () => {

        const xmlFieldMarkup = XMLMarkupMockService.getRichTextAreaFieldTypeXMLMarkup();
        const fakeFieldName = 'RichTextArea__c.field-meta.xml';
        const actualFieldDetail = await XmlFileProcessor.processXmlFieldContent(xmlFieldMarkup, fakeFieldName);
        const expectedXMLFieldDetail = XMLMarkupMockService.getRichTextAreaXMLFieldDetail();

        expect(actualFieldDetail).toEqual(expectedXMLFieldDetail);
        expect(actualFieldDetail.length).toBe(32768);

    });

});
describe('isSalesforceFieldMetadataFile', () => {

    const FILE = 1;
    const DIRECTORY = 2;

    test('given a real Salesforce field file, returns true', () => {
        expect(XmlFileProcessor.isSalesforceFieldMetadataFile('Neighborhood__c.field-meta.xml', FILE)).toBe(true);
    });

    /*
        The reported defect: a fields directory can hold a hand-saved copy or an export carrying
        CustomField markup. Matching on ".xml" alone parsed those as real fields and generated
        picklist dependency specs for fields the org does not have.
    */
    test('given an xml file without the field-meta suffix, returns false', () => {
        expect(XmlFileProcessor.isSalesforceFieldMetadataFile('gfh__c.xml', FILE)).toBe(false);
    });

    test('given other stray xml files that can sit beside field metadata, returns false', () => {
        expect(XmlFileProcessor.isSalesforceFieldMetadataFile('package.xml', FILE)).toBe(false);
        expect(XmlFileProcessor.isSalesforceFieldMetadataFile('Neighborhood__c.field-meta.xml.bak', FILE)).toBe(false);
        expect(XmlFileProcessor.isSalesforceFieldMetadataFile('Copy of Neighborhood__c.xml', FILE)).toBe(false);
    });

    // A FILE NAMED EXACTLY THE SUFFIX HAS NO API NAME TO DERIVE, SO IT IS NOT A FIELD
    test('given a file named exactly the suffix, returns false', () => {
        expect(XmlFileProcessor.isSalesforceFieldMetadataFile('.field-meta.xml', FILE)).toBe(false);
    });

    test('given a directory whose name ends in the suffix, returns false', () => {
        expect(XmlFileProcessor.isSalesforceFieldMetadataFile('Something.field-meta.xml', DIRECTORY)).toBe(false);
    });

    test('given mixed casing, still recognises the suffix', () => {
        expect(XmlFileProcessor.isSalesforceFieldMetadataFile('Neighborhood__c.Field-Meta.XML', FILE)).toBe(true);
    });

    /*
        isXMLFileType keeps meaning "is an .xml file" -- GlobalValueSetSingleton and RecordTypeService
        rely on it for .globalValueSet-meta.xml and .recordType-meta.xml, so narrowing it would have
        broken those. The two checks are deliberately separate.
    */
    test('isXMLFileType still accepts any xml file, unchanged', () => {
        expect(XmlFileProcessor.isXMLFileType('gfh__c.xml', FILE)).toBe(true);
        expect(XmlFileProcessor.isXMLFileType('SomeRecordType.recordType-meta.xml', FILE)).toBe(true);
    });


    describe('global value set backed dependent picklist', () => {

        /*
            A picklist whose values come from a GLOBAL value set has no local valueSetDefinition, but
            it can still be dependent -- the controllingField and valueSettings markup are present in
            the field file either way. controllingField was previously read only inside the
            valueSetDefinition branch, so such a field parsed as NOT dependent: no dependency spec was
            generated for it, and recipe generation treated it as a plain picklist.
        */
        const globalValueSetDependentPicklistMarkup = `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>GlobalSuperDependent__c</fullName>
    <label>GlobalSuperDependent</label>
    <type>Picklist</type>
    <valueSet>
        <controllingField>DependentPicklist__c</controllingField>
        <restricted>true</restricted>
        <valueSetName>Planets</valueSetName>
        <valueSettings>
            <controllingFieldValue>tree</controllingFieldValue>
            <controllingFieldValue>weed</controllingFieldValue>
            <valueName>earth</valueName>
        </valueSettings>
        <valueSettings>
            <controllingFieldValue>plant</controllingFieldValue>
            <valueName>neptune</valueName>
        </valueSettings>
    </valueSet>
</CustomField>`;

        test('captures the controlling field rather than dropping it', async () => {

            const fieldDetail = await XmlFileProcessor.processXmlFieldContent(globalValueSetDependentPicklistMarkup, 'GlobalSuperDependent__c.field-meta.xml');

            expect(fieldDetail.controllingField).toBe('DependentPicklist__c');
            // THE GLOBAL VALUE SET NAME IS STILL RECORDED -- BOTH FACTS ARE TRUE OF THIS FIELD
            expect(fieldDetail.globalValueSetName).toBe('Planets');

        });

        test('derives the dependency configuration from valueSettings', async () => {

            const fieldDetail = await XmlFileProcessor.processXmlFieldContent(globalValueSetDependentPicklistMarkup, 'GlobalSuperDependent__c.field-meta.xml');

            const controllingValuesByDependentValue = Object.fromEntries(
                (fieldDetail.picklistValues ?? []).map(picklistValue => [
                    picklistValue.picklistOptionApiName,
                    picklistValue.controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection
                ])
            );

            expect(controllingValuesByDependentValue['earth']).toEqual(['tree', 'weed']);
            expect(controllingValuesByDependentValue['neptune']).toEqual(['plant']);

        });

        test('given a global value set picklist that is NOT dependent, records no controlling field and no picklist values', async () => {

            const nonDependentMarkup = globalValueSetDependentPicklistMarkup
                .replace('<controllingField>DependentPicklist__c</controllingField>', '')
                .replace(/<valueSettings>[\s\S]*<\/valueSettings>/, '');

            const fieldDetail = await XmlFileProcessor.processXmlFieldContent(nonDependentMarkup, 'PlainGlobal__c.field-meta.xml');

            expect(fieldDetail.controllingField).toBeUndefined();
            expect(fieldDetail.globalValueSetName).toBe('Planets');
            expect(fieldDetail.picklistValues).toBeUndefined();

        });

    });

});
