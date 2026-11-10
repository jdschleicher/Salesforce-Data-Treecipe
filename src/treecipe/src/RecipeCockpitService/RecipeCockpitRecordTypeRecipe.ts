import * as vscode from 'vscode';
import { ConfigurationService } from '../ConfigurationService/ConfigurationService';
import { DirectoryProcessor } from '../DirectoryProcessingService/DirectoryProcessor';
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
        the children (#622). Nothing is written. The card's tree is the recipe file Generate Treecipe
        would put in the folder of the same name; when the metadata no longer builds that tree, there
        is no recipe to hand back.
    */
    static async buildDerivedTreeRecipe(workspaceRoot: string,
                                        treeFolderName: string,
                                        recordTypeSelection: Readonly<Record<string, string[]>>): Promise<IDerivedTreeRecipe | undefined> {

        const objectsDirectoryPath = ConfigurationService.resolveObjectsDirectoryPath(workspaceRoot);
        const isMissingGlobalValueSetsDirectoryWarningShown = false;

        // AWAITED BEFORE THE WALK, WHICH READS THESE SETS, AS GENERATE TREECIPE DOES
        await GlobalValueSetSingleton.getInstance().initialize(
            ConfigurationService.resolveSalesforceMetadataParentPath(objectsDirectoryPath, workspaceRoot),
            isMissingGlobalValueSetsDirectoryWarningShown
        );

        const isChildTreeCopiedPerRecordTypeBlock = true;
        const tickedSelection = new TickedRecordTypeSelection(Object.keys(recordTypeSelection)
            .map((objectApiName): [string, string[]] => [objectApiName, recordTypeSelection[objectApiName]]), isChildTreeCopiedPerRecordTypeBlock);

        const objectInfoWrapper = await new DirectoryProcessor().processAllObjectsAndRelationships(vscode.Uri.file(objectsDirectoryPath), undefined, tickedSelection);
        const treeRecipeFile = ( objectInfoWrapper.RecipeFiles ?? [] )
            .find(recipeFile => RelationshipService.buildRecipeTreeFolderName(recipeFile.objects) === treeFolderName);

        return treeRecipeFile
            ? { recipeText: treeRecipeFile.content, droppedTicks: tickedSelection.droppedTicks }
            : undefined;

    }

    /*
        A card's settings are stored by object, or by OCCURRENCE (object and nickname) for an object
        the run's recipe writes more than once (#467). The derived recipe names its blocks after the
        ticked record types, so an occurrence setting is placed again: one made on the run's first
        block goes to the derived recipe's first block, any other keeps its nickname, and one whose
        block the derived recipe does not write is left out and named. A setting stored by object
        applies to every block and every copy, a record count included.
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

        const isSelfLookupIteration = (objectApiName: string, nickname: string) => {
            const iterationNickname = RelationshipService.buildSelfLookupIterationNickname(objectApiName);
            const tickedDeveloperNames = Object.prototype.hasOwnProperty.call(recordTypeSelection, objectApiName) ? recordTypeSelection[objectApiName] : [];
            const blockNicknames = RecordTypeSelection.buildRecordTypeBlocks(objectApiName, { selectedRecordTypeApiNames: tickedDeveloperNames, ignoredDeveloperNames: [] }, [iterationNickname])
                .map(recordTypeBlock => recordTypeBlock.nickname);
            // A COPY OF THE ITERATION UNDER A LATER BLOCK IS NAMED AFTER IT: <Object>_child_<block>_NickName
            return !blockNicknames.includes(nickname)
                && ( nickname === iterationNickname || nickname.startsWith(iterationNickname.replace(/NickName$/, '')) );
        };

        return new OccurrenceSettingPlacer(derivedNicknamesByObject, runFirstNicknameByObject, isSelfLookupIteration);

    }

    // WHAT THE CONFIRMATION WARNS OF: TICKS DROPPED, AND OCCURRENCE SETTINGS THAT REACH ONE BLOCK OR NONE
    static buildConfirmationWarnings(droppedTicks: readonly IDroppedRecordTypeTick[], settingPlacer: OccurrenceSettingPlacer): string[] {

        const describe = (occurrenceKey: string) => {
            const { objectApiName, nickname } = RecipeCockpitRecipeWriter.parseOccurrenceKey(occurrenceKey);
            return `${objectApiName} · ${nickname}`;
        };

        return [
            'The recipe is built again from the object metadata for the ticked record types, so lines edited by hand in the recipe file and friends added on this card are not in it.',
            ...droppedTicks.map(droppedTick =>
                `${droppedTick.objectApiName} no longer has the record type ${droppedTick.missingDeveloperNames.join(', ')} in the object metadata, so its ticks were dropped and it is generated with its default record type.`),
            ...( settingPlacer.firstBlockOnlyKeys.length > 0
                ? [`Settings made on one copy apply to the first record type block only: ${settingPlacer.firstBlockOnlyKeys.map(describe).join(', ')}.`]
                : [] ),
            ...( settingPlacer.unplacedKeys.length > 0
                ? [`Settings made on a copy this recipe does not write are not applied: ${settingPlacer.unplacedKeys.map(describe).join(', ')}.`]
                : [] )
        ];

    }

}

export class OccurrenceSettingPlacer {

    private readonly firstBlockOnlyKeySet = new Set<string>();
    private readonly unplacedKeySet = new Set<string>();

    constructor(private readonly derivedNicknamesByObject: ReadonlyMap<string, string[]>,
                private readonly runFirstNicknameByObject: ReadonlyMap<string, string>,
                private readonly isSelfLookupIteration: (objectApiName: string, nickname: string) => boolean) {}

    // THE KEY THE SETTING IS APPLIED UNDER IN THE DERIVED RECIPE, OR undefined WHEN NO BLOCK OF IT TAKES THE SETTING
    place(settingKey: string): string | undefined {

        const { objectApiName, nickname } = RecipeCockpitRecipeWriter.parseOccurrenceKey(settingKey);
        if ( nickname === undefined ) {
            return settingKey;
        }

        const derivedNicknames = this.derivedNicknamesByObject.get(objectApiName) ?? [];
        const placedNickname = nickname === this.runFirstNicknameByObject.get(objectApiName) ? derivedNicknames[0] : nickname;

        if ( placedNickname === undefined || !derivedNicknames.includes(placedNickname) ) {
            this.unplacedKeySet.add(settingKey);
            return undefined;
        }

        const placedKey = RecipeCockpitRecipeWriter.buildOccurrenceKey(objectApiName, placedNickname);
        if ( placedNickname === derivedNicknames[0] && derivedNicknames.length > 1 ) {
            this.firstBlockOnlyKeySet.add(placedKey);
        }

        return placedKey;

    }

    /*
        A record count is written on ONE occurrence's "count:" line, so an object's count is placed
        on every record type block and every copy of the object: each record type's records get the
        same number of children. A self-lookup's iteration keeps its own count, as it always has.
    */
    placeCount(settingKey: string): string[] {

        const { objectApiName, nickname } = RecipeCockpitRecipeWriter.parseOccurrenceKey(settingKey);
        if ( nickname !== undefined ) {
            const placedKey = this.place(settingKey);
            return placedKey === undefined ? [] : [placedKey];
        }

        const countedNicknames = ( this.derivedNicknamesByObject.get(objectApiName) ?? [] )
            .filter(derivedNickname => derivedNickname !== undefined && !this.isSelfLookupIteration(objectApiName, derivedNickname));

        return countedNicknames.length > 1
            ? countedNicknames.map(countedNickname => RecipeCockpitRecipeWriter.buildOccurrenceKey(objectApiName, countedNickname))
            : [settingKey];

    }

    placeKeys<T>(settingsByKey: ReadonlyMap<string, T>): Map<string, T> {

        const placedSettings = new Map<string, T>();
        settingsByKey.forEach((setting, settingKey) => {
            const placedKey = this.place(settingKey);
            if ( placedKey !== undefined ) {
                placedSettings.set(placedKey, setting);
            }
        });
        return placedSettings;

    }

    placeCounts(countsByKey: ReadonlyMap<string, number>): Map<string, number> {

        const placedCounts = new Map<string, number>();
        // AN OBJECT'S COUNT FIRST, SO A COUNT MADE ON ONE OCCURRENCE WINS ON THE BLOCK IT IS PLACED ON
        const isOccurrenceCount = (settingKey: string) => RecipeCockpitRecipeWriter.parseOccurrenceKey(settingKey).nickname !== undefined;
        [...countsByKey]
            .sort(([firstKey], [secondKey]) => Number(isOccurrenceCount(firstKey)) - Number(isOccurrenceCount(secondKey)))
            .forEach(([settingKey, recordCount]) => {
                this.placeCount(settingKey).forEach(placedKey => placedCounts.set(placedKey, recordCount));
            });
        return placedCounts;

    }

    get firstBlockOnlyKeys(): string[] {
        return [...this.firstBlockOnlyKeySet];
    }

    get unplacedKeys(): string[] {
        return [...this.unplacedKeySet];
    }

}
