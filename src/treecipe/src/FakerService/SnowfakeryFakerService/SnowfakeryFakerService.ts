

import { RecordTypeWrapper } from "../../RecordTypeService/RecordTypesWrapper";
import { IFakerService } from "../IFakerService";

export class SnowfakeryFakerService implements IFakerService {

    openingRecipeSyntax:string = "${{";
    closingRecipeSyntax:string = "}}";

    generateTabs(tabCount: number):string {
        const spacesPerTab = 4;
        return ' '.repeat(spacesPerTab * tabCount);
    }

    getMapSalesforceFieldToFakerValue():Record<string, string> {

        const salesforceFieldToSnowfakeryMap: Record<string, string> = {
            'text': '${{fake.text(max_nb_chars=50)}}',
            'textarea': '${{fake.paragraph()}}',
            'longtextarea': '${{fake.text(max_nb_chars=1000)}}',
            'html': '${{fake.text(max_nb_chars=1000)}}',
            'email': '${{fake.email()}}',
            'phone': '${{fake.phone_number()}}',
            'url': '${{fake.url()}}',
            'number': '${{fake.random_int(min=0, max=999999)}}',
            'currency': '${{fake.pydecimal(left_digits=6, right_digits=2, positive=True)}}',
            'percent': '${{fake.pydecimal(left_digits=2, right_digits=2, positive=True)}}',
            'date': '${{date(fake.date_between(start_date="-1y", end_date="today"))}}',
            'datetime': '${{ (fake.date_time_between(start_date="-1y", end_date="now")).strftime("%Y-%m-%dT%H:%M:%S.000+0000") }}',
            'time': '${{fake.time()}}',
            'picklist': 'GENERATED BY FIELD XML MARKUP',
            'multiselectpicklist': 'GENERATED BY FIELD XML MARKUP',
            'checkbox': '${{ (random_choice("true", "false")).lower() }}',
            'lookup': '### TODO -- REFERENCE ID REQUIRED',
            'masterdetail': '### TODO -- REFERENCE ID REQUIRED',
            'formula': '### TODO - REMOVE ME - Formula fields are calculated, not generated',
            'location': '"### TODO -- SEE ONE PAGER - https://gist.github.com/jdschleicher/4abfd188a933598833285ee76e560445"'
        };
    
        return salesforceFieldToSnowfakeryMap;

    }

    buildMultiSelectPicklistRecipeValueByXMLFieldDetail(availablePicklistChoices: string[],
                                                        recordTypeNameByRecordTypeWrapper: Record<string, RecordTypeWrapper>,
                                                        associatedFieldApiName
                                                        ): string {

        const commaJoinedPicklistChoices = availablePicklistChoices.join("', '");
        let fakeMultiSelectRecipeValue = `${this.openingRecipeSyntax} (';').join((fake.random_sample(elements=('${commaJoinedPicklistChoices}')))) ${this.closingRecipeSyntax}`;
        
        const recordTypeBasedRecipeValues = this.buildRecordTypeBasedMultipicklistRecipeValue(recordTypeNameByRecordTypeWrapper, associatedFieldApiName);
        if ( recordTypeBasedRecipeValues) {
            fakeMultiSelectRecipeValue += `\n${recordTypeBasedRecipeValues}`;
        }
        
        return fakeMultiSelectRecipeValue;

    }

