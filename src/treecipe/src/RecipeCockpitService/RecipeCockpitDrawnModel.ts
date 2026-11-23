import {
    RECIPE_COCKPIT_EXPRESSION_OPENER,
    RECIPE_COCKPIT_FIXED_VALUE_DEPENDENT_REASON_PREFIX
} from './RecipeCockpitFieldRowsConstants';
import {
    RECIPE_COCKPIT_UPDATER_RECORD_TYPE_REASON,
    RECIPE_COCKPIT_UPDATER_LOOKUP_REASON
} from './RecipeCockpitAdapterConstants';

import { RecipeCockpitValidationRuleList } from './RecipeCockpitValidationRuleList';
import { INormalizedOrgField } from '../SalesforceOrgService/SalesforceOrgService';
import {
    IRecipeFilterLookup,
    IRecipeFixedValue,
    IRecipeUnconstrainedValue,
    RecipeCockpitRecipeWriter
} from '../RecipeWriter/RecipeCockpitRecipeWriter';
import { OccurrenceSettingPlacer } from './RecipeCockpitRecordTypeRecipe';
import { IRecipeFakerService } from '../RecipeFakerService.ts/IRecipeFakerService';
import { FakerJSRecipeFakerService } from '../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { IRecipeCockpitTreeDatasetViewModel } from './RecipeCockpitTreeHistory';
import { IUpdateSnapshotObject } from './RecipeCockpitRecordUpdate';
import type {
    IRecipeCockpitAddableParentTarget,
    IRecipeCockpitFieldReferenceViewModel,
    IRecipeCockpitFieldViewModel,
    IRecipeCockpitLookupWiringTarget,
    IRecipeCockpitObjectViewModel,
    IRecipeCockpitOrgRecordLookupTarget,
    IRecipeCockpitPanelState,
    IRecipeCockpitRecipeViewModel,
    IRecipeCockpitRunFakerFilteredRecipe,
    IRecipeCockpitTodoViewModel,
    IRecipeCockpitTreeHistoryAllowLists,
    IRecipeCockpitTreeOccurrence,
    IRecipeCockpitTreeViewModel
} from './RecipeCockpitViewModel';
import { RECIPE_COCKPIT_UPDATER_FORMULA_REASON } from './RecipeCockpitModelBuild';
import { RecipeCockpitTreeSelectionStore } from './RecipeCockpitTreeSelectionStore';

/*
    What the panel drew, read without the panel (#671): a tree's occurrences and fields, a picklist
    field's value choice, the recipe Run Faker filters to, and the keys every allow-list holds --
    which friends, lookups, parents, picklists, sources and rules a rendered model lets the panel
    post back. Every member is pure: it reads a view model and returns, and holds no state.
*/
export class RecipeCockpitDrawnModel {

    static buildSelectableObjectKey(treeKey: string, objectApiName: string): string {
        return `${treeKey}\n${objectApiName}`;
    }

    // THE OCCURRENCE OF THE CARD'S OBJECT A MESSAGE NAMES: ITS FIRST WITHOUT A NICKNAME, ELSE THE ONE WITH THAT NICKNAME THE CARD LISTS (#467)
    static findTreeOccurrence(objectsByApiName: ReadonlyMap<string, IRecipeCockpitObjectViewModel>,
                                tree: IRecipeCockpitTreeViewModel,
                                objectApiName: string,
                                nickname: string | undefined): IRecipeCockpitTreeOccurrence | undefined {

        const occurrences = RecipeCockpitTreeSelectionStore.listTreeOccurrences(objectsByApiName, tree, objectApiName);
        if ( nickname === undefined ) {
            return occurrences[0];
        }
        // AN OBJECT WRITTEN ONCE KEEPS NO NICKNAME FOR ITS SETTINGS, BUT A MESSAGE MAY STILL NAME THE ONE IT IS DRAWN WITH
        return occurrences.find(occurrence => occurrence.nickname === nickname)
            ?? ( occurrences.length === 1 && occurrences[0].nickname === undefined && occurrences[0].objectViewModel.nickname === nickname ? occurrences[0] : undefined );

    }

    // WHAT A CARD GENERATES WITH, BY OBJECT -- OR OCCURRENCE KEY, FOR AN OBJECT WITH iterations (#467) -- THEN FIELD
    static listFixedValuesByObject(tree: IRecipeCockpitTreeViewModel | undefined): Map<string, Map<string, IRecipeFixedValue>> {

        const fixedValuesByObject = new Map<string, Map<string, IRecipeFixedValue>>();
        ( tree?.fixedValues ?? [] ).forEach(fixedValue => {
            const occurrenceKey = RecipeCockpitRecipeWriter.buildOccurrenceKey(fixedValue.objectApiName, fixedValue.nickname);
            const fixedValuesByField = fixedValuesByObject.get(occurrenceKey) ?? new Map<string, IRecipeFixedValue>();
            fixedValuesByField.set(fixedValue.fieldApiName, { value: fixedValue.value, kind: fixedValue.kind });
            fixedValuesByObject.set(occurrenceKey, fixedValuesByField);
        });
        return fixedValuesByObject;

    }

    // A FIELD OF A CARD AS THE MODEL ON SCREEN DRAWS IT -- WITH A LINE IN THE RECIPE -- OR undefined
    static findDrawnField(recipeViewModel: IRecipeCockpitRecipeViewModel | undefined, treeKey: string, objectApiName: string, fieldApiName: string):
        { tree: IRecipeCockpitTreeViewModel; objectViewModel: IRecipeCockpitObjectViewModel; fieldViewModel: IRecipeCockpitFieldViewModel } | undefined {

        const tree = recipeViewModel?.trees.find(candidateTree => candidateTree.treeKey === treeKey);
        const objectViewModel = recipeViewModel?.objects.find(candidateObject => candidateObject.objectApiName === objectApiName);
        const fieldViewModel = objectViewModel?.fields.find(candidateField => candidateField.fieldApiName === fieldApiName && candidateField.lineNumber !== undefined);

        return tree && objectViewModel && fieldViewModel ? { tree: tree, objectViewModel: objectViewModel, fieldViewModel: fieldViewModel } : undefined;

    }

