import { RecordTypeWrapper } from "../RecordTypeService/RecordTypesWrapper";
import { ResolvedRecipeFieldConstraint } from "./RecipeFieldConstraint/RecipeFieldConstraint";

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
    getMinimumRequiredFieldsTemplate(): Record<string, Record<string, string>>;
    getAddressComponentToRecipeValueMap(): Record<string, string>;
    getGeolocationComponentToRecipeValueMap(): Record<string, string>;

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
    buildTextRecipeValueWithLength(length: number): string
    buildNumericRecipeValueWithPrecisionAndScale(precision: number, scale?: number): string
    buildCurrencyRecipeValueWithPrecisionAndScale(precision: number, scale?: number): string
    /*
        The ONE-LINE expression a field generates with once the Recipe Cockpit constrains it (#323).
        fieldType is the Salesforce <type>; the constraint is already resolved and in bounds
        (RecipeFieldConstraint.resolve), so a backend formats it and decides nothing. Throws for a
        constraint whose kind is not the field type's.
    */
    buildConstrainedExpression(fieldType: string, constraint: ResolvedRecipeFieldConstraint): string
}
