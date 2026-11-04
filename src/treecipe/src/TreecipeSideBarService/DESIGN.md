# Activity Bar Treecipe view — design notes

Design notes moved out of CLAUDE.md (#563). Read this before changing the service; CLAUDE.md keeps only the rules every change must follow. History is in CHANGELOG.md.

- **The Activity Bar's Treecipe view is a third DOOR to the commands, never a second code path** (#456) — `package.json` contributes a `treecipe` Activity Bar container (icon `images/treecipe-activity-bar.svg`, a one-colour 24×24 SVG in `currentColor` traced from the logo, because VS Code draws the icon as a mask and the logo PNG has no transparency) holding one view, `treecipe.commands`. `TreecipeSideBarService` lists `TREECIPE_SIDE_BAR_GROUPS` (Recipes, Picklist Dependencies: every contributed command but Initiate Configuration), and each row's `command` is the palette's command id with NO arguments, so every guard a command has applies to a click; a test fails on a row whose id `package.json` does not declare, whose title differs from the palette's, or that passes arguments. Its nodes are plain data and `getTreeItem` builds the `vscode.TreeItem`, so importing the service (as `ExtensionCommandService` does) needs no `TreeItem` in any suite's vscode mock. An EMPTY tree is what lets `viewsWelcome` draw: `workbenchState == empty` is a text-only note, and `!salesforce-data-treecipe.isTreecipeWorkspace` offers **Initiate Configuration**, whose handler calls `TreecipeSideBarService.refresh()` once the file is written. The context key comes from `isTreecipeConfigurationPresent`, which is READ ONLY: a stored `treecipeConfigurationPath` counts only under `getStaleTreecipeConfigurationPathReason`'s rule, else `treecipe/treecipe.config.json` must be a file, and it never calls `resolveTreecipeConfigurationFilePath`, which can rewrite the setting and warn. It also refreshes on a `**/treecipe/treecipe.config.json` create or delete (a `FileSystemWatcher`), and answers `false` rather than throwing, because it runs during `activate` before any command is registered. Drawing the view runs no command but `setContext` and writes no setting (a test holds both). Contributing a view also activates the extension when the view is opened, in any folder

## Files

What CLAUDE.md's Project Structure said about these files before #563 trimmed it to one line each.

```
    │   ├── TreecipeSideBarService.ts         # The Activity Bar's Treecipe view (#456): the command rows as data (TREECIPE_SIDE_BAR_GROUPS), the tree provider, the read-only config check behind the isTreecipeWorkspace context key, register/refresh
```
