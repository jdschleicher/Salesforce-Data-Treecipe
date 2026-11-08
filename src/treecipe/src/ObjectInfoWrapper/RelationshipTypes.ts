/*
    The shapes RelationshipService fills in and ObjectInfo / ObjectInfoWrapper carry. They live in the
    metadata model so it never imports the service that computes them (#574).
*/

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
export interface OrderedRelationshipTree {
  treeId: string;                    // Unique identifier for this tree (e.g., "tree_Account_1694123456")
  treeName: string;                  // Human-readable name (e.g., "RelationshipTree_1")
  orderedLevels: RecipeLevel[];      // Array of levels, ordered from 0 (top parents) to highest
  combinedRecipe: string;            // Complete YAML recipe for this entire tree
}

// Represents one level in the hierarchy (all objects at the same dependency level)
export interface RecipeLevel {
  level: number;                     // The hierarchy level (0 = top-most parents, 1 = their children, etc.)
  objects: string[];                 // Array of object API names at this level (e.g., ["Account", "User"])
  recipes: RecipeInfo[];             // Array of recipe info for each object at this level
}

// Contains the recipe and metadata for one specific object
export interface RecipeInfo {
  objectName: string;                // Object API name (e.g., "Account")
  recipe: string;                    // The YAML recipe content for this object (its first record type block, when there are several)
  additionalRecordTypeRecipes: string[]; // Every later record type block (#194); empty when the object is one block
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
