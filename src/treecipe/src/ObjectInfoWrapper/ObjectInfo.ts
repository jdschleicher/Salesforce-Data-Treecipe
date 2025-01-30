import { FieldInfo } from "./FieldInfo";
import { RelationshipDetail } from "../RelationshipService/RelationshipDetail";
import { RecordTypeWrapper } from "../RecordTypeService/RecordTypesWrapper";

export class ObjectInfo {

  apiName: string;
  fields: FieldInfo[];
  relationshipDetail: RelationshipDetail;
  fullRecipe: string;
  recordTypesMap: Record<string, RecordTypeWrapper>;
  
  constructor(objectApiName:string)  {
    this.apiName = objectApiName;
  };

}