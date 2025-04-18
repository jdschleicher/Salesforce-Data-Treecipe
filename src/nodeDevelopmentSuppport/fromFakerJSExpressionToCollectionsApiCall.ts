import { FakerJSRecipeProcessor } from "../treecipe/src/FakerRecipeProcessor/FakerJSRecipeProcessor/FakerJSRecipeProcessor";
import { RecipeMockService } from "../treecipe/src/RecipeService/tests/mocks/RecipeMockService";

function processFakerJSExpression() {


    const mockYamlContent = RecipeMockService.getFakerJSExpectedEvertyingExampleFullObjectRecipeMarkup();
              
    const fakerJSRecipeProcessor = new FakerJSRecipeProcessor();
     
      
    const fakeTestFile = 'test.yaml';                        
    const result = await fakerJSRecipeProcessor.generateFakeDataBySelectedRecipeFile(fakeTestFile);

    
                  
              const transformed: Map<string, CollectionsApiJsonStructure>  = fakerJSRecipeProcessor.transformFakerJsonDataToCollectionApiFormattedFilesBySObject(result);
    
              transformed.forEach((collectionsApiContent, sobjectApiName) => {
    
                  CollectionsApiService.createCollectionsApiFile(
                      sobjectApiName, 
                      collectionsApiContent, 
                      'fullPathToStoreDatasetFiles'
                  );
                  
              });
              
}