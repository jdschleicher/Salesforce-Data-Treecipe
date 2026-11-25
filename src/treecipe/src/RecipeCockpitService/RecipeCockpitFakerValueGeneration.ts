import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { IFakerRecipeProcessor } from '../FakerRecipeProcessor/IFakerRecipeProcessor';
import { FakerJSRecipeProcessor } from '../FakerRecipeProcessor/FakerJSRecipeProcessor/FakerJSRecipeProcessor';
import { SnowfakeryRecipeProcessor } from '../FakerRecipeProcessor/SnowfakeryRecipeProcessor/SnowfakeryRecipeProcessor';
import { RecipeCockpitUntrustedValue } from './RecipeCockpitUntrustedValue';

export type RecipeCockpitFakerService = 'faker-js' | 'snowfakery';

/*
    Records generated from a one-object recipe the cockpit built in memory: the Treecipe Adapter's
    values (#417) and a field row's "Test faker value" example (#718). The recipe is written to a
    temporary folder outside the workspace -- never beside the recipe -- run by the backend through
    the same processor Run Faker uses, read back as one record per record asked for, and the folder
    is removed whatever happens. A count that differs refuses, so a value is never paired with the
    wrong record.
*/
export class RecipeCockpitFakerValueGeneration {

    static createRecipeProcessor(fakerService: RecipeCockpitFakerService): IFakerRecipeProcessor {
        return fakerService === 'faker-js' ? new FakerJSRecipeProcessor() : new SnowfakeryRecipeProcessor();
    }

    static async generateObjectRecords(processor: IFakerRecipeProcessor,
                                        fakerService: RecipeCockpitFakerService,
                                        objectApiName: string,
                                        recordCount: number,
                                        recipeText: string,
                                        recipeFileName: string): Promise<{ records: Record<string, unknown>[] } | { refusal: string }> {

        let temporaryFolderPath: string | undefined;
        try {
            temporaryFolderPath = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-updater-values-'));
            const temporaryRecipePath = path.join(temporaryFolderPath, recipeFileName);
            fs.writeFileSync(temporaryRecipePath, recipeText, { encoding: 'utf8', flag: 'wx' });

            const generatedJson = await processor.generateFakeDataBySelectedRecipeFile(temporaryRecipePath) as string;
            const generatedRecords = processor.transformFakerJsonDataToCollectionApiFormattedFilesBySObject(generatedJson).get(objectApiName)?.records ?? [];

            if ( generatedRecords.length !== recordCount ) {
                return { refusal: `${fakerService} generated ${generatedRecords.length} ${objectApiName} ${generatedRecords.length === 1 ? 'record' : 'records'} for ${recordCount} asked for.` };
            }

            return { records: generatedRecords as Record<string, unknown>[] };
        } catch (generationError) {
            return { refusal: `${fakerService} could not generate the values of ${objectApiName}: ${RecipeCockpitUntrustedValue.describeThrown(generationError)}` };
        } finally {
            if ( temporaryFolderPath ) {
                fs.rmSync(temporaryFolderPath, { recursive: true, force: true });
            }
        }

    }

}
