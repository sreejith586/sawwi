# Decisions

One entry per decision. Add new entries at the bottom; never rewrite an old one. When a decision changes, add a new entry and mark the old one **Superseded by D-n**.

---

### D-1: v1 scope is GCC e-commerce sellers and brands
- **Context:** Sawwi could serve many industries; trying all at once dilutes the templates.
- **Decision:** v1 covers e-commerce only, from the seller/brand perspective, in the GCC. It covers three channels: marketplaces (Amazon.ae/.sa, Noon, Namshi, Trendyol, any other), own webstores (Shopify, Magento 1 and 2 / Adobe Commerce, WooCommerce, Salla, Zid) and direct B2B sales. Other industries are deferred until these are done end to end.
- **Consequences:** templates, aliases, currencies (AED, SAR, …) and VAT rules are GCC-specific.

### D-2: The LLM never matches rows
- **Context:** most jobs are repeats with new files, and token cost has to stay low.
- **Decision:** matching and checks are deterministic code that runs declarative template specs. LLMs are used only for column mapping (Haiku) and, from Phase 4, for narrative and chat over aggregates. Raw rows are never sent.
- **Consequences:** results are reproducible and cheap, and templates must be expressive enough to declare their checks.

### D-3: Mapping runs cheapest first
- **Decision:** saved mapping by header-layout fingerprint, then known-header heuristics, then Haiku for the leftovers, then one-click chip questions. A repeat run with the same file layout asks nothing.

### D-4: Prompt caching by design
- **Decision:** system prompts and glossaries form a byte-stable prefix with `cache_control` (1h TTL). Usage (input, cache read, cache write, output) is logged per call in `llm_usage`.

### D-5: Matching engine in TypeScript, not DuckDB
- **Context:** the architecture first planned DuckDB.
- **Decision:** joins run in memory in TS. Uploads are capped at 25 MB (~200k rows), which runs in well under a second, and there's no native binary to deploy.
- **Consequences:** revisit if volumes grow.

### D-6: Local SQLite store for now
- **Decision:** `node:sqlite` in `.data/` (git-ignored, `SAWWI_DATA_DIR` overrides it). All SQL is kept in store modules so it can be ported to Postgres later.

### D-7: Uploads go through a route handler
- **Context:** Next.js server actions are capped at 1 MB.
- **Decision:** files are posted to `/api/runs/[id]/files`, and the upload cap is 25 MB.

### D-8: Honest check status
- **Decision:** a check with no automated rule shows "Not run" and is never silently passed. A check that needs an optional file that wasn't uploaded is "skipped". The `asOf` date is the latest date in the files, so results are reproducible.

