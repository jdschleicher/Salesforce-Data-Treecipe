import { XMLFieldDetail } from "../XMLProcessingService/XMLFieldDetail";
import * as xml2js from 'xml2js';
import { IPicklistValue } from "../ObjectInfoWrapper/FieldInfo";

import * as path from 'path';
import * as vscode from 'vscode';
import { ErrorHandlingService } from "../ErrorHandlingService/ErrorHandlingService";


export class XmlFileProcessor {

  static async processXmlFieldContent(xmlContent: string, xmlFieldFileName: string): Promise<XMLFieldDetail> {

    let xmlFieldDetail = new XMLFieldDetail();
  
    try {
  
      xmlFieldDetail.xmlMarkup = xmlContent;

      let fieldXML: any;
      let parseString = xml2js.parseString;
      parseString(xmlContent, function (error, result) {

        if (error) { 
          throw new Error(`Error processing xmlContent ${xmlContent}:` + error);
        }

        fieldXML = result;

      });

      const apiName = fieldXML.CustomField.fullName[0];
      xmlFieldDetail.apiName = apiName;

      const typeValue = fieldXML?.CustomField?.type?.[0] ?? "AUTO_GENERATED";
      const fieldLabel = fieldXML?.CustomField?.label?.[0] ?? "AUTO_GENERATED";
      xmlFieldDetail.fieldType = typeValue;
      xmlFieldDetail.fieldLabel = fieldLabel;

      // Parse precision, scale, and length properties (only if they exist in XML)
      const precision = fieldXML?.CustomField?.precision?.[0];
      if (precision !== undefined && precision !== null) {
        xmlFieldDetail.precision = parseInt(precision, 10);
      }

      const scale = fieldXML?.CustomField?.scale?.[0];
      if (scale !== undefined && scale !== null) {
        xmlFieldDetail.scale = parseInt(scale, 10);
      }

      const length = fieldXML?.CustomField?.length?.[0];
      if (length !== undefined && length !== null) {
        xmlFieldDetail.length = parseInt(length, 10);
      }

      if ( typeValue === 'Picklist' || typeValue === "MultiselectPicklist") {

        let picklistValueSetMarkup = fieldXML.CustomField.valueSet?.[0];

        if (picklistValueSetMarkup) {

            // IF picklistValueSetMarkup.valueSetDefinition IS undefined THIS IS AN INDICATOR THAT THE PICKLIST IS A GLOBAL PICKLIST
            if (picklistValueSetMarkup.valueSetDefinition !== undefined) {
        
              xmlFieldDetail.picklistValues = this.extractPickListDetailsFromXMLValueTag(picklistValueSetMarkup);

              const controllingFieldApiName = picklistValueSetMarkup.controllingField ? picklistValueSetMarkup.controllingField[0]: null;
              if (controllingFieldApiName) {
                xmlFieldDetail.controllingField = controllingFieldApiName;
              }     
        
            } else if ( picklistValueSetMarkup?.valueSetName !== undefined ) {

              // Index of "0" used to convert xml tag array to single value
              xmlFieldDetail.globalValueSetName = picklistValueSetMarkup.valueSetName[0];

              /*
                A picklist backed by a GLOBAL value set can still be DEPENDENT. controllingField was
                previously read only in the branch above, so such a field parsed as not dependent at
                all: no dependency spec was generated for it and recipe generation treated it as a
                plain picklist. The controllingField and valueSettings markup are present in the
                field file either way -- only the value DEFINITIONS live elsewhere.
              */
              const globalValueSetControllingFieldApiName = picklistValueSetMarkup.controllingField ? picklistValueSetMarkup.controllingField[0] : null;
              if (globalValueSetControllingFieldApiName) {

                xmlFieldDetail.controllingField = globalValueSetControllingFieldApiName;
                xmlFieldDetail.picklistValues = this.extractPicklistDetailsFromValueSettings(picklistValueSetMarkup);

              }

            } 

        } else {

          /*
          
            if no <valueSet> tag on xml markup that is set to "Picklist" then the field is a "Standard Value Set"

            if the fieldLabel was null and set to "AUTO_GENERATED" , we will update the label to be the standard value set api name

          */

            xmlFieldDetail.isStandardValueSet = true;
            xmlFieldDetail.fieldLabel = xmlFieldDetail.apiName;

        }
        
      } else if ( typeValue === "Lookup" || typeValue === "MasterDetail" ) {
        
        const referenceTo = fieldXML.CustomField.referenceTo? fieldXML.CustomField.referenceTo[0] : null;
        xmlFieldDetail.referenceTo = referenceTo;

      }
      
      return xmlFieldDetail;

    } catch (error) {

      const executedCommand = "XMLFileProcessor.processXmlFieldContent";
      const customErrorMessage = `Error processing XML file: ${xmlFieldFileName} - ${error.message}`;
      
      const customXMLFieldError = new Error();
      customXMLFieldError.message = customErrorMessage;

      customXMLFieldError.name = "XMLFieldProcessorError";
      customXMLFieldError.stack = error.stack;

      customXMLFieldError.cause = xmlFieldDetail;

      ErrorHandlingService.createGenerateRecipeErrorCaptureFile(customXMLFieldError, executedCommand);
      
      throw customXMLFieldError;
      
    }
    

  }

