
export interface IFakerRecipeProcessor {

    isRecipeProcessorSetup(): Promise<boolean>;
    generateFakeDataBySelectedRecipeFile(fullRecipeFileNamePath: string): Promise<string>|Promise<unknown>;
    transformFakerJsonDataToCollectionApiFormattedFilesBySObject(fakerContent: string): Map<string, CollectionsApiJsonStructure>;

    
}

