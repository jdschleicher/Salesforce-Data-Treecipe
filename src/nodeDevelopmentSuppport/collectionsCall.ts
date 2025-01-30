import { Org } from '@salesforce/core';
import * as fs from 'fs';

// import { SfCommand, Flags } from '@salesforce/sf-plugins-core';

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

function getSObjectName(filePath: string): string | null {
    const regex = /collectionsApi-(.*?)\.json/;
    const match = filePath.match(regex);
    
    if (match && match[1]) {
        return match[1];
    }
    
    return null; 
}


const orgAlias = 'trail-dev';
const collectionsApiFile = "treecipe/FakeDataSets/dataset-2025-01-20T20-22-47/collectionsApi-Account.json";

// Execute the function with a specific org alias
makeCollectionsCall(orgAlias, collectionsApiFile)
.then(results => {
    // Handle successful response
})
.catch(error => {
    // Handle any errors
    console.log(error);
});