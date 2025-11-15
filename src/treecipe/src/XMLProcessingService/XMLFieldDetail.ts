import { IPicklistValue } from "../ObjectInfoWrapper/FieldInfo";

export class XMLFieldDetail {
    public fieldType: string;
    public apiName: string;
    public picklistValues?: IPicklistValue[];
    public globalValueSetName?: string;
    public referenceTo?: string;
    public fieldLabel: string;
    public controllingField?: string;
    public xmlMarkup: string;
    public isStandardValueSet?: boolean;
    public precision?: number;
    public length?: number;
}
