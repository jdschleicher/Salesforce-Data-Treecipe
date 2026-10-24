import { ErrorHandlingService } from "../ErrorHandlingService/ErrorHandlingService";
import { GlobalValueSetSingleton } from "../GlobalValueSetSingleton/GlobalValueSetSingleton";
import { IRecipeFakerService } from "../RecipeFakerService.ts/IRecipeFakerService";
import { RecipeYamlScalar } from "../RecipeFakerService.ts/RecipeYamlScalar/RecipeYamlScalar";
import { RecordTypeWrapper } from "../RecordTypeService/RecordTypesWrapper";
import { IRecordTypeBlock, RecordTypeSelection } from "../RecordTypeService/RecordTypeSelection";
import { ValueSetService } from "../ValueSetService/ValueSetService";
import { XMLFieldDetail } from "../XMLProcessingService/XMLFieldDetail";
import { ICompoundComponentRecipe } from "./ICompoundComponentRecipe";
import { SalesforceApiName } from "./SalesforceApiName";
import { IRecipeFieldConstraintTarget, IStoredRecipeFieldConstraint, RecipeFieldConstraint, ResolvedRecipeFieldConstraint } from "../RecipeFakerService.ts/RecipeFieldConstraint/RecipeFieldConstraint";
import { IValidationRuleConstraintRecord, IValidationRuleFieldConstraint, IValidationRuleRegexAtom } from "../ValidationRuleAnalyzerService/ValidationRuleAnalyzerService";
import { RecipeCockpitRecipeWriter } from "../RecipeCockpitService/RecipeCockpitRecipeWriter";

export interface IValidationRuleFieldRecipe {
    recipeValue: string;
    validationRuleConstraints: IValidationRuleConstraintRecord[];
}

