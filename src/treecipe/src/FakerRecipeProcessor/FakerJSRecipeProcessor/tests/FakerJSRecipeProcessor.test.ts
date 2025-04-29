import { CollectionsApiService } from '../../../CollectionsApiService/CollectionsApiService';
import { RecipeMockService } from '../../../RecipeService/tests/mocks/RecipeMockService';
import { FakerJSRecipeProcessor } from '../FakerJSRecipeProcessor';
import { FakerJSExpressionMocker } from './mocks/FakerJSExpressionMocker';

import * as fs from 'fs';
import * as yaml from 'js-yaml';


import { faker } from '@faker-js/faker';

// jest.mock('@faker-js/faker', () => ({

//   faker: {
//     helpers: {
//       arrayElement: jest.fn()
//     },
//   }

// }));

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


        test('should process complex YAML file and generate fake data', async () => {

          const mockYamlContent = RecipeMockService.getFakerJSExpectedEvertyingExampleFullObjectRecipeMarkup();
          
          jest.spyOn(fs, 'readFileSync').mockReturnValue(mockYamlContent);
          
          // creating yaml.load "spy" to check what is being passed into the load argument
          // this argument should be mockYamlContent as its the mock value used for fs.readFileSync
          jest.spyOn(yaml, 'load');

          // Mock the evaluateFakerJSExpression method
          // const expressionEvalSpy = jest.spyOn(fakerJSRecipeProcessor, 'evaluateFakerJSExpression')
          //                             .mockImplementation(async (fakerJSExpression) => {
          //                                 const mockedExpressionEval = FakerJSExpressionMocker.getMockValue(fakerJSExpression);
          //                                 return mockedExpressionEval;
          //                             }
          //                         );
  
          const fakeTestFile = 'test.yaml';                        
          const result = await fakerJSRecipeProcessor.generateFakeDataBySelectedRecipeFile(fakeTestFile);


              
          const transformed: Map<string, CollectionsApiJsonStructure>  = fakerJSRecipeProcessor.transformFakerJsonDataToCollectionApiFormattedFilesBySObject(result);

          // transformed.forEach((collectionsApiContent, sobjectApiName) => {

          //     CollectionsApiService.createCollectionsApiFile(
          //         sobjectApiName, 
          //         collectionsApiContent, 
          //         'fullPathToStoreDatasetFiles'
          //     );
              
          // });

          expect(fs.readFileSync).toHaveBeenCalledWith(fakeTestFile, 'utf8');

          // below expect assert will not work without spy
          expect(yaml.load).toHaveBeenCalledWith(mockYamlContent);

          const parsedResult = JSON.parse(result);

          expect(parsedResult.length).toBe(2);
          // expect(parsedResult[0].object).toBe('Account');
          // expect(parsedResult[0].nickname).toBe('standard_account');
          // expect(parsedResult[0].fields.Name).toBe('Acme Corp');
          // expect(parsedResult[0].fields.Description).toBe('Innovative solutions');

      });

    });

    describe('transformFakerJsonDataToCollectionApiFormattedFilesBySObject', () => {
        
        test('should transform faker JSON to collection API format', () => {
                      
            const fakeAccountYamlRecipeObjectStructure = FakerJSExpressionMocker.getFakeAccountYamlRecipeObjectStructure();
            const fakeAccountRecipeYamlContent = JSON.stringify(fakeAccountYamlRecipeObjectStructure);
    
            const actualMappedSObjectApiToRecords = fakerJSRecipeProcessor.transformFakerJsonDataToCollectionApiFormattedFilesBySObject(fakeAccountRecipeYamlContent);
        
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

          const getFakeValueSpy = jest.spyOn(fakerJSRecipeProcessor, 'getFakeValueFromFakerJSExpression')
          const result = await fakerJSRecipeProcessor.evaluateFakerJSExpression(
            "${{ faker.company.name() }}", 
            {}, 
            'Name'
          );
      
            expect(getFakeValueSpy).toHaveBeenCalledWith("${{ faker.company.name() }}");

        });
    
        test('should handle dependent picklist values', async () => {
          
            const fieldValues = {
                'Industry': 'Technology'
            };
    
            const mockDependentPicklistExpression = FakerJSExpressionMocker.getExpectedMockYamlDependentPicklistStructure();

            jest.spyOn(faker.helpers, 'arrayElement');
      
            const result = await fakerJSRecipeProcessor.evaluateFakerJSExpression(
                mockDependentPicklistExpression, 
                fieldValues, 
                'SubIndustry'
            );
          
            expect(faker.helpers.arrayElement).toHaveBeenCalledWith(['Software', 'Hardware', 'Cloud Services']);
          
        });

    });

    describe('prepareFakerDateSyntax', () => {
        
        test('should transform date_between syntax', () => {
    
          const result = fakerJSRecipeProcessor.prepareFakerDateSyntax(
            "date_between({from: 'today', to: '+30'})"
          );
    
          expect(result).toBe("dateUtils.date_between({from: 'today', to: '+30'})");

        });
    
        test('should transform datetime syntax', () => {
    
          const result = fakerJSRecipeProcessor.prepareFakerDateSyntax(
            "datetime('today')"
          );
    
          expect(result).toBe("dateUtils.datetime('today')");
        });

    });

    describe('dateUtils.parseRelativeDate', () => {

      test('should handle today keyword when no DateTime boolean is provided', () => {

        const mockDate = new Date('2023-01-01');
        jest.spyOn(global, 'Date').mockImplementation(() => mockDate as any);
  
        const actualResult = fakerJSRecipeProcessor.dateUtils.parseRelativeDate('today');
        
        const expectedResultForMockedDate = mockDate.toISOString().split("T")[0];
        expect(actualResult).toEqual(expectedResultForMockedDate);

      });

      test('should handle today keyword when DateTime boolean IS provided', () => {

        const mockDate = new Date('2023-01-01T12:00:00Z');
        jest.spyOn(global, 'Date').mockImplementation(() => mockDate as any);
  
        const actualResult = fakerJSRecipeProcessor.dateUtils.parseRelativeDate('today', true);
        const expectedResultForMockedDate = mockDate.toISOString();

        expect(actualResult).toEqual(expectedResultForMockedDate);

      });
      
      test('should handle relative days in the future', () => {
          
          let currentDate = new Date();
          const expectedDaysInFuture = 377;

          const futureExpectedDate:Date = new Date(currentDate.setDate(currentDate.getDate() + expectedDaysInFuture));
      
          const parsedDate = fakerJSRecipeProcessor.dateUtils.parseRelativeDate(`+${expectedDaysInFuture}`);
          
          // to focus on just date, parse to ISO string and split off the time element
          const futureExpectedDateTrimmedOfIsoString =  futureExpectedDate.toISOString().split('T')[0];
          expect(parsedDate).toBe(futureExpectedDateTrimmedOfIsoString);

      });

      test('should handle relative days in the past', () => {
          
        let currentDate = new Date();
        const expectedDaysInPast = 15;
        const pastExpectedDate:Date = new Date(currentDate.setDate(currentDate.getDate() - expectedDaysInPast));
    
        const parsedDate = fakerJSRecipeProcessor.dateUtils.parseRelativeDate(`-${expectedDaysInPast}`);
        
        // to focus on just date, parse to ISO string and split off the time element
        const pastExpectedDateTrimmedOfIsoString =  pastExpectedDate.toISOString().split('T')[0];
        expect(parsedDate).toBe(pastExpectedDateTrimmedOfIsoString);

      });

      test('given invalid Javascript date expression, should return value combined with todo to check the date', () => {
        
        const dateExpression = "new Date('2023-01-01')";
        const actualParsedDate = fakerJSRecipeProcessor.dateUtils.parseRelativeDate(dateExpression);
        
        const expectedTodoValue = `${dateExpression} ### TODO: THIS MAY NOT BE A VALID DATE VALUE`;
        expect(actualParsedDate).toBe(expectedTodoValue);

      });

      test('given valid YYYY-MM-DD match with no surrounding characters outside of quotes, should return and stop parsing for relative date', () => {
        
        const dateExpression = "2023-01-01";
        const actualParsedDate = fakerJSRecipeProcessor.dateUtils.parseRelativeDate(dateExpression);
        
        expect(actualParsedDate).toBe(dateExpression);

      });

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
  
      test('should return original string when no faker syntax is present', async () => {
        const result = await fakerJSRecipeProcessor.getFakeValueFromFakerJSExpression('plain text');
        expect(result).toBe('plain text');
      });

      test('should process multiple faker expressions', async () => {

        const mockImplementation = (code) => {
          if (code === 'faker.person.firstName()') { return 'John';}
          if (code === 'faker.internet.email()') { return 'john@example.com';}
          return '';
        };
      
        jest.spyOn(fakerJSRecipeProcessor, 'getFakerJSExpressionEvaluation').mockImplementation(mockImplementation);
        
        const result = await fakerJSRecipeProcessor.getFakeValueFromFakerJSExpression('${{faker.person.firstName()}} has email ${{faker.internet.email()}}');
        
        expect(fakerJSRecipeProcessor.getFakerJSExpressionEvaluation).toHaveBeenCalledTimes(2);
        expect(result).toBe('John has email john@example.com');

      });
  
      test('should process nested expressions in correct order', async () => {
        const mockImplementation = (code) => {
          if (code === 'faker.person.firstName()') {
            return 'John';
          }
          if (code === 'faker.random.number()') {
            return '42';
          }
          return '';
        };
        
        jest.spyOn(fakerJSRecipeProcessor, 'getFakerJSExpressionEvaluation').mockImplementation(mockImplementation);
        
        const result = await fakerJSRecipeProcessor.getFakeValueFromFakerJSExpression('Outer ${{faker.person.firstName()}} with ${{faker.random.number()}}');
        
        expect(fakerJSRecipeProcessor.getFakerJSExpressionEvaluation).toHaveBeenCalledTimes(2);
        expect(result).toBe('Outer John with 42');
        
      });
  
      test('should handle whitespace in expressions', async () => {

        jest.spyOn(fakerJSRecipeProcessor, 'getFakerJSExpressionEvaluation').mockReturnValue('John');
        
        const result = await fakerJSRecipeProcessor.getFakeValueFromFakerJSExpression('Name: ${{  faker.person.firstName()  }}');
        
        expect(fakerJSRecipeProcessor.getFakerJSExpressionEvaluation).toHaveBeenCalledWith('faker.person.firstName()');
        expect(result).toBe('Name: John');

      });

    });

    describe('getExpectedDateRegExPatterns', () => {

        const dateRegExPatterns = fakerJSRecipeProcessor.getExpectedDateRegExPatterns();

        test('thinking', () => {



          const result = fakerJSRecipeProcessor.prepareFakerDateSyntax(
            "date_between({from: 'today', to: '+30'})"
          );
    
          expect(result).toBe("dateUtils.date_between({from: 'today', to: '+30'})");

        
        });
      



    });
 

});