/*
    The Recipe Cockpit's model, built from a generated recipe run on disk (#671): the runs found, the
    objects wrapper normalized and checked, the recipe files parsed and attached, the cards and their
    iterations. It never loads the hub, which posts what is built and keeps the allow-lists.
*/

import * as fs from 'fs';
import * as path from 'path';
import { ConfigurationService } from '../ConfigurationService/ConfigurationService';
import { IFieldSize } from '../ObjectInfoWrapper/FieldInfo';
import { FakerJSRecipeFakerService } from '../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { RecipeService } from '../RecipeService/RecipeService';
import {
    ILookupWiringContext,
    IRecipeFilterLookup,
    IRecipeRecordTypeBlocks,
    IRemovedTodoComment,
    IScannedObject,
    RecipeCockpitRecipeWriter
} from '../RecipeWriter/RecipeCockpitRecipeWriter';
import { RelationshipService } from '../RelationshipService/RelationshipService';
import { SalesforceApiName } from '../SalesforceApiName/SalesforceApiName';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';
import { XMLFieldDetail } from '../XMLProcessingService/XMLFieldDetail';
import { RecipeCockpitAdaptedDataset } from './RecipeCockpitAdaptedDataset';
import { RECIPE_COCKPIT_UPDATER_LOOKUP_REASON } from './RecipeCockpitAdapterConstants';
import {
    ICustomTreecipeDefinition,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_FILE_NAME,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_MAX_FILE_BYTES,
    RecipeCockpitCustomTreecipe
} from './RecipeCockpitCustomTreecipe';
import { RECIPE_COCKPIT_READ_ONLY_FORMULA_MAXIMUM_LENGTH } from './RecipeCockpitFieldRowsConstants';
import { IOrgNewFieldDetail } from './RecipeCockpitOrgChangeDetection';
import {
    IRemovedTodoFileRead,
    RecipeCockpitRemovedTodoStore
} from './RecipeCockpitRemovedTodoStore';
import { RecipeCockpitTreeHistory } from './RecipeCockpitTreeHistory';
import { RecipeCockpitTreeSelectionStore } from './RecipeCockpitTreeSelectionStore';
import type { RecipeCockpitTodoRemoveLock } from './RecipeCockpitTroubleshootingConstants';
import { RecipeCockpitValidationRuleList } from './RecipeCockpitValidationRuleList';
import type {
    IRecipeCockpitAddableParentViewModel,
    IRecipeCockpitCustomTreeSource,
    IRecipeCockpitEmptyLookupViewModel,
    IRecipeCockpitFieldValidationRulesViewModel,
    IRecipeCockpitFieldViewModel,
    IRecipeCockpitLoadedRecipe,
    IRecipeCockpitLookupWiringViewModel,
    IRecipeCockpitNormalizedObjectsWrapper,
    IRecipeCockpitObjectIterationViewModel,
    IRecipeCockpitObjectViewModel,
    IRecipeCockpitParentLookupViewModel,
    IRecipeCockpitPicklistDisplayValues,
    IRecipeCockpitRecipeViewModel,
    IRecipeCockpitRecordTypeImpactViewModel,
    IRecipeCockpitRecordTypeViewModel,
    IRecipeCockpitRemovedTodoViewModel,
    IRecipeCockpitRun,
    IRecipeCockpitRunViewModel,
    IRecipeCockpitTodoViewModel,
    IRecipeCockpitTreeObjectViewModel,
    IRecipeCockpitTreeViewModel,
    IRecipeCockpitWrapperTree,
    IRecipeSourceFieldEntry,
    IRecipeSourceFile,
    IRecipeSourceObjectEntry,
    RecipeCockpitPicklistDisplayValuesByObjectApiName
} from './RecipeCockpitViewModel';

export const RECIPE_COCKPIT_NO_RUN_MESSAGE = 'No generated recipe run was found under treecipe/GeneratedRecipes. Generate Treecipe writes one from the object metadata in this workspace, and the cockpit opens it when it finishes.';

// THE FIELD TYPES WHOSE ROWS EXPAND TO THEIR VALUES IN THE STRUCTURE TAB
export const RECIPE_COCKPIT_PICKLIST_FIELD_TYPES: readonly string[] = ['Picklist', 'MultiselectPicklist'];

export const RECIPE_COCKPIT_UNGROUPED_TREE_TITLE = 'Not in a relationship tree';

export const RECIPE_COCKPIT_TREE_DATA_MISSING_NOTICE = 'This run\'s objects wrapper has no relationship tree data, so each recipe file is shown as its own card, with its objects in file order and no lookups. Run "Generate Treecipe" again to see the run\'s relationship trees.';

const RUN_FOLDER_TIMESTAMP_PATTERN = /-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})$/;

const FAKER_JS_RUN_FOLDER_PREFIX = 'recipe-fakerjs-';

const RECIPE_FILE_EXTENSIONS = ['.yml', '.yaml'];

// A FIELD ONLY THE ORG HOLDS (#446) IS READ FROM ITS STAGED FILE, WHICH SAYS WHETHER IT IS A FORMULA
export const RECIPE_COCKPIT_UPDATER_FORMULA_REASON = 'a formula: Salesforce calculates its value';

export class RecipeCockpitModelBuild {

    /*
        The TODOs a card's removed-TODOs file (#391) lists that are still out of its recipe, read
        beside it: only a file inside the workspace. A TODO back in the recipe -- put back by hand,
        or never really gone -- is left out, so it is listed once, under Open; the next write of the
        file drops it. A file that is there and cannot be read lists nothing, with a notice.
    */
    static readRemovedTodos(recipeFilePath: string, workspaceRoot: string, recipeText: string | undefined): { entries: IRemovedTodoComment[]; notices: string[] } {

        const removedTodoFilePath = RecipeCockpitRemovedTodoStore.buildFilePath(recipeFilePath);
        const removedTodoRead = this.readRemovedTodoFile(removedTodoFilePath, workspaceRoot);

        if ( removedTodoRead.isUnreadable ) {
            return { entries: [], notices: [`"${path.basename(removedTodoFilePath)}" is not a removed-TODOs file the Recipe Cockpit can read, so its recipe lists no removed TODO.`] };
        }
        if ( removedTodoRead.entries.length === 0 || recipeText === undefined ) {
            return { entries: [], notices: [] };
        }

        return { entries: this.listRemovedTodosStillOut(recipeText, removedTodoRead.entries), notices: [] };

    }

    // ONE SPLIT AND SCAN FOR EVERY REMOVED TODO OF THE FILE
    static listRemovedTodosStillOut(recipeText: string, entries: IRemovedTodoComment[]): IRemovedTodoComment[] {
        const { lines } = RecipeCockpitRecipeWriter.splitRecipeLines(recipeText);
        const scannedObjects = RecipeCockpitRecipeWriter.scanRecipeObjects(lines);
        return entries.filter(entry => !RecipeCockpitRecipeWriter.isRemovedTodoBack(lines, scannedObjects, entry, entries));
    }

    static buildRemovedTodoViewModels(entries: IRemovedTodoComment[]): IRecipeCockpitRemovedTodoViewModel[] {
        return entries.map((entry, entryIndex) => ({
            removalKey: String(entryIndex),
            objectApiName: entry.objectApiName,
            ...( entry.objectNickname !== undefined ? { objectNickname: entry.objectNickname } : {} ),
            ...( entry.fieldApiName !== undefined ? { fieldApiName: entry.fieldApiName } : {} ),
            lineNumber: entry.lineNumber,
            text: entry.todoText
        }));
    }

    // NO FILE IS NO ENTRIES; ONE OUTSIDE THE WORKSPACE IS NEVER READ
    static readRemovedTodoFile(removedTodoFilePath: string, workspaceRoot: string): IRemovedTodoFileRead {

        if ( !RecipeCockpitTreeSelectionStore.isUsableWorkspacePath(removedTodoFilePath, workspaceRoot) ) {
            return { entries: [], isUnreadable: false };
        }

        try {
            return RecipeCockpitRemovedTodoStore.parse(fs.readFileSync(removedTodoFilePath, 'utf-8'));
        } catch {
            return { entries: [], isUnreadable: true };
        }

    }

    /*
        One staged field as the Adapter offers it (#446, #447): a field model drawn from its file, so
        the Updater's own rules read it as they read a recipe field; locked by a formula, a lookup the
        file names, or the lock given; else the expression the recipe's backend writes for its type,
        or none (a fixed value only).
    */
    static offerStagedField(newField: IOrgNewFieldDetail,
                                    fieldApiName: string,
                                    findLockReason: (fieldViewModel: IRecipeCockpitFieldViewModel) => string | undefined,
                                    recipeService: RecipeService | undefined): { fieldViewModel: IRecipeCockpitFieldViewModel; lockReason?: string; expression?: string } {

        const fieldSize = {
            ...( newField.length !== undefined ? { length: newField.length } : {} ),
            ...( newField.precision !== undefined ? { precision: newField.precision } : {} ),
            ...( newField.scale !== undefined ? { scale: newField.scale } : {} )
        };
        const fieldViewModel: IRecipeCockpitFieldViewModel = {
            fieldApiName: fieldApiName,
            fieldLabel: newField.fieldLabel,
            fieldType: newField.fieldType,
            fieldTypeWithSize: this.formatFieldTypeWithSize(newField.fieldType, fieldSize),
            recipeValue: '',
            controllingField: newField.controllingField,
            isOnlyInRecipeFile: false,
            // SO A TYPED VALUE IS HELD TO THE VALUES ITS STAGED FILE LISTS, AS A RECIPE PICKLIST'S IS
            ...( newField.picklistValues.length > 0 ? { isPicklist: true } : {} )
        };
        const lockReason = newField.isFormula
            ? RECIPE_COCKPIT_UPDATER_FORMULA_REASON
            : newField.referenceTo !== ''
                ? RECIPE_COCKPIT_UPDATER_LOOKUP_REASON
                : findLockReason(fieldViewModel);

        let expression: string | undefined;
        if ( lockReason === undefined && recipeService ) {
            const xmlFieldDetail = Object.assign(new XMLFieldDetail(), {
                apiName: fieldApiName,
                fieldType: newField.fieldType,
                fieldLabel: newField.fieldLabel,
                xmlMarkup: '',
                ...fieldSize,
                ...( newField.picklistValues.length > 0 ? { picklistValues: newField.picklistValues.map(picklistValue => ({ picklistOptionApiName: picklistValue, label: picklistValue })) } : {} ),
                ...( newField.valueSetName !== '' ? { globalValueSetName: newField.valueSetName } : {} )
            });
            expression = recipeService.getOrgOnlyFieldExpression(xmlFieldDetail);
        }
        fieldViewModel.recipeValue = expression ?? '';

        return {
            fieldViewModel: fieldViewModel,
            ...( lockReason !== undefined ? { lockReason: lockReason } : {} ),
            ...( expression !== undefined ? { expression: expression } : {} )
        };

    }

