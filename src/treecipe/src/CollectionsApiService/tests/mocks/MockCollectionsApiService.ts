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

    static getFakeTreecipeObjectInfoWrapperJson() {

        const fakeTreecipeObjectInfoWrapperJson = `
{
    "propertyone": "fakevalue"
}
`;

        return fakeTreecipeObjectInfoWrapperJson;

    }

    static getMockedSalesforceCoreConnection() {

        const mockSobjectInsertResults: any[] = [
            { id: "001ABC000123XYZ", success: true, errors: [] },
            { id: "001ABC000456DEF", success: true, errors: [] }
          ];
          
        const mockedConnection = {
            query: jest.fn(),
            // sobject: jest.fn().mockReturnValue({
            //     insert: jest.fn().mockReturnValue({
            //         mockResolvedValue: jest.fn()
            //     })
            // })
            // sobject: jest.fn( (fakeObject) => {
            //     return {
            //         insert: jest.fn( (fakeRecordDetails:any, fakeCallProperties:any) => {
            //             return {
            //                 catch: jest.fn( (fakeError) => {

            //                 })
            //             };
            //         })
            //     };
            // })
            // sobject: jest.fn().mockImplementation(() => ({
            //     insert: jest.fn().mockResolvedValue(mockSobjectInsertResults) // Ensure proper return type
            // }))
            sobject: jest.fn()
 
        } as unknown as jest.Mocked<Connection>;

        return mockedConnection;

    }

    static getSimpleCoreConnectionMock():Connection {
        
        const fakeConnection:any = {
            instanceUrl: "https://fake-instance.salesforce.com",
            accessToken: "00DFAKEACCESS123TOKEN",
            userId: "005FAKEUSERID",
            orgId: "00DFAKEORGID",
            apiVersion: "59.0"
        };

        return fakeConnection;

    }

    static getFakeCollectionApiDetail() {

        const salesforceCollection = {
            
            records: [
              {
                attributes: { type: "Account", referenceId: "ref1" },
                Name: "Example Account 1",
                Industry: "Technology",
                AnnualRevenue: 5000000
              },
              {
                attributes: { type: "Account", referenceId: "ref2" },
                Name: "Example Account 2",
                Industry: "Finance",
                AnnualRevenue: 10000000
              },
              {
                attributes: { type: "Account", referenceId: "ref3" },
                Name: "Example Account 3",
                Industry: "Healthcare",
                AnnualRevenue: 7500000
              }
            ]
          };

          return salesforceCollection;
    }



}