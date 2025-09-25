
// import { RelationshipService } from '../src/RelationshipService';
import { ObjectInfoWrapper } from '../../ObjectInfoWrapper/ObjectInfoWrapper';
import { RelationshipService } from '../RelationshipService';

import * as fs from 'fs';


describe("Shared Relationship Service Tests", () => {

    test("given expected object map structure, creates expected recipe", () => {

        const wrapperFilePath = './src/treecipe/src/RelationshipService/tests/mocks/wrappers.json'; // Path to your JSON file
        const wrapperContent = fs.readFileSync(wrapperFilePath, 'utf8');
        let objectInfoWrapperMock:ObjectInfoWrapper = JSON.parse(wrapperContent);
 
        let relationshipService = new RelationshipService();
        

        for (const [objectName, objectInfo] of Object.entries(objectInfoWrapperMock.ObjectToObjectInfoMap)) {
            
            objectInfo.RelationshipDetail = null;
            objectInfo.RelationshipDetail = relationshipService.buildNewRelationshipDetail(objectName);


                if (objectInfo.Fields) {

                    objectInfo.Fields.forEach((field) => {

                        if (field.type === 'Lookup' 
                                || field.type === 'MasterDetail' 
                                || field.type === 'Hiearchy') {

                            relationshipService.addRelationshipConnection(objectInfoWrapperMock, objectName, field);
                        
                        }

                    });
                }

            }

                // let test = relationshipService.processAllRelationships(objectInfoWrapperMock);


        


    });
    /*
    

        1. for each relationship structure , create a dedicated yaml file 
        2. be able to identify relationship type of self, that would generate a copy of the object recipe
        3. for each field in an object that has a reference to the same object, create a dedicated object recipe 
        4. after each lookup field is processed, run level adjuster function that moves nodes into the correct order through a recursive function of child lookups of the parent

    */

});

// // Mock VSCode APIs
// jest.mock('vscode', () => ({
//   workspace: {
//     fs: {
//       writeFile: jest.fn(),
//       createDirectory: jest.fn()
//     }
//   },
//   window: {
//     showInformationMessage: jest.fn(),
//     showErrorMessage: jest.fn()
//   },
//   Uri: {
//     joinPath: jest.fn((base, ...segments) => ({
//       fsPath: `${base.fsPath}/${segments.join('/')}`
//     }))
//   }
// }));

// describe('RelationshipService', () => {

//   let relationshipService: RelationshipService;
//   let mockObjectInfoWrapper: ObjectInfoWrapper;

//   beforeEach(() => {
//     relationshipService = new RelationshipService();
//     mockObjectInfoWrapper = createMockObjectInfoWrapper();
//   });

//   describe('buildNewRelationshipDetail', () => {
//     it('should create a new RelationshipDetail with default values', () => {
//       const result = relationshipService.buildNewRelationshipDetail('Account');

//       expect(result).toEqual({
//         objectApiName: 'Account',
//         level: -1,
//         parentObjects: [],
//         childObjects: [],
//         lookupFields: [],
//         isProcessed: false
//       });
//     });

//     it('should create a new RelationshipDetail with empty objectApiName if not provided', () => {
//       const result = relationshipService.buildNewRelationshipDetail();

//       expect(result.objectApiName).toBe('');
//       expect(result.level).toBe(-1);
//       expect(result.isProcessed).toBe(false);
//     });
//   });

//   describe('processAllRelationships', () => {
//     it('should process a simple parent-child relationship', () => {
//       const wrapper = createSimpleAccountContactWrapper();
      
//       relationshipService.processAllRelationships(wrapper);

//       // Account should be level 0 (parent)
//       expect(wrapper.ObjectToObjectInfoMap['Account'].RelationshipDetail?.level).toBe(0);
//       expect(wrapper.ObjectToObjectInfoMap['Account'].RelationshipDetail?.childObjects).toContain('Contact');
//       expect(wrapper.ObjectToObjectInfoMap['Account'].RelationshipDetail?.parentObjects).toHaveLength(0);

//       // Contact should be level 1 (child)
//       expect(wrapper.ObjectToObjectInfoMap['Contact'].RelationshipDetail?.level).toBe(1);
//       expect(wrapper.ObjectToObjectInfoMap['Contact'].RelationshipDetail?.parentObjects).toContain('Account');
//       expect(wrapper.ObjectToObjectInfoMap['Contact'].RelationshipDetail?.childObjects).toHaveLength(0);
//     });

