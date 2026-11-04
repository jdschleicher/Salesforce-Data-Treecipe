# Record types — design notes

Design notes moved out of CLAUDE.md (#563). Read this before changing the service; CLAUDE.md keeps only the rules every change must follow. History is in CHANGELOG.md.

## Files

What CLAUDE.md's Project Structure said about these files before #563 trimmed it to one line each.

```
    │   ├── RecordTypeSelection.ts           # The record types chosen per object (#193): untrusted-input parsing, which names an object uses and which are ignored, the blocks they are written as and their nicknames (#194), a record type's values for a field, a dependent picklist narrowed to one record type; imports only RecordTypeWrapper
```
