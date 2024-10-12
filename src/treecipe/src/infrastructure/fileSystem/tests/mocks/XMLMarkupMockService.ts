import { IPicklistValue } from "../../../../domain/entities/FieldInfo";
import { XMLFieldDetail } from "../../../../domain/entities/XMLFieldDetail";

export class XMLMarkupMockService {

    static getMasterDetailXMLFieldDetail() {

        const masterDetailXMLField: XMLFieldDetail = {
            fieldType: "MasterDetail",
            apiName: "MD_MegaMapMadness__c",
            fieldLabel: "MD MegaMapMadness",
            referenceTo: "MegaMapMadness__c"
        };

        return masterDetailXMLField;   

    }

    static getMasterDetailFieldTypeXMLMarkup() {

        const masterDetailXMLMarkup = `
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>MD_MegaMapMadness__c</fullName>
    <label>MD MegaMapMadness</label>
    <referenceTo>MegaMapMadness__c</referenceTo>
    <relationshipLabel>MasterDetailMadness</relationshipLabel>
    <relationshipName>MasterDetailMadness</relationshipName>
    <relationshipOrder>0</relationshipOrder>
    <reparentableMasterDetail>false</reparentableMasterDetail>
    <trackTrending>false</trackTrending>
    <type>MasterDetail</type>
    <writeRequiresMasterRead>false</writeRequiresMasterRead>
</CustomField>
`;

        return masterDetailXMLMarkup;

    }

    static getUrlXMLFieldDetail() {

        const urlXMLField: XMLFieldDetail = {
            fieldType: "Url",
            apiName: "Url__c",
            fieldLabel: "Url"
        };

        return urlXMLField;         
    
    }

    static getUrlFieldTypeXMLMarkup() {
    
        const urlFieldMarkup = `
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Url__c</fullName>
    <label>Url</label>
    <required>false</required>
    <trackTrending>false</trackTrending>
    <type>Url</type>
</CustomField>
`;

        return urlFieldMarkup;
    }

    static getTimeXMLFieldDetail() {

        const timeXMLField: XMLFieldDetail = {
            fieldType: "Time",
            apiName: "Time__c",
            fieldLabel: "Time"
        };

        return timeXMLField;     
    
    }

    static getTimeFieldTypeXMLMarkup() {

        const timeXMLMarkup = `
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Time__c</fullName>
    <label>Time</label>
    <required>false</required>
    <trackTrending>false</trackTrending>
    <type>Time</type>
</CustomField>
`;

        return timeXMLMarkup;

    }

    static getRichTextAreaXMLFieldDetail() {

        const richTextAreaXMLField: XMLFieldDetail = {
            fieldType: "RichTextArea",
            apiName: "TextAreaRich__c",
            fieldLabel: "TextAreaRich"
        };

        return richTextAreaXMLField;     
    }

    static getRichTextAreaFieldTypeXMLMarkup() {
        
        const richTextAreaXMLMarkup = `
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>TextAreaRich__c</fullName>
    <label>TextAreaRich</label>
    <length>32768</length>
    <trackTrending>false</trackTrending>
    <type>RichTextArea</type>
    <visibleLines>25</visibleLines>
</CustomField>        
`;

        return richTextAreaXMLMarkup;

    }

    static getLongTextAreaXMLFieldDetail() {

        const longTextAreaXMLField: XMLFieldDetail = {
            fieldType: "LongTextArea",
            apiName: "Text_Area_Long__c",
            fieldLabel: "Text Area Long"
        };

        return longTextAreaXMLField;     
    
    }

    static getLongTextAreaFieldTypeXMLMarkup() {

        const longTextAreaXMLMarkup = `
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Text_Area_Long__c</fullName>
    <label>Text Area Long</label>
    <length>131072</length>
    <trackTrending>false</trackTrending>
    <type>LongTextArea</type>
    <visibleLines>5</visibleLines>
</CustomField>
`;

        return longTextAreaXMLMarkup;

    }

    static getPhoneXMLFieldDetail() {

        const phoneXMLField: XMLFieldDetail = {
            fieldType: "Phone",
            apiName: "Phone__c",
            fieldLabel: "Phone"
        };

        return phoneXMLField;       
    
    }

