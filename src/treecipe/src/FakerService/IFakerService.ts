import { XMLFieldDetail } from "../XMLProcessingService/XMLFieldDetail";

export interface IFakerService {

    getMapSalesforceFieldToFakerValue(): Record<string, string>;
    buildMultiSelectPicklistRecipeValueByXMLFieldDetail(availablePicklistChoices: string[]): string;
    buildDependentPicklistRecipeFakerValue(controllingValueToPicklistOptions: Record<string, string[]>, 
        recordTypeNameToRecordTypeXMLMarkup: Record<string, any>,  
        controllingField: string,
        fieldApiName ): string;
    buildPicklistRecipeValueByXMLFieldDetail(availablePicklistChoices: string[]): string;
    generateTabs(tabCount: number): string;
    
}