    /*
        The occurrence of a card's object a panel message names (#467), as the model on screen draws
        it: no nickname is the object's first occurrence; a nickname must be one of its occurrences the
        card lists. nickname in the answer is the one its settings are kept by -- undefined for an
        object written once.
    */
    static resolvePostedOccurrence(recipeViewModel: IRecipeCockpitRecipeViewModel | undefined, treeKey: string, objectApiName: string, postedNickname: unknown):
        { tree: IRecipeCockpitTreeViewModel; occurrence: IRecipeCockpitTreeOccurrence } | undefined {

        if ( !recipeViewModel || ( postedNickname !== undefined && typeof postedNickname !== 'string' ) ) {
            return undefined;
        }

        const tree = recipeViewModel.trees.find(candidateTree => candidateTree.treeKey === treeKey);
        const occurrence = tree ? this.findTreeOccurrence(RecipeCockpitTreeSelectionStore.buildObjectsByApiName(recipeViewModel), tree, objectApiName, postedNickname as string | undefined) : undefined;

        return tree && occurrence ? { tree: tree, occurrence: occurrence } : undefined;

    }

    // A FIELD OF ONE OCCURRENCE AS THE MODEL ON SCREEN DRAWS IT -- WITH A LINE IN THAT OCCURRENCE -- AND THE OBJECT'S OWN FIELD, WHICH HOLDS WHAT GENERATE TREECIPE WROTE
    static findDrawnOccurrenceField(recipeViewModel: IRecipeCockpitRecipeViewModel | undefined, treeKey: string, objectApiName: string, postedNickname: unknown, fieldApiName: string):
        { tree: IRecipeCockpitTreeViewModel; occurrence: IRecipeCockpitTreeOccurrence; objectViewModel: IRecipeCockpitObjectViewModel; fieldViewModel: IRecipeCockpitFieldViewModel; generatedFieldViewModel: IRecipeCockpitFieldViewModel } | undefined {

        const resolved = this.resolvePostedOccurrence(recipeViewModel, treeKey, objectApiName, postedNickname);
        const fieldViewModel = resolved?.occurrence.objectViewModel.fields.find(candidateField => candidateField.fieldApiName === fieldApiName && candidateField.lineNumber !== undefined);
        const generatedFieldViewModel = recipeViewModel?.objects.find(candidateObject => candidateObject.objectApiName === objectApiName)?.fields.find(candidateField => candidateField.fieldApiName === fieldApiName);

        return resolved && fieldViewModel
            ? { tree: resolved.tree, occurrence: resolved.occurrence, objectViewModel: resolved.occurrence.objectViewModel, fieldViewModel: fieldViewModel, generatedFieldViewModel: generatedFieldViewModel ?? fieldViewModel }
            : undefined;

    }

    /*
        What the copy writes for each field whose rules are off: both values as the wrapper recorded
        them, so the writer swaps only lines that still hold what the rules wrote. A field the rules
        did not change (an ISBLANK rule) has nothing to swap and is left out.
    */
    static listUnconstrainedValuesByObject(recipeViewModel: IRecipeCockpitRecipeViewModel, tree: IRecipeCockpitTreeViewModel): Map<string, Map<string, IRecipeUnconstrainedValue>> {

        const unconstrainedValuesByObject = new Map<string, Map<string, IRecipeUnconstrainedValue>>();
        ( tree.validationRulesOff ?? [] ).forEach(fieldReference => {
            const validationRules = this.findDrawnField(recipeViewModel, tree.treeKey, fieldReference.objectApiName, fieldReference.fieldApiName)?.fieldViewModel.validationRules;
            if ( validationRules?.recipeValue === undefined || validationRules.unconstrainedRecipeValue === undefined
                    || validationRules.recipeValue === validationRules.unconstrainedRecipeValue ) {
                return;
            }
            const occurrenceKey = RecipeCockpitRecipeWriter.buildOccurrenceKey(fieldReference.objectApiName, fieldReference.nickname);
            const valuesByField = unconstrainedValuesByObject.get(occurrenceKey) ?? new Map<string, IRecipeUnconstrainedValue>();
            valuesByField.set(fieldReference.fieldApiName, { constrainedValue: validationRules.recipeValue, unconstrainedValue: validationRules.unconstrainedRecipeValue });
            unconstrainedValuesByObject.set(occurrenceKey, valuesByField);
        });

        return unconstrainedValuesByObject;

    }

    // WHAT A CARD GENERATES WITH: ITS CHANGED COUNTS, BY OBJECT OR OCCURRENCE KEY (#467), NEVER AN EXCLUDED OBJECT'S, WHICH IS NOT GENERATED AT ALL
    static listObjectCountsByObject(tree: IRecipeCockpitTreeViewModel | undefined): Map<string, number> {

        const excludedObjectApiNames = new Set(RecipeCockpitTreeSelectionStore.listExcludedObjectApiNames(tree));

        return new Map(( tree?.objectCounts ?? [] )
            .filter(objectCount => !excludedObjectApiNames.has(objectCount.objectApiName))
            .map(objectCount => [RecipeCockpitRecipeWriter.buildOccurrenceKey(objectCount.objectApiName, objectCount.nickname), objectCount.count]));

    }

    /*
        Every field a card leaves out of generation by object, never an excluded object's, which goes
        whole. An object with iterations lists every field ANY of its occurrences leaves out (#467):
        what the insert's readiness reads, which refuses an unticked field the org requires wherever
        it is unticked.
    */
    static listExcludedFieldApiNamesByObject(tree: IRecipeCockpitTreeViewModel | undefined): Map<string, string[]> {

        const excludedFieldApiNamesByObject = new Map<string, string[]>();
        this.listExcludedFieldApiNamesByOccurrence(tree).forEach((fieldApiNames, occurrenceKey) => {
            const objectApiName = RecipeCockpitRecipeWriter.parseOccurrenceKey(occurrenceKey).objectApiName;
            excludedFieldApiNamesByObject.set(objectApiName, [...new Set([...( excludedFieldApiNamesByObject.get(objectApiName) ?? [] ), ...fieldApiNames])]);
        });
        return excludedFieldApiNamesByObject;

    }

