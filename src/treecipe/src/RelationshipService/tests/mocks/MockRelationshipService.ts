import * as fs from 'fs';

export class MockRelationshipService {

    static getExpectTreeStructures() {
        let allTrees = [];

        const expectedAccountThruProductFamilyTreeObjects =
            this.getAccountThruProductFamilyTreeObjects();
        allTrees.push(expectedAccountThruProductFamilyTreeObjects);

        const expectedCaseThruVehicleObjects = this.getCaseThruVehicleObjects();
        allTrees.push(expectedCaseThruVehicleObjects);

        let leadTreeObjects = ["Lead"];
        allTrees.push(leadTreeObjects);

        const expectedPricebook2ThruPricebook2Objects =
            this.getPricebook2ThruPricebook2Objects();
        allTrees.push(expectedPricebook2ThruPricebook2Objects);

        const expectedManufacturingThruManufacturingObjects =
            this.getManufacturingThruManufacturingObjects();
        allTrees.push(expectedManufacturingThruManufacturingObjects);

        const expectedProductThruProductObjects =
            this.getProductThruProductObjects();
        allTrees.push(expectedProductThruProductObjects);

        return allTrees;
    }

    static getCaseThruVehicleObjects() {
        const caseTreeObjects = ["Case", "Vehicle__c"];

        return caseTreeObjects;
    }

    static getAccountThruProductFamilyTreeObjects() {
        return [
            "Account",
            "Contact",
            "User",
            "Opportunity",
            "MegaMapMadness__c",
            "Order__c",
            "Order_Item__c",
            "Example_Everything__c",
            "Product_Family__c",
            "Product__c",
        ];
    }

    static getPricebook2ThruPricebook2Objects() {
        const pricebook2Objects = ["Pricebook2"];
        return pricebook2Objects;
    }

    static getManufacturingThruManufacturingObjects() {
        const manufacturingTree = ["Manufacturing_Event__e"];
        return manufacturingTree;
    }

    static getProductThruProductObjects() {
        const productObjects = ["Product2"];
        return productObjects;
    }

    static getExpectedRelationshipTreesJson() {

        const relationshipTreesJsonWrapper = `
            [{"treeId":"tree_Account_1761581681939","topLevelObjects":["Account","User","Product_Family__c"],"allObjects":["Account","Contact","Example_Everything__c","Opportunity","Order__c","User","MasterDetailMadness__c","Order_Item__c","MegaMapMadness__c","Product__c","Product_Family__c"],"maxLevel":2},{"treeId":"tree_Case_1761581681939","topLevelObjects":["Vehicle__c"],"allObjects":["Case","Vehicle__c"],"maxLevel":1},{"treeId":"tree_Lead_1761581681939","topLevelObjects":["Lead"],"allObjects":["Lead"],"maxLevel":0},{"treeId":"tree_Manufacturing_Event__e_1761581681939","topLevelObjects":["Manufacturing_Event__e"],"allObjects":["Manufacturing_Event__e"],"maxLevel":0},{"treeId":"tree_Pricebook2_1761581681939","topLevelObjects":["Pricebook2"],"allObjects":["Pricebook2"],"maxLevel":0},{"treeId":"tree_Product2_1761581681939","topLevelObjects":["Product2"],"allObjects":["Product2"],"maxLevel":0}]
       `;

        return relationshipTreesJsonWrapper;
    }

