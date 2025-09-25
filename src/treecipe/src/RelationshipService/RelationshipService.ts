import { FieldInfo } from "../ObjectInfoWrapper/FieldInfo";
import { ObjectInfoWrapper } from "../ObjectInfoWrapper/ObjectInfoWrapper";

export class RelationshipService {


    buildNewRelationshipDetail(objectApiName?: string): RelationshipDetail {
      return {
        objectApiName: objectApiName || '',
        level: -1, // -1 indicates not yet processed
        parentObjects: [],
        childObjects: [],
        lookupFields: [],
        isProcessed: false
      };
    }

   /**
   * Main method to process all relationships and establish hierarchy levels
   */
  processAllRelationships(objectInfoWrapper: ObjectInfoWrapper) {

    console.log('test');
    this.test();
    // Step 1: Build all relationship connections
    this.buildRelationshipConnections(objectInfoWrapper);
    
    // Step 2: Calculate hierarchy levels
    this.calculateRelationshipLevels(objectInfoWrapper);
    
    // Step 3: Group objects into relationship trees
    this.buildRelationshipTrees(objectInfoWrapper);

    return objectInfoWrapper;

  }

  private test() {
    console.log('we are here');
  }

  /**
   * Build bidirectional relationship connections between objects
   */
  private buildRelationshipConnections(objectInfoWrapper: ObjectInfoWrapper) {

    for (const [objectName, objectInfo] of Object.entries(objectInfoWrapper.ObjectToObjectInfoMap)) {

      // if (!objectInfo.RelationshipDetail) {
        objectInfo.RelationshipDetail = this.buildNewRelationshipDetail(objectName);
      // }
      
      
      if (objectInfo.Fields) {

        objectInfo.Fields.forEach((field) => {

          if (field.type === 'Lookup' 
                || field.type === 'MasterDetail' 
                || field.type === 'Hiearchy') {

            // this.addRelationshipConnection(objectInfoWrapper, objectName, field);
          
          }

        });
      }
    }
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

    // Build bidirectional connections
    if (!sourceRelDetail.childObjects.includes(targetObject)) {
      sourceRelDetail.childObjects.push(targetObject);
    }

    const targetRelDetail = objectInfoWrapper.ObjectToObjectInfoMap[targetObject].RelationshipDetail!;
    if (!targetRelDetail.parentObjects.includes(sourceObject)) {
      targetRelDetail.parentObjects.push(sourceObject);
    }

  }

  /**
   * Calculate hierarchy levels recursively
   */
  private calculateRelationshipLevels(objectInfoWrapper: ObjectInfoWrapper): void {
    // Reset all levels
    for (const objectInfo of Object.values(objectInfoWrapper.ObjectToObjectInfoMap)) {
      if (objectInfo.RelationshipDetail) {
        objectInfo.RelationshipDetail.level = -1;
        objectInfo.RelationshipDetail.isProcessed = false;
      }
    }

    // Find and process top-level objects (those with no parents or only self-references)
    for (const [objectName, objectInfo] of Object.entries(objectInfoWrapper.ObjectToObjectInfoMap)) {
      if (objectInfo.RelationshipDetail && !objectInfo.RelationshipDetail.isProcessed) {
        if (this.isTopLevelObject(objectInfo.RelationshipDetail)) {
          this.calculateLevelsRecursively(objectInfoWrapper, objectName, 0);
        }
      }
    }

    // Handle any remaining unprocessed objects (circular references, orphans)
    for (const [objectName, objectInfo] of Object.entries(objectInfoWrapper.ObjectToObjectInfoMap)) {
      if (objectInfo.RelationshipDetail && !objectInfo.RelationshipDetail.isProcessed) {
        this.calculateLevelsRecursively(objectInfoWrapper, objectName, 0);
      }
    }
  }

