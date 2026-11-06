# Sawwi

Reconciliation for e-commerce sellers in the GCC: marketplace sellers, own webstores (Shopify,
Magento 1 & 2, WooCommerce, Salla, Zid) and companies selling directly to businesses.

Product and architecture plan: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Where things stand: [docs/PROGRESS.md](docs/PROGRESS.md). Why: [docs/DECISIONS.md](docs/DECISIONS.md). How to contribute (PRs, docs in every commit): [docs/PROCESS.md](docs/PROCESS.md).

## Run locally

```bash
pnpm install
cp .env.example .env.local   # add ANTHROPIC_API_KEY (optional, see below)
pnpm dev                     # http://localhost:3000
```

```bash
pnpm test        # unit + engine tests (never call the API)
pnpm typecheck
pnpm lint
pnpm build
```

## How a run works

1. Onboarding records the seller profile; the gallery shows templates that fit it.
2. Starting a template creates a run. Each uploaded file (CSV, TSV, XLSX or PDF, up to 25 MB; several
   files can go into one slot) is parsed, title rows are skipped, and every column is profiled (type,
   date format, currency). PDFs (bank statements, invoices, settlement statements) are turned into the
   same table in code, with no AI: embedded ZATCA e-invoice XML first, then the text layer, with a
   saved layout per bank, and balance and VAT checks before matching. Scanned (image-only) PDFs,
   up to 20 pages, are read by local OCR (`tesseract.js`, English and Arabic, on the server; nothing
   is sent out) and marked for review. Password-protected PDFs are refused. See ARCHITECTURE §8.
3. Columns are mapped to the template's canonical fields, cheapest first:
   - **Saved mapping** for this file layout (fingerprint of its headers): no AI, no questions.
   - **Known column names** (`src/lib/mapping/aliases.ts`) scored against headers and data types.
   - **Claude Haiku** (`src/lib/mapping/llm.ts`) for whatever is still unresolved, with a cached,
     byte-stable system prompt shared by every template and run. Skipped if no API key is set.
4. Anything uncertain becomes a one-click question in the chat: confirm a column, pick a column,
   day-first vs month-first dates, currency, or a cross-file key format difference (`#1001` vs `1001`).
5. Answers are saved per company and file layout, so the next run with the same exports asks nothing.
6. **Run reconciliation** joins the files per the template's `links` (`src/lib/templates/catalog.ts`) and
   evaluates every check's declarative `rule` (`src/lib/recon/match.ts`): unmatched rows, amount
   differences with tolerance, duplicates, ageing, row patterns, VAT rates. No AI tokens are used.
   Checks without a rule show as "Not run", never as passed.
7. The report has KPI tiles, a matching summary, and sortable, filterable check and exception tables.
   Every table downloads as Excel (`/api/runs/[id]/export`), filtered and sorted like the screen.

8. Above the report, an **analysis** (Claude Sonnet, written once per result from totals and the
   largest exceptions, then cached) says what's wrong and what to fix first. Without an API key, Sawwi
   writes it from rules.
9. The **chat** offers one-click follow-ups: what to fix first, breakdowns by key/month/SKU (with
   Excel), copyable email drafts to the marketplace/customer/supplier, and "explain this exception".
   Free-text questions use Claude Haiku. The AI only sees aggregates and a few exceptions, never files.
10. **No template fits?** Start a custom reconciliation from the gallery: name two files, confirm the
    key and amount columns with chips, and save it as your own template.
11. **Schedules:** set a template to come due weekly or monthly. When it's due it appears under
    "Due now" on Home and on the Schedules page; Start opens that period's run, and saved mappings
    make a repeat ask nothing. No background jobs: due dates are worked out when the page loads.

Local data (SQLite database and uploaded files) lives in `.data/`, which is git-ignored.
