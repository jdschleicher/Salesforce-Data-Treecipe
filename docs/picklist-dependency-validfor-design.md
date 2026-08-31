# Technical Design: Reading Picklist Dependencies via the `validFor` Bitmap

This document captures the single most load-bearing (and least obvious) mechanism in the
Picklist Dependency Validation Framework: how the Apex source
(`force-app/main/default/classes/PicklistDependencyFramework/SchemaPicklistDependencySource.cls`)
reads dependent-picklist rules out of a Salesforce org without a callout, and why it does it
the way it does.

The framework itself (specs, validator, generated test classes, VS Code commands) is
documented in `scripts/picklist-dependency-demo/README.md` and the main `README.md`. This
document covers only the data-acquisition layer underneath it.

---

## The plain-language version

When an admin sets up a dependent picklist in Setup ("City depends on State; when State =
Ohio, allow Columbus and Cleveland"), they tick checkboxes in a matrix of controlling values
× dependent values.

Salesforce stores that matrix and, whenever an API describes the field, serves each
dependent value's row of the matrix as a field called **`validFor`**: a base64 string that
is really a row of bits, one bit per controlling value. Bit *i* on means "this dependent
value is allowed when the controlling field is set to its *i*-th value."

The catch: **Apex has no official way to read `validFor`.** `Schema.PicklistEntry` exposes
only `getLabel()`, `getValue()`, `isActive()`, and `isDefaultValue()` — no `getValidFor()`.
The data is on the underlying object; Salesforce just never wrote an Apex getter for it.

The workaround this framework uses: `JSON.serialize(picklistEntry)` serializes the *whole*
underlying object, including the hidden `validFor` key. Deserialize that JSON, pull out the
string, and decode the bits by hand. This is a long-standing, community-known loophole, not
a documented feature — the guards described below exist for exactly that reason.

## Who generates `validFor`

Nothing in this repository generates it. The chain is:

```
Admin clicks checkboxes in Setup (Field Dependencies)
        ↓
Salesforce saves the dependency matrix
        ↓
Salesforce's describe engine encodes each dependent value's row
as a bitmap and serves it (base64) as validFor
        ↓
SchemaPicklistDependencySource reads it (JSON trick) and decodes
the bits back into controlling-value indexes
```

The bitmap is compactness only: a controlling picklist with 100 values costs 100 bits
(~17 base64 characters) per dependent value instead of a list of names.

## What Salesforce documents — and what it does not

`validFor` is an officially documented field of the platform's describe result; **reading it
from Apex via JSON serialization is not documented anywhere**. The doc trail, per API:

- **SOAP API — `DescribeSObjectResult` → `PicklistEntry` → `validFor`.** The one place the
  field itself is documented, including that it is set only for dependent picklists and
  indicates which controlling values make the entry valid:
  <https://developer.salesforce.com/docs/atlas.en-us.api.meta/api/sforce_api_calls_describesobjects_describesobjectresult.htm>
- **Apex Reference — `Schema.PicklistEntry`.** Documents exactly four methods
  (`getLabel`, `getValue`, `isActive`, `isDefaultValue`) and no `getValidFor` — the gap
  this framework works around:
  <https://developer.salesforce.com/docs/atlas.en-us.apexref.meta/apexref/apex_class_Schema_PicklistEntry.htm>
- **UI API — Picklist Values response.** Returns the same information already decoded:
  each picklist value carries a `validFor` array of controlling-value **indexes**, and the
  field's `controllerValues` map names each index. This is the source used to
  cross-verify the bit order (including `{"false": 0, "true": 1}` for checkboxes):
  <https://developer.salesforce.com/docs/atlas.en-us.uiapi.meta/uiapi/ui_api_responses_picklist_value.htm>
- **Metadata API — `CustomField` → `ValueSet` → `valueSettings`.** How the dependency is
  *authored* in source format (`controllingFieldValue` per dependent value; checkboxes
  spelled `checked`/`unchecked` here, unlike describe's `true`/`false`):
  <https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/customfield.htm>

The `JSON.serialize(Schema.PicklistEntry)` behavior that exposes `validFor` to Apex is a
long-standing community-known loophole with no official contract behind it. If a URL above
drifts, search developer.salesforce.com for the page titles given — the section names are
stable even when the atlas paths move.

## The encoding, precisely

- `validFor` is base64. Decoded, it is a byte array read **most-significant-bit first**:
  bit index 0 is the **high bit of the first byte** (`0x80`), bit index 1 is `0x40`, bit
  index 8 is the high bit of the second byte, and so on.
- Bit index *i* refers to the *i*-th value of the **controlling** field, in the controlling
  field's own `getPicklistValues()` order. This was verified against the UI API's
  `controllerValues` map, which reports identical indexes.
- **Checkbox controlling fields** report no picklist values of their own. Their index order
  is `false` = 0, `true` = 1 — and getting that backwards silently inverts every result for
  a checkbox-controlled picklist. Verified in a live org: a dependent value requiring the
  checkbox CHECKED serializes as `"QAAA"` (bit 1) and one requiring it UNCHECKED as
  `"gAAA"` (bit 0); the UI API agrees (`controllerValues = {"false": 0, "true": 1}`). Note
  the Metadata API spells these values `checked`/`unchecked` in `valueSettings`, but
  describe and the UI API both key them `true`/`false`, which is what a spec must use.
- The bitmap can carry **padding bits** beyond the controlling value count; they are
  ignored. It can also be **shorter** than the requested count; decoding stops at the end
  of the data rather than throwing.
- A **non-dependent** picklist serializes `validFor` as `null`, which decodes as "valid for
  nothing" — that is a normal state, not an error.

Worked examples (all pinned by tests in `SchemaPicklistDependencySourceTest.cls`):

| base64 | bytes | set bit indexes | meaning |
|---|---|---|---|
| `gAAA` | `80 00 00` | 0 | valid only for controlling value #1 |
| `QAAA` | `40 00 00` | 1 | valid only for controlling value #2 |
| `wAAA` | `C0 00 00` | 0, 1 | valid for the first two controlling values |
| `AIAA` | `00 80 00` | 8 | valid only for controlling value #9 |
| `null` / `""` | — | none | not a dependent picklist |

The decoder (`decodeValidForIndexes`) works a hex nibble at a time: bit *i* lives in nibble
`i / 4` at position `3 - (i mod 4)`.

## Why this path was chosen

| Alternative | Why it was rejected |
|---|---|
| `ConnectApi.UiApi` from Apex | **Does not exist.** Deploy fails with `Variable does not exist: ConnectApi.UiApi`. (This was the framework's first attempt.) |
| UI API via REST callout | Returns the dependency map already decoded (`controllerValues`), but requires Remote Site / Named Credential setup in every target org, and **callouts cannot run inside `@IsTest` at all** — which would break the generated test classes that are the whole point of the framework. |
| Tooling / Metadata API | Same callout constraints, plus async deploy semantics. |
| SOAP describe (Partner/Enterprise API) | Exposes `validFor` as a byte array, but only from outside the org — not reachable from Apex. |
| **Schema describe + JSON serialization (chosen)** | No callout, no SOQL, no org setup, works inside `@IsTest`. The price is decoding the bitmap by hand and depending on an undocumented serialization detail. |

Because the whole validator runs every spec in one transaction, "no callout, no SOQL"
also means CPU is the only binding governor limit; the describe caching in
`SchemaPicklistDependencySource` addresses that (measurements are in the class header).

## Guards against the undocumented dependency

The JSON loophole could change under us in a platform release. The design assumes it will
be noticed loudly, not absorbed silently:

1. **Loud failure on a missing key.** Once `getController()` proves a field is dependent,
   every entry must carry a bitmap — a value valid for nothing still serializes as all-zero
   bits, not `null`. An absent `validFor` on a dependent field therefore means the
   serialization contract changed, and `fetch()` throws rather than reporting
   `MISSING_VALUES` on every spec (which would read like an admin deleted the dependency
   configuration).
2. **Bit-order pinned by tests.** `SchemaPicklistDependencySourceTest` asserts the table
   above directly (`decodesASingleSetBitToItsControllingValueIndex` and siblings), so a
   change to the MSB-first convention or the index order fails unit tests, not production
   decoding.
3. **Checkbox ordering pinned by tests**, including against the org's own serialization
   (`checkboxControllingValuesAreOrderedFalseThenTrue`,
   `checkboxIndexOrderDecodesTheSameWayTheOrgReportsIt`) — because reversing it inverts
   every checkbox-controlled result while everything still "works".
4. **End-to-end verification against a real dependency** is done by the anonymous Apex
   runner and the demo walkthrough (`scripts/picklist-dependency-demo/`), since no org is
   guaranteed to ship with a dependent picklist to unit-test against.

## Reproducing from a completely blank org

A blank org has no dependent picklists, so seeing a real bitmap takes one Setup step first.

**1. Prove the hidden key exists (works immediately, anonymous Apex):**

```apex
Schema.PicklistEntry entry = Account.Industry.getDescribe().getPicklistValues()[0];
System.debug(JSON.serialize(entry));
// {"active":true,"defaultValue":false,"label":"Agriculture","validFor":null,"value":"Agriculture"}
```

`validFor` is present despite `Schema.PicklistEntry` having no getter for it, and `null`
because Industry is not dependent.

**2. Create a dependency in Setup (~2 minutes, no code).** On Account: a picklist
`Controlling__c` with values `A`, `B`; a picklist `Dependent__c` with values `X`, `Y`;
then Field Dependencies → include `X` under `A` and `Y` under `B`.

**3. Dump and decode the real bitmap (anonymous Apex):**

```apex
Schema.DescribeFieldResult dep = Schema.getGlobalDescribe()
    .get('Account').getDescribe()
    .fields.getMap().get('Dependent__c').getDescribe();

Schema.DescribeFieldResult ctrl = dep.getController().getDescribe();

List<String> controllingValues = new List<String>();
for (Schema.PicklistEntry e : ctrl.getPicklistValues()) {
    controllingValues.add(e.getValue());
}
System.debug('Controlling values in bit order: ' + controllingValues);

Map<String, Integer> hexMap = new Map<String, Integer>{
    '0'=>0,'1'=>1,'2'=>2,'3'=>3,'4'=>4,'5'=>5,'6'=>6,'7'=>7,
    '8'=>8,'9'=>9,'a'=>10,'b'=>11,'c'=>12,'d'=>13,'e'=>14,'f'=>15
};

for (Schema.PicklistEntry e : dep.getPicklistValues()) {

    Map<String, Object> raw = (Map<String, Object>) JSON.deserializeUntyped(JSON.serialize(e));
    String validFor = (String) raw.get('validFor');

    List<String> allowedFor = new List<String>();
    String hex = EncodingUtil.convertToHex(EncodingUtil.base64Decode(validFor)).toLowerCase();
    for (Integer i = 0; i < controllingValues.size(); i++) {
        Integer nibble = hexMap.get(hex.substring(i / 4, i / 4 + 1));
        if (((nibble >> (3 - Math.mod(i, 4))) & 1) == 1) {
            allowedFor.add(controllingValues[i]);
        }
    }

    System.debug(e.getValue() + ' -> validFor=' + validFor + ' -> allowed when Controlling = ' + allowedFor);
}
```

Expected (the base64 length may vary — `gA==` vs `gAAA` — the bits are what matter):

```
Controlling values in bit order: (A, B)
X -> validFor=gA== -> allowed when Controlling = (A)
Y -> validFor=QA== -> allowed when Controlling = (B)
```

## Where the decode is consumed

`decodeValidForIndexes` is called only from `SchemaPicklistDependencySource.fetch()`, which
builds the `PicklistDependencySnapshot` the validator compares specs against. From there:

```
VS Code command "Run Picklist Dependency Check"
  → deploys generated SFTreecipePicklistDependencySpecs(+Test) with the framework
    → PicklistDependencyValidator.run(specs, new SchemaPicklistDependencySource())
      → fetch() per spec: describe → JSON trick → decodeValidForIndexes
        → snapshot compared against the spec's expectations
          → PASS, or a Failure naming object.field @ "value" and what drifted
```
