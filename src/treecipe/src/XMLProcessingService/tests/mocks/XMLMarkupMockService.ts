import { IPicklistValue } from "../../../ObjectInfoWrapper/FieldInfo";
import { XMLFieldDetail } from "../../../XMLProcessingService/XMLFieldDetail";

export class XMLMarkupMockService {

    static getMasterDetailXMLFieldDetail() {

        const masterDetailXMLField: XMLFieldDetail = {
            fieldType: "MasterDetail",
            apiName: "MD_MegaMapMadness__c",
            fieldLabel: "MD MegaMapMadness",
            referenceTo: "MegaMapMadness__c",
            xmlMarkup: this.getMasterDetailFieldTypeXMLMarkup()
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
            fieldLabel: "Url",
            xmlMarkup: this.getUrlFieldTypeXMLMarkup()        };

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
            fieldLabel: "Time",
            xmlMarkup: this.getTimeFieldTypeXMLMarkup()        };

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
            fieldType: "Html",
            apiName: "TextAreaRich__c",
            fieldLabel: "TextAreaRich",
            xmlMarkup: this.getRichTextAreaFieldTypeXMLMarkup()        };

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
    <type>Html</type>
    <visibleLines>25</visibleLines>
</CustomField>        
`;

        return richTextAreaXMLMarkup;

    }

    static getLongTextAreaXMLFieldDetail() {

        const longTextAreaXMLField: XMLFieldDetail = {
            fieldType: "LongTextArea",
            apiName: "Text_Area_Long__c",
            fieldLabel: "Text Area Long",
            xmlMarkup: this.getLongTextAreaFieldTypeXMLMarkup()        };

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
            fieldLabel: "Phone",
            xmlMarkup: this.getPhoneFieldTypeXMLMarkup()        };

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
            fieldLabel: "Number",
            xmlMarkup: this.getNumberFieldTypeXMLMarkup()        };

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
            fieldLabel: "Geolocation",
            xmlMarkup: this.getGeolocationFieldTypeXMLMarkup()        };

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
            fieldLabel: "Formula",
            xmlMarkup: this.getFormulaFieldTypeXMLMarkup()        };

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
`;
        return formulaFieldMarkup;

    }

    static getLookupXMLFieldDetail() {

        const lookupXMLField: XMLFieldDetail = {
            fieldType: "Lookup",
            apiName: "Example_Everything_Lookup__c",
            fieldLabel: "Example Everything Lookup",
            referenceTo: "Example_Everything__c",
            xmlMarkup: this.getLookupFieldTypeXMLMarkup()        };

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
            controllingField: "Picklist__c",
            xmlMarkup: this.getDependentPicklistFieldTypeXMLMarkup()        };

        return dependentPicklistXMLField;      
    }

    static getDependentPicklistWithIsActiveXMLFieldDetail() {

        const mockedMultiSelectPicklistValues = this.getIPicklistValuesWithIsActiveConfigDependentPickllist__c();
        const dependentPicklistXMLField: XMLFieldDetail = {
            fieldType: "Picklist",
            apiName: "DependentPicklist__c",
            picklistValues: mockedMultiSelectPicklistValues,
            fieldLabel: "DependentPicklist",
            controllingField: "Picklist__c",
            xmlMarkup: this.getDependentPicklistFieldTypeWithIsActiveTagsXMLMarkup()        };

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

    static getDependentPicklistFieldTypeWithIsActiveTagsXMLMarkup() {
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
                <fullName>fancystone</fullName>
                <default>false</default>
                <isActive>false</isActive>
                <label>fancystone</label>
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
            <value>
                <fullName>moss</fullName>
                <default>false</default>
                <isActive>false</isActive>
                <label>moss</label>
            </value>
            <value>
                <fullName>hedges</fullName>
                <default>false</default>
                <isActive>true</isActive>
                <label>hedges</label>
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
        <valueSettings>
            <controllingFieldValue>cle</controllingFieldValue>
            <controllingFieldValue>eastlake</controllingFieldValue>
            <valueName>hedges</valueName>
        </valueSettings>
    </valueSet>
</CustomField>
`;

        return xmlMarkup;   
    
    }

    static getExpectedIsActiveDependentPicklistXMLDetail():XMLFieldDetail {
        
        const mockedMultiSelectPicklistValues = this.getIPicklistValuesWithIsActiveConfigDependentPickllist__c();
        const dependentPicklistXMLField: XMLFieldDetail = {
            fieldType: "Picklist",
            apiName: "DependentPicklist__c",
            picklistValues: mockedMultiSelectPicklistValues,
            fieldLabel: "DependentPicklist",
            controllingField: "Picklist__c",
            xmlMarkup: this.getDependentPicklistFieldTypeWithIsActiveTagsXMLMarkup()        };

        return dependentPicklistXMLField;         
    
    }

    static getIPicklistValuesForDependentPickllist__c(): IPicklistValue[] {
        
        const expectedPicklistFieldDetails:IPicklistValue[] = [
            {
                picklistOptionApiName: 'tree',
                label: 'tree',
                default: false,
                isActive: true,
                controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection: ['cle', 'eastlake', 'madison', 'willoughby']
            },
            {
                picklistOptionApiName: 'plant',
                label: 'plant',
                default: false,
                isActive: true,
                controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection: ['madison', 'mentor']
            },
            {
                picklistOptionApiName: 'weed',
                label: 'weed',
                default: false,
                isActive: true,
                controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection: ['cle', 'eastlake', 'madison', 'mentor', 'wickliffe', 'willoughby']
            },
            {
                picklistOptionApiName: 'mulch',
                label: 'mulch',
                default: false,
                isActive: true,
                controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection: ['cle', 'eastlake', 'willoughby']
            },
            {
                picklistOptionApiName: 'rocks',
                label: 'rocks',
                default: false,
                isActive: true,
                controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection: ['cle',  'wickliffe']
            }
       
        ];

        return expectedPicklistFieldDetails;
    
    }

    static getIPicklistValuesWithIsActiveConfigDependentPickllist__c(): IPicklistValue[] {
        
        const expectedPicklistFieldDetails:IPicklistValue[] = [
            {
                picklistOptionApiName: 'tree',
                label: 'tree',
                default: false,
                isActive: true,
                controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection: ['cle', 'eastlake', 'madison', 'willoughby']
            },
            {
                picklistOptionApiName: 'plant',
                label: 'plant',
                default: false,
                isActive: true,
                controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection: ['madison', 'mentor']
            },
            {
                picklistOptionApiName: 'fancystone',
                label: 'fancystone',
                default: false,
                controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection: null,
                isActive: false
            },
            {
                picklistOptionApiName: 'weed',
                label: 'weed',
                default: false,
                isActive: true,
                controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection: ['cle', 'eastlake', 'madison', 'mentor', 'wickliffe', 'willoughby']
            },
            {
                picklistOptionApiName: 'mulch',
                label: 'mulch',
                default: false,
                isActive: true,
                controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection: ['cle', 'eastlake', 'willoughby']
            },
            {
                picklistOptionApiName: 'rocks',
                label: 'rocks',
                default: false,
                isActive: true,
                controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection: ['cle',  'wickliffe']
            },
            {
                picklistOptionApiName: 'moss',
                label: 'moss',
                default: false,
                controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection: null,
                isActive: false
            },
            {
                picklistOptionApiName: 'hedges',
                label: 'hedges',
                default: false,
                controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection: ['cle', 'eastlake'],
                isActive: true
            }
       
        ];

        return expectedPicklistFieldDetails;
    
    }

    static getPicklistFieldSetToGlobalPicklistXMLFieldDetail() {

        const globalPicklistXMLField: XMLFieldDetail = {
            fieldType: "Picklist",
            apiName: "ValueSetPicklist",
            globalValueSetName: 'Value_Set_Picklist_VS',
            fieldLabel: "Value Set Picklist",
            xmlMarkup: this.getGlobalValueSetFieldXMLMarkup()        };

        return globalPicklistXMLField;      
    }

    static getGlobalValueSetFieldXMLMarkup() {

        const xmlMarkup = `                     
        <?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>ValueSetPicklist</fullName>
    <label>Value Set Picklist</label>
    <required>false</required>
    <trackFeedHistory>false</trackFeedHistory>
    <trackHistory>false</trackHistory>
    <trackTrending>false</trackTrending>
    <type>Picklist</type>
    <valueSet>
        <restricted>true</restricted>
        <valueSetName>Value_Set_Picklist_VS</valueSetName>
    </valueSet>
</CustomField>
`;

        return xmlMarkup;
    }

     static getExpectedStandardValueSetLeadSourcePicklistXMLFieldDetail() {

        const standardValueSetPicklistXMLField: XMLFieldDetail = {
            fieldType: "Picklist",
            apiName: "LeadSource",
            isStandardValueSet: true,
            fieldLabel: "LeadSource",
            xmlMarkup: this.getStandardValueSetLeadSourceXMLMarkup()
        };

        return standardValueSetPicklistXMLField;      
    }

    static getStandardValueSetLeadSourceXMLMarkup() {

        const xmlMarkup = `                     
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>LeadSource</fullName>
    <trackFeedHistory>false</trackFeedHistory>
    <type>Picklist</type>
</CustomField>
`;

        return xmlMarkup;
    }

    static getExpectedGlobalValueSetCLEGlobalPicklistXMLFieldDetail() {

        const globalValueSetPicklistXMLField: XMLFieldDetail = {
            fieldType: "Picklist",
            apiName: "CustomGlobalValueSet",
            isStandardValueSet: false,
            fieldLabel: "CustomGlobalValueSet",
            globalValueSetName: "CLEGlobal",
            xmlMarkup: this.getFieldGlobalValueSetCustomGlobalValueSetXMLMarkup()
        };

        return globalValueSetPicklistXMLField;      
    }

      static getFieldGlobalValueSetCustomGlobalValueSetXMLMarkup() {

        const xmlMarkup = `                     
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>GlobalValuePicklist__c</fullName>
    <description>the world</description>
    <externalId>false</externalId>
    <inlineHelpText>the world</inlineHelpText>
    <label>GlobalValuePicklist</label>
    <required>false</required>
    <trackTrending>false</trackTrending>
    <type>Picklist</type>
    <valueSet>
        <restricted>true</restricted>
        <valueSetName>CLEGlobal</valueSetName>
    </valueSet>
</CustomField>
`;

        return xmlMarkup;

    }

    static getCLEGlobalValueSetXMLMarkup() {

        const globalValueSetMarkup = `<?xml version="1.0" encoding="UTF-8"?>
<GlobalValueSet xmlns="http://soap.sforce.com/2006/04/metadata">
    <customValue>
        <fullName>guardians</fullName>
        <default>false</default>
        <label>guardians</label>
    </customValue>
    <customValue>
        <fullName>cavs</fullName>
        <default>false</default>
        <label>cavs</label>
    </customValue>
    <customValue>
        <fullName>browns</fullName>
        <default>false</default>
        <label>browns</label>
    </customValue>
    <customValue>
        <fullName>monsters</fullName>
        <default>false</default>
        <label>monsters</label>
    </customValue>
    <customValue>
        <fullName>crunch</fullName>
        <default>false</default>
        <label>crunch</label>
    </customValue>
    <masterLabel>CLEGlobal</masterLabel>
    <sorted>false</sorted>
</GlobalValueSet>
`;

        return globalValueSetMarkup;

    }

    static getOneEXTRACLEGlobalValueSetXMLMarkup() {

        const globalValueSetMarkup = `<?xml version="1.0" encoding="UTF-8"?>
<GlobalValueSet xmlns="http://soap.sforce.com/2006/04/metadata">
   <customValue>
        <fullName>captains</fullName>
        <default>false</default>
        <label>captains</label>
    </customValue>
    <customValue>
        <fullName>guardians</fullName>
        <default>false</default>
        <label>guardians</label>
    </customValue>
    <customValue>
        <fullName>cavs</fullName>
        <default>false</default>
        <label>cavs</label>
    </customValue>
    <customValue>
        <fullName>browns</fullName>
        <default>false</default>
        <label>browns</label>
    </customValue>
    <customValue>
        <fullName>monsters</fullName>
        <default>false</default>
        <label>monsters</label>
    </customValue>
    <customValue>
        <fullName>crunch</fullName>
        <default>false</default>
        <label>crunch</label>
    </customValue>
    <masterLabel>ExtraUpdatedCaptainsCLEGlobal</masterLabel>
    <sorted>false</sorted>
</GlobalValueSet>
`;

        return globalValueSetMarkup;

    }

    static getPlanetsGlobalValueSetXMLFileContent() {
        
        const planetsXmlFileContent = `<?xml version="1.0" encoding="UTF-8"?>
<GlobalValueSet xmlns="http://soap.sforce.com/2006/04/metadata">
    <customValue>
        <fullName>world</fullName>
        <default>false</default>
        <label>world</label>
    </customValue>
    <customValue>
        <fullName>earth</fullName>
        <default>false</default>
        <label>earth</label>
    </customValue>
    <customValue>
        <fullName>planet</fullName>
        <default>false</default>
        <label>planet</label>
    </customValue>
    <customValue>
        <fullName>mars</fullName>
        <default>false</default>
        <label>mars</label>
    </customValue>
    <customValue>
        <fullName>venus</fullName>
        <default>false</default>
        <label>venus</label>
    </customValue>
    <customValue>
        <fullName>neptune</fullName>
        <default>false</default>
        <label>neptune</label>
    </customValue>
    <customValue>
        <fullName>saturn</fullName>
        <default>false</default>
        <label>saturn</label>
    </customValue>
    <description>the planets of the milky way</description>
    <masterLabel>Planets</masterLabel>
    <sorted>false</sorted>
</GlobalValueSet>`;

        return planetsXmlFileContent;

    }

    static getExpectedStandardValueSetPicklistXMLFieldDetailThatIsntTrackedInValueSetMap() {

        const standardValueSetPicklistXMLField: XMLFieldDetail = {
            fieldType: "Picklist",
            apiName: "NoStandardValuesetPreconfigured",
            isStandardValueSet: true,
            fieldLabel: "NoStandardValuesetPreconfigured",
            xmlMarkup: this.getNoStandardValuesetPreconfiguredXMLMarkup()
        };

        return standardValueSetPicklistXMLField;      
    }

    static getNoStandardValuesetPreconfiguredXMLMarkup() {

        const xmlMarkup = `                     
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>NoStandardValuesetPreconfigured</fullName>
    <trackFeedHistory>false</trackFeedHistory>
    <type>Picklist</type>
</CustomField>
`;

        return xmlMarkup;
    }


    static getEmailXMLFieldDetail() {
        
        let xmlFieldDetail: XMLFieldDetail = {
            fieldType: "Email",
            apiName: "Email__c",
            fieldLabel: "Email",
            xmlMarkup: this.getEmailFieldTypeXMLMarkup()
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
            fieldLabel: "DateTime",
            xmlMarkup: this.getDateTimeFieldTypeXMLMarkup()
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
            fieldLabel: "Date",
            xmlMarkup: this.getDateFieldTypeXMLMarkup()
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
            fieldLabel: "Currency",
            xmlMarkup: this.getCurrencyFieldTypeXMLMarkup()
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
            fieldLabel: "Checkbox",
            xmlMarkup: this.getCheckboxFieldTypeXMLMarkup()
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
            fieldLabel: "MultiPicklistTest",
            xmlMarkup: this.getMultiSelectPicklistFieldTypeXMLMarkup()
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

    static getTypePicklistFieldTypeXMLMarkup():string {

        const xmlPicklistMarkup = `
        <?xml version="1.0" encoding="UTF-8" ?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Type__c</fullName>
    <description
    >The Type field categorizes experiences into specific activities like &quot;Tennis &amp; Pickleball,&quot; &quot;Swimming Pools,&quot; and &quot;Beaches &amp; Snorkeling,&quot; helping guests easily find and book preferred activities, and aiding resort organization.</description>
    <label>Type</label>
    <required>false</required>
    <trackTrending>false</trackTrending>
    <type>Picklist</type>
    <valueSet>
        <valueSetDefinition>
            <sorted>false</sorted>
            <value>
                <fullName>Adventure Activities</fullName>
                <default>false</default>
                <label>Adventure Activities</label>
            </value>
            <value>
                <fullName>Beaches &amp; Snorkeling</fullName>
                <default>false</default>
                <label>Beaches &amp; Snorkeling</label>
            </value>
            <value>
                <fullName>Cultural Tours &amp; Workshops</fullName>
                <default>false</default>
                <label>Cultural Tours &amp; Workshops</label>
            </value>
            <value>
                <fullName>Dining Experiences</fullName>
                <default>false</default>
                <label>Dining Experiences</label>
            </value>
            <value>
                <fullName>Family &amp; Kids&apos; Activities</fullName>
                <default>false</default>
                <label>Family &amp; Kids&apos; Activities</label>
            </value>
            <value>
                <fullName>Fitness &amp; Exercise</fullName>
                <default>false</default>
                <label>Fitness &amp; Exercise</label>
            </value>
            <value>
                <fullName>Golf</fullName>
                <default>false</default>
                <label>Golf</label>
            </value>
            <value>
                <fullName>Nature &amp; Eco Tours</fullName>
                <default>false</default>
                <label>Nature &amp; Eco Tours</label>
            </value>
            <value>
                <fullName>Nightlife &amp; Entertainment</fullName>
                <default>false</default>
                <label>Nightlife &amp; Entertainment</label>
            </value>
            <value>
                <fullName>Relaxation &amp; Quiet Zones</fullName>
                <default>false</default>
                <label>Relaxation &amp; Quiet Zones</label>
            </value>
            <value>
                <fullName>Spa &amp; Wellness</fullName>
                <default>false</default>
                <label>Spa &amp; Wellness</label>
            </value>
            <value>
                <fullName>Swimming Pools</fullName>
                <default>false</default>
                <label>Swimming Pools</label>
            </value>
            <value>
                <fullName>Tennis &amp; Pickleball</fullName>
                <default>false</default>
                <label>Tennis &amp; Pickleball</label>
            </value>
            <value>
                <fullName>Water Sports</fullName>
                <default>false</default>
                <label>Water Sports</label>
            </value>
        </valueSetDefinition>
    </valueSet>
</CustomField>
        `;

        return xmlPicklistMarkup;

    }

    static getTypePicklistXMLFieldDetail(): XMLFieldDetail {

        const mockedPicklistValues = this.getIPicklistValuesForType__c();
        let picklistXMLField: XMLFieldDetail = {
            fieldType: "Picklist",
            apiName: "Type__c",
            picklistValues: mockedPicklistValues,
            fieldLabel: "Type",
            xmlMarkup: this.getTypePicklistFieldTypeXMLMarkup()
        };

        return picklistXMLField;
        
    }

    static getPicklistXMLFieldDetail(): XMLFieldDetail {

        const mockedPicklistValues = this.getIPicklistValuesForPicklist__c();
        let picklistXMLField: XMLFieldDetail = {
            fieldType: "Picklist",
            apiName: "Picklist__c",
            picklistValues: mockedPicklistValues,
            fieldLabel: "Picklist",
            xmlMarkup: this.getPicklistFieldTypeXMLMarkup()
        };

        return picklistXMLField;
        
    }

    static getIPicklistValuesForType__c(): IPicklistValue[] {
        
        const expectedPicklistFieldDetails:IPicklistValue[] = [
            {
                picklistOptionApiName: 'Adventure Activities',
                label: 'Adventure Activities',
                default: false,
                isActive: true
            },
            {
                picklistOptionApiName: 'Beaches & Snorkeling',
                label: 'Beaches & Snorkeling',
                default: false,
                isActive: true
            },
            {
                picklistOptionApiName: 'Cultural Tours & Workshops',
                label: 'Cultural Tours & Workshops',
                default: false,
                isActive: true
            },
            {
                picklistOptionApiName: 'Dining Experiences',
                label: 'Dining Experiences',
                default: false,
                isActive: true
            },
            {
                picklistOptionApiName: "Family & Kids' Activities",
                label: "Family & Kids' Activities",
                default: false,
                isActive: true
            },
            {
                picklistOptionApiName: 'Fitness & Exercise',
                label: 'Fitness & Exercise',
                default: false,
                isActive: true
            },
            {
                picklistOptionApiName: 'Golf',
                label: 'Golf',
                default: false,
                isActive: true
            },
            {
                picklistOptionApiName: 'Nature & Eco Tours',
                label: 'Nature & Eco Tours',
                default: false,
                isActive: true
            },
            {
                picklistOptionApiName: 'Nightlife & Entertainment',
                label: 'Nightlife & Entertainment',
                default: false,
                isActive: true
            },
            {
                picklistOptionApiName: 'Relaxation & Quiet Zones',
                label: 'Relaxation & Quiet Zones',
                default: false,
                isActive: true
            },
            {
                picklistOptionApiName: 'Spa & Wellness',
                label: 'Spa & Wellness',
                default: false,
                isActive: true
            },
            {
                picklistOptionApiName: 'Swimming Pools',
                label: 'Swimming Pools',
                default: false,
                isActive: true
            },
            {
                picklistOptionApiName: 'Tennis & Pickleball',
                label: 'Tennis & Pickleball',
                default: false,
                isActive: true
            },
            {
                picklistOptionApiName: 'Water Sports',
                label: 'Water Sports',
                default: false,
                isActive: true
            }
        ];

        return expectedPicklistFieldDetails;
    
    }

    static getIPicklistValuesForPicklist__c(): IPicklistValue[] {
        
        const expectedPicklistFieldDetails:IPicklistValue[] = [
            {
                picklistOptionApiName: 'cle',
                label: 'cle',
                default: false,
                isActive: true
            },
            {
                picklistOptionApiName: 'eastlake',
                label: 'eastlake',
                default: false,
                isActive: true
            },
            {
                picklistOptionApiName: 'madison',
                label: 'madison',
                default: false,
                isActive: true
            },
            {
                picklistOptionApiName: 'mentor',
                label: 'mentor',
                default: false,
                isActive: true
            },
            {
                picklistOptionApiName: 'wickliffe',
                label: 'wickliffe',
                default: false,
                isActive: true
            },
            {
                picklistOptionApiName: 'willoughby',
                label: 'willoughby',
                default: false,
                isActive: true
            }
            

        ];

        return expectedPicklistFieldDetails;
    
    }

    static getIPicklistValuesForMultiSelectPickllist__c(): IPicklistValue[] {
        
        const expectedPicklistFieldDetails:IPicklistValue[] = [
            {
                picklistOptionApiName: 'chicken',
                label: 'chicken',
                default: false,
                isActive: true
            },
            {
                picklistOptionApiName: 'chorizo',
                label: 'chorizo',
                default: false,
                isActive: true
            },
            {
                picklistOptionApiName: 'egg',
                label: 'egg',
                default: false,
                isActive: true
            },
            {
                picklistOptionApiName: 'fish',
                label: 'fish',
                default: false,
                isActive: true
            },
            {
                picklistOptionApiName: 'pork',
                label: 'pork',
                default: false,
                isActive: true
            },
            {
                picklistOptionApiName: 'steak',
                label: 'steak',
                default: false,
                isActive: true
            },
            {
                picklistOptionApiName: 'tofu',
                label: 'tofu',
                default: false,
                isActive: true
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
            fieldLabel: "Text",
            xmlMarkup: this.getTextFieldTypeXMLMarkup()
        };

        return textXMLFieldDetail;
    }

    static getParseStringCLEGlobalValueSetMock() {
        const parseCLEGlobalAny = {
            GlobalValueSet: {
                customValue: [
                    {
                        fullName: [
                            'guardians'
                        ]
                    },
                    {
                         fullName: [
                            'cavs'
                        ]
                    },
                    {
                        fullName: [
                            'browns'
                        ]
                    },
                    {
                        fullName: [
                            'monsters'
                        ]
                    },
                    {
                        fullName: [
                            'crunch'
                        ]
                    }
                ],
                masterLabel: "CLEGlobal"
            }
        };

        return parseCLEGlobalAny;
    }


}