    static getPhoneFieldTypeXMLMarkup() {
        
        const phoneXMLMarkup = `
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Phone__c</fullName>
    <label>Phone</label>
    <required>false</required>
    <trackTrending>false</trackTrending>
    <type>Phone</type>
</CustomField>
`;

        return phoneXMLMarkup;

    }

    static getNumberXMLFieldDetail() {

        const numberXMLField: XMLFieldDetail = {
            fieldType: "Number",
            apiName: "Number__c",
            fieldLabel: "Number"
        };

        return numberXMLField;    
    
    }

    static getNumberFieldTypeXMLMarkup() {
        const numberFieldMarkup = `
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Number__c</fullName>
    <externalId>false</externalId>
    <label>Number</label>
    <precision>18</precision>
    <required>false</required>
    <scale>0</scale>
    <trackTrending>false</trackTrending>
    <type>Number</type>
    <unique>false</unique>
</CustomField>
`;
        return numberFieldMarkup;    }

    static getGeolocationXMLFieldDetail() {

        const locationXMLField: XMLFieldDetail = {
            fieldType: "Location",
            apiName: "Geolocation__c",
            fieldLabel: "Geolocation"
        };

        return locationXMLField;

    }

    static getGeolocationFieldTypeXMLMarkup() {
        const locationFieldMarkup = `
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Geolocation__c</fullName>
    <displayLocationInDecimal>false</displayLocationInDecimal>
    <label>Geolocation</label>
    <required>false</required>
    <scale>2</scale>
    <trackTrending>false</trackTrending>
    <type>Location</type>
</CustomField>
`;
        return locationFieldMarkup;

    }

    static getFormulaXMLFieldDetail() {

        const formulaXMLField: XMLFieldDetail = {
            fieldType: "Number",
            apiName: "Formula__c",
            fieldLabel: "Formula"
        };

        return formulaXMLField;      

    }

    static getFormulaFieldTypeXMLMarkup() {
        const formulaFieldMarkup = `
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Formula__c</fullName>
    <externalId>false</externalId>
    <formula>$Organization.Longitude</formula>
    <formulaTreatBlanksAs>BlankAsZero</formulaTreatBlanksAs>
    <label>Formula</label>
    <precision>18</precision>
    <required>false</required>
    <scale>2</scale>
    <trackTrending>false</trackTrending>
    <type>Number</type>
    <unique>false</unique>
</CustomField>
`
        return formulaFieldMarkup;

    }

    static getLookupXMLFieldDetail() {

        const lookupXMLField: XMLFieldDetail = {
            fieldType: "Lookup",
            apiName: "Example_Everything_Lookup__c",
            fieldLabel: "Example Everything Lookup",
            referenceTo: "Example_Everything__c"
        };

        return lookupXMLField;        
    
    }

    static getLookupFieldTypeXMLMarkup() {
        const xmlLookupMarkup = `
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Example_Everything_Lookup__c</fullName>
    <deleteConstraint>SetNull</deleteConstraint>
    <description>lookup to itself</description>
    <label>Example Everything Lookup</label>
    <referenceTo>Example_Everything__c</referenceTo>
    <relationshipLabel>Everythings</relationshipLabel>
    <relationshipName>Everythings</relationshipName>
    <required>false</required>
    <trackTrending>false</trackTrending>
    <type>Lookup</type>
</CustomField>
`;

        return xmlLookupMarkup;
    }

    static getDependentPicklistXMLFieldDetail() {

        const mockedMultiSelectPicklistValues = this.getIPicklistValuesForDependentPickllist__c();
        const dependentPicklistXMLField: XMLFieldDetail = {
            fieldType: "Picklist",
            apiName: "DependentPicklist__c",
            picklistValues: mockedMultiSelectPicklistValues,
            fieldLabel: "DependentPicklist",
            controllingField: "Picklist__c"
        };

        return dependentPicklistXMLField;      
    }

