import { ConfigurationService } from '../../ConfigurationService/ConfigurationService';
import { DirectoryProcessor } from '../DirectoryProcessor';
import { IRecipeFakerService } from '../../RecipeFakerService.ts/IRecipeFakerService';
import { FakerJSRecipeFakerService } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { StandardFieldParentReferenceMap } from '../../RelationshipService/StandardFieldParentReferenceMap';
import { RelationshipService } from '../../RelationshipService/RelationshipService';

jest.mock('vscode', () => ({
    workspace: { workspaceFolders: undefined, fs: { readDirectory: jest.fn(), readFile: jest.fn() } },
    Uri: { file: (fsPath: string) => ({ fsPath }) },
    window: { showWarningMessage: jest.fn() },
    FileType: { Directory: 2, File: 1, SymbolicLink: 64 }
}), { virtual: true });

// WHAT A HIERARCHY FIELD WITH NO KNOWN PARENT HAS ALWAYS BEEN WRITTEN AS, IN BOTH BACKENDS
const UNHANDLED_HIERARCHY_RECIPE_VALUE = '"### TODO -- FieldType Not Handled -- hierarchy does not exist in this programs Salesforce field map."';

const buildFieldXml = (fieldApiName: string, fieldType: string, extraMarkup = '') => `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>${fieldApiName}</fullName>
    <trackFeedHistory>false</trackFeedHistory>
    ${extraMarkup}
    <type>${fieldType}</type>
</CustomField>`;

describe.each([
    ['faker-js', () => new FakerJSRecipeFakerService()],
    ['snowfakery', () => new SnowfakeryRecipeFakerService()]
] as const)('DirectoryProcessor standard field parents with the %s backend (#400)', (unusedBackend, createFakerService: () => IRecipeFakerService) => {

    let directoryProcessor: DirectoryProcessor;

    beforeEach(() => {

        jest.spyOn(ConfigurationService, 'getFakerImplementationByExtensionConfigSelection').mockImplementation(createFakerService);
        jest.spyOn(ConfigurationService, 'getCustomRelationshipMappings').mockReturnValue({});
        directoryProcessor = new DirectoryProcessor();

    });

    const buildFieldInfo = (objectApiName: string, fieldApiName: string, fieldType: string, extraMarkup = '') =>
        directoryProcessor.buildFieldInfoByXMLContent(buildFieldXml(fieldApiName, fieldType, extraMarkup), objectApiName, {}, `${fieldApiName}.field-meta.xml`);

    test('a standard Account.ParentId Hierarchy field takes Account as its parent and is written as a lookup', async () => {

        const fieldInfo = await buildFieldInfo('Account', 'ParentId', 'Hierarchy');

        expect(fieldInfo.type).toBe('Hierarchy');
        expect(fieldInfo.referenceTo).toBe('Account');
        expect(fieldInfo.recipeValue).toBe(RelationshipService.referenceIdRequiredTodo);

    });

    test('a standard Lookup the map names (Contact.ReportsToId) takes its parent', async () => {

        const fieldInfo = await buildFieldInfo('Contact', 'ReportsToId', 'Lookup');

        expect(fieldInfo.referenceTo).toBe('Contact');
        expect(fieldInfo.recipeValue).toBe(RelationshipService.referenceIdRequiredTodo);

    });

    test('an explicit <referenceTo> always wins over the map', async () => {

        const fieldInfo = await buildFieldInfo('Contact', 'AccountId', 'Lookup', '<referenceTo>Other__c</referenceTo>');

        expect(fieldInfo.referenceTo).toBe('Other__c');

    });

    test('a custom relationship mapping for the field wins: the map leaves it without a referenceTo, for the relationship step to resolve', async () => {

        jest.spyOn(ConfigurationService, 'getCustomRelationshipMappings').mockReturnValue({ 'Contact.ReportsToId': 'User' });
        directoryProcessor = new DirectoryProcessor();

        const fieldInfo = await buildFieldInfo('Contact', 'ReportsToId', 'Lookup');

        expect(fieldInfo.referenceTo).toBeFalsy();
        expect(new RelationshipService().resolveParentReferenceForField('Contact', 'ReportsToId', { 'Contact.ReportsToId': 'User' })).toBe('User');

    });

    test('a Hierarchy field the map does not name (User.ManagerId) is written exactly as before, with no parent', async () => {

        const fieldInfo = await buildFieldInfo('User', 'ManagerId', 'Hierarchy');

        expect(fieldInfo.referenceTo).toBeFalsy();
        expect(fieldInfo.recipeValue).toBe(UNHANDLED_HIERARCHY_RECIPE_VALUE);

    });

    test('a field of another type with a mapped name is left alone', async () => {

        const fieldInfo = await buildFieldInfo('Account', 'ParentId', 'Text', '<length>20</length>');

        expect(fieldInfo.referenceTo).toBeFalsy();

    });

    test('a parent the map answers that is not a Salesforce api name is refused, like any <referenceTo>', async () => {

        jest.spyOn(StandardFieldParentReferenceMap, 'resolveParentObjectApiName').mockReturnValue('Not An\nApi Name');

        const fieldInfo = await buildFieldInfo('Account', 'ParentId', 'Hierarchy');

        expect(fieldInfo.referenceTo).toBeFalsy();
        expect(fieldInfo.recipeValue).toBe(UNHANDLED_HIERARCHY_RECIPE_VALUE);

    });

});
