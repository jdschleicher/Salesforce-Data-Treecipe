import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CollectionsApiService } from '../CollectionsApiService';
import { RecipeService } from '../../RecipeService/RecipeService';
import { FakerJSRecipeFakerService } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { FakerJSRecipeProcessor } from '../../FakerRecipeProcessor/FakerJSRecipeProcessor/FakerJSRecipeProcessor';
import { SnowfakeryRecipeProcessor } from '../../FakerRecipeProcessor/SnowfakeryRecipeProcessor/SnowfakeryRecipeProcessor';
import { MockRecordTypeService } from '../../RecordTypeService/tests/MockRecordTypeService';
import { PythonTestHarness } from '../../RecipeFakerService.ts/RecipeYamlScalar/tests/mocks/PythonTestHarness';

jest.mock('vscode', () => ({
    workspace: { workspaceFolders: undefined },
    window: { showErrorMessage: jest.fn(), showWarningMessage: jest.fn(), showInformationMessage: jest.fn() },
    ThemeIcon: jest.fn()
}), { virtual: true });

/*
    A generated recipe, through faker output, to the Collections API JSON the insert sends (#157).
    RecordTypeId used to load as every developer name joined with spaces, and the Id swap turned that
    into several Ids in one value, so a recipe nobody edited could not be inserted.
*/
const OBJECT_API_NAME = 'Example_Everything__c';
const RECORD_TYPE_DETAIL_FROM_TARGET_ORG = {
    records: [
        { SobjectType: OBJECT_API_NAME, DeveloperName: 'OneRecType', Id: '012000000000001AAA' },
        { SobjectType: OBJECT_API_NAME, DeveloperName: 'TwoRecType', Id: '012000000000002AAA' }
    ]
};

const testRequiringPyYaml = PythonTestHarness.testRequiringModules('yaml');

function generateRecipe(recipeService: RecipeService): string {

    return recipeService.initiateRecipeByObjectName(OBJECT_API_NAME, MockRecordTypeService.getMultipleRecordTypeToFieldToRecordTypeWrapperMap(), {});

}

function getRecordTypeIdsSentToTheOrg(collectionsApiJsonByObject: Map<string, unknown>): unknown[] {

    const collectionsApiJson = JSON.stringify(collectionsApiJsonByObject.get(OBJECT_API_NAME), null, 2);
    const preparedCollectionsApiJson = CollectionsApiService.updateCollectionApiJsonContentWithOrgRecordTypeIds(collectionsApiJson, RECORD_TYPE_DETAIL_FROM_TARGET_ORG);
    return JSON.parse(preparedCollectionsApiJson).records.map((record: { RecordTypeId: unknown }) => record.RecordTypeId);

}

describe('a generated RecordTypeId, inserted as generated', () => {

    let sandboxDirectoryPath: string;

    beforeEach(() => {
        sandboxDirectoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-record-type-id-'));
    });

    afterEach(() => {
        fs.rmSync(sandboxDirectoryPath, { recursive: true, force: true });
    });

    test('with faker-js, becomes the single org Id of the first record type', async () => {

        const recipeFilePath = path.join(sandboxDirectoryPath, 'recipe.yml');
        fs.writeFileSync(recipeFilePath, generateRecipe(new RecipeService(new FakerJSRecipeFakerService())));

        const fakerJSProcessor = new FakerJSRecipeProcessor();
        const fakerOutput = await fakerJSProcessor.generateFakeDataBySelectedRecipeFile(recipeFilePath);

        expect(getRecordTypeIdsSentToTheOrg(fakerJSProcessor.transformFakerJsonDataToCollectionApiFormattedFilesBySObject(fakerOutput))).toEqual(['012000000000001AAA']);

    });

    // snowfakery is not installed to run the recipe, so its output is built from what PyYAML -- snowfakery's reader -- loads
    testRequiringPyYaml('with snowfakery, becomes the single org Id of the first record type', () => {

        const [ loadedRecipe ] = PythonTestHarness.loadWithPyYaml([generateRecipe(new RecipeService(new SnowfakeryRecipeFakerService()))]) as Array<Array<{ fields: Record<string, unknown> }>>;
        const snowfakeryOutput = JSON.stringify([{ _table: OBJECT_API_NAME, id: 1, nickname: `${OBJECT_API_NAME}_NickName`, ...loadedRecipe[0].fields }]);

        const snowfakeryProcessor = new SnowfakeryRecipeProcessor();

        expect(getRecordTypeIdsSentToTheOrg(snowfakeryProcessor.transformFakerJsonDataToCollectionApiFormattedFilesBySObject(snowfakeryOutput))).toEqual(['012000000000001AAA']);

    });

});
