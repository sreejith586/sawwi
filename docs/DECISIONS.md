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
