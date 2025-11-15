import { RecordTypeWrapper } from "../../RecordTypeService/RecordTypesWrapper";
import { IRecipeFakerService } from "../IRecipeFakerService";

export class FakerJSRecipeFakerService implements IRecipeFakerService {

    openingRecipeSyntax:string = `\${{`;
    closingRecipeSyntax:string = `}}`;

    generateTabs(tabCount: number):string {
        const spacesPerTab = 4;
        return ' '.repeat(spacesPerTab * tabCount);
    }

    buildDependentPicklistRecipeFakerValue(controllingValueToPicklistOptions: Record<string, string[]>, 
                                            recordTypeApiToRecordTypeWrapperMap: Record<string, RecordTypeWrapper>,
                                            controllingField: string,
                                            fieldApiName: string
                                        ): string {
    
        let allDependentPicklistChoiceRecipe:string;

        const newLineBreak = `\n`;
        
        for ( const controllingValueKey in controllingValueToPicklistOptions ) {

            let randomChoicesBreakdown:string;

            let picklistValuesAvailableForChoice = controllingValueToPicklistOptions[controllingValueKey];
            // get initial list of all available picklist values before record type sections
            picklistValuesAvailableForChoice.forEach( value => {

                if (randomChoicesBreakdown) {
                    randomChoicesBreakdown += `${newLineBreak}${this.generateTabs(5)}- ${value}`;
                } else {
                    randomChoicesBreakdown = `- ${value}`;
                }

            });   

            const allRecordTypeChoicesBreakdown = this.updateDependentPicklistRecipeFakerValueByRecordTypeSections( 
                                                        recordTypeApiToRecordTypeWrapperMap, 
                                                        fieldApiName, 
                                                        controllingField,
                                                        controllingValueKey
                                                    );

            if (allRecordTypeChoicesBreakdown) {
                randomChoicesBreakdown += allRecordTypeChoicesBreakdown;
            }

            let dependentPicklistRandomChoiceRecipe = 
`${this.generateTabs(2)}- choice:
${this.generateTabs(3)}when: ${this.openingRecipeSyntax} ${controllingField} == '${controllingValueKey}' ${this.closingRecipeSyntax}
${this.generateTabs(3)}pick:
${this.generateTabs(4)}random_choice:
${this.generateTabs(5)}${randomChoicesBreakdown}`;

            if (!(allDependentPicklistChoiceRecipe)) {
                allDependentPicklistChoiceRecipe = dependentPicklistRandomChoiceRecipe;
            } else {
                const lineBreakRandomChoiceRecipe = `\n${dependentPicklistRandomChoiceRecipe}`;
                allDependentPicklistChoiceRecipe += lineBreakRandomChoiceRecipe;
            }

        }

        let fakeDependentPicklistRecipeValue = "";

        if (fakeDependentPicklistRecipeValue) {
            fakeDependentPicklistRecipeValue += `\n${this.generateTabs(2)}${allDependentPicklistChoiceRecipe}`;
        } else {
            fakeDependentPicklistRecipeValue = `\n${this.generateTabs(1.5)}if:`;
            fakeDependentPicklistRecipeValue += `\n${allDependentPicklistChoiceRecipe}`;
        }

        return fakeDependentPicklistRecipeValue;

    }

