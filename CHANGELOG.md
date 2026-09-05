# Change Log

## [3.13.0] - The spec manifest carries the information content of the specs, not their cross product

Resolves [#102](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/102).

Reading and parsing `treecipe/PicklistDependencySpecs/manifest.json` was the single largest cost of opening the Picklist Dependency Explorer -- measured during 3.11.0 at roughly **59%** of the open, and named there as tracked rather than fixed.

The size was structural. Every expectation recorded its own `forbiddenValues`, so the file grew with *combinations x declared values* when the information content of those two lists is their **sum**. The view model had already had this exact treatment -- `IPicklistDependencyCombinationViewModel.hasForbiddenAssertion` carries no values for the same reason -- and the manifest had not.

### The complement is derived, not stored

A field entry now records `declaredValues` **once**, and an expectation whose forbidden set is the complement of its `dependentValues` within that universe records one boolean instead of the values:

```jsonc
{
    "controllingValue": "cle",
    "dependentValues": ["ohiocity"],
    "forbiddenValuesAreDeclaredComplement": true
}
```

`buildSpecDetailsByManifest` reconstructs the array on read, so **every consumer is unchanged** -- the Explorer's rows, and `PicklistDependencyMetadataWriterService`, whose whole transpose turns on that list because `expectNotAllowed` is what *removes* a pair. A reconstruction that quietly returned an empty list would leave writeback adding but never removing, so that is asserted directly rather than assumed.

Measured on a synthetic org of 150 objects x 8 dependent picklists x 40 controlling values x 120 declared values, serialized and parsed through the real builder (median of three runs; in-memory, so no disk read is included):

| | before | after |
|---|---|---|
| `manifest.json` | **315.7 MB** | **32.2 MB** |
| `JSON.parse` | ~1,400 ms | **~59 ms** |
| validate + normalize | ~119 ms | ~33 ms |
| `buildSpecDetailsByManifest` | ~41 ms | ~145 ms |
| **read → spec details** | **~1,560 ms** | **~237 ms** |

The reconstruction is the one thing that got *slower*, by ~104 ms, and it is named rather than buried: deriving 48,000 complements is work the old shape did not do. It buys back 13x that on the parse.

The issue's baseline of 153 MB / ~1.37 s came from the same shape with shorter api names; the parse times agree, and the ratios above are within one fixture on one machine, which is the only comparison worth quoting.

### Ordering the universe once per field, not once per complement

The generator emits its complement sorted, so a reconstruction that only filtered would return the right values in the wrong order -- identical to a set comparison, and not identical to the round trip the manifest is now held to. Sorting *inside* the complement measured **594 ms** against **59 ms** for the filter alone, which would have handed back most of what the parse saved. The universe is ordered once per field instead, and `buildDeclaredComplement` takes it already ordered.

### Three forbidden states, still three

- **the marker** -- the complement, which is what the generator always emits
- **a written-out `forbiddenValues` array** -- a set that is *not* the complement. `expectNone` and `expectUnavailable` both assert an **empty** one against a universe that is not empty, and the panel renders those two differently from each other
- **neither** -- a spec asserting only the positive half, which the panel must not draw a complement for at all

Deriving the marker is a *comparison*, not an assumption: `buildManifestExpectations` builds the complement and checks it against what the expectation actually declares, recording the values literally when they differ. That is what makes the round trip a property of the manifest rather than a coincidence of what the two generators happen to emit -- an Apex-parsed spec naming a partial `expectNotAllowed` list is entitled to forbid something that is not the complement, and rewriting it into one would assert something the spec never claimed.

The universe recorded is the one each spec was **drawn against**: for a record-type-scoped field that is what the record type assigns, not everything the field declares, which is why it is recorded per field *entry* rather than per field api name. It also has to be **complete** -- a truncated universe would have every consumer deriving a complement understate what the spec forbids, which is a false claim rather than a shorter one.

### `manifestVersion` is now 3

A version 2 manifest is structurally readable -- objects, fields and expectations in shapes this build walks -- which is exactly why it is refused by version rather than by shape. It carries no `declaredValues`, so every complement drawn against it would be empty and the panel would show specs that forbid nothing at all. It is refused with the existing "re-run Generate Picklist Dependency Tests" message.

### Tests

Every new guard was verified by reintroducing the defect -- dropping the reconstruction fails seven tests across all three services, including the existing round trip, the Explorer's row parity and the writeback's proposed metadata. The shape itself is pinned at small scale in `PicklistDependencyManifestService/tests`: a field whose controlling values each unlock exactly one of twelve values writes each value **twice**, where the old shape wrote it thirteen times.


## [3.12.0] - Initiate Configuration: a picker that opens immediately, seeded from sfdx-project.json

Resolves [#100](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/100).

**Initiate Configuration File** built its entire directory list before it showed anything. `promptForObjectsPath` walked every non-hidden, non-`node_modules` directory in the workspace -- one `readdir` per directory, recursively -- and only then called `showQuickPick`. On a real repository that is thousands of stat calls with an empty screen in front of them.

It is worse from the warning notification. VS Code dismisses a notification the instant one of its buttons is clicked, and offers no way to keep it open, disable the button, or put a spinner in it. So clicking **Run Treecipe Initiation Setup** removed the last thing on screen that said anything was happening, and nothing replaced it until the walk finished.

### The picker opens first and fills as it scans

`promptForObjectsPath` now builds the quick pick up front, marks it `busy`, shows it, and streams directories in as the walk discovers them. The dead time is not narrated -- it is gone.

**The user's answer ends the command, not the scan.** Selecting a directory found in the first few milliseconds returns immediately; the walk is told to stop and unwinds on its own. This is the part that is easy to get wrong -- an earlier draft awaited the whole walk and only then read the selection, which put the original stall back one layer down and, worse, threw away an already-made selection if the user then hit Cancel. Both cases are now covered by tests that fail against that shape.

Item updates are **batched** (200 items or 100ms, whichever comes first). Assigning `.items` is an ext-host to renderer round trip that re-sends the entire list and re-runs the filter, so one assignment per directory is quadratic in payload on exactly the large workspaces this targets. The highlighted item is restored across each flush, because VS Code resets it to the top -- otherwise the scan would drag the user's cursor away from them while they were reading.

Alongside it, the scan runs under a **cancellable** progress notification. `ProgressLocation.Notification` rather than `Window` for the reason the picklist dependency commands already chose it: `Window` "supports neither cancellation nor discrete progress", so the token it hands you never fires. Cancelling before a selection stops the walk, closes the picker, and writes no configuration file.

### Options come from sfdx-project.json

Where a workspace has an `sfdx-project.json`, the scan is seeded from its `packageDirectories` instead of the workspace root, and the picker says so. To be clear about the size of this win: the walk already skipped `node_modules` and dotfolders, so most of the directory reduction predates this change -- seeding drops the remaining non-DX siblings and, more usefully, puts the directories a Salesforce developer actually wants at the top of the list.

> Select directory that contains the Salesforce objects - options from packageDirectories in sfdx-project.json

**Every** usable entry, not just the one marked `default` -- a multi-package repository can keep objects under several, and seeding from only the default would hide the rest. Entries are scanned in file order, so a team that lists `force-app` first means it. A `Browse all workspace directories...` item is always offered for the case where the answer is somewhere else.

### Every way the project file can disappoint you degrades to the old behavior

The commands that write Apex resolve a package directory through `resolveDefaultPackageDirectoryPath`, which **throws** on each of these, because they cannot proceed without one. Config initiation can, so it reads the same file through a tolerant resolver instead:

- No `sfdx-project.json` -- the user is not in a DX project, and still gets the full walk
- `packageDirectories` missing, empty, or with no usable `path` -- full walk
- A path that is absolute, escapes the workspace, or is not on disk -- skipped, and the remaining valid entries still seed the picker
- A project file that is present and **unparseable** -- full walk, plus a warning naming the file, because that one is a typo the user wants to know about rather than an absence

### Internals

`SfdxProjectService` is new, and deliberately a leaf: `fs` and `path`, no `vscode`, no other service. `VSCodeWorkspaceService` needed the containment logic that lived in `PicklistDependencyTestService`, and importing that service would have closed a cycle through `RecipeService` and `ErrorHandlingService`. `PicklistDependencyTestService` keeps its four helpers as delegations, `isPathContainedInWorkspace` injecting its own realpath resolver so it remains the one source of truth for how its paths resolve.

The value here is the cycle and the dependency weight of that one module graph, and **not** a startup saving: `extension.ts` imports `ExtensionCommandService`, which imports `@salesforce/core` at the top level, so that dependency is loaded on the first command regardless of what this service does.

Reading `sfdx-project.json` now requires a regular file rather than merely an existing path -- a repository can commit that name as a symlink to a character device, and reading one would hang the extension host on the first command a new user runs.

The walk also stopped calling `getWorkspaceRoot()` once per directory entry; it is resolved once and handed down the recursion.

## [3.11.0] - Picklist Dependency Explorer: the panel opens first and says what it is doing

Resolves [#97](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/97).

### Fixed first: the panel has rendered nothing since 3.8.0

The panel script is emitted from a template literal, so every backslash in it has to be doubled — `'\\n'` in the service source is what puts `'\n'` in the script. One site was written with a single backslash, which the template consumed, so the shipped script contained a string literal broken across a real newline:

```js
.join('
')
```

That is a `SyntaxError`. It kills the entire IIFE, so **every** version from 3.8.0 through 3.10.0 opened the Picklist Dependency Explorer to an empty panel — no structure, no banners, no toolbar. Nothing else in the extension was affected.

No test caught it because every test in this file asserts on the script as *text*, and text does not have to parse. Two guards now stand where it was: one compiles the emitted script with `new Function` (which needs no DOM and no new dependency, and answers the one question `toContain` cannot ask), and one anchors the exact site. Both were verified by reintroducing the defect and watching them fail.

Opening the Explorer on a large org looked like nothing happening. The panel was not created until a finished model existed, so every phase — reading the spec manifest, stat-walking the objects directory for staleness, building the view, serializing it — ran against a window showing nothing at all. On a synthetic org of 150 objects x 8 dependent picklists x 40 controlling values that was roughly two seconds of blank tab, with no way to tell which phase was slow or whether the command had failed.

### Fixed: relationship level calculation allocated a set per path

`RelationshipService.calculateLevelsRecursively` handed every child a **copy** of the visited set. The set holds the current path, so a copy per child means an object reachable by many paths is re-walked once per path — with a fresh allocation each time.

On a layered graph, the shape an org has when several objects share a child lookup:

| objects | recursive calls |
|---|---|
| 30 | 88,572 |
| 36 | 797,160 |
| 42 | **7,174,452** |

Each of those calls was allocating. That allocation rate is what exhausted CI's 4 GB heap, and on a deep enough org it would have done the same inside the extension while generating recipes.

The set is now added to on entry and removed on exit. A child sees exactly the same set it saw before — a sibling's subtree removes its own entries on the way out — so the cycle guard is unchanged and the per-child allocation is gone. **2.0-2.3x faster** on the graphs above.

Verified by differential run: the levels assigned across 600 random graphs, cyclic and acyclic, are **identical** to the previous implementation. That check earned its place — a first attempt also skipped re-walks that could not raise a level, which is the fix for the exponential *time*, and the differential caught it changing the levels of 1,531 objects, all in graphs containing a cycle. Those levels decide the insertion order of generated recipes, so that change needs its own issue rather than riding along with a memory fix. **The traversal is still exponential in depth.**

### CI: bounded jest workers, and a run that says where its memory went

A jest worker on CI was reaching the 4 GB V8 heap ceiling and dying, which failed the build with **zero failing tests** — the OOM and the reported `SIGTERM` are different processes, so the suite named in the log was collateral rather than the culprit. It was not specific to this change: `main` failed identically, and the same commit on another branch went both ways on consecutive runs.

Nothing in the run identified the real consumer, so the test scripts now ask:

- `--logHeapUsage` — every suite reports its heap, so the next failure names the consumer instead of its neighbour
- `--workerIdleMemoryLimit=512MB` — recycles a worker that grows past the limit, which bounds the accumulation this looks like (no suite exceeds 342 MB on its own, yet a worker reached 4 GB)
- `--maxWorkers=2` — lowers concurrent peak, and measured *faster* locally rather than slower

Applied to **both** `jest-test` and `jest-test-summary`, because CI runs the latter — flags on `jest-test` alone would have changed nothing about the failure.

This is a mitigation with a diagnostic attached, not a root cause: the failure does not reproduce locally even at CI's exact heap cap, where the suite passes with a 1 GB cap.

### The panel opens before the work, not after it

The webview shell is static — it carries no model — so it is created and shown the moment the command runs, in **0.01 ms**. What used to be a blank window is now a panel reporting the phase it is in:

- **Reading the generated spec manifest…**
- **Loading the most recent picklist dependency check results…**
- **Building the dependency view…**
- **Checking whether the generated specs still match your metadata…**

Each phase appears both in a status line at the top of the panel and in a status bar entry, so the load stays legible whether or not the panel has focus. The status bar entry is an explicit item rather than `ProgressLocation.Window`, which supports neither cancellation nor discrete progress; the generation command's progress notification is unchanged, because cancelling *its* walk is useful and this load has nothing to cancel.

### The staleness walk no longer blocks the first paint

`resolveManifestFreshness` stats every file under the objects directory to answer "could this have changed since generation". It produced a *caveat about* the structure rather than any part of it, so the structure is now painted first and the walk runs after, posting its answer into the banner when it lands.

Measured honestly, that walk is ~113 ms — about 5% of the open on local disk, not the largest phase (the manifest parse is, at ~59%). It is the phase most exposed to a slow filesystem, which is why it moved, but the earlier paint it buys on local disk is worth ~113 ms rather than seconds.

The load also now yields the extension host's event loop between phases. Without that, the whole open is one uninterrupted turn: VS Code batches webview posts and status bar writes and flushes them when the turn ends, so every phase line would arrive at once, after the work it describes had finished, and the panel would open having narrated nothing.

Until it lands the banner says so. Manifest freshness has a fourth state, `pendingCheck`, rendered as *"Generated specs — checking whether they still match your metadata…"*. It is deliberately neither "fresh" nor "stale": calling it fresh would assert agreement with metadata nothing had looked at yet, and calling it stale would send you to regenerate over a difference that may not exist.

### The model is posted, not embedded

The view model used to be serialized into a `<script type="application/json">` block inside the panel document — up to 18 MB of it for a large org. It now travels over `postMessage`, which changes three things:

- The document is independent of the model, which is what lets it be shown before one exists
- Revealing a hidden panel — the panel is deliberately not retained when hidden — is answered from the host's copy of the model, so the manifest is not re-read, the model is not rebuilt, and the objects directory is not re-walked. To be precise about what this does *not* buy: the old path did not re-run any of that on a reveal either, because VS Code retained the html it had been given. What changes is where the cost sits — a reveal now costs the host ~58 ms warm to re-serialize the model, in place of the webview re-parsing an 18 MB document
- **No metadata reaches the panel document at all.** Picklist values, api names and Apex failure messages are written into the DOM through `textContent`, so the escaping this service used to apply on the way into the html is gone rather than merely unused — there is no markup context left for a value to escape out of

### What did not move

The run results overlay stays *before* the first paint, and the measurement is why: loading `results.json` and attributing every failure to its combination costs **17 ms** of a two-second open, under 1%. Deferring it would also break something real — `applyModelLimits` keeps a failing combination over a passing one when the rendering ceiling has to drop rows, and it cannot do that against statuses that have not been applied yet. A row dropped for lack of a status is a row a failure then has nowhere to land on.

Two larger costs are named here rather than fixed: the manifest parse (~1.1 s of that open, because `manifest.json` records `forbiddenValues` per expectation and so grows with combinations x declared values) and the model build (~380 ms). Both are tracked separately.

## [3.10.0] - A dedicated Apex test suite for the generated picklist dependency tests

Resolves [#96](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/96).

**Generate Picklist Dependency Tests** wrote `SDTPLDSpecsTest.cls` and nothing that named it. The only way to run the generated assertions was to know the class name and hard-code it — in a CI pipeline, in `sf apex run test --tests`, or by finding it in Setup. This extension did exactly that too, invoking the class it happened to generate.

That makes the generated class name a public contract by accident. Rename it, split it per object, and every pipeline that referenced it breaks.

### The suite is the handle

Generation now also writes `<packageDir>/main/default/testSuites/SDTPicklistDependencyTests.testSuite-meta.xml`, an `ApexTestSuite` registering `SDTPLDSpecsTest`. It is the stable name a pipeline, Setup → **Apex Test Execution**, and this extension all address:

```
sf apex run test --suite-names SDTPicklistDependencyTests --target-org <alias>
```

The suite has one member today, and that is the point — its value is the stable handle, not the member count. Anything later added or split out is registered in the same suite, and nothing downstream changes.

### Regeneration merges, it does not reset

A test suite is a grouping a team curates. Someone may well add their own picklist-adjacent test class to it, so regeneration **unions** the generated member in and removes nothing:

- A member added by hand survives every regeneration
- Members are emitted sorted, so regenerating an unchanged project reproduces the file byte for byte and the suite stays out of source-control diffs
- A `.testSuite-meta.xml` that cannot be read as an `ApexTestSuite` is left **exactly** as it is, with a warning saying the generated tests are not registered in it — rather than being silently replaced by a file this command could understand

This is the same rule the metadata writeback follows: silence in the generated model is never an instruction to delete.

### The check runs the suite

**Run Picklist Dependency Check** now invokes `--suite-names` rather than `--tests`, so the extension and everyone else reach the tests by one route instead of two. The suite file is included in the deploy the command offers, because a deploy that sent the classes without it would succeed and then fail at the very next step.

The "is it deployed" check asks about **membership**, not existence, through one Tooling API query over `TestSuiteMembership`. A suite whose member class has been deleted still exists, and running it would report success having asserted nothing — the same vacuous-green failure the generated `specRegistryIsNotEmpty` guard exists to prevent one layer down.

### Refusing to run a suite the org does not have

A workspace generated before this release has every class and no suite. Left alone, the check would have found no suite in the org, offered a deploy, sent the classes **without** one, and then invoked `--suite-names` against an org that still had none — failing with the CLI's own unknown-suite error and nothing to say that regenerating is the fix. The deploy now requires the suite file up front and says exactly that instead.

### Reading a suite it did not write

The merge reads a file a hand edit or a cloned repository controls, so it is deliberately hard to fool:

- The "is this a suite" test is loose while the member reader is strict, so every occurrence of the element is **counted** and compared against what was read. A member written in a form the reader does not handle — an attribute, a self-closing tag, an unclosed element — makes the whole file unreadable and untouched, rather than parsing as absent and being dropped on write. Dropping a member is the one outcome the merge exists to prevent.
- Comments and CDATA are stripped before anything is counted or read, so a member deliberately **commented out** is not restored on the next regeneration.
- Entities are decoded on read to match the escaping on write. Without that a member stored as `A&amp;B` grew an entity on every run, which would have broken the byte-for-byte stability described above.
- A file that exists but cannot be **read at all** — a permissions failure, a lock held by another process — is now distinguished from "no file yet". Only `ENOENT` means there is no suite; anything else writes nothing and warns, because generating a fresh file over an unreadable one would drop every member it held.

### Containment that works on a directory that does not exist yet

`getRealDirectoryPath` could not resolve a directory that had not been created, and fell back to comparing the path lexically — which skips symlink resolution for the whole path, so a symlinked *ancestor* would satisfy the containment check that exists to catch exactly that. That was tolerable while every checked directory already existed; `testSuites` is guaranteed absent on a first run, which would have made the weak branch the normal one for it. It now resolves the nearest **existing** ancestor and re-appends the remaining segments. Every caller benefits, not just the new one.

The check command applies the same containment to `testSuites` that generation does, since it derives that path too in order to put the suite in the deploy.

### Also in this release

- The spec manifest records the suite name and file path, written by the run that generated the Apex rather than recomputed by a reader. `manifestVersion` is now **2**; a manifest written by 3.9.0 is refused with the existing "re-run the command" message rather than being read as if it named a suite.
- The change report no longer filters the suite out. It previously excluded every `-meta.xml`, which the suite file's own name ends with, so a run whose only change was the suite reported nothing. The filter now targets the `.cls-meta.xml` sidecar specifically.
- `writePlannedSpecsFiles` creates each planned file's own directory, since the planned set no longer lives in one place. It remembers which it has created, so a run emitting hundreds of classes does not repeat the same `mkdir` for the same directory inside a loop that cannot yield.
## [3.9.0] - Generate Picklist Dependency Tests: progress you can watch, warnings you get once

Resolves [#92](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/92).

**Generate Picklist Dependency Tests** was the only picklist dependency command that reported nothing while it ran. The check, the metadata writeback and both Explorer paths each wrapped their work in a progress scope; generation walked the entire objects directory, read every field's XML, resolved global value sets, planned every file and wrote the Apex — all with a frozen UI. On a large org's metadata it looked hung. Its warnings, meanwhile, arrived as up to four separate notifications *partway through the walk*, before you knew whether generation had even succeeded.

### Progress you can watch, and stop

The run now reports itself in a progress notification and the walk can be cancelled.

It started as a status bar spinner, and that turned out to be unimplementable as specified: `ProgressLocation.Window` "supports neither cancellation nor discrete progress" — it renders no cancel button, so the token behind it never fires, and no percentage bar either. Status bar and cancellation are mutually exclusive in the VS Code API. Cancellation won, which also puts this command in line with the check and the writeback rather than apart from them.

While walking, it reports a **growing** count of what it has found — `47 dependent picklist field(s) found so far, reading Account...`. Not a fraction: nothing at that point knows how many dependent picklists the tree holds, because establishing that is what the walk is doing. A denominator there would be a guess, and a guess that ran low would make the bar move backwards. Once collection finishes the total is real, and the write phase reports against it — `writing spec 12/47...`, advancing on unchanged files too, since on a re-run from unchanged metadata most classes are already correct and reporting only rewrites would leave the message stalled.

The run is in three parts — read, **ask**, write — and the change-plan confirmation sits between two progress scopes rather than inside one. A progress bar left spinning behind a modal asking whether to proceed is the thing being asked about.

**Cancellation is on the walk only, and that is deliberate.** The walk awaits the filesystem per directory, so its token genuinely flips and it stops between directories with nothing written; it is also the larger cost, and the one that grows with org size. The write phase is straight-line synchronous code — the host thread never yields, so a token could not flip part way through however often it were polled. A per-file check there would advertise responsiveness the runtime cannot deliver. Leaving the write uninterruptible is also what keeps the generated classes and the manifest a matched pair: a half-written set with no manifest describing it is a state nothing downstream can detect, because freshness is computed from the *objects* directory, which a write never touches. The honest design is not to create that state at all.

Declining the change-plan confirmation still reports what was skipped. That is the one path where the skips matter most — the user is deciding whether the generation is worth taking.

### One report at the end, grouped by what actually happened

The per-warning notifications are gone. Skips are now carried as identity rather than only as prose — every one records a typed `reason` — and the run closes with a single message that groups them, with **View Details** writing the full list to the output channel. Reading the warnings does not cost you the deploy offer; it is put again once the report is open.

The grouping keeps three outcomes apart, because they are not the same news:

- **Fields skipped** — no spec was generated (`invalid api name`, `no "valueSettings" markup`, `global value set not found`, and the record-type file failures)
- **Values dropped** — the field was specced, but values the global value set does not declare were left out of it
- **Record-type scopes skipped** — the record type assigns no values, so no combination is reachable through it; the field-level spec still covers the field

Rolling those into one "skipped" count would overstate what the run declined to do. The aggregate warning this replaces already took care to say so in prose; it is now structural, and the panel and the manifest group by the same table the summary does.

Where every candidate was skipped, the skips are folded into the *same* "no dependent picklists were found" message rather than arriving as a second toast — one run, one piece of news.

### Manifests written before this release still load

`manifest.json` now records each skipped field's reason. A manifest written by an earlier version carries none, and a hand-edited one can carry a string this build does not define. Both degrade to `unknown` rather than dropping the row: the warning text is still exactly what the run reported, and losing the entry would understate what generation left out — the one thing the skipped-field list exists to prevent.

### Notes

- No new command, and no change to `IRecipeFakerService` or `IFakerRecipeProcessor`. Neither faker backend is touched — this lives entirely on the Apex generation path
- The progress port handed to `PicklistDependencyTestService` is deliberately free of any `vscode` type, so what the walk reports and where it stops are unit-tested rather than asserted against a `withProgress` double
- A framework class that could not be scaffolded keeps its own warning rather than riding in the summary. It means the generated Apex will not compile at all, which is a different kind of news from a run report, and an information toast VS Code truncates is the wrong place for a blocker
## [3.8.0] - Picklist Dependency Explorer layout: less to scroll past, a contents to navigate by

Resolves [#93](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/93).

3.7.0 made the Explorer searchable. It was still a panel you had to scroll, because the longest thing on every row was the part fewest readers wanted and the record types sat flat beneath the fields with nothing separating them. This release is layout only — nothing about what the model carries, what the ceiling drops, or what any status means has changed.

### "must not unlock" collapses

A combination's forbidden set is the *complement* of what it unlocks, so it grows with the field's picklist while the unlock list stays short. A field declaring 40 values pushed the four values a controlling value actually unlocks off the screen under the 36 it forbids.

It is now a disclosure — `▸ must not unlock (14)` — collapsed by default, with two deliberate exceptions:

- **A failed row opens it.** A failed combination already opens its spec and run-report links for the same reason; `MISSING_VALUES` and `EXTRA_VALUES` are *about* the forbidden set, so putting it behind a click on a row already marked failed is a step with nothing on the other side of it.
- **A capped declared list still says so, uncollapsed.** Where `maxDeclaredValuesPerNode` capped a field's universe, the panel refuses to draw a complement against it and says why. That line is a claim about what the panel *cannot* show; behind a collapsed arrow an unexpanded row would read as "nothing forbidden here" — the exact false claim the branch exists to avoid.

The count in the summary is taken from the rendered list rather than computed a second way, so the label and the list cannot disagree. An empty complement renders no disclosure at all.

### A table of contents

Under the toolbar, collapsible, open on arrival:

- **Sections** — the banners and notices the panel actually rendered, each registered by the renderer that built it, past that renderer's own guard. A section the panel did not render cannot appear in its contents.
- **Objects** — every object with its counts, status and `not asserted` badge. Clicking one opens it, scrolls to it, and shows every one of its dependent picklists including the ones the active query was hiding: naming the object outranks the query *within* it.

Object entries hide and show with the filter, so the contents and the panel can never give two accounts of what is on screen. Every entry addresses a section the panel already built — the contents names nothing the panel is not showing, and opens no path of its own.

The **Jump to object** dropdown is retired. One thing it could do does not survive: that select listed every object unconditionally, so it could reach an object the filter had hidden, and a contents that lists only what the panel is showing has no entry to click for one. Widening the query is how you reach it now — the trade buys a contents that cannot disagree with the panel beside it.

### Record types are their own section

A field's record type scopes move under one collapsible `Record Types (4)` group instead of being appended flat beneath the field-level combinations. The separation is the point: a field-level combination is asserted by the generated check and a record-type-scoped one is not, and running them together as siblings made a reader work that out from the wording of a note.

The group header shows a **failed count** and **never a passed or unknown badge**. Apex describe returns picklist values without record type filtering, so nothing in the shipped framework verifies a scoped row — a green badge over the group would assert exactly what each scope's note exists to deny. A failed count is a different statement: it is about scopes a run *did* report against.

Where the rendering ceiling dropped scopes, the notice saying so sits **outside** the collapsible body, directly under the header. The header states the count of scopes the panel renders, which is not the field's record type count when some were dropped — a correction behind a click the reader has no reason to make is not a correction.

Scope bodies stay lazy. Opening the group reveals headings that already existed and builds no rows, so the record type axis still does not multiply the panel's element count. Two paths open the group when something inside it is the target: a pasted combination reference naming a scoped row, and a find-box query naming a record type — without them, the panel would filter down to the right field and then leave what was searched for behind a collapsed disclosure.

A group the *filter* opened, the filter closes again when its match lapses. The find box fires on every keystroke and matches on a bare substring, so a prefix of a query names record types the finished query does not — typing `Status__c` matches `Master` on its first letter — and opening without ever closing would leave exactly the wall of headings this group exists to collapse, held open by a query that no longer matches. The moment the reader touches a group themselves, though, the filter stops managing it in both directions: reopening one they just shut is the same kind of wrong as leaving one open that no longer matches.

### Unchanged

Filtering still only ever hides, and recomputes no status. `Expand all` still opens object sections only, bounded by the same 25-object limit — expanding every group and disclosure would reintroduce the volume this release removes. No model limit, manifest shape, or generated Apex changed.

## [3.7.0] - Picklist Dependency Explorer UX: find it, understand it, jump to it

Resolves [#83](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/83).

3.1.0 shipped the Explorer as one flat scroll of every dependent picklist in the org. It rendered the data correctly, and it was not usable at org scale: finding a field meant scrolling, a failed combination showed you the raw Apex failure kind without telling you what to do about it, and the whole model was built into the DOM up front. This release makes the panel somewhere you diagnose drift rather than somewhere you look once.

### Find a field without scrolling

A toolbar above the structure, sticky to the top of the panel:

- **Find object or field** — matches on object, field, controlling field, record type and generated method name. Searching for a field name reaches the object holding it, so you do not have to know which object that was. When exactly one object matches, it opens by itself
- **Status** — *any status* / *failed* / *passed* / *not checked*, so "what broke" is one selection rather than a scan
- **Jump to object** — every object by name; picking one opens and scrolls to it, even when the filter was hiding it
- **Expand all / Collapse all**, bounded: past 25 visible objects the panel says so and asks for a narrower filter rather than freezing

Filtering only ever hides. No status is recomputed and none is inferred from a row being hidden — an unverified combination stays unverified whether or not the filter is showing it.

Every combination also carries a **Copy reference** action. It copies the stable combination key the manifest recorded — `Object__c.Field__c [RecordType] @ Controlling Value` — and pasting that back into the find box reopens exactly that combination, in that object, under that record type. It survives a re-render in a way a scroll position does not, so it is something you can put in a review comment or a ticket.

### Opens and stays responsive at the pathological shape

PR #80 measured roughly 1.8M DOM elements at 100 objects × 3 dependent picklists × 5 record types, on top of an unbounded embedded payload. Both are now bounded:

- **An object's rows are built when you expand it**, not at load. Record type scopes already worked this way; the same rule now applies one level up, so opening the panel builds a heading per object and nothing else. Filtering runs against the model rather than the DOM, so it costs the same whether an object has been expanded or not
- **A measured ceiling on the model itself.** Per-axis caps shape the panel — at most 250 objects, 25 dependent picklists per object, 200 combinations per field, 25 record type scopes per field, 200 declared values per field — and one **total budget of 20,000 rendered combinations** across the whole model is what actually bounds its size. The caps alone do not: their product is millions of rows

The per-axis numbers were chosen; the total was **measured**, by serializing synthetic models through the real builder:

| Scenario | Objects | Combinations rendered | Embedded JSON |
|---|---|---|---|
| Healthy 100 × 3 × 50 (inside every cap) | 100 | 15,000 | 5.19 MB |
| Healthy 400 × 3 × 400 (over every cap) | 250 | 20,000 | **9.67 MB** |
| Every combination failing, 400 × 3 × 400 | 250 | 20,000 | **11.40 MB** |
| Every combination failing, 100 × 3 × 300 | 100 | 20,000 | 9.06 MB |

For reference, the unbounded payload this replaces reached about **17 MB** on a large org, and the same synthetic shapes measured **57 MB** and **144 MB** against an earlier draft of this ceiling that capped only the per-axis numbers.

Getting there took bounding three axes, not one. Combinations were the obvious one. Dependent picklists per object were unbounded. And `declaredValues` — the value universe a field's forbidden complement is drawn against — grows with the picklist rather than with how many combinations survive the budget, which made it the dominant term once the other two were capped.

Where that value universe is capped, the panel **stops drawing the "must not unlock" list** and says why: a complement of a partial universe understates what the spec forbids, which is a false claim rather than a shorter one.

The rule that decides what survives is fixed: **a combination, scope or object the check reported a failure for is never dropped in favour of a passing one**, and neither is an object carrying a skipped field. Where retained rows alone exceed a per-axis cap, they are all kept. Past the *total* budget even a reported failure can be dropped — an unbounded payload is worse for the reader than a bounded one — and that case is counted and named on its own, pointing at the run's `report.md` as the complete record. A dropped row is absent and counted, never re-labelled: the three-state guarantee holds under the ceiling exactly as it holds under a filter.

### A failure tells you what to do about it

Every failed combination now carries a **likely cause** and a **next step** in the words of someone who administers the org, alongside the Apex kind and message — never instead of them. All ten `SDTPicklistDependencyValidator` failure kinds are covered, and the two that no org state can cause say so explicitly:

- `MISSING_VALUES` → a value was unassigned from the dependent field, or the matrix was re-drawn; re-tick it in Setup, or re-generate to re-baseline
- `FORBIDDEN_VALUES_PRESENT` → the dependency was widened in the org, which is the direction that silently lets bad data in
- `CONTROLLING_FIELD_MISMATCH` → the dependency was re-pointed at another controlling field, which invalidates every combination for that field at once
- `CONTRADICTORY_EXPECTATION` and `CIRCULAR_DEPENDENCY` → a hand edit to generated Apex, not org drift. **Do not change the org**: nothing in it caused this
- `UPSTREAM_FAILURE` → this row was not evaluated at all; fix the named upstream spec first
- A kind this version has never seen is **not** explained away — the panel says it has no explanation and points at the raw Apex message

The prose is stored **once per failure kind** at the model root and looked up by kind in the panel, not copied onto every failure. Only an unrecognised kind carries its own text inline, because that text names the kind. Inlining it made the payload grow with how *broken* an org is rather than how large it is.

### Straight to the code and the run entry

A failed combination opens with its detail already showing, because it is the row you came for. Beside **Reveal in Explorer**:

- **Open spec method** — opens the generated `.cls` at the *declaration* of the spec method that asserts this row. A generated class names each method twice, at its declaration and inside `all()`; the declaration is the one you wanted
- **Open run report entry** — opens the run's `report.md` at that object's `### ` entry, which is the entry carrying the message

Each is offered only where the model names the code behind it, so a metadata preview offers neither — nothing asserts a preview row, and a link into a class that does not exist would contradict the banner above it.

### Webview posture unchanged

No external resource, no new runtime dependency, no local server. The content security policy is byte-for-byte what it was: `default-src 'none'` with the extension's own nonced inline style and script only, and every metadata-derived value still goes through `escapeHtml` or `escapeJsonForScriptBlock`.

Each new panel action is gated by **its own allow-list**, built from the model the panel was rendered from. The spec and report lists key on the file *and* the method together, so a message cannot pair a file the model named with a method name of its own choosing; **Copy reference** is matched against the combination keys the model actually declares.

An allow-list is only as trustworthy as the text it was built from, and `manifest.json` is a file on disk that a hand edit — or someone else's commit — controls. **Open spec method** is the first thing to turn a manifest-recorded path into a file the extension host actually reads, so `generatedClassFilePath` and `classesDirectoryPath` are now brought back inside the workspace before they can become openable targets, exactly as the objects directory already was. A path outside the workspace resolves to empty, which renders no button and contributes no allow-list entry — the same way a metadata preview already behaves.

## [3.6.0] - Update Picklist Dependency Metadata: writing spec intent back into source

Resolves [#81](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/81).

v3.4.0 made the generated Apex specs a durable statement of intent: edit a spec, the test goes red, fix the org, it goes green. But *"fix the org"* was entirely manual. You read a failure saying `Account.Region__c @ cle: missing [plant]` and hand-translated it into XML.

That translation is a **transpose**, which is what made it error-prone. The failure is indexed by **controlling** value; the metadata is indexed by **dependent** value — so making `cle` also unlock `plant` means editing the **`plant` block**, nowhere near where the failure message points you.

### The new command

**Update Picklist Dependency Metadata from Specs** (`treecipe.updatePicklistDependencyMetadata`) reads the generated Apex — including whatever you edited into it — and reconciles your source metadata to match. It runs opposite to Generate, and closes the loop the check opens.

| Command | Direction |
|---|---|
| Generate Picklist Dependency Tests | metadata → Apex specs |
| **Update Picklist Dependency Metadata from Specs** *(new)* | **Apex specs → metadata** |
| Run Picklist Dependency Check | Apex specs → org (assert) |

Nothing is written before you see it. The command reports every pair it would add or remove, in the words the failure used — `cle unlocks plant` — and declining leaves every file untouched. After writing, it offers to deploy the changed files to an org; declining that says explicitly that the changes are in your working tree and were not deployed.

### Intent is merged into your metadata, not substituted for it

A spec asserts what a controlling value **must** unlock (`expectAtLeast`) and what it **must not** (`expectNotAllowed`). Anything it names neither way — and any controlling value it never mentions — it makes no claim about, and writeback leaves alone. Reading those silences as deletions would let a one-line hand-written spec strip the rest of the file.

`expectNone` and `expectExactly` are the exception, and deliberately so: both state their dependent list *completely*, so anything else the metadata unlocks under that controlling value contradicts the spec and is removed.

### The controlling field is reconciled too

A dependent field's `valueSettings` can only name a controlling value the **controlling** field actually offers. When a spec asserts `madison unlocks willowick` and the controlling picklist declares no `madison`, the value is added to that field's own `valueSetDefinition` in the same run — otherwise the write would describe a combination no user could ever reach, and you would find out on deploy. Only values a spec asserts are *usable* count; a forbidden combination names nothing the controlling field has to start offering.

The controlling field is held to the same global-value-set rule as the dependent one, and when it is itself somebody's dependent field the added values fold into its existing plan rather than producing a second write of the same path.

### Three things it refuses to do

- **A global-value-set-backed field** can be rewired, but a new value is refused with a message naming the set to add it to first. The only place a new value could go is the shared `.globalValueSet-meta.xml`, whose blast radius reaches every other field pointing at it. That file is never edited.
- **An orphaning cascade** — removing a value that is itself the controlling field of another picklist — names the downstream field and skips that field's write. Every unaffected field still writes. Resolving it means editing the downstream field too, which is a decision about intent this command has no basis to make alone.
- **A spec class that cannot be parsed** aborts naming the file, and writes nothing at all. Treating an unparseable class as "this object has no dependencies" would silently skip the fields you edited.

### Your file's formatting survives

Only two spans of a field file are ever rewritten: the `valueSettings` region, and `valueSetDefinition` when a spec names a value the field cannot offer yet. The XML declaration, indentation, unrelated markup and trailing newline are preserved because they are never rebuilt.

Both `<valueSettings>` shapes are supported and preserved — grouped by `valueName` with repeated `controllingFieldValue`, and one pair per block. Rewriting a file into the other shape would make the first reconciliation a restructure of every block.

Order is normalized alphabetically on both axes on the first writeback, so a second writeback with no spec change produces **zero diff** — and after a writeback, running Generate produces byte-identical Apex. The two directions agree, and neither reports drift the other introduced.

A field file that is not pretty printed is handled rather than damaged: where a `<valueSettings>` block does not start its own line, the rewritten span stops at the tag instead of extending back over markup that has nothing to do with it. New picklist values are inserted ahead of the *real* `</valueSetDefinition>`, located against a comment-blanked copy so a commented-out close tag cannot put them in dead text.

### Correctness across a multi-object run

Field API names are not unique across objects — `Status__c` on Account and on Case are routine and different. Every path map and dependency-graph key is therefore keyed by **object and field**, so one object's dependency metadata can never be written into another object's file, and an orphaning cascade on `Account.Type__c` is not read as one on `Case.Sub_Type__c`. Reports name fields the same way.

The write sink checks containment itself: a field file resolving outside the configured objects directory — a symlink out of the tree included — is refused rather than written, independent of the API-name validation upstream.

Chain links survive the round trip. `.dependsOn(...)` names a spec *method*, and method names are deliberately lossy, so the link is derived from the parsed set — a field whose controlling field is itself specced in the same class — rather than reverse-engineered from the identifier. A field naming itself as its controlling field stays a root.


## [3.5.0] - The Spec Manifest: the Explorer and the generated Apex become one artifact

Resolves [#82](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/82).

The Explorer and the generated Apex were two independent derivations of the same thing. The panel re-walked your source XML every time it opened, while the Apex in your package directory had been generated at some earlier moment from whatever the metadata looked like *then*. Nothing guaranteed a row in the panel corresponded to a spec method that actually existed, and a failure was attributed by matching free text against combinations the panel had just re-derived rather than against the ones the spec declared.

This release makes them one artifact.

### Generation writes a manifest, from the same model, in the same run

**Generate Picklist Dependency Tests** now writes `treecipe/PicklistDependencySpecs/manifest.json` alongside the `.cls` files it emits, built from the same in-memory model — so the two cannot disagree by construction. It records, per object, the generated class name and file path and the test method name; per field, the spec method name, controlling field, upstream field and every expectation; plus `generatedAt`, the generator version, the objects directory scanned, and the skipped fields.

It goes under `treecipe/` rather than beside the `.cls` files on purpose: a stray `.json` inside a Salesforce package directory is not valid metadata, and would ride along into `sf project deploy` and fail the deploy of the very classes it describes.

### The Explorer renders the manifest, and never re-derives

Opening the panel now reads the manifest and does not walk the source metadata at all. What you see is what your tests assert:

- **Every node names the generated class and spec method that asserts it**, and every object names its test method
- **Every combination carries a stable key**, and failure attribution resolves against those keys. A failure naming a combination the manifest does not declare is still surfaced as unattributed — the three-state guarantee is unchanged, and an unverified combination is still never rendered as verified
- **A field the generator skipped now appears as its own row, marked *not asserted*, with the warning text**, instead of being absent. A field missing from both the Apex and the panel was indistinguishable from one with no dependency at all, which is the more dangerous of the two readings. An object whose every field was skipped is rendered too, rather than vanishing
- **A manifest recorded against a different objects directory, or against metadata that has since changed, renders with a staleness banner** naming the generate command — never a silent re-derivation. Staleness is a stat-only walk (path, mtime, size) rather than a re-parse, so it keeps the cost the manifest was introduced to avoid
- **No manifest** gives an empty state naming the generate command, plus an explicit **"Preview from metadata (not generated)"** action. The preview keeps 3.1.0's "no setup required" property, honestly: its banner says nothing asserts any row below it, and no row claims a spec method
- **A malformed manifest** reports the parse failure and offers the same preview, handled exactly as an unreadable `results.json` already was — never a blank panel

### The generated Apex reads at a glance

The point of emitting specs is that reading one beats clicking through the Salesforce dependency matrix UI, so the Apex is a deliverable here too:

- Each per-object class header lists the object's dependent picklists and the controlling field for each
- Each spec method is preceded by a comment stating its combinations in plain language — `"USA" unlocks East, West -- and must not unlock Baja`, `"Ontario" unlocks nothing`, `"Canada" is not available under record type US_Only`
- The comment and the assertions are built from one spec detail, so they cannot drift apart

A picklist value carrying a newline or a block comment terminator is neutralised before it reaches a comment. Neither is producible through the Salesforce UI, which is exactly why nothing else in the pipeline would have caught one.

Adding a value to a combination now shows as six changed lines rather than three — the three assertions and the three comments that describe them. The diff stays proportional to the change rather than to the file, and a comment that did *not* move when its assertion did would be the drift the comments exist to rule out.

### Also in this release

- Skipped fields are now carried as structured entries (object, field, record type) alongside the warning prose, so the panel can group them without scraping a free-text message
- The staleness fingerprint stops descending at a directory holding `fields`, exactly as the collection walk does — the sibling metadata directories under an object (`listViews`, `compactLayouts`, `webLinks`, and the rest) cannot contain a spec-contributing file, so skipping them removes roughly seven in ten of the directories visited while producing a byte-identical digest
- A field file reached through a **symlink** is now digested rather than dropped. A symlink reports itself, not its target, so one pointing at a `.field-meta.xml` was previously treated as a directory and silently left out — edits to it never moved the fingerprint, and the staleness banner never fired
- The manifest's `objectsDirectoryPath` is checked for workspace containment before any node path is built under it. It is the only string in the manifest that reaches the filesystem, and those paths become the allow-list the panel's reveal action trusts, so a manifest committed into a cloned repo cannot point that list outside the workspace
- Object and field api names in a manifest are held to the same gate the generator applies before emitting. An edited name outside that shape now costs its own entry instead of aborting the whole Explorer command
- The Explorer reads each object's test method name **from the manifest** rather than re-deriving it — re-deriving was itself a second derivation of the kind this release removes, and the two inputs diverge the moment an entry is dropped at the parse boundary
- The manifest's object set is the union of field-level and record-type-scoped specs, matching the set the Apex writer emits classes for, so an object producing only scoped specs cannot get a generated class with no manifest entry describing it
- A picklist naming **itself** as its controlling field no longer emits a self-recursive `dependsOn`. The Explorer already treated such a field as a root; the emitter now agrees
- Fixed an intermittent test failure where temp directory cleanup on some container filesystems returned `ENOTEMPTY` and failed a test whose assertions had all already passed

## [3.4.0] - Diff-Friendly Picklist Dependency Specs

Resolves [#78](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/78).

The generated Apex specs are meant to be committed and code-reviewed, but nothing about them was built for that. This release makes them deterministic, shows you what a regeneration would change before it changes it, and teaches the Apex framework to recognise the one edit that can never pass.

### Emission is deterministic, so a regeneration is a reviewable diff

Output ordering used to follow the filesystem and the order values happened to appear in the metadata, so identical metadata could regenerate to different bytes on different machines, and adding one picklist value produced a diff far larger than the change.

Three orders were erased:

- **Spec methods** are ordered by field api name, independent of `readDirectory` order. Sorting happens where the spec details are built, so the Apex, the generated test class and the Explorer all inherit one order rather than three that can drift.
- **Expectations** are ordered by controlling value, so a value moving between "unlocks something" and "unlocks nothing" no longer reorders the emitted block.
- **Every value list** — `expectAtLeast`, `expectNotAllowed`, `expectNone` — is sorted. Previously the forbidden list was the complement taken in declaration order, so inserting one value into the middle of a picklist shifted that value's position in **every forbidden list under every controlling value**.

Regenerating from unchanged metadata is now a byte-identical no-op, and a real metadata change arrives as a diff of only the lines that changed. Adding one value to one combination now touches three lines — the `expectAtLeast` that gains it and the two complements that gain it — instead of every list in the file.

Sorting uses code unit order rather than `localeCompare`, whose result depends on the host's ICU locale data and so would reintroduce the same portability problem in another form.

> **One-time reordering diff.** The first regeneration after upgrading reorders your existing generated classes. That diff is reviewable, which is the point — but review it on its own rather than mixed in with a metadata change.

### The command shows what it would do before it does it

**Generate Picklist Dependency Tests** now resolves the whole change against what is on disk before writing anything:

- A run that would **replace or delete** something prompts with a report naming what is new, what is overwritten, and which stale per-object classes would be deleted. A stale class is now **named rather than removed silently**.
- **Show Diff** opens VS Code's native diff editor between the file on disk and the content that would be written, then returns to the prompt. Cancelling writes nothing.
- A run that only **adds** files does not prompt — nothing is lost — and a run that would change nothing neither prompts nor writes. Files already carrying their proposed content are skipped rather than rewritten, so an unchanged regeneration no longer moves their mtimes.

This replaces the old blanket modal, which fired on the mere presence of generated files, could not say what was about to change, and warned that hand-tightened `expectExactly` lines "will be lost".

That warning no longer describes how these files work. The workflow the specs exist for — **declare the dependency you intend, watch the test go red, fix the org metadata until it goes green** — now survives regeneration: git is the merge base, your edit shows up as a working-tree diff, and you keep or revert it per hunk. The generated class header says so.

### A spec that contradicts itself is reported as a broken spec, not as org drift

`expectNotAllowed` is emitted as the complement of `expectAtLeast`, so adding a value to the positive list without removing it from the forbidden one makes the spec **unsatisfiable** — no org edit can make it pass. That is exactly the trap a hand edit falls into, and it used to report forever as a paired `MISSING_VALUES` and `FORBIDDEN_VALUES_PRESENT`, which reads as two org problems rather than one broken expectation.

`SDTPicklistDependencyValidator` now raises `CONTRADICTORY_EXPECTATION`, naming the object, field, controlling value and the overlapping values. It runs **before** `source.fetch()`, so it costs no describe — which matters most on the run where it fires, since the whole class is validated in one transaction against the CPU limit. `expectExactly` is checked alongside `expectAtLeast`, being the other mode that carries required values and producing the same unsatisfiable pairing.

### Recipe generation is unchanged

No faker service was touched. `IRecipeFakerService`, `IFakerRecipeProcessor` and both backends' dependent-picklist recipe output are exactly as they were.

## [3.3.1] - Global Value Sets Actually Load

Resolves [#85](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/85).

### Generate Treecipe now produces real values for global-value-set-backed picklists

`GlobalValueSetSingleton.initialize` took a leading boolean that gated whether it did any work at all, returning immediately when `false`. **Generate Treecipe** passed `false`, so the sets were never loaded and every picklist backed by one fell through recipe generation with no values:

```yaml
# before
Territory__c: '### TODO: This picklist field needs manually updated with either a standard value set list or global value set'

# after
Territory__c: ${{ faker.helpers.arrayElement([`Territory_North`,`Territory_South`]) }}
```

If your project uses global value sets, regenerating will replace those TODO placeholders with real generated values.

**Generate Treecipe no longer warns when a project has no `globalValueSets` directory.** That notice never actually appeared before — the call returned at its guard before reaching the check — and it would now fire on every run for the majority of projects, which have no global value sets at all. A field that genuinely needs a set still generates a TODO naming that field exactly, which is more useful than a directory-level toast.

### Security: picklist values are now escaped before being embedded in faker expressions

A picklist option is untrusted text — it comes from field metadata, or a global value set, in whatever repository the user opened — and both backends embedded it into an executable expression with no escaping, contrary to the rule stated in `CLAUDE.md`.

- **faker-js**: options are embedded in a JavaScript template literal that the recipe processor passes to `new Function()`. A value containing a backtick closed the literal, and the rest of the value was executed as code rather than read as data. A `${...}` interpolation did the same without needing a backtick.
- **Snowfakery**: options are embedded in a single-quoted Jinja2 string literal evaluated by the `snowfakery` CLI. A value containing an apostrophe closed the literal the same way.

Both backends now escape every option at every embedding site — backslash first, then the delimiter each language uses, then newlines, which also prevents a value from breaking the generated recipe's YAML structure. The two escapers are deliberately **separate**, because the backends embed into different languages and one escaper covering both would under-escape each.

Values without special characters generate byte-identical output; only a value containing a backtick, apostrophe, backslash, `${`, or newline changes — and only to be emitted correctly as data.

This flaw predates this release and was reachable through ordinary picklist values, not only global value sets. It was found by the security review on the PR that made global value sets reach recipe generation for the first time.

### The flag is gone rather than fixed

The parameter is removed, not renamed. It guarded a case that never existed — nothing initializes these sets at extension startup, so there was never an "already initialized" run to skip — while its name, `isGlobalValuesInitializedOnExtensionStartUp`, described a **state** where the guard read it as a **command**.

Three of its four callers reasoned from the name and passed the value that silently disabled the call: recipe generation, and both picklist dependency paths (fixed in 3.3.0). The demo harness was a fourth. A parameter no caller wants, and most callers get backwards, is not worth keeping — so it cannot be passed wrongly again.

The call is also `await`ed now. Recipe generation started its objects walk without waiting, so even a corrected flag left a race that could empty the same picklists.

### Coverage for the command that had none

`generateRecipeFromConfigurationDetail` had no tests at all, which is why the defect survived being found and fixed on three sibling call sites. It now has two, both asserting what the command **achieves** rather than which arguments it passed: that the sets are loaded, and that loading finishes before the walk begins. The second fails if the `await` is removed.

## [3.3.0] - Deep Dependency Chains and Global-Value-Set-Backed Dependent Picklists

Resolves [#76](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/76). Part of epic [#62](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/62).

### A dependent picklist backed by a global value set now gets a correct spec

A dependent picklist can take its values from a **global value set**. Its field file carries the whole dependency configuration — `<controllingField>` and `<valueSettings>` — while the values themselves live in `globalValueSets/` beside the objects directory.

Generation read only the field file, so the declared-value universe was just the values carrying a `valueSettings` entry. Every `expectNotAllowed` complement was therefore taken against a partial universe, and a global value set value that **no** controlling value unlocks — the value that belongs in *every* complement — went unasserted entirely.

**Generate Picklist Dependency Tests** and the **Picklist Dependency Explorer** now read the global value sets beside the objects directory, the same way recipe generation does, and take the complement against what the set actually declares.

- A field references its set by **full name** (the file name), while the only name inside the set file is `<masterLabel>` — an admin-editable display label. Global value sets are now registered under **both** names, collapsing to one entry wherever they agree, so a set whose label was renamed is still reachable from the field pointing at it
- A field naming a global value set that is **not in the project** is skipped with an explicit warning naming the set and the `globalValueSets` directory, rather than being specced against an empty universe
- A `valueSettings` entry naming a value the set does **not** declare — usually a value removed from the set without cleaning up the field — is dropped from the spec and reported. No org exposes that value, so asserting it would generate a spec that must fail for a reason the spec cannot fix. A controlling value left unlocking nothing becomes `expectNone`, which is what the metadata now says about it
- **Inactive** global value set values are excluded from the universe. An inactive value cannot be selected in any org, so leaving it in turned a controlling value that unlocks nothing into an `expectNone` line the org's describe can never satisfy — a generated spec that must fail against correct metadata
- Reading the sets never takes the calling command down with it. A `globalValueSets` directory that cannot be listed, or one malformed set file, costs that set rather than every other object's specs
- Recipe YAML output is unchanged: recipe generation reads the same `valueSettings`-derived map it always did

### The demo harness now exercises the global value set path it always claimed to

`scripts/picklist-dependency-demo` writes a `Planets` global value set and a tier 3 `Planet__c` field backed by it, and its first drift phase rewires a value on exactly that field. The headless driver never initialized the global value set singleton, so `Planet__c` was skipped as "set not found" on every run: it never got a spec, the drift phase asserted against a spec that did not exist, and `-Step FullRun` stopped there. The driver now initializes the sets the same way the command does, so the global-value-set drift path is genuinely proven rather than silently absent.

### Dependency chains deeper than two links are covered

The generator has always been depth-agnostic, but every test stopped at two links, so nothing proved the one link a deeper chain has that a shallower one does not: a spec that **has** an upstream and **is** one.

The `Chain_Example__c` fixture now runs `Country__c → State__c → City__c → District__c` — four fields, three dependency links — and the Apex framework tests cover the three-link chain end to end:

- A healthy three-link chain validates every link with zero failures
- A break at the chain **root** yields one failure at its source plus exactly one `UPSTREAM_FAILURE` per downstream link, each naming its **immediate** upstream rather than the root — the chain is fixed one link at a time. The memoized result carries through, so the failing root is described once no matter how many links hang off it
- A break in the **middle** leaves the root green, reports the middle failure at its source, and defers only the leaf

`dependsOn` is emitted only where the controlling field is itself dependent, so a chain of three dependency links emits **two** `dependsOn` calls — the root of the `dependsOn` graph has nothing above it.

## [3.2.0] - Record-Type-Scoped Picklist Dependency Specs

Resolves [#77](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/77). Part of epic [#62](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/62).

### Generated specs now capture what each record type actually exposes

The generated specs asserted the field-level dependency map — the "bones" from `valueSettings`. Record types sit on top of those bones: each assigns its own subset of picklist values to the controlling and dependent fields, so the combinations reachable *through a record type* are narrower than the field-level map. Nothing captured them, so a value unassigned from a record type left every generated test passing.

Where an object has a `recordTypes/` directory, **Generate Picklist Dependency Tests** now emits the field-level spec unchanged, plus one narrowed spec per record type:

```apex
public static SDTPicklistDependencySpec specFor_Dependency_Example_c_Neighborhood_c_recordType_Cleveland_Only() {
    return SDTPicklistDependencySpec.forRecordType('Dependency_Example__c', 'Neighborhood__c', 'Cleveland_Only')
            .controlledBy('City__c')
            .expectAtLeast('cle', new List<String>{ 'ohiocity', 'tremont' })
            .expectNotAllowed('cle', new List<String>{ 'willowick' })
            .expectUnavailable('eastlake');
}
```

- Controlling values are the field's, intersected with what the record type assigns to the controlling field; each value's unlocked values are intersected with what it assigns to the dependent field
- A controlling value the record type **does** assign but whose unlocked values it assigns none of becomes `expectNone`; one it does **not** assign becomes `expectUnavailable`. The two are different assertions — `expectNone` requires the value to exist, so using it for an unassigned value would fail against exactly the metadata that is correct
- The forbidden complement is taken against **the record type's** assigned values rather than everything the field declares — a value the record type does not expose is already unreachable through it
- A chained spec links to the upstream spec for the *same* record type, and the link is dropped when the record type assigns nothing to the upstream field, rather than naming a method that was never emitted
- Scoped specs are collected by `recordTypeSpecs()` per object and `SDTPLDSpecs.allRecordTypeScoped()` on the aggregator
- An object with **no** `recordTypes/` directory generates byte-identical output to 3.0.0

### A field a record type never mentions is treated as unassigned, not as fully assigned

The one genuinely ambiguous case in the metadata. Treating absence as "every value assigned" would assert a contract the metadata never stated, so the combination is skipped, a warning names the record type and the field, and the field-level spec still covers that field. This matches what recipe generation already does with the same markup.

### The Apex framework understands record type scope

- `SDTPicklistDependencySpec.forRecordType(object, field, recordTypeDeveloperName)` alongside `forField`, with `isRecordTypeScoped()` and a `label()` that carries the record type — the validator's dedupe and memoisation key, so a field's field-level spec never collapses onto its scoped ones
- `expectUnavailable(controllingValue)` (`MatchMode.UNAVAILABLE`), the record-type equivalent of `expectNone`: it asserts the controlling value is not reachable at all, and fails with the new `UNEXPECTED_CONTROLLING_VALUE` kind — naming the values it wrongly unlocks — if a record type later gains it
- Malformed record type markup is skipped with a warning rather than aborting generation: a `<picklistValues>` block missing its `<picklist>` child, nested markup where the developer name should be, and `<values>` entries with no `<fullName>` are all well-formed XML that previously threw part-way through the walk — one of them mid-write, leaving a half-regenerated class set on disk
- `SDTPicklistDependencyValidator.Failure` carries `recordTypeDeveloperName` and renders it in the scope: `MISSING_VALUES — Account.Region__c [US_Only] @ United States: ...`
- Record type developer names pass the same api name gate as object and field names before being embedded in Apex; an invalid one is skipped with a warning rather than emitted

### The Explorer shows them too

The Picklist Dependency Explorer (3.1.0) renders the field-level structure; record type scoping was invisible there, which would have left the panel quietly disagreeing with the Apex it sits beside.

- Each record type's narrowed combinations are nested under the field they narrow, collapsed until opened, with the scope's own values as the universe its "must not unlock" list complements against — a value the record type does not expose is already unreachable through it
- A controlling value the record type does not assign renders as **not available under this record type** rather than as unlocking nothing: a different claim, and the one `expectUnavailable` actually makes
- Scoped rows are counted apart from field-level ones in the header, and stay "not checked" even after a passing run — the check validates `SDTPLDSpecs.all()`, which holds the field-level specs only, so calling them passed would report a scope nothing verified as green. Every scope says so beside its own rows
- The Explorer's failure parser now understands the `[RecordType]` segment `SDTPicklistDependencyValidator` emits, so a scoped failure attributes to its record type instead of landing on the field-level row for the same controlling value — and a failure naming a record type the metadata no longer declares is reported with its scope rather than silently dropped

### Known limitation: the scoped specs are captured, not yet verified against an org

Apex `Schema` describe returns picklist values with **no** record type filtering, and the UI API that does is a REST callout that cannot run inside `@IsTest`. Rather than answer a scoped spec with field-level data — which would report a scope that was never checked as green — `SDTSchemaPicklistDependencySource` rejects one outright with a message saying why.

So `SDTPLDSpecsTest` continues to assert `SDTPLDSpecs.all()` only, the scoped specs sit in `allRecordTypeScoped()` ready for an `ISDTPicklistDependencySource` that can read record-type-filtered values, and the generation summary says as much rather than leaving you to infer it. **Run Picklist Dependency Check** is unchanged: it reports what the Apex tests report.
## [3.1.0] - Picklist Dependency Explorer

Resolves [#73](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/73). Part of epic [#62](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/62).

### New command: **Salesforce Treecipe: Open Picklist Dependency Explorer**

The dependency data this extension already extracts had only ever been emitted as Apex and as `treecipe/PicklistDependencyResults/check-*/{results.json,report.md}`. There was nothing to *look* at — working out which controlling value unlocks what, or which combination just broke, meant reading generated Apex or a markdown dump.

`treecipe.openPicklistDependencyExplorer` opens a read-only panel showing object → controlling field → controlling value → allowed values, with the values a combination must **not** unlock rendered alongside them, and the most recent check overlaid as pass/fail per combination.

- **Chains are a graph, not repeated rows.** A field whose controlling field is itself a dependent picklist is nested under it, drawn once, however deep the chain runs
- **A failing combination names the failure kind and message** — `MISSING_VALUES`, `FORBIDDEN_VALUES_PRESENT`, `CONTROLLING_FIELD_MISMATCH` and the rest, read out of the run's Apex assertion message
- **Clicking a combination reveals the generating field's source XML path**, with a "Reveal in Explorer" action that opens the `.field-meta.xml`
- Nothing new is required to use it: no org, no Salesforce CLI, and no previous check run. Only `treecipe.config.json` pointing at your objects directory

### It is a webview, deliberately

No local HTTP server, no open port, no new runtime dependency, and no second process. The panel's content security policy is `default-src 'none'` with only the extension's own nonced inline style and script admitted, so it can load nothing from the network — `form-action` and `base-uri` are named explicitly because neither falls back to `default-src`. The nonce comes from the crypto RNG rather than `Math.random`, so the policy does not rest on there being no injection primitive to spend a predicted value on. `localResourceRoots` is set **empty** rather than omitted: omitting it does not deny the grant, it defaults to the extension directory plus every open workspace folder.

Every colour is a VS Code theme variable, so it follows your active light, dark or high contrast theme without the extension knowing which is active.

One panel is reused for the window and revealed on re-run, rather than a new tab stacking up per invocation, and `retainContextWhenHidden` is deliberately not set — the panel's state is entirely derived from the model, so a hidden panel costs nothing to rebuild. Scanning runs under a progress notification instead of leaving the command looking inert while it walks a large org's metadata.

Picklist values, api names and Apex failure messages all originate in metadata the extension does not control, so none of them are interpolated raw — they are HTML-escaped, and the model is handed to the panel as JSON inside a `application/json` block that a value containing `</script>` cannot close. The "Reveal in Explorer" handler opens a path only when the built view model itself named it, so a message from anywhere else cannot make the extension host open an arbitrary file.

### An unverified combination is never shown as verified

The generated test class asserts one method **per object**, so `results.json` carries object-level outcomes and the per-combination detail lives inside the failure message. Three states follow, and the panel distinguishes all three rather than collapsing them into pass/fail:

| Situation | Shown as |
|---|---|
| The run covered this object and every failure it reported was tied to a combination, but not this one | passed |
| The run named this exact combination as failing | failed, with every kind and message it reported |
| No check has run, the object was not in the run, or **any** of the object's failures could not be tied to a combination | **not checked**, with the unplaceable failure text surfaced on the object |

The third row is the point. Marking every combination of an unattributable failure as failed would overstate a drift that touched one of them; marking them passed would report green for a combination the org may well have broken. Neither is a claim the loaded artifact supports.

Attribution is therefore decided **before** any status is assigned. An earlier revision only asked whether the failure message parsed at all, not whether the parsed failures actually landed on a combination — so a failure naming a combination the local metadata no longer describes was silently discarded, leaving the object marked failed while every combination under it showed a green tick and the Apex message vanished from the panel entirely. Found in review, fixed, and pinned by regression tests.

A controlling value may itself contain `": "` — `Tier 1: Premium` is a legal Salesforce picklist value — so the failure line `KIND — Object.Field @ Tier 1: Premium: message` cannot be split by the line alone. The raw tail is carried through parsing and resolved against the controlling values the metadata actually declares, rather than guessing at the first colon.

`SDTPicklistDependencyValidator` raises `MISSING_VALUES` and `FORBIDDEN_VALUES_PRESENT` independently for the same controlling value, so **every** failure on a combination is kept and rendered. Showing only the first hid a real drift fact.

### The panel payload is linear in picklist size, not quadratic

`forbiddenValues` is the complement of the allowed values within the field's declared set, so carrying it per combination made the embedded model the *product* of the two picklists' sizes. Measured against the first revision: **62 MB** of embedded JSON and 2.25 M value elements for a large org, and 6.6 MB for a single 300 × 800 picklist — enough to freeze the webview renderer.

The node now carries its declared values once and the panel derives each combination's complement, which is the same rendering from the *sum* rather than the product. Same shapes after the change: 6.9 MB (**9× smaller**) and 0.08 MB (**83× smaller**). A test pins the linear shape so it cannot silently regress.

An expectation that never declared a forbidden list asserted only the positive half, and the panel still renders no complement for it — the derivation is exact, not an approximation.

### Unhappy paths render, they do not error

- **No results directory** — the structure renders in full, marked "not checked" throughout, naming the directory that was looked in and the command that would populate it
- **Malformed `results.json`** — a readable message and the structure without the overlay, never a blank panel. A file that parses but carries no `methodOutcomes` list is reported the same way
- **Zero dependent picklists** — an empty state naming the objects directory that was scanned, and what makes a picklist appear there
- **A run folder holding no `results.json`** is skipped rather than picked and then failed on, so a partially written run does not hide the last good one

The newest run is chosen by the timestamp in the `check-<org>-<timestamp>` folder name rather than by file mtime — every file in a fresh clone carries the checkout time, which would make "most recent" arbitrary for anyone committing their check artifacts.

### Known limitations

- **A combination added since the last check run shows as passed.** Results are recorded per object, and nothing in `results.json` fingerprints the specs it was generated from, so the panel cannot tell "this combination was verified" from "this combination was added to `valueSettings` after the run". Re-run the check after changing dependency metadata.
- **A dependent picklist whose field is skipped during collection does not appear**, for the same reasons generation skips it — an invalid api name, or no `valueSettings` markup. The count of skipped fields and the reason for each is shown at the top of the panel rather than being silently omitted.

## [3.0.0] - SDT-Prefixed Per-Object Picklist Dependency Specs with Negative Assertions

Resolves [#72](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/72). Part of epic [#62](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/62).

### BREAKING: every Apex class this extension writes is now `SDT`-prefixed

The picklist dependency framework shipped unprefixed in 2.12.0 and the generated registry carried an `SFTreecipe` prefix. Both are renamed, so **anyone who deployed the framework between 2.12.0 and 2.14.0 has classes in their org that this version orphans**:

| Was | Now |
|---|---|
| `PicklistDependencyFramework/` (folder) | `SDTPicklistDependencyFramework/` |
| `IPicklistDependencySource` | `ISDTPicklistDependencySource` |
| `PicklistDependencySpec` | `SDTPicklistDependencySpec` |
| `PicklistDependencySnapshot` | `SDTPicklistDependencySnapshot` |
| `PicklistDependencyReport` | `SDTPicklistDependencyReport` |
| `PicklistDependencyValidator` | `SDTPicklistDependencyValidator` |
| `SchemaPicklistDependencySource` | `SDTSchemaPicklistDependencySource` |
| `SFTreecipePicklistDependencySpecs[Test]` | `SDTPicklistDependencySpecs[Test]` |

- One prefix, applied to everything: a class in your package directory starting with `SDT` was put there by Salesforce Data Treecipe, not by you, and cannot collide with your own `PicklistDependencySpec`
- **Generation detects the old layout and warns**, naming the exact paths to delete locally and the exact class names to delete from any org they reached. **Nothing is deleted for you** — these are files in your package directory that may well be committed and deployed, so removing them is your call
- Left in place, the two frameworks deploy side by side under different names and both compile, which is why the warning names them rather than staying quiet

### A dependent picklist backed by a global value set is now captured

Found by running the generator against real-world metadata artifacts. `controllingField` was read only inside the `valueSetDefinition` branch of `XmlFileProcessor`, so a picklist whose values come from a **global value set** parsed as not dependent at all — even with `<controllingField>` and full `<valueSettings>` markup in the field file.

Two consequences, both silent: no dependency spec was generated for such a field, and recipe generation treated it as a plain picklist rather than a dependent one.

- `controllingField` is now read for a global-value-set picklist too, and `globalValueSetName` continues to be recorded — both facts are true of the field
- Its dependency configuration is derived from `valueSettings`, which names every dependent value and the controlling values that unlock it. Only the value *definitions* live in the global value set; the dependency markup is local
- The field therefore travels the same path as any other dependent picklist: it gets a generated spec with `expectAtLeast` / `expectNotAllowed`, a `dependsOn` link when its controlling field is itself dependent, and a dependency-aware recipe value with record type sections
- **Limitation, deliberate:** the values captured are those carrying `valueSettings` configuration. A global value set value with no `valueSettings` entry is unlocked by no controlling value and does not appear — reading the global value set file to include it is not done, since generation reads the object metadata it was pointed at
- A global value set picklist that is *not* dependent is unchanged, asserted by test

### A dependent picklist absent from a record type no longer crashes recipe generation

Also found through real-world artifacts, and present on `main` — unrelated to the picklist dependency spec work.

A record type can expose the **controlling** field, with the controlling value available, and still not include the dependent field in its picklist sections. The controlling-field lookup was guarded; the dependent-field lookup two lines later was not, so the undefined dereference threw and took recipe generation down for the entire run rather than reporting a gap in one record type.

- Present identically in **both** faker backends; fixed in both
- Each now emits the same `### TODO: -- RecordType Options --` line it already emits when the controlling value is unavailable, and continues with the remaining record types
- Tests added to both backends first, confirmed failing with `Cannot read properties of undefined (reading 'forEach')` before the fix

### Generated class names fit the Salesforce 40-character ApexClass limit

Found in scratch-org testing: the first per-object naming used a `SDTPicklistDependencySpecs_` prefix, which spent **27 of the 40 characters** before the object name began. `SDTPicklistDependencySpecs_Treecipe_Demo_c` is 42 characters and the deploy was rejected — almost any custom object breached it.

- The generated registry family is now `SDTPLDSpecs`, `SDTPLDSpecsTest` and `SDTPLDSpecs_<Object>`. `PLD` is picklist-dependency abbreviated; the prefix drops to 12 characters, leaving 28 for the part of the name that identifies the class
- The six framework classes keep their descriptive names — they are fixed-length, all fit comfortably, and they are the ones a human actually reads
- A custom object api name can itself reach 40 characters, so a short prefix alone is not a guarantee. An over-long name is truncated and given a 6-character digest of the **full** api name: unique, and stable across runs. A positional suffix would have changed as metadata changed and orphaned the previously generated class in the org
- Truncation strips a trailing underscore before appending, since `__` is not legal in an Apex identifier
- Tests assert the invariant directly against a 40-character object api name, plus stability across runs and distinctness for two names sharing a truncated prefix

### Negative assertions: drift is now caught in both directions

Generated specs only ever asserted what a controlling value *must* unlock, so a value that drifted **into** a combination it does not belong in passed silently. Each controlling value now gets a second line:

```apex
.expectAtLeast('USA', new List<String>{ 'Ohio', 'Texas' })
.expectNotAllowed('USA', new List<String>{ 'Ontario' })
```

- New `expectNotAllowed(controllingValue, values)` builder and a `FORBIDDEN_VALUES_PRESENT` failure kind naming the specific offending values
- The forbidden list is the **complement** — every value the dependent field declares that this controlling value does not unlock — taken from the field's own `<valueSet>` rather than from its `valueSettings` map, so a value carrying no `valueSettings` entry at all (unreachable under every controlling value) lands in every complement
- **This deliberately does not switch the generator to `expectExactly`.** Exact matching would fire on any value an admin legitimately adds to the field after generation; the complement tolerates that while still failing on a value in the wrong bucket. The `expectAtLeast` design decision from #62 stands
- A controlling value whose complement is empty emits no line — it would assert nothing. A controlling value that unlocks nothing still emits `expectNone`, which is strictly stronger than listing what it must not unlock

### One spec class per object, with an aggregator

A registry covering every dependent picklist in a real org is not something anyone reads, and regenerating rewrote one file that every object's diff landed in.

- One `SDTPicklistDependencySpecs_<Object>.cls` per object, each with one spec method per dependent picklist on that object
- `SDTPicklistDependencySpecs.all()` becomes a thin aggregator calling each per-object `all()`. Callers depend on the aggregator, so a per-object class appearing or disappearing does not ripple outwards
- **Splitting per field was considered and rejected** — it multiplies files by the number of dependent picklists for no gain in readability, and separates a chained picklist from the field that controls it
- The generated test class keeps its existing one-`@IsTest`-method-per-object shape, so **Run Picklist Dependency Check** needs no change to how it invokes or parses results
- Object api names collapsing to one Apex identifier (`Foo__c` and `Foo_c` both yield `Foo_c`) take a numeric suffix, as spec method names already did
- **Stale classes are removed.** An object that loses its last dependent picklist leaves a generated class the new aggregator no longer calls — left on disk it still deploys, so the org keeps asserting a contract your metadata no longer describes. Only files matching the generated pattern and absent from the current run are removed, and the summary names them. The aggregator, the test class and your own Apex are never touched
- The check command discovers per-object classes from disk and adds them to the deploy set — without them the aggregator deploys and fails to compile against classes that are not there

### Chained dependencies are linked

Where a dependent picklist is itself the controlling field of another (`Country__c` → `State__c` → `City__c`), the lower spec now carries `.dependsOn(specFor_Chain_Example_c_State_c())`.

- The validator resolves the chain and reports a break **once at its source**; each downstream spec gets a single `UPSTREAM_FAILURE` naming the spec to fix first, instead of repeating the same describe mismatch for every dependent below it
- Upstream specs are resolved **on demand and memoized**, not assumed present in the caller's list — the generated test class validates one object at a time, and a controlling field shared by several dependents costs one describe rather than one per dependent
- A `CIRCULAR_DEPENDENCY` guard terminates a hand-edited cycle rather than exhausting the stack. Salesforce cannot express a cyclic picklist dependency; a hand-edited `dependsOn` can
- A spec listed twice is reported once
- **A controlling field always lives on the same object as the field it controls**, so an emitted `dependsOn` always names a sibling method in the same per-object class. There is no cross-object chain to link, and none is fabricated

### Testing

- New three-level chain fixture (`Chain_Example__c`: `Country__c` → `State__c` → `City__c`) drives complement, chain-linking and contract coverage
- The contract test asserting that every emitted builder exists on the shipped Apex class now covers `dependsOn` and `expectNotAllowed`, and additionally asserts the validator exposes the new failure kinds and that every framework class the generator scaffolds is actually present in the shipped directory
- Apex tests added for forbidden-value detection, tolerance of org-added values, unknown controlling values under a negative assertion, healthy and broken chains, upstream-not-in-list resolution, the cycle guard, and duplicate specs
- Coverage: 83.07% → 83.58% statements, 77.67% → 78.08% branches, 85.15% → 85.83% functions

### Deploy confirmation now states the real reason, and refuses when there is nothing to send

Two defects in the deploy prompt, both found in review.

- The confirmation opened with *"`SDTPLDSpecsTest` was not found in `<org>`"* on **both** paths. The end-to-end command deploys because it has just rewritten the classes, having never asked the org anything — so a user whose test class *was* deployed was told it was missing, and could reasonably conclude their previous deploy had failed. The opening line is the only thing anyone has to reason about before approving a deploy. It now names the real reason on each path
- The confirmation was built **before** the check for anything to deploy, so a workspace where generation never ran got an approval dialog reading *"The following 0 file(s) will be deployed:"* with a blank list, and only received the actionable "run Generate first" error after approving it. The validation is now extracted and runs before the modal

### Tests for three service files that changed without them

Against CLAUDE.md's "update tests each change" mandate, three files had shipped untested.

- **`DirectoryProcessor`** — the new object-child pruning changes recipe generation for *every* user, and its safety argument lived only in a comment. Pinned now: sibling directories are not read once `fields` is present, a directory with no `fields` child is still walked in full, the object is still registered, and — the load-bearing one — record types still resolve from the fields path even though `recordTypes` is pruned from the walk
- **`VSCodeWorkspaceService`** — org quick pick labelling and dismissal, and the output channel's lazy creation, reuse, subscription registration, and clear-before-append ordering. Review raised that an org with an empty identifier would be indistinguishable from a dismissed picker; verification showed `buildAuthenticatedOrgDetails` already drops an unusable identifier upstream, so a test pins that invariant rather than adding a redundant guard
- **`ConfigurationService`** — the two picklist dependency results path methods

Coverage: 83.58% → 84.59% statements, 78.08% → 79.22% branches, 85.83% → 87.47% functions. `VSCodeWorkspaceService` moved from 75% to 85% statements and 61.5% to 84.6% functions.

### A stray `undefined/` directory, and the bug that created it

`undefined/treecipe/GeneratedRecipes/RecipeGenerationErrors/` was committed to this branch by accident, carrying two error captures from a debugging run. It was not excluded by `.vscodeignore`, so it would have shipped in the `.vsix`.

The directory name was the symptom of a real defect. `VSCodeWorkspaceService.getWorkspaceRoot()` is declared to return a `string` but returns `undefined` when no workspace folder is open, and all three error-capture writers interpolated it straight into a template literal — producing the literal string `"undefined"` and silently creating an `undefined/treecipe/...` tree wherever the process happened to be running. Anything running outside an extension host, the headless demo driver included, hits this.

- The three writers now resolve their target through a shared guard that returns `undefined` rather than a path built from a missing root, and each skips the capture with a warning instead of writing somewhere nobody will look
- The committed directory is removed
- Tests cover all three writers plus the guard: no directory is created, no file is written, a warning is raised, and the resolved path never contains `"undefined"`

The wider issue is untouched and worth a separate look: `getWorkspaceRoot()` still lies about its return type, and nine other call sites interpolate its result the same way.

### End-to-end scratch org verification

Verified against a fresh scratch org: generation, deployment, a passing check, drift detection in both directions, and restore.

- The demo scaffold (`scripts/picklist-dependency-demo/`) covered only a plain two-tier dependency with a local `valueSetDefinition`, so a real scratch org run never exercised the chained or global-value-set paths this release added. It now writes a `Planets` global value set plus a third tier: `Dressing__c` (chained, local values, and a value containing a space) and `Planet__c` (chained, **global value set**). Generation produces 3 specs for the object, and `Planet__c` correctly emits both a spec and a `dependsOn` link
- **The Drift step could never have failed.** It broke a dependency by omitting a `valueSettings` entry, but Salesforce *merges* `valueSettings` on a `CustomField` deploy — the omitted entry stayed in the org, the deploy reported `Succeeded`, and the check correctly reported PASS against an org that never changed. Drift now *rewires* a value from one controlling value to another, which is what an admin actually does in Setup and asserts more: `MISSING_VALUES` on the old controlling value and `FORBIDDEN_VALUES_PRESENT` on the new one
- Drift runs in two phases, because a broken controlling field short-circuits every spec below it into a single `UPSTREAM_FAILURE`. Phase 1 drifts only the global-value-set field, so its own expectations are actually evaluated; phase 2 drifts the controlling field as well, proving the chain reports the break once at its source
- Fixed `.Count` on a single-element pipeline result failing under `Set-StrictMode -Version Latest`, which aborted `-Step Generate` whenever exactly one per-object spec class was produced — the demo's normal case

### One-command orchestration for the end-to-end run

The verification above took a dozen separate invocations plus hand-written anonymous Apex to root-cause. It is now a single command, and a VS Code task.

- **`-Step Verify`** reads the live controlling-value map out of the org through `SDTSchemaPicklistDependencySource` — the same source the check uses — and prints it. This is the question a deploy result cannot answer, and it previously had no command at all
- **`-Step FullRun`** chains `Preflight` → `Restore`, including both drift phases, in one invocation
- **A drift guard.** `Drift` now calls `Verify` before and after its own deploy and refuses to run the check unless the org genuinely moved, exiting `1` with the reason. Without it, a no-op drift deploy produces a `PASS` indistinguishable from a healthy run — which is exactly how the omission bug above survived
- **`-Interactive`** pauses at the three points a human has to judge something an assertion cannot: the generated contract before it deploys, and each drift report after it fails. Off by default, so the same script runs unattended in CI
- **`-Step Accept`** closes the loop. Drift has two legitimate endings and only one existed: `Restore` rejects the change by putting the org back. `Accept` treats the org as correct — it retrieves the org state into local source, regenerates the contract, redeploys and re-runs. Retrieving *before* regenerating is the whole point: generation reads local metadata, and drift deliberately leaves local source at the original contract, so regenerating alone produces a byte-identical contract that fails again identically. `Accept` fingerprints the generated classes either side of regeneration and refuses to re-run if nothing changed
- `-Step FullRun` now runs the complete lifecycle — stand up, pass, drift, fail, regenerate, pass — in one invocation
- **Every run now starts from a new scratch org.** `CreateOrg` used to reuse a live org carrying the same alias, which meant a run inherited the previous run's drift, deployed classes and source-tracking history — a green result proved the feature worked *there* rather than from nothing, and the reuse is what produced this harness's source-conflict failures. It now replaces that org; `-ReuseExistingOrg` opts back in for iterating on a single step
- Deploys pass `--ignore-conflicts`. The script authors every file it deploys, so local is authoritative by construction, and `Accept` creates a source-tracking conflict by design when it retrieves. Without this, every deploy after an `Accept` was refused
- Six `PICKLIST:` tasks in `.vscode/tasks.json` wrap the script, prompting for the scratch org alias and Dev Hub

### Removed: the anonymous-Apex CI runner

`scripts/apex/runPicklistDependencyChecks.apex` and `scripts/apex/run-picklist-dependency-checks.js` (with the `npm run picklist-dependency-check` script) are deleted. Every picklist dependency check now runs one way: from generated Apex that has been **deployed** to the target environment and executed as a test class in system context. The anonymous-Apex path ran as the authenticated user, so its result could vary — misleadingly — with that user's field-level security, and nothing invoked it: no CI workflow called the runner, `.vscodeignore` already excluded it from the `.vsix`, and the end-to-end demo harness deploys the generated classes instead. The `PICKLIST_DEPENDENCY_CHECK_RESULT` marker is unaffected — `SDTPicklistDependencyReport` still emits it

### Removed: the repository is no longer a Salesforce DX project

`force-app/`, `sfdx-project.json`, `config/project-scratch-def.json` and `.forceignore` are gone. This repository is a VS Code extension; the only Salesforce metadata it carries is the Apex framework source, which now lives in a directory named for exactly that purpose:

- **`apexPicklistDependencyFramework/SDTPicklistDependencyFramework/`** — the six runtime classes shipped in the `.vsix` and scaffolded into the user's package directory by Generate Picklist Dependency Tests. `scaffoldMissingFrameworkClasses` and the `.vscodeignore` negation both point here now
- **`apexPicklistDependencyFramework/frameworkApexTests/`** — the framework's own Apex unit tests and stub source, dev-only, never shipped
- **`apexPicklistDependencyFramework/README.md`** — documents what each half is for and how to deploy the tests
- The committed `SDTPLDSpecs.cls` placeholder is deleted outright: generation always emits a fresh aggregator, so a tracked copy existed only to be overwritten

The demo harness no longer deploys from the repository. `-Step Scaffold` generates a throwaway DX project under `scripts/picklist-dependency-demo/demoSalesforceProject/` (gitignored) — `sfdx-project.json` written on the fly, framework classes copied in from their source of truth, sample metadata and generated classes landing inside it — and every `sf` project command runs from that directory. This is also the more faithful demo: the extension's real consumers run it against their own DX project, and the staging project plays that role

### New: `docs/PICKLIST-DEPENDENCY-IN-ORG-GUIDE.md`

An org-side companion to the design record, written for the admin or developer looking at `SDTPLDSpecsTest` in a Salesforce org with no VS Code in front of them: what each deployed class is, how to read a generated spec line-by-line against the **Field Dependencies** grid in Setup, where the org side of the comparison actually comes from (including Execute Anonymous diagnostics that print the org's live view, flagged as diagnostics rather than the gate), the four ways to run the tests, the full failure-kind table, how to **trigger a failure on purpose** — and why omitting a `valueSettings` entry silently will not do it — and a decision tree for choosing between fixing the org and regenerating the specs. Linked from the README, the design record, and the demo runbook.

### Design record: the `validFor` mechanism is now fully documented

`docs/PICKLIST-DEPENDENCY-TECHNICAL-DESIGN.md` §6 now captures the entire `validFor` story rather than only the decode: where the bitmap comes from (the admin's Field Dependencies matrix, compressed and served by Salesforce's describe engine), a mermaid sequence diagram of the full deserialize-and-parse walkthrough — Setup click → `fetch()` → the `JSON.serialize` loophole → base64/hex/bit decode → snapshot → validator verdict, including the fail-loud path for a missing key — a worked bitmap-examples table pinned to `SDTSchemaPicklistDependencySourceTest`, and direct links to the official Salesforce documentation per API (SOAP describe, Apex `Schema.PicklistEntry`, UI API picklist values, Metadata API `valueSettings`), stating plainly that the JSON serialization behaviour itself is documented nowhere. A new **Appendix B** gives a self-contained anonymous-Apex procedure reproducing the contract from a blank org, referenced from the §12 verification checklist

### Cleaner assert messages

Assertion failures surfaced in a Salesforce org escaped every embedded double quote as `&quot;`, which buried the field and value names the message exists to report. Every double quote is gone from the messages `SDTPicklistDependencyValidator`, `SDTSchemaPicklistDependencySource`, and the generated test class produce — `Account.Type @ "Customer"` now reads `Account.Type @ Customer`. The word "reports", which reads as Salesforce Reports to an admin, is replaced with "the org has" throughout those messages.

## [2.14.0] - Run Picklist Dependency Check Command

Resolves [#69](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/69). Part of epic [#62](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/62).

### Features

- New command **Salesforce Treecipe: Run Picklist Dependency Check** (`treecipe.runPicklistDependencyCheck`) that deploys and runs the generated picklist dependency tests against an org and reports the outcome in VS Code. [#61](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/61) generated specs but shipped nothing that could execute them — `.vscodeignore` excludes `scripts/apex/**`, so the `npm run picklist-dependency-check` runner its verification story assumed is repo-local tooling that never reaches an extension user
- The target org is chosen from a quick pick built from `AuthInfo.listAllAuthorizations()`, preferring the alias and falling back to the username. Both are accepted by `sf --target-org`
- Results are written to a dedicated **Picklist Dependency Check** output channel, cleared on each run so the visible output always belongs to the run that just finished, with a pass/fail summary notification carrying the failure count
- **Every run is also saved to `treecipe/PicklistDependencyResults/check-<org>-<timestamp>/`** as `results.json` (machine-readable per-method outcomes) and `report.md` (human-readable). Because the output channel is cleared on each invocation, a check would otherwise leave nothing behind — nothing to commit, nothing to diff against the previous run, and nothing to attach to a review. Passing runs are persisted too, so a green check is on record rather than only a failing one. The org identifier is sanitized for the folder name, since a username is a valid target and contains characters that read poorly in a directory listing

### Directory walks now filter to what is actually consumed

- Both walks recursed into **every** child directory of an object — `recordTypes`, `listViews`, `webLinks`, and anything else Salesforce puts there — hunting for more `fields`. Nothing downstream reads those types: only `fields` is consumed, and record types are reached by navigating from the fields directory path rather than by the walk finding them
- A directory containing `fields` is an object directory, so its other children cannot contribute anything. Both walks now stop there. Measured on the fixture tree: **43 directory reads down to 32, and 11 non-field directories visited down to 0**, with identical output. The saving scales with the number of objects in the org rather than the number of dependent picklists
- Filtering on this invariant rather than deny-listing type names means no maintenance when Salesforce adds another object child type
- It also pins the object api name to the directory that actually holds the fields. A `fields` folder found deeper in the tree would previously have been attributed to whatever directory happened to contain it

### Fixed: files without the `.field-meta.xml` suffix were parsed as fields

- The field walk accepted **any** `.xml` file in a `fields` directory. Salesforce source format names every custom field `<ApiName>.field-meta.xml`, so a hand-saved copy, an export, or a scratch file carrying `CustomField` markup was parsed as a real field — generating picklist dependency specs for fields the org has no reason to have
- Reproduced against a fixture already in this repository. `MockSalesforceMetadataDirectory/objects/Example_Everything__c/fields/gfh__c.xml` holds dependent-picklist markup without the required suffix:

  | | specs generated | `gfh` references in the registry |
  |---|---|---|
  | Before | 2 | 4 |
  | After | 1 | 0 |

- **`isXMLFileType` is unchanged and still means "is an `.xml` file".** `GlobalValueSetSingleton` and `RecordTypeService` depend on it for `.globalValueSet-meta.xml` and `.recordType-meta.xml`, so narrowing it would have broken them. A separate `isSalesforceFieldMetadataFile` carries the stricter rule, and requires an api name before the suffix so a file called exactly `.field-meta.xml` is not treated as a field
- The same strictness is applied to `DirectoryProcessor`, which had the identical defect on the recipe generation path. **This changes recipe output for anyone whose `fields` directory contains a stray `.xml`** — such a field will no longer appear in a generated recipe, which is the intended behaviour
- The `gfh__c.xml` fixture is deliberately left in place as the regression case, with a test asserting no spec is generated for it while the properly named dependent picklist beside it still is

### Generated registry renamed, and one method per scenario

- The generated registry is now **`SFTreecipePicklistDependencySpecs`** (and `SFTreecipePicklistDependencySpecsTest`). The prefix makes it obvious the class was written into the user's package directory by this extension rather than by them, and removes any chance of colliding with a `PicklistDependencySpecs` of their own
- **Each dependent picklist is now its own method**, and `all()` returns the collection of them:

  ```apex
  public static PicklistDependencySpec specFor_Dependency_Example_c_Neighborhood_c() {
      return PicklistDependencySpec.forField('Dependency_Example__c', 'Neighborhood__c')
              .controlledBy('City__c')
              .expectAtLeast('cle', new List<String>{ 'ohiocity', 'tremont' })
              .expectNone('akron');
  }

  public static List<PicklistDependencySpec> all() {
      return new List<PicklistDependencySpec>{
          specFor_Dependency_Example_c_Neighborhood_c()
      };
  }
  ```

  A single dependency can now be read on its own, referenced by name from a hand-written test, or tightened to `expectExactly` without picking through one long list expression. A comment above each method names the object, field and controlling field
- Spec method names collapse runs of underscores for the same reason the test method names do — Apex identifiers may not contain two consecutive underscores — and take a numeric suffix when two scenarios collapse onto one identifier. The `specFor_` prefix also keeps the identifier valid when an api name starts with a digit
- The api names inside each spec are still emitted as **string literals** with their exact `__c` suffixes, so Schema describe resolves the real object and field

### Generation offers to run end to end

- After writing the classes, **Generate Picklist Dependency Tests** now offers to deploy and run them against an org in the same invocation. Accepting prompts for the target org, deploys, runs, and reports — generation through to verified results without leaving the command
- Implemented as a prompt on the existing command rather than a new one. A third picklist command in the palette would have been a worse trade for the same capability
- The offer comes **after** generation, not before: generating is useful on its own — reviewing a diff, or working without an org to hand — so dismissing leaves a completed generation rather than a cancelled command
- That path **always deploys**, where the standalone check deploys only when the test class is absent. The classes were just rewritten, so the org copy is stale by definition and a conditional deploy would run yesterday's contract against today's metadata. A test asserts `isSpecsTestClassDeployedInOrg` is never consulted on this path
- Both commands now share three private helpers — generation, org selection, and deploy-run-report — so the two entry points cannot drift in their handling of confirmations, cancellation, artifacts, or reporting

### Corrected: the generated Apex is now a real test class

- `PicklistDependencyTestService` now also emits `PicklistDependencySpecsTest.cls`, an `@IsTest` class asserting the spec registry through `PicklistDependencyValidator` and `SchemaPicklistDependencySource`. Despite the command being named "Generate Picklist Dependency Tests", what [#61](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/61) emitted was a plain data registry executed by anonymous Apex
- That design came from an epic decision that **stopped being true**: verification was anonymous Apex because the original `ConnectApi`-based source could not run inside `@IsTest`. `e6c624d` replaced it with `SchemaPicklistDependencySource`, and Schema describe has neither constraint — it runs inside `@IsTest` and returns the org's real metadata rather than isolated test data, so no `SeeAllData` and no test setup are involved
- One test method per object, so a failure names the object in the test results and each method gets its own CPU and heap budget rather than sharing one transaction across the whole registry — the describe work is what binds that limit
- A `specRegistryIsNotEmpty` guard method fails when the registry is empty. This is the `EMPTY` semantics of the anonymous-Apex marker protocol expressed as an assertion; without it the class would report green while asserting nothing
- Generated method names are derived from validated object API names, with a prefix applied when a name begins with a digit so the Apex identifier stays valid

### Salesforce CLI over the API equivalents

- The check runs `sf apex run test --json` rather than `connection.tooling.executeAnonymous()`. `executeAnonymous` returns compile and success status but **not** the debug log, and the entire per-combination report is emitted through `System.debug` — recovering it would have required a debugging header or a follow-up `ApexLog` query. `sf apex run test` returns structured per-method results, so no marker protocol and no debug-log scraping exist on the extension's path at all
- The optional deploy step uses `sf project deploy start --source-dir`, which avoids a zip library plus metadata-format packaging via `connection.metadata.deploy()` and avoids adding `@salesforce/source-deploy-retrieve` as a dependency
- That deploy names the eight classes this command owns individually rather than passing the whole `classes` directory. A user's package directory holds their own Apex, and a deploy approved to get a dependency check running must not carry unrelated work-in-progress classes into the org with it
- This adds no meaningful new requirement: `CollectionsApiService.getConnectionFromAlias` already resolves orgs through `Org.create({ aliasOrUsername })`, which reads the CLI's own auth files, so a user without the CLI has no authenticated orgs to select in the first place. Precedent for shelling out already exists in `SnowfakeryRecipeProcessor`
- On Windows the CLI is named as its `sf.cmd` shim directly. Since the Node fix for CVE-2024-27980, spawn refuses `.cmd`/`.bat` without a shell, and naming the shim keeps the argv form and its immunity to shell metacharacters instead of falling back to `shell: true`

### Unhappy paths

- No authenticated orgs reports how to authorize one rather than showing an empty quick pick
- Dismissing the org quick pick exits silently and runs nothing
- A missing test class prompts before deploying; declining exits cleanly and deploys nothing
- The Salesforce CLI missing from `PATH` reports an actionable message naming the CLI rather than a raw spawn error, and is never conflated with dependency drift
- A deploy that fails on compilation surfaces the component failure message rather than a raw stack trace
- An org with source tracking that reports conflicts gets actionable guidance naming the org and the `--ignore-conflicts` escape hatch, rather than the CLI's bare "N conflicts detected". Conflicts are deliberately not forced past automatically — the org copy may hold edits worth keeping, and this command reports drift rather than overwriting it

### Review fixes

Applied after a three-reviewer pass (architecture, performance, security) on PR [#70](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/70):

- **The CLI is invoked asynchronously.** Every call was `spawnSync`, which blocks the VS Code extension host — a single shared, single-threaded process — for the whole run, freezing every installed extension with no progress and no way out. All three calls now use `execFile` inside `vscode.window.withProgress({ cancellable: true })`, with the cancellation token wired to `child.kill()`
- **`--wait` is in MINUTES, not seconds.** The test run was sent `--wait 20`, written believing it meant seconds; it meant twenty minutes. Now bounded to 10, and the deploy passes an explicit `--wait` rather than inheriting the CLI's 33-minute default
- **The Windows handling was backwards.** Naming the `sf.cmd` shim directly was documented as preserving the argv form; since the Node fix for CVE-2024-27980, spawning a `.cmd` with arguments and *without* a shell fails with `EINVAL`, so it broke every invocation on win32 instead. Windows now enables the shell with every argument quoted, and a value containing a double quote is rejected rather than escaped. Other platforms keep the argv form unchanged
- **Test result keys are read case-insensitively.** Only `Outcome` was read, so an unexpected casing would have rendered every method failed — a false report of dependency drift, the one thing this command must never produce
- **`stderr` and the exit code are carried into parse failures.** An auth failure produced "Unexpected end of JSON input" with the real cause discarded
- **The org identifier is charset-validated** before reaching the CLI, rejecting anything that could be read as a flag rather than a value. Defence in depth given the argv form, and load-bearing on the Windows shell path
- **The classes directory is re-checked for workspace containment.** Containment was enforced on the package directory, then `main/default/classes` was appended unchecked — and `writeFileSync` follows symlinks
- **The deploy confirmation lists every file** it will send. Framework classes are scaffolded only when absent, so a workspace carrying its own copy deploys that copy; the user has to see which files those are
- **The output channel is disposed** via `context.subscriptions`, and typed `OrgAuthorization` replaces the `any[]` on the authorization boundary
- **The same Windows defect is fixed in `scripts/apex/run-picklist-dependency-checks.js`**, where it originated in [#60](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/60) and from which it was copied — comment included. That runner now enables the shell on Windows with quoted arguments, validates the `--target-org` value (which can arrive from argv or `SF_TARGET_ORG`, and on the shell path would otherwise be interpreted by `cmd.exe`), and reports `EINVAL` distinctly from `ENOENT`

### Fixed: generated test class would not deploy for any custom object

- **Apex identifiers may not contain two consecutive underscores**, and every custom object api name ends in `__c`. The generated method name embedded the api name verbatim, so `Example_Everything__c` produced `Example_Everything__c_picklistDependenciesMatchSourceMetadata` and the class failed to deploy with `Invalid character in identifier`. Runs of underscores are now collapsed: `Example_Everything_c_picklistDependenciesMatchSourceMetadata`
- Collapsing rather than stripping the suffix keeps `Thing__c` and `Thing__e` distinguishable as `Thing_c` and `Thing_e`
- The api name is still passed to the assertion as a **string literal**, keeping its exact `__c` suffix, so Schema describe resolves the real object — only the method identifier changed
- Collapsing can map two distinct api names onto one identifier (`Foo__c` and `Foo_c` both yield `Foo_c`), and two Apex methods with the same name will not compile, so later collisions now get a numeric suffix
- A whole-class guard test asserts no emitted identifier contains `__`, so any future change reintroducing this fails regardless of which helper produced the name

  This survived the earlier live-org deploy check because that check used `Account` and `Contact` — **standard** objects, which have no `__c` and were therefore unaffected. Verifying against standard objects alone was not enough to exercise the path every real registry takes.

### Framework classes moved into their own directory

- The six runtime framework classes now live in `force-app/main/default/classes/PicklistDependencyFramework/`, and are scaffolded into the matching `PicklistDependencyFramework` subfolder of the user's package directory. Salesforce resolves `ApexClass` by the enclosing `classes` directory and walks nested folders, so the layout deploys identically — verified locally with `sf project convert source`, which resolved a nested class to `ApexClass` in `package.xml`
- The split is for humans, not the platform: six files the user did not write stay separate from `PicklistDependencySpecs.cls` and `PicklistDependencySpecsTest.cls`, which are the contract they read and sometimes hand-tighten. The framework becomes removable in one action
- **`.vscodeignore` drops from twelve per-file negations to one directory negation.** The per-file list was a standing hazard: adding a framework class without adding two more lines would have silently shipped a `.vsix` whose generated code could not compile. Anything outside that directory is now excluded by construction rather than by omission — confirmed the package still carries exactly 12 files, the 6 classes and their metadata
- A workspace generated by an earlier version keeps working. The scaffolder skips a class present in **either** location, and the deploy resolves each class from one path only — Salesforce rejects the same `ApexClass` twice in a single deployment

### Verified against a live org

Confirmed in a scratch org rather than assumed from the docs:

- The generated `PicklistDependencySpecs.cls` and `PicklistDependencySpecsTest.cls` **compile** — deployed 8 of 8 components with no component failures, including a picklist value carrying an apostrophe, which exercises the Apex string-literal escaping
- `sf apex run test --json` returns `result.tests[]` with `MethodName`, `Outcome`, and `Message`, and `Message` is `null` rather than absent on passing methods
- A failing run exits **100**, confirming that a non-zero CLI exit must not be treated as an error — the payload still carries the per-method outcomes
- The multi-line assertion message survives the round trip, so the object name and the specific failing combination reach the output channel intact
- The CLI's `@salesforce/sfdx-scanner` plugin warning is written to **stderr**, leaving `stdout` as clean JSON — the service reads `stdout` specifically, so the warning cannot corrupt parsing
- A failing Apex test makes the CLI exit non-zero, which is deliberately **not** treated as an error — the result payload still carries the per-method outcomes the user needs to see

### Notes

- This repository's own `npm run picklist-dependency-check`, its anonymous-Apex entry point, and the `PICKLIST_DEPENDENCY_CHECK_RESULT` marker are unchanged and stay as local tooling
- No faker service change; neither `IRecipeFakerService` nor `IFakerRecipeProcessor` is touched, so no dual-backend parity work was required

## [2.13.0] - Generate Picklist Dependency Tests Command

Resolves [#61](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/61). Part of epic [#62](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/62).

### Features

- New command **Salesforce Treecipe: Generate Picklist Dependency Tests** (`treecipe.generatePicklistDependencyTests`) that emits `PicklistDependencySpecs.cls` from local source metadata, replacing the hand-written registry that [#60](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/60) shipped. The parsing this needs already existed to drive dependent-picklist recipe generation; this is a second consumer of it, emitting Apex instead of YAML
- New `PicklistDependencyTestService` walks the configured `salesforceObjectsPath` and emits one spec per picklist field declaring a `controllingField`, each carrying `.controlledBy(controllingFieldApiName)` so the framework's `CONTROLLING_FIELD_MISMATCH` check is active
- Every controlling value is emitted as `expectAtLeast`, so source combinations must still exist while org-added values are tolerated. Tightening a line to `expectExactly` stays a deliberate edit by the spec owner — and is lost on regeneration, which the generated file header states plainly
- A controlling value that unlocks nothing is emitted as `expectNone`. These are only discoverable by diffing the dependent field's `valueSettings` against the **controlling field's own** picklist values, read from its sibling field file — the dependent field's markup alone cannot distinguish "unlocks nothing" from "does not exist". When the controlling field is not among the parsed fields, no `expectNone` lines are emitted rather than guessing
- The framework runtime classes are now shipped in the `.vsix` and scaffolded into the resolved package directory when missing. `.vscodeignore` excluded `force-app/**`, so a generated specs file would have had nothing to compile against in a user's workspace. Negation entries ship exactly the six runtime classes and their metadata, keeping `force-app` the single source of truth so the shipped copies cannot drift; the test classes, the stub source, and the placeholder `PicklistDependencySpecs.cls` are deliberately still excluded. An existing class in the workspace is never overwritten, so a customized copy is preserved
- Picklist values are escaped for Apex string literals (backslash, single quote, and newline, in that order); API names are emitted verbatim. Ampersands need no Apex escaping and are left alone. Note this is separate from the faker services' backtick-wrapping, which is a JS template-literal technique and not reusable here
- Output written to the `classes` folder of the package directory marked `default` in `sfdx-project.json`, falling back to the first entry when none is marked. `sourceApiVersion` drives the generated `-meta.xml`

### Unhappy paths

- A field with a `controllingField` but no `valueSettings` is reported as a warning naming the object and field, and skipped — the run continues and still generates every other spec
- No `sfdx-project.json`, no `packageDirectories` entries, or a resolved package directory with no `path` each raise an actionable error and write nothing
- An existing `PicklistDependencySpecs.cls` prompts before overwrite, warning that hand-tightened lines will be lost
- Zero dependent picklists in the metadata directory reports an informational message and writes no file, rather than emitting a class whose empty registry the framework would report as `EMPTY`

### Refactor

- The `controllingValueToPicklistOptions` build moved out of `RecipeService.getDependentPicklistRecipeFakerValue` into `RecipeService.buildControllingValueToPicklistOptions`, a static shared by recipe generation and spec generation. It reads only `picklistValues`, so it needs no record type parameter. Behavior is unchanged and both faker backends' existing dependent-picklist tests pass untouched as the regression guard

### Hardening

- Object, field, and controlling-field api names are validated against `^[A-Za-z0-9_]+$` and the spec is skipped with a warning when one fails. A field api name is a raw XML `<fullName>` text node and an object api name is a directory name on disk, so neither is trustworthy by construction — the api-name constraint is enforced by Salesforce, and this generator never talks to Salesforce. Api names are additionally escaped at emission, which is a no-op for every name that passes validation, so emission stays safe without depending on the caller having validated first
- The resolved package directory is confirmed to stay inside the workspace before anything is written. `path.join` normalizes a traversing path rather than rejecting it, so a `packageDirectories[].path` of `../../..` in a workspace `sfdx-project.json` would otherwise have created directories and written files outside the folder the user opened. Absolute paths are rejected outright
- A framework class that could not be supplied is now reported instead of silently skipped. The generated specs class does not compile without the framework, so the previous behavior handed the user a broken file with no indication of why. Both the class and its `-meta.xml` are checked before either is copied, so a missing meta file cannot leave an orphaned `.cls` behind
- `sourceApiVersion` is validated against `^\d+\.\d+$` before being interpolated into generated XML, falling back to the default otherwise
- Malformed `sfdx-project.json` raises an actionable parse error naming the file, rather than surfacing a raw `SyntaxError` behind a "report issue to GitHub" button for what is the user's own typo
- A missing objects directory reports an actionable message pointing at `salesforceObjectsPath`, the most likely misconfiguration
- The overwrite prompt now covers the generated `-meta.xml` as well as the `.cls`, so a hand-tuned `apiVersion` or `status` cannot be replaced without confirmation. The success message names the destination directory
- Skipped-field warnings are capped at three individual notifications followed by an aggregate count, so a managed package declaring dependent picklists without `valueSettings` cannot bury the user in toasts
- The directory walk tests `entryType` as a bitmask so a symlinked object directory is still walked, and accumulates results with `concat` rather than spread-into-push, which throws once an accumulated subtree exceeds the engine's argument limit

### CI and supply chain hardening

- `build.yaml` installs with `npm ci --ignore-scripts` instead of bare `npm install`. `npm ci` installs exactly what `package-lock.json` records, so a hijacked patch release inside an existing `^` version range cannot be pulled into CI — which is the axios-incident path and the reason the floating pins in `package.json` were a live risk rather than a theoretical one. `--ignore-scripts` additionally stops dependency install hooks from executing on the runner; verified that no dependency in this project builds a native addon, so nothing needs them
- `build.yaml` now runs `npm run compile` and `npm run lint`. The job was named `Compile-and-Test` but never compiled: `ts-jest` typechecks only files reachable from a test, and nothing imports `src/extension.ts`, so a type error in the extension entry point passed PR CI and first surfaced during release
- `release.yaml` pins `@vscode/vsce@3.9.2` rather than installing it unpinned. That install runs in the job holding `VSCE_PAT`, so a hijacked release of the publish tool itself would execute with the token in scope. The pinned version was verified to package this extension identically (103 files, 610.32 KB) before pinning
- `release.yaml` also uses `--ignore-scripts` and moves to `actions/setup-node@v4`, matching `build.yaml`
- Both workflows declare least-privilege `permissions: contents: read`; neither writes to the repository
- Dependencies were deliberately **not** re-pinned to exact versions. With `package-lock.json` committed and `npm ci` in use, the lockfile already determines exact resolution transitively, so exact pins in `package.json` would be redundant defense that makes routine dependency updates noisier. The meaningful fix was replacing `npm install` with `npm ci`

### Tests

- `ExtensionCommandService` gains its first `tests/` folder, covering the new command handler end to end: the write path, zero-dependent-picklist and missing-objects-directory paths, both branches of the overwrite prompt, unavailable and scaffolded framework classes, the skipped-field notification cap, and error routing through `ErrorHandlingService`. `initiateTreecipeConfigurationSetup` and `changeFakerImplementationService` are covered too. Note this *lowers* the reported total percentage while increasing tested code — the file was previously absent from the coverage report entirely, because no test imported it

### Delta review fixes

A second review pass over the fix commit itself found three defects introduced *by* the fixes, plus a gap in the workflow changes:

- The symlink bitmask made symlinked directories walkable without any cycle protection. The previous strict `entryType !== Directory` check had prevented recursion loops only as a side effect of skipping symlinks entirely; removing it meant a link pointing back up the tree (`objects/Thing__c/loop` → `objects`) would recurse until the stack was exhausted. The walk now carries a visited set keyed on the realpath-resolved directory
- Workspace containment rejected a package directory of `"."`, which is a legal `sfdx-project.json` value for a project keeping metadata at the repo root. It resolves to the workspace root itself, and the `startsWith(root + sep)` check treated the root as outside the root. Containment now accepts an exact root match, and additionally compares realpath-resolved paths so a symlink inside the workspace cannot point outside it
- The api name validation used `Array.find`, whose "not found" sentinel is `undefined` — the same value an invalid entry could itself hold, so the guard would not fire for an `undefined` api name. Switched to `findIndex`, which has no such collision
- `release.yaml` installed the pinned `@vscode/vsce` **with lifecycle scripts enabled**, in the job holding `VSCE_PAT`, immediately after `--ignore-scripts` had been added to the dependency install. Pinning the top-level package does not pin its 30 direct dependencies, which are all caret ranges resolved fresh at install time and include native modules that legitimately run install hooks. The global install now uses `--ignore-scripts` too
- The publish token moved from a command-line argument to the step environment. An argv-borne secret is readable by any concurrent process on the runner and is not covered by GitHub's log masking; `vsce` reads `VSCE_PAT` natively, so the `-p` flag was unnecessary. This also removes the token from PowerShell double-quote expansion
- The release job now checks out `main` explicitly with `persist-credentials: false`. On a closed `pull_request` the default ref is `refs/pull/N/merge`, the pre-merge test-merge commit, so a moving `main` could have published source that never existed on `main`
- The command-service test asserted on `stringContaining('PicklistDependencySpecs')`, which matches the class declaration that is emitted unconditionally — it would have passed even if every spec were dropped. It now asserts on real emitted spec content. The suite also clears the whole `vscode` mock factory rather than the two functions it happens to assert on

### Verification

- The generated Apex was validated against a live org via a check-only deploy alongside the framework classes, so the emitted builder calls and the escaping of values containing quotes, backslashes, and ampersands are confirmed to compile rather than merely inferred. A test also asserts every emitted builder method exists on the shipped `PicklistDependencySpec`, so a future change to that fluent API cannot silently break the generator
- Adversarial tests cover the untrusted-input paths directly: an api name carrying `'); System.abortJob('`, an object directory name containing a quote, a controlling field name with an embedded newline, a traversing and an absolute `packageDirectories[].path`, malformed project JSON, and a `sourceApiVersion` carrying XML markup

## [2.12.0] - Apex Picklist Dependency Validation Framework

Resolves [#60](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/60). Part of epic [#62](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/62).

### Features

- New deployable Apex framework under `force-app/main/default/classes/` that asserts expected picklist dependency combinations against a live org, so a dependency an admin later rewires is caught in CI instead of surfacing as a confusing Collections API error at data-load time
- `PicklistDependencySpec` — fluent builder (`forField` / `controlledBy` / `expectExactly` / `expectAtLeast` / `expectNone`); match mode is per controlling-value line so a single expectation can be tightened to `expectExactly` without affecting the rest
- `PicklistDependencySnapshot` — ConnectApi-free snapshot; `valuesValidFor(controllingValue)` decodes `validFor` bit indexes against `controllerValues`, returning an empty set for a controlling value that unlocks nothing and `null` for one the org does not have
- `PicklistDependencyValidator` — returns a `Failure` list and never throws on a mismatch; failure kinds cover `MISSING_VALUES`, `UNEXPECTED_VALUES`, `UNKNOWN_CONTROLLING_VALUE`, `CONTROLLING_FIELD_MISMATCH`, and `LOOKUP_ERROR`. A source exception is recorded as `LOOKUP_ERROR` for that spec and the remaining specs still validate. `UNKNOWN_CONTROLLING_VALUE` failures list the controlling values the org actually reports
- `IPicklistDependencySource` — returns a plain `PicklistDependencySnapshot` rather than an org-API type, keeping the validator and its tests independent of how the data was obtained so a source can be stubbed
- `SchemaPicklistDependencySource` — reads live data through Schema describe, with no callout. `Schema.PicklistEntry` exposes no `getValidFor()` in Apex, but `JSON.serialize(entry)` emits a base64 `validFor` bitmap whose set bits are controlling-value indexes; index order is the controlling field's own `getPicklistValues()` order, verified to match the UI API's `controllerValues`. A non-dependent picklist is rejected up front by the `getController()` guard; past that guard an absent `validFor` means the undocumented serialization contract has changed, and is raised as an error rather than silently decoding to "valid for nothing". Checkbox controlling fields use `false` / `true` **in that order** — verified in a live org, where a value requiring the checkbox checked serializes as `QAAA` (bit 1) and one requiring it unchecked as `gAAA` (bit 0), matching the UI API's `controllerValues` of `{"false": 0, "true": 1}`. Note the metadata API spells these `checked` / `unchecked` in `valueSettings`, but a spec must use `true` / `false`
- `PicklistDependencyReport` — formats a run into a human-readable report plus a `PICKLIST_DEPENDENCY_CHECK_RESULT=PASS|FAIL|EMPTY` marker. An empty spec registry reports `EMPTY` rather than `PASS`, so a CI gate cannot go green having verified nothing
- `PicklistDependencySpecs` — hand-written spec registry today; the target of the upcoming "Generate Picklist Dependency Tests" command ([#61](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/61))

### Performance

- `SchemaPicklistDependencySource` caches describe lookups for the life of the transaction — `Schema.getGlobalDescribe()`, the per-object field map, and the resolved `DescribeFieldResult`. The validator runs every spec in a single transaction against a shared 10,000 ms CPU limit, and these were previously recomputed per spec for an identical answer. Measured in a scratch org, timing describe resolution alone in isolated transactions: **63 distinct fields on one object — ~827 ms uncached vs ~25 ms cached**; the same field 100 times — ~1130 ms vs ~70 ms. The distinct-field case is the realistic one (a registry holds one spec per dependent field) and gains *more*, because `getGlobalDescribe()` is the dominant term and is now paid once rather than per spec. Roughly a tenth of the entire transaction budget returned. This matters ahead of [#61](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/61), whose generator will emit specs in bulk
- Describes are keyed on the `Schema.SObjectField` token rather than an `Object.Field` string. A controlling field is reached via `getController()`, which yields a token and no name — naming it would require the very `getDescribe()` the cache exists to avoid. Token keying covers the dependent *and* controlling paths with one map (the controlling describe previously bypassed the cache entirely and was paid per spec) and dedupes for free when one spec's controlling field is another spec's dependent field
- Object cache keys are lower-cased: Apex `Map<String, …>` compares case-sensitively while describe resolves case-insensitively, so specs written `account` and `Account` would otherwise each hold a duplicate field map
- Heap cost is **~43 KB per object** with its field describes retained. This scales with the number of *distinct objects* in the spec list, not with spec count — a registry spanning dozens of objects trades CPU for monotonically growing heap against the 6 MB limit
- Batching the `validFor` JSON round-trip per field instead of per picklist entry was implemented, measured, and **rejected**: one 32-entry serialization costs the same as 32 single-entry ones (~500 ms per 100 specs either way, with run-to-run noise exceeding the difference), because JSON cost tracks bytes rather than call count. It bought only a positional-alignment failure mode. The rationale is recorded on `validForOf` so it is not re-attempted. Note that comparing approaches *within* one transaction is invalid here — each successive block measured ~2x slower than the last regardless of what it did, so approaches must be timed in separate transactions

### Tooling

- Added `sfdx-project.json` (sourceApiVersion `64.0`) at the repo root, making this a Salesforce DX project alongside the extension source
- `scripts/apex/runPicklistDependencyChecks.apex` — anonymous Apex entry point; reports against the org's real metadata without deploying a test class
- `scripts/apex/run-picklist-dependency-checks.js` — Node CI runner; exits `0` on pass, `1` on expectation failure, `2` when the check cannot run (CLI missing, compile failure, unparseable output, an unreachable org, or an empty spec registry). Accepts `--target-org <alias>` and `--target-org=<alias>`; spawns `sf.cmd` on Windows, where the Node fix for CVE-2024-27980 blocks `spawn` from running `.cmd` shims; surfaces the CLI's own error name and message rather than reporting "no result payload"
- New npm scripts: `npm run picklist-dependency-check` (live org check) and `npm run apex-test` (runs `PicklistDependencyValidatorTest` and `SchemaPicklistDependencySourceTest`)
- `.vscodeignore` excludes `force-app/**`, `scripts/apex/**`, and `sfdx-project.json` from the published `.vsix`
- `.vscodeignore` also excludes the Salesforce CLI's local tooling and per-org state, which this repo only began producing once it became a DX project ([#67](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/67)). `.sfdx/**` alone carried 2,386 files including a 7.2 MB `apex.db` and the whole `StandardApexLibrary`; `.sf/**` carried per-org source-tracking state under `.sf/orgs/<ORG_ID>/`, naming the packaging developer's org and its metadata. Also excludes `coverage/**` — being in `.gitignore` does **not** exclude it, because `vsce` packages the working directory rather than the git index — plus `.claude/**` and `.github/**` as repo automation with no runtime role. Package drops from **5,515 files / 15 MB to 2,948 files / 11.55 MB**, with `out/`, `images/`, and production `node_modules/` intact. Never shipped: there is no `v2.12.0` tag or release

### Tests

- `PicklistDependencyValidatorTest` covers both match modes, `expectNone`, `validFor` decode (empty set vs `null`), unknown controlling value, controlling-field mismatch, source exceptions (isolated per spec), and report summarisation — driven by a `StubPicklistDependencySource` so no live org is required
- `SchemaPicklistDependencySourceTest` covers the base64 bitmap decode (single bit, multiple bits, bits past the first byte, padding beyond the controlling-value count, short bitmaps, `null` / blank) and the source's error paths: unknown object, missing-or-invisible field, and a field that is not dependent
- Describe caching is covered by asserting the repeat paths, since a cache that went stale would corrupt every spec after the first: a non-dependent field is rejected identically on a second fetch, and a warmed object cache still rejects both an unknown field on that object and an unknown object
- `cachedDescribesDoNotBleedBetweenFieldsOnTheSameObject` pins cache *identity* — that a cached describe is the field that was asked for, asserted via `getName()` across two passes. Verified by mutation: collapsing the describe key onto a single shared entry makes this test fail (`Expected: Type, Actual: Industry`) while the weaker repeat-path assertions still pass
- `objectCacheKeyIsCaseInsensitive` and `clearCachesForcesAColdResolveWithoutChangingResults` cover the lower-cased object key and the `@TestVisible clearCaches()` hook, the latter existing so a future FLS-variant test can switch running user with `System.runAs` without silently asserting against the previous user's cached describe
- Verified end to end against a scratch org with a real dependent picklist: 33/33 Apex tests pass, a matching spec exits `0`, an empty registry exits `2`, and a dependency value deleted from the org is reported as `MISSING_VALUES` with exit `1`
- Coverage caveat: `SchemaPicklistDependencySource` sits at 78%, and the uncovered block begins at the `describeOf(controllerToken)` call that routes the controlling-field describe through the cache. Every `fetch()` test uses `Account.Industry`, which is not a dependent picklist, so `fetch()` throws at the `getController()` guard and never reaches the snapshot-building path. No dependent-picklist field metadata exists under `force-app/`, so the end-to-end verification above is not reproducible without hand-configuring an org. Tracked in [#66](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/66)

### Notes

- No TypeScript service change: this slice consumes no `IRecipeFakerService` / `IFakerRecipeProcessor` surface, so both faker backends are unaffected. `jest.config.js` already ignores `force-app/`, so the Jest suite and coverage are unchanged
- Specs are not record-type scoped. Schema describe exposes no record-type-aware picklist values, so rather than ship a `.forRecordType()` builder that always fails, none is provided. Record-type scoping would require the UI API as a REST callout (Remote Site or Named Credential setup, and unusable inside `@IsTest`); it can be added later as a second `IPicklistDependencySource` behind the same interface
- The Apex framework is not covered by CI. GitHub Actions runs the Jest suite only, and the Apex tests plus `npm run picklist-dependency-check` need an authorized org; both are run manually against a scratch org

---

## [2.11.1] - Fix `.undefined/` directory quick pick items (deprecated fs.Dirent.path)

Resolves [#51](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/51).

### Bug Fixes

- Directory quick pick items in **Initiate Configuration File** (and the **Insert Data Set by Directory** dataset picker) rendered every folder as `.undefined/` instead of its relative path
- Root cause: `VSCodeWorkspaceService.buildDirectoryVSCodeQuickPickItemByDirectoryEntry` derived the path from `fs.Dirent.path`, which is deprecated ([DEP0178](https://nodejs.org/api/deprecations.html)) in favor of `dirent.parentPath` and returns `undefined` in the Node runtime bundled with recent VS Code/Electron builds — no code change caused this; a runtime update surfaced it
- The builder now takes the parent directory path from its caller (`getDirectoryQuickPickItemsByStartingDirectoryPath` / `getDataSetDirectoryQuickPickItemsByStartingDirectoryPath`) instead of reading the deprecated `Dirent.path`, making label generation runtime-independent
- `getAvailableRecipeFileQuickPickItemsByDirectory` (the **Run Faker by Recipe** file picker) had the same deprecated `entry.path` dependency, where `path.join(undefined, ...)` would throw and break recipe file selection entirely; it now uses the in-scope `folderPathToParse`
- Added regression tests: `buildDirectoryVSCodeQuickPickItemByDirectoryEntry` produces a defined label when `Dirent.path` is `undefined`, the recursive directory traversal builds a correct relative-path label without relying on `Dirent.path`, and the recipe file picker builds a correct `detail` path when `Dirent.path` is `undefined`

---

## [2.11.0] - friends Block Processing in FakerJS Recipe Processor

Resolves [#45](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/45).

### Features

- `FakerJSRecipeProcessor.processObjectDeclarationForYamlDocumentItem` now detects a `friends:` array on YAML object entries and recursively processes each child entry for every iteration of the parent's `count`
- When `count > 1` and a `friends:` block is present, each parent iteration receives a unique per-iteration nickname (e.g. `Account_1`, `Account_2`) so child lookup references resolve to distinct parents instead of all pointing to the same record
- Lookup field values in `friends:` entries that reference the parent's YAML nickname are automatically rewritten to the parent's effective per-iteration nickname via `replaceParentNicknameReferencesInFriendFields`
- The `_originalYamlNickname` internal field propagates the declared YAML nickname through recursive calls so grandchild lookup fields (referencing an intermediate parent's YAML nickname) are correctly rewritten when the intermediate parent is assigned a generated nickname
- Nested `friends:` blocks (grandchild objects) are processed recursively — each level inherits its parent's generated nickname as ancestry context
- Recipes with no `friends:` block are unaffected; output is identical to prior behavior
- `CollectionsApiService.updateLookupReferencesInCollectionApiJson` now sorts nickname entries by length descending before string replacement, preventing shorter nicknames (e.g. `account`) from corrupting longer ones (e.g. `child_account`) via substring collision
- New `FakerJSRecipeProcessor.buildRecipeDataStructureSummary` static method summarises expected record counts and hierarchy from a parsed recipe YAML
- `ExtensionCommandService.runFakerGenerationByRecipeFile` now displays a VS Code modal confirmation dialog showing the data structure summary before generating fake data, allowing the user to review and confirm before any records are created

---

## [2.10.0] - Custom Relationship Mappings for Lookup Field Hierarchy Resolution

Resolves [#47](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/47).

### 🎯 Major Features

#### 1. **`customRelationshipMappings` Config Property**

`treecipe.config.json` now supports an optional `customRelationshipMappings` property — a flat map keyed by `"ObjectApiName.FieldApiName"` whose value is the parent object API name. This lets developers manually resolve custom lookup fields whose XML metadata is missing the `<referenceTo>` tag, so those objects get grouped into the correct relationship tree and Treecipe files are generated with the right insertion order.

**Example:**

```json
{
    "salesforceObjectsPath": "force-app/main/default/objects",
    "dataFakerService": "snowfakery",
    "customRelationshipMappings": {
        "CustomObject__c.Primary_Contact__c": "Contact",
        "Project__c.Owner_Account__c": "Account"
    }
}
```

#### 2. **OOTB Map is Always Preserved**

Custom entries **extend**, never override, the built-in OOTB map (`AccountId → Account`). Lookup resolution checks the full `ObjectApiName.FieldApiName` key in the custom map first, then falls back to OOTB by `FieldApiName`. If a custom entry collides with an OOTB key, OOTB wins.

#### 3. **Graceful Handling of Invalid Keys**

Malformed custom keys (missing dot separator, empty object/field segment, multiple dots) are silently skipped — no crash, behavior matches the pre-existing "no relationship resolved" outcome.

### 🔧 Technical Details

- New `ConfigurationService.getCustomRelationshipMappings()` static getter — returns `{}` when the property is absent or null
- New `TreecipeConfigDetail.customRelationshipMappings?: Record<string, string>` interface field
- New `RelationshipService.getMergedReferenceLookupMap(customRelationshipMappings)` — returns OOTB map merged with valid custom entries
- New `RelationshipService.resolveParentReferenceForField(objectApiName, fieldApiName, customRelationshipMappings)` — resolves a parent for a Lookup/MasterDetail/Hierarchy field, custom-first, OOTB fallback
- `DirectoryProcessor` lazy-loads custom mappings once per processor instance and consults them at lookup-resolution time when XML `<referenceTo>` is absent
- Unit tests added for `ConfigurationService.getCustomRelationshipMappings` (present, absent, null)
- Unit tests added for `RelationshipService.getMergedReferenceLookupMap` and `resolveParentReferenceForField` (OOTB-only, custom extends OOTB, OOTB never overridden, invalid keys skipped, fallback chain)

### 🧭 Out of Scope (Tracked Separately)

- Recipe YAML field-level content generation for custom lookup fields (`friends` block / dynamic relationship references)
- Distinguishing `Lookup` vs `MasterDetail` field types in custom mappings
- Overriding OOTB entries with custom mappings
- VS Code UI for editing custom mappings

---

## [2.9.0][PR#37](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/37) - Mermaid ERD Dedicated File & MermaidService Extraction

### 🎯 Major Features

#### 1. **Dedicated Mermaid ERD Markdown File**

The Mermaid entity relationship diagram has been moved out of the SOQL/SOSL template file and into its own dedicated companion file (`mermaid-erd--{tree-name}-{timestamp}.md`). This separates concerns: the SOQL/SOSL template file focuses purely on query templates, while the ERD file stands alone for diagram rendering and documentation.

**File naming:** `mermaid-erd--{treecipeTopToBottomLevelName}-{timestamp}.md` — written into the same subfolder as the recipe YAML and SOQL template.

#### 2. **Titled Mermaid ERD File**

The dedicated ERD file includes a descriptive header and explanatory prose before the diagram:

- `# Entity Relationship Diagram` title
- Description of what the diagram shows (typed fields, relationship cardinalities)
- Explanation of `|o--o{` (Lookup, optional parent) vs `||--o{` (MasterDetail, required parent) notation
- Generated timestamp and object list
- Cross-tree exclusion note

#### 3. **MermaidService Extraction**

Mermaid ERD generation logic has been extracted from `SOQLTemplateService` into a dedicated `MermaidService` (`src/treecipe/src/MermaidService/`), following the existing service-per-folder pattern. `SOQLTemplateService` delegates ERD generation to `MermaidService`.

### 🔧 Technical Details

- New `MermaidService` class with `buildMermaidERD()`, `generateMermaidMarkdown()`, and `generateMermaidMarkdownForTree()` methods
- `DirectoryProcessor` writes both `soql-sosl-templates--*.md` and `mermaid-erd--*.md` per recipe tree
- SOQL/SOSL template file no longer contains the `## Entity Relationship Diagram` section
- Unit tests added for `MermaidService`; `SOQLTemplateService` tests updated to reflect ERD removal

---

## [2.8.0][PR#36](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/36) - Feature: SOQL & SOSL Query Template Builder

### 🎯 Major Features

#### 1. **Per-Tree SOQL & SOSL Query Template File**

Each generated Treecipe recipe folder now includes a companion Markdown file (`soql-sosl-templates--{tree-name}-{timestamp}.md`) alongside the recipe YAML. The file is scoped to the objects in that specific relationship hierarchy — one template file per relationship tree, not one combined file for all objects.

**File location:** written into the same subfolder as the recipe YAML (e.g., `Account-thru-OrderItem/`).

#### 2. **Mermaid Entity Relationship Diagram**

The template file opens with a `mermaid erDiagram` block showing all entities and relationships for that tree:

- Object fields rendered as typed attributes (`string`, `number`, `date`, `datetime`, `boolean`)
- Lookup fields rendered as `|o--o{` relationship lines (optional parent)
- MasterDetail fields rendered as `||--o{` relationship lines (required parent)
- Cross-tree relationships intentionally excluded — the diagram reflects only the objects in the current recipe

#### 3. **Per-Object SOQL Query Sections**

For each object in the tree, the template includes:

- **Base Query** — `SELECT Id, <all fields> FROM Object__c`
- **Child-to-Parent Queries** — one per Lookup/MasterDetail field, using relationship dot-notation (`Account.Name`) with up to five parent fields traversed
- **Parent-to-Child Queries** — subquery per child object in the same tree (`SELECT Id, ... FROM ChildRelationship__r`)
- **Record Type Filtered Queries** — one `WHERE RecordType.DeveloperName = 'X'` variant per detected record type
- **SOSL Template** — `FIND {searchTerm} IN ALL FIELDS RETURNING Object(text-fields)` scoped to text-type fields only

### 🔧 Technical Details

- New `SOQLTemplateService` follows the existing service-per-folder pattern (`src/treecipe/src/SOQLTemplateService/`)
- `generateSOQLTemplateMarkdownForTree(objectInfoWrapper, treeObjectNames, timestamp)` filters the full wrapper to only the tree's objects, guaranteeing cross-tree isolation in both queries and the ERD
- `buildParentToChildSubqueries` skips children not present in the current filtered wrapper, preventing cross-tree relationship bleed
- Integration point: `DirectoryProcessor.createRecipeFilesInSubdirectory()` calls the service inside the per-recipe-file loop, immediately after writing the YAML, using the same `treecipeTopToBottomLevelName` in the filename
- 38 unit tests added in `SOQLTemplateService/tests/`

---

## [2.7.0] [PR#35](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/35) - Feature: Enhanced Text & Numeric Field Precision Handling

### 🎯 Major Features

#### 1. **Text and Numeric Value Constraints**
Added new methods for building text and numeric recipe values with constraints, enhancing control over generated data ranges and formats.

### 🔧 Technical Details

**Code Example - Currency Field XML to FakerJS YAML**:

Given a custom object field XML markup with precision and scale:

```xml
<fields>
  <fullName>Price__c</fullName>
  <description>Product price</description>
  <externalId>false</externalId>
  <label>Price</label>
  <precision>8</precision>
  <required>false</required>
  <scale>2</scale>
  <type>Currency</type>
  <unique>false</unique>
</fields>
```

The generated recipe automatically creates a faker expression that respects the precision (8) and scale (2):

```yaml
- object: My_Custom_Object__c
  fields:
    Price__c: ${{ faker.finance.amount({ min: 0, max: 999999, dec: 2 }) }}
```

This ensures the generated currency values:
- Have at most 8 total digits (precision)
- Have exactly 2 decimal places (scale)
- Are within the valid range (0 to 99,999.99)
- Match Salesforce field constraints

## [2.6.0] [PR#34](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/34) - Feature: Relationship Service & Bug Fix for Special Characters in Picklists

### 🎯 Major Features

#### 1. **Comprehensive Relationship Service **

Generating recipes command, now creates relationship "Treecipe" files. 

Each Treecipe file is a set of related objects that are attached based on their xml markup.

Based on your source code and the relationships definied with in each field's xml, there could be one or many Treecipe files created. 

This Treecipe will also be created so that each object is inerted based on the hiearchy of objects in the Treecipe file.

#### 2. **Bug Fix: Special Characters in Picklist Values**
Fixed critical bug where picklist values containing special characters (`&`, `'`, etc.) were breaking FakerJS expression generation.

**Problem**: Picklist values like "Beaches & Snorkeling" or "Family & Kids' Activities" were causing syntax errors when wrapped in single quotes.

**Solution**: Changed from single quotes to backticks (template literals) in `FakerJSRecipeFakerService`:
- `buildPicklistFakerArraySingleElementSyntaxByPicklistOptions()`: Now uses `` `${option}` ``
- `buildMultPicklistFakerArrayElementsSyntaxByPicklistOptions()`: Now uses `` `${option}` ``

**Benefits**:
- Natural handling of all special characters without escaping
- Consistent format across all picklist/multiselect expressions
- Future-proof for any special characters in picklist values
- No breaking changes to existing functionality

### 🧪 Testing

- Added comprehensive mock infrastructure for testing complex relationships
- Created `MockRelationshipService` with 7 pre-configured test scenarios
- Updated all picklist-related tests to use backtick format
- Added test validation for fields with XML entities (`&amp;`, `&apos;`)
- Created detailed test documentation with visual relationship diagrams

### 📝 Documentation

- Added scenario-specific markdown files documenting complex relationship patterns
- Included ASCII diagrams for visual understanding of object hierarchies
- Provided clear examples of expected sort orders and dependencies

### 🔧 Technical Details

**Files Modified**:
- `src/treecipe/src/RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService.ts`
- `src/treecipe/src/RecipeService/tests/FakerJSRecipeService.test.ts`
- `src/treecipe/src/XMLProcessingService/tests/mocks/XMLMarkupMockService.ts`
- `src/treecipe/src/RelationshipService/tests/RelationshipService.test.ts`
- `src/treecipe/src/RelationshipService/tests/mocks/MockRelationshipService.ts`

**New Test Documentation** (with Mermaid diagrams):
- [Scenario 3: Linear Chain with Multiple Children](src/treecipe/src/RelationshipService/tests/test-scenario-3-linear-chain.md)
- [Scenario 7: Diamond Pattern](src/treecipe/src/RelationshipService/tests/test-scenario-7-diamond-pattern.md)

## [2.5.1] [PR#33](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/33) - Bug : 2.5.1

Initial approach to capturing GlobalValueSets assumed that the singleton would be reset with every invocation of the "Generate Recipe" command.

This was far from how VS Code session and state management function lol

Instead of checking if the singleton was already initialized, we assume we need to retrieve the global value sets with every invocation. This allows for making updates to GlobalValueSet markup and files and re-running the Generate Recipe command and getting the updated faker function based on the latest from the Global Value Sets directory

## [2.5.0] [PR#32](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/32) - Feature : 2.5.0

### Global Value Set Map for avoiding additional TODO's when generating recipes from code base

To round out the remaining drivers of scenarios that drive the generation of picklist values, we have added GlobalValueSets.

This functionality is dependent upon there being a dedicated directory named "globalValueSets" that contain files with expected GlobalValueSet XML markup.  

This functionality relies on a singleton to initiate the a map of GlobalValueSets to associated available picklist values which mapps out to expected faker expressions for picklist fields.


## [2.4.0] [PR#29](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/29) - Feature : 2.4.0

### Standard Value Set Map for avoiding additional TODO's when generating recipes from code base

When generating recipes based on source code, there tends to be references to standardValueSets that require extra efforts to get their associated picklist values in a faker function because the OOTB standard value sets are picklists WITHOUT any necessary xml markup capturing what values make up the picklist.

This feature created a dedicated field api name to picklist values to allow for local management of OOTB standardPicklistValues.

It's not an exhaustive list but is a start and can be easily added on to.

## [2.3.0] [PR#27](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/27) - Feature : 2.3.0

Feature: Leverage nickname property from yaml object recipe that can combine with unique "record reference key" to allow for lookup reference replacements. 

With this update we can now leverage the yaml property "nickname" on a parent object.  When a child object needs to reference a parent to populate for a lookup or masterdetail field, it can provide the nickname as its value:

```yaml

- object: Account
  nickname: ParentAccountNickname
  fields:
    Name: ${{ faker.company.name() }} 

- object: Contact
  fields:
    FirstName: ${{ ... }}
    LastName: ${{ ... }}
    AccountId: ParentAccountNickname

```

## [2.2.0] [PR#26](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/26) - Feature : 2.2.0

Feature: Variable syntax capabilities using faker-js recipes

[Quick YouTube Walkthrough to reuse generated Date field](https://youtu.be/qiO35RUnq8U)

A great feature to snowfakery is [leveraging variable definitions](https://snowfakery.readthedocs.io/en/latest/index.html#define-variables). When generating fake data is the ability to reuse previously generated values, constants or hardcoded variable names. With this update, faker-js based recipes can leverage variable syntax as well.

This functionality introduces a way for specific variable syntax to be leveraged in fake data recipe generation.

```yaml

- var: dinoName 
  value: "indominous"

- var: animatedHero 
  value: batman

- var: randomDate
  value: |
    ${{ faker.date.between({ from: new Date('2023-01-01'), to: new Date('2023-02-01') }).toISOString().split('T')[0] }}

- var: multipicklistFood
  value: ${{ (faker.helpers.arrayElements(['chorizo','pork','steak','tofu'])).join(';') }} 

- object: Account
  count: 1
  nickname: AccountWithCustomFieldsSetByVariables
  fields:
    VarDate__c: ${{ var.randomDate }}    
    VarAnimatedHero__c: ${{ var.animatedHero }}
    VarDinoName__c: ${{ var.dinoName }} 
    VarFood__c: ${{ var.multipicklistFood }}

```

## [2.1.0] [PR#25](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/25) - Feature and Bug Fix: 2.1.0

When generating recipes error handling was not granular and provided no specific detail into what Salesforce field in the local project base was causing an issue. This functionality wraps the field processing service in a try/catch and generates a error details page for self-service troubleshooting.

BUGFIX - as part of this work, there was a bug discovered for dependent picklists and global picklist markup. This update provides functionality that provides necessary logic to prevent recipe generation failure at run time.

## [2.0.4] [PR#21](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/21) - Bug: 2.0.4

Fix for extension error "Command Not Found" -- added "faker-js" into package.json dependencies instead of devDependencies configuriation

## [2.0.3] [PR#18](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/19) - Bug: 2.0.3

Third attempt to fix issue with "Command Not Found"

## [2.0.2] [PR#18](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/18) - Bug: 2.0.2

Second attempt to fix issue with "Command Not Found"

## [2.0.1] [PR#17](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/17) - Bug: 2.0.1

Attempting to fix issue with "Command Not Found"

## [2.0.0] [PR#16](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/16 )- Feature: Introducing "faker-js" as a native node module for generating fake values

Based upon the same YAML file approached used with snowfakery, this update introduces three capabilities to support a faker-js option to generating YAML recipe files and processing the generated faker recipes to production-like data:

1. New extension command to switch between snowfakery-cli and faker-js processors
2. FakerJSRecipeFakerService: based on inputs from field xml, provides expected syntax needed for faker-js recipe processor to work as expected
3. FakerJSRecipeProcessor: Given expected inputs within expected expression syntax indicators "${{ }}" , this processor will either evaluate the faker expression as expected or it will take additional expected outputs surrounding the syntax indicators and build structures to create an output that represents an accepted value structure for Salesforce field types ( Text, dependent picklist , multipicklist, and more )
4. In addition to the two new FakerJS files, the existing FakerRecipeService and FakerServiceProcessor files were renamed to be specific for snowfakery, "SnowfakeryFakerRecipeService" and "SnowfakeryServiceProcessor". This is to clearly describe file names containing expected handling logic for either snowfakery or faker-js. 
5. Custom functions for date and datetime field types for FakerJSRecipeProcessor similar to Snowfakery. 
6. Non-intrusive info box for inserting data sets  (doesn't prevent anything from being done in VS Code and shows the status of the files being processed)
7. On Non-intrusive progress window, selecting "Cancel" button will initiate "Delete Previous Records" functionality that will delete any saved records of that run
  

## [1.3.0] [PR#15](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/15) - Feature: Salesforce OOTB boilerplate faker recipes for several OOTB objects like Account, Contact 

- main feature - OOTB boilerplate recipe markup for several Salesforce CRM objects
- others 
  - added "TODO" verbiage for Picklist fields without xml valueSet markup. The verbiage indicates that the picklist field may need options from a standard value set or global value set
  - refactored RecordTypeService
  - added new unit tests to manage for several different scenarios of picklist xml markup
  - adding changelog :) 


## [1.2.1] [PR#13](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/13) - Bug: logic always expects a record types directory to exist under the custom object directory  

- bug fix stemming from record type logic always expecting a record types directory to exists and record type configurations to build picklists and multiselect picklists from


## [1.2.0] ([PR#12](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/12)) - Feature: Insert Created Datasets with Collections API Service 

- Takes expected artifacts already in Collections API format, generates "proof" artifacts, attempts insert of pre-structured files, and adds insert success/failure results in same timestamped directory as "proof" artifacts. 
- significant refactoring needed to properly setup proof files and introduce new "RecordTypeWrapper" object that incorporates a map of "RecordType.DeveloperName" to unique Record Type Id based on the targeted Salesforce org we are attempting to insert data against
- brief description of each file change below



## [1.1.0] ([PR#10](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/10)) - Feature: Source Record Type parsing for Record Type based Picklists and Multiselect Picklists  

- Introduce logic to parse the "recordTypes" directory within an objects directory and generate a key-value map of record type to associated xml markup details 
- updated unit tests to ensure scenarios where record types are included in the source directory, the generated recipes include the expected record type associated picklist options



## [1.0.0] ([PR#9](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/9)) - Feature: new command pallette option that prompts the User to select a previously created recipe file and executes the snowfakery cli command to generate fake data 

- New Extension command -> Run Snowfakery by Recipe File
  - Executing command will prompt to choose a recipe file to generate fake data from.  These files are found in the path "treecipe/GeneratedRecipes" 
  - Upon recipe file selection, snowfakery cli is executed against the recipe yaml file and results are outputted to json.
  - json is then formatted for for collections api a new timestamped "dataset" directory is created under the folder path "treecipe/FakeDataSets" and within this two files will be created under this directory:
    - The collectionsApi formatted file that has the recipe that generated it
    -  the originating recipe file that lead to the generated fake data
  - If snowfakery cli is not installed on your machine, an exception will be thrown 



## [0.2.1] ([PR#8](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/8)) - Bug: object variable being populated with full objects path instead of intended parsing of the path to get the object name 

- new features - organization - dedicated directory called "GeneratedRecipes" where all new recipes will be placed instead of alongside the root of treecipe folder
- fix windows bug where instead of last segment of path is returned to "object" yaml property, returns whole path:
![image](https://github.com/user-attachments/assets/8eb082af-83d7-40ac-a985-8ec75684bdc9)
- development tooling - new custom vscode task to open jest coverage results in browser and adjusting other jest custom task to create coverage files in coverage directory locally
- significant refactoring of DirectoryProcessor as unit tests were built to support validation of functionality and abstract away logic that could be in isolated methods ( DirectoryProcessor.ts also includes bug fix
- testing support - new methods in MockDirectoryService to mimic vscode.workspace.fs.readDirectory mocking and mocking vscode workspace
- new test suite for ErrorHandlingService



## [0.2.0] ([PR#5](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/5)) - Bug: Graceful error handling when recipes do not generate and associated Support Functionality 

- Introduces a error handling service around all available Treecipe VSCode extension commands
  - error handling includes VSCode Alerts that can:
     - auto-generate GitHub Issue in this repository with templated details needed to reproduce and triage
     - auto-rerun of extension command ( if the Generate Treecipe command is ran without being an initiated treecipe config file, a button is available to auto start the initiate command
  - standardize forward-slashes for objects path on creation of the treecipe.config.json file
  - gracefully handle OOTB Salesforce fields that do not have expected XML tags like "type".  
    - In the event of these scenarios, the recipe field is still generated for awareness and given a value of "REMOVE ME AS I MAY NOT BE ABLE TO GENERATE BECAUSE I AM OOTB FIELD LIKE Id or AccountNumber  


## [0.1.1] ([PR#3](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/3)) - Bug: Snowfakery configuration value casing issue 

- updates the bug fix along with associated jidoka ( countermeasure) tests to validate this scenario occurring again or not
- fix  casing issues with selected faker service type for snowfakery

---

- Initial release

## [0.1.0] ([PR#1](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/1)) - Configiuration service for faker service selection 

 - initial setup for factory pattern "choose your faker service" and associated VSCodeWorkplace and Extension Configuration Management based on faker service choice ( setting, getting configuration values )
 - faker service introduced refactoring needs for separating out expected recipe values in RecipeService into two dedicated recipe providers ( NPMFakerService, SnowfakeryFakerService) - NPMFakerService is not used at the moment and this entire setup was excessive from an actual usage stand point. I did learn some fun stuff and got to apply the factory pattern. In the future, the faker service could be chosen as part of configuration setup. For now it defaults to "Snowfakery"
 - Associated unit tests and supported mock service
 - GitHub Actions for automated jest tests validation and publishing jobs
