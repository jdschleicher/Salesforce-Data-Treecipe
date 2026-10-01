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

}