    // THE PARENTS A CARD CAN ADD ARE THE TEMPLATE'S OBJECTS, WHICH BOTH BACKENDS SHARE; THE VALUES COME FROM THE RECIPE'S OWN BACKEND AT THE WRITE
    static getParentObjectTemplates(fakerService: 'faker-js' | 'snowfakery'): Record<string, Record<string, string>> {

        return fakerService === 'faker-js'
            ? new FakerJSRecipeFakerService().getMinimumRequiredFieldsTemplate()
            : new SnowfakeryRecipeFakerService().getMinimumRequiredFieldsTemplate();

    }

    /*
        The card's TODO lookups whose one standard parent the recipe does not write (#294), from the
        text the load already read when it has it; a file that cannot be read offers none.
    */
    static listTreeAddableParents(recipeFilePath: string,
                                    tree: IRecipeCockpitTreeViewModel,
                                    objectLevelsByApiName: Map<string, number> | undefined,
                                    alreadyReadRecipeText?: string): IRecipeCockpitAddableParentViewModel[] {

        let recipeText = alreadyReadRecipeText;
        if ( recipeText === undefined ) {
            try {
                recipeText = fs.readFileSync(recipeFilePath, 'utf-8');
            } catch {
                return [];
            }
        }

        const templateObjectApiNames = new Set(Object.keys(this.getParentObjectTemplates('faker-js')));

        return RecipeCockpitRecipeWriter.listAddableParentObjects(recipeText, this.buildLookupWiringContext(tree, objectLevelsByApiName), templateObjectApiNames)
            .map(addition => ({ ...addition }));

    }

    /*
        The card's TODO lookups to one parent (#421), each with why Create or Use existing would be
        refused, from the text the load already read when it has it; a file that cannot be read
        offers none.
    */
    static listTreeEmptyLookups(recipeFilePath: string,
                                tree: IRecipeCockpitTreeViewModel,
                                objectLevelsByApiName: Map<string, number> | undefined,
                                alreadyReadRecipeText?: string): IRecipeCockpitEmptyLookupViewModel[] {

        let recipeText = alreadyReadRecipeText;
        if ( recipeText === undefined ) {
            try {
                recipeText = fs.readFileSync(recipeFilePath, 'utf-8');
            } catch {
                return [];
            }
        }

        const templateObjectApiNames = new Set(Object.keys(this.getParentObjectTemplates('faker-js')));

        return RecipeCockpitRecipeWriter.listEmptyLookups(recipeText, this.buildLookupWiringContext(tree, objectLevelsByApiName), templateObjectApiNames)
            .map(emptyLookup => ({ ...emptyLookup }));

    }

    // WHAT THE WRITER DECIDES A WIRING BY: THE CARD'S OWN LOOKUPS AND RelationshipService's LEVELS, AS THE GENERATE BUTTON'S FILTERED COPY USES THEM
    static buildLookupWiringContext(tree: IRecipeCockpitTreeViewModel, objectLevelsByApiName: Map<string, number> | undefined): ILookupWiringContext {

        const parentLookupsByObjectApiName = new Map<string, IRecipeFilterLookup[]>();
        tree.objects
            .filter(treeObject => treeObject.iterationNickname === undefined)
            .forEach(treeObject => parentLookupsByObjectApiName.set(treeObject.objectApiName, treeObject.parentLookups.map(parentLookup => ({ ...parentLookup }))));

        return {
            parentLookupsByObjectApiName: parentLookupsByObjectApiName,
            ...( objectLevelsByApiName ? { levelsByObjectApiName: objectLevelsByApiName } : {} )
        };

    }

    /*
        The card's TODO lookups, from the text the load already read for the file (readRecipeSourceFiles)
        when it has it, else read from disk; a file that cannot be read offers none.
    */
    static listTreeLookupWirings(recipeFilePath: string,
                                    tree: IRecipeCockpitTreeViewModel,
                                    objectLevelsByApiName: Map<string, number> | undefined,
                                    alreadyReadRecipeText?: string): IRecipeCockpitLookupWiringViewModel[] {

        let recipeText = alreadyReadRecipeText;
        if ( recipeText === undefined ) {
            try {
                recipeText = fs.readFileSync(recipeFilePath, 'utf-8');
            } catch {
                return [];
            }
        }

        return RecipeCockpitRecipeWriter.listLookupWirings(recipeText, this.buildLookupWiringContext(tree, objectLevelsByApiName))
            .map(wiring => ({
                objectApiName: wiring.objectApiName,
                ...( wiring.objectNickname !== undefined ? { objectNickname: wiring.objectNickname } : {} ),
                fieldApiName: wiring.fieldApiName,
                candidateNicknames: wiring.candidateNicknames
            }));

    }

    /*
        Each rule a field row names (#560) gets sourceRuleNames for the ones whose file the project
        holds, found once per load from the configured objects path. Only a field with rules is
        looked at, so a run without them reads no configuration and posts the model it did; a path
        that cannot be resolved costs the links, never the load.
    */
    static attachValidationRuleSources(objects: IRecipeCockpitObjectViewModel[], workspaceRoot: string) {

        const ruleNamesOf = (validationRules: IRecipeCockpitFieldValidationRulesViewModel) =>
            [...new Set([...validationRules.appliedRuleNames, ...validationRules.notAppliedRules.map(notAppliedRule => notAppliedRule.ruleName)])];

        const ruleNamesByObject = new Map<string, string[]>();
        objects.forEach(objectViewModel => objectViewModel.fields.forEach(fieldViewModel => {
            if ( fieldViewModel.validationRules ) {
                let ruleNames = ruleNamesByObject.get(objectViewModel.objectApiName);
                if ( !ruleNames ) {
                    ruleNames = [];
                    ruleNamesByObject.set(objectViewModel.objectApiName, ruleNames);
                }
                ruleNames.push(...ruleNamesOf(fieldViewModel.validationRules));
            }
        }));

        if ( ruleNamesByObject.size === 0 ) {
            return;
        }

        let objectsDirectoryPath: string;
        try {
            objectsDirectoryPath = ConfigurationService.resolveObjectsDirectoryPath(workspaceRoot);
        } catch {
            return;
        }

        const sourceFilePaths = RecipeCockpitValidationRuleList.resolveRuleSourceFilePaths(objectsDirectoryPath, workspaceRoot, ruleNamesByObject);

        objects.forEach(objectViewModel => objectViewModel.fields.forEach(fieldViewModel => {
            if ( !fieldViewModel.validationRules ) {
                return;
            }
            const sourceRuleNames = ruleNamesOf(fieldViewModel.validationRules)
                .filter(ruleName => sourceFilePaths.has(RecipeCockpitValidationRuleList.buildRuleSourceKey(objectViewModel.objectApiName, ruleName)));
            if ( sourceRuleNames.length > 0 ) {
                fieldViewModel.validationRules.sourceRuleNames = sourceRuleNames;
            }
        }));

    }

    /*
        Every Generate Treecipe run under GeneratedRecipes that carries an objects wrapper, newest
        first.

        Ordered by the timestamp SUFFIX rather than the folder name: a faker-js run is prefixed
        "recipe-fakerjs-" and a snowfakery run "recipe-", so sorting the names would rank every run
        of one backend above every run of the other regardless of when either ran. A folder that
        does not end in a run timestamp, or holds no wrapper, is not a run this panel can read.
    */
    static findGeneratedRecipeRuns(generatedRecipesFolderPath: string): IRecipeCockpitRun[] {

        if ( !SfdxProjectService.isExistingDirectory(generatedRecipesFolderPath) ) {
            return [];
        }

        const recipeRuns: IRecipeCockpitRun[] = [];

        fs.readdirSync(generatedRecipesFolderPath, { withFileTypes: true }).forEach(runFolderEntry => {

            if ( !runFolderEntry.isDirectory() ) {
                return;
            }

            const timestampMatch = RUN_FOLDER_TIMESTAMP_PATTERN.exec(runFolderEntry.name);

            if ( !timestampMatch ) {
                return;
            }

            const runFolderPath = path.join(generatedRecipesFolderPath, runFolderEntry.name);
            const objectsWrapperFilePath = this.findObjectsWrapperFilePath(runFolderPath, timestampMatch);

            if ( !objectsWrapperFilePath ) {
                return;
            }

            const [, runDate, runHours, runMinutes, runSeconds] = timestampMatch;

            const customTreeFolderNames = this.listCustomTreeFolderNames(runFolderPath);
            recipeRuns.push({
                runFolderName: runFolderEntry.name,
                runFolderPath: runFolderPath,
                generatedAtTimestamp: `${runDate}T${runHours}:${runMinutes}:${runSeconds}Z`,
                objectsWrapperFilePath: objectsWrapperFilePath,
                ...( customTreeFolderNames.length > 0 ? { customTreeFolderNames: customTreeFolderNames } : {} )
            });

        });

        return recipeRuns.sort((firstRun, secondRun) => (
            secondRun.generatedAtTimestamp.localeCompare(firstRun.generatedAtTimestamp)
            || firstRun.runFolderName.localeCompare(secondRun.runFolderName)
        ));

    }

    // A RUN'S "custom-" TREE FOLDERS (#677) THAT HOLD A RECIPE, SORTED WITH "<"; A LINK OR A NAME THAT COULD STEP OUT IS NOT ONE
    static listCustomTreeFolderNames(runFolderPath: string): string[] {

        // ONE UNREADABLE custom- FOLDER IS LEFT OUT OF THE LIST, NEVER THE REASON THE COCKPIT CANNOT LOAD
        const holdsRecipeFile = (treeFolderPath: string) => {
            try {
                return fs.readdirSync(treeFolderPath, { withFileTypes: true })
                    .some(treeFolderEntry => treeFolderEntry.isFile() && RECIPE_FILE_EXTENSIONS.includes(path.extname(treeFolderEntry.name).toLowerCase()));
            } catch {
                return false;
            }
        };

        return fs.readdirSync(runFolderPath, { withFileTypes: true })
            .filter(runFolderEntry => runFolderEntry.isDirectory()
                                        && RecipeCockpitCustomTreecipe.isCustomTreeFolderName(runFolderEntry.name)
                                        && RecipeCockpitCustomTreecipe.isTreeFolderName(runFolderEntry.name)
                                        && holdsRecipeFile(path.join(runFolderPath, runFolderEntry.name)))
            .map(runFolderEntry => runFolderEntry.name)
            .sort((left, right) => ( left < right ? -1 : left > right ? 1 : 0 ));

    }

    // THE WRAPPER NAMED FOR THE RUN'S OWN TIMESTAMP IF IT IS THERE, OTHERWISE THE FIRST WRAPPER IN THE FOLDER
    private static findObjectsWrapperFilePath(runFolderPath: string, timestampMatch: RegExpExecArray): string | undefined {

        const objectsWrapperPrefix = ConfigurationService.getTreecipeObjectsWrapperName();
        const runTimestamp = timestampMatch[0].substring(1);

        const objectsWrapperFileNames = fs.readdirSync(runFolderPath, { withFileTypes: true })
            .filter(runFileEntry => runFileEntry.isFile()
                                    && runFileEntry.name.startsWith(objectsWrapperPrefix)
                                    && runFileEntry.name.endsWith('.json'))
            .map(runFileEntry => runFileEntry.name)
            .sort();

        const objectsWrapperFileName = objectsWrapperFileNames.find(fileName => fileName === `${objectsWrapperPrefix}-${runTimestamp}.json`)
            ?? objectsWrapperFileNames[0];

        return objectsWrapperFileName ? path.join(runFolderPath, objectsWrapperFileName) : undefined;

    }

