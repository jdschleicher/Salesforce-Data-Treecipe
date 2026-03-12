import { RecordTypeWrapper } from "../RecordTypeService/RecordTypesWrapper";
import { ValidationRuleConstraint } from "../ValidationRuleAnalyzerService/ValidationRuleAnalyzerService";

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
        fieldApiName: string,
        constraints?: ValidationRuleConstraint[]): string;
    generateTabs(tabCount: number): string;
    getOOTBObjectApiNameToFieldApiNameMap(): Record<string, Record<string, string>>;
    buildRecordTypeBasedPicklistRecipeValue(
        recordTypeNameByRecordTypeWrapper: Record<string, RecordTypeWrapper>,
        associatedFieldApiName: string): string;
    buildRecordTypeBasedMultipicklistRecipeValue(
        recordTypeNameByRecordTypeWrapper: Record<string, RecordTypeWrapper>,
        associatedFieldApiName: string): string;
    updateDependentPicklistRecipeFakerValueByRecordTypeSections(
        recordTypeNameByRecordTypeWrapper: Record<string, RecordTypeWrapper>,
        dependentFieldApiName: string,
        controllingFieldApiName: string,
        controllingValue: string): string
    getMultipicklistTODOPlaceholderWithExample(): string
    getStandardAndGlobalValueSetTODOPlaceholderWithExample(): string
    buildTextRecipeValueWithLength(length: number, constraints?: ValidationRuleConstraint[]): string
    buildNumericRecipeValueWithPrecisionAndScale(precision: number, scale?: number, constraints?: ValidationRuleConstraint[]): string
    buildCurrencyRecipeValueWithPrecisionAndScale(precision: number, scale?: number, constraints?: ValidationRuleConstraint[]): string
    buildDateRecipeValue(fieldType: string, constraints?: ValidationRuleConstraint[]): string
}
