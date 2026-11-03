---
name: readable-code
description: Readability review of a diff, for a human maintainer and for a coding agent — checks what the change adds against CLAUDE.md's Human-Readable Code rules (domain names, rule beside its data, smallest change that states the rule, named rule lists, short why-comments, actionable notifications, and the token cost of where code and guidance are added) and rewrites what fails, when asked. Ported from salesforce-to-git's /readable-code. Use /readability-gauge to score existing code.
---

# /readable-code

You review a diff for **readability**. Your one question for every change: *could someone
who knows Salesforce metadata, Treecipe recipes and VS Code, but has never opened this file,
say what this change does and why, from the code alone?* A coding agent arriving cold is the
second reader: it pays in tokens for every line it has to read to answer the same question.

The rules are CLAUDE.md's **Human-Readable Code** section. Read it first; it wins over
anything here.

Review only what the diff **adds or changes**. Untouched code that breaks a rule is out of
scope; at most, mention it once at the end.

---

## Step 1 — The diff

```bash
git diff origin/main...HEAD --stat
git diff origin/main...HEAD
git status --porcelain   # uncommitted work counts too
```

If the diff touches no code and no guidance file (`CLAUDE.md`, `.claude/**`, `docs/**`), say so and stop.

---

## Step 2 — Say what the change does, in one sentence

Before checking anything, write a sentence a maintainer would agree with: *"A field a
validation rule names now links to the rule's .validationRule-meta.xml file."* If you cannot
write it from the code without reading the PR or the issue, that is finding number one.

---

## Step 3 — Check each rule

### 3.1 Domain names

For every **new** variable, function, parameter, message field and test name, ask whether a
Salesforce admin or a Treecipe user would recognise the thing it names.

- **Pass:** `objectApiName`, `recordTypeDeveloperName`, `ruleName`, `treeKey`, `nickname`, `resolveRuleSourceFilePaths`, `it('links a list row whose rule the host found a file for')`.
- **Fail:** bookkeeping names (`rows2`, `flag`, `tmp`, `data`, `result`, `map1`, `x`), and abbreviations a newcomer must decode.

### 3.2 Rule beside its data

For every check the diff adds or changes, find where the values it checks against are
declared: allowed values, limits, labels, field names.

```bash
grep -rn '<the constant or variable the check reads>' src
```

- **Fail:** the declaration is in another file, or more than a screen (~50 lines) away, with
  only a constant name linking them. Say how far apart they are (file and line of each). In
  `RecipeCockpitService.ts` a `RECIPE_COCKPIT_*` constant declared near the top and read
  20,000 lines later in the panel script is this shape.

### 3.3 Smallest change that states the rule

Compare the diff to the one-sentence summary from Step 2. Every added line should be needed
to make that sentence true, or to test it.

- **Fail:** counters, log lines, flags, helper functions, parameters, settings or message
  fields the request did not ask for. Quote each one and what it adds beyond the rule.

### 3.4 Several rules on one record

If one function decides a record with several separate `if … return reason` or
`if … throw` blocks, list the rules in plain English as you read them.

- **Fail:** you had to follow control flow to find them all, or a rule's name exists only in
  its message string. Recommend a named rule list: each entry with a name, a check and a
  reason, run in order.

### 3.5 Comments

- **Fail:** a comment on new code longer than the code it explains; history ("#342 reversed…",
  "an earlier revision did…") that belongs in the PR or CHANGELOG; or a comment that says
  *what* the next line does rather than *why*.
- **Exempt:** a warning at the point of a hazard — an escaping rule, a containment check, a
  "never splat this" note beside the line it protects.

### 3.6 Messages a person can act on

For every new or changed notification (`showWarningMessage`, `showErrorMessage`,
`showInformationMessage`), refusal text, `throw`, and panel note:

- **Pass:** it names the object, field, file or org, the rule broken in plain words, and what
  to do. Workspace text still goes through `escapeForNotification`.
- **Fail:** it names only internals (variable or function names) or leaves the reader to guess
  the next step.

### 3.7 Where it was added, and what that costs a reader

Readability for an agent is measured in tokens: every line it must read to change one thing.

- **Fail:** new logic added inside a template-literal string (the Recipe Cockpit's panel script
  or stylesheet) when it could live in a checked `.ts` module — the compiler, ESLint and
  go-to-definition never see it, and an escaping slip (`'\n'` vs `'\\n'`) fails only at run
  time with no line number. Say so, even when the existing code leaves no better place yet.
- **Fail:** a file already past ~2,000 lines (one Read) grows by a self-contained concern that
  could be its own file beside it. Give the file's size before and after.
- **Fail:** guidance added to an always-loaded file (`CLAUDE.md`) longer than the rule needs —
  more than a few lines per rule, or design history, measurements and issue chronology that
  belong in the PR, the CHANGELOG or a design note beside the service. Every line of
  `CLAUDE.md` is read by every session and every subagent.

---

## Step 4 — Report

```
## 📖 Readable Code Review

### What this change does
<the one sentence from Step 2 — or "could not tell from the code" and why>

### Findings
| Rule | Location | Reads as | Should read as |
|------|----------|----------|----------------|
| 3.3 Smallest change | `RecipeCockpitService.ts:19420` | a counter + log line beside the fix | the check and nothing else |

### Verdict
READABLE — a newcomer can follow every change
  OR
NEEDS WORK — <N> findings
```

**Reads as / Should read as** is the point of the table. Quote or paraphrase the real code on
the left, and show the rewrite on the right, small enough to paste.

---

## Step 5 — Fix (only when asked)

If the user asks you to apply the findings:

1. Make the smallest rewrite each finding needs, with no behaviour change.
2. Run the affected suites (`npx jest <path>`), then `npm run compile` and `npm run lint`.
3. Report what changed in one line per finding.

If a PR exists, post the report as a PR comment, ending with the attribution footer.
