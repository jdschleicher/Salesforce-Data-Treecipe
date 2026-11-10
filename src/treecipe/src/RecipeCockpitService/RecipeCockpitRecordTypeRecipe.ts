import * as vscode from 'vscode';
import { ConfigurationService } from '../ConfigurationService/ConfigurationService';
import { DirectoryProcessor, IRecipeGenerationProgress, RecipeGenerationCancelledError } from '../DirectoryProcessingService/DirectoryProcessor';
import { GlobalValueSetSingleton } from '../GlobalValueSetSingleton/GlobalValueSetSingleton';
import { RecipeCockpitRecipeWriter } from '../RecipeWriter/RecipeCockpitRecipeWriter';
import { IObjectRecordTypeSelection, RecordTypeSelection } from '../RecordTypeService/RecordTypeSelection';
import { RecordTypeWrapper } from '../RecordTypeService/RecordTypesWrapper';
import { RelationshipService } from '../RelationshipService/RelationshipService';

/*
    How the record types ticked under "Manage record types" become ONE generate (#623, slice C of
    #620). The ticks are used at "Generate fake data and insert": when they ask for anything the run's
    recipe does not already write, the tree's recipe is built again in memory from the object
    metadata, and no Generate Treecipe run is written. Slice D adds the 'separate' mode.
*/
export type RecordTypeSetMode = 'folded';

export const RECORD_TYPE_SET_MODE_LABELS: Readonly<Record<RecordTypeSetMode, string>> = Object.freeze({
    folded: 'One data set with the record types folded together'
});

export const RECORD_TYPE_SET_MODE_LEGEND = 'Record types ticked under Manage record types';
export const RECORD_TYPE_RECIPE_PROGRESS_TITLE = 'Building the recipe for the ticked record types';
const RECORD_TYPE_ID_FIELD_API_NAME = 'RecordTypeId';

// WHAT THE PLAN READS OF AN OBJECT WITH RECORD TYPES: ITS DEFAULT, AND WHAT THE RUN'S RECIPE ALREADY WRITES
export interface IRecordTypeTickObject {
    objectApiName: string;
    defaultDeveloperName: string;
    generatedDeveloperNames: readonly string[];
}

export interface IRecordTypeGenerationPlan {
    // FALSE: THE RUN'S RECIPE ON DISK IS GENERATED FROM, EXACTLY AS BEFORE #623
    isRecipeDerived: boolean;
    // EMPTY: THE CONFIRMATION ASKS NOTHING NEW
    offeredModes: RecordTypeSetMode[];
    // ONLY THE OBJECTS WITH A CHOICE; ANY OTHER OBJECT IS GENERATED WITH ITS DEFAULT, AS GENERATE TREECIPE WRITES IT
    recordTypeSelection: Record<string, string[]>;
}

export interface IDroppedRecordTypeTick {
    objectApiName: string;
    missingDeveloperNames: string[];
}

export interface IDerivedTreeRecipe {
    recipeText: string;
    droppedTicks: IDroppedRecordTypeTick[];
}

// WHY THERE IS NO DERIVED RECIPE: THE READER CANCELLED THE WALK, OR THE METADATA NO LONGER BUILDS THE CARD'S TREE
export type DerivedTreeRecipeRefusal = 'cancelled' | 'treeNotBuilt';

/*
    The ticked selection as generation reads it. A tick naming a record type the metadata no longer
    has drops the object's WHOLE choice, as a stale saved selection is dropped (#196): the object is
    generated with its default, since a partial entry would write a choice the reader never made.
*/
class TickedRecordTypeSelection extends RecordTypeSelection {

    readonly droppedTicks: IDroppedRecordTypeTick[] = [];

    resolve(objectApiName: string, writableRecordTypeApiToRecordTypeWrapperMap: Record<string, RecordTypeWrapper>): IObjectRecordTypeSelection {

        const tickedDeveloperNames = this.getDeveloperNames(objectApiName) ?? [];
        const missingDeveloperNames = tickedDeveloperNames
            .filter(developerName => !Object.prototype.hasOwnProperty.call(writableRecordTypeApiToRecordTypeWrapperMap, developerName));

        if ( missingDeveloperNames.length > 0 ) {
            this.droppedTicks.push({ objectApiName: objectApiName, missingDeveloperNames: missingDeveloperNames });
            return { selectedRecordTypeApiNames: [], ignoredDeveloperNames: [] };
        }

        return super.resolve(objectApiName, writableRecordTypeApiToRecordTypeWrapperMap);

    }

}

