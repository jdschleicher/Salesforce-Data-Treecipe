# Tasks

## In Progress

<!-- Move items here when actively working on them -->

## Backlog

### Feature: SOQL/SOSL Query Template Builder

Generate a query template file alongside each Treecipe recipe, giving developers ready-to-use SOQL and SOSL queries based on the actual object metadata parsed from source.

**Goal:** After the directory is parsed and relationships/lookups are resolved, write a `.soql-templates.txt` (or `.md`) file per object (or one combined file) that captures every meaningful query scenario for that object.

**Scope:**

- [x] Generate a base `SELECT <all fields> FROM <Object>` query per object using every field found in source XML
- [ ] Generate filtered variants: one per indexed field (`<externalId>true</externalId>`, `<unique>true</unique>`)
- [x] Generate relationship (JOIN) queries for every Lookup and MasterDetail field — both parent-to-child (`SELECT Id, (SELECT Id FROM ChildObjects__r) FROM ParentObject__c`) and child-to-parent (`SELECT Id, ParentObject__r.Name FROM ChildObject__c`)
- [x] Generate SOSL templates: `FIND {searchTerm} IN ALL FIELDS RETURNING <Object>(<fields>)` scoped to text-type fields
- [x] Include record type filters where record types are detected (`WHERE RecordType.DeveloperName = 'X'`)
- [x] Integrate as a post-step in `RecipeService` — runs after YAML generation, writes template file(s) to the same output directory
- [x] New service: `SOQLTemplateService` following existing service-per-folder pattern with `tests/` subfolder
- [x] Tests: unit tests with mock XML fixtures covering simple object, multi-lookup object, record-type object, and SOSL scenarios

---

### Feature: Required Field Identification and Documentation

Surface required field information from Salesforce object metadata so developers know which fields must have a value — both in the generated recipe YAML and in the SOQL template companion file.

**Goal:** Parse `<required>true</required>` XML attributes from field metadata and emit a YAML comment on required fields in the recipe output. Additionally, generate a dedicated "Required Fields" section in the SOQL template markdown listing all required fields per object so developers understand data constraints at a glance.

**Scope:**

- [ ] Extend `FieldInfo` to carry a `required: boolean` property, populated from `<required>true</required>` in the Salesforce field XML
- [ ] Update `XmlFileProcessor` / `DirectoryProcessor` to read the `<required>` element and pass it into `FieldInfo.create()`
- [ ] In `FakerJSRecipeFakerService` and `SnowfakeryRecipeFakerService`, prepend a `# REQUIRED FIELD` YAML comment above the faker expression for any field where `required === true`
- [ ] Add a **Required Fields** section to the SOQL template markdown (in `SOQLTemplateService.buildObjectSection()`) listing the API names of all required fields for that object
- [ ] Update `ObjectInfo` to expose a helper `getRequiredFields(): FieldInfo[]` for use by both the faker services and the SOQL template service

**Tests**

- [ ] Unit tests: field XML with `<required>true</required>` populates `FieldInfo.required = true`; field XML without the element defaults to `false`
- [ ] Test that the faker service emits the `# REQUIRED FIELD` comment only for required fields, in both FakerJS and Snowfakery implementations
- [ ] Test that `SOQLTemplateService` includes the Required Fields section with the correct field names, and omits the section when no required fields exist
- [ ] Mock XML fixtures: object with no required fields, object with one required field, object with multiple required fields

---

### Feature: Validation Rule Deactivator / Reactivator

Allow data insertion to succeed by programmatically deactivating validation rules before a data load and reactivating them afterward. Produces deployable metadata and a tracking map file.

**Goal:** Parse all validation rule XML files from a Salesforce source directory, generate deactivated copies ready to deploy via `sf project deploy start`, and maintain a JSON map that records what was deactivated so the reactivation step can restore them precisely.

**Scope:**

**Deactivation Step**
- [ ] New service: `ValidationRuleService` following existing service-per-folder pattern with `tests/` subfolder
- [ ] Parse all `*.validationRules-meta.xml` files under the configured `salesforceObjectsPath`
- [ ] For each active rule (where `<active>true</active>`), produce a copy with `<active>false</active>` written to a staging output directory (e.g., `treecipe/validationRules/deactivated/`)
- [ ] Write a `validationRuleMap.json` tracking file to `treecipe/validationRules/` with the structure:
  ```json
  {
    "generatedAt": "<ISO timestamp>",
    "orgAlias": "<alias used>",
    "rules": [
      {
        "object": "Account",
        "ruleName": "Require_Phone_on_Close",
        "filePath": "force-app/.../Account.Require_Phone_on_Close.validationRule-meta.xml",
        "wasActive": true,
        "currentState": "deactivated"
      }
    ]
  }
  ```
- [ ] New VS Code command: `treecipe.deactivateValidationRules` — prompts for org alias, runs deactivation + deploy
- [ ] After staging files are written, invoke `sf project deploy start` against the staging directory
- [ ] Show progress in VS Code output channel; surface errors via `ErrorHandlingService`

**Reactivation Step**
- [ ] New VS Code command: `treecipe.reactivateValidationRules` — reads `validationRuleMap.json`, restores only rules where `wasActive: true`
- [ ] Regenerates original (active) XML copies to a `treecipe/validationRules/reactivated/` staging directory
- [ ] Deploys reactivated rules via `sf project deploy start`
- [ ] Updates `validationRuleMap.json` `currentState` to `"reactivated"` on success

