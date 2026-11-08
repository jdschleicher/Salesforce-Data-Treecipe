import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/*
    #592. readDirectory lists in the file system's order, which differs between machines. The walk
    reads object folders and field files in name order whatever that order is, so the same metadata
    gives the same objects wrapper listed forwards, backwards or shuffled. vscode is a read-only
    stand-in over a temp workspace whose listing order each test chooses.
*/
jest.mock('vscode', () => {
    const realFs = jest.requireActual('fs');
    const realPath = jest.requireActual('path');
    const toUri = (fsPath: string) => ({ fsPath: fsPath, path: fsPath });
    return {
        workspace: {
            workspaceFolders: undefined,
            fs: {
                readDirectory: async (directoryUri: { fsPath: string }) => {
                    try {
                        const directoryEntries = realFs.readdirSync(directoryUri.fsPath, { withFileTypes: true })
                            .map((entry: { name: string; isDirectory: () => boolean }) => [entry.name, entry.isDirectory() ? 2 : 1]);
                        return mockDirectoryListing.arrange(directoryEntries);
                    } catch {
                        return [];
                    }
                },
                readFile: async (fileUri: { fsPath: string }) => realFs.readFileSync(fileUri.fsPath)
            }
        },
        Uri: {
            file: toUri,
            parse: (uriText: string) => toUri(uriText.replace(/^file:\/\//, '')),
            joinPath: (baseUri: { fsPath: string }, ...segments: string[]) => toUri(realPath.join(baseUri.fsPath, ...segments))
        },
        window: { showWarningMessage: jest.fn(), showInformationMessage: jest.fn(), showErrorMessage: jest.fn() },
        FileType: { Directory: 2, File: 1, SymbolicLink: 64 },
        ThemeIcon: jest.fn()
    };
}, { virtual: true });

type DirectoryEntry = [string, number];

const mockDirectoryListing = {
    arrange: (directoryEntries: DirectoryEntry[]): DirectoryEntry[] => directoryEntries
};

import * as vscode from 'vscode';
import { ConfigurationService } from '../../ConfigurationService/ConfigurationService';
import { RecipeFakerServiceFactory } from '../../FakerRecipeProcessor/RecipeFakerServiceFactory';
import { DirectoryProcessor } from '../DirectoryProcessor';
import { ObjectInfoWrapper } from '../../ObjectInfoWrapper/ObjectInfoWrapper';
import { FakerJSRecipeFakerService } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { IRecipeFakerService } from '../../RecipeFakerService.ts/IRecipeFakerService';

const byName = ([firstName]: DirectoryEntry, [secondName]: DirectoryEntry) => ( firstName < secondName ? -1 : ( firstName > secondName ? 1 : 0 ) );

const LISTING_ORDERS: [string, (directoryEntries: DirectoryEntry[]) => DirectoryEntry[]][] = [
    ['sorted', directoryEntries => [...directoryEntries].sort(byName)],
    ['reversed', directoryEntries => [...directoryEntries].sort(byName).reverse()],
    // A FIXED INTERLEAVE OF BOTH ENDS, SO THE ORDER IS NEITHER SORTED NOR REVERSED AND THE SAME EVERY RUN
    ['interleaved', directoryEntries => {
        const sortedEntries = [...directoryEntries].sort(byName);
        const interleavedEntries: DirectoryEntry[] = [];
        while ( sortedEntries.length > 0 ) {
            interleavedEntries.push(sortedEntries.pop());
            if ( sortedEntries.length > 0 ) {
                interleavedEntries.push(sortedEntries.shift());
            }
        }
        return interleavedEntries;
    }]
];

const buildTextFieldXml = (fieldApiName: string) => `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>${fieldApiName}</fullName>
    <length>80</length>
    <type>Text</type>
</CustomField>`;

const buildPicklistFieldXml = (fieldApiName: string, valueName: string, controllingFieldApiName?: string, controllingFieldValue?: string) => `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>${fieldApiName}</fullName>
    <type>Picklist</type>
    <valueSet>
        ${controllingFieldApiName ? `<controllingField>${controllingFieldApiName}</controllingField>` : ''}
        <restricted>true</restricted>
        <valueSetDefinition>
            <sorted>false</sorted>
            <value>
                <fullName>${valueName}</fullName>
                <default>false</default>
                <label>${valueName}</label>
            </value>
        </valueSetDefinition>
        ${controllingFieldApiName ? `<valueSettings><controllingFieldValue>${controllingFieldValue}</controllingFieldValue><valueName>${valueName}</valueName></valueSettings>` : ''}
    </valueSet>
</CustomField>`;

/*
    Upper-case names sort before lower-case ones with "<" (Beta__c, Zeta__c, alpha__c), which
    localeCompare would not do. ADependent__c is a dependent picklist whose name sorts above its
    controller, so the walk still moves the controller above it after reading in name order (#462).
    Empty__c is an object folder with no files and README.md is a stray file beside the objects.
*/
function writeObjectsDirectory(objectsPath: string) {

    const writeField = (objectApiName: string, fieldApiName: string, fieldXml: string) => {
        const fieldsPath = path.join(objectsPath, objectApiName, 'fields');
        fs.mkdirSync(fieldsPath, { recursive: true });
        fs.writeFileSync(path.join(fieldsPath, `${fieldApiName}.field-meta.xml`), fieldXml);
    };

    writeField('Zeta__c', 'Name__c', buildTextFieldXml('Name__c'));
    writeField('alpha__c', 'Name__c', buildTextFieldXml('Name__c'));
    writeField('Beta__c', 'alpha__c', buildTextFieldXml('alpha__c'));
    writeField('Beta__c', 'Beta__c', buildTextFieldXml('Beta__c'));
    writeField('Beta__c', 'ZController__c', buildPicklistFieldXml('ZController__c', 'Controller Value'));
    writeField('Beta__c', 'ADependent__c', buildPicklistFieldXml('ADependent__c', 'Dependent Value', 'ZController__c', 'Controller Value'));
    fs.mkdirSync(path.join(objectsPath, 'Empty__c'));
    fs.writeFileSync(path.join(objectsPath, 'README.md'), 'Not an object.');

}

describe.each([
    ['faker-js', () => new FakerJSRecipeFakerService()],
    ['snowfakery', () => new SnowfakeryRecipeFakerService()]
] as const)('DirectoryProcessor reads every folder in name order with the %s backend (#592)', (unusedBackend, createFakerService: () => IRecipeFakerService) => {

    let workspacePath: string;
    let objectsPath: string;

    beforeEach(() => {

        workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-directory-order-'));
        objectsPath = path.join(workspacePath, 'objects');
        writeObjectsDirectory(objectsPath);

        jest.spyOn(RecipeFakerServiceFactory, 'getFakerImplementationByExtensionConfigSelection').mockImplementation(createFakerService);
        jest.spyOn(ConfigurationService, 'getCustomRelationshipMappings').mockReturnValue({});
        jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue([]);

    });

    afterEach(() => {
        fs.rmSync(workspacePath, { recursive: true, force: true });
    });

    // A RELATIONSHIP TREE ID CARRIES Date.now(), SO BOTH WALKS READ ONE INSTANT
    const RUN_INSTANT_MILLISECONDS = Date.UTC(2026, 0, 2, 3, 4, 5);

    const processObjectsListedIn = async (arrange: (directoryEntries: DirectoryEntry[]) => DirectoryEntry[]): Promise<ObjectInfoWrapper> => {
        mockDirectoryListing.arrange = arrange;
        jest.spyOn(Date, 'now').mockReturnValue(RUN_INSTANT_MILLISECONDS);
        return new DirectoryProcessor().processAllObjectsAndRelationships(vscode.Uri.file(objectsPath));
    };

    test('objects are visited in name order, upper case before lower case, and a stray file or an empty object folder adds none', async () => {

        const objectInfoWrapper = await processObjectsListedIn(LISTING_ORDERS[1][1]);

        expect(Object.keys(objectInfoWrapper.ObjectToObjectInfoMap)).toEqual(['Beta__c', 'Zeta__c', 'alpha__c']);

    });

    test('fields are read in name order, and a controlling picklist still sits directly above the dependent it controls', async () => {

        const objectInfoWrapper = await processObjectsListedIn(LISTING_ORDERS[1][1]);

        expect(objectInfoWrapper.ObjectToObjectInfoMap.Beta__c.Fields.map(fieldInfo => fieldInfo.fieldName))
            .toEqual(['ZController__c', 'ADependent__c', 'Beta__c', 'alpha__c']);

    });

    test.each(LISTING_ORDERS.slice(1))('listed %s, the objects wrapper and every recipe are the same as listed sorted', async (unusedListingOrder, arrange) => {

        const sortedListingWrapper = await processObjectsListedIn(LISTING_ORDERS[0][1]);
        const otherListingWrapper = await processObjectsListedIn(arrange);

        expect(JSON.stringify(otherListingWrapper)).toBe(JSON.stringify(sortedListingWrapper));

    });

});
