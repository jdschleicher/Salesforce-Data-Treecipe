import { FieldInfo } from "../ObjectInfoWrapper/FieldInfo";
import { ObjectInfo } from "../ObjectInfoWrapper/ObjectInfo";
import { ObjectInfoWrapper } from "../ObjectInfoWrapper/ObjectInfoWrapper";
import { SalesforceApiName } from "../RecipeService/SalesforceApiName";

export class RelationshipService {

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

  private calculateRelationshipLevels(objectInfoWrapper: ObjectInfoWrapper, relatedObjects: Set<string>): void {

    // Find and process top-level objects (those with no parents or only self-references)
    for (const [objectName, objectInfo] of Object.entries(objectInfoWrapper.ObjectToObjectInfoMap)) {

      const isRelatedObjectToBeProcessed = relatedObjects.has(objectName);
      if (isRelatedObjectToBeProcessed
        && !objectInfo.RelationshipDetail.isProcessed) {

        if (this.isTopLevelObjectWithNoExternalParents(objectInfo.RelationshipDetail)) {

          this.calculateLevelsRecursively(objectInfoWrapper, objectName, 0);

        }

      }

    }

    for (const [objectName, objectInfo] of Object.entries(objectInfoWrapper.ObjectToObjectInfoMap)) {

      const isRelatedObjectToBeProcessed = relatedObjects.has(objectName);

      if (isRelatedObjectToBeProcessed
        && !objectInfo.RelationshipDetail.isProcessed) {

        this.calculateLevelsRecursively(objectInfoWrapper, objectName, 0);

      }

    }

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
   * Recursively calculate levels, ensuring parents are always at lower or equal levels than children
   */
  private calculateLevelsRecursively(
    objectInfoWrapper: ObjectInfoWrapper,
    objectName: string,
    proposedLevel: number,
    visited: Set<string> = new Set()
  ): void {

    const relationshipDetail = objectInfoWrapper.ObjectToObjectInfoMap[objectName]?.RelationshipDetail;

    if (!relationshipDetail) {
      return;
    }

    // Handle circular references
    if (visited.has(objectName)) {
      return;
    }

    // Update level if this is higher than current level
    if (relationshipDetail.level < proposedLevel) {
      relationshipDetail.level = proposedLevel;
    }

    relationshipDetail.isProcessed = true;

    /*
      Added before descending and removed after, rather than handing each child a COPY of the
      set. The set holds exactly the current path either way -- a child never sees what a
      sibling's subtree visited, because that subtree removes its own entries on the way out --
      so the cycle guard behaves identically and the per-child allocation is gone.

      That allocation is what made this method a memory problem rather than merely a slow one.
      On a layered graph -- the shape an org has when several objects share a child lookup --
      42 objects produce 7,174,452 recursive calls, each of which was copying the visited set.
      That allocation rate is what exhausted a 4 GB heap in CI.

      The traversal is still exponential in depth, because an object reachable by many paths is
      re-walked once per path. Skipping a re-walk that cannot raise a level would fix that, and
      it is NOT done here: it changes the levels a CYCLIC graph settles on, and those levels
      decide the insertion order of generated recipes. A differential run over 600 random graphs
      showed 1,531 level differences, all of them in graphs containing a cycle. That is a
      behaviour change needing its own issue and its own fixture, not a side effect of a
      memory fix.
    */
    visited.add(objectName);

    // Process all child objects at the next level
    const childObjectKeys = Object.keys(relationshipDetail.childObjectToFieldReferences);

    for (const childObjectName of childObjectKeys) {

      if (childObjectName !== objectName) { // Skip self-references

        this.calculateLevelsRecursively(
          objectInfoWrapper,
          childObjectName,
          relationshipDetail.level + 1,
          visited
        );

      }

    }

    visited.delete(objectName);
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

  getOrderedObjectsForRecipes(objectInfoWrapper: ObjectInfoWrapper, nestChildObjectsAsFriends: boolean): OrderedRecipeStructure {

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
                relationshipInfo: this.getObjectRelationshipSummary(objectInfo.RelationshipDetail!)
              });

            }

          });

          orderedTree.orderedLevels.push(levelInfo);

        }

      }

      // Build combined recipe for this tree (in dependency order)
      const nestedTreeRecipe = nestChildObjectsAsFriends
        ? this.buildNestedFriendsTreeRecipe(orderedTree, objectInfoWrapper)
        : undefined;
      orderedTree.combinedRecipe = nestedTreeRecipe ?? this.buildCombinedTreeRecipe(orderedTree);
      orderedStructure.relationshipTrees.push(orderedTree);
      orderedStructure.totalObjects += tree.allObjects.length;

    });

    return orderedStructure;
    
  }

  /**
   * Build a combined recipe string for an entire relationship tree
   */
  private buildCombinedTreeRecipe(orderedTree: OrderedRelationshipTree): string {
    let combinedRecipe = `# Relationship Tree: ${orderedTree.treeName}\n`;
    combinedRecipe += `# Objects must be processed in this order for proper lookup resolution\n\n`;

    orderedTree.orderedLevels.forEach(level => {
      combinedRecipe += `# Level ${level.level} - ${level.objects.join(', ')}\n`;
      level.recipes.forEach(recipeInfo => {
        combinedRecipe += `# ${recipeInfo.objectName} (${recipeInfo.relationshipInfo})\n`;
        combinedRecipe += recipeInfo.recipe;
        if (!recipeInfo.recipe.endsWith('\n')) {
          combinedRecipe += '\n';
        }
        combinedRecipe += '\n';
      });
    });

    return combinedRecipe;
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
    recurses. undefined when nothing in the tree nests, so a tree without relationships is written
    by buildCombinedTreeRecipe exactly as before.
  */
  private buildNestedFriendsTreeRecipe(orderedTree: OrderedRelationshipTree, objectInfoWrapper: ObjectInfoWrapper): string | undefined {

    const recipeInfosInInsertOrder = orderedTree.orderedLevels.flatMap(level => level.recipes);
    const objectNamesInInsertOrder = recipeInfosInInsertOrder.map(recipeInfo => recipeInfo.objectName);

    const friendsParentByObjectName = RelationshipService.selectFriendsParentByObjectName(objectNamesInInsertOrder, objectInfoWrapper);
    const selfLookupObjectNames = new Set(objectNamesInInsertOrder.filter(objectName => RelationshipService.hasSelfLookup(objectName, objectInfoWrapper)));
    if ( friendsParentByObjectName.size === 0 && selfLookupObjectNames.size === 0 ) {
      return undefined;
    }

    const recipeInfoByObjectName = new Map(recipeInfosInInsertOrder.map(recipeInfo => [recipeInfo.objectName, recipeInfo]));
    const friendObjectNamesByParentName = new Map<string, string[]>();
    friendsParentByObjectName.forEach((parentName, objectName) => {
      friendObjectNamesByParentName.set(parentName, [...(friendObjectNamesByParentName.get(parentName) ?? []), objectName]);
    });

    const renderObject = (objectName: string, depth: number, ancestorObjectNames: string[], isSelfLookupIteration: boolean = false): string[] => {

      const recipeInfo = recipeInfoByObjectName.get(objectName);
      const indentation = ' '.repeat(4 * depth);
      const objectRecipe = isSelfLookupIteration
        ? RelationshipService.renameRecipeNickname(recipeInfo.recipe, RelationshipService.buildSelfLookupIterationNickname(objectName))
        : recipeInfo.recipe;
      const objectLines = this.wireLookupsToParents(objectName, objectRecipe, ancestorObjectNames, recipeInfoByObjectName, objectInfoWrapper)
        .map(recipeLine => recipeLine ? `${indentation}${recipeLine}` : recipeLine);

      if ( isSelfLookupIteration ) {
        return objectLines;
      }

      const friendIndentation = ' '.repeat(4 * (depth + 1));
      const friendAncestorObjectNames = [...ancestorObjectNames, objectName];
      const friendLines = (friendObjectNamesByParentName.get(objectName) ?? []).flatMap(friendObjectName => [
        `${friendIndentation}# ${friendObjectName} (${recipeInfoByObjectName.get(friendObjectName).relationshipInfo})`,
        ...renderObject(friendObjectName, depth + 1, friendAncestorObjectNames)
      ]);

      if ( selfLookupObjectNames.has(objectName) ) {
        const selfLookupFieldNames = RelationshipService.getWritableSelfLookupFieldNames(objectName, objectInfoWrapper);
        friendLines.push(
          `${friendIndentation}# ${objectName} (Child iteration of the ${objectName} above, through ${selfLookupFieldNames.join(', ')})`,
          ...renderObject(objectName, depth + 1, friendAncestorObjectNames, true)
        );
      }

      if ( friendLines.length === 0 ) {
        return objectLines;
      }

      return [...objectLines, `${indentation}  friends:`, ...friendLines];

    };

    let nestedRecipe = `# Relationship Tree: ${orderedTree.treeName}\n`;
    nestedRecipe += `# Child objects are nested under their parent's friends: block -- a friend's count is records PER parent record\n\n`;

    objectNamesInInsertOrder
      .filter(objectName => !friendsParentByObjectName.has(objectName))
      .forEach(rootObjectName => {
        nestedRecipe += `# ${rootObjectName} (${recipeInfoByObjectName.get(rootObjectName).relationshipInfo})\n`;
        nestedRecipe += `${renderObject(rootObjectName, 0, []).join('\n')}\n\n`;
      });

    return nestedRecipe;

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
    resolved by the parent it names: an ANCESTOR is wired to its nickname, which FakerJSRecipeProcessor
    resolves to the record the child was generated under (#46); a parent in the same tree with a recipe
    at a strictly LOWER level is wired to its nickname too, which FakerJSRecipeProcessor resolves to one
    of that parent's records once the recipe is generated -- a lower level is inserted first (#189).
    Any other lookup -- a cycle, or a parent with no recipe -- keeps its TODO, naming the parent. Only
    a line that is EXACTLY the generated TODO is rewritten, so a lookup a mapping or a person already
    filled in is left as it is.
  */
  private wireLookupsToParents(objectName: string,
                                objectRecipe: string,
                                ancestorObjectNames: string[],
                                recipeInfoByObjectName: Map<string, RecipeInfo>,
                                objectInfoWrapper: ObjectInfoWrapper): string[] {

    const lookupFieldNamesByParentName = objectInfoWrapper.ObjectToObjectInfoMap[objectName].RelationshipDetail.parentObjectToFieldReferences;
    const levelOf = (lookupObjectName: string): number => objectInfoWrapper.ObjectToObjectInfoMap[lookupObjectName].RelationshipDetail.level;
    const readNickname = (parentName: string): string | undefined =>
      /^ {2}nickname:[ \t]*(\S+)[ \t]*$/m.exec(recipeInfoByObjectName.get(parentName).recipe)?.[1];

    const ancestorNicknameByLookupLine = new Map<string, string>();
    const lowerLevelNicknameByLookupLine = new Map<string, string>();
    const todoParentNamesByLookupLine = new Map<string, string[]>();

    Object.keys(lookupFieldNamesByParentName).sort((first, second) => ( first < second ? -1 : ( first > second ? 1 : 0 ) )).forEach(parentName => {

      const isAncestor = ancestorObjectNames.includes(parentName);
      const isLowerLevelParentWithRecipe = !isAncestor
                                            && parentName !== objectName
                                            && recipeInfoByObjectName.has(parentName)
                                            && levelOf(parentName) < levelOf(objectName);
      const parentNickname = ( isAncestor || isLowerLevelParentWithRecipe ) ? readNickname(parentName) : undefined;

      lookupFieldNamesByParentName[parentName].forEach(lookupFieldName => {
        const lookupLine = `    ${lookupFieldName}: ${RelationshipService.referenceIdRequiredTodo}`;
        if ( parentNickname !== undefined ) {
          ( isAncestor ? ancestorNicknameByLookupLine : lowerLevelNicknameByLookupLine ).set(lookupLine, parentNickname);
        } else {
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

  generateSeparateRecipeFiles(objectInfoWrapper: ObjectInfoWrapper, nestChildObjectsAsFriends: boolean = false): RecipeFileOutput[] {

    const orderedStructure = this.getOrderedObjectsForRecipes(objectInfoWrapper, nestChildObjectsAsFriends);
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

  getOotbReferenceLookupMap(): Record<string, string> {

    let ootbLookupReferenceToObjectApiNameMap: Record<string, string> | undefined;
    if (ootbLookupReferenceToObjectApiNameMap) {
      return ootbLookupReferenceToObjectApiNameMap;
    }

    ootbLookupReferenceToObjectApiNameMap = {
      "AccountId": "Account"
    };

    return ootbLookupReferenceToObjectApiNameMap;

  }

  getMergedReferenceLookupMap(customRelationshipMappings?: Record<string, string>): Record<string, string> {

    const ootbMap = this.getOotbReferenceLookupMap();
    const merged: Record<string, string> = { ...ootbMap };

    if (!customRelationshipMappings) {
      return merged;
    }

    for (const [customKey, parentObjectApiName] of Object.entries(customRelationshipMappings)) {

      if (!this.isValidCustomRelationshipKey(customKey) || !parentObjectApiName) {
        continue;
      }

      // OOTB entries always win — custom entries extend, never override
      if (merged[customKey]) {
        continue;
      }

      merged[customKey] = parentObjectApiName;

    }

    return merged;

  }

  resolveParentReferenceForField(
    objectApiName: string,
    fieldApiName: string,
    customRelationshipMappings?: Record<string, string>
  ): string | undefined {

    const ootbMap = this.getOotbReferenceLookupMap();

    if (customRelationshipMappings) {
      const objectFieldKey = `${objectApiName}.${fieldApiName}`;
      const customMatch = customRelationshipMappings[objectFieldKey];
      if (customMatch && this.isValidCustomRelationshipKey(objectFieldKey)) {
        return customMatch;
      }
    }

    return ootbMap[fieldApiName];

  }

  private isValidCustomRelationshipKey(key: string): boolean {

    if (!key || typeof key !== 'string') {
      return false;
    }

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

export interface RelationshipDetail {
  objectApiName: string;
  level: number; // 0 = top-most parent, higher numbers = deeper in hierarchy
  childObjectToFieldReferences: Record<string, string[]>;
  parentObjectToFieldReferences: Record<string, string[]>;
  relationshipTreeId?: string; // Groups related objects together
  isProcessed: boolean; // Track if we've calculated its level
}

export interface RelationshipTree {
  treeId: string;
  topLevelObjects: string[]; // Objects at level 0 or -1 , -1 means no other relationships
  allObjects: string[]; // All objects in this tree
  maxLevel: number; // Deepest level in this tree
}

// Main structure that holds all ordered recipes across all relationship trees
export interface OrderedRecipeStructure {
  relationshipTrees: OrderedRelationshipTree[];  // Array of separate relationship trees
  totalObjects: number;                          // Total count of all objects across all trees
}

// Represents one relationship tree with its objects ordered by dependency level
interface OrderedRelationshipTree {
  treeId: string;                    // Unique identifier for this tree (e.g., "tree_Account_1694123456")
  treeName: string;                  // Human-readable name (e.g., "RelationshipTree_1")
  orderedLevels: RecipeLevel[];      // Array of levels, ordered from 0 (top parents) to highest
  combinedRecipe: string;            // Complete YAML recipe for this entire tree
}

// Represents one level in the hierarchy (all objects at the same dependency level)
interface RecipeLevel {
  level: number;                     // The hierarchy level (0 = top-most parents, 1 = their children, etc.)
  objects: string[];                 // Array of object API names at this level (e.g., ["Account", "User"])
  recipes: RecipeInfo[];             // Array of recipe info for each object at this level
}

// Contains the recipe and metadata for one specific object
interface RecipeInfo {
  objectName: string;                // Object API name (e.g., "Account")
  recipe: string;                    // The YAML recipe content for this object
  relationshipInfo: string;          // Human-readable summary of relationships (e.g., "Parents: User | Children: Contact, Opportunity")
}

// Represents a complete recipe file ready to be saved to disk
export interface RecipeFileOutput {
  fileName: string;                  // File name (e.g., "recipe_relationshiptree_1.yml")
  content: string;                   // Complete file content (YAML with comments)
  objectCount: number;               // Number of objects in this file
  maxLevel: number;                  // Deepest hierarchy level in this file
  objects: string[];                 // All object API names included in this file
}