    updateDependentPicklistRecipeFakerValueByRecordTypeSections(recordTypeNameByRecordTypeWrapper: Record<string, RecordTypeWrapper>,
        dependentFieldApiName: string,
        controllingFieldApiName: string,
        controllingValue: string
    ): string {

        const newLineBreak: string = `\n`;
        let allRecordTypeChoicesBreakdown:string = '';    

        Object.entries(recordTypeNameByRecordTypeWrapper).forEach(([recordTypeApiNameKey, recordTypeWrapper]) => {

            const availableRecordTypePicklistValuesForControllingField = recordTypeWrapper.PicklistFieldSectionsToPicklistDetail[controllingFieldApiName];

            const noPicklistValuesForRecordTypeVerbiage = `${newLineBreak}${this.generateTabs(5)}### TODO: -- RecordType Options -- ${recordTypeApiNameKey} -- "${controllingValue}" is not an available value for ${controllingFieldApiName} for record type ${recordTypeApiNameKey}`;

            if ( !availableRecordTypePicklistValuesForControllingField || !availableRecordTypePicklistValuesForControllingField.includes(controllingValue) ) {

                /*
                EITHER
                - picklist value not available for record type so no dependent picklist values to process
                - controlling api field doesn't exist in record type markup so no dependent picklist values to process
                */
                allRecordTypeChoicesBreakdown += noPicklistValuesForRecordTypeVerbiage;

            } else {

                let recordTypeChoicesBreakdown:string;

                const picklistValuesForDependentField = recordTypeWrapper.PicklistFieldSectionsToPicklistDetail[dependentFieldApiName];
                picklistValuesForDependentField.forEach( recordTypeAvailablePicklistValue => {

                    if (recordTypeChoicesBreakdown) {
                        recordTypeChoicesBreakdown += `${newLineBreak}${this.generateTabs(5)}- ${recordTypeAvailablePicklistValue}`;
                    } else {
                        const recordTypeTodoVerbiage = `### TODO: -- RecordType Options -- ${recordTypeApiNameKey} -- SELECT THIS SECTION OF OPTIONS IF USING RECORD TYPE -- ${recordTypeApiNameKey}`;
                        recordTypeChoicesBreakdown = `${newLineBreak}${this.generateTabs(5)}${recordTypeTodoVerbiage}${newLineBreak}${this.generateTabs(5)}- ${recordTypeAvailablePicklistValue}`;                                
                    }

                });

                allRecordTypeChoicesBreakdown += recordTypeChoicesBreakdown;
            }

        });

        return allRecordTypeChoicesBreakdown;

    }

    buildPicklistRecipeValueByXMLFieldDetail(availablePicklistChoices: string[],
                                                recordTypeNameByRecordTypeWrapper: Record<string, RecordTypeWrapper>,
                                                fieldApiName: string): string {

        let fakeRecipeValue = '';

        if ( !(availablePicklistChoices) || availablePicklistChoices.length === 0 ) {
            // indicates no svs or picklistvlaues
            return "### TODO: This picklist field needs manually updated with either a standard value set list or global value set";

        } 
         
        const fakerJoinedChoicesSyntax = this.buildPicklistFakerArraySingleElementSyntaxByPicklistOptions(availablePicklistChoices);
        fakeRecipeValue = `${this.openingRecipeSyntax} ${fakerJoinedChoicesSyntax} ${this.closingRecipeSyntax}`;

        const recordTypeBasedRecipeValues = this.buildRecordTypeBasedPicklistRecipeValue(recordTypeNameByRecordTypeWrapper, fieldApiName);
        if ( recordTypeBasedRecipeValues) {
            fakeRecipeValue += `\n${recordTypeBasedRecipeValues}`;
        }

        return fakeRecipeValue;

    }