  static extractPickListDetailsFromXMLValueTag(picklistValueSetMarkup: any): IPicklistValue[] {
  
    // NOTE: THE INDEX OF ZERO "[0]" USED IN SEVERAL LOCATIONS IS REQUIRED DUE TO HOW THE XML ARE PARSED AS THERE COULD BE 1 OR MANY OF THE SAME ELEMENT NODE
    let picklistFieldDetails:IPicklistValue[] = [];
  
    /* 
      IF picklistValueSetMarkup.valueSetDefinition IS undefined 
      THIS IS AN INDICATOR THAT THE PICKLIST IS A GLOBAL PICKLIST.
      This scenario is handled further upstream but to prevent unexpected errors 
      for xml not needed we will do a null/undefined check 
    */
    if (picklistValueSetMarkup.valueSetDefinition !== undefined) {
      
      let picklistValues = picklistValueSetMarkup.valueSetDefinition[0].value;
      picklistValues.forEach(valueSetDefinitionElement => {
        
        const picklistDetail = this.extractPicklistDetailFromValueSetDefinition(valueSetDefinitionElement);
        const dependentPicklistConfigurationExists = ( picklistValueSetMarkup?.controllingField?.length === 1 );
        // IF THERE IS A CONTROLLING FIELD THEN WE CAN EXPECT THERE TO BE A DEPENDENT PICKLIST CONFIGURATION
        if (dependentPicklistConfigurationExists) {
            const dependentPicklistConfigurationDetail = this.getDependentPicklistConfigurationDetailByPicklistDetail(picklistDetail.picklistOptionApiName, picklistValueSetMarkup);
            picklistDetail.controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection = dependentPicklistConfigurationDetail;
        }
        picklistFieldDetails.push(picklistDetail);
        
      });

    }

    return picklistFieldDetails;

  }

  /*
    Builds picklist details for a dependent picklist whose values come from a global value set.

    Such a field has no local valueSetDefinition to walk, but its valueSettings name every dependent
    value and the controlling values that unlock it -- which is all the dependency map needs. Deriving
    the details from valueSettings lets a global-value-set-backed dependent picklist travel the same
    path as any other rather than being treated as non-dependent.

    The values this yields are those carrying dependency configuration. A global value set value with
    no valueSettings entry is unlocked by no controlling value and so does not appear here; reading
    the global value set file to include it is deliberately not done, since generation reads the
    object metadata it was pointed at.
  */
  static extractPicklistDetailsFromValueSettings(picklistValueSetMarkup: any): IPicklistValue[] {

    const dependentPicklistValueSettings = picklistValueSetMarkup?.valueSettings;
    if ( !dependentPicklistValueSettings ) {
      return [];
    }

    let controllingValuesByDependentValue: Record<string, string[]> = {};

    dependentPicklistValueSettings.forEach(dependentPicklistSetting => {

      const dependentValueApiName = dependentPicklistSetting?.valueName?.[0];
      if ( !dependentValueApiName ) {
        return;
      }

      const controllingFieldValues: string[] = dependentPicklistSetting?.controllingFieldValue ?? [];
      const alreadyCapturedControllingValues = controllingValuesByDependentValue[dependentValueApiName] ?? [];

      // A DEPENDENT VALUE CAN APPEAR IN MORE THAN ONE valueSettings BLOCK, SO THE CONTROLLING VALUES ARE MERGED
      controllingValuesByDependentValue[dependentValueApiName] = [
        ...alreadyCapturedControllingValues,
        ...controllingFieldValues.filter(controllingValue => !alreadyCapturedControllingValues.includes(controllingValue))
      ];

    });

    return Object.entries(controllingValuesByDependentValue).map(([dependentValueApiName, controllingValues]) => ({
      picklistOptionApiName: dependentValueApiName,
      label: dependentValueApiName,
      default: false,
      isActive: true,
      controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection: controllingValues
    }));

  }

