import { ConfigurationService } from '../ConfigurationService/ConfigurationService';
import { IRecipeFakerService } from '../RecipeFakerService.ts/IRecipeFakerService';
import { FakerJSRecipeFakerService } from '../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { IFakerRecipeProcessor } from './IFakerRecipeProcessor';
import { FakerJSRecipeProcessor } from './FakerJSRecipeProcessor/FakerJSRecipeProcessor';
import { SnowfakeryRecipeProcessor } from './SnowfakeryRecipeProcessor/SnowfakeryRecipeProcessor';

/*
    The faker backend the selectedFakerService setting names. It lives with the processors, which already
    import the faker services, so ConfigurationService (platform layer) only reads the setting and
    imports no backend, and no folder cycle forms (#574).
*/
export class RecipeFakerServiceFactory {

    static getFakerImplementationByExtensionConfigSelection(): IRecipeFakerService {

        const fakerConfigurationSelection = ConfigurationService.getSelectedDataFakerServiceConfig();
        switch (fakerConfigurationSelection) {
            case 'snowfakery':
              return new SnowfakeryRecipeFakerService();
            case 'faker-js':
              return new FakerJSRecipeFakerService();
            default:
              throw new Error(`Unknown Faker Service selection: ${fakerConfigurationSelection}`);
          }
    
    }

    static getFakerRecipeProcessorByExtensionConfigSelection(): IFakerRecipeProcessor {

        const fakerConfigurationSelection = ConfigurationService.getSelectedDataFakerServiceConfig();
        switch (fakerConfigurationSelection) {
            case 'snowfakery':
              return new SnowfakeryRecipeProcessor();
            case 'faker-js':
              return new FakerJSRecipeProcessor();
            default:
              throw new Error(`Unknown Faker Recipe Processor selection: ${fakerConfigurationSelection}`);
          }
    
    }

}
