import { RecordTypeWrapper } from "../RecordTypeService/RecordTypesWrapper";
import { ResolvedRecipeFieldConstraint } from "./RecipeFieldConstraint/RecipeFieldConstraint";
import { IValidationRuleRegexAtom } from "../ValidationRuleAnalyzerService/ValidationRuleAnalyzerService";

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
    /*
        The ONE-LINE expression that generates a value matching a validation rule's REGEX (#324), from
        the atoms ValidationRuleAnalyzerService parsed it into, or undefined for a backend with no
        regex generator -- which reports the rule as not applied rather than approximating it.
    */
    buildRegexExpression(regexAtoms: IValidationRuleRegexAtom[]): string | undefined
    /*
        The ONE-LINE expression a picklist generates with once the Recipe Cockpit narrows it to the
        values the reader ticked (#465): the same choice the backend generates, over those values
        only, each through the backend's escaper.
    */
    buildPicklistChoiceExpression(picklistValues: string[], isMultiSelect: boolean): string
}