    // WHAT THE FILTERED COPY LEAVES OUT, BY OBJECT OR, FOR AN OBJECT WITH iterations, BY OCCURRENCE KEY (#467)
    static listExcludedFieldApiNamesByOccurrence(tree: IRecipeCockpitTreeViewModel | undefined): Map<string, string[]> {

        const excludedObjectApiNames = new Set(RecipeCockpitTreeSelectionStore.listExcludedObjectApiNames(tree));

        return new Map(( tree?.fieldSelection?.objects ?? [] )
            .filter(objectFieldSelection => objectFieldSelection.excludedFieldApiNames.length > 0 && !excludedObjectApiNames.has(objectFieldSelection.objectApiName))
            .map(objectFieldSelection => [RecipeCockpitRecipeWriter.buildOccurrenceKey(objectFieldSelection.objectApiName, objectFieldSelection.nickname), [...objectFieldSelection.excludedFieldApiNames]]));

    }

    static buildSelectableFieldKey(treeKey: string, objectApiName: string, fieldApiName: string): string {
        return `${treeKey}\n${objectApiName}\n${fieldApiName}`;
    }

    // AN ITERATION IS NO PART OF THE OBJECT CASCADE (#467), SO ONE WITH NO FIELD TICKED IS LEFT OUT ON ITS OWN, BY ITS OCCURRENCE KEY (#611)
    static listNoFieldsSelectedIterationKeys(tree: IRecipeCockpitTreeViewModel | undefined): string[] {

        const excludedObjectApiNames = new Set(RecipeCockpitTreeSelectionStore.listExcludedObjectApiNames(tree));
        const iterationKeys = new Set(( tree?.objects ?? [] )
            .filter(treeObject => treeObject.iterationNickname !== undefined)
            .map(treeObject => RecipeCockpitRecipeWriter.buildOccurrenceKey(treeObject.objectApiName, treeObject.iterationNickname)));

        return ( tree?.fieldSelection?.objects ?? [] )
            .filter(objectFieldSelection => objectFieldSelection.isEveryFieldExcluded && !excludedObjectApiNames.has(objectFieldSelection.objectApiName))
            .map(objectFieldSelection => RecipeCockpitRecipeWriter.buildOccurrenceKey(objectFieldSelection.objectApiName, objectFieldSelection.nickname))
            .filter(occurrenceKey => iterationKeys.has(occurrenceKey));

    }

    static buildPicklistChoiceExpression(fakerService: 'faker-js' | 'snowfakery', picklistValues: string[], fieldViewModel: IRecipeCockpitFieldViewModel): string {

        const recipeFakerService: IRecipeFakerService = fakerService === 'faker-js' ? new FakerJSRecipeFakerService() : new SnowfakeryRecipeFakerService();
        return recipeFakerService.buildPicklistChoiceExpression(picklistValues, fieldViewModel.fieldType === 'MultiselectPicklist');

    }

    /*
        The choice the field's GENERATED line makes (#465): its first "${{ ... }}" line, unquoted
        when a validation rule wrote it double-quoted, read back as a choice. undefined when that
        line is not one (a TODO, a hand edit), so nothing is claimed about what it generates.
    */
    static readGeneratedPicklistChoice(fieldViewModel: IRecipeCockpitFieldViewModel, declaredPicklistValues: readonly string[]): string[] | undefined {

        const expressionLine = String(fieldViewModel.recipeValue ?? '').split(/\r?\n/)
            .map(valueLine => this.unquoteExpressionLine(valueLine.trim()))
            .find(valueLine => valueLine.startsWith(RECIPE_COCKPIT_EXPRESSION_OPENER));

        return expressionLine === undefined ? undefined : this.recoverPicklistValueChoice(expressionLine, declaredPicklistValues, fieldViewModel);

    }

    private static unquoteExpressionLine(valueLine: string): string {

        if ( valueLine.length < 2 || !valueLine.startsWith('"') || !valueLine.endsWith('"') ) {
            return valueLine;
        }
        // A LINE OPENING AND CLOSING ON A DOUBLE QUOTE PARSES ONLY AS A STRING, OR NOT AT ALL
        try {
            return String(JSON.parse(valueLine));
        } catch {
            return valueLine;
        }

    }

