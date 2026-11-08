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
| 8 | Email through Resend (reminders, "ready to review" notices, password reset) and public SEO pages (D-44) | In review: email foundation, reminders and notices (D-45, #25); password reset (D-46, #26, based on #25); SEO pages (D-47, this PR, based on #26) |
| 7 | Go live on Vercel + Neon (D-37): Postgres everywhere (PGlite in dev/tests), private Blob uploads, connector keyring, Vercel deploy, jobs table + Vercel Cron | Done: live at sawwiapp.ai (D-43). Merged: scope (D-37, #16), Postgres everywhere (D-38, #17), files in private Blob (D-39, #18), connector key ring (D-40, #19), Vercel deploy (D-41, #20), docs (#21), jobs table + Vercel Cron (D-42, #22 → #24) |
| 9 | Automation, a peer of Reconciliation (D-60): purchase invoice capture → reviewable draft → CSV or Business Central draft; ranked backlog of other automations | In progress. Merged: purchase invoice capture, review queue, CSV and BC push, phone camera (D-60–D-67, #40). In review: AI-assisted reading (D-68, D-69, #41). Next: marketplace settlements → journal entries |

## In flight

| Work | Branch | PR | Owner |
| --- | --- | --- | --- |
| UI polish (on request) | `ui-polish` | — | U/UX session |
| Delete a PR's Neon preview database when it closes (D-59) | `ci/neon-preview-cleanup` | #39 | Magento↔BC session |
| Purchase invoices: AI-assisted reading (D-68, D-69) | `feature/purchase-invoice-ai-reading` | #41 | Automation session |
| Marketplace settlements → journal entries (D-70–D-73) | `feature/automation-marketplace-settlements` | — | Automation session |

Merged on 8 Nov 2026: Phase 8 (#25, #26, #28), logo and wordmark (#27, #31), D-50 (#29), D-51 (#30), and the Magento ↔ Business Central stack D-52 to D-58 (#35, #32, #33, #34, #36, #37, #38).

## Recent changes

- **Plan: marketplace settlements → journal entries** (D-70–D-73, `feature/automation-marketplace-settlements`).
  - Settlement reports in, one journal per settlement out. The reader handles Amazon-style long files (amount type and description per row) and wide files (a column per fee), as CSV, Excel or PDF.
  - Categories go into buckets (sales, fees, VAT on fees, refunds, advertising…), each mapped to a G/L account. The payout goes to a clearing account.
  - Same review queue, approval and CSV as purchase invoices. Push creates unposted journal lines in a Business Central batch (D-71).
  - Duplicates are caught in Sawwi and in Business Central (D-72). In the demo, settlements post to the store company (D-73).

- **Phase 9: Automation, starting with purchase invoices** (D-60–D-67 merged as #40 on 8 Nov 2026; D-68 and D-69 in `feature/purchase-invoice-ai-reading`).
  - **Automation section** next to Reconciliation. The sidebar is grouped into Workspace, Reconcile and Automate. `/automation` shows purchase invoices, plus eight more use cases ranked by value and marked "Coming soon":
    1. marketplace settlements → journals;
    2. COD remittances;
    3. gateway and BNPL payouts;
    4. supplier credit notes;
    5. ad and SaaS bills with reverse-charge VAT;
    6. supplier statements → payment proposals;
    7. landed cost;
    8. vendors from TRN certificates.
  - **Purchase invoices:** upload PDFs (text, scans, ZATCA e-invoices; no AI). Each becomes a draft with supplier, TRN, invoice number and date, due date, currency, lines and totals.
  - **Review queue** (D-66, asked for by the user): every draft's extracted data, checks and blockers in one table. Rows expand to their lines. Single and bulk approve, CSV and push.
  - **Single invoice page:** the PDF (scan or text) beside an editable form, with checks live.
  - **AI-assisted reading** (D-69, the user's call: "no compromise in accuracy"):
    - when the rules fall short (failed check, missing fields, unreadable scan, low OCR confidence) or on "Read again with AI", Claude Opus 5.5 reads the PDF at high effort;
    - its reading goes through the same checks, and is kept unless it checks worse;
    - fields the two readers disagree on are listed for review, and the draft is marked "Read by AI";
    - usage shows on the usage dashboard (migration 6 adds `org_key` to `llm_usage`);
    - off in the demo.
  - **Approve and push by the same person** is fine (D-68, the user's call).
  - **Phone camera** (D-67, asked for by the user): "Take a photo", then "Add another page" for each next page (or Gallery), with rotate, reorder and remove per page, as in Daftar. The pages become one PDF in the browser, read by local OCR like a scan.
  - **Out:** approved drafts download as CSV (D-65) or push to Business Central as unposted purchase invoices, behind a confirmation that names each invoice (D-64).
  - **Matching** (D-62): vendor by memory, TRN or exact name; item by memory, SKU, GTIN or exact name. A supplier's item codes, vendor and payment terms are remembered from pushed or exported drafts (D-61).
  - **Duplicates** (D-63): the same file opens its draft; the same supplier and number is flagged; an invoice already in BC is refused at push and shown when opened.
  - **Connectors gain writes:** `Connector.purchaseInvoices` (Business Central only). BC's own total is read back. A half-made draft is deleted if a line fails. `liveDeps` and the fixed host apply.
  - **Mock BC:** accepts draft writes and has vendors, items and accounts for the trading company.
  - **Demo:** four sample invoices:
    - one matched by TRN and SKU that needs a G/L account for delivery;
    - one with supplier item codes, matched by name and learned;
    - GLS-2307, already in BC as PI-9003;
    - an OCR'd scan.
  - Migrations 5 and 6. 28 new tests; 2 updated (migration list, the trading company now has items).
  - **Checked in the browser** (localhost):
    - demo: loaded 3 samples; coded the delivery line; save and approve; pushed CAS-55188 → draft PI-1004 in the mock BC;
    - bulk-selected 2 and approved the 1 that could be;
    - bulk push of GLS-2307 refused as PI-9003;
    - CSV and PDF downloads;
    - a normal workspace: uploaded a PDF through the file input; with no ERP it is "Ready to approve";
    - phone camera flow: two page photos (page 2 sideways, rotated in the page list) → one PDF → read by OCR as DOS-7781, AED 3,297.00, totals checked, "Ready to approve"; the page list clears after a read and stays if the read fails (fixed during the check);
    - phone width shows no sideways scroll; no console or server errors.
    - A fieldset overflow at narrow desktop widths was found and fixed.
  - **Waits for the user:**
    - a live push to a BC sandbox: the Entra app needs a purchase-document permission set, e.g. D365 PURCH DOC, EDIT;
    - one live AI reading of a real supplier invoice with the production key, to see accuracy and cost on a real document (tests use a fake reader).
- **Vercel previews failing; preview databases now deleted when a PR closes** (D-59, `ci/neon-preview-cleanup`).
  - Every preview of a new git branch since 7 Nov failed within a second with `Resource provisioning failed`. The Neon integration's 10-branch Free plan was full of databases from previews of merged PRs. The user deleted them on 8 Nov.
  - New workflow `.github/workflows/neon-preview-cleanup.yml` deletes `preview/<branch>` in Neon when its PR closes.
  - The `NEON_API_KEY` secret and `NEON_PROJECT_ID` variable are set in GitHub (8 Nov). The first real run is this PR's own close, which should delete `preview/ci/neon-preview-cleanup`.
- **Multi-store, multi-currency store invoices vs. ERP** (D-58, `feature/magento-multi-currency`, PR 7 of the stack, based on PR 6; scenario 10, added by the user).
  - New template `web-erp-fx`: each store view's invoices at the base value Magento recorded against Business Central's local-currency amount (tolerance 1.00). It also flags invoices in the wrong currency, invoices not posted, and stores missing from Business Central (by Global Dimension 1).
  - Magento connector: new `invoice_currencies` report (store view, currencies, recorded rate). Business Central connector: new `web_sales_invoices_fx` report, with local currency worked out from the exchange rates table on the posting date (API v2.0 documents have no currency factor).
  - Demo: KSA (SAR) and Oman (OMR) store views; the template fills in one click and finds its 8 planted exceptions. The Oman order is also "not synced" in the invoices template, and the payouts template now matches per provider and currency, so the SAR and OMR cash-on-delivery sales show with no payouts.
  - 2 new tests, 5 updated.

- **Gift cards and store credit roll-forward** (D-57, `feature/magento-gift-cards`, PR 6 of the stack, based on #36; scenario 9, added by the user).
  - New template `web-gift-cards` (Adobe Commerce only): each gift card and store credit balance should roll forward (opening + issued − redeemed − expired = closing) against the redemptions on orders. Flags breaks, over-redeemed and negative balances, and redemptions with no issuance.
  - Magento connector: new `gift_card_balances` report (`/V1/giftcardaccounts`, from each account's balance history) and `gift_card_redemptions` report (gift cards and store credit used on orders). Store credit balances come from the admin's export; Adobe Commerce documents no REST list for them.
  - Engine: `compare.unmatchedAsZero` and `row_match.key`/`value`.
  - Demo: the template fills in one click and finds its 6 planted exceptions; other demo results are unchanged. 2 new tests.

- **Webstore sales by payment method vs. payouts and bank** (D-56, `feature/magento-payouts-by-method`, PR 5 of the stack, based on PR 4).
  - New template `web-payouts-by-method`: Magento sales per payment provider (card, PayPal, Apple Pay, Tabby, COD…) against each provider's payouts before fees, and each payout against the bank. It shares the payouts file and payouts-to-bank link with "Bank statement vs. expected payouts", whose results are unchanged.
  - Magento connector: new `payment_totals` report (payable orders per provider and method, net of online refunds).
  - Demo: a payouts file named by provider; the template fills in one click and finds its 5 planted exceptions. 2 new tests (one keeps every template's summary within the 160-character page description; "Returns vs. invoiced items" was 163 and is trimmed).

- **Store prices vs. ERP prices** (D-55, `feature/magento-bc-prices`, PR 4 of the stack, based on PR 3).
  - New template `web-erp-prices`: each Magento SKU's price against Business Central's unit price, plus special prices past their end date and special prices above the regular price.
  - Magento connector: new `product_prices` report (simple, virtual and downloadable products, special price and dates). Business Central: the `items` report from PR 3. Price list lines aren't in Business Central's standard API, so they aren't read (D-55).
  - Engine: `date_outside` may leave out `from`.
  - Demo: the template fills in one click and finds its 4 planted exceptions. 1 new test.

- **Store stock vs. ERP inventory** (D-54, `feature/magento-bc-stock`, PR 3 of the stack, based on PR 2).
  - New template `web-erp-stock`: Magento's sellable quantity per SKU (summed over in-stock sources) against Business Central's item inventory. Flags overselling, stock hidden from the store, and SKUs Business Central doesn't know.
  - Magento connector: new `source_items` report (Multi-Source Inventory, current stock). Business Central connector: new `items` report (inventory and unit price), the first undated report.
  - Demo: the store company's items and two Magento sources; the template fills in one click and finds its 3 planted exceptions.
  - From the browser check: stock gaps are valued at quantity × unit price (a `value` expression on `compare`), "Explain" says "units" for quantity checks, and generated text keeps acronyms ("ERP", "VAT", "GRN") instead of lower-casing them. A remembered column mapping now also maps fields a template gained after it was saved, by name and without questions.
  - 1 new test, 2 extended. A new SEO test checks each connector page lists every template its connector fills, with no duplicates; it found the Business Central page missing "B2B invoices vs. payment release", now listed.

- **Store refunds vs. ERP credit notes** (D-53, `feature/magento-bc-credit-memos`, PR 2 of the stack, based on PR 1).
  - New template `web-erp-credit-memos`: every Magento credit memo should be a posted Business Central credit memo, once, for the same amount and VAT. Matched on the order number.
  - Magento connector: new `credit_memos` report (totals, with shipping and adjustment refunds). Business Central connector: new `web_sales_credit_memos` report.
  - Demo: a 15.00 goodwill refund on order 108 (store credit, no items); the store company posts 103's refund twice, leaves 106's as a draft and posts 108's as 20.00. The template fills in one click and finds its 6 planted exceptions; the other demo results are unchanged.
  - 2 new tests, 2 extended.

- **Store invoices vs. ERP posted invoices** (D-52, `feature/magento-bc-invoices`, PR 1 of the Magento ↔ Business Central stack).
  - New template `web-erp-invoices`: every Magento invoice should be a posted Business Central invoice, once, with the same total, VAT and customer e-mail. Flags orders never synced, orders posted twice, total, VAT and customer differences; "posted without a store invoice" is listed for review.
  - Magento connector: new `invoices` report (order number and customer e-mail looked up from the orders). Business Central connector: new `web_sales_invoices` report (posted invoices with a store order number in External Document No., with the sell-to e-mail).
  - Engine: new `text_mismatch` rule (a text field differs between matched records).
  - Demo: a second Business Central company, "Sawwi Demo Store LLC", holds the demo store's books and is its own demo source, so the B2B demo results are unchanged. The template fills in one click and finds its 8 planted exceptions.
  - Public Magento 2 and Business Central pages list the new template, report and an FAQ. 5 new tests.

- **Larger wordmark** (`feature/larger-wordmark`): "sawwiapp" next to the logo mark is 20px in headers (was 16px) and 18px in the footer (was 14px), at the user's request. The mark stays 28px and 24px.
- **Light by default; theme switching only inside the app** (D-51, `feature/light-default-theme`).
  - With nothing saved, the theme is light (it used to follow the OS). "System" and "Dark" are still in Settings and the account menu.
  - The switch is gone from the homepage, public pages, log in, checkout and onboarding, and those pages are always light.
  - Checked in the browser: with dark saved, the homepage stays light; going into the app (client navigation and full reload) turns it dark; going back turns it light; the Settings switch applies and saves; with nothing saved the app is light.

- **AI in production was failing** (D-50, `fix/anthropic-workspace-header`). Every summary, chat answer and AI column mapping returned a 400, because the API key isn't scoped to a workspace. Found by asking the chat a question on a test run in production.
  - All clients now come from `anthropicClient()`, which sends `anthropic-workspace-id` when `ANTHROPIC_WORKSPACE_ID` is set. 2 new tests.
  - **Done by the user (2026-11-07):** a new workspace-scoped key and `ANTHROPIC_WORKSPACE_ID` are set in Vercel, and production was redeployed. The chat now answers in production; checked with a question on a test run.
- **New logo and app icons** (D-48, #27, merged).
  - The mark is two sheets, with the front one ticked, on a theme-aware tile, next to a `sawwiapp` wordmark. It replaces the black "S" square in the marketing header, footer, auth, checkout, onboarding, sidebar and phone top bar.
  - New `favicon.ico`, `icon.svg` and `apple-icon.png` replace Next's default favicon. The link-preview image and the email header use the new mark too, and the email button is emerald.
  - The logo is kept clearly apart from sawwi.ai's blue star and joined "ww" wordmark.
- **Dropdowns** (same branch): every select gets its own chevron, inset 10px from the right edge, with 32px of right padding so text never runs under it (`globals.css`).
- **Brand emerald as a quiet accent** (D-49, same branch): focus rings, text selection, selected chips, the active sidebar item, progress markers, landing-page eyebrows and feature icons. Primary (call-to-action) buttons are emerald; the landing page's bottom CTA band stays black. Secondary buttons and status colours are unchanged.
- **SEO pages** (D-47, Phase 8 PR 3, based on #26).
  - Nine public reconciliation pages: Magento 2, Dynamics 365 Business Central, Shopify, Amazon and Noon settlements, bank, payment gateway, COD and BNPL. Plus a hub at `/reconciliation` and a public template catalogue with a page per template, built from the seeded specs.
  - Connector claims are checked in a test against each connector's report list. Pages say "connector" only where one exists and "upload" everywhere else. Checks not calculated yet are shown as "listed for review".
  - `sitemap.xml`, `robots.txt`, canonical URLs on `sawwiapp.ai`, OpenGraph/Twitter cards with a generated preview image, and JSON-LD (`SoftwareApplication`, `BreadcrumbList`, `FAQPage`, `ItemList`).
  - A shared footer links every public page; the landing page gets a "By system" row.
  - 5 new tests.
  - Checked in the browser with an audit script across 15 pages: one h1 each, no heading skips, no images without alt, titles ≤ 65 characters and descriptions ≤ 161, canonical, OG and Twitter on every page. A phone-width check showed no horizontal scroll. Unknown slugs return 404.
  - **The user's part:** after merging, add `sawwiapp.ai` to Google Search Console and Bing Webmaster Tools (a DNS TXT record) and submit `https://sawwiapp.ai/sitemap.xml`.
- **Password reset** (D-46, Phase 8 PR 2, #26, based on #25).
  - "Forgot your password?" on the login page opens `/forgot-password`. It always gives the same answer, so nobody learns whether an email has an account.
  - The emailed link holds a 256-bit token, stored only as a hash. It works once, for an hour.
  - Resetting signs the user out everywhere and voids their other links.
  - Rate-limited in the database: 3 requests an hour per email (silently), 10 per address.
  - Migration 4. 3 new tests.
  - Checked in the browser: request → link from the log → new password → log in; a used link shows "expired".
- **Email through Resend: reminders and "ready to review"** (D-44, D-45, Phase 8 PR 1, #25).
  - Phase 8 scope recorded (D-44): email through Resend, then password reset, then SEO pages, as three stacked PRs.
  - `src/lib/email/`: Resend's REST API when `RESEND_API_KEY` is set, a log line otherwise. Each email is a `send_email` job whose key is the message, also sent as Resend's idempotency key, so retries never send twice.
  - **Reminders:** an hourly job emails owners, admins and editors once when a schedule comes due and nobody has started it.
  - **"Ready to review":** after a reconciliation, everyone else in the workspace gets the exception count and value and a link, sent right after the response.
  - **Settings → Email:** each person switches reminders and notices on or off.
  - **Designed emails:** a branded HTML layout (logo, card, figure tiles, a button), checked at desktop and phone width, with a plain-text copy alongside. `scripts/send-test-email.ts` sends a sample of each.
  - Migration 3 (`email_prefs`). 8 new tests with a fake Resend; nothing calls the live API.
  - **The user's part** (docs/DEPLOY.md → Email): `RESEND_API_KEY` is set in Vercel and Resend receiving is on (the user, 2026-11-07). Left: confirm `sawwiapp.ai` shows "Verified" in Resend (DNS records), optionally set `EMAIL_FROM`, and redeploy after merging.
- **Primary domain `sawwiapp.ai`** (D-43, #23, merged).
  - `DEFAULT_APP_URL`, `.env.example` and `docs/DEPLOY.md` use `https://sawwiapp.ai`.
  - The runbook now covers the Stripe webhook destination (Your account, Snapshot, eight events).
  - **The user's part:** in Vercel, set `sawwiapp.com`, the `www` hosts and `sawwi.hypermaxsolutions.com` to redirect to `sawwiapp.ai`; set `APP_URL=https://sawwiapp.ai`; point the Stripe webhook at `https://sawwiapp.ai/api/stripe/webhook`; redeploy.
- **Background jobs** (D-42, #22 → merged to `main` as #24).
  - A `jobs` table, run every 15 minutes by Vercel Cron through `/api/cron/tick` (protected by `CRON_SECRET`).
  - Jobs are queued once per key, claimed safely, retried with backoff, and listed in Admin.
  - First jobs: the demo store's midnight reset, cleanup of abandoned uploads, and pruning old jobs.
  - 6 new tests.
  - **Needs** `CRON_SECRET` in Vercel (Secret).
- **Production is live again** (2026-11-07). The user approved merging the Phase 7 stack (#16–#20) in this session. Before the merge, every production page failed, because `main` used SQLite and Vercel's disk is read-only.
  - Production `/api/health` reports the database ok, the files ok on Blob, and the region `fra1`.
  - The live demo reconciles end to end in production: 9 of 10 matched, 5 exceptions, AED 779.
  - Production environment variables were set by the user (connector key ring, superadmin, app URL, Anthropic, Stripe).
- **Vercel deploy** (D-41, #20, merged).
  - Functions are pinned to `fra1`, next to Neon.
  - `/api/health` checks the database and the file store.
  - The `pg` SSL warning is quieted.
  - `docs/DEPLOY.md` is the runbook.
  - Checked on #18's preview: the live demo runs end to end on Neon and Blob (5 exceptions, AED 779).
- **Connector key ring** (D-40, #19, merged).
  - Connection tokens use envelope encryption under named master keys from `SAWWI_CONNECTOR_KEYS`, active key first.
  - Superadmins rotate them from Admin → Connection secrets.
  - The old single key and old secrets keep working.
  - 4 new tests, including a full rotation through the database.
- **Files in a private Vercel Blob store** (D-39, #18, merged).
  - Normalized tables live in Blob on Vercel and in `.data/files` locally.
  - With Blob on, uploads go from the browser straight to Blob, past Vercel's 4.5 MB request limit, using a short-lived token scoped to the run. The server then parses them and deletes the raw copies.
  - The demo reset deletes its runs' files.
  - 9 new tests use a mocked Blob SDK, and the local path was checked in the browser.
  - **Fix:** uploads, setup answers and column remaps now check role, plan and trial (`runBlocker()`), so Viewers can no longer change a run.
  - **Needs:** a live upload test on a preview. The Blob store is connected, through OIDC (`BLOB_STORE_ID`), with no long-lived token.
- **Postgres everywhere** (D-38, #17, merged).
  - `node:sqlite` is gone. Production will use Neon through `pg` (`DATABASE_URL`). Locally and in tests, Sawwi runs PGlite, an in-process Postgres, so no install is needed.
  - Every store function is now async, and so are its callers. Tables are created by numbered migrations in `src/lib/db.ts`.
  - Lint now fails on a missed `await`.
  - All 203 tests pass, plus 4 new database-layer tests. The suite also ran against a real Postgres 17 through `pg`.
  - Checked in the browser: the live demo, a demo-data fill, a reconciliation, and the runs, usage and connections pages.
  - Local data from before this change (`.data/sawwi.db`) is no longer read.
  - Neon is connected to the Vercel project with the "SAWWI" prefix, so `SAWWI_DATABASE_URL` is read as well as `DATABASE_URL`.
- **Phase 7 scope: go live on Vercel + Neon** (D-37, #16, merged). Six PRs, in order:
  1. this scope;
  2. Postgres everywhere (Neon in production, PGlite in dev and tests, async stores);
  3. uploads in private Vercel Blob, sent from the browser straight to Blob (Vercel's 4.5 MB request cap);
  4. a connector keyring with rotation;
  5. Vercel deploy config, health check and runbook;
  6. a jobs table + Vercel Cron.
- **Demo data for every template; Phase 6 done** (D-36, #15, merged). Made-up files for the last 7 templates: customer statement, supplier statement, price list, RMA log, post-dated cheque register and bank, payouts and bank, import shipments, customs and freight bills. They refer to the demo company's and demo store's own documents, so all 23 templates fill with one click in the demo store and find their planted exceptions. A test fails if a template is added without demo data. 8 new tests.
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

0. **Phase 8:** email (#25), password reset (#26), SEO pages (D-47, this PR). Merge in that order. Then submit the sitemap in Google Search Console.
   - Resend: the key is in Vercel. Confirm `sawwiapp.ai` is verified in Resend, then redeploy after merging (docs/DEPLOY.md).
   - After merging, check Admin → Background jobs for `schedule_reminders` and `send_email`.
   - **Still open from Phase 7:** sign in to a real account on production and upload a file over 4.5 MB. That's the one path not yet run against the real Blob store.
1. Try Phase 4 with `ANTHROPIC_API_KEY` set. The AI path (analysis, emails, explain, free text) has only run against fallbacks so far.
2. Test Phase 5 (PDF inputs) on real anonymised statements and invoices, text and scanned.
3. **Live check of the Business Central connector** with the design partner's tenant: an Entra app registration + client secret, the app enabled in BC with a read-only permission set (D-29). Then the Shopify live check with the user's store.
4. **Live check of the Magento 2 connector** with a real store: an integration token with read-only Sales and Stores resources (D-30). Include Sales → Operations → Invoices for the new invoices report (D-52).
   - With the design partner: confirm their Magento↔BC sync writes the Magento order number to External Document No. and the shopper's e-mail to Sell-to E-mail, or the web templates need a different key (D-52).
5. Scheduled connector pulls, as a new job kind on the jobs table (D-26, D-27, D-42). Not chosen for Phase 8.

## Open questions

- **Multi-currency with the design partner (live check):** do their web invoices carry the Magento store view code in Global Dimension 1, and do they ever change the currency factor on a document? Sawwi works out local currency from BC's exchange rates table, because API v2.0 documents don't carry it (D-58).

- **Adobe Commerce gift cards (blocked on a live store):** confirm where Commerce's REST API returns a gift card account's balance history. Until then the gift card report stops with a clear message if it's missing, and store credit balances are uploaded (D-57). Does the design partner run Adobe Commerce or Magento Open Source?

- **Business Central price lists:** the price template compares Magento with BC's item unit price. Checking promotions against BC price list lines needs a small custom API page (AL extension) in the tenant, since API v2.0 has none (D-55). Does the design partner want that?

- **Demo store:** shared by all visitors (they can see each other's runs until the daily reset), with uploads and AI off. Do you want a private sandbox per visitor, or a small AI quota in the demo, instead?
- **Data residency:** the database and functions are in Frankfurt (D-41). Do UAE or KSA (PDPL) customers need their data kept in-country? Decide before real customer data goes in.
- **Neon plan:** Free for now. Upgrade before real customer data (storage, compute hours, restore window).
- **Vercel plan:** the team is on a Pro trial. Keep Pro after the trial (commercial use, cron).
- **Email replies:** the sender is `sawwi@sawwiapp.ai` (set by the user). With Resend receiving on, replies land in Resend. Should they go to a support inbox instead (a `reply-to`)?
- **Shopify live test:** needs a store and a custom-app token from the user. Should Sawwi also get a public Shopify app (OAuth, one-click install)?
- **Business Central live test:** needs the design partner's IT to register an Entra app and enable it in BC (D-29). Which environment (Sandbox first?) and company? Do they want customer/vendor ledger entries too? Those need a small AL extension (custom API page), since API v2.0 has none.
- **Magento live test:** which store? On 2.4.4+ the merchant must allow integration tokens as Bearer tokens (or we add OAuth 1.0a signing). Magento 1 stays upload-only.
- **Next connector:** Odoo (easy, free trial) or Amazon SP-API (most valuable, needs a developer registration, which only the user can start).
- **Production key management:** built (D-40): a key ring in a sensitive Vercel variable, rotated from Admin. Add a cloud KMS (AWS or GCP) later?
- **Scheduled runs:** the run is created on Start rather than pre-created (D-26), so unused schedules don't use plan runs. Is that what you want?
- **Real PDF samples:** anonymised Emirates NBD, ADCB, Al Rajhi and SNB statements and Noon/Amazon invoices, to tune the header vocabulary and layouts. Arabic PDFs are so far tested only with synthetic positioned text, and Arabic OCR not on a real scan.
- **Brand / trademark:** stay "Sawwi" or rename (see D-12)?
- **Anthropic API key:** not configured yet, so neither the Haiku mapping path nor the Phase 4 Sonnet/Haiku writing has run live. Rule-based fallbacks cover both meanwhile.
- **Real sample exports** (Magento 1, Odoo, marketplace settlements) to test mappings against.

## Known issues

- Dev-only "instant navigation" warnings on client navigation from the gallery to a template page. The production build is fine; investigated, no fix found yet.
- Small files of whole numbers (e.g. 5 invoice lines, all with different quantities) profile the quantity column as an ID, so mapping asks one confirm question. This is a general profiling rule, not specific to PDFs. Connectors avoid it by writing decimals with 2 places (D-29).
- "Value at risk" adds quantity differences into money totals for quantity checks (D-13), except where a check prices them with a `value` expression, as the stock template does (D-54).