export class RecipeCockpitRecordTypeRecipe {

    /*
        The rule of #623. An object's ticks are a CHOICE when more than one is ticked or the one
        ticked is not its default: any choice offers the folded question. The recipe is built in
        memory for a choice, and also when the ticks differ from what the run's recipe writes, so
        unticking back to the default takes effect on a run that already has record type blocks.
        An object the panel posted no ticks for is left as the run has it.
    */
    static planGeneration(treeRecordTypeObjects: readonly IRecordTypeTickObject[],
                            tickedDeveloperNamesByObject: Readonly<Record<string, string[]>> | undefined): IRecordTypeGenerationPlan {

        const recordTypeSelection: Record<string, string[]> = Object.create(null);
        let isAnyObjectChangedFromRun = false;

        treeRecordTypeObjects.forEach(treeRecordTypeObject => {

            const { objectApiName, defaultDeveloperName, generatedDeveloperNames } = treeRecordTypeObject;
            const tickedDeveloperNames = tickedDeveloperNamesByObject && Object.prototype.hasOwnProperty.call(tickedDeveloperNamesByObject, objectApiName)
                ? tickedDeveloperNamesByObject[objectApiName]
                : undefined;

            if ( !tickedDeveloperNames || tickedDeveloperNames.length === 0 ) {
                return;
            }

            if ( tickedDeveloperNames.length > 1 || tickedDeveloperNames[0] !== defaultDeveloperName ) {
                recordTypeSelection[objectApiName] = [...tickedDeveloperNames];
            }

            const isSameAsRun = tickedDeveloperNames.length === generatedDeveloperNames.length
                                    && tickedDeveloperNames.every((developerName, nameIndex) => developerName === generatedDeveloperNames[nameIndex]);
            isAnyObjectChangedFromRun = isAnyObjectChangedFromRun || !isSameAsRun;

        });

        const hasChoice = Object.keys(recordTypeSelection).length > 0;

        return {
            isRecipeDerived: hasChoice || isAnyObjectChangedFromRun,
            offeredModes: hasChoice ? ['folded'] : [],
            recordTypeSelection: recordTypeSelection
        };

    }

