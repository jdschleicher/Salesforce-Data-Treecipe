# Salesforce api name — design notes

`SalesforceApiName` imports nothing, so it sits at layer 0 (#572): a lower-layer service that loads a name, such as `ObjectInfoWrapper`, `RecordTypeService` or `SalesforceOrgService`, holds it to this rule without importing `RecipeService`.

## Where its rule is used

One guard per name, in the service that loads the name: "A metadata NAME reaches a recipe only if it IS a Salesforce api name" in [`RecipeService/DESIGN.md`](../RecipeService/DESIGN.md).

## Files

```
    ├── SalesforceApiName/
    │   ├── SalesforceApiName.ts             # The one api-name rule every metadata NAME is held to before it reaches a recipe; imports nothing
    │   └── tests/                           # SalesforceApiName.test.ts: "imports nothing"
```
