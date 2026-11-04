# Picklist dependency writeback — design notes

Design notes moved out of CLAUDE.md (#563). Read this before changing the service; CLAUDE.md keeps only the rules every change must follow. History is in CHANGELOG.md.

- **The transpose is the writeback's whole reason to exist** — a validator failure is indexed by *controlling* value (`cle @ missing [plant]`) while `valueSettings` is indexed by *dependent* value (`plant ← cle`), so acting on a failure by hand means editing a block the message never names. `PicklistDependencyMetadataWriterService` owns that direction; keep it one function with one direction
- **Anything spanning a run is keyed by object AND field** — a run reconciles every per-object spec class at once, and field api names repeat across objects (`Status__c` on Account and on Case). `PicklistDependencyMetadataWriterService.buildFieldKey` is the one place that shape is defined; use it for every path map, dependency-graph key and report line rather than the bare field api name
- **Writeback merges intent, it does not substitute for it** — a spec asserts what a controlling value must and must not unlock; anything it names neither way it makes no claim about. Only `expectNone` and `expectExactly` are exhaustive and may remove. Reading silence as deletion would let a one-line spec strip a file