    static buildRunLabel(recipeRun: IRecipeCockpitRun, isLatestRun: boolean): string {

        const generatedAt = recipeRun.generatedAtTimestamp.replace('T', ' ').replace('Z', ' UTC');
        const fakerService = recipeRun.runFolderName.startsWith(FAKER_JS_RUN_FOLDER_PREFIX) ? 'faker-js' : 'snowfakery';

        return `${generatedAt} · ${fakerService}${isLatestRun ? ' · latest' : ''}`;

    }

    // THE LOADER, END TO END: THE LATEST RUN, OR THE ONE REQUESTED WHEN IT IS STILL ON DISK
    static buildRecipeViewModel(workspaceRoot: string, requestedRunFolderName?: string): IRecipeCockpitRecipeViewModel {

        const generatedRecipesFolderPath = path.join(workspaceRoot, ConfigurationService.getGeneratedRecipesFolderPath());

        return this.buildRecipeViewModelByRuns(this.findGeneratedRecipeRuns(generatedRecipesFolderPath), workspaceRoot, requestedRunFolderName);

    }

    // A TREE FOLDER'S customTreecipe.json (#677), OR undefined FOR A GENERATED TREE, A MISSING FILE OR ONE THAT DOES NOT READ BACK
    static readCustomTreecipeDefinition(treeFolderPath: string): ICustomTreecipeDefinition | undefined {

        const definitionFilePath = path.join(treeFolderPath, RECIPE_COCKPIT_CUSTOM_TREECIPE_FILE_NAME);
        try {
            const definitionFileStats = fs.lstatSync(definitionFilePath);
            if ( !definitionFileStats.isFile() || definitionFileStats.size > RECIPE_COCKPIT_CUSTOM_TREECIPE_MAX_FILE_BYTES ) {
                return undefined;
            }
            return RecipeCockpitCustomTreecipe.readDefinition(fs.readFileSync(definitionFilePath, 'utf8'));
        } catch {
            return undefined;
        }

    }

    /*
        A custom tree (#677) as one card: its objects in the order its original generated tree
        inserts them -- the wrapper's tree of that folder name -- then any its recipe holds that the
        wrapper's tree does not, in recipe order. Its source, for the card, is what its
        customTreecipe.json records, or its original when that file does not read back.
    */
    static buildCustomTreeSource(normalizedObjectsWrapper: Pick<IRecipeCockpitNormalizedObjectsWrapper, 'recipeTrees'>,
                                    recipeSourceFiles: IRecipeSourceFile[],
                                    runFolderPath: string,
                                    customTreeFolderName: string): IRecipeCockpitCustomTreeSource {

        const definition = this.readCustomTreecipeDefinition(path.join(runFolderPath, customTreeFolderName));
        const originalTreeFolderName = RecipeCockpitCustomTreecipe.resolveOriginalTreeFolderName(customTreeFolderName, definition);
        const recipeObjectApiNames = recipeSourceFiles.flatMap(recipeSourceFile => [...recipeSourceFile.objectEntries.keys()]);
        const recipeObjectApiNameSet = new Set(recipeObjectApiNames);
        const originalTree = normalizedObjectsWrapper.recipeTrees
            .find(recipeTree => RelationshipService.buildRecipeTreeFolderName(recipeTree.objectApiNames) === originalTreeFolderName);
        const orderedObjectApiNames = ( originalTree?.objectApiNames ?? [] ).filter(objectApiName => recipeObjectApiNameSet.has(objectApiName));

        return {
            folderName: customTreeFolderName,
            objectApiNames: [...new Set([...orderedObjectApiNames, ...recipeObjectApiNames])],
            customCopyOf: definition?.sourceTreeFolderName ?? originalTreeFolderName
        };

    }

    static buildRecipeViewModelByRuns(recipeRuns: IRecipeCockpitRun[],
                                        workspaceRoot: string,
                                        requestedRunFolderName?: string): IRecipeCockpitRecipeViewModel {

        return this.loadRecipeRunByRuns(recipeRuns, workspaceRoot, requestedRunFolderName).recipeViewModel;

    }

    static loadRecipeRunByRuns(recipeRuns: IRecipeCockpitRun[],
                                workspaceRoot: string,
                                requestedRunFolderName?: string,
                                customTreeFolderNameByRunFolderName: ReadonlyMap<string, string> = new Map()): IRecipeCockpitLoadedRecipe {

        // EACH RUN, THEN ITS CUSTOM TREES (#677) UNDER IT
        const runViewModels: IRecipeCockpitRunViewModel[] = recipeRuns.flatMap((recipeRun, runIndex) => {
            const runLabel = this.buildRunLabel(recipeRun, runIndex === 0);
            return [
                { runFolderName: recipeRun.runFolderName, label: runLabel },
                ...( recipeRun.customTreeFolderNames ?? [] ).map(customTreeFolderName => ({
                    runFolderName: recipeRun.runFolderName,
                    label: `${runLabel} · ${customTreeFolderName}`,
                    customTreeFolderName: customTreeFolderName
                }))
            ];
        });

        if ( recipeRuns.length === 0 ) {
            return {
                recipeViewModel: { runs: [], selectedRunFolderName: '', objects: [], trees: [], notices: [], emptyStateMessage: RECIPE_COCKPIT_NO_RUN_MESSAGE },
                picklistDisplayValuesByObjectApiName: new Map(),
                treeHistoryTargets: RecipeCockpitTreeHistory.buildEmptyTargets()
            };
        }

        const requestedRun = recipeRuns.find(recipeRun => recipeRun.runFolderName === requestedRunFolderName);
        const selectedRun = requestedRun ?? recipeRuns[0];

        const requestedCustomTreeFolderName = customTreeFolderNameByRunFolderName.get(selectedRun.runFolderName);
        const selectedCustomTreeFolderName = requestedCustomTreeFolderName && ( selectedRun.customTreeFolderNames ?? [] ).includes(requestedCustomTreeFolderName)
            ? requestedCustomTreeFolderName
            : undefined;

        const recipeViewModel: IRecipeCockpitRecipeViewModel = {
            runs: runViewModels,
            selectedRunFolderName: selectedRun.runFolderName,
            ...( selectedCustomTreeFolderName ? { selectedCustomTreeFolderName: selectedCustomTreeFolderName } : {} ),
            objects: [],
            trees: [],
            notices: [],
            emptyStateMessage: ''
        };

        let parsedObjectsWrapper: unknown;

        try {
            parsedObjectsWrapper = JSON.parse(fs.readFileSync(selectedRun.objectsWrapperFilePath, 'utf-8'));
        } catch (readError) {
            recipeViewModel.emptyStateMessage = `The objects wrapper "${path.basename(selectedRun.objectsWrapperFilePath)}" for this run could not be read: ${readError?.message ?? readError}. Choose another run, or run "Generate Treecipe" again.`;
            return {
                recipeViewModel: recipeViewModel,
                picklistDisplayValuesByObjectApiName: new Map(),
                treeHistoryTargets: RecipeCockpitTreeHistory.buildEmptyTargets()
            };
        }

        const normalizedObjectsWrapper = this.normalizeObjectsWrapper(parsedObjectsWrapper);
        const recipeSourceRead = this.readRecipeSourceFiles(selectedRun.runFolderPath, workspaceRoot, selectedCustomTreeFolderName);

        /*
            An object the wrapper holds with no Fields is one a lookup points at. RelationshipService
            still lists it in its tree's RecipeFiles objects, but no recipe is written for it -- so it
            is kept only if a recipe file actually carries it.
        */
        // A CUSTOM TREE (#677) DRAWS ONLY WHAT ITS RECIPE HOLDS: EVERY OTHER OBJECT OF THE RUN BELONGS TO THE RUN'S OWN TREES
        recipeViewModel.objects = this.attachRecipeSources(normalizedObjectsWrapper.objects, recipeSourceRead.recipeSourceFiles)
            .filter(objectViewModel => ( !normalizedObjectsWrapper.fieldlessObjectApiNames.has(objectViewModel.objectApiName) || !!objectViewModel.recipeFilePath )
                                        && ( !selectedCustomTreeFolderName || !!objectViewModel.recipeFilePath ));
        this.applyGeneratedRecordTypes(recipeViewModel.objects, recipeSourceRead.recordTypeBlocks);
        this.attachValidationRuleSources(recipeViewModel.objects, workspaceRoot);

        const recipeTreeBuild = this.buildRecipeTreeViewModels(
            normalizedObjectsWrapper,
            recipeViewModel.objects,
            recipeSourceRead.recipeSourceFiles,
            selectedRun.runFolderPath,
            selectedCustomTreeFolderName ? this.buildCustomTreeSource(normalizedObjectsWrapper, recipeSourceRead.recipeSourceFiles, selectedRun.runFolderPath, selectedCustomTreeFolderName) : undefined
        );

        recipeViewModel.trees = recipeTreeBuild.trees;

        const treeHistoryBuild = RecipeCockpitTreeHistory.buildTreeHistories(
            path.dirname(selectedRun.runFolderPath),
            path.join(workspaceRoot, ConfigurationService.getFakeDataSetsFolderPath()),
            workspaceRoot,
            selectedRun.runFolderName,
            recipeViewModel.trees
        );

        const pinnedFixedValuesByFolderName = new Map<string, Map<string, Map<string, string>>>();
        const removedTodosByTreeKey = new Map<string, IRemovedTodoComment[]>();
        const fixedValueNotices: string[] = [];

        recipeViewModel.trees.forEach(tree => {
            const treeHistory = treeHistoryBuild.historiesByTreeKey.get(tree.treeKey);
            if ( treeHistory ) {
                tree.history = treeHistory;
            }
            const runFakerRecipeFilePath = treeHistoryBuild.targets.runFakerRecipeFilePathsByTreeKey.get(tree.treeKey);
            if ( runFakerRecipeFilePath ) {
                tree.runFakerRecipeFileName = path.basename(runFakerRecipeFilePath);
                const lookupWirings = this.listTreeLookupWirings(runFakerRecipeFilePath, tree, normalizedObjectsWrapper.objectLevelsByApiName, recipeSourceRead.recipeTextsByFilePath.get(runFakerRecipeFilePath));
                if ( lookupWirings.length > 0 ) {
                    tree.lookupWirings = lookupWirings;
                }
                const addableParents = this.listTreeAddableParents(runFakerRecipeFilePath, tree, normalizedObjectsWrapper.objectLevelsByApiName, recipeSourceRead.recipeTextsByFilePath.get(runFakerRecipeFilePath));
                if ( addableParents.length > 0 ) {
                    tree.addableParents = addableParents;
                }
                const emptyLookups = this.listTreeEmptyLookups(runFakerRecipeFilePath, tree, normalizedObjectsWrapper.objectLevelsByApiName, recipeSourceRead.recipeTextsByFilePath.get(runFakerRecipeFilePath));
                if ( emptyLookups.length > 0 ) {
                    tree.emptyLookups = emptyLookups;
                }
                const pinnedFixedValues = RecipeCockpitTreeSelectionStore.readPinnedFixedValues(runFakerRecipeFilePath, workspaceRoot, recipeSourceRead.recipeTextsByFilePath.get(runFakerRecipeFilePath));
                fixedValueNotices.push(...pinnedFixedValues.notices);
                if ( pinnedFixedValues.orgRecordLookups.length > 0 ) {
                    tree.orgRecordLookups = pinnedFixedValues.orgRecordLookups;
                }
                if ( tree.folderName && pinnedFixedValues.valuesByObject.size > 0 ) {
                    pinnedFixedValuesByFolderName.set(tree.folderName, pinnedFixedValues.valuesByObject);
                }
                const removedTodos = this.readRemovedTodos(runFakerRecipeFilePath, workspaceRoot, recipeSourceRead.recipeTextsByFilePath.get(runFakerRecipeFilePath));
                fixedValueNotices.push(...removedTodos.notices);
                if ( removedTodos.entries.length > 0 ) {
                    removedTodosByTreeKey.set(tree.treeKey, removedTodos.entries);
                    tree.removedTodos = this.buildRemovedTodoViewModels(removedTodos.entries);
                }
            }
        });

        const unmatchedDatasetNotices = treeHistoryBuild.unmatchedDatasetCount > 0
            ? [RecipeCockpitTreeHistory.buildUnmatchedDatasetsNotice(treeHistoryBuild.unmatchedDatasetCount)]
            : [];

        const missingRunNotices = requestedRunFolderName && !requestedRun
            ? [`The run "${requestedRunFolderName}" is no longer on disk, so the latest run is shown instead.`]
            : [];

        recipeViewModel.notices = [...missingRunNotices, ...normalizedObjectsWrapper.notices, ...recipeSourceRead.notices, ...recipeTreeBuild.notices, ...fixedValueNotices, ...unmatchedDatasetNotices];

        if ( recipeViewModel.objects.length === 0 ) {
            recipeViewModel.emptyStateMessage = normalizedObjectsWrapper.isObjectsWrapper
                ? `The objects wrapper "${path.basename(selectedRun.objectsWrapperFilePath)}" lists no objects. Choose another run, or run "Generate Treecipe" again.`
                : `"${path.basename(selectedRun.objectsWrapperFilePath)}" is not a Treecipe objects wrapper. Choose another run, or run "Generate Treecipe" again.`;
        }

        return {
            recipeViewModel: recipeViewModel,
            picklistDisplayValuesByObjectApiName: normalizedObjectsWrapper.picklistDisplayValuesByObjectApiName,
            treeHistoryTargets: treeHistoryBuild.targets,
            ...( normalizedObjectsWrapper.objectLevelsByApiName ? { objectLevelsByApiName: normalizedObjectsWrapper.objectLevelsByApiName } : {} ),
            ...( pinnedFixedValuesByFolderName.size > 0 ? { pinnedFixedValuesByFolderName: pinnedFixedValuesByFolderName } : {} ),
            ...( removedTodosByTreeKey.size > 0 ? { removedTodosByTreeKey: removedTodosByTreeKey } : {} ),
            objectsWrapperFilePath: selectedRun.objectsWrapperFilePath
        };

    }