    static getDependentPicklistFieldTypeXMLMarkup() {
        const xmlMarkup = `
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>DependentPicklist__c</fullName>
    <label>DependentPicklist</label>
    <required>false</required>
    <trackTrending>false</trackTrending>
    <type>Picklist</type>
    <valueSet>
        <controllingField>Picklist__c</controllingField>
        <restricted>true</restricted>
        <valueSetDefinition>
            <sorted>false</sorted>
            <value>
                <fullName>tree</fullName>
                <default>false</default>
                <label>tree</label>
            </value>
            <value>
                <fullName>plant</fullName>
                <default>false</default>
                <label>plant</label>
            </value>
            <value>
                <fullName>weed</fullName>
                <default>false</default>
                <label>weed</label>
            </value>
            <value>
                <fullName>mulch</fullName>
                <default>false</default>
                <label>mulch</label>
            </value>
            <value>
                <fullName>rocks</fullName>
                <default>false</default>
                <label>rocks</label>
            </value>
        </valueSetDefinition>
        <valueSettings>
            <controllingFieldValue>cle</controllingFieldValue>
            <controllingFieldValue>eastlake</controllingFieldValue>
            <controllingFieldValue>madison</controllingFieldValue>
            <controllingFieldValue>willoughby</controllingFieldValue>
            <valueName>tree</valueName>
        </valueSettings>
        <valueSettings>
            <controllingFieldValue>cle</controllingFieldValue>
            <controllingFieldValue>eastlake</controllingFieldValue>
            <controllingFieldValue>madison</controllingFieldValue>
            <controllingFieldValue>mentor</controllingFieldValue>
            <controllingFieldValue>wickliffe</controllingFieldValue>
            <controllingFieldValue>willoughby</controllingFieldValue>
            <valueName>weed</valueName>
        </valueSettings>
        <valueSettings>
            <controllingFieldValue>cle</controllingFieldValue>
            <controllingFieldValue>eastlake</controllingFieldValue>
            <controllingFieldValue>willoughby</controllingFieldValue>
            <valueName>mulch</valueName>
        </valueSettings>
        <valueSettings>
            <controllingFieldValue>cle</controllingFieldValue>
            <controllingFieldValue>wickliffe</controllingFieldValue>
            <valueName>rocks</valueName>
        </valueSettings>
        <valueSettings>
            <controllingFieldValue>madison</controllingFieldValue>
            <controllingFieldValue>mentor</controllingFieldValue>
            <valueName>plant</valueName>
        </valueSettings>
    </valueSet>
</CustomField>
`;

        return xmlMarkup;   
    
    }

    static getIPicklistValuesForDependentPickllist__c(): IPicklistValue[] {
        
        const expectedPicklistFieldDetails:IPicklistValue[] = [
            {
                fullName: 'tree',
                label: 'tree',
                default: false,
                availableForControllingValues: ['cle', 'eastlake', 'madison', 'willoughby']
            },
            {
                fullName: 'plant',
                label: 'plant',
                default: false,
                availableForControllingValues: ['madison', 'mentor']
            },
            {
                fullName: 'weed',
                label: 'weed',
                default: false,
                availableForControllingValues: ['cle', 'eastlake', 'madison', 'mentor', 'wickliffe', 'willoughby']
            },
            {
                fullName: 'mulch',
                label: 'mulch',
                default: false,
                availableForControllingValues: ['cle', 'eastlake', 'willoughby']
            },
            {
                fullName: 'rocks',
                label: 'rocks',
                default: false,
                availableForControllingValues: ['cle',  'wickliffe']
            }
       
        ];

        return expectedPicklistFieldDetails;
    
    }

    static getEmailXMLFieldDetail() {
        
        let xmlFieldDetail: XMLFieldDetail = {
            fieldType: "Email",
            apiName: "Email__c",
            fieldLabel: "Email"
        };

        return xmlFieldDetail;    
    }

    static getEmailFieldTypeXMLMarkup() {
        
        const xmlMarkup = `
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Email__c</fullName>
    <externalId>false</externalId>
    <label>Email</label>
    <required>false</required>
    <trackTrending>false</trackTrending>
    <type>Email</type>
    <unique>false</unique>
</CustomField>
`;

        return xmlMarkup;    
    }

