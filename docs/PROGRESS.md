# Progress

_Updated in every commit. Newest first within each section._

## Phase status

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Onboarding, template catalogue, gallery | Done (364f854, 4551bc8) |
| 2 | Upload, file profiling, column mapping (cache → heuristics → Haiku → chips) | Done (fa9210f) |
| 3 | Deterministic matching engine, report with sort/filter, Excel export | Done (f8431b6, 99e0e5f) |
| — | UI refresh, sidebar, theme switch, accounts, workspaces, paywall, Stripe | Done (965a8b5 → cddff64) |
| — | Purchasing: 3-way PO/GRN/invoice match, supplier statement, import landed cost | Done (65d80c0) |
| 4 | Sonnet narrative, follow-up chat with one-click actions, email drafts, "no template fits" generic reco and save-as-template | In review (PR from `phase-4-narrative-chat`) |
| 5 | Usage/cost dashboard, scheduled runs, connectors (marketplace APIs, ERP, bank feeds) | Not started |

## In flight

| Work | Branch | PR | Owner |
| --- | --- | --- | --- |
| Phase 4 | `phase-4-narrative-chat` (worktree) | open (see branch) | Phase 4 session |
| UI polish (on request) | `ui-polish` | — | U/UX session |

## Recent changes

- **Phase 4 (`phase-4-narrative-chat`):**
  - An analysis above each report, written by Sonnet from a digest of totals, per-check counts and the 8 largest exceptions. It is cached per result and falls back to a rule-based summary.
  - A follow-up chat on the run page with chips: fix first, breakdowns by key/month/SKU with Excel, copyable email drafts, and explain an exception. Free text goes to Haiku.
  - A "no template fits" two-file reconciliation, with save-as-template per workspace and "Your templates" in the gallery.
  - New tables `run_narratives` and `custom_templates`, plus `messages.payload_json`. 75 tests.
  - Decisions D-15 to D-19.
- **PR process (#1, 62052b3):** merged. `main` is branch-protected and CI must pass.
- **Process:** PR-based workflow, CI, PR template and living docs (`CLAUDE.md`, `docs/PROCESS.md`, `docs/DECISIONS.md`, this file).
- **Purchasing templates (65d80c0):** "Purchasing & suppliers" group with 3 templates (23 in total). Onboarding now asks "buy from suppliers on POs?" and "import stock?". Engine: `value` expression on row rules, and `by` fields on duplicate checks.
- **Repo:** `main` pushed to https://github.com/sreejith586/sawwi.git.

## Next

1. Review and merge the Phase 4 PR, then try it with `ANTHROPIC_API_KEY` set. The AI path (analysis, emails, explain, free text) has only run against fallbacks so far.
2. Phase 5 planning.

## Open questions

- **Brand / trademark:** stay "Sawwi" or rename (see D-12)?
- **Anthropic API key:** not configured yet, so neither the Haiku mapping path nor the Phase 4 Sonnet/Haiku writing has run live. Rule-based fallbacks cover both meanwhile.
- **Real sample exports** (Magento 1/2, Odoo, marketplace settlements) to test mappings against.

## Known issues

- Dev-only "instant navigation" warnings on client navigation from the gallery to a template page. The production build is fine; investigated, no fix found yet.
- "Value at risk" adds quantity differences into money totals for quantity checks (D-13).
- Custom reco: the key-column guess can propose a text column (e.g. a bank "Narrative", through the `narration` alias). The user corrects it with No.
- A "which column" chip can list a column that a later answer has already taken. This is long-standing engine behaviour, now more visible because custom recos ask more chips.