  static extractPicklistDetailFromValueSetDefinition(valueSetDefinitionElement: any):IPicklistValue {

    // FOR ALL USES OF "0" AS INDEX, THE XML PARSER IS LOOKING FOR 1 OR MANY TAGS SO WE ARE ONLY EXPECTED ONE BUT IT IS RETURNING AN ARRAY SO WE NEED TO GET THE FIRST INDEX OF '0'
    const picklistOptionApiName:string = valueSetDefinitionElement.fullName[0];
    const picklistLabel:string = valueSetDefinitionElement.label[0];

    // for below string to boolean conversions, stopped trying for the moment to get explicit conversion to work after tests continued to return string values

    // "is picklist active" defaults to true if there is no <isActive> xml makrup that indicates false or true
    const isPicklistActiveStringValue:any = valueSetDefinitionElement?.isActive ? valueSetDefinitionElement.isActive[0] : true;
    const isPickListActive:boolean = Boolean(isPicklistActiveStringValue === 'true' || isPicklistActiveStringValue === true );
    
    const isPicklistDefaultStringValue:any = valueSetDefinitionElement.default ? valueSetDefinitionElement.default[0] : null;
    const isPickListDefault:boolean = Boolean(isPicklistDefaultStringValue === 'true' || isPicklistDefaultStringValue === true);

    let picklistDetail: IPicklistValue = {
      picklistOptionApiName: picklistOptionApiName,
      label: picklistLabel,
      default: isPickListDefault,
      isActive: isPickListActive
    };

    return picklistDetail;

  }

  static getDependentPicklistConfigurationDetailByPicklistDetail(picklistOptionApiName: string, picklistValueSetMarkup: any): string[] {


      /* 

        IF THERE IS A CONTROLLING FIELD THEN WE CAN EXPECT THERE TO BE A DEPENDENT PICKLIST CONFIGURATION
        
        THERE CAN BE INSTANCES WHERE:
        1.) POTENTIAL CONTROLLING FIELD IS SELECTED BUT NO VALUE SETTINGS ARE MADE AND SO WE NEED TO MANAGE FOR BOTH
        2.) PICKLIST VALUE OF DEPENDENT PICKLIST IS INACTIVE OR HAS NO CONFIGURATION OF CONTROLLING FIELDS

      */
      let controllingValuesFromParentPicklistThatAllowThisPicklistValue = picklistValueSetMarkup.valueSettings?.filter( 
        /*
          there could be multiple <valueSetting></valueSetting> configurations. 
          This filter will capture those controllingField values based on the picklist's value api name
          <valueSettings>
            <controllingFieldValue>cle</controllingFieldValue>
            <controllingFieldValue>eastlake</controllingFieldValue>
            <controllingFieldValue>madison</controllingFieldValue>
            <controllingFieldValue>willoughby</controllingFieldValue>
            <valueName>tree</valueName>
        </valueSettings>
        */
        (dependentPicklistSetting) => dependentPicklistSetting.valueName[0] === picklistOptionApiName
      );


      let controlllingValuesDependentPicklistIndividualValueIsAvailableFor:string[] = null;
      if (controllingValuesFromParentPicklistThatAllowThisPicklistValue && controllingValuesFromParentPicklistThatAllowThisPicklistValue.length > 0) { {

        controlllingValuesDependentPicklistIndividualValueIsAvailableFor = controllingValuesFromParentPicklistThatAllowThisPicklistValue[0].controllingFieldValue;
        
      }

    }

    return controlllingValuesDependentPicklistIndividualValueIsAvailableFor;
    
  }

  static isXMLFileType(fileName: string, directoryItemTypeEnum: number ): boolean {

    return (directoryItemTypeEnum === vscode.FileType.File 
            && path.extname(fileName).toLowerCase() === '.xml');

  }

  /*
    Salesforce source format names every custom field file "<ApiName>.field-meta.xml". Matching on
    ".xml" alone is not enough: a fields directory can hold a hand-saved copy, an export, or a
    scratch file that happens to carry CustomField markup, and each of those would be parsed as a
    real field. That produced spec lines for fields the org does not have.

    The api name is taken from the file name rather than the <fullName> element elsewhere in the
    pipeline, so a file not following the convention has no reliable api name to begin with.
  */
  private static salesforceFieldMetadataSuffix = '.field-meta.xml';

  static getSalesforceFieldMetadataSuffix(): string {
    return this.salesforceFieldMetadataSuffix;
  }

  static isSalesforceFieldMetadataFile(fileName: string, directoryItemTypeEnum: number): boolean {

    if ( directoryItemTypeEnum !== vscode.FileType.File ) {
      return false;
    }

    const normalizedFileName = fileName.toLowerCase();

    // THE SUFFIX MUST BE PRECEDED BY AN API NAME, SO A FILE CALLED EXACTLY ".field-meta.xml" IS NOT ONE
    return normalizedFileName.endsWith(this.salesforceFieldMetadataSuffix)
            && normalizedFileName.length > this.salesforceFieldMetadataSuffix.length;

  }


}
