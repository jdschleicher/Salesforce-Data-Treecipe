# Recipe Cockpit guide

The Recipe Cockpit shows the recipes Generate Treecipe wrote as cards you can open, trim and generate from.
Click **?** at the top of the cockpit for the short version of this page.

A few words used below:

- **Run**: one Generate Treecipe output, a timestamped folder under `treecipe/GeneratedRecipes`.
- **Tree**: a group of related objects written to one recipe file, parents before children. Each card is one tree.
- **Recipe file**: the `.yml` file Run Faker reads to make fake records.

<!-- Kept in step with RECIPE_COCKPIT_HELP_SECTIONS in src/treecipe/src/RecipeCockpitService/RecipeCockpitService.ts by /cockpit-help-sync. The ## headings below must match the help's, in the same order: a test checks them. -->

## Where recipes come from

Generate Treecipe reads your object metadata and writes a run: a folder under `treecipe/GeneratedRecipes` holding the recipe files and a list of the objects it read.
The cockpit opens the newest run, or the one you pick in the run list at the top.
Under the run list, the **Org** section picks the org a card can insert into, opens it in your browser (**Open in browser**) or makes a new scratch org (**+ New scratch org**), which it creates and selects without deploying anything to it.
The **Treecipes** section below it holds the cards; click either heading to fold it away.

![The cockpit toolbar with the run list, Favorites only and the ? button, above the Org section and the Treecipes section's tree cards](images/recipe-cockpit/where-recipes-come-from.png)

## What the cockpit changes without editing the YAML

These settings change what is generated, but the recipe file stays exactly as Generate Treecipe wrote it, so it always shows what was generated from your metadata:

- **Excluded objects** (the chain link): the object and its children are left out.
- **Unticked fields**: the field is left out.
- **Record counts**: how many records an object gets.
- **Faker bounds** (✎): a narrower range, length or date window.
- **The rules box**: a field generated without the limits its validation rules set.

![A card with one object excluded, a field unticked and a count changed](images/recipe-cockpit/changes-without-editing-the-yaml.png)

## What does edit the YAML

These buttons rewrite the recipe file itself, because the change belongs in the recipe:

- **Wire to…** and **Wire TODO lookups**: fill a lookup's TODO with its parent's nickname.
- **Add &lt;parent&gt; to recipe**: adds a standard parent object, such as Account, above the child that needs it.
- **+** beside an object that looks up to itself: adds a child record under it.
- **Fixed values** (the pin): one value for every record, written into the recipe so Run Faker by Recipe uses it too. The lines it replaced are kept in a `.fixedValues.json` file beside the recipe, and **Clear** puts them back exactly.

Three more write other files: **Remember this selection** saves record types to `treecipe.config.json`, **Generate permission set** writes a permission set into your project, and **Retrieve validation rules** writes an org's validation rules into your project.

![A card's Treecipe tab with Wire TODO lookups at the top and Wire to… on Contact's AccountId lookup](images/recipe-cockpit/what-edits-the-yaml.png)

## Where your changes are stored

The settings that leave the YAML alone are kept by VS Code for this workspace on this machine, per tree.
They carry over when you regenerate the same objects, but they are not in your repository, so a teammate or a fresh clone starts without them.

When you generate, the cockpit applies them to a copy of the recipe.
The data set keeps that copy as `filteredRecipe-…` beside `originalRecipe-…` in its `BaseArtifactFiles` folder, and `datasetSource.json` lists what was changed.
**Reset selection** on a card clears its settings. A fixed value is in the recipe file, so Reset leaves it: clear it with its pin.

![The help section open, listing which cards differ from their recipe files](images/recipe-cockpit/where-changes-are-stored.png)

## faker-js and snowfakery

faker-js recipes nest child objects under `friends:`, snowfakery recipes keep every object at the top.
snowfakery does not apply a validation rule's pattern (`REGEX`), so those fields have no rules box.
Everything else on this page works the same for both.
