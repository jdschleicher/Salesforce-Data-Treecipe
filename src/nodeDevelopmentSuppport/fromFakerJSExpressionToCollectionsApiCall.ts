import { FakerJSRecipeProcessor } from "../treecipe/src/FakerRecipeProcessor/FakerJSRecipeProcessor/FakerJSRecipeProcessor";
import { RecipeMockService } from "../treecipe/src/RecipeService/tests/mocks/RecipeMockService";
import { Org } from '@salesforce/core';


import * as fs from 'fs';
const orgAlias = 'lwc-test';

interface TestCollectionsApiJsonStructure {
    allOrNone: boolean;
    records: any[];
}

function getSObjectName(filePath: string): string | null {
    const regex = /collectionsApi-(.*?)\.json/;
    const match = filePath.match(regex);
    
    if (match && match[1]) {
        return match[1];
    }
    
    return null; 
}


async function makeCollectionsCall(orgAlias: string, collectionsApiFile: string) {


    try {

        const org = await Org.create({ aliasOrUsername: orgAlias });
        const connection = org.getConnection();

        // // for quick troubleshooting
        // const metadata = await connection.sobject('Example_Everything__c').describe();
        // console.log('Account Object Description:', metadata.label); 

        const objectName = getSObjectName(collectionsApiFile);
        if (!objectName) {
            throw new Error('Could not determine the SObject name from the file path');
        }

        // Read the file synchronously
        const rawData = fs.readFileSync(collectionsApiFile, 'utf-8');
        // Parse the JSON data and assign it to a variable
        const jsonData = JSON.parse(rawData);
        console.log(jsonData);

        const result = await connection.sobject(objectName).create(
                                                            jsonData.records,
                                                            { allOrNone: true }
                                                        );
        console.log('processed: ' + result.length);
        console.log('create Describe:', JSON.stringify(result, null, 2));
    
    } catch (error) {
        console.error('Error making Collections API call:', error);
        throw error;
    }
}

async function processFakerJSExpressionToCollectionsApiCall() {

    const mockYamlContent = RecipeMockService.getFakerJSExpectedEvertyingExampleFullObjectRecipeMarkup();
    const fakeTestFile = 'src/nodeDevelopmentSupport/tests/test.yaml';                        

    fs.writeFileSync(fakeTestFile, mockYamlContent, 'utf8'); // Write the YAML file
    const fakerJSRecipeProcessor = new FakerJSRecipeProcessor();
     
    const fakerJsonResult = await fakerJSRecipeProcessor.generateFakeDataBySelectedRecipeFile(fakeTestFile);
      
    const transformed: Map<string, TestCollectionsApiJsonStructure>  = fakerJSRecipeProcessor.transformFakerJsonDataToCollectionApiFormattedFilesBySObject(fakerJsonResult);

    transformed.forEach((collectionsApiContent, sobjectApiName) => {

        const pathFileName = createCollectionsApiFile(
            sobjectApiName, 
            collectionsApiContent, 
            'src/nodeDevelopmentSuppport/tests/TestFullPathToStoreDatasetFiles'
        );


        // Execute the function with a specific org alias
        makeCollectionsCall(orgAlias, pathFileName)
            .then(results => {
                console.log('test');
                // Handle successful response
            })
            .catch(error => {
                // Handle any errors
                console.log(error);
        });
        
    });
    
}

function createCollectionsApiFile(objectApiName: string, collectionsApiFormattedRecords: any, uniqueTimeStampedFakeDataSetsFolderName: string ) {

        const expectedCollectionsApiOutputFile = buildCollectionsApiFileNameBySobjectName(objectApiName);
        const fullCollectionsApiFilePath = `${uniqueTimeStampedFakeDataSetsFolderName}/${expectedCollectionsApiOutputFile}`;

        const jsonStringFormattedRecords = JSON.stringify(collectionsApiFormattedRecords, null, 2);

        fs.writeFile(fullCollectionsApiFilePath, jsonStringFormattedRecords, error => {
            
            if (error) {
                throw new Error(`Error occurred in Collections Api file creation: ${error.message}`);
            } 

        });

        return fullCollectionsApiFilePath;

    }

function buildCollectionsApiFileNameBySobjectName(sobjectApiName: string):string {

        const collectionsApiFileName = `collectionsApi-${sobjectApiName}.json`;
        return collectionsApiFileName;

    }


processFakerJSExpressionToCollectionsApiCall();