    static getDateTimeFieldDetail() {

        let xmlFieldDetail: XMLFieldDetail = {
            fieldType: "DateTime",
            apiName: "DateTime__c",
            fieldLabel: "DateTime"
        };

        return xmlFieldDetail;
    }

    static getDateTimeFieldTypeXMLMarkup() {
        
        const datetimeXMLMarkup = `
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>DateTime__c</fullName>
    <label>DateTime</label>
    <required>false</required>
    <trackTrending>false</trackTrending>
    <type>DateTime</type>
</CustomField>
`;

        return datetimeXMLMarkup;

    }
    
    static getDateFieldDetail() {

        let xmlFieldDetail: XMLFieldDetail = {
            fieldType: "Date",
            apiName: "Date__c",
            fieldLabel: "Date"
        };

        return xmlFieldDetail;

    }

    static getDateFieldTypeXMLMarkup() {
        const dateXMLFieldMarkup = `
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Date__c</fullName>
    <label>Date</label>
    <required>false</required>
    <trackTrending>false</trackTrending>
    <type>Date</type>
</CustomField>
`;
        
        return dateXMLFieldMarkup;

    }
   
    static getCurrencyFieldDetail() {

        let xmlFieldDetail: XMLFieldDetail = {
            fieldType: "Currency",
            apiName: "Currency__c",
            fieldLabel: "Currency"
        };

        return xmlFieldDetail;

    }

    static getCurrencyFieldTypeXMLMarkup() {

        const currencyXMLMarkup = `
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Currency__c</fullName>
    <label>Currency</label>
    <precision>18</precision>
    <required>false</required>
    <scale>2</scale>
    <trackTrending>false</trackTrending>
    <type>Currency</type>
</CustomField>
`;

        return currencyXMLMarkup;

    }
    
    static getCheckboxFieldDetail() {

        let xmlFieldDetail: XMLFieldDetail = {
            fieldType: "Checkbox",
            apiName: "Checkbox__c",
            fieldLabel: "Checkbox"
        };

        return xmlFieldDetail;

    }

    static getCheckboxFieldTypeXMLMarkup() {

        const checkboxXMLMarkup = `
        <?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Checkbox__c</fullName>
    <defaultValue>false</defaultValue>
    <label>Checkbox</label>
    <trackTrending>false</trackTrending>
    <type>Checkbox</type>
</CustomField>
`;
        return checkboxXMLMarkup;
        
    }

    static getMultiSelectPicklistXMLFieldDetail(): XMLFieldDetail {

        const mockedMultiSelectPicklistValues = this.getIPicklistValuesForMultiSelectPickllist__c();
        const multiSelectPicklistXMLField: XMLFieldDetail = {
            fieldType: "MultiselectPicklist",
            apiName: "MultiPicklist__c",
            picklistValues: mockedMultiSelectPicklistValues,
            fieldLabel: "MultiPicklistTest"
        };

        return multiSelectPicklistXMLField;    
    
    }

    static getMultiSelectPicklistFieldTypeXMLMarkup():string {
        const xmlMultiSelectMarkup = `
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>MultiPicklist__c</fullName>
    <label>MultiPicklistTest</label>
    <required>false</required>
    <trackTrending>false</trackTrending>
    <type>MultiselectPicklist</type>
    <valueSet>
        <restricted>true</restricted>
        <valueSetDefinition>
            <sorted>false</sorted>
            <value>
                <fullName>chicken</fullName>
                <default>false</default>
                <label>chicken</label>
            </value>
            <value>
                <fullName>chorizo</fullName>
                <default>false</default>
                <label>chorizo</label>
            </value>
            <value>
                <fullName>egg</fullName>
                <default>false</default>
                <label>egg</label>
            </value>
            <value>
                <fullName>fish</fullName>
                <default>false</default>
                <label>fish</label>
            </value>
            <value>
                <fullName>pork</fullName>
                <default>false</default>
                <label>pork</label>
            </value>
            <value>
                <fullName>steak</fullName>
                <default>false</default>
                <label>steak</label>
            </value>
            <value>
                <fullName>tofu</fullName>
                <default>false</default>
                <label>tofu</label>
            </value>
        </valueSetDefinition>
    </valueSet>
    <visibleLines>4</visibleLines>
</CustomField>
`;
        return xmlMultiSelectMarkup;

    }

