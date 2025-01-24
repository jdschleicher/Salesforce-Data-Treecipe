

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
            'richtextarea': '${{fake.text(max_nb_chars=1000)}}',
            'email': '${{fake.email()}}',
            'phone': '${{fake.phone_number()}}',
            'url': '${{fake.url()}}',
            'number': '${{fake.random_int(min=0, max=999999)}}',
            'currency': '${{fake.pydecimal(left_digits=6, right_digits=2, positive=True)}}',
            'percent': '${{fake.pydecimal(left_digits=2, right_digits=2, positive=True)}}',
            'date': '${{date(fake.date_between(start_date="-1y", end_date="today"))}}',
            'datetime': '${{fake.date_time_between(start_date="-1y", end_date="now")}}',
            'time': '${{fake.time()}}',
            'picklist': 'GENERATED BY FIELD XML MARKUP',
            'multiselectpicklist': 'GENERATED BY FIELD XML MARKUP',
            'checkbox': '${{fake.boolean()}}',
            'lookup': '"TODO -- REFERENCE ID REQUIRED"',
            'masterdetail': '"TODO -- REFERENCE ID REQUIRED"',
            'formula': 'Formula fields are calculated, not generated',
            'location': '"SEE ONE PAGER - https://gist.github.com/jdschleicher/4abfd188a933598833285ee76e560445"'
        };
    
        return salesforceFieldToSnowfakeryMap;

    }

    buildMultiSelectPicklistRecipeValueByXMLFieldDetail(availablePicklistChoices: string[]): string {

        const commaJoinedPicklistChoices = availablePicklistChoices.join("','");
        const fakeMultiSelectRecipeValue = `${this.openingRecipeSyntax} (';').join((fake.random_sample(elements=('${commaJoinedPicklistChoices}')))) ${this.closingRecipeSyntax}`;
        return fakeMultiSelectRecipeValue;

    }

    buildDependentPicklistRecipeFakerValue(
                        controllingValueToPicklistOptions: Record<string, string[]>, 
                        recordTypeNameByRecordTypeNameToXMLMarkup: Record<string, any>,
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

            randomChoicesBreakdown = this.updateDependentPicklistRecipeFakerValueByRecordTypeSections( 
                                            recordTypeNameByRecordTypeNameToXMLMarkup, 
                                            fieldApiName, 
                                            picklistValuesAvailableForChoice, 
                                            randomChoicesBreakdown 
                                        );

            // for ( const recordTypeKey in recordTypeNameByRecordTypeNameToXMLMarkup ) {
                
            //     let recordTypePicklistSections = recordTypeNameByRecordTypeNameToXMLMarkup[recordTypeKey]?.RecordType?.picklistValues;

            //     if ( recordTypePicklistSections ) {

            //         recordTypePicklistSections.forEach( recordTypeSection => {  
                
            //             let recordTypeChoicesBreakdown:string;
            //             const fieldApiNameFromRecordTypeMarkup = recordTypeSection.picklist[0];
            //             /*  
            //                 ENSURE THAT THE FIELD API NAME FROM THE RECORD TYPE MARKUP MATCHES THE FIELD API NAME
            //                 AS THE RECORD TYPE MARKUP INCLUDES MULTIPLE FIELDS AND ASSOCIATED PICKLIST VALUES
            //             */
            //             if ( fieldApiNameFromRecordTypeMarkup === fieldApiName) { 

            //                 recordTypeSection.values.forEach( recordTypeValueDetail => {

            //                     const recordTypePicklistValue = recordTypeValueDetail.fullName[0];

            //                     picklistValuesAvailableForChoice.forEach( availableValue => {

            //                         if ( availableValue === recordTypePicklistValue ) {

            //                             if (recordTypeChoicesBreakdown) {
            //                                 recordTypeChoicesBreakdown += `${newLineBreak}${this.generateTabs(5)}- ${recordTypePicklistValue}`;
            //                             } else {
            //                                 const recordTypeTodoVerbiage = `### TODO: SELECT BELOW OPTIONS IF USING RECORD TYPE -- ${recordTypeKey}`;
            //                                 recordTypeChoicesBreakdown = `${newLineBreak}${this.generateTabs(5)}${recordTypeTodoVerbiage}${newLineBreak}${this.generateTabs(5)}- ${recordTypePicklistValue}`;                                
            //                             }

            //                         }
                    
            //                     });  
                
            //                 });  
                    
            //                 randomChoicesBreakdown += recordTypeChoicesBreakdown;

            //             }
               
            //         });



            //     }      
       
            // }


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

    buildPicklistRecipeValueByXMLFieldDetail(availablePicklistChoices: string[]): string {

        const commaJoinedPicklistChoices = availablePicklistChoices.join("','");
        const fakeRecipeValue = `${this.openingRecipeSyntax} random_choice('${commaJoinedPicklistChoices}') ${this.closingRecipeSyntax}`;
        return fakeRecipeValue;

    }


    updateDependentPicklistRecipeFakerValueByRecordTypeSections(recordTypeNameByRecordTypeNameToXMLMarkup: Record<string, any>,
                                                                fieldApiName: string,
                                                                picklistValuesAvailableForChoice: string[],
                                                                randomChoicesBreakdown: string
                                                            ): string {

        const newLineBreak: string = `\n`;

        // Object.entries(recordTypeNameByRecordTypeNameToXMLMarkup).forEach(([recordTypeKey, value]) => {
        //     console.log(`Key: ${key}, Value: ${value}`);
        //   });

        Object.entries(recordTypeNameByRecordTypeNameToXMLMarkup).forEach(([recordTypeKey, recordTypeDetail]) => {

        // for ( const recordTypeKey in recordTypeNameByRecordTypeNameToXMLMarkup ) {
                
            let recordTypePicklistSections = recordTypeDetail?.RecordType?.picklistValues;

            if ( recordTypePicklistSections ) {

                recordTypePicklistSections.forEach( recordTypeSection => {  
            
                    let recordTypeChoicesBreakdown:string;
                    const fieldApiNameFromRecordTypeMarkup = recordTypeSection.picklist[0];
                    /*  
                        ENSURE THAT THE FIELD API NAME FROM THE RECORD TYPE MARKUP MATCHES THE FIELD API NAME
                        AS THE RECORD TYPE MARKUP INCLUDES MULTIPLE FIELDS AND ASSOCIATED PICKLIST VALUES
                    */
                    if ( fieldApiNameFromRecordTypeMarkup === fieldApiName) { 

                        recordTypeSection.values.forEach( recordTypePicklistValueDetail => {

                            const recordTypePicklistValue = recordTypePicklistValueDetail.fullName[0];

                            picklistValuesAvailableForChoice.forEach( availableValue => {

                                if ( availableValue === recordTypePicklistValue ) {

                                    if (recordTypeChoicesBreakdown) {
                                        recordTypeChoicesBreakdown += `${newLineBreak}${this.generateTabs(5)}- ${recordTypePicklistValue}`;
                                    } else {
                                        const recordTypeTodoVerbiage = `### TODO: SELECT BELOW OPTIONS IF USING RECORD TYPE -- ${recordTypeKey}`;
                                        recordTypeChoicesBreakdown = `${newLineBreak}${this.generateTabs(5)}${recordTypeTodoVerbiage}${newLineBreak}${this.generateTabs(5)}- ${recordTypePicklistValue}`;                                
                                    }

                                }
                
                            });  
            
                        });  
                
                        randomChoicesBreakdown += recordTypeChoicesBreakdown;

                    }
            
                });

            }      
    
        // }
        });

        return randomChoicesBreakdown;

    }

}