    /*
        Which values an edit ticks (#465), or undefined when the edit is not a choice of them. Read
        back by BUILDING: the values whose literal the expression holds, in declared order, must build
        the expression exactly with one backend, so a hand-written expression is never read as a
        choice it only resembles.
    */
    static recoverPicklistValueChoice(expression: string, declaredPicklistValues: readonly string[], fieldViewModel: IRecipeCockpitFieldViewModel): string[] | undefined {

        const literalBuilders: { fakerService: 'faker-js' | 'snowfakery'; buildLiteral: (picklistValue: string) => string }[] = [
            { fakerService: 'faker-js', buildLiteral: picklistValue => `\`${FakerJSRecipeFakerService.escapePicklistValueForJavaScriptString(picklistValue, '`')}\`` },
            { fakerService: 'snowfakery', buildLiteral: picklistValue => `'${SnowfakeryRecipeFakerService.escapePicklistValueForJinjaStringLiteral(picklistValue)}'` }
        ];

        for ( const literalBuilder of literalBuilders ) {
            const chosenValues = declaredPicklistValues.filter(declaredValue => expression.includes(literalBuilder.buildLiteral(declaredValue)));
            if ( chosenValues.length > 0 && this.buildPicklistChoiceExpression(literalBuilder.fakerService, chosenValues, fieldViewModel) === expression ) {
                return chosenValues;
            }
        }

        return undefined;

    }

    // WHAT A CARD'S EDIT OF A PICKLIST TICKS (#465), FOR THE TILES THAT ASKED; NOTHING FOR A CARD OR FIELD NOT ON SCREEN, OR NO EDIT
    static readPicklistValueChoice(recipeViewModel: IRecipeCockpitRecipeViewModel,
                                    treeKey: string,
                                    objectApiName: string,
                                    fieldApiName: string,
                                    declaredPicklistValues: readonly string[],
                                    nickname?: string): { treeKey?: string; chosenPicklistValues?: string[]; isOtherEdit?: true; isEdited?: true } {

        const tree = recipeViewModel.trees.find(candidateTree => candidateTree.treeKey === treeKey);
        if ( !tree ) {
            return {};
        }

        // THE OCCURRENCE THE TILES WERE OPENED ON (#467): ITS OWN EDIT AND ITS OWN GENERATED LINE
        const drawnField = this.findDrawnOccurrenceField(recipeViewModel, treeKey, objectApiName, nickname, fieldApiName);
        if ( !drawnField ) {
            return { treeKey: treeKey };
        }
        const fieldViewModel = drawnField.fieldViewModel;
        const occurrenceNickname = drawnField.occurrence.nickname;
        const fixedValue = ( tree.fixedValues ?? [] ).find(candidate => candidate.objectApiName === objectApiName && candidate.nickname === occurrenceNickname && candidate.fieldApiName === fieldApiName);
        if ( !fixedValue ) {
            const generatedChoice = this.readGeneratedPicklistChoice(fieldViewModel, declaredPicklistValues);
            return generatedChoice ? { treeKey: treeKey, chosenPicklistValues: generatedChoice } : { treeKey: treeKey };
        }

        const chosenPicklistValues = fixedValue.kind === 'expression' ? this.recoverPicklistValueChoice(fixedValue.value, declaredPicklistValues, fieldViewModel) : undefined;
        return chosenPicklistValues ? { treeKey: treeKey, chosenPicklistValues: chosenPicklistValues, isEdited: true } : { treeKey: treeKey, isOtherEdit: true, isEdited: true };

    }

    // A PICKLIST'S ACTIVE VALUES AND EVERY RECORD TYPE'S, FROM THE HOST-ONLY DISPLAY COPY; undefined FOR A FIELD THAT IS NOT A PICKLIST
    static listDeclaredPicklistValues(panelState: IRecipeCockpitPanelState, objectApiName: string, fieldApiName: string): string[] | undefined {

        const picklistDisplayValues = panelState.picklistDisplayValuesByObjectApiName.get(objectApiName)?.get(fieldApiName);

        return picklistDisplayValues
            ? [...picklistDisplayValues.picklistValues, ...picklistDisplayValues.recordTypePicklistValues.flatMap(recordTypeValues => recordTypeValues.picklistValues)]
            : undefined;

    }

    // ONE RUN PICKER ENTRY: THE RUN, OR "<run>/<custom tree>" -- A FOLDER NAME NEVER HOLDS A "/"
    static buildRunPickerKey(runFolderName: string, customTreeFolderName?: string): string {
        return customTreeFolderName === undefined ? runFolderName : `${runFolderName}/${customTreeFolderName}`;
    }

    /*
        What the generate button runs for a card with exclusions (#219): the filtered copy of its recipe, or
        why there is none. Read at the click from the stored model, which is what the card shows.
    */
    static buildRunFakerFilteredRecipe(recipeText: string,
                                        tree: IRecipeCockpitTreeViewModel,
                                        objectLevelsByApiName: Map<string, number> | undefined,
                                        recipeViewModel: IRecipeCockpitRecipeViewModel,
                                        settingPlacer?: OccurrenceSettingPlacer): IRecipeCockpitRunFakerFilteredRecipe | { refusalMessage: string } {

        // A RECIPE BUILT FOR THE TICKED RECORD TYPES (#623) NAMES ITS BLOCKS ANEW, SO EACH SETTING IS PLACED ON THE BLOCK IT NOW BELONGS TO
        const placeKeys = <T>(settingsByKey: Map<string, T>) => settingPlacer ? settingPlacer.placeKeys(settingsByKey) : settingsByKey;
        const excludedObjectApiNames = RecipeCockpitTreeSelectionStore.listExcludedObjectApiNames(tree);
        const placedExcludedFieldApiNames = placeKeys(this.listExcludedFieldApiNamesByOccurrence(tree));
        const excludedFieldApiNamesByObject = settingPlacer ? settingPlacer.keepRecordTypeIdOfChoiceObjects(placedExcludedFieldApiNames) : placedExcludedFieldApiNames;
        const objectCountsByObject = settingPlacer ? settingPlacer.placeCounts(this.listObjectCountsByObject(tree)) : this.listObjectCountsByObject(tree);
        const fixedValuesByObject = placeKeys(this.listFixedValuesByObject(tree));
        const unconstrainedValuesByObject = placeKeys(this.listUnconstrainedValuesByObject(recipeViewModel, tree));
        const parentLookupsByObjectApiName = new Map<string, IRecipeFilterLookup[]>();
        tree.objects
            .filter(treeObject => treeObject.iterationNickname === undefined)
            .forEach(treeObject => parentLookupsByObjectApiName.set(treeObject.objectApiName, treeObject.parentLookups.map(parentLookup => ({ ...parentLookup }))));

        const noFieldsSelectedIterationKeys = [...placeKeys(new Map(this.listNoFieldsSelectedIterationKeys(tree).map(iterationKey => [iterationKey, true]))).keys()];
        const filterResult = RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, {
            excludedObjectApiNames: excludedObjectApiNames,
            ...( noFieldsSelectedIterationKeys.length > 0 ? { excludedOccurrenceKeys: noFieldsSelectedIterationKeys } : {} ),
            parentLookupsByObjectApiName: parentLookupsByObjectApiName,
            levelsByObjectApiName: objectLevelsByApiName,
            excludedFieldApiNamesByObject: excludedFieldApiNamesByObject,
            objectCountsByObject: objectCountsByObject,
            fixedValuesByObject: fixedValuesByObject,
            unconstrainedValuesByObject: unconstrainedValuesByObject
        });

        if ( 'refusal' in filterResult ) {
            return { refusalMessage: filterResult.refusal.message };
        }

        return {
            recipeText: filterResult.recipeText,
            excludedObjectApiNames: excludedObjectApiNames,
            ...( excludedFieldApiNamesByObject.size > 0 ? { excludedFieldApiNamesByObject: Object.fromEntries(excludedFieldApiNamesByObject) } : {} ),
            ...( filterResult.appliedCounts.length > 0 ? { objectCountsByObject: Object.fromEntries(filterResult.appliedCounts.map(appliedCount => [appliedCount.objectApiName, appliedCount.count])) } : {} ),
            ...( filterResult.appliedFixedValues.length > 0 ? { fixedValuesByObject: this.groupAppliedFixedValues(filterResult.appliedFixedValues) } : {} ),
            ...( filterResult.appliedUnconstrainedValues.length > 0 ? { validationRulesOffByObject: this.groupFieldReferences(filterResult.appliedUnconstrainedValues) } : {} )
        };

    }