    /*
        The ObjectInfoWrapper JSON, reduced to what the panel renders and checked on the way.

        The file is on disk, so nothing in it is assumed: every value read is type checked, a field
        entry with no api name is dropped and COUNTED rather than rendered as a row with nothing to
        name it by, and an object only referenced by a lookup -- a key the wrapper holds for the
        relationship but no recipe was written for -- is not listed as though it were in the recipe.

        Objects come in RECIPE order, the order RecipeFiles says they are inserted in, because that
        is the order the reader meets them in the files the panel opens.
    */
    static normalizeObjectsWrapper(parsedObjectsWrapper: unknown): IRecipeCockpitNormalizedObjectsWrapper {

        const objectsWrapperRecord = this.asRecord(parsedObjectsWrapper);
        const objectToObjectInfoMap = this.asRecord(objectsWrapperRecord?.ObjectToObjectInfoMap);

        if ( !objectToObjectInfoMap ) {
            return {
                objects: [],
                notices: [],
                isObjectsWrapper: false,
                fieldlessObjectApiNames: new Set(),
                picklistDisplayValuesByObjectApiName: new Map(),
                recipeTrees: [],
                parentLookupsByObjectApiName: new Map()
            };
        }

        const recipeObjectApiNames: string[] = [];
        const recipeTrees: IRecipeCockpitWrapperTree[] = [];
        const recipeFiles = objectsWrapperRecord.RecipeFiles;

        if ( Array.isArray(recipeFiles) ) {
            recipeFiles.forEach(recipeFile => {
                const recipeFileObjects = this.asRecord(recipeFile)?.objects;
                if ( Array.isArray(recipeFileObjects) ) {
                    const treeObjectApiNames = recipeFileObjects.filter((objectApiName): objectApiName is string => typeof objectApiName === 'string' && !!objectApiName);
                    treeObjectApiNames.forEach(objectApiName => recipeObjectApiNames.push(objectApiName));
                    if ( treeObjectApiNames.length > 0 ) {
                        recipeTrees.push({ objectApiNames: treeObjectApiNames });
                    }
                }
            });
        }

        const wrapperObjectApiNames = Object.keys(objectToObjectInfoMap);
        const recipeObjectApiNameSet = new Set(recipeObjectApiNames);

        const orderedObjectApiNames = new Set([
            ...recipeObjectApiNames.filter(objectApiName => Object.prototype.hasOwnProperty.call(objectToObjectInfoMap, objectApiName)),
            ...wrapperObjectApiNames.filter(objectApiName => !recipeObjectApiNameSet.has(objectApiName))
        ]);

        const objects: IRecipeCockpitObjectViewModel[] = [];
        const fieldlessObjectApiNames = new Set<string>();
        const picklistDisplayValuesByObjectApiName: RecipeCockpitPicklistDisplayValuesByObjectApiName = new Map();
        const parentLookupsByObjectApiName = new Map<string, IRecipeCockpitParentLookupViewModel[]>();
        const objectLevelsByApiName = new Map<string, number>();
        let unreadableFieldCount = 0;

        orderedObjectApiNames.forEach(objectApiName => {

            const wrapperObjectRecord = this.asRecord(objectToObjectInfoMap[objectApiName]);
            const wrapperFields = wrapperObjectRecord?.Fields;
            const recordTypePicklistSections = this.readRecordTypePicklistSections(wrapperObjectRecord?.RecordTypesMap);

            parentLookupsByObjectApiName.set(objectApiName, this.readParentLookups(wrapperObjectRecord?.RelationshipDetail));
            const objectLevel = this.asRecord(wrapperObjectRecord?.RelationshipDetail)?.level;
            if ( typeof objectLevel === 'number' && Number.isInteger(objectLevel) && objectLevel >= 0 ) {
                objectLevelsByApiName.set(objectApiName, objectLevel);
            }

            if ( !Array.isArray(wrapperFields) ) {

                if ( !recipeObjectApiNameSet.has(objectApiName) ) {
                    return;
                }

                fieldlessObjectApiNames.add(objectApiName);

            }

            const fields: IRecipeCockpitFieldViewModel[] = [];

            ( Array.isArray(wrapperFields) ? wrapperFields : [] ).forEach(wrapperField => {

                const wrapperFieldRecord = this.asRecord(wrapperField) ?? {};
                const fieldApiName = wrapperFieldRecord.fieldName;

                if ( typeof fieldApiName !== 'string' || !fieldApiName ) {
                    unreadableFieldCount++;
                    return;
                }

                const activePicklistValues = Array.isArray(wrapperFieldRecord.picklistValues)
                    ? this.readActivePicklistValues(wrapperFieldRecord.picklistValues)
                    : undefined;

                const fieldType = this.asString(wrapperFieldRecord.type);
                const fieldViewModel: IRecipeCockpitFieldViewModel = {
                    fieldApiName: fieldApiName,
                    fieldLabel: this.asString(wrapperFieldRecord.fieldLabel),
                    fieldType: fieldType,
                    fieldTypeWithSize: this.formatFieldTypeWithSize(fieldType, {
                        length: this.asFieldSize(wrapperFieldRecord.length),
                        precision: this.asFieldSize(wrapperFieldRecord.precision),
                        scale: this.asFieldSize(wrapperFieldRecord.scale)
                    }),
                    recipeValue: this.buildDisplayExpression(this.asString(wrapperFieldRecord.recipeValue).split('\n')),
                    controllingField: this.asString(wrapperFieldRecord.controllingField),
                    isOnlyInRecipeFile: false
                };

                const validationRules = this.readFieldValidationRules(wrapperFieldRecord);
                if ( validationRules ) {
                    fieldViewModel.validationRules = validationRules;
                }

                // WORKSPACE TEXT: A STRING, AND NO LONGER THAN SALESFORCE ALLOWS A FORMULA
                if ( typeof wrapperFieldRecord.formula === 'string' && wrapperFieldRecord.formula.length <= RECIPE_COCKPIT_READ_ONLY_FORMULA_MAXIMUM_LENGTH ) {
                    fieldViewModel.formula = wrapperFieldRecord.formula;
                }

                if ( RECIPE_COCKPIT_PICKLIST_FIELD_TYPES.includes(fieldType) ) {

                    fieldViewModel.isPicklist = true;

                    const picklistDisplayValuesByFieldApiName = picklistDisplayValuesByObjectApiName.get(objectApiName) ?? new Map<string, IRecipeCockpitPicklistDisplayValues>();
                    picklistDisplayValuesByFieldApiName.set(fieldApiName, {
                        picklistValues: activePicklistValues ?? [],
                        recordTypePicklistValues: recordTypePicklistSections
                            .filter(recordTypeSection => Object.prototype.hasOwnProperty.call(recordTypeSection.picklistValuesByFieldApiName, fieldApiName))
                            .map(recordTypeSection => ({
                                recordTypeDeveloperName: recordTypeSection.recordTypeDeveloperName,
                                picklistValues: recordTypeSection.picklistValuesByFieldApiName[fieldApiName]
                            }))
                    });
                    picklistDisplayValuesByObjectApiName.set(objectApiName, picklistDisplayValuesByFieldApiName);

                }

                fields.push(fieldViewModel);

            });

            const recordTypes = this.readRecordTypeOptions(wrapperObjectRecord?.RecordTypesMap, fields);
            objects.push({
                objectApiName: objectApiName,
                recipeFilePath: '',
                fields: fields,
                ...( recordTypes.length >= 2 ? { recordTypes: recordTypes } : {} )
            });

        });

        const notices = unreadableFieldCount > 0
            ? [`${unreadableFieldCount} field ${unreadableFieldCount === 1 ? 'entry' : 'entries'} in the objects wrapper had no field api name and ${unreadableFieldCount === 1 ? 'is' : 'are'} not shown.`]
            : [];

        return {
            objects: objects,
            notices: notices,
            isObjectsWrapper: true,
            fieldlessObjectApiNames: fieldlessObjectApiNames,
            picklistDisplayValuesByObjectApiName: picklistDisplayValuesByObjectApiName,
            recipeTrees: recipeTrees,
            parentLookupsByObjectApiName: parentLookupsByObjectApiName,
            objectLevelsByApiName: objectLevelsByApiName
        };

    }