  /**
   * Determine if an object is at the top level (no external parents)
   */
  private isTopLevelObject(relationshipDetail: RelationshipDetail): boolean {
    // Top level if no parents, or only self-references
    return relationshipDetail.parentObjects.length === 0 || 
           relationshipDetail.parentObjects.every(parent => parent === relationshipDetail.objectApiName);
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
    if (!relationshipDetail) return;

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
    for (const childObjectName of relationshipDetail.childObjects) {
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
  private buildSingleRelationshipTree(
    objectInfoWrapper: ObjectInfoWrapper,
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
      
      if (localProcessed.has(currentObject)) continue;
      localProcessed.add(currentObject);
      globalProcessedObjects.add(currentObject);
      allObjects.add(currentObject);

      const relationshipDetail = objectInfoWrapper.ObjectToObjectInfoMap[currentObject]?.RelationshipDetail;
      if (relationshipDetail) {
        // Add all connected objects (parents and children)
        [...relationshipDetail.parentObjects, ...relationshipDetail.childObjects].forEach(connectedObject => {
          if (!localProcessed.has(connectedObject)) {
            toProcess.push(connectedObject);
          }
        });
      }
    }

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

  /**
   * Get relationship trees for debugging/visualization
   */
  getRelationshipTrees(objectInfoWrapper: ObjectInfoWrapper): RelationshipTree[] {
    return this.buildRelationshipTrees(objectInfoWrapper);
  }

  /**
   * Get ordered objects for recipe generation - THIS IS THE KEY METHOD
   * Returns objects grouped by relationship tree, ordered by dependency level
   */
  getOrderedObjectsForRecipes(objectInfoWrapper: ObjectInfoWrapper): OrderedRecipeStructure {
    const trees = this.getRelationshipTrees(objectInfoWrapper);
    const orderedStructure: OrderedRecipeStructure = {
      relationshipTrees: [],
      totalObjects: 0
    };

    trees.forEach((tree, treeIndex) => {
      const orderedTree: OrderedRelationshipTree = {
        treeId: tree.treeId,
        treeName: `RelationshipTree_${treeIndex + 1}`,
        orderedLevels: [],
        combinedRecipe: ''
      };

      // Group objects by level for this tree
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

          // Get the recipe for each object at this level
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
    if (relationshipDetail.parentObjects.length > 0) {
      parts.push(`Parents: ${relationshipDetail.parentObjects.join(', ')}`);
    }
    if (relationshipDetail.childObjects.length > 0) {
      parts.push(`Children: ${relationshipDetail.childObjects.join(', ')}`);
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
  
    // updateRelationshipDetail():RelationshipDetail {

    //     if ( !(this.objects.get(fieldInfo.referenceTo).relationshipDetail)) {
    //         this.objects.get(fieldInfo.referenceTo).relationshipDetail = new RelationshipDetail();
    //         this.objects.get(fieldInfo.referenceTo).relationshipDetail.relationshipTree = new relationshipTree();
    //       } 
    //       let lookupRelationshipBreakdown = this.objects.get(fieldInfo.referenceTo).relationshipDetail
  
    //       if (!(lookupRelationshipBreakdown.childRelationshipBreakdown.objectToReferencedFields)) {
  
    //         let fieldReferences = [];
    //         fieldReferences.push(fieldInfo);
    //         lookupRelationshipBreakdown.childRelationshipBreakdown.objectToReferencedFields = new Map<string, FieldInfo[]>();
    //         lookupRelationshipBreakdown.childRelationshipBreakdown.objectToReferencedFields[fieldInfo.objectName] = fieldReferences;
  
    //       } else {
  
    //         lookupRelationshipBreakdown.childRelationshipBreakdown.objectToReferencedFields[fieldInfo.objectName].add(fieldInfo);
  
    //       }
    //       let totalFieldReferencesByOneObject = lookupRelationshipBreakdown[fieldInfo.objectName].childRelationshipBreakdown.count;
    //       if (lookupRelationshipBreakdown.maxTotalCountReferencedByOneObject < totalFieldReferencesByOneObject ) {
    //         lookupRelationshipBreakdown.maxTotalCountReferencedByOneObject = totalFieldReferencesByOneObject;
    //       } 
  
    //       let lookupRelationshipLevel = this.objects.get(fieldInfo.referenceTo).relationshipDetail.relationshipLevel;
    //       let currentObjectRelationshipLevel = this.objects.get(fieldInfo.objectName).relationshipDetail.relationshipLevel;
    //       if ( currentObjectRelationshipLevel >= lookupRelationshipLevel ) {
    //         let newRelationshipLevel = ( lookupRelationshipLevel - 1 );
    //         this.objects.get(fieldInfo.objectName).relationshipDetail.relationshipLevel = newRelationshipLevel;
    //       }

          
    // }

    // public buildRelationshipTrackerByObject(objectName: string, objectTracker: ObjectRelationshipWrapper ) {
    
    //     if ( !(objectTracker.objects.has(objectName)) ) {
    
    //         let relationshipTracker = new RelationshipDetail();
    //         relationshipTracker.relationshipLevel = 1;
    //         relationshipTracker.relationshipTree = new relationshipTree();
            
    //     }
    
    // }

   
}

interface RelationshipDetail {
  objectApiName: string;
  level: number; // 0 = top-most parent, higher numbers = deeper in hierarchy
  parentObjects: string[]; // Objects that reference this object
  childObjects: string[]; // Objects this object references
  relationshipTreeId?: string; // Groups related objects together
  lookupFields: LookupFieldDetail[]; // Track which fields create relationships
  isProcessed: boolean; // Track if we've calculated its level
}

interface LookupFieldDetail {
  fieldName: string;
  fieldType: 'Lookup' | 'MasterDetail' | 'Hiearchy';
  referenceTo: string;
}

interface RelationshipTree {
  treeId: string;
  topLevelObjects: string[]; // Objects at level 0
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
