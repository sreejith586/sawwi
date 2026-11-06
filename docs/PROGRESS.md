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
| 4 | Sonnet narrative, follow-up chat with one-click actions, email drafts, "no template fits" generic reco and save-as-template | In progress |
| 5 | PDF inputs: bank statements, invoices, settlement statements (ARCHITECTURE §8) | Planned (D-20), starting next |
| 6 | Usage/cost dashboard, scheduled runs, connectors (marketplace APIs, ERP, bank feeds) | Not started |

## In flight

| Work | Branch | PR | Owner |
| --- | --- | --- | --- |
| Phase 4 | `phase-4-narrative-chat` (worktree) | — | Phase 4 session |
| PDF inputs plan | `docs/plan-pdf-inputs` | open | Phase 4 session |
| UI polish (on request) | `ui-polish` | — | U/UX session |

## Recent changes

- **Plan: PDF inputs as Phase 5** (D-20, ARCHITECTURE §8). Scanned PDFs: local OCR only (user's decision). Usage/cost dashboard and connectors move to Phase 6.
- **Process:** PR-based workflow, CI, PR template and living docs (`CLAUDE.md`, `docs/PROCESS.md`, `docs/DECISIONS.md`, this file).
- **Purchasing templates (65d80c0):** "Purchasing & suppliers" group with 3 templates (23 in total). Onboarding now asks "buy from suppliers on POs?" and "import stock?". Engine: `value` expression on row rules, and `by` fields on duplicate checks.
- **Repo:** `main` pushed to https://github.com/sreejith586/sawwi.git.

## Next

1. Finish Phase 4 (see the scope above) and open its PR.
2. Phase 5, PDF inputs: embedded ZATCA XML and text-layer extraction first, then the layout memory and checks.

## Open questions

- **Brand / trademark:** stay "Sawwi" or rename (see D-12)?
- **Anthropic API key:** not configured yet, so the Haiku mapping path has never run live. Heuristics and chips cover it meanwhile.
- **Real sample exports** (Magento 1/2, Odoo, marketplace settlements) to test mappings against.

## Known issues

- Dev-only "instant navigation" warnings on client navigation from the gallery to a template page. The production build is fine; investigated, no fix found yet.
- "Value at risk" adds quantity differences into money totals for quantity checks (D-13).
