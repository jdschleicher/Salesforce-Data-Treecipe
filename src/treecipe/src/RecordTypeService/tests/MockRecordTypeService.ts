

export class MockRecordTypeService {


    static getRecordTypeXMLContent(): string {

        const mockRecordTypeXMLContent = `
<?xml version="1.0" encoding="UTF-8"?>
<RecordType xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>OneRecType</fullName>
    <active>true</active>
    <label>OneRecType</label>
    <picklistValues>
        <picklist>DependentPicklist__c</picklist>
        <values>
            <fullName>mulch</fullName>
            <default>false</default>
        </values>
        <values>
            <fullName>plant</fullName>
            <default>false</default>
        </values>
        <values>
            <fullName>rocks</fullName>
            <default>false</default>
        </values>
        <values>
            <fullName>tree</fullName>
            <default>false</default>
        </values>
        <values>
            <fullName>weed</fullName>
            <default>false</default>
        </values>
    </picklistValues>
    <picklistValues>
        <picklist>MultiPicklist__c</picklist>
        <values>
            <fullName>chorizo</fullName>
            <default>false</default>
        </values>
        <values>
            <fullName>pork</fullName>
            <default>false</default>
        </values>
        <values>
            <fullName>steak</fullName>
            <default>false</default>
        </values>
        <values>
            <fullName>tofu</fullName>
            <default>false</default>
        </values>
    </picklistValues>
    <picklistValues>
        <picklist>Picklist__c</picklist>
        <values>
            <fullName>cle</fullName>
            <default>false</default>
        </values>
        <values>
            <fullName>eastlake</fullName>
            <default>false</default>
        </values>
    </picklistValues>
</RecordType>
        `;

        return mockRecordTypeXMLContent;

    }

    static getRecordTypeXMLAsObject(): any {
        
        const mockRecordTypeXML = {
            
            RecordType: {
                fullName: ['OneRecType'],
                active: [true],
                label: ['OneRecType'],
                picklistValues: [
                    {
                        picklist: ['DependentPicklist__c'],
                        values: [
                            { fullName: 'mulch', default: false },
                            { fullName: 'plant', default: false },
                            { fullName: 'rocks', default: false },
                            { fullName: 'tree', default: false },
                            { fullName: 'weed', default: false }
                        ]
                    },
                    {
                        picklist: ['MultiPicklist__c'],
                        values: [
                            { fullName: 'chorizo', default: false },
                            { fullName: 'pork', default: false },
                            { fullName: 'steak', default: false },
                            { fullName: 'tofu', default: false }
                        ]
                    },
                    {
                        picklist: ['Picklist__c'],
                        values: [
                            { fullName: 'cle', default: false },
                            { fullName: 'eastlake', default: false }
                        ]
                    }
                ]
            }
        };

        return mockRecordTypeXML;

    }


} 