//     it('should handle multiple relationship levels', () => {
//       const wrapper = createMultiLevelWrapper();
      
//       relationshipService.processAllRelationships(wrapper);

//       // Account: level 0 (top parent)
//       expect(wrapper.ObjectToObjectInfoMap['Account'].RelationshipDetail?.level).toBe(0);
      
//       // Contact: level 1 (child of Account)
//       expect(wrapper.ObjectToObjectInfoMap['Contact'].RelationshipDetail?.level).toBe(1);
      
//       // Case: level 2 (child of Contact)
//       expect(wrapper.ObjectToObjectInfoMap['Case'].RelationshipDetail?.level).toBe(2);
//     });

//     it('should handle self-referencing relationships', () => {
//       const wrapper = createSelfReferencingWrapper();
      
//       relationshipService.processAllRelationships(wrapper);

//       // Account should still be level 0 even with self-reference
//       expect(wrapper.ObjectToObjectInfoMap['Account'].RelationshipDetail?.level).toBe(0);
//       expect(wrapper.ObjectToObjectInfoMap['Account'].RelationshipDetail?.parentObjects).toContain('Account');
//       expect(wrapper.ObjectToObjectInfoMap['Account'].RelationshipDetail?.childObjects).toContain('Account');
//     });

//     it('should handle circular references between different objects', () => {
//       const wrapper = createCircularReferenceWrapper();
      
//       relationshipService.processAllRelationships(wrapper);

//       // Both objects should be processed and have valid levels
//       expect(wrapper.ObjectToObjectInfoMap['Opportunity'].RelationshipDetail?.level).toBeGreaterThanOrEqual(0);
//       expect(wrapper.ObjectToObjectInfoMap['OpportunityLineItem'].RelationshipDetail?.level).toBeGreaterThanOrEqual(0);
      
//       // Should handle the circular reference gracefully
//       expect(wrapper.ObjectToObjectInfoMap['Opportunity'].RelationshipDetail?.isProcessed).toBe(true);
//       expect(wrapper.ObjectToObjectInfoMap['OpportunityLineItem'].RelationshipDetail?.isProcessed).toBe(true);
//     });
//   });

//   describe('getOrderedObjectsForRecipes', () => {
//     it('should return properly ordered objects for recipe generation', () => {
//       const wrapper = createMultiLevelWrapper();
//       relationshipService.processAllRelationships(wrapper);

//       const result = relationshipService.getOrderedObjectsForRecipes(wrapper);

//       expect(result.relationshipTrees).toHaveLength(1);
//       const tree = result.relationshipTrees[0];
      
//       // Should have 3 levels (0, 1, 2)
//       expect(tree.orderedLevels).toHaveLength(3);
      
//       // Level 0 should contain Account
//       expect(tree.orderedLevels[0].level).toBe(0);
//       expect(tree.orderedLevels[0].objects).toContain('Account');
      
//       // Level 1 should contain Contact
//       expect(tree.orderedLevels[1].level).toBe(1);
//       expect(tree.orderedLevels[1].objects).toContain('Contact');
      
//       // Level 2 should contain Case
//       expect(tree.orderedLevels[2].level).toBe(2);
//       expect(tree.orderedLevels[2].objects).toContain('Case');
//     });

//     it('should separate unrelated object trees', () => {
//       const wrapper = createMultipleTreesWrapper();
//       relationshipService.processAllRelationships(wrapper);

//       const result = relationshipService.getOrderedObjectsForRecipes(wrapper);

//       // Should have 2 separate relationship trees
//       expect(result.relationshipTrees).toHaveLength(2);
      
//       // One tree should contain Account-Contact
//       const accountTree = result.relationshipTrees.find(tree => 
//         tree.orderedLevels.some(level => level.objects.includes('Account'))
//       );
//       expect(accountTree).toBeDefined();
      
//       // Other tree should contain Knowledge
//       const knowledgeTree = result.relationshipTrees.find(tree => 
//         tree.orderedLevels.some(level => level.objects.includes('Knowledge__kav'))
//       );
//       expect(knowledgeTree).toBeDefined();
//     });
//   });

