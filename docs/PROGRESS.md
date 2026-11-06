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
| 5 | PDF inputs: bank statements, invoices, settlement statements (ARCHITECTURE §8) | Built, in review (`phase-5-pdf-inputs`) |
| 6 | Usage/cost dashboard, scheduled runs, connectors (marketplace APIs, ERP, bank feeds) | Not started |

## In flight

| Work | Branch | PR | Owner |
| --- | --- | --- | --- |
| Phase 4 | `phase-4-narrative-chat` (worktree) | — | Phase 4 session |
| Phase 5: PDF inputs | `phase-5-pdf-inputs` (worktree) | open | Phase 5 session |
| UI polish (on request) | `ui-polish` | — | U/UX session |

## Recent changes

- **Phase 5, PDF inputs** (D-21 to D-23, ARCHITECTURE §8): any slot takes `.pdf`, and several files at once. ZATCA UBL XML attachments, then the text layer (statements, invoices, settlement tables; wrapped narration, multi-page tables, carried-forward and total lines, Arabic digits and RTL), with the ZATCA QR as fallback. Statement metadata is shown next to the file. Balance and VAT checks run before matching; a failure holds the run with a chat question and a banner in the preview. Layout recipes are saved per workspace (`pdf_layouts`). Password-protected PDFs are refused with a message. 25 new tests with synthetic fixture PDFs (golden tables for text PDFs, key fields for OCR).
- **Scanned PDFs: local OCR** (D-24, the user's decision on D-20): image-only pages (up to 20) are OCR'd on the server with `tesseract.js` (English + Arabic, bundled language data, nothing sent out). The OCR text goes through the same table reader, layout memory and checks; OCR files are marked (confidence, low-confidence rows) and a scan with nothing to check against holds the run.
- **Process:** PR-based workflow, CI, PR template and living docs (`CLAUDE.md`, `docs/PROCESS.md`, `docs/DECISIONS.md`, this file).
- **Purchasing templates (65d80c0):** "Purchasing & suppliers" group with 3 templates (23 in total). Onboarding now asks "buy from suppliers on POs?" and "import stock?". Engine: `value` expression on row rules, and `by` fields on duplicate checks.
- **Repo:** `main` pushed to https://github.com/sreejith586/sawwi.git.

## Next

1. Finish Phase 4 (see the scope above) and open its PR.
2. Review and merge Phase 5 (PDF inputs). Then test it on real anonymised statements and invoices, text and scanned.

## Open questions

- **Real PDF samples:** anonymised Emirates NBD, ADCB, Al Rajhi and SNB statements and Noon/Amazon invoices, to tune the header vocabulary and layouts. Arabic PDFs are so far tested only with synthetic positioned text, and Arabic OCR not on a real scan.
- **Brand / trademark:** stay "Sawwi" or rename (see D-12)?
- **Anthropic API key:** not configured yet, so the Haiku mapping path has never run live. Heuristics and chips cover it meanwhile.
- **Real sample exports** (Magento 1/2, Odoo, marketplace settlements) to test mappings against.

## Known issues

- Dev-only "instant navigation" warnings on client navigation from the gallery to a template page. The production build is fine; investigated, no fix found yet.
- Small files of whole numbers (e.g. 5 invoice lines, all with different quantities) profile the quantity column as an ID, so mapping asks one confirm question. This is a general profiling rule, not specific to PDFs.
- "Value at risk" adds quantity differences into money totals for quantity checks (D-13).
