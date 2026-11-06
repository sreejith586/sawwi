# How we work

## Flow

1. **Branch** from the latest `main`: `git fetch && git switch -c <descriptive-name> origin/main`.
2. **Commit** small, coherent steps. Every commit updates the docs it affects (see below).
3. **Push and open a PR:** `git push -u origin <branch>`, then `gh pr create`. Fill in the template.
4. **CI** (`.github/workflows/ci.yml`) runs tests, typecheck, lint and build. It must be green.
5. **Review:** the user reviews. Agents may review each other's PRs and comment, but don't approve on the user's behalf.
6. **Merge:** only when the user says so. Squash or merge commit, then delete the branch. Other open branches rebase onto the new `main`.

`main` is always releasable. Nobody commits or pushes to it directly.

## Docs kept up to date in every commit

| File | What goes in it |
| --- | --- |
| `docs/PROGRESS.md` | Phase status, what's in flight (branch, PR, owner), recent changes, next steps, open questions and known issues |
| `docs/DECISIONS.md` | One numbered entry per decision: context, decision, consequences. Add new entries; don't rewrite old ones. Mark one superseded instead |
| `docs/ARCHITECTURE.md` | How the system works: journey, engine, templates, caching, stack, accounts |
| `README.md` | How to set up, run and test |

A PR that changes behaviour without touching the docs is incomplete.

## Branch names

Descriptive and scoped: `phase-4-narrative-chat`, `fix-run-page-scroll`, `docs/process-and-tracking`. Rename auto-generated names before pushing.

## Several sessions at once

- Each session owns its branch and worktree, and records it in the "In flight" table in `docs/PROGRESS.md`.
- Hand-offs between sessions are messages, not approvals. Only the user approves merges.
- If your work depends on another open PR, say so in your PR description.