    static getPicklistFieldTypeXMLMarkup():string {

        const xmlPicklistMarkup = `
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Picklist__c</fullName>
    <label>Picklist</label>
    <required>false</required>
    <trackTrending>false</trackTrending>
    <type>Picklist</type>
    <valueSet>
        <restricted>true</restricted>
        <valueSetDefinition>
            <sorted>false</sorted>
            <value>
                <fullName>cle</fullName>
                <default>false</default>
                <label>cle</label>
            </value>
            <value>
                <fullName>eastlake</fullName>
                <default>false</default>
                <label>eastlake</label>
            </value>
            <value>
                <fullName>madison</fullName>
                <default>false</default>
                <label>madison</label>
            </value>
            <value>
                <fullName>mentor</fullName>
                <default>false</default>
                <label>mentor</label>
            </value>
            <value>
                <fullName>wickliffe</fullName>
                <default>false</default>
                <label>wickliffe</label>
            </value>
            <value>
                <fullName>willoughby</fullName>
                <default>false</default>
                <label>willoughby</label>
            </value>
        </valueSetDefinition>
    </valueSet>
</CustomField> 
`;
    
        return xmlPicklistMarkup;
    
    }

    static getPicklistXMLFieldDetail(): XMLFieldDetail {

        const mockedPicklistValues = this.getIPicklistValuesForPickllist__c();
        let picklistXMLField: XMLFieldDetail = {
            fieldType: "Picklist",
            apiName: "Picklist__c",
            picklistValues: mockedPicklistValues,
            fieldLabel: "Picklist"
        };

        return picklistXMLField;
        
    }

    static getIPicklistValuesForPickllist__c(): IPicklistValue[] {
        
        const expectedPicklistFieldDetails:IPicklistValue[] = [
            {
                fullName: 'cle',
                label: 'cle',
                default: false
            },
            {
                fullName: 'eastlake',
                label: 'eastlake',
                default: false
            },
            {
                fullName: 'madison',
                label: 'madison',
                default: false
            },
            {
                fullName: 'mentor',
                label: 'mentor',
                default: false
            },
            {
                fullName: 'wickliffe',
                label: 'wickliffe',
                default: false
            },
            {
                fullName: 'willoughby',
                label: 'willoughby',
                default: false
            }
        ];

        return expectedPicklistFieldDetails;
    
    }

    static getIPicklistValuesForMultiSelectPickllist__c(): IPicklistValue[] {
        
        const expectedPicklistFieldDetails:IPicklistValue[] = [
            {
                fullName: 'chicken',
                label: 'chicken',
                default: false
            },
            {
                fullName: 'chorizo',
                label: 'chorizo',
                default: false
            },
            {
                fullName: 'egg',
                label: 'egg',
                default: false
            },
            {
                fullName: 'fish',
                label: 'fish',
                default: false
            },
            {
                fullName: 'pork',
                label: 'pork',
                default: false
            },
            {
                fullName: 'steak',
                label: 'steak',
                default: false
            },
            {
                fullName: 'tofu',
                label: 'tofu',
                default: false
            }
        ];

        return expectedPicklistFieldDetails;
    
    }

    static getTextFieldTypeXMLMarkup():string {
        const xmlTextMarkup = `
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Text__c</fullName>
    <externalId>false</externalId>
    <label>Text</label>
    <length>255</length>
    <required>false</required>
    <trackTrending>false</trackTrending>
    <type>Text</type>
    <unique>false</unique>
</CustomField>
`;
        return xmlTextMarkup;

    }

    static getTextXMLFieldDetail():XMLFieldDetail {
        
        let textXMLFieldDetail: XMLFieldDetail = {
            fieldType: "Text",
            apiName: "Text__c",
            fieldLabel: "Text"
        };

        return textXMLFieldDetail;
    }


}
