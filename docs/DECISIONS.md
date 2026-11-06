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
