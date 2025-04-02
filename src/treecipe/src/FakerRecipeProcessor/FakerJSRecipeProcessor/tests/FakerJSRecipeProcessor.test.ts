import { FakerJSRecipeProcessor } from '../FakerJSRecipeProcessor';
import { FakerJSExpressionMocker } from './mocks/FakerJSExpressionMocker';

import * as fs from 'fs';
import * as yaml from 'js-yaml';


const { faker } = require('@faker-js/faker');

jest.mock('@faker-js/faker', () => ({

  faker: {
    helpers: {
      arrayElement: jest.fn().mockReturnValue('Software'),
    },
  }

}));

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
                                        .mockImplementation(async (fakerJSExpression) => {
                                            const mockedExpressionEval = FakerJSExpressionMocker.getMockValue(fakerJSExpression);
                                            return mockedExpressionEval;
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

    describe('evaluateFakerJSExpression', () => {

        test('should evaluate simple faker expression', async () => {
          // Mock the getFakeValueFromFakerJSExpression method
          const getFakeValueSpy = jest.spyOn(fakerJSRecipeProcessor, 'getFakeValueFromFakerJSExpression')
            .mockResolvedValue('Acme Corp');
    
          const result = await fakerJSRecipeProcessor.evaluateFakerJSExpression(
            "${{ faker.company.name() }}", 
            {}, 
            'Name'
          );
      
            expect(getFakeValueSpy).toHaveBeenCalledWith("${{ faker.company.name() }}");
            expect(result).toBe('Acme Corp');

        });
    
        test('should handle dependent picklist values', async () => {
          
            const fieldValues = {
                'Industry': 'Technology'
            };
    
            const mockDependentPicklistExpression = FakerJSExpressionMocker.getExpectedMockYamlDependentPicklistStructure();

            (faker.helpers.arrayElement as jest.Mock).mockResolvedValue('Software');
      
            const result = await fakerJSRecipeProcessor.evaluateFakerJSExpression(
                mockDependentPicklistExpression, 
                fieldValues, 
                'SubIndustry'
            );
          
            expect(result).toBe('Software');
            expect(faker.helpers.arrayElement).toHaveBeenCalledWith(['Software', 'Hardware', 'Cloud Services']);
          
        });

    });

    describe('prepareFakerDateSyntax', () => {
        
      test('should transform date_between syntax', () => {
          // Mock the createComposableRegex method
          jest.spyOn(fakerJSRecipeProcessor, 'createComposableRegex').mockReturnValue({
            dateBetweenRegex: /date_between\(\{from:\s*['"]?([^'"}]+)['"]?,\s*to:\s*['"]?([^'"}]+)['"]?\}\)/,
            datetimeBetweenRegex: /datetime_between\(\{from:\s*['"]?([^'"}]+)['"]?,\s*to:\s*['"]?([^'"}]+)['"]?\}\)/,
            dateRegex: /date\(\s*['"]?([^'")+]*)['"]?\s*\)/,
            datetimeRegex: /datetime\(\s*['"]?([^'")+]*)['"]?\s*\)/
          });
    
          const result = fakerJSRecipeProcessor.prepareFakerDateSyntax(
            "date_between({from: 'today', to: '+30'})"
          );
    
          expect(result).toBe("dateUtils.date_between({from: 'today', to: '+30'})");
        });
    
        test('should transform datetime syntax', () => {
          // Mock the createComposableRegex method
          jest.spyOn(fakerJSRecipeProcessor, 'createComposableRegex').mockReturnValue({
            dateBetweenRegex: /date_between\(\{from:\s*['"]?([^'"}]+)['"]?,\s*to:\s*['"]?([^'"}]+)['"]?\}\)/,
            datetimeBetweenRegex: /datetime_between\(\{from:\s*['"]?([^'"}]+)['"]?,\s*to:\s*['"]?([^'"}]+)['"]?\}\)/,
            dateRegex: /date\(\s*['"]?([^'")+]*)['"]?\s*\)/,
            datetimeRegex: /datetime\(\s*['"]?([^'")+]*)['"]?\s*\)/
          });
    
          const result = fakerJSRecipeProcessor.prepareFakerDateSyntax(
            "datetime('today')"
          );
    
          expect(result).toBe("dateUtils.datetime('today')");
        });
    });

    describe('dateUtils.parseRelativeDate', () => {

      test('should handle today keyword', () => {
        const mockDate = new Date('2023-01-01T12:00:00Z');
        jest.spyOn(global, 'Date').mockImplementation(() => mockDate as any);
  
        const result = fakerJSRecipeProcessor.dateUtils.parseRelativeDate('today');
        
        expect(result).toEqual(mockDate);
      });
  
      // test('should handle relative days in the future', () => {

      //     const mockDate = new Date('2023-01-01T12:00:00Z');
      //     const futureMockDate = new Date('2023-01-06T12:00:00Z');
          
      //     let currentDate = mockDate;
      //     jest.spyOn(global, 'Date').mockImplementation(() => {
      //         const dateCopy = new Date(currentDate.getTime());
      //         return dateCopy as any;
      //     });
      
      //     // Mock the Date.prototype.setDate to simulate adding days
      //     const originalSetDate = Date.prototype.setDate;
      //     Date.prototype.setDate = jest.fn(function(day) {
      //         if (day === currentDate.getDate() + 5) {
      //         // Simulate adding 5 days
      //         currentDate = futureMockDate;
      //         return futureMockDate.getTime();
      //         }
      //         return originalSetDate.call(this, day);
      //     });
      
      //     const result = fakerJSRecipeProcessor.dateUtils.parseRelativeDate('+5');
          
      //     expect(result).toBe('2023-01-06');
          
      //     // Restore original method
      //     Date.prototype.setDate = originalSetDate;

      // });

    });


    describe('buildWhenConditionRegexMatchForControllingField', () => {

      test('should create regex for matching controlling field expressions', () => {
        const regex = fakerJSRecipeProcessor.buildWhenConditionRegexMatchForControllingField();
        
        const testExpression = "${{ Industry == 'Technology' }}";
        const matches = testExpression.match(regex);
        
        expect(matches).not.toBeNull();
        expect(matches[1].trim()).toBe('Industry');
        expect(matches[2].trim()).toBe("'Technology'");
      });

    });

    describe('getFakeValueFromFakerJSExpression', () => {
      // Define the regex statically for tests
      beforeEach(() => {
        FakerJSRecipeProcessor.regExpressionForSurroundingFakerJSSyntax = /\{\{(.*?)\}\}/g;
      });
  
      test('should return original string when no faker syntax is present', async () => {
        const result = await fakerJSRecipeProcessor.getFakeValueFromFakerJSExpression('plain text');
        expect(result).toBe('plain text');
      });
  
      test('should process a single faker expression', async () => {
        // Spy on the getFakerJSExpressionEvaluation method
        jest.spyOn(fakerJSRecipeProcessor, 'getFakerJSExpressionEvaluation').mockReturnValue('John');
        
        const result = await fakerJSRecipeProcessor.getFakeValueFromFakerJSExpression('Name: {{faker.name.firstName()}}');
        
        expect(fakerJSRecipeProcessor.getFakerJSExpressionEvaluation).toHaveBeenCalledWith('faker.name.firstName()');
        expect(result).toBe('Name: John');
      });
  
      test('should process multiple faker expressions', async () => {

        const mockImplementation = (code) => {
          if (code === 'faker.name.firstName()') { return 'John';}
          if (code === 'faker.internet.email()') { return 'john@example.com';}
          return '';
        };
      
        jest.spyOn(fakerJSRecipeProcessor, 'getFakerJSExpressionEvaluation').mockImplementation(mockImplementation);
        
        const result = await fakerJSRecipeProcessor.getFakeValueFromFakerJSExpression('{{faker.name.firstName()}} has email {{faker.internet.email()}}');
        
        expect(fakerJSRecipeProcessor.getFakerJSExpressionEvaluation).toHaveBeenCalledTimes(2);
        expect(result).toBe('John has email john@example.com');

      });
  
      test('should process nested expressions in correct order', async () => {
        const mockImplementation = (code) => {
          if (code === 'faker.name.firstName()') {return 'John';}
          if (code === 'faker.random.number()') {return '42';}
          return '';
        };
        
        jest.spyOn(fakerJSRecipeProcessor, 'getFakerJSExpressionEvaluation').mockImplementation(mockImplementation);
        
        const result = await fakerJSRecipeProcessor.getFakeValueFromFakerJSExpression('Outer {{faker.name.firstName()}} with {{faker.random.number()}}');
        
        expect(fakerJSRecipeProcessor.getFakerJSExpressionEvaluation).toHaveBeenCalledTimes(2);
        expect(result).toBe('Outer John with 42');
      });
  
      test('should handle whitespace in expressions', async () => {

        jest.spyOn(fakerJSRecipeProcessor, 'getFakerJSExpressionEvaluation').mockReturnValue('John');
        
        const result = await fakerJSRecipeProcessor.getFakeValueFromFakerJSExpression('Name: {{  faker.name.firstName()  }}');
        
        expect(fakerJSRecipeProcessor.getFakerJSExpressionEvaluation).toHaveBeenCalledWith('faker.name.firstName()');
        expect(result).toBe('Name: John');
      });
    });
  

 

});