    // fromEntries, SO AN OBJECT NAMED __proto__ IS RECORDED RATHER THAN SET AS A PROTOTYPE
    static groupFieldReferences(fieldReferences: IRecipeCockpitFieldReferenceViewModel[]): Record<string, string[]> {

        const objectApiNames = [...new Set(fieldReferences.map(fieldReference => fieldReference.objectApiName))];

        return Object.fromEntries(objectApiNames.map(objectApiName => [objectApiName, fieldReferences
            .filter(fieldReference => fieldReference.objectApiName === objectApiName)
            .map(fieldReference => fieldReference.fieldApiName)]));

    }

    // fromEntries DEFINES EACH KEY, SO AN OBJECT OR FIELD NAMED __proto__ IS RECORDED RATHER THAN SET AS A PROTOTYPE
    static groupAppliedFixedValues(appliedFixedValues: Array<{ objectApiName: string; fieldApiName: string; value: string }>): Record<string, Record<string, string>> {

        const objectApiNames = [...new Set(appliedFixedValues.map(appliedFixedValue => appliedFixedValue.objectApiName))];

        return Object.fromEntries(objectApiNames.map(objectApiName => [objectApiName, Object.fromEntries(appliedFixedValues
            .filter(appliedFixedValue => appliedFixedValue.objectApiName === objectApiName)
            .map(appliedFixedValue => [appliedFixedValue.fieldApiName, appliedFixedValue.value]))]));

    }

    static buildEmptyTreeHistoryAllowLists(): IRecipeCockpitTreeHistoryAllowLists {

        return {
            openableDatasetFolderNames: new Set(),
            insertableDatasetFolderNames: new Set(),
            countableDatasetFolderNames: new Set(),
            viewableInsertResultsDatasetFolderNames: new Set(),
            nameableTreeKeys: new Set(),
            nameableDatasetFolderNames: new Set(),
            selectableObjectKeys: new Set(),
            selectableFieldKeys: new Set(),
            selectableRecordTypeKeys: new Set(),
            removableTodoKeys: new Set(),
            restorableTodoKeys: new Set()
        };

    }

    // EVERY HISTORY ACTION THE RENDERED MODEL OFFERS, BY NAME, AND NOTHING ELSE
    static collectTreeHistoryAllowLists(recipeViewModel: IRecipeCockpitRecipeViewModel, runFakerRecipeFilePathsByTreeKey: ReadonlyMap<string, string> = new Map()): IRecipeCockpitTreeHistoryAllowLists {

        const treeHistoryAllowLists = this.buildEmptyTreeHistoryAllowLists();
        const objectsByApiName = RecipeCockpitTreeSelectionStore.buildObjectsByApiName(recipeViewModel);

        recipeViewModel.trees.forEach(tree => {

            tree.objects
                .map(treeObject => objectsByApiName.get(treeObject.objectApiName))
                .filter((objectViewModel): objectViewModel is IRecipeCockpitObjectViewModel => !!objectViewModel?.recordTypes)
                .forEach(objectViewModel => {
                    objectViewModel.recordTypes.forEach(recordType => treeHistoryAllowLists.selectableRecordTypeKeys.add(this.buildSelectableRecordTypeKey(objectViewModel.objectApiName, recordType.developerName)));
                });

            this.collectRemovableTodoLineNumbers(objectsByApiName, tree, runFakerRecipeFilePathsByTreeKey.get(tree.treeKey))
                .forEach(lineNumber => treeHistoryAllowLists.removableTodoKeys.add(this.buildTodoActionKey(tree.treeKey, lineNumber)));
            ( tree.removedTodos ?? [] ).forEach(removedTodo => treeHistoryAllowLists.restorableTodoKeys.add(this.buildTodoActionKey(tree.treeKey, removedTodo.removalKey)));

            if ( tree.folderName !== '' ) {
                treeHistoryAllowLists.nameableTreeKeys.add(tree.treeKey);
                // EVERY OCCURRENCE'S FIELDS (#467): A FIELD ONLY AN ITERATION WRITES HAS A CHECKBOX ON THAT ROW
                RecipeCockpitTreeSelectionStore.listTreeOccurrences(objectsByApiName, tree).forEach(({ objectApiName, objectViewModel }) => {
                    treeHistoryAllowLists.selectableObjectKeys.add(this.buildSelectableObjectKey(tree.treeKey, objectApiName));
                    RecipeCockpitTreeSelectionStore.listSelectableFieldApiNames(objectViewModel)
                        .forEach(fieldApiName => treeHistoryAllowLists.selectableFieldKeys.add(this.buildSelectableFieldKey(tree.treeKey, objectApiName, fieldApiName)));
                });
            }

            if ( !tree.history ) {
                return;
            }

            tree.history.datasets.forEach(dataset => this.addDatasetToAllowLists(treeHistoryAllowLists, dataset));

        });

        return treeHistoryAllowLists;

    }

    static buildTodoActionKey(treeKey: string, todoName: string | number): string {

        return `${treeKey}\n${todoName}`;

    }

    /*
        Every TODO of the card's own recipe file a reader may remove (#391): on an object the card
        draws whose recipe is that file, an iteration's and a field's included, and held by no lock.
        A card with no single recipe file offers none, since there is no one file to write.
    */
    static collectRemovableTodoLineNumbers(objectsByApiName: Map<string, IRecipeCockpitObjectViewModel>, tree: IRecipeCockpitTreeViewModel, recipeFilePath: string | undefined): number[] {

        if ( !recipeFilePath ) {
            return [];
        }

        return this.listTreeTodos(objectsByApiName, tree, recipeFilePath)
            .filter(treeTodo => treeTodo.todo.removeLock === undefined)
            .map(treeTodo => treeTodo.todo.lineNumber);

    }

