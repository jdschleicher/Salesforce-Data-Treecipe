import { FieldInfo } from "../ObjectInfoWrapper/FieldInfo";
import { ObjectInfo } from "../ObjectInfoWrapper/ObjectInfo";
import { ObjectInfoWrapper } from "../ObjectInfoWrapper/ObjectInfoWrapper";
import { RelationshipDetail, RelationshipTree, OrderedRecipeStructure, OrderedRelationshipTree, RecipeLevel, RecipeInfo, RecipeFileOutput } from "../ObjectInfoWrapper/RelationshipTypes";
import { SalesforceApiName } from "../SalesforceApiName/SalesforceApiName";

export class RelationshipService {

  private static readonly ootbReferenceLookupMap: Readonly<Record<string, string>> = Object.freeze({
    "AccountId": "Account"
  });

  /*
    The folder Generate Treecipe writes one tree's recipe into, and what the Recipe Cockpit names
    that tree's card by: "<only>-ONLY", or "<first>-thru-<last>" in insert order. One rule, so the
    subtitle a reader sees is always the folder they find on disk.
  */
  static buildRecipeTreeFolderName(objectApiNames: string[]): string {

    if ( objectApiNames.length === 1 ) {
      return `${objectApiNames[0]}-ONLY`;
    }

    return `${objectApiNames.at(0)}-thru-${objectApiNames.at(-1)}`;

  }


  buildNewRelationshipDetail(objectApiName?: string): RelationshipDetail {

    return {
      objectApiName: objectApiName || '',
      level: -1, // -1 indicates not yet processed
      parentObjectToFieldReferences: {},
      childObjectToFieldReferences: {},
      isProcessed: false
    };

  }

  /**
  * Main method to process all relationships and establish hierarchy levels
  */
  processAllRelationships(objectInfoWrapper: ObjectInfoWrapper) {

    objectInfoWrapper.RelationshipTrees = this.buildRelationshipTrees(objectInfoWrapper);
    return objectInfoWrapper;

  }

  /*
    An object's level is its longest path from a root once every cycle is cut at the lookup that
    closes it (#104). A cycle has no insert order that satisfies every lookup in it, so one lookup
    per cycle stays a TODO; a depth-first walk in name order, roots first, picks the lookup that
    closes the cycle, and every other lookup is levelled as in an acyclic graph. Each object and
    lookup is walked once, so the cost grows with the graph, not with the paths through it.
  */
  private calculateRelationshipLevels(objectInfoWrapper: ObjectInfoWrapper, relatedObjects: Set<string>): void {

    const objectNamesInNameOrder = RelationshipService.sortByCodeUnit(
      [...relatedObjects].filter(objectName => objectInfoWrapper.ObjectToObjectInfoMap[objectName]?.RelationshipDetail)
    );
    const rootObjectNames = objectNamesInNameOrder.filter(objectName =>
      this.isTopLevelObjectWithNoExternalParents(objectInfoWrapper.ObjectToObjectInfoMap[objectName].RelationshipDetail)
    );

    const walk: CycleCuttingWalk = {
      objectNamesOnPath: new Set<string>(),
      walkedObjectNames: new Set<string>(),
      objectsInFinishOrder: []
    };

    for (const startObjectName of [...rootObjectNames, ...objectNamesInNameOrder]) {
      if (!walk.walkedObjectNames.has(startObjectName)) {
        this.walkCuttingCycleClosingLookups(objectInfoWrapper, startObjectName, walk);
      }
    }

    const objectsInInsertOrder = [...walk.objectsInFinishOrder].reverse();

    objectsInInsertOrder.forEach(({ objectName }) => {
      const relationshipDetail = objectInfoWrapper.ObjectToObjectInfoMap[objectName].RelationshipDetail;
      relationshipDetail.level = 0;
      relationshipDetail.isProcessed = true;
    });

    objectsInInsertOrder.forEach(({ objectName, acyclicChildObjectNames }) => {
      const parentLevel = objectInfoWrapper.ObjectToObjectInfoMap[objectName].RelationshipDetail.level;
      acyclicChildObjectNames.forEach(childObjectName => {
        const childRelationshipDetail = objectInfoWrapper.ObjectToObjectInfoMap[childObjectName].RelationshipDetail;
        childRelationshipDetail.level = Math.max(childRelationshipDetail.level, parentLevel + 1);
      });
    });

  }

  private walkCuttingCycleClosingLookups(objectInfoWrapper: ObjectInfoWrapper, objectName: string, walk: CycleCuttingWalk): void {

    walk.walkedObjectNames.add(objectName);
    walk.objectNamesOnPath.add(objectName);

    const childObjectToFieldReferences = objectInfoWrapper.ObjectToObjectInfoMap[objectName].RelationshipDetail.childObjectToFieldReferences;
    const childObjectNames = RelationshipService.sortByCodeUnit(
      Object.keys(childObjectToFieldReferences).filter(childObjectName =>
        childObjectName !== objectName && objectInfoWrapper.ObjectToObjectInfoMap[childObjectName]?.RelationshipDetail
      )
    );

    const acyclicChildObjectNames: string[] = [];
    for (const childObjectName of childObjectNames) {

      const lookupClosesCycle = walk.objectNamesOnPath.has(childObjectName);
      if (lookupClosesCycle) {
        continue;
      }

      acyclicChildObjectNames.push(childObjectName);
      if (!walk.walkedObjectNames.has(childObjectName)) {
        this.walkCuttingCycleClosingLookups(objectInfoWrapper, childObjectName, walk);
      }

    }

    walk.objectNamesOnPath.delete(objectName);
    walk.objectsInFinishOrder.push({ objectName, acyclicChildObjectNames });

  }

  // Code-unit order, never localeCompare, so levels never depend on the machine.
  private static sortByCodeUnit(objectNames: string[]): string[] {
    return objectNames.sort((first, second) => (first < second ? -1 : first > second ? 1 : 0));
  }

  private isTopLevelObjectWithNoExternalParents(relationshipDetail: RelationshipDetail): boolean {

    const parentObjectKeys = Object.keys(relationshipDetail.parentObjectToFieldReferences);

    const currentObjectIsParentForAllOthersInTree = parentObjectKeys?.every(
      parent => parent === relationshipDetail.objectApiName
    ) ?? false;

    const parentReferencesLength = parentObjectKeys?.length ?? 0;

    const topLevelObjectScenarioMet = ((parentReferencesLength === 0) || currentObjectIsParentForAllOthersInTree);

    return topLevelObjectScenarioMet;

  }