    buildRecordTypeBasedPicklistRecipeValue(recordTypeNameByRecordTypeWrapper: Record<string, RecordTypeWrapper>,
                                                associatedFieldApiName: string) {

        let allRecordTypeBasedPicklistOptions:string = '';
        const newLineBreak = `\n`;

        Object.entries(recordTypeNameByRecordTypeWrapper).forEach(([recordTypeApiNameKey, recordTypeWrapper]) => {

            const availableRecordTypePicklistValuesForField = recordTypeWrapper.PicklistFieldSectionsToPicklistDetail[associatedFieldApiName];
            if ( availableRecordTypePicklistValuesForField ) {

                const fakerJoinedChoicesSyntax = this.buildPicklistFakerArraySingleElementSyntaxByPicklistOptions(availableRecordTypePicklistValuesForField);
                const recordTypBasedFakeRecipeValue = `${this.openingRecipeSyntax} ${fakerJoinedChoicesSyntax} ${this.closingRecipeSyntax}`;

                let recordTypeTodoVerbiage = `${this.generateTabs(5)}### TODO: -- RecordType Options -- ${recordTypeApiNameKey} -- Below is the faker recipe for the record type ${recordTypeApiNameKey} for the field ${associatedFieldApiName}`;
                recordTypeTodoVerbiage += `${newLineBreak}${this.generateTabs(5)}${recordTypBasedFakeRecipeValue}`;

                if ( allRecordTypeBasedPicklistOptions.trim() === '' ) {
                    // check to see if allRecordTypeBasedPicklistOptions has been given an initial value to properly handle recipe spacing
                    allRecordTypeBasedPicklistOptions = `${recordTypeTodoVerbiage}`;
                } else {
                    allRecordTypeBasedPicklistOptions += `${newLineBreak}${recordTypeTodoVerbiage}`;
                }

            }

        });

        return allRecordTypeBasedPicklistOptions;

    }


    buildMultiSelectPicklistRecipeValueByXMLFieldDetail(availablePicklistChoices: string[],
                                                            recordTypeNameByRecordTypeWrapper: Record<string, RecordTypeWrapper>,
                                                            associatedFieldApiName
                                                        ): string {
   
        const fakerJoinedChoicesSyntax = this.buildMultPicklistFakerArrayElementsSyntaxByPicklistOptions(availablePicklistChoices);
        let fakeMultiSelectRecipeValue = `${this.openingRecipeSyntax} ${fakerJoinedChoicesSyntax} ${this.closingRecipeSyntax}`;

        const recordTypeBasedRecipeValues = this.buildRecordTypeBasedMultipicklistRecipeValue(recordTypeNameByRecordTypeWrapper, associatedFieldApiName);
        if ( recordTypeBasedRecipeValues) {
            fakeMultiSelectRecipeValue += `\n${recordTypeBasedRecipeValues}`;
        }
        return fakeMultiSelectRecipeValue;

    }

    buildRecordTypeBasedMultipicklistRecipeValue(recordTypeNameByRecordTypeWrapper: Record<string, RecordTypeWrapper>,
                                                    associatedFieldApiName: string) {

        let allRecordTypeBasedMultiselectPicklistOptions:string = '';
        const newLineBreak = `\n`;

        Object.entries(recordTypeNameByRecordTypeWrapper).forEach(([recordTypeApiNameKey, recordTypeWrapper]) => {

            const availableRecordTypePicklistValuesForField = recordTypeWrapper.PicklistFieldSectionsToPicklistDetail[associatedFieldApiName];
            if ( availableRecordTypePicklistValuesForField ) {

                const fakerJSJoinedMultiPicklsitChoicesSyntax = this.buildMultPicklistFakerArrayElementsSyntaxByPicklistOptions(availableRecordTypePicklistValuesForField);
                const recordTypBasedFakeRecipeValue = `${this.openingRecipeSyntax} ${fakerJSJoinedMultiPicklsitChoicesSyntax} ${this.closingRecipeSyntax}`;
                let recordTypeTodoVerbiage = `${this.generateTabs(5)}### TODO: -- RecordType Options -- ${recordTypeApiNameKey} -- Below is the Multiselect faker recipe for the record type ${recordTypeApiNameKey} for the field ${associatedFieldApiName}`;
                recordTypeTodoVerbiage += `${newLineBreak}${this.generateTabs(5)}${recordTypBasedFakeRecipeValue}`;

                if ( allRecordTypeBasedMultiselectPicklistOptions.trim() === '' ) {
                    // check to see if allRecordTypeBasedPicklistOptions has been given an initial value to properly handle recipe spacing
                    allRecordTypeBasedMultiselectPicklistOptions = `${recordTypeTodoVerbiage}`;
                } else {
                    allRecordTypeBasedMultiselectPicklistOptions += `${newLineBreak}${recordTypeTodoVerbiage}`;
                }

            }

        });

        return allRecordTypeBasedMultiselectPicklistOptions;

    }

