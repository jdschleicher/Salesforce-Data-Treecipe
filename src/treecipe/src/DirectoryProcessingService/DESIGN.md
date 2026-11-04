# Directory processing — design notes

Design notes moved out of CLAUDE.md (#563). Read this before changing the service; CLAUDE.md keeps only the rules every change must follow. History is in CHANGELOG.md.

- **Generate Treecipe reports through a vscode-free port, and a cancel is not an error** (#216) — the command runs inside one cancellable `ProgressLocation.Notification` and hands `DirectoryProcessor` an `IRecipeGenerationProgress` (`report`, `isCancellationRequested`). `processDirectory` checks for a cancel before each directory it enters, and `processAllObjectsAndRelationships` checks again after the walk and after the trees are built. The command checks after the global value sets load and once more before writing, and never after that, so a run folder is written whole or not at all. A cancel throws `RecipeGenerationCancelledError`, which the command answers with an information message and NEVER routes to `ErrorHandlingService`. It still returns normally, which is what lets the Recipe Cockpit's Generate Treecipe button reload. "N of M" counts the top-level directories of the configured objects path, so the total is known before the walk descends. A walk run without a port behaves exactly as before

## Files

What CLAUDE.md's Project Structure said about these files before #563 trimmed it to one line each.

```
    │       └── mocks/                       # Sample Salesforce metadata XML fixtures; ValidationRuleSalesforceMetadataDirectory/ is Gadget__c with a rule per shape (applied, intersected, empty, not applied, inactive) and Widget__c with none; StandardFieldParentSalesforceMetadataDirectory/ is Account.ParentId (Hierarchy), Case's bare AccountId/ContactId/ParentId lookups and an unmapped User.ManagerId (#400)
```