    /*
        A field's type as the Structure tab draws it: "Number(16,2)" from precision and scale,
        "Text(50)" from length, the bare type otherwise. A precision with no scale is a scale of 0,
        which is what Salesforce gives such a field. A run from before sizes were recorded has
        neither, so it draws the bare type.
    */
    static formatFieldTypeWithSize(fieldType: string, fieldSize: IFieldSize): string {

        if ( !fieldType ) {
            return '';
        }

        if ( fieldSize.precision !== undefined ) {
            return `${fieldType}(${fieldSize.precision},${fieldSize.scale ?? 0})`;
        }

        if ( fieldSize.length !== undefined ) {
            return `${fieldType}(${fieldSize.length})`;
        }

        return fieldType;

    }

    private static asFieldSize(candidateValue: unknown): number | undefined {

        return typeof candidateValue === 'number' && Number.isInteger(candidateValue) && candidateValue >= 0
            ? candidateValue
            : undefined;

    }

    /*
        RelationshipDetail.parentObjectToFieldReferences as one entry per lookup field, in the
        order the wrapper lists them. Anything not a string is dropped: the file is on disk.
    */
    static readParentLookups(relationshipDetail: unknown): IRecipeCockpitParentLookupViewModel[] {

        const parentObjectToFieldReferences = this.asRecord(this.asRecord(relationshipDetail)?.parentObjectToFieldReferences);
        const parentLookups: IRecipeCockpitParentLookupViewModel[] = [];

        if ( !parentObjectToFieldReferences ) {
            return parentLookups;
        }

        Object.keys(parentObjectToFieldReferences).forEach(parentObjectApiName => {

            const fieldApiNames = parentObjectToFieldReferences[parentObjectApiName];

            if ( !Array.isArray(fieldApiNames) ) {
                return;
            }

            fieldApiNames
                .filter((fieldApiName): fieldApiName is string => typeof fieldApiName === 'string' && !!fieldApiName)
                .forEach(fieldApiName => parentLookups.push({ fieldApiName: fieldApiName, parentObjectApiName: parentObjectApiName }));

        });

        return parentLookups;

    }

    /*
        RecordTypesMap as the per-field values each record type assigns, in the map's own order --
        RecordTypeService sorts it by developer name once where it is loaded (#166), so re-sorting
        here would be a second order to keep in step.
    */
    static readRecordTypePicklistSections(recordTypesMap: unknown): Array<{ recordTypeDeveloperName: string; picklistValuesByFieldApiName: Record<string, string[]> }> {

        const recordTypesRecord = this.asRecord(recordTypesMap);

        if ( !recordTypesRecord ) {
            return [];
        }

        return Object.keys(recordTypesRecord).map(recordTypeDeveloperName => {

            const picklistSections = this.asRecord(this.asRecord(recordTypesRecord[recordTypeDeveloperName])?.PicklistFieldSectionsToPicklistDetail) ?? {};
            // KEYED BY FIELD API NAME FROM A FILE ON DISK, SO NO PROTOTYPE A NAME LIKE "constructor" COULD READ BACK
            const picklistValuesByFieldApiName: Record<string, string[]> = Object.create(null);

            Object.keys(picklistSections).forEach(fieldApiName => {
                const sectionValues = picklistSections[fieldApiName];
                if ( Array.isArray(sectionValues) ) {
                    picklistValuesByFieldApiName[fieldApiName] = sectionValues.filter((sectionValue): sectionValue is string => typeof sectionValue === 'string');
                }
            });

            return { recordTypeDeveloperName: recordTypeDeveloperName, picklistValuesByFieldApiName: picklistValuesByFieldApiName };

        });

    }

    /*
        The record types the Record types section offers for one object (#195), in the map's own order
        (RecordTypeService sorted it once, #166). Only a developer name that IS an api name is
        offered: generation refuses any other (#120), so offering it would offer nothing. Each
        carries what it restricts -- every picklist field of the object its section lists, and how
        many values it allows there -- as counts, never the values.
    */
    static readRecordTypeOptions(recordTypesMap: unknown, fields: IRecipeCockpitFieldViewModel[]): IRecipeCockpitRecordTypeViewModel[] {

        const recordTypesRecord = this.asRecord(recordTypesMap);

        if ( !recordTypesRecord ) {
            return [];
        }

        const picklistFields = fields.filter(field => RECIPE_COCKPIT_PICKLIST_FIELD_TYPES.includes(field.fieldType));
        const picklistSectionsByDeveloperName = new Map(this.readRecordTypePicklistSections(recordTypesRecord)
            .map(recordTypeSection => [recordTypeSection.recordTypeDeveloperName, recordTypeSection.picklistValuesByFieldApiName]));

        return Object.keys(recordTypesRecord)
            .filter(developerName => SalesforceApiName.isApiName(developerName))
            .map(developerName => {

                // readRecordTypePicklistSections READS EVERY KEY OF THE SAME MAP, SO EVERY OFFERED NAME HAS AN ENTRY
                const picklistValuesByFieldApiName = picklistSectionsByDeveloperName.get(developerName) as Record<string, string[]>;
                const impacts: IRecipeCockpitRecordTypeImpactViewModel[] = picklistFields
                    .filter(field => Object.prototype.hasOwnProperty.call(picklistValuesByFieldApiName, field.fieldApiName))
                    .map(field => ({
                        fieldApiName: field.fieldApiName,
                        kind: field.controllingField ? 'dependent' : ( field.fieldType.toLowerCase() === 'multiselectpicklist' ? 'multiselect' : 'picklist' ),
                        valueCount: picklistValuesByFieldApiName[field.fieldApiName].length
                    }));

                return {
                    developerName: developerName,
                    isActive: this.asRecord(recordTypesRecord[developerName])?.Active !== false,
                    impacts: impacts
                };

            });

    }

    // AN OBJECT WHOSE RECIPE NAMES NONE OF ITS RECORD TYPES IS DRAWN WITH THE DEFAULT TICKED: THE FIRST ACTIVE ONE, AS GENERATION PICKS
    static applyGeneratedRecordTypes(objects: IRecipeCockpitObjectViewModel[], recordTypeBlocks: IRecipeRecordTypeBlocks): void {

        const { developerNamesByObjectApiName, defaultWrittenObjectApiNames } = recordTypeBlocks;

        objects
            .filter(objectViewModel => !!objectViewModel.recordTypes)
            .forEach(objectViewModel => {

                const offeredDeveloperNames = objectViewModel.recordTypes.map(recordType => recordType.developerName);
                const generatedDeveloperNames = (developerNamesByObjectApiName.get(objectViewModel.objectApiName) ?? [])
                    .filter(developerName => offeredDeveloperNames.includes(developerName));

                if ( generatedDeveloperNames.length === 0 ) {
                    const defaultRecordType = objectViewModel.recordTypes.find(recordType => recordType.isActive) ?? objectViewModel.recordTypes[0];
                    objectViewModel.generatedRecordTypeDeveloperNames = [defaultRecordType.developerName];
                    return;
                }

                objectViewModel.generatedRecordTypeDeveloperNames = generatedDeveloperNames;
                if ( !defaultWrittenObjectApiNames.has(objectViewModel.objectApiName) ) {
                    objectViewModel.isRecordTypeSelectionApplied = true;
                }

            });

    }

    /*
        One card per relationship tree, in RecipeFiles order, each listing the objects the recipe
        carries in insert order with the lookups tying each to a parent in the SAME tree.

        A card is keyed by the folder Generate Treecipe wrote the tree to, which it names by the
        tree's first and last object -- lookup targets with no recipe of their own included, so the
        name is taken from the tree's whole object list, before the objects the panel does not list
        are dropped. A wrapper with no RecipeFiles (a run from before they were written, or one
        edited by hand) falls back to one card per recipe file, its objects in file order, with no
        lookups and a notice saying why. An object no card claimed still gets one, because a view
        that left it out would say it is not in the recipe.
    */
    static buildRecipeTreeViewModels(normalizedObjectsWrapper: Pick<IRecipeCockpitNormalizedObjectsWrapper, 'recipeTrees' | 'parentLookupsByObjectApiName'>,
                                        objects: IRecipeCockpitObjectViewModel[],
                                        recipeSourceFiles: IRecipeSourceFile[],
                                        runFolderPath: string,
                                        customTreeSource?: IRecipeCockpitCustomTreeSource): { trees: IRecipeCockpitTreeViewModel[]; notices: string[] } {

        const objectsByApiName = new Map(objects.map(objectViewModel => [objectViewModel.objectApiName, objectViewModel]));
        const claimedObjectApiNames = new Set<string>();
        const usedTreeKeys = new Set<string>();
        const titleCountsByFolderName = new Map<string, number>();
        const trees: IRecipeCockpitTreeViewModel[] = [];
        const notices: string[] = [];

        const hasTreeData = normalizedObjectsWrapper.recipeTrees.length > 0 || !!customTreeSource;

        const treeSources: Array<{ folderName: string; objectApiNames: string[]; hasLookups: boolean }> = customTreeSource
            ? [{ folderName: customTreeSource.folderName, objectApiNames: customTreeSource.objectApiNames, hasLookups: true }]
            : hasTreeData
            ? normalizedObjectsWrapper.recipeTrees.map(recipeTree => ({
                folderName: RelationshipService.buildRecipeTreeFolderName(recipeTree.objectApiNames),
                objectApiNames: recipeTree.objectApiNames,
                hasLookups: true
            }))
            : recipeSourceFiles.map(recipeSourceFile => ({
                folderName: path.resolve(path.dirname(recipeSourceFile.filePath)) === path.resolve(runFolderPath)
                    ? path.basename(recipeSourceFile.filePath)
                    : path.basename(path.dirname(recipeSourceFile.filePath)),
                objectApiNames: [...recipeSourceFile.objectEntries.keys()],
                hasLookups: false
            }));

        if ( !hasTreeData && objects.length > 0 ) {
            notices.push(RECIPE_COCKPIT_TREE_DATA_MISSING_NOTICE);
        }

        treeSources.forEach((treeSource, treeIndex) => {

            const treeObjectApiNameSet = new Set(treeSource.objectApiNames);
            const treeObjects: IRecipeCockpitTreeObjectViewModel[] = [];

            treeSource.objectApiNames.forEach(objectApiName => {

                if ( !objectsByApiName.has(objectApiName) || claimedObjectApiNames.has(objectApiName) ) {
                    return;
                }

                claimedObjectApiNames.add(objectApiName);

                const parentLookups = treeSource.hasLookups
                    ? ( normalizedObjectsWrapper.parentLookupsByObjectApiName.get(objectApiName) ?? [] )
                        .filter(parentLookup => treeObjectApiNameSet.has(parentLookup.parentObjectApiName))
                    : [];

                treeObjects.push({ objectApiName: objectApiName, parentLookups: parentLookups });

            });

            const treeViewModel = this.buildTreeViewModel(
                this.claimTreeKey(treeSource.folderName, treeIndex, usedTreeKeys),
                this.claimTreeTitle(treeSource.folderName, titleCountsByFolderName),
                treeSource.folderName,
                this.placeTreeIterations(treeObjects, objectsByApiName),
                objectsByApiName
            );
            if ( customTreeSource ) {
                treeViewModel.customCopyOf = customTreeSource.customCopyOf;
            }
            trees.push(treeViewModel);

        });

        const unclaimedObjects = objects.filter(objectViewModel => !claimedObjectApiNames.has(objectViewModel.objectApiName));

        if ( unclaimedObjects.length > 0 ) {
            trees.push(this.buildTreeViewModel(
                this.claimTreeKey('', trees.length, usedTreeKeys),
                RECIPE_COCKPIT_UNGROUPED_TREE_TITLE,
                '',
                unclaimedObjects.map(objectViewModel => ({ objectApiName: objectViewModel.objectApiName, parentLookups: [] })),
                objectsByApiName
            ));
        }

        return { trees: trees, notices: notices };

    }

