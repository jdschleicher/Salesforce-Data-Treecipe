
export interface IFakerRecipeProcessor {

    generateFakeDataBySelectedRecipeFile(fullRecipeFileNamePath: string): Promise<string|unknown>;
    transformFakerJsonDataToCollectionApiFormattedFilesBySObject(fakerContent: string): Map<string, CollectionsApiJsonStructure>;

}

