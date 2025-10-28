
import { ConfigurationService } from '../../ConfigurationService/ConfigurationService';
import { DirectoryProcessor } from '../../DirectoryProcessingService/DirectoryProcessor';
import { FakerJSRecipeFakerService } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { MockRelationshipService } from './mocks/MockRelationshipService';

// import { ObjectInfoWrapper } from '../../ObjectInfoWrapper/ObjectInfoWrapper';
import { RelationshipTree } from '../RelationshipService';


// import * as ncp from 'copy-paste';
// import { promisify } from 'util';
// const copy = promisify(ncp.copy);
// const paste = promisify(ncp.paste);


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
import { hasSubscribers } from 'diagnostics_channel';



function haseSameSalesforceTreeBase(treeIdXX: string, treeIdYY: string): boolean {
   
    const regex = /^tree_([A-Za-z0-9_]+__c|[A-Za-z0-9_]+)_\d+$/;
    const matchXX = treeIdXX.match(regex);
    const matchYY = treeIdYY.match(regex);
    return !!matchXX && !!matchYY && matchXX[1] === matchYY[1];

}

describe("Shared Relationship Service Tests", () => {

    let directoryProcessor = null;

    beforeAll(() => {

        jest.spyOn(ConfigurationService, 'getFakerImplementationByExtensionConfigSelection')
            .mockImplementation(() => new FakerJSRecipeFakerService());

        directoryProcessor = new DirectoryProcessor();

    });


    test("given expected test directory, objects directories are processed and relationships are genereated", async() => {

        const dedicatedTestPathToProcessForActualResult = "src/treecipe/src/DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory/objects";
        const directoryPathUri = vscode.Uri.file(dedicatedTestPathToProcessForActualResult);

        const actualObjectInfoWrapperCreated = await directoryProcessor.processAllObjectsAndRelationships(directoryPathUri);

        const expectedRelationshipTreesJson = MockRelationshipService.getExpectedRelationshipTreesJson();
        const expectedRelationshipTrees:RelationshipTree[] = JSON.parse(expectedRelationshipTreesJson);

        const actualRelationshipTrees = actualObjectInfoWrapperCreated.RelationshipTrees;
               
        expect(expectedRelationshipTrees.length).toBe(actualRelationshipTrees.length);
        

        for ( const actualTree in actualRelationshipTrees ) {

            const match = expectedRelationshipTrees.find(expectedTree => haseSameSalesforceTreeBase(actualTree.treeId, expectedTree.treeId));
            // console.log(`${actualTree} → ${match ? "Matched: " + match : "No Match"}`);

        }
        // const expectedTreeStructuresForExpectedDirectoryStructure = MockRelationshipService.getExpectTreeStructures();
        

        // const treeAccountExpectedPattern = "tree_Account";
        // const actualTreeAccountRelationshipTree = objectInfoWrapperCreated.RelationshipTrees.find( tree => tree.treeId.includes(treeAccountExpectedPattern));
        // const expectedAccountThruProductFamilyObjects =['Account', 'Contact', 'Example_Everything__c', 'Opportunity', 'Order__c', 'User', 'MasterDetailMadness__c', 'Order_Item__c', 'MegaMapMadness__c', 'Product__c', 'Product_Family__c'];
        // expect(expectedAccountThruProductFamilyObjects.length).toBe(actualTreeAccountRelationshipTree.allObjects.length);
   
        // await copy(expectedRelationshipTreesJson);


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
