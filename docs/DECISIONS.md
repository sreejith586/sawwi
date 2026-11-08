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
- **Update:** the public address moved to `sawwiapp.ai` (D-43).

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

### D-40: Connector secrets: envelope encryption under a named, rotatable key ring
- **Context:** D-37's fourth PR. Connection tokens were sealed straight under one key, `SAWWI_CONNECTOR_KEY`. That key had no name, and changing it made every stored token unreadable. D-37 ruled out a cloud KMS for now, since there's no AWS or GCP account.
- **Decision:**
  - **Envelope encryption** (format `v2`). Each secret is sealed with its own random 256-bit data key (AES-256-GCM, workspace and provider as associated data). The data key is wrapped by a master key whose id is stored with the secret.
  - **Master keys** come from `SAWWI_CONNECTOR_KEYS`, a list of `id:key` entries with the active key first. In production this is a sensitive Vercel variable. A malformed ring switches connections off rather than half-working. The old single `SAWWI_CONNECTOR_KEY` still works as key `k0`, and `v1` secrets still open, so nothing breaks on deploy.
  - **Rotation:**
    1. Add the new key in front of the old one and redeploy.
    2. In Admin → Connection secrets, re-encrypt: every secret gets a fresh data key under the active key, written only if it hasn't changed since it was read.
    3. Remove the old key once that page shows no secrets left under it.

    Secrets that no key on the server opens are counted, never overwritten. It's a superadmin action rather than a script because Vercel has no shell.
  - The design leaves room for a cloud KMS later: it would wrap and unwrap the data keys instead of the environment keys, with no change to the stored format beyond the key id.
- **Rejected alternatives:**
  - A cloud KMS now: a second cloud account, which D-37 ruled out.
  - Re-encrypting with one new key and no ids: a deploy gap would leave secrets unreadable.
  - A command-line rotation script: there's no shell on Vercel.
- **Consequences:** env-held master keys are only as safe as the Vercel project's environment settings, so production keys must be marked Sensitive. Losing every key that a secret is sealed under means those connections must be re-added.

### D-41: Deploying on Vercel: functions in Frankfurt next to Neon, a health check, a runbook
- **Context:** D-37's fifth PR. The Vercel project already existed, and production (`main`, still SQLite) was failing on every page: `mkdir /var/task/.data` fails on Vercel's read-only disk. Neon (`neon-sawwi`, Frankfurt, Free plan) and a private Blob store (`sawwi-blob`, signed in through OIDC) are connected for Production and Preview, with the "SAWWI" prefix. The team is on a Vercel Pro trial.
- **Decision:**
  - **Region:** functions run in `fra1` (`vercel.json`), the same region as the Neon database. A page makes several sequential queries, and a cross-region round trip on each would cost more than the distance to the Gulf.
  - **Health check:** `/api/health` is public and uncached. It reports only ok/failing for the database and the file store, plus which store and region, never error details. Uptime checks and the runbook use it.
  - **`pg` SSL:** a Neon URL's `sslmode=require` is rewritten to `verify-full`. That's what `pg` already does, but it warns about it on every cold start.
  - **Runbook:** `docs/DEPLOY.md` lists what production needs, every environment variable per environment, how to ship and check a change, how to roll back, and how to restore.
  - **Schema migrations stay additive,** because a rollback doesn't undo them and the old deployment serves against the new schema until promotion.
- **Rejected alternatives:**
  - A region nearer the Gulf with the database in Frankfurt: every query would cross regions.
  - Moving Neon to a Gulf region: there's no Neon region in the GCC. The UAE and KSA data-residency question stays open.