    // EVERY TODO OF THE CARD'S OBJECTS WHOSE RECIPE IS recipeFilePath, WITH THE TEXT THE PANEL DRAWS FOR IT
    static listTreeTodos(objectsByApiName: Map<string, IRecipeCockpitObjectViewModel>, tree: IRecipeCockpitTreeViewModel, recipeFilePath: string): { todo: IRecipeCockpitTodoViewModel; text: string; objectApiName: string; fieldApiName?: string }[] {

        const treeTodos: { todo: IRecipeCockpitTodoViewModel; text: string; objectApiName: string; fieldApiName?: string }[] = [];
        const seenObjectApiNames = new Set<string>();

        tree.objects.forEach(treeObject => {

            const objectViewModel = objectsByApiName.get(treeObject.objectApiName);
            if ( !objectViewModel || objectViewModel.recipeFilePath !== recipeFilePath || seenObjectApiNames.has(objectViewModel.objectApiName) ) {
                return;
            }
            seenObjectApiNames.add(objectViewModel.objectApiName);

            const addTodos = (todos: IRecipeCockpitTodoViewModel[] | undefined, recipeValue: string | undefined, fieldApiName?: string) => ( todos ?? [] ).forEach(todo => {
                treeTodos.push({ todo: todo, text: this.readTodoText(todo, recipeValue), objectApiName: objectViewModel.objectApiName, ...( fieldApiName !== undefined ? { fieldApiName: fieldApiName } : {} ) });
            });

            addTodos(objectViewModel.todos, undefined);
            objectViewModel.fields.forEach(fieldViewModel => addTodos(fieldViewModel.todos, fieldViewModel.recipeValue, fieldViewModel.fieldApiName));
            ( objectViewModel.iterations ?? [] ).forEach(iteration => {
                addTodos(iteration.todos, undefined);
                iteration.fields.forEach(iterationField => addTodos(iterationField.todos, iterationField.recipeValue, iterationField.fieldApiName));
            });

        });

        return treeTodos;

    }

    // A TODO'S TEXT AS THE PANEL'S readFieldTodoText DRAWS IT: ITS OWN, OR THE SPAN OF THE FIELD'S VALUE THAT HOLDS IT
    static readTodoText(todo: IRecipeCockpitTodoViewModel, recipeValue: string | undefined): string {

        if ( typeof todo.text === 'string' ) {
            return todo.text;
        }

        const value = typeof recipeValue === 'string' ? recipeValue : '';
        const isUsableSpan = Number.isInteger(todo.valueStart) && Number.isInteger(todo.valueLength)
            && todo.valueStart >= 0 && todo.valueLength > 0 && todo.valueStart + todo.valueLength <= value.length;

        return isUsableSpan ? value.substr(todo.valueStart, todo.valueLength) : '';

    }

    static buildSelectableRecordTypeKey(objectApiName: string, developerName: string): string {

        return `${objectApiName}\n${developerName}`;

    }

    // WHAT ONE DATA SET ROW OFFERS: THE ONE RULE A WHOLE MODEL AND A datasetAdded (#226) BOTH USE
    static addDatasetToAllowLists(treeHistoryAllowLists: IRecipeCockpitTreeHistoryAllowLists, dataset: IRecipeCockpitTreeDatasetViewModel) {

        treeHistoryAllowLists.openableDatasetFolderNames.add(dataset.datasetFolderName);
        treeHistoryAllowLists.insertableDatasetFolderNames.add(dataset.datasetFolderName);
        treeHistoryAllowLists.nameableDatasetFolderNames.add(dataset.datasetFolderName);

        if ( dataset.recordCounts === null ) {
            treeHistoryAllowLists.countableDatasetFolderNames.add(dataset.datasetFolderName);
        }

        if ( dataset.lastInsert?.hasResultsFile === true ) {
            treeHistoryAllowLists.viewableInsertResultsDatasetFolderNames.add(dataset.datasetFolderName);
        }

    }

    /*
        A COPY, never the same sets: once a model is acknowledged its pending and active lists ARE
        the same objects, so adding a new row's names to "pending" in place would make them usable
        before the panel has drawn the row.
    */
    static cloneTreeHistoryAllowLists(treeHistoryAllowLists: IRecipeCockpitTreeHistoryAllowLists): IRecipeCockpitTreeHistoryAllowLists {

        const clonedAllowLists = this.buildEmptyTreeHistoryAllowLists();

        (Object.keys(clonedAllowLists) as Array<keyof IRecipeCockpitTreeHistoryAllowLists>).forEach(allowListName => {
            clonedAllowLists[allowListName] = new Set(treeHistoryAllowLists[allowListName]);
        });

        return clonedAllowLists;

    }

    /*
        The expression a field's new values are generated from (#417): the FIRST "\${{ ... }}" line of
        its recipe value, as the Updater's editor starts from it -- a double-quoted one unquoted. The
        model's value is the display form (continuation lines moved to column 0, a block indicator
        dropped), so a record type's commented variants and a "### Driven by ValidationRule" note are
        left out rather than written as lines no recipe layout reads. Undefined when there is none
        (a TODO comment loads as null).
    */
    static findRecipeExpression(recipeValue: string | undefined): string | undefined {

        return RecipeCockpitRecipeWriter.findFirstExpressionLine(recipeValue);

    }

    // A FIELD'S VALUE AS THE ORG'S ANSWER CASES IT: SOQL NAMES ARE CASE-INSENSITIVE, AND THE ORG ANSWERS WITH ITS OWN CASING
    static readRecordFieldValue(record: Record<string, unknown>, fieldApiName: string): unknown {
        if ( Object.prototype.hasOwnProperty.call(record, fieldApiName) ) {
            return record[fieldApiName];
        }
        const lowerCaseName = fieldApiName.toLowerCase();
        const matchingKey = Object.keys(record).find(recordKey => recordKey.toLowerCase() === lowerCaseName);
        return matchingKey === undefined ? null : record[matchingKey];
    }

