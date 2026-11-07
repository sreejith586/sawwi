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
| 6 | Usage/cost dashboard, scheduled runs, connectors (marketplace APIs, ERP, bank feeds) | In progress: usage dashboard (D-25, #5), scheduled runs (D-26, #6) and connectors plan (D-27, #7) and connector framework + Shopify (D-28, #8) merged; Business Central (D-29, #9) and Magento 2 (D-30) connectors in review |

## In flight

| Work | Branch | PR | Owner |
| --- | --- | --- | --- |
| Business Central connector + mock tenant (D-29) | `phase-6-business-central-connector` | #9 | Phase 6 session |
| Magento 2 connector + mock store + network guard (D-30) | `phase-6-magento-connector` (on top of #9) | (this PR) | Phase 6 session |
| UI polish (on request) | `ui-polish` | — | U/UX session |

## Recent changes

- **Magento 2 connector** (D-30, branch `phase-6-magento-connector`, in review, stacked on #9). Magento 2 / Adobe Commerce REST with an integration token. Three reports, all mapping by name:
  - orders, for orders vs gateway, COD and BNPL;
  - credit memo lines, for refunds vs returns;
  - shipments with tracking numbers and weight in kg, for courier freight.

  A **mock store** with invented data drives the tests and a browser demo. A full orders-vs-gateway test reconciles Magento orders against a made-up card settlement and finds the 3 planted exceptions. New **network guard** for every live connector request: https, public addresses only, no redirects. The connection form no longer shows the wrong source after a submit. 13 new tests.
- **Business Central connector** (D-29, #9, in review), for the design partner. Microsoft Dynamics 365 Business Central online, API v2.0, client-credentials sign-in through Microsoft Entra. Eight read-only reports (sales invoices, invoice lines, credit memos, open order lines, shipment lines; open PO lines, receipt lines, purchase invoice lines) with fixed columns that map onto the B2B and three-way-match templates by name, with no AI and no questions. A **mock tenant** with an invented company and planted exceptions drives the tests and, with `SAWWI_CONNECTOR_MOCK=business-central`, a full browser demo (connect → import → reconcile). Run pages now suggest the report made for that template's slot first. 14 new tests; no live tenant called.
- **Phase 6, part 3b: connectors built** (D-28, #8, merged). A connector framework with credentials encrypted per workspace (`SAWWI_CONNECTOR_KEY`) and an import history. The first connector is **Shopify orders** (Admin GraphQL, read-only). Owners and admins manage connections in Settings → Connections; each run slot has "Import from a connection". Imports go through the same mapping and engine as an upload. 10 new tests with synthetic Shopify responses; no live calls.
- **Phase 6, part 3: connectors plan** (D-27, ARCHITECTURE §9, docs only, #7, merged). A connector emits the same table as an upload, so mapping and matching don't change. Recommended order: Shopify or Odoo, then Amazon SP-API, then Salla/Zid, gateways, other ERPs, and bank feeds via an open-banking aggregator. The plan covers encrypted credentials, and pulls per schedule period through slot bindings. It needs a job runner (user to approve).
- **Phase 6, part 2: scheduled runs** (D-26, #6, merged). Schedule a template weekly or monthly from its page. When it comes due it shows in **Due now** on Home and on the new **Schedules** page. Start creates that period's run (once; reused on a second click), and saved mappings make a repeat ask nothing. Pause, resume and delete are available, and the schedules table sorts, filters and exports to Excel. Due dates are computed on read; there's no job runner. 10 new tests.
- **Phase 6, part 1: usage and cost dashboard** (D-25, #5, merged). Settings → Usage & cost: estimated cost, tokens, cache hit rate and "repeat runs that asked nothing", a cost-per-day chart, and breakdowns by day, purpose, model and run with sort, filter and Excel. `/admin/usage` adds every workspace and a by-workspace view. Prices in one dated table (`src/lib/usage/pricing.ts`). No new LLM calls; 12 new tests.
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
3. **Live check of the Business Central connector** with the design partner's tenant: an Entra app registration + client secret, the app enabled in BC with a read-only permission set (D-29). Then the Shopify live check with the user's store.
4. **Live check of the Magento 2 connector** with a real store: an integration token with read-only Sales and Stores resources (D-30).
5. **User decision:** which job runner to allow for scheduled pulls and emailed reminders (D-26, D-27).

## Open questions

- **Job runner:** whether to add one (DB jobs table + cron, Inngest, or a worker) for scheduled pulls and emailed reminders.
- **Shopify live test:** needs a store and a custom-app token from the user. Should Sawwi also get a public Shopify app (OAuth, one-click install)?
- **Business Central live test:** needs the design partner's IT to register an Entra app and enable it in BC (D-29). Which environment (Sandbox first?) and company? Do they want customer/vendor ledger entries too? Those need a small AL extension (custom API page), since API v2.0 has none.
- **Magento live test:** which store? On 2.4.4+ the merchant must allow integration tokens as Bearer tokens (or we add OAuth 1.0a signing). Magento 1 stays upload-only.
- **Next connector:** Odoo (easy, free trial) or Amazon SP-API (most valuable, needs a developer registration, which only the user can start).
- **Production key management:** `SAWWI_CONNECTOR_KEY` from the environment for now; a KMS when deployed?
- **Scheduled runs:** the run is created on Start rather than pre-created (D-26), so unused schedules don't use plan runs. Is that what you want? Emailed reminders need a job runner and an email provider: add them?
- **Real PDF samples:** anonymised Emirates NBD, ADCB, Al Rajhi and SNB statements and Noon/Amazon invoices, to tune the header vocabulary and layouts. Arabic PDFs are so far tested only with synthetic positioned text, and Arabic OCR not on a real scan.
- **Brand / trademark:** stay "Sawwi" or rename (see D-12)?
- **Anthropic API key:** not configured yet, so neither the Haiku mapping path nor the Phase 4 Sonnet/Haiku writing has run live. Rule-based fallbacks cover both meanwhile.
- **Real sample exports** (Magento 1, Odoo, marketplace settlements) to test mappings against.

## Known issues

- Dev-only "instant navigation" warnings on client navigation from the gallery to a template page. The production build is fine; investigated, no fix found yet.
- Small files of whole numbers (e.g. 5 invoice lines, all with different quantities) profile the quantity column as an ID, so mapping asks one confirm question. This is a general profiling rule, not specific to PDFs. Connectors avoid it by writing decimals with 2 places (D-29).
- "Value at risk" adds quantity differences into money totals for quantity checks (D-13).
