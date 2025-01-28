import { XMLFieldDetail } from "../XMLProcessingService/XMLFieldDetail";

export interface IFakerService {

    getMapSalesforceFieldToFakerValue(): Record<string, string>;
    buildMultiSelectPicklistRecipeValueByXMLFieldDetail(availablePicklistChoices: string[]): string;
    buildDependentPicklistRecipeFakerValue(controllingValueToPicklistOptions: Record<string, string[]>, 
                                                recordTypeToPicklistFieldsToAvailablePicklistValuesMap: Record<string, Record<string, string[]>>,  
                                                controllingField: string,
                                                fieldApiName): string;
    buildPicklistRecipeValueByXMLFieldDetail(availablePicklistChoices: string[], 
                                                recordTypeToPicklistFieldsToAvailablePicklistValuesMap: Record<string, Record<string, string[]>>,
                                                fieldApiName): string;
    generateTabs(tabCount: number): string;
    
}