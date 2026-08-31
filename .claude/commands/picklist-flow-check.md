---
name: picklist-flow-check
description: Verifies the picklist dependency flow diagrams are not stale — checks every identifier the doc names still exists in source, flags picklist pipeline identifiers the doc never mentions, and warns when a change touches spec generation without touching the doc. Run after any change to the picklist dependency spec generation or check pipeline.
---

You are the staleness checker for the picklist dependency flow documentation.

**The doc under guard:** `scripts/picklist-dependency-demo/PICKLIST-DEPENDENCY-FLOW.md` (8 mermaid diagrams) and its companion `scripts/picklist-dependency-demo/README.md`.

These diagrams make load-bearing claims about class names, method names, Apex assertion verbs, deployment set composition and command flow. Markdown has no compiler, so a rename in `src/` silently makes them lie. This skill is the compiler.

**Design rule — never hardcode the current names.** Every check below derives its expectations from the codebase at run time. A check written as "verify `SFTreecipePicklistDependencySpecs` appears" would itself go stale the first time the class is renamed, and would then pass while the doc is wrong. Extract from source, compare to the doc, report the difference in both directions.

---

## Watched paths

A change to any of these should be accompanied by a doc review:

```bash
WATCHED='
src/treecipe/src/PicklistDependencyTestService
src/treecipe/src/PicklistDependencyCheckService
src/treecipe/src/ExtensionCommandService/ExtensionCommandService.ts
scripts/picklist-dependency-demo
'
# Apex framework + generated-contract classes, wherever they currently live
find apexPicklistDependencyFramework -type d -name "*PicklistDependency*" 2>/dev/null
find apexPicklistDependencyFramework -name "*PicklistDependency*.cls" -o -name "*PLDSpecs*.cls" 2>/dev/null
```

---

## Check 0 — Did this change touch the picklist pipeline?

```bash
CHANGED=$(git diff main...HEAD --name-only 2>/dev/null || git diff HEAD~1 --name-only)
echo "$CHANGED" | grep -E "PicklistDependency|picklist-dependency|PLDSpecs" || echo "NO PICKLIST CHANGES"
```

If nothing matches, report **NOT APPLICABLE** and stop — do not run the remaining checks or manufacture findings.

---

## Check 1 — Every identifier the doc names still resolves (doc → code)

Two traps make the naive version of this check worthless, and both have already been hit here:

- **"Does the name appear anywhere?" passes on a corpse.** A renamed class often survives in a legacy/migration warning list or in a test asserting that warning. A grep for the bare name then succeeds while the doc is provably wrong. The name must resolve to a **live definition**, or survive **outside string literals** — a name that exists only inside quotes is a deprecation artifact, not a live symbol.
- **Bare prose yields junk identifiers.** Extracting every `expect[A-Za-z]+` from prose harvests "expected" and "expectation"; `resolve[A-Za-z]+` harvests "resolves". Trust only inline-code spans and mermaid node labels — the doc writes real identifiers as `code` or inside diagram labels, never as bare prose.

