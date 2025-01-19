import { Connection } from '@salesforce/core';
import { AuthInfo } from '@salesforce/core';

async function makeCollectionsCall(orgAlias: string) {

    // console.log('Org Alias:', orgAlias);

    try {
        // Get the AuthInfo instance for the specified org alias
        const authInfo = await AuthInfo.create({ username: orgAlias });

        // { alias: 'my-dev-org' }
        
        // Create connection using the auth info
        const connection = await Connection.create({ authInfo });
        
        const test = connection.getAuthInfo();
        console.log(test);

            // Describe an SObject (e.g., Account)
        const sObjectDescribe = await connection.describe('Account');
        
        console.log('SObject Describe:', JSON.stringify(sObjectDescribe, null, 2));
    
    } catch (error) {
        console.error('Error making Collections API call:', error);
        throw error;
    }
}

// Execute the function with a specific org alias
makeCollectionsCall('jdschleicher@playful-bear-ksyrun.com')
    .then(results => {
        // Handle successful response
    })
    .catch(error => {
        // Handle any errors
        console.log(error);
    });