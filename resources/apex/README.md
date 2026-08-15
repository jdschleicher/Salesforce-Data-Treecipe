# Bundled Apex picklist dependency framework

These files are the Apex classes that a generated `PicklistDependencySpecs.cls` compiles against.
They are **mirrors** of `force-app/main/default/classes/` — that directory is the source of truth.

They exist here because `.vscodeignore` excludes `force-app/**` from the published `.vsix`, so an
extension user would otherwise receive a generated specs class with nothing to compile against. The
**Generate Picklist Dependency Tests** command copies any missing file from this directory into the
user's package directory alongside the specs class it writes.

## Keeping them in sync

Do not edit these copies. Edit `force-app/main/default/classes/` and copy the result here:

```bash
for c in IPicklistDependencySource PicklistDependencySnapshot PicklistDependencyReport \
         PicklistDependencySpec PicklistDependencyValidator SchemaPicklistDependencySource; do
    cp "force-app/main/default/classes/$c.cls" "force-app/main/default/classes/$c.cls-meta.xml" resources/apex/
done
```

`PicklistDependencyTestService.test.ts` asserts every file here is byte-identical to its `force-app`
counterpart, so drift fails the test suite rather than shipping a stale framework.

`StubPicklistDependencySource` is deliberately absent — it exists only for the framework's own Apex
tests and should never be scaffolded into a user's org.
