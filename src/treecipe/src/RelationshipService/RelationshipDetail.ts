
export interface LookupFieldDetail {
  fieldName: string;
  fieldType: 'Lookup' | 'MasterDetail' | 'Hiearchy';
  referenceTo: string;
}