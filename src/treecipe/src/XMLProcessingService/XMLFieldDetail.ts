import { IPicklistValue } from "../ObjectInfoWrapper/FieldInfo";
import type { ReadOnlyFieldReason } from "../ObjectInfoWrapper/ReadOnlyFields";

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
    public scale?: number;
    public length?: number;
    // SET ONLY FOR A FIELD SALESFORCE CALCULATES OR SETS ITSELF (#685), SO EVERY OTHER FIELD IS WRITTEN AS BEFORE
    public readOnlyReason?: ReadOnlyFieldReason;
    public formula?: string;
}