//   describe('generateSeparateRecipeFiles', () => {
//     it('should generate recipe files with proper naming and content', () => {
//       const wrapper = createSimpleAccountContactWrapper();
//       relationshipService.processAllRelationships(wrapper);

//       const result = relationshipService.generateSeparateRecipeFiles(wrapper);

//       expect(result).toHaveLength(1);
//       expect(result[0].fileName).toBe('recipe_account_tree.yaml');
//       expect(result[0].objectCount).toBe(2);
//       expect(result[0].maxLevel).toBe(1);
//       expect(result[0].objects).toEqual(expect.arrayContaining(['Account', 'Contact']));
      
//       // Content should include proper Snowfakery formatting
//       expect(result[0].content).toContain('# Snowfakery Recipe File');
//       expect(result[0].content).toContain('# Dependency Level 0');
//       expect(result[0].content).toContain('# Dependency Level 1');
//       expect(result[0].content).toContain('- object: Account');
//       expect(result[0].content).toContain('- object: Contact');
//     });

//     it('should handle multiple objects at the same level', () => {
//       const wrapper = createSameLevelObjectsWrapper();
//       relationshipService.processAllRelationships(wrapper);

//       const result = relationshipService.generateSeparateRecipeFiles(wrapper);

//       expect(result).toHaveLength(1);
//       const content = result[0].content;
      
//       // Both Account and User should be at level 0
//       expect(content).toContain('# Objects: Account, User');
//       expect(content).toContain('- object: Account');
//       expect(content).toContain('- object: User');
//     });
//   });

//   describe('printRelationshipHierarchy', () => {
//     it('should generate readable hierarchy output', () => {
//       const wrapper = createMultiLevelWrapper();
//       relationshipService.processAllRelationships(wrapper);

//       const result = relationshipService.printRelationshipHierarchy(wrapper);

//       expect(result).toContain('RECIPE GENERATION ORDER');
//       expect(result).toContain('Level 0: Account');
//       expect(result).toContain('Level 1: Contact');
//       expect(result).toContain('Level 2: Case');
//       expect(result).toContain('Children: Contact');
//       expect(result).toContain('Parents: Account');
//     });
//   });
// });

// // Integration Test
// describe('RelationshipService Integration Test', () => {
//   let relationshipService: RelationshipService;

//   beforeEach(() => {
//     relationshipService = new RelationshipService();
//   });

//   it('should handle realistic Salesforce object relationships', () => {
//     // Create a comprehensive Salesforce-like object structure
//     const wrapper = createRealisticSalesforceWrapper();
    
//     relationshipService.processAllRelationships(wrapper);
//     const orderedRecipes = relationshipService.getOrderedObjectsForRecipes(wrapper);
//     const recipeFiles = relationshipService.generateSeparateRecipeFiles(wrapper);

//     // Verify the relationship hierarchy
//     expect(orderedRecipes.relationshipTrees).toHaveLength(2); // Account tree + Knowledge tree

//     // Find the main Account relationship tree
//     const accountTree = orderedRecipes.relationshipTrees.find(tree => 
//       tree.orderedLevels.some(level => level.objects.includes('Account'))
//     )!;

//     expect(accountTree).toBeDefined();
    
//     // Verify proper level assignments
//     const levelMap = getLevelMapFromTree(accountTree);
    
//     // Level 0: Top-level objects (no parents)
//     expect(levelMap[0]).toEqual(expect.arrayContaining(['Account', 'User']));
    
//     // Level 1: Objects that reference Level 0
//     expect(levelMap[1]).toEqual(expect.arrayContaining(['Contact', 'Opportunity']));
    
//     // Level 2: Objects that reference Level 1
//     expect(levelMap[2]).toEqual(expect.arrayContaining(['Case', 'Task']));
    
//     // Level 3: Objects that reference Level 2
//     expect(levelMap[3]).toEqual(expect.arrayContaining(['CaseComment']));

//     // Verify recipe file generation
//     const accountRecipeFile = recipeFiles.find(file => file.fileName.includes('account'));
//     expect(accountRecipeFile).toBeDefined();
//     expect(accountRecipeFile!.objectCount).toBe(7); // Account, User, Contact, Opportunity, Case, Task, CaseComment
//     expect(accountRecipeFile!.maxLevel).toBe(3);

//     // Verify recipe content order (parents before children)
//     const content = accountRecipeFile!.content;
//     const accountIndex = content.indexOf('- object: Account');
//     const contactIndex = content.indexOf('- object: Contact');
//     const caseIndex = content.indexOf('- object: Case');
    
