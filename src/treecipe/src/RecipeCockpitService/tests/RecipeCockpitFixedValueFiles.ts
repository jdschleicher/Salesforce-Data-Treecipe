import * as fs from 'fs';
import { IRecipeFixedValue, RecipeCockpitRecipeWriter } from '../RecipeCockpitRecipeWriter';
import { RecipeCockpitFixedValueStore } from '../RecipeCockpitFixedValueStore';

/*
    A fixed value lives in the recipe FILE and its fixed-values file since #342, so a suite that needs
    a pinned field pins it on disk the way the cockpit does and puts both files back afterwards.
    Returns the function that puts them back; call it in a finally or an afterEach.
*/
export function pinFieldInRecipeFile(recipeFilePath: string, objectApiName: string, fieldApiName: string, fixedValue: IRecipeFixedValue): () => void {

    const fixedValueFilePath = RecipeCockpitFixedValueStore.buildFilePath(recipeFilePath);
    const recipeTextBefore = fs.readFileSync(recipeFilePath, 'utf8');
    const fixedValueTextBefore = fs.existsSync(fixedValueFilePath) ? fs.readFileSync(fixedValueFilePath, 'utf8') : undefined;

    const pinResult = RecipeCockpitRecipeWriter.pinField(recipeTextBefore, objectApiName, fieldApiName, fixedValue);
    if ( 'refusal' in pinResult ) {
        throw new Error(`could not pin ${objectApiName}.${fieldApiName}: ${pinResult.refusal.message}`);
    }

    const entriesBefore = RecipeCockpitFixedValueStore.parse(fixedValueTextBefore).entries;
    fs.writeFileSync(fixedValueFilePath, RecipeCockpitFixedValueStore.serialize(RecipeCockpitFixedValueStore.upsertEntry(entriesBefore, {
        objectApiName: objectApiName,
        fieldApiName: fieldApiName,
        value: fixedValue.value,
        occurrences: pinResult.occurrences
    })));
    fs.writeFileSync(recipeFilePath, pinResult.recipeText);

    return () => restoreRecipeFiles(recipeFilePath, recipeTextBefore, fixedValueTextBefore);

}

export function restoreRecipeFiles(recipeFilePath: string, recipeText: string, fixedValueText: string | undefined): void {

    const fixedValueFilePath = RecipeCockpitFixedValueStore.buildFilePath(recipeFilePath);
    fs.writeFileSync(recipeFilePath, recipeText);
    if ( fixedValueText !== undefined ) {
        fs.writeFileSync(fixedValueFilePath, fixedValueText);
    } else if ( fs.existsSync(fixedValueFilePath) ) {
        fs.unlinkSync(fixedValueFilePath);
    }

}
