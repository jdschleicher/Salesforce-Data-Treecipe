/*
    The standard objects whose Name is the read-only compound of Salutation, FirstName and LastName
    (#114). An insert cannot write that Name, and a query can still read it. Account is not listed:
    its Name is compound only on a person account, which source metadata does not say. Imports nothing.
*/
export class PersonNameObjects {

    static readonly objectApiNames: string[] = ['Contact', 'Lead', 'Individual'];

    static includes(objectApiName: string): boolean {

        return PersonNameObjects.objectApiNames.includes(objectApiName);

    }

}