  /**
   * Group objects into relationship trees
   */
  buildRelationshipTrees(objectInfoWrapper: ObjectInfoWrapper): RelationshipTree[] {

    const trees: RelationshipTree[] = [];
    const processedObjects = new Set<string>();

    for (const [objectName, objectInfo] of Object.entries(objectInfoWrapper.ObjectToObjectInfoMap)) {

      if (!processedObjects.has(objectName) && objectInfo.RelationshipDetail) {

        const tree = this.buildSingleRelationshipTree(objectInfoWrapper, objectName, processedObjects);

        if (tree.allObjects.length > 0) {
          trees.push(tree);
        }

      }

    }

    // Assign tree IDs to relationship details
    trees.forEach((tree, index) => {

      tree.allObjects.forEach(objectName => {

        const relationshipDetail = objectInfoWrapper.ObjectToObjectInfoMap[objectName]?.RelationshipDetail;
        if (relationshipDetail) {
          relationshipDetail.relationshipTreeId = tree.treeId;
        }

      });

    });

    return trees;

  }

  /**
   * Build a single relationship tree starting from a given object
   */
  private buildSingleRelationshipTree(objectInfoWrapper: ObjectInfoWrapper,
    startObjectName: string,
    globalProcessedObjects: Set<string>
  ): RelationshipTree {

    const treeId = `tree_${startObjectName}_${Date.now()}`;
    const allObjects = new Set<string>();
    const toProcess = [startObjectName];
    const localProcessed = new Set<string>();

    // Find all connected objects using BFS
    while (toProcess.length > 0) {

      const currentObject = toProcess.shift()!;

      if (localProcessed.has(currentObject)) {
        continue;
      }

      localProcessed.add(currentObject);
      globalProcessedObjects.add(currentObject);
      allObjects.add(currentObject);

      const relationshipDetail = objectInfoWrapper.ObjectToObjectInfoMap[currentObject]?.RelationshipDetail;
      if (relationshipDetail) {
        // Add all connected objects (parents and children)
        const parentReferences = Object.keys(relationshipDetail.parentObjectToFieldReferences);
        const childReferences = Object.keys(relationshipDetail.childObjectToFieldReferences);

        const referencesToIterateOver = [...parentReferences, ...childReferences];
        referencesToIterateOver.forEach(connectedObject => {

          if (!localProcessed.has(connectedObject)) {
            toProcess.push(connectedObject);
          }

        });

      }

    }

    this.calculateRelationshipLevels(objectInfoWrapper, allObjects);

    // Find top level objects and max level
    const topLevelObjects: string[] = [];
    let maxLevel = 0;

    Array.from(allObjects).forEach(objectName => {

      const relationshipDetail = objectInfoWrapper.ObjectToObjectInfoMap[objectName]?.RelationshipDetail;
      if (relationshipDetail) {
        if (relationshipDetail.level === 0) {
          topLevelObjects.push(objectName);
        }
        maxLevel = Math.max(maxLevel, relationshipDetail.level);
      }

    });

    return {
      treeId,
      topLevelObjects,
      allObjects: Array.from(allObjects),
      maxLevel
    };
    
  }

  getOrderedObjectsForRecipes(objectInfoWrapper: ObjectInfoWrapper,
                              nestChildObjectsAsFriends: boolean,
                              isChildTreeCopiedPerRecordTypeBlock: boolean = false): OrderedRecipeStructure {

    const orderedStructure: OrderedRecipeStructure = {
      relationshipTrees: [],
      totalObjects: 0
    };

    objectInfoWrapper.RelationshipTrees.forEach((tree, treeIndex) => {

      const orderedTree: OrderedRelationshipTree = {

        treeId: tree.treeId,
        treeName: `RelationshipTree_${treeIndex + 1}`,
        orderedLevels: [],
        combinedRecipe: ''

      };

      const objectsByLevel: Record<number, string[]> = {};

      tree.allObjects.forEach(objectName => {

        const level = objectInfoWrapper.ObjectToObjectInfoMap[objectName]?.RelationshipDetail?.level ?? -1;

        if (!objectsByLevel[level]) {
          objectsByLevel[level] = [];
        }

        objectsByLevel[level].push(objectName);

      });

      // Create ordered levels (parents first, then children)
      for (let level = 0; level <= tree.maxLevel; level++) {

        if (objectsByLevel[level]) {

          const levelInfo: RecipeLevel = {
            level: level,
            objects: objectsByLevel[level].sort(), // Sort alphabetically within level
            recipes: []
          };

          objectsByLevel[level].forEach(objectName => {

            const objectInfo = objectInfoWrapper.ObjectToObjectInfoMap[objectName];
            if (objectInfo?.FullRecipe) {

              levelInfo.recipes.push({
                objectName: objectName,
                recipe: objectInfo.FullRecipe,
                additionalRecordTypeRecipes: objectInfo.AdditionalRecordTypeRecipes ?? [],
                relationshipInfo: this.getObjectRelationshipSummary(objectInfo.RelationshipDetail!)
              });

            }

          });

          orderedTree.orderedLevels.push(levelInfo);

        }

      }

      // Build combined recipe for this tree (in dependency order)
      const nestedTreeRecipe = nestChildObjectsAsFriends
        ? this.buildNestedFriendsTreeRecipe(orderedTree, objectInfoWrapper, isChildTreeCopiedPerRecordTypeBlock)
        : undefined;
      const flatTreeRecipeWithChildCopies = !nestChildObjectsAsFriends && isChildTreeCopiedPerRecordTypeBlock
        ? this.buildFlatTreeRecipeWithChildCopies(orderedTree, objectInfoWrapper)
        : undefined;
      orderedTree.combinedRecipe = nestedTreeRecipe ?? flatTreeRecipeWithChildCopies ?? this.buildCombinedTreeRecipe(orderedTree, objectInfoWrapper);
      orderedStructure.relationshipTrees.push(orderedTree);
      orderedStructure.totalObjects += tree.allObjects.length;

    });

    return orderedStructure;
    
  }

