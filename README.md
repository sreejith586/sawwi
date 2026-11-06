# Sawwi

Reconciliation for e-commerce sellers in the GCC: marketplace sellers, own webstores (Shopify,
Magento 1 & 2, WooCommerce, Salla, Zid) and companies selling directly to businesses.

Product and architecture plan: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

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
2. Starting a template creates a run. Each uploaded file (CSV, TSV, XLSX) is parsed, title rows are
   skipped, and every column is profiled (type, date format, currency).
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

Local data (SQLite database and uploaded files) lives in `.data/`, which is git-ignored.
