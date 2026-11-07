# Faker services — design notes

Design notes moved out of CLAUDE.md (#563). Read this before changing the service; CLAUDE.md keeps only the rules every change must follow. History is in CHANGELOG.md.

## Files

What CLAUDE.md's Project Structure said about these files before #563 trimmed it to one line each.

```
    │   │   ├── RecipeFieldConstraint.ts     # A field's faker constraint (#323, used by #324's validation rules since #356 removed the cockpit's ✎): which types take one, a typed bound checked against the field's precision/scale or <length>, defaults that never cross a typed bound, the resolved constraint both backends' buildConstrainedExpression format; imports nothing
    │   │   └── tests/                       # ConstrainedExpressionGeneration.test.ts: the contract both backends are held to, and every constraint generated through the filtered copy with each backend and checked inside its bounds
    │           └── mocks/                   # HostilePicklistValues: the shared payload list. PythonTestHarness: the PyYAML / Jinja runners and the gate every such check goes through — runs where python3 has the module, skips without CI, FAILS in CI (#158)
```

## faker-js `|` blocks and the trailing line break (#593)

`FakerJSRecipeFakerService` writes Phone, Number, Percent, Date, DateTime, Time, Geolocation and every precision/scale field as a `|` block. YAML ends a `|` block with one line break, which is no part of the value faker produces, and `FakerJSRecipeProcessor` only replaces the `${{ … }}` expression inside it.

- **The line break is dropped where the recipe is loaded, in `FakerJSRecipeProcessor.loadRecipeYaml`, not where it is written.** Changing the writer to `|-` would change every faker-js recipe and leave recipes already generated with the line break.
- **Only a `|` block (clip chomping) that holds an expression loses it.** After loading, `|`, `|+` and a quoted `"…\n"` are the same string, so the loader reads each value's header through js-yaml's `listener` option (declared in `@types/js-yaml`; js-yaml is pinned). `|+`, `|-`, `>`, quoted values and blocks with no expression load as written.
- **The header is read from the node's open position**: js-yaml opens a node at the space after its `:` or `-`, before any tag or anchor. `FakerJSRecipeProcessor.literalBlockLineBreak.test.ts` holds each header shape, so a js-yaml upgrade that moves that position fails there.
- An anchored `|` block reused by an alias keeps its line break in the alias: js-yaml stores the anchor before the listener runs. Generate Treecipe writes no anchors.