  /**
   * Build a combined recipe string for an entire relationship tree
   */
  private buildCombinedTreeRecipe(orderedTree: OrderedRelationshipTree, objectInfoWrapper: ObjectInfoWrapper): string {
    let combinedRecipe = `# Relationship Tree: ${orderedTree.treeName}\n`;
    combinedRecipe += `# Objects must be processed in this order for proper lookup resolution\n\n`;

    const blockNicknamesByObjectName = RelationshipService.buildRecordTypeBlockNicknamesByObjectName(orderedTree.orderedLevels.flatMap(level => level.recipes));

    orderedTree.orderedLevels.forEach(level => {
      combinedRecipe += `# Level ${level.level} - ${level.objects.join(', ')}\n`;
      level.recipes.forEach(recipeInfo => {
        combinedRecipe += `# ${recipeInfo.objectName} (${recipeInfo.relationshipInfo})\n`;
        // EACH SELECTED RECORD TYPE'S BLOCK FOLLOWS THE FIRST, FLAT (#194)
        [recipeInfo.recipe, ...recipeInfo.additionalRecordTypeRecipes].forEach(blockRecipe => {
          const annotatedBlockRecipe = RelationshipService.annotateLookupsToRecordTypeBlocks(recipeInfo.objectName, blockRecipe.split('\n'), blockNicknamesByObjectName, objectInfoWrapper).join('\n');
          combinedRecipe += annotatedBlockRecipe;
          if (!annotatedBlockRecipe.endsWith('\n')) {
            combinedRecipe += '\n';
          }
        });
        combinedRecipe += '\n';
      });
    });

    return combinedRecipe;
  }

  static readNickname(objectRecipe: string): string | undefined {
    return /^ {2}nickname:[ \t]*(\S+)[ \t]*$/m.exec(objectRecipe)?.[1];
  }

  /*
    The nickname of every block of each object written as SEVERAL record type blocks (#194), the
    first block's first. An object written as one block is absent, so nothing below changes a tree
    no selection reached.
  */
  static buildRecordTypeBlockNicknamesByObjectName(recipeInfos: RecipeInfo[]): Map<string, string[]> {

    const blockNicknamesByObjectName = new Map<string, string[]>();
    recipeInfos
      .filter(recipeInfo => recipeInfo.additionalRecordTypeRecipes.length > 0)
      .forEach(recipeInfo => {
        const blockNicknames = [recipeInfo.recipe, ...recipeInfo.additionalRecordTypeRecipes]
          .map(blockRecipe => RelationshipService.readNickname(blockRecipe))
          .filter((nickname): nickname is string => nickname !== undefined);
        blockNicknamesByObjectName.set(recipeInfo.objectName, blockNicknames);
      });
    return blockNicknamesByObjectName;

  }

  static readonly recordTypeBlocksTodo = '### TODO -- RECORD TYPE BLOCKS --';

  /*
    A lookup still left as the REFERENCE ID REQUIRED TODO, to a parent written as several record type
    blocks, gets one comment line under it naming every block it could reference (#194) -- snowfakery
    writes every tree flat, so this is how its reader learns the choices. The lookup's own line is
    untouched, so the Recipe Cockpit's TODO wiring (#151) still recognises it, and a comment at the
    field's depth ends the field without becoming part of its value.
  */
  static annotateLookupsToRecordTypeBlocks(objectName: string,
                                            objectLines: string[],
                                            blockNicknamesByObjectName: Map<string, string[]>,
                                            objectInfoWrapper: ObjectInfoWrapper): string[] {

    if ( blockNicknamesByObjectName.size === 0 ) {
      return objectLines;
    }

    const blockParentNamesByLookupFieldName = new Map<string, string[]>();
    // EVERY OBJECT A TREE WRITES HAS A RelationshipDetail -- buildRelationshipTrees GROUPS NO OTHER
    const lookupFieldNamesByParentName = objectInfoWrapper.ObjectToObjectInfoMap[objectName].RelationshipDetail.parentObjectToFieldReferences;
    Object.keys(lookupFieldNamesByParentName)
      .filter(parentName => blockNicknamesByObjectName.has(parentName))
      .sort((first, second) => ( first < second ? -1 : ( first > second ? 1 : 0 ) ))
      .forEach(parentName => {
        lookupFieldNamesByParentName[parentName].forEach(lookupFieldName => {
          blockParentNamesByLookupFieldName.set(lookupFieldName, [...(blockParentNamesByLookupFieldName.get(lookupFieldName) ?? []), parentName]);
        });
      });

    if ( blockParentNamesByLookupFieldName.size === 0 ) {
      return objectLines;
    }

    // A SELF-LOOKUP NEVER OFFERS THE BLOCK IT IS WRITTEN IN -- A RECORD CANNOT REFERENCE ITS OWN BLOCK'S RECORDS BEFORE THEY ARE INSERTED
    const ownNickname = RelationshipService.readNickname(objectLines.join('\n'));

    return objectLines.flatMap(objectLine => {

      const lookupLineMatch = /^( *)(\w+): ### TODO -- REFERENCE ID REQUIRED(?: -- .*)?$/.exec(objectLine);
      const blockParentNames = lookupLineMatch ? blockParentNamesByLookupFieldName.get(lookupLineMatch[2]) : undefined;
      const blockChoices = ( blockParentNames ?? [] )
        .map(parentName => [parentName, blockNicknamesByObjectName.get(parentName).filter(nickname => parentName !== objectName || nickname !== ownNickname)] as const)
        .filter(([, nicknames]) => nicknames.length > 0)
        .map(([parentName, nicknames]) => `${parentName}: ${nicknames.join(', ')}`)
        .join('; ');
      if ( !blockChoices ) {
        return [objectLine];
      }

      return [objectLine, `${lookupLineMatch[1]}${RelationshipService.recordTypeBlocksTodo} ${lookupLineMatch[2]} can reference any record type block of ${blockChoices}`];

    });

  }

  static readonly referenceIdRequiredTodo = '### TODO -- REFERENCE ID REQUIRED';

