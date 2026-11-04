# Data set insert attempts — design notes

Design notes moved out of CLAUDE.md (#563). Read this before changing the service; CLAUDE.md keeps only the rules every change must follow. History is in CHANGELOG.md.

## Files

What CLAUDE.md's Project Structure said about these files before #563 trimmed it to one line each.

```
    │   ├── DatasetInsertAttemptService.ts   # Each insert's InsertAttempts/insertAttempt-<ts>/insertAttemptSummary-<ts>.json (#469): outcome, rollback, all-or-none, counts, org; written wx beside the results file, read back as untrusted JSON (no link followed) into the data set row's status (succeeded/partial/failed/cancelled/unknown); fs and path only
```