    buildPicklistFakerArraySingleElementSyntaxByPicklistOptions(availablePicklistChoices: string[] ):string {

        const joinedChoices = availablePicklistChoices.map(option => `\`${option}\``).join(',');
        const fakerjsChoicesSyntax = `faker.helpers.arrayElement([${joinedChoices}])`;

        return fakerjsChoicesSyntax;

    }

    buildMultPicklistFakerArrayElementsSyntaxByPicklistOptions(availablePicklistChoices: string[] ):string {

        const joinedChoices = availablePicklistChoices.map(option => `\`${option}\``).join(',');
        const fakerjsChoicesSyntax = `(faker.helpers.arrayElements([${joinedChoices}])).join(';')`;

        return fakerjsChoicesSyntax;

    }

    getMapSalesforceFieldToFakerValue():Record<string, string> {

        const salesforceFieldToNPMFakerMap: Record<string, string> = {
            'text': `\${{ faker.lorem.text(5).substring(0, 255) }}`,
            'textarea': `\${{ faker.lorem.paragraph() }}`,
            'longtextarea': `\${{ faker.lorem.text(100) }}`,
            'html': `\${{ faker.string.alpha(10) }}`,
            'email': `\${{ faker.internet.email() }}`,
            'phone': `|
                \${{ faker.phone.number({style:'national'}) }}`,
            'url': `\${{ faker.internet.url() }}`,
            'number': `|
                \${{ faker.number.int({min: 0, max: 999999}) }}`,
            'currency': `\${{ faker.finance.amount(0, 999999, 2) }}`,
            'percent': `|
                \${{ faker.number.float({ min: 0, max: 99, precision: 0.01 }).toFixed(2) }}`,
            'date': `|
                \${{ faker.date.between({ from: new Date('2023-01-01'), to: new Date() }).toISOString().split('T')[0] }}`,
            'datetime': `|
                \${{ faker.date.between({ from: new Date('2023-01-01T00:00:00Z'), to: new Date() }).toISOString() }}`,
            'time': `|
                \${{ faker.date.between({ from: new Date('1970-01-01T00:00:00Z'), to: new Date('1970-01-01T23:59:59Z') }).toISOString().split('T')[1] }}`,
            'checkbox': `\${{ faker.datatype.boolean() }}`,
            'picklist': 'GENERATED BY FIELD XML MARKUP',
            'multiselectpicklist': 'GENERATED BY FIELD XML MARKUP',
            'lookup': '### TODO -- REFERENCE ID REQUIRED',
            'masterdetail': '### TODO -- REFERENCE ID REQUIRED',
            'formula': '### TODO - Formula fields are calculated, not generated - remove this line',
            'location': '### TODO -- SEE ONE PAGER - https://gist.github.com/jdschleicher/4abfd188a933598833285ee76e560445',
        };

        return salesforceFieldToNPMFakerMap;
    }

