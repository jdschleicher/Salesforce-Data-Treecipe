import { XmlFileProcessor } from './XmlFileProcessor';
import { RecipeService } from '../../application/services/RecipeService';

import * as fs from 'fs';
import * as path from 'path';
import { FieldInfo } from '../../domain/entities/FieldInfo';
import { XMLFieldDetail } from '../../domain/entities/XMLFieldDetail';
import { ObjectInfoWrapper } from '../../domain/entities/ObjectInfoWrapper';


export function processDirectory(directoryPath: string, objectInfoWrapper: ObjectInfoWrapper): ObjectInfoWrapper {
  
    const entries = fs.readdirSync(directoryPath, { withFileTypes: true, recursive: false });


    for (const entry of entries) {
        
      const fullPath = path.join(directoryPath, entry.name);

      if (entry.isDirectory()) {
          if (entry.name === 'fields'){

            let parentObjectDirectoryPath = entry.path
            let objectName = getLastSegmentFromPath(parentObjectDirectoryPath);
            objectInfoWrapper.addKeyToObjectInfoMap(objectName);

            let fieldsInfo:FieldInfo[] = processFieldsDirectory(fullPath, objectName);
            objectInfoWrapper.objectToObjectInfoMap[objectName].fields = fieldsInfo;

            if ( !(objectInfoWrapper.objectToObjectInfoMap[objectName].fullRecipe) ) {
              objectInfoWrapper.objectToObjectInfoMap[objectName].fullRecipe = RecipeService.initiateRecipeByObjectName(objectName);
            }

            fieldsInfo.forEach((fieldDetail) => {
              
              objectInfoWrapper.objectToObjectInfoMap[objectName].fullRecipe = RecipeService.appendFieldRecipeToObjectRecipe(
                                                                                                                              objectInfoWrapper.objectToObjectInfoMap[objectName].fullRecipe,
                                                                                                                              fieldDetail.recipeValue,
                                                                                                                              fieldDetail.fieldName
                                                                                                                            );

            });

            objectInfoWrapper.combinedRecipes += objectInfoWrapper.objectToObjectInfoMap[objectName].fullRecipe;
            objectInfoWrapper.combinedRecipes += "\n";

          } else {
              processDirectory(fullPath, objectInfoWrapper);
          }
      }

    }

    return objectInfoWrapper;

}

export function processFieldsDirectory (
                                        directoryPath: string, 
                                        associatedObjectName: string
                                        ) : FieldInfo[] {
  
  const files = fs.readdirSync(directoryPath);
  let fieldInfoDetails:FieldInfo[] = [];
  for (const file of files) {

    if (path.extname(file).toLowerCase() === '.xml') {

      const fieldPath = path.join(directoryPath, file);
      const xmlContent = fs.readFileSync(fieldPath, 'utf-8');

      let fieldXMLDetail:XMLFieldDetail = XmlFileProcessor.processXmlFieldContent(xmlContent);
      let recipeValue = RecipeService.getRecipeFakeValueByXMLFieldDetail(fieldXMLDetail);
      
      let fieldInfo = FieldInfo.create(
          associatedObjectName,
          fieldXMLDetail.apiName,
          fieldXMLDetail.fieldLabel,
          fieldXMLDetail.fieldType,
          fieldXMLDetail.picklistValues,
          fieldXMLDetail.controllingField,
          fieldXMLDetail.referenceTo,
          recipeValue
      );

      fieldInfoDetails.push(fieldInfo);

    }

  }

  return fieldInfoDetails;

}

function getLastSegmentFromPath(path: string): string {
  const segments = path.split('/');
  return segments[segments.length - 1];
}

