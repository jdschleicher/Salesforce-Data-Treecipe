---
name: cockpit-row-style
description: Holds every Recipe Cockpit list to the row presentation standard (#558) — a two-line row header, a bordered row box, or a column table. Audits the diff for a list that uses none of them or styles its own rows, says which row type it should use, and hands screenshot changes to /cockpit-help-sync. Run after any change to a list, table or row in the Recipe Cockpit, and as a step of the task and PR flows.
---

# /cockpit-row-style

The Recipe Cockpit draws many lists: data sets, a data set's insert journey, the Troubleshooting History, query previews, Treecipe fields, Adapter rows, TODO and rule cards. Each one used to make up its own layout, so the same kind of information looked different from tab to tab. Issue #558 set a standard of **three row types**. Every list body uses one of them.

`src/treecipe/src/RecipeCockpitService/tests/RecipeCockpitRowPresentation.test.ts` enforces the parts a test can check: tables are made only by `buildRowTable`, cell borders come only from `.sdtRowTable`, and a data set row is two lines. This skill covers what a test cannot judge: whether a new or changed list picked the right type.

---

## The three row types

| Type | Built by | Classes | Use it for |
|---|---|---|---|
| **Two-line row header** | the row's builder appends a `sdtRowHeaderPrimary` and a `sdtRowHeaderDetail` div to a `sdtRowHeader` | `sdtRowHeader`, `sdtRowHeaderPrimary`, `sdtRowHeaderDetail` | One item per row that the reader acts on (a data set). **Line 1** holds what the reader decides on: favorite, rename, name, status chip, then the actions. **Line 2** starts with the row's ▸ (if it has one), then the facts: when, how, which version, where. Both lines start at the same inset, so the ▸ sits under the first icon. |
| **Bordered row box** | `treeFieldsBox` / `treeFieldSelectAllRow` (#494) | `treeFieldsBox`, `treeField` | Rows that belong to one parent and are edited in place (an object's fields). The box's left margin puts each row's controls under the parent's ▸. An empty box hides itself with CSS `:has()`, never through the script. |
| **Column table** | `buildRowTable(tableOptions)` in the panel script | `sdtRowTable`, `sdtRowTableWrap`, plus the table's own name | Rows of the same facts that a reader compares or sorts: a timeline, a history, a record preview. Columns in `sortColumns` head with a `link` button and `aria-sort`; the caller keeps the sort and draws the rows into `bodyElement`. A wide table scrolls inside its wrap. |

`buildRowTable` takes:

```js
buildRowTable({
    className: 'treeDatasetJourneyTable',   // the table's own class; the wrap gets <className>Wrap
    columnClassName: 'treeDatasetJourney',  // optional: th gets <name>Header <name>Header-<key>, sort buttons <name>Sort <name>Sort-<key>
    columns: [{ key, label }, ...],
    sortColumns: ['time', ...],             // optional
    sort: { column, isDescending },         // optional; no sort, plain headers
    onSort: function (columnKey) { ... }    // re-sort, redraw, focus sortButtons[columnKey]
}) // → { wrapElement, bodyElement, sortButtons }
```

Users today: the Troubleshooting History (#485), a data set's insert journey (#471), the Query and Adapter record previews (#367, #416).

---

## Step 1: Find the list changes

```bash
BASE=$(git merge-base HEAD origin/main)
git diff "$BASE"...HEAD -- src/treecipe/src/RecipeCockpitService/RecipeCockpitService.ts | grep -nE "^\+.*(createElement\('(table|tr|td|th|ol|ul|li)'|className|display: (flex|grid)|border)" | head -80
```

Include uncommitted changes too (`git diff -- src/treecipe/src/RecipeCockpitService`). For each hunk, decide whether it draws **a list body**: repeated rows of the same kind under a header, a tab or a ▸.

## Step 2: Classify each list

For each list in the diff, answer:

1. **Which type is it?** Use the table above. If the reader compares the same facts across rows, use a column table. If a row is one item with actions, use a two-line row header. If it is the children of one parent, edited in place, use a bordered row box.
2. **Is it built the standard way?**
   - A table not made by `buildRowTable` → **fail** (the test catches this too).
   - A rule that sets `border`, `padding` or `vertical-align` on a table's `th`/`td` outside `.sdtRowTable` → **fail**.
   - An `ol`/`ul` timeline or a flex row of facts where a table fits → **move it**.
   - A one-line row header with more than about six things on it → **split it** into the two-line header.
   - A ▸ anywhere but first on line 2 of a two-line row header, or first in a box row → **move it**.
3. **Does it keep what the cockpit guarantees?** Every value through `textContent`; buttons from `createButton` with one kind (#363); colours only from `--sdt-*` pairs the contrast test holds; no inline style (motion is classes, #227).

If a list is outside the PR's scope and is not yet on the standard, list it as a follow-up. Do not move it in this PR.

## Step 3: Check the test still covers it

If the diff adds a new list that uses a row type, add its case to `RecipeCockpitRowPresentation.test.ts`: the classes it carries and the order of its first children. A new table needs nothing more, because the table check counts every `createElement('table'` in the panel script.

## Step 4: Screenshots

If any row's look changed, run `/cockpit-help-sync` so the guide's pictures and words match.

## Step 5: Report

```
## Cockpit row style — <branch>

| List | Where | Row type | Verdict |
|---|---|---|---|
| Data set journey | buildDatasetJourneyEntry | Column table | ✅ |
| <new list> | <function> | <type> | ❌ <what to change> |

Follow-ups (outside this PR): <lists not yet on the standard>
Screenshots: <re-taken by /cockpit-help-sync | no visible change>
```

When this skill runs inside a PR flow, post the report as a PR comment ending with the attribution footer, and have `/pr-body` link it.
