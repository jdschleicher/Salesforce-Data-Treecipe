import { IPicklistValue } from "../ObjectInfoWrapper/FieldInfo";

export class XMLFieldDetail {
    public fieldType: string;
    public apiName: string;
    public picklistValues?: IPicklistValue[];
    public referenceTo?: string;
    public fieldLabel: string;
    public controllingField?: string;
}