### D-9: UI language
- **Decision:** neutral app chrome with semantic colours for values: high = danger red, medium = amber (#dc6803 in light mode), info = blue, success = green. Every table has sort and filter and downloads to Excel (built server-side with exceljs, using the same query as the screen).

### D-10: Profile lives on the workspace
- **Decision:** the business profile is stored on the workspace (`orgs.profile_json`), not in a cookie. Runs are filed under the workspace's fixed key. New profile fields are optional and default to "no", so existing workspaces keep working.

### D-11: Accounts and paywall
- **Decision:** email and password accounts with workspaces and roles (owner, admin, editor, viewer). A paywall is off by default and turned on by a superadmin. Stripe Checkout (embedded) handles card payments. See ARCHITECTURE §6a.

### D-12: Brand name stays Sawwi (for now)
- **Context:** a rename to "Sawwina" (e96ff7c) was made because a Saudi company trades as "Sawwi" (sawwi.ai).
- **Decision:** the rename was reverted (1deb94f). The public address is `sawwi.hypermaxsolutions.com` (cddff64).
- **Consequences:** the trademark question is still open. See PROGRESS → Open questions.

### D-13: 3-way matching is cumulative per PO line
- **Decision:** PO, GRN and supplier invoice are matched on PO number + SKU, so partial deliveries and split invoices add up. The accepted quantity is received minus rejected. Price is checked per invoice line against the PO price through a lookup link. Row-level rules can take a `value` expression, because GRNs carry no prices.
- **Consequences:** quantity differences are added into "value at risk" alongside money. This is a known wart, shared with the sales-side 3-way check.

### D-14: Pull requests and living docs
- **Decision:** every change goes through a PR from a descriptively named branch. CI runs tests, typecheck, lint and build. Only the user merges. Every commit updates `docs/PROGRESS.md`, `docs/DECISIONS.md` and, where affected, `docs/ARCHITECTURE.md` and `README.md`. The rules are in `CLAUDE.md` and `docs/PROCESS.md`, so every session picks them up.

### D-15: Narrative from a digest, cached per result
- **Context:** Phase 4 adds a plain-language analysis. Re-opening a run must not spend tokens, and raw rows never go to the LLM (D-2).
- **Decision:** Claude Sonnet 5.5 writes the analysis (headline, up to four findings, three next steps) from `digestText`: totals, how the files matched, every check's count and value, and the 8 largest exceptions by key. It is generated after the report renders and stored in `run_narratives`, keyed by the result's timestamp. Without an API key, or for a viewer opening an uncached run, Sawwi shows the rule-based summary and does not cache it, so a key added later still writes one.
- **Consequences:** re-running a reco invalidates and regenerates it. The narrative can be wrong only in phrasing, not in numbers, because the numbers come from the digest.

### D-16: Chat answers by code first, LLM only for prose
- **Decision:** "What should I fix first?" (ranked by value × severity weight) and breakdowns (by key, month or low-cardinality mapped fields, grouped from the rows behind each exception) are computed in code and use no tokens. The LLM writes only prose: email drafts (Sonnet, from one check's aggregates and its 15 largest items), single-exception explanations (Haiku, from that exception's own rows) and free-text answers (Haiku, digest plus earlier follow-ups). Each has a code-written fallback. Chat messages carry a `payload_json` card.
- **Consequences:** the chips work without an API key, and breakdown numbers always tie to the report.

### D-17: One cached prefix for all report-writing calls
- **Decision:** every narrative, email, explanation and chat call sends two system blocks with `cache_control` (`ttl: "1h"`): the fixed instructions shared by every run and customer, then the run digest shared by every turn on that run. Nothing volatile goes before them. Usage is logged per purpose (`narrative`, `email_draft`, `explain`, `chat`). Sonnet calls set `fallbacks: "default"` (server-side refusal fallback, beta `server-side-fallback-2026-07-01`).
- **Consequences:** Sonnet and Haiku each keep their own cache, so a run's follow-ups on one model read the digest from cache.

### D-18: Generic two-file reco confirms every column with chips
- **Context:** "No template fits" needs to work for any pair of exports, and generic fields like "key" and "amount" match almost any header.
- **Decision:** the generic template (`src/lib/templates/custom.ts`) has a key, an amount, and an optional date, description and currency. Its checks are: missing on either side, amount mismatch within the user's tolerance, and duplicates on either side. Templates with `confirmColumns` skip the AI and turn every required field into a chip ("Is X the key?" or "Which column holds the key?"). For key (id) fields, free-text columns score at half weight and are listed after identifier-like columns, so a bank "Narrative" is never proposed over "Txn Ref". Optional fields map only on a strong name match, or to the file's single date column. The file names and tolerance are set on a chip-first form in the gallery.
- **Consequences:** a few more clicks the first time; the saved mapping makes repeats free.

### D-19: Saved templates are per workspace and carry their mappings
- **Decision:** "Save as a reusable template" stores the generic spec, with the user's names, tolerance and title, in `custom_templates`, keyed by workspace (id `custom-…`). It copies the confirmed column mappings to the new template id, so the next run with the same exports asks nothing. Saved templates appear under "Your templates" in the gallery, where they can be started or deleted. `src/lib/runs/templates.ts` resolves catalogue, generic and saved templates for every run.
- **Consequences:** saved templates aren't shared across workspaces and aren't editable yet. To change one, run a custom reco and save it again.

<!-- D-20 is taken by PR #3 (the PDF plan). -->

### D-20: PDF inputs are Phase 5, cheapest extraction first
- **Context:** GCC bank statements and invoices often come only as PDF. Uploads accepted CSV, TSV and XLSX only.
- **Decision:** PDF support becomes Phase 5, ahead of the usage dashboard and connectors (now Phase 6). A PDF is converted into the same table `parseUpload` returns, so mapping and matching are unchanged. The order is: embedded ZATCA e-invoice XML, then text-layer extraction in code, then a per-workspace layout memory. Deterministic balance and VAT checks run before matching. Scanned PDFs use local OCR only; the user chose this over Claude vision, so page images never leave the server and D-2 holds.
- **Consequences:** text PDFs cost no tokens, and repeat statements ask nothing. How it was built: D-21 to D-24.

### D-21: PDFs are read with pdf.js in Node, with no AI and no native binary
- **Context:** Phase 5 (D-20) needs text with positions, PDF attachments and QR codes from server code, and the app avoids native binaries in deployment (D-5).
- **Decision:** `pdfjs-dist` (legacy build) reads text items with positions, attachments and image data; pages are never rendered, so its optional canvas package is not installed (`ignoredOptionalDependencies` in `pnpm-workspace.yaml`), and `pdfjs-dist` is a `serverExternalPackages` entry so its worker module loads from `node_modules`. `jsqr` (pure JS) decodes ZATCA QR images. UBL XML is read by a small built-in reader. Order: embedded ZATCA XML, then the text layer (QR fills missing invoice totals), then refuse. No LLM calls in this step.
- **Consequences:** text PDFs cost no tokens and give the same answer every time. Scanned PDFs are refused until the user decides on OCR or Claude vision (D-20).

### D-22: The shape of a PDF table
- **Decision:** statements and other tables keep their printed column names, so header fingerprints and saved mappings stay stable month to month; set-aside lines (opening/closing, brought/carried forward, totals, repeated headers) and statement metadata never become rows. Invoices get fixed column names that the heuristics map. The slot picks the grain: slots with SKU, quantity, unit price or line-amount fields get one row per invoice line, others one row per invoice. Credit notes are negative. Several files into one slot are stacked with a `Source file` column. A layout recipe per workspace and issuer (`pdf_layouts`) is saved after every text-layer read and used first next time.
- **Consequences:** a repeat statement from the same bank is read with its saved recipe and mapped from the cache, so it asks nothing. Per-invoice and per-line slots never double count invoice totals.

### D-23: A failed PDF check holds the run
- **Context:** a misread PDF row would otherwise flow silently into matching.
- **Decision:** balance checks (opening + credits − debits = closing, printed totals, running balance) and invoice checks (lines = subtotal, qty × price, VAT = rate × net at 5% UAE / 15% KSA / 10% Bahrain, net + VAT = total) run before matching. A failure is a chat question ("Use these rows anyway?" / "I'll upload a corrected file"). The second answer keeps the question open, so the run stays on hold until the user continues or replaces the file. The file card lists every check, and the preview shows a red banner over the rows. A VAT rate that doesn't match the workspace's countries also fails the check.
- **Consequences:** no silent runs on bad extractions. A UAE workspace that receives KSA invoices sees a 15% warning it has to confirm once per upload.

### D-24: Scanned PDFs are read by local OCR only
- **Context:** D-20 left scanned (image-only) PDFs on hold: Claude vision would send page images beyond D-2, or local OCR keeps them on the server. The user chose: "use local OCR only for scanned PDFs".
- **Decision:** scanned pages are OCR'd on the server with `tesseract.js` (WebAssembly, no native binary, in line with D-21), English and Arabic, using language data from npm packages (`@tesseract.js-data/eng`, `/ara`). It is never fetched from a CDN at runtime. Page images are taken from the PDF as decoded by pdf.js, so nothing is rendered and no canvas package is needed. Page images are never sent to Claude or any external service; D-2 stays intact. The OCR words go through the same table reader, layout memory and balance/VAT checks. Guards: 20 scanned pages per file, one recognition at a time, and OCR output marked as such (confidence, low-confidence rows) on the card, in the chat and over the preview. A failed check holds the run, and so does a scan with nothing to check against.
- **Consequences:** scanned statements and invoices work with no tokens and no data leaving the server, at a few seconds a page. Accuracy depends on scan quality; the checks catch most digit errors. The language data adds about 4.4 MB to `node_modules`. Arabic OCR is untested on real scans until samples arrive.

### D-25: Usage and cost dashboard, priced from one dated table
- **Context:** Phase 6 starts with making token spend visible (ARCHITECTURE §5: "track per-run tokens from day one so cache hit rate is visible"). `llm_usage` already logs every call, keyed by run, so the dashboard needs no new logging and no LLM calls.
- **Decision:** a read-only page at Settings → Usage & cost for every member of the workspace (viewers included; reading is never paywalled, so it needs a session, not `runBlocker()`), and a cross-workspace tab at `/admin/usage` for superadmins. A call belongs to the workspace of its run. It shows tokens (input, cache read, cache write, output), cache hit rate = cache read ÷ (input + cache read + cache write), and estimated cost, by day (UTC), purpose, model and run (admins also by workspace), for the last 7, 30 or 90 days or all time. Every breakdown has sort, filter and an Excel download of the same rows. Prices are US dollars per million tokens in one constant table, `src/lib/usage/pricing.ts`, with an as-of date and a source note: Haiku 5.5 $0.10 / $0.50, Sonnet 5.5 $2 / $10, cache reads at their listed rate, and cache writes at the 1-hour TTL (2× input), because every call caches with `ttl: "1h"` (D-17). Opus 5.5 and Fable 5.1 are listed so a call served by the Sonnet refusal fallback is still priced; a model with no price is counted but left out of the cost, and marked. "Repeat runs that asked nothing" counts completed runs in the period whose workspace had run the same template before, and of those the ones with no chip question and no mapping call. History before the period decides what is a repeat. All maths is pure (`src/lib/usage/aggregate.ts`) and tested.
- **Consequences:** costs are estimates at list prices, not an invoice (no Batch or partner pricing, no Haiku long-prompt tier). Changing prices means editing one table and its date. A fallback-served call is logged under the model that answered, as before. The chart is a single series, so it has no legend; it uses a new `--chart-1` token, validated in both themes.
### D-26: Scheduled runs are reminders with an inbox, computed on read
- **Context:** most recos repeat weekly or monthly with new files (§5). Until connectors exist (Phase 6, part 3) there is no automatic file source, so a schedule can't run a reco by itself. The app has no job runner, cron or email sender.
- **Decision:** the smallest useful version. A **schedule** is a template + cadence: weekly on a weekday, or monthly on a day (29–31 fall back to the month's last day), in UTC, stored per workspace (`schedules`). Editors add one from the template page ("Remind us every week on …"). Whether it is due is worked out when a page loads (`src/lib/schedules/due.ts`, pure and tested), so nothing runs in the background. The first due date is the first occurrence on or after the day the schedule was made. A due schedule shows in **Due now** on Home and on the new Schedules page (sidebar). **Start** creates an ordinary run for that period and tags it (`runs.schedule_id`, `runs.schedule_period`). The run is created on click, not ahead of time, so a schedule nobody acts on never uses up the plan's monthly runs. Clicking again opens the same run, so nothing is created or counted twice. Saved mappings (D-3) apply as on any run, so a repeat with the same exports asks nothing. The schedule then shows "In progress" until the run has a report, then "Up to date" with the next date. A period that was never started is skipped once the next one comes due, and only the latest period is shown. Gating: creating a schedule and starting its run go through `runBlocker()`, so viewers, suspended workspaces and ended trials or used-up run limits are blocked, and starting a run counts toward `runsPerMonth` like any run. Pause, resume and delete need edit rights (`canRun`). Viewers can see schedules and download them, but change nothing. There is no separate per-plan schedule limit. Every table sorts, filters and downloads as Excel (`/api/schedules`).
- **Rejected alternatives:** (1) **pre-creating each period's run** when it comes due. It would use up a plan run (`runsThisMonth` counts created runs) for every schedule, whether or not anyone uploads, and it would need something to create the run, i.e. a page load or a job. Creating it on Start gives the user the same thing (a run for the period, with mappings reused) without the side effect. (2) A **job runner** (cron, queue, worker), ruled out for now (no new infrastructure); computing due state on read needs none.
- **Consequences:** no new infrastructure and no LLM calls. Reminders are in-app only. Emailed reminders, or runs that start themselves when a connector brings new files, need a job runner (and an email provider). I'll ask the user before adding either. Custom saved templates can be scheduled by the action, but the form is only on catalogue template pages for now.
### D-27: Connectors plan: a connector is another way a file arrives
- **Context:** Phase 6 includes connectors (marketplace APIs, ERPs, bank feeds). Each needs real accounts, credentials and often app review, and the app has no job runner.
- **Decision (plan only, no code yet):** see ARCHITECTURE §9.
  - A connector pulls a report and emits the same `{ headers, rows }` table as `parseUpload`, with fixed column names per report type. It goes through `ingestFiles` → mapping cache → engine unchanged, so after the first confirmed mapping a pull asks nothing. No new LLM use (D-2).
  - Order of work: Shopify or Odoo first (free test accounts, simple auth, proves the pipeline), then Amazon SP-API (most value, gated by app review), then Salla/Zid, payment gateways, Zoho and other ERPs, and bank feeds via a licensed open-banking aggregator (Lean or Tarabut) or MT940/CAMT.053 over SFTP. Noon, Namshi and Trendyol depend on partner API access.
  - Credentials: OAuth, or provider-issued read-only keys, entered by an owner or admin on the provider's page or a key form. Secrets are encrypted at rest (AES-256-GCM; KMS in production) in their own table, never shown, logged or sent to the browser. Disconnecting revokes them.
  - Sync: pull per schedule period (D-26) through slot bindings, idempotent per window. The run is created behind `runBlocker()` and reconciled automatically when nothing needs an answer.
- **Consequences:** connectors depend on a job runner, which needs the user's approval (D-26). The user picks the first connector and connects it with their own account; agents never enter real credentials.

### D-28: First connector is Shopify orders, behind a small connector framework
- **Context:** the user asked for as much as possible without them. Connectors need real accounts, so this has to be built against the providers' documented APIs and tested with synthetic fixtures, then verified live by the user later.
- **Decision:**
  - A small framework (`src/lib/connectors/`): source interface, encrypted credentials per workspace, import history, and pulls fed into `ingestFiles` as a CSV, so mapping and matching are unchanged (D-27).
  - The first connector is **Shopify orders** (Admin GraphQL `2026-10`, read-only `read_orders`). Its token comes from a custom app the merchant creates in their own admin, so Sawwi needs no public-app listing or OAuth review to start. Its fixed columns map onto the webstore orders slot by name.
  - Secrets use AES-256-GCM with `SAWWI_CONNECTOR_KEY` from the environment, and the workspace is bound as associated data. Secrets are never returned to the browser.
  - Pulls are manual: "Import from a connection" on a run slot, behind `runBlocker()`. Owners and admins add or remove connections.
  - Rejected alternatives:
    - A **watched folder or SFTP drop**: it needs a server filesystem or an SFTP service per tenant, and a poller.
    - An **upload-by-email inbox**: it needs an inbound mail provider and a domain.
    - **Amazon SP-API first**: more valuable, but it can't be built or verified without a registered developer app.
    - **Shopify OAuth (public app)** instead of a custom-app token: it needs an app listing and callback hosting; it can come later for one-click installs.
    - **Scheduled automatic pulls**: they need a job runner (D-26), which the brief rules out for now.
- **Consequences:** the whole flow is tested with replayed responses, but not yet against a live store. The user needs to create a custom app in a Shopify store and paste its token once. Changing `SAWWI_CONNECTOR_KEY` makes stored tokens unreadable (reconnect needed). The `read_orders` scope only reaches back 60 days unless the merchant grants `read_all_orders`.

### D-29: Business Central connector (API v2.0, client credentials), with a mock tenant for tests and demos
- **Context:** the user's design partner runs Microsoft Dynamics 365 Business Central, so the user asked for it first ("Can we start building a connector for that first?"), then for a mock-up of the connection and its data. Nobody has a BC tenant for Sawwi yet, and agents never enter real credentials.
- **Decision:**
  - **Auth:** service-to-service OAuth (client credentials) against Microsoft Entra ID: tenant ID or domain, environment name, application (client) ID, client secret, and an optional company name. Token from `login.microsoftonline.com/{tenant}/oauth2/v2.0/token`, scope `https://api.businesscentral.dynamics.com/.default`. Entra only offers `API.ReadWrite.All` for BC, so read-only is enforced inside BC: the customer adds the app on "Microsoft Entra Applications" with a read-only permission set (e.g. D365 READ). Sawwi only sends GETs. Both hosts are fixed and tenant/environment are validated; `@odata.nextLink` must stay on the API host.
  - **Data:** the standard API v2.0, no BC extension needed. Eight reports with fixed column names chosen to match the template field labels, so mapping is exact with no AI: sales invoices, sales invoice lines, sales credit memos, open sales order lines, sales shipment lines, open purchase order lines, purchase receipt lines (GRN) and purchase invoice lines. They feed the B2B templates (cash application, order → delivery → invoice, price compliance, returns vs credit notes, B2B payment release) and the purchasing three-way match. Window filter on `postingDate` (`orderDate` for orders); drafts are left out. Decimals are written with at least 2 places (`7350.00`), as BC shows them; whole numbers would otherwise profile as IDs on small pulls.
  - **Two API v2.0 limits, handled deterministically:** invoice lines carry no shipment number, so "Delivery note no." is filled from the order's shipments only when unambiguous (one shipment of that item, or exactly one with the same quantity), else left blank. And BC deletes an order once it is fully invoiced, so the order-lines reports cover open orders only.
  - **Report hints per template:** the slot key `invoices` means customer invoices, sales invoice lines or vendor invoice lines depending on the template, so a report's slot hint can name `template/slot`; the run page offers those first.
  - **Mock tenant** (`src/lib/connectors/mock/`): an in-process stand-in for Entra and BC API v2.0 (token, companies, companyInformation, `$filter`, `$expand`, paging) with an invented company, *Sawwi Demo Trading LLC*, and October 2026 documents containing deliberate exceptions. Tests run the real connector against it. Locally, `SAWWI_CONNECTOR_MOCK=business-central` routes BC's hosts to it so the whole flow can be demoed in the browser; Settings shows a "Demo mode" note with **Fill demo values**. It is ignored when `NODE_ENV=production`. The demo values (including a made-up secret) are sent to the form only in mock mode; they work only against the mock.
  - **Rejected alternatives:**
    - **OData web services or a custom AL API page** (e.g. for customer/vendor ledger entries, which v2.0 lacks): more data, but the customer must publish pages or install an extension. Standard v2.0 works on any BC online tenant; ledgers can follow as a small AL extension if the partner wants them.
    - **Delegated OAuth (a user signs in)**: tokens tied to one person, MFA and expiry; client credentials suit unattended pulls.
    - **BC on-premises**: needs Entra auth configured on their server and a reachable URL; online first.
    - **A recorded-fixture JSON file** like Shopify's: fine for unit tests, but can't drive a browser demo. The mock answers real URLs, so the same code path runs in tests and in the demo.
- **Consequences:** no live tenant has been called. The partner needs an Entra app registration, a client secret, and the app enabled in BC with a read-only permission set; then a live check (D-28's rule: the user connects with their own account). Customer and vendor ledger statements (b2b-customer-statement, p2p-supplier-statement) aren't covered by v2.0 and still come from uploads.

### D-30: Magento 2 connector (REST, integration token), a network guard for self-hosted sources, and a mock store
- **Context:** the user asked for Magento 2 after Business Central ("yes, start Magento 2 with a mock store"). Magento 1/2 exports are already the most common webstore uploads (the alias table is built around their grids), so a connector removes the most frequent manual export. Unlike Shopify or Business Central, every Magento store runs on its own domain.
- **Decision:**
  - **Auth:** an integration access token (System → Extensions → Integrations) with read-only resources: Sales → Operations (Orders, Credit Memos, Shipments) and Stores → Settings (for the weight unit). Sent as a Bearer token, which Magento 2.4.4+ accepts only with "Allow OAuth Access Tokens to be used as standalone Bearer tokens" = Yes; the help text and error message say so. Sawwi only sends GETs to `/rest/V1`.
  - **Three reports** with fixed columns named after the template fields:
    - **Orders** feed the orders slot of orders vs gateway, COD remittance and BNPL. They include the payment method code and title, and totals, refunds and shipping.
    - **Credit memo lines** feed the refunds slot of refunds vs returns. There is one line per refunded item, configurable parent/child pairs are collapsed to one line, and the order's number is looked up because credit memos only carry its internal ID.
    - **Shipments** feed the courier freight shipments slot. There is one row per tracking number. Weight is in kg, converted from lbs if the store uses lbs. When the unit can't be read, the row says "kgs (assumed)".
  - Windows use `created_at` in UTC as whole days, both ends inclusive. Paging stops at `total_count`, because Magento repeats the last page when asked past the end.
  - **Network guard for every live connector request** (`net-guard.ts`):
    - only https, and the store URL must be a public host name (no IPs, ports, logins or internal names);
    - every request's host is resolved and refused if any address is private, loopback, link-local, CGNAT or reserved;
    - redirects aren't followed.
    This stops a connection from pointing Sawwi's server at its own network. Shopify and Business Central go through the same guard.
  - **Mock store** (`mock/magento*.ts`): the invented *Sawwi Demo Store* at the reserved address `demo-store.sawwi-mock.example`, with October 2026 orders paid by card, cash on delivery and BNPL, a cancellation, a partial and a full refund, a shipment with two tracking numbers and one with none, and orders just outside the month. It answers Magento's search criteria (filters, `in`, paging). Tests use it. `SAWWI_CONNECTOR_MOCK=magento` (or `business-central,magento`) enables it locally, never in production.
  - **Connection form:** it now submits without React's automatic form reset. The reset made the source picker show Shopify while Magento's fields were on screen.
  - **Rejected alternatives:**
    - **Magento GraphQL**: built for the storefront; admin sales data (credit memos, shipments) is in REST.
    - **OAuth 1.0a signed requests**: work on every version without the bearer setting, but every request has to be signed with four secrets. The bearer token is one secret and is Adobe's documented path for 2.4.4+. Signing can come later if a store can't change the setting.
    - **Admin username and password tokens** (`integration/admin/token`): they'd hold an admin's login and expire after hours.
    - **Pinning the host like Shopify**: impossible for self-hosted stores, hence the guard.
- **Consequences:** no real store has been called. The user, or the merchant, creates the integration and pastes its token once. Magento 1 isn't covered (its API is SOAP/XML-RPC and end-of-life); Magento 1 grid exports keep coming in as uploads. The guard resolves DNS before each request, so a host that changes its DNS between the check and the connection (DNS rebinding) is a small remaining risk. Pinning the resolved address per request would close it.

### D-31: One-click demo data for every reconciliation the mocks can cover
- **Context:** the user wanted to see how reconciliations work from the demo connections ("Let me import mock data when I use Import from connection so I can see demo how the recon works"). The Business Central and Magento mocks only fill their own side. Orders vs gateway, for example, also needs a gateway settlement, and COD needs courier files. Importing slot by slot was also slow for a demo.
- **Decision:**
  - **"Demo data" source** (`src/lib/connectors/demo.ts`, data in `mock/demo-files.ts`): made-up counterpart files that fit the mock store's and mock company's documents, each with planted exceptions:
    - a card gateway settlement and a Tabby settlement;
    - courier COD status and remittance;
    - a courier freight invoice and rate card;
    - warehouse returns received;
    - bank receipts for cash application.

    It has no credentials, calls nothing, and has `template/slot` hints so the right file is offered for each slot. Dated files are filtered to the period.
  - **"Fill with demo data"** on the run page (`/api/runs/[id]/demo-fill`, `demo-fill.ts`): it connects the mocked sources and Demo data if they aren't connected yet. For each empty slot it imports the best-fitting report from those sources only, never a real connection, for October 2026. It goes through `runBlocker()` like any import, and is offered to editors.
  - **Covered templates:** orders vs gateway, BNPL, COD remittance, refunds vs returns, courier freight, cash application, order → delivery → invoice and the three-way match all fill completely, ask nothing, and find their planted exceptions (tested).
  - **Only in demo mode:** all of this needs `SAWWI_CONNECTOR_MOCK` set, and none of it works in production. The source isn't offered, its saved connections are hidden, and the route answers 404.
  - **Rejected alternatives:**
    - **Static sample CSVs to upload by hand:** slower to demo, and they would drift from the mock data.
    - **A "demo workspace" seeded in the database:** it hides how a real run is built, and it would be hard to keep in step with templates and mappings.
    - **Running the reconciliation automatically after the fill:** a demo should show the "Ready to reconcile" step.
- **Consequences:** marketplace templates, price compliance, returns vs credit notes and the supplier and customer statements have no demo data yet. The button names the slots it couldn't fill. Changing the mock documents means updating the counterpart files and their tests together.

### D-32: A public demo store, reset daily, replaces the developer demo switch
- **Context:** the user asked for demo data for the marketplace templates too, then: "Make the demo data only available for a default demo store so visitors can run it and see how the reconciliation works", and "let the demo store reset every 24 hours." Until now demo data was a developer switch (`SAWWI_CONNECTOR_MOCK`, D-29 to D-31). It added demo connections to whichever workspace was signed in, and it never ran in production.
- **Decision:**
  - **One shared demo workspace** (`src/lib/demo/`), key `_sawwi_demo`, named "Sawwi Demo Trading".
    - Real keys come from company names and only contain letters, digits and hyphens, so no customer workspace can ever be mistaken for it.
    - It is created on first use, on the unlimited plan, with a profile covering every channel so every template applies.
    - One shared visitor user has Editor access and a random, discarded password. Visitors can run reconciliations but can't manage the team, plan or profile, and nobody can log in as the visitor.
  - **Entry:** "Try the live demo" on the landing and login pages is a form POST, so link prefetching never starts a session. It signs the browser in as the visitor; no account is needed. A banner in the app says it's the live demo, that the data is invented and shared, and when it next resets, with a link to create a real workspace. `SAWWI_DEMO=off` hides the demo.
  - **Demo data lives only there.**
    - The Business Central and Magento mocks and the Demo data files are built-in sources of the demo workspace (`demo:<provider>`), not saved connections. They hold no secrets, need no encryption key, and their requests are answered in-process.
    - Real workspaces never see these sources, can't add Demo data, and get "no longer exists" if they try to pull from a `demo:` source.
    - `SAWWI_CONNECTOR_MOCK` and the "Fill demo values" form are removed.
  - **Marketplace demo data:** one invented seller (MP-10xx orders, two October settlements, fees, ads, returns, claims, fulfilment stock, business-order invoices). All 8 marketplace templates fill completely and find their planted exceptions, so 16 templates have demo data in total.
  - **Shared and public, so:**
    - **Uploads are off.** Nobody's real files end up where other visitors can see them; the upload area explains this.
    - **Connections can't be added or removed** in the demo.
    - **No AI calls.** `llmAvailable()` is false for the demo workspace, so visitors can't run up token costs. Summaries, emails and explanations use the rule-based text, and free-text chat says it is off in the demo.
  - **Daily reset at 00:00 UTC**, on the first request after midnight (checked in `getCurrentSession`), like due dates in D-26, so no job runner is needed.
    - It deletes every row filed under the demo's key, and its runs' rows, in every table, including tables added later. It also removes the runs' uploaded files.
    - The workspace and its visitor stay, so an open tab keeps working; earlier runs simply disappear.
    - The last reset time is stored in a new `demo_state` table.
  - **Rejected alternatives:**
    - **A private sandbox per visitor:** nobody sees anyone else's runs, but every visit creates a workspace, which needs cleanup and abuse limits. One shared store, wiped daily, is the "default demo store" the user described.
    - **Keeping the developer switch alongside:** two ways to get demo data, one of which could put mock sources in a real workspace.
    - **Allowing uploads with a warning:** visitors would still put real customer files into a shared space.
    - **A cron job for the reset:** needs a job runner (D-26). Resetting on read does the same without one.
    - **Allowing AI in the demo with a quota:** possible later; the rule-based text already shows the flow.
- **Consequences:** visitors share one store, so they can see each other's runs for up to a day. That's acceptable for invented data, and the banner says so. A visitor working at midnight UTC sees their runs vanish. The supplier and customer statement, price compliance and returns-vs-credit-notes templates still have no demo data. The demo's runs count in admin usage and lists like any workspace. Developers now try the connectors through the demo store; there's no switch to mock them in their own workspace.

### D-33: The chat lives in a resizable right sidebar, the mirror of the left nav
- **Context:** the user asked: "Open the chat agent on a right side bar similar to the left nav bar. Also allow width adjustment using mouse so the user can click and drag the left border." Before this, "Ask Sawwi" was a fixed 384px overlay opened from the top bar, with placeholder content. The real chat agent was a fixed 360px column on each reconciliation page.
- **Decision:**
  - **One right-hand panel in the app shell** (`components/shell/chat-panel.tsx`), opened and closed from the top bar's chat button.
    - From 64rem it docks: full height and sticky, pushing the page over like the left sidebar does.
    - Below 64rem it is an overlay drawer with a backdrop, and Escape closes it, as the left nav does on phones.
    - Open/closed and the width live on `<html>` (`data-chat`, `--chat-width`) and in localStorage. An inline script restores them before first paint (`lib/chat-panel.ts`, same pattern as the sidebar and theme), so the panel never jumps on load.
  - **Resizing:** the user drags the panel's left border.
    - The width stays between 300 and 720 px, and never takes more than 60% of the window.
    - Double-click resets it to 384 px.
    - The border is also a focusable `separator`: Left and Right arrows change it by 24 px, and Home / End go to the maximum and minimum.
  - **A reconciliation's chat goes into the panel** through a portal into `#chat-panel-slot`, so its state stays in the run page. The page itself uses the full width. On other pages the general Ask Sawwi panel shows, still a placeholder.
    - When a run has a setup question, the panel opens on wide screens, and the chat button shows a red dot whenever the panel is closed.
    - Clicking "Explain" or a follow-up opens the panel.
    - The question count under the title has an "Answer in the chat" link.
- **Rejected alternatives:**
  - **Keeping the run chat in its page column alongside a separate panel:** two chats side by side, and less room for the report.
  - **A resize library:** pointer events and one CSS variable are enough.
  - **Width in React state:** it would flash the default width before hydration, and layouts would re-render while dragging.
- **Consequences:** on a run page the chat is closed until the user opens it, unless a question is waiting, so it no longer takes 360 px by default. On narrow screens it covers the page while open.

### D-34: Run pages open the chat panel by default, under one header
- **Context:** after D-33 the user asked: "open the chat panel by default on run pages". On a reconciliation, the chat is where setup questions are answered and the report's follow-ups happen, so it should be in view without a click.
- **Decision:**
  - **Where it can dock** (64rem and up), a run page opens the panel. On a direct visit the inline script opens it before first paint, so it doesn't pop in late. On a click-through, the run page opens it when it mounts.
  - **Not saved as the user's choice.** Leaving the run restores the panel to how the user left it elsewhere. Only the top bar's button and the close button save a choice. Explain, the follow-ups and "Answer in the chat" also open it without saving.
  - **Narrow screens:** the panel stays closed, because it would cover the page. The chat button's dot still shows when a question is waiting.
  - **One header.** The user asked: "Do we need both the headers?" The panel header ("Ask Sawwi" and close) and the run chat's own header ("S · Sawwi · Ask about this result · AI off") are merged. The run's status and the AI off tag now sit under "Ask Sawwi", portalled into a second panel slot (`header`), and the run chat no longer has a header of its own.
  - **Robustness fix:** the panel announces its slots when it mounts, and run pages subscribe to them. The run's chat therefore lands in the panel whichever of the two renders first. Before, a run page could miss the slot and never look again.
- **Rejected alternatives:**
  - **Saving "open" when a run page opens it:** the panel would then stay open on every page afterwards, which the user didn't ask for.
  - **Opening it on narrow screens too:** it covers the whole page there.
- **Consequences:** closing the panel on a run page closes it for this visit only; the next run page opens it again. Testing note: a hidden browser pane never runs animation frames, so React never reveals streamed page content there and pages look stuck on "Loading…". That is a test-environment effect, not an app bug.

### D-35: Canned questions in a fresh chat, answered by rules
- **Context:** the user asked: "Add a list of canned questions when the chat is fresh." A new chat showed only a greeting, so people didn't know what to ask. Before a report there was nothing to ask at all, and the general panel was a "coming soon" placeholder.
- **Decision:**
  - **On a reconciliation:** while nobody has asked anything and no setup question is waiting, the chat lists "What files do I need?", "What does this reconciliation check?", "How are the files matched?" and "Where do I find these exports?".
    - Each is a new chat intent (`about`), answered from the template by rules (`src/lib/insights/about.ts`): the files with their required fields, the automatic and manual checks, each link's keys, tolerances and date window, and typical exports per file. That means no AI and no tokens.
    - It works before any file is uploaded, and in the demo store. The answers are saved in the run's chat like any other.
    - Questions not yet asked stay listed as "More questions" until there's a report. After that, the report's follow-up buttons take over, so "What should I fix first?" isn't listed twice.
  - **In the general panel** (no reconciliation open): "What can Sawwi reconcile?", "How does matching work?", "Is my data sent to AI?" and "Which reconciliations need my attention?".
    - The answers are fixed, shown on the spot in the panel, and link to Templates, Reconciliations and Home.
    - They aren't saved. Free questions across all reconciliations are still to come.
- **Rejected alternatives:**
  - **Sending canned questions to the AI:** it costs tokens for answers the template already knows, and it wouldn't work in the demo or without a key.
  - **Showing them only before the first message:** the remaining ones were lost after one click.
  - **Static FAQ text in the panel:** a question and its answer read better in a chat.
- **Consequences:** the answers change automatically when a template changes. They are only as good as the template's descriptions and examples.

### D-36: Demo data for every template, and Phase 6 closed
- **Context:** the user asked to "add demo data for the remaining templates" and to start the next phase in a new session if Phase 6 is then finished. Seven templates had no demo data: customer and supplier statements, price compliance, returns vs credit notes, post-dated cheques, bank vs payouts, and import landed cost.
- **Decision:**
  - Add made-up files for them (`src/lib/connectors/mock/finance-files.ts`), served by the demo store's Demo data source (D-31, D-32). They refer to the demo company's own documents, so each reconciliation lines up end to end:
    - Business Central invoices and credit memos meet a customer's statement, a price list and an RMA log;
    - its vendor bills meet a supplier statement;
    - the demo store's card, Tabby and courier payouts meet a bank statement;
    - its POs meet customs declarations and forwarder bills.

    Each file plants exceptions. A test fills and reconciles all 23 templates and fails if a template is added without demo data.
  - Phase 6 (usage dashboard, scheduled runs, connectors, plus the demo store and chat panel built along the way) is marked done. What's left is live checks and decisions that need the user or the design partner, listed in PROGRESS → Next and Open questions. The next phase starts in a new session, beginning with a scope proposal, because no Phase 7 is defined yet.
- **Rejected alternative:** a future-dated cheque to show "Due within 30 days". A reconciliation's "as of" date is the latest date in its data, so a future cheque becomes the as-of date and reads as already due. The demo shows past-due cheques only.
- **Consequences:** a planted duplicate shows up twice on purpose. A bill entered twice in the supplier ledger is flagged as a duplicate, and its total also differs from the statement. The same happens with the AWB billed twice in courier freight.


### D-37: Phase 7 is "go live": Postgres on Neon, private Blob uploads, a connector keyring, deployed on Vercel
- **Context:** Phase 6 left three candidates: a job runner, more connectors, and production readiness. Nothing has run for a real user yet. The Anthropic path and the Business Central, Shopify and Magento live checks are all waiting, and where the app is hosted decides how a job runner works. The user chose production readiness on **Vercel + Neon**.
- **Decision:** Phase 7 makes Sawwi deployable at sawwi.hypermaxsolutions.com. It ships as six PRs, in order:
  1. **Scope** (this entry).
  2. **Postgres everywhere.** `node:sqlite` goes. Production uses Neon, added through the Vercel Marketplace (`DATABASE_URL`), via `pg` with a module-level `Pool` and `attachDatabasePool` from `@vercel/functions` (Fluid compute). Local dev and tests use PGlite (in-process Postgres, no Docker, no account) when `DATABASE_URL` is unset, so there's one SQL dialect. The store API becomes async. SQL stays in the store modules, and the schema stays in `src/lib/db.ts` as numbered migrations recorded in a `schema_migrations` table. No ORM.
  3. **Uploads in private Vercel Blob** (`@vercel/blob` 2.3+, private store), behind a small file-storage interface; local disk in dev. Vercel caps a function's request body at 4.5 MB, below the 25 MB upload cap, so files go from the browser straight to Blob (client upload with a server-issued token, checked with `runBlocker()`), and the server reads them back from Blob.
  4. **A connector keyring.** Envelope encryption: each secret gets its own data key, wrapped by a master key with a key ID. Master keys come from a sensitive Vercel environment variable (`SAWWI_CONNECTOR_KEYS`, several allowed for rotation), and a re-wrap command moves secrets to the newest key. A cloud KMS can be added later as another key provider. There is no AWS or GCP account in this plan, so none is required now.
  5. **Vercel deploy.** Project config, a `/api/health` route (database and Blob reachable), the region chosen next to the Neon database, the full environment variable list, and a runbook (`docs/DEPLOY.md`): first deploy, domain, secrets, Stripe webhook, rollback, backups (Neon point-in-time restore).
  6. **Jobs table + Vercel Cron.** This is the smallest job runner from D-26/D-27, option (a). It's a `jobs` table and a cron route protected by `CRON_SECRET`, which first takes over the demo store's daily reset and a sweep of due schedules. Scheduled connector pulls and emailed reminders build on it in a later phase.
- **Needs from the user:**
  - a Vercel Pro team (the Hobby plan is for non-commercial use and allows only daily cron), with the project linked to the GitHub repo;
  - Neon and a private Blob store added from the project's Storage tab;
  - the DNS record for sawwi.hypermaxsolutions.com;
  - production secrets entered by the user in Vercel: Stripe live keys and webhook secret, `ANTHROPIC_API_KEY`, the connector keys and `CRON_SECRET`.

  Agents never enter or see them.
- **Rejected alternatives:**
  - The Neon serverless driver (`@neondatabase/serverless`): `pg` with pooling is the fit for Vercel Fluid compute.
  - Keeping SQLite for dev next to Postgres in production: two dialects, and production bugs found late.
  - Docker Postgres for tests: an extra install for every contributor and in CI.
  - Uploads as `bytea` in Postgres: it bloats the database and its backups.
  - Public blobs: uploads are customers' financial data.
  - An AWS KMS now: a second cloud account the user didn't choose.
  - Building B (job runner) or C (connectors) first: B depends on the host, and C adds unverified connectors before the built ones have had a live check.
- **Consequences:**
  - Every store call and its callers become async, which is the largest single change of the phase.
  - Tests run against PGlite, which is real Postgres, so SQL tested locally is the SQL that runs in production.
  - Data residency for GCC customers (UAE, and KSA's PDPL) depends on the Vercel and Neon regions. It's an open question for the user before real customer data goes in.

### D-38: Postgres everywhere: raw SQL kept, `?` placeholders numbered at runtime, PGlite for dev and tests
- **Context:** D-37's second PR. `node:sqlite` is synchronous and file-based, which doesn't work on Vercel (no persistent disk). About 100 store functions and every caller had to become async.
- **Decision:**
  - `src/lib/db.ts` exposes a small async API (`all`, `get`, `run`, `tx`) over two drivers: `pg` with a pool when `DATABASE_URL` is set (Neon), PGlite otherwise. It is cached on `globalThis` so dev hot reloads never open a second PGlite on the same folder.
  - The SQL stays raw, in the store modules. `?` placeholders are kept and numbered (`$1`, `$2`, …) at runtime, outside quoted text, so the SQL diff is small and readable. Only SQLite-only syntax changed:
    - `json_extract` became `::jsonb #>>`;
    - `GROUP_CONCAT` became `string_agg`;
    - `PRAGMA` and `sqlite_master` became `information_schema` (in the demo wipe, which runs in one transaction);
    - `AUTOINCREMENT` became an identity column;
    - an ambiguous `uses + 1` is qualified.
  - All tables, including the ones the SaaS store and team roster used to create lazily, now live in one numbered migration in `db.ts`, recorded in `schema_migrations`. Later schema changes are new migrations, never edits.
  - Column types stay as they were (TEXT for dates and JSON, INTEGER flags). Changing them would touch every mapper for no user-visible gain. Revisit with real volumes.
  - The callers were converted by a codemod plus hand fixes. Lists that looked up templates one at a time now look them up with `Promise.all`. `LayoutMemory` (PDF layout recipes) accepts async `find`/`save`.
  - Type-aware lint rules (`no-floating-promises`, `no-misused-promises`, `await-thenable`) are on for `src/`, so a forgotten `await` fails CI.
  - The connection string is read from `DATABASE_URL`, or from `SAWWI_DATABASE_URL`. The second is the name Vercel's Neon integration gives it when, as in production, the integration was set up with the "SAWWI" prefix.
- **Rejected alternatives:**
  - An ORM (Drizzle, as ARCHITECTURE §6 first planned): a rewrite of every query on top of the async change.
  - Rewriting placeholders to `$n` by hand: noisy diffs, and easy to misnumber.
  - Keeping SQLite for development: two dialects (D-37).
  - Importing old local `.data/sawwi.db` data: it's development data only, and nothing is in production yet.
- **Consequences:**
  - Local data starts empty after this change (the old SQLite file is ignored).
  - Tests run on real Postgres semantics. The suite also passed against a Postgres 17 container through the `pg` driver, apart from one test that assumes its own database per file.
  - `pnpm lint` is slower, since it now type-checks.
  - Tests time out after 30 s instead of 5 s: the first query in each file starts PGlite, which takes seconds on a busy runner.

### D-39: Files in a private Vercel Blob store; large uploads go from the browser straight to Blob
- **Context:** D-37's third PR. Normalized tables were written to `.data/uploads` on local disk, which doesn't survive on Vercel. Vercel also caps a function's request body at 4.5 MB, while Sawwi accepts uploads up to 25 MB.
- **Decision:**
  - A small file store (`src/lib/files/storage.ts`: put, read, size, delete, delete by prefix) over a **private** Vercel Blob store when its token is set, and `.data/files/` otherwise.
    - A connected store shows up as `BLOB_STORE_ID`, and the SDK signs in with the deployment's short-lived Vercel OIDC token, so no long-lived Blob secret exists. A read-write token (`BLOB_READ_WRITE_TOKEN`, or `SAWWI_`-prefixed) works too.
    - On Vercel without a token it refuses to run, like the database.
    - Keys are built on the server and checked, so they can't climb out of the store's folder.
  - What's kept is unchanged: each slot's **normalized CSV** (`runs/<run>/<slot>.csv`), not the original upload. `run_files.stored_path` now holds that key.
  - **Uploads with Blob on:**
    1. The browser uploads each file to `incoming/<run>/<slot>/` through a **presigned URL** from `/api/runs/[id]/uploads`. That route uses `issueSignedToken`, which works with OIDC, unlike the older client-token flow, which needs a read-write token. It signs only for the run's own workspace, never in the demo store, and only for one `put` on one path in that folder, limited to the upload file types, 25 MB and 10 minutes.
    2. The browser posts the resulting paths to the existing files route. It accepts only paths in that run's slot folder, re-checks the 25 MB total, reads and parses the files, and always deletes the raw copies.

    Locally, without Blob, the browser still posts multipart form data.
  - The browser checks the file type and the 25 MB total before uploading, with the server's own wording, so a refused token never shows up as a vague network error.
  - The upload limits live in `upload-paths.ts`, shared by the browser and the server.
  - **Fixed along the way:** uploading a file, answering a setup question and remapping a column now go through `runBlocker()`, like pulls, demo fill and reconciling already did. Before, a Viewer (or a suspended workspace, or one whose trial had ended) could upload files into a run, answer its questions and change its mappings, though Viewers are meant to read reports only.
- **Rejected alternatives:**
  - Public blobs: they're reachable by anyone with the URL, and these are financial files.
  - Streaming uploads through a function: the 4.5 MB cap.
  - Keeping the original files: nothing reads them after parsing, and keeping them would double the stored customer data.
  - Using the upload-completed webhook: it can't reach localhost or previews reliably. The browser's second request is simpler and goes through the same session checks.
- **Consequences:**
  - A raw upload abandoned between the two requests (the tab closed) stays in `incoming/` until the jobs runner (PR 6) cleans the folder.
  - The direct-upload path needs a real Blob store to run, so it is tested with a mocked SDK, and checked on a preview deploy.
  - **Found on the first preview deploy:** the connected store came with `BLOB_STORE_ID` (OIDC) and no read-write token, so Blob stayed off and the demo reset failed. Blob is now on with either credential, and deleting an empty list needs no store.