    // THE FOLDER NAME, UNLESS A HAND-EDITED WRAPPER REPEATS ONE -- TWO CARDS SHARING A KEY WOULD SCOPE A SEARCH TO BOTH
    private static claimTreeKey(folderName: string, treeIndex: number, usedTreeKeys: Set<string>): string {

        const treeKey = usedTreeKeys.has(folderName) ? `${folderName}#${treeIndex + 1}` : folderName;
        usedTreeKeys.add(treeKey);
        return treeKey;

    }

    /*
        Where a card lists each LATER occurrence of an object (#467): right under the occurrence whose
        friends: block holds it, one level deeper, after what is already listed under that one -- so a
        friend added under a self-lookup iteration is drawn under the iteration, and its own friends
        under it in turn. Occurrences are placed in file order, so a parent is listed before what it
        holds. A later block sharing its first occurrence's parent (a record type block, #194) is that
        occurrence's sibling and follows it at its depth, as does an occurrence whose parent the card
        cannot name. First occurrences keep insert order and draw no indent.
    */
    static placeTreeIterations(treeObjects: IRecipeCockpitTreeObjectViewModel[],
                                objectsByApiName: ReadonlyMap<string, IRecipeCockpitObjectViewModel>): IRecipeCockpitTreeObjectViewModel[] {

        interface ITreeObjectPlace { entry: IRecipeCockpitTreeObjectViewModel; depth: number; children: ITreeObjectPlace[]; followers: ITreeObjectPlace[] }

        const roots: ITreeObjectPlace[] = treeObjects.map(entry => ({ entry: entry, depth: 0, children: [], followers: [] }));
        const placesByNickname = new Map<string, ITreeObjectPlace>();
        const claimNickname = (nickname: string | undefined, place: ITreeObjectPlace) => {
            if ( nickname !== undefined && !placesByNickname.has(nickname) ) {
                placesByNickname.set(nickname, place);
            }
        };

        const laterOccurrences: { place: ITreeObjectPlace; root: ITreeObjectPlace; iteration: IRecipeCockpitObjectIterationViewModel }[] = [];
        roots.forEach(root => {
            const objectViewModel = objectsByApiName.get(root.entry.objectApiName);
            claimNickname(objectViewModel?.nickname ?? objectViewModel?.recipeNickname, root);
            ( objectViewModel?.iterations ?? [] ).forEach(iteration => laterOccurrences.push({
                place: { entry: { objectApiName: root.entry.objectApiName, parentLookups: root.entry.parentLookups, iterationNickname: iteration.nickname }, depth: 0, children: [], followers: [] },
                root: root,
                iteration: iteration
            }));
        });

        if ( laterOccurrences.length === 0 ) {
            return treeObjects;
        }

        laterOccurrences
            .sort((first, second) => first.iteration.lineNumber - second.iteration.lineNumber)
            .forEach(({ place, root, iteration }) => {
                const firstOccurrence = objectsByApiName.get(root.entry.objectApiName);
                const isSiblingOfFirst = iteration.parentNickname === undefined
                    || ( iteration.parentNickname === firstOccurrence?.parentNickname && iteration.parentObjectApiName === firstOccurrence?.countParentObjectApiName );
                const parentPlace = isSiblingOfFirst ? undefined : placesByNickname.get(iteration.parentNickname as string);
                if ( parentPlace ) {
                    place.depth = parentPlace.depth + 1;
                    parentPlace.children.push(place);
                } else {
                    place.depth = root.depth;
                    root.followers.push(place);
                }
                claimNickname(iteration.nickname, place);
            });

        const placedTreeObjects: IRecipeCockpitTreeObjectViewModel[] = [];
        const listPlace = (place: ITreeObjectPlace) => {
            placedTreeObjects.push(place.depth > 0 ? { ...place.entry, nestingDepth: place.depth } : place.entry);
            place.children.forEach(listPlace);
            place.followers.forEach(listPlace);
        };
        roots.forEach(listPlace);

        return placedTreeObjects;

    }

    /*
        A card is named by the folder Generate Treecipe wrote it to (#389), so the dropdown says
        what a tree holds -- "<first>-thru-<last>" or "<only>-ONLY" -- rather than where it sits.
        A hand-edited wrapper can repeat a folder; the second takes " (2)" so the two options differ.
    */
    private static claimTreeTitle(folderName: string, titleCountsByFolderName: Map<string, number>): string {

        const titleCount = ( titleCountsByFolderName.get(folderName) ?? 0 ) + 1;
        titleCountsByFolderName.set(folderName, titleCount);
        return titleCount === 1 ? folderName : `${folderName} (${titleCount})`;

    }

    private static buildTreeViewModel(treeKey: string,
                                        title: string,
                                        folderName: string,
                                        treeObjects: IRecipeCockpitTreeObjectViewModel[],
                                        objectsByApiName: Map<string, IRecipeCockpitObjectViewModel>): IRecipeCockpitTreeViewModel {

        return {
            treeKey: treeKey,
            title: title,
            folderName: folderName,
            objects: treeObjects,
            // AN OBJECT'S FIELDS ONCE, HOWEVER MANY OCCURRENCES OF IT THE CARD LISTS
            fieldCount: treeObjects
                .filter(treeObject => treeObject.iterationNickname === undefined)
                .reduce((fieldCount, treeObject) => fieldCount + objectsByApiName.get(treeObject.objectApiName).fields.length, 0)
        };

    }

    /*
        A FieldInfo's picklistValues as the values a record can be given: an entry with no
        picklistOptionApiName names nothing and is skipped, and one marked isActive: false is not
        a value a record can take. An absent isActive is active, as XmlFileProcessor defaults it.
    */
    static readActivePicklistValues(wrapperPicklistValues: unknown[]): string[] {

        return wrapperPicklistValues.reduce<string[]>((activePicklistValues, wrapperPicklistValue) => {

            const picklistValueRecord = this.asRecord(wrapperPicklistValue);
            const picklistOptionApiName = picklistValueRecord?.picklistOptionApiName;

            if ( typeof picklistOptionApiName === 'string' && picklistValueRecord.isActive !== false ) {
                activePicklistValues.push(picklistOptionApiName);
            }

            return activePicklistValues;

        }, []);

    }

    private static asRecord(candidateValue: unknown): Record<string, unknown> | undefined {

        return candidateValue !== null && typeof candidateValue === 'object' && !Array.isArray(candidateValue)
            ? candidateValue as Record<string, unknown>
            : undefined;

    }

    private static asString(candidateValue: unknown): string {

        return typeof candidateValue === 'string' ? candidateValue : '';

    }

    /*
        A faker expression as a reader would read it in the file, without the file's placement.

        The first line is whatever followed "Field:" and is trimmed on its own; a YAML block
        indicator ("|", ">", with or without a chomping sign) or nothing at all there is dropped.
        The lines after it are DEDENTED rather than trimmed: they are indented to line up in the
        recipe file, which is noise in a row, but their indentation RELATIVE to each other is the
        structure of a choice-if block, and trimming each line flattened it into a list that no
        longer said which "pick" belonged to which "when".
    */
    /*
        A field's validation rules as #324 recorded them (#325), or undefined for a field none names.
        The wrapper is a workspace file, so every record is type-checked and one that is not is
        skipped. An applied rule counts only when both values the box switches between are strings:
        without them nothing could be switched, and the field is drawn as it was before #325.
    */
    static readFieldValidationRules(wrapperFieldRecord: Record<string, unknown>): IRecipeCockpitFieldValidationRulesViewModel | undefined {

        const ruleRecords = wrapperFieldRecord.validationRuleConstraints;
        if ( !Array.isArray(ruleRecords) ) {
            return undefined;
        }

        const readableRules = ruleRecords
            .map(ruleRecord => this.asRecord(ruleRecord))
            .filter((ruleRecord): ruleRecord is Record<string, unknown> => !!ruleRecord
                                                                            && typeof ruleRecord.ruleName === 'string'
                                                                            && ruleRecord.ruleName !== ''
                                                                            && typeof ruleRecord.applied === 'boolean');
        const recipeValue = wrapperFieldRecord.recipeValue;
        const unconstrainedRecipeValue = wrapperFieldRecord.unconstrainedRecipeValue;
        const canSwitch = typeof recipeValue === 'string' && typeof unconstrainedRecipeValue === 'string';
        const appliedRuleNames = canSwitch
            ? [...new Set(readableRules.filter(ruleRecord => ruleRecord.applied).map(ruleRecord => ruleRecord.ruleName as string))]
            : [];
        const notAppliedRules = readableRules
            .filter(ruleRecord => !ruleRecord.applied)
            .map(ruleRecord => ({ ruleName: ruleRecord.ruleName as string, reason: typeof ruleRecord.reason === 'string' ? ruleRecord.reason : '' }));

        if ( appliedRuleNames.length === 0 && notAppliedRules.length === 0 ) {
            return undefined;
        }

        return {
            appliedRuleNames: appliedRuleNames,
            notAppliedRules: notAppliedRules,
            ...( appliedRuleNames.length > 0 ? {
                recipeValue: recipeValue as string,
                unconstrainedRecipeValue: unconstrainedRecipeValue as string,
                unconstrainedExpression: this.buildDisplayExpression(( unconstrainedRecipeValue as string ).split('\n'))
            } : {} )
        };

    }

