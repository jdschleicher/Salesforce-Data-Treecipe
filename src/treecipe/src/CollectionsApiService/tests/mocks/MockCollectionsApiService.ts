import { Connection } from "@salesforce/core";

export class MockCollectionsApiService {


    static getMockedCollectionApiSuccessfulResults() {
        return [
            { id: "001ABC123", success: true },
            { id: "002XYZ456", success: true },
            { id: "003DEF789", success: true },
        ];
    }
      
    static getFailedMockCollectionApiResults() {
        return [
            { id: "004GHI321", success: false, errors: ["Required field missing"] },
            { id: "005JKL654", success: false, errors: ["Invalid field value"] },
        ];
    }
      
      static getMockCombinedSuccessAndFailureCollectionResults() {
        
        const successfulRecords = this.getMockedCollectionApiSuccessfulResults();
        const failedMockedrecords = this.getFailedMockCollectionApiResults();
        return [
            ...successfulRecords, 
            ...failedMockedrecords
        ];
     
    }

    static getFakeSalesforceCoreConnection():Connection {
        
        const fakeConnection:any = {
            instanceUrl: "https://fake-instance.salesforce.com",
            accessToken: "00DFAKEACCESS123TOKEN",
            userId: "005FAKEUSERID",
            orgId: "00DFAKEORGID",
            apiVersion: "59.0"
        };

        return fakeConnection;
    }


}