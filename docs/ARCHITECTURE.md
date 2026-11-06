# Sawwi — Product & Architecture Plan

Sawwi is a reconciliation platform for finance, operations and logistics teams across verticals
(E-commerce, Trading, Manufacturing, FMCG, Logistics). You upload files, answer a few one-click
questions, and get back a reconciliation report, an analysis of it, and suggested follow-up actions.

> **Current scope (v1): E-commerce sellers: marketplace, own webstore (D2C), and direct B2B (selling to
> other businesses via a B2B portal, wholesale or a sales team).**
> Other industries (Trading, Manufacturing, FMCG, Logistics) are deferred until these two are
> handled end to end. The rest of this document keeps them for reference only.

## 1. User journey

1. **Onboarding**: the user picks their industry, organisation type, department and role (chips,
   no free text). This profile filters the template catalogue.
2. **Template gallery**: shows the recos that apply to that profile, ranked by industry and role.
3. **Run a template**: the template lists the source slots it needs (e.g. "Marketplace settlement
   report", "Sales invoice register"). The user drops files into those slots.
4. **Clarify**: Sawwi profiles the files and asks only what it could not work out, using yes/no
   and single-select chips (e.g. "Is `Ord_Ref` the same as `Order ID`?  [Yes] [No]").
5. **Run**: the deterministic engine does the matching, and the LLM writes the narrative.
6. **Report and chat**: you get matched, unmatched and partial results, the variances and the root
   causes. Follow-up chips include "Draft email to marketplace", "Raise debit note list",
   "Export exceptions" and "Re-run with tolerance ±₹1".
7. **No template fits**: Sawwi asks 3–5 chip questions (what is being compared, the key and amount
   fields, the tolerance), shows a generic two-source form, and offers to **save it as a template**.

## 2. Core principle: the LLM never matches rows

Matching is done by code (DuckDB/Polars): joins, fuzzy keys, tolerances, many-to-one, and date windows.
The LLM only sees **schemas, samples and aggregates**, never whole files. This keeps cost flat no matter
how big the files get, and the results stay auditable and reproducible.

| Step | Done by | Model |
|---|---|---|
| File profiling (headers, types, formats, sample rows) | Code | — |
| Column → canonical field mapping | Cache first, then LLM | Haiku 5.5 |
| Clarifying questions (structured JSON chips) | LLM | Haiku 5.5 |
| Matching and rules | Code (TypeScript engine, `src/lib/recon`) | — |
| Exception reason classification | Cache first, then rules, then LLM in batch | Haiku 5.5 |
| Report narrative, chat and email drafts | LLM | Sonnet 5.5 (Haiku for simple chat) |
| New-template design (no template found) | LLM | Sonnet 5.5 |

## 3. Template = declarative spec (JSON/YAML)

```yaml
id: ecom.marketplace.settlement_vs_orders
industries: [ecommerce]
roles: [finance, accounts_receivable]
sources:
  orders:     { canonical: [order_id, sku, qty, invoice_amount, order_date] }
  settlement: { canonical: [order_id, settled_amount, commission, fees, tcs, tds, settlement_date] }
match:
  keys: [{ left: orders.order_id, right: settlement.order_id, normalize: [trim, upper] }]
  cardinality: one_to_many
  amount: { left: invoice_amount, right: "settled_amount + commission + fees + tcs + tds", tolerance: 1.0 }
exceptions: [missing_in_settlement, short_paid, excess_commission, returned_not_credited]
outputs: [summary, exceptions_by_reason, ageing]
```

Templates, saved mappings and answers are stored per org. A user-created template uses the same spec.

## 4. Starter template catalogue (seeded)

### v1 catalogue: GCC sellers/brands (Marketplace + Webstore + Direct B2B + Purchasing), 23 templates

Perspective: a **seller/brand** selling on marketplaces and/or its own webstore in the GCC.
Currencies: AED, SAR, KWD, QAR, BHD, OMR (multi-currency and FX are handled throughout).
Tax: VAT (UAE 5%, KSA 15%, etc.), plus KSA ZATCA e-invoice fields where relevant.
Marketplace and provider names are examples; every template works from uploaded files, whatever the source.

**Marketplace seller (e.g. Amazon.ae/.sa, Noon, Namshi)**
1. Marketplace settlement/payout statement vs. order and sales invoice register
2. B2B marketplace invoices vs. payment released (short-pay, held and reserve amounts)
3. Returns vs. invoiced items: customer returns, failed delivery/RTO, refund deductions, missing restock
4. Commission and fee validation vs. rate card (referral %, fulfilment fees, closing fees, shipping)
5. Marketplace-fulfilled inventory (FBA/FBN-style): sent vs. received vs. sold vs. returned vs. lost, with reimbursement claims
6. Damage/lost claims raised vs. reimbursements received
7. Advertising/promotion deductions vs. campaign invoices
8. VAT reco: output VAT on sales vs. marketplace invoices; input VAT on marketplace fee invoices

**Own webstore / D2C (e.g. Shopify, Magento 1 & Magento 2 / Adobe Commerce, WooCommerce, Salla, Zid)**
9. Orders vs. payment gateway settlements (e.g. Checkout.com, Tap, PayTabs, Telr, Stripe): fees, refunds, chargebacks
10. COD: delivered orders vs. courier COD remittance (e.g. Aramex, SMSA, iMile)
11. BNPL settlements (e.g. Tabby, Tamara) vs. orders
12. Courier freight invoice vs. shipments and contracted rates (weight and zone disputes)
13. Refunds issued vs. returns physically received

**Direct B2B (own B2B portal, wholesale, sales team)**
15. Customer payments vs. open invoices (cash application: short pays, overpayments, unapplied cash)
16. Customer ledger vs. customer statement / balance confirmation (shown when credit terms are given)
17. Sales orders vs. deliveries (POD) vs. invoices (unbilled deliveries, invoiced-not-delivered)
18. Invoiced prices vs. customer price list / contract
19. Customer returns (GRN/RMA) vs. credit notes
20. Post-dated cheques (PDC) register vs. bank clearing (shown when customers pay by cheque)

**Common to marketplace and webstore**
14. Bank statement vs. expected payouts (marketplace, gateway, BNPL, courier COD), including FX differences

### Deferred industries (reference only)

**E-commerce / marketplace (original, region-neutral list)**
- Marketplace settlement vs. order/invoice register (payment release)
- B2B marketplace invoices vs. payment received (short-pay, held, reserve release)
- Returns (customer return and RTO) vs. invoiced items, and credit/refund received
- Commission and fee validation against the rate card (category %, fixed fee, shipping slabs)
- Payment gateway / COD remittance vs. orders delivered
- Tax collected at source by marketplace (e.g. TCS/TDS) vs. tax-portal statements
- Ads/promotion deductions vs. campaign invoices

**Finance (all industries)**
- Bank statement vs. ledger (BRS)
- AR cash application: receipts vs. open invoices
- AP 3-way match: PO vs. GRN vs. vendor invoice
- Vendor statement vs. vendor ledger
- Intercompany balance reconciliation
- GST/VAT: purchase register vs. supplier filings (e.g. GSTR-2B)
- Credit card / expense statements vs. claims

**Trading / Manufacturing**
- Stock: physical/WMS vs. book inventory
- Production consumption vs. BOM standard
- Customer/distributor ledger confirmation

**FMCG**
- Distributor scheme/claim reconciliation (trade promotions)
- Primary vs. secondary sales
- Damages/expiry claims vs. returns received

**Logistics**
- Freight/carrier invoice vs. shipment manifest and contracted rates
- COD collected vs. remitted by courier
- Weight discrepancy (declared vs. charged)

## 5. Token-cost and caching strategy

Most runs repeat the same template every week or month with new files, so we cache aggressively,
in layers. The cheapest one comes first:

1. **Schema-fingerprint mapping cache (no LLM call).** Fingerprint each uploaded file as
   `hash(sorted headers + inferred types + date/number formats)`. If we have seen that fingerprint
   for this org and template, we reuse the saved mapping and skip both the mapping and questions steps.
   Repeat runs should usually make **zero** LLM calls before the report.
2. **Answer memory.** Every clarification answer is saved against (org, template, fingerprint), so
   Sawwi never asks the same question twice. Answers act as rules the next time.
3. **Exception-reason cache.** We normalise exception patterns (e.g. "settlement short by exactly
   commission delta on category X") and cache the reason classification. Only new patterns go to the LLM.
4. **Anthropic prompt caching** for the calls that remain. Prompts are ordered *most static → most dynamic*:
   `tools` → system prompt (Sawwi persona + reco rules) → template spec + glossary → org profile and
   saved mappings → **cache breakpoint** → this run's summary stats → user turn.
   Use the 1-hour cache TTL for chat sessions and bursty month-end runs. Chat history grows by
   appending only, so each turn reads the earlier turns from cache.
   Never put timestamps, run IDs or reordered JSON before the breakpoint, because any change there
   makes the cache miss.
5. **Compact payloads.** Send the LLM aggregates (counts, sums, top-N exceptions, ≤20 sample rows)
   as compact CSV or TSV, not JSON, and never the raw files.
6. **Batch API** for work that doesn't need an instant answer (bulk exception classification,
   scheduled recurring recos). This trades latency for a large discount.
7. **Model routing.** Haiku by default. Escalate to Sonnet only for narrative reports, ambiguous
   mappings Haiku flags as low-confidence, and new-template design.
8. **Structured outputs** (JSON schema / tool use) for mappings and questions, so we don't pay for
   retries or parsing failures.

Track per-run tokens (input, cache read, cache write, output) from day one so cache hit rate is visible.

## 6. Stack

_Current:_ Next.js 16, TypeScript, Tailwind v4, `node:sqlite` store, an in-memory TS matching engine (D-5, D-6), exceljs and the Anthropic SDK. The original plan is below, kept for reference.

- **Next.js 16 (this repo):** UI, auth, API routes / server actions
- **Postgres** (via Drizzle): orgs, users, templates, mappings, answers, runs, exceptions (later; SQLite now)
- **DuckDB** (Node bindings, server-side): the matching engine over uploaded CSV/XLSX/Parquet (replaced by the TS engine, D-5)
- **Object storage** (S3/R2): uploaded files and generated reports (XLSX/PDF)
- **Anthropic SDK:** Haiku 5.5 / Sonnet 5.5, prompt caching, Batch API
- **Job queue** (e.g. Inngest/BullMQ): long-running recos and scheduled repeat runs

## 6a. Accounts, workspaces and paywall (SaaS groundwork)

- **Public:** `/` intro page, `/signup`, `/login`. Everything else needs a session (`src/proxy.ts` does an optimistic cookie check; `src/lib/saas/session.ts` re-validates against the DB in every page, action and route).
- **Accounts:** email + scrypt password, DB-backed sessions (only the token hash is stored). Each sign-up creates a workspace (`orgs`) whose fixed `key` files its runs, mappings and members; the business profile lives on the workspace. Invited emails join the inviting workspace on sign-up or login.
- **Roles:** owner / admin (team, profile, plan) / editor (run reconciliations) / viewer (read reports only).
- **Paywall:** plans and limits in `src/lib/saas/plans.ts`, enforced by `entitlement()`. Off by default (early access); a superadmin turns it on in `/admin`. Blocked workspaces keep read access to existing reports. No payment provider yet: "Choose plan" files a request that a superadmin approves.
- **Card payments (Stripe):** `/checkout/[plan]` embeds Stripe Checkout (`ui_mode: embedded_page`, subscription mode) with card, Apple Pay / Google Pay and Link. Prices come from `STRIPE_PRICE_*`; one Stripe Customer per workspace. `/checkout/return` verifies the session belongs to the workspace and applies the plan at once; `/api/stripe/webhook` (signature-verified) keeps it in sync for renewals, failed payments, cancellations and portal changes. "Manage billing" opens Stripe's billing portal. Checkout is offered only while the paywall is on; Enterprise stays a request.
- **Superadmin:** granted only via `SAWWI_SUPERADMIN_EMAILS`. Console at `/admin`: paywall, trial length, open sign-ups, plan requests, workspaces (plan, trial, suspend) and users, with Excel exports.
- **Storage:** SQLite now (`src/lib/saas/store.ts` holds all SQL for this); port to Postgres with the rest.

## 7. Build phases

Status: see `docs/PROGRESS.md` (kept current) and `docs/DECISIONS.md`. Phases 1–5 done; Phase 6 in progress (connectors plan in §9). Phase 3 = deterministic matching engine (`src/lib/recon/`) running each template's links and check rules, report UI with sort/filter, Excel export of every table. Phase 4 (PR #2) is merged; its notes follow. PDF inputs (§8, PR #4) are merged.

Phase 4 (`src/lib/insights/`):
- **Analysis above the report.** Claude Sonnet 5.5 writes a headline, up to four findings and three next steps from a digest (`digestText`: totals, per-check counts/values and the 8 largest exceptions by key, never rows). Fetched after the report renders, then cached per result in `run_narratives`, so re-opening a run costs nothing. No API key, or a viewer opening an uncached run: the rule-based summary (`ruleNarrative`), not cached so a later key still writes one.
- **Follow-up chat** on the run page, chips first: "What should I fix first?" (ranked by value × severity in code, zero tokens), "Break down <check> by key/month/SKU/…" (grouped in code from the rows behind each exception; Excel at `/api/runs/[id]/breakdown`), "Draft email to <counterparty>" (Sonnet, from one check's aggregates and its 15 largest items; copyable), "Explain <exception>" (Haiku 5.5, from that exception's own rows; also an Explain button per exception row), and free text (Haiku, digest + earlier follow-ups). Every AI answer has a code-written fallback. Messages live in `messages` with a `payload_json` card (email, breakdown, fix list).
- **Prompt caching.** Every call sends the same two system blocks with `cache_control` (1h): fixed instructions shared by all runs, then the run digest shared by every turn on that run. Sonnet calls use the server-side refusal fallback (`fallbacks: "default"`). Usage is logged per purpose (`narrative`, `email_draft`, `explain`, `chat`).
- **No template fits.** The gallery's "Start a custom reconciliation" names the two files (preset chips or free text) and picks a tolerance; the run uses the generic two-file spec (`src/lib/templates/custom.ts`: key + amount, optional date/description; missing either side, amount mismatch, duplicates). Its fields are always confirmed with chips (`confirmColumns`), with no AI guess. "Save as a reusable template" stores the spec per workspace (`custom_templates`) and copies the confirmed mappings, so the next run with the same exports asks nothing. Saved templates show under "Your templates" in the gallery. `src/lib/runs/templates.ts` resolves catalogue, generic and saved templates for every run.
- Chat and analysis actions keep `getOwnedRun` + `runBlocker()`; downloads are read-only like the other exports.

Decision (Phase 3): matching runs in TypeScript in memory rather than DuckDB. Uploads are capped at 25 MB (~200k rows), which in-memory joins handle in well under a second, and it avoids a native binary in deployment. Revisit DuckDB if volumes grow.


1. Onboarding, template catalogue (seeded specs) and gallery UI
2. Upload, file profiling, mapping (cache + Haiku), chip-question chat
3. DuckDB matching engine executing template specs, plus exceptions
4. Report UI and export; narrative and follow-up chat; email drafts
5. Generic reco when no template fits, and save-as-template
6. PDF inputs: bank statements, invoices and settlement statements as PDF (§8)
7. Usage/cost dashboard, scheduled runs, connectors (marketplace APIs, ERP, bank feeds)

## 8. PDF inputs

GCC bank statements, supplier and marketplace invoices and settlement statements often arrive only as PDF. Any slot accepts `.pdf` next to CSV, TSV and XLSX. A PDF becomes the same `{ headers, rows }` table that `parseUpload` (`src/lib/files/parse.ts`) returns for a CSV, so profiling, the mapping cache, chips and the engine are unchanged. Everything here is code; this step makes no LLM calls and sends nothing off the server (D-2, D-21, D-24).

**Order, cheapest and most exact first** (`src/lib/pdf/index.ts`):

1. **Embedded ZATCA e-invoice XML.** KSA invoices are PDF/A-3 with the UBL 2.1 XML attached. When an attachment is UBL (`Invoice` / `CreditNote`), Sawwi reads number, date, seller and buyer with VAT numbers, PO reference, currency, net, VAT, total and every line (`src/lib/pdf/zatca.ts`, with a small XML reader in `xml.ts`). Credit notes come out negative.
2. **Text layer** (`pdfjs-dist`, legacy build, in Node; no native binary, pages are never rendered). Text items keep their positions (`read.ts`) and become words, then lines grouped by y (`layout.ts`). The header line is the one whose cells best match a vocabulary of English and Arabic column names (date, value date, narration, reference, debit, credit, amount, balance, qty, unit price, SKU, net, VAT, total…), with tightly set labels split apart. Column x-bands come from the header cells widened by the data under them (whitespace channels across the rows), so right-aligned amounts and long narrations land in the right column. Then, per page:
   - rows start at a date (or an amount, for tables without dates); lines in between are wrapped narration and fold into the row above;
   - repeated headers on later pages, page footers ("Page 2 of 3"), "balance brought/carried forward", opening/closing balance and total rows are set aside, not returned as rows;
   - statement metadata (issuer, account, IBAN, period, currency, opening and closing balance, printed totals) is kept apart from the rows and shown next to the file;
   - Arabic-Indic digits (٠–٩, ۰–۹) and Arabic separators (٫ ٬) are normalised, bidi marks are dropped, and Arabic text is put in reading order (RTL runs inside LTR lines and vice versa). Arabic headers list columns right to left;
   - amounts are normalised: `1,234.50 DR` and `(1,234.50)` are negative; a single signed Amount column (or Amount + Dr/Cr) also gets Debit and Credit columns.
   The PDF is then classified: **statement** (balance + debit/credit/amount columns), **invoice** (invoice wording + an invoice number; header fields by label, the line table, and the subtotal/VAT/total block), or any other **table** (settlement and payout statements).
3. **Local OCR for scanned pages (D-24).** When a PDF has no text layer, the scan on each page (the largest image, decoded by pdf.js itself, so no page rendering or canvas is needed) is OCR'd on the server by `tesseract.js` (WebAssembly, English + Arabic, `src/lib/pdf/ocr.ts`). The language data comes from the `@tesseract.js-data/eng` and `/ara` npm packages (`4.0.0_best_int`), copied to a local temp folder, and is never fetched from a CDN. Page images never leave the server and nothing goes to Claude. The OCR words carry positions and confidence and go through the same table reader, layout memory and checks as a text PDF. Guards: up to 20 scanned pages per file, one recognition at a time on a shared worker, specks with no letters or digits dropped. The result is marked as OCR (method, average confidence, low-confidence rows) on the file card, in the chat and in a banner over the preview. A scan with no balance or VAT figures to check against holds the run with a question, like a failed check.
4. **ZATCA QR (TLV) fallback.** When an invoice's text lacks the total, VAT or seller VAT number, or a scan has no readable text, QR images on the first and last page are decoded in pure JS (`jsqr`) and the base64 TLV (seller, VAT number, timestamp, total, VAT) fills the gaps.

**Table shape.** Statements and other tables keep their own column names, so the header fingerprint (and with it the saved mapping) is stable from one month to the next. Invoices get fixed column names that the known-header heuristics map (`Invoice number`, `Supplier`, `PO number`, `Amount excl. VAT`, `VAT`, `Total incl. VAT`…). The slot decides the grain: slots with SKU, quantity, unit price or line amount fields get one row per invoice line, others one row per invoice (D-22).

**Layout memory** (`pdf_layouts`, per workspace). After a text-layer read, the recipe (issuer key from the top lines of page 1 without digits, header tokens, column names, roles and x-bands) is saved. The next PDF from the same issuer finds its header by the saved tokens and reuses the column roles, even if its header words aren't in the vocabulary. The file card shows "PDF layout remembered". With the mapping cache, a repeat statement from the same bank asks nothing.

**Checks before matching** (`statement.ts`, `invoice.ts`):
- statements: opening + credits − debits = closing; rows add up to printed totals; every printed running balance follows from the one before, including carried/brought-forward lines between pages. A one-off misprint is reported once, and after a missing row the walk re-syncs on the printed figures;
- invoices: lines add up to the subtotal; qty × unit price = line amount; VAT = rate × net, at the printed rate or the GCC standard rate it matches (5% UAE and Oman, 15% KSA, 10% Bahrain), and flagged if it isn't the workspace's country rate; net + VAT = total.
Results show under the file (✓/✕ with figures). A failed check is posted in the run chat as a question ("Use these rows anyway?" / "I'll upload a corrected file") that holds the run until the user continues or replaces the file, and the Preview data tab shows a red banner above the extracted rows (D-23).

**Several files into one slot.** The drop zone takes several files at once (up to 50, 25 MB in total). Each is read on its own and the tables are stacked with a `Source file` column first and the union of the columns (`parseUploads`). A month of supplier invoices becomes one row per invoice, or per line.

**Refused, with a message:** password-protected PDFs; PDFs over 200 pages; scans over 20 pages; scans OCR can't read ("upload a clearer scan, at least 200 dpi…"); and files that aren't readable PDFs. While a PDF upload runs longer than a moment, the drop zone says "Reading scanned pages…".

**Storage.** How each PDF was read (kind, method, pages, metadata, checks, rows set aside) is stored with the run's other checks (`run_checks`, key `pdf_<slot>`, via `store.setPdfInfo`) and served in the run view. The extracted table is stored as CSV like any upload, so preview and Excel export work unchanged.

**Tests:** `src/lib/pdf/pdf.test.ts` and `src/lib/runs/pdf-ingest.test.ts` generate synthetic PDFs (`src/lib/pdf/fixtures/make.ts`, with `pdf-lib` and `qrcode` as dev dependencies): a one-page statement, a three-page statement with carried-forward lines and repeated headers, a misprinted statement, a text invoice, a ZATCA PDF/A-3 with UBL XML and QR, a QR-only invoice, a password-protected file, and scanned (image-only) versions of the statements and the invoice rendered with Liberation Sans through `pureimage`. Text PDFs have golden tables; OCR tests assert the key fields and checks, so they tolerate OCR noise. Arabic and RTL reading is tested on positioned text items, because the standard PDF fonts can't draw Arabic, and there is no Arabic scan fixture yet: the fixture renderer can't shape Arabic script. The Arabic OCR data loads in every OCR test. Real anonymised samples are still wanted (Emirates NBD, ADCB, Al Rajhi and SNB statements; Noon and Amazon invoices).

## 9. Connectors (planned, Phase 6 part 3, D-27)

Status: **plan only, no code.** Each connector needs real accounts and credentials, so the user picks the first one and connects it themselves. An agent never enters real credentials.

**Principle: a connector is just another way a file arrives.** A connector pulls a report from a source's API and turns it into the same `{ headers, rows }` table that `parseUpload` returns. From there the path is unchanged: `ingestFiles` → profile → fingerprint → mapping cache → chips → engine (D-3, D-5). No connector code touches matching, and nothing new goes to the LLM (D-2). Each connector and report type emits a fixed set of column names, so its fingerprint is stable. After the first run's mapping is confirmed, every later pull maps from the cache and asks nothing.

**Which sources first.** Ranked by value to GCC sellers, ease of getting API access, and whether a free test account exists:

| Order | Source | Feeds templates | API and auth | Notes |
| --- | --- | --- | --- | --- |
| 1 | **Shopify** | Orders vs gateway, refunds vs returns, bank vs payouts | Admin GraphQL API, OAuth (custom or public app), read-only scopes `read_orders`, `read_shopify_payments_payouts` | Free development stores. Payouts and balance transactions only for Shopify Payments; other gateways come from the gateway connector |
| 2 | **Odoo** | Ledger side of bank, customer, supplier and B2B recos | JSON-RPC / XML-RPC with a per-user API key (Odoo 14+) | Free trial or self-hosted Docker for testing. Read-only user. `account.move.line`, `sale.order`, `purchase.order`, `stock.picking` |
| 3 | **Amazon SP-API** | Settlement vs orders, fees vs rate card, returns, FBA inventory, reimbursements | Reports API (`GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2`, order and FBA reports), Login with Amazon OAuth, seller authorises the app | Needs a registered developer profile and app review (weeks). Highest value for marketplace sellers. Amazon.ae and .sa share the EU/ME endpoint |
| 4 | **Salla / Zid** | Webstore orders vs gateway/COD/BNPL (KSA) | OAuth partner apps (Salla Partners, Zid apps), REST | Needs a partner account per platform |
| 5 | **Payment gateways**: Stripe, Checkout.com, Tap, PayTabs | Orders vs gateway settlements, fees, chargebacks | API keys (restricted, read-only) or OAuth (Stripe Connect) | Stripe has free test mode; the others need a merchant account |
| 6 | **Zoho Books**, then QuickBooks / Xero / NetSuite / SAP B1 / Dynamics | Ledger side, like Odoo | OAuth REST (Zoho, QBO, Xero); token-based for NetSuite; Service Layer for SAP B1 | One at a time, as customers ask |
| 7 | **Bank feeds** | Bank vs payouts (template 14), cash application | Through an open-banking aggregator (Lean Technologies or Tarabut in UAE/KSA; UAE Open Finance and SAMA open banking), or MT940 / CAMT.053 statements dropped on SFTP | Licensed aggregators sit between Sawwi and the bank, so Sawwi never holds bank logins. Until then, PDF and CSV statements (§8) cover it |
| — | **Noon, Namshi, Trendyol** | Marketplace templates | Partner APIs are limited or invite-only; check per marketplace | Until access exists: forward the emailed report to a per-workspace inbox address, or keep uploading |

My recommendation is to build **Shopify or Odoo first**. Both have free test accounts and simple auth, so they prove the whole pipeline (connect, pull, map, reconcile, schedule) cheaply. **Amazon SP-API** should come next: it is the most valuable source, but it is gated by app review, so start its developer registration in parallel.

**Credentials and auth.**
- Only an owner or admin can connect or disconnect a source, from Settings → Connections. They sign in on the provider's own page (OAuth), or paste a key the provider issued into a form. The app never asks for a password to another service.
- Scopes are read-only, and as narrow as each provider allows.
- New table `connections`, per workspace: provider, account label, scopes, status, last sync, error. Secrets go in a separate `connection_secrets` row encrypted at rest with AES-256-GCM. The key comes from `SAWWI_CONNECTOR_KEY` for now and from a KMS (envelope encryption) in production. Secrets are never sent to the browser, logged or shown again; the UI shows only "Connected as …".
- Refresh tokens are rotated on use. Disconnecting revokes the token at the provider where possible, then deletes the secret. A failed refresh marks the connection "Needs reconnecting" and pauses its syncs.

**Sync model: pull, per period, idempotent.**
- A **binding** links a schedule's slot (D-26) to a connection and report type, e.g. "Settlement vs. sales invoices → settlement slot ← Amazon settlement report; orders slot ← Odoo invoices".
- When a scheduled period comes due, a **sync job** pulls each bound slot for the period's date window and writes the result as CSV, stored like an upload with source metadata. It then calls `ingestFiles` on that period's run, which it creates if needed, behind the same `runBlocker()` check as the Start button. When every slot is filled and nothing needs an answer, it runs the reconciliation and puts the result in Due now / Home as "Ready to review". Anything that needs a human (a new layout, a failed check) stays as a chip question, exactly as for an upload.
- Idempotency is keyed on (connection, report type, window), or on the provider's report id. Re-pulling a window replaces that slot's file rather than appending. Cursors and pull history go in `connection_syncs`.
- Rate limits are respected with backoff. Large windows are paged. A pull is capped at the upload limits (25 MB, ~200k rows); over that, the period is split.

**Infrastructure needed (ask before adding).** Syncs need to run without a user on the page, which the app can't do today (D-26):
- (a) a `jobs` table in the database, plus a cron hitting a protected route (Vercel Cron or any external cron), which is the smallest option;
- (b) a hosted queue such as Inngest;
- (c) a separate worker process.
Any of these also enables the emailed reminders that D-26 deferred.

