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

## Completed

- [x] v2.6.0 — Relationship Service: multi-object Treecipe file grouping by relationship hierarchy
- [x] v2.6.0 — Bug fix: picklist values with special characters (`&`, `'`) breaking FakerJS expressions
- [x] v2.7.0 — Enhanced numeric/currency field precision: respect `<precision>` and `<scale>` XML attributes when generating faker-js recipe values

## Notes

- Run tests: `npm run jest-test`
- Compile: `npm run compile`
- Lint: `npm run lint`