    getOOTBObjectApiNameToFieldApiNameMap(): Record<string, Record<string, string>> {

        const salesforceFakerMappings: Record<string, Record<string, string>> = {
            
            "Account": {
                "Name": `\${{faker.company.name()}}`,
                "AccountNumber": `\${{faker.string.numeric(8)}}`,
                "AnnualRevenue": `\${{faker.string.numeric(7)}}`,
                "BillingStreet": `\${{faker.location.streetAddress()}}`,
                "BillingCity": `\${{faker.location.city()}}`,
                "BillingState": `\${{faker.location.state()}}`,
                "BillingPostalCode": `\${{faker.location.zipCode()}}`,
                "BillingCountry": `\${{faker.location.country()}}`,
                "Description": `\${{faker.company.catchPhrase()}}`,
                "Industry": `\${{faker.helpers.arrayElement(['Technology', 'Finance', 'Healthcare', 'Retail', 'Manufacturing', 'Education'])}}`,
                "NumberOfEmployees": `\${{faker.string.numeric(4)}}`,
                "Phone": `|
                    \${{faker.phone.number({style:'national'})}}`,
                "Rating": `\${{faker.helpers.arrayElement(['Hot', 'Warm', 'Cold'])}}`,
                "ShippingStreet": `\${{faker.location.streetAddress()}}`,
                "ShippingCity": `\${{faker.location.city()}}`,
                "ShippingState": `\${{faker.location.state()}}`,
                "ShippingPostalCode": `\${{faker.location.zipCode()}}`,
                "ShippingCountry": `\${{faker.location.country()}}`,
                "Sic": `\${{faker.string.numeric(4)}}`,
                "Type": `\${{faker.helpers.arrayElement(['Customer', 'Partner', 'Prospect'])}}`,
                "Website": `\${{faker.internet.domainName()}}`
            },
                
            "Contact": {
                "FirstName": `\${{faker.person.firstName()}}`,
                "LastName": `\${{faker.person.lastName()}}`,
                "Email": `\${{faker.internet.email()}}`,
                "Phone": `|
                    \${{faker.phone.number({style:'national'})}}`,
                "MobilePhone": `|
                    \${{faker.phone.number({style:'national'})}}`,
                "Title": `\${{faker.job}}`,
                "Department": `\${{faker.helpers.arrayElement(['Sales', 'Marketing', 'IT', 'Finance', 'HR', 'Operations'])}}`,
                "Birthdate": `\${{faker.date.birthdate()}}`,
                "Description": `\${{faker.lorem.paragraph()}}`,
                "MailingStreet": `\${{faker.location.streetAddress()}}`,
                "MailingCity": `\${{faker.location.city()}}`,
                "MailingState": `\${{faker.location.state()}}`,
                "MailingPostalCode": `\${{faker.location.zipCode()}}`,
                "MailingCountry": `\${{faker.location.country()}}`,
                "OtherStreet": `\${{faker.location.streetAddress()}}`,
                "OtherCity": `\${{faker.location.city()}}`,
                "OtherState": `\${{faker.location.state()}}`,
                "OtherPostalCode": `\${{faker.location.zipCode()}}`,
                "OtherCountry": `\${{faker.location.country()}}`,
                "LeadSource": `\${{faker.helpers.arrayElement(['Web', 'Phone Inquiry', 'Partner', 'Purchased List', 'Other'])}}`,
                "Salutation": `\${{faker.helpers.arrayElement(['Mr.', 'Ms.', 'Mrs.', 'Dr.'])}}`,
                "AssistantName": `\${{faker.person.fullName()}}`,
                "AssistantPhone": `|
                    \${{faker.phone.number({style:'national'})}}`
            },
                
            "Opportunity": {
                "Name": `\${{faker.company.catchPhrase()}}`,
                "Amount": `\${{ (faker.string.numeric(6)) }}.00`,
                "CloseDate": `|
                    \${{ faker.date.between({from: (new Date().setDate(new Date().getDate() - 30)), to: (new Date().setDate(new Date().getDate() + 90)) }) }}`,
                "Description": `\${{faker.lorem.paragraph()}}`,
                "ExpectedRevenue": `\${{ (faker.string.numeric(6)) }}.00`,
                "LeadSource": `\${{faker.helpers.arrayElement(['Web', 'Phone Inquiry', 'Partner', 'Purchased List', 'Other'])}}`,
                "NextStep": `\${{faker.lorem.sentence()}}`,
                "Probability": `\${{ (faker.string.numeric(2))}}.0 `,
                "StageName": `\${{faker.helpers.arrayElement(['Prospecting', 'Qualification', 'Needs Analysis', 'Value Proposition', 'Id. Decision Makers', 'Perception Analysis', 'Proposal/Price Quote', 'Negotiation/Review', 'Closed Won', 'Closed Lost'])}}`,
                "Type": `\${{faker.helpers.arrayElement(['New Customer', 'Existing Customer - Upgrade', 'Existing Customer - Replacement', 'Existing Customer - Downgrade'])}}`,
                "ForecastCategory": `\${{faker.helpers.arrayElement(['Pipeline', 'Best Case', 'Commit', 'Closed'])}}`
            },
                
            "Lead": {
                "FirstName": `\${{faker.person.firstName()}}`,
                "LastName": `\${{faker.person.lastName()}}`,
                "Company": `\${{faker.company.name()}}`,
                "Title": `\${{faker.job}}`,
                "Email": `\${{faker.internet.email()}}`,
                "Phone": `|
                    \${{faker.phone.number({style:'national'})}}`,
                "MobilePhone": `|
                    \${{faker.phone.number({style:'national'})}}`,
                "Street": `\${{faker.location.streetAddress()}}`,
                "City": `\${{faker.location.city()}}`,
                "State": `\${{faker.location.state()}}`,
                "PostalCode": `\${{faker.location.zipCode()}}`,
                "Country": `\${{faker.location.country()}}`,
                "Industry": `\${{faker.helpers.arrayElement(['Technology', 'Finance', 'Healthcare', 'Retail', 'Manufacturing', 'Education'])}}`,
                "AnnualRevenue": `\${{faker.string.numeric(7)}}`,
                "Description": `\${{faker.lorem.paragraph()}}`,
                "LeadSource": `\${{faker.helpers.arrayElement(['Web', 'Phone Inquiry', 'Partner', 'Purchased List', 'Other'])}}`,
                "Rating": `\${{faker.helpers.arrayElement(['Hot', 'Warm', 'Cold'])}}`,
                "Status": `\${{faker.helpers.arrayElement(['Open - Not Contacted', 'Working - Contacted', 'Closed - Converted', 'Closed - Not Converted'])}}`,
                "NumberOfEmployees": `\${{faker.string.numeric(4)}}`
            },
                
            "Case": {
                "Subject": `\${{faker.company.catchPhrase()}}`,
                "Description": `\${{faker.lorem.paragraph()}}`,
                "Status": `\${{faker.helpers.arrayElement(['New', 'Working', 'Escalated', 'Closed'])}}`,
                "Origin": `\${{faker.helpers.arrayElement(['Email', 'Phone', 'Web', 'Social'])}}`,
                "Priority": `\${{faker.helpers.arrayElement(['High', 'Medium', 'Low'])}}`,
                "Type": `\${{faker.helpers.arrayElement(['Problem', 'Feature Request', 'Question'])}}`,
                "Reason": `\${{faker.helpers.arrayElement(['Installation', 'Equipment Complexity', 'Performance', 'Breakdown', 'Equipment Design', 'Feedback'])}}`,
                "SuppliedName": `\${{faker.person.fullName()}}`,
                "SuppliedEmail": `\${{faker.internet.email()}}`,
                "SuppliedPhone": `|
                    \${{faker.phone.number({style:'national'})}}`,
                "SuppliedCompany": `\${{faker.company.name()}}`
            },
                
            "Campaign": {
                "Name": `\${{faker.company.bs()}}`,
                "Type": `\${{faker.helpers.arrayElement(['Email', 'Webinar', 'Conference', 'Direct Mail', 'Advertisement'])}}`,
                "Status": `\${{faker.helpers.arrayElement(['Planned', 'In Progress', 'Completed', 'Aborted'])}}`,
                "StartDate": `|
                    \${{faker.date.between({from: (new Date().setDate(new Date().getDate() - 30)), to: (new Date().setDate(new Date().getDate() + 90)) })}}`,
                "EndDate": `|
                    \${{faker.date.between({from: (new Date().setDate(new Date().getDate() + 91)), to: (new Date().setDate(new Date().getDate() + 180)) })}}`,
                "Description": `\${{faker.lorem.paragraph()}}`,
                "BudgetedCost": `"\{{ (faker.string.numeric(5)) }}.00`,
                "ActualCost": `"\{{ (faker.string.numeric(5)) }}.00`,
                "ExpectedRevenue": `"\{{ (faker.string.numeric(6)) }}.00`,
                "ExpectedResponse": `"\{{ (faker.string.numeric(2)) }}.0`,
                "NumberOfContacts": `\${{faker.string.numeric(3)}}`,
                "NumberOfLeads": `\${{faker.string.numeric(3)}}`,
                "NumberOfOpportunities": `\${{faker.string.numeric(2)}}`,
                "NumberOfResponses": `\${{faker.string.numeric(3)}}`
            },
                
            "Task": {
                "Subject": `\${{faker.company.catchPhrase()}}`,
                "Description": `\${{faker.lorem.paragraph()}}`,
                "Status": `\${{faker.helpers.arrayElement(['Not Started', 'In Progress', 'Completed', 'Waiting on someone else', 'Deferred'])}}`,
                "Priority": `\${{faker.helpers.arrayElement(['High', 'Normal', 'Low'])}}`,
                "ActivityDate": `|
                    \${{faker.date.between({from: (new Date().setDate(new Date().getDate() - 7)), to: (new Date().setDate(new Date().getDate() + 30)) })}}`,
                "Type": `\${{faker.helpers.arrayElement(['Call', 'Meeting', 'Other'])}}`,
                "CallType": `\${{faker.helpers.arrayElement(['Inbound', 'Outbound'])}}`
            },
                
            "Event": {
                "Subject": `\${{faker.company.catchPhrase()}}`,
                "Description": `\${{faker.lorem.paragraph()}}`,
                "StartDateTime": `|
                    \${{faker.date.between({from: (new Date().setDate(new Date().getDate() - 7)), to: (new Date().setDate(new Date().getDate() + 30)) })}}`,
                "EndDateTime": `|
                    \${{faker.date.between({from: (new Date().setDate(new Date().getDate() + 31)), to: (new Date().setDate(new Date().getDate() + 38)) })}}`,
                "Location": `\${{faker.location.streetAddress()}}, {{faker.location.city()}}, {{faker.location.state()}} {{faker.location.zipCode()}}`,
                "ShowAs": `\${{faker.helpers.arrayElement(['Busy', 'Free', 'OutOfOffice', 'Working'])}}`,
                "Type": `\${{faker.helpers.arrayElement(['Meeting', 'Call', 'Other'])}}`,
                "IsAllDayEvent": `\${{faker.helpers.arrayElement(['true', 'false'])}}`
            },
                
            "Product2": {
                "Name": `\${{faker.commerce.productName()}}`,
                "Description": `\${{faker.lorem.paragraph()}}`,
                "ProductCode": `\${{faker.commerce.product()}}-\${{faker.string.alphanumeric(6)}}`,
                "IsActive": `\${{faker.helpers.arrayElement(['true', 'false'])}}`,
                "Family": `\${{faker.helpers.arrayElement(['Hardware', 'Software', 'Services', 'Other'])}}`,
                "QuantityUnitOfMeasure": `\${{faker.helpers.arrayElement(['Each', 'Case', 'Box', 'Pallet'])}}`,
                "DisplayUrl": `\${{faker.internet.url()}}`,
                "ExternalId": `\${{faker.string.uuid()}}`
            },
                
            "PriceBook2": {
                "Name": `\${{ (faker.company.bs()) Price Book }} "`,
                "Description": `\${{faker.lorem.paragraph()}}`,
                "IsActive": `\${{faker.helpers.arrayElement(['true', 'false'])}}`
            },
                
            "Asset": {
                "Name": `\${{faker.commerce.productName()}}`,
                "Description": `\${{faker.lorem.paragraph()}}`,
                "InstallDate": `|
                    \${{faker.date.between({from: (new Date().setDate(new Date().getDate() - 365)), to: (new Date()) })}}`,
                "PurchaseDate": `|
                    \${{faker.date.between({from: (new Date().setDate(new Date().getDate() - 730)), to: (new Date().setDate(new Date().getDate() - 366)) })}}`,
                "SerialNumber": `\${{faker.string.alphanumeric(10)}}-{{faker.string.numeric(6)}}`,
                "Status": `\${{faker.helpers.arrayElement(['Purchased', 'Shipped', 'Installed', 'Registered'])}}`,
                "Price": `\${{ (faker.string.numeric(5)) }}.00`,
                "Quantity": `\${{faker.string.numeric(2)}}`
            },
                
            "Contract": {
                "Status": `\${{faker.helpers.arrayElement(['Draft', 'In Approval Process', 'Activated', 'Terminated'])}}`,
                "StartDate": `|
                    \${{faker.date.between({from: (new Date().setDate(new Date().getDate() - 30)), to: (new Date().setDate(new Date().getDate() + 90)) })}}`,
                "ContractTerm": `\${{faker.string.numeric(2)}}`,
                "OwnerExpirationNotice": `\${{faker.helpers.arrayElement(['15', '30', '45', '60', '90'])}}`,
                "Description": `\${{faker.lorem.paragraph()}}`,
                "BillingStreet": `\${{faker.location.streetAddress()}}`,
                "BillingCity": `\${{faker.location.city()}}`,
                "BillingState": `\${{faker.location.state()}}`,
                "BillingPostalCode": `\${{faker.location.zipCode()}}`,
                "BillingCountry": `\${{faker.location.country()}}`,
                "ShippingStreet": `\${{faker.location.streetAddress()}}`,
                "ShippingCity": `\${{faker.location.city()}}`,
                "ShippingState": `\${{faker.location.state()}}`,
                "ShippingPostalCode": `\${{faker.location.zipCode()}}`,
                "ShippingCountry": `\${{faker.location.country()}}`,
                "SpecialTerms": `\${{faker.lorem.paragraph()}}`
            }
            
        };
    
    
        return salesforceFakerMappings;
    
    }

