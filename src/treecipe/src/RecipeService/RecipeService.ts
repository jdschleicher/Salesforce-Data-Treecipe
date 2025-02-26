import { IFakerService } from "../FakerService/IFakerService";
import { RecordTypeWrapper } from "../RecordTypeService/RecordTypesWrapper";
import { XMLFieldDetail } from "../XMLProcessingService/XMLFieldDetail";

export class RecipeService {

    private fakerService: IFakerService;
    constructor(private fakerServiceImplementation) {
        this.fakerService = fakerServiceImplementation;
    }

    private fakerFieldTypeMappings: Record<string, string> = null;
    getFakerFieldTypeMappings() {

        if ( !this.fakerFieldTypeMappings ) {
            this.fakerFieldTypeMappings = this.fakerService.getMapSalesforceFieldToFakerValue();
        }

        return this.fakerFieldTypeMappings;

    }

    private ootbSobjectToOttbFieldFakerValue:  Record<string, Record<string, string>> = null;
    getOOTBExpectedObjectToFakerValueMappings() {
        
        if ( !this.ootbSobjectToOttbFieldFakerValue ) {
            this.ootbSobjectToOttbFieldFakerValue = this.fakerService.getOOTBObjectApiNameToFieldApiNameMap();
        }

        return this.ootbSobjectToOttbFieldFakerValue;

    }

    generateTabs(tabCount: number):string {
        const spacesPerTab = 4;
        return ' '.repeat(spacesPerTab * tabCount);
    }

    getSalesforceFieldToSnowfakeryMap() {
        this.fakerService.getMapSalesforceFieldToFakerValue();
    }

    getRecipeFakeValueByXMLFieldDetail(xmlFieldDetail: XMLFieldDetail, recordTypeApiToRecordTypeWrapperMap: Record<string, RecordTypeWrapper>): string {
        
        let fakeRecipeValue;
        const fieldType = xmlFieldDetail.fieldType.toLowerCase();
        switch (fieldType) {
            
            case 'picklist':
                
                if (xmlFieldDetail.controllingField) {
                    // THIS SCENARIO INDICATES THAT THE PICKLIST FIELD IS DEPENDENT
                    fakeRecipeValue = this.getDependentPicklistRecipeFakerValue(xmlFieldDetail, recordTypeApiToRecordTypeWrapperMap);
                } else {

                    if ( !(xmlFieldDetail.picklistValues) ) {
                        // THIS SCENARIO INDICATEDS THAT THE PICKLIST FIELD UTILIZED A GLOBAL VALUE SET
                        return '';
                    }
                    const availablePicklistChoices = xmlFieldDetail.picklistValues.map(detail => detail.fullName);
                    fakeRecipeValue = this.fakerService.buildPicklistRecipeValueByXMLFieldDetail(availablePicklistChoices, 
                                                                                                recordTypeApiToRecordTypeWrapperMap,
                                                                                                xmlFieldDetail.apiName);  
                }

                return fakeRecipeValue;
                
            case 'multiselectpicklist':

                if ( !(xmlFieldDetail.picklistValues) ) {
                    return '';
                }
                const availablePicklistChoices = xmlFieldDetail.picklistValues.map(detail => detail.fullName);
                fakeRecipeValue = this.fakerService.buildMultiSelectPicklistRecipeValueByXMLFieldDetail(availablePicklistChoices, 
                                                                                                        recordTypeApiToRecordTypeWrapperMap,
                                                                                                        xmlFieldDetail.apiName
                                                                                                    );
        
                return fakeRecipeValue;
                
            // case 'masterdetail':
                
            //     return {
            //         type: 'lookup'
            //     };

            // case 'lookup':

            //     return 'test';
                
            default: 

                fakeRecipeValue = this.getFakeValueIfExpectedSalesforceFieldType(fieldType);
                return fakeRecipeValue;

        }

    }
    
    getFakeValueIfExpectedSalesforceFieldType(fieldType:string):string {
        let recipeValue = null;
        const fieldToRecipeValueMap:Record<string, string> = this.getFakerFieldTypeMappings();
        // CHECK IF VALID FIELD TYPE OR EXISTS IN PROGRAMS SALESFORCE FIELD MAP
        if ( fieldType in fieldToRecipeValueMap ) {
            recipeValue = fieldToRecipeValueMap[fieldType];
        } else {
            // NOT THROWING EXCEPTION HERE, WE WANT THE REMAINING FIELDS TO BE PROCESSED
            recipeValue = `"FieldType Not Handled -- ${fieldType} does not exist in this programs Salesforce field map."`;
        }    

        return recipeValue;
    
    }

