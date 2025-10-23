
import { ConfigurationService } from '../../ConfigurationService/ConfigurationService';
import { DirectoryProcessor } from '../../DirectoryProcessingService/DirectoryProcessor';
import { FakerJSRecipeFakerService } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';

import * as fs from 'fs';

import * as path from 'path';

// Simple mock at the top of your test file
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
import * as vscode from 'vscode';

describe("Shared Relationship Service Tests", () => {

    test("given expected test directory, objects directories are processed and relationships are genereated", async() => {

        const expectedTestPath = "src/treecipe/src/DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory/objects";
        const directoryPathUri = vscode.Uri.file(expectedTestPath);

        jest.spyOn(ConfigurationService, 'getFakerImplementationByExtensionConfigSelection')
            .mockImplementation(() => new FakerJSRecipeFakerService());
  
        let directoryProcessor = new DirectoryProcessor();

        const objectInfoWrapperCreated = await directoryProcessor.processAllObjectsAndRelationships(directoryPathUri);
        console.log(objectInfoWrapperCreated);
        
        let allTrees = [];

        let accountTopRelationshipObjects = [
            'Account', 
            'Contact',
            'User',
            'MegaMapMadness__c',
            'Order__c',
            'Order_Item__c',
            'Product2',
            'Example_Everything__c',
            'Product_Family__c',
            'Product__c'
        ];
        allTrees.push(accountTopRelationshipObjects);

        let caseTreeObjects = [
            'Case',
            'Vehicle__c'
        ];
        allTrees.push(caseTreeObjects);

        let oppTree = [
            'Opportunity'
        ];
        allTrees.push(oppTree);

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

        expect(allTrees.length).toBe(objectInfoWrapperCreated.RecipeFiles.length);



    });


    test("given expected object map structure, creates expected recipe", () => {

       


    });
    /*
    

        1. for each relationship structure , create a dedicated yaml file 
        2. be able to identify relationship type of self, that would generate a copy of the object recipe
        3. for each field in an object that has a reference to the same object, create a dedicated object recipe 
        4. after each lookup field is processed, run level adjuster function that moves nodes into the correct order through a recursive function of child lookups of the parent

    */

});