    getStandardAndGlobalValueSetTODOPlaceholderWithExample():string {

        const emptyPicklistXMLDetailRecipePlaceholder = `### TODO: POSSIBLE GLOBAL OR STANDARD VALUE SET USED FOR THIS PICKLIST AS DETAILS ARE NOT IN FIELD XML MARKUP -- FIND ASSOCIATED VALUE SET AND REPALCE COMMA SEPARATED FRUITS WITH VALUE SET OPTIONS: \${{ faker.helpers.arrayElement(['banana', 'orange', 'apple']) }}`;
        return emptyPicklistXMLDetailRecipePlaceholder;

    }

    getMultipicklistTODOPlaceholderWithExample():string {

        const emptyMultiSelectXMLDetailPlaceholder = `### TODO: POSSIBLE GLOBAL OR STANDARD VALUE SET USED FOR THIS MULTIPICKLIST AS DETAILS ARE NOT IN FIELD XML MARKUP -- FIND ASSOCIATED VALUE SET AND REPLACE COMMA SEPARATED FRUITS WITH VALUE SET OPTIONS: \${{ (faker.helpers.arrayElements(['apple', 'orange', 'banana']) ).join(';') }}`;
        return emptyMultiSelectXMLDetailPlaceholder;

    }

    buildTextRecipeValueWithLength(length: number): string {
        return `${this.openingRecipeSyntax} faker.lorem.text(${length}).substring(0, ${length}) ${this.closingRecipeSyntax}`;
    }

    buildNumericRecipeValueWithPrecision(precision: number): string {
        // For numeric fields, precision typically represents total digits, but we can use it to limit the range
        const maxValue = Math.pow(10, precision) - 1;
        return `${this.openingRecipeSyntax} faker.number.int({min: 0, max: ${maxValue}}) ${this.closingRecipeSyntax}`;
    }

}
