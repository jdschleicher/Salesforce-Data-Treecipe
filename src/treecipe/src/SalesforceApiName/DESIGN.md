# Salesforce api name — design notes

`SalesforceApiName` imports nothing, so it sits at layer 0 (#572): `ObjectInfoWrapper`, `RecordTypeService`, `SavedRecordTypeSelection`, `SalesforceOrgService`, `ValidationRuleAnalyzerService`, `SOQLTemplateService` and `MermaidService` hold a name to it without importing `RecipeService`.

## Where its rule is used

One guard per name, in the service that loads the name: "A metadata NAME reaches a recipe only if it IS a Salesforce api name" in [`RecipeService/DESIGN.md`](../RecipeService/DESIGN.md).

## Files

```
    ├── SalesforceApiName/
    │   └── SalesforceApiName.ts             # The one api-name rule every metadata NAME is held to before it reaches a recipe; imports nothing
```
