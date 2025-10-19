import { FieldInfo } from "../ObjectInfoWrapper/FieldInfo";
import { ObjectInfoWrapper } from "../ObjectInfoWrapper/ObjectInfoWrapper";

export class RelationshipService {


    buildNewRelationshipDetail(objectApiName?: string): RelationshipDetail {
      return {
        objectApiName: objectApiName || '',
        level: -1, // -1 indicates not yet processed
        parentObjectToFieldReferences: {},
        childObjectToFieldReferences: {},
        lookupFields: [],
        isProcessed: false
      };
    }

   /**
   * Main method to process all relationships and establish hierarchy levels
   */
  processAllRelationships(objectInfoWrapper: ObjectInfoWrapper) {

    // Step 2: Calculate hierarchy levels
    
    objectInfoWrapper.TheTrees = this.buildRelationshipTrees(objectInfoWrapper);

    // this.calculateRelationshipLevels(objectInfoWrapper);

    return objectInfoWrapper;

  }

  /**
   * Add a relationship connection between two objects
   */
  addRelationshipConnection(
    objectInfoWrapper: ObjectInfoWrapper, 
    sourceObject: string, 
    field: FieldInfo
  ) {

    const targetObject = field.referenceTo;
    
    // Ensure target object has relationship detail
    if (!objectInfoWrapper.ObjectToObjectInfoMap[targetObject]) {
      objectInfoWrapper.addKeyToObjectInfoMap(targetObject);
    }

    if (!objectInfoWrapper.ObjectToObjectInfoMap[targetObject].RelationshipDetail) {
      objectInfoWrapper.ObjectToObjectInfoMap[targetObject].RelationshipDetail = 
        this.buildNewRelationshipDetail(targetObject);
    }

    // Add lookup field detail to source object
    const sourceRelDetail = objectInfoWrapper.ObjectToObjectInfoMap[sourceObject].RelationshipDetail!;
    const lookupDetail: LookupFieldDetail = {
      fieldName: field.fieldName,
      fieldType: field.type as 'Lookup' | 'MasterDetail' | 'Hiearchy',
      referenceTo: targetObject
    };
    
    if (!sourceRelDetail.lookupFields.some(lf => 
          lf.fieldName === lookupDetail.fieldName 
          && lf.referenceTo === lookupDetail.referenceTo) ) {

        sourceRelDetail.lookupFields.push(lookupDetail);
    }


  }

  /**
   * Calculate hierarchy levels recursively
   */
  private calculateRelationshipLevels(objectInfoWrapper: ObjectInfoWrapper, relatedObjects: Set<string>): void {


    // Find and process top-level objects (those with no parents or only self-references)
    for (const [objectName, objectInfo] of Object.entries(objectInfoWrapper.ObjectToObjectInfoMap)) {

      const isRelatedObjectToBeProcessed = relatedObjects.has(objectName);
      if ( isRelatedObjectToBeProcessed 
          && !objectInfo.RelationshipDetail.isProcessed ) {
        
        if (this.isTopLevelObject(objectInfo.RelationshipDetail)) {
          
          this.calculateLevelsRecursively(objectInfoWrapper, objectName, 0);
        
        }

      }

    }

    for (const [objectName, objectInfo] of Object.entries(objectInfoWrapper.ObjectToObjectInfoMap)) {
    
      const isRelatedObjectToBeProcessed = relatedObjects.has(objectName);

      if ( isRelatedObjectToBeProcessed 
          && !objectInfo.RelationshipDetail.isProcessed ) {
        
        this.calculateLevelsRecursively(objectInfoWrapper, objectName, 0);

      }

    }

  }

