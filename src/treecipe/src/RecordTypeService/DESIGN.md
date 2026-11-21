# Record types — design notes

Design notes moved out of CLAUDE.md (#563). Read this before changing the service; CLAUDE.md keeps only the rules every change must follow. History is in CHANGELOG.md.

- **`isChildTreeCopiedPerRecordTypeBlock` is a property of the selection, not a generation setting** (#622) — it only means anything when an object has several blocks, so it travels with the names that make them. Off by default; the constructor's second argument, and `fromUnknown`'s, which turns it on only for exactly `true` because a selection can arrive through a command argument. A saved selection (#196) never sets it. What it does to a recipe is `RelationshipService/DESIGN.md`'s.
- **`listRecordTypeCombinations` counts before it lists** (#624) — the product of each object's names is computed first and the combinations built only within the caller's cap, so a large selection is refused without building it. Objects follow the order given (the tree's insert order), the first changing slowest; an object with no names, or one only inherited from a prototype, is in no set. The cap and the words of a refusal are the cockpit's (`RecipeCockpitRecordTypeRecipe`).

## Files

What CLAUDE.md's Project Structure said about these files before #563 trimmed it to one line each.

```
    │   ├── RecordTypeSelection.ts           # The record types chosen per object (#193): untrusted-input parsing, which names an object uses and which are ignored, the blocks they are written as and their nicknames (#194), a record type's values for a field, a dependent picklist narrowed to one record type; imports only RecordTypeWrapper
```
