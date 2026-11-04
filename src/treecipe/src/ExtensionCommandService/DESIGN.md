# Extension commands — design notes

Design notes moved out of CLAUDE.md (#563). Read this before changing the service; CLAUDE.md keeps only the rules every change must follow. History is in CHANGELOG.md.

- **Insert Data Set by Directory refuses production on the connection it inserts with** (#204) — its picker still lists production (the CLI's local data cannot tell Developer Edition from production), so the deciding check is made after connecting: the command opens ONE connection by the picked username and sends `queryOrganizationType` on it before the AllOrNone question, the record-type query or any Collections API request. `SalesforceOrgService.isOrgTypeAllowedForDataSetInsert` (pure) allows `isSandbox === true` or `organizationType` exactly `DEVELOPER_EDITION_ORGANIZATION_TYPE`; an `undefined` answer, an empty type and any case or whitespace variant are refused. A refusal is a warning (`ExtensionCommandService.buildRefusedInsertOrgMessage`, alias, username and type label each through `escapeForNotification`) and writes nothing, not even `InsertAttempts/`. Both entries, the folder picker and the cockpit's pre-selected **Insert…** folder, pass the same check. This rule is deliberately looser than the cockpit's tree insert, which requires `IsSandbox: true`; do not merge the two without a decision

## Files

What CLAUDE.md's Project Structure said about these files before #563 trimmed it to one line each.

```
    │   ├── ExtensionCommandService.ts       # VS Code command handler implementations; Run Faker opens a recipe that fails to load at the line to fix, naming pre-3.29.1 bare record-type variants
```
