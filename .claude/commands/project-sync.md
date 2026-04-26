---
name: project-sync
description: Syncs GitHub issues and PRs for the current task — ensures the current branch has an issue, the PR references it, and the issue state is correct.
user_invocable: true
---

You are the project tracking sync agent for Salesforce Data Treecipe. Ensure alignment between the GitHub issue, PR, and branch for the current task.

**Repo:** `jdschleicher/Salesforce-Data-Treecipe`

---

## Step 1 — Identify Current Task

```bash
git branch --show-current
```

Extract an issue number from the branch name if present (e.g., `feature/42-add-currency-handler` → issue `42`, or check the PR body).

If no issue number can be found from the branch:
```bash
gh pr view --repo jdschleicher/Salesforce-Data-Treecipe --json body --jq '.body' 2>/dev/null | grep -o "Closes #[0-9]*" | head -1
```

---

## Step 2 — Verify Issue Exists and is Open

```bash
gh issue view <N> --repo jdschleicher/Salesforce-Data-Treecipe --json number,title,state,url 2>/dev/null
```

**If no issue found:** Offer to create one via `/new-issue`.
**If issue is closed:** Ask the user whether to reopen it or create a new one.

---

## Step 3 — Verify PR References the Issue

```bash
gh pr view --repo jdschleicher/Salesforce-Data-Treecipe --json number,url,body 2>/dev/null
```

Check the PR body for `Closes #<N>`. If missing, offer to add it:

```bash
gh pr edit <PR_number> --repo jdschleicher/Salesforce-Data-Treecipe --body "$(gh pr view <PR_number> --json body --jq '.body') 

Closes #<N>"
```

---

## Step 4 — Verify PR Title Matches Issue

Compare the PR title against the issue title. They don't need to be identical, but the PR title should convey the same intent. Flag if they seem unrelated.

---

## Step 5 — Check for Missing Labels

```bash
gh issue view <N> --repo jdschleicher/Salesforce-Data-Treecipe --json labels --jq '.labels[].name' 2>/dev/null
```

If the issue has no labels, offer to add appropriate ones (e.g., `enhancement`, `bug`, `field-type-handler`).

---

## Step 6 — Verify Branch is Pushed

```bash
git branch -r | grep $(git branch --show-current) || echo "Branch not pushed to remote"
```

If not pushed:
```bash
git push -u origin $(git branch --show-current)
```

---

## Step 7 — Report

```
## Project Sync Report

### Issue
#<N> — <title>
State: open ✅
URL: <url>
Labels: <labels or "none">

### PR
#<PR_number> — <PR title>
References issue: Yes (Closes #N) ✅ / No ❌

### Branch
<branch-name>
Pushed to remote: Yes ✅ / No ❌

### Actions Taken
- <any fixes applied automatically>

### Remaining Manual Steps
- <anything that needs user action>
```
