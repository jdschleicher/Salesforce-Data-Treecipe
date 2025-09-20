import { FieldInfo } from "./FieldInfo";
import { RecordTypeWrapper } from "../RecordTypeService/RecordTypesWrapper";
import { RelationshipDetail } from "../RelationshipService/RelationshipDetail";

export class ObjectInfo {

  ApiName: string;
  Fields: FieldInfo[];
  RelationshipDetail: RelationshipDetail;
  FullRecipe: string;
  RecordTypesMap: Record<string, RecordTypeWrapper>;
  
  constructor(objectApiName:string)  {
    this.ApiName = objectApiName;
  };

}