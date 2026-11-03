---
name: readability-gauge
description: Gauges how readable a file or area is for BOTH readers — a human maintainer and a coding agent — and scores it on nine dimensions where the two meet (one checked input per entry point, abstraction proportional to variety, hops to an answer, greppable literals, domain names, comment budget, reproducible in one test, read size, feedback loop), plus an optional guidance budget for CLAUDE.md and design notes. Measures the tokens and seconds an agent spends to change one thing. Proposes concrete refactors ranked by the score, tokens and seconds they save; applies them only when asked. Ported from salesforce-to-git's /readability-gauge. Use on existing code before a refactor; use /readable-code to check a diff.
---

# /readability-gauge

You **gauge readability for two readers at once**: a maintainer who knows Salesforce metadata,
Treecipe recipes and VS Code but has never opened this file, and a coding agent arriving cold
with only `grep` and a file reader that stops at 2,000 lines. Where they want different
things, find the middle:

| A human wants | An agent wants | The middle |
|---|---|---|
| A short story per function | Every fact reachable by `grep` | Short functions whose literals sit inline |
| Few jumps between files | Small files it can read whole | One concern per file, its data beside it |
| Inputs it can see at a glance | Inputs it can enumerate | One typed input, checked by one reader |
| Prose for the *why* | Code for the *what* | Why in a line or two; history in the PR/CHANGELOG |
| To rerun a failure | To reproduce without an org or VS Code | One Jest test with the fixture and mocks it needs |

The rules are CLAUDE.md's **Human-Readable Code** section; read it first, it wins over
anything here. This skill differs from `/readable-code` in scope: that one checks a **diff**
against the rules; this one scores **existing code** — a file, a folder, a feature — and says
what to restructure.

---

## Step 1 — The target

Take the path(s) from the arguments. With none, use the files the branch changed:

```bash
git diff origin/main...HEAD --name-only
```

For a VS Code command, the target includes its `ExtensionCommandService` handler and the
services it calls. For a Recipe Cockpit feature, include its router case, executor, host
helpers and panel functions in `RecipeCockpitService.ts`, plus any `RecipeCockpit*.ts` module
it imports. Measure sizes first:

```bash
wc -lc <target files>
```

---

## Step 2 — Ask it three questions, cold

Before scoring, try to answer these **from the target alone**, and count the files you opened
and the jumps (`grep` → open → scroll) each answer took:

