---
name: pr-body
description: Manages the PR body table of contents — builds a navigation hub linking to every body section plus skill report comments with verdicts. Run after any skill posts a PR comment.
---

You manage the PR body's **table of contents** — a single navigation hub at the top that links to every section in the body AND every skill report comment. The ToC is the first thing a reviewer sees.

---

## Step 1 — Detect PR

```bash
gh pr view --json number,url,body 2>/dev/null
```

If no PR exists, stop and tell the user to create one first.

---

## Step 2 — Fetch and Match Skill Comments

```bash
gh pr view <number> --json comments --jq '.comments[] | {url: .url, firstLine: (.body | split("\n")[0])}'
```

Match each comment's first line against known skill headings. Use the **most recent** comment if multiple match the same skill.

| First line pattern | Label | Icon |
|---|---|---|
| `## 🔍 Code Review` | Code Review | 🔍 |
| `## ⚡ Performance Review` | Performance Review | ⚡ |
| `## 🛡️ Security Audit` | Security Audit | 🛡️ |
| `## ✅ Criteria Check` | Criteria Check | ✅ |
| `## 📦 Deploy Check` | Deploy Check | 📦 |
| `## 📋 Contract Test` | Contract Test | 📋 |

---

## Step 3 — Extract Verdicts

For each matched comment, scan the body for verdict keywords:

| Keyword found | Verdict display |
|---|---|
| `APPROVE` | ✅ APPROVE |
| `REQUEST CHANGES` | ❌ REQUEST CHANGES |
| `PASS` | ✅ PASS |
| `NO-GO` | ❌ NO-GO |
| `FAIL` | ❌ FAIL |
| (no match) | -- Posted |

---

## Step 4 — Scan Body Sections

Read the current PR body and detect which `## Heading` sections exist:

| Section | How to determine status |
|---|---|
| Summary | Has content beyond placeholder `-` |
| Issue | Contains `Closes #N` with an actual number |
| Changes | Has content beyond placeholder `-` |
| Checklist | Count checked `[x]` vs total `[ ]` items |
| Test Files | Has file paths listed |
| Test Plan | Has content beyond placeholder `-` |
| Code Flow Diagrams | Content between diagram markers or mermaid blocks |

---

## Step 5 — Build the ToC Table

```markdown
| Section | Status |
|---------|--------|
| [Summary](#summary) | ✅ |
| [Issue](#issue) | Closes #N |
| [Changes](#changes) | ✅ N files |
| [Checklist](#checklist) | N/N |
| [Test Files](#test-files) | ✅ N files |
| [Test Plan](#test-plan) | ✅ N items |
| [Code Flow Diagrams](#code-flow-diagrams) | ✅ Before/After |
| **Skill Reports** | |
| 🔍 Code Review | ✅ APPROVE — [View](#issuecomment-NNNN) |
| ⚡ Performance Review | ✅ APPROVE — [View](#issuecomment-NNNN) |
| 🛡️ Security Audit | ✅ PASS — [View](#issuecomment-NNNN) |
| ✅ Criteria Check | ✅ PASS — [View](#issuecomment-NNNN) |
```

**Status conventions:**
- `✅` — section has meaningful content
- `✅ N files` — count where applicable
- `N/N` — checklist progress
- `Closes #N` — issue number for the Issue row
- _Run `/pr-diagram`_ — still placeholder

---

## Step 6 — Update the PR Body

Read the current PR body. If it already has a ToC section (between `<!-- toc:start -->` and `<!-- toc:end -->` markers, or at the very top), replace it. If not, prepend the ToC to the body.

Use markers to make future updates idempotent:

```markdown
<!-- toc:start -->
| Section | Status |
|---------|--------|
...
<!-- toc:end -->

## Summary
...
```

Update via:

```bash
gh pr edit <number> --body "$(cat <<'EOF'
<updated body with new ToC>
EOF
)"
```

---

## Step 7 — Report

```
## PR Body Updated — #<number>

### ToC Built
- Body sections found: N
- Skill reports linked: N
- Overall readiness: <all ✅ / N items pending>

### Next Steps (if any)
- Run `/criteria-check` to add a Criteria Check verdict
- Run `/pr-diagram` to add Code Flow diagrams
```