```bash
python3 - <<'PY'
import re, subprocess, pathlib

DOC = 'scripts/picklist-dependency-demo/PICKLIST-DEPENDENCY-FLOW.md'
text = open(DOC).read()
lines = text.split('\n')

# Trust only inline-code spans and mermaid node labels.
cands = {m.group(1).strip() for m in re.finditer(r'`([^`\n]+)`', text)}
inb = False
for l in lines:
    if l.startswith('```mermaid'): inb = True; continue
    if inb and l.startswith('```'): inb = False; continue
    if inb:
        cands |= {m.group(1).strip() for m in re.finditer(r'"([^"]+)"', l)}

TOKEN = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')
idents = set()
for c in cands:
    c = c.strip().rstrip('()').split('.')[-1].split('/')[-1]
    c = re.sub(r'\.(cls|ts|md|xml|json)$', '', c)
    if TOKEN.match(c) and len(c) > 3 and not c.islower():
        idents.add(c)
    elif TOKEN.match(c) and re.match(r'^(forField|controlledBy|dependsOn|expect[A-Z])', c):
        idents.add(c)

def rg(pattern, *paths):
    r = subprocess.run(['grep','-rEl',pattern,*paths], capture_output=True, text=True)
    return [p for p in r.stdout.split('\n') if p]

def strip_strings(s):
    s = re.sub(r"'[^']*'", "''", s)
    s = re.sub(r'"[^"]*"', '""', s)
    return re.sub(r'//.*$', '', s)

SEARCH = ['src', 'apexPicklistDependencyFramework', 'scripts']
missing, mention_only, live = [], [], []
for ident in sorted(idents):
    if list(pathlib.Path('.').glob(f'**/{ident}.cls')) or list(pathlib.Path('src').glob(f'**/{ident}.ts')):
        live.append(ident); continue
    hits = [h for h in rg(rf'\b{ident}\b', *SEARCH) if not h.endswith('PICKLIST-DEPENDENCY-FLOW.md')]
    if not hits:
        missing.append(ident); continue
    real = False
    for f in hits:
        try: content = open(f, errors='ignore').read()
        except Exception: continue
        if any(re.search(rf'\b{ident}\b', strip_strings(line)) for line in content.split('\n')):
            real = True; break
    (live if real else mention_only).append(ident)

print(f"identifiers checked: {len(idents)}  live: {len(live)}")
if missing:
    print("\nMISSING (named in the doc, absent from the codebase):")
    for i in missing: print(f"  - {i}")
if mention_only:
    print("\nMENTION-ONLY (survives only inside string literals -- e.g. a legacy/migration list):")
    for i in mention_only: print(f"  - {i}")
if not missing and not mention_only:
    print("\nAll doc identifiers resolve to live definitions.")
PY
```

**Flag every `MISSING` and `MENTION-ONLY` identifier as a finding.** `MENTION-ONLY` is the more interesting signal: it usually means the symbol was renamed and the old name lives on only in a migration path — the doc is describing something users no longer have.

Sanity-check the checker itself: if it reports zero findings on a change you know renamed things, the extraction or the resolution rule is broken. Fix it rather than trusting the clean result.

---

## Check 2 — Pipeline identifiers the doc never mentions (code → doc)

The reverse direction catches *additions* — a new assertion verb, a new framework class, a new generated class family that the diagrams do not show.

```bash
DOC=scripts/picklist-dependency-demo/PICKLIST-DEPENDENCY-FLOW.md

# Apex classes that ship or are scaffolded
find apexPicklistDependencyFramework -name "*.cls" | sed 's|.*/||; s|\.cls$||' \
  | grep -E "PicklistDependency|PLDSpecs" | sort -u > /tmp/code-classes.txt

# Public builder verbs the generated Apex actually emits
grep -ohE '\.(forField|controlledBy|expect[A-Za-z]+|dependsOn)\(' \
  src/treecipe/src/PicklistDependencyTestService/*.ts 2>/dev/null \
  | tr -d '.(' | sort -u > /tmp/code-verbs.txt

cat /tmp/code-classes.txt /tmp/code-verbs.txt | sort -u | while read -r ident; do
  [ -z "$ident" ] && continue
  grep -qE "\b${ident}\b" "$DOC" || echo "UNDOCUMENTED  $ident"
done || echo "Everything in the pipeline appears in the doc."
```

**Flag each `UNDOCUMENTED` identifier.** Judge severity by what it is: a new assertion verb or a new framework class is a real gap; an internal test-only stub usually is not. Say which you judged unimportant and why — do not silently drop them.

---

## Check 3 — Commands and deployment set

```bash
# Picklist commands declared vs documented
node -e "
const pkg = require('./package.json');
((pkg.contributes||{}).commands||[])
  .filter(c => /icklist/.test(c.command))
  .forEach(c => console.log(c.command + ' | ' + c.title));
"
grep -c "Generate Picklist Dependency Tests\|Run Picklist Dependency Check" scripts/picklist-dependency-demo/PICKLIST-DEPENDENCY-FLOW.md
```

The doc's deployment-set diagram asserts a specific class count in one transaction. Derive the real number rather than trusting the prose:

```bash
grep -n "frameworkClassNames" -A 12 src/treecipe/src/PicklistDependencyTestService/PicklistDependencyTestService.ts \
  | grep -oE "'[A-Za-z]+'" | tr -d "'" | sort -u
```

**Flag** any count claimed in the doc ("all eight classes", "the six framework classes") that no longer matches what the generator scaffolds and deploys. Counts stated as prose are the most fragile claims in the document — if the composition is now variable (for example a per-object class family), the fix is to stop stating a fixed number, not to update it to a new fixed number.

---

## Check 4 — Mermaid integrity

Syntax validity is necessary but not sufficient — these blocks have broken on GitHub while parsing cleanly.

```bash
DOC=scripts/picklist-dependency-demo/PICKLIST-DEPENDENCY-FLOW.md
python3 - "$DOC" <<'PY'
import sys, re
lines = open(sys.argv[1]).read().split('\n')
fences = [i for i, l in enumerate(lines) if l.startswith('```')]
print(f"fences: {len(fences)} (balanced: {len(fences) % 2 == 0})")
inb = False
problems = 0
for i, l in enumerate(lines, 1):
    if l.startswith('```mermaid'):
        inb = True
        continue
    if inb and l.startswith('```'):
        inb = False
        continue
    if not inb:
        continue
    if ';' in l:
        print(f"  SEMICOLON     {i}: {l.strip()}"); problems += 1
    if '`' in l:
        print(f"  BACKTICK      {i}: {l.strip()}"); problems += 1
    if 'http' in l or l.strip().startswith('click'):
        print(f"  URL/CLICK     {i}: {l.strip()}"); problems += 1
    if re.search(r'<(?!br\s*/?>)', l):
        print(f"  RAW ANGLE     {i}: {l.strip()}"); problems += 1
print("mermaid integrity:", "CLEAN" if problems == 0 else f"{problems} problem(s)")
PY
```

Why each rule exists — do not relax them without cause:

- **Backticks / URLs / `click`** — bare URLs have been corrupted in transit into ``` "``https://…"`` ```, which is invalid mermaid and kills the whole block. GitHub also renders mermaid with `securityLevel: strict`, so click-to-URL does nothing anyway. Links belong in surrounding markdown, never inside a block.
- **Raw `<` other than `<br/>`** — swallowed as an HTML tag on render; use `{placeholder}`.
- **Semicolons** — statement separators that behave inconsistently across renderers.

Also reject **edges that target a subgraph id** rather than a node, especially combined with a `direction` statement — mermaid ignores `direction` on any subgraph in an external edge, and the combination renders inconsistently:

```bash
python3 - "$DOC" <<'PY'
import sys, re
lines = open(sys.argv[1]).read().split('\n')
inb = False; ids = []; edges = []
for i, l in enumerate(lines, 1):
    if l.startswith('```mermaid'): inb = True; ids = []; continue
    if inb and l.startswith('```'):
        for ln, txt in edges:
            for sid in ids:
                if re.search(rf'\|\s*{sid}\s*$', txt) or re.match(rf'^\s*{sid}\s*(-->|-\.->)', txt):
                    print(f"  SUBGRAPH-EDGE {ln}: {txt.strip()}")
        inb = False; edges = []; continue
    if inb:
        m = re.match(r'\s*subgraph\s+([A-Za-z0-9_]+)', l)
        if m: ids.append(m.group(1))
        if re.search(r'(-->|-\.->|==>)', l): edges.append((i, l))
PY
```

If `@mermaid-js/mermaid-cli` is available, render each block as a final gate — but note that rendering proves only that *what is on disk* parses. It cannot catch corruption introduced when the content is posted somewhere else.

---

## Check 5 — Co-change enforcement

```bash
CHANGED=$(git diff main...HEAD --name-only 2>/dev/null || git diff HEAD~1 --name-only)
PIPELINE=$(echo "$CHANGED" | grep -E "PicklistDependency|PLDSpecs" | grep -v "^scripts/picklist-dependency-demo/" || true)
DOCCHANGED=$(echo "$CHANGED" | grep -E "^scripts/picklist-dependency-demo/(PICKLIST-DEPENDENCY-FLOW|README)\.md$" || true)

if [ -n "$PIPELINE" ] && [ -z "$DOCCHANGED" ]; then
  echo "WARN — pipeline changed but neither doc did:"
  echo "$PIPELINE" | sed 's/^/  /'
fi
```

A pipeline change with no doc change is a **warning, not automatically a failure** — a pure refactor with no observable change to names, flow or assertions legitimately needs no doc edit. Decide from Checks 1–3: if they are clean, say so and let it pass. Never demand a doc edit you cannot point at a stale claim to justify.

---

## Output Format

```
## Picklist Flow Check

Scope: <N> pipeline file(s) changed | NOT APPLICABLE

| Check | Result |
|---|---|
| 1. Doc identifiers resolve | PASS / STALE (N) |
| 2. Pipeline documented | PASS / UNDOCUMENTED (N) |
| 3. Commands + deployment set | PASS / STALE |
| 4. Mermaid integrity | CLEAN / N problems |
| 5. Co-change | OK / WARN |

### Findings
| # | Check | Finding | Evidence |
|---|---|---|---|
| 1 | 1 | Doc names `X`, which no longer exists | renamed to `Y` at file:line |

### Verdict
CURRENT — the diagrams match the code.
  OR
STALE — <N> claim(s) no longer hold; details above.
```

---

## Fixing what it finds

Offer to update the doc, and when you do:

- **Re-derive each claim from source.** Read the file and confirm the arrow direction, the class name, the verb. Do not infer a diagram from surrounding prose — an inverted dependency arrow has shipped in this document before, in the one diagram whose entire argument rested on its arrows being right.
- **Prefer claims that cannot drift.** "The classes the generator scaffolds" beats "the six framework classes"; a named step beats "step 27" in an autonumbered sequence.
- **Keep both directions in sync** — `PICKLIST-DEPENDENCY-FLOW.md` and the demo `README.md` describe the same feature and drift independently.
- **Re-run Check 4** after editing.
