import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as vscode from 'vscode';
import { ConfigurationService } from '../../ConfigurationService/ConfigurationService';
import { RecipeFakerServiceFactory } from '../../FakerRecipeProcessor/RecipeFakerServiceFactory';
import { DirectoryProcessor } from '../DirectoryProcessor';
import { FieldInfo } from '../../ObjectInfoWrapper/FieldInfo';
import { IRecipeFakerService } from '../../RecipeFakerService.ts/IRecipeFakerService';
import { FakerJSRecipeFakerService } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { RecipeService } from '../../RecipeService/RecipeService';

jest.mock('vscode', () => ({
    workspace: { workspaceFolders: undefined, fs: { readDirectory: jest.fn(), readFile: jest.fn() } },
    Uri: {
        file: (fsPath: string) => ({ fsPath }),
        joinPath: (baseUri: { fsPath: string }, fileName: string) => ({ fsPath: `${baseUri.fsPath}/${fileName}` })
    },
    window: { showWarningMessage: jest.fn() },
    FileType: { Directory: 2, File: 1, SymbolicLink: 64 }
}), { virtual: true });

const MISSING_TYPE_TODO = '### TODO -- REVIEW THIS LINE TO DETERMINE IF IT SHOULD BE REMOVED';

const FIXTURE_OBJECTS_PATH = path.resolve(__dirname, 'mocks/StandardCompoundAddressSalesforceMetadataDirectory/objects');

// WHAT A RETRIEVE WRITES FOR A STANDARD ADDRESS: NO <type>, NO <label>
const buildTypelessFieldXml = (fieldApiName: string) => `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>${fieldApiName}</fullName>
    <trackFeedHistory>false</trackFeedHistory>
</CustomField>`;

const buildTextFieldXml = (fieldApiName: string) => `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>${fieldApiName}</fullName>
    <label>${fieldApiName}</label>
    <length>40</length>
    <type>Text</type>
</CustomField>`;

const readFixtureFieldFiles = (objectApiName: string): Record<string, string> => {

    const fieldsDirectoryPath = path.join(FIXTURE_OBJECTS_PATH, objectApiName, 'fields');
    return Object.fromEntries(fs.readdirSync(fieldsDirectoryPath).map(fieldFileName => [
        fieldFileName,
        fs.readFileSync(path.join(fieldsDirectoryPath, fieldFileName), 'utf8')
    ]));

};

const ADDRESS_PARTS = ['Street', 'City', 'State', 'PostalCode', 'Country'];
const partsOf = (prefix: string): string[] => ADDRESS_PARTS.map(addressPart => `${prefix}${addressPart}`);

