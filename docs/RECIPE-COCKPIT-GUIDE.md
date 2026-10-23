# Recipe Cockpit guide

The Recipe Cockpit shows the recipes Generate Treecipe wrote as cards you can open, trim and generate from.
Click **?** at the top right of the cockpit, beside the version and the GitHub icon, for the short version of this page.

A few words used below:

- **Run**: one Generate Treecipe output, a timestamped folder under `treecipe/GeneratedRecipes`.
- **Tree**: a group of related objects written to one recipe file, parents before children. Each card is one tree.
- **Recipe file**: the `.yml` file Run Faker reads to make fake records.

<!-- Kept in step with RECIPE_COCKPIT_HELP_SECTIONS in src/treecipe/src/RecipeCockpitService/RecipeCockpitService.ts by /cockpit-help-sync. The ## headings below must match the help's, in the same order: a test checks them. -->

## Where recipes come from

Generate Treecipe reads your object metadata and writes a run: a folder under `treecipe/GeneratedRecipes` holding the recipe files and a list of the objects it read.
The cockpit opens the newest run, or the one you pick in the run list at the top.
Under the run list, the **Target Org Management** section picks the org a card can insert into, opens it in your browser (**Open in browser**) or makes a new scratch org (**+ New scratch org**), which it creates and selects without deploying anything to it. It stays at the top of the panel while you scroll.
The **Treecipes** section below it shows one card at a time: pick it in the **Treecipe** dropdown, which starts on the one you picked last.
Each card is named after the folder its tree was written to: its first object thru its last, such as `Account-thru-Contact`, or `Lead-ONLY` for a single object, until you rename it with ✎.
Under the dropdown, a line lists the card's objects in the order they are inserted, and marks each excluded object, whether you excluded it or its parent.
The search box above the dropdown finds a treecipe by its name or folder, or by an object, field or record type in it, and lists what it found. Click a result to open that card on its Treecipe tab at that row.
**Favorites only** narrows the dropdown to your starred cards.
Each card's **Generate fake data and insert** button generates the tree and inserts it into that org; with no org chosen, it asks you for one first, and when something else stops the insert it is disabled and says why. It asks nothing about lookups: one still a TODO to an object the tree does not insert is left blank, or, when the org requires it, given a random existing record.
If an insert fails, its message offers **View failed file** (the generated file that failed), **View errors** and **Open Troubleshooting**, which opens the card's Troubleshooting area that may fix it.
To generate without inserting, use **Run Faker by Recipe** from the command palette.

Each object shows its nickname, the name its lookups use in the recipe file.
Click it to list the fields that point to it and jump to one; a field holding a nickname shows it highlighted (**↖ Account_NickName**), and clicking it jumps back to that object.
A friend, an object nested under another's `friends:` in a faker-js recipe, shows a holding-hands chip for each parent it belongs to: the one it is nested under first, then any other its lookups name.
Each chip reads the parent's nickname and the friend's place among that parent's friends (**Account_NickName-2**); click it to jump to that parent.

Generate Treecipe marks what still needs a hand edit with a TODO comment, such as a lookup with no parent yet or a validation rule it could not apply.
Tick **TODOs only** on a card's Treecipe tab to see just the fields and objects with one, or open its **Troubleshooting** tab, whose **TODO's** list shows them all: one card per object, which you click to open, then each TODO under its field with a link to its line (**↗ yml**).
Its **Open** list holds the TODOs still in the recipe, and **Removed** the ones you took out.

The **Troubleshooting** tab shows one area at a time: **TODO's**, **Fields**, **Permissions**, **Validation Rules**, **Record Types** and **Global Value Sets**, each with its own search.
It opens on the one you chose last.
Each action there is a card you click anywhere on, saying when you would need it and, when it cannot run, why.
**Validation Rules** lists each object's validation rules from your project on a card you click to open, its header counting them by what Generate Treecipe did (such as *2 applied · 1 not applied*): whether each is active, its error message, the fields it constrains and whether Generate Treecipe applied it, or why not.
**Show formula** opens a rule's formula.

