

export class MockRecordTypeService {

    static getRecordTypeOneRecTypeXMLContent(): string {

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

    static getRecordTypeMockOneRecTypeAsObject(): any {

        const mockRecordTypeXML = {

            RecordType: {
                fullName: ['OneRecType'],
                active: [true],
                label: ['OneRecType'],
                picklistValues: [
                    {
                        picklist: ['DependentPicklist__c'],
                        values: [
                            { fullName: ['mulch'], default: false },
                            { fullName: ['plant'], default: false }
                        ]
                    },
                    {
                        picklist: ['MultiPicklist__c'],
                        values: [
                            { fullName: ['chorizo'], default: false },
                            { fullName: ['pork'], default: false },
                            { fullName: ['steak'], default: false },
                            { fullName: ['tofu'], default: false }
                        ]
                    },
                    {
                        picklist: ['Picklist__c'],
                        values: [
                            { fullName: ['cle'], default: false },
                            { fullName: ['eastlake'], default: false }
                        ]
                    }
                ]
            }
        };

        return mockRecordTypeXML;
    
    }

    static getRecordTypeTwoRecTypeXMLContent(): string {

        const mockTwoRecTypeRecordTypeXMLContent = `
<?xml version="1.0" encoding="UTF-8"?>
<RecordType xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>TwoRecType</fullName>
    <active>true</active>
    <label>TwoRecType</label>
    <picklistValues>
        <picklist>DependentPicklist__c</picklist>
        <values>
            <fullName>mulch</fullName>
            <default>false</default>
        </values>
        <values>
            <fullName>plant</fullName>
            <default>true</default>
        </values>
        <values>
            <fullName>rocks</fullName>
            <default>false</default>
        </values>
        <values>
            <fullName>tree</fullName>
            <default>false</default>
        </values>
    </picklistValues>
    <picklistValues>
        <picklist>MultiPicklist__c</picklist>
        <values>
            <fullName>chicken</fullName>
            <default>false</default>
        </values>
        <values>
            <fullName>egg</fullName>
            <default>false</default>
        </values>
        <values>
            <fullName>fish</fullName>
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
            <fullName>willoughby</fullName>
            <default>false</default>
        </values>
    </picklistValues>
</RecordType>
`;

        return mockTwoRecTypeRecordTypeXMLContent;

    }

    static getRecordTypeMockTwoRecTypeAsObject(): any {

        const mockTwoRecTypeRecordTypeXML = {
            RecordType: {
                fullName: ['TwoRecType'],
                active: [true],
                label: ['TwoRecType'],
                picklistValues: [
                    {
                        picklist: ['DependentPicklist__c'],
                        values: [
                            { fullName: ['mulch'], default: false },
                            { fullName: ['plant'], default: false },
                            { fullName: ['rocks'], default: false },
                            { fullName: ['tree'], default: false }
                        ]
                    },
                    {
                        picklist: ['MultiPicklist__c'],
                        values: [
                            { fullName: ['chicken'], default: false },
                            { fullName: ['egg'], default: false },
                            { fullName: ['fish'], default: false },
                            { fullName: ['tofu'], default: false }
                        ]
                    },
                    {
                        picklist: ['Picklist__c'],
                        values: [
                            { fullName: ['cle'], default: false },
                            { fullName: ['willoughby'], default: false }
                        ]
                    }
                ]
            }
        };

        return mockTwoRecTypeRecordTypeXML;

    }

    static getMultipleRecordTypeXMLObjectsMap(): Record<string, object> {
        
        return {
            OneRecType: this.getOneRecTypeFieldToPicklistValuesMap(),
            TwoRecType: this.getTwoRecTypeFieldToPicklistValuesMap()
        };

    }

    static getDependentPicklistControllingFieldToAvailablePicklistValues(): Record<string, string[]> {   

        const controllingValueToPicklistOptions: Record<string, string[]> = {
            cle: [
              'tree',
              'weed',
              'mulch',
              'rocks',
            ],
            eastlake: [
              'tree',
              'weed',
              'mulch',
            ],
            madison: [
              'plant',
              'tree',
            ],
            willoughby: [
              'tree',
              'mulch',
            ],
            mentor: [
              'weed',
              'plant',
            ],
            wickliffe: [
              'rocks',
            ],
          };

        return controllingValueToPicklistOptions;
    
    }

    static getCleControllingValueToDependentPicklistOptions():string {

        const cleControllingValueToPicklistOptions =       
        `
                    ### TODO: SELECT BELOW OPTIONS IF USING RECORD TYPE -- OneRecType
                    - mulch
                    ### TODO: SELECT BELOW OPTIONS IF USING RECORD TYPE -- TwoRecType
                    - mulch
                    - rocks
                    - tree`;

        return cleControllingValueToPicklistOptions;
    
    }

    static getMadisonControllingValueToDependentPicklistOptions():string {

        const madisionControllingValueToPicklistOptions =       
        `
                    ### TODO: SELECT BELOW OPTIONS IF USING RECORD TYPE -- OneRecType
                    - "madison" is not an available value for Picklist__c for this record type
                    ### TODO: SELECT BELOW OPTIONS IF USING RECORD TYPE -- TwoRecType
                    - "madison" is not an available value for Picklist__c for this record type`;

        return madisionControllingValueToPicklistOptions;
    
    }

    static getOneRecTypeFieldToPicklistValuesMap(): Record<string, string[]> {
        return {
            DependentPicklist__c: ['mulch', 'plant'],
            MultiPicklist__c: ['chorizo', 'pork', 'steak', 'tofu'],
            Picklist__c: ['cle', 'eastlake']
        };
    }

    static getTwoRecTypeFieldToPicklistValuesMap(): Record<string, string[]> {
        return {
            DependentPicklist__c: ['mulch', 'plant', 'rocks', 'tree'],
            MultiPicklist__c: ['chicken', 'egg', 'fish', 'tofu'],
            Picklist__c: ['cle', 'willoughby']
        };
    }


} 