import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as vscode from 'vscode';
import { ConfigurationService } from '../../ConfigurationService/ConfigurationService';
import { RecipeFakerServiceFactory } from '../../FakerRecipeProcessor/RecipeFakerServiceFactory';
import { DirectoryProcessor } from '../DirectoryProcessor';
import { FieldInfo } from '../../ObjectInfoWrapper/FieldInfo';
import { ObjectInfoWrapper } from '../../ObjectInfoWrapper/ObjectInfoWrapper';
import { PersonNameObjects } from '../../ObjectInfoWrapper/PersonNameObjects';
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

// WHAT A RETRIEVE WRITES FOR A STANDARD Name FIELD, COMPOUND OR NOT: NO <type>, NO <label>
const TYPELESS_NAME_XML = `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Name</fullName>
    <trackFeedHistory>true</trackFeedHistory>
</CustomField>`;

const buildTypedFieldXml = (fieldApiName: string, typeMarkup: string) => `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>${fieldApiName}</fullName>
    <label>${fieldApiName}</label>
    ${typeMarkup}
</CustomField>`;

const INDIVIDUAL_FIELDS_DIRECTORY_PATH = path.resolve(__dirname, 'mocks/CompoundNameSalesforceMetadataDirectory/objects/Individual/fields');

const readIndividualFixtureFieldFiles = (): Record<string, string> => Object.fromEntries(
    fs.readdirSync(INDIVIDUAL_FIELDS_DIRECTORY_PATH).map(fieldFileName => [
        fieldFileName,
        fs.readFileSync(path.join(INDIVIDUAL_FIELDS_DIRECTORY_PATH, fieldFileName), 'utf8')
    ])
);

