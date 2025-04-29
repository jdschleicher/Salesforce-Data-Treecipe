// List of sObject types to delete all records from
List<String> sObjectsToDelete = new List<String>{
    'Account',
    'Contact',
    'Case',
    'Opportunity',
    'Example_Everything__c',
    'Product2',
    'Pricebook2',
    'Lead'
};

for (String objectName : sObjectsToDelete) {
    try {
        // Dynamically build the SOQL query
        String query = 'SELECT Id FROM ' + objectName;
        List<SObject> records = Database.query(query);

        if (!records.isEmpty()) {
            System.debug('Deleting ' + records.size() + ' records from ' + objectName);
            List<Database.DeleteResult> deleteResults = Database.delete(records, false);

            for (Integer i = 0; i < deleteResults.size(); i++) {
                if (!deleteResults[i].isSuccess()) {
                    for (Database.Error err : deleteResults[i].getErrors()) {
                        System.debug('Failed to delete ' + objectName + ' record: ' + records[i].Id + '. Error: ' + err.getMessage());
                    }
                }
            }
        } else {
            System.debug('No records found for ' + objectName);
        }

    } catch (Exception e) {
        System.debug('Error processing ' + objectName + ': ' + e.getMessage());
    }
}
