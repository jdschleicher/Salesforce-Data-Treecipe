# Validation rule analyzer — design notes

Design notes moved out of CLAUDE.md (#563). Read this before changing the service; CLAUDE.md keeps only the rules every change must follow. History is in CHANGELOG.md.

## Files

What CLAUDE.md's Project Structure said about these files before #563 trimmed it to one line each.

```
    │   ├── ValidationRuleAnalyzerService.ts # Reads an active *.validationRule-meta.xml into one single-field constraint (#324, from #41): REGEX, numeric/LEN/date bounds, ISPICKVAL, ISBLANK; numbers and dates parsed, field references held to SalesforceApiName, a regex translated into generatable atoms or refused; vscode-free
```
