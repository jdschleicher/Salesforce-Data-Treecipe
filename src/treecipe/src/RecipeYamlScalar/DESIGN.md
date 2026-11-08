# Recipe YAML scalar — design notes

`RecipeYamlScalar` imports nothing, so it sits at layer 0 (#572) and the platform services (`ConfigurationService`, `ErrorHandlingService`, `SalesforceOrgService`, `VSCodeWorkspace`) and `SavedRecordTypeSelection` use it without importing the faker services.

## Where its rules are used

It is the YAML half of "Every picklist value reaches a recipe through its backend's escaper" in [`RecipeService/DESIGN.md`](../RecipeService/DESIGN.md). Its `tests/mocks/` holds the payloads and the Python gate every hostile-picklist suite in both backends imports.

## Files

```
    ├── RecipeYamlScalar/
    │   ├── RecipeYamlScalar.ts              # The YAML half of writing an untrusted picklist value: line breaks either parser sees, plain-vs-quoted list items
    │   └── tests/                           # PythonTestHarness.test.ts pins the gate below
    │       └── mocks/                   # HostilePicklistValues: the shared payload list. PythonTestHarness: the PyYAML / Jinja runners and the gate every such check goes through — runs where python3 has the module, skips without CI, FAILS in CI (#158)
```
