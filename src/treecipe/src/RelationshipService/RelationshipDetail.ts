
export interface RelationshipDetail {
  objectApiName: string;
  level: number; // 0 = top-most parent, higher numbers = deeper in hierarchy
  parentObjects: string[]; // Objects that reference this object
  childObjects: string[]; // Objects this object references
  relationshipTreeId?: string; // Groups related objects together
  lookupFields: LookupFieldDetail[]; // Track which fields create relationships
  isProcessed: boolean; // Track if we've calculated its level
}

export interface LookupFieldDetail {
  fieldName: string;
  fieldType: 'Lookup' | 'MasterDetail' | 'Hiearchy';
  referenceTo: string;
}

// export interface RelationshipTree {
//   treeId: string;
//   topLevelObjects: string[]; // Objects at level 0
//   allObjects: string[]; // All objects in this tree
//   maxLevel: number; // Deepest level in this tree
// }