//     expect(accountIndex).toBeLessThan(contactIndex);
//     expect(contactIndex).toBeLessThan(caseIndex);

//     // Verify separate Knowledge tree
//     const knowledgeTree = orderedRecipes.relationshipTrees.find(tree => 
//       tree.orderedLevels.some(level => level.objects.includes('Knowledge__kav'))
//     );
//     expect(knowledgeTree).toBeDefined();
    
//     const knowledgeRecipeFile = recipeFiles.find(file => file.fileName.includes('knowledge'));
//     expect(knowledgeRecipeFile).toBeDefined();
//     expect(knowledgeRecipeFile!.objectCount).toBe(1);
//   });

//   it('should generate expected recipe file structure for complex relationships', () => {
//     const wrapper = createRealisticSalesforceWrapper();
//     relationshipService.processAllRelationships(wrapper);
//     const recipeFiles = relationshipService.generateSeparateRecipeFiles(wrapper);

//     // Should generate exactly 2 recipe files
//     expect(recipeFiles).toHaveLength(2);

//     // Verify file names
//     expect(recipeFiles.some(f => f.fileName.includes('account'))).toBe(true);
//     expect(recipeFiles.some(f => f.fileName.includes('knowledge'))).toBe(true);

//     // Verify each file has proper Snowfakery structure
//     recipeFiles.forEach(file => {
//       expect(file.content).toContain('# Snowfakery Recipe File');
//       expect(file.content).toContain('# Dependency Level');
//       expect(file.content).toMatch(/- object: \w+/);
//       expect(file.content).toContain('fields:');
//     });

//     // Verify the main account tree file contains all expected objects in correct order
//     const mainFile = recipeFiles.find(f => f.fileName.includes('account'))!;
//     const lines = mainFile.content.split('\n');
//     const objectLines = lines.filter(line => line.match(/^- object: /));
    
//     expect(objectLines).toHaveLength(7); // All 7 objects in the account tree
    
//     // Extract object names and verify ordering
//     const objectOrder = objectLines.map(line => line.replace('- object: ', ''));
    
//     // Account and User should come before Contact
//     const accountIndex = objectOrder.indexOf('Account');
//     const userIndex = objectOrder.indexOf('User');
//     const contactIndex = objectOrder.indexOf('Contact');
    
//     expect(Math.min(accountIndex, userIndex)).toBeLessThan(contactIndex);
//   });

// });

// // Helper functions to create test data
// function createMockObjectInfoWrapper(): ObjectInfoWrapper {
//   return {
//     ObjectToObjectInfoMap: {},
//     CombinedRecipes: '',
//     OrderedRecipes: undefined,
//     RecipeFiles: undefined,
//     addKeyToObjectInfoMap: jest.fn()
//   };
// }

// function createSimpleAccountContactWrapper(): ObjectInfoWrapper {
//   const wrapper = createMockObjectInfoWrapper();
  
//   // Account object
//   wrapper.ObjectToObjectInfoMap['Account'] = {
//     FullRecipe: '- object: Account\n  fields:\n    Name: fake:company',
//     Fields: [],
//     RelationshipDetail: relationshipService.buildNewRelationshipDetail('Account')
//   };

//   // Contact object with lookup to Account
//   wrapper.ObjectToObjectInfoMap['Contact'] = {
//     FullRecipe: '- object: Contact\n  fields:\n    LastName: fake:last_name\n    AccountId:\n      reference: Account',
//     Fields: [
//       {
//         fieldName: 'AccountId',
//         type: 'lookup',
//         referenceTo: 'Account',
//         recipeValue: 'reference: Account'
//       } as FieldInfo
//     ],
//     RelationshipDetail: RelationshipService.buildNewRelationshipDetail('Contact')
//   };

//   return wrapper;
// }

// function createMultiLevelWrapper(): ObjectInfoWrapper {
//   const wrapper = createSimpleAccountContactWrapper();

//   // Add Case object with lookup to Contact
//   wrapper.ObjectToObjectInfoMap['Case'] = {
//     FullRecipe: '- object: Case\n  fields:\n    Subject: fake:sentence\n    ContactId:\n      reference: Contact',
//     Fields: [
//       {
//         fieldName: 'ContactId',
//         type: 'lookup',
//         referenceTo: 'Contact',
//         recipeValue: 'reference: Contact'
//       } as FieldInfo
//     ],
//     RelationshipDetail: relationshipService.buildNewRelationshipDetail('Case')
//   };