  /*
    The parent an object is nested under in a faker-js recipe (#46): of its parents in the same tree
    that have a recipe, the DEEPEST -- its closest ancestor -- with ties broken by name. Only a parent
    at a strictly lower level qualifies, so the chosen parents form a forest whatever cycles the
    lookups themselves contain. Names compare with "<", never localeCompare, so the nesting does not
    depend on the machine's locale (#166).
  */
  static selectFriendsParentByObjectName(objectNamesInInsertOrder: string[], objectInfoWrapper: ObjectInfoWrapper): Map<string, string> {

    const objectNamesWithRecipes = new Set(objectNamesInInsertOrder);
    const friendsParentByObjectName = new Map<string, string>();

    // ONLY CALLED FOR AN OBJECT THAT HAS A RECIPE IN THIS TREE, AND buildRelationshipTrees ONLY GROUPS OBJECTS WITH A RelationshipDetail
    const levelOf = (objectName: string): number => objectInfoWrapper.ObjectToObjectInfoMap[objectName].RelationshipDetail.level;

    objectNamesInInsertOrder.forEach(objectName => {

      const relationshipDetail = objectInfoWrapper.ObjectToObjectInfoMap[objectName]?.RelationshipDetail;
      if ( !relationshipDetail ) {
        return;
      }

      const candidateParentNames = Object.keys(relationshipDetail.parentObjectToFieldReferences)
        .filter(parentName => parentName !== objectName
                                && objectNamesWithRecipes.has(parentName)
                                && levelOf(parentName) < levelOf(objectName));

      const selectedParentName = candidateParentNames.reduce<string | undefined>((selected, candidate) => {
        if ( selected === undefined ) {
          return candidate;
        }
        if ( levelOf(candidate) !== levelOf(selected) ) {
          return levelOf(candidate) > levelOf(selected) ? candidate : selected;
        }
        return candidate < selected ? candidate : selected;
      }, undefined);

      if ( selectedParentName !== undefined ) {
        friendsParentByObjectName.set(objectName, selectedParentName);
      }

    });

    return friendsParentByObjectName;

  }

  /*
    One faker-js recipe per tree with every child written under its parent's "friends:" block (#46),
    so a friend's count is records PER parent record. Each object is still written once, and a
    lookup to ANY ancestor on its chain -- the parent it sits under, the top parent above that -- is
    wired to that ancestor's nickname in place of the REFERENCE ID REQUIRED TODO, which
    FakerJSRecipeProcessor resolves to the ancestor record the child was generated under. A lookup to
    a second parent that is not an ancestor is wired too when that parent has a recipe at a lower
    level, and resolved round-robin to one of its records (#189); any other keeps a TODO naming it.

    An object with a SELF-lookup (Account.ParentId) gets one more friend, written last: a second
    iteration of itself named <Object>_child_NickName, whose every self-lookup holds the parent
    iteration's nickname -- it is an ancestor of itself, so wireLookupsToParents wires it -- while the
    top iteration keeps its TODO, a cycle (#188). The iteration carries no friends of its own, so nothing
    recurses. With isChildTreeCopiedPerRecordTypeBlock on, each record type block carries its own copy
    of the friends (#622, buildBlockPlacer). undefined when nothing in the tree nests, so a tree without relationships is written
    by buildCombinedTreeRecipe exactly as before.
  */
  private buildNestedFriendsTreeRecipe(orderedTree: OrderedRelationshipTree,
                                        objectInfoWrapper: ObjectInfoWrapper,
                                        isChildTreeCopiedPerRecordTypeBlock: boolean): string | undefined {

    const recipeInfosInInsertOrder = orderedTree.orderedLevels.flatMap(level => level.recipes);
    const objectNamesInInsertOrder = recipeInfosInInsertOrder.map(recipeInfo => recipeInfo.objectName);

    const friendsParentByObjectName = RelationshipService.selectFriendsParentByObjectName(objectNamesInInsertOrder, objectInfoWrapper);
    const selfLookupObjectNames = new Set(objectNamesInInsertOrder.filter(objectName => RelationshipService.hasSelfLookup(objectName, objectInfoWrapper)));
    if ( friendsParentByObjectName.size === 0 && selfLookupObjectNames.size === 0 ) {
      return undefined;
    }

    const recipeInfoByObjectName = new Map(recipeInfosInInsertOrder.map(recipeInfo => [recipeInfo.objectName, recipeInfo]));
    const blockNicknamesByObjectName = RelationshipService.buildRecordTypeBlockNicknamesByObjectName(recipeInfosInInsertOrder);
    const placeObject = this.buildBlockPlacer(recipeInfosInInsertOrder, friendsParentByObjectName, selfLookupObjectNames, isChildTreeCopiedPerRecordTypeBlock, objectInfoWrapper);

    const renderBlock = (placement: RecordTypeBlockPlacement, depth: number): string[] => {
      const indentation = ' '.repeat(4 * depth);
      const wiredLines = this.wireLookupsToParents(placement.objectName,
                                                    placement.blockRecipe,
                                                    placement.ancestorNicknameByObjectName,
                                                    placement.resolveLowerLevelParentNickname,
                                                    recipeInfoByObjectName,
                                                    objectInfoWrapper);
      return RelationshipService.annotateLookupsToRecordTypeBlocks(placement.objectName, wiredLines, blockNicknamesByObjectName, objectInfoWrapper)
        .map(recipeLine => recipeLine ? `${indentation}${recipeLine}` : recipeLine);
    };

    /*
      Every block after the first is written right after it at the same depth -- a sibling at the top
      of the file, or another friend of the same parent block -- wired to the same ancestors. Which
      blocks carry friends is the placer's decision: the first only (#194), or each its own copy (#622).
    */
    const renderPlacements = (objectName: string, placements: RecordTypeBlockPlacement[], depth: number): string[] => {

      const indentation = ' '.repeat(4 * depth);
      const friendIndentation = ' '.repeat(4 * (depth + 1));

      return placements.flatMap((placement, blockIndex) => {

        const blockLines = [
          ...( blockIndex > 0 ? [`${indentation}# ${objectName} (record type block ${placement.nickname})`] : [] ),
          ...renderBlock(placement, depth)
        ];

        const friendLines = placement.friends.flatMap(friend => [
          `${friendIndentation}# ${friend.objectName} (${recipeInfoByObjectName.get(friend.objectName).relationshipInfo})`,
          ...renderPlacements(friend.objectName, friend.placements, depth + 1)
        ]);

        if ( placement.selfLookupIteration ) {
          const selfLookupFieldNames = RelationshipService.getWritableSelfLookupFieldNames(objectName, objectInfoWrapper);
          friendLines.push(
            `${friendIndentation}# ${objectName} (Child iteration of the ${objectName} above, through ${selfLookupFieldNames.join(', ')})`,
            ...renderBlock(placement.selfLookupIteration, depth + 1)
          );
        }

        return friendLines.length === 0
          ? blockLines
          : [...blockLines, `${indentation}  friends:`, ...friendLines];

      });

    };

    let nestedRecipe = `# Relationship Tree: ${orderedTree.treeName}\n`;
    nestedRecipe += `# Child objects are nested under their parent's friends: block -- a friend's count is records PER parent record\n\n`;

    objectNamesInInsertOrder
      .filter(objectName => !friendsParentByObjectName.has(objectName))
      .forEach(rootObjectName => {
        nestedRecipe += `# ${rootObjectName} (${recipeInfoByObjectName.get(rootObjectName).relationshipInfo})\n`;
        nestedRecipe += `${renderPlacements(rootObjectName, placeObject(rootObjectName, new Map(), []), 0).join('\n')}\n\n`;
      });

    return nestedRecipe;

  }

