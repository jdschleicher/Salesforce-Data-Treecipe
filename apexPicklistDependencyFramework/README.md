# apexPicklistDependencyFramework

The Apex source for the picklist dependency validation framework. This is the **only** Salesforce
metadata in this repository, and this repository is deliberately **not** a Salesforce DX project —
there is no `sfdx-project.json` or `force-app/` here. Anything that needs to deploy this Apex
stages a throwaway DX project on the fly (see the demo harness below), the same way the Trailhead
"quick start" tutorials do.

## Layout

```
apexPicklistDependencyFramework/
├── SDTPicklistDependencyFramework/   SHIPPED — packaged into the .vsix
│   ├── ISDTPicklistDependencySource.cls
│   ├── SDTPicklistDependencySpec.cls
│   ├── SDTPicklistDependencySnapshot.cls
│   ├── SDTPicklistDependencyReport.cls
│   ├── SDTPicklistDependencyValidator.cls
│   └── SDTSchemaPicklistDependencySource.cls
└── frameworkApexTests/               DEV-ONLY — never shipped
    ├── SDTPicklistDependencyValidatorTest.cls
    ├── SDTSchemaPicklistDependencySourceTest.cls
    └── SDTStubPicklistDependencySource.cls
```

## `SDTPicklistDependencyFramework/` — shipped runtime classes

The six runtime classes the generated contract depends on. The **Generate Picklist Dependency
Tests** command emits `SDTPLDSpecs.cls`, one `SDTPLDSpecs_<Object>.cls` per object, and
`SDTPLDSpecsTest.cls` into the *user's* DX project — and those generated classes call
`SDTPicklistDependencyValidator`, `SDTPicklistDependencySpec`, and the rest of this framework, so
they cannot compile without it.

That is why this folder ships inside the extension package: `.vscodeignore` excludes this whole
directory and then negates exactly this subfolder back in, and
`PicklistDependencyTestService.scaffoldMissingFrameworkClasses` copies these files from the
installed extension into the user's package directory (under
`classes/SDTPicklistDependencyFramework/`) whenever they are missing. The folder name is part of
that contract — it must match `PicklistDependencyTestService.frameworkDirectoryName`.

**If you add, rename, or remove a class here**, update `frameworkClassNames` in
`PicklistDependencyTestService.ts` and the demo harness's `$FrameworkClassNames`, or the new class
silently never ships.

## `frameworkApexTests/` — the framework's own unit tests

Apex unit tests for the framework itself (plus the stub dependency source they use). These are this
repository's quality gate for the Apex it ships; they are excluded from the `.vsix` and are never
scaffolded into a user's project.

They need an org to run against. The demo harness deploys them for you, or by hand:

```bash
# stage a throwaway DX project and deploy framework + tests into a scratch org
sf project generate --name sdt-apex-tests --template standard
cp -r apexPicklistDependencyFramework/SDTPicklistDependencyFramework sdt-apex-tests/force-app/main/default/classes/
cp apexPicklistDependencyFramework/frameworkApexTests/* sdt-apex-tests/force-app/main/default/classes/
cd sdt-apex-tests && sf project deploy start --target-org <alias>

# then, from anywhere:
npm run apex-test          # sf apex run test --tests SDTPicklistDependencyValidatorTest ...
```

## End-to-end verification

`scripts/picklist-dependency-demo/Invoke-PicklistDependencyDemo.ps1` is the full walkthrough: it
generates a scratch DX project (writing `sfdx-project.json` and the scratch definition on the fly),
copies this framework into it, scaffolds sample dependent-picklist metadata, generates the
contract, and proves the check passes, fails on drift, and passes again after regeneration. See its
README in the same folder.
