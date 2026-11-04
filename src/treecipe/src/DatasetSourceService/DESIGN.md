# Data set source records — design notes

Design notes moved out of CLAUDE.md (#563). Read this before changing the service; CLAUDE.md keeps only the rules every change must follow. History is in CHANGELOG.md.

- **A data set records its source by NAME, and the reader never trusts the names** — Run Faker by Recipe writes `BaseArtifactFiles/datasetSource.json` naming the recipe run folder, tree folder and recipe file, taken from the recipe's position under `GeneratedRecipes/` (`null` run and tree for a recipe directly under it). It is a file in the user's workspace, so `DatasetSourceService.readDatasetSource` type-checks every field (`unreadable` otherwise), refuses any name that is empty, carries a separator or is a `..` (or `.`) segment — `my..recipe.yml` and `team..v2` are names, not paths (#185) — and links only a name that matches a run and tree folder on disk (`unknown` otherwise). It never throws: a data set the reader cannot place is a status, not a failure of whatever lists it. A data set from before the file is linked only when its single recipe copy and single wrapper copy agree on a run that is still there — anything ambiguous is `unknown` rather than a guess. Its `origin` is `runFaker` or `createInOrg` (#180), and `orgUsername`, `createdObjectApiName` and `createdRecordIds` are present exactly when it is `createInOrg`. The data set folder takes the first free of `<name>`, `<name>-2`, … with `mkdirSync` as the existence check, and every reader of data set folder names must accept that suffix. The service imports only `fs` and `path`, so the cockpit and any non-vscode tooling can read it

## Files

What CLAUDE.md's Project Structure said about these files before #563 trimmed it to one line each.

```
    │   ├── DatasetSourceService.ts          # Writes and reads a data set's BaseArtifactFiles/datasetSource.json (recipe run, tree, file, faker service, record counts, and the objects a Recipe Cockpit generate excluded and the fields it unticked), infers it for older data sets, parses dataset folder names including the same-second -<n> suffix and the Treecipe Adapter's <name>-adapted-<yyyyMMdd-HHmmss> (#448), reads origin "adapt" and its adaptation, counts a legacy data set's records from its Collections API files; fs and path only
```