    /*
        The tree's recipe as Generate Treecipe would write it for these record types, built in memory:
        the same walk of the object metadata, with every record type block carrying its own copy of
        the children (#622). Nothing is written. The walk reads every field file of the project, so
        it runs behind the cancellable progress notification Generate Treecipe shows. The card's
        tree is the recipe file Generate Treecipe would put in the folder of the same name; when the
        metadata no longer builds that tree, there is no recipe to hand back.
    */
    static async buildDerivedTreeRecipe(workspaceRoot: string,
                                        treeFolderName: string,
                                        recordTypeSelection: Readonly<Record<string, string[]>>): Promise<IDerivedTreeRecipe | DerivedTreeRecipeRefusal> {

        const objectsDirectoryPath = ConfigurationService.resolveObjectsDirectoryPath(workspaceRoot);
        const isMissingGlobalValueSetsDirectoryWarningShown = false;
        const isChildTreeCopiedPerRecordTypeBlock = true;
        const tickedSelection = new TickedRecordTypeSelection(Object.keys(recordTypeSelection)
            .map((objectApiName): [string, string[]] => [objectApiName, recordTypeSelection[objectApiName]]), isChildTreeCopiedPerRecordTypeBlock);

        try {

            return await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: RECORD_TYPE_RECIPE_PROGRESS_TITLE,
                cancellable: true
            }, async (progress, cancellationToken) => {

                const generationProgress: IRecipeGenerationProgress = {
                    report: (message: string) => progress.report({ message }),
                    isCancellationRequested: () => cancellationToken.isCancellationRequested
                };

                // AWAITED BEFORE THE WALK, WHICH READS THESE SETS, AS GENERATE TREECIPE DOES
                generationProgress.report('Reading global value sets…');
                await GlobalValueSetSingleton.getInstance().initialize(
                    ConfigurationService.resolveSalesforceMetadataParentPath(objectsDirectoryPath, workspaceRoot),
                    isMissingGlobalValueSetsDirectoryWarningShown
                );
                DirectoryProcessor.throwIfCancellationRequested(generationProgress);

                const objectInfoWrapper = await new DirectoryProcessor().processAllObjectsAndRelationships(vscode.Uri.file(objectsDirectoryPath), generationProgress, tickedSelection);
                const treeRecipeFile = ( objectInfoWrapper.RecipeFiles ?? [] )
                    .find(recipeFile => RelationshipService.buildRecipeTreeFolderName(recipeFile.objects) === treeFolderName);

                return treeRecipeFile
                    ? { recipeText: treeRecipeFile.content, droppedTicks: tickedSelection.droppedTicks }
                    : 'treeNotBuilt';

            });

        } catch (buildError) {
            if ( buildError instanceof RecipeGenerationCancelledError ) {
                return 'cancelled';
            }
            throw buildError;
        }

    }

    /*
        A card's settings are stored by object, or by OCCURRENCE (object and nickname) for an object
        the run's recipe writes more than once (#467). The derived recipe names its blocks after the
        ticked record types, so an occurrence setting is placed again. One whose nickname the derived
        recipe still writes stays on that block. Otherwise one made on the run's first block goes to
        the derived recipe's first block, unless that block has a setting of its own. Any other is
        left out and named. A setting stored by object applies to every block and every copy, a
        record count included.
    */
    static buildOccurrenceSettingPlacer(derivedRecipeText: string,
                                        runFirstNicknameByObject: ReadonlyMap<string, string>,
                                        recordTypeSelection: Readonly<Record<string, string[]>>): OccurrenceSettingPlacer {

        const { lines } = RecipeCockpitRecipeWriter.splitRecipeLines(derivedRecipeText);
        const derivedNicknamesByObject = new Map<string, string[]>();

        RecipeCockpitRecipeWriter.scanRecipeObjects(lines).forEach(scannedObject => {
            const derivedNicknames = derivedNicknamesByObject.get(scannedObject.objectApiName) ?? [];
            derivedNicknames.push(scannedObject.nicknames[0]);
            derivedNicknamesByObject.set(scannedObject.objectApiName, derivedNicknames);
        });

        // THE SELF-LOOKUP ITERATION OF AN OBJECT THAT HAS ONE, AND ITS COPIES UNDER LATER BLOCKS (<Object>_child_<block>_NickName); NEVER A RECORD TYPE BLOCK
        const iterationNicknamesByObject = new Map<string, Set<string>>();
        derivedNicknamesByObject.forEach((derivedNicknames, objectApiName) => {
            const iterationNickname = RelationshipService.buildSelfLookupIterationNickname(objectApiName);
            if ( !derivedNicknames.includes(iterationNickname) ) {
                return;
            }
            const tickedDeveloperNames = Object.prototype.hasOwnProperty.call(recordTypeSelection, objectApiName) ? recordTypeSelection[objectApiName] : [];
            const blockNicknames = RecordTypeSelection.buildRecordTypeBlocks(objectApiName, { selectedRecordTypeApiNames: tickedDeveloperNames, ignoredDeveloperNames: [] }, [iterationNickname])
                .map(recordTypeBlock => recordTypeBlock.nickname);
            const iterationStem = iterationNickname.replace(/NickName$/, '');
            iterationNicknamesByObject.set(objectApiName, new Set(derivedNicknames
                .filter(derivedNickname => !blockNicknames.includes(derivedNickname) && ( derivedNickname === iterationNickname || derivedNickname.startsWith(iterationStem) ))));
        });

        const choiceObjectApiNames = new Set(Object.keys(recordTypeSelection));

        return new OccurrenceSettingPlacer(derivedNicknamesByObject, runFirstNicknameByObject, iterationNicknamesByObject, choiceObjectApiNames);

    }

    // WHAT THE CONFIRMATION SAYS "Remember this selection" WILL DO TO treecipe.config.json; AN EMPTY SELECTION REMOVES A SAVED ONE
    static buildRememberWarning(rememberedRecordTypeSelection: Readonly<Record<string, string[]>>): string {

        const objectApiNames = Object.keys(rememberedRecordTypeSelection);

        return objectApiNames.length > 0
            ? `Remember this selection: treecipe.config.json will hold these record types for Generate Treecipe: ${objectApiNames.map(objectApiName => `${objectApiName}: ${rememberedRecordTypeSelection[objectApiName].join(', ')}`).join('; ')}.`
            : 'Remember this selection: every object is ticked at its default record type, so any record types saved in treecipe.config.json will be removed.';

    }

    // WHAT THE CONFIRMATION WARNS OF: TICKS DROPPED, AND OCCURRENCE SETTINGS THAT REACH ONE BLOCK OR NONE
    static buildConfirmationWarnings(droppedTicks: readonly IDroppedRecordTypeTick[], settingPlacer: OccurrenceSettingPlacer): string[] {

        const describe = (occurrenceKey: string) => {
            const { objectApiName, nickname } = RecipeCockpitRecipeWriter.parseOccurrenceKey(occurrenceKey);
            return `${objectApiName} · ${nickname}`;
        };

        return [
            'The recipe is built again from the object metadata for the ticked record types, so what was written into the recipe file is not in it: lines edited by hand, lookups wired on this card, and parents or friends added on it.',
            ...droppedTicks.map(droppedTick =>
                `${droppedTick.objectApiName} no longer has the record type ${droppedTick.missingDeveloperNames.join(', ')} in the object metadata, so its ticks were dropped and it is generated with its default record type.`),
            ...( settingPlacer.firstBlockOnlyKeys.length > 0
                ? [`Settings made on one copy apply to the first record type block only: ${settingPlacer.firstBlockOnlyKeys.map(describe).join(', ')}.`]
                : [] ),
            ...( settingPlacer.unplacedKeys.length > 0
                ? [`Settings made on a copy this recipe does not write are not applied: ${settingPlacer.unplacedKeys.map(describe).join(', ')}.`]
                : [] ),
            ...( settingPlacer.heldRecordTypeIdObjectApiNames.length > 0
                ? [`${RECORD_TYPE_ID_FIELD_API_NAME} is unticked on this card, and is generated all the same for the objects with record types ticked: ${settingPlacer.heldRecordTypeIdObjectApiNames.join(', ')}.`]
                : [] )
        ];

    }

}