**Tests**
- [ ] Unit tests with mock XML fixtures: single active rule, single inactive rule, mixed set, object with no validation rules
- [ ] Test map file serialization/deserialization
- [ ] Test that only `wasActive: true` rules are included in the reactivation deploy set

---

### Feature: Date-Constraint-Aware Faker Value Generation

Analyze Date and DateTime field XML and any active validation rules referencing those fields to generate faker date expressions that satisfy date range constraints — so generated data respects business rules like "close date must be in the future" or "start date must be before end date".

**Goal:** When generating a recipe value for a `Date` or `DateTime` field, check the field's own XML attributes and any active validation rules that reference that field, extract date boundary constraints (min date, max date, relative offsets, field-to-field comparisons), and emit a faker expression with the appropriate `from`/`to` bounds.

**Scope:**

- [ ] Extend `ValidationRuleAnalyzerService` to recognize date-specific formula patterns:
  - `CloseDate > TODAY()` → date must be in the future (`from: today`, `to: today + configurable range`)
  - `CloseDate < TODAY()` → date must be in the past
  - `CloseDate >= DATE(2020, 1, 1)` → absolute date lower bound
  - `CloseDate <= DATE(2025, 12, 31)` → absolute date upper bound
  - `EndDate__c >= StartDate__c` → field-to-field ordering constraint (emit TODO comment with context)
- [ ] New `constraintType` values: `'dateMin'`, `'dateMax'`, `'dateRelativeMin'`, `'dateRelativeMax'`
- [ ] Extend `FakerJSRecipeFakerService.buildDateRecipeValue()` to accept optional date constraints and adjust the `from`/`to` in `faker.date.between()`
- [ ] Extend `SnowfakeryRecipeFakerService.buildDateRecipeValue()` equivalently using `fake.date_between(start_date=..., end_date=...)`
- [ ] Add mock XML validation rule fixtures for date constraint scenarios
- [ ] For field-to-field comparisons, emit a YAML comment describing the ordering constraint rather than trying to resolve it programmatically

**Tests**
- [ ] Unit tests: `TODAY()` future bound, `TODAY()` past bound, `DATE(Y, M, D)` absolute lower bound, `DATE(Y, M, D)` absolute upper bound, field-to-field comparison → comment
- [ ] Test that both faker backend services produce date expressions with the correct `from`/`to` range
- [ ] Test that no constraint falls back to the default date range

---

### Feature: Validation-Rule-Aware Faker Value Generation

Analyze validation rule XML for each Salesforce object and use the embedded formula logic to generate faker values that satisfy those constraints — so generated data passes validation rules without requiring them to be deactivated.

**Goal:** Parse `*.validationRule-meta.xml` files alongside the object's field XML, extract the `<errorConditionFormula>` expressions, infer constraints (regex patterns, range checks, required field dependencies, picklist restrictions), and emit faker expressions in the recipe that satisfy those constraints.

**Scope:**

- [ ] New service: `ValidationRuleAnalyzerService` following existing service-per-folder pattern with `tests/` subfolder
- [ ] Parse all `*.validationRule-meta.xml` files under the configured `salesforceObjectsPath` for a given object
- [ ] For each active rule (`<active>true</active>`), extract the `<errorConditionFormula>` and `<errorMessage>` and associate the rule with the relevant field(s) it references (via regex on field API names in the formula)
- [ ] Identify common formula patterns and translate them to faker constraints:
  - `REGEX(Field__c, "pattern")` → use `faker.helpers.fromRegExp()` or constrain to matching values
  - `Field__c < X` / `Field__c > X` → set numeric `min`/`max` bounds on the faker expression
  - `ISPICKVAL(Field__c, "value")` → restrict to (or exclude) specific picklist values
  - `NOT(ISBLANK(Field__c))` → mark field as required (non-null) in the recipe
  - `LEN(Field__c) <= N` / `LEN(Field__c) >= N` → constrain string length bounds
- [ ] Pass the extracted constraints into `FakerJSRecipeFakerService` and `SnowfakeryRecipeFakerService` so each field's faker expression respects the active validation rules for that object
- [ ] If a formula is too complex to parse deterministically, emit a YAML comment noting the unresolved rule and its error message so the developer is aware
- [ ] Integrate into the existing `RecipeService` orchestration flow — runs after object/field metadata is parsed, before recipe YAML is written

**Tests**
- [ ] Unit tests with mock XML fixtures: object with no validation rules, single REGEX rule, single numeric range rule, ISPICKVAL restriction, ISBLANK required-field rule, multi-rule object
- [ ] Test that unrecognized/complex formulas produce a YAML comment rather than crashing
- [ ] Test that constraints are correctly forwarded to both faker backend services

---

## Completed

- [x] v2.6.0 — Relationship Service: multi-object Treecipe file grouping by relationship hierarchy
- [x] v2.6.0 — Bug fix: picklist values with special characters (`&`, `'`) breaking FakerJS expressions
- [x] v2.7.0 — Enhanced numeric/currency field precision: respect `<precision>` and `<scale>` XML attributes when generating faker-js recipe values

## Notes

- Run tests: `npm run jest-test`
- Compile: `npm run compile`
- Lint: `npm run lint`