    // WHICH FIELDS AN UPDATE OR A RESTORE WROTE THAT ONLY THE ORG HELD (#446), FOR THE RESULTS FILE; NOTHING WHEN THERE WERE NONE
    static buildOrgOnlyFieldsResult(snapshotObjects: readonly IUpdateSnapshotObject[]): { orgOnlyFields?: Record<string, string[]> } {

        const orgOnlyEntries = snapshotObjects
            .filter(snapshotObject => ( snapshotObject.orgOnlyFieldApiNames ?? [] ).length > 0)
            .map((snapshotObject): [string, string[]] => [snapshotObject.objectApiName, [...snapshotObject.orgOnlyFieldApiNames as string[]]]);

        return orgOnlyEntries.length > 0 ? { orgOnlyFields: Object.fromEntries(orgOnlyEntries) } : {};

    }

    /*
        Why a field a snapshot says only the org held (#446) is not one the Treecipe Adapter writes
        back, from the org's describe: the Updater's lock rule read off what the org says the field is,
        since the recipe has no model of it. Not updateable or calculated is findUpdateReason's.
    */
    static findDescribedOrgOnlyFieldLockReason(fieldApiName: string, describedField: INormalizedOrgField | undefined): string | undefined {

        if ( !describedField ) {
            return undefined;
        }
        if ( fieldApiName.toLowerCase() === 'recordtypeid' ) {
            return RECIPE_COCKPIT_UPDATER_RECORD_TYPE_REASON;
        }
        if ( describedField.fieldType === 'reference' || describedField.referenceTo.length > 0 ) {
            return RECIPE_COCKPIT_UPDATER_LOOKUP_REASON;
        }
        if ( describedField.controllingField ) {
            return `${RECIPE_COCKPIT_FIXED_VALUE_DEPENDENT_REASON_PREFIX}${describedField.controllingField}`;
        }
        if ( describedField.isCalculated ) {
            return RECIPE_COCKPIT_UPDATER_FORMULA_REASON;
        }

        return undefined;

    }

    // WHETHER A PICKLIST IS WRITTEN ON AN OBJECT WITH RECORD TYPES, WHICH CAN NARROW IT: THE ORG DECIDES, PER RECORD (#418)
    static hasRecordTypePicklist(recipe: IRecipeCockpitRecipeViewModel,
                                         plannedObjects: ReadonlyArray<{ objectApiName: string; fieldApiNames: readonly string[] }>,
                                         describeOutcomes: ReadonlyMap<string, { describe?: { fields: ReadonlyArray<{ fieldApiName: string; fieldType: string }> } }>): boolean {

        return plannedObjects.some(plannedObject => {
            const describedFields = describeOutcomes.get(plannedObject.objectApiName)?.describe?.fields ?? [];
            return recipe.objects.some(object => object.objectApiName === plannedObject.objectApiName && ( object.recordTypes ?? [] ).length > 1)
                && plannedObject.fieldApiNames.some(fieldApiName => {
                    const fieldType = describedFields.find(describedField => describedField.fieldApiName.toLowerCase() === fieldApiName.toLowerCase())?.fieldType;
                    return fieldType === 'picklist' || fieldType === 'multipicklist';
                });
        });

    }

    static buildOpenSourceKey(filePath: string, lineNumber: number): string {

        return `${filePath}\n${lineNumber}`;

    }

    static buildInsertableFriendKey(treeKey: string, objectApiName: string, iterationNickname: string, friendObjectApiName: string): string {

        return `${treeKey}\n${objectApiName}\n${iterationNickname}\n${friendObjectApiName}`;

    }

    /*
        Every friend a "+" the rendered model draws can add, by card, object, iteration and friend,
        each mapped to the recipe file the iteration is in -- host-only, so the panel never names it.
        Only a card that LISTS the iteration offers it, so a key names a "+" that is on screen.
    */
    static collectInsertableFriendTargets(recipeViewModel: IRecipeCockpitRecipeViewModel): Map<string, string> {

        const insertableFriendTargets = new Map<string, string>();
        const objectsByApiName = new Map(recipeViewModel.objects.map(objectViewModel => [objectViewModel.objectApiName, objectViewModel]));

        recipeViewModel.trees.forEach(tree => tree.objects
            .filter(treeObject => treeObject.iterationNickname !== undefined)
            .forEach(treeObject => {

                const objectViewModel = objectsByApiName.get(treeObject.objectApiName);
                const iteration = objectViewModel?.iterations?.find(candidateIteration => candidateIteration.nickname === treeObject.iterationNickname);

                if ( !objectViewModel?.recipeFilePath || !iteration ) {
                    return;
                }

                ( iteration.insertableFriendObjectApiNames ?? [] ).forEach(friendObjectApiName => insertableFriendTargets.set(
                    this.buildInsertableFriendKey(tree.treeKey, objectViewModel.objectApiName, iteration.nickname, friendObjectApiName),
                    objectViewModel.recipeFilePath
                ));

            }));

        return insertableFriendTargets;

    }

    static buildWireableLookupKey(treeKey: string, objectApiName: string, objectNickname: string | undefined, fieldApiName: string): string {

        return `${treeKey}\n${RecipeCockpitRecipeWriter.buildLookupWiringKey(objectApiName, objectNickname, fieldApiName)}`;

    }

    // EVERY "Wire to…" THE RENDERED MODEL DRAWS, MAPPED TO ITS CARD'S RECIPE FILE -- HOST-ONLY, SO THE PANEL NEVER NAMES IT
    static collectWireableLookupTargets(recipeViewModel: IRecipeCockpitRecipeViewModel, recipeFilePathsByTreeKey: ReadonlyMap<string, string>): Map<string, IRecipeCockpitLookupWiringTarget> {

        const wireableLookupTargets = new Map<string, IRecipeCockpitLookupWiringTarget>();

        recipeViewModel.trees.forEach(tree => {

            const recipeFilePath = recipeFilePathsByTreeKey.get(tree.treeKey);
            if ( !recipeFilePath ) {
                return;
            }

            ( tree.lookupWirings ?? [] ).forEach(wiring => wireableLookupTargets.set(
                this.buildWireableLookupKey(tree.treeKey, wiring.objectApiName, wiring.objectNickname, wiring.fieldApiName),
                { recipeFilePath: recipeFilePath, wiring: wiring }
            ));

        });

        return wireableLookupTargets;

    }