// A REGEX RULE REPLACES THE FIELD'S GENERATOR, SO IT APPLIES ONLY WHERE ANY STRING MATCHING IT IS A VALUE THE FIELD TAKES
export const VALIDATION_RULE_REGEX_FIELD_TYPES = ['Text', 'TextArea', 'LongTextArea', 'Phone'];
// A Phone FIELD HAS NO <length>; SALESFORCE HOLDS EVERY ONE TO 40 CHARACTERS
export const VALIDATION_RULE_PHONE_FIELD_LENGTH = 40;

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

    /*
        The Collections API cannot accept a compound Address field, so a recipe has to carry one line
        per component instead. State and Country are deliberately the PLAIN forms rather than
        StateCode/CountryCode: the coded components only exist when State and Country Picklists are
        enabled in the target org, while these exist either way, and source metadata does not say
        which org the recipe is destined for.
    */
    static readonly compoundAddressComponentKeys: string[] = ['Street', 'City', 'State', 'PostalCode', 'Country'];

    /*
        The Collections API cannot accept a compound Geolocation field either, so it expands the same
        way an Address does -- into the two component fields an insert actually writes. Salesforce
        derives their api names by the identical rule, which is why buildCompoundComponentApiName is
        shared rather than duplicated per compound type.

        <displayLocationInDecimal> is deliberately not read: it controls whether the ORG DISPLAYS
        degrees/minutes/seconds, while the API accepts decimal degrees either way, so the generated
        recipe is the same for both settings.
    */
    static readonly compoundGeolocationComponentKeys: string[] = ['Latitude', 'Longitude'];

    /*
        Salesforce names compound components two different ways and the compound field's own api name
        is the only signal for which: a custom field's components carry the "__s" system suffix off
        the base name, a standard field's are the compound name with "Address" swapped for the
        component. Lead's compound field is literally named "Address", so an empty prefix -- and the
        bare "Street"/"City" components it produces -- is a correct result here, not a fallback.

        The "Address" swap holds for Geolocation too rather than being incidental to it -- the
        components of a standard compound address ARE its geolocation, so BillingAddress would yield
        BillingLatitude and BillingLongitude, which are the real api names. Nothing reaches that
        branch by the geolocation route today: only a <type>Location</type> field is expanded this
        way, and in source metadata that is always a custom field. It is asserted because it is the
        rule, not because a caller exercises it.
    */
    static buildCompoundComponentApiName(compoundFieldApiName: string, componentKey: string): string {

        const customFieldSuffix = '__c';
        if ( compoundFieldApiName.endsWith(customFieldSuffix) ) {

            const customFieldBaseName = compoundFieldApiName.slice(0, -customFieldSuffix.length);
            return `${customFieldBaseName}__${componentKey}__s`;

        }

        const standardCompoundFieldSuffix = 'Address';
        const standardComponentPrefix = compoundFieldApiName.endsWith(standardCompoundFieldSuffix)
            ? compoundFieldApiName.slice(0, -standardCompoundFieldSuffix.length)
            : compoundFieldApiName;

        return `${standardComponentPrefix}${componentKey}`;

    }

    buildCompoundAddressComponentRecipes(compoundFieldApiName: string): ICompoundComponentRecipe[] {

        const addressComponentToRecipeValue = this.fakerService.getAddressComponentToRecipeValueMap();
        return RecipeService.buildComponentRecipesByKeys(compoundFieldApiName,
                                                            RecipeService.compoundAddressComponentKeys,
                                                            addressComponentToRecipeValue
                                                          );

    }

    buildCompoundGeolocationComponentRecipes(compoundFieldApiName: string): ICompoundComponentRecipe[] {

        const geolocationComponentToRecipeValue = this.fakerService.getGeolocationComponentToRecipeValueMap();
        return RecipeService.buildComponentRecipesByKeys(compoundFieldApiName,
                                                            RecipeService.compoundGeolocationComponentKeys,
                                                            geolocationComponentToRecipeValue
                                                          );

    }

    private static buildComponentRecipesByKeys(compoundFieldApiName: string,
                                                    componentKeys: string[],
                                                    componentKeyToRecipeValue: Record<string, string>
                                                ): ICompoundComponentRecipe[] {

        return componentKeys.map((componentKey) => {

            return {
                componentKey: componentKey,
                componentApiName: RecipeService.buildCompoundComponentApiName(compoundFieldApiName, componentKey),
                recipeValue: componentKeyToRecipeValue[componentKey]
            };

        });

    }

    generateTabs(tabCount: number):string {
        const spacesPerTab = 4;
        return ' '.repeat(spacesPerTab * tabCount);
    }

    getSalesforceFieldToSnowfakeryMap() {
        this.fakerService.getMapSalesforceFieldToFakerValue();
    }

    /*
        With a record type SELECTED for the object (#193), every picklist sink is narrowed here to that
        record type's values and the backend is handed NO record type map, so it writes one live
        expression and no commented variants -- in both backends alike, and still through each
        backend's own escaper, because the values reach the same builders they always did.
    */
    getRecipeFakeValueByXMLFieldDetail(xmlFieldDetail: XMLFieldDetail,
                                        recordTypeApiToRecordTypeWrapperMap: Record<string, RecordTypeWrapper>,
                                        selectedRecordTypeApiName?: string,
                                        excludedPicklistValues?: ReadonlySet<string>): string {
        
        let fakeRecipeValue;
        const fieldType = xmlFieldDetail.fieldType.toLowerCase();

        const selectedRecordTypeWrapper = RecipeService.getSelectedRecordTypeWrapper(recordTypeApiToRecordTypeWrapperMap, selectedRecordTypeApiName);
        if ( selectedRecordTypeWrapper ) {
            recordTypeApiToRecordTypeWrapperMap = {};
        }
        if ( excludedPicklistValues?.size > 0 ) {
            recordTypeApiToRecordTypeWrapperMap = RecipeService.excludeRecordTypePicklistValues(recordTypeApiToRecordTypeWrapperMap, xmlFieldDetail.apiName, excludedPicklistValues);
        }
        const selectedRecordTypePicklistValues = selectedRecordTypeWrapper
            ? RecordTypeSelection.getRecordTypePicklistValues(selectedRecordTypeWrapper, xmlFieldDetail.apiName)
            : undefined;

        try {
            
            switch (fieldType) {
            
                case 'picklist':
                    
                    if (xmlFieldDetail.controllingField) {
                        // THIS SCENARIO INDICATES THAT THE PICKLIST FIELD IS DEPENDENT
                        fakeRecipeValue = this.getDependentPicklistRecipeFakerValue(xmlFieldDetail, recordTypeApiToRecordTypeWrapperMap, selectedRecordTypeWrapper, excludedPicklistValues);
                    } else {
                        
                        const availablePicklistValueOptions = RecipeService.excludePicklistValues(
                            this.getAvailablePicklistValueOptions(xmlFieldDetail, selectedRecordTypePicklistValues),
                            excludedPicklistValues
                        );

                        fakeRecipeValue = this.fakerService.buildPicklistRecipeValueByXMLFieldDetail(availablePicklistValueOptions, recordTypeApiToRecordTypeWrapperMap, xmlFieldDetail.apiName );  
                    
                    }
    
                    return fakeRecipeValue;
                    
                case 'multiselectpicklist':

                    if ( selectedRecordTypePicklistValues?.length > 0 ) {
                        return this.fakerService.buildMultiSelectPicklistRecipeValueByXMLFieldDetail(selectedRecordTypePicklistValues,
                                                                                                    recordTypeApiToRecordTypeWrapperMap,
                                                                                                    xmlFieldDetail.apiName
                                                                                                );
                    }

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

                case 'hierarchy':

                    // A HIERARCHY FIELD WHOSE PARENT IS KNOWN (Account.ParentId, #400) IS WRITTEN AS EITHER BACKEND WRITES A LOOKUP; ONE WITH NONE STAYS "NOT HANDLED"
                    return this.getFakeValueIfExpectedSalesforceFieldType(xmlFieldDetail.referenceTo ? 'lookup' : fieldType);

                case 'text':
                case 'textarea':
                case 'longtextarea':
                case 'html':

                    if (xmlFieldDetail.length) {
                        fakeRecipeValue = this.fakerService.buildTextRecipeValueWithLength(xmlFieldDetail.length);
                        return fakeRecipeValue;
                    }
                    // Fall through to default if no length

                case 'number':
                case 'percent':

                    if (xmlFieldDetail.precision) {
                        fakeRecipeValue = this.fakerService.buildNumericRecipeValueWithPrecisionAndScale(xmlFieldDetail.precision, xmlFieldDetail.scale);
                        return fakeRecipeValue;
                    }
                    // Fall through to default if no precision

                case 'currency':

                    if (xmlFieldDetail.precision) {
                        fakeRecipeValue = this.fakerService.buildCurrencyRecipeValueWithPrecisionAndScale(xmlFieldDetail.precision, xmlFieldDetail.scale);
                        return fakeRecipeValue;
                    }
                    // Fall through to default if no precision

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
    
    /*
        The ONE faker expression a field only the org holds (#446) generates its Treecipe Adapter
        values from: what Generate Treecipe writes for its XML through this backend, with no record
        type (the Adapter fills the field's own values), read as its first "${{ … }}" line and held to
        checkConstrainedExpression. Undefined when the backend writes none -- an unknown type, a TODO,
        a picklist whose file lists no values, or anything that is not one expression line -- so the
        field is offered as a fixed value only.
    */
    getOrgOnlyFieldExpression(xmlFieldDetail: XMLFieldDetail): string | undefined {

        const fieldType = String(xmlFieldDetail.fieldType ?? '').toLowerCase();

        if ( ( fieldType === 'picklist' || fieldType === 'multiselectpicklist' ) && !( xmlFieldDetail.picklistValues?.length > 0 ) ) {
            return undefined;
        }

        let recipeValue: unknown;
        try {
            recipeValue = this.getRecipeFakeValueByXMLFieldDetail(xmlFieldDetail, {});
        } catch {
            return undefined;
        }

        for ( const valueLine of String(recipeValue ?? '').split('\n') ) {
            const trimmedLine = valueLine.trim();
            let candidate: unknown = trimmedLine;
            if ( trimmedLine.length >= 2 && trimmedLine.startsWith('"') && trimmedLine.endsWith('"') ) {
                try {
                    candidate = JSON.parse(trimmedLine);
                } catch {
                    return undefined;
                }
            }
            if ( typeof candidate === 'string' && candidate.startsWith('${{') ) {
                return RecipeCockpitRecipeWriter.checkConstrainedExpression(candidate) === undefined ? candidate : undefined;
            }
        }

        return undefined;

    }

    /*
        A plain picklist's values: its own <picklistValues>, else a standard value set by the field's
        name, else its global value set -- and a selected record type's own values over any of them.
    */
    getAvailablePicklistValueOptions(xmlFieldDetail: XMLFieldDetail, selectedRecordTypePicklistValues?: string[]): string[] {

        if ( selectedRecordTypePicklistValues?.length > 0 ) {
            return selectedRecordTypePicklistValues;
        }

        if ( xmlFieldDetail.picklistValues ) {
            return xmlFieldDetail.picklistValues.map(picklistOption => picklistOption.picklistOptionApiName);
        }

        // IF THE FIELD TYPE IS 'picklist' BUT!!! THERE IS NO <picklistValues> XML MARKUP, THEN WE TRY
        // TO GET PICKLIST VALUES WITH THE POSSIBILITY THEY ARE A DEFAULT STANDARD VALUE SET OR A GLOBAL VALUE SET
        const existingOOTBStandardValueSetPicklistValuesByApiName = ValueSetService.getOOTBValueOptionsByStandardValueSetName(xmlFieldDetail.apiName);
        if ( existingOOTBStandardValueSetPicklistValuesByApiName ) {
            return existingOOTBStandardValueSetPicklistValuesByApiName;
        }

        const gvsPicklistByPicklistValues: Record<string, string[]> = GlobalValueSetSingleton.getInstance().getPicklistValueMaps();
        return gvsPicklistByPicklistValues?.[xmlFieldDetail.globalValueSetName] ?? [];

    }

    static excludePicklistValues(picklistValues: string[], excludedPicklistValues?: ReadonlySet<string>): string[] {

        return excludedPicklistValues?.size > 0
            ? picklistValues.filter(picklistValue => !excludedPicklistValues.has(picklistValue))
            : picklistValues;

    }

    // A COPY: THE WRAPPERS ARE THE OBJECT'S, SHARED BY EVERY FIELD AND RECORDED IN THE OBJECTS WRAPPER
    static excludeRecordTypePicklistValues(recordTypeApiToRecordTypeWrapperMap: Record<string, RecordTypeWrapper>,
                                            fieldApiName: string,
                                            excludedPicklistValues: ReadonlySet<string>): Record<string, RecordTypeWrapper> {

        const filteredRecordTypeMap: Record<string, RecordTypeWrapper> = {};
        Object.entries(recordTypeApiToRecordTypeWrapperMap ?? {}).forEach(([recordTypeApiName, recordTypeWrapper]) => {

            const fieldSection = recordTypeWrapper.PicklistFieldSectionsToPicklistDetail?.[fieldApiName];
            if ( !Array.isArray(fieldSection) ) {
                filteredRecordTypeMap[recordTypeApiName] = recordTypeWrapper;
                return;
            }
            // A SECTION THE EXCLUSION EMPTIES IS DROPPED, SO NO BACKEND WRITES A VARIANT CHOOSING FROM NOTHING
            const remainingValues = RecipeService.excludePicklistValues(fieldSection, excludedPicklistValues);
            const otherSections = Object.fromEntries(Object.entries(recordTypeWrapper.PicklistFieldSectionsToPicklistDetail)
                .filter(([sectionFieldApiName]) => sectionFieldApiName !== fieldApiName));
            filteredRecordTypeMap[recordTypeApiName] = {
                ...recordTypeWrapper,
                PicklistFieldSectionsToPicklistDetail: remainingValues.length > 0
                    ? { ...otherSections, [fieldApiName]: remainingValues }
                    : otherSections
            };

        });
        return filteredRecordTypeMap;

    }

    getFakeValueIfExpectedSalesforceFieldType(fieldType:string):string {
        let recipeValue = null;
        const fieldToRecipeValueMap:Record<string, string> = this.getFakerFieldTypeMappings();
        // CHECK IF VALID FIELD TYPE OR EXISTS IN PROGRAMS SALESFORCE FIELD MAP
        if ( fieldType in fieldToRecipeValueMap ) {
            recipeValue = fieldToRecipeValueMap[fieldType];
        } else {
            // NOT THROWING EXCEPTION HERE, WE WANT THE REMAINING FIELDS TO BE PROCESSED
            recipeValue = `"### TODO -- FieldType Not Handled -- ${fieldType} does not exist in this programs Salesforce field map."`;
        }    

        return recipeValue;
    
    }

    /*
        Builds the controlling-value-to-dependent-options map from a dependent picklist's
        <valueSettings> markup. Shared by recipe generation and by Apex picklist dependency
        spec generation, so it is intentionally free of any faker or record type concern.
    */
    static buildControllingValueToPicklistOptions(xmlFieldDetail: XMLFieldDetail): Record<string, string[]> {

        // NULL PROTOTYPED: THE KEYS ARE PICKLIST VALUES, AND "constructor" OR "__proto__" AS A KEY OTHERWISE READS OR REPLACES AN INHERITED MEMBER
        let controllingValueToPicklistOptions:Record<string, string[]> = Object.create(null);

        if ( !(xmlFieldDetail.picklistValues) ) {
            return controllingValueToPicklistOptions;
        }

        xmlFieldDetail.picklistValues.forEach(picklistOption => {

            if ( !(picklistOption.controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection) ) {
                return;
            }
            picklistOption.controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection.forEach((controllingValue) => {

                if ( Object.prototype.hasOwnProperty.call(controllingValueToPicklistOptions, controllingValue) ) {
                    controllingValueToPicklistOptions[controllingValue].push(picklistOption.picklistOptionApiName);
                } else {
                    controllingValueToPicklistOptions[controllingValue] = [ picklistOption.picklistOptionApiName ];
                }

            });

        });

        return controllingValueToPicklistOptions;

    }

    static getSelectedRecordTypeWrapper(recordTypeApiToRecordTypeWrapperMap: Record<string, RecordTypeWrapper>, selectedRecordTypeApiName?: string): RecordTypeWrapper | undefined {

        if ( selectedRecordTypeApiName === undefined
                || !recordTypeApiToRecordTypeWrapperMap
                || !Object.prototype.hasOwnProperty.call(recordTypeApiToRecordTypeWrapperMap, selectedRecordTypeApiName) ) {
            return undefined;
        }
        return recordTypeApiToRecordTypeWrapperMap[selectedRecordTypeApiName];

    }

    // AN EXCLUDED VALUE LEAVES EVERY CHOICE IT WAS IN, AND A CHOICE LEFT WITH NO VALUE IS DROPPED
    static excludeDependentPicklistValues(controllingValueToPicklistOptions: Record<string, string[]>, excludedPicklistValues?: ReadonlySet<string>): Record<string, string[]> {

        if ( !( excludedPicklistValues?.size > 0 ) ) {
            return controllingValueToPicklistOptions;
        }

        const filteredControllingValueToPicklistOptions: Record<string, string[]> = Object.create(null);
        Object.keys(controllingValueToPicklistOptions).forEach(controllingValue => {
            const remainingOptions = RecipeService.excludePicklistValues(controllingValueToPicklistOptions[controllingValue], excludedPicklistValues);
            if ( remainingOptions.length > 0 ) {
                filteredControllingValueToPicklistOptions[controllingValue] = remainingOptions;
            }
        });
        return filteredControllingValueToPicklistOptions;

    }

    getDependentPicklistRecipeFakerValue(xmlFieldDetail: XMLFieldDetail,
                                            recordTypeApiToRecordTypeWrapperMap: Record<string, RecordTypeWrapper>,
                                            selectedRecordTypeWrapper?: RecordTypeWrapper,
                                            excludedPicklistValues?: ReadonlySet<string>): string {

        const controllingField = xmlFieldDetail.controllingField;

        if ( !RecipeService.isRecipeWritableFieldApiName(controllingField) ) {
            return ` ${this.buildInvalidApiNameTodo('DEPENDENT PICKLIST SKIPPED -- controlling field', controllingField, `fix the <controllingField> of "${RecipeYamlScalar.escapeForComment(String(xmlFieldDetail.apiName ?? ''))}" and regenerate`)}`;
        }

        if ( !(xmlFieldDetail.picklistValues) ) {
            return '';
        }

        let controllingValueToPicklistOptions = RecipeService.buildControllingValueToPicklistOptions(xmlFieldDetail);
        const hasValueSettings = Object.keys(controllingValueToPicklistOptions).length > 0;
        controllingValueToPicklistOptions = RecipeService.excludeDependentPicklistValues(controllingValueToPicklistOptions, excludedPicklistValues);

        if ( !hasValueSettings ) {

            // If there is a controlling field in the xml markup but there are no valueSettings in the XML markup, there may be an unexpected issue with how the dependent picklist was setup
            const noValueSettingsForControllingFieldRecipe = this.getNoValueSettingsToDoRecipeValue(xmlFieldDetail);
            return noValueSettingsForControllingFieldRecipe;

        }

        if ( selectedRecordTypeWrapper ) {

            controllingValueToPicklistOptions = RecordTypeSelection.narrowControllingValueToPicklistOptions(controllingValueToPicklistOptions,
                                                                                                            selectedRecordTypeWrapper,
                                                                                                            controllingField,
                                                                                                            xmlFieldDetail.apiName
                                                                                                        );
            if ( Object.keys(controllingValueToPicklistOptions).length === 0 ) {
                return ` ${this.buildNoDependentValuesForRecordTypeTodo(xmlFieldDetail, selectedRecordTypeWrapper)}`;
            }

        }

        return this.fakerService.buildDependentPicklistRecipeFakerValue(
            controllingValueToPicklistOptions, 
            recordTypeApiToRecordTypeWrapperMap, 
            controllingField,
            xmlFieldDetail.apiName
        );

    }

    /*
        A comment is the field's whole value, so it loads as null -- as a refused controlling field
        does -- rather than as an if: with no choice to make. The developer name is a writable api
        name by now; the field name is escaped like every name in a comment.
    */
    buildNoDependentValuesForRecordTypeTodo(xmlFieldDetail: XMLFieldDetail, selectedRecordTypeWrapper: RecordTypeWrapper): string {

        const escapedFieldApiName = RecipeYamlScalar.escapeForComment(String(xmlFieldDetail.apiName));
        const escapedControllingField = RecipeYamlScalar.escapeForComment(String(xmlFieldDetail.controllingField));
        const escapedDeveloperName = RecipeYamlScalar.escapeForComment(String(selectedRecordTypeWrapper.DeveloperName));
        return `### TODO -- DEPENDENT PICKLIST -- record type "${escapedDeveloperName}" makes no value of "${escapedFieldApiName}" available under any value of "${escapedControllingField}" it allows; set a value by hand or leave the field out`;

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
                                salesforceOOTBFakerMappings: Record<string, Record<string, string>>,
                                recordTypeBlock?: IRecordTypeBlock
                            ): string {

        // ADD NEW LINE CHARACTER TO SEPARATE OBJECT RECIPES WHEN THEY ARE ADDED TOGETHER
        let objectRecipeMarkup = 
`\n- object: ${objectName}
  nickname: ${recordTypeBlock?.nickname ?? RecordTypeSelection.buildDefaultNickname(objectName)}
  count: 1
  fields:`;

        const { writableRecordTypeApiToRecordTypeWrapperMap, skippedRecordTypeDeveloperNames } = RecipeService.partitionRecordTypesByWritableDeveloperName(recordTypeApiToRecordTypeWrapperMap);
        recordTypeApiToRecordTypeWrapperMap = writableRecordTypeApiToRecordTypeWrapperMap;

        const recordTypeApiNames = Object.keys(recordTypeApiToRecordTypeWrapperMap);
        if ( recordTypeApiNames.length > 0 ) {

            /*
                The value is ONE developer name: CollectionsApiService swaps each "Object.DeveloperName" for
                its org Id, so a value naming every record type became several Ids in one RecordTypeId (#157).
                The others are commented lines, as with record-type picklist variants (#153) -- a bare line
                indented under the value is folded into it by YAML.
            */
            // A SELECTED RECORD TYPE IS THE ONE THE USER WANTS (#193), SO ITS ALTERNATIVES ARE NOT OFFERED
            const userSelectedRecordTypeApiName = RecipeService.getSelectedRecordTypeWrapper(recordTypeApiToRecordTypeWrapperMap, recordTypeBlock?.recordTypeApiName)
                ? recordTypeBlock.recordTypeApiName
                : undefined;
            const selectedRecordTypeApiName = userSelectedRecordTypeApiName ?? RecipeService.selectDefaultRecordTypeApiName(recordTypeApiToRecordTypeWrapperMap);
            const otherRecordTypeApiNames = userSelectedRecordTypeApiName !== undefined
                ? []
                : recordTypeApiNames.filter(recordTypeApiName => recordTypeApiName !== selectedRecordTypeApiName);
            let recordTypeIdRecipeValue = `${objectName}.${selectedRecordTypeApiName}`;

            if ( otherRecordTypeApiNames.length > 0 ) {

                recordTypeIdRecipeValue += `\n${this.generateTabs(5)}### TODO: -- RecordType Options -- From below, choose the expected Record Type Developer Name and ensure the rest of fields on this object recipe is consistent with the record type selection`;
                otherRecordTypeApiNames.forEach((recordTypeApiName) => {
                    recordTypeIdRecipeValue += `\n${this.generateTabs(5)}# ${objectName}.${recordTypeApiName}`;
                });

            }

            objectRecipeMarkup = this.appendFieldRecipeToObjectRecipe(
                objectRecipeMarkup,
                recordTypeIdRecipeValue,
                "RecordTypeId"
            );

        }

        skippedRecordTypeDeveloperNames.forEach((skippedRecordTypeDeveloperName) => {
            objectRecipeMarkup += `\n${this.generateTabs(1)}${this.buildInvalidApiNameTodo('RECORD TYPE SKIPPED -- developer name', skippedRecordTypeDeveloperName, "fix the record type's <fullName> and regenerate")}`;
        });

        recordTypeBlock?.ignoredDeveloperNames.forEach((ignoredDeveloperName) => {
            objectRecipeMarkup += `\n${this.generateTabs(1)}${RecipeService.buildIgnoredRecordTypeSelectionTodo(objectName, ignoredDeveloperName)}`;
        });

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

    /*
        The map arrives in RecordTypeService's fixed developer-name order (#166). Inserting with an
        inactive record type fails, so the default is the first ACTIVE one; with none active, the
        first is still written rather than no RecordTypeId at all.
    */
    static selectDefaultRecordTypeApiName(recordTypeApiToRecordTypeWrapperMap: Record<string, RecordTypeWrapper>): string | undefined {

        const recordTypeApiNames = Object.keys(recordTypeApiToRecordTypeWrapperMap);
        const firstActiveRecordTypeApiName = recordTypeApiNames.find(recordTypeApiName => recordTypeApiToRecordTypeWrapperMap[recordTypeApiName].Active !== false);
        return firstActiveRecordTypeApiName ?? recordTypeApiNames[0];

    }

    /*
        A selected name comes from the user or a hand-edited file, so it is escaped like any other
        untrusted text written into a comment. The object name is an api name by now (#164).
    */
    static buildIgnoredRecordTypeSelectionTodo(objectName: string, ignoredDeveloperName: string): string {

        const escapedDeveloperName = RecipeYamlScalar.escapeForComment(String(ignoredDeveloperName ?? ''));
        return `### TODO -- RECORD TYPE SELECTION IGNORED -- "${escapedDeveloperName}" -- it is not a record type of ${objectName} with a valid developer name`;

    }

    static readonly salesforceFieldApiNamePattern = SalesforceApiName.pattern;

    static isRecipeWritableFieldApiName(fieldApiName: string): boolean {

        return SalesforceApiName.isApiName(fieldApiName);

    }

    /*
        The api name is the one part of a recipe line written as a YAML KEY, and it comes from a
        <fullName> the workspace controls: a line break in it starts a line of the attacker's choosing,
        whose value faker-js evaluates with new Function() (#120). Salesforce api names are
        [A-Za-z0-9_], so anything else is not a field an org can have -- the field is skipped with a
        TODO naming it, and its recipe value is dropped with it, since that value may embed the same
        name. The name in the comment is escaped so neither YAML parser sees a break in it.
    */
    buildSkippedFieldApiNameTodo(fieldApiName: string): string {

        return this.buildInvalidApiNameTodo('FIELD SKIPPED -- api name', fieldApiName, "fix the field's <fullName> and regenerate");

    }

    buildInvalidApiNameTodo(skippedSubject: string, invalidApiName: string, remedy: string): string {

        const escapedApiName = RecipeYamlScalar.escapeForComment(String(invalidApiName ?? ''));
        return `### TODO -- ${skippedSubject} "${escapedApiName}" is not a valid Salesforce api name ([A-Za-z][A-Za-z0-9_]*); ${remedy}`;

    }

    /*
        A record type's developer name is written into recipe VALUES -- the RecordTypeId options and
        every record-type TODO and commented variant in both backends -- not only into comments, so
        the api-name rule applies to it as it does to a field key. Partitioning the map once, where it
        is loaded, keeps an invalid name away from all of those sinks rather than guarding each.
    */
    static partitionRecordTypesByWritableDeveloperName(recordTypeApiToRecordTypeWrapperMap: Record<string, RecordTypeWrapper>): {
        writableRecordTypeApiToRecordTypeWrapperMap: Record<string, RecordTypeWrapper>,
        skippedRecordTypeDeveloperNames: string[]
    } {

        const writableRecordTypeApiToRecordTypeWrapperMap: Record<string, RecordTypeWrapper> = {};
        const skippedRecordTypeDeveloperNames: string[] = [];

        Object.entries(recordTypeApiToRecordTypeWrapperMap ?? {}).forEach(([recordTypeDeveloperName, recordTypeWrapper]) => {

            if ( RecipeService.isRecipeWritableFieldApiName(recordTypeDeveloperName) ) {
                writableRecordTypeApiToRecordTypeWrapperMap[recordTypeDeveloperName] = recordTypeWrapper;
            } else {
                skippedRecordTypeDeveloperNames.push(recordTypeDeveloperName);
            }

        });

        return { writableRecordTypeApiToRecordTypeWrapperMap, skippedRecordTypeDeveloperNames };

    }

    appendFieldRecipeToObjectRecipe(objectRecipe:string, fieldRecipe: string, fieldApiName: string): string {

        const fieldPropertAndRecipeValue = RecipeService.isRecipeWritableFieldApiName(fieldApiName)
            ? `${fieldApiName}: ${fieldRecipe}`
            : this.buildSkippedFieldApiNameTodo(fieldApiName);
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


    /*
        What a field's validation rules come to (#324). Rules are grouped by what they constrain and
        each group is applied whole or not at all: bounds of one kind are intersected (tightest min,
        tightest max) and handed to RecipeFieldConstraint (#323's rule), so an empty intersection
        applies none of them; several ISPICKVAL exclusions drop their values together; a regex
        replaces the generator. The expression is the backend's own buildConstrainedExpression or
        buildRegexExpression, checked by RecipeCockpitRecipeWriter.checkConstrainedExpression and
        written double-quoted, with one "### Driven by ValidationRule" line naming the rules that
        changed it. Every rule is recorded, with why it was not applied when it was not.
    */
    applyValidationRules(xmlFieldDetail: XMLFieldDetail,
                            unconstrainedRecipeValue: string,
                            fieldRuleConstraints: IValidationRuleFieldConstraint[],
                            recordTypeApiToRecordTypeWrapperMap: Record<string, RecordTypeWrapper>,
                            selectedRecordTypeApiName?: string,
                            now: Date = new Date()): IValidationRuleFieldRecipe {

        const fieldType = String(xmlFieldDetail.fieldType ?? '');
        const recordsByRule = new Map<IValidationRuleFieldConstraint, IValidationRuleConstraintRecord>();
        const record = (ruleConstraint: IValidationRuleFieldConstraint, reason?: string) => {
            recordsByRule.set(ruleConstraint, {
                ruleName: ruleConstraint.ruleName,
                type: ruleConstraint.type,
                ...( ruleConstraint.value !== undefined ? { value: ruleConstraint.value } : {} ),
                ...( ruleConstraint.isExclusive ? { isExclusive: true } : {} ),
                applied: reason === undefined,
                ...( reason !== undefined ? { reason: reason } : {} )
            });
        };

        const pendingRules = fieldRuleConstraints.filter(ruleConstraint => {
            if ( ruleConstraint.refusal !== undefined ) {
                record(ruleConstraint, ruleConstraint.refusal);
                return false;
            }
            return true;
        });

        const isTodoRecipeValue = typeof unconstrainedRecipeValue !== 'string'
            || /^"?\s*###/.test(unconstrainedRecipeValue.trim())
            || unconstrainedRecipeValue.trim() === '';
        const rulesOfType = (...types: string[]) => pendingRules.filter(ruleConstraint => types.includes(ruleConstraint.type));

        rulesOfType('required').forEach(ruleConstraint => record(ruleConstraint, isTodoRecipeValue
            ? "the field's recipe is a TODO, so it generates no value; set one by hand"
            : undefined));

        let recipeValue = unconstrainedRecipeValue;
        const drivingRuleNames: string[] = [];
        const drive = (ruleConstraints: IValidationRuleFieldConstraint[]) => {
            ruleConstraints.forEach(ruleConstraint => {
                record(ruleConstraint);
                if ( !drivingRuleNames.includes(ruleConstraint.ruleName) ) {
                    drivingRuleNames.push(ruleConstraint.ruleName);
                }
            });
        };

        const picklistExcludeRules = rulesOfType('picklistExclude');
        if ( picklistExcludeRules.length > 0 ) {
            const exclusionRefusal = fieldType.toLowerCase() === 'picklist'
                ? this.findPicklistExclusionRefusal(xmlFieldDetail, new Set(picklistExcludeRules.map(ruleConstraint => ruleConstraint.value as string)), recordTypeApiToRecordTypeWrapperMap, selectedRecordTypeApiName)
                : `ISPICKVAL excludes a value of a picklist, and this is a ${fieldType} field`;
            if ( exclusionRefusal !== undefined ) {
                picklistExcludeRules.forEach(ruleConstraint => record(ruleConstraint, exclusionRefusal));
            } else {
                recipeValue = this.getRecipeFakeValueByXMLFieldDetail(xmlFieldDetail,
                                                                        recordTypeApiToRecordTypeWrapperMap,
                                                                        selectedRecordTypeApiName,
                                                                        new Set(picklistExcludeRules.map(ruleConstraint => ruleConstraint.value as string)));
                drive(picklistExcludeRules);
            }
        }

        let constrainedExpression: string | undefined;

        const regexRules = rulesOfType('regex');
        if ( regexRules.length > 1 ) {
            regexRules.forEach(ruleConstraint => record(ruleConstraint, `${regexRules.length} regex rules on one field cannot be combined`));
        } else if ( regexRules.length === 1 ) {
            const lengthCeiling = RecipeService.getRegexFieldLengthCeiling(xmlFieldDetail);
            const fittedAtoms = RecipeService.fitRegexAtomsToLength(regexRules[0].regexAtoms ?? [], lengthCeiling);
            const regexExpression = VALIDATION_RULE_REGEX_FIELD_TYPES.includes(fieldType) && fittedAtoms !== undefined
                ? this.fakerService.buildRegexExpression(fittedAtoms)
                : undefined;
            const regexRefusal = !VALIDATION_RULE_REGEX_FIELD_TYPES.includes(fieldType)
                ? `a regex rule is applied to a ${VALIDATION_RULE_REGEX_FIELD_TYPES.join(', ')} field, and this is a ${fieldType} field`
                : fittedAtoms === undefined
                    ? `the shortest value the pattern matches is longer than the field's ${lengthCeiling} characters`
                    : ( regexExpression === undefined
                        ? 'this faker service has no regex generator'
                        : RecipeService.findConstrainedExpressionRefusal(regexExpression) );
            if ( regexRefusal !== undefined ) {
                record(regexRules[0], regexRefusal);
            } else {
                constrainedExpression = regexExpression;
                drive(regexRules);
            }
        }

        const boundRules = rulesOfType('numericMin', 'numericMax', 'lengthMin', 'lengthMax', 'dateMin', 'dateMax');
        if ( boundRules.length > 0 ) {
            if ( constrainedExpression !== undefined ) {
                boundRules.forEach(ruleConstraint => record(ruleConstraint, 'a regex rule on this field decides its value, and a bound cannot be combined with it'));
            } else {
                const boundExpression = this.applyBoundRules(xmlFieldDetail, boundRules, record, now);
                if ( boundExpression !== undefined ) {
                    constrainedExpression = boundExpression.expression;
                    drive(boundExpression.appliedRules);
                }
            }
        }

        if ( constrainedExpression !== undefined ) {
            recipeValue = RecipeYamlScalar.toDoubleQuotedScalar(constrainedExpression);
        }
        if ( drivingRuleNames.length > 0 ) {
            const quotedRuleNames = drivingRuleNames.map(ruleName => `"${RecipeYamlScalar.escapeForComment(ruleName)}"`).join(', ');
            recipeValue += `\n${this.generateTabs(5)}### Driven by ValidationRule ${quotedRuleNames}`;
        }

        return {
            recipeValue: recipeValue,
            validationRuleConstraints: fieldRuleConstraints.map(ruleConstraint => recordsByRule.get(ruleConstraint) as IValidationRuleConstraintRecord)
        };

    }

    static getRegexFieldLengthCeiling(xmlFieldDetail: XMLFieldDetail): number {

        if ( xmlFieldDetail.fieldType === 'Phone' ) {
            return VALIDATION_RULE_PHONE_FIELD_LENGTH;
        }
        return RecipeFieldConstraint.getLengthCeiling({
            fieldType: xmlFieldDetail.fieldType,
            ...( Number.isInteger(xmlFieldDetail.length) && xmlFieldDetail.length > 0 ? { length: xmlFieldDetail.length } : {} )
        });

    }

    /*
        A pattern's atoms with their repeats held to the field's length, or undefined when even each
        atom's minimum is too long. Every atom keeps its minimum and the room left is handed out in
        pattern order, so any value drawn still matches the pattern AND fits the field.
    */
    static fitRegexAtomsToLength(regexAtoms: IValidationRuleRegexAtom[], lengthCeiling: number): IValidationRuleRegexAtom[] | undefined {

        let remainingLength = lengthCeiling - regexAtoms.reduce((total, regexAtom) => total + regexAtom.min, 0);
        if ( remainingLength < 0 ) {
            return undefined;
        }

        return regexAtoms.map(regexAtom => {
            const extraRepeats = Math.min(regexAtom.max - regexAtom.min, remainingLength);
            remainingLength -= extraRepeats;
            return { ...regexAtom, max: regexAtom.min + extraRepeats };
        });

    }

    findPicklistExclusionRefusal(xmlFieldDetail: XMLFieldDetail,
                                    excludedPicklistValues: ReadonlySet<string>,
                                    recordTypeApiToRecordTypeWrapperMap: Record<string, RecordTypeWrapper>,
                                    selectedRecordTypeApiName?: string): string | undefined {

        if ( xmlFieldDetail.controllingField ) {
            const controllingValueToPicklistOptions = RecipeService.buildControllingValueToPicklistOptions(xmlFieldDetail);
            if ( Object.keys(controllingValueToPicklistOptions).length === 0 ) {
                return 'the dependent picklist has no valueSettings to exclude a value from';
            }
            return Object.keys(RecipeService.excludeDependentPicklistValues(controllingValueToPicklistOptions, excludedPicklistValues)).length === 0
                ? 'the excluded values are every value the dependent picklist offers'
                : undefined;
        }

        const selectedRecordTypeWrapper = RecipeService.getSelectedRecordTypeWrapper(recordTypeApiToRecordTypeWrapperMap, selectedRecordTypeApiName);
        const picklistValues = this.getAvailablePicklistValueOptions(xmlFieldDetail, selectedRecordTypeWrapper
            ? RecordTypeSelection.getRecordTypePicklistValues(selectedRecordTypeWrapper, xmlFieldDetail.apiName)
            : undefined);
        if ( picklistValues.length === 0 ) {
            return 'the picklist has no values Treecipe knows of to exclude a value from';
        }
        return RecipeService.excludePicklistValues(picklistValues, excludedPicklistValues).length === 0
            ? 'the excluded values are every value the picklist offers'
            : undefined;

    }

    // THE ONE CHECK A RECIPE COCKPIT CONSTRAINT IS HELD TO: ONE "${{ … }}" WITH NO LINE BREAK, CONTROL CHARACTER OR INNER DELIMITER
    static findConstrainedExpressionRefusal(expression: string): string | undefined {

        const expressionRefusal = RecipeCockpitRecipeWriter.checkConstrainedExpression(expression);
        return expressionRefusal === undefined ? undefined : `the expression it generates ${expressionRefusal}`;

    }

    /*
        Bounds of the field's ONE constraint kind, intersected. A bound a field cannot hold on its own
        (more digits than its precision, a length past its <length>) is that rule's refusal; the rest
        are resolved together, and a refusal then -- min above max -- is every one of theirs.
    */
    private applyBoundRules(xmlFieldDetail: XMLFieldDetail,
                                boundRules: IValidationRuleFieldConstraint[],
                                record: (ruleConstraint: IValidationRuleFieldConstraint, reason?: string) => void,
                                now: Date): { expression: string; appliedRules: IValidationRuleFieldConstraint[] } | undefined {

        const fieldType = String(xmlFieldDetail.fieldType ?? '');
        const target: IRecipeFieldConstraintTarget = {
            fieldType: fieldType,
            ...( Number.isInteger(xmlFieldDetail.length) ? { length: xmlFieldDetail.length } : {} ),
            ...( Number.isInteger(xmlFieldDetail.precision) ? { precision: xmlFieldDetail.precision } : {} ),
            ...( Number.isInteger(xmlFieldDetail.scale) ? { scale: xmlFieldDetail.scale } : {} )
        };
        const kind = RecipeFieldConstraint.getConstraintKind(fieldType);
        const kindByRuleType: Record<string, string> = { numericMin: 'number', numericMax: 'number', lengthMin: 'length', lengthMax: 'length', dateMin: 'date', dateMax: 'date' };

        const candidates: Array<{ ruleConstraint: IValidationRuleFieldConstraint; bound: string; boundName: 'min' | 'max' }> = [];

        boundRules.forEach(ruleConstraint => {

            const ruleKind = kindByRuleType[ruleConstraint.type];
            if ( ruleKind !== kind || ( ruleKind === 'date' && fieldType !== 'Date' ) ) {
                record(ruleConstraint, ruleKind === 'date' && fieldType === 'DateTime'
                    ? 'it compares a DateTime field with a date'
                    : `a ${ruleKind} bound does not apply to a ${fieldType} field`);
                return;
            }

            const boundName = ruleConstraint.type.endsWith('Min') ? 'min' : 'max';
            const bound = ruleKind === 'number'
                ? RecipeService.roundNumberBoundIntoScale(ruleConstraint.value as string, target.scale ?? 0, boundName, ruleConstraint.isExclusive === true)
                : ruleConstraint.value as string;
            const boundRefusal = RecipeFieldConstraint.checkBound(target, bound, boundName);
            if ( boundRefusal !== undefined ) {
                record(ruleConstraint, boundRefusal);
                return;
            }
            candidates.push({ ruleConstraint: ruleConstraint, bound: bound, boundName: boundName });

        });

        if ( candidates.length === 0 ) {
            return undefined;
        }

        const comparable = (bound: string): number => kind === 'date'
            ? RecipeFieldConstraint.toComparableMilliseconds(target, RecipeFieldConstraint.parseDateBound(target, bound), now)
            : Number(bound);
        const tightest = (boundName: 'min' | 'max'): string | undefined => candidates
            .filter(candidate => candidate.boundName === boundName)
            .map(candidate => candidate.bound)
            .reduce<string | undefined>((tightestBound, bound) => {
                if ( tightestBound === undefined ) {
                    return bound;
                }
                const isTighter = boundName === 'min' ? comparable(bound) > comparable(tightestBound) : comparable(bound) < comparable(tightestBound);
                return isTighter ? bound : tightestBound;
            }, undefined);

        const storedConstraint: IStoredRecipeFieldConstraint = {};
        const tightestMin = tightest('min');
        const tightestMax = tightest('max');
        if ( tightestMin !== undefined ) {
            storedConstraint.min = tightestMin;
        }
        if ( tightestMax !== undefined ) {
            storedConstraint.max = tightestMax;
        }

        const resolution = RecipeFieldConstraint.resolve(target, storedConstraint, now);
        const candidateRules = candidates.map(candidate => candidate.ruleConstraint);
        if ( !( 'constraint' in resolution ) ) {
            const reason = candidateRules.length > 1
                ? `together these rules leave no value to generate: ${resolution.refusal}`
                : resolution.refusal;
            candidateRules.forEach(ruleConstraint => record(ruleConstraint, reason));
            return undefined;
        }

        const expression = this.fakerService.buildConstrainedExpression(fieldType, resolution.constraint as ResolvedRecipeFieldConstraint);
        const expressionRefusal = RecipeService.findConstrainedExpressionRefusal(expression);
        if ( expressionRefusal !== undefined ) {
            candidateRules.forEach(ruleConstraint => record(ruleConstraint, expressionRefusal));
            return undefined;
        }

        return { expression: expression, appliedRules: candidateRules };

    }

    /*
        A bound read from a formula, as the nearest value at the field's scale that still satisfies
        it: a minimum rounds up and a maximum down, and an excluded bound ("<=", ">=") moves one step
        of the scale inward. Done in whole units of the scale with BigInt, so the digits written are
        the ones parsed and no double rounds them.
    */
    static roundNumberBoundIntoScale(numberText: string, scale: number, boundName: 'min' | 'max', isExclusive: boolean): string {

        const [, sign, wholeDigits, decimalDigits = ''] = /^(-?)(\d+)(?:\.(\d+))?$/.exec(numberText) as RegExpExecArray;
        const ZERO_UNITS = BigInt(0);
        const ONE_UNIT = BigInt(1);
        const isNegative = sign === '-';
        const truncatedUnits = BigInt(`${wholeDigits}${decimalDigits.padEnd(scale, '0').slice(0, scale)}`);
        const hasRemainder = /[1-9]/.test(decimalDigits.slice(scale));

        // floor AND ceil OF THE ABSOLUTE VALUE, THEN OF THE SIGNED ONE
        const absoluteFloor = truncatedUnits;
        const absoluteCeil = truncatedUnits + ( hasRemainder ? ONE_UNIT : ZERO_UNITS );
        const floorUnits = isNegative ? -absoluteCeil : absoluteFloor;
        const ceilUnits = isNegative ? -absoluteFloor : absoluteCeil;
        const isWhole = !hasRemainder;

        let units: bigint;
        if ( boundName === 'min' ) {
            units = isExclusive && isWhole ? ceilUnits + ONE_UNIT : ceilUnits;
        } else {
            units = isExclusive && isWhole ? floorUnits - ONE_UNIT : floorUnits;
        }

        const absoluteUnits = ( units < ZERO_UNITS ? -units : units ).toString().padStart(scale + 1, '0');
        const wholePart = absoluteUnits.slice(0, absoluteUnits.length - scale);
        const decimalPart = scale > 0 ? `.${absoluteUnits.slice(absoluteUnits.length - scale)}` : '';
        return `${units < ZERO_UNITS ? '-' : ''}${wholePart}${decimalPart}`;

    }

    /*
        A rule naming no field the walk read: an OOTB field written from Treecipe's mapping, or a
        field with no file under fields/. The reason is the object's, as the field is not in its list.
    */
    static buildMissingFieldReason(fieldReference: string, ootbFieldApiNames: string[]): string {

        return ootbFieldApiNames.some(ootbFieldApiName => ootbFieldApiName.toLowerCase() === fieldReference.toLowerCase())
            ? `${fieldReference} is written from Treecipe's standard-field mapping, which validation rules do not change`
            : `${fieldReference} is not a field Treecipe read from this object's fields folder`;

    }

    buildValidationRuleNotAppliedTodo(ruleName: string, reason: string): string {

        return `### TODO -- VALIDATION RULE NOT APPLIED -- "${RecipeYamlScalar.escapeForComment(ruleName)}" -- ${RecipeYamlScalar.escapeForComment(reason)}`;

    }

}
