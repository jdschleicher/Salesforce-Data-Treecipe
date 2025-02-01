import { FieldInfo } from "./FieldInfo";
import { RelationshipDetail } from "../RelationshipService/RelationshipDetail";
import { RecordTypeWrapper } from "../RecordTypeService/RecordTypesWrapper";

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