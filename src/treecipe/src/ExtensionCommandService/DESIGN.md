# Extension commands — design notes

Design notes moved out of CLAUDE.md (#563). Read this before changing the service; CLAUDE.md keeps only the rules every change must follow. History is in CHANGELOG.md.

- **Insert Data Set by Directory refuses production on the connection it inserts with** (#204) — its picker still lists production (the CLI's local data cannot tell Developer Edition from production), so the deciding check is made after connecting: the command opens ONE connection by the picked username and sends `queryOrganizationType` on it before the AllOrNone question, the record-type query or any Collections API request. `SalesforceOrgService.isOrgTypeAllowedForDataSetInsert` (pure) allows `isSandbox === true` or `organizationType` exactly `DEVELOPER_EDITION_ORGANIZATION_TYPE`; an `undefined` answer, an empty type and any case or whitespace variant are refused. A refusal is a warning (`ExtensionCommandService.buildRefusedInsertOrgMessage`, alias, username and type label each through `escapeForNotification`) and writes nothing, not even `InsertAttempts/`. Both entries, the folder picker and the cockpit's pre-selected **Insert…** folder, pass the same check. This rule is deliberately looser than the cockpit's tree insert, which requires `IsSandbox: true`; do not merge the two without a decision

- **The golden test runs the commands, not the pipeline** (#571). `tests/GenerationCommands.golden.test.ts` calls `activate()` and runs `treecipe.generateTreecipe` and then `treecipe.runFakerByRecipe` through the handlers it registered. Only `vscode` is mocked:
  - `workspace.fs` reads the real disk;
  - settings are an in-memory store;
  - every notification is recorded, and an error notification fails the run;
  - the modal answers "Generate Data".

  Each run works in its own `fs.mkdtemp` workspace and deletes it, so the repository is never written. Output is made deterministic in three ways:
  - **The clock.** Only `Date` is faked, at a fixed instant, and timers stay real because generation awaits file writes. Its folder timestamp and ISO form become `{TIMESTAMP}`, and the workspace path becomes `{WORKSPACE}`.
  - **faker.** `faker.seed(571)` before each Run Faker. With `@faker-js/faker` 9.7 that alone makes the data stable, so values are compared exactly, not by shape.
  - **Directory order.** `readDirectory` lists each folder sorted. Today the order reaches the output: a reversed listing renumbers the relationship trees and reorders fields. So the expected files hold only for a sorted listing, and a real machine's order can still change a run.

  The comparison is byte for byte, line endings included; `.gitattributes` marks `tests/golden/` `-text` so a checkout never rewrites them. faker-js nests every child under `friends:` (#46), so its run is also the nested-`friends:` run. Snowfakery compares generation only, since generating data needs its CLI.

## Files

What CLAUDE.md's Project Structure said about these files before #563 trimmed it to one line each.

```
    │   ├── ExtensionCommandService.ts       # VS Code command handler implementations; Run Faker opens a recipe that fails to load at the line to fix, naming pre-3.29.1 bare record-type variants
```