    static getExpectedObjectToObjectInfoMap() {

        const filePathToExpectedObjectToObjectInfoMapJson = 'src/treecipe/src/RelationshipService/tests/mocks/expectedObjectToObjectInfoMap.json';
        const expectedObjectToObjectInfoMapJson = fs.readFileSync(filePathToExpectedObjectToObjectInfoMapJson, 'utf-8');
        // const rawData = fs.readFileSync(collectionsApiFile, 'utf-8');

        return expectedObjectToObjectInfoMapJson;

    }

//     static getExpectedObjectInfoJson() {
//         const objectInfoWJsonrapper = `
// {
//   "Account": {
//     "ApiName": "Account",
//     "FullRecipe": "\n- object: Account\n  nickname: Account_NickName\n  count: 1\n  fields:\n    Name: ${{ faker.company.name() }}\n    AccountNumber: ${{ faker.string.numeric(8) }}\n    AnnualRevenue: ${{ faker.string.numeric(7) }}\n    BillingStreet: ${{ faker.location.streetAddress() }}\n    BillingCity: ${{ faker.location.city() }}\n    BillingState: ${{ faker.location.state() }}\n    BillingPostalCode: ${{ faker.location.zipCode() }}\n    BillingCountry: ${{ faker.location.country() }}\n    Description: ${{ faker.company.catchPhrase() }}\n    Industry: ${{ faker.helpers.arrayElement(['Technology', 'Finance', 'Healthcare', 'Retail', 'Manufacturing', 'Education']) }}\n    NumberOfEmployees: ${{ faker.string.numeric(4) }}\n    Phone: |\n                    ${{ faker.phone.number({ style: 'national' }) }}\n    Rating: ${{ faker.helpers.arrayElement(['Hot', 'Warm', 'Cold']) }}\n    ShippingStreet: ${{ faker.location.streetAddress() }}\n    ShippingCity: ${{ faker.location.city() }}\n    ShippingState: ${{ faker.location.state() }}\n    ShippingPostalCode: ${{ faker.location.zipCode() }}\n    ShippingCountry: ${{ faker.location.country() }}\n    Sic: ${{ faker.string.numeric(4) }}\n    Type: ${{ faker.helpers.arrayElement(['Customer', 'Partner', 'Prospect']) }}\n    Website: ${{ faker.internet.domainName() }}\n    AccountSource: ${{ faker.helpers.arrayElement(['Web', 'Phone Inquiry', 'Partner Referral', 'Purchased List', 'Other']) }}\n    Active__c: ${{ faker.helpers.arrayElement(['No', 'Yes']) }}\n    CustomerPriority__c: ${{ faker.helpers.arrayElement(['High', 'Low', 'Medium']) }}\n    Jigsaw: ### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE\n    Number_of_Contacts__c: |\n                ${{ faker.number.int({ min: 0, max: 999999 }) }}\n    OwnerId: ### TODO -- REFERENCE ID REQUIRED\n    ParentId: \"FieldType Not Handled -- hierarchy does not exist in this programs Salesforce field map.\"\n    SLAExpirationDate__c: |\n                ${{ faker.date.between({ from: new Date('2023-01-01'), to: new Date() }).toISOString().split('T')[0] }}\n    SLASerialNumber__c: ${{ faker.lorem.text(5).substring(0, 255) }}\n    SLA__c: ${{ faker.helpers.arrayElement(['Gold', 'Silver', 'Platinum', 'Bronze']) }}\n    ShippingAddress: ### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE\n    SicDesc: ### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE\n    Site: ### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE\n    TickerSymbol: ### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE\n    UpsellOpportunity__c: ${{ faker.helpers.arrayElement(['Maybe', 'No', 'Yes']) }}",
//     "RelationshipDetail": {
//       "objectApiName": "Account",
//       "level": 0,
//       "parentObjectToFieldReferences": {},
//       "childObjectToFieldReferences": {
//         "Contact": [
//           "AccountId"
//         ],
//         "Example_Everything__c": [
//           "AccountLookup__c"
//         ],
//         "Opportunity": [
//           "AccountId"
//         ],
//         "Order__c": [
//           "Account__c"
//         ]
//       },
//       "isProcessed": true,
//       "relationshipTreeId": "tree_Account_1761643023450"
//     },
//     "Fields": [
//       {
//         "objectName": "Account",
//         "fieldName": "AccountSource",
//         "fieldLabel": "AccountSource",
//         "type": "Picklist",
//         "recipeValue": "${{ faker.helpers.arrayElement(['Web', 'Phone Inquiry', 'Partner Referral', 'Purchased List', 'Other']) }}"
//       },
//       {
//         "objectName": "Account",
//         "fieldName": "Active__c",
//         "fieldLabel": "Active",
//         "type": "Picklist",
//         "picklistValues": [
//           {
//             "picklistOptionApiName": "No",
//             "label": "No",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "Yes",
//             "label": "Yes",
//             "default": false,
//             "isActive": true
//           }
//         ],
//         "recipeValue": "${{ faker.helpers.arrayElement(['No', 'Yes']) }}"
//       },
//       {
//         "objectName": "Account",
//         "fieldName": "CustomerPriority__c",
//         "fieldLabel": "Customer Priority",
//         "type": "Picklist",
//         "picklistValues": [
//           {
//             "picklistOptionApiName": "High",
//             "label": "High",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "Low",
//             "label": "Low",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "Medium",
//             "label": "Medium",
//             "default": false,
//             "isActive": true
//           }
//         ],
//         "recipeValue": "${{ faker.helpers.arrayElement(['High', 'Low', 'Medium']) }}"
//       },
//       {
//         "objectName": "Account",
//         "fieldName": "Jigsaw",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "AUTO_GENERATED",
//         "recipeValue": "### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE"
//       },
//       {
//         "objectName": "Account",
//         "fieldName": "Number_of_Contacts__c",
//         "fieldLabel": "Number of Contacts",
//         "type": "Number",
//         "recipeValue": "|\n                ${{ faker.number.int({ min: 0, max: 999999 }) }}"
//       },
//       {
//         "objectName": "Account",
//         "fieldName": "OwnerId",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "Lookup",
//         "referenceTo": null,
//         "recipeValue": "### TODO -- REFERENCE ID REQUIRED"
//       },
//       {
//         "objectName": "Account",
//         "fieldName": "ParentId",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "Hierarchy",
//         "recipeValue": "\"FieldType Not Handled -- hierarchy does not exist in this programs Salesforce field map.\""
//       },
//       {
//         "objectName": "Account",
//         "fieldName": "SLAExpirationDate__c",
//         "fieldLabel": "SLA Expiration Date",
//         "type": "Date",
//         "recipeValue": "|\n                ${{ faker.date.between({ from: new Date('2023-01-01'), to: new Date() }).toISOString().split('T')[0] }}"
//       },
//       {
//         "objectName": "Account",
//         "fieldName": "SLASerialNumber__c",
//         "fieldLabel": "SLA Serial Number",
//         "type": "Text",
//         "recipeValue": "${{ faker.lorem.text(5).substring(0, 255) }}"
//       },
//       {
//         "objectName": "Account",
//         "fieldName": "SLA__c",
//         "fieldLabel": "SLA",
//         "type": "Picklist",
//         "picklistValues": [
//           {
//             "picklistOptionApiName": "Gold",
//             "label": "Gold",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "Silver",
//             "label": "Silver",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "Platinum",
//             "label": "Platinum",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "Bronze",
//             "label": "Bronze",
//             "default": false,
//             "isActive": true
//           }
//         ],
//         "recipeValue": "${{ faker.helpers.arrayElement(['Gold', 'Silver', 'Platinum', 'Bronze']) }}"
//       },
//       {
//         "objectName": "Account",
//         "fieldName": "ShippingAddress",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "AUTO_GENERATED",
//         "recipeValue": "### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE"
//       },
//       {
//         "objectName": "Account",
//         "fieldName": "SicDesc",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "AUTO_GENERATED",
//         "recipeValue": "### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE"
//       },
//       {
//         "objectName": "Account",
//         "fieldName": "Site",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "AUTO_GENERATED",
//         "recipeValue": "### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE"
//       },
//       {
//         "objectName": "Account",
//         "fieldName": "TickerSymbol",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "AUTO_GENERATED",
//         "recipeValue": "### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE"
//       },
//       {
//         "objectName": "Account",
//         "fieldName": "UpsellOpportunity__c",
//         "fieldLabel": "Upsell Opportunity",
//         "type": "Picklist",
//         "picklistValues": [
//           {
//             "picklistOptionApiName": "Maybe",
//             "label": "Maybe",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "No",
//             "label": "No",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "Yes",
//             "label": "Yes",
//             "default": false,
//             "isActive": true
//           }
//         ],
//         "recipeValue": "${{ faker.helpers.arrayElement(['Maybe', 'No', 'Yes']) }}"
//       }
//     ]
//   },
//   "Case": {
//     "ApiName": "Case",
//     "FullRecipe": "\n- object: Case\n  nickname: Case_NickName\n  count: 1\n  fields:\n    Subject: ${{ faker.company.catchPhrase() }}\n    Description: ${{ faker.lorem.paragraph() }}\n    Status: ${{ faker.helpers.arrayElement(['New', 'Working', 'Escalated', 'Closed']) }}\n    Origin: ${{ faker.helpers.arrayElement(['Email', 'Phone', 'Web', 'Social']) }}\n    Priority: ${{ faker.helpers.arrayElement(['High', 'Medium', 'Low']) }}\n    Type: ${{ faker.helpers.arrayElement(['Problem', 'Feature Request', 'Question']) }}\n    Reason: ${{ faker.helpers.arrayElement(['Installation', 'Equipment Complexity', 'Performance', 'Breakdown', 'Equipment Design', 'Feedback']) }}\n    SuppliedName: ${{ faker.person.fullName() }}\n    SuppliedEmail: ${{ faker.internet.email() }}\n    SuppliedPhone: |\n                    ${{ faker.phone.number({ style: 'national' }) }}\n    SuppliedCompany: ${{ faker.company.name() }}\n    Case_Category__c: ${{ faker.helpers.arrayElement(['Mechanical', 'Electrical', 'Electronic', 'Structural', 'Other']) }}\n    PotentialLiability__c: ${{ faker.helpers.arrayElement(['No', 'Yes']) }}\n    ProductId: ### TODO -- REFERENCE ID REQUIRED\n    Product__c: ${{ faker.helpers.arrayElement(['GC1040', 'GC1060', 'GC3020', 'GC3040', 'GC3060', 'GC5020', 'GC5040', 'GC5060', 'GC1020']) }}\n    SLAViolation__c: ${{ faker.helpers.arrayElement(['No', 'Yes']) }}\n    SlaExitDate: ### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE\n    SlaStartDate: ### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE\n    Vehicle__c: ### TODO -- REFERENCE ID REQUIRED",
//     "RelationshipDetail": {
//       "objectApiName": "Case",
//       "level": 1,
//       "parentObjectToFieldReferences": {
//         "Vehicle__c": [
//           "Vehicle__c"
//         ]
//       },
//       "childObjectToFieldReferences": {},
//       "isProcessed": true,
//       "relationshipTreeId": "tree_Case_1761643023450"
//     },
//     "Fields": [
//       {
//         "objectName": "Case",
//         "fieldName": "Case_Category__c",
//         "fieldLabel": "Case Category",
//         "type": "Picklist",
//         "picklistValues": [
//           {
//             "picklistOptionApiName": "Mechanical",
//             "label": "Mechanical",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "Electrical",
//             "label": "Electrical",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "Electronic",
//             "label": "Electronic",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "Structural",
//             "label": "Structural",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "Other",
//             "label": "Other",
//             "default": false,
//             "isActive": true
//           }
//         ],
//         "recipeValue": "${{ faker.helpers.arrayElement(['Mechanical', 'Electrical', 'Electronic', 'Structural', 'Other']) }}"
//       },
//       {
//         "objectName": "Case",
//         "fieldName": "PotentialLiability__c",
//         "fieldLabel": "Potential Liability",
//         "type": "Picklist",
//         "picklistValues": [
//           {
//             "picklistOptionApiName": "No",
//             "label": "No",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "Yes",
//             "label": "Yes",
//             "default": false,
//             "isActive": true
//           }
//         ],
//         "recipeValue": "${{ faker.helpers.arrayElement(['No', 'Yes']) }}"
//       },
//       {
//         "objectName": "Case",
//         "fieldName": "ProductId",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "Lookup",
//         "referenceTo": null,
//         "recipeValue": "### TODO -- REFERENCE ID REQUIRED"
//       },
//       {
//         "objectName": "Case",
//         "fieldName": "Product__c",
//         "fieldLabel": "Product",
//         "type": "Picklist",
//         "picklistValues": [
//           {
//             "picklistOptionApiName": "GC1040",
//             "label": "GC1040",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "GC1060",
//             "label": "GC1060",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "GC3020",
//             "label": "GC3020",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "GC3040",
//             "label": "GC3040",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "GC3060",
//             "label": "GC3060",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "GC5020",
//             "label": "GC5020",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "GC5040",
//             "label": "GC5040",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "GC5060",
//             "label": "GC5060",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "GC1020",
//             "label": "GC1020",
//             "default": false,
//             "isActive": true
//           }
//         ],
//         "recipeValue": "${{ faker.helpers.arrayElement(['GC1040', 'GC1060', 'GC3020', 'GC3040', 'GC3060', 'GC5020', 'GC5040', 'GC5060', 'GC1020']) }}"
//       },
//       {
//         "objectName": "Case",
//         "fieldName": "SLAViolation__c",
//         "fieldLabel": "SLA Violation",
//         "type": "Picklist",
//         "picklistValues": [
//           {
//             "picklistOptionApiName": "No",
//             "label": "No",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "Yes",
//             "label": "Yes",
//             "default": false,
//             "isActive": true
//           }
//         ],
//         "recipeValue": "${{ faker.helpers.arrayElement(['No', 'Yes']) }}"
//       },
//       {
//         "objectName": "Case",
//         "fieldName": "SlaExitDate",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "AUTO_GENERATED",
//         "recipeValue": "### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE"
//       },
//       {
//         "objectName": "Case",
//         "fieldName": "SlaStartDate",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "AUTO_GENERATED",
//         "recipeValue": "### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE"
//       },
//       {
//         "objectName": "Case",
//         "fieldName": "Vehicle__c",
//         "fieldLabel": "Vehicle",
//         "type": "Lookup",
//         "referenceTo": "Vehicle__c",
//         "recipeValue": "### TODO -- REFERENCE ID REQUIRED"
//       }
//     ]
//   },
//   "Vehicle__c": {
//     "ApiName": "Vehicle__c",
//     "RelationshipDetail": {
//       "objectApiName": "Vehicle__c",
//       "level": 0,
//       "parentObjectToFieldReferences": {},
//       "childObjectToFieldReferences": {
//         "Case": [
//           "Vehicle__c"
//         ]
//       },
//       "isProcessed": true,
//       "relationshipTreeId": "tree_Case_1761643023450"
//     }
//   },
//   "Contact": {
//     "ApiName": "Contact",
//     "FullRecipe": "\n- object: Contact\n  nickname: Contact_NickName\n  count: 1\n  fields:\n    FirstName: ${{ faker.person.firstName() }}\n    LastName: ${{ faker.person.lastName() }}\n    Email: ${{ faker.internet.email() }}\n    Phone: |\n                    ${{ faker.phone.number({ style: 'national' }) }}\n    MobilePhone: |\n                    ${{ faker.phone.number({ style: 'national' }) }}\n    Title: ${{ faker.job }}\n    Department: ${{ faker.helpers.arrayElement(['Sales', 'Marketing', 'IT', 'Finance', 'HR', 'Operations']) }}\n    Birthdate: ${{ faker.date.birthdate() }}\n    Description: ${{ faker.lorem.paragraph() }}\n    MailingStreet: ${{ faker.location.streetAddress() }}\n    MailingCity: ${{ faker.location.city() }}\n    MailingState: ${{ faker.location.state() }}\n    MailingPostalCode: ${{ faker.location.zipCode() }}\n    MailingCountry: ${{ faker.location.country() }}\n    OtherStreet: ${{ faker.location.streetAddress() }}\n    OtherCity: ${{ faker.location.city() }}\n    OtherState: ${{ faker.location.state() }}\n    OtherPostalCode: ${{ faker.location.zipCode() }}\n    OtherCountry: ${{ faker.location.country() }}\n    LeadSource: ${{ faker.helpers.arrayElement(['Web', 'Phone Inquiry', 'Partner', 'Purchased List', 'Other']) }}\n    Salutation: ${{ faker.helpers.arrayElement(['Mr.', 'Ms.', 'Mrs.', 'Dr.']) }}\n    AssistantName: ${{ faker.person.fullName() }}\n    AssistantPhone: |\n                    ${{ faker.phone.number({ style: 'national' }) }}\n    AccountId: ### TODO -- REFERENCE ID REQUIRED\n    Name: ### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE\n    OtherAddress: ### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE\n    ReportsToId: ### TODO -- REFERENCE ID REQUIRED\n    UserOfAContact_1__c: ### TODO -- REFERENCE ID REQUIRED\n    Userlookup_2__c: ### TODO -- REFERENCE ID REQUIRED",
//     "RelationshipDetail": {
//       "objectApiName": "Contact",
//       "level": 1,
//       "parentObjectToFieldReferences": {
//         "Account": [
//           "AccountId"
//         ],
//         "User": [
//           "UserOfAContact_1__c",
//           "Userlookup_2__c"
//         ]
//       },
//       "childObjectToFieldReferences": {
//         "MasterDetailMadness__c": [
//           "LU_Contact__c"
//         ]
//       },
//       "isProcessed": true,
//       "relationshipTreeId": "tree_Account_1761643023450"
//     },
//     "Fields": [
//       {
//         "objectName": "Contact",
//         "fieldName": "AccountId",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "Lookup",
//         "referenceTo": null,
//         "recipeValue": "### TODO -- REFERENCE ID REQUIRED"
//       },
//       {
//         "objectName": "Contact",
//         "fieldName": "Name",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "AUTO_GENERATED",
//         "recipeValue": "### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE"
//       },
//       {
//         "objectName": "Contact",
//         "fieldName": "OtherAddress",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "AUTO_GENERATED",
//         "recipeValue": "### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE"
//       },
//       {
//         "objectName": "Contact",
//         "fieldName": "ReportsToId",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "Lookup",
//         "referenceTo": null,
//         "recipeValue": "### TODO -- REFERENCE ID REQUIRED"
//       },
//       {
//         "objectName": "Contact",
//         "fieldName": "UserOfAContact_1__c",
//         "fieldLabel": "UserOfAContact_1",
//         "type": "Lookup",
//         "referenceTo": "User",
//         "recipeValue": "### TODO -- REFERENCE ID REQUIRED"
//       },
//       {
//         "objectName": "Contact",
//         "fieldName": "Userlookup_2__c",
//         "fieldLabel": "Userlookup_2",
//         "type": "Lookup",
//         "referenceTo": "User",
//         "recipeValue": "### TODO -- REFERENCE ID REQUIRED"
//       }
//     ]
//   },
//   "User": {
//     "ApiName": "User",
//     "RelationshipDetail": {
//       "objectApiName": "User",
//       "level": 0,
//       "parentObjectToFieldReferences": {},
//       "childObjectToFieldReferences": {
//         "Contact": [
//           "UserOfAContact_1__c",
//           "Userlookup_2__c"
//         ],
//         "MegaMapMadness__c": [
//           "LUOne_User__c",
//           "LUTwo_User__c"
//         ]
//       },
//       "isProcessed": true,
//       "relationshipTreeId": "tree_Account_1761643023450"
//     },
//     "FullRecipe": "\n- object: User\n  nickname: User_NickName\n  count: 1\n  fields:",
//     "Fields": []
//   },
//   "Example_Everything__c": {
//     "ApiName": "Example_Everything__c",
//     "FullRecipe": "\n- object: Example_Everything__c\n  nickname: Example_Everything__c_NickName\n  count: 1\n  fields:\n    RecordTypeId: ### TODO: -- RecordType Options -- From below, choose the expected Record Type Developer Name and ensure the rest of fields on this object recipe is consistent with the record type selection\n                    Example_Everything__c.OneRecType\n                    Example_Everything__c.TwoRecType\n    AccountLookup__c: ### TODO -- REFERENCE ID REQUIRED\n    Checkbox__c: ${{ faker.datatype.boolean() }}\n    Currency__c: ${{ faker.finance.amount(0, 999999, 2) }}\n    DateOne__c: |\n                ${{ faker.date.between({ from: new Date('2023-01-01'), to: new Date() }).toISOString().split('T')[0] }}\n    DateTimeOne__c: |\n                ${{ faker.date.between({ from: new Date('2023-01-01T00:00:00Z'), to: new Date() }).toISOString() }}\n    DateTimeTwo__c: |\n                ${{ faker.date.between({ from: new Date('2023-01-01T00:00:00Z'), to: new Date() }).toISOString() }}\n    DateTime__c: |\n                ${{ faker.date.between({ from: new Date('2023-01-01T00:00:00Z'), to: new Date() }).toISOString() }}\n    DateTwo__c: |\n                ${{ faker.date.between({ from: new Date('2023-01-01'), to: new Date() }).toISOString().split('T')[0] }}\n    Date__c: |\n                ${{ faker.date.between({ from: new Date('2023-01-01'), to: new Date() }).toISOString().split('T')[0] }}\n    DependentPicklist__c: \n      if:\n        - choice:\n            when: ${{ Picklist__c == 'cle'}}\n            pick:\n                random_choice:\n                    - tree\n                    - weed\n                    - mulch\n                    - rocks\n                    ### TODO: -- RecordType Options -- OneRecType -- SELECT THIS SECTION OF OPTIONS IF USING RECORD TYPE -- OneRecType\n                    - mulch\n                    - rocks\n                    - tree\n                    - weed\n                    ### TODO: -- RecordType Options -- TwoRecType -- SELECT THIS SECTION OF OPTIONS IF USING RECORD TYPE -- TwoRecType\n                    - mulch\n                    - plant\n                    - rocks\n                    - tree\n        - choice:\n            when: ${{ Picklist__c == 'eastlake'}}\n            pick:\n                random_choice:\n                    - tree\n                    - weed\n                    - mulch\n                    ### TODO: -- RecordType Options -- OneRecType -- SELECT THIS SECTION OF OPTIONS IF USING RECORD TYPE -- OneRecType\n                    - mulch\n                    - rocks\n                    - tree\n                    - weed\n                    ### TODO: -- RecordType Options -- TwoRecType -- \"eastlake\" is not an available value for Picklist__c for record type TwoRecType\n        - choice:\n            when: ${{ Picklist__c == 'madison'}}\n            pick:\n                random_choice:\n                    - tree\n                    - plant\n                    - weed\n                    ### TODO: -- RecordType Options -- OneRecType -- \"madison\" is not an available value for Picklist__c for record type OneRecType\n                    ### TODO: -- RecordType Options -- TwoRecType -- \"madison\" is not an available value for Picklist__c for record type TwoRecType\n        - choice:\n            when: ${{ Picklist__c == 'willoughby'}}\n            pick:\n                random_choice:\n                    - tree\n                    - weed\n                    - mulch\n                    ### TODO: -- RecordType Options -- OneRecType -- \"willoughby\" is not an available value for Picklist__c for record type OneRecType\n                    ### TODO: -- RecordType Options -- TwoRecType -- SELECT THIS SECTION OF OPTIONS IF USING RECORD TYPE -- TwoRecType\n                    - mulch\n                    - plant\n                    - rocks\n                    - tree\n        - choice:\n            when: ${{ Picklist__c == 'mentor'}}\n            pick:\n                random_choice:\n                    - plant\n                    - weed\n                    ### TODO: -- RecordType Options -- OneRecType -- \"mentor\" is not an available value for Picklist__c for record type OneRecType\n                    ### TODO: -- RecordType Options -- TwoRecType -- \"mentor\" is not an available value for Picklist__c for record type TwoRecType\n        - choice:\n            when: ${{ Picklist__c == 'wickliffe'}}\n            pick:\n                random_choice:\n                    - weed\n                    - rocks\n                    ### TODO: -- RecordType Options -- OneRecType -- \"wickliffe\" is not an available value for Picklist__c for record type OneRecType\n                    ### TODO: -- RecordType Options -- TwoRecType -- \"wickliffe\" is not an available value for Picklist__c for record type TwoRecType\n    Email__c: ${{ faker.internet.email() }}\n    Example_Everything_Lookup__c: ### TODO -- REFERENCE ID REQUIRED\n    Formula__c: |\n                ${{ faker.number.int({ min: 0, max: 999999 }) }}\n    Geolocation__c: ### TODO -- SEE ONE PAGER - https://gist.github.com/jdschleicher/4abfd188a933598833285ee76e560445\n    GlobalValuePicklist__c: ### TODO: This picklist field needs manually updated with either a standard value set list or global value set\n    MultiPicklist__c: ${{ (faker.helpers.arrayElements(['chicken', 'chorizo', 'egg', 'fish', 'pork', 'steak', 'tofu'])).join(';')}}\n                    ### TODO: -- RecordType Options -- OneRecType -- Below is the Multiselect faker recipe for the record type OneRecType for the field MultiPicklist__c\n                    ${{ (faker.helpers.arrayElements(['chorizo', 'pork', 'steak', 'tofu'])).join(';')}}\n                    ### TODO: -- RecordType Options -- TwoRecType -- Below is the Multiselect faker recipe for the record type TwoRecType for the field MultiPicklist__c\n                    ${{ (faker.helpers.arrayElements(['chicken', 'egg', 'fish', 'tofu'])).join(';')}}\n    Number__c: |\n                ${{ faker.number.int({ min: 0, max: 999999 }) }}\n    Percent__c: |\n                ${{ faker.number.float({ min: 0, max: 99, precision: 0.01 }).toFixed(2) }}\n    Phone__c: |\n                ${{ faker.phone.number({ style: 'national' }) }}\n    Picklist__c: ${{ faker.helpers.arrayElement(['cle', 'eastlake', 'madison', 'mentor', 'wickliffe', 'willoughby']) }}\n                    ### TODO: -- RecordType Options -- OneRecType -- Below is the faker recipe for the record type OneRecType for the field Picklist__c\n                    ${{ faker.helpers.arrayElement(['cle', 'eastlake']) }}\n                    ### TODO: -- RecordType Options -- TwoRecType -- Below is the faker recipe for the record type TwoRecType for the field Picklist__c\n                    ${{ faker.helpers.arrayElement(['cle', 'willoughby']) }}\n    PlanetGlobalValuePicklist__c: ### TODO: This picklist field needs manually updated with either a standard value set list or global value set\n    RichTextAreaHtml__c: ${{ faker.string.alpha(10) }}\n    TextAreaRich__c: ${{ faker.string.alpha(10) }}\n    Text_Area_Long__c: ${{ faker.lorem.text(100) }}\n    Text__c: ${{ faker.lorem.text(5).substring(0, 255) }}\n    Time__c: |\n                ${{ faker.date.between({ from: new Date('1970-01-01T00:00:00Z'), to: new Date('1970-01-01T23:59:59Z') }).toISOString().split('T')[1] }}\n    Url__c: ${{ faker.internet.url() }}\n    gfh__c: \n      if:\n        - choice:\n            when: ${{ nv__c == 'a'}}\n            pick:\n                random_choice:\n                    - 1\n                    - 2\n                    ### TODO: -- RecordType Options -- OneRecType -- \"a\" is not an available value for nv__c for record type OneRecType\n                    ### TODO: -- RecordType Options -- TwoRecType -- \"a\" is not an available value for nv__c for record type TwoRecType\n        - choice:\n            when: ${{ nv__c == 'b'}}\n            pick:\n                random_choice:\n                    - 3\n                    ### TODO: -- RecordType Options -- OneRecType -- \"b\" is not an available value for nv__c for record type OneRecType\n                    ### TODO: -- RecordType Options -- TwoRecType -- \"b\" is not an available value for nv__c for record type TwoRecType\n        - choice:\n            when: ${{ nv__c == 'c'}}\n            pick:\n                random_choice:\n                    - 3\n                    - 4\n                    ### TODO: -- RecordType Options -- OneRecType -- \"c\" is not an available value for nv__c for record type OneRecType\n                    ### TODO: -- RecordType Options -- TwoRecType -- \"c\" is not an available value for nv__c for record type TwoRecType",
//     "RelationshipDetail": {
//       "objectApiName": "Example_Everything__c",
//       "level": 1,
//       "parentObjectToFieldReferences": {
//         "Account": [
//           "AccountLookup__c"
//         ],
//         "Example_Everything__c": [
//           "Example_Everything_Lookup__c"
//         ]
//       },
//       "childObjectToFieldReferences": {
//         "Example_Everything__c": [
//           "Example_Everything_Lookup__c"
//         ]
//       },
//       "isProcessed": true,
//       "relationshipTreeId": "tree_Account_1761643023450"
//     },
//     "Fields": [
//       {
//         "objectName": "Example_Everything__c",
//         "fieldName": "AccountLookup__c",
//         "fieldLabel": "AccountLookup",
//         "type": "Lookup",
//         "referenceTo": "Account",
//         "recipeValue": "### TODO -- REFERENCE ID REQUIRED"
//       },
//       {
//         "objectName": "Example_Everything__c",
//         "fieldName": "Checkbox__c",
//         "fieldLabel": "Checkbox",
//         "type": "Checkbox",
//         "recipeValue": "${{ faker.datatype.boolean() }}"
//       },
//       {
//         "objectName": "Example_Everything__c",
//         "fieldName": "Currency__c",
//         "fieldLabel": "Currency",
//         "type": "Currency",
//         "recipeValue": "${{ faker.finance.amount(0, 999999, 2) }}"
//       },
//       {
//         "objectName": "Example_Everything__c",
//         "fieldName": "DateOne__c",
//         "fieldLabel": "DateOne",
//         "type": "Date",
//         "recipeValue": "|\n                ${{ faker.date.between({ from: new Date('2023-01-01'), to: new Date() }).toISOString().split('T')[0] }}"
//       },
//       {
//         "objectName": "Example_Everything__c",
//         "fieldName": "DateTimeOne__c",
//         "fieldLabel": "DateTimeOne",
//         "type": "DateTime",
//         "recipeValue": "|\n                ${{ faker.date.between({ from: new Date('2023-01-01T00:00:00Z'), to: new Date() }).toISOString() }}"
//       },
//       {
//         "objectName": "Example_Everything__c",
//         "fieldName": "DateTimeTwo__c",
//         "fieldLabel": "DateTimeTwo",
//         "type": "DateTime",
//         "recipeValue": "|\n                ${{ faker.date.between({ from: new Date('2023-01-01T00:00:00Z'), to: new Date() }).toISOString() }}"
//       },
//       {
//         "objectName": "Example_Everything__c",
//         "fieldName": "DateTime__c",
//         "fieldLabel": "DateTime",
//         "type": "DateTime",
//         "recipeValue": "|\n                ${{ faker.date.between({ from: new Date('2023-01-01T00:00:00Z'), to: new Date() }).toISOString() }}"
//       },
//       {
//         "objectName": "Example_Everything__c",
//         "fieldName": "DateTwo__c",
//         "fieldLabel": "DateTwo",
//         "type": "Date",
//         "recipeValue": "|\n                ${{ faker.date.between({ from: new Date('2023-01-01'), to: new Date() }).toISOString().split('T')[0] }}"
//       },
//       {
//         "objectName": "Example_Everything__c",
//         "fieldName": "Date__c",
//         "fieldLabel": "Date",
//         "type": "Date",
//         "recipeValue": "|\n                ${{ faker.date.between({ from: new Date('2023-01-01'), to: new Date() }).toISOString().split('T')[0] }}"
//       },
//       {
//         "objectName": "Example_Everything__c",
//         "fieldName": "DependentPicklist__c",
//         "fieldLabel": "DependentPicklist",
//         "type": "Picklist",
//         "picklistValues": [
//           {
//             "picklistOptionApiName": "tree",
//             "label": "tree",
//             "default": false,
//             "isActive": true,
//             "controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection": [
//               "cle",
//               "eastlake",
//               "madison",
//               "willoughby"
//             ]
//           },
//           {
//             "picklistOptionApiName": "plant",
//             "label": "plant",
//             "default": false,
//             "isActive": true,
//             "controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection": [
//               "madison",
//               "mentor"
//             ]
//           },
//           {
//             "picklistOptionApiName": "weed",
//             "label": "weed",
//             "default": false,
//             "isActive": true,
//             "controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection": [
//               "cle",
//               "eastlake",
//               "madison",
//               "mentor",
//               "wickliffe",
//               "willoughby"
//             ]
//           },
//           {
//             "picklistOptionApiName": "mulch",
//             "label": "mulch",
//             "default": false,
//             "isActive": true,
//             "controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection": [
//               "cle",
//               "eastlake",
//               "willoughby"
//             ]
//           },
//           {
//             "picklistOptionApiName": "rocks",
//             "label": "rocks",
//             "default": false,
//             "isActive": true,
//             "controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection": [
//               "cle",
//               "wickliffe"
//             ]
//           }
//         ],
//         "controllingField": "Picklist__c",
//         "recipeValue": "\n      if:\n        - choice:\n            when: ${{ Picklist__c == 'cle'}}\n            pick:\n                random_choice:\n                    - tree\n                    - weed\n                    - mulch\n                    - rocks\n                    ### TODO: -- RecordType Options -- OneRecType -- SELECT THIS SECTION OF OPTIONS IF USING RECORD TYPE -- OneRecType\n                    - mulch\n                    - rocks\n                    - tree\n                    - weed\n                    ### TODO: -- RecordType Options -- TwoRecType -- SELECT THIS SECTION OF OPTIONS IF USING RECORD TYPE -- TwoRecType\n                    - mulch\n                    - plant\n                    - rocks\n                    - tree\n        - choice:\n            when: ${{ Picklist__c == 'eastlake'}}\n            pick:\n                random_choice:\n                    - tree\n                    - weed\n                    - mulch\n                    ### TODO: -- RecordType Options -- OneRecType -- SELECT THIS SECTION OF OPTIONS IF USING RECORD TYPE -- OneRecType\n                    - mulch\n                    - rocks\n                    - tree\n                    - weed\n                    ### TODO: -- RecordType Options -- TwoRecType -- \"eastlake\" is not an available value for Picklist__c for record type TwoRecType\n        - choice:\n            when: ${{ Picklist__c == 'madison'}}\n            pick:\n                random_choice:\n                    - tree\n                    - plant\n                    - weed\n                    ### TODO: -- RecordType Options -- OneRecType -- \"madison\" is not an available value for Picklist__c for record type OneRecType\n                    ### TODO: -- RecordType Options -- TwoRecType -- \"madison\" is not an available value for Picklist__c for record type TwoRecType\n        - choice:\n            when: ${{ Picklist__c == 'willoughby'}}\n            pick:\n                random_choice:\n                    - tree\n                    - weed\n                    - mulch\n                    ### TODO: -- RecordType Options -- OneRecType -- \"willoughby\" is not an available value for Picklist__c for record type OneRecType\n                    ### TODO: -- RecordType Options -- TwoRecType -- SELECT THIS SECTION OF OPTIONS IF USING RECORD TYPE -- TwoRecType\n                    - mulch\n                    - plant\n                    - rocks\n                    - tree\n        - choice:\n            when: ${{ Picklist__c == 'mentor'}}\n            pick:\n                random_choice:\n                    - plant\n                    - weed\n                    ### TODO: -- RecordType Options -- OneRecType -- \"mentor\" is not an available value for Picklist__c for record type OneRecType\n                    ### TODO: -- RecordType Options -- TwoRecType -- \"mentor\" is not an available value for Picklist__c for record type TwoRecType\n        - choice:\n            when: ${{ Picklist__c == 'wickliffe'}}\n            pick:\n                random_choice:\n                    - weed\n                    - rocks\n                    ### TODO: -- RecordType Options -- OneRecType -- \"wickliffe\" is not an available value for Picklist__c for record type OneRecType\n                    ### TODO: -- RecordType Options -- TwoRecType -- \"wickliffe\" is not an available value for Picklist__c for record type TwoRecType"
//       },
//       {
//         "objectName": "Example_Everything__c",
//         "fieldName": "Email__c",
//         "fieldLabel": "Email",
//         "type": "Email",
//         "recipeValue": "${{ faker.internet.email() }}"
//       },
//       {
//         "objectName": "Example_Everything__c",
//         "fieldName": "Example_Everything_Lookup__c",
//         "fieldLabel": "Example Everything Lookup",
//         "type": "Lookup",
//         "referenceTo": "Example_Everything__c",
//         "recipeValue": "### TODO -- REFERENCE ID REQUIRED"
//       },
//       {
//         "objectName": "Example_Everything__c",
//         "fieldName": "Formula__c",
//         "fieldLabel": "Formula",
//         "type": "Number",
//         "recipeValue": "|\n                ${{ faker.number.int({ min: 0, max: 999999 }) }}"
//       },
//       {
//         "objectName": "Example_Everything__c",
//         "fieldName": "Geolocation__c",
//         "fieldLabel": "Geolocation",
//         "type": "Location",
//         "recipeValue": "### TODO -- SEE ONE PAGER - https://gist.github.com/jdschleicher/4abfd188a933598833285ee76e560445"
//       },
//       {
//         "objectName": "Example_Everything__c",
//         "fieldName": "GlobalValuePicklist__c",
//         "fieldLabel": "GlobalValuePicklist",
//         "type": "Picklist",
//         "recipeValue": "### TODO: This picklist field needs manually updated with either a standard value set list or global value set"
//       },
//       {
//         "objectName": "Example_Everything__c",
//         "fieldName": "MultiPicklist__c",
//         "fieldLabel": "MultiPicklist",
//         "type": "MultiselectPicklist",
//         "picklistValues": [
//           {
//             "picklistOptionApiName": "chicken",
//             "label": "chicken",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "chorizo",
//             "label": "chorizo",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "egg",
//             "label": "egg",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "fish",
//             "label": "fish",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "pork",
//             "label": "pork",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "steak",
//             "label": "steak",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "tofu",
//             "label": "tofu",
//             "default": false,
//             "isActive": true
//           }
//         ],
//         "recipeValue": "${{ (faker.helpers.arrayElements(['chicken', 'chorizo', 'egg', 'fish', 'pork', 'steak', 'tofu'])).join(';')}}\n                    ### TODO: -- RecordType Options -- OneRecType -- Below is the Multiselect faker recipe for the record type OneRecType for the field MultiPicklist__c\n                    ${{ (faker.helpers.arrayElements(['chorizo', 'pork', 'steak', 'tofu'])).join(';')}}\n                    ### TODO: -- RecordType Options -- TwoRecType -- Below is the Multiselect faker recipe for the record type TwoRecType for the field MultiPicklist__c\n                    ${{ (faker.helpers.arrayElements(['chicken', 'egg', 'fish', 'tofu'])).join(';')}}"
//       },
//       {
//         "objectName": "Example_Everything__c",
//         "fieldName": "Number__c",
//         "fieldLabel": "Number",
//         "type": "Number",
//         "recipeValue": "|\n                ${{ faker.number.int({ min: 0, max: 999999 }) }}"
//       },
//       {
//         "objectName": "Example_Everything__c",
//         "fieldName": "Percent__c",
//         "fieldLabel": "Percent",
//         "type": "Percent",
//         "recipeValue": "|\n                ${{ faker.number.float({ min: 0, max: 99, precision: 0.01 }).toFixed(2) }}"
//       },
//       {
//         "objectName": "Example_Everything__c",
//         "fieldName": "Phone__c",
//         "fieldLabel": "Phone",
//         "type": "Phone",
//         "recipeValue": "|\n                ${{ faker.phone.number({ style: 'national' }) }}"
//       },
//       {
//         "objectName": "Example_Everything__c",
//         "fieldName": "Picklist__c",
//         "fieldLabel": "Picklist",
//         "type": "Picklist",
//         "picklistValues": [
//           {
//             "picklistOptionApiName": "cle",
//             "label": "cle",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "eastlake",
//             "label": "eastlake",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "madison",
//             "label": "madison",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "mentor",
//             "label": "mentor",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "wickliffe",
//             "label": "wickliffe",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "willoughby",
//             "label": "willoughby",
//             "default": false,
//             "isActive": true
//           }
//         ],
//         "recipeValue": "${{ faker.helpers.arrayElement(['cle', 'eastlake', 'madison', 'mentor', 'wickliffe', 'willoughby']) }}\n                    ### TODO: -- RecordType Options -- OneRecType -- Below is the faker recipe for the record type OneRecType for the field Picklist__c\n                    ${{ faker.helpers.arrayElement(['cle', 'eastlake']) }}\n                    ### TODO: -- RecordType Options -- TwoRecType -- Below is the faker recipe for the record type TwoRecType for the field Picklist__c\n                    ${{ faker.helpers.arrayElement(['cle', 'willoughby']) }}"
//       },
//       {
//         "objectName": "Example_Everything__c",
//         "fieldName": "PlanetGlobalValuePicklist__c",
//         "fieldLabel": "PlanetGlobalValuePicklist",
//         "type": "Picklist",
//         "recipeValue": "### TODO: This picklist field needs manually updated with either a standard value set list or global value set"
//       },
//       {
//         "objectName": "Example_Everything__c",
//         "fieldName": "RichTextAreaHtml__c",
//         "fieldLabel": "RichTextAreaHtml",
//         "type": "Html",
//         "recipeValue": "${{ faker.string.alpha(10) }}"
//       },
//       {
//         "objectName": "Example_Everything__c",
//         "fieldName": "TextAreaRich__c",
//         "fieldLabel": "TextAreaRich",
//         "type": "Html",
//         "recipeValue": "${{ faker.string.alpha(10) }}"
//       },
//       {
//         "objectName": "Example_Everything__c",
//         "fieldName": "Text_Area_Long__c",
//         "fieldLabel": "Text Area Long",
//         "type": "LongTextArea",
//         "recipeValue": "${{ faker.lorem.text(100) }}"
//       },
//       {
//         "objectName": "Example_Everything__c",
//         "fieldName": "Text__c",
//         "fieldLabel": "Text",
//         "type": "Text",
//         "recipeValue": "${{ faker.lorem.text(5).substring(0, 255) }}"
//       },
//       {
//         "objectName": "Example_Everything__c",
//         "fieldName": "Time__c",
//         "fieldLabel": "Time",
//         "type": "Time",
//         "recipeValue": "|\n                ${{ faker.date.between({ from: new Date('1970-01-01T00:00:00Z'), to: new Date('1970-01-01T23:59:59Z') }).toISOString().split('T')[1] }}"
//       },
//       {
//         "objectName": "Example_Everything__c",
//         "fieldName": "Url__c",
//         "fieldLabel": "Url",
//         "type": "Url",
//         "recipeValue": "${{ faker.internet.url() }}"
//       },
//       {
//         "objectName": "Example_Everything__c",
//         "fieldName": "gfh__c",
//         "fieldLabel": "gfh",
//         "type": "Picklist",
//         "picklistValues": [
//           {
//             "picklistOptionApiName": "1",
//             "label": "1",
//             "default": false,
//             "isActive": true,
//             "controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection": [
//               "a"
//             ]
//           },
//           {
//             "picklistOptionApiName": "2",
//             "label": "2",
//             "default": false,
//             "isActive": true,
//             "controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection": [
//               "a"
//             ]
//           },
//           {
//             "picklistOptionApiName": "3",
//             "label": "3",
//             "default": false,
//             "isActive": true,
//             "controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection": [
//               "b",
//               "c"
//             ]
//           },
//           {
//             "picklistOptionApiName": "4",
//             "label": "4",
//             "default": false,
//             "isActive": true,
//             "controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection": [
//               "c"
//             ]
//           }
//         ],
//         "controllingField": "nv__c",
//         "recipeValue": "\n      if:\n        - choice:\n            when: ${{ nv__c == 'a'}}\n            pick:\n                random_choice:\n                    - 1\n                    - 2\n                    ### TODO: -- RecordType Options -- OneRecType -- \"a\" is not an available value for nv__c for record type OneRecType\n                    ### TODO: -- RecordType Options -- TwoRecType -- \"a\" is not an available value for nv__c for record type TwoRecType\n        - choice:\n            when: ${{ nv__c == 'b'}}\n            pick:\n                random_choice:\n                    - 3\n                    ### TODO: -- RecordType Options -- OneRecType -- \"b\" is not an available value for nv__c for record type OneRecType\n                    ### TODO: -- RecordType Options -- TwoRecType -- \"b\" is not an available value for nv__c for record type TwoRecType\n        - choice:\n            when: ${{ nv__c == 'c'}}\n            pick:\n                random_choice:\n                    - 3\n                    - 4\n                    ### TODO: -- RecordType Options -- OneRecType -- \"c\" is not an available value for nv__c for record type OneRecType\n                    ### TODO: -- RecordType Options -- TwoRecType -- \"c\" is not an available value for nv__c for record type TwoRecType"
//       }
//     ],
//     "RecordTypesMap": {
//       "OneRecType": {
//         "RecordTypeId": "",
//         "DeveloperName": "OneRecType",
//         "PicklistFieldSectionsToPicklistDetail": {
//           "DependentPicklist__c": [
//             "mulch",
//             "rocks",
//             "tree",
//             "weed"
//           ],
//           "GlobalValuePicklist__c": [
//             "browns",
//             "cavs",
//             "crunch",
//             "guardians",
//             "monsters"
//           ],
//           "MultiPicklist__c": [
//             "chorizo",
//             "pork",
//             "steak",
//             "tofu"
//           ],
//           "Picklist__c": [
//             "cle",
//             "eastlake"
//           ]
//         }
//       },
//       "TwoRecType": {
//         "RecordTypeId": "",
//         "DeveloperName": "TwoRecType",
//         "PicklistFieldSectionsToPicklistDetail": {
//           "DependentPicklist__c": [
//             "mulch",
//             "plant",
//             "rocks",
//             "tree"
//           ],
//           "GlobalValuePicklist__c": [
//             "browns",
//             "cavs",
//             "crunch",
//             "guardians",
//             "monsters"
//           ],
//           "MultiPicklist__c": [
//             "chicken",
//             "egg",
//             "fish",
//             "tofu"
//           ],
//           "Picklist__c": [
//             "cle",
//             "willoughby"
//           ]
//         }
//       }
//     }
//   },
//   "Lead": {
//     "ApiName": "Lead",
//     "FullRecipe": "\n- object: Lead\n  nickname: Lead_NickName\n  count: 1\n  fields:\n    FirstName: ${{ faker.person.firstName() }}\n    LastName: ${{ faker.person.lastName() }}\n    Company: ${{ faker.company.name() }}\n    Title: ${{ faker.job }}\n    Email: ${{ faker.internet.email() }}\n    Phone: |\n                    ${{ faker.phone.number({ style: 'national' }) }}\n    MobilePhone: |\n                    ${{ faker.phone.number({ style: 'national' }) }}\n    Street: ${{ faker.location.streetAddress() }}\n    City: ${{ faker.location.city() }}\n    State: ${{ faker.location.state() }}\n    PostalCode: ${{ faker.location.zipCode() }}\n    Country: ${{ faker.location.country() }}\n    Industry: ${{ faker.helpers.arrayElement(['Technology', 'Finance', 'Healthcare', 'Retail', 'Manufacturing', 'Education']) }}\n    AnnualRevenue: ${{ faker.string.numeric(7) }}\n    Description: ${{ faker.lorem.paragraph() }}\n    LeadSource: ${{ faker.helpers.arrayElement(['Web', 'Phone Inquiry', 'Partner', 'Purchased List', 'Other']) }}\n    Rating: ${{ faker.helpers.arrayElement(['Hot', 'Warm', 'Cold']) }}\n    Status: ${{ faker.helpers.arrayElement(['Open - Not Contacted', 'Working - Contacted', 'Closed - Converted', 'Closed - Not Converted']) }}\n    NumberOfEmployees: ${{ faker.string.numeric(4) }}\n    Address: ### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE\n    CampaignId: ### TODO -- REFERENCE ID REQUIRED\n    CleanStatus: ### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE\n    CompanyDunsNumber: ### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE\n    CurrentGenerators__c: ${{ faker.lorem.text(5).substring(0, 255) }}\n    CustomLeadCheck__c: ${{ faker.datatype.boolean() }}\n    DandbCompanyId: ### TODO -- REFERENCE ID REQUIRED\n    DoNotCall: ### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE\n    Fax: ### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE\n    GenderIdentity: ### TODO: This picklist field needs manually updated with either a standard value set list or global value set\n    HasOptedOutOfEmail: ### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE\n    HasOptedOutOfFax: ### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE\n    IndividualId: ### TODO -- REFERENCE ID REQUIRED\n    Jigsaw: ### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE\n    LastTransferDate: ### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE\n    Name: ### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE\n    NumberofLocations__c: |\n                ${{ faker.number.int({ min: 0, max: 999999 }) }}\n    OwnerId: ### TODO -- REFERENCE ID REQUIRED\n    Primary__c: ${{ faker.helpers.arrayElement(['No', 'Yes']) }}\n    ProductInterest__c: ${{ faker.helpers.arrayElement(['GC1000 series', 'GC5000 series', 'GC3000 series']) }}\n    Pronouns: ### TODO: This picklist field needs manually updated with either a standard value set list or global value set\n    SICCode__c: ${{ faker.lorem.text(5).substring(0, 255) }}\n    Website: ### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE",
//     "RelationshipDetail": {
//       "objectApiName": "Lead",
//       "level": 0,
//       "parentObjectToFieldReferences": {},
//       "childObjectToFieldReferences": {},
//       "isProcessed": true,
//       "relationshipTreeId": "tree_Lead_1761643023450"
//     },
//     "Fields": [
//       {
//         "objectName": "Lead",
//         "fieldName": "Address",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "AUTO_GENERATED",
//         "recipeValue": "### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE"
//       },
//       {
//         "objectName": "Lead",
//         "fieldName": "CampaignId",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "Lookup",
//         "referenceTo": null,
//         "recipeValue": "### TODO -- REFERENCE ID REQUIRED"
//       },
//       {
//         "objectName": "Lead",
//         "fieldName": "CleanStatus",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "AUTO_GENERATED",
//         "recipeValue": "### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE"
//       },
//       {
//         "objectName": "Lead",
//         "fieldName": "CompanyDunsNumber",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "AUTO_GENERATED",
//         "recipeValue": "### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE"
//       },
//       {
//         "objectName": "Lead",
//         "fieldName": "CurrentGenerators__c",
//         "fieldLabel": "Current Generator(s)",
//         "type": "Text",
//         "recipeValue": "${{ faker.lorem.text(5).substring(0, 255) }}"
//       },
//       {
//         "objectName": "Lead",
//         "fieldName": "CustomLeadCheck__c",
//         "fieldLabel": "CustomLeadCheck",
//         "type": "Checkbox",
//         "recipeValue": "${{ faker.datatype.boolean() }}"
//       },
//       {
//         "objectName": "Lead",
//         "fieldName": "DandbCompanyId",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "Lookup",
//         "referenceTo": null,
//         "recipeValue": "### TODO -- REFERENCE ID REQUIRED"
//       },
//       {
//         "objectName": "Lead",
//         "fieldName": "DoNotCall",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "AUTO_GENERATED",
//         "recipeValue": "### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE"
//       },
//       {
//         "objectName": "Lead",
//         "fieldName": "Fax",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "AUTO_GENERATED",
//         "recipeValue": "### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE"
//       },
//       {
//         "objectName": "Lead",
//         "fieldName": "GenderIdentity",
//         "fieldLabel": "GenderIdentity",
//         "type": "Picklist",
//         "recipeValue": "### TODO: This picklist field needs manually updated with either a standard value set list or global value set"
//       },
//       {
//         "objectName": "Lead",
//         "fieldName": "HasOptedOutOfEmail",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "AUTO_GENERATED",
//         "recipeValue": "### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE"
//       },
//       {
//         "objectName": "Lead",
//         "fieldName": "HasOptedOutOfFax",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "AUTO_GENERATED",
//         "recipeValue": "### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE"
//       },
//       {
//         "objectName": "Lead",
//         "fieldName": "IndividualId",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "Lookup",
//         "referenceTo": null,
//         "recipeValue": "### TODO -- REFERENCE ID REQUIRED"
//       },
//       {
//         "objectName": "Lead",
//         "fieldName": "Jigsaw",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "AUTO_GENERATED",
//         "recipeValue": "### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE"
//       },
//       {
//         "objectName": "Lead",
//         "fieldName": "LastTransferDate",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "AUTO_GENERATED",
//         "recipeValue": "### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE"
//       },
//       {
//         "objectName": "Lead",
//         "fieldName": "Name",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "AUTO_GENERATED",
//         "recipeValue": "### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE"
//       },
//       {
//         "objectName": "Lead",
//         "fieldName": "NumberofLocations__c",
//         "fieldLabel": "Number of Locations",
//         "type": "Number",
//         "recipeValue": "|\n                ${{ faker.number.int({ min: 0, max: 999999 }) }}"
//       },
//       {
//         "objectName": "Lead",
//         "fieldName": "OwnerId",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "Lookup",
//         "referenceTo": null,
//         "recipeValue": "### TODO -- REFERENCE ID REQUIRED"
//       },
//       {
//         "objectName": "Lead",
//         "fieldName": "Primary__c",
//         "fieldLabel": "Primary",
//         "type": "Picklist",
//         "picklistValues": [
//           {
//             "picklistOptionApiName": "No",
//             "label": "No",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "Yes",
//             "label": "Yes",
//             "default": false,
//             "isActive": true
//           }
//         ],
//         "recipeValue": "${{ faker.helpers.arrayElement(['No', 'Yes']) }}"
//       },
//       {
//         "objectName": "Lead",
//         "fieldName": "ProductInterest__c",
//         "fieldLabel": "Product Interest",
//         "type": "Picklist",
//         "picklistValues": [
//           {
//             "picklistOptionApiName": "GC1000 series",
//             "label": "GC1000 series",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "GC5000 series",
//             "label": "GC5000 series",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "GC3000 series",
//             "label": "GC3000 series",
//             "default": false,
//             "isActive": true
//           }
//         ],
//         "recipeValue": "${{ faker.helpers.arrayElement(['GC1000 series', 'GC5000 series', 'GC3000 series']) }}"
//       },
//       {
//         "objectName": "Lead",
//         "fieldName": "Pronouns",
//         "fieldLabel": "Pronouns",
//         "type": "Picklist",
//         "recipeValue": "### TODO: This picklist field needs manually updated with either a standard value set list or global value set"
//       },
//       {
//         "objectName": "Lead",
//         "fieldName": "SICCode__c",
//         "fieldLabel": "SIC Code",
//         "type": "Text",
//         "recipeValue": "${{ faker.lorem.text(5).substring(0, 255) }}"
//       },
//       {
//         "objectName": "Lead",
//         "fieldName": "Website",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "AUTO_GENERATED",
//         "recipeValue": "### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE"
//       }
//     ]
//   },
//   "Manufacturing_Event__e": {
//     "ApiName": "Manufacturing_Event__e",
//     "FullRecipe": "\n- object: Manufacturing_Event__e\n  nickname: Manufacturing_Event__e_NickName\n  count: 1\n  fields:\n    Order_Id__c: ${{ faker.lorem.text(5).substring(0, 255) }}\n    Status__c: ${{ faker.lorem.text(5).substring(0, 255) }}",
//     "RelationshipDetail": {
//       "objectApiName": "Manufacturing_Event__e",
//       "level": 0,
//       "parentObjectToFieldReferences": {},
//       "childObjectToFieldReferences": {},
//       "isProcessed": true,
//       "relationshipTreeId": "tree_Manufacturing_Event__e_1761643023451"
//     },
//     "Fields": [
//       {
//         "objectName": "Manufacturing_Event__e",
//         "fieldName": "Order_Id__c",
//         "fieldLabel": "Order Id",
//         "type": "Text",
//         "recipeValue": "${{ faker.lorem.text(5).substring(0, 255) }}"
//       },
//       {
//         "objectName": "Manufacturing_Event__e",
//         "fieldName": "Status__c",
//         "fieldLabel": "Status",
//         "type": "Text",
//         "recipeValue": "${{ faker.lorem.text(5).substring(0, 255) }}"
//       }
//     ]
//   },
//   "MasterDetailMadness__c": {
//     "ApiName": "MasterDetailMadness__c",
//     "FullRecipe": "\n- object: MasterDetailMadness__c\n  nickname: MasterDetailMadness__c_NickName\n  count: 1\n  fields:\n    LU_Contact__c: ### TODO -- REFERENCE ID REQUIRED\n    MD_MegaMapMadness__c: ### TODO -- REFERENCE ID REQUIRED",
//     "RelationshipDetail": {
//       "objectApiName": "MasterDetailMadness__c",
//       "level": 2,
//       "parentObjectToFieldReferences": {
//         "Contact": [
//           "LU_Contact__c"
//         ],
//         "MegaMapMadness__c": [
//           "MD_MegaMapMadness__c"
//         ]
//       },
//       "childObjectToFieldReferences": {},
//       "isProcessed": true,
//       "relationshipTreeId": "tree_Account_1761643023450"
//     },
//     "Fields": [
//       {
//         "objectName": "MasterDetailMadness__c",
//         "fieldName": "LU_Contact__c",
//         "fieldLabel": "LU Contact",
//         "type": "Lookup",
//         "referenceTo": "Contact",
//         "recipeValue": "### TODO -- REFERENCE ID REQUIRED"
//       },
//       {
//         "objectName": "MasterDetailMadness__c",
//         "fieldName": "MD_MegaMapMadness__c",
//         "fieldLabel": "MD MegaMapMadness",
//         "type": "MasterDetail",
//         "referenceTo": "MegaMapMadness__c",
//         "recipeValue": "### TODO -- REFERENCE ID REQUIRED"
//       }
//     ]
//   },
//   "MegaMapMadness__c": {
//     "ApiName": "MegaMapMadness__c",
//     "RelationshipDetail": {
//       "objectApiName": "MegaMapMadness__c",
//       "level": 1,
//       "parentObjectToFieldReferences": {
//         "User": [
//           "LUOne_User__c",
//           "LUTwo_User__c"
//         ]
//       },
//       "childObjectToFieldReferences": {
//         "MasterDetailMadness__c": [
//           "MD_MegaMapMadness__c"
//         ]
//       },
//       "isProcessed": true,
//       "relationshipTreeId": "tree_Account_1761643023450"
//     },
//     "FullRecipe": "\n- object: MegaMapMadness__c\n  nickname: MegaMapMadness__c_NickName\n  count: 1\n  fields:\n    CheckMadness__c: ${{ faker.datatype.boolean() }}\n    LUOne_User__c: ### TODO -- REFERENCE ID REQUIRED\n    LUTwo_User__c: ### TODO -- REFERENCE ID REQUIRED",
//     "Fields": [
//       {
//         "objectName": "MegaMapMadness__c",
//         "fieldName": "CheckMadness__c",
//         "fieldLabel": "CheckMadness",
//         "type": "Checkbox",
//         "recipeValue": "${{ faker.datatype.boolean() }}"
//       },
//       {
//         "objectName": "MegaMapMadness__c",
//         "fieldName": "LUOne_User__c",
//         "fieldLabel": "LUOne User",
//         "type": "Lookup",
//         "referenceTo": "User",
//         "recipeValue": "### TODO -- REFERENCE ID REQUIRED"
//       },
//       {
//         "objectName": "MegaMapMadness__c",
//         "fieldName": "LUTwo_User__c",
//         "fieldLabel": "LUTwo User",
//         "type": "Lookup",
//         "referenceTo": "User",
//         "recipeValue": "### TODO -- REFERENCE ID REQUIRED"
//       }
//     ]
//   },
//   "Opportunity": {
//     "ApiName": "Opportunity",
//     "FullRecipe": "\n- object: Opportunity\n  nickname: Opportunity_NickName\n  count: 1\n  fields:\n    Name: ${{ faker.company.catchPhrase() }}\n    Amount: ${{ (faker.string.numeric(6))}}.00\n    CloseDate: |\n                    ${{ faker.date.between({ from: (new Date().setDate(new Date().getDate() - 30)), to: (new Date().setDate(new Date().getDate() + 90)) }) }}\n    Description: ${{ faker.lorem.paragraph() }}\n    ExpectedRevenue: ${{ (faker.string.numeric(6))}}.00\n    LeadSource: ${{ faker.helpers.arrayElement(['Web', 'Phone Inquiry', 'Partner', 'Purchased List', 'Other']) }}\n    NextStep: ${{ faker.lorem.sentence() }}\n    Probability: ${{ (faker.string.numeric(2))}}.0 \n    StageName: ${{ faker.helpers.arrayElement(['Prospecting', 'Qualification', 'Needs Analysis', 'Value Proposition', 'Id. Decision Makers', 'Perception Analysis', 'Proposal/Price Quote', 'Negotiation/Review', 'Closed Won', 'Closed Lost']) }}\n    Type: ${{ faker.helpers.arrayElement(['New Customer', 'Existing Customer - Upgrade', 'Existing Customer - Replacement', 'Existing Customer - Downgrade']) }}\n    ForecastCategory: ${{ faker.helpers.arrayElement(['Pipeline', 'Best Case', 'Commit', 'Closed']) }}\n    AccountId: ### TODO -- REFERENCE ID REQUIRED\n    CampaignId: ### TODO -- REFERENCE ID REQUIRED\n    ContractId: ### TODO -- REFERENCE ID REQUIRED\n    CurrentGenerators__c: ${{ faker.lorem.text(5).substring(0, 255) }}\n    DeliveryInstallationStatus__c: ${{ faker.helpers.arrayElement(['In progress', 'Yet to begin', 'Completed']) }}\n    IqScore: ### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE\n    IsPrivate: ### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE\n    MainCompetitors__c: ${{ faker.lorem.text(5).substring(0, 255) }}\n    OrderNumber__c: ${{ faker.lorem.text(5).substring(0, 255) }}\n    OwnerId: ### TODO -- REFERENCE ID REQUIRED\n    Pricebook2Id: ### TODO -- REFERENCE ID REQUIRED\n    TotalOpportunityQuantity: ### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE\n    TrackingNumber__c: ${{ faker.lorem.text(5).substring(0, 255) }}",
//     "RelationshipDetail": {
//       "objectApiName": "Opportunity",
//       "level": 1,
//       "parentObjectToFieldReferences": {
//         "Account": [
//           "AccountId"
//         ]
//       },
//       "childObjectToFieldReferences": {},
//       "isProcessed": true,
//       "relationshipTreeId": "tree_Account_1761643023450"
//     },
//     "Fields": [
//       {
//         "objectName": "Opportunity",
//         "fieldName": "AccountId",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "Lookup",
//         "referenceTo": null,
//         "recipeValue": "### TODO -- REFERENCE ID REQUIRED"
//       },
//       {
//         "objectName": "Opportunity",
//         "fieldName": "CampaignId",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "Lookup",
//         "referenceTo": null,
//         "recipeValue": "### TODO -- REFERENCE ID REQUIRED"
//       },
//       {
//         "objectName": "Opportunity",
//         "fieldName": "ContractId",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "Lookup",
//         "referenceTo": null,
//         "recipeValue": "### TODO -- REFERENCE ID REQUIRED"
//       },
//       {
//         "objectName": "Opportunity",
//         "fieldName": "CurrentGenerators__c",
//         "fieldLabel": "Current Generator(s)",
//         "type": "Text",
//         "recipeValue": "${{ faker.lorem.text(5).substring(0, 255) }}"
//       },
//       {
//         "objectName": "Opportunity",
//         "fieldName": "DeliveryInstallationStatus__c",
//         "fieldLabel": "Delivery/Installation Status",
//         "type": "Picklist",
//         "picklistValues": [
//           {
//             "picklistOptionApiName": "In progress",
//             "label": "In progress",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "Yet to begin",
//             "label": "Yet to begin",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "Completed",
//             "label": "Completed",
//             "default": false,
//             "isActive": true
//           }
//         ],
//         "recipeValue": "${{ faker.helpers.arrayElement(['In progress', 'Yet to begin', 'Completed']) }}"
//       },
//       {
//         "objectName": "Opportunity",
//         "fieldName": "IqScore",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "AUTO_GENERATED",
//         "recipeValue": "### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE"
//       },
//       {
//         "objectName": "Opportunity",
//         "fieldName": "IsPrivate",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "AUTO_GENERATED",
//         "recipeValue": "### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE"
//       },
//       {
//         "objectName": "Opportunity",
//         "fieldName": "MainCompetitors__c",
//         "fieldLabel": "Main Competitor(s)",
//         "type": "Text",
//         "recipeValue": "${{ faker.lorem.text(5).substring(0, 255) }}"
//       },
//       {
//         "objectName": "Opportunity",
//         "fieldName": "OrderNumber__c",
//         "fieldLabel": "Order Number",
//         "type": "Text",
//         "recipeValue": "${{ faker.lorem.text(5).substring(0, 255) }}"
//       },
//       {
//         "objectName": "Opportunity",
//         "fieldName": "OwnerId",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "Lookup",
//         "referenceTo": null,
//         "recipeValue": "### TODO -- REFERENCE ID REQUIRED"
//       },
//       {
//         "objectName": "Opportunity",
//         "fieldName": "Pricebook2Id",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "Lookup",
//         "referenceTo": null,
//         "recipeValue": "### TODO -- REFERENCE ID REQUIRED"
//       },
//       {
//         "objectName": "Opportunity",
//         "fieldName": "TotalOpportunityQuantity",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "AUTO_GENERATED",
//         "recipeValue": "### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE"
//       },
//       {
//         "objectName": "Opportunity",
//         "fieldName": "TrackingNumber__c",
//         "fieldLabel": "Tracking Number",
//         "type": "Text",
//         "recipeValue": "${{ faker.lorem.text(5).substring(0, 255) }}"
//       }
//     ]
//   },
//   "Order_Item__c": {
//     "ApiName": "Order_Item__c",
//     "FullRecipe": "\n- object: Order_Item__c\n  nickname: Order_Item__c_NickName\n  count: 1\n  fields:\n    Order__c: ### TODO -- REFERENCE ID REQUIRED\n    Price__c: ${{ faker.finance.amount(0, 999999, 2) }}\n    Product__c: ### TODO -- REFERENCE ID REQUIRED\n    Qty_L__c: |\n                ${{ faker.number.int({ min: 0, max: 999999 }) }}\n    Qty_M__c: |\n                ${{ faker.number.int({ min: 0, max: 999999 }) }}\n    Qty_S__c: |\n                ${{ faker.number.int({ min: 0, max: 999999 }) }}",
//     "RelationshipDetail": {
//       "objectApiName": "Order_Item__c",
//       "level": 2,
//       "parentObjectToFieldReferences": {
//         "Order__c": [
//           "Order__c"
//         ],
//         "Product__c": [
//           "Product__c"
//         ]
//       },
//       "childObjectToFieldReferences": {},
//       "isProcessed": true,
//       "relationshipTreeId": "tree_Account_1761643023450"
//     },
//     "Fields": [
//       {
//         "objectName": "Order_Item__c",
//         "fieldName": "Order__c",
//         "fieldLabel": "Reseller Order",
//         "type": "MasterDetail",
//         "referenceTo": "Order__c",
//         "recipeValue": "### TODO -- REFERENCE ID REQUIRED"
//       },
//       {
//         "objectName": "Order_Item__c",
//         "fieldName": "Price__c",
//         "fieldLabel": "Price",
//         "type": "Currency",
//         "recipeValue": "${{ faker.finance.amount(0, 999999, 2) }}"
//       },
//       {
//         "objectName": "Order_Item__c",
//         "fieldName": "Product__c",
//         "fieldLabel": "Product",
//         "type": "Lookup",
//         "referenceTo": "Product__c",
//         "recipeValue": "### TODO -- REFERENCE ID REQUIRED"
//       },
//       {
//         "objectName": "Order_Item__c",
//         "fieldName": "Qty_L__c",
//         "fieldLabel": "L",
//         "type": "Number",
//         "recipeValue": "|\n                ${{ faker.number.int({ min: 0, max: 999999 }) }}"
//       },
//       {
//         "objectName": "Order_Item__c",
//         "fieldName": "Qty_M__c",
//         "fieldLabel": "M",
//         "type": "Number",
//         "recipeValue": "|\n                ${{ faker.number.int({ min: 0, max: 999999 }) }}"
//       },
//       {
//         "objectName": "Order_Item__c",
//         "fieldName": "Qty_S__c",
//         "fieldLabel": "S",
//         "type": "Number",
//         "recipeValue": "|\n                ${{ faker.number.int({ min: 0, max: 999999 }) }}"
//       }
//     ]
//   },
//   "Order__c": {
//     "ApiName": "Order__c",
//     "RelationshipDetail": {
//       "objectApiName": "Order__c",
//       "level": 1,
//       "parentObjectToFieldReferences": {
//         "Account": [
//           "Account__c"
//         ]
//       },
//       "childObjectToFieldReferences": {
//         "Order_Item__c": [
//           "Order__c"
//         ]
//       },
//       "isProcessed": true,
//       "relationshipTreeId": "tree_Account_1761643023450"
//     },
//     "FullRecipe": "\n- object: Order__c\n  nickname: Order__c_NickName\n  count: 1\n  fields:\n    Account__c: ### TODO -- REFERENCE ID REQUIRED\n    Status__c: ${{ faker.helpers.arrayElement(['Draft', 'Submitted to Manufacturing', 'Approved by Manufacturing', 'In Production']) }}",
//     "Fields": [
//       {
//         "objectName": "Order__c",
//         "fieldName": "Account__c",
//         "fieldLabel": "Account",
//         "type": "Lookup",
//         "referenceTo": "Account",
//         "recipeValue": "### TODO -- REFERENCE ID REQUIRED"
//       },
//       {
//         "objectName": "Order__c",
//         "fieldName": "Status__c",
//         "fieldLabel": "Status",
//         "type": "Picklist",
//         "picklistValues": [
//           {
//             "picklistOptionApiName": "Draft",
//             "label": "Draft",
//             "default": true,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "Submitted to Manufacturing",
//             "label": "Submitted to Manufacturing",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "Approved by Manufacturing",
//             "label": "Approved by Manufacturing",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "In Production",
//             "label": "In Production",
//             "default": false,
//             "isActive": true
//           }
//         ],
//         "recipeValue": "${{ faker.helpers.arrayElement(['Draft', 'Submitted to Manufacturing', 'Approved by Manufacturing', 'In Production']) }}"
//       }
//     ]
//   },
//   "Product__c": {
//     "ApiName": "Product__c",
//     "RelationshipDetail": {
//       "objectApiName": "Product__c",
//       "level": 1,
//       "parentObjectToFieldReferences": {
//         "Product_Family__c": [
//           "Product_Family__c"
//         ]
//       },
//       "childObjectToFieldReferences": {
//         "Order_Item__c": [
//           "Product__c"
//         ]
//       },
//       "isProcessed": true,
//       "relationshipTreeId": "tree_Account_1761643023450"
//     },
//     "FullRecipe": "\n- object: Product__c\n  nickname: Product__c_NickName\n  count: 1\n  fields:\n    Battery__c: ${{ faker.lorem.text(5).substring(0, 255) }}\n    Category__c: ${{ faker.helpers.arrayElement(['Mountain', 'Commuter']) }}\n    Charger__c: ${{ faker.lorem.text(5).substring(0, 255) }}\n    Description__c: ${{ faker.lorem.text(100) }}\n    Fork__c: ${{ faker.lorem.text(5).substring(0, 255) }}\n    Frame_Color__c: ${{ faker.helpers.arrayElement(['white', 'red', 'blue', 'green']) }}\n    Front_Brakes__c: ${{ faker.lorem.text(5).substring(0, 255) }}\n    Handlebar_Color__c: ${{ faker.helpers.arrayElement(['white', 'red', 'blue', 'green']) }}\n    Level__c: ${{ faker.helpers.arrayElement(['Beginner', 'Enthusiast', 'Racer']) }}\n    MSRP__c: ${{ faker.finance.amount(0, 999999, 2) }}\n    Material__c: ${{ faker.helpers.arrayElement(['Aluminum', 'Carbon']) }}\n    Motor__c: ${{ faker.lorem.text(5).substring(0, 255) }}\n    Picture_URL__c: ${{ faker.internet.url() }}\n    Product_Family__c: ### TODO -- REFERENCE ID REQUIRED\n    Rear_Brakes__c: ${{ faker.lorem.text(5).substring(0, 255) }}\n    Seat_Color__c: ${{ faker.helpers.arrayElement(['white', 'red', 'blue', 'green']) }}\n    Waterbottle_Color__c: ${{ faker.helpers.arrayElement(['white', 'red', 'blue', 'green']) }}",
//     "Fields": [
//       {
//         "objectName": "Product__c",
//         "fieldName": "Battery__c",
//         "fieldLabel": "Battery",
//         "type": "Text",
//         "recipeValue": "${{ faker.lorem.text(5).substring(0, 255) }}"
//       },
//       {
//         "objectName": "Product__c",
//         "fieldName": "Category__c",
//         "fieldLabel": "Category",
//         "type": "Picklist",
//         "picklistValues": [
//           {
//             "picklistOptionApiName": "Mountain",
//             "label": "Mountain",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "Commuter",
//             "label": "Commuter",
//             "default": false,
//             "isActive": true
//           }
//         ],
//         "recipeValue": "${{ faker.helpers.arrayElement(['Mountain', 'Commuter']) }}"
//       },
//       {
//         "objectName": "Product__c",
//         "fieldName": "Charger__c",
//         "fieldLabel": "Charger",
//         "type": "Text",
//         "recipeValue": "${{ faker.lorem.text(5).substring(0, 255) }}"
//       },
//       {
//         "objectName": "Product__c",
//         "fieldName": "Description__c",
//         "fieldLabel": "Description",
//         "type": "LongTextArea",
//         "recipeValue": "${{ faker.lorem.text(100) }}"
//       },
//       {
//         "objectName": "Product__c",
//         "fieldName": "Fork__c",
//         "fieldLabel": "Fork",
//         "type": "Text",
//         "recipeValue": "${{ faker.lorem.text(5).substring(0, 255) }}"
//       },
//       {
//         "objectName": "Product__c",
//         "fieldName": "Frame_Color__c",
//         "fieldLabel": "Frame Color",
//         "type": "Picklist",
//         "picklistValues": [
//           {
//             "picklistOptionApiName": "white",
//             "label": "white",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "red",
//             "label": "red",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "blue",
//             "label": "blue",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "green",
//             "label": "green",
//             "default": false,
//             "isActive": true
//           }
//         ],
//         "recipeValue": "${{ faker.helpers.arrayElement(['white', 'red', 'blue', 'green']) }}"
//       },
//       {
//         "objectName": "Product__c",
//         "fieldName": "Front_Brakes__c",
//         "fieldLabel": "Front Brakes",
//         "type": "Text",
//         "recipeValue": "${{ faker.lorem.text(5).substring(0, 255) }}"
//       },
//       {
//         "objectName": "Product__c",
//         "fieldName": "Handlebar_Color__c",
//         "fieldLabel": "Handlebar Color",
//         "type": "Picklist",
//         "picklistValues": [
//           {
//             "picklistOptionApiName": "white",
//             "label": "white",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "red",
//             "label": "red",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "blue",
//             "label": "blue",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "green",
//             "label": "green",
//             "default": false,
//             "isActive": true
//           }
//         ],
//         "recipeValue": "${{ faker.helpers.arrayElement(['white', 'red', 'blue', 'green']) }}"
//       },
//       {
//         "objectName": "Product__c",
//         "fieldName": "Level__c",
//         "fieldLabel": "Level",
//         "type": "Picklist",
//         "picklistValues": [
//           {
//             "picklistOptionApiName": "Beginner",
//             "label": "Beginner",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "Enthusiast",
//             "label": "Enthusiast",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "Racer",
//             "label": "Racer",
//             "default": false,
//             "isActive": true
//           }
//         ],
//         "recipeValue": "${{ faker.helpers.arrayElement(['Beginner', 'Enthusiast', 'Racer']) }}"
//       },
//       {
//         "objectName": "Product__c",
//         "fieldName": "MSRP__c",
//         "fieldLabel": "MSRP",
//         "type": "Currency",
//         "recipeValue": "${{ faker.finance.amount(0, 999999, 2) }}"
//       },
//       {
//         "objectName": "Product__c",
//         "fieldName": "Material__c",
//         "fieldLabel": "Material",
//         "type": "Picklist",
//         "picklistValues": [
//           {
//             "picklistOptionApiName": "Aluminum",
//             "label": "Aluminum",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "Carbon",
//             "label": "Carbon",
//             "default": false,
//             "isActive": true
//           }
//         ],
//         "recipeValue": "${{ faker.helpers.arrayElement(['Aluminum', 'Carbon']) }}"
//       },
//       {
//         "objectName": "Product__c",
//         "fieldName": "Motor__c",
//         "fieldLabel": "Motor",
//         "type": "Text",
//         "recipeValue": "${{ faker.lorem.text(5).substring(0, 255) }}"
//       },
//       {
//         "objectName": "Product__c",
//         "fieldName": "Picture_URL__c",
//         "fieldLabel": "Picture URL",
//         "type": "Url",
//         "recipeValue": "${{ faker.internet.url() }}"
//       },
//       {
//         "objectName": "Product__c",
//         "fieldName": "Product_Family__c",
//         "fieldLabel": "Product Family",
//         "type": "Lookup",
//         "referenceTo": "Product_Family__c",
//         "recipeValue": "### TODO -- REFERENCE ID REQUIRED"
//       },
//       {
//         "objectName": "Product__c",
//         "fieldName": "Rear_Brakes__c",
//         "fieldLabel": "Rear Brakes",
//         "type": "Text",
//         "recipeValue": "${{ faker.lorem.text(5).substring(0, 255) }}"
//       },
//       {
//         "objectName": "Product__c",
//         "fieldName": "Seat_Color__c",
//         "fieldLabel": "Seat Color",
//         "type": "Picklist",
//         "picklistValues": [
//           {
//             "picklistOptionApiName": "white",
//             "label": "white",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "red",
//             "label": "red",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "blue",
//             "label": "blue",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "green",
//             "label": "green",
//             "default": false,
//             "isActive": true
//           }
//         ],
//         "recipeValue": "${{ faker.helpers.arrayElement(['white', 'red', 'blue', 'green']) }}"
//       },
//       {
//         "objectName": "Product__c",
//         "fieldName": "Waterbottle_Color__c",
//         "fieldLabel": "Waterbottle Color",
//         "type": "Picklist",
//         "picklistValues": [
//           {
//             "picklistOptionApiName": "white",
//             "label": "white",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "red",
//             "label": "red",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "blue",
//             "label": "blue",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "green",
//             "label": "green",
//             "default": false,
//             "isActive": true
//           }
//         ],
//         "recipeValue": "${{ faker.helpers.arrayElement(['white', 'red', 'blue', 'green']) }}"
//       }
//     ]
//   },
//   "Pricebook2": {
//     "ApiName": "Pricebook2",
//     "FullRecipe": "\n- object: Pricebook2\n  nickname: Pricebook2_NickName\n  count: 1\n  fields:\n    Description: ### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE\n    IsActive: ### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE\n    IsStandard: ### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE\n    Name: ### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE",
//     "RelationshipDetail": {
//       "objectApiName": "Pricebook2",
//       "level": 0,
//       "parentObjectToFieldReferences": {},
//       "childObjectToFieldReferences": {},
//       "isProcessed": true,
//       "relationshipTreeId": "tree_Pricebook2_1761643023451"
//     },
//     "Fields": [
//       {
//         "objectName": "Pricebook2",
//         "fieldName": "Description",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "AUTO_GENERATED",
//         "recipeValue": "### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE"
//       },
//       {
//         "objectName": "Pricebook2",
//         "fieldName": "IsActive",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "AUTO_GENERATED",
//         "recipeValue": "### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE"
//       },
//       {
//         "objectName": "Pricebook2",
//         "fieldName": "IsStandard",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "AUTO_GENERATED",
//         "recipeValue": "### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE"
//       },
//       {
//         "objectName": "Pricebook2",
//         "fieldName": "Name",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "AUTO_GENERATED",
//         "recipeValue": "### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE"
//       }
//     ]
//   },
//   "Product2": {
//     "ApiName": "Product2",
//     "FullRecipe": "\n- object: Product2\n  nickname: Product2_NickName\n  count: 1\n  fields:\n    Name: ${{ faker.commerce.productName() }}\n    Description: ${{ faker.lorem.paragraph() }}\n    ProductCode: ${{ faker.commerce.product() }}-${{ faker.string.alphanumeric(6) }}\n    IsActive: ${{ faker.helpers.arrayElement(['true', 'false']) }}\n    Family: ${{ faker.helpers.arrayElement(['Hardware', 'Software', 'Services', 'Other']) }}\n    QuantityUnitOfMeasure: ${{ faker.helpers.arrayElement(['Each', 'Case', 'Box', 'Pallet']) }}\n    DisplayUrl: ${{ faker.internet.url() }}\n    ExternalId: ${{ faker.string.uuid() }}\n    Cost__c: ${{ faker.finance.amount(0, 999999, 2) }}\n    Current_Inventory__c: |\n                ${{ faker.number.int({ min: 0, max: 999999 }) }}\n    ExternalDataSourceId: ### TODO -- REFERENCE ID REQUIRED\n    Lifespan_Months__c: |\n                ${{ faker.number.int({ min: 0, max: 999999 }) }}\n    Maintenance_Cycle__c: |\n                ${{ faker.number.int({ min: 0, max: 999999 }) }}\n    Replacement_Part__c: ${{ faker.datatype.boolean() }}\n    SellerId: ### TODO -- REFERENCE ID REQUIRED\n    SourceProductId: ### TODO -- REFERENCE ID REQUIRED\n    StockKeepingUnit: ### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE\n    Warehouse_SKU__c: ${{ faker.lorem.text(5).substring(0, 255) }}",
//     "RelationshipDetail": {
//       "objectApiName": "Product2",
//       "level": 0,
//       "parentObjectToFieldReferences": {},
//       "childObjectToFieldReferences": {},
//       "isProcessed": true,
//       "relationshipTreeId": "tree_Product2_1761643023451"
//     },
//     "Fields": [
//       {
//         "objectName": "Product2",
//         "fieldName": "Cost__c",
//         "fieldLabel": "Cost",
//         "type": "Currency",
//         "recipeValue": "${{ faker.finance.amount(0, 999999, 2) }}"
//       },
//       {
//         "objectName": "Product2",
//         "fieldName": "Current_Inventory__c",
//         "fieldLabel": "Current Inventory",
//         "type": "Number",
//         "recipeValue": "|\n                ${{ faker.number.int({ min: 0, max: 999999 }) }}"
//       },
//       {
//         "objectName": "Product2",
//         "fieldName": "ExternalDataSourceId",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "Lookup",
//         "referenceTo": null,
//         "recipeValue": "### TODO -- REFERENCE ID REQUIRED"
//       },
//       {
//         "objectName": "Product2",
//         "fieldName": "Lifespan_Months__c",
//         "fieldLabel": "Lifespan Months",
//         "type": "Number",
//         "recipeValue": "|\n                ${{ faker.number.int({ min: 0, max: 999999 }) }}"
//       },
//       {
//         "objectName": "Product2",
//         "fieldName": "Maintenance_Cycle__c",
//         "fieldLabel": "Maintenance Cycle (Days)",
//         "type": "Number",
//         "recipeValue": "|\n                ${{ faker.number.int({ min: 0, max: 999999 }) }}"
//       },
//       {
//         "objectName": "Product2",
//         "fieldName": "Replacement_Part__c",
//         "fieldLabel": "Replacement Part",
//         "type": "Checkbox",
//         "recipeValue": "${{ faker.datatype.boolean() }}"
//       },
//       {
//         "objectName": "Product2",
//         "fieldName": "SellerId",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "Lookup",
//         "referenceTo": null,
//         "recipeValue": "### TODO -- REFERENCE ID REQUIRED"
//       },
//       {
//         "objectName": "Product2",
//         "fieldName": "SourceProductId",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "Lookup",
//         "referenceTo": null,
//         "recipeValue": "### TODO -- REFERENCE ID REQUIRED"
//       },
//       {
//         "objectName": "Product2",
//         "fieldName": "StockKeepingUnit",
//         "fieldLabel": "AUTO_GENERATED",
//         "type": "AUTO_GENERATED",
//         "recipeValue": "### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD'S VALUE MAY BE AUTO GENERATED BY SALESFORCE"
//       },
//       {
//         "objectName": "Product2",
//         "fieldName": "Warehouse_SKU__c",
//         "fieldLabel": "Warehouse SKU",
//         "type": "Text",
//         "recipeValue": "${{ faker.lorem.text(5).substring(0, 255) }}"
//       }
//     ]
//   },
//   "Product_Family__c": {
//     "ApiName": "Product_Family__c",
//     "FullRecipe": "\n- object: Product_Family__c\n  nickname: Product_Family__c_NickName\n  count: 1\n  fields:\n    Category__c: ${{ faker.helpers.arrayElement(['Commuter', 'Hybrid', 'Mountain']) }}\n    Description__c: ${{ faker.lorem.paragraph() }}",
//     "RelationshipDetail": {
//       "objectApiName": "Product_Family__c",
//       "level": 0,
//       "parentObjectToFieldReferences": {},
//       "childObjectToFieldReferences": {
//         "Product__c": [
//           "Product_Family__c"
//         ]
//       },
//       "isProcessed": true,
//       "relationshipTreeId": "tree_Account_1761643023450"
//     },
//     "Fields": [
//       {
//         "objectName": "Product_Family__c",
//         "fieldName": "Category__c",
//         "fieldLabel": "Category",
//         "type": "Picklist",
//         "picklistValues": [
//           {
//             "picklistOptionApiName": "Commuter",
//             "label": "Commuter",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "Hybrid",
//             "label": "Hybrid",
//             "default": false,
//             "isActive": true
//           },
//           {
//             "picklistOptionApiName": "Mountain",
//             "label": "Mountain",
//             "default": false,
//             "isActive": true
//           }
//         ],
//         "recipeValue": "${{ faker.helpers.arrayElement(['Commuter', 'Hybrid', 'Mountain']) }}"
//       },
//       {
//         "objectName": "Product_Family__c",
//         "fieldName": "Description__c",
//         "fieldLabel": "Description",
//         "type": "TextArea",
//         "recipeValue": "${{ faker.lorem.paragraph() }}"
//       }
//     ]
//   }
// }
//         `;

//         return objectInfoWJsonrapper;
//     }

//     static getExpectedRecipeFilesJson() {
//         const recipeFilesJsonWrapper = `

//         `;

//         return recipeFilesJsonWrapper;
//     }
}
