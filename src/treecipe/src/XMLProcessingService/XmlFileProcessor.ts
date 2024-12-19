import { XMLFieldDetail } from "../XMLProcessingService/XMLFieldDetail";
import * as xml2js from 'xml2js';
import * as fs from 'fs';

import { IPicklistValue } from "../ObjectInfoWrapper/FieldInfo";

export class XmlFileProcessor {

  static async processXmlFieldContent(xmlContent: string): Promise<XMLFieldDetail> {

    let xmlFieldDetail = new XMLFieldDetail();
  
    try {

      let fieldXML: any;
      let parseString = xml2js.parseString;
      parseString(xmlContent, function (err, result) {
          console.dir(result);
          fieldXML = result;
      });

      const typeValue = fieldXML?.CustomField?.type?.[0] ?? "AUTO_GENERATED";
      const fieldLabel = fieldXML?.CustomField?.label?.[0] ?? "AUTO_GENERATED";
      
      const apiName = fieldXML.CustomField.fullName[0];

      xmlFieldDetail.fieldType = typeValue;
      xmlFieldDetail.fieldLabel = fieldLabel;
      xmlFieldDetail.apiName = apiName;

      if ( typeValue === 'Picklist' || typeValue === "MultiselectPicklist") {

        let picklistValueSetMarkup = fieldXML.CustomField.valueSet[0];
        xmlFieldDetail.picklistValues = this.extractPickListDetailsFromXMLValueTag(picklistValueSetMarkup);

        const controllingFieldApiName = picklistValueSetMarkup.controllingField ? picklistValueSetMarkup.controllingField[0]: null;
        if (controllingFieldApiName) {
          xmlFieldDetail.controllingField = controllingFieldApiName;
        }
        
      } else if ( typeValue === "Lookup" || typeValue === "MasterDetail" ) {
        
        const referenceTo = fieldXML.CustomField.referenceTo? fieldXML.CustomField.referenceTo[0] : null;
        xmlFieldDetail.referenceTo = referenceTo;

      }
  
    } catch (error) {
      console.error(`Error processing xmlContent ${xmlContent}:`, error);
    }

    
    return xmlFieldDetail;

  }

  static extractPickListDetailsFromXMLValueTag(picklistValueSetMarkup: any): IPicklistValue[] {
  
    // NOTE: THE INDEX OF ZERO "[0]" USED IN SEVERAL LOCATIONS IS REQUIRED DUE TO HOW THE XML ARE PARSED AS THERE COULD BE 1 OR MANY OF THE SAME ELEMENT NODE
    let picklistFieldDetails:IPicklistValue[] = [];
  
    let picklistValues = picklistValueSetMarkup.valueSetDefinition[0].value;
    picklistValues.forEach(element => {
            
      const picklistApiFullName:string = element.fullName[0];
      const picklistLabel:string = element.label[0];
      const picklistDefault:any = element.default ? element.default[0] : null;
      const isPickListDefault:boolean = Boolean(picklistDefault === 'true' || picklistDefault === true);

      let picklistDetail: IPicklistValue = {
        fullName: picklistApiFullName,
        label: picklistLabel,
        default: isPickListDefault
      };

      if ( picklistValueSetMarkup.controllingField ) {
        // IF THERE IS A CONTROLLING FIELD THEN WE CAN EXPECT THERE TO BE A DEPENDENT PICKLIST AND CONTROLLING FIELD VALUE SETTINGS
        let availableForControllingValuesForPicklistOption = picklistValueSetMarkup.valueSettings.filter( (dependentPicklistSetting) => dependentPicklistSetting.valueName[0] === picklistApiFullName);
        if (availableForControllingValuesForPicklistOption) {
          let availableForControllingValuesettings:string[] = availableForControllingValuesForPicklistOption[0].controllingFieldValue;
          picklistDetail.availableForControllingValues = availableForControllingValuesettings;
        }

      }

      picklistFieldDetails.push(picklistDetail);
  
    });

    return picklistFieldDetails;

  }



}

  



