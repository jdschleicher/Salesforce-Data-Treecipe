# Faker services — design notes

Design notes moved out of CLAUDE.md (#563). Read this before changing the service; CLAUDE.md keeps only the rules every change must follow. History is in CHANGELOG.md.

## Files

What CLAUDE.md's Project Structure said about these files before #563 trimmed it to one line each.

```
    │   │   ├── RecipeFieldConstraint.ts     # A field's faker constraint (#323, used by #324's validation rules since #356 removed the cockpit's ✎): which types take one, a typed bound checked against the field's precision/scale or <length>, defaults that never cross a typed bound, the resolved constraint both backends' buildConstrainedExpression format; imports nothing
    │   │   └── tests/                       # ConstrainedExpressionGeneration.test.ts: the contract both backends are held to, and every constraint generated through the filtered copy with each backend and checked inside its bounds
    │           └── mocks/                   # HostilePicklistValues: the shared payload list. PythonTestHarness: the PyYAML / Jinja runners and the gate every such check goes through — runs where python3 has the module, skips without CI, FAILS in CI (#158)
```
