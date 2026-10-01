import { ErrorHandlingService } from "../ErrorHandlingService/ErrorHandlingService";
import { GlobalValueSetSingleton } from "../GlobalValueSetSingleton/GlobalValueSetSingleton";
import { IRecipeFakerService } from "../RecipeFakerService.ts/IRecipeFakerService";
import { RecipeYamlScalar } from "../RecipeFakerService.ts/RecipeYamlScalar/RecipeYamlScalar";
import { RecordTypeWrapper } from "../RecordTypeService/RecordTypesWrapper";
import { ValueSetService } from "../ValueSetService/ValueSetService";
import { XMLFieldDetail } from "../XMLProcessingService/XMLFieldDetail";
import { ICompoundComponentRecipe } from "./ICompoundComponentRecipe";

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
                        
                        let availablePicklistValueOptions: string[] = [];
                        if ( !(xmlFieldDetail.picklistValues) ) {

                            // IF THE FIELD TYPE IS 'picklist' BUT!!! THERE IS NO <picklistValues> XML MARKUP, THEN WE TRY
                            // TO GET PICKLIST VALUES WITH THE POSSIBILITY THEY ARE A DEFAULT STANDARD VALUE SET (OR GLOBAL VALUE SET IN A FUTURE FEATURE)
                            const existingOOTBStandardValueSetPicklistValuesByApiName = ValueSetService.getOOTBValueOptionsByStandardValueSetName(xmlFieldDetail.apiName);
                            if ( existingOOTBStandardValueSetPicklistValuesByApiName ) {
                                availablePicklistValueOptions = existingOOTBStandardValueSetPicklistValuesByApiName;
                            } else {

                                const globalValueSetSingleton = GlobalValueSetSingleton.getInstance();
                                const gvsPicklistByPicklistValues:Record<string, string[]> = globalValueSetSingleton.getPicklistValueMaps();
                                if ( gvsPicklistByPicklistValues ) {

                                    const picklistValuesByGlobalValueSetName = gvsPicklistByPicklistValues[xmlFieldDetail.globalValueSetName];
                                    if ( picklistValuesByGlobalValueSetName ) {
                                        availablePicklistValueOptions = picklistValuesByGlobalValueSetName;
                                     }

                                }
                              
                            }

                        } else {
                            
                            availablePicklistValueOptions = xmlFieldDetail.picklistValues.map(picklistOption => picklistOption.picklistOptionApiName);
                            
                        }

                        fakeRecipeValue = this.fakerService.buildPicklistRecipeValueByXMLFieldDetail(availablePicklistValueOptions, recordTypeApiToRecordTypeWrapperMap, xmlFieldDetail.apiName );  
                    
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

    getDependentPicklistRecipeFakerValue(xmlFieldDetail: XMLFieldDetail, recordTypeApiToRecordTypeWrapperMap: Record<string, RecordTypeWrapper>): string {

        const controllingField = xmlFieldDetail.controllingField;

        if ( !RecipeService.isRecipeWritableFieldApiName(controllingField) ) {
            return ` ${this.buildInvalidApiNameTodo('DEPENDENT PICKLIST SKIPPED -- controlling field', controllingField, `fix the <controllingField> of "${RecipeYamlScalar.escapeForComment(String(xmlFieldDetail.apiName ?? ''))}" and regenerate`)}`;
        }

        if ( !(xmlFieldDetail.picklistValues) ) {
            return '';
        }

        const controllingValueToPicklistOptions = RecipeService.buildControllingValueToPicklistOptions(xmlFieldDetail);

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
            const [ selectedRecordTypeApiName, ...otherRecordTypeApiNames ] = recordTypeApiNames;
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

    static readonly salesforceFieldApiNamePattern = /^[A-Za-z][A-Za-z0-9_]*$/;

    static isRecipeWritableFieldApiName(fieldApiName: string): boolean {

        return typeof fieldApiName === 'string' && RecipeService.salesforceFieldApiNamePattern.test(fieldApiName);

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

}