1. **What goes in?** Every argument the entry point receives (a command's arguments, a panel
   message's fields), and where each is type-checked.
2. **What does it read?** Every workspace file, setting, wrapper field or org call it depends on.
3. **How do I reproduce it?** The Jest suite, fixture and mocks that run one real case
   without an org or VS Code.

Also note the **tokens read** to get each answer (bytes read ÷ ~4). These counts are the
evidence for the scores below. Write them down.

Then measure what an agent pays to **change one thing** in the target — pick a typical task
(add a field to a panel message, fix one refusal text):

```bash
wc -c <every file and slice the change needs read>        # ÷ 4 = tokens read per task
grep -c '<the line you would anchor the Edit on>' <file>  # 1 = a unique anchor
time npx jest <the one suite that covers it> --coverage=false   # warm; add --no-cache for cold
time npx tsc --noEmit -p .                                 # the compile an edit waits for
```

Count every region that must stay in step for the change (type, router case, executor,
panel function, test): regions far apart in one file cost as much as separate files.

---

## Step 3 — Score the dimensions

Score each **2 (good) · 1 (fair) · 0 (poor)**, or **N/A** where the dimension has nothing to
measure — 3.1 for a pure module with no entry point, 3.2 where the code reads no external
records. The total is out of 2 × the dimensions scored. Each line in the report quotes the code
that earned the score and says what it costs the human and what it costs the agent.

### 3.1 One checked input per entry point

A command id or a panel message is callable with anything, so its input is untrusted.

- **2:** one typed input, checked field by field by ONE reader beside the entry point
  (`readRunFakerOptions`, a `routePanelMessage` case), matched against an allow-list built from
  what was rendered, never validated as a path.
- **1:** checked, but the checks are spread over the handler and its helpers.
- **0:** fields read loosely in several places, or one used before it is checked.

A proposal that loosens a check is not a readability gain, whatever it does to the score.

### 3.2 Abstraction proportional to variety

A generic helper earns its place by having genuinely different callers. Data with one source
and a fixed shape — a field's validation rule records in the objects wrapper — does not need one.

- **2:** each value the code reads has a dedicated accessor named in the domain, holding its
  key inline, so `grep validationRuleConstraints` lands on the one function that reads it.
- **1:** a generic helper with a few dedicated wrappers on top.
- **0:** one generic reader fed key names declared elsewhere — the reader must resolve two
  names to learn which value is read.

Also flag the opposite: three near-identical functions over data that really does vary should
be one helper. The test is variety, not a preference for either shape.

### 3.3 Hops to an answer

From Step 2: score the **worst** of the three answers, counting files opened beyond the target.

- **2:** zero or one. **1:** two. **0:** three or more, or an answer that needed control flow
  traced across files (host router → executor → panel script → harness).

### 3.4 Greppable literals

Can an agent `grep` a field name, message command, setting or constant and land where it is
**used**?

- **2:** literals appear at their use. **1:** a constant declared in the same file within a
  screen (~50 lines) of its use. **0:** declared in another file or more than a screen from its
  only reader, built by interpolation, or used inside a template-literal string through
  `${JSON.stringify(…)}`, where the use is not code the agent's tools can follow.

### 3.5 Domain names

Use `/readable-code`'s 3.1 test for each name. **2:** all names domain words. **1:** one to
three bookkeeping names. **0:** more.

### 3.6 Comment budget

Compare each comment block with the code it covers.

- **2:** no block longer than its code; design history in the PR or CHANGELOG. **1:** one or
  two blocks longer than their code. **0:** more, or a file header longer than the code it
  introduces.

**Exempt** a warning that sits at the point of a hazard — an escaping rule, a containment or
no-link check, a "never interpolate this" note beside the line that needs it. Never propose
moving it away.

### 3.7 Reproducible in one test

- **2:** one Jest test reproduces a case with a fixture under `tests/mocks/` and the shared
  mocks (`RecipeCockpitPanelHarness`, `OrgConnectionPings`, `RecipeCockpitConfirmationAnswers`).
  **1:** possible, but needs hand-built state (assigning private statics, long panel-state
  setup). **0:** only reproducible in a running VS Code or against an org.

### 3.8 Read size

What an agent must load to change one thing. Read in units of the Read tool's 2,000 lines.

- **2:** every file an answer lives in reads whole in one Read, and the compiler and ESLint
  cover all of it. **1:** a file of 2,000–5,000 lines, or a concern split across several large
  files. **0:** a file past 5,000 lines holding unrelated concerns, or logic that lives in a
  string the compiler never checks (the Recipe Cockpit's panel script).

Lower the score one step (not below 0) when the change's Edit anchors are not unique — the
same line or block repeated so an agent must read wider context to place an edit — or when a
change touches more than three regions over 1,000 lines apart.

### 3.9 Guidance budget (only when the target includes CLAUDE.md, `.claude/**` or a design note)

Always-loaded guidance is read by every session and every subagent before any work starts,
so its cost is its size × (sessions + subagents). Report it in tokens per session.

- **2:** `CLAUDE.md` holds rules and pointers, a few lines each; history, measurements and
  issue chronology live in the CHANGELOG, the PR or a design note beside the service, loaded
  only when that service is touched. **1:** some rules carry their history inline. **0:** most
  of the file is design history, or it is past ~100 KB.

### 3.10 Feedback loop

How long an agent waits to learn whether an edit is right. Every wait is paid again per retry,
and a slow loop pushes an agent to run fewer checks.

- **2:** the one covering suite runs warm in under ~5 s and its errors point at a line in a
  checked file. **1:** 5–20 s, or a full-project `tsc` is the only compile check. **0:** over
  20 s, a suite that must import a file past ~1 MB (its cold transform alone is seconds), or a
  failure that surfaces only at run time with no line (a slip inside a template-literal string).

---

## Step 4 — Report

```
## 🧭 Readability Gauge — <target>

**Score: <total>/<2 × dimensions scored>** · <one sentence: the single biggest thing standing
between this code and a cold reader>

### Cold questions
| Question | Answer | Files opened | Tokens read |
|---|---|---|---|
| What goes in? | `openValidationRuleSource {objectApiName, ruleName}`, checked in `routePanelMessage` | 1 | ~3k |

### Cost of one change
| Task | Tokens read | Regions in step | Unique anchor | Suite (warm / cold) | Compile |
|---|---|---|---|---|---|
| Add a field to `openValidationRuleSource` | ~6k | 5, lines 2,978–22,299 | yes | 5 s / 15 s | 17 s |

### Scores
| Dimension | Score | Evidence | Human cost | Agent cost |
|---|---|---|---|---|
| 3.8 Read size | 0 | `RecipeCockpitService.ts`: 33,509 lines, 1.86 MB; panel script lines 21,747–33,502 in a string | one file per feature to scroll | ~465k tokens to hold it; grep-and-slice only |

### Proposed refactors (highest score and token gain first)
1. **<dimension>** — <before → after, small enough to paste> — +<points>, ~<tokens saved per task>, <seconds saved per check>

### Next steps
- Apply refactor 1? (yes/no)
- <at most three bullets>
```

Keep the proposals to the few that move the score most. Each is a before/after snippet, not a
description. Estimate tokens saved per typical task (what an agent reads to change one thing),
not per repository.

---

## Step 5 — Refactor (only when asked)

1. One refactor per commit, behaviour unchanged, smallest edit that earns the points.
2. Moving code keeps every guarantee CLAUDE.md states about it — for the Recipe Cockpit, the
   nonce-only shell, `localResourceRoots: []`, `textContent` only, and the pending/active
   allow-lists. Panel code moved into modules is bundled and inlined into the shell at build
   time, never loaded as an external file.
3. Run the affected suites (`npx jest <path>`), `npm run compile` and `npm run lint`; the
   source-scanning tests (button kinds, row presentation, contrast) must follow the code they
   scan.
4. Re-score and report the before/after total, tokens read for the gauged task, and the
   covering suite's time, in one line.

If a PR exists, post the report as a PR comment, ending with the attribution footer.
