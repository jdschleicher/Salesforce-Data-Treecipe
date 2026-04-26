---
name: contract-test
description: Verifies that both faker backends implement IRecipeFakerService and IFakerRecipeProcessor identically — same field type handlers, same method signatures, same return shapes. Run after changing any faker service.
---

# /contract-test — Faker Backend Interface Verification

Contract tests verify that **FakerJSRecipeFakerService** and **SnowfakeryRecipeFakerService** agree on the same field type handling contract. They catch the #1 source of drift in this codebase: a handler added to one backend but not the other.

## When to Use

- After adding a new Salesforce field type handler to either backend
- After changing a method signature in `IRecipeFakerService` or `IFakerRecipeProcessor`
- After any refactor of the faker service classes
- As part of a pre-merge check

---

## Step 1 — Read the Interfaces

Read both interface files to understand the contract:

```bash
cat src/treecipe/src/RecipeFakerService.ts/IRecipeFakerService.ts
cat src/treecipe/src/FakerRecipeProcessor/IFakerRecipeProcessor.ts
```

Document every method signature that both implementations must provide.

---

## Step 2 — Verify Interface Implementation Declarations

Both service classes must declare `implements`:

```bash
grep -n "implements\|class Faker" src/treecipe/src/RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService.ts
grep -n "implements\|class Snowfakery" src/treecipe/src/RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService.ts
```

**Flag:** Either class missing `implements IRecipeFakerService` as **[CRITICAL]**.

---

## Step 3 — Method Signature Parity

For each method defined in `IRecipeFakerService`, verify both implementations have the exact same parameter names, types, and return types:

```bash
grep -n "static\|public\|private" src/treecipe/src/RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService.ts | grep -v "\.test\." | head -40
grep -n "static\|public\|private" src/treecipe/src/RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService.ts | grep -v "\.test\." | head -40
```

---

## Step 4 — Field Type Handler Parity

This is the most critical check. Both backends must handle the same set of Salesforce field types.

Extract the field type keys from each backend:

```bash
echo "=== FakerJS field types ==="
grep -oE "'[A-Za-z]+':" src/treecipe/src/RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService.ts | sort -u

echo "=== Snowfakery field types ==="
grep -oE "'[A-Za-z]+':" src/treecipe/src/RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService.ts | sort -u
```

Or extract `case` statements if using a switch:

```bash
echo "=== FakerJS cases ==="
grep "case " src/treecipe/src/RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService.ts | sed "s/.*case //" | sed "s/:.*//" | sort -u

echo "=== Snowfakery cases ==="
grep "case " src/treecipe/src/RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService.ts | sed "s/.*case //" | sed "s/:.*//" | sort -u
```

Diff the two sets. Any field type in one but not the other is a **[CRITICAL]** contract violation.

---

## Step 5 — Return Shape Contracts

For a sample of field type handlers in each backend, verify the return shape is consistent with what `RecipeService` / `FakerRecipeProcessor` consumes. Read the caller:

```bash
grep -n "getRecipeFor\|getFakerExpression\|processField" src/treecipe/src/RecipeService/RecipeService.ts 2>/dev/null | head -20 || true
```

Verify the shape of values consumed from faker service methods matches what both implementations return.

---

## Step 6 — Run Existing Tests

```bash
npm run jest-test 2>&1 | tail -20
```

If any faker service tests are failing, report them as **[CRITICAL]** — they indicate a contract violation that was already caught.

---

## Step 7 — Add Missing Contract Tests

If field type handler parity gaps were found, add or update countermeasure tests for each backend:

**Test pattern for a field type handler contract:**

```typescript
describe('contract: <FieldType> handler', () => {
  it('FakerJS produces a non-empty string for <FieldType>', () => {
    const result = FakerJSRecipeFakerService.getRecipeFor<FieldType>(...);
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('Snowfakery produces a non-empty string for <FieldType>', () => {
    const result = SnowfakeryRecipeFakerService.getRecipeFor<FieldType>(...);
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });
});
```

Test placement:
- FakerJS: `src/treecipe/src/RecipeFakerService.ts/FakerJSRecipeFakerService/tests/`
- Snowfakery: `src/treecipe/src/RecipeFakerService.ts/SnowfakeryRecipeFakerService/tests/`

---

## Step 8 — Report

```
## Contract Test Report — Faker Backend Interfaces

### Interface Implementation
| Class | Implements IRecipeFakerService | Status |
|-------|-------------------------------|--------|
| FakerJSRecipeFakerService | Yes | ✅ |
| SnowfakeryRecipeFakerService | Yes | ✅ |

### Method Signature Parity
| Method | FakerJS | Snowfakery | Match |
|--------|---------|------------|-------|
| <method> | <signature> | <signature> | ✅ / ❌ |

### Field Type Handler Parity
| Field Type | FakerJS | Snowfakery | Status |
|------------|---------|------------|--------|
| Checkbox | ✅ | ✅ | ✅ |
| Currency | ✅ | ✅ | ✅ |
| <new type> | ✅ | ❌ | ❌ MISSING |

### Contract Tests
- Tests added: N
- Tests updated: N
- All tests passing: Yes / No

### Verdict
PASS — both backends fully satisfy all interface contracts.
  OR
FAIL — N contract violations (see above). Fix before merging.
```

---

## What Makes a Good Contract Test

1. **Tests the boundary** — what shape does the method produce? What does the caller expect?
2. **Tests both backends for every field type** — one test per backend per type
3. **Fails on interface change** — if a return shape changes, the contract test breaks immediately
4. **Labels intent** — the test name says exactly which field type and which backend is under test