//   return wrapper;
// }

// function createSelfReferencingWrapper(): ObjectInfoWrapper {
//   const wrapper = createMockObjectInfoWrapper();

//   wrapper.ObjectToObjectInfoMap['Account'] = {
//     FullRecipe: '- object: Account\n  fields:\n    Name: fake:company\n    ParentId:\n      reference: Account',
//     Fields: [
//       {
//         fieldName: 'ParentId',
//         type: 'lookup',
//         referenceTo: 'Account',
//         recipeValue: 'reference: Account'
//       } as FieldInfo
//     ],
//     RelationshipDetail: relationshipService.buildNewRelationshipDetail('Account')
//   };

//   return wrapper;
// }

// function createCircularReferenceWrapper(): ObjectInfoWrapper {
//   const wrapper = createMockObjectInfoWrapper();

//   // Opportunity references OpportunityLineItem
//   wrapper.ObjectToObjectInfoMap['Opportunity'] = {
//     FullRecipe: '- object: Opportunity\n  fields:\n    Name: fake:sentence',
//     Fields: [],
//     RelationshipDetail: relationshipService.buildNewRelationshipDetail('Opportunity')
//   };

//   // OpportunityLineItem references Opportunity (circular)
//   wrapper.ObjectToObjectInfoMap['OpportunityLineItem'] = {
//     FullRecipe: '- object: OpportunityLineItem\n  fields:\n    OpportunityId:\n      reference: Opportunity',
//     Fields: [
//       {
//         fieldName: 'OpportunityId',
//         type: 'lookup',
//         referenceTo: 'Opportunity',
//         recipeValue: 'reference: Opportunity'
//       } as FieldInfo
//     ],
//     RelationshipDetail: relationshipService.buildNewRelationshipDetail('OpportunityLineItem')
//   };

//   return wrapper;
// }

// function createMultipleTreesWrapper(): ObjectInfoWrapper {

//   const wrapper = createSimpleAccountContactWrapper();

//   // Add unrelated Knowledge object
//   wrapper.ObjectToObjectInfoMap['Knowledge__kav'] = {
//     FullRecipe: '- object: Knowledge__kav\n  fields:\n    Title: fake:sentence',
//     Fields: [],
//     RelationshipDetail: relationshipService.buildNewRelationshipDetail('Knowledge__kav')
//   };

//   return wrapper;
// }

// function createSameLevelObjectsWrapper(): ObjectInfoWrapper {
//   const wrapper = createMockObjectInfoWrapper();
//   let relationshipService: RelationshipService;

//   // Account - no parents
//   wrapper.ObjectToObjectInfoMap['Account'] = {
//     FullRecipe: '- object: Account\n  fields:\n    Name: fake:company',
//     Fields: [],
//     RelationshipDetail: relationshipService.buildNewRelationshipDetail('Account')
//   };

//   // User - no parents (same level as Account)
//   wrapper.ObjectToObjectInfoMap['User'] = {
//     FullRecipe: '- object: User\n  fields:\n    LastName: fake:last_name',
//     Fields: [],
//     RelationshipDetail: relationshipService.buildNewRelationshipDetail('User')
//   };

//   // Contact references both Account and User
//   wrapper.ObjectToObjectInfoMap['Contact'] = {
//     FullRecipe: '- object: Contact\n  fields:\n    AccountId:\n      reference: Account\n    OwnerId:\n      reference: User',
//     Fields: [
//       {
//         fieldName: 'AccountId',
//         type: 'lookup',
//         referenceTo: 'Account',
//         recipeValue: 'reference: Account'
//       } as FieldInfo,
//       {
//         fieldName: 'OwnerId',
//         type: 'lookup',
//         referenceTo: 'User',
//         recipeValue: 'reference: User'
//       } as FieldInfo
//     ],
//     RelationshipDetail: relationshipService.buildNewRelationshipDetail('Contact')
//   };

//   return wrapper;
// }

// function createRealisticSalesforceWrapper(): ObjectInfoWrapper {
//   const wrapper = createMockObjectInfoWrapper();

