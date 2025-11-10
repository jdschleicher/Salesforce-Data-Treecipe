import { ConfigurationService } from '../../ConfigurationService/ConfigurationService';
import { DirectoryProcessor } from '../../DirectoryProcessingService/DirectoryProcessor';
import { FakerJSRecipeFakerService } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { MockRelationshipService } from './mocks/MockRelationshipService';

import { RelationshipDetail, RelationshipService, RelationshipTree } from '../RelationshipService';
import { ObjectInfo } from '../../ObjectInfoWrapper/ObjectInfo';

import * as fs from 'fs';
import * as path from 'path';

import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as vscode from 'vscode';
import { ObjectInfoWrapper } from '../../ObjectInfoWrapper/ObjectInfoWrapper';

jest.mock('vscode', () => ({
    Uri: {
        file: (p: string) => ({ fsPath: p, path: p }),
        joinPath: (uri: { fsPath: string; path: string }, ...pathSegments: string[]) => {
            const joined = path.join(uri.fsPath, ...pathSegments);
            return { 
                fsPath: joined, 
                path: joined 
            };
        },
        parse: (value: string) => {
            const filePath = value.replace(/^file:\/\//, '');
            return { fsPath: filePath, path: filePath };
        }
    },
    FileType: {
        Unknown: 0,
        File: 1,
        Directory: 2,
        SymbolicLink: 64
    },
    workspace: {
        fs: {
            readDirectory: async (uri: { fsPath: string }) => {
                const entries = await fs.promises.readdir(uri.fsPath, { withFileTypes: true });
                return entries.map(entry => [
                    entry.name,
                    entry.isDirectory() ? 2 : 1 // 2 = Directory, 1 = File
                ]);
            },
            readFile: async (uri: { fsPath: string }) => {
                const buffer = await fs.promises.readFile(uri.fsPath);
                return new Uint8Array(buffer);
            }
        }
    },
    window: {
        showWarningMessage: jest.fn()
    }
}), { virtual: true });


// uncomment below when using copy/paste functionality
// import * as ncp from 'copy-paste';
// import { promisify } from 'util';
// const copy = promisify(ncp.copy);

function haseSameSalesforceTreeBase(treeIdXX: string, treeIdYY: string): boolean {
   
    const regex = /^tree_([A-Za-z0-9_]+__c|[A-Za-z0-9_]+)_\d+$/;
    const matchXX = treeIdXX.match(regex);
    const matchYY = treeIdYY.match(regex);
    return !!matchXX && !!matchYY && matchXX[1] === matchYY[1];

}


describe("Shared Relationship Service Tests", () => {

    let directoryProcessor = null;
    let actualObjectInfoWrapperCreated = null;

    describe("processAllObjectsAndRelationships", () => {

        beforeAll(async() => {

            jest.spyOn(ConfigurationService, 'getFakerImplementationByExtensionConfigSelection')
                .mockImplementation(() => new FakerJSRecipeFakerService());

            directoryProcessor = new DirectoryProcessor();

            const dedicatedTestPathToProcessForActualResult = "src/treecipe/src/DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory/objects";
            const directoryPathUri = vscode.Uri.file(dedicatedTestPathToProcessForActualResult);

            actualObjectInfoWrapperCreated = await directoryProcessor.processAllObjectsAndRelationships(directoryPathUri);

        });

        test("given expected mock test directory with expected relationships, object and field directories are parses as expected and expected Relationship Trees are built", async() => {
        
            const expectedRelationshipTreesJson = MockRelationshipService.getExpectedRelationshipTreesJson();
            const expectedRelationshipTrees:RelationshipTree[] = JSON.parse(expectedRelationshipTreesJson);

            const actualRelationshipTrees:RelationshipTree[] = actualObjectInfoWrapperCreated.RelationshipTrees;
                
            expect(expectedRelationshipTrees.length).toBe(actualRelationshipTrees.length);
            
            actualRelationshipTrees.forEach(actualTree => {
                
                const matchingExpectedRelationshipTree:RelationshipTree = expectedRelationshipTrees.find(
                    expectedTree => haseSameSalesforceTreeBase(actualTree.treeId, expectedTree.treeId)
                );

                // IF THERE IS NO MATCH IN THE EXPECTED TREE IDS THEN FAIL THAT TREE
                expect(matchingExpectedRelationshipTree).toBeDefined();
                console.log(matchingExpectedRelationshipTree.allObjects);
                console.log(actualTree.allObjects);

                actualTree.topLevelObjects.forEach((actualTopLevelObject, index) => {
        
                    const matchingTtopLevelObject = matchingExpectedRelationshipTree.topLevelObjects[index];
                    expect(actualTopLevelObject).toBe(matchingTtopLevelObject);

                });

                expect(actualTree.allObjects.length).toBe(matchingExpectedRelationshipTree.allObjects.length);
                expect(actualTree.allObjects).toIncludeAllMembers(matchingExpectedRelationshipTree.allObjects);

            }); 


        });

        test("given expected hiearchy levels of expected related objects, the actual processing of an expected objects directory creates same hiearchy levels", () => {

            // const testJson = JSON.stringify(actualObjectInfoWrapperCreated.ObjectToObjectInfoMap);
            // await copy(testJson);

            const expectedObjectToObjectInfoMapJson = MockRelationshipService.getExpectedObjectToObjectInfoMap();
            const expectedObjectToObjectInfoMap:Record<string, ObjectInfo> = JSON.parse(expectedObjectToObjectInfoMapJson);
            
            const actualObjectToObjectInfoMap:Record<string, ObjectInfo> = actualObjectInfoWrapperCreated.ObjectToObjectInfoMap;

            Object.entries(expectedObjectToObjectInfoMap).forEach(([expectedObjectApiKey, expectedObjectInfoWrapper]) => {
            
                const iteratingActualObjectInfoWrapper = actualObjectToObjectInfoMap[expectedObjectApiKey];
                //If there is no wrapper defined then there is a mismatch between
                // what the directory generated and the expected mock structure
                expect(iteratingActualObjectInfoWrapper).toBeDefined();

                expect(iteratingActualObjectInfoWrapper.RelationshipDetail.level).toBe(expectedObjectInfoWrapper.RelationshipDetail.level);
                
                const actualChildObjectKeys = Object.keys(iteratingActualObjectInfoWrapper.RelationshipDetail.childObjectToFieldReferences);
                const expectedChildObjectKeys = Object.keys(expectedObjectInfoWrapper.RelationshipDetail.childObjectToFieldReferences);
                expect(actualChildObjectKeys).toIncludeAllMembers(expectedChildObjectKeys);

                const actualChildObjectValues = Object.values(iteratingActualObjectInfoWrapper.RelationshipDetail.childObjectToFieldReferences);
                const expectedChildObjectValues = Object.values(expectedObjectInfoWrapper.RelationshipDetail.childObjectToFieldReferences);
                expect(actualChildObjectValues).toIncludeAllMembers(expectedChildObjectValues);


                const actualParentObjectKeys = Object.keys(iteratingActualObjectInfoWrapper.RelationshipDetail.parentObjectToFieldReferences);
                const expectedParentObjectKeys = Object.keys(expectedObjectInfoWrapper.RelationshipDetail.parentObjectToFieldReferences);
                expect(actualParentObjectKeys).toIncludeAllMembers(expectedParentObjectKeys);

                const actualParentObjectvalues = Object.values(iteratingActualObjectInfoWrapper.RelationshipDetail.parentObjectToFieldReferences);
                const expectedParentObjectvalues = Object.values(expectedObjectInfoWrapper.RelationshipDetail.parentObjectToFieldReferences);
                expect(actualParentObjectvalues).toIncludeAllMembers(expectedParentObjectvalues);

            });

    

            // actualRelationshipTrees.forEach(actualTree => {
                
            //     // const matchingExpectedRelationshipTree:RelationshipTree = expectedRelationshipTrees.find(
            //     //     expectedTree => haseSameSalesforceTreeBase(actualTree.treeId, expectedTree.treeId)
            //     // );

            //     // IF THERE IS NO MATCH IN THE EXPECTED TREE IDS THEN FAIL THAT TREE
            //     expect(matchingExpectedRelationshipTree).toBeDefined();
            //     console.log(matchingExpectedRelationshipTree.allObjects);
            //     console.log(actualTree.allObjects);

            //     actualTree.topLevelObjects.forEach((actualTopLevelObject, index) => {
            //         // console.log(index); // 0, 1, 2
            //         // console.log(topLevelObject); // 9, 2, 5

            //         const matchingTtopLevelObject = matchingExpectedRelationshipTree.topLevelObjects[index];
            //         expect(actualTopLevelObject).toBe(matchingTtopLevelObject);

            //     });

            //     expect(actualTree.allObjects.length).toBe(matchingExpectedRelationshipTree.allObjects.length);
            //     expect(actualTree.allObjects).toIncludeAllMembers(matchingExpectedRelationshipTree.allObjects);

            // }); 
            
            // ( const actualTree in actualRelationshipTrees:RelationshipTree[] ) {

                // console.log(`${actualTree} → ${match ? "Matched: " + match : "No Match"}`);

            // }
            // const expectedTreeStructuresForExpectedDirectoryStructure = MockRelationshipService.getExpectTreeStructures();
            

            // const treeAccountExpectedPattern = "tree_Account";
            // const actualTreeAccountRelationshipTree = objectInfoWrapperCreated.RelationshipTrees.find( tree => tree.treeId.includes(treeAccountExpectedPattern));
            // const expectedAccountThruProductFamilyObjects =['Account', 'Contact', 'Example_Everything__c', 'Opportunity', 'Order__c', 'User', 'MasterDetailMadness__c', 'Order_Item__c', 'MegaMapMadness__c', 'Product__c', 'Product_Family__c'];
            // expect(expectedAccountThruProductFamilyObjects.length).toBe(actualTreeAccountRelationshipTree.allObjects.length);
    
            // await copy(expectedRelationshipTreesJson);


        });

    });



    describe("calculateLevelsRecursively", () => {

        test("given expected scenario, levels calculated as expected", () => {

        });

    });

    describe('BFS Relationship Tree - Building Foundation', () => {
        

        test('INPUT: Single isolated object → OUTPUT: Found 1 object at level 0', () => {
            // Given: One object with no relationships
           
            const expectedAccountRelationshipDetailWithNOChildOrParentReferencesJSON = `{
                "objectApiName": "Account",
                "level": -1,
                "parentObjectToFieldReferences": {},
                "childObjectToFieldReferences": {},
                "isProcessed": false,
                "relationshipTreeId": "tree_Account_1762091021883"
            }`;

            const expectedAccountRelationshipDetail:RelationshipDetail = JSON.parse(expectedAccountRelationshipDetailWithNOChildOrParentReferencesJSON);
            
            const mockFieldsJson = [
                {
                    "objectName": "Account",
                    "fieldName": "AccountSource",
                    "fieldLabel": "AccountSource",
                    "type": "Picklist",
                    "recipeValue": "${{ faker.helpers.arrayElement(['Web','Phone Inquiry','Partner Referral','Purchased List','Other']) }}"
                },
                {
                    "objectName": "Account",
                    "fieldName": "Active__c",
                    "fieldLabel": "Active",
                    "type": "Picklist",
                    "picklistValues": [
                        {
                            "picklistOptionApiName": "No",
                            "label": "No",
                            "default": false,
                            "isActive": true
                        },
                        {
                            "picklistOptionApiName": "Yes",
                            "label": "Yes",
                            "default": false,
                            "isActive": true
                        }
                    ],
                    "recipeValue": "${{ faker.helpers.arrayElement(['No','Yes']) }}"
                }
            ];

            const expectedObjectAccountApiName = 'Account';
            let expectedObjectInfoWrapper = new ObjectInfoWrapper();
            
            let expectedObjectInfo = new ObjectInfo(expectedObjectAccountApiName);
            expectedObjectInfo.RelationshipDetail = expectedAccountRelationshipDetail;
            expectedObjectInfo.Fields = mockFieldsJson;
            expectedObjectInfo.RecordTypesMap = {};
            expectedObjectInfo.FullRecipe = 'not Testing';

            let expectedObjectToObjectInfoMap:Record<string, ObjectInfo> = {};
            expectedObjectToObjectInfoMap[expectedObjectAccountApiName] = expectedObjectInfo;
            expectedObjectInfoWrapper.ObjectToObjectInfoMap = expectedObjectToObjectInfoMap;

            // When: Start BFS from 'Account'
            let expectedEmptyProcessedObjects = new Set<string>();
            const relationshipService = new RelationshipService();
            const actualResultTree = (relationshipService as any).buildSingleRelationshipTree(expectedObjectInfoWrapper, expectedObjectAccountApiName, expectedEmptyProcessedObjects);

            expect(actualResultTree.allObjects).toEqual(['Account']);
            expect(actualResultTree.topLevelObjects.length).toEqual(1);

            expect(actualResultTree.topLevelObjects[0]).toEqual(expectedObjectAccountApiName);
            expect(actualResultTree.maxLevel).toBe(0);

        });

        test('INPUT: A→B chain, start at A → OUTPUT: Found [A, B] with A at level 0, B at level 1', () => {
            // Given: Account has a child Contact
            let objectInfoWrapper = new ObjectInfoWrapper();
            
            // Setup Account object
            let accountObjectInfo = new ObjectInfo('Account');
            accountObjectInfo.RelationshipDetail = {
                objectApiName: 'Account',
                level: -1,
                parentObjectToFieldReferences: {},
                childObjectToFieldReferences: { 'Contact': ['AccountId'] },
                isProcessed: false
            };
            objectInfoWrapper.ObjectToObjectInfoMap['Account'] = accountObjectInfo;
            
            // Setup Contact object
            let contactObjectInfo = new ObjectInfo('Contact');
            contactObjectInfo.RelationshipDetail = {
                objectApiName: 'Contact',
                level: -1,
                parentObjectToFieldReferences: { 'Account': ['AccountId'] },
                childObjectToFieldReferences: {},
                isProcessed: false
            };
            objectInfoWrapper.ObjectToObjectInfoMap['Contact'] = contactObjectInfo;

            // When: Start BFS from 'Account'
            const relationshipService = new RelationshipService();
            const processedObjects = new Set<string>();
            const result = (relationshipService as any).buildSingleRelationshipTree(objectInfoWrapper, 'Account', processedObjects);

            // Then: Find both objects
            expect(result.allObjects).toHaveLength(2);
            expect(result.allObjects).toContain('Account');
            expect(result.allObjects).toContain('Contact');
            
            // Account is top level
            expect(result.topLevelObjects).toEqual(['Account']);
            
            // Contact is one level below Account
            expect(result.maxLevel).toBe(1);
            expect(objectInfoWrapper.ObjectToObjectInfoMap['Account'].RelationshipDetail.level).toBe(0);
            expect(objectInfoWrapper.ObjectToObjectInfoMap['Contact'].RelationshipDetail.level).toBe(1);
        });

        test('INPUT: A→B→C chain, start at A → OUTPUT: Found [A, B, C] at levels 0, 1, 2', () => {
            // Given: Account → Contact → Opportunity
            let objectInfoWrapper = new ObjectInfoWrapper();
            
            // Setup Account object
            let accountObjectInfo = new ObjectInfo('Account');
            accountObjectInfo.RelationshipDetail = {
                objectApiName: 'Account',
                level: -1,
                parentObjectToFieldReferences: {},
                childObjectToFieldReferences: { 'Contact': ['AccountId'] },
                isProcessed: false
            };
            objectInfoWrapper.ObjectToObjectInfoMap['Account'] = accountObjectInfo;
            
            // Setup Contact object
            let contactObjectInfo = new ObjectInfo('Contact');
            contactObjectInfo.RelationshipDetail = {
                objectApiName: 'Contact',
                level: -1,
                parentObjectToFieldReferences: { 'Account': ['AccountId'] },
                childObjectToFieldReferences: { 'Opportunity': ['ContactId'] },
                isProcessed: false
            };
            objectInfoWrapper.ObjectToObjectInfoMap['Contact'] = contactObjectInfo;
            
            // Setup Opportunity object
            let opportunityObjectInfo = new ObjectInfo('Opportunity');
            opportunityObjectInfo.RelationshipDetail = {
                objectApiName: 'Opportunity',
                level: -1,
                parentObjectToFieldReferences: { 'Contact': ['ContactId'] },
                childObjectToFieldReferences: {},
                isProcessed: false
            };
            objectInfoWrapper.ObjectToObjectInfoMap['Opportunity'] = opportunityObjectInfo;

            // When: Start BFS from 'Account'
            const relationshipService = new RelationshipService();
            const processedObjects = new Set<string>();
            const result = (relationshipService as any).buildSingleRelationshipTree(objectInfoWrapper, 'Account', processedObjects);

            // Then: Find all three objects
            expect(result.allObjects).toHaveLength(3);
            expect(result.topLevelObjects).toEqual(['Account']);
            expect(result.maxLevel).toBe(2);
            
            // Each object is one level deeper
            expect(objectInfoWrapper.ObjectToObjectInfoMap['Account'].RelationshipDetail.level).toBe(0);
            expect(objectInfoWrapper.ObjectToObjectInfoMap['Contact'].RelationshipDetail.level).toBe(1);
            expect(objectInfoWrapper.ObjectToObjectInfoMap['Opportunity'].RelationshipDetail.level).toBe(2);
        });

        test('INPUT: A with two children B and C, start at A → OUTPUT: Found [A, B, C] with B and C both at level 1', () => {
            // Given: Account has two children: Contact and Opportunity
            let objectInfoWrapper = new ObjectInfoWrapper();
            
            // Setup Account object
            let accountObjectInfo = new ObjectInfo('Account');
            accountObjectInfo.RelationshipDetail = {
                objectApiName: 'Account',
                level: -1,
                parentObjectToFieldReferences: {},
                childObjectToFieldReferences: { 
                    'Contact': ['AccountId'],
                    'Opportunity': ['AccountId']
                },
                isProcessed: false
            };
            objectInfoWrapper.ObjectToObjectInfoMap['Account'] = accountObjectInfo;
            
            // Setup Contact object
            let contactObjectInfo = new ObjectInfo('Contact');
            contactObjectInfo.RelationshipDetail = {
                objectApiName: 'Contact',
                level: -1,
                parentObjectToFieldReferences: { 'Account': ['AccountId'] },
                childObjectToFieldReferences: {},
                isProcessed: false
            };
            objectInfoWrapper.ObjectToObjectInfoMap['Contact'] = contactObjectInfo;
            
            // Setup Opportunity object
            let opportunityObjectInfo = new ObjectInfo('Opportunity');
            opportunityObjectInfo.RelationshipDetail = {
                objectApiName: 'Opportunity',
                level: -1,
                parentObjectToFieldReferences: { 'Account': ['AccountId'] },
                childObjectToFieldReferences: {},
                isProcessed: false
            };
            objectInfoWrapper.ObjectToObjectInfoMap['Opportunity'] = opportunityObjectInfo;

            // When: Start BFS from 'Account'
            const relationshipService = new RelationshipService();
            const processedObjects = new Set<string>();
            const result = (relationshipService as any).buildSingleRelationshipTree(objectInfoWrapper, 'Account', processedObjects);

            // Then: Find all three objects
            expect(result.allObjects).toHaveLength(3);
            expect(result.topLevelObjects).toEqual(['Account']);
            expect(result.maxLevel).toBe(1);
            
            // Both children are at the same level (this is BFS!)
            expect(objectInfoWrapper.ObjectToObjectInfoMap['Account'].RelationshipDetail.level).toBe(0);
            expect(objectInfoWrapper.ObjectToObjectInfoMap['Contact'].RelationshipDetail.level).toBe(1);
            expect(objectInfoWrapper.ObjectToObjectInfoMap['Opportunity'].RelationshipDetail.level).toBe(1);
        });

        test('Complex User→MegaMapMadness→MasterDetailMadness scenario', () => {
            // Given: User is parent to MegaMapMadness which is parent to MasterDetailMadness
            let objectInfoWrapper = new ObjectInfoWrapper();
            
            // Setup User object (top level parent)
            let userObjectInfo = new ObjectInfo('User');
            userObjectInfo.RelationshipDetail = {
                objectApiName: 'User',
                level: -1,
                parentObjectToFieldReferences: {},
                childObjectToFieldReferences: { 
                    'MegaMapMadness__c': ['LUOne_User__c', 'LUTwo_User__c']
                },
                isProcessed: false
            };
            objectInfoWrapper.ObjectToObjectInfoMap['User'] = userObjectInfo;
            
            // Setup MegaMapMadness object (middle level)
            let megaMapMadnessObjectInfo = new ObjectInfo('MegaMapMadness__c');
            megaMapMadnessObjectInfo.RelationshipDetail = {
                objectApiName: 'MegaMapMadness__c',
                level: -1,
                parentObjectToFieldReferences: { 
                    'User': ['LUOne_User__c', 'LUTwo_User__c'] 
                },
                childObjectToFieldReferences: {
                    'MasterDetailMadness__c': ['MD_MegaMapMadness__c']
                },
                isProcessed: false
            };
            objectInfoWrapper.ObjectToObjectInfoMap['MegaMapMadness__c'] = megaMapMadnessObjectInfo;
            
            // Setup MasterDetailMadness object (child level)
            let masterDetailMadnessObjectInfo = new ObjectInfo('MasterDetailMadness__c');
            masterDetailMadnessObjectInfo.RelationshipDetail = {
                objectApiName: 'MasterDetailMadness__c',
                level: -1,
                parentObjectToFieldReferences: { 
                    'MegaMapMadness__c': ['MD_MegaMapMadness__c'],
                    'Contact': ['LU_Contact__c']
                },
                childObjectToFieldReferences: {},
                isProcessed: false
            };
            objectInfoWrapper.ObjectToObjectInfoMap['MasterDetailMadness__c'] = masterDetailMadnessObjectInfo;
            
            // Setup Contact object (referenced by MasterDetailMadness - for this test, Contact is a top-level object)
            let contactObjectInfo = new ObjectInfo('Contact');
            contactObjectInfo.RelationshipDetail = {
                objectApiName: 'Contact',
                level: -1,
                parentObjectToFieldReferences: {}, // No parents in this tree structure
                childObjectToFieldReferences: {
                    'MasterDetailMadness__c': ['LU_Contact__c']
                },
                isProcessed: false
            };
            objectInfoWrapper.ObjectToObjectInfoMap['Contact'] = contactObjectInfo;

            // When: Start BFS from 'User'
            const relationshipService = new RelationshipService();
            const processedObjects = new Set<string>();
            const result = (relationshipService as any).buildSingleRelationshipTree(objectInfoWrapper, 'User', processedObjects);

            // Then: Find all objects connected to the tree
            expect(result.allObjects).toHaveLength(4);
            expect(result.allObjects).toContain('User');
            expect(result.allObjects).toContain('MegaMapMadness__c');
            expect(result.allObjects).toContain('MasterDetailMadness__c');
            expect(result.allObjects).toContain('Contact');
            
            // Both User and Contact are top level (no parents in this tree)
            expect(result.topLevelObjects).toContain('User');
            expect(result.topLevelObjects).toContain('Contact');
            expect(result.topLevelObjects).toHaveLength(2);
            
            // Verify correct hierarchy levels
            expect(result.maxLevel).toBe(2); // 3 levels: User(0) -> MegaMapMadness(1) -> MasterDetailMadness(2), and Contact(0) -> MasterDetailMadness(1)
            expect(objectInfoWrapper.ObjectToObjectInfoMap['User'].RelationshipDetail.level).toBe(0);
            expect(objectInfoWrapper.ObjectToObjectInfoMap['MegaMapMadness__c'].RelationshipDetail.level).toBe(1);
            expect(objectInfoWrapper.ObjectToObjectInfoMap['MasterDetailMadness__c'].RelationshipDetail.level).toBe(2);
            expect(objectInfoWrapper.ObjectToObjectInfoMap['Contact'].RelationshipDetail.level).toBe(0); // Contact is at level 0 as a top-level object
        });

        test('Complex Example_Everything__c scenario with self-reference', () => {
            // Given: Example_Everything__c which has a self-reference lookup
            let objectInfoWrapper = new ObjectInfoWrapper();
            
            // Setup Account object (parent)
            let accountObjectInfo = new ObjectInfo('Account');
            accountObjectInfo.RelationshipDetail = {
                objectApiName: 'Account',
                level: -1,
                parentObjectToFieldReferences: {},
                childObjectToFieldReferences: { 
                    'Example_Everything__c': ['AccountLookup__c']
                },
                isProcessed: false
            };
            objectInfoWrapper.ObjectToObjectInfoMap['Account'] = accountObjectInfo;
            
            // Setup Example_Everything__c object with self-reference
            let exampleEverythingObjectInfo = new ObjectInfo('Example_Everything__c');
            exampleEverythingObjectInfo.RelationshipDetail = {
                objectApiName: 'Example_Everything__c',
                level: -1,
                parentObjectToFieldReferences: { 
                    'Account': ['AccountLookup__c'],
                    'Example_Everything__c': ['Example_Everything_Lookup__c']
                },
                childObjectToFieldReferences: {
                    'Example_Everything__c': ['Example_Everything_Lookup__c']
                },
                isProcessed: false
            };
            objectInfoWrapper.ObjectToObjectInfoMap['Example_Everything__c'] = exampleEverythingObjectInfo;
            
            // When: Start BFS from 'Account'
            const relationshipService = new RelationshipService();
            const processedObjects = new Set<string>();
            const result = (relationshipService as any).buildSingleRelationshipTree(objectInfoWrapper, 'Account', processedObjects);

            // Then: Find both objects
            expect(result.allObjects).toHaveLength(2);
            expect(result.allObjects).toContain('Account');
            expect(result.allObjects).toContain('Example_Everything__c');
            
            // Account is top level
            expect(result.topLevelObjects).toEqual(['Account']);
            
            // Verify correct hierarchy levels
            expect(result.maxLevel).toBe(1);
            expect(objectInfoWrapper.ObjectToObjectInfoMap['Account'].RelationshipDetail.level).toBe(0);
            expect(objectInfoWrapper.ObjectToObjectInfoMap['Example_Everything__c'].RelationshipDetail.level).toBe(1);
        });
        
        test('Complex Product-Order-OrderItem hierarchy scenario', () => {
            // Given: Product_Family__c → Product__c → Order_Item__c ← Order__c ← Account
            let objectInfoWrapper = new ObjectInfoWrapper();
            
            // Setup Account object
            let accountObjectInfo = new ObjectInfo('Account');
            accountObjectInfo.RelationshipDetail = {
                objectApiName: 'Account',
                level: -1,
                parentObjectToFieldReferences: {},
                childObjectToFieldReferences: { 
                    'Order__c': ['Account__c']
                },
                isProcessed: false
            };
            objectInfoWrapper.ObjectToObjectInfoMap['Account'] = accountObjectInfo;
            
            // Setup Order__c object
            let orderObjectInfo = new ObjectInfo('Order__c');
            orderObjectInfo.RelationshipDetail = {
                objectApiName: 'Order__c',
                level: -1,
                parentObjectToFieldReferences: { 
                    'Account': ['Account__c']
                },
                childObjectToFieldReferences: {
                    'Order_Item__c': ['Order__c']
                },
                isProcessed: false
            };
            objectInfoWrapper.ObjectToObjectInfoMap['Order__c'] = orderObjectInfo;
            
            // Setup Order_Item__c object
            let orderItemObjectInfo = new ObjectInfo('Order_Item__c');
            orderItemObjectInfo.RelationshipDetail = {
                objectApiName: 'Order_Item__c',
                level: -1,
                parentObjectToFieldReferences: { 
                    'Order__c': ['Order__c'],
                    'Product__c': ['Product__c']
                },
                childObjectToFieldReferences: {},
                isProcessed: false
            };
            objectInfoWrapper.ObjectToObjectInfoMap['Order_Item__c'] = orderItemObjectInfo;
            
            // Setup Product__c object
            let productObjectInfo = new ObjectInfo('Product__c');
            productObjectInfo.RelationshipDetail = {
                objectApiName: 'Product__c',
                level: -1,
                parentObjectToFieldReferences: { 
                    'Product_Family__c': ['Product_Family__c']
                },
                childObjectToFieldReferences: {
                    'Order_Item__c': ['Product__c']
                },
                isProcessed: false
            };
            objectInfoWrapper.ObjectToObjectInfoMap['Product__c'] = productObjectInfo;
            
            // Setup Product_Family__c object
            let productFamilyObjectInfo = new ObjectInfo('Product_Family__c');
            productFamilyObjectInfo.RelationshipDetail = {
                objectApiName: 'Product_Family__c',
                level: -1,
                parentObjectToFieldReferences: {},
                childObjectToFieldReferences: {
                    'Product__c': ['Product_Family__c']
                },
                isProcessed: false
            };
            objectInfoWrapper.ObjectToObjectInfoMap['Product_Family__c'] = productFamilyObjectInfo;

            // When: Start BFS from 'Product_Family__c'
            const relationshipService = new RelationshipService();
            const processedObjects = new Set<string>();
            const result = (relationshipService as any).buildSingleRelationshipTree(objectInfoWrapper, 'Product_Family__c', processedObjects);

            // Then: Find all connected objects
            expect(result.allObjects).toHaveLength(5);
            expect(result.allObjects).toContain('Product_Family__c');
            expect(result.allObjects).toContain('Product__c');
            expect(result.allObjects).toContain('Order_Item__c');
            expect(result.allObjects).toContain('Order__c');
            expect(result.allObjects).toContain('Account');
            
            // Both Product_Family__c and Account are top-level (no parents in this tree)
            expect(result.topLevelObjects).toContain('Product_Family__c');
            expect(result.topLevelObjects).toContain('Account');
            expect(result.topLevelObjects).toHaveLength(2);
            
            // Verify correct hierarchy levels
            // Product_Family__c (0) → Product__c (1) → Order_Item__c (2)
            // Account (0) → Order__c (1) → Order_Item__c (already at 2)
            expect(result.maxLevel).toBe(2);
            expect(objectInfoWrapper.ObjectToObjectInfoMap['Product_Family__c'].RelationshipDetail.level).toBe(0);
            expect(objectInfoWrapper.ObjectToObjectInfoMap['Account'].RelationshipDetail.level).toBe(0);
            expect(objectInfoWrapper.ObjectToObjectInfoMap['Product__c'].RelationshipDetail.level).toBe(1);
            expect(objectInfoWrapper.ObjectToObjectInfoMap['Order__c'].RelationshipDetail.level).toBe(1);
            expect(objectInfoWrapper.ObjectToObjectInfoMap['Order_Item__c'].RelationshipDetail.level).toBe(2);
        });
    });
});
