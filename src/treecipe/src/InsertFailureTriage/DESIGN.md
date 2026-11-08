# Insert failure triage — design notes

`RecipeCockpitInsertFailureTriage` imports nothing, so it sits at layer 0 (#572) and `CollectionsApiService` names its sub-tabs without importing the Recipe Cockpit. The class keeps its cockpit name.

## How a failed insert is triaged

The note is the cockpit's, since the rule spans the insert and the panel: "A failed tree insert names its first failed FILE and opens the Troubleshooting SUB-TAB its error points at" (#375) in [`RecipeCockpitService/DESIGN.md`](../RecipeCockpitService/DESIGN.md).

## Files

```
    ├── InsertFailureTriage/
    │   ├── RecipeCockpitInsertFailureTriage.ts # A failed tree insert's first error → the Troubleshooting sub-tab "Open Troubleshooting" opens (#375), the first error that is not an all-or-none rollback answer; imports nothing
    │   └── tests/                            # RecipeCockpitInsertFailureTriage.test.ts, including "imports nothing"
```
