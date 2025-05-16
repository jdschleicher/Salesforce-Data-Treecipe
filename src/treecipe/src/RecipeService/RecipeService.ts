import { ErrorHandlingService } from "../ErrorHandlingService/ErrorHandlingService";
import { IRecipeFakerService } from "../RecipeFakerService.ts/IRecipeFakerService";
import { RecordTypeWrapper } from "../RecordTypeService/RecordTypesWrapper";
import { XMLFieldDetail } from "../XMLProcessingService/XMLFieldDetail";

export class RecipeService {

    private fakerService: IRecipeFakerService;
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

        try {
            
            switch (fieldType) {
            
                case 'picklist':
                    
                    if (xmlFieldDetail.controllingField) {
                        // THIS SCENARIO INDICATES THAT THE PICKLIST FIELD IS DEPENDENT
                        fakeRecipeValue = this.getDependentPicklistRecipeFakerValue(xmlFieldDetail, recordTypeApiToRecordTypeWrapperMap);
                    } else {
    
                        if ( !(xmlFieldDetail.picklistValues) ) {
                            // THIS SCENARIO INDICATEDS THAT THE PICKLIST FIELD UTILIZED A GLOBAL VALUE SET
                            const emptyPicklistXMLDetailRecipePlaceholder = this.fakerService.getStandardAndGlobalValueSetTODOPlaceholderWithExample();
                            return emptyPicklistXMLDetailRecipePlaceholder;
                        }
                        const availablePicklistChoices = xmlFieldDetail.picklistValues.map(picklistOption => picklistOption.picklistOptionApiName);
                        fakeRecipeValue = this.fakerService.buildPicklistRecipeValueByXMLFieldDetail(availablePicklistChoices, 
                                                                                                    recordTypeApiToRecordTypeWrapperMap,
                                                                                                    xmlFieldDetail.apiName);  
                    }
    
                    return fakeRecipeValue;
                    
                case 'multiselectpicklist':
    
                    if ( !(xmlFieldDetail.picklistValues) ) {
                        // THIS SCENARIO INDICATEDS THAT THE PICKLIST FIELD UTILIZED A GLOBAL VALUE SET
                        const emptyMultiSelectXMLDetailPlaceholder = this.fakerService.getMultipicklistTODOPlaceholderWithExample();
                        return emptyMultiSelectXMLDetailPlaceholder;
                    }
                    const availablePicklistChoices = xmlFieldDetail.picklistValues.map(picklistOption => picklistOption.picklistOptionApiName);
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

        } catch (error) {
            
            const executedCommand = "XMLFileProcessor.getRecipeFakeValueByXMLFieldDetail";
            const customErrorMessage = `Error generating fake value: ${xmlFieldDetail.apiName} - ${error.message}`;
            
            const customGenerateFakerJSValueError = new Error();
            customGenerateFakerJSValueError.message = customErrorMessage;
    
            customGenerateFakerJSValueError.name = "GenerateFakerJSValueError";
            customGenerateFakerJSValueError.stack = error.stack;
    
            customGenerateFakerJSValueError.cause = xmlFieldDetail;
    
            ErrorHandlingService.createGetRecipeFakerErrorCaptureFile(customGenerateFakerJSValueError, executedCommand);
            
            throw customGenerateFakerJSValueError;

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
            
            if ( !(picklistOption.controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection) ) {
                return '';
            }
            picklistOption.controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection.forEach((controllingValue) => {

                if ( controllingValue in controllingValueToPicklistOptions ) {
                    controllingValueToPicklistOptions[controllingValue].push(picklistOption.picklistOptionApiName);
                } else {
                    controllingValueToPicklistOptions[controllingValue] = [ picklistOption.picklistOptionApiName ];
                }

            });

        });

        if ( Object.keys(controllingValueToPicklistOptions).length === 0 ) {

            // If there is a controlling field in the xml markup but there are no valueSettings in the XML markup, there may be an unexpected issue with how the dependent picklist was setup
            const noValueSettingsForControllingFieldRecipe = this.getNoValueSettingsToDoRecipeValue(xmlFieldDetail);
            return noValueSettingsForControllingFieldRecipe;

        } else {

            return this.fakerService.buildDependentPicklistRecipeFakerValue(
                controllingValueToPicklistOptions, 
                recordTypeApiToRecordTypeWrapperMap, 
                controllingField,
                xmlFieldDetail.apiName
            );

        }

        
    }

    getNoValueSettingsToDoRecipeValue(xmlFieldDetail:XMLFieldDetail): string {

        const noValueSettingsForControllingFieldRecipe =` ### TODO -- THERE ARE NO DEPENDENT PICKLIST "valueSettings" in xml markup of Picklist field "${xmlFieldDetail.apiName}" for controlling field "${xmlFieldDetail.controllingField}". The below "choice-if" structure cannot be populated.
        # if:
        #  - choice:
        #      when: \${{ ${xmlFieldDetail.controllingField} == 'GOT NOTHING FOR YOU' }}
        #      pick:
        #          random_choice:
        #              - check ${xmlFieldDetail.apiName}.field-meta.xml field file's xml for valeSetDefintions to add here 
        #              - check ${xmlFieldDetail.apiName}.field-meta.xml field file's xml for valeSetDefintions to add here `;

        return noValueSettingsForControllingFieldRecipe;

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