export class OccurrenceSettingPlacer {

    private readonly firstBlockOnlyKeySet = new Set<string>();
    private readonly unplacedKeySet = new Set<string>();
    private readonly heldRecordTypeIdObjectApiNameSet = new Set<string>();

    constructor(private readonly derivedNicknamesByObject: ReadonlyMap<string, string[]>,
                private readonly runFirstNicknameByObject: ReadonlyMap<string, string>,
                private readonly iterationNicknamesByObject: ReadonlyMap<string, ReadonlySet<string>>,
                private readonly choiceObjectApiNames: ReadonlySet<string>) {}

    // EVERY OBJECT THE DERIVED RECIPE WRITES
    get derivedObjectApiNames(): string[] {
        return [...this.derivedNicknamesByObject.keys()];
    }

    // THE BLOCKS AND COPIES OF AN OBJECT, WITHOUT ITS SELF-LOOKUP ITERATIONS
    private listBlockNicknames(objectApiName: string): string[] {
        const iterationNicknames = this.iterationNicknamesByObject.get(objectApiName);
        return ( this.derivedNicknamesByObject.get(objectApiName) ?? [] ).filter(derivedNickname => !iterationNicknames?.has(derivedNickname));
    }

    /*
        The keys a card's settings are applied under in the derived recipe, in the order given. A
        key whose nickname the recipe writes keeps it. A key of the run's first block, when the
        recipe no longer writes that nickname, takes the recipe's first block, but never over a
        setting that block already has. Every other key is left out and named.
    */
    placeKeys<T>(settingsByKey: ReadonlyMap<string, T>): Map<string, T> {

        const placedSettings = new Map<string, T>();
        const firstBlockFallbacks: Array<{ settingKey: string; firstBlockKey: string; setting: T }> = [];

        settingsByKey.forEach((setting, settingKey) => {

            const { objectApiName, nickname } = RecipeCockpitRecipeWriter.parseOccurrenceKey(settingKey);
            const derivedNicknames = this.derivedNicknamesByObject.get(objectApiName) ?? [];

            if ( nickname === undefined || derivedNicknames.includes(nickname) ) {
                placedSettings.set(settingKey, setting);
                this.noteFirstBlockOnly(objectApiName, nickname);
                return;
            }

            if ( nickname === this.runFirstNicknameByObject.get(objectApiName) && derivedNicknames.length > 0 ) {
                firstBlockFallbacks.push({ settingKey: settingKey, firstBlockKey: RecipeCockpitRecipeWriter.buildOccurrenceKey(objectApiName, derivedNicknames[0]), setting: setting });
                return;
            }

            this.unplacedKeySet.add(settingKey);

        });

        firstBlockFallbacks.forEach(({ settingKey, firstBlockKey, setting }) => {

            if ( placedSettings.has(firstBlockKey) ) {
                this.unplacedKeySet.add(settingKey);
                return;
            }

            const { objectApiName, nickname } = RecipeCockpitRecipeWriter.parseOccurrenceKey(firstBlockKey);
            placedSettings.set(firstBlockKey, setting);
            this.noteFirstBlockOnly(objectApiName, nickname);

        });

        return placedSettings;

    }

