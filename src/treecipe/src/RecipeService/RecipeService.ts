import { IFakerService } from "../FakerService/IFakerService";

import { XMLFieldDetail } from "../XMLProcessingService/XMLFieldDetail";


export class RecipeService {


    private fakerService: IFakerService;
    constructor(private fakerServiceImplementation) {
        this.fakerService = fakerServiceImplementation;
    }

    generateTabs(tabCount: number):string {
        const spacesPerTab = 4;
        return ' '.repeat(spacesPerTab * tabCount);
    }

    getSalesforceFieldToSnowfakeryMap() {
        this.fakerService.getMapSalesforceFieldToFakerValue();
    }

    getRecipeFakeValueByXMLFieldDetail(xmlFieldDetail: XMLFieldDetail): string {
        
        let fakeRecipeValue;
        const fieldType = xmlFieldDetail.fieldType.toLowerCase();
        switch (fieldType) {
            
            case 'picklist':
                
                if (xmlFieldDetail.controllingField) {
                    fakeRecipeValue = this.getDependentPicklistRecipeFakerValue(xmlFieldDetail);
                } else {
                    if ( !(xmlFieldDetail.picklistValues) ) {
                        return '';
                    }
                    const availablePicklistChoices = xmlFieldDetail.picklistValues.map(detail => detail.fullName);
                    fakeRecipeValue = this.fakerService.buildPicklistRecipeValueByXMLFieldDetail(availablePicklistChoices);
                }

                return fakeRecipeValue;
                
            case 'multiselectpicklist':

                if ( !(xmlFieldDetail.picklistValues) ) {
                    return '';
                }
                const availablePicklistChoices = xmlFieldDetail.picklistValues.map(detail => detail.fullName);
                fakeRecipeValue = this.fakerService.buildMultiSelectPicklistRecipeValueByXMLFieldDetail(availablePicklistChoices);
        
                return fakeRecipeValue;
                
            // case 'masterdetail':
                
            //     return {
            //         type: 'lookup'
            //     };

            // case 'lookiup':

            //     return 'test';
                
            default: 
                const fieldToRecipeValueMap = this.fakerService.getMapSalesforceFieldToFakerValue;
                // CHECK IF VALID FIELD TYPE OR EXISTS IN PROGRAMS SALESFORCE FIELD MAP
                if ( fieldType in fieldToRecipeValueMap ) {
                    fakeRecipeValue = fieldToRecipeValueMap[fieldType];
                } else {
                    // NOT THROWING EXCEPTION HERE, WE WANT THE REMAINING FIELDS TO BE PROCESSED
                    fakeRecipeValue = `"FieldType Not Handled -- ${fieldType} does not exist in this programs Salesforce field map."`;
                }

                return fakeRecipeValue;
            

        }

    }

    getDependentPicklistRecipeFakerValue(xmlFieldDetail: XMLFieldDetail): string {
    
        const controllingField = xmlFieldDetail.controllingField;
        let controllingValueToPicklistOptions:Record<string, string[]> = {};

        if ( !(xmlFieldDetail.picklistValues) ) {
            return '';
        }
        xmlFieldDetail.picklistValues.forEach(picklistOption => {
            
            if ( !(picklistOption.availableForControllingValues) ) {
                return '';
            }
            picklistOption.availableForControllingValues.forEach((controllingValue) => {

                if ( controllingValue in controllingValueToPicklistOptions ) {
                    controllingValueToPicklistOptions[controllingValue].push(picklistOption.fullName);
                } else {
                    controllingValueToPicklistOptions[controllingValue] = [ picklistOption.fullName ];
                }

            });

        });

        return this.fakerService.buildDependentPicklistRecipeFakerValue(controllingValueToPicklistOptions, controllingField);
        
    }


    initiateRecipeByObjectName(objectName: string): string {

        // ADD NEW LINE CHARACTER TO SEPARATE OBJECT RECIPES WHEN THEY ARE ADDED TOGETHER
        const objectRecipeMarkup = 
`\n- object: ${objectName}
  nickname: ${objectName}_NickName
  count: 1
  fields:`;

        return objectRecipeMarkup;
    }

    appendFieldRecipeToObjectRecipe(objectRecipe:string, fieldRecipe: string, fieldApiName: string): string {
        const fieldPropertAndRecipeValue = `${fieldApiName}: ${fieldRecipe}`;
        const updatedObjectRecipe =
`${objectRecipe}
${this.generateTabs(1)}${fieldPropertAndRecipeValue}`;

        return updatedObjectRecipe;
    }


    
}