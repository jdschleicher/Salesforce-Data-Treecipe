
import { XmlFileProcessor } from '../XMLProcessingService/XmlFileProcessor';

import * as fs from 'fs';
import * as xml2js from 'xml2js';
import * as vscode from 'vscode';


export class RecordTypeService {

    static async getRecordTypeMarkupMap(associatedFieldsDirectoryPath: string): Promise<Record<string, object>> {

        const baseObjectPath = associatedFieldsDirectoryPath.split('/fields')[0]; // getting index of 0 will return base path 
        const expectedRecordTypesFolderName = 'recordTypes';
        const expectedRecordTypesPath = `${baseObjectPath}/${expectedRecordTypesFolderName}`;
        const recordTypesDirectoryUri = vscode.Uri.parse(expectedRecordTypesPath);
    
        let recordTypeToXMLMarkupMap: Record<string, object> = {};
    
        // check if recordTypes folder exists, return and skip functionality if not
        if (!fs.existsSync(expectedRecordTypesPath)) {
          // no recordTypes folder exists for object
          return recordTypeToXMLMarkupMap;
        }
        
        const recordTypeFileTuples = await vscode.workspace.fs.readDirectory(recordTypesDirectoryUri);
        if (recordTypeFileTuples === undefined || recordTypeFileTuples.length === 0) {
          // if folder exists but is empty, return and skip functionality
          return recordTypeToXMLMarkupMap;
        } 
    
        for (const [fileName, directoryItemTypeEnum] of recordTypeFileTuples) {
    
          if ( XmlFileProcessor.isXMLFileType(fileName, directoryItemTypeEnum) ) {
    
            const recordTypeUri = vscode.Uri.joinPath(recordTypesDirectoryUri, fileName);
            const recordTypeContentUriData = await vscode.workspace.fs.readFile(recordTypeUri);
            const recordTypeXMLContent = Buffer.from(recordTypeContentUriData).toString('utf8');
    
            let recordTypeXML: any;
            xml2js.parseString(recordTypeXMLContent, function (error, result) {
    
              if (error) {  
                throw new Error(`Error processing record type xmlContent ${recordTypeXMLContent}: ` + error.message);
              }
              recordTypeXML = result;

            });

            const recordType = recordTypeXML.RecordType;
            const picklistValues = recordType.picklistValues;
        
            const fieldApiToRecordTypePicklistValuesMap: Record<string, string[]> = {};
            picklistValues.forEach((picklistValue: any) => {
                const fieldName = picklistValue.picklist[0]; // picklist is array with one expected value
                const recordTypePicklistValuesForField = picklistValue.values.flatMap((value: any) => value.fullName ); // Extract the list of values
                fieldApiToRecordTypePicklistValuesMap[fieldName] = recordTypePicklistValuesForField;
            });
        
            const apiName = recordTypeXML.RecordType.fullName[0];
            recordTypeToXMLMarkupMap[apiName] = fieldApiToRecordTypePicklistValuesMap;
    
          }
    
        }
        
        return recordTypeToXMLMarkupMap;
      
    }

    

}