describe.each([
    ['faker-js', () => new FakerJSRecipeFakerService(), '${{faker.location.streetAddress()}}'],
    ['snowfakery', () => new SnowfakeryRecipeFakerService(), '${{fake.street_address}}']
] as const)('DirectoryProcessor standard compound addresses with the %s backend (#694)', (unusedBackend, createFakerService: () => IRecipeFakerService, expectedStreetValue) => {

    let directoryProcessor: DirectoryProcessor;
    let standardFieldMappings: Record<string, Record<string, string>>;
    let addressComponentValues: Record<string, string>;

    beforeEach(() => {

        jest.spyOn(RecipeFakerServiceFactory, 'getFakerImplementationByExtensionConfigSelection').mockImplementation(createFakerService);
        jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue([]);
        jest.spyOn(ConfigurationService, 'getCustomRelationshipMappings').mockReturnValue({});
        directoryProcessor = new DirectoryProcessor();
        standardFieldMappings = createFakerService().getOOTBObjectApiNameToFieldApiNameMap();
        addressComponentValues = createFakerService().getAddressComponentToRecipeValueMap();

    });

    const walkFields = async (objectApiName: string, xmlByFieldFileName: Record<string, string>): Promise<FieldInfo[]> => {

        jest.spyOn(vscode.workspace.fs, 'readDirectory').mockImplementation(
            () => Promise.resolve(Object.keys(xmlByFieldFileName).map(fieldFileName => [fieldFileName, vscode.FileType.File])) as any
        );
        jest.spyOn(vscode.workspace.fs, 'readFile').mockImplementation(
            (fieldUri: any) => Promise.resolve(Buffer.from(xmlByFieldFileName[path.basename(fieldUri.fsPath)])) as any
        );

        return await directoryProcessor.processFieldsDirectory(
            vscode.Uri.file(`/fake/${objectApiName}/fields`),
            objectApiName,
            {},
            standardFieldMappings
        );

    };

    const fieldNamesOf = (fieldInfos: FieldInfo[]): string[] => fieldInfos.map(fieldInfo => fieldInfo.fieldName);

    describe('isCompoundAddressField', () => {

        test.each([
            ['Quote', 'BillingAddress'], ['Quote', 'AdditionalAddress'], ['Order', 'ShippingAddress'],
            ['WorkOrder', 'Address'], ['Account', 'PersonMailingAddress'], ['Lead', 'Address']
        ])('a typeless %s.%s is a compound address', (objectApiName, fieldApiName) => {

            expect(directoryProcessor.isCompoundAddressField({ fieldName: fieldApiName, type: 'AUTO_GENERATED' } as FieldInfo, objectApiName)).toBe(true);

        });

        test('no field info at all is not a compound address, and does not throw', () => {

            expect(directoryProcessor.isCompoundAddressField(undefined as unknown as FieldInfo, 'Quote')).toBe(false);
            expect(directoryProcessor.isCompoundAddressField({ type: 'AUTO_GENERATED' } as FieldInfo, 'Quote')).toBe(false);

        });

        test.each([
            ['Widget__c', 'BillingAddress'], ['Order', 'QuoteToAddress'], ['Quote', 'Address'], ['Case', 'Address'], ['constructor', 'Address']
        ])('a typeless %s.%s is not', (objectApiName, fieldApiName) => {

            expect(directoryProcessor.isCompoundAddressField({ fieldName: fieldApiName, type: 'AUTO_GENERATED' } as FieldInfo, objectApiName)).toBe(false);

        });

    });

    describe('an object whose address field files were not retrieved', () => {

        test('a Quote gets every part of its four addresses', async () => {

            const fieldInfos = await walkFields('Quote', { 'Quote_Note__c.field-meta.xml': buildTextFieldXml('Quote_Note__c') });

            expect(fieldNamesOf(fieldInfos)).toEqual([
                'Quote_Note__c', ...partsOf('Billing'), ...partsOf('Shipping'), ...partsOf('QuoteTo'), ...partsOf('Additional')
            ]);
            expect(fieldInfos.find(fieldInfo => fieldInfo.fieldName === 'QuoteToStreet')?.recipeValue).toBe(expectedStreetValue);

        });

        test.each([
            ['Order', [...partsOf('Billing'), ...partsOf('Shipping')]],
            ['ServiceContract', [...partsOf('Billing'), ...partsOf('Shipping')]],
            ['WorkOrder', ADDRESS_PARTS],
            ['ServiceAppointment', ADDRESS_PARTS],
            ['Asset', ADDRESS_PARTS],
            ['User', ADDRESS_PARTS]
        ])('%s gets its address parts', async (objectApiName, expectedPartNames) => {

            const fieldInfos = await walkFields(objectApiName, {});

            expect(fieldNamesOf(fieldInfos)).toEqual(expectedPartNames);
            expect(Object.fromEntries(fieldInfos.map(fieldInfo => [fieldInfo.fieldName.slice(-6), fieldInfo.recipeValue])))
                .toEqual(expect.objectContaining({ Street: addressComponentValues.Street }));

        });

        test('each part is labelled by the address it belongs to', async () => {

            const fieldInfos = await walkFields('Quote', {});

            expect(fieldInfos.slice(0, 2).map(fieldInfo => fieldInfo.fieldLabel)).toEqual(['Bill To Street', 'Bill To City']);

        });

        test.each(['Account', 'Contact', 'Lead'])('%s gains nothing: its standard field map already writes every part', async (objectApiName) => {

            expect(await walkFields(objectApiName, {})).toEqual([]);

        });

        test('Contract writes each Billing and Shipping part once, from its standard field map or as a part', async () => {

            const fieldInfos = await walkFields('Contract', {});
            const writtenFieldApiNames = [...Object.keys(standardFieldMappings.Contract ?? {}), ...fieldNamesOf(fieldInfos)];

            [...partsOf('Billing'), ...partsOf('Shipping')].forEach(partName => {
                expect(writtenFieldApiNames.filter(fieldApiName => fieldApiName === partName)).toHaveLength(1);
            });

        });

        test('a business Account gets no person account address', async () => {

            const fieldInfos = await walkFields('Account', { 'ShippingAddress.field-meta.xml': buildTypelessFieldXml('ShippingAddress') });

            expect(fieldInfos).toEqual([]);

        });

        test('an object with no standard address gets nothing', async () => {

            const fieldInfos = await walkFields('Widget__c', { 'Widget_Note__c.field-meta.xml': buildTextFieldXml('Widget_Note__c') });

            expect(fieldNamesOf(fieldInfos)).toEqual(['Widget_Note__c']);

        });

    });

    describe('an address field file that was retrieved with no <type>', () => {

        test('the Quote fixture writes BillingCity once, from its own file, and no TODO line', async () => {

            const fieldInfos = await walkFields('Quote', readFixtureFieldFiles('Quote'));

            expect(fieldNamesOf(fieldInfos)).toEqual([
                'BillingCity', 'Quote_Note__c',
                ...partsOf('Billing').filter(partName => partName !== 'BillingCity'),
                ...partsOf('Shipping'), ...partsOf('QuoteTo'), ...partsOf('Additional')
            ]);
            expect(fieldInfos[0].type).toBe('Text');
            expect(fieldInfos.some(fieldInfo => String(fieldInfo.recipeValue).includes(MISSING_TYPE_TODO))).toBe(false);

        });

        test('a typeless person account address writes its parts, and the business addresses stay with the standard field map', async () => {

            const fieldInfos = await walkFields('Account', readFixtureFieldFiles('Account'));

            expect(fieldNamesOf(fieldInfos)).toEqual(partsOf('PersonMailing'));
            expect(fieldInfos[0].fieldLabel).toBe('Mailing Address Street');
            expect(fieldInfos[0].recipeValue).toBe(expectedStreetValue);

        });

        test.each([
            ['Account', 'ShippingAddress'], ['Contact', 'OtherAddress'], ['Lead', 'Address']
        ])('%s.%s is no longer a TODO line', async (objectApiName, fieldApiName) => {

            const fieldInfos = await walkFields(objectApiName, { [`${fieldApiName}.field-meta.xml`]: buildTypelessFieldXml(fieldApiName) });

            expect(fieldInfos).toEqual([]);

        });

        test('a typeless field on an object with no standard address is still a TODO line', async () => {

            const fieldInfos = await walkFields('Widget__c', readFixtureFieldFiles('Widget__c'));

            expect(fieldNamesOf(fieldInfos)).toEqual(['Site__c', 'Widget_Note__c']);
            expect(fieldInfos[0].recipeValue).toContain(MISSING_TYPE_TODO);

        });

        test('a configured custom compound address still expands', async () => {

            jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue(['Widget__c.Site__c']);
            directoryProcessor = new DirectoryProcessor();

            const fieldInfos = await walkFields('Widget__c', readFixtureFieldFiles('Widget__c'));

            expect(fieldNamesOf(fieldInfos)).toEqual(['Widget_Note__c', ...ADDRESS_PARTS.map(addressPart => `Site__${addressPart}__s`)]);

        });

    });

    test('a block generated for a selected record type carries the same address lines', async () => {

        const defaultBlockFieldInfos = await walkFields('Order', {});
        const recordTypeBlockFieldInfos = await directoryProcessor.processFieldsDirectory(
            vscode.Uri.file('/fake/Order/fields'), 'Order', {}, standardFieldMappings, 'Retail'
        );

        expect(fieldNamesOf(recordTypeBlockFieldInfos)).toEqual(fieldNamesOf(defaultBlockFieldInfos));

    });

    test('the Quote object recipe it produces loads as YAML with every address part', async () => {

        const fieldInfos = await walkFields('Quote', readFixtureFieldFiles('Quote'));
        const recipeService = new RecipeService(createFakerService());

        let objectRecipe = `- object: Quote\n  nickname: Quote_NickName\n  count: 1\n  fields:`;
        fieldInfos.forEach((fieldInfo) => {
            objectRecipe = recipeService.appendFieldRecipeToObjectRecipe(objectRecipe, fieldInfo.recipeValue, fieldInfo.fieldName);
        });
        const loadedFields = ( yaml.load(objectRecipe) as any[] )[0].fields;

        expect(Object.keys(loadedFields)).toHaveLength(21);
        expect(loadedFields.AdditionalStreet).toBe(expectedStreetValue);

    });

});