  /*
    Where each record type block of a tree is written, and under which ancestor blocks: one walk
    for both layouts, so a copy is the same copy in a faker-js and a snowfakery recipe. An object's
    friends -- and its self-lookup iteration (#188) -- go under its FIRST block; with
    isChildTreeCopiedPerRecordTypeBlock on (#622), every later block carries its own copy of those
    friends too, though never a second self-lookup iteration: that iteration is the object's own
    parent-and-child pair, not part of the record type's children.

    A copy renames every nickname it writes to <nickname stem>_<copying block's stem>_NickName --
    Contact_NickName under Account_Partner_NickName is Contact_Account_Partner_NickName -- so
    records sharing a nickname never share a referenceId. A name the tree already holds takes _Copy
    before _NickName until it is free. Every part is a nickname built from api names joined by "_",
    so a copy's name is an api name too.
  */
  private buildBlockPlacer(recipeInfos: RecipeInfo[],
                            friendsParentByObjectName: Map<string, string>,
                            selfLookupObjectNames: Set<string>,
                            isChildTreeCopiedPerRecordTypeBlock: boolean,
                            objectInfoWrapper: ObjectInfoWrapper
                          ): (objectName: string, ancestorNicknameByObjectName: Map<string, string>, copyContexts: ChildTreeCopyContext[]) => RecordTypeBlockPlacement[] {

    const recipeInfoByObjectName = new Map(recipeInfos.map(recipeInfo => [recipeInfo.objectName, recipeInfo]));
    const friendObjectNamesByParentName = new Map<string, string[]>();
    friendsParentByObjectName.forEach((parentName, objectName) => {
      friendObjectNamesByParentName.set(parentName, [...(friendObjectNamesByParentName.get(parentName) ?? []), objectName]);
    });

    const takenNicknames = new Set<string>();
    recipeInfos.forEach(recipeInfo => {
      [recipeInfo.recipe, ...recipeInfo.additionalRecordTypeRecipes]
        .map(blockRecipe => RelationshipService.readNickname(blockRecipe))
        .filter((nickname): nickname is string => nickname !== undefined)
        .forEach(nickname => takenNicknames.add(nickname));
    });
    selfLookupObjectNames.forEach(objectName => takenNicknames.add(RelationshipService.buildSelfLookupIterationNickname(objectName)));

    // ONE NAME PER (COPY, NICKNAME): THE BLOCK THAT WRITES IT AND EVERY LOOKUP THAT NAMES IT MUST AGREE
    const copyNicknameByKey = new Map<string, string>();
    const nicknameInCopy = <Nickname extends string | undefined>(nickname: Nickname, copyContexts: ChildTreeCopyContext[]): Nickname | string => {
      if ( nickname === undefined || copyContexts.length === 0 ) {
        return nickname;
      }
      const copyStem = copyContexts[copyContexts.length - 1].nicknameStem;
      const copyKey = `${copyStem}\n${nickname}`;
      if ( !copyNicknameByKey.has(copyKey) ) {
        const nicknameStem = RelationshipService.readNicknameStem(nickname);
        let copySuffix = '';
        while ( takenNicknames.has(`${nicknameStem}_${copyStem}${copySuffix}_NickName`) ) {
          copySuffix += '_Copy';
        }
        const copyNickname = `${nicknameStem}_${copyStem}${copySuffix}_NickName`;
        takenNicknames.add(copyNickname);
        copyNicknameByKey.set(copyKey, copyNickname);
      }
      return copyNicknameByKey.get(copyKey);
    };

    const isFriendsDescendantOf = (objectName: string, ancestorName: string): boolean => {
      for ( let parentName = friendsParentByObjectName.get(objectName); parentName !== undefined; parentName = friendsParentByObjectName.get(parentName) ) {
        if ( parentName === ancestorName ) {
          return true;
        }
      }
      return false;
    };

    // A LOWER-LEVEL PARENT INSIDE THE COPY BEING WRITTEN IS THAT COPY'S RECORDS, OTHERWISE THE ORIGINAL'S (#189)
    const buildLowerLevelParentNicknameResolver = (copyContexts: ChildTreeCopyContext[]) => (parentName: string): string | undefined => {
      const parentNickname = RelationshipService.readNickname(recipeInfoByObjectName.get(parentName).recipe);
      if ( parentNickname === undefined ) {
        return undefined;
      }
      for ( let contextIndex = copyContexts.length - 1; contextIndex >= 0; contextIndex-- ) {
        if ( isFriendsDescendantOf(parentName, copyContexts[contextIndex].objectName) ) {
          return nicknameInCopy(parentNickname, copyContexts.slice(0, contextIndex + 1));
        }
      }
      return parentNickname;
    };

    const placeObject = (objectName: string, ancestorNicknameByObjectName: Map<string, string>, copyContexts: ChildTreeCopyContext[]): RecordTypeBlockPlacement[] => {

      const recipeInfo = recipeInfoByObjectName.get(objectName);
      const resolveLowerLevelParentNickname = buildLowerLevelParentNicknameResolver(copyContexts);

      return [recipeInfo.recipe, ...recipeInfo.additionalRecordTypeRecipes].map((blockRecipe, blockIndex) => {

        // A BLOCK WITH NO NICKNAME LINE IS NO ANCESTOR TO WIRE, AND ITS LATER BLOCKS COPY NOTHING UNDER A NAME
        const nickname = nicknameInCopy(RelationshipService.readNickname(blockRecipe), copyContexts);
        const placement: RecordTypeBlockPlacement = {
          objectName,
          nickname,
          blockRecipe: nickname === RelationshipService.readNickname(blockRecipe) ? blockRecipe : RelationshipService.renameRecipeNickname(blockRecipe, nickname),
          ancestorNicknameByObjectName,
          resolveLowerLevelParentNickname,
          friends: []
        };

        if ( blockIndex > 0 && ( !isChildTreeCopiedPerRecordTypeBlock || nickname === undefined ) ) {
          return placement;
        }

        const friendAncestorNicknameByObjectName = nickname === undefined
          ? ancestorNicknameByObjectName
          : new Map(ancestorNicknameByObjectName).set(objectName, nickname);
        const friendCopyContexts = blockIndex === 0
          ? copyContexts
          : [...copyContexts, { objectName, nicknameStem: RelationshipService.readNicknameStem(nickname) }];

        placement.friends = (friendObjectNamesByParentName.get(objectName) ?? []).map(friendObjectName => ({
          objectName: friendObjectName,
          placements: placeObject(friendObjectName, friendAncestorNicknameByObjectName, friendCopyContexts)
        }));

        if ( blockIndex === 0 && selfLookupObjectNames.has(objectName) ) {
          const selfLookupIterationNickname = nicknameInCopy(RelationshipService.buildSelfLookupIterationNickname(objectName), copyContexts);
          placement.selfLookupIteration = {
            objectName,
            nickname: selfLookupIterationNickname,
            blockRecipe: RelationshipService.renameRecipeNickname(recipeInfo.recipe, selfLookupIterationNickname),
            ancestorNicknameByObjectName: friendAncestorNicknameByObjectName,
            resolveLowerLevelParentNickname,
            friends: []
          };
        }

        return placement;

      });

    };

    return placeObject;

  }

