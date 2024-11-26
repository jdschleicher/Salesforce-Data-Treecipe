
export interface IFakerService {

    getMapSalesforceFieldToFakerValue(): Record<string, string>;
    getFakeMultiSelectPicklistRecipeValueByXMLFieldDetail(picklistChoices:string[]) : string;
    // getFakePicklistRecipeValueByXMLFieldDetail()
}