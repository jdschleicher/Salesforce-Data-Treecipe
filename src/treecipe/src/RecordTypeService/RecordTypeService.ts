
import { XmlFileProcessor } from '../XMLProcessingService/XmlFileProcessor';
import { RecordTypeWrapper } from './RecordTypesWrapper';
import { SalesforceApiName } from '../RecipeService/SalesforceApiName';

import * as fs from 'fs';
import * as xml2js from 'xml2js';
import * as vscode from 'vscode';
import { Connection } from '@salesforce/core';

export class RecordTypeService {

  static async getRecordTypeToApiFieldToRecordTypeWrapper(associatedFieldsDirectoryPath: string): Promise<Record<string, RecordTypeWrapper>> {

      const expectedRecordTypesPath = this.getExpectedRecordTypesPathByFieldsDirectoryPath(associatedFieldsDirectoryPath);
      const recordTypeFileTuples = await this.getRecordTypeTuplesFromExpectedRecordTypesDirectory(expectedRecordTypesPath);
      const loadedRecordTypes: { recordTypeApiName: string, fileName: string, recordTypeWrapper: RecordTypeWrapper }[] = [];

      for (const [fileName, directoryItemTypeEnum] of recordTypeFileTuples) {
  
        if ( XmlFileProcessor.isXMLFileType(fileName, directoryItemTypeEnum) ) {

          const recordTypeXMLObjectDetail:any = await this.getRecordTypeDetailFromRecordTypeFile(fileName, expectedRecordTypesPath);
          const recordTypeApiName = recordTypeXMLObjectDetail.fullName[0];
          const recordTypeWrapper = this.initiateRecordTypeWrapperByXMLDetail(recordTypeXMLObjectDetail, recordTypeApiName);
          loadedRecordTypes.push({ recordTypeApiName, fileName, recordTypeWrapper });

        }
  
      }

      /*
          readDirectory lists in the file system's order, which is not sorted on every platform, and
          the first record type becomes the default RecordTypeId (#157) and leads every record-type
          section in both backends -- so the order is fixed here, once, for every consumer (#166).
          Code-unit comparison rather than localeCompare, whose result depends on the machine's
          locale. A developer name two files share is tie-broken by file name, so which one wins
          the map does not depend on the listing either.
      */
      loadedRecordTypes.sort((first, second) =>
        this.compareByCodeUnit(String(first.recordTypeApiName), String(second.recordTypeApiName))
        || this.compareByCodeUnit(first.fileName, second.fileName)
      );

      // NO PROTOTYPE: A record type named __proto__ is then a key the api-name partition refuses with a TODO, rather than silently replacing the map's prototype
      const recordTypeDeveloperNameToRecordTypeWrapper: Record<string, RecordTypeWrapper> = Object.create(null);
      loadedRecordTypes.forEach(({ recordTypeApiName, recordTypeWrapper }) => {
        recordTypeDeveloperNameToRecordTypeWrapper[recordTypeApiName] = recordTypeWrapper;
      });
      
      return recordTypeDeveloperNameToRecordTypeWrapper;
      
  }

  static compareByCodeUnit(first: string, second: string): number {

    if ( first < second ) {
      return -1;
    }
    return ( first > second ) ? 1 : 0;

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
      
    // EACH NAME IS INTERPOLATED INTO SOQL, SO ONLY AN API NAME IS EVER SENT -- WHATEVER THE CALLER CHECKED
    const queryableObjectApiNames = objectApiNames.filter(objectApiName => SalesforceApiName.isApiName(objectApiName));

    if ( queryableObjectApiNames.length === 0 ) {
      return { totalSize: 0, done: true, records: [] };
    }

    const joinedObjectNames = queryableObjectApiNames.join("','");
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
    recordTypeWrapper.Active = this.isActiveByXMLDetail(recordTypeXMLDetail);

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

  /*
    Only an explicit <active>false</active> is inactive; a missing tag counts as active. The value is
    type-checked rather than String()-ed: nested markup parses to an object, and one carrying a
    <toString> child makes String() throw, which would abort the whole walk.
  */
  static isActiveByXMLDetail(recordTypeXMLDetail: { active?: unknown[] } | undefined): boolean {

    const activeValue: unknown = recordTypeXMLDetail?.active?.[0];
    if ( typeof activeValue === 'boolean' ) {
      return activeValue;
    }
    return !( typeof activeValue === 'string' && activeValue.trim().toLowerCase() === 'false' );

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
