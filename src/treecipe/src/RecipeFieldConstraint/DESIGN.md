# Recipe field constraint — design notes

`RecipeFieldConstraint` imports nothing, so it sits at layer 0 (#572) and `ValidationRuleAnalyzerService` reads a constraint without importing the faker services.

## Where its rules are used

Validation rules apply constraints in `RecipeService` ("Generate Treecipe applies the constraints validation rules imply", [`RecipeService/DESIGN.md`](../RecipeService/DESIGN.md)); a bound past 15 digits is refused here, so neither backend's `buildConstrainedExpression` receives one ([`RecipeFakerService.ts/DESIGN.md`](../RecipeFakerService.ts/DESIGN.md)).

## Files

```
    ├── RecipeFieldConstraint/
    │   ├── RecipeFieldConstraint.ts     # A field's faker constraint (#323, used by #324's validation rules since #356 removed the cockpit's ✎): which types take one, a typed bound checked against the field's precision/scale or <length>, defaults that never cross a typed bound, the resolved constraint both backends' buildConstrainedExpression format; imports nothing
    │   └── tests/                       # ConstrainedExpressionGeneration.test.ts: the contract both backends are held to, and every constraint generated through the filtered copy with each backend and checked inside its bounds
```
