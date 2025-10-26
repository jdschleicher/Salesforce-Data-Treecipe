
export class MockRelationshipService {

    static getExpectTreeStructures() {
    
        let allTrees = [];

        const expectedAccountThruProductFamilyTreeObjects = this.getAccountThruProductFamilyTreeObjects(); 
        allTrees.push(expectedAccountThruProductFamilyTreeObjects);

        let caseTreeObjects = [
            'Case',
            'Vehicle__c'
        ];
        allTrees.push(caseTreeObjects);

        let leadTreeObjects = [
            'Lead'
        ];
        allTrees.push(leadTreeObjects);

        let pricebook2Objects = [
            'Pricebook2'
        ];
        allTrees.push(pricebook2Objects);

        let manufacturingTree = [
            'Manufacturing_Event__e'
        ];
        allTrees.push(manufacturingTree);
    
        let productObjects = [
            'Product2'
        ];
        allTrees.push(productObjects);

        return allTrees;

    }

    static getAccountThruProductFamilyTreeObjects() {
        
        return [
            'Account', 
            'Contact',
            'User',
            'Opportunity',
            'MegaMapMadness__c',
            'Order__c',
            'Order_Item__c',
            'Example_Everything__c',
            'Product_Family__c',
            'Product__c'
        ];

    }





}
