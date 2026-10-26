/*
    The one definition of what a metadata NAME must look like before it is written into a recipe.
    It imports nothing on purpose: ObjectInfoWrapper, SOQLTemplateService and MermaidService run
    without vscode, and RecipeService does not.
*/
export class SalesforceApiName {

    static readonly pattern = /^[A-Za-z][A-Za-z0-9_]*$/;

    static isApiName(name: unknown): name is string {

        return typeof name === 'string' && SalesforceApiName.pattern.test(name);

    }

    // AN OBJECT API NAME, OR ONE AND THE NICKNAME OF ONE OF ITS OCCURRENCES ("<Object>\n<Nickname>", #467), EACH AN API NAME
    static isOccurrenceKey(key: unknown): key is string {

        if ( typeof key !== 'string' ) {
            return false;
        }
        const keyParts = key.split('\n');
        return keyParts.length <= 2 && keyParts.every(keyPart => SalesforceApiName.pattern.test(keyPart));

    }

}
