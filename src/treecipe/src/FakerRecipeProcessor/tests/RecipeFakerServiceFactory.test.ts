import { ConfigurationService } from '../../ConfigurationService/ConfigurationService';
import { RecipeFakerServiceFactory } from '../RecipeFakerServiceFactory';
import { FakerJSRecipeFakerService } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { FakerJSRecipeProcessor } from '../FakerJSRecipeProcessor/FakerJSRecipeProcessor';
import { SnowfakeryRecipeProcessor } from '../SnowfakeryRecipeProcessor/SnowfakeryRecipeProcessor';

jest.mock('vscode', () => ({
    workspace: { workspaceFolders: undefined, getConfiguration: jest.fn() },
    window: { showErrorMessage: jest.fn(), showWarningMessage: jest.fn() }
}), { virtual: true });

describe('RecipeFakerServiceFactory -- the backend the selectedFakerService setting names (#574)', () => {

    test.each([
        ['snowfakery', SnowfakeryRecipeFakerService, SnowfakeryRecipeProcessor],
        ['faker-js', FakerJSRecipeFakerService, FakerJSRecipeProcessor]
    ] as const)('given "%s", returns its faker service and its recipe processor', (selectedFakerService, expectedFakerService, expectedRecipeProcessor) => {

        jest.spyOn(ConfigurationService, 'getSelectedDataFakerServiceConfig').mockReturnValue(selectedFakerService);

        expect(RecipeFakerServiceFactory.getFakerImplementationByExtensionConfigSelection()).toBeInstanceOf(expectedFakerService);
        expect(RecipeFakerServiceFactory.getFakerRecipeProcessorByExtensionConfigSelection()).toBeInstanceOf(expectedRecipeProcessor);

    });

    test('given an unknown selection, both throw naming it', () => {

        jest.spyOn(ConfigurationService, 'getSelectedDataFakerServiceConfig').mockReturnValue('unknown-option');

        expect(() => RecipeFakerServiceFactory.getFakerImplementationByExtensionConfigSelection()).toThrow('Unknown Faker Service selection: unknown-option');
        expect(() => RecipeFakerServiceFactory.getFakerRecipeProcessorByExtensionConfigSelection()).toThrow('Unknown Faker Recipe Processor selection: unknown-option');

    });

});
