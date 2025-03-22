import { RecordTypeWrapper } from "../RecordTypeService/RecordTypesWrapper";

export interface IRecipeFakerService {

    getMapSalesforceFieldToFakerValue(): Record<string, string>;
    buildMultiSelectPicklistRecipeValueByXMLFieldDetail(availablePicklistChoices: string[],
        recordTypeApiToRecordTypeWrapperMap: Record<string, RecordTypeWrapper>,
        fieldApiName): string;
    buildDependentPicklistRecipeFakerValue(controllingValueToPicklistOptions: Record<string, string[]>, 
        recordTypeApiToRecordTypeWrapperMap: Record<string, RecordTypeWrapper>,
        controllingField: string,
        fieldApiName): string;
    buildPicklistRecipeValueByXMLFieldDetail(availablePicklistChoices: string[], 
        recordTypeApiToRecordTypeWrapperMap: Record<string, RecordTypeWrapper>,
        fieldApiName): string;
    generateTabs(tabCount: number): string;
    getOOTBObjectApiNameToFieldApiNameMap(): Record<string, Record<string, string>>;
    
}