    static buildDisplayExpression(expressionLines: string[]): string {

        const [firstLine = '', ...continuationLines] = expressionLines;

        const leadingText = firstLine.trim();
        const bodyLines = continuationLines.filter(continuationLine => !!continuationLine.trim());
        // A LOOP RATHER THAN Math.min(...spread), WHICH THROWS PAST THE ENGINE'S ARGUMENT LIMIT ON A LONG ENOUGH VALUE
        const indentWidth = bodyLines.reduce(
            (narrowestIndent, bodyLine) => Math.min(narrowestIndent, bodyLine.length - bodyLine.trimStart().length),
            Number.POSITIVE_INFINITY
        );
        const dedentedLines = bodyLines.map(bodyLine => bodyLine.slice(indentWidth).trimEnd());

        const isBlockIndicatorOnly = !leadingText || /^[|>][-+]?$/.test(leadingText);

        return ( isBlockIndicatorOnly ? dedentedLines : [leadingText, ...dedentedLines] ).join('\n');

    }

    /*
        Every recipe file the run wrote, read for where each object and field sits in it.

        Only regular files inside the WORKSPACE are read: each path found here can become something
        the host opens, so it passes the same containment check the Apex-writing commands apply --
        symlinks resolved -- before it is trusted. One unreadable file costs that file's source
        links and a notice, not the panel.
    */
    // recipeTextsByFilePath IS EACH FILE'S TEXT AS IT WAS READ HERE, SO THE TREE CARDS' TODO LOOKUPS ARE LISTED WITHOUT READING IT AGAIN (#151)
    static readRecipeSourceFiles(runFolderPath: string, workspaceRoot: string, onlyCustomTreeFolderName?: string): { recipeSourceFiles: IRecipeSourceFile[]; notices: string[]; recipeTextsByFilePath: Map<string, string>; recordTypeBlocks: IRecipeRecordTypeBlocks } {

        const recipeSourceFiles: IRecipeSourceFile[] = [];
        const notices: string[] = [];
        const recipeTextsByFilePath = new Map<string, string>();
        const recordTypeBlocks = RecipeCockpitRecipeWriter.buildEmptyRecordTypeBlocks();

        this.collectRecipeFilePaths(runFolderPath, onlyCustomTreeFolderName)
            .filter(recipeFilePath => SfdxProjectService.isPathContainedInWorkspace(path.resolve(recipeFilePath), path.resolve(workspaceRoot)))
            .forEach(recipeFilePath => {

                try {
                    const recipeText = fs.readFileSync(recipeFilePath, 'utf-8');
                    recipeSourceFiles.push({
                        filePath: recipeFilePath,
                        objectEntries: this.parseRecipeSource(recipeText, recordTypeBlocks)
                    });
                    recipeTextsByFilePath.set(recipeFilePath, recipeText);
                } catch (readError) {
                    notices.push(`The recipe file "${path.basename(recipeFilePath)}" could not be read (${readError?.message ?? readError}), so its objects and fields cannot be opened from here.`);
                }

            });

        return { recipeSourceFiles: recipeSourceFiles, notices: notices, recipeTextsByFilePath: recipeTextsByFilePath, recordTypeBlocks: recordTypeBlocks };

    }

    /*
        The run folder and its relationship-tree subfolders, which is where DirectoryProcessor writes
        each recipe. A run leaves its "custom-" tree folders out (#677): they hold the run's objects
        a second time, and a run keeps one view model per object. Asked for one custom tree, it reads
        that folder alone.
    */
    static collectRecipeFilePaths(runFolderPath: string, onlyCustomTreeFolderName?: string): string[] {

        // AN ADAPTED RECIPE (#448) IS A SIDE FILE: READING ITS OBJECTS TOO WOULD DRAW EVERY ONE TWICE
        const isRecipeFile = (fileEntry: fs.Dirent) => (
            fileEntry.isFile()
            && RECIPE_FILE_EXTENSIONS.includes(path.extname(fileEntry.name).toLowerCase())
            && !RecipeCockpitAdaptedDataset.isAdaptedRecipeFileName(fileEntry.name)
        );

        const recipeFilePaths: string[] = [];

        fs.readdirSync(runFolderPath, { withFileTypes: true }).forEach(runFolderEntry => {

            const runFolderEntryPath = path.join(runFolderPath, runFolderEntry.name);

            if ( isRecipeFile(runFolderEntry) ) {
                if ( !onlyCustomTreeFolderName ) {
                    recipeFilePaths.push(runFolderEntryPath);
                }
                return;
            }

            const isWantedTreeFolder = onlyCustomTreeFolderName
                ? runFolderEntry.name === onlyCustomTreeFolderName
                : !RecipeCockpitCustomTreecipe.isCustomTreeFolderName(runFolderEntry.name);
            if ( !runFolderEntry.isDirectory() || !isWantedTreeFolder ) {
                return;
            }

            fs.readdirSync(runFolderEntryPath, { withFileTypes: true })
                .filter(isRecipeFile)
                .forEach(treeFolderEntry => recipeFilePaths.push(path.join(runFolderEntryPath, treeFolderEntry.name)));

        });

        return recipeFilePaths.sort();

    }

    /*
        Where each object and field sits in one recipe file, by line, with the text of each field's
        value.

        This reads the layout both faker backends emit rather than parsing YAML, through the SAME
        scan RecipeCockpitRecipeWriter edits by, so the line the panel jumps to and the line an edit
        changes cannot disagree: "- object: X" at column zero, "  fields:" under it, one field per
        line at exactly four spaces, and every column four spaces deeper for each "friends:" level a
        faker-js recipe nests a child object under (#46). Anything deeper than a field is its
        continuation (a block scalar, a choice-if, a commented TODO). The first occurrence wins, for
        an object and for a field, which is the line a reader jumping to it expects. An object
        written again -- the nested child iteration a self-lookup adds (#188) -- is a second entry
        only when NICKNAMES tell the two apart: then it is kept on the first as an iteration, with
        its own lines, and the map stays keyed by api name for everything that asks about an object.
    */
    static parseRecipeSource(recipeContent: string, recordTypeBlocks?: IRecipeRecordTypeBlocks): Map<string, IRecipeSourceObjectEntry> {

        const objectEntries = new Map<string, IRecipeSourceObjectEntry>();
        const { lines } = RecipeCockpitRecipeWriter.splitRecipeLines(recipeContent);
        const scannedObjects = RecipeCockpitRecipeWriter.scanRecipeObjects(lines);
        if ( recordTypeBlocks ) {
            RecipeCockpitRecipeWriter.collectRecordTypeBlocks(lines, scannedObjects, recordTypeBlocks);
        }
        const scannedFriendIndex = RecipeCockpitRecipeWriter.buildScannedFriendIndex(scannedObjects);
        const scannedObjectsByHeaderIndex = scannedFriendIndex.objectsByHeaderIndex;

        // "<object>\n<nickname>" -> HOW MANY OCCURRENCES OF THAT OBJECT CARRY THAT NICKNAME
        const occurrenceCountsByNicknameKey = new Map<string, number>();
        scannedObjects.forEach(scannedObject => scannedObject.nicknames.forEach(nickname => {
            const nicknameKey = `${scannedObject.objectApiName}\n${nickname}`;
            occurrenceCountsByNicknameKey.set(nicknameKey, (occurrenceCountsByNicknameKey.get(nicknameKey) ?? 0) + 1);
        }));
        const readDistinctNickname = (scannedObject: IScannedObject): string | undefined => (
            scannedObject.nicknames.length === 1 && occurrenceCountsByNicknameKey.get(`${scannedObject.objectApiName}\n${scannedObject.nicknames[0]}`) === 1
                ? scannedObject.nicknames[0]
                : undefined
        );
        const occurrenceCountsByObject = new Map<string, number>();
        scannedObjects.forEach(scannedObject => occurrenceCountsByObject.set(scannedObject.objectApiName, (occurrenceCountsByObject.get(scannedObject.objectApiName) ?? 0) + 1));
        // AN OCCURRENCE NO NICKNAME TELLS APART FROM ANOTHER OF ITS OBJECT: ITS TODOS CANNOT BE REMOVED, SINCE A RESTORE COULD NOT FIND THEIR PLACE (#391)
        const isIndistinctOccurrence = (scannedObject: IScannedObject): boolean => (
            occurrenceCountsByObject.get(scannedObject.objectApiName) > 1 && readDistinctNickname(scannedObject) === undefined
        );

        scannedObjects.forEach(scannedObject => {

            const firstObjectEntry = objectEntries.get(scannedObject.objectApiName);

            if ( !firstObjectEntry ) {
                const nickname = scannedObject.nicknames.length === 1 ? scannedObject.nicknames[0] : undefined;
                const recordCount = RecipeCockpitRecipeWriter.readObjectCount(lines, scannedObject);
                const parentScannedObject = scannedObject.parentHeaderIndex !== undefined ? scannedObjectsByHeaderIndex.get(scannedObject.parentHeaderIndex) : undefined;
                const countParentObjectApiName = parentScannedObject?.objectApiName;
                objectEntries.set(scannedObject.objectApiName, {
                    lineNumber: scannedObject.headerIndex + 1,
                    ...( nickname !== undefined ? { nickname: nickname } : {} ),
                    ...( recordCount !== undefined ? { recordCount: recordCount } : {} ),
                    ...( countParentObjectApiName !== undefined ? { countParentObjectApiName: countParentObjectApiName } : {} ),
                    ...( parentScannedObject?.nicknames.length === 1 ? { parentNickname: parentScannedObject.nicknames[0] } : {} ),
                    fieldEntries: this.readRecipeSourceFieldEntries(scannedObject, lines),
                    ...( RecipeCockpitRecipeWriter.hasRecordTypeSections(lines, scannedObject) ? { hasRecordTypeSections: true } : {} )
                });
                this.attachRecipeSourceTodos(objectEntries.get(scannedObject.objectApiName), scannedObject, lines, isIndistinctOccurrence(scannedObject));
                return;
            }

            // A LATER OCCURRENCE IS KEPT ONLY WHEN IT AND THE FIRST EACH CARRY A NICKNAME NO OTHER OCCURRENCE DOES; ANY OTHER IS LEFT TO THE FIRST, AS BEFORE (#188)
            const nickname = readDistinctNickname(scannedObject);
            const firstScannedObject = scannedObjectsByHeaderIndex.get(firstObjectEntry.lineNumber - 1);
            if ( nickname === undefined || readDistinctNickname(firstScannedObject) === undefined ) {
                firstObjectEntry.hasIndistinctOccurrences = true;
                // THE FIRST OCCURRENCE IS THE ONE ROW DRAWN FOR THEM ALL, SO IT LISTS THEIR TODOS TOO (#354)
                this.attachRecipeSourceTodos(firstObjectEntry, scannedObject, lines, true);
                return;
            }

            const parentScannedObject = scannedObjectsByHeaderIndex.get(scannedObject.parentHeaderIndex);
            const insertableFriendObjectApiNames = RecipeCockpitRecipeWriter.listInsertableFriendObjectApiNames(scannedObjects, scannedObject, scannedFriendIndex);
            const iterationRecordCount = RecipeCockpitRecipeWriter.readObjectCount(lines, scannedObject);
            firstObjectEntry.iterations = [...(firstObjectEntry.iterations ?? []), {
                nickname: nickname,
                lineNumber: scannedObject.headerIndex + 1,
                ...( iterationRecordCount !== undefined ? { recordCount: iterationRecordCount } : {} ),
                ...( parentScannedObject ? { parentObjectApiName: parentScannedObject.objectApiName } : {} ),
                ...( parentScannedObject?.nicknames.length === 1 ? { parentNickname: parentScannedObject.nicknames[0] } : {} ),
                fieldEntries: this.readRecipeSourceFieldEntries(scannedObject, lines),
                ...( insertableFriendObjectApiNames.length > 0 ? { insertableFriendObjectApiNames: insertableFriendObjectApiNames } : {} )
            }];
            this.attachRecipeSourceTodos(firstObjectEntry.iterations[firstObjectEntry.iterations.length - 1], scannedObject, lines, false);

        });

        return objectEntries;

    }