    buildDependentPicklistRecipeFakerValue(
                        controllingValueToPicklistOptions: Record<string, string[]>, 
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
${this.generateTabs(3)}when: ${this.openingRecipeSyntax} ${controllingField} == '${controllingValueKey}' }}
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

    buildPicklistRecipeValueByXMLFieldDetail(availablePicklistChoices: string[], 
                                                recordTypeNameByRecordTypeWrapper: Record<string, RecordTypeWrapper>,
                                                associatedFieldApiName): string {

        const commaJoinedPicklistChoices = availablePicklistChoices.join("', '");
        let fakeRecipeValue = `${this.openingRecipeSyntax} random_choice('${commaJoinedPicklistChoices}') ${this.closingRecipeSyntax}`;

        const recordTypeBasedRecipeValues = this.buildRecordTypeBasedPicklistRecipeValue(recordTypeNameByRecordTypeWrapper, associatedFieldApiName);
        if ( recordTypeBasedRecipeValues) {
            fakeRecipeValue += `\n${recordTypeBasedRecipeValues}`;
        }

        return fakeRecipeValue;

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

    buildRecordTypeBasedPicklistRecipeValue(recordTypeNameByRecordTypeWrapper: Record<string, RecordTypeWrapper>,
                                            associatedFieldApiName: string) {

        let allRecordTypeBasedPicklistOptions:string = '';
        const newLineBreak = `\n`;

        Object.entries(recordTypeNameByRecordTypeWrapper).forEach(([recordTypeApiNameKey, recordTypeWrapper]) => {

            const availableRecordTypePicklistValuesForField = recordTypeWrapper.PicklistFieldSectionsToPicklistDetail[associatedFieldApiName];
            if ( availableRecordTypePicklistValuesForField ) {

                const commaJoinedPicklistChoices = availableRecordTypePicklistValuesForField.join("', '");
                const recordTypBasedFakeRecipeValue = `${this.openingRecipeSyntax} random_choice('${commaJoinedPicklistChoices}') ${this.closingRecipeSyntax}`;
    
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

    buildRecordTypeBasedMultipicklistRecipeValue(recordTypeNameByRecordTypeWrapper: Record<string, RecordTypeWrapper>,
                                                    associatedFieldApiName: string) {


        let allRecordTypeBasedMultiselectPicklistOptions:string = '';
        const newLineBreak = `\n`;

        Object.entries(recordTypeNameByRecordTypeWrapper).forEach(([recordTypeApiNameKey, recordTypeWrapper]) => {

            const availableRecordTypePicklistValuesForField = recordTypeWrapper.PicklistFieldSectionsToPicklistDetail[associatedFieldApiName];
            if ( availableRecordTypePicklistValuesForField ) {

                const commaJoinedPicklistChoices = availableRecordTypePicklistValuesForField.join("', '");
                const recordTypBasedFakeRecipeValue = `${this.openingRecipeSyntax} (';').join((fake.random_sample(elements=('${commaJoinedPicklistChoices}')))) ${this.closingRecipeSyntax}`;
                
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

    getOOTBObjectApiNameToFieldApiNameMap(): Record<string, Record<string, string>> {

        const salesforceSnowfakeryMappings: Record<string, Record<string, string>> = {
            
            "Account": {
              "Name": "${{fake.company}}",
              "AnnualRevenue": "${{random_number(1000000,9999999)}}.00",
              "BillingStreet": "${{fake.street_address}}",
              "BillingCity": "${{fake.city}}",
              "BillingState": "${{fake.state}}",
              "BillingPostalCode": "${{fake.zipcode}}",
              "BillingCountry": "${{fake.country}}",
              "Description": "${{fake.catch_phrase}}",
              "Industry": "${{random_choice('Technology', 'Finance', 'Healthcare', 'Retail', 'Manufacturing', 'Education')}}",
              "NumberOfEmployees": "${{random_number(1000,9999)}}",
              "Phone": "${{fake.phone_number}}",
              "Rating": "${{random_choice('Hot', 'Warm', 'Cold')}}",
              "ShippingStreet": "${{fake.street_address}}",
              "ShippingCity": "${{fake.city}}",
              "ShippingState": "${{fake.state}}",
              "ShippingPostalCode": "${{fake.zipcode}}",
              "ShippingCountry": "${{fake.country}}",
              "Type": "${{random_choice('Customer', 'Partner', 'Prospect')}}",
              "Website": "${{fake.domain_name}}"
            },
            
            "Contact": {
              "FirstName": "${{fake.first_name}}",
              "LastName": "${{fake.last_name}}",
              "Email": "${{fake.email}}",
              "Phone": "${{fake.phone_number}}",
              "MobilePhone": "${{fake.phone_number}}",
              "Title": "${{fake.job}}",
              "Department": "${{random_choice('Sales', 'Marketing', 'IT', 'Finance', 'HR', 'Operations')}}",
              "Birthdate": "${{fake.date_of_birth}}",
              "Description": "${{fake.paragraph}}",
              "MailingStreet": "${{fake.street_address}}",
              "MailingCity": "${{fake.city}}",
              "MailingState": "${{fake.state}}",
              "MailingPostalCode": "${{fake.zipcode}}",
              "MailingCountry": "${{fake.country}}",
              "OtherStreet": "${{fake.street_address}}",
              "OtherCity": "${{fake.city}}",
              "OtherState": "${{fake.state}}",
              "OtherPostalCode": "${{fake.zipcode}}",
              "OtherCountry": "${{fake.country}}",
              "LeadSource": "${{random_choice('Web', 'Phone Inquiry', 'Partner', 'Purchased List', 'Other')}}",
              "Salutation": "${{random_choice('Mr.', 'Ms.', 'Mrs.', 'Dr.')}}",
              "AssistantName": "${{fake.name}}",
              "AssistantPhone": "${{fake.phone_number}}"
            },
            
            "Opportunity": {
              "Name": "${{fake.catch_phrase}}",
              "Amount": "${{random_number(100000,999999)}}.00",
              "CloseDate": "${{date_between(start_date='-30d', end_date='+90d')}}",
              "Description": "${{fake.paragraph}}",
              "ExpectedRevenue": "${{random_number(100000,999999)}}.00",
              "LeadSource": "${{random_choice('Web', 'Phone Inquiry', 'Partner', 'Purchased List', 'Other')}}",
              "NextStep": "${{fake.sentence}}",
              "Probability": "${{random_number(10,99)}}.0",
              "StageName": "${{random_choice('Prospecting', 'Qualification', 'Needs Analysis', 'Value Proposition', 'Id. Decision Makers', 'Perception Analysis', 'Proposal/Price Quote', 'Negotiation/Review', 'Closed Won', 'Closed Lost')}}",
              "Type": "${{random_choice('New Customer', 'Existing Customer - Upgrade', 'Existing Customer - Replacement', 'Existing Customer - Downgrade')}}",
              "ForecastCategory": "${{random_choice('Pipeline', 'Best Case', 'Commit', 'Closed')}}"
            },
            
            "Lead": {
              "FirstName": "${{fake.first_name}}",
              "LastName": "${{fake.last_name}}",
              "Company": "${{fake.company}}",
              "Title": "${{fake.job}}",
              "Email": "${{fake.email}}",
              "Phone": "${{fake.phone_number}}",
              "MobilePhone": "${{fake.phone_number}}",
              "Street": "${{fake.street_address}}",
              "City": "${{fake.city}}",
              "State": "${{fake.state}}",
              "PostalCode": "${{fake.zipcode}}",
              "Country": "${{fake.country}}",
              "Industry": "${{random_choice('Technology', 'Finance', 'Healthcare', 'Retail', 'Manufacturing', 'Education')}}",
              "AnnualRevenue": "${{random_number(1000000,9999999)}}",
              "Description": "${{fake.paragraph}}",
              "LeadSource": "${{random_choice('Web', 'Phone Inquiry', 'Partner', 'Purchased List', 'Other')}}",
              "Rating": "${{random_choice('Hot', 'Warm', 'Cold')}}",
              "Status": "${{random_choice('Open - Not Contacted', 'Working - Contacted', 'Closed - Converted', 'Closed - Not Converted')}}",
              "NumberOfEmployees": "${{random_number(1000,9999)}}"
            },
            
            "Case": {
              "Subject": "${{fake.catch_phrase}}",
              "Description": "${{fake.paragraph}}",
              "Status": "${{random_choice('New', 'Working', 'Escalated', 'Closed')}}",
              "Origin": "${{random_choice('Email', 'Phone', 'Web', 'Social')}}",
              "Priority": "${{random_choice('High', 'Medium', 'Low')}}",
              "Type": "${{random_choice('Problem', 'Feature Request', 'Question')}}",
              "Reason": "${{random_choice('Installation', 'Equipment Complexity', 'Performance', 'Breakdown', 'Equipment Design', 'Feedback')}}",
              "SuppliedName": "${{fake.name}}",
              "SuppliedEmail": "${{fake.email}}",
              "SuppliedPhone": "${{fake.phone_number}}",
              "SuppliedCompany": "${{fake.company}}"
            },
            
            "Campaign": {
              "Name": "${{fake.bs}}",
              "Type": "${{random_choice('Email', 'Webinar', 'Conference', 'Direct Mail', 'Advertisement')}}",
              "Status": "${{random_choice('Planned', 'In Progress', 'Completed', 'Aborted')}}",
              "StartDate": "${{date_between(start_date='-30d', end_date='+90d')}}",
              "EndDate": "${{date_between(start_date='+91d', end_date='+180d')}}",
              "Description": "${{fake.paragraph}}",
              "BudgetedCost": "${{random_number(10000,99999)}}.00",
              "ActualCost": "${{random_number(10000,99999)}}.00",
              "ExpectedRevenue": "${{random_number(100000,999999)}}.00",
              "ExpectedResponse": "${{random_number(10,99)}}.0",
              "NumberOfContacts": "${{random_number(100,999)}}",
              "NumberOfLeads": "${{random_number(100,999)}}",
              "NumberOfOpportunities": "${{random_number(10,99)}}",
              "NumberOfResponses": "${{random_number(100,999)}}"
            },
            
            "Task": {
              "Subject": "${{fake.catch_phrase}}",
              "Description": "${{fake.paragraph}}",
              "Status": "${{random_choice('Not Started', 'In Progress', 'Completed', 'Waiting on someone else', 'Deferred')}}",
              "Priority": "${{random_choice('High', 'Normal', 'Low')}}",
              "ActivityDate": "${{date_between(start_date='-7d', end_date='+30d')}}",
              "Type": "${{random_choice('Call', 'Meeting', 'Other')}}",
              "CallType": "${{random_choice('Inbound', 'Outbound')}}"
            },
            
            "Product2": {
              "Name": "${{fake.catch_phrase}}",
              "Description": "${{fake.paragraph}}",
              "ProductCode": "${{fake.ean}}",
              "IsActive": "${{random_choice('true', 'false')}}",
              "Family": "${{random_choice('Hardware', 'Software', 'Services', 'Other')}}",
              "QuantityUnitOfMeasure": "${{random_choice('Each', 'Case', 'Box', 'Pallet')}}",
              "DisplayUrl": "${{fake.url}}",
              "ExternalId": "${{fake.uuid4}}"
            },
            
            "Pricebook2": {
              "Name": "${{fake.bs}} Price Book",
              "Description": "${{fake.paragraph}}",
              "IsActive": "${{random_choice('true', 'false')}}"
            }
            
          };


        return salesforceSnowfakeryMappings;

    }

}