![The cockpit's title row with the GitHub icon and the ? button at its right, the toolbar with the run list and Favorites only under it, above the Target Org Management section and the Treecipes section's search box, its Treecipe dropdown with the line naming the card's objects in insert order, and the one card it shows](images/recipe-cockpit/where-recipes-come-from.png)

## What the cockpit changes without editing the YAML

These settings change what is generated, but the recipe file stays exactly as Generate Treecipe wrote it, so it always shows what was generated from your metadata:

- **Excluded objects** (the chain link): the object and its children are left out.
- **Unticked fields**: the field is left out. **All fields**, above an object's fields, ticks or unticks them all.
- **Record counts**: how many records an object gets.
- **The rules box**: a field generated without the limits its validation rules set.

![A card with one object excluded, a field unticked and a count changed](images/recipe-cockpit/changes-without-editing-the-yaml.png)

## What does edit the YAML

These buttons rewrite the recipe file itself, because the change belongs in the recipe:

- **Wire to…** and **Wire TODO lookups**: fill a lookup's TODO with its parent's nickname.
- **Create &lt;parent&gt; in recipe**, on a lookup that is still a TODO: adds a standard parent object, such as Account, above the child that needs it. In a faker-js recipe the confirmation also offers **Add as the parent, nest the tree under it**: the child's whole top-level block moves under the new parent's `friends:`, and every TODO lookup in it to that parent is wired. A friend's count is records per parent record. A parent with no template, such as a custom object, draws it disabled and says why.
- **Use existing &lt;parent&gt; from org…**, beside it: pick any connected org, then **Search &lt;parent&gt;** or **Enter a record Id**, which is checked in that org. The Id is written as the lookup's value and the row shows `org record · <org>`; the insert checks the Id exists in the org it inserts into. **Clear**, under the pencil, puts the TODO back.
- **+** beside an object that looks up to itself: adds a child record under it.
- **Remove TODO** (in the **Troubleshooting** tab's **TODO's** list): takes a TODO comment out of the recipe and lists it under **Removed**, where **Restore** puts it back exactly. The line is kept in a `.removedTodos.json` file beside the recipe. A TODO that is a field's whole value, such as a lookup's, stays.
- **Edit** (the pencil on a field): opens the field's faker expression to change its arguments or call another faker method, or to replace it with one fixed value for every record. It is written into the recipe so Run Faker by Recipe uses it too. The lines it replaced are kept in a `.fixedValues.json` file beside the recipe, and **Clear** puts them back exactly.

Others write other files: **Remember this selection** saves record types to `treecipe.config.json`, and on a card's **Troubleshooting** tab, **Generate permission set** (under **Permissions**) writes a permission set into your project. **Retrieve validation rules**, **Retrieve fields**, **Retrieve record types** and **Retrieve global value sets**, each under its own area, copy that part of an org you pick into your project, and change nothing in the org.

The **Troubleshooting** tab also deploys to a sandbox or scratch org, never production: **Deploy permission set** (**Permissions**), **Deploy fields** (**Fields**: custom fields and the custom objects that hold them, with an optional box for every tree object's validation rules, record types and global value sets), **Deploy record types** (**Record Types**) and **Deploy global value sets** (**Global Value Sets**) each send just those parts of your project, after a confirmation that lists them.

Each of these asks first, in a box over the cockpit. Scroll it to read everything it will do; **Cancel** or Escape does nothing.

The **Query** tab writes no recipe either. It lists the SOQL Generate Treecipe wrote for the tree (the same queries as the tree folder's `soql-sosl-templates--….md`). Edit a query, **Run…** it against any connected org you pick in the command palette (a query only reads), and **Export JSON** or **Export CSV** what came back, under `treecipe/QueryResults/<tree folder>/`, which git ignores. A run reads at most 50,000 records or 1,000,000 values, and the tab previews the first 50 rows and 50 columns.

The **Treecipe Updater** tab, after **Query**, draws the tree's objects and fields as the Treecipe tab does, each object once. Tick the fields you want to fill on records an org already holds, and its search narrows the rows by field name, label, type or faker expression. A lookup, `RecordTypeId`, a dependent picklist, an auto number or roll-up summary field (Salesforce sets those) and a field read only from the recipe file cannot be chosen, and each says why. The cockpit remembers the fields you ticked.

**Load records** reads the tree's existing records from the sandbox or scratch org chosen in **Target Org Management**; with none chosen it asks for one in the command palette, as the insert does. It reads every object of the tree: the record Id, the lookups to the tree's other objects and the fields you ticked, and under an object you can type a **WHERE** (such as `CreatedDate = LAST_N_DAYS:30`) to read only some of its records. Each object then shows how many records it has and its first 10 rows, or why the org would not read it. A load reads at most 50,000 records and 1,000,000 values in all; an object after that limit is not read and says so. A WHERE ending in `FOR UPDATE`, `FOR VIEW` or `FOR REFERENCE` is refused, since those change or lock records. It only reads.

**Generate values** makes a new value for every loaded record of each ticked field. By default a field's value comes from the faker expression its recipe holds (or the edit you made to it on the Treecipe tab), generated by the recipe's own backend (faker-js or snowfakery) from a temporary recipe outside your workspace. The ✎ beside a field changes that: start with `${{` to edit the expression, or type anything else to give every record that fixed value. The checks are the Treecipe tab's (a number, a date, a declared picklist value, no template in a fixed value). Your edit stays in the Updater; it is never written to the recipe. Values are made 2,000 records at a time, and the progress notification can cancel the run. Before anything runs, a confirmation lists every field with where its value comes from, an edited expression in full. Each object then shows its first 10 rows as Id, current value and new value. A field ticked after the last load needs **Load records** again, so its current value is read.

**Update N records in …** writes those values to the loaded records by Id. It writes only to the sandbox or scratch org the records were loaded from, and only once the cockpit has checked that the org lets you update every field. A confirmation lists each object's record count and fields, then you choose all-or-none as for an insert. Before anything is sent, the records' current values are saved to `treecipe/UpdateAttempts/<tree folder>/<timestamp>-before.json` (a folder git ignores), and nothing is sent if that save fails. Records go 200 per request, parents first, and the results are written beside the snapshot. Without all-or-none every request is sent and a record the org rejects is listed in the results. With it, the first request that fails stops the update, and the records already updated are set back to their old values. A picklist value is the field's own list, not its record type's, so a record whose record type does not allow the value is rejected by the org and listed there. Once anything was sent, the loaded records and values are spent: load again to see the new values. Restoring the old values from a snapshot is still to come ([#414](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/414)).

![A card's Treecipe tab with Wire TODO lookups at the top and Wire to… on Contact's AccountId lookup](images/recipe-cockpit/what-edits-the-yaml.png)

## Where your changes are stored

The settings that leave the YAML alone are kept by VS Code for this workspace on this machine, per tree.
They carry over when you regenerate the same objects, but they are not in your repository, so a teammate or a fresh clone starts without them.
Switching to another run while a tree on screen has settings asks first: Reset selections clears them, Apply same selections keeps them for the trees of that run with the same folder, and Cancel stays on the run.

When you generate, the cockpit applies them to a copy of the recipe.
The data set keeps that copy as `filteredRecipe-…` beside `originalRecipe-…` in its `BaseArtifactFiles` folder, and `datasetSource.json` lists what was changed.
**Reset selection** on a card clears its settings. An edit is in the recipe file, so Reset leaves it: clear it with the field's pencil.
Edits on the **Query** tab are kept the same way, per tree; **Reset** beside a query puts back the generated text.

![The help section open, listing which cards differ from their recipe files](images/recipe-cockpit/where-changes-are-stored.png)

## faker-js and snowfakery

faker-js recipes nest child objects under `friends:`, snowfakery recipes keep every object at the top.
snowfakery does not apply a validation rule's pattern (`REGEX`), so those fields have no rules box.
Everything else on this page works the same for both.
