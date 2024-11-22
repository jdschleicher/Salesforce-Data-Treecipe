

export class FieldInfo {
  
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

      if (!objectName || !fieldName || !type) {
        throw new Error('Invalid FieldInfo data');
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

}

export interface IPicklistValue {
  fullName: string;
  label: string;
  default?: boolean;
  availableForControllingValues?: string[];
}
