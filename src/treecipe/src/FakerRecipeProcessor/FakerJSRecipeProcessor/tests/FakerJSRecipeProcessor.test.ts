import * as fs from 'fs';

import * as yaml from 'js-yaml';
import { FakerJSRecipeProcessor } from '../FakerJSRecipeProcessor';


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
            
            const mockParsedData = [
                {
                    object: 'Account',
                    nickname: 'standard_account',
                    count: 2,
                    fields: {
                        Name: "${{ faker.company.name() }}",
                        Description: "${{ faker.company.catchPhrase() }}"
                    }
                }
            ];
    
            // Setup mocks
            jest.spyOn(fs, 'readFileSync').mockReturnValue(mockYamlContent);
            jest.spyOn(yaml, 'load').mockReturnValue(mockParsedData);

            // Mock the evaluateFakerJSExpression method
            const evaluateSpy = jest.spyOn(fakerJSRecipeProcessor, 'evaluateFakerJSExpression')
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
    
            // Execute the method
            const result = await fakerJSRecipeProcessor.generateFakeDataBySelectedRecipeFile('test.yaml');
            
     
    
            // Assertions
            expect(fs.readFileSync).toHaveBeenCalledWith('test.yaml', 'utf8');
            expect(yaml.load).toHaveBeenCalledWith(mockYamlContent);
            expect(evaluateSpy).toHaveBeenCalledTimes(4); // 2 fields × 2 records

            // Parse the result
            const parsedResult = JSON.parse(result);

            expect(parsedResult.length).toBe(2);
            expect(parsedResult[0].object).toBe('Account');
            expect(parsedResult[0].nickname).toBe('standard_account');
            expect(parsedResult[0].fields.Name).toBe('Acme Corp');
            expect(parsedResult[0].fields.Description).toBe('Innovative solutions');

        });


    });





});