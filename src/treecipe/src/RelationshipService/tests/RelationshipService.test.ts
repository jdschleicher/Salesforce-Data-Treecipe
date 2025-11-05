
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
            
            const relationshipService = new RelationshipService();
            // When: Start BFS from 'Account'
            let expectedEmptyProcessedObjects = new Set<string>();
            const actualResultTree = (relationshipService as any).buildSingleRelationshipTree(expectedObjectInfoWrapper, expectedObjectAccountApiName, expectedEmptyProcessedObjects);

            // const result = relationshipService.buildSingleRelationshipTree(input, 'Account', globalProcessed);

            // Then: Find exactly that one object
            expect(actualResultTree.allObjects).toEqual(['Account']);
            expect(actualResultTree.topLevelObjects.length).toEqual(1);

            expect(actualResultTree.topLevelObjects[0]).toEqual(expectedObjectAccountApiName);
            expect(actualResultTree.maxLevel).toBe(0);

        });

        // it('INPUT: A→B chain, start at A → OUTPUT: Found [A, B] with A at level 0, B at level 1', () => {
        //     // Given: Account has a child Contact
        //     const input: ObjectInfoWrapper = {
        //         ObjectToObjectInfoMap: {
        //             'Account': { RelationshipDetail: createRelationshipDetail([], ['Contact'], 'Account') },
        //             'Contact': { RelationshipDetail: createRelationshipDetail(['Account'], [], 'Contact') }
        //         }
        //     };

        //     // When: Start BFS from 'Account'
        //     const result = builder.buildTree(input, 'Account', globalProcessed);

        //     // Then: Find both objects
        //     expect(result.allObjects).toHaveLength(2);
        //     expect(result.allObjects).toContain('Account');
        //     expect(result.allObjects).toContain('Contact');
            
        //     // Account is top level
        //     expect(result.topLevelObjects).toEqual(['Account']);
            
        //     // Contact is one level below Account
        //     expect(result.maxLevel).toBe(1);
        //     expect(input.ObjectToObjectInfoMap['Account'].RelationshipDetail.level).toBe(0);
        //     expect(input.ObjectToObjectInfoMap['Contact'].RelationshipDetail.level).toBe(1);
        // });

        // it('INPUT: A→B→C chain, start at A → OUTPUT: Found [A, B, C] at levels 0, 1, 2', () => {
        //     // Given: Account → Contact → Opportunity
        //     const input: ObjectInfoWrapper = {
        //     ObjectToObjectInfoMap: {
        //         'Account': { RelationshipDetail: createRelationshipDetail([], ['Contact']) },
        //         'Contact': { RelationshipDetail: createRelationshipDetail(['Account'], ['Opportunity']) },
        //         'Opportunity': { RelationshipDetail: createRelationshipDetail(['Contact'], []) }
        //     }
        //     };

        //     // When: Start BFS from 'Account'
        //     const result = builder.buildTree(input, 'Account', globalProcessed);

        //     // Then: Find all three objects
        //     expect(result.allObjects).toHaveLength(3);
        //     expect(result.topLevelObjects).toEqual(['Account']);
        //     expect(result.maxLevel).toBe(2);
            
        //     // Each object is one level deeper
        //     expect(input.ObjectToObjectInfoMap['Account'].RelationshipDetail.level).toBe(0);
        //     expect(input.ObjectToObjectInfoMap['Contact'].RelationshipDetail.level).toBe(1);
        //     expect(input.ObjectToObjectInfoMap['Opportunity'].RelationshipDetail.level).toBe(2);
        // });

        // it('INPUT: A with two children B and C, start at A → OUTPUT: Found [A, B, C] with B and C both at level 1', () => {
        //     // Given: Account has two children: Contact and Opportunity
        //     const input: ObjectInfoWrapper = {
        //     ObjectToObjectInfoMap: {
        //         'Account': { RelationshipDetail: createRelationshipDetail([], ['Contact', 'Opportunity']) },
        //         'Contact': { RelationshipDetail: createRelationshipDetail(['Account'], []) },
        //         'Opportunity': { RelationshipDetail: createRelationshipDetail(['Account'], []) }
        //     }
        //     };

        //     // When: Start BFS from 'Account'
        //     const result = builder.buildTree(input, 'Account', globalProcessed);

        //     // Then: Find all three objects
        //     expect(result.allObjects).toHaveLength(3);
        //     expect(result.topLevelObjects).toEqual(['Account']);
        //     expect(result.maxLevel).toBe(1);
            
        //     // Both children are at the same level (this is BFS!)
        //     expect(input.ObjectToObjectInfoMap['Account'].RelationshipDetail.level).toBe(0);
        //     expect(input.ObjectToObjectInfoMap['Contact'].RelationshipDetail.level).toBe(1);
        //     expect(input.ObjectToObjectInfoMap['Opportunity'].RelationshipDetail.level).toBe(1);
        // });

    });
    

    // describe("ensureRelationshipDetailExists", () => {

    //     test('', () => {

            

    //     });

    // });

    // test("given expected object map structure, creates expected recipe", () => {

       


    // });
    /*
    

        1. for each relationship structure , create a dedicated yaml file 
        2. be able to identify relationship type of self, that would generate a copy of the object recipe
        3. for each field in an object that has a reference to the same object, create a dedicated object recipe 
        4. after each lookup field is processed, run level adjuster function that moves nodes into the correct order through a recursive function of child lookups of the parent

    */

});