  // A NICKNAME WITHOUT ITS _NickName ENDING: Account_Partner_NickName -> Account_Partner
  static readNicknameStem(nickname: string): string {
    return nickname.endsWith('_NickName') && nickname.length > '_NickName'.length
      ? nickname.slice(0, -'_NickName'.length)
      : nickname;
  }

  /*
    Snowfakery writes every tree flat (#46), so a child copied per parent record type block (#622)
    is written once per block it belongs to, after every object of a lower level, each copy's
    lookups to its ancestor blocks written as ${{reference(<nickname>)}} -- snowfakery's link to the
    most recent record of that nickname. undefined when no object in the tree has a later block
    with children, so such a tree is written by buildCombinedTreeRecipe exactly as before.
  */
  private buildFlatTreeRecipeWithChildCopies(orderedTree: OrderedRelationshipTree, objectInfoWrapper: ObjectInfoWrapper): string | undefined {

    const recipeInfosInInsertOrder = orderedTree.orderedLevels.flatMap(level => level.recipes);
    const objectNamesInInsertOrder = recipeInfosInInsertOrder.map(recipeInfo => recipeInfo.objectName);
    const friendsParentByObjectName = RelationshipService.selectFriendsParentByObjectName(objectNamesInInsertOrder, objectInfoWrapper);
    const parentNamesWithFriends = new Set(friendsParentByObjectName.values());
    if ( !recipeInfosInInsertOrder.some(recipeInfo => recipeInfo.additionalRecordTypeRecipes.length > 0 && parentNamesWithFriends.has(recipeInfo.objectName)) ) {
      return undefined;
    }

    // A FLAT RECIPE HAS NO SELF-LOOKUP ITERATION, SO NONE IS PLACED
    const placeObject = this.buildBlockPlacer(recipeInfosInInsertOrder, friendsParentByObjectName, new Set(), true, objectInfoWrapper);
    const placementsByObjectName = new Map<string, RecordTypeBlockPlacement[]>();
    const collectPlacements = (objectName: string, placements: RecordTypeBlockPlacement[]): void => {
      placementsByObjectName.set(objectName, [...(placementsByObjectName.get(objectName) ?? []), ...placements]);
      placements.forEach(placement => placement.friends.forEach(friend => collectPlacements(friend.objectName, friend.placements)));
    };
    objectNamesInInsertOrder
      .filter(objectName => !friendsParentByObjectName.has(objectName))
      .forEach(rootObjectName => collectPlacements(rootObjectName, placeObject(rootObjectName, new Map(), [])));

    const blockNicknamesByObjectName = RelationshipService.buildRecordTypeBlockNicknamesByObjectName(recipeInfosInInsertOrder);

    let flatRecipe = `# Relationship Tree: ${orderedTree.treeName}\n`;
    flatRecipe += `# Objects must be processed in this order for proper lookup resolution\n`;
    flatRecipe += `# Each child is written once per record type block of its parent, each copy referencing its own block\n\n`;

    orderedTree.orderedLevels.forEach(level => {
      flatRecipe += `# Level ${level.level} - ${level.objects.join(', ')}\n`;
      level.recipes.forEach(recipeInfo => {
        flatRecipe += `# ${recipeInfo.objectName} (${recipeInfo.relationshipInfo})\n`;
        // EVERY OBJECT WITH A RECIPE IS PLACED: A ROOT, OR A FRIEND OF ITS PARENT'S FIRST BLOCK
        placementsByObjectName.get(recipeInfo.objectName).forEach(placement => {
          const referencedLines = RelationshipService.referenceAncestorLookups(placement, objectInfoWrapper);
          const annotatedBlockRecipe = RelationshipService.annotateLookupsToRecordTypeBlocks(recipeInfo.objectName, referencedLines, blockNicknamesByObjectName, objectInfoWrapper).join('\n');
          flatRecipe += annotatedBlockRecipe;
          if ( !annotatedBlockRecipe.endsWith('\n') ) {
            flatRecipe += '\n';
          }
        });
        flatRecipe += '\n';
      });
    });

    return flatRecipe;

  }

  // ONLY A LINE THAT IS EXACTLY THE GENERATED TODO, TO AN ANCESTOR BLOCK, IS REWRITTEN; EVERY OTHER LOOKUP STAYS AS SNOWFAKERY WRITES IT
  static referenceAncestorLookups(placement: RecordTypeBlockPlacement, objectInfoWrapper: ObjectInfoWrapper): string[] {

    const lookupFieldNamesByParentName = objectInfoWrapper.ObjectToObjectInfoMap[placement.objectName].RelationshipDetail.parentObjectToFieldReferences;
    const ancestorNicknameByLookupLine = new Map<string, string>();
    Object.keys(lookupFieldNamesByParentName)
      .filter(parentName => placement.ancestorNicknameByObjectName.has(parentName))
      // CODE-UNIT ORDER, AS "<" -- A POLYMORPHIC LOOKUP TO TWO ANCESTORS REFERENCES THE FIRST BY NAME
      .sort()
      .forEach(parentName => {
        lookupFieldNamesByParentName[parentName].forEach(lookupFieldName => {
          const lookupLine = `    ${lookupFieldName}: ${RelationshipService.referenceIdRequiredTodo}`;
          if ( !ancestorNicknameByLookupLine.has(lookupLine) ) {
            ancestorNicknameByLookupLine.set(lookupLine, placement.ancestorNicknameByObjectName.get(parentName));
          }
        });
      });

    return placement.blockRecipe.split('\n').map(objectLine => {
      const ancestorNickname = ancestorNicknameByLookupLine.get(objectLine);
      return ancestorNickname === undefined
        ? objectLine
        : `${objectLine.slice(0, objectLine.indexOf(':') + 1)} \${{reference(${ancestorNickname})}}`;
    });

  }