  // /**
  //  * Determine if an object is at the top level (no external parents)
  //  */
  private isTopLevelObject(relationshipDetail: RelationshipDetail): boolean {
  //   // Top level if no parents, or only self-references
    console.log(relationshipDetail.objectApiName);
    const parentObjectKeys = Object.keys(relationshipDetail.parentObjectToFieldReferences);
    
    const currentObjectIsParentForAllOthersInTree = parentObjectKeys?.every(
      parent => parent === relationshipDetail.objectApiName
    ) ?? false;
    
    const parentReferencesLength = parentObjectKeys?.length ?? 0;

    const topLevelObjectScenarioMet = (( parentReferencesLength === 0 ) || currentObjectIsParentForAllOthersInTree );

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
    visited.add(objectName);

    // Update level if this is higher than current level
    if (relationshipDetail.level < proposedLevel) {
      relationshipDetail.level = proposedLevel;
    }

    relationshipDetail.isProcessed = true;

    // Process all child objects at the next level
    const childObjectKeys = Object.keys(relationshipDetail.childObjectToFieldReferences);

    for (const childObjectName of childObjectKeys) {
      
      if (childObjectName !== objectName) { // Skip self-references
        
        this.calculateLevelsRecursively(
          objectInfoWrapper, 
          childObjectName, 
          relationshipDetail.level + 1,
          new Set(visited)
        );

      }

    }
  }

  /**
   * Group objects into relationship trees
   */
  private buildRelationshipTrees(objectInfoWrapper: ObjectInfoWrapper): RelationshipTree[] {

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

        const referencesToIterateOver = [...parentReferences , ...childReferences];
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


  getOrderedObjectsForRecipes(objectInfoWrapper: ObjectInfoWrapper): OrderedRecipeStructure {
    
    const orderedStructure: OrderedRecipeStructure = {
      relationshipTrees: [],
      totalObjects: 0
    };

    objectInfoWrapper.TheTrees.forEach((tree, treeIndex) => {
      
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
      orderedTree.combinedRecipe = this.buildCombinedTreeRecipe(orderedTree);
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

  /**
   * Get a summary of an object's relationships for documentation
   */
  private getObjectRelationshipSummary(relationshipDetail: RelationshipDetail): string {

    const parts = [];
    const parentObjectKeys = Object.keys(relationshipDetail.parentObjectToFieldReferences);
    const childObjectKeys = Object.keys(relationshipDetail.childObjectToFieldReferences);

    if ( parentObjectKeys?.length > 0 ) {
      parts.push(`Parents: ${parentObjectKeys.join(', ')}`);
    }
    if ( childObjectKeys?.length > 0) {
      parts.push(`Children: ${childObjectKeys.join(', ')}`);
    }
    return parts.join(' | ') || 'No relationships';
  }

  /**
   * Generate separate recipe files for each relationship tree
   */
  generateSeparateRecipeFiles(objectInfoWrapper: ObjectInfoWrapper): RecipeFileOutput[] {
    
    const orderedStructure = this.getOrderedObjectsForRecipes(objectInfoWrapper);
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

  /**
   * Print relationship hierarchy for debugging
   */
  printRelationshipHierarchy(objectInfoWrapper: ObjectInfoWrapper): string {

    const orderedStructure = this.getOrderedObjectsForRecipes(objectInfoWrapper);
    let output = `\n=== RECIPE GENERATION ORDER (${orderedStructure.totalObjects} total objects) ===\n\n`;

    orderedStructure.relationshipTrees.forEach((tree, treeIndex) => {
      output += `Tree ${treeIndex + 1}: ${tree.treeName}\n`;
      output += `${'='.repeat(40)}\n`;
      
      tree.orderedLevels.forEach(level => {
        output += `Level ${level.level}: ${level.objects.join(', ')}\n`;
        level.recipes.forEach(recipeInfo => {
          output += `  └─ ${recipeInfo.objectName} (${recipeInfo.relationshipInfo})\n`;
        });
      });
      output += '\n';
    });

    return output;
  
  }
     
}

export interface RelationshipDetail {
  objectApiName: string;
  level: number; // 0 = top-most parent, higher numbers = deeper in hierarchy
  childObjectToFieldReferences: Record<string, string[]>;
  parentObjectToFieldReferences: Record<string, string[]>;

  relationshipTreeId?: string; // Groups related objects together
  lookupFields: LookupFieldDetail[]; // Track which fields create relationships
  isProcessed: boolean; // Track if we've calculated its level
}

export interface LookupFieldDetail {
  fieldName: string;
  fieldType: 'Lookup' | 'MasterDetail' | 'Hiearchy';
  referenceTo: string;
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
