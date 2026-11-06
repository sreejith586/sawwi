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
| 5 | PDF inputs: bank statements, invoices, settlement statements (ARCHITECTURE §8) | Done (#4, bd5c07c) |
| 6 | Usage/cost dashboard, scheduled runs, connectors (marketplace APIs, ERP, bank feeds) | In progress: usage dashboard (D-25, #5) and scheduled runs (D-26) in review |

## In flight

| Work | Branch | PR | Owner |
| --- | --- | --- | --- |
| Phase 6, part 2: scheduled runs (D-26) | `phase-6-scheduled-runs` | (this PR) | Phase 6 session |
| UI polish (on request) | `ui-polish` | — | U/UX session |

## Recent changes

- **Phase 6, part 2: scheduled runs** (D-26, branch `phase-6-scheduled-runs`, in review). Schedule a template weekly or monthly from its page. When it comes due it shows in **Due now** on Home and on the new **Schedules** page. Start creates that period's run (once; reused on a second click), and saved mappings make a repeat ask nothing. Pause, resume and delete are available, and the schedules table sorts, filters and exports to Excel. Due dates are computed on read; there's no job runner. 10 new tests.
- **Docs:** the PDF plan (#3) is merged, so it's out of the in-flight table.
- **Phase 5, PDF inputs (#4, bd5c07c), merged** (plan D-20; build D-21 to D-23, ARCHITECTURE §8): any slot takes `.pdf`, and several files at once. ZATCA UBL XML attachments, then the text layer (statements, invoices, settlement tables; wrapped narration, multi-page tables, carried-forward and total lines, Arabic digits and RTL), with the ZATCA QR as fallback. Statement metadata is shown next to the file. Balance and VAT checks run before matching; a failure holds the run with a chat question and a banner in the preview. Layout recipes are saved per workspace (`pdf_layouts`). Password-protected PDFs are refused with a message. 25 new tests with synthetic fixture PDFs (golden tables for text PDFs, key fields for OCR).
- **Scanned PDFs: local OCR** (D-24, the user's decision on D-20): image-only pages (up to 20) are OCR'd on the server with `tesseract.js` (English + Arabic, bundled language data, nothing sent out). The OCR text goes through the same table reader, layout memory and checks; OCR files are marked (confidence, low-confidence rows) and a scan with nothing to check against holds the run.
- **Phase 4 (#2, 285587a):** merged.
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
2. Test Phase 5 (PDF inputs) on real anonymised statements and invoices, text and scanned.
3. Phase 6, part 3: connectors plan (ARCHITECTURE and a decision), then the user picks the first connector.
4. Scheduled runs, later: emailed reminders and connector-triggered runs need a job runner and an email provider. Ask the user first.

## Open questions

- **Scheduled runs:** the run is created on Start rather than pre-created (D-26), so unused schedules don't use plan runs. Is that what you want? Emailed reminders need a job runner and an email provider: add them?
- **Real PDF samples:** anonymised Emirates NBD, ADCB, Al Rajhi and SNB statements and Noon/Amazon invoices, to tune the header vocabulary and layouts. Arabic PDFs are so far tested only with synthetic positioned text, and Arabic OCR not on a real scan.
- **Brand / trademark:** stay "Sawwi" or rename (see D-12)?
- **Anthropic API key:** not configured yet, so neither the Haiku mapping path nor the Phase 4 Sonnet/Haiku writing has run live. Rule-based fallbacks cover both meanwhile.
- **Real sample exports** (Magento 1/2, Odoo, marketplace settlements) to test mappings against.

## Known issues

- Dev-only "instant navigation" warnings on client navigation from the gallery to a template page. The production build is fine; investigated, no fix found yet.
- Small files of whole numbers (e.g. 5 invoice lines, all with different quantities) profile the quantity column as an ID, so mapping asks one confirm question. This is a general profiling rule, not specific to PDFs.
- "Value at risk" adds quantity differences into money totals for quantity checks (D-13).
