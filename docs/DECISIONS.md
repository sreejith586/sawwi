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

<!-- D-15 to D-19 are taken by PR #2 (Phase 4) and D-20 by PR #3 (the PDF plan). -->

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
