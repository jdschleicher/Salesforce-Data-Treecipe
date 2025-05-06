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

      if ( typeValue === 'Picklist' || typeValue === "MultiselectPicklist") {

        let picklistValueSetMarkup = fieldXML.CustomField.valueSet?.[0];

        if (picklistValueSetMarkup) {
          xmlFieldDetail.picklistValues = this.extractPickListDetailsFromXMLValueTag(picklistValueSetMarkup);

          const controllingFieldApiName = picklistValueSetMarkup.controllingField ? picklistValueSetMarkup.controllingField[0]: null;
          if (controllingFieldApiName) {
            xmlFieldDetail.controllingField = controllingFieldApiName;
          }

        } else {
          // TODO: handle possible global picklist scenario
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
  
    let picklistValues = picklistValueSetMarkup.valueSetDefinition[0].value;
    picklistValues.forEach(valueSetDefinitionElement => {
      
      const picklistDetail = this.extractPicklistDetailFromValueSetDefinition(valueSetDefinitionElement);
      const dependentPicklistConfigurationExists = picklistValueSetMarkup.controllingField;
      // IF THERE IS A CONTROLLING FIELD THEN WE CAN EXPECT THERE TO BE A DEPENDENT PICKLIST CONFIGURATION
      if (dependentPicklistConfigurationExists) {
          const dependentPicklistConfigurationDetail = this.getDependentPicklistConfigurationDetailByPicklistDetail(picklistDetail.picklistOptionApiName, picklistValueSetMarkup);
          picklistDetail.controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection = dependentPicklistConfigurationDetail;
      }
      picklistFieldDetails.push(picklistDetail);
      
  
    });

    return picklistFieldDetails;

  }

  static extractPicklistDetailFromValueSetDefinition(valueSetDefinitionElement: any):IPicklistValue {

    const picklistOptionApiName:string = valueSetDefinitionElement.fullName[0];
    const picklistLabel:string = valueSetDefinitionElement.label[0];
    const picklistDefault:any = valueSetDefinitionElement.default ? valueSetDefinitionElement.default[0] : null;
    const isPickListDefault:boolean = Boolean(picklistDefault === 'true' || picklistDefault === true);

    let picklistDetail: IPicklistValue = {
      picklistOptionApiName: picklistOptionApiName,
      label: picklistLabel,
      default: isPickListDefault
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

        if ( !controllingValuesFromParentPicklistThatAllowThisPicklistValue[0]?.controllingFieldValue ) {
          // IF THERE IS A CONTROLLING FIELD VALUE THEN WE CAN EXPECT THERE TO BE A DEPENDENT PICKLIST
          // THERE CAN BE INSTANCES WHERE CONTROLLING FIELD IS SELECTED BUT NO VALUE SETTINGS ARE MADE AND SO WE NEED TO MANAGE FOR BOTH
          console.log(controllingValuesFromParentPicklistThatAllowThisPicklistValue);
        }

        controlllingValuesDependentPicklistIndividualValueIsAvailableFor = controllingValuesFromParentPicklistThatAllowThisPicklistValue[0].controllingFieldValue;
        // picklistDetail.controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection = availableForControllingValuesettings;
        
      }

    }

    return controlllingValuesDependentPicklistIndividualValueIsAvailableFor;
    
  }

  static isXMLFileType(fileName: string, directoryItemTypeEnum: number ): boolean {

    return (directoryItemTypeEnum === vscode.FileType.File 
            && path.extname(fileName).toLowerCase() === '.xml');

  }


}

  