- **Consequences:**
  - Gulf users get roughly 100 ms extra latency per page.
  - Neon Free's limits (storage, compute hours, short restore window) mean upgrading before real customer data.
  - Production stays broken until this PR stack (#16–#20) is merged, because `main` still uses SQLite.

### D-42: Background jobs: a jobs table run by Vercel Cron every 15 minutes
- **Context:** D-37's last PR. The app had no way to do work without a visitor. The demo store reset on its first request after midnight (D-32), and raw uploads abandoned between the two upload requests (D-39) were never cleaned up. D-26 and D-27 deferred a job runner for scheduled pulls and emailed reminders.
- **Decision:** option (a) from D-27: a `jobs` table in Postgres plus Vercel Cron calling a protected route.
  - **Queueing is by unique key**, so two ticks or two instances never queue the same work twice. Periodic jobs are keyed by their period (day or hour) and queued as of the tick's own clock, so they run in that tick.
  - **Claiming** uses `FOR UPDATE SKIP LOCKED` with a 5-minute lock. Two runners never take the same job, and a job whose runner crashed is taken again once its lock expires.
  - **Retries:** 3 attempts, 1 and 2 minutes apart, then the job is marked failed. An unknown kind fails at once. Handlers must be idempotent.
  - **`/api/cron/tick`** checks `Authorization: Bearer $CRON_SECRET` in constant time. It is off (503) when no secret is set. It runs jobs within a 45 s budget, and `vercel.json` schedules it every 15 minutes.
  - **First jobs:** the demo reset (the on-request check stays as a fallback), deleting `incoming/` uploads older than an hour, and pruning finished jobs older than 30 days.
  - Admin lists the last 15 jobs with their status, attempts and result or error.
- **Rejected alternatives:**
  - Inngest or another hosted queue: a new account and SDK for three small jobs.
  - A separate worker process: Vercel doesn't run one.
  - One cron entry per job: harder to add jobs to, and no retries or history.
- **Consequences:**
  - Cron runs on production deployments only, and more often than daily needs Vercel Pro.
  - Jobs start at most 15 minutes late.
  - The next job kinds are scheduled connector pulls and emailed reminders (D-26, D-27). Reminders also need an email provider.

### D-43: The public address is sawwiapp.ai; every other domain redirects to it
- **Context:** the user registered `sawwiapp.com` and `sawwiapp.ai` and pointed both at the Vercel project. Both served the app directly, next to `sawwi.hypermaxsolutions.com` (D-12). Several addresses serving the same app split sign-in cookies (a session on one domain isn't sent to another), can't all be the Stripe webhook URL, and split search ranking.
- **Decision:**
  - `sawwiapp.ai` is the primary domain, chosen by the user. `DEFAULT_APP_URL` (`src/lib/site.ts`) and the documented `APP_URL` are `https://sawwiapp.ai`.
  - `sawwiapp.com`, the `www` hosts and `sawwi.hypermaxsolutions.com` are set in Vercel to redirect (308) to `sawwiapp.ai`, so old links keep working.
  - The Stripe webhook points at `https://sawwiapp.ai/api/stripe/webhook`, and the runbook (`docs/DEPLOY.md`) spells out the event destination settings.
- **Rejected alternatives:**
  - `sawwiapp.com` as primary: the user's choice was `.ai`.
  - Serving every domain without redirects: split cookies and duplicate content.
  - Dropping `sawwi.hypermaxsolutions.com`: links already shared would break.
- **Consequences:** users signed in on the old address sign in once more on `sawwiapp.ai`. The domain redirects and `APP_URL` are set by the user in Vercel; the code default only matters where `APP_URL` is unset.

### D-44: Phase 8 is email through Resend, and SEO for the reconciliations Sawwi covers
- **Context:** Phase 7 is live at `sawwiapp.ai` (D-43). The jobs table (D-42) made background work possible, and D-26/D-27/D-42 left emailed reminders waiting on an email provider. The site had one public page, so search engines had nothing to find for "Magento reconciliation" or "Business Central reconciliation". The user chose Phase 8: Resend for email, and SEO that clearly covers Magento, Dynamics 365 Business Central and the other important reconciliations. Scheduled connector pulls were not chosen; they stay for later.
- **Decision:** three PRs, stacked in this order so they merge without conflicts:
  1. **Email foundation, reminders and notices** (D-45): an email module (Resend when `RESEND_API_KEY` is set, a log line otherwise), sending as `send_email` jobs with unique keys, an hourly sweep that emails owners, admins and editors when a schedule comes due, a "ready to review" email when a reconciliation finishes, and per-user switches in Settings → Email.
  2. **Password reset** (D-46): `/forgot-password` with a signed, single-use token that expires within an hour, stored hashed, rate-limited, that never reveals whether an email has an account.
  3. **SEO** (D-47): public pages for Magento 2, Business Central, Shopify, Amazon and Noon settlements, and bank, gateway, COD and BNPL reconciliation; a public template catalogue built from the seeded specs; sitemap, robots, metadata, canonical URLs, OpenGraph and JSON-LD.
- **Rules for both:** agents never create the Resend account or enter keys; tests never call Resend. Public copy says only what the product does today: connectors are built but not yet checked against live accounts (PROGRESS), so the pages say "connector" for Shopify, Magento 2 and Business Central and "upload the export" for everything else. No reviews, ratings or customer logos.
- **Rejected alternatives:** scheduled connector pulls (not chosen by the user); Postmark or SES (the user picked Resend, and has a key).
- **Consequences:** the user sets up Resend (account, DNS records for `sawwiapp.ai`, `RESEND_API_KEY` and `EMAIL_FROM` in Vercel, docs/DEPLOY.md). Until then, emails are logged, not sent.

### D-45: Email: Resend's REST API, one job per message, reminders hourly, notices right away
- **Context:** D-44's first PR.
- **Decision:**
  - **Transport** (`src/lib/email/send.ts`, like `files/storage.ts`): with `RESEND_API_KEY`, a `POST` to Resend's `/emails` with `fetch`, no SDK. Without it, a log line (the body too, but only off Vercel, since a body can hold a single-use link). The sender is `EMAIL_FROM`, by default `Sawwi <sawwi@sawwiapp.ai>`. Resend's 429 and 5xx answers are retried; other errors (a refused address) fail the job at once.
  - **One `send_email` job per message.** The job key is the message's identity (`email:reminder:<schedule>:<period>:<user>`, `email:ready:<run>:<user>`), so the same email is never queued twice, and it's also sent as Resend's `Idempotency-Key`, so a retry after a timeout isn't delivered twice. The job stores the template name and its data; the email is rendered when it's sent.
  - **Right away when a person is waiting.** An email queued during a request is sent from `after()` once the response is out (`runJobsNow`, which claims only those keys). If that fails, the job stays queued and the cron tick retries it.
  - **Reminders:** a periodic `schedule_reminders` job, hourly, looks at every workspace with a live schedule (not the demo store, not suspended workspaces). A schedule that is due with no run started for the period, and came due in the last 7 days, gets one email per owner, admin and editor. Viewers can't start a run, so they get none. Once someone starts the run, nobody is reminded again.
  - **"Ready to review":** when someone runs a reconciliation, everyone else in the workspace (all roles) gets the exception count and value, rows matched, and a link to the report. The person who ran it is looking at it, so they're left out. It's sent once per run: re-running after a fix doesn't mail again.
  - **Switches:** Settings → Email, per user, for reminders and for notices (`email_prefs`, migration 3; no row means both on). They're checked when the email is queued and again when it's sent. Deactivated teammates get nothing.
  - **Design** (the user asked for designed emails, not plain text): a branded HTML layout in the app's palette, with the logo, a white card, a heading, figures in tiles (exceptions and value in the danger colour, green when clean), one button and a quiet footer. It's built from tables with inline styles, so Gmail, Outlook and Apple Mail render it alike, and it fits a phone. A plain-text copy goes along as the multipart alternative, for spam filters and text-only readers.
  - **Copy:** short, with the workspace, the template, the numbers and one link, plus a footer linking to Settings → Email. Links use `APP_URL` (`https://sawwiapp.ai`).
  - **Test send:** `scripts/send-test-email.ts`, run by a person with their own key, sends one of each email with made-up data.
- **Rejected alternatives:**
  - The `resend` npm package: one `fetch` does it, and tests mock `fetch` without a module mock.
  - Sending inline from the action: a slow or failing Resend call would hold up the reconciliation, and nothing would retry it.
  - A reminder for viewers: they can't act on it.
  - "Ready to review" to the person who ran it: it's on their screen.
- **Consequences:** with no Resend key, nothing is sent and the log shows what would have been. Reminders go out at most an hour after a schedule comes due (the sweep is hourly, the tick every 15 minutes). Preview deployments have no cron (D-42), so only emails sent from a request (notices, resets) go out there, and their links point at `APP_URL`.

### D-46: Password reset: a hashed single-use token for an hour, the same answer for every email, rate-limited in the database
- **Context:** D-44's second PR. Until now, a forgotten password needed a superadmin.
- **Decision:**
  - **`/forgot-password`** takes an email and always answers "If there's a Sawwi account for that email, we've sent it a link". The email goes out after the response (`sendSoon`), so the answer takes about the same time whether or not there's an account.
  - **The link** is `/reset-password?token=…`, with 32 random bytes (256 bits). Only its SHA-256 hash is stored (`password_resets`, migration 4), the same way sessions are, so a copy of the database gives nobody a working link. It works for 60 minutes and once: using it is a single `UPDATE … WHERE used_at IS NULL AND expires_at > now RETURNING`, so two submits can't both succeed.
  - **"Signed":** the brief asked for a signed token. A random token looked up by its hash gives what signing would: it can't be forged or guessed, and nothing is readable in it. It also needs no signing key to keep secret or rotate. So there's no HMAC over the token.
  - **After a reset:** the new password is set, every other open link for that user stops working, and every session is deleted (signed out on every device). The person logs in again with the new password.
  - **Rate limits** live in Postgres (`reset_requests`), not in memory, because Vercel runs many instances. They count by hashed email and hashed IP over the last hour. More than 3 requests for one email: the answer stays the same and nothing is sent, so nobody can flood an inbox and the answer gives nothing away. 10 requests from one address: "Too many reset requests from here", which says nothing about any account. Requests and old links are pruned after a day by `prune_jobs`.
  - **The email** uses the same designed layout (D-45), is always sent whatever the user's switches, and its job payload (which holds the link) is cleared once it's sent. The reset page sends no referrer and isn't indexed.
- **Rejected alternatives:**
  - An HMAC-signed token with an expiry inside it: it's single-use only with a database row anyway, and it needs a new secret.
  - Signing the person in straight after the reset: a link that signs someone in is worth more to an attacker. Logging in again is one step.
  - An in-memory rate limit, as the login form has: it's per instance, so it does little on Vercel.
- **Consequences:** reset emails need Resend (D-45). Without it, the link appears only in the server log (locally with the body). Links point at `APP_URL`, so on a preview without `APP_URL` they open production.

### D-47: SEO: public reconciliation pages and a template catalogue, built from the specs and checked against the connectors
- **Context:** D-44's third PR. The only public page was the landing page, and everything under `/templates` is behind login (`src/proxy.ts`). The user asked for pages that clearly cover Magento, Dynamics 365 Business Central and the other important reconciliations, with copy that matches what the product does.
- **Decision:**
  - **Nine reconciliation pages** at `/reconciliation/<slug>`: `magento-2`, `dynamics-365-business-central`, `shopify`, `amazon-settlement`, `noon-settlement`, `bank`, `payment-gateway`, `cash-on-delivery` and `bnpl`, plus a hub at `/reconciliation`. Each has a title, intro, "how your data gets in", the templates that apply, how it works, FAQs and related pages. The copy is in `src/lib/seo/solutions.ts`.
  - **A public template catalogue** at `/reconciliation-templates`, with a page per seeded template (`/reconciliation-templates/<id>`). The files a template needs, what it checks and what it produces come straight from its spec, so the pages can't drift from the engine. Checks without a rule are shown as "listed for you to review (not calculated automatically yet)", not as automated checks.
  - **Connector claims are checked in code.** `src/lib/seo/coverage.ts` maps each connector to the template slots it can fill, and a test checks every entry against that connector's real report list (`slotFit`). Pages say "connector" only for Shopify (orders), Magento 2 (orders, credit memo lines, shipments) and Business Central (eight sales and purchase reports). Everything else says "upload the export", and pages note there's no Amazon, Noon, Tabby, Tamara or bank-feed connector. Connector pages say the connector is new and offer the upload path, since live checks with real accounts are still to come.
  - **Metadata:** each page has a title under ~60 characters and a description under 160 (tested), a canonical URL on `APP_URL` (`https://sawwiapp.ai`), OpenGraph and Twitter cards, and one shared preview image (`app/opengraph-image.tsx`). `pageMetadata()` names the image again, because a page's own `openGraph` replaces the root one.
  - **JSON-LD:** `SoftwareApplication` (no offers or ratings: nothing we don't actually have), `BreadcrumbList` on every public page, `FAQPage` on reconciliation pages, and `ItemList` on the catalogue. It's escaped so it can't close its `<script>` tag.
  - **`sitemap.xml`** lists every public page. **`robots.txt`** allows the public pages, keeps out the app (`/home`, `/runs`, `/templates`, `/settings`, `/admin`, `/api/` and so on) and the reset pages, and asks preview deployments not to be crawled at all.
  - **Shared footer** with links to every reconciliation page and the catalogue, on the landing page too, so each public page is one click from the others. The landing page gets a "By system" row.
  - The two `[slug]`/`[id]` pages are prerendered from `generateStaticParams` and set `instant = false`. They read `params` before rendering, so an unknown slug is a real 404. `dynamicParams` isn't allowed with `cacheComponents`.
- **Rejected alternatives:**
  - Opening `/templates` to the public: it's the signed-in gallery, shaped by the workspace profile, with run buttons.
  - A blog or comparison pages: more copy to keep accurate. They can come later.
  - `AggregateRating` or `Offer` in `SoftwareApplication`: there are no reviews, and prices depend on the paywall switch.
- **Consequences:** new templates and connectors appear on the public pages automatically. A new connector also needs an entry in `coverage.ts`. The user should submit `https://sawwiapp.ai/sitemap.xml` in Google Search Console and Bing Webmaster Tools (verifying the domain needs a DNS TXT record).

### D-48: Logo: two sheets, the front one ticked, with a "sawwiapp" wordmark
- **Context:** the app showed a black square with an "S" as its logo, plus Next's default favicon. A Saudi company trades as "Sawwi" at sawwi.ai (D-12). Its logo is a blue four-point star, and its "Sawwi" wordmark draws the "ww" as one joined stroke. Our address is sawwiapp.ai (D-43), so the logo has to be clearly different from theirs.
- **Decision:**
  - **Mark:** two rounded sheets, with the front one ticked, standing for two files, reconciled. It sits on a rounded tile. Chosen by the user from several concepts.
  - **Wordmark:** lowercase `sawwiapp` in Geist, with "app" in the brand colour, matching the domain. The letters are plain, with no stylised "ww". Sizes (raised at the user's request after launch): 20px next to the 28px mark in headers, 18px next to the 24px mark in the footer.
  - **Colour:** emerald (`#0e7c66` in light mode, `#2bbf95` in dark mode). It's a different shade from the success green, so it never reads as a status. Where else it appears is set in D-49.
  - **Theme:** the mark's colours are tokens (`--brand`, `--logo-*` in `globals.css`). The tile is dark on light pages and light on dark pages.
  - **Files:** `src/components/brand/logo.tsx` (`LogoMark`, `Wordmark`, `LogoLockup`) is used in the marketing header, the shared public footer (`marketing/footer.tsx`), auth and checkout pages, onboarding, sidebar and phone top bar. `src/app/icon.svg`, `apple-icon.png` and `favicon.ico` (16/32/48) use the dark tile. The link-preview image (`opengraph-image.tsx`) draws the same mark. Emails show `apple-icon.png` from the site, since mail clients don't render SVG, with the wordmark beside it and an emerald button.
  - Product copy still says "Sawwi" ("Open Sawwi", "Ask Sawwi", page titles). Only the logo lockup says "sawwiapp".
- **Rejected alternatives:**
  - The shadda-check marks (the shadda of سوّي turning into a tick, "ww✓"): their "ww" stroke is too close to sawwi.ai's wordmark.
  - Two overlapping rings with a filled middle: too close to Mastercard's logo.
  - Balance tick and merge tick: offered; the user picked the two sheets.
- **Consequences:** the two-sheet mark is close to generic "copy" and "done" icons, so the tile, colours and wordmark carry most of the recognition. Always show the mark on its tile. The trademark question in D-12 stays open; a distinct logo lowers the risk of confusion but doesn't settle it.

### D-49: The brand emerald as a quiet accent across the app
- **Context:** after D-48 the user asked for the brand colours to be used "smart and subtle" across the app pages. D-9 kept the chrome neutral (near-black and white) and kept colour for meaning (danger, warn, info, success).
- **Decision:** emerald marks the main call to action, focus, selection and "where you are". It never marks a value or a status.
  - Tokens: `--brand`, `--brand-strong` (hover), `--brand-soft` (a pale tint), `--on-brand` (text on the solid), with matching Tailwind colours.
  - **Call-to-action buttons are emerald**, at the user's request: `buttonClass("primary")`, the sidebar's "New reconciliation" button and the chat's Send button. Secondary buttons stay neutral.
  - Focus rings everywhere use `ring-brand/40` (they were `ring-foreground/30`). Text selection gets a light emerald tint.
  - Selected chips (onboarding, settings) get an emerald outline, a soft tint and an emerald check (they were black).
  - The active sidebar item gets the soft tint with an emerald icon.
  - Progress markers use the solid: onboarding steps, "how it works" step numbers, and the tick on a filled file slot. Numbered next steps in the run analysis use the soft tint.
  - Landing page: section eyebrows and feature icon tiles in emerald; template cards get an emerald border on hover.
  - The landing page's bottom CTA band stays black (the user tried emerald and reverted it). The paywall banner and chat bubbles stay neutral too. Success green, amber, red and blue keep their meanings (D-9).
- **Rejected alternatives:**
  - Neutral (black) primary buttons: the user wanted the call to action in the brand colour. The risk is that an emerald button reads as "success". The brand emerald is bluer and darker than the success green, and success colour only appears on values and badges, never on buttons.
  - Keeping the chrome fully neutral: the user asked for the brand to show in the app.
- **Consequences:** D-9 still holds for values. New UI uses `brand` for the primary action and for focus, selection, active or progress states; it uses the semantic colours for meaning. Emerald doesn't fill large areas.

### D-50: An Anthropic key not scoped to a workspace needs ANTHROPIC_WORKSPACE_ID
- **Context:** in production every AI call failed with a 400: "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header". The key set in Vercel is an unscoped one. Users only saw the rule-based summary and "I couldn't answer that just now" in the chat.
- **Decision:**
  - Every Anthropic client comes from `anthropicClient()` (`src/lib/anthropic.ts`). When `ANTHROPIC_WORKSPACE_ID` is set, each request carries it as the `anthropic-workspace-id` header. Unset, nothing changes.
  - Either fix works in production: set `ANTHROPIC_WORKSPACE_ID` to the Claude Console workspace ID (`wrkspc_…`), or replace the key with one created inside a workspace.
- **Rejected alternatives:**
  - Requiring a workspace-scoped key with no code change: it works, but an unscoped key is what was set up, and the header keeps both kinds working.
- **Consequences:** production was fixed first by the user swapping in a workspace-scoped key (2026-11-07); this change keeps an unscoped key working too. `llmAvailable()` still only checks that a key exists, so a misconfigured key shows up as "LLM … failed" errors in the Vercel logs, not in the UI.

### D-51: Light by default; the theme switch and the user's theme live in the app only
- **Context:** the user asked for light as the default, and for the theme switch to be removed from the homepage and every page without a sidebar, so the theme is switched inside the app only. Until now, with nothing saved the site followed the OS ("System"), and a Light/System/Dark switch sat in the marketing header, log-in, checkout and onboarding.
- **Decision:**
  - **Default:** nothing saved means light. "System" is now saved explicitly (`sawwi-theme` = `system`), and choosing Light clears the saved value. Visitors who never picked a theme, and were following a dark OS, now see light.
  - **Where it applies:** only the signed-in app (the sidebar layout). Pages without the sidebar are always light: the landing page, public reconciliation pages, log in and sign up, password reset, checkout and onboarding. Otherwise someone who picked dark in the app would land on a dark homepage with no switch to change it.
  - **Where it's switched:** Settings and the account menu, both inside the app. The switch is gone from the marketing header and the auth, checkout and onboarding layouts.
  - **How:** the theme script moved from the root layout into `components/shell/theme-scope.tsx`, rendered first in `(app)/layout.tsx`. On a full load it sets `data-theme-scope="app"`, `data-theme-pref` and `data-theme` before the app paints. On a client navigation into the app a layout effect does the same, and leaving the app removes `data-theme`, so the CSS falls back to light. The "System" and other-tab listeners do nothing outside the app scope.
- **Rejected alternatives:**
  - Applying the saved theme on every page while showing the switch only in the app: a dark pick would follow the user to public pages that have no way to change it back.
  - Keeping "System" as the default: the user asked for light.
- **Consequences:** a dark theme no longer shows on public or auth pages, even for signed-in users who picked it. New pages inside `(app)` get the theme automatically; pages outside it are light.

### D-52: Magento ↔ Business Central templates; first, store invoices vs. ERP posted invoices
- **Context:** the design partner runs Business Central with a Magento 2 web store, so the user picked five Magento scenarios: Magento orders vs BC posted invoices, credit memos vs BC credit notes, stock per SKU, prices, and payouts by payment method vs the bank. They ship as a small stack of PRs, one template each. This entry covers the stack and the first template.
- **Decision:**
  - **Generic templates, named connectors.** Each template is written for "store" and "ERP" so an upload from any store or ERP works; the Magento and Business Central connectors fill it with no questions. New template `web-erp-invoices` ("Store invoices vs. ERP posted invoices").
  - **Left side is Magento's invoices, not its orders.** An order is owed a posted invoice once Magento invoices it (card and BNPL when paid, COD when delivered). New Magento report `invoices` (`/V1/invoices` by `created_at`, paging to `total_count`), with the order number and customer e-mail looked up in one `orders` call per 100 invoices.
  - **Right side is BC's posted invoices that carry a store order number.** New BC report `web_sales_invoices`: posted `salesInvoices` with a non-empty External Document No. (where Magento↔BC connectors write the order number) and the sell-to e-mail (`email` in API v2.0). Matched on the order number with leading zeros stripped, many-to-many, so partial invoices sum.
  - **Checks:** not posted (unmatched), posted twice (same order and same amount, so a legitimate second partial invoice isn't called a duplicate), total and VAT differences (0.05), and a different customer, compared on e-mail. "Posted without a store invoice" is listed for review only: in a company that also sells B2B, customer PO numbers live in External Document No. too, and month-end timing would make it noisy.
  - **Engine:** a new rule kind `text_mismatch` compares a text field between matched records (trimmed, case-insensitive, blanks skipped). Severity high; the fix-first action says to correct whichever side is wrong.
  - **Demo:** the mock tenant gets a third company, "Sawwi Demo Store LLC", holding the demo Magento store's books, served as its own demo source (`demo:business-central-store`) that offers only the web reports. The trading company keeps every other report. So the existing B2B demo results don't change. Planted: one order never synced (only a draft), one posted twice, one posted with shipping (504 vs 484), one posted without VAT, one posted to a guest e-mail. Invented shoppers use `example.com`.
- **Rejected alternatives:**
  - Posting the web invoices into the trading company: cash application, order-to-invoice and price compliance would all pick them up and change their planted results.
  - Comparing customer names: BC copies the name from the customer card, and Magento guests have none. E-mail is set per document and is what connectors carry over. If a business posts every web order to one generic customer with one e-mail, this check will flag every order and should be ignored; that is noted on the check.
  - Magento orders as the left side: unpaid or undelivered orders aren't owed an invoice yet and would show as "not synced".
- **Consequences:** 24 templates. The Magento connector has four reports, Business Central nine. Public pages for Magento 2 and Business Central list the new template and report; the connector-claims test checks both. Live checks with the design partner's tenant and store still wait for the user.

### D-53: Store refunds vs. ERP credit notes
- **Context:** PR 2 of the Magento ↔ Business Central stack (D-52): every Magento refund should be posted in BC as a credit memo for the same amount.
- **Decision:**
  - New template `web-erp-credit-memos`, built like `web-erp-invoices`: Magento credit memos against BC posted sales credit memos, matched on the order number (leading zeros stripped), many-to-many so several refunds on one order sum.
  - **Key is the order number, not the credit memo number.** Magento numbers orders and credit memos in separate series that overlap (order 000000103, credit memo 000000103 are different documents), so trying the credit memo number first could pair the wrong documents. Web connectors that post refunds commonly carry the order number to External Document No.
  - New Magento report `credit_memos`: one row per credit memo with subtotal, shipping refunded, adjustment, VAT and total. The item-level `credit_memo_lines` stays for refunds vs. returns; an adjustment-only refund (no items) appears only in the new report.
  - New BC report `web_sales_credit_memos`: posted `salesCreditMemos` with a store order number in External Document No., plus the sell-to e-mail.
  - **Checks:** not posted, posted twice (same order and amount), amount and VAT differences (0.05). "Credit note without a store refund" is listed for review, for the same reason as D-52.
  - **Demo:** order 108 gets a 15.00 goodwill refund, offline as store credit with no items (so refunds vs. returns and the card gateway file are unaffected; the gateway template still flags 108 as before). In the store company: 103's refund posted twice, 106's only as a draft, 108's posted as 20.00.
- **Rejected alternatives:** matching on the credit memo number with the order number as fallback (`combine: "or"`): see the overlapping series above. Comparing customer e-mail here too: refunds go back to the customer of the order, which `web-erp-invoices` already checks.
- **Consequences:** 25 templates. Magento has five reports, Business Central ten.

### D-54: Store stock vs. ERP inventory
- **Context:** PR 3 of the Magento ↔ Business Central stack (D-52): compare Magento's sellable quantity per SKU with BC's item inventory, flagging overselling (Magento shows more than BC holds) and hidden stock (Magento shows less).
- **Decision:**
  - New template `web-erp-stock`: BC items (one row per SKU) against Magento stock (one row per SKU and source), summed per SKU, tolerance 0. Checks: overselling, hidden stock, and SKUs with sellable stock that BC doesn't know. "In the ERP, not in the store" is listed for review, since many ERP items aren't sold online.
  - **Magento side is source quantity, not "salable quantity".** New report `source_items` reads Multi-Source Inventory `GET /V1/inventory/source-items` (all pages, sorted by SKU then source, stopping at `total_count`). A source's quantity counts as sellable while its status is in stock. Magento's salable quantity also subtracts reservations for orders not yet shipped, but BC's inventory only drops when a shipment is posted, so source quantity is the like-for-like figure; it is also one paged call instead of one call per SKU. A store without MSI gets a message to upload a stock export instead.
  - **BC side** is the standard API v2.0 `items` entity (`inventory`, `unitPrice`, `priceIncludesTax`). New report `items`, the first report with no date field: it's the current state, so the window is ignored and no `$filter` is sent. The price template (next PR) reuses it.
  - **Demo:** the store company gets items for the store's SKUs (plus a showroom-only gift box and a delivery service item), and the Magento store gets two sources. Planted: OUD-50 oversold (10 vs 4), SND-42 hidden (a source set out of stock: 15 vs 20), OUD-100 not in BC.
- **Rejected alternatives:** per-SKU `get-product-salable-quantity` calls (thousands of requests, and the wrong comparison, above); the legacy `stockItems` API (one call per SKU, single source).
- **Value at risk for quantities** (found in the browser check, where a 6-unit gap showed as "AED 6.00"):
  - A `compare` rule may give a `value` expression for the money at risk, with `diff` as left minus right. Here overselling and hidden stock are `abs(diff) * unit_price`, using BC's unit price (a new optional field on the ERP slot), so oversold OUD-50 is AED 1,710 at risk, not "AED 6".
  - "Sold online, unknown to the ERP" has no price to go on, so its `value` is 0; unmatched rules now keep showing the row's own figure (the store's quantity) when `value` prices it differently. Templates that used `value` because the side had no amount behave as before.
  - "Explain" on a compare check whose figures are all number fields says "units" instead of a currency, then the money at risk.
  - Generated text keeps acronyms when it lower-cases a label (`inText`): "the ERP posted credit notes", "goods returns (GRN / RMA)", not "erp" or "grn".
  - **Remembered layouts pick up new fields.** The same browser check reused a column mapping saved before the unit price field existed, so the field showed "Not in file". Now, when a remembered mapping lacks fields the template has gained since, those fields map on a strong name match (≥ 0.85) among unused columns, with no AI and no questions; anything else stays unmapped as before. The file is then shown as auto-mapped rather than fully remembered.
- **Consequences:** 26 templates. Magento has six reports, Business Central eleven. Quantity checks elsewhere still add quantities into value at risk (D-13) until they get a `value`. Both sides are snapshots, so run it when no sync is in progress.

### D-55: Store prices vs. ERP prices; BC price list lines left out
- **Context:** PR 4 of the Magento ↔ Business Central stack (D-52): compare each SKU's Magento price, special price and dates with BC's unit price or price list lines, flagging wrong prices and special prices past their end date.
- **Decision:**
  - New template `web-erp-prices`: Magento prices looked up against BC items by SKU. Checks: price differs (0.01), special price past its end date, special price above the regular price, SKU unknown to BC.
  - **BC side is the item's unit price** (the `items` report from D-54). Business Central's standard API v2.0 has no price list endpoint (checked against Microsoft's APIV2 pages: items, but no `priceListLines`); reading price list lines would need a custom API page installed in the customer's tenant (an AL extension), like the ledger entries in the open questions. Not built: the brief allowed "unit price or price list lines", and an extension is the design partner's IT's call. Both systems must hold prices on the same VAT basis; BC reports "Price includes VAT" next to the price.
  - **Expired special prices are judged on Magento alone:** `special_to` before the "Checked on" date. Magento's prices are current, so the report stamps each row with the period's end, or today if that is earlier; the demo's October window is therefore reproducible. `date_outside` now allows leaving out `from`, so a special price that hasn't started yet isn't flagged.
  - New Magento report `product_prices`: `GET /V1/products` filtered to simple, virtual and downloadable products (configurable, bundle and grouped parents get their price from children), with `special_price`, `special_from_date` and `special_to_date` from `custom_attributes`. Default store view only; website-level prices aren't read.
  - **Demo:** Magento products with an expired special price (ABY-BLK-M), a wrong price (SND-42, 189 vs 199), a special price above the price (MAT-01) and a SKU BC doesn't have (OUD-100), plus a configurable parent the pull leaves out.
- **Rejected alternatives:** publishing BC page 7001 "Price List Lines" as an OData web service: it's a list part that depends on its header page, so its OData shape isn't dependable; a custom API page is the supported route if this is wanted later.
- **Consequences:** 27 templates. Magento has seven reports; Business Central's `items` report serves the stock and price templates. A follow-up, if the design partner wants promotions checked against BC: a small AL API page for price list lines and an optional slot on this template.

### D-56: Webstore sales by payment method vs. payouts and bank
- **Context:** PR 5 of the Magento ↔ Business Central stack (D-52), the user's scenario 8: group Magento orders by payment method (card, PayPal, Apple Pay, Tabby and so on) and check expected payouts against bank credits, reusing `bank-payouts` where it fits.
- **Decision:**
  - New template `web-payouts-by-method` in "Payouts & bank", three files: the store's sales per payment provider, the providers' payouts, and the bank statement. Sales meet payouts per provider (many-to-many sums; payouts counted before fees, `amount + fees`, tolerance 1). Payouts meet the bank exactly as in `bank-payouts`.
  - **Reuse:** the payouts slot (now `providerPayouts`, with a new optional "Fees deducted" field) and the payouts-to-bank link (`payoutsToBank`) are shared with `bank-payouts`, so its demo results don't change. `bank-payouts` itself isn't extended with a sales file: its payouts mix marketplaces, couriers and gateways, and the Magento orders report's generic `orders` hint would make the demo fill a new optional slot there and change its results.
  - **Checks:** sold but not yet paid out, paid out more than sold, a provider with sales and no payouts, payouts from a provider with no sales, payout not credited, bank credit differs, unidentified credit.
  - **New Magento report `payment_totals`:** orders created in the period in state processing, complete or closed, totalled per payment method code and title: orders, order total, refunds made online, expected to receive. Offline refunds (store credit, cash) are left out because they don't come out of a provider's payouts (`total_online_refunded`, falling back to `total_refunded`).
  - **Provider names** come from the method code (`stripe…` → Stripe, `…paypal…` → PayPal, `checkout…` → Checkout.com, `tabby…`, `tamara…`, `cashondelivery` → Cash on delivery, and Adyen, Braintree, Tap, PayTabs, Telr, Amazon Pay); unknown codes keep their title. Wallets such as Apple Pay run through a gateway, so they share its provider and stay apart as their own method row. The payouts file must name providers the same way; the slot says so.
  - **Demo:** order 108's 15.00 goodwill refund is offline. A payouts file named by provider, with fees: Stripe paid 5.00 short (108's capture), Tabby hasn't paid out order 109, COD was collected 10.00 short; the bank file is `bank-payouts`'s.
- **Rejected alternatives:** matching provider totals straight to bank credits by narration: payouts are net of fees and several land per month, so per-provider totals wouldn't meet single credits; payout IDs do. Expected payout from `total_paid`: Magento only sets it when an invoice is paid, so COD orders delivered but not yet invoiced would be missed.
- **Consequences:** 28 templates. Magento has eight reports. Timing shows up as "not yet paid out": sales at month end are paid out next month. Comparing a full month of sales with the same month's payouts is the intended use.

### D-57: Gift cards and store credit roll-forward (Adobe Commerce)
- **Context:** the user added scenario 9 (relayed by the Phase 6 session, 2026-11-08): per gift card account or customer, opening + issued − redeemed − expired should equal the closing balance, with redemptions taken from orders. Flag cards redeemed above their balance, negative balances and redemptions with no issuance. Gift cards and store credit are Adobe Commerce features, not Magento Open Source, and the template and copy must say so. The user asked for the work to be finished without them, so these calls are recorded here instead of asked.
- **Decision:**
  - New template `web-gift-cards` with three files: gift card balances, store credit balances (optional) and redemptions on orders. Each balance file links to the redemptions by account (gift card code, or the customer's e-mail for store credit). The link's amount is opening + issued − expired − closing on the left against redeemed on the right.
  - **Checks, for gift cards and for store credit each:**
    - the balance doesn't roll forward;
    - redeemed above opening + issued − expired;
    - negative closing balance;
    - redeemed with no issuance (a redemption whose account isn't in the balances; `where` on the redemption type keeps gift cards and store credit apart).
  - **Engine:** `compare` takes `unmatchedAsZero`, so an account with no redemptions in the period must still roll forward. `row_match` takes `key` and `value`, so a negative balance is keyed by its account and valued at the shortfall.
  - **Gift cards through the connector:** new report `gift_card_balances` reads Adobe Commerce's documented `/V1/giftcardaccounts` (ACL `Magento_GiftCardAccount::giftcardaccount`). It builds each account's opening and closing balance and the issued and expired amounts from the account's balance history, using Commerce's history actions (created, used, sent, redeemed, expired, updated).
  - **Not confirmed yet:** whether a live Commerce store returns that history through REST. So the report reads `history` on the account when it's there, and otherwise stops with a message to upload the history export. It never guesses a balance. This waits on a live Adobe Commerce store.
  - A Magento Open Source store gets "an Adobe Commerce feature" for the 404.
  - **Redemptions through the connector:** new report `gift_card_redemptions` reads orders in the period. Gift cards come from the order's `gift_cards` list (Commerce's `{c: code, a: amount}`), and store credit from `customer_balance_amount`, keyed by the customer's e-mail. Cancelled orders are left out.
  - **Store credit balances by upload, not a mocked endpoint:** Adobe Commerce documents no admin REST list of customer balances (store credit is in GraphQL for the shopper only). Inventing a route would make a connector claim Sawwi can't back, so the slot takes the admin's store credit export. The demo store's built-in "Demo data" source supplies an invented one.
  - **Demo:** four Commerce gift card accounts with history, and redemptions on orders 101, 104, 106 and 108. The order totals are left as they were, so every other demo result is unchanged. Planted:
    - GC-BBB2 redeemed above its balance, closing at −50;
    - GC-CCC3's balance doesn't roll forward;
    - GC-ZZZ9 used with no account;
    - a store credit balance that doesn't roll forward;
    - a customer spending store credit with no balance on file.
- **Rejected alternatives:**
  - Mocking a customer balance REST endpoint (the relayed brief suggested it): Adobe Commerce documents none.
  - Deriving the opening balance as closing + redeemed − issued: that assumes the movements are complete, which is what the roll-forward is meant to prove.
- **Consequences:** 29 templates. Magento has ten reports, two of them Adobe Commerce only (labelled so). The Magento 2 public page says gift cards and store credit need Adobe Commerce.

### D-58: Multi-store, multi-currency store invoices vs. ERP
- **Context:** the user added scenario 10 (relayed 2026-11-08), to be finished without them. For each store view or website, convert totals at the rate Magento recorded (`base_to_order_rate`, `base_grand_total` vs `grand_total`). Compare that with what BC booked, by currency code, amount in that currency (FCY) and in local currency (LCY). Flag FX differences above a tolerance, invoices posted in the wrong currency and stores missing from BC.
- **Decision:**
  - New template `web-erp-fx`, built on invoices like `web-erp-invoices`, since an invoice is what gets posted. Link 0 is the order number: Magento's base total against BC's LCY amount, tolerance 1.00 in base currency, plus the currencies compared as text. Link 1 is the store: Magento's store view code against BC's Global Dimension 1.
  - **Checks:** FX difference, wrong currency, not posted, and a store missing from BC (one finding per invoice of that store, valued at its base total).
  - **New Magento report `invoice_currencies`:** each invoice's store view code and name (`/V1/store/storeViews`), order currency and total, base currency and total, the recorded rate, and total ÷ rate as a cross-check. Without Stores → Settings access, the store ID stands in for the code.
  - **New BC report `web_sales_invoices_fx`:** posted web invoices with currency (blank means LCY), FCY amount, the rate and the LCY amount, and `shortcutDimension1Code` as the store.
  - **LCY is calculated, not read.** API v2.0 posted invoices have no currency factor and no LCY amounts. So Sawwi applies the rate BC would use from the standard `currencyExchangeRates` table: the latest starting date on or before the posting date, LCY per unit = relational ÷ exchange rate amount. An invoice whose rate was changed by hand on the document isn't visible this way. Reading customer ledger entries' "Amount (LCY)" would need a custom API page, like D-55.
  - **Assumption for the live check:** web invoices carry the Magento store view code in Global Dimension 1. That is a common setup, not a given, so it is noted in PROGRESS.
  - **Payouts by payment method (D-56) now match per provider and currency.** With SAR and OMR sales in the demo, provider-only matching would have summed SAR into AED payouts. The demo now also shows the KSA and Oman cash-on-delivery sales with no payouts.
  - **Demo:** a KSA store view (SAR, 15% VAT) and an Oman one (OMR) with four delivered cash-on-delivery orders, and three SAR invoices posted in the store company, with SAR rates that move on 20 October. Planted:
    - one SAR invoice posted in AED;
    - one posted after the rate moved (19.26 lower in AED);
    - the Oman store never posted.
  - The Oman order also shows in `web-erp-invoices` as not synced. Other templates are unchanged: the new orders are cash on delivery, so the card and Tabby templates skip them, and they have no shipments or refunds.
- **Rejected alternatives:**
  - Orders instead of invoices: orders that aren't invoiced yet aren't owed a posting.
  - A percentage tolerance: the engine compares absolute amounts, and 1.00 in base currency covers rounding at GCC rates.
- **Consequences:** 30 templates. Magento has eleven reports, Business Central twelve.

### D-59: A GitHub Action deletes a PR's Neon preview database when the PR closes
- **Context:** Vercel's Neon integration creates a database branch (`preview/<git branch>`) for each new preview git branch, and nothing deletes it. On Neon's Free plan, 10 branches fill up after 9 previews. From 7 Nov 2026 every preview of a new branch failed in about a second with `Resource provisioning failed` (PRs #29–#38), while production kept deploying. The user deleted the 9 stale branches by hand on 8 Nov.
- **Decision:** a workflow, `.github/workflows/neon-preview-cleanup.yml`, runs on `pull_request: closed` (merged or not, since a closed PR's preview is no longer needed) and deletes the Neon branch named `preview/<head branch>` through the Neon API. It only ever deletes a branch whose name starts with `preview/` and that isn't the default branch. If the branch doesn't exist, or the secret and variable aren't set, it succeeds without deleting anything. It can also be run by hand for one git branch. Fork PRs are skipped (they get no secrets). It uses `curl` and `jq` rather than a third-party action, so no outside code runs with the key.
- **Consequences:** needs a `NEON_API_KEY` secret and a `NEON_PROJECT_ID` variable in the GitHub repository; the user adds them. Reopening a PR makes a new database branch on its next preview. More than 9 PRs open at the same time still fill the Free plan. Previews still get their own database branch, so they never touch production data (DEPLOY.md).


### D-60: Phase 9 is Automation, a peer of Reconciliation; purchase invoice capture first
- **Context:** the user wants Sawwi to do work as well as check it: turn documents GCC e-commerce sellers type in by hand into ERP entries. Purchase invoices come first. The other use cases are to be researched and shown as "coming soon", ranked by value.
- **Decision:**
  - A new **Automation** section sits beside Reconciliation in the sidebar. The nav is grouped: Home; Reconcile (Reconciliations, Templates, Schedules); Automate (Automation).
  - `/automation` lists the use cases. The one that's live opens its workspace; the rest are cards marked "Coming soon", in value order. The list lives in code (`src/lib/automation/use-cases.ts`), with a value score and the reason for it, so ranking changes go through review.
  - **First use case: purchase invoices** at `/automation/purchase-invoices`. Upload supplier invoice PDFs (text, scans or ZATCA e-invoices) and get a draft per invoice. Review and correct it, then download CSV or push it to Business Central as an unposted purchase invoice.
  - **Ranked backlog**, by value = documents a month × minutes saved per document × cost of a mistake, with what Sawwi already has noted:
    1. Marketplace settlements (Amazon, Noon, Namshi, Trendyol) → journal entries. Every seller has them, every fortnight, with dozens of fee lines each. Settlements are already parsed for reconciliation.
    2. COD remittances (Aramex, SMSA, J&T, Quiqup…) → cash receipts applied to orders. Cash on delivery is still a large share of GCC orders, and applying remittances order by order is the slowest manual job.
    3. Payment gateway and BNPL payouts (Tabby, Tamara, Checkout.com, PayTabs, Tap, Stripe) → cash receipts plus fee and VAT-on-fee entries.
    4. Supplier credit notes → draft purchase credit memos. Almost free once purchase invoices exist: the reader already tells credit notes apart.
    5. Ad and SaaS bills (Meta, Google, TikTok, Shopify…) → purchase invoices with reverse-charge VAT. Monthly, foreign suppliers, and the VAT treatment is easy to get wrong.
    6. Supplier statements → payment proposals: pay what's due, matched and not disputed. Builds on the supplier statement template.
    7. Import and customs bills → landed cost (item charges spread over receipts). High value per document, but fewer documents and a harder allocation.
    8. New suppliers from their TRN or VAT certificate → vendor cards. Rare, but it closes the "vendor not found" gap in purchase invoice capture.
  - **Considered and left out for now:** VAT return workpapers (a report, not an entry), and sales invoices for B2B customers (already made in the ERP).
- **Consequences:** Phase 9 opens with one PR: the plan, the section, the purchase invoice flow end to end against the mock Business Central, and the backlog. Each later use case is its own PR and decision.

### D-61: Purchase invoice capture: the Phase 5 reader, no LLM, supplier memory learned from corrections
- **Context:** repeat suppliers must cost nothing to read. Phase 5's reader (ARCHITECTURE §8, D-24) already reads invoices with no AI: embedded ZATCA XML, then the text layer or local OCR of scans, with the ZATCA QR for totals. It remembers a table layout per issuer in `pdf_layouts`.
- **Decision:**
  - **Reading:** `extractPdf` at line grain, with the workspace's layout memory, so a supplier's line table is learned the first time and reused after. The reader now also picks up the due date ("Due date", "Payment due") and keeps it apart from the invoice date. Dates become ISO, read day-first as in the GCC.
  - **No LLM in v1.** Rules plus the review screen cover the fields; a supplier whose layout the rules can't read is fixed once by hand, and the fix is remembered. A Haiku fallback for a first-time supplier's missing header fields (text only, cached per supplier) is left for later and would be its own decision.
  - **Supplier memory** (`supplier_profiles`, per workspace, keyed by the reader's issuer key, with the TRN as a second key):
    - the ERP vendor the user picked;
    - supplier SKU or description → ERP item or G/L account, from each line the user mapped;
    - payment terms in days, used when an invoice has no due date.
    These are saved when a draft is pushed or exported, not on every keystroke, so only reviewed choices are learned.
  - **The source PDF is kept** with its draft (`automation/<org>/purchase-invoices/<id>.pdf`), so review shows the document next to the form. That's unlike reconciliation uploads (D-39), which aren't kept. It is deleted with the draft. Uploads go to Blob from the browser where Blob is on, as in D-39.
  - **Checks** are the reader's (lines add up to the subtotal, VAT = rate × net, net + VAT = total) and are run again on the edited draft. A draft can't be pushed while a total check fails, nor while a line has no item or account, nor without a vendor.
- **Consequences:** no AI cost per invoice. A supplier whose PDF has no line table still gives a one-line draft (net, VAT, total) the user can split. OCR'd drafts say so and ask for a closer look.

### D-62: Matching suppliers and items to Business Central records
- **Decision:**
  - **Vendor**, first hit wins: the supplier memory; then TRN equal to the vendor's `taxRegistrationNumber`; then name, compared without case, punctuation or legal suffixes (LLC, FZE, FZCO, Co., Trading, Est.…), which must match exactly one vendor. Otherwise the user picks from the vendor list. Sawwi never creates vendors (that is backlog item 8).
  - **Line**, first hit wins: the supplier memory for that SKU or description; then SKU equal to an item number; then SKU equal to the item's GTIN; then the description equal to exactly one item's name, after the same normalising. Otherwise the user picks an item, or a G/L account for freight, services and the like.
  - **Master data is cached** per workspace and connection (`erp_master_data`) for an hour: vendors, items and G/L accounts that allow direct posting. The review screen has "Refresh from Business Central". The cache is read-only data the ERP already holds, and it is deleted with the connection.
- **Consequences:** a repeat supplier with mapped SKUs goes straight to "Ready". Fuzzy matching is left out on purpose, since a wrong item on a purchase invoice costs more than a click.

### D-63: Duplicate supplier invoices are caught three times
- **Decision:**
  1. **Same file:** a SHA-256 of the PDF. Uploading it again opens the existing draft instead of making a new one.
  2. **Same invoice in Sawwi:** same supplier (vendor, else TRN, else issuer) and the same invoice number after normalising (case, spaces, dashes, leading zeros). Shown as a warning on both drafts. A second push of the same draft is refused.
  3. **Already in the ERP:** before every push, Sawwi asks Business Central for purchase invoices of that vendor with that vendor invoice number, posted or not (`purchaseInvoices?$filter=vendorNumber eq '…' and vendorInvoiceNumber eq '…'`). If there is one, the push is refused, with its number. The same check runs when a draft is opened, so it shows early.
  - **Soft warning:** the same supplier, date and total under another invoice number ("possible duplicate"). It doesn't block.
- **Consequences:** Business Central also refuses to post a second invoice with the same vendor invoice number, but only at posting. Sawwi stops it before a draft is made.

### D-64: Writing to the ERP: connectors gain a write capability, drafts only, confirmed per push
- **Context:** connectors have only read so far (D-27–D-30). Creating a purchase invoice is the first write.
- **Decision:**
  - **Capability, not a new connector:** `Connector.purchaseInvoices?` holds three functions: `masterData` (vendors, items, accounts), `findExisting` (the duplicate check) and `createDraft`. Only Business Central has it for now. A connection whose connector lacks it can't be a push target.
  - **Drafts only.** Sawwi creates an unposted purchase invoice (`POST …/purchaseInvoices`, then `POST …/purchaseInvoices({id})/purchaseInvoiceLines` per line) and never posts, releases or changes an existing document. If a line fails, Sawwi deletes the half-made draft it just created (only that one, by id) and reports the error.
  - **VAT is Business Central's.** Lines carry type, number, description, quantity and direct unit cost. Business Central works out VAT from its posting setup. Sawwi then reads the draft back and compares BC's total with the invoice's. A difference is shown on the draft (for example, a vendor posting group with the wrong VAT), and the BC draft is left for the user to fix.
  - **Explicit confirmation per push:** the dialog names the company, vendor, invoice number and total. The server takes a hash of the exact draft it showed and refuses if the draft changed since, so a confirmation never carries over to other content. Every push is recorded on the draft: who, when, BC number and id. Viewers can't push, and `runBlocker()` applies (role, plan, trial).
  - **Same network rules as reads:** live requests go through `liveDeps`, so `assertPublicUrl` applies (https, public addresses only, no redirects, 30 s timeout). The connector also only ever builds URLs on the fixed Business Central host. The demo store pushes to the in-process mock BC (D-29), which now accepts these writes, keeps them in memory, and forgets them at the demo's nightly reset.
  - **Customer setup:** the Entra app already has `API.ReadWrite.All` (there is no read-only scope, D-29). To push, its permission set in Business Central must also allow creating purchase invoices, for example "D365 PURCH DOC, EDIT" next to "D365 READ". Without it Business Central answers 403, and Sawwi says which permission set to add.
- **Consequences:** reading and writing share one connection and one secret. Pushing more document types later means adding functions to the capability. A live push waits for the user and a sandbox tenant.

### D-65: Purchase invoice CSV: one row per line, header repeated, ERP numbers alongside the supplier's
- **Decision:** the CSV is one row per line, with the invoice header repeated on each row, so it loads as a flat table into Business Central configuration packages, Excel or another ERP. Columns:
  - header: Vendor No., Vendor name, Vendor TRN, Vendor invoice no., Invoice date, Due date, Currency, Purchase order no.;
  - line: Line no., Type (Item / G/L Account), No., Description, Supplier SKU, Quantity, Direct unit cost, VAT %, Line amount excl. VAT, Line VAT;
  - totals: Invoice amount excl. VAT, Invoice VAT, Invoice amount incl. VAT.
  Dates are ISO and amounts are plain numbers with a dot. One invoice, or every draft marked ready, in one file.
- **Consequences:** CSV works with no ERP connection. Vendor and item numbers are blank where nothing matched yet.

### D-66: A review queue with single and bulk approval; approval is required before CSV-or-push, and is for exact content
- **Context:** the user asked (8 Nov 2026, during the build) for a review screen showing all the extracted invoice data for manual review, with single and bulk approve. They also asked for the scanned PDF to be shown on the review screen (already planned in D-61).
- **Decision:**
  - **The queue is the review screen.** `/automation/purchase-invoices` lists every captured invoice with the extracted data:
    - supplier, TRN, the vendor it matched and how;
    - invoice number, how the PDF was read, and dates;
    - lines, net, VAT and total, and whether the totals check;
    - status and the first blocker.
    A row expands to its lines with their item or account coding and every blocker and warning. Tabs: To review, Approved, In ERP, All. Checkboxes allow bulk approve, CSV download and push.
  - **Single invoice:** its own page shows the PDF (text or scan) next to an editable form, with checks run live.
  - **Approve is a status, not a push.** Statuses: needs review → ready → approved → pushing → pushed. Only a draft with nothing blocking can be approved; bulk approve approves those and says why each other one wasn't. An approval stores a hash of the draft and the push target. Any edit, or a change of target, voids it.
  - **Push takes approved drafts only**, still with the confirmation from D-64. One dialog lists every invoice, vendor and total for a bulk push, and each push is checked against its own hash. "Download approved as CSV" exports every approved draft.
- **Consequences:** two people can split the work, one approving and another pushing. The approver is recorded on the draft. Separate approver and pusher roles (four eyes) aren't enforced yet; that is an open product choice.

### D-67: Phone camera capture: one invoice from one or more page photos, made into a PDF in the browser
- **Context:** the user asked (8 Nov 2026, during the build) for camera support on phones, and for adding pages to the same invoice the way the Daftar project's receipt capture does.
- **Decision:**
  - **Flow, as in Daftar:** below the `md` breakpoint the purchase invoices page shows "Take a photo" (rear camera, `capture="environment"`) and "Gallery" (several at once). After the first photo the button reads "Add another page" with a page count, and a page list shows thumbnails, "Page n of N", rotate, move up and down, remove, and "Remove all". "Read invoice (N pages)" sends them as one invoice. Up to 10 pages.
  - The camera input has no `multiple`, because Android Chrome then ignores `capture` and opens the file chooser (Daftar found the same).
  - **Photos become a PDF in the browser** (`components/automation/photo.ts`, `lib/automation/purchase-invoices/photo-pdf.ts`). Each photo is:
    - turned upright from its EXIF orientation, then by the user's quarter turns;
    - scaled to at most 2400 px on its long side;
    - made grayscale with its contrast stretched (2nd–98th percentile), which helps OCR on paper photos;
    - saved as a JPEG page in a minimal multi-page PDF written by hand (no library).
    The server sees a scanned PDF: the same upload route, local OCR (D-24), the same checks, and the PDF kept and shown on the review page. Uploads stay PDF only, and no AI is involved.
  - **Reader fix found while testing this:** an invoice number must contain a digit, so "Invoice No:  Bill To: …" with the number left blank no longer reads as "Bill".
- **Rejected alternatives:**
  - Accepting JPEG/PNG on the server: the reader, storage and review screen all expect a PDF, and a multi-page invoice would need one anyway.
  - A live in-page camera (`getUserMedia`): the phone's own camera app focuses and exposes better, and needs no permission prompt.
  - Edge detection or perspective correction: worth it if real photos read badly; it waits on photos of real invoices.
- **Consequences:** photos read at OCR quality, so the review page says to check the figures against the image. The demo store still takes no uploads, so the camera is offered only in real workspaces.

### D-68: Approving and pushing can be the same person
- **Context:** D-66 left open whether approving and pushing should be separate roles. The user decided (8 Nov 2026): they can be the same.
- **Decision:** any editor or above can approve and push, including an invoice they approved themselves. The approver and the pusher are still recorded on each draft. No separate approver role.
- **Consequences:** no change to the code from D-66. A four-eyes option can be added later per workspace if a customer asks.

### D-69: AI-assisted reading when the rules fall short, accuracy first
- **Context:** D-61 kept capture rule-only and left an AI fallback open. The user decided (8 Nov 2026) that AI assistance is required where the rules can't read an invoice, with "no compromise in accuracy as much as possible".
- **Decision:**
  - **Rules first, still.** A supplier whose invoice the rules read completely, with every check passing, costs nothing, as in D-61.
  - **When the AI is asked:**
    - the rules can't read the PDF as an invoice (unreadable scan, unusual layout);
    - a totals check fails;
    - the invoice number, date, total, supplier or line items are missing, or lines are incomplete;
    - only the ZATCA QR could be read;
    - OCR confidence is below 85%;
    - or the user clicks "Read again with AI" on a draft not yet pushed.
  - **Model and settings, for accuracy:** Claude Opus 5.5 (`claude-opus-5-5`, the most capable default model) at effort `high`. It reads the PDF itself (text and page images, so scans and photos too), with structured output against a fixed schema and the server-side refusal fallback. The instructions are byte-stable and cached for an hour (D-4). They tell the model to copy what is printed and never compute or infer a figure; anything not printed is null. Net = qty × price is the only figure Sawwi fills in.
  - **Verification:**
    - the AI's reading goes through the same totals checks as a rule-read draft;
    - it is kept unless it checks worse than the rules' reading, or says the document isn't an invoice while the rules read one;
    - blank header fields are filled from the other reading;
    - every field the two read differently (TRN, number, dates, currency, net, VAT, total, line count) is shown as "Check against the PDF";
    - the AI's own notes are shown, and the draft is marked "Read by AI" in the queue and on the review page;
    - nothing read by AI skips review, since approval (D-66) is still required.
  - **No AI in the demo store** (`llmAvailable`, D-32), and none without an API key; then the rules' reading stands as before.
  - **Cost:** each AI reading is logged as "Invoice reading (AI)". Since there is no run, `llm_usage` gains an `org_key` (migration 6), so the usage dashboard counts it for the workspace. A one- or two-page invoice is a few thousand input tokens: a few US cents on Opus 5.5.
  - **Time:** the capture route and the pages' server actions allow 300 seconds (`maxDuration`), for OCR plus an AI reading.
- **Rejected alternatives:**
  - The AI on every invoice: it costs every time, and the rules are exact where they work.
  - Sonnet or Haiku for this: the user put accuracy first.
  - Sending the rules' reading to the AI as a hint: it would anchor the AI on the rules' mistakes. The two readings are independent, then compared.
- **Consequences:** a repeat supplier whose layout the rules can't read is read by AI each time. Learning a layout recipe from an AI reading is a possible follow-up. Live checks against the API wait for the user, as tests use a fake reader.
