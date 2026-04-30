import { RecipeMockService } from '../../../RecipeService/tests/mocks/RecipeMockService';
import { FakerJSRecipeProcessor } from '../FakerJSRecipeProcessor';

import { FakerJSExpressionMocker } from './mocks/FakerJSExpressionMocker';

import * as fs from 'fs';
import * as yaml from 'js-yaml';

import { faker } from '@faker-js/faker';
import { ProcessedYamlWrapper } from '../../../RecipeFakerService.ts/FakerJSRecipeFakerService/ProcessedYamlWrapper';


// the below mock is required to prevent missing vscode module error when FakerJSRecipeProcessor references service layers that have vscode as a required library
jest.mock('vscode', () => ({}), { virtual: true });


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

            // Mock the evaluateProvidedYamlPropertyValue method
            const expressionEvalSpy = jest.spyOn(fakerJSRecipeProcessor, 'evaluateProvidedYamlPropertyValue')
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
    
            const fakeTestFile = 'test.yaml';                        
            const result = await fakerJSRecipeProcessor.generateFakeDataBySelectedRecipeFile(fakeTestFile);

            expect(fs.readFileSync).toHaveBeenCalledWith(fakeTestFile, 'utf8');

            // below assert will not work without yaml spy
            expect(yaml.load).toHaveBeenCalledWith(mockYamlContent);

            const parsedResult = JSON.parse(result);

            expect(parsedResult.length).toBe(2);
          

        });

        test('should process variable expression syntax in YAML file and generate fake data', async () => {

            const mockVariableYamlContent = RecipeMockService.getDoubleExpressionSmallFakerJSMockVariableExpressionMarkup();
            
            jest.spyOn(fs, 'readFileSync').mockReturnValue(mockVariableYamlContent);
            
            // creating yaml.load "spy" to check what is being passed into the load argument
            // this argument should be mockYamlContent as its the mock value used for fs.readFileSync
            jest.spyOn(yaml, 'load');
    
            const fakeTestFile = 'test.yaml';                        
            const result = await fakerJSRecipeProcessor.generateFakeDataBySelectedRecipeFile(fakeTestFile);

            expect(fs.readFileSync).toHaveBeenCalledWith(fakeTestFile, 'utf8');

            // below assert will not work without yaml spy
            expect(yaml.load).toHaveBeenCalledWith(mockVariableYamlContent);

            const parsedResult = JSON.parse(result);

            expect(parsedResult.length).toBe(1);

        });

    });

    describe('transformFakerJsonDataToCollectionApiFormattedFilesBySObject', () => {
        
        test('for OOTB object, should transform faker JSON to collection API format', () => {
                      
            const fakeAccountYamlRecipeObjectStructure = FakerJSExpressionMocker.getFakeAccountYamlRecipeObjectStructure();
            const fakeAccountRecipeYamlContent = JSON.stringify(fakeAccountYamlRecipeObjectStructure);
    
            const actualMappedSObjectApiToRecords = fakerJSRecipeProcessor.transformFakerJsonDataToCollectionApiFormattedFilesBySObject(fakeAccountRecipeYamlContent);
        
            expect(actualMappedSObjectApiToRecords.size).toBe(2); 
            
            const accountData = actualMappedSObjectApiToRecords.get('Account');
            expect(accountData).toBeDefined();
            expect(accountData.records.length).toBe(2);
            expect(accountData.records[0].attributes.type).toBe('Account');
            expect(accountData.records[0].attributes.referenceId).toBe('Account_Reference_1__standard_account');
            expect(accountData.records[1].attributes.referenceId).toBe('Account_Reference_2__coolNickname');

            expect(accountData.records[0].Name).toBe('Acme Corp');
            
            const contactData = actualMappedSObjectApiToRecords.get('Contact');
            expect(contactData).toBeDefined();
            expect(contactData.records.length).toBe(1);
            expect(contactData.records[0].attributes.type).toBe('Contact');
            expect(contactData.records[0].FirstName).toBe('John');

        });

        test('for custom object, should transform faker JSON to collection API format', () => {
                      
            const fakeProjectFamilyYamlRecipeObjectStructure = FakerJSExpressionMocker.getFakeCustomProjectFamilyYamlRecipeObjectStructure();
            const projectFamiyRecipeYamlContent = JSON.stringify(fakeProjectFamilyYamlRecipeObjectStructure);
    
            const actualMappedSObjectApiToRecords = fakerJSRecipeProcessor.transformFakerJsonDataToCollectionApiFormattedFilesBySObject(projectFamiyRecipeYamlContent);
        
            expect(actualMappedSObjectApiToRecords.size).toBe(2); 
            
            const projectFamilyData = actualMappedSObjectApiToRecords.get('Project_Family__c');
            expect(projectFamilyData).toBeDefined();
            expect(projectFamilyData.records.length).toBe(2);
            expect(projectFamilyData.records[0].attributes.type).toBe('Project_Family__c');
            expect(projectFamilyData.records[0].attributes.referenceId).toBe('Project_Family__c_Reference_1__standard_projfam');
            expect(projectFamilyData.records[1].attributes.referenceId).toBe('Project_Family__c_Reference_2__coolNickname');

            const contactData = actualMappedSObjectApiToRecords.get('Contact');
            expect(contactData).toBeDefined();
            expect(contactData.records.length).toBe(1);
            expect(contactData.records[0].attributes.type).toBe('Contact');
            expect(contactData.records[0].FirstName).toBe('John');

        });

    });

    describe('evaluateProvidedYamlPropertyValue', () => {

        test('should evaluate simple faker expression', async () => {

          const testPopulatedVariableToExistingReferenceMapThatShouldNotImpactEvaluatedExpression = {
              Fruit: "Banana",
              Instrument: "Piano"
          };

          const mockedYamlToExistingProcessYaml = FakerJSExpressionMocker. getFakeAccountYamlRecipeObjectStructure();

          const mockAlreadyProcessedYaml:ProcessedYamlWrapper = {
              ObjectPropertyToExistingProcessedYaml: mockedYamlToExistingProcessYaml,
              VariablePropertyToExistingProcessedYaml: testPopulatedVariableToExistingReferenceMapThatShouldNotImpactEvaluatedExpression
          };

          const getFakeValueSpy = jest.spyOn(fakerJSRecipeProcessor, 'getFakeValueFromFakerJSExpression');
          const result = await fakerJSRecipeProcessor.evaluateProvidedYamlPropertyValue(
            "${{ faker.company.name() }}", 
            {}, 
            'Name',
            mockAlreadyProcessedYaml
          );
      
            expect(getFakeValueSpy).toHaveBeenCalledWith(
              "${{ faker.company.name() }}",
              testPopulatedVariableToExistingReferenceMapThatShouldNotImpactEvaluatedExpression
            );

        });
    
        test('should handle dependent picklist values', async () => {
          
            const fieldValues = {
                'Industry': 'Technology'
            };
    
            const mockDependentPicklistExpression = FakerJSExpressionMocker.getExpectedMockYamlDependentPicklistStructure();

            jest.spyOn(faker.helpers, 'arrayElement');
      
            const result = await fakerJSRecipeProcessor.evaluateProvidedYamlPropertyValue(
                mockDependentPicklistExpression, 
                fieldValues, 
                'SubIndustry',
                null
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
  
        const emptyVariableToExistingReferencesMap:Record<string, any> = null;
        test('should return original string when no faker syntax is present', async () => {
          const result = await fakerJSRecipeProcessor.getFakeValueFromFakerJSExpression('plain text', emptyVariableToExistingReferencesMap);
          expect(result).toBe('plain text');
        });

        test('should process multiple faker expressions', async () => {

           const mockImplementation = (code) => {
              if (code === 'faker.person.firstName()') { return 'John';}
              if (code === 'faker.internet.email()') { return 'john@example.com';}
              return '';
            };
          
            jest.spyOn(fakerJSRecipeProcessor, 'getFakerJSExpressionEvaluation').mockImplementation(mockImplementation);
            
            const result = await fakerJSRecipeProcessor.getFakeValueFromFakerJSExpression('${{faker.person.firstName()}} has email ${{faker.internet.email()}}', emptyVariableToExistingReferencesMap);
            
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
            
            const testPopulatedVariableToExistingReferenceMapThatShouldNotImpactEvaluatedExpression = {
              Fruit: "Banana",
              Instrument: "Piano"
            };
            const result = await fakerJSRecipeProcessor.getFakeValueFromFakerJSExpression('Outer ${{faker.person.firstName()}} with ${{faker.random.number()}}', testPopulatedVariableToExistingReferenceMapThatShouldNotImpactEvaluatedExpression);
            
            expect(fakerJSRecipeProcessor.getFakerJSExpressionEvaluation).toHaveBeenCalledTimes(2);
            expect(result).toBe('Outer John with 42');
          
        }); 
    
        test('should handle whitespace in expressions', async () => {

            jest.spyOn(fakerJSRecipeProcessor, 'getFakerJSExpressionEvaluation').mockReturnValue('John');
            
            const result = await fakerJSRecipeProcessor.getFakeValueFromFakerJSExpression('Name: ${{  faker.person.firstName()  }}', emptyVariableToExistingReferencesMap);
            
            expect(fakerJSRecipeProcessor.getFakerJSExpressionEvaluation).toHaveBeenCalledWith('faker.person.firstName()');
            expect(result).toBe('Name: John');

        });

        test('should handle variable expression evaluation', async () => {

            jest.spyOn(fakerJSRecipeProcessor, 'getFakerJSExpressionEvaluation').mockReturnValue('John');
            
            const expectedVariableKeyToVariableValueMap:Record<string, any> =  {
                DogName: "Rover"
            };
            const result = await fakerJSRecipeProcessor.getFakeValueFromFakerJSExpression('Gonna be some kind of value at the end here:: ${{ var.DogName  }}', expectedVariableKeyToVariableValueMap);
            
            expect(fakerJSRecipeProcessor.getFakerJSExpressionEvaluation).toHaveBeenCalledTimes(0);
            expect(result).toBe('Gonna be some kind of value at the end here:: Rover');

        });

        test('Should handle variable expression and process nested expressions in correct order', async () => {

            const mockImplementation = (code) => {
              if (code === 'faker.person.firstName()') {
                return 'Steve';
              }
              if (code === 'faker.random.number()') {
                return '42';
              }
              return '';
            };
            
            const expectedVariableKeyToVariableValueMap:Record<string, any> =  {
                Car: "Toyota",
                Speed: "Fast"
            };

            jest.spyOn(fakerJSRecipeProcessor, 'getFakerJSExpressionEvaluation').mockImplementation(mockImplementation);
            
            const result = await fakerJSRecipeProcessor.getFakeValueFromFakerJSExpression('Sweet ${{faker.person.firstName()}} has a ${{ var.Speed }} car. ${{faker.random.number()}} competitors have been defeated by his ${{ var.Car }}', expectedVariableKeyToVariableValueMap);
            
            expect(fakerJSRecipeProcessor.getFakerJSExpressionEvaluation).toHaveBeenCalledTimes(2);
            expect(result).toBe('Sweet Steve has a Fast car. 42 competitors have been defeated by his Toyota');
          
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

    describe('processObjectDeclarationForYamlDocumentItem friends block', () => {

        test('recipe with no friends block produces identical output — no regression', async () => {

            const processedYamlWrapper: ProcessedYamlWrapper = {
                ObjectPropertyToExistingProcessedYaml: {},
                VariablePropertyToExistingProcessedYaml: {}
            };

            const entry = {
                object: 'Account',
                nickname: 'plain_account',
                count: 1,
                fields: { Name: 'Acme Corp' }
            };

            const result = await fakerJSRecipeProcessor.processObjectDeclarationForYamlDocumentItem(
                'Account', entry, processedYamlWrapper
            );

            expect(result.ObjectPropertyToExistingProcessedYaml['Account']).toHaveLength(1);
            expect(result.ObjectPropertyToExistingProcessedYaml['Account'][0].nickname).toBe('plain_account');
            expect(result.ObjectPropertyToExistingProcessedYaml['Account'][0].fields.Name).toBe('Acme Corp');
            expect(Object.keys(result.ObjectPropertyToExistingProcessedYaml)).toEqual(['Account']);

        });

        test('single-level friends count=1: child nickname is objectType_parentNickname, lookup field unchanged', async () => {

            const processedYamlWrapper: ProcessedYamlWrapper = {
                ObjectPropertyToExistingProcessedYaml: {},
                VariablePropertyToExistingProcessedYaml: {}
            };

            const entry = {
                object: 'Account',
                nickname: 'topAccount',
                count: 1,
                fields: { Name: 'Acme Corp' },
                friends: [
                    {
                        object: 'Contact',
                        fields: { FirstName: 'Jane', AccountId: 'topAccount' }
                    }
                ]
            };

            const result = await fakerJSRecipeProcessor.processObjectDeclarationForYamlDocumentItem(
                'Account', entry, processedYamlWrapper
            );

            expect(result.ObjectPropertyToExistingProcessedYaml['Account']).toHaveLength(1);
            expect(result.ObjectPropertyToExistingProcessedYaml['Account'][0].nickname).toBe('topAccount');

            expect(result.ObjectPropertyToExistingProcessedYaml['Contact']).toHaveLength(1);
            const childContact = result.ObjectPropertyToExistingProcessedYaml['Contact'][0];
            expect(childContact.nickname).toBe('Contact_topAccount');
            expect(childContact.fields.AccountId).toBe('topAccount');

        });

        test('count > 1 parent: each iteration gets unique nickname and rewrites child lookup fields', async () => {

            const processedYamlWrapper: ProcessedYamlWrapper = {
                ObjectPropertyToExistingProcessedYaml: {},
                VariablePropertyToExistingProcessedYaml: {}
            };

            const entry = {
                object: 'Account',
                nickname: 'multiAccount',
                count: 2,
                fields: { Name: 'Corp Inc' },
                friends: [
                    {
                        object: 'Contact',
                        fields: { FirstName: 'Bob', AccountId: 'multiAccount' }
                    }
                ]
            };

            const result = await fakerJSRecipeProcessor.processObjectDeclarationForYamlDocumentItem(
                'Account', entry, processedYamlWrapper
            );

            expect(result.ObjectPropertyToExistingProcessedYaml['Account']).toHaveLength(2);
            expect(result.ObjectPropertyToExistingProcessedYaml['Account'][0].nickname).toBe('multiAccount_1');
            expect(result.ObjectPropertyToExistingProcessedYaml['Account'][1].nickname).toBe('multiAccount_2');

            expect(result.ObjectPropertyToExistingProcessedYaml['Contact']).toHaveLength(2);

            const firstChild = result.ObjectPropertyToExistingProcessedYaml['Contact'][0];
            const secondChild = result.ObjectPropertyToExistingProcessedYaml['Contact'][1];

            expect(firstChild.nickname).toBe('Contact_multiAccount_1');
            expect(firstChild.fields.AccountId).toBe('multiAccount_1');

            expect(secondChild.nickname).toBe('Contact_multiAccount_2');
            expect(secondChild.fields.AccountId).toBe('multiAccount_2');

        });

        test('multi-level nested friends: grandchild lookup rewired to immediate parent generated nickname', async () => {

            // The Contact has an explicit YAML nickname so the Case can reference it.
            // The processor rewrites the Case's ContactId from the Contact's YAML nickname
            // ('child_contact') to the Contact's generated nickname ('Contact_rootAccount').
            const processedYamlWrapper: ProcessedYamlWrapper = {
                ObjectPropertyToExistingProcessedYaml: {},
                VariablePropertyToExistingProcessedYaml: {}
            };

            const entry = {
                object: 'Account',
                nickname: 'rootAccount',
                count: 1,
                fields: { Name: 'Root Corp' },
                friends: [
                    {
                        object: 'Contact',
                        nickname: 'child_contact',
                        fields: { FirstName: 'Alice', AccountId: 'rootAccount' },
                        friends: [
                            {
                                object: 'Case',
                                fields: { Subject: 'Support Request', ContactId: 'child_contact' }
                            }
                        ]
                    }
                ]
            };

            const result = await fakerJSRecipeProcessor.processObjectDeclarationForYamlDocumentItem(
                'Account', entry, processedYamlWrapper
            );

            expect(result.ObjectPropertyToExistingProcessedYaml['Account']).toHaveLength(1);
            expect(result.ObjectPropertyToExistingProcessedYaml['Contact']).toHaveLength(1);
            expect(result.ObjectPropertyToExistingProcessedYaml['Case']).toHaveLength(1);

            const contact = result.ObjectPropertyToExistingProcessedYaml['Contact'][0];
            expect(contact.nickname).toBe('Contact_rootAccount');
            expect(contact.fields.AccountId).toBe('rootAccount');

            const grandchild = result.ObjectPropertyToExistingProcessedYaml['Case'][0];
            expect(grandchild.nickname).toBe('Case_Contact_rootAccount');
            expect(grandchild.fields.ContactId).toBe('Contact_rootAccount');

        });

        test('mixed objects: entries with and without friends all process correctly', async () => {

            const processedYamlWrapper: ProcessedYamlWrapper = {
                ObjectPropertyToExistingProcessedYaml: {},
                VariablePropertyToExistingProcessedYaml: {}
            };

            const accountEntry = {
                object: 'Account',
                nickname: 'solo_account',
                count: 1,
                fields: { Name: 'Solo Corp' }
            };

            const opportunityEntry = {
                object: 'Opportunity',
                nickname: 'parent_opp',
                count: 1,
                fields: { Name: 'Big Deal' },
                friends: [
                    {
                        object: 'OpportunityLineItem',
                        fields: { Quantity: '1', OpportunityId: 'parent_opp' }
                    }
                ]
            };

            let result = await fakerJSRecipeProcessor.processObjectDeclarationForYamlDocumentItem(
                'Account', accountEntry, processedYamlWrapper
            );
            result = await fakerJSRecipeProcessor.processObjectDeclarationForYamlDocumentItem(
                'Opportunity', opportunityEntry, result
            );

            expect(result.ObjectPropertyToExistingProcessedYaml['Account']).toHaveLength(1);
            expect(result.ObjectPropertyToExistingProcessedYaml['Opportunity']).toHaveLength(1);
            expect(result.ObjectPropertyToExistingProcessedYaml['OpportunityLineItem']).toHaveLength(1);

            const lineItem = result.ObjectPropertyToExistingProcessedYaml['OpportunityLineItem'][0];
            expect(lineItem.nickname).toBe('OpportunityLineItem_parent_opp');
            expect(lineItem.fields.OpportunityId).toBe('parent_opp');

        });

    });

    describe('replaceParentNicknameReferencesInFriendFields', () => {

        test('replaces field values that exactly match the original nickname with the effective nickname', () => {

            const fields = { AccountId: 'top_account', Name: 'Some Name', OtherId: 'unrelated' };
            const result = fakerJSRecipeProcessor.replaceParentNicknameReferencesInFriendFields(
                fields, 'top_account', 'top_account_1'
            );

            expect(result.AccountId).toBe('top_account_1');
            expect(result.Name).toBe('Some Name');
            expect(result.OtherId).toBe('unrelated');

        });

        test('returns fields unchanged when originalNickname equals effectiveNickname (count=1 case)', () => {

            const fields = { AccountId: 'top_account', Name: 'Corp' };
            const result = fakerJSRecipeProcessor.replaceParentNicknameReferencesInFriendFields(
                fields, 'top_account', 'top_account'
            );

            expect(result).toEqual(fields);

        });

        test('returns empty object when fields is undefined', () => {

            const result = fakerJSRecipeProcessor.replaceParentNicknameReferencesInFriendFields(
                undefined, 'top_account', 'top_account_1'
            );

            expect(result).toEqual({});

        });

        test('does not do partial string replacement — only exact field value matches are replaced', () => {

            const fields = { AccountId: 'top_account_extra', Name: 'top_account' };
            const result = fakerJSRecipeProcessor.replaceParentNicknameReferencesInFriendFields(
                fields, 'top_account', 'top_account_1'
            );

            expect(result.AccountId).toBe('top_account_extra');
            expect(result.Name).toBe('top_account_1');

        });

    });

    describe('buildRecipeDataStructureSummary', () => {

        test('flat recipe with no friends produces correct totals', () => {

            const parsedYaml = [
                { object: 'Account', count: 5, fields: {} },
                { object: 'Contact', count: 10, fields: {} }
            ];

            const summary = FakerJSRecipeProcessor.buildRecipeDataStructureSummary(parsedYaml);

            expect(summary).toContain('Account: 5 total');
            expect(summary).toContain('Contact: 10 total');
            expect(summary).toContain('Total records: 15');

        });

        test('recipe with friends block shows per-parent and total counts', () => {

            const parsedYaml = [
                {
                    object: 'Account',
                    count: 2,
                    fields: {},
                    friends: [
                        { object: 'Contact', count: 5, fields: {} }
                    ]
                }
            ];

            const summary = FakerJSRecipeProcessor.buildRecipeDataStructureSummary(parsedYaml);

            expect(summary).toContain('Account: 2 total');
            expect(summary).toContain('Contact: 5 per parent');
            expect(summary).toContain('10 total');
            expect(summary).toContain('Total records: 12');

        });

        test('nested friends produce correct cascading totals', () => {

            const parsedYaml = [
                {
                    object: 'Account',
                    count: 2,
                    fields: {},
                    friends: [
                        {
                            object: 'Contact',
                            count: 3,
                            fields: {},
                            friends: [
                                { object: 'Case', count: 4, fields: {} }
                            ]
                        }
                    ]
                }
            ];

            const summary = FakerJSRecipeProcessor.buildRecipeDataStructureSummary(parsedYaml);

            expect(summary).toContain('Account: 2 total');
            expect(summary).toContain('Contact: 3 per parent');
            expect(summary).toContain('6 total');
            expect(summary).toContain('Case: 4 per parent');
            expect(summary).toContain('24 total');
            expect(summary).toContain('Total records: 32');

        });

    });


});