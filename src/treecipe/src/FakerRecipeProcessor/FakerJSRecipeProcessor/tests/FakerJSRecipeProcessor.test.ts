import * as fs from 'fs';

import * as yaml from 'js-yaml';
import { FakerJSRecipeProcessor } from '../FakerJSRecipeProcessor';
import { FakerJSExpressionMocker } from './mocks/FakerJSExpressionMocker';


describe('Shared FakerJSRecipeProcessor tests', () => {

    const fakerJSRecipeProcessor = new FakerJSRecipeProcessor();

    describe('generateFakeDataBySelectedRecipeFile', () => {
        
        test('should process YAML file and generate fake data', async () => {

            const mockYamlContent = `
  - object: Account
    nickname: standard_account
    count: 2
    fields:
      Name: "\${{ faker.company.name() }}"
      Description: "\${{ faker.company.catchPhrase() }}"
`;
            
            jest.spyOn(fs, 'readFileSync').mockReturnValue(mockYamlContent);
            
            // creating yaml.load "spy" to check what is being passed into the load argument
            // this argument should be mockYamlContent as its the mock value used for fs.readFileSync
            jest.spyOn(yaml, 'load');

            // Mock the evaluateFakerJSExpression method
            const expressionEvalSpy = jest.spyOn(fakerJSRecipeProcessor, 'evaluateFakerJSExpression')
                                        .mockImplementation(async (expr) => {
                                            if ( expr === "${{ faker.company.name() }}" ) {
                                                return "Acme Corp";
                                            } 
                                            if ( expr === "${{ faker.company.catchPhrase() }}" ) {
                                                return "Innovative solutions";
                                            }
                                            return "";
                                        }
                                    );
    
            const fakeTestFile = 'test.yaml';                        
            const result = await fakerJSRecipeProcessor.generateFakeDataBySelectedRecipeFile(fakeTestFile);
                
            // Assertions
            expect(fs.readFileSync).toHaveBeenCalledWith(fakeTestFile, 'utf8');

            // below expect assert will not work without spy
            expect(yaml.load).toHaveBeenCalledWith(mockYamlContent);

            expect(expressionEvalSpy).toHaveBeenCalledTimes(4); // count is set to 2 and there are 2 fields that have to be evaluated, (2x2=4)

            const parsedResult = JSON.parse(result);

            expect(parsedResult.length).toBe(2);
            expect(parsedResult[0].object).toBe('Account');
            expect(parsedResult[0].nickname).toBe('standard_account');
            expect(parsedResult[0].fields.Name).toBe('Acme Corp');
            expect(parsedResult[0].fields.Description).toBe('Innovative solutions');

        });


    });

    describe('transformFakerJsonDataToCollectionApiFormattedFilesBySObject', () => {

        test('given expected fakerContent', () => {

        });

    });

    describe('transformFakerJsonDataToCollectionApiFormattedFilesBySObject', () => {
        
        test('should transform faker JSON to collection API format', () => {
          
            const fakerContent = FakerJSExpressionMocker.getMockYamlRecipeContent();
            const actualMappedSObjectApiToRecords = fakerJSRecipeProcessor.transformFakerJsonDataToCollectionApiFormattedFilesBySObject(fakerContent);
        
            expect(actualMappedSObjectApiToRecords.size).toBe(2); 
            
            const accountData = actualMappedSObjectApiToRecords.get('Account');
            expect(accountData).toBeDefined();
            expect(accountData.records.length).toBe(2);
            expect(accountData.records[0].attributes.type).toBe('Account');
            expect(accountData.records[0].attributes.referenceId).toBe('Account_Reference_1');
            expect(accountData.records[0].Name).toBe('Acme Corp');
            
            const contactData = actualMappedSObjectApiToRecords.get('Contact');
            expect(contactData).toBeDefined();
            expect(contactData.records.length).toBe(1);
            expect(contactData.records[0].attributes.type).toBe('Contact');
            expect(contactData.records[0].FirstName).toBe('John');

        });

      });





});