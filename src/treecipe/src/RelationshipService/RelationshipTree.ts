import { FieldInfo } from "../ObjectInfoWrapper/FieldInfo";

export class RelationshipTree {

    objectToReferencedFields: Record<string, FieldInfo[]>;
    relationshipType: string;
  
}