    // A SETTING ON THE FIRST OF SEVERAL BLOCKS REACHES THAT BLOCK ONLY, WHICH THE CONFIRMATION SAYS
    private noteFirstBlockOnly(objectApiName: string, nickname: string | undefined): void {

        const blockNicknames = this.listBlockNicknames(objectApiName);
        if ( nickname !== undefined && nickname === blockNicknames[0] && blockNicknames.length > 1 ) {
            this.firstBlockOnlyKeySet.add(RecipeCockpitRecipeWriter.buildOccurrenceKey(objectApiName, nickname));
        }

    }

    /*
        A record count is written on ONE occurrence's "count:" line, so an object's count is placed
        on every record type block and every copy of the object: each record type's records get the
        same number of children. A self-lookup's iteration keeps its own count, as it always has. A
        count made on one occurrence wins on the block it is placed on.
    */
    placeCounts(countsByKey: ReadonlyMap<string, number>): Map<string, number> {

        const isOccurrenceCount = (settingKey: string) => RecipeCockpitRecipeWriter.parseOccurrenceKey(settingKey).nickname !== undefined;
        const placedCounts = new Map<string, number>();

        [...countsByKey]
            .filter(([settingKey]) => !isOccurrenceCount(settingKey))
            .forEach(([objectApiName, recordCount]) => {
                const blockNicknames = this.listBlockNicknames(objectApiName);
                if ( blockNicknames.length > 1 ) {
                    blockNicknames.forEach(blockNickname => placedCounts.set(RecipeCockpitRecipeWriter.buildOccurrenceKey(objectApiName, blockNickname), recordCount));
                } else {
                    placedCounts.set(objectApiName, recordCount);
                }
            });

        this.placeKeys(new Map([...countsByKey].filter(([settingKey]) => isOccurrenceCount(settingKey))))
            .forEach((recordCount, placedKey) => placedCounts.set(placedKey, recordCount));

        return placedCounts;

    }

    /*
        An object with record types ticked is generated with its RecordTypeId whatever the card
        unticks: without the line every block would be the default record type, and the ticks would
        do nothing. The confirmation names each object this holds the field for.
    */
    keepRecordTypeIdOfChoiceObjects(excludedFieldApiNamesByKey: ReadonlyMap<string, readonly string[]>): Map<string, string[]> {

        const keptExclusions = new Map<string, string[]>();

        excludedFieldApiNamesByKey.forEach((excludedFieldApiNames, settingKey) => {

            const { objectApiName } = RecipeCockpitRecipeWriter.parseOccurrenceKey(settingKey);
            const isRecordTypeIdHeld = this.choiceObjectApiNames.has(objectApiName) && excludedFieldApiNames.includes(RECORD_TYPE_ID_FIELD_API_NAME);

            if ( isRecordTypeIdHeld ) {
                this.heldRecordTypeIdObjectApiNameSet.add(objectApiName);
            }

            const stillExcludedFieldApiNames = isRecordTypeIdHeld
                ? excludedFieldApiNames.filter(fieldApiName => fieldApiName !== RECORD_TYPE_ID_FIELD_API_NAME)
                : [...excludedFieldApiNames];
            if ( stillExcludedFieldApiNames.length > 0 ) {
                keptExclusions.set(settingKey, stillExcludedFieldApiNames);
            }

        });

        return keptExclusions;

    }

    get firstBlockOnlyKeys(): string[] {
        return [...this.firstBlockOnlyKeySet];
    }

    get unplacedKeys(): string[] {
        return [...this.unplacedKeySet];
    }

    get heldRecordTypeIdObjectApiNames(): string[] {
        return [...this.heldRecordTypeIdObjectApiNameSet];
    }

}
