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
| 6 | Usage/cost dashboard, scheduled runs, connectors (marketplace APIs, ERP, bank feeds) | Done (#5–#15): usage dashboard (D-25), scheduled runs (D-26), connector framework + Shopify, Business Central and Magento 2 (D-27–D-30), demo store with demo data for all 23 templates (D-31, D-32, D-36), chat sidebar (D-33, D-34, D-35). Live checks and open decisions below |
| 7 | Go live on Vercel + Neon (D-37): Postgres everywhere (PGlite in dev/tests), private Blob uploads, connector keyring, Vercel deploy at sawwi.hypermaxsolutions.com, jobs table + Vercel Cron | In progress: scope (D-37, #16), Postgres everywhere (D-38) |

## In flight

| Work | Branch | PR | Owner |
| --- | --- | --- | --- |
| Phase 7 scope: go live on Vercel + Neon (D-37) | `phase-7-scope` | #16 | Phase 7 session |
| Postgres everywhere: Neon via `pg`, PGlite locally (D-38) | `phase-7-postgres` | (this PR, stacked on #16) | Phase 7 session |
| UI polish (on request) | `ui-polish` | — | U/UX session |

## Recent changes

- **Postgres everywhere** (D-38, branch `phase-7-postgres`, in review).
  - `node:sqlite` is gone. Production will use Neon through `pg` (`DATABASE_URL`). Locally and in tests, Sawwi runs PGlite, an in-process Postgres, so no install is needed.
  - Every store function is now async, and so are its callers. Tables are created by numbered migrations in `src/lib/db.ts`.
  - Lint now fails on a missed `await`.
  - All 203 tests pass, plus 4 new database-layer tests. The suite also ran against a real Postgres 17 through `pg`.
  - Checked in the browser: the live demo, a demo-data fill, a reconciliation, and the runs, usage and connections pages.
  - Local data from before this change (`.data/sawwi.db`) is no longer read.
  - Neon is connected to the Vercel project with the "SAWWI" prefix, so `SAWWI_DATABASE_URL` is read as well as `DATABASE_URL`.
- **Phase 7 scope: go live on Vercel + Neon** (D-37, branch `phase-7-scope`, in review). Six PRs, in order:
  1. this scope;
  2. Postgres everywhere (Neon in production, PGlite in dev and tests, async stores);
  3. uploads in private Vercel Blob, sent from the browser straight to Blob (Vercel's 4.5 MB request cap);
  4. a connector keyring with rotation;
  5. Vercel deploy config, health check and runbook;
  6. a jobs table + Vercel Cron.
- **Demo data for every template; Phase 6 done** (D-36, branch `phase-6-remaining-demo-data`, in review). Made-up files for the last 7 templates: customer statement, supplier statement, price list, RMA log, post-dated cheque register and bank, payouts and bank, import shipments, customs and freight bills. They refer to the demo company's and demo store's own documents, so all 23 templates fill with one click in the demo store and find their planted exceptions. A test fails if a template is added without demo data. 8 new tests.
- **Chat panel opens by default on run pages** (D-34, #14, merged).
  - Where the panel can dock (64rem and up), a reconciliation opens it. A direct visit opens it before first paint.
  - Leaving the run restores your own open/closed choice; narrow screens keep it closed.
  - One header: the run's status ("Ask about this result", "AI off") sits under "Ask Sawwi" instead of in a second header.
  - Also fixes the run's chat sometimes not landing in the panel after a direct visit.
- **Canned questions in a fresh chat** (D-35, same branch).
  - On a reconciliation: "What files do I need?", "What does this reconciliation check?", "How are the files matched?" and "Where do I find these exports?". They're answered from the template by rules, with no AI and no tokens, even before any upload.
  - Unasked ones stay listed until there's a report.
  - The general panel offers four questions about Sawwi, with links.
  - 6 new tests.
- **Chat in a resizable right sidebar** (D-33, #13, merged).
  - "Ask Sawwi" is now a right-hand panel that mirrors the left nav: docked from 64rem, a drawer on narrow screens.
  - Drag its left border to resize it (300 to 720 px). Double-click resets the width, and arrow keys work too. The width and whether it's open are remembered.
  - On a reconciliation, that run's chat lives in the panel and the page uses the full width.
  - A waiting question opens the panel, or puts a dot on the chat button.
  - 3 new tests.
- **Public demo store** (D-32, #12, merged). "Try the live demo" on the landing and login pages opens one shared workspace with invented data, no account needed. Demo data now exists only there: the developer switch `SAWWI_CONNECTOR_MOCK` is gone. **Marketplace demo data** was added: one invented seller, so all 8 marketplace templates fill and find their planted exceptions, 16 templates in total. In the demo, uploads are off, connections are read-only and no AI is called. It **resets every day at 00:00 UTC** on the first request after midnight, wiping only the demo's data. 17 new tests.
- **Demo data fill** (D-31, #11, merged). In demo mode (`SAWWI_CONNECTOR_MOCK`), a run page offers **Fill with demo data**. It connects the mocked Business Central and Magento sources plus a new credential-free "Demo data" source (made-up gateway, Tabby, courier, warehouse and bank files), then imports every empty slot for October 2026. Eight templates fill completely and find their planted exceptions: orders vs gateway, BNPL, COD, refunds vs returns, courier freight, cash application, order → delivery → invoice and the three-way match. None of it is available in production. 11 new tests.
- **Magento 2 connector** (D-30, #10, merged). Magento 2 / Adobe Commerce REST with an integration token. Three reports, all mapping by name:
  - orders, for orders vs gateway, COD and BNPL;
  - credit memo lines, for refunds vs returns;
  - shipments with tracking numbers and weight in kg, for courier freight.

  A **mock store** with invented data drives the tests and a browser demo. A full orders-vs-gateway test reconciles Magento orders against a made-up card settlement and finds the 3 planted exceptions. New **network guard** for every live connector request: https, public addresses only, no redirects. The connection form no longer shows the wrong source after a submit. 13 new tests.
- **Business Central connector** (D-29, #9, merged), for the design partner. Microsoft Dynamics 365 Business Central online, API v2.0, client-credentials sign-in through Microsoft Entra. Eight read-only reports (sales invoices, invoice lines, credit memos, open order lines, shipment lines; open PO lines, receipt lines, purchase invoice lines) with fixed columns that map onto the B2B and three-way-match templates by name, with no AI and no questions. A **mock tenant** with an invented company and planted exceptions drives the tests and, with `SAWWI_CONNECTOR_MOCK=business-central`, a full browser demo (connect → import → reconcile). Run pages now suggest the report made for that template's slot first. 14 new tests; no live tenant called.
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

0. **Phase 7 (D-37):** Postgres (D-38) in review; next Blob uploads (`phase-7-blob-uploads`), then connector keyring, Vercel deploy, jobs + cron.
   - **The user's part, when the deploy PR is ready:**
     - a Vercel Pro team with the project linked to the repo;
     - Neon and a private Blob store added from the Storage tab;
     - the DNS record for sawwi.hypermaxsolutions.com;
     - production secrets entered in Vercel.
1. Try Phase 4 with `ANTHROPIC_API_KEY` set. The AI path (analysis, emails, explain, free text) has only run against fallbacks so far.
2. Test Phase 5 (PDF inputs) on real anonymised statements and invoices, text and scanned.
3. **Live check of the Business Central connector** with the design partner's tenant: an Entra app registration + client secret, the app enabled in BC with a read-only permission set (D-29). Then the Shopify live check with the user's store.
4. **Live check of the Magento 2 connector** with a real store: an integration token with read-only Sales and Stores resources (D-30).
5. Scheduled connector pulls and emailed reminders, on top of Phase 7's jobs table (D-26, D-27, D-37).

## Open questions

- **Demo store:** shared by all visitors (they can see each other's runs until the daily reset), with uploads and AI off. Do you want a private sandbox per visitor, or a small AI quota in the demo, instead?
- **Hosting region and data residency:** which Vercel and Neon region (closest to the GCC)? Do UAE or KSA (PDPL) customers need their data kept in-country? Decide before real customer data goes in (D-37).
- **Email provider** for reminders, once the jobs table exists: Resend, Postmark or SES, plus DNS for a sending domain.
- **Shopify live test:** needs a store and a custom-app token from the user. Should Sawwi also get a public Shopify app (OAuth, one-click install)?
- **Business Central live test:** needs the design partner's IT to register an Entra app and enable it in BC (D-29). Which environment (Sandbox first?) and company? Do they want customer/vendor ledger entries too? Those need a small AL extension (custom API page), since API v2.0 has none.
- **Magento live test:** which store? On 2.4.4+ the merchant must allow integration tokens as Bearer tokens (or we add OAuth 1.0a signing). Magento 1 stays upload-only.
- **Next connector:** Odoo (easy, free trial) or Amazon SP-API (most valuable, needs a developer registration, which only the user can start).
- **Production key management:** D-37 uses a keyring of master keys in a sensitive Vercel environment variable, with rotation. Add a cloud KMS (AWS or GCP) later?
- **Scheduled runs:** the run is created on Start rather than pre-created (D-26), so unused schedules don't use plan runs. Is that what you want? Emailed reminders need a job runner and an email provider: add them?
- **Real PDF samples:** anonymised Emirates NBD, ADCB, Al Rajhi and SNB statements and Noon/Amazon invoices, to tune the header vocabulary and layouts. Arabic PDFs are so far tested only with synthetic positioned text, and Arabic OCR not on a real scan.
- **Brand / trademark:** stay "Sawwi" or rename (see D-12)?
- **Anthropic API key:** not configured yet, so neither the Haiku mapping path nor the Phase 4 Sonnet/Haiku writing has run live. Rule-based fallbacks cover both meanwhile.
- **Real sample exports** (Magento 1, Odoo, marketplace settlements) to test mappings against.

## Known issues

- Dev-only "instant navigation" warnings on client navigation from the gallery to a template page. The production build is fine; investigated, no fix found yet.
- Small files of whole numbers (e.g. 5 invoice lines, all with different quantities) profile the quantity column as an ID, so mapping asks one confirm question. This is a general profiling rule, not specific to PDFs. Connectors avoid it by writing decimals with 2 places (D-29).
- "Value at risk" adds quantity differences into money totals for quantity checks (D-13).
