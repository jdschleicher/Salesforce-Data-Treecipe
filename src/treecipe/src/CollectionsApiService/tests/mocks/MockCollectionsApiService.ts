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

        const mockedConnection = {
            query: jest.fn(),
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

    static getMockedInsertAttemptFileJsonContent() {

        const insertAttemptJsonContent = `
        {
  "SuccessResults": {
    "Account": [
      {
        "id": "001DK000017d3k5YAA",
        "success": true,
        "errors": [],
        "orgRecordLink": "https://platform-dream-4197-dev-ed.scratch.my.salesforce.com/001DK000017d3k5YAA"
      }
    ]
  },
  "FailureResults": {
    "Example_Everything__c": [
      {
        "success": false,
        "errors": [
          {
            "statusCode": "ALL_OR_NONE_OPERATION_ROLLED_BACK",
            "message": "Record rolled back because not all records were valid and the request was using AllOrNone header",
            "fields": []
          }
        ]
      },
      {
        "success": false,
        "errors": [
          {
            "statusCode": "ALL_OR_NONE_OPERATION_ROLLED_BACK",
            "message": "Record rolled back because not all records were valid and the request was using AllOrNone header",
            "fields": []
          }
        ]
      },
      {
        "success": false,
        "errors": [
          {
            "statusCode": "ALL_OR_NONE_OPERATION_ROLLED_BACK",
            "message": "Record rolled back because not all records were valid and the request was using AllOrNone header",
            "fields": []
          }
        ]
      },
      {
        "success": false,
        "errors": [
          {
            "statusCode": "ALL_OR_NONE_OPERATION_ROLLED_BACK",
            "message": "Record rolled back because not all records were valid and the request was using AllOrNone header",
            "fields": []
          }
        ]
      },
      {
        "success": false,
        "errors": [
          {
            "statusCode": "ALL_OR_NONE_OPERATION_ROLLED_BACK",
            "message": "Record rolled back because not all records were valid and the request was using AllOrNone header",
            "fields": []
          }
        ]
      },
      {
        "success": false,
        "errors": [
          {
            "statusCode": "INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST",
            "message": "Picklist: bad value for restricted picklist field: whooooofailllll",
            "fields": [
              "Picklist__c"
            ]
          }
        ]
      },
      {
        "success": false,
        "errors": [
          {
            "statusCode": "ALL_OR_NONE_OPERATION_ROLLED_BACK",
            "message": "Record rolled back because not all records were valid and the request was using AllOrNone header",
            "fields": []
          }
        ]
      },
      {
        "success": false,
        "errors": [
          {
            "statusCode": "ALL_OR_NONE_OPERATION_ROLLED_BACK",
            "message": "Record rolled back because not all records were valid and the request was using AllOrNone header",
            "fields": []
          }
        ]
      },
      {
        "success": false,
        "errors": [
          {
            "statusCode": "ALL_OR_NONE_OPERATION_ROLLED_BACK",
            "message": "Record rolled back because not all records were valid and the request was using AllOrNone header",
            "fields": []
          }
        ]
      },
      {
        "success": false,
        "errors": [
          {
            "statusCode": "ALL_OR_NONE_OPERATION_ROLLED_BACK",
            "message": "Record rolled back because not all records were valid and the request was using AllOrNone header",
            "fields": []
          }
        ]
      },
      {
        "success": false,
        "errors": [
          {
            "statusCode": "ALL_OR_NONE_OPERATION_ROLLED_BACK",
            "message": "Record rolled back because not all records were valid and the request was using AllOrNone header",
            "fields": []
          }
        ]
      },
      {
        "success": false,
        "errors": [
          {
            "statusCode": "ALL_OR_NONE_OPERATION_ROLLED_BACK",
            "message": "Record rolled back because not all records were valid and the request was using AllOrNone header",
            "fields": []
          }
        ]
      },
      {
        "success": false,
        "errors": [
          {
            "statusCode": "ALL_OR_NONE_OPERATION_ROLLED_BACK",
            "message": "Record rolled back because not all records were valid and the request was using AllOrNone header",
            "fields": []
          }
        ]
      },
      {
        "success": false,
        "errors": [
          {
            "statusCode": "ALL_OR_NONE_OPERATION_ROLLED_BACK",
            "message": "Record rolled back because not all records were valid and the request was using AllOrNone header",
            "fields": []
          }
        ]
      },
      {
        "success": false,
        "errors": [
          {
            "statusCode": "ALL_OR_NONE_OPERATION_ROLLED_BACK",
            "message": "Record rolled back because not all records were valid and the request was using AllOrNone header",
            "fields": []
          }
        ]
      },
      {
        "success": false,
        "errors": [
          {
            "statusCode": "ALL_OR_NONE_OPERATION_ROLLED_BACK",
            "message": "Record rolled back because not all records were valid and the request was using AllOrNone header",
            "fields": []
          }
        ]
      },
      {
        "success": false,
        "errors": [
          {
            "statusCode": "ALL_OR_NONE_OPERATION_ROLLED_BACK",
            "message": "Record rolled back because not all records were valid and the request was using AllOrNone header",
            "fields": []
          }
        ]
      },
      {
        "success": false,
        "errors": [
          {
            "statusCode": "ALL_OR_NONE_OPERATION_ROLLED_BACK",
            "message": "Record rolled back because not all records were valid and the request was using AllOrNone header",
            "fields": []
          }
        ]
      },
      {
        "success": false,
        "errors": [
          {
            "statusCode": "ALL_OR_NONE_OPERATION_ROLLED_BACK",
            "message": "Record rolled back because not all records were valid and the request was using AllOrNone header",
            "fields": []
          }
        ]
      },
      {
        "success": false,
        "errors": [
          {
            "statusCode": "ALL_OR_NONE_OPERATION_ROLLED_BACK",
            "message": "Record rolled back because not all records were valid and the request was using AllOrNone header",
            "fields": []
          }
        ]
      },
      {
        "success": false,
        "errors": [
          {
            "statusCode": "ALL_OR_NONE_OPERATION_ROLLED_BACK",
            "message": "Record rolled back because not all records were valid and the request was using AllOrNone header",
            "fields": []
          }
        ]
      },
      {
        "success": false,
        "errors": [
          {
            "statusCode": "ALL_OR_NONE_OPERATION_ROLLED_BACK",
            "message": "Record rolled back because not all records were valid and the request was using AllOrNone header",
            "fields": []
          }
        ]
      },
      {
        "success": false,
        "errors": [
          {
            "statusCode": "ALL_OR_NONE_OPERATION_ROLLED_BACK",
            "message": "Record rolled back because not all records were valid and the request was using AllOrNone header",
            "fields": []
          }
        ]
      },
      {
        "success": false,
        "errors": [
          {
            "statusCode": "ALL_OR_NONE_OPERATION_ROLLED_BACK",
            "message": "Record rolled back because not all records were valid and the request was using AllOrNone header",
            "fields": []
          }
        ]
      },
      {
        "success": false,
        "errors": [
          {
            "statusCode": "ALL_OR_NONE_OPERATION_ROLLED_BACK",
            "message": "Record rolled back because not all records were valid and the request was using AllOrNone header",
            "fields": []
          }
        ]
      }
    ]
  }
}
        
        `;

        return insertAttemptJsonContent;
    }



}