  static hasSelfLookup(objectName: string, objectInfoWrapper: ObjectInfoWrapper): boolean {
    return RelationshipService.getWritableSelfLookupFieldNames(objectName, objectInfoWrapper).length > 0;
  }

  /*
    A RelationshipDetail records a lookup's field name as the XML gave it, including one the api-name
    rule refused -- the recipe writes that field as a SKIPPED TODO, but the relationship is still
    recorded. The child-iteration comment writes these names into the recipe, so only api names
    reach it, and a self-lookup whose every name was refused adds no iteration: there would be no
    lookup line to wire, only a second, unlinked copy of the object (#120, #188).
  */
  static getWritableSelfLookupFieldNames(objectName: string, objectInfoWrapper: ObjectInfoWrapper): string[] {

    const parentObjectToFieldReferences = objectInfoWrapper.ObjectToObjectInfoMap[objectName]?.RelationshipDetail?.parentObjectToFieldReferences;
    if ( !parentObjectToFieldReferences || !Object.prototype.hasOwnProperty.call(parentObjectToFieldReferences, objectName) ) {
      return [];
    }

    return parentObjectToFieldReferences[objectName].filter(fieldName => SalesforceApiName.isApiName(fieldName));

  }

  static buildSelfLookupIterationNickname(objectName: string): string {
    return `${objectName}_child_NickName`;
  }

  // THE ONE "  nickname:" LINE RecipeService WRITES AT THE TOP OF AN OBJECT RECIPE
  private static renameRecipeNickname(objectRecipe: string, nickname: string): string {
    return objectRecipe.replace(/^( {2}nickname:)[ \t]*\S+[ \t]*$/m, `$1 ${nickname}`);
  }

  /*
    The object's recipe as lines, without the blank lines around it, with each generated lookup TODO
    resolved by the parent it names: an ANCESTOR is wired to the nickname of the block it sits under, which FakerJSRecipeProcessor
    resolves to the record the child was generated under (#46); a parent in the same tree with a recipe
    at a strictly LOWER level is wired to its nickname too, which FakerJSRecipeProcessor resolves to one
    of that parent's records once the recipe is generated -- a lower level is inserted first (#189).
    Any other lookup -- a cycle, or a parent with no recipe -- keeps its TODO, naming the parent. Only
    a line that is EXACTLY the generated TODO is rewritten, so a lookup a mapping or a person already
    filled in is left as it is.
  */
  private wireLookupsToParents(objectName: string,
                                objectRecipe: string,
                                ancestorNicknameByObjectName: Map<string, string>,
                                resolveLowerLevelParentNickname: (parentName: string) => string | undefined,
                                recipeInfoByObjectName: Map<string, RecipeInfo>,
                                objectInfoWrapper: ObjectInfoWrapper): string[] {

    const lookupFieldNamesByParentName = objectInfoWrapper.ObjectToObjectInfoMap[objectName].RelationshipDetail.parentObjectToFieldReferences;
    const levelOf = (lookupObjectName: string): number => objectInfoWrapper.ObjectToObjectInfoMap[lookupObjectName].RelationshipDetail.level;

    const ancestorNicknameByLookupLine = new Map<string, string>();
    const lowerLevelNicknameByLookupLine = new Map<string, string>();
    const todoParentNamesByLookupLine = new Map<string, string[]>();

    Object.keys(lookupFieldNamesByParentName).sort((first, second) => ( first < second ? -1 : ( first > second ? 1 : 0 ) )).forEach(parentName => {

      const isAncestor = ancestorNicknameByObjectName.has(parentName);
      const isLowerLevelParentWithRecipe = !isAncestor
                                            && parentName !== objectName
                                            && recipeInfoByObjectName.has(parentName)
                                            && levelOf(parentName) < levelOf(objectName);
      const parentNickname = isAncestor
        ? ancestorNicknameByObjectName.get(parentName)
        : ( isLowerLevelParentWithRecipe ? resolveLowerLevelParentNickname(parentName) : undefined );

      lookupFieldNamesByParentName[parentName].forEach(lookupFieldName => {
        const lookupLine = `    ${lookupFieldName}: ${RelationshipService.referenceIdRequiredTodo}`;
        const nicknameByLookupLine = isAncestor ? ancestorNicknameByLookupLine : lowerLevelNicknameByLookupLine;
        // A POLYMORPHIC LOOKUP WITH TWO PARENTS THAT QUALIFY IS WIRED TO THE FIRST BY NAME
        if ( parentNickname !== undefined && !nicknameByLookupLine.has(lookupLine) ) {
          nicknameByLookupLine.set(lookupLine, parentNickname);
        } else if ( parentNickname === undefined ) {
          todoParentNamesByLookupLine.set(lookupLine, [...(todoParentNamesByLookupLine.get(lookupLine) ?? []), parentName]);
        }
      });

    });

    const objectLines = objectRecipe.split('\n');
    while ( objectLines.length > 0 && !objectLines[0].trim() ) {
      objectLines.shift();
    }
    while ( objectLines.length > 0 && !objectLines[objectLines.length - 1].trim() ) {
      objectLines.pop();
    }

    return objectLines.map(objectLine => {
      const parentNickname = ancestorNicknameByLookupLine.get(objectLine) ?? lowerLevelNicknameByLookupLine.get(objectLine);
      if ( parentNickname !== undefined ) {
        return `${objectLine.slice(0, objectLine.indexOf(':') + 1)} ${parentNickname}`;
      }
      const todoParentNames = todoParentNamesByLookupLine.get(objectLine);
      return todoParentNames === undefined
        ? objectLine
        : `${objectLine} -- ${todoParentNames.join(', ')}`;
    });

  }

