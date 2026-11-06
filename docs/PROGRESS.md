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
| 4 | Sonnet narrative, follow-up chat with one-click actions, email drafts, "no template fits" generic reco and save-as-template | Done (#2, 285587a) |
| 5 | PDF inputs: bank statements, invoices, settlement statements (ARCHITECTURE §8); scanned PDFs via local OCR | In progress (PR #4) |
| 6 | Usage/cost dashboard, scheduled runs, connectors (marketplace APIs, ERP, bank feeds) | Not started |

## In flight

| Work | Branch | PR | Owner |
| --- | --- | --- | --- |
| PDF inputs plan | `docs/plan-pdf-inputs` | #3 | Phase 4 session |
| Phase 5: PDF inputs | `phase-5-pdf-inputs` | #4 | Phase 5 session |
| UI polish (on request) | `ui-polish` | — | U/UX session |

## Recent changes

- **Plan: PDF inputs as Phase 5** (D-20, ARCHITECTURE §8). Scanned PDFs use local OCR only (the user's decision). Usage/cost dashboard and connectors move to Phase 6.
- **Phase 4 (#2, 285587a), merged:**
  - An analysis above each report, written by Sonnet from a digest of totals, per-check counts and the 8 largest exceptions. It is cached per result and falls back to a rule-based summary.
  - A follow-up chat on the run page with chips: fix first, breakdowns by key/month/SKU with Excel, copyable email drafts, and explain an exception. Free text goes to Haiku.
  - A "no template fits" two-file reconciliation, with save-as-template per workspace and "Your templates" in the gallery.
  - New tables `run_narratives` and `custom_templates`, plus `messages.payload_json`. 75 tests.
  - Decisions D-15 to D-19.
  - Fix: the custom reco no longer proposes a free-text column (e.g. a bank "Narrative") as the matching key. Identifier-like columns win, and "txn ref" / "transaction ref" are now known reference headers.
  - Fix (all templates): "Which column…?" chips no longer offer a column that a later answer has already taken. An open "Is X the …?" question whose X has since been taken becomes a fresh "Which column…?" question.
- **PR process (#1, 62052b3):** merged. `main` is branch-protected and CI must pass.
- **Process:** PR-based workflow, CI, PR template and living docs (`CLAUDE.md`, `docs/PROCESS.md`, `docs/DECISIONS.md`, this file).
- **Purchasing templates (65d80c0):** "Purchasing & suppliers" group with 3 templates (23 in total). Onboarding now asks "buy from suppliers on POs?" and "import stock?". Engine: `value` expression on row rules, and `by` fields on duplicate checks.
- **Repo:** `main` pushed to https://github.com/sreejith586/sawwi.git.

## Next

1. Try Phase 4 with `ANTHROPIC_API_KEY` set. The AI path (analysis, emails, explain, free text) has only run against fallbacks so far.
2. Phase 5, PDF inputs (PR #4), including local OCR for scanned PDFs.

## Open questions

- **Brand / trademark:** stay "Sawwi" or rename (see D-12)?
- **Anthropic API key:** not configured yet, so neither the Haiku mapping path nor the Phase 4 Sonnet/Haiku writing has run live. Rule-based fallbacks cover both meanwhile.
- **Real sample exports** (Magento 1/2, Odoo, marketplace settlements) to test mappings against.

## Known issues

- Dev-only "instant navigation" warnings on client navigation from the gallery to a template page. The production build is fine; investigated, no fix found yet.
- "Value at risk" adds quantity differences into money totals for quantity checks (D-13).