    // EVERY "Add <Parent> to recipe" THE RENDERED MODEL DRAWS, MAPPED TO ITS CARD'S RECIPE FILE -- HOST-ONLY, SO THE PANEL NEVER NAMES IT
    static collectAddableParentTargets(recipeViewModel: IRecipeCockpitRecipeViewModel, recipeFilePathsByTreeKey: ReadonlyMap<string, string>): Map<string, IRecipeCockpitAddableParentTarget> {

        const addableParentTargets = new Map<string, IRecipeCockpitAddableParentTarget>();

        recipeViewModel.trees.forEach(tree => {

            const recipeFilePath = recipeFilePathsByTreeKey.get(tree.treeKey);
            if ( !recipeFilePath ) {
                return;
            }

            ( tree.addableParents ?? [] ).forEach(addition => addableParentTargets.set(
                this.buildWireableLookupKey(tree.treeKey, addition.objectApiName, addition.objectNickname, addition.fieldApiName),
                { recipeFilePath: recipeFilePath, addition: addition }
            ));

        });

        return addableParentTargets;

    }

    // EVERY "Use existing <Parent> from org…" THE RENDERED MODEL DRAWS ENABLED, MAPPED TO ITS CARD'S RECIPE FILE -- HOST-ONLY
    static collectOrgRecordLookupTargets(recipeViewModel: IRecipeCockpitRecipeViewModel, recipeFilePathsByTreeKey: ReadonlyMap<string, string>): Map<string, IRecipeCockpitOrgRecordLookupTarget> {

        const orgRecordLookupTargets = new Map<string, IRecipeCockpitOrgRecordLookupTarget>();

        recipeViewModel.trees.forEach(tree => {

            const recipeFilePath = recipeFilePathsByTreeKey.get(tree.treeKey);
            if ( !recipeFilePath ) {
                return;
            }

            ( tree.emptyLookups ?? [] )
                .filter(emptyLookup => emptyLookup.orgRecordRefusal === undefined)
                .forEach(emptyLookup => orgRecordLookupTargets.set(
                    this.buildWireableLookupKey(tree.treeKey, emptyLookup.objectApiName, emptyLookup.objectNickname, emptyLookup.fieldApiName),
                    { recipeFilePath: recipeFilePath, emptyLookup: emptyLookup }
                ));

        });

        return orgRecordLookupTargets;

    }

    static buildPicklistKey(objectApiName: string, fieldApiName: string): string {

        return `${objectApiName}\n${fieldApiName}`;

    }

    // EVERY ROW THE RENDERED MODEL MARKS AS A PICKLIST, AND NOTHING ELSE
    static collectLoadablePicklistKeys(recipeViewModel: IRecipeCockpitRecipeViewModel): string[] {

        return recipeViewModel.objects.flatMap(objectViewModel => objectViewModel.fields
            .filter(fieldViewModel => fieldViewModel.isPicklist)
            .map(fieldViewModel => this.buildPicklistKey(objectViewModel.objectApiName, fieldViewModel.fieldApiName)));

    }

    static collectOpenableValidationRuleKeys(recipeViewModel: IRecipeCockpitRecipeViewModel): string[] {

        const ruleKeys = new Set<string>();
        const collect = (objectApiName: string, fieldViewModels: IRecipeCockpitFieldViewModel[]) => fieldViewModels.forEach(fieldViewModel =>
            ( fieldViewModel.validationRules?.sourceRuleNames ?? [] ).forEach(ruleName => ruleKeys.add(RecipeCockpitValidationRuleList.buildRuleSourceKey(objectApiName, ruleName))));

        recipeViewModel.objects.forEach(objectViewModel => collect(objectViewModel.objectApiName, objectViewModel.fields));

        return [...ruleKeys];

    }

    // EVERY FILE AND LINE THE RENDERED MODEL OFFERS TO OPEN, AND NOTHING ELSE
    static collectOpenableSourceKeys(recipeViewModel: IRecipeCockpitRecipeViewModel): string[] {

        const openableSourceKeys: string[] = [];

        recipeViewModel.objects.forEach(objectViewModel => {

            if ( !objectViewModel.recipeFilePath ) {
                return;
            }

            // EVERY TODO COMMENT THE PANEL LISTS IS ITS OWN LINK (#354); ONE ON ITS OWNER'S LINE IS THAT LINE'S KEY ALREADY
            const pushTodoKeys = (todos: IRecipeCockpitTodoViewModel[] | undefined, ownerLineNumber: number | undefined) => ( todos ?? [] )
                .filter(todo => todo.lineNumber !== ownerLineNumber)
                .forEach(todo => openableSourceKeys.push(this.buildOpenSourceKey(objectViewModel.recipeFilePath, todo.lineNumber)));

            if ( objectViewModel.lineNumber ) {
                openableSourceKeys.push(this.buildOpenSourceKey(objectViewModel.recipeFilePath, objectViewModel.lineNumber));
            }
            pushTodoKeys(objectViewModel.todos, objectViewModel.lineNumber);

            objectViewModel.fields.forEach(fieldViewModel => {
                if ( fieldViewModel.lineNumber ) {
                    openableSourceKeys.push(this.buildOpenSourceKey(objectViewModel.recipeFilePath, fieldViewModel.lineNumber));
                }
                pushTodoKeys(fieldViewModel.todos, fieldViewModel.lineNumber);
            });

            ( objectViewModel.iterations ?? [] ).forEach(iteration => {
                openableSourceKeys.push(this.buildOpenSourceKey(objectViewModel.recipeFilePath, iteration.lineNumber));
                pushTodoKeys(iteration.todos, iteration.lineNumber);
                iteration.fields.forEach(iterationField => {
                    openableSourceKeys.push(this.buildOpenSourceKey(objectViewModel.recipeFilePath, iterationField.lineNumber));
                    pushTodoKeys(iterationField.todos, iterationField.lineNumber);
                });
            });

        });

        return openableSourceKeys;

    }

}
