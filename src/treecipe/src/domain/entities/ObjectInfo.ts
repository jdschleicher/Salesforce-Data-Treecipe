import { FieldInfo } from "./FieldInfo";
import { RelationshipDetail } from "./RelationshipDetail";

export class ObjectInfo {

  apiName: string;
  fields: FieldInfo[];
  relationshipDetail: RelationshipDetail;
  fullRecipe: string;
  
  constructor(objectApiName:string)  {
    this.apiName = objectApiName;
  };

}