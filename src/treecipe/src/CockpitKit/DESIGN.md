# Cockpit kit — design notes

Design notes moved out of CLAUDE.md (#563). Read this before changing the service; CLAUDE.md keeps only the rules every change must follow. History is in CHANGELOG.md.

- **A confirmation can offer record type set modes, and the answer names one** (#623) — a request carrying `recordTypeSetModes` (`{name, label}` each, with `recordTypeSetModeLegend`) draws a `radiogroup` between the body and the buttons, one `check`-kind button per mode with `role="radio"`, the first chosen, all in the Tab cycle. Modes that are not all a name and a label draw none. A chosen button answers `recordTypeSetMode: <name>`; Cancel names none. `CockpitConfirmDialog.readRecordTypeSetMode` gives the name back only when it is one the request offered, and the cockpit that asked reads any other answer as Cancel. Labels are the host's and written with `textContent`. Slice D of #620 offers a second mode through the same group.

## Files

What CLAUDE.md's Project Structure said about these files before #563 trimmed it to one line each.

```
    ├── CockpitKit/                          # What every cockpit shares (#524, epic #523): the --sdt-* palette, button kinds (createButton and its CSS, kept as the pieces the Recipe Cockpit's stylesheet interpolates where they were), org picker and pinned section CSS, the in-panel confirmation (CSS, markup, panel script, and the names and classes it needs from the cockpit beside it, each list derived and held by a test; buildConfirmationId/readAnswer); imports only crypto
```
