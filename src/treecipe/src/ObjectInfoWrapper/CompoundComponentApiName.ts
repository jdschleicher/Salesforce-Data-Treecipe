/*
    Salesforce names compound components two different ways and the compound field's own api name
    is the only signal for which: a custom field's components carry the "__s" system suffix off
    the base name, a standard field's are the compound name with "Address" swapped for the
    component. Lead's compound field is literally named "Address", so an empty prefix -- and the
    bare "Street"/"City" components it produces -- is a correct result here, not a fallback.

    The "Address" swap holds for Geolocation too rather than being incidental to it -- the
    components of a standard compound address ARE its geolocation, so BillingAddress would yield
    BillingLatitude and BillingLongitude, which are the real api names. Nothing reaches that
    branch by the geolocation route today: only a <type>Location</type> field is expanded this
    way, and in source metadata that is always a custom field. It is asserted because it is the
    rule, not because a caller exercises it.

    Imports nothing, so SOQLTemplateService reads the rule without loading RecipeService (#697).
*/
export class CompoundComponentApiName {

    static build(compoundFieldApiName: string, componentKey: string): string {

        const customFieldSuffix = '__c';
        if ( compoundFieldApiName.endsWith(customFieldSuffix) ) {

            const customFieldBaseName = compoundFieldApiName.slice(0, -customFieldSuffix.length);
            return `${customFieldBaseName}__${componentKey}__s`;

        }

        const standardCompoundFieldSuffix = 'Address';
        const standardComponentPrefix = compoundFieldApiName.endsWith(standardCompoundFieldSuffix)
            ? compoundFieldApiName.slice(0, -standardCompoundFieldSuffix.length)
            : compoundFieldApiName;

        return `${standardComponentPrefix}${componentKey}`;

    }

}
