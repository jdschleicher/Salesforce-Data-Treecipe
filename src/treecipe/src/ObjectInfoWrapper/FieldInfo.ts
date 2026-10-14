import { IValidationRuleConstraintRecord } from "../ValidationRuleAnalyzerService/ValidationRuleAnalyzerService";

export class FieldInfo {

  /*
    The field XML's <length>, <precision> and <scale>, recorded only when the XML has them, so a field
    without one serializes into the objects wrapper exactly as it did before they were recorded.
  */
  public length?: number;
  public precision?: number;
  public scale?: number;

  /*
    Set only on a field a validation rule names (#324): every such rule, applied or not, and the value
    the field generated before any was applied, so the Recipe Cockpit can switch back. A field no
    rule names carries neither, and serializes as it did before rules were read.
  */
  public validationRuleConstraints?: IValidationRuleConstraintRecord[];
  public unconstrainedRecipeValue?: string;

  constructor(
    public objectName: string,
    public fieldName: string,
    public fieldLabel: string,
    public type: string,
    public picklistValues?: IPicklistValue[],
    public controllingField?: string,
    public referenceTo?: string,
    public recipeValue?: string
  ) {
      this.objectName = objectName;
      this.fieldName = fieldName;
      this.type = type;
      this.referenceTo = referenceTo;
      this.picklistValues = picklistValues;
      this.controllingField = controllingField;
      this.recipeValue = recipeValue;

  }

  public static create(
                        objectName: string, 
                        fieldName: string,
                        fieldLabel: string,
                        type: string,
                        picklistValues: IPicklistValue[],
                        controllingField: string,
                        referenceTo: string,
                        recipeValue ) : FieldInfo {

      if (!objectName || !fieldName ) {
        throw new Error('Invalid FieldInfo data: FieldInfo.create()');
      }

      return new FieldInfo(
        objectName,
        fieldName,
        fieldLabel,
        type,
        picklistValues,
        controllingField,
        referenceTo,
        recipeValue
      );

  }

  public static applyFieldSize(fieldInfo: FieldInfo, fieldSize: IFieldSize): FieldInfo {

    if ( Number.isInteger(fieldSize.length) ) {
      fieldInfo.length = fieldSize.length;
    }

    if ( Number.isInteger(fieldSize.precision) ) {
      fieldInfo.precision = fieldSize.precision;
    }

    if ( Number.isInteger(fieldSize.scale) ) {
      fieldInfo.scale = fieldSize.scale;
    }

    return fieldInfo;

  }

}

export interface IFieldSize {
  length?: number;
  precision?: number;
  scale?: number;
}

export interface IPicklistValue {
  picklistOptionApiName: string;
  label: string;
  default?: boolean;
  controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection?: string[];
  isActive?: boolean;
}