describe.each([
    ['faker-js', () => new FakerJSRecipeFakerService(), {
        Salutation: `\${{faker.helpers.arrayElement(['Mr.', 'Ms.', 'Mrs.', 'Dr.'])}}`,
        FirstName: '${{faker.person.firstName()}}',
        LastName: '${{faker.person.lastName()}}'
    }],
    ['snowfakery', () => new SnowfakeryRecipeFakerService(), {
        Salutation: `\${{random_choice('Mr.', 'Ms.', 'Mrs.', 'Dr.')}}`,
        FirstName: '${{fake.first_name}}',
        LastName: '${{fake.last_name}}'
    }]
] as const)('DirectoryProcessor compound Name with the %s backend (#114)', (unusedBackend, createFakerService: () => IRecipeFakerService, expectedNameComponentValues) => {

    let directoryProcessor: DirectoryProcessor;
    let standardFieldMappings: Record<string, Record<string, string>>;

    beforeEach(() => {

        jest.spyOn(RecipeFakerServiceFactory, 'getFakerImplementationByExtensionConfigSelection').mockImplementation(createFakerService);
        jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue([]);
        jest.spyOn(ConfigurationService, 'getCustomRelationshipMappings').mockReturnValue({});
        directoryProcessor = new DirectoryProcessor();
        standardFieldMappings = createFakerService().getOOTBObjectApiNameToFieldApiNameMap();

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

    const toRecipeValueByFieldName = (fieldInfoDetails: FieldInfo[]): Record<string, string> => Object.fromEntries(
        fieldInfoDetails.map(fieldInfo => [fieldInfo.fieldName, fieldInfo.recipeValue])
    );

    describe('isCompoundNameField', () => {

        test.each(PersonNameObjects.objectApiNames)('a typeless Name on %s is compound', (objectApiName) => {

            const typelessNameFieldInfo: any = { fieldName: 'Name', type: 'AUTO_GENERATED' };

            expect(directoryProcessor.isCompoundNameField(typelessNameFieldInfo, objectApiName)).toBe(true);

        });

        test('the person-style objects are Contact, Lead and Individual, and no other', () => {

            expect(PersonNameObjects.objectApiNames).toEqual(['Contact', 'Lead', 'Individual']);

        });

        test.each(['Account', 'Opportunity', 'Product2', 'Pricebook2', 'User', 'Widget__c'])('a typeless Name on %s is plain', (objectApiName) => {

            const typelessNameFieldInfo: any = { fieldName: 'Name', type: 'AUTO_GENERATED' };

            expect(directoryProcessor.isCompoundNameField(typelessNameFieldInfo, objectApiName)).toBe(false);

        });

        test('a Name that declares a type is plain, even on a person-style object', () => {

            expect(directoryProcessor.isCompoundNameField({ fieldName: 'Name', type: 'Text' } as any, 'Individual')).toBe(false);

        });

        test('another typeless field on a person-style object is not a compound Name', () => {

            expect(directoryProcessor.isCompoundNameField({ fieldName: 'Jigsaw', type: 'AUTO_GENERATED' } as any, 'Lead')).toBe(false);

        });

        test('no field info at all does not throw', () => {

            expect(directoryProcessor.isCompoundNameField(undefined as any, 'Contact')).toBe(false);
            expect(directoryProcessor.isCompoundNameField(null as any, undefined as any)).toBe(false);

        });

    });

    describe('Individual, which has no standard field map', () => {

        test('the Individual fixture gets Salutation, FirstName and LastName and no Name line', async () => {

            const fieldInfoDetails = await walkFields('Individual', readIndividualFixtureFieldFiles());

            expect(fieldInfoDetails.map(fieldInfo => fieldInfo.fieldName)).toEqual(['BirthDate', 'Salutation', 'FirstName', 'LastName']);
            expect(toRecipeValueByFieldName(fieldInfoDetails)).toEqual(expect.objectContaining(expectedNameComponentValues));

        });

        test('each component is labelled by its own name', async () => {

            const fieldInfoDetails = await walkFields('Individual', { 'Name.field-meta.xml': TYPELESS_NAME_XML });

            expect(fieldInfoDetails.map(fieldInfo => fieldInfo.fieldLabel)).toEqual(['Salutation', 'FirstName', 'LastName']);

        });

        test('the object recipe it produces loads as YAML with the three components', async () => {

            const fieldInfoDetails = await walkFields('Individual', readIndividualFixtureFieldFiles());
            const recipeService = new RecipeService(createFakerService());

            let objectRecipe = `- object: Individual\n  nickname: Individual_NickName\n  count: 1\n  fields:`;
            fieldInfoDetails.forEach((fieldInfo) => {
                objectRecipe = recipeService.appendFieldRecipeToObjectRecipe(objectRecipe, fieldInfo.recipeValue, fieldInfo.fieldName);
            });
            const loadedFields = ( yaml.load(objectRecipe) as any[] )[0].fields;

            expect(Object.keys(loadedFields)).toEqual(['BirthDate', 'Salutation', 'FirstName', 'LastName']);
            expect(loadedFields).toEqual(expect.objectContaining(expectedNameComponentValues));

        });

        test('an Individual with its own FirstName field file gets FirstName once, from that file', async () => {

            const fieldInfoDetails = await walkFields('Individual', {
                'FirstName.field-meta.xml': buildTypedFieldXml('FirstName', '<length>40</length><type>Text</type>'),
                'Name.field-meta.xml': TYPELESS_NAME_XML
            });

            expect(fieldInfoDetails.map(fieldInfo => fieldInfo.fieldName)).toEqual(['FirstName', 'Salutation', 'LastName']);
            expect(fieldInfoDetails[0].type).toBe('Text');
            expect(fieldInfoDetails[0].recipeValue).not.toBe(expectedNameComponentValues.FirstName);

        });

    });

    describe('record type blocks', () => {

        test('a block generated for a selected record type carries the same name lines as the default block', async () => {

            const defaultBlockFieldInfos = await walkFields('Lead', { 'Name.field-meta.xml': TYPELESS_NAME_XML });

            jest.spyOn(vscode.workspace.fs, 'readDirectory').mockImplementation(
                () => Promise.resolve([['Name.field-meta.xml', vscode.FileType.File]]) as any
            );
            jest.spyOn(vscode.workspace.fs, 'readFile').mockImplementation(() => Promise.resolve(Buffer.from(TYPELESS_NAME_XML)) as any);
            const recordTypeBlockFieldInfos = await directoryProcessor.processFieldsDirectory(
                vscode.Uri.file('/fake/Lead/fields'), 'Lead', {}, standardFieldMappings, 'Partner_Lead'
            );

            expect(toRecipeValueByFieldName(recordTypeBlockFieldInfos)).toEqual(toRecipeValueByFieldName(defaultBlockFieldInfos));
            expect(recordTypeBlockFieldInfos.map(fieldInfo => fieldInfo.fieldName)).toEqual(['Salutation']);

        });

    });

    describe('a validation rule that names the compound Name or one of its parts', () => {

        const NOT_READ_REASON = 'is not a field Treecipe read from this object\'s fields folder';

        const recordNotAppliedRule = async (objectApiName: string, ruleFieldReference: string, xmlByFieldFileName: Record<string, string>) => {

            const ruleConstraint: any = { fieldReference: ruleFieldReference };
            const ruleConstraintsByField = new Map([[ruleFieldReference.toLowerCase(), [ruleConstraint]]]);
            const fieldsInfo = await walkFields(objectApiName, xmlByFieldFileName);
            const objectInfoWrapper = new ObjectInfoWrapper();
            objectInfoWrapper.addKeyToObjectInfoMap(objectApiName);
            objectInfoWrapper.ObjectToObjectInfoMap[objectApiName].FullRecipe = '';

            directoryProcessor.recordValidationRulesNotApplied(
                objectInfoWrapper,
                objectApiName,
                [{ ruleName: 'Person_Rule', constraint: ruleConstraint } as any],
                ruleConstraintsByField,
                fieldsInfo,
                standardFieldMappings
            );

            return objectInfoWrapper.ObjectToObjectInfoMap[objectApiName];

        };

        test.each(['Contact', 'Lead', 'Individual'])('a rule on %s.Name says Name is a read-only compound, not that it was not read', async (objectApiName) => {

            const objectInfo = await recordNotAppliedRule(objectApiName, 'Name', { 'Name.field-meta.xml': TYPELESS_NAME_XML });

            const expectedReason = `Name on ${objectApiName} is a read-only compound of Salutation, FirstName, LastName, so no Name value is generated`;
            expect(objectInfo.ValidationRulesNotApplied).toEqual([{ ruleName: 'Person_Rule', reason: expectedReason }]);
            expect(objectInfo.FullRecipe).toContain(`### TODO -- VALIDATION RULE NOT APPLIED -- "Person_Rule" -- ${expectedReason}`);
            expect(objectInfo.FullRecipe).not.toContain(NOT_READ_REASON);

        });

        test('a rule on a part the expansion wrote (Lead.Salutation) says where the part comes from', async () => {

            const objectInfo = await recordNotAppliedRule('Lead', 'salutation', { 'Name.field-meta.xml': TYPELESS_NAME_XML });

            expect(objectInfo.ValidationRulesNotApplied[0].reason)
                .toBe("Salutation is written as a part of Lead's compound Name, which validation rules do not change");

        });

        test.each(['Salutation', 'FirstName', 'LastName'])('a rule on Individual.%s says where the part comes from', async (namePartApiName) => {

            const objectInfo = await recordNotAppliedRule('Individual', namePartApiName, { 'Name.field-meta.xml': TYPELESS_NAME_XML });

            expect(objectInfo.ValidationRulesNotApplied[0].reason)
                .toBe(`${namePartApiName} is written as a part of Individual's compound Name, which validation rules do not change`);

        });

        test('a part the standard field map writes (Contact.FirstName) keeps the standard-field reason', async () => {

            const objectInfo = await recordNotAppliedRule('Contact', 'FirstName', { 'Name.field-meta.xml': TYPELESS_NAME_XML });

            expect(objectInfo.ValidationRulesNotApplied[0].reason)
                .toBe("FirstName is written from Treecipe's standard-field mapping, which validation rules do not change");

        });

        test('a part that was never written (Individual with no Name file) keeps the not-read reason', async () => {

            const objectInfo = await recordNotAppliedRule('Individual', 'Salutation', {});

            expect(objectInfo.ValidationRulesNotApplied[0].reason).toBe(`Salutation ${NOT_READ_REASON}`);

        });

        test('a rule on Name of an object that is not person-style keeps the not-read reason', async () => {

            const objectInfo = await recordNotAppliedRule('Widget__c', 'Name', {});

            expect(objectInfo.ValidationRulesNotApplied[0].reason).toBe(`Name ${NOT_READ_REASON}`);

        });

    });

    describe('objects whose standard field map already writes the components', () => {

        test('Contact gets nothing from its compound Name: the map writes all three', async () => {

            const fieldInfoDetails = await walkFields('Contact', { 'Name.field-meta.xml': TYPELESS_NAME_XML });

            expect(fieldInfoDetails).toEqual([]);
            expect(standardFieldMappings.Contact).toEqual(expect.objectContaining(expectedNameComponentValues));

        });

        test('Lead gets only Salutation, the one component its map does not write', async () => {

            const fieldInfoDetails = await walkFields('Lead', { 'Name.field-meta.xml': TYPELESS_NAME_XML });

            expect(toRecipeValueByFieldName(fieldInfoDetails)).toEqual({ Salutation: expectedNameComponentValues.Salutation });

        });

    });

    describe('a plain Name is written as before', () => {

        // WHICH OF THE TWO A STANDARD OBJECT GETS DEPENDS ON ITS BACKEND'S MAP (faker-js MAPS NO Pricebook2), NEVER ON THIS CHANGE
        test.each(['Account', 'Opportunity', 'Product2', 'Pricebook2'])('a typeless Name on %s is the map\'s Name or one TODO line, and no component', async (objectApiName) => {

            const fieldInfoDetails = await walkFields(objectApiName, { 'Name.field-meta.xml': TYPELESS_NAME_XML });

            if ( standardFieldMappings[objectApiName]?.Name ) {
                expect(fieldInfoDetails).toEqual([]);
            } else {
                expect(fieldInfoDetails.map(fieldInfo => fieldInfo.fieldName)).toEqual(['Name']);
                expect(fieldInfoDetails[0].recipeValue).toContain(MISSING_TYPE_TODO);
            }

        });

        test('Account and Opportunity have a mapped Name in this backend, and faker-js Pricebook2 has the TODO line', async () => {

            expect(standardFieldMappings.Account.Name).toBeTruthy();
            expect(standardFieldMappings.Opportunity.Name).toBeTruthy();

            const fakerJSMappings = new FakerJSRecipeFakerService().getOOTBObjectApiNameToFieldApiNameMap();
            expect(fakerJSMappings.Pricebook2?.Name).toBeUndefined();

        });

        test('a custom object Text Name is one writable Name line', async () => {

            const fieldInfoDetails = await walkFields('Widget__c', {
                'Name.field-meta.xml': buildTypedFieldXml('Name', '<length>80</length><type>Text</type>')
            });

            expect(fieldInfoDetails.map(fieldInfo => fieldInfo.fieldName)).toEqual(['Name']);
            expect(fieldInfoDetails[0].recipeValue).not.toContain('TODO');

        });

        test('a custom object AutoNumber Name is written exactly as an AutoNumber field of any other name', async () => {

            const autoNumberMarkup = '<displayFormat>W-{0000}</displayFormat><type>AutoNumber</type>';
            const nameFieldInfoDetails = await walkFields('Widget__c', { 'Name.field-meta.xml': buildTypedFieldXml('Name', autoNumberMarkup) });
            const otherFieldInfoDetails = await walkFields('Widget__c', { 'Serial__c.field-meta.xml': buildTypedFieldXml('Serial__c', autoNumberMarkup) });

            expect(nameFieldInfoDetails.map(fieldInfo => fieldInfo.fieldName)).toEqual(['Name']);
            expect(nameFieldInfoDetails[0].recipeValue).toBe(otherFieldInfoDetails[0].recipeValue);

        });

    });

});
