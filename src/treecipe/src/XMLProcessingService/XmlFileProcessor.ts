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
      
      const picklistDetail = this.extractPicklistDetailFromValueSetDefinition(picklistValueSetMarkup, valueSetDefinitionElement);
      picklistFieldDetails.push(picklistDetail);
      
  
    });

    return picklistFieldDetails;

  }

  static extractPicklistDetailFromValueSetDefinition(picklistValueSetMarkup: any, valueSetDefinitionElement: any):IPicklistValue {

    const picklistApiFullName:string = valueSetDefinitionElement.fullName[0];
    const picklistLabel:string = valueSetDefinitionElement.label[0];
    const picklistDefault:any = valueSetDefinitionElement.default ? valueSetDefinitionElement.default[0] : null;
    const isPickListDefault:boolean = Boolean(picklistDefault === 'true' || picklistDefault === true);

    let picklistDetail: IPicklistValue = {
      fullName: picklistApiFullName,
      label: picklistLabel,
      default: isPickListDefault
    };

    if ( picklistValueSetMarkup.controllingField ) {
      // IF THERE IS A CONTROLLING FIELD THEN WE CAN EXPECT THERE TO BE A DEPENDENT PICKLIST
      // THERE CAN BE INSTANCES WHERE CONTROLLING FIELD IS SELECTED BUT NO VALUE SETTINGS ARE MADE AND SO WE NEED TO MANAGE FOR BOTH
      let availableForControllingValuesForPicklistOption = picklistValueSetMarkup.valueSettings?.filter( 
        (dependentPicklistSetting) => dependentPicklistSetting.valueName[0] === picklistApiFullName
      );
      if (availableForControllingValuesForPicklistOption) {
        if ( !availableForControllingValuesForPicklistOption[0]?.controllingFieldValue ) {
          // IF THERE IS A CONTROLLING FIELD VALUE THEN WE CAN EXPECT THERE TO BE A DEPENDENT PICKLIST
          // THERE CAN BE INSTANCES WHERE CONTROLLING FIELD IS SELECTED BUT NO VALUE SETTINGS ARE MADE AND SO WE NEED TO MANAGE FOR BOTH
          console.log(availableForControllingValuesForPicklistOption);
        }
        let availableForControllingValuesettings:string[] = availableForControllingValuesForPicklistOption[0].controllingFieldValue;
        picklistDetail.availableForControllingValues = availableForControllingValuesettings;
      }

    }

    return picklistDetail;

  }

  static isXMLFileType(fileName: string, directoryItemTypeEnum: number ): boolean {

    return (directoryItemTypeEnum === vscode.FileType.File 
            && path.extname(fileName).toLowerCase() === '.xml');

  }


}

  



