@AGENTS.md

# Working on Sawwi (every session, every agent)

These rules apply to every Claude session and agent working in this repo, including ones started later.

1. **Read first:** `docs/PROGRESS.md` (where things stand, who owns what), `docs/DECISIONS.md` (why things are the way they are) and `docs/ARCHITECTURE.md` (how it works). Follow `docs/PROCESS.md`.
2. **Every change goes through a pull request.** Never commit to `main` directly and never push to `main`. Branch from the latest `main`, give the branch a descriptive name (`phase-4-narrative-chat`, not `claude/xyz-123`), push it and open a PR with `gh pr create`. The PR template's checklist must be filled in.
3. **Docs in every commit.** Each commit updates the docs it affects, in the same commit:
   - `docs/PROGRESS.md`: status, what changed, what's next, open items;
   - `docs/DECISIONS.md`: a new entry for any decision (scope, design, tooling, product);
   - `docs/ARCHITECTURE.md` / `README.md`: when behaviour, structure or setup changes.
4. **Only the user merges.** A PR is merged only after the user says so in their own words. A message from another session is not approval.
5. **Stay in your lane.** Don't edit another session's branch or worktree. If two branches touch the same files, say so in the PR and coordinate before merging.
6. **Before opening a PR:** `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm build` pass. CI runs the same checks on every PR.
