
export interface IFakerRecipeProcessor {

    isRecipeProcessorSetup(): Promise<boolean>;
    generateFakeDataBySelectedRecipeFile(fullRecipeFileNamePath: string): Promise<string>;
    transformFakerJsonDataToCollectionApiFormattedFilesBySObject(fakerContent: string): Map<string, CollectionsApiJsonStructure>;

    
}