    /*
        Puts each TODO comment of one occurrence's block on the field whose lines hold it, or on the
        entry itself when it sits on no field (#354). A field the entry does not list -- a later
        indistinct occurrence's own field -- puts its TODO on the entry, so none is lost. todos is
        set only when there is one, so a recipe without a TODO is read as it always was.
    */
    private static attachRecipeSourceTodos(
        sourceEntry: { fieldEntries: Map<string, IRecipeSourceFieldEntry>; todos?: IRecipeCockpitTodoViewModel[] },
        scannedObject: IScannedObject,
        lines: string[],
        isIndistinctOccurrence: boolean
    ): void {

        let fieldIndex = 0;
        const markerStartIndexes = new Set(scannedObject.commentedOutFieldMarkers.map(marker => marker.startIndex));

        scannedObject.todoLineIndexes.forEach(todoLineIndex => {

            while ( fieldIndex < scannedObject.fields.length && scannedObject.fields[fieldIndex].endIndex <= todoLineIndex ) {
                fieldIndex++;
            }

            const scannedField = scannedObject.fields[fieldIndex];
            const removeLock: RecipeCockpitTodoRemoveLock | undefined = isIndistinctOccurrence
                ? 'indistinct-occurrence'
                : RecipeCockpitRecipeWriter.findTodoRemoveLock(lines, scannedObject, todoLineIndex, {
                    fieldStartingAtLine: scannedField && scannedField.startIndex === todoLineIndex ? scannedField : null,
                    owningField: scannedField && scannedField.startIndex < todoLineIndex && todoLineIndex < scannedField.endIndex ? scannedField : null,
                    markerStartIndexes: markerStartIndexes
                });
            const todo: IRecipeCockpitTodoViewModel = {
                lineNumber: todoLineIndex + 1,
                text: RecipeCockpitRecipeWriter.readTodoCommentText(lines[todoLineIndex]) ?? '',
                ...( removeLock !== undefined ? { removeLock: removeLock } : {} )
            };

            const fieldEntry = scannedField && scannedField.startIndex <= todoLineIndex
                ? sourceEntry.fieldEntries.get(scannedField.fieldApiName)
                : undefined;
            const todoOwner = fieldEntry ?? sourceEntry;

            // PUSHED, NEVER SPREAD: ONE OWNER CAN HOLD THOUSANDS, AND A COPY PER TODO WAS 14 s FOR 50,000
            ( todoOwner.todos ??= [] ).push(todo);

        });

    }

    // THE FIRST OCCURRENCE OF EACH FIELD WINS, WHICH IS THE LINE A READER JUMPING TO IT EXPECTS
    private static readRecipeSourceFieldEntries(scannedObject: IScannedObject, lines: string[]): Map<string, IRecipeSourceFieldEntry> {

        const { fieldIndent } = RecipeCockpitRecipeWriter.getObjectLayout(scannedObject.objectIndent);
        const fieldEntries = new Map<string, IRecipeSourceFieldEntry>();

        scannedObject.fields.forEach(scannedField => {

            if ( fieldEntries.has(scannedField.fieldApiName) ) {
                return;
            }

            const firstLineValue = lines[scannedField.startIndex].slice(fieldIndent.length + scannedField.fieldApiName.length + 1);
            const continuationLines = lines.slice(scannedField.startIndex + 1, scannedField.endIndex);

            fieldEntries.set(scannedField.fieldApiName, {
                lineNumber: scannedField.startIndex + 1,
                valueText: this.buildDisplayExpression([firstLineValue, ...continuationLines])
            });

        });

        return fieldEntries;

    }

    /*
        Gives each object the file and line it is written at, each field its line, and adds the
        fields the recipe file carries that the wrapper does not (see isOnlyInRecipeFile).

        Fields are ordered by line so the panel reads in the same order as the file it opens; a
        field the file does not carry keeps its wrapper order after them.
    */
    static attachRecipeSources(objects: IRecipeCockpitObjectViewModel[], recipeSourceFiles: IRecipeSourceFile[]): IRecipeCockpitObjectViewModel[] {

        return objects.map(objectViewModel => {

            const recipeSourceFile = recipeSourceFiles.find(sourceFile => sourceFile.objectEntries.has(objectViewModel.objectApiName));

            if ( !recipeSourceFile ) {
                return objectViewModel;
            }

            const objectEntry = recipeSourceFile.objectEntries.get(objectViewModel.objectApiName);
            const wrapperFieldApiNames = new Set(objectViewModel.fields.map(fieldViewModel => fieldViewModel.fieldApiName));

            /*
                The wrapper records every lookup as the generated "### TODO -- REFERENCE ID REQUIRED", and
                keeps saying so after Generate Treecipe wired it to an ancestor (#46) or the reader wired
                it in the cockpit (#151). Such a row shows what the recipe FILE says instead, which is
                what Run Faker reads.
            */
            const locatedWrapperFields = objectViewModel.fields.map(fieldViewModel => {
                const fieldEntry = objectEntry.fieldEntries.get(fieldViewModel.fieldApiName);
                return {
                    ...fieldViewModel,
                    ...( fieldEntry && fieldViewModel.recipeValue.startsWith(RelationshipService.referenceIdRequiredTodo) ? { recipeValue: fieldEntry.valueText } : {} ),
                    lineNumber: fieldEntry?.lineNumber
                };
            });

            const recipeFileOnlyFields: IRecipeCockpitFieldViewModel[] = [];

            objectEntry.fieldEntries.forEach((fieldEntry, fieldApiName) => {

                if ( wrapperFieldApiNames.has(fieldApiName) ) {
                    return;
                }

                recipeFileOnlyFields.push({
                    fieldApiName: fieldApiName,
                    fieldLabel: '',
                    fieldType: '',
                    fieldTypeWithSize: '',
                    recipeValue: fieldEntry.valueText,
                    controllingField: '',
                    isOnlyInRecipeFile: true,
                    lineNumber: fieldEntry.lineNumber,
                    ...( fieldEntry.todos ? { todos: this.buildFieldTodoViewModels(fieldEntry.todos, fieldEntry.valueText) } : {} )
                });

            });

            locatedWrapperFields.forEach(fieldViewModel => {
                const fieldTodos = objectEntry.fieldEntries.get(fieldViewModel.fieldApiName)?.todos;
                if ( fieldTodos ) {
                    fieldViewModel.todos = this.buildFieldTodoViewModels(fieldTodos, fieldViewModel.recipeValue);
                }
            });

            const locatedFields = [...locatedWrapperFields, ...recipeFileOnlyFields]
                .filter(fieldViewModel => fieldViewModel.lineNumber !== undefined)
                .sort((firstField, secondField) => firstField.lineNumber - secondField.lineNumber);

            const unlocatedFields = locatedWrapperFields.filter(fieldViewModel => fieldViewModel.lineNumber === undefined);

            return {
                ...objectViewModel,
                recipeFilePath: recipeSourceFile.filePath,
                lineNumber: objectEntry.lineNumber,
                fields: [...locatedFields, ...unlocatedFields],
                ...( objectEntry.hasIndistinctOccurrences ? { hasIndistinctOccurrences: true } : {} ),
                ...( objectEntry.hasRecordTypeSections ? { hasRecordTypeSections: true } : {} ),
                ...( objectEntry.recordCount !== undefined ? { recordCount: objectEntry.recordCount } : {} ),
                ...( objectEntry.countParentObjectApiName !== undefined ? { countParentObjectApiName: objectEntry.countParentObjectApiName } : {} ),
                ...( objectEntry.parentNickname !== undefined ? { parentNickname: objectEntry.parentNickname } : {} ),
                ...( objectEntry.todos ? { todos: objectEntry.todos.slice() } : {} ),
                ...( !objectEntry.iterations && objectEntry.nickname !== undefined ? { recipeNickname: objectEntry.nickname } : {} ),
                ...( objectEntry.iterations ? {
                    nickname: objectEntry.nickname,
                    iterations: objectEntry.iterations.map(iteration => ({
                        nickname: iteration.nickname,
                        lineNumber: iteration.lineNumber,
                        ...( iteration.recordCount !== undefined ? { recordCount: iteration.recordCount } : {} ),
                        ...( iteration.parentObjectApiName !== undefined ? { parentObjectApiName: iteration.parentObjectApiName } : {} ),
                        ...( iteration.parentNickname !== undefined ? { parentNickname: iteration.parentNickname } : {} ),
                        fields: Array.from(iteration.fieldEntries, ([fieldApiName, fieldEntry]) => ({
                            fieldApiName: fieldApiName,
                            lineNumber: fieldEntry.lineNumber,
                            recipeValue: fieldEntry.valueText,
                            ...( fieldEntry.todos ? { todos: this.buildFieldTodoViewModels(fieldEntry.todos, fieldEntry.valueText) } : {} )
                        })),
                        ...( iteration.insertableFriendObjectApiNames ? { insertableFriendObjectApiNames: iteration.insertableFriendObjectApiNames.slice() } : {} ),
                        ...( iteration.todos ? { todos: iteration.todos.slice() } : {} )
                    }))
                } : {} )
            };

        });

    }

    // A FIELD'S TODOS AS POSTED (#354): A TODO ITS DRAWN VALUE ALREADY HOLDS CARRIES ITS LINE AND WHERE IT SITS IN THAT VALUE (#365), NOT ITS TEXT
    static buildFieldTodoViewModels(todos: IRecipeCockpitTodoViewModel[], recipeValue: string): IRecipeCockpitTodoViewModel[] {

        return todos.map(todo => {
            const valueStart = todo.text ? recipeValue.indexOf(todo.text) : -1;
            const removeLock = todo.removeLock !== undefined ? { removeLock: todo.removeLock } : {};
            if ( valueStart === -1 ) {
                return todo.text !== undefined ? { lineNumber: todo.lineNumber, text: todo.text, ...removeLock } : { lineNumber: todo.lineNumber, ...removeLock };
            }
            return { lineNumber: todo.lineNumber, valueStart: valueStart, valueLength: todo.text.length, ...removeLock };
        });

    }

}
