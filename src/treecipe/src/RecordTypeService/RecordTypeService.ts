
import { XmlFileProcessor } from '../XMLProcessingService/XmlFileProcessor';
import { RecordTypeWrapper } from './RecordTypesWrapper';

import * as fs from 'fs';
import * as xml2js from 'xml2js';
import * as vscode from 'vscode';
import { Connection } from '@salesforce/core';

export class RecordTypeService {

  static async getRecordTypeToApiFieldToRecordTypeWrapper(associatedFieldsDirectoryPath: string): Promise<Record<string, RecordTypeWrapper>> {

      const expectedRecordTypesPath = this.getExpectedRecordTypesPathByFieldsDirectoryPath(associatedFieldsDirectoryPath);
      const recordTypeFileTuples = await this.getRecordTypeTuplesFromExpectedRecordTypesDirectory(expectedRecordTypesPath);
      let recordTypeDeveloperNameToRecordTypeWrapper: Record<string, RecordTypeWrapper> = {};

      for (const [fileName, directoryItemTypeEnum] of recordTypeFileTuples) {
  
        if ( XmlFileProcessor.isXMLFileType(fileName, directoryItemTypeEnum) ) {

          const recordTypeXMLObjectDetail:any = await this.getRecordTypeDetailFromRecordTypeFile(fileName, expectedRecordTypesPath);
          const recordTypeApiName = recordTypeXMLObjectDetail.picklistOptionApiName[0];
          const recordTypeWrapper = this.initiateRecordTypeWrapperByXMLDetail(recordTypeXMLObjectDetail, recordTypeApiName);
          recordTypeDeveloperNameToRecordTypeWrapper[recordTypeApiName] = recordTypeWrapper;

        }
  
      }
      
      return recordTypeDeveloperNameToRecordTypeWrapper;
      
  }

  static getExpectedRecordTypesPathByFieldsDirectoryPath(associatedFieldsDirectoryPath: string) {

    const baseObjectPath = associatedFieldsDirectoryPath.split('/fields')[0]; // getting index of 0 will return base path 
    const expectedRecordTypesFolderName = 'recordTypes';
    const expectedRecordTypesPath = `${baseObjectPath}/${expectedRecordTypesFolderName}`;

    return expectedRecordTypesPath;

  }

  static async getRecordTypeIdsByConnection(conn: Connection, 
                                            objectApiNames: string[]
                                            ): Promise<any> {
      
    const joinedObjectNames = objectApiNames.join("','");
    const recordTypeDetail = await conn.query(`
        SELECT Id, 
            SObjectType,
            DeveloperName 
        FROM RecordType 
        WHERE SObjectType IN ('${joinedObjectNames}')
    `); 
  
    return recordTypeDetail;

  }

  static initiateRecordTypeWrapperByXMLDetail(recordTypeXMLDetail: any, recordTypeApiName: string) {

    let recordTypeWrapper = new RecordTypeWrapper();
    recordTypeWrapper.RecordTypeId = '';
    recordTypeWrapper.DeveloperName = recordTypeApiName;

    const associatedFieldApiToRecordTypePicklistValuesMap: Record<string, string[]> = {};
    const picklistValues = recordTypeXMLDetail.picklistValues;
    if ( picklistValues !== undefined ) {
      picklistValues.forEach((picklistValue: any) => {
        const fieldName = picklistValue.picklist[0]; // picklist is array with one expected value
        const recordTypePicklistValuesForField = picklistValue.values.flatMap((value: any) => value.fullName ); // Extract the list of values
        associatedFieldApiToRecordTypePicklistValuesMap[fieldName] = recordTypePicklistValuesForField;
      });
    }

    recordTypeWrapper.PicklistFieldSectionsToPicklistDetail = associatedFieldApiToRecordTypePicklistValuesMap;
    return recordTypeWrapper;

  }

  static async getRecordTypeTuplesFromExpectedRecordTypesDirectory(expectedRecordTypesPath):Promise<[string, number][]> {

    /*
      check if recordTypes folder exists, return empty and skip functionality if not
      if folder exists but is empty, return and skip functionality
    */ 

    let recordTypeFileTuples: [string, number][] = [];
    const recordTypesDirectoryExists = ( fs.existsSync(expectedRecordTypesPath) );

    if ( recordTypesDirectoryExists ) {
      const recordTypesDirectoryUri = vscode.Uri.parse(expectedRecordTypesPath);
      recordTypeFileTuples = await vscode.workspace.fs.readDirectory(recordTypesDirectoryUri);
    }

    return recordTypeFileTuples;

  }

  static convertRecordTypeXMLContentToXMLDetailObject(recordTypeXMLContent: string): any {

    let recordTypeXML: any = {};
    xml2js.parseString(recordTypeXMLContent, function (error, result) {
  
      if (error) {  
        throw new Error(`Error processing record type xmlContent ${recordTypeXMLContent}: ` + error.message);
      }
      recordTypeXML = result;

    });

    const recordTypeXMLDetail = recordTypeXML.RecordType;  
    return recordTypeXMLDetail;
  
  }

  static async getRecordTypeDetailFromRecordTypeFile(fileName: string, recordTypesPath: string) {
      
    const recordTypeUri = vscode.Uri.joinPath((vscode.Uri.parse(recordTypesPath)), fileName);
    const recordTypeContentUriData = await vscode.workspace.fs.readFile(recordTypeUri);
    const recordTypeXMLContent = Buffer.from(recordTypeContentUriData).toString('utf8');

    const recordTypeXMLDetail: any = this.convertRecordTypeXMLContentToXMLDetailObject(recordTypeXMLContent);
    return recordTypeXMLDetail;

  }

}
