import { FieldInfo } from "./FieldInfo";

export class RelationshipTree {

    objectToReferencedFields: Record<string, FieldInfo[]>;
    relationshipType: string;
  
}