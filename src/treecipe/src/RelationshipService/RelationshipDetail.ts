
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