    getDependentPicklistRecipeFakerValue(xmlFieldDetail: XMLFieldDetail, recordTypeApiToRecordTypeWrapperMap: Record<string, RecordTypeWrapper>): string {
    
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

        return this.fakerService.buildDependentPicklistRecipeFakerValue(
                                                                controllingValueToPicklistOptions, 
                                                                recordTypeApiToRecordTypeWrapperMap, 
                                                                controllingField,
                                                                xmlFieldDetail.apiName
                                                            );
        
    }

    initiateRecipeByObjectName(
                                objectName: string, 
                                recordTypeApiToRecordTypeWrapperMap: Record<string, RecordTypeWrapper>,
                                salesforceOOTBFakerMappings: Record<string, Record<string, string>> 
                            ): string {

        // ADD NEW LINE CHARACTER TO SEPARATE OBJECT RECIPES WHEN THEY ARE ADDED TOGETHER
        let objectRecipeMarkup = 
`\n- object: ${objectName}
  nickname: ${objectName}_NickName
  count: 1
  fields:`;

        if ( recordTypeApiToRecordTypeWrapperMap !== undefined && Object.keys(recordTypeApiToRecordTypeWrapperMap).length > 0 ) {

            let recordTypeDeveloperNamesToSelect:string = '';
            const recordTypeDeveloperNameTodoVerbiage = `### TODO: -- RecordType Options -- From below, choose the expected Record Type Developer Name and ensure the rest of fields on this object recipe is consistent with the record type selection`;
            const newLineBreak = "\n";
            Object.entries(recordTypeApiToRecordTypeWrapperMap).forEach(([recordTypeApiNameKey, recordTypeWrapper]) => {
                    
                if ( recordTypeDeveloperNamesToSelect.trim() === '' ) {
                    // check to see if recordTypeDeveloperNamesToSelect has been given an initial value to properly handle recipe spacing
                    recordTypeDeveloperNamesToSelect = `${recordTypeDeveloperNameTodoVerbiage}`;

                } 

                recordTypeDeveloperNamesToSelect += `${newLineBreak}${this.generateTabs(5)}${objectName}.${recordTypeApiNameKey}`;
    
            });

            objectRecipeMarkup = this.appendFieldRecipeToObjectRecipe(
                objectRecipeMarkup,
                recordTypeDeveloperNamesToSelect,
                "RecordTypeId"
            );
    
        }

        if ( salesforceOOTBFakerMappings[objectName] ) {

            Object.entries(salesforceOOTBFakerMappings[objectName]).forEach(([ootbFieldApiName, expectedOOTBFieldRecipe]) => {
                objectRecipeMarkup = this.appendFieldRecipeToObjectRecipe(
                    objectRecipeMarkup, 
                    expectedOOTBFieldRecipe, 
                    ootbFieldApiName
                );
            });

        }

        return objectRecipeMarkup;

    }

    appendFieldRecipeToObjectRecipe(objectRecipe:string, fieldRecipe: string, fieldApiName: string): string {

        const fieldPropertAndRecipeValue = `${fieldApiName}: ${fieldRecipe}`;
        const updatedObjectRecipe =
`${objectRecipe}
${this.generateTabs(1)}${fieldPropertAndRecipeValue}`;

        return updatedObjectRecipe;

    }

    getRecipeValueWithMissingXMLDetailByFieldApiName(): string {
        
        // IF AN OOTB FIELD HAS BEEN PULLED DOWN INTO SOURCE THAT ISNT ALREADY IN EXPECTED OOTB MAPPINGS IT COULD BE AN AUTO GENERATED FIELD OR WE NEED TO GET THE OOTB MAPPINGS UPDATED WITH THAT FIELD
        const ootbAutoGeneratedRecipeValue = '### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED - IN THE FIELD FILE THERE IS NO TYPE DEFINITION IN XML MARKUP - THIS FIELD\'S VALUE MAY BE AUTO GENERATED BY SALESFORCE'; 
        return ootbAutoGeneratedRecipeValue;

    }
    
}