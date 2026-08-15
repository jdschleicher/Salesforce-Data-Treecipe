/*
    Backend-agnostic description of one dependent picklist's expected combinations.

    This mirrors the Apex PicklistDependencySpec fluent API one-to-one so the emitter is a
    straight serialization step rather than a second place that decides what a dependency means.
*/
export interface IPicklistDependencyExpectation {
    controllingValue: string;
    // An empty list means the controlling value must exist and unlock nothing -- emitted as expectNone
    dependentValues: string[];
}

export interface IPicklistDependencySpecDetail {
    objectApiName: string;
    fieldApiName: string;
    controllingFieldApiName: string;
    expectations: IPicklistDependencyExpectation[];
}

export interface IPicklistDependencySpecCollectionResult {
    specDetails: IPicklistDependencySpecDetail[];
    // Fields carrying a controllingField whose XML had no usable valueSettings -- reported, never fatal
    skippedFieldWarnings: string[];
}
