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

### v1 catalogue: GCC sellers/brands (Marketplace + Webstore + Direct B2B + Purchasing), 26 templates

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
24. Store invoices vs. ERP posted invoices (e.g. Magento 2 → Business Central): not synced, posted twice, total, VAT or customer differs (D-52; the customer check is the engine's `text_mismatch` rule, which compares a text field across matched records, ignoring case and blanks)
25. Store refunds (credit memos) vs. ERP credit notes: not posted, posted twice, amount or VAT differs (D-53)
26. Store stock vs. ERP inventory per SKU: overselling, stock hidden from the store, SKUs unknown to the ERP (D-54; gaps valued at quantity × unit price through a `compare` rule's `value` expression, where `diff` is left minus right)

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

**Usage dashboard (Phase 6, D-25).** Settings → Usage & cost reads `llm_usage` joined to `runs` (a call belongs to its run's workspace) and shows estimated cost, tokens, cache hit rate (cache read ÷ all prompt tokens) and the share of repeat runs that asked nothing (no chip question, no mapping call), with a cost-per-day chart and breakdowns by day, purpose, model and run. Every breakdown sorts, filters and downloads as Excel (`/api/usage`). Superadmins get the same across workspaces at `/admin/usage` (`/api/admin/usage`). Prices live in `src/lib/usage/pricing.ts` (per million tokens, dated, cache writes at the 1-hour TTL); the maths is pure in `src/lib/usage/aggregate.ts`. The page makes no LLM calls and is readable by viewers.

## 6. Stack

_Current:_ Next.js 16, TypeScript, Tailwind v4, Postgres (Neon in production via `pg`, PGlite locally and in tests; D-37, D-38), an in-memory TS matching engine (D-5, D-6), exceljs and the Anthropic SDK. The original plan is below, kept for reference.

- **Next.js 16 (this repo):** UI, auth, API routes / server actions
- **Postgres**: orgs, users, templates, mappings, answers, runs, exceptions (built in Phase 7 with raw SQL in store modules, no ORM; D-38)
- **DuckDB** (Node bindings, server-side): the matching engine over uploaded CSV/XLSX/Parquet (replaced by the TS engine, D-5)
- **Object storage** (S3/R2): uploaded files and generated reports (XLSX/PDF)
- **Anthropic SDK:** Haiku 5.5 / Sonnet 5.5, prompt caching, Batch API
- **Job queue** (e.g. Inngest/BullMQ): long-running recos and scheduled repeat runs

## 6a. Accounts, workspaces and paywall (SaaS groundwork)

- **Public:** `/` intro page, `/signup`, `/login`, `/forgot-password`, `/reset-password` (D-46), and the SEO pages `/reconciliation/*` and `/reconciliation-templates/*` with `sitemap.xml`, `robots.txt` and `opengraph-image` (D-47). `src/proxy.ts` guards only the routes in its matcher, so these need no change there. Everything else needs a session (`src/proxy.ts` does an optimistic cookie check; `src/lib/saas/session.ts` re-validates against the DB in every page, action and route).
- **Accounts:** email + scrypt password, DB-backed sessions (only the token hash is stored). Each sign-up creates a workspace (`orgs`) whose fixed `key` files its runs, mappings and members; the business profile lives on the workspace. Invited emails join the inviting workspace on sign-up or login.
- **Roles:** owner / admin (team, profile, plan) / editor (run reconciliations) / viewer (read reports only).
- **Paywall:** plans and limits in `src/lib/saas/plans.ts`, enforced by `entitlement()`. Off by default (early access); a superadmin turns it on in `/admin`. Blocked workspaces keep read access to existing reports. No payment provider yet: "Choose plan" files a request that a superadmin approves.
- **Card payments (Stripe):** `/checkout/[plan]` embeds Stripe Checkout (`ui_mode: embedded_page`, subscription mode) with card, Apple Pay / Google Pay and Link. Prices come from `STRIPE_PRICE_*`; one Stripe Customer per workspace. `/checkout/return` verifies the session belongs to the workspace and applies the plan at once; `/api/stripe/webhook` (signature-verified) keeps it in sync for renewals, failed payments, cancellations and portal changes. "Manage billing" opens Stripe's billing portal. Checkout is offered only while the paywall is on; Enterprise stays a request.
- **Superadmin:** granted only via `SAWWI_SUPERADMIN_EMAILS`. Console at `/admin`: paywall, trial length, open sign-ups, plan requests, workspaces (plan, trial, suspend), users and AI usage across workspaces, with Excel exports.
- **Storage:** Postgres (D-38). `src/lib/saas/store.ts` holds all SQL for this; tables are created in `src/lib/db.ts`.

## 6b. Database (Phase 7, D-37, D-38)

- **One dialect, two drivers.** `src/lib/db.ts` opens `pg` (a pooled connection to Neon, closed cleanly on Vercel via `attachDatabasePool`) when `DATABASE_URL` is set (or `SAWWI_DATABASE_URL`, its name under the Vercel integration's "SAWWI" prefix), and PGlite (Postgres compiled to WASM, in-process) otherwise: `.data/pglite` in development, a fresh in-memory database per test file under Vitest. On Vercel, a missing `DATABASE_URL` is an error rather than a silent local database.
- **API.** `getDb()` returns `all`, `get`, `run` (→ `{ changes }`) and `tx(fn)`, all async. Store modules keep `?` placeholders; `toPositional` numbers them for Postgres. COUNT/SUM (int8, numeric) come back as JS numbers.
- **Schema.** Numbered, append-only migrations in `db.ts`, recorded in `schema_migrations` and applied on first use under an advisory lock, so cold-starting instances don't race. Columns stay `TEXT` (ISO dates, JSON strings) as in the SQLite schema; JSON is read with `::jsonb` where SQL needs it.
- **Guard rails.** The type-aware lint rules `no-floating-promises`, `no-misused-promises` and `await-thenable` fail on a missed `await`, since a Promise is always truthy.

## 6c. Files (Phase 7, D-39)

- **Store.** `src/lib/files/storage.ts`: a private Vercel Blob store when one is connected (`BLOB_STORE_ID`: the SDK signs in with the deployment's short-lived Vercel OIDC token) or a read-write token is set (`BLOB_READ_WRITE_TOKEN`, or `SAWWI_`-prefixed), `.data/files/` otherwise; on Vercel, no store is an error. Keys are built on the server: `runs/<run>/<slot>.csv` is a slot's normalized table (what `run_files.stored_path` holds and every later step reads); `incoming/<run>/<slot>/<n>-<random>.<ext>` is a raw browser upload waiting to be parsed. Reads skip the CDN cache, so a replaced file is never stale. Blobs are private: nothing is reachable by URL without the token.
- **Uploads.** Vercel caps a function's request body at 4.5 MB, below the 25 MB upload limit. With Blob on, the run page uploads each file straight to Blob (`@vercel/blob/client`, multipart above 5 MB) using a presigned URL from `/api/runs/[id]/uploads` (`handleUploadPresigned` + `issueSignedToken`). That route checks the run belongs to the workspace, runs `runBlocker()`, refuses the demo store, and signs a 10-minute `put`-only token for one path in the run's `incoming/` folder, limited to the upload types and 25 MB. The page then posts `{ slot, uploads }` to `/api/runs/[id]/files`, which only accepts that run's slot folder, re-checks the total size, parses, and deletes the raw copies whatever happens. Locally, files are posted as multipart form data, as before.
- **Deleting.** The demo store's daily reset deletes its runs' `runs/` and `incoming/` folders. Raw uploads abandoned between the two requests are cleaned up by the jobs runner (Phase 7, PR 6).

## 6d. Deployment (Phase 7, D-41)

Vercel project `hypermax-solutions/sawwi`, functions in `fra1` (`vercel.json`) next to the Neon database. `/api/health` reports whether the database and file store answer. Everything else (what production needs, environment variables, shipping, rollback, restore) is in `docs/DEPLOY.md`.

## 6e. Background jobs (Phase 7, D-42)

- `jobs` table (migration 2): kind, unique key, payload, status (queued → running → done / failed), run-after time, attempts, lock expiry, result or last error.
- `src/lib/jobs/store.ts`: queue by key (a duplicate key is a no-op), claim due jobs with `FOR UPDATE SKIP LOCKED` (a running job whose lock expired is taken again), finish, fail with retry, prune.
- `src/lib/jobs/runner.ts`: `tick()` queues the periodic jobs for the current period (keys like `demo_reset:2026-11-07`, `cleanup_incoming:2026-11-07T10`), then runs due jobs in batches of 5 within a 45 s budget. Failures retry after 1 and 2 minutes, and fail for good after 3 attempts; an unknown kind fails at once. Handlers are idempotent.
- Jobs: `demo_reset` (D-32, also still checked on each demo request), `cleanup_incoming` (raw uploads over an hour old, D-39), `prune_jobs` (done jobs over 30 days), `schedule_reminders` (hourly, D-45) and `send_email` (one per message, D-45).
- `runJobsNow(keys)` claims and runs only those jobs; a request uses it from `after()` to send an email it just queued without waiting for the next tick. A handler error with `retryable: false` fails the job at once.
- `/api/cron/tick` is called every 15 minutes by Vercel Cron (`vercel.json`), with `Authorization: Bearer $CRON_SECRET` checked in constant time. Admin shows the last 15 jobs.
- Next on this: scheduled connector pulls (D-27) as a new job kind.

## 6f. Email (Phase 8, D-44, D-45)

- **Transport.** `src/lib/email/send.ts`: Resend's REST API with `RESEND_API_KEY`, a log line without it (with the body only off Vercel). Sender `EMAIL_FROM`, default `Sawwi <sawwi@sawwiapp.ai>`. Each request carries the job key as `Idempotency-Key`. 429/5xx are retryable; other errors aren't.
- **Design.** `templates.ts` renders every email into one HTML layout (`layout()`: logo, card, heading, paragraphs, figure tiles, a button, footer; tables and inline styles, light palette from `globals.css`) plus a plain-text copy. `scripts/send-test-email.ts` sends one of each to an address, run by hand with a key.
- **Queue.** `src/lib/email/queue.ts`: `queueEmail(key, payload)` adds a `send_email` job (template name, data, recipient, and the user and topic to re-check). `sendSoon(keys)` sends them from `after()`. `deliver.ts` re-checks the recipient's switch, renders (`templates.ts`, pure) and sends.
- **Who gets what.** `src/lib/email/store.ts` holds the SQL: `email_prefs` (migration 3: reminders, notices; no row = on) and `recipients(orgKey, roles, topic)`, which leaves out suspended workspaces, deactivated teammates and anyone with that topic off.
- **Reminders** (`reminders.ts`): the hourly `schedule_reminders` job reads each workspace's schedule rows (`schedules/view.ts`, the same due maths as the Schedules page) and queues one email per due period (no run yet, due in the last 7 days) for each owner, admin and editor: key `email:reminder:<schedule>:<period>:<user>`. The demo store is skipped.
- **"Ready to review"** (`notices.ts`): `reconcileRun` queues one email per other member of the workspace, any role (key `email:ready:<run>:<user>`), with the exception count and value, rows matched and the report link, and sends them right after the response.
- **Password reset** (D-46): `/forgot-password` → `requestPasswordReset` (`src/lib/saas/reset.ts`; SQL in `reset-store.ts`, tables `password_resets` and `reset_requests`, migration 4) → a `reset` email with `/reset-password?token=…` → `resetPassword` uses the token once, sets the password, voids other links and deletes the user's sessions → `/login?reset=1`. Rate limits are counted in the database by hashed email (3 an hour, silently) and hashed IP (10 an hour, with an error).
- **Settings → Email** (`/settings/email`): each person's own switches, any role. The demo store sends nothing.

## 6g. Public pages and SEO (Phase 8, D-47)

- **Routes** (`src/app/(marketing)/`, with the shared header and `MarketingFooter`): `/reconciliation` (hub), `/reconciliation/[slug]` (nine pages from `src/lib/seo/solutions.ts`), `/reconciliation-templates` and `/reconciliation-templates/[id]` (one per seeded template). All are static, prerendered from `generateStaticParams`.
- **Facts from code:** template pages render the spec's sources, checks (ruled ones as checks, the rest as "listed for review") and outputs (`components/marketing/template-details.tsx`). `src/lib/seo/coverage.ts` says which connector fills which slot, and `seo.test.ts` checks it against each connector's reports.
- **Metadata:** `pageMetadata()` (`src/lib/seo/metadata.ts`) sets the title, description, canonical, OpenGraph and Twitter cards with the shared image (`app/opengraph-image.tsx`). `metadataBase` is `APP_URL`. JSON-LD helpers are in `src/lib/seo/jsonld.ts` (`SoftwareApplication`, `BreadcrumbList`, `FAQPage`), rendered by `components/marketing/json-ld.tsx`.
- **Crawling:** `app/sitemap.ts` (every public page) and `app/robots.ts` (app routes and reset pages disallowed; previews disallow everything).

## 7. Build phases

Status: see `docs/PROGRESS.md` (kept current) and `docs/DECISIONS.md`. Phases 1–7 done (Phase 6: usage dashboard §5, scheduled runs, connectors and the demo store §9, chat panel; Phase 7, D-37: live on Vercel + Neon with Postgres everywhere, private Blob uploads, a connector key ring and the jobs table). Phase 8 (D-44) is in progress: email through Resend (§6f: reminders, "ready to review" notices, password reset) and public SEO pages for the reconciliations Sawwi covers (§6g). Phase 3 = deterministic matching engine (`src/lib/recon/`) running each template's links and check rules, report UI with sort/filter, Excel export of every table. Phase 4 (PR #2) is merged; its notes follow. PDF inputs (§8, PR #4) are merged.

Phase 4 (`src/lib/insights/`):
- **Analysis above the report.** Claude Sonnet 5.5 writes a headline, up to four findings and three next steps from a digest (`digestText`: totals, per-check counts/values and the 8 largest exceptions by key, never rows). Fetched after the report renders, then cached per result in `run_narratives`, so re-opening a run costs nothing. No API key, or a viewer opening an uncached run: the rule-based summary (`ruleNarrative`), not cached so a later key still writes one.
- **Chat panel (D-33).** The run's chat is portalled into the app shell's right-hand panel (`components/shell/chat-panel.tsx`, `#chat-panel-slot`), opened from the top bar. It docks from 64rem, can be resized by dragging its left border (or with the arrow keys) between 300 and 720 px, and is a drawer on narrow screens. Open state and width are kept on `<html>` (`data-chat`, `--chat-width`) and restored before paint (`lib/chat-panel.ts`). Run pages open it by default where it docks, without saving that as the user's choice (D-34). A fresh chat lists canned questions (D-35): on a run, the `about` intent answers them from the template by rules (`src/lib/insights/about.ts`); in the general panel, fixed answers. A waiting setup question opens it, or marks the chat button with a dot.
- **Follow-up chat** on the run page, chips first: "What should I fix first?" (ranked by value × severity in code, zero tokens), "Break down <check> by key/month/SKU/…" (grouped in code from the rows behind each exception; Excel at `/api/runs/[id]/breakdown`), "Draft email to <counterparty>" (Sonnet, from one check's aggregates and its 15 largest items; copyable), "Explain <exception>" (Haiku 5.5, from that exception's own rows; also an Explain button per exception row), and free text (Haiku, digest + earlier follow-ups). Every AI answer has a code-written fallback. Messages live in `messages` with a `payload_json` card (email, breakdown, fix list).
- **Prompt caching.** Every call sends the same two system blocks with `cache_control` (1h): fixed instructions shared by all runs, then the run digest shared by every turn on that run. Sonnet calls use the server-side refusal fallback (`fallbacks: "default"`). Usage is logged per purpose (`narrative`, `email_draft`, `explain`, `chat`).
- **No template fits.** The gallery's "Start a custom reconciliation" names the two files (preset chips or free text) and picks a tolerance; the run uses the generic two-file spec (`src/lib/templates/custom.ts`: key + amount, optional date/description; missing either side, amount mismatch, duplicates). Its fields are always confirmed with chips (`confirmColumns`), with no AI guess. "Save as a reusable template" stores the spec per workspace (`custom_templates`) and copies the confirmed mappings, so the next run with the same exports asks nothing. Saved templates show under "Your templates" in the gallery. `src/lib/runs/templates.ts` resolves catalogue, generic and saved templates for every run.
- Chat and analysis actions keep `getOwnedRun` + `runBlocker()`; downloads are read-only like the other exports.

Phase 6, scheduled runs (D-26, `src/lib/schedules/`):
- A schedule is a template + cadence per workspace (`schedules` table): weekly on a weekday, or monthly on a day of the month (29–31 clamp to the month end), in UTC. Editors add one from the template page.
- Due state is computed when a page loads (`due.ts`, pure). There is no job runner. The first due date is the first occurrence on or after creation. A schedule is due when its latest occurrence has no run, in progress when that period's run has no report yet, and up to date once it has one. Paused schedules are never due.
- **Due now** (Home, and `/schedules` in the sidebar) lists due schedules. Start (`startScheduledRun`) checks `runBlocker()`, creates an ordinary run tagged with `runs.schedule_id` and `runs.schedule_period`, and opens it; a second click opens the same run. The mapping cache makes a repeat with the same exports ask nothing. Runs are created only on Start, so they count toward the plan's monthly runs only when used.
- Pause, resume and delete need edit rights. Viewers see schedules and the Excel export (`/api/schedules`).
- Emailed reminders (D-45, §6f): the hourly sweep mails owners, admins and editors once per due period. Later: connector-triggered runs (a pulled file goes into the period's run).

Decision (Phase 3): matching runs in TypeScript in memory rather than DuckDB. Uploads are capped at 25 MB (~200k rows), which in-memory joins handle in well under a second, and it avoids a native binary in deployment. Revisit DuckDB if volumes grow.


1. Onboarding, template catalogue (seeded specs) and gallery UI
2. Upload, file profiling, mapping (cache + Haiku), chip-question chat
3. DuckDB matching engine executing template specs, plus exceptions
4. Report UI and export; narrative and follow-up chat; email drafts
5. Generic reco when no template fits, and save-as-template
6. PDF inputs: bank statements, invoices and settlement statements as PDF (§8)
7. Usage/cost dashboard, scheduled runs, connectors (marketplace APIs, ERP, bank feeds)
8. Go live: Postgres (Neon), object storage (Vercel Blob), key management, deploy (Vercel), job runner (D-37; the repo's Phase 7)
9. Email (Resend: reminders, notices, password reset) and SEO pages (D-44; the repo's Phase 8)

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

Status: **framework, the Shopify orders connector (D-28), the Business Central connector (D-29) and the Magento 2 connector (D-30) are built**; the rest of this section is the plan. Each connector needs real accounts and credentials, so live checks wait for the user, who connects with their own account. An agent never enters real credentials, and tests never call a provider.

**What's built (D-28, `src/lib/connectors/`).**
- `types.ts`: a `Connector` has credential fields, reports, `parseCredentials`, `test` (one cheap read-only call) and `pull(report, window)`, which returns a `ParsedTable`. `fetch` and `sleep` are injected, so tests replay synthetic responses (`fixtures/shopify.json`).
- `shopify.ts`: Admin GraphQL `2026-10`, `orders` query paged by cursor (250 a page), backoff on HTTP 429/5xx and `THROTTLED`, readable errors for 401/403/`ACCESS_DENIED`. The store must be `*.myshopify.com`, so a connection can't point the server at another host. Auth is an Admin API token from a custom app with `read_orders` (`read_all_orders` for orders older than 60 days). It returns 15 fixed columns ("Order", "Created at", "Financial status", "Payment gateway", "Total", "Total refunded", …), which the known-header heuristics map onto the webstore orders slot with no AI.
- `crypto.ts` (D-40): envelope encryption. Each secret is sealed (AES-256-GCM) with its own random data key, which is wrapped by a named master key from `SAWWI_CONNECTOR_KEYS` (`id:key,…`, first active; the older single `SAWWI_CONNECTOR_KEY` counts as `k0`). Format `v2.<keyId>.…`; v1 secrets from D-28 still open. The workspace and provider are bound in as associated data, so a secret copied to another workspace won't decrypt. Without a key, connections can't be added. `keyring.ts` reports which key each secret is under and re-wraps them under the active key; superadmins run it from Admin → Connection secrets after adding a new key, then remove the old one.
- `store.ts`: `connections` (encrypted secret, status, last error, last import) and `connection_syncs` (every import, with its window, run, slot, rows and status).
- `service.ts`: `addConnection` (validate, test, encrypt) and `pullIntoRun`. `pullIntoRun` pulls, writes CSV and calls `ingestFiles` on the slot, so it's the same path as an upload: the mapping cache, chips and checks all apply. Auth or scope failures mark the connection "Needs attention"; an empty period doesn't.
- UI: Settings → Connections lets owners and admins add or remove a connection; everyone sees the list and the import history (sort, filter, Excel at `/api/connections/syncs`). On a run, each file slot has "Import from a connection" with a period (default: last month, UTC), offered to editors and up. It posts to `/api/runs/[id]/pull` behind `runBlocker()`.
- `business-central.ts` (D-29): Dynamics 365 Business Central online, API v2.0, client-credentials OAuth (tenant, environment, client ID, secret, optional company). Eleven reports, each a small spec (entity, date field, `$expand` for lines, fixed columns): sales invoices / invoice lines / credit memos, open sales order lines, shipment lines, open purchase order lines, receipt lines, purchase invoice lines, and posted sales invoices (D-52) and credit memos (D-53) for web orders: only documents with an External Document No., the store's order number, plus the sell-to e-mail; and items with inventory and unit price (D-54), which has no date field, so it's pulled without `$filter` whatever the window. Paging follows `@odata.nextLink` (API host only); 429/5xx back off; Entra `AADSTS…` codes and BC 401/403/404 become readable messages. Invoice lines get "Delivery note no." from the order's shipments when that is unambiguous. Report slot hints may name `template/slot`, ranked first on the run page (`slot-fit.ts`).
- `mock/`: in-process stand-ins with invented October 2026 data: a Business Central tenant (Entra token, companies, `$filter`/`$expand`, paging) and a Magento store at a reserved `.example` address (search criteria, paging). Tests use them, and the demo store's built-in sources (`demo:<id>`) pull from them through `demoDeps`, which refuses any other host. The mock tenant has two companies with data: "Sawwi Demo Trading LLC" (B2B and purchasing) and "Sawwi Demo Store LLC", the demo Magento store's books (D-52). Each is its own demo source; a source can be limited to some of its connector's reports (`reports`, `demoSourceOffers`), so the web reports come only from the store company and the B2B demo results don't change.
- `magento.ts` (D-30): Magento 2 / Adobe Commerce REST `/rest/V1` with an integration token (Bearer). Reports: orders, invoices (order number and customer e-mail looked up from the internal ID, D-52), credit memos as totals with shipping and adjustment refunds (D-53), stock per SKU and source from Multi-Source Inventory `inventory/source-items` (current, not filtered by date, sorted by SKU and source for stable paging; only in-stock sources are sellable; D-54), credit memo lines (order number looked up likewise), shipments with one row per tracking number (weight in kg via `store/storeConfigs`). Search criteria on `created_at` (UTC, whole days), paging stopped at `total_count`.
- `demo.ts`, `demo-fill.ts`, `mock/demo-files.ts`, `mock/marketplace-files.ts`, `mock/finance-files.ts` (D-31, D-32, D-36): all 26 templates have demo data; the demo store's built-in sources: two Business Central companies and the Magento store from the mocks plus a credential-free "Demo data" source with made-up files (a marketplace seller's sales, settlements, fees, ads, returns, claims and stock; card and Tabby settlements; courier, warehouse and bank files; customer and supplier statements, a price list, RMAs, cheques, payouts and imports, `mock/finance-files.ts`). All 26 templates have demo data (D-34). "Fill with demo data" on the run page (`/api/runs/[id]/demo-fill`) fills every empty slot for October 2026. Only the demo workspace sees any of it.
- `net-guard.ts` (D-30): every live request (all connectors) must be https to a public host name whose addresses are all public; redirects are refused. `liveDeps` applies it; mocked URLs skip it.
- Not built yet: scheduled pulls (needs a job runner), OAuth apps (Shopify public app, Amazon LWA), KMS key management, BC ledger entries (need a custom API page), and the other sources below.

**Public demo store (D-32, `src/lib/demo/`).** "Try the live demo" (landing and login pages, `startDemo`) signs the visitor into one shared workspace, key `_sawwi_demo`, as an Editor with no usable password. It has invented data only: built-in sources, uploads off, connections read-only, and no AI calls (`llmAvailable(orgKey)` is false). A banner shows when it next resets. `getCurrentSession` calls `resetDemoIfDue()` for the demo workspace: the first request after 00:00 UTC deletes every row under the demo key, and its runs' rows and uploads (`demo/store.ts`, generic over tables with `org_key` / `run_id`), then records the time in `demo_state`. `SAWWI_DEMO=off` turns it off.

**Principle: a connector is just another way a file arrives.** A connector pulls a report from a source's API and turns it into the same `{ headers, rows }` table that `parseUpload` returns. From there the path is unchanged: `ingestFiles` → profile → fingerprint → mapping cache → chips → engine (D-3, D-5). No connector code touches matching, and nothing new goes to the LLM (D-2). Each connector and report type emits a fixed set of column names, so its fingerprint is stable. After the first run's mapping is confirmed, every later pull maps from the cache and asks nothing.

**Which sources first.** Ranked by value to GCC sellers, ease of getting API access, and whether a free test account exists:

| Order | Source | Feeds templates | API and auth | Notes |
| --- | --- | --- | --- | --- |
| 1 | **Shopify** | Orders vs gateway, refunds vs returns, bank vs payouts | Admin GraphQL API, OAuth (custom or public app), read-only scopes `read_orders`, `read_shopify_payments_payouts` | Free development stores. Payouts and balance transactions only for Shopify Payments; other gateways come from the gateway connector |
| 2 | **Odoo** | Ledger side of bank, customer, supplier and B2B recos | JSON-RPC / XML-RPC with a per-user API key (Odoo 14+) | Free trial or self-hosted Docker for testing. Read-only user. `account.move.line`, `sale.order`, `purchase.order`, `stock.picking` |
| 3 | **Amazon SP-API** | Settlement vs orders, fees vs rate card, returns, FBA inventory, reimbursements | Reports API (`GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2`, order and FBA reports), Login with Amazon OAuth, seller authorises the app | Needs a registered developer profile and app review (weeks). Highest value for marketplace sellers. Amazon.ae and .sa share the EU/ME endpoint |
| 4 | **Salla / Zid** | Webstore orders vs gateway/COD/BNPL (KSA) | OAuth partner apps (Salla Partners, Zid apps), REST | Needs a partner account per platform |
| 5 | **Payment gateways**: Stripe, Checkout.com, Tap, PayTabs | Orders vs gateway settlements, fees, chargebacks | API keys (restricted, read-only) or OAuth (Stripe Connect) | Stripe has free test mode; the others need a merchant account |
| 6 | **Zoho Books**, then QuickBooks / Xero / NetSuite / SAP B1 | Ledger side, like Odoo | OAuth REST (Zoho, QBO, Xero); token-based for NetSuite; Service Layer for SAP B1 | One at a time, as customers ask. **Dynamics 365 Business Central was pulled forward for the design partner and is built (D-29)** |
| 7 | **Bank feeds** | Bank vs payouts (template 14), cash application | Through an open-banking aggregator (Lean Technologies or Tarabut in UAE/KSA; UAE Open Finance and SAMA open banking), or MT940 / CAMT.053 statements dropped on SFTP | Licensed aggregators sit between Sawwi and the bank, so Sawwi never holds bank logins. Until then, PDF and CSV statements (§8) cover it |
| — | **Noon, Namshi, Trendyol** | Marketplace templates | Partner APIs are limited or invite-only; check per marketplace | Until access exists: forward the emailed report to a per-workspace inbox address, or keep uploading |

My recommendation is to build **Shopify or Odoo first**. Both have free test accounts and simple auth, so they prove the whole pipeline (connect, pull, map, reconcile, schedule) cheaply. **Amazon SP-API** should come next: it is the most valuable source, but it is gated by app review, so start its developer registration in parallel.

**Credentials and auth.**
- Only an owner or admin can connect or disconnect a source, from Settings → Connections. They sign in on the provider's own page (OAuth), or paste a key the provider issued into a form. The app never asks for a password to another service.
- Scopes are read-only, and as narrow as each provider allows.
- New table `connections`, per workspace: provider, account label, scopes, status, last sync, error. Secrets go in a separate `connection_secrets` row encrypted at rest with AES-256-GCM. Envelope encryption under a named, rotatable master key from `SAWWI_CONNECTOR_KEYS` (D-40); a cloud KMS can later supply the master key instead. Secrets are never sent to the browser, logged or shown again; the UI shows only "Connected as …".
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

