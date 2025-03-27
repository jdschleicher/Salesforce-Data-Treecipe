
export interface IFakerRecipeProcessor {

    isRecipeProcessorSetup(): Promise<boolean>;
    generateFakeDataBySelectedRecipeFile(fullRecipeFileNamePath: string): Promise<string|unknown>;
    transformFakerJsonDataToCollectionApiFormattedFilesBySObject(fakerContent: string): Map<string, CollectionsApiJsonStructure>;

}

