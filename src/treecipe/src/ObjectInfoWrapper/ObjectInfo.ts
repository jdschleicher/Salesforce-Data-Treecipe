import { FieldInfo } from "./FieldInfo";
import { RecordTypeWrapper } from "../RecordTypeService/RecordTypesWrapper";
import { RelationshipDetail } from "../RelationshipService/RelationshipService";

export class ObjectInfo {

  ApiName: string;
  Fields: FieldInfo[];
  RelationshipDetail: RelationshipDetail;
  FullRecipe: string;
  // THE SECOND AND LATER RECORD TYPE BLOCKS, SET ONLY WHEN SEVERAL RECORD TYPES WERE SELECTED (#194); FullRecipe IS THE FIRST
  AdditionalRecordTypeRecipes?: string[];
  RecordTypesMap: Record<string, RecordTypeWrapper>;
  
  constructor(objectApiName:string)  {
    this.ApiName = objectApiName;
  };

}