  private getObjectRelationshipSummary(relationshipDetail: RelationshipDetail): string {

    const parts = [];
    const parentObjectKeys = Object.keys(relationshipDetail.parentObjectToFieldReferences);
    const childObjectKeys = Object.keys(relationshipDetail.childObjectToFieldReferences);

    if (parentObjectKeys?.length > 0) {
      parts.push(`Parents: ${parentObjectKeys.join(', ')}`);
    }
    if (childObjectKeys?.length > 0) {
      parts.push(`Children: ${childObjectKeys.join(', ')}`);
    }
    return parts.join(' | ') || 'No relationships';
  }

  generateSeparateRecipeFiles(objectInfoWrapper: ObjectInfoWrapper,
                              nestChildObjectsAsFriends: boolean = false,
                              isChildTreeCopiedPerRecordTypeBlock: boolean = false): RecipeFileOutput[] {

    const orderedStructure = this.getOrderedObjectsForRecipes(objectInfoWrapper, nestChildObjectsAsFriends, isChildTreeCopiedPerRecordTypeBlock);
    const recipeFiles: RecipeFileOutput[] = [];

    orderedStructure.relationshipTrees.forEach((tree, index) => {

      recipeFiles.push({
        fileName: `recipe_${tree.treeName.toLowerCase()}.yml`,
        content: tree.combinedRecipe,
        objectCount: tree.orderedLevels.reduce((count, level) => count + level.objects.length, 0),
        maxLevel: Math.max(...tree.orderedLevels.map(l => l.level)),
        objects: tree.orderedLevels.flatMap(l => l.objects)
      });

    });

    return recipeFiles;

  }

  buildBidirectionalChildAndParentRelationshipReferences(fieldDetail: FieldInfo, 
                                                          objectInfoWrapper: ObjectInfoWrapper,
                                                          objectName: string,
                                                          parentReferenceApiName): Record<string, ObjectInfo> {

    if (parentReferenceApiName) {

      this.buildBidirectionalRelationship(
        objectInfoWrapper,
        parentReferenceApiName,
        objectName,
        fieldDetail.fieldName
      );

    }

    return objectInfoWrapper.ObjectToObjectInfoMap;

  }

  private buildBidirectionalRelationship(objectInfoWrapper: ObjectInfoWrapper,
                                          parentReferenceApiName: string,
                                          childObjectName: string,
                                          fieldName: string
                                        ): void {

    // A <referenceTo> OR A CONFIGURED MAPPING THAT IS NOT AN API NAME NEVER BECOMES AN OBJECT, SO THE LOOKUP RECORDS NO RELATIONSHIP (#164)
    if ( !this.ensureRelationshipDetailExists(objectInfoWrapper, parentReferenceApiName)
          || !this.ensureRelationshipDetailExists(objectInfoWrapper, childObjectName) ) {
      return;
    }


    // Add child reference to parent
    const parentRelationship = objectInfoWrapper.ObjectToObjectInfoMap[parentReferenceApiName].RelationshipDetail;

    this.addFieldToRelationshipArray(
      parentRelationship.childObjectToFieldReferences,
      childObjectName,
      fieldName
    );

    // Add parent reference to child
    const childRelationship = objectInfoWrapper.ObjectToObjectInfoMap[childObjectName].RelationshipDetail;
    this.addFieldToRelationshipArray(
      childRelationship.parentObjectToFieldReferences,
      parentReferenceApiName,
      fieldName
    );

  }   

  private ensureRelationshipDetailExists(objectInfoWrapper: ObjectInfoWrapper,
                                        objectName: string
                                        ): boolean {

    if ( !objectInfoWrapper.addKeyToObjectInfoMap(objectName) ) {
      return false;
    }

    if (!objectInfoWrapper.ObjectToObjectInfoMap[objectName].RelationshipDetail) {

      objectInfoWrapper.ObjectToObjectInfoMap[objectName].RelationshipDetail = this.buildNewRelationshipDetail(objectName);

    }

    return true;

  }

  private addFieldToRelationshipArray(relationshipMap: Record<string, string[]>,
                                        key: string,
                                        fieldName: string
                                      ): void {

    if (!relationshipMap[key]) {
      relationshipMap[key] = [];
    }
    relationshipMap[key].push(fieldName);
    
  }

  resolveParentReferenceForField(
    objectApiName: string,
    fieldApiName: string,
    customRelationshipMappings?: Record<string, string>
  ): string | undefined {

    if (customRelationshipMappings) {
      const objectFieldKey = `${objectApiName}.${fieldApiName}`;
      const customMatch = customRelationshipMappings[objectFieldKey];
      if (typeof customMatch === 'string' && customMatch && this.isValidCustomRelationshipKey(objectFieldKey)) {
        return customMatch;
      }
    }

    // own-key check: a field named like an Object.prototype member must not resolve to it
    return Object.prototype.hasOwnProperty.call(RelationshipService.ootbReferenceLookupMap, fieldApiName)
      ? RelationshipService.ootbReferenceLookupMap[fieldApiName]
      : undefined;

  }

  private isValidCustomRelationshipKey(key: string): boolean {

    const dotIndex = key.indexOf('.');
    if (dotIndex <= 0 || dotIndex === key.length - 1) {
      return false;
    }

    // reject keys containing more than a single dot separator
    if (key.indexOf('.', dotIndex + 1) !== -1) {
      return false;
    }

    return true;

  }

}

// Inside a copy of a block's children (#622): the object whose later block is copied, and that block's nickname without _NickName
interface ChildTreeCopyContext {
  objectName: string;
  nicknameStem: string;
}

// One record type block where it is written: its recipe under the nickname of its copy, the ancestor blocks above it, and what it carries
interface RecordTypeBlockPlacement {
  objectName: string;
  nickname: string | undefined;
  blockRecipe: string;
  ancestorNicknameByObjectName: Map<string, string>;
  resolveLowerLevelParentNickname: (parentName: string) => string | undefined;
  friends: { objectName: string; placements: RecordTypeBlockPlacement[] }[];
  selfLookupIteration?: RecordTypeBlockPlacement;
}

// One depth-first walk of a tree: the lookups it keeps (every one but those that close a cycle) and the order objects finish in
interface CycleCuttingWalk {
  objectNamesOnPath: Set<string>;
  walkedObjectNames: Set<string>;
  objectsInFinishOrder: { objectName: string; acyclicChildObjectNames: string[] }[];
}