//   // Level 0: Account, User (top-level objects)
//   wrapper.ObjectToObjectInfoMap['Account'] = {
//     FullRecipe: '- object: Account\n  fields:\n    Name: fake:company\n    Type: Customer',
//     Fields: [],
//     RelationshipDetail: relationshipService.buildNewRelationshipDetail('Account')
//   };

//   wrapper.ObjectToObjectInfoMap['User'] = {
//     FullRecipe: '- object: User\n  fields:\n    LastName: fake:last_name\n    Email: fake:email',
//     Fields: [],
//     RelationshipDetail: relationshipService.buildNewRelationshipDetail('User')
//   };

//   // Level 1: Contact, Opportunity (reference Account and/or User)
//   wrapper.ObjectToObjectInfoMap['Contact'] = {
//     FullRecipe: '- object: Contact\n  fields:\n    AccountId:\n      reference: Account\n    OwnerId:\n      reference: User',
//     Fields: [
//       { fieldName: 'AccountId', type: 'lookup', referenceTo: 'Account', recipeValue: 'reference: Account' } as FieldInfo,
//       { fieldName: 'OwnerId', type: 'lookup', referenceTo: 'User', recipeValue: 'reference: User' } as FieldInfo
//     ],
//     RelationshipDetail: relationshipService.buildNewRelationshipDetail('Contact')
//   };

//   wrapper.ObjectToObjectInfoMap['Opportunity'] = {
//     FullRecipe: '- object: Opportunity\n  fields:\n    AccountId:\n      reference: Account\n    OwnerId:\n      reference: User',
//     Fields: [
//       { fieldName: 'AccountId', type: 'masterdetail', referenceTo: 'Account', recipeValue: 'reference: Account' } as FieldInfo,
//       { fieldName: 'OwnerId', type: 'lookup', referenceTo: 'User', recipeValue: 'reference: User' } as FieldInfo
//     ],
//     RelationshipDetail: relationshipService.buildNewRelationshipDetail('Opportunity')
//   };

//   // Level 2: Case, Task (reference Contact)
//   wrapper.ObjectToObjectInfoMap['Case'] = {
//     FullRecipe: '- object: Case\n  fields:\n    ContactId:\n      reference: Contact\n    AccountId:\n      reference: Account',
//     Fields: [
//       { fieldName: 'ContactId', type: 'lookup', referenceTo: 'Contact', recipeValue: 'reference: Contact' } as FieldInfo,
//       { fieldName: 'AccountId', type: 'lookup', referenceTo: 'Account', recipeValue: 'reference: Account' } as FieldInfo
//     ],
//     RelationshipDetail: relationshipService.buildNewRelationshipDetail('Case')
//   };

//   wrapper.ObjectToObjectInfoMap['Task'] = {
//     FullRecipe: '- object: Task\n  fields:\n    WhoId:\n      reference: Contact',
//     Fields: [
//       { fieldName: 'WhoId', type: 'lookup', referenceTo: 'Contact', recipeValue: 'reference: Contact' } as FieldInfo
//     ],
//     RelationshipDetail: relationshipService.buildNewRelationshipDetail('Task')
//   };

//   // Level 3: CaseComment (references Case)
//   wrapper.ObjectToObjectInfoMap['CaseComment'] = {
//     FullRecipe: '- object: CaseComment\n  fields:\n    ParentId:\n      reference: Case',
//     Fields: [
//       { fieldName: 'ParentId', type: 'masterdetail', referenceTo: 'Case', recipeValue: 'reference: Case' } as FieldInfo
//     ],
//     RelationshipDetail: relationshipService.buildNewRelationshipDetail('CaseComment')
//   };

//   // Separate tree: Knowledge (no relationships)
//   wrapper.ObjectToObjectInfoMap['Knowledge__kav'] = {
//     FullRecipe: '- object: Knowledge__kav\n  fields:\n    Title: fake:sentence\n    UrlName: fake:slug',
//     Fields: [],
//     RelationshipDetail: relationshipService.buildNewRelationshipDetail('Knowledge__kav')
//   };

//   return wrapper;
// }

// function getLevelMapFromTree(tree: any): Record<number, string[]> {
//   const levelMap: Record<number, string[]> = {};
//   tree.orderedLevels.forEach((level: any) => {
//     levelMap[level.level] = level.objects;
//   });
//   return levelMap;
// }


