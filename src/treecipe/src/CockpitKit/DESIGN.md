# Cockpit kit — design notes

Design notes moved out of CLAUDE.md (#563). Read this before changing the service; CLAUDE.md keeps only the rules every change must follow. History is in CHANGELOG.md.

## Files

What CLAUDE.md's Project Structure said about these files before #563 trimmed it to one line each.

```
    ├── CockpitKit/                          # What every cockpit shares (#524, epic #523): the --sdt-* palette, button kinds (createButton and its CSS, kept as the pieces the Recipe Cockpit's stylesheet interpolates where they were), org picker and pinned section CSS, the in-panel confirmation (CSS, markup, panel script, and the names and classes it needs from the cockpit beside it, each list derived and held by a test; buildConfirmationId/readAnswer); imports only crypto
```
