import { FieldInfo } from "./FieldInfo";
import { RecordTypeWrapper } from "../RecordTypeService/RecordTypesWrapper";
import { RelationshipDetail } from "../RelationshipService/RelationshipService";
import { IValidationRuleNotApplied } from "../ValidationRuleAnalyzerService/ValidationRuleAnalyzerService";

export class ObjectInfo {

  ApiName: string;
  Fields: FieldInfo[];
  RelationshipDetail: RelationshipDetail;
  FullRecipe: string;
  // THE SECOND AND LATER RECORD TYPE BLOCKS, SET ONLY WHEN SEVERAL RECORD TYPES WERE SELECTED (#194); FullRecipe IS THE FIRST
  AdditionalRecordTypeRecipes?: string[];
  RecordTypesMap: Record<string, RecordTypeWrapper>;
  // ACTIVE VALIDATION RULES THAT MATCH NO SHAPE OR NAME NO FIELD THE WALK READ (#324), SET ONLY WHEN THERE IS ONE
  ValidationRulesNotApplied?: IValidationRuleNotApplied[];
  
  constructor(objectApiName:string)  {
    this.ApiName = objectApiName;
  };

}