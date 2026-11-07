# Deploying Sawwi

Production runs on **Vercel** (project `hypermax-solutions/sawwi`) with **Neon** Postgres and a
**private Vercel Blob** store (D-37). This is the runbook: what has to exist, how a deploy goes out,
and what to do when something breaks.

## What production needs

| Piece | Where it comes from | Notes |
| --- | --- | --- |
| Vercel Pro team | Vercel billing | Hobby is for non-commercial use and runs cron jobs only daily. |
| Neon database | Project → Storage → Neon (Marketplace): `neon-sawwi`, Frankfurt (`fra1`) | Connected with the `SAWWI` prefix, so the app reads `SAWWI_DATABASE_URL` (the pooled URL). Production and Preview; turn on preview branching so previews never touch production data. |
| Private Blob store | Project → Storage → Blob, access **Private**: `sawwi-blob` | Adds `BLOB_STORE_ID`; the app signs in with the deployment's Vercel OIDC token (no long-lived secret). |
| Domain | Project → Domains: `sawwiapp.ai` (primary, D-43) | `sawwiapp.com`, `www.sawwiapp.ai`, `www.sawwiapp.com` and `sawwi.hypermaxsolutions.com` are set to **Redirect to** `sawwiapp.ai` (308), so there is one address for sign-in cookies, the Stripe webhook and search. |

## Environment variables

Set in Project → Settings → Environment Variables. Mark secrets **Sensitive**. Values are entered by
a person, never by an agent or committed to the repo.

| Variable | Production | Preview | What it is |
| --- | --- | --- | --- |
| `SAWWI_DATABASE_URL` | Neon integration | Neon integration | Postgres connection (D-38). `DATABASE_URL` also works. |
| `BLOB_STORE_ID` | Blob integration | Blob integration | File store (D-39). |
| `SAWWI_CONNECTOR_KEYS` | Sensitive, required for connections | Sensitive, a **different** key | Key ring for connection secrets: `k1:<openssl rand -base64 32>` (D-40). Never remove a key that still has secrets (Admin → Connection secrets). |
| `ANTHROPIC_API_KEY` | Sensitive | Optional | AI mapping and writing. Without it, rule-based fallbacks. |
| `SAWWI_SUPERADMIN_EMAILS` | Your email | Your email | Who gets `/admin`. |
| `APP_URL` | `https://sawwiapp.ai` | unset | Pins links and Stripe return URLs. |
| `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH`, `STRIPE_WEBHOOK_SECRET` | Live keys, Sensitive | Test-mode keys | Card checkout. Only shown while the paywall is on. |
| `SAWWI_DEMO` | unset (demo on) | unset | `off` hides the public demo store. |
| `CRON_SECRET` | Secret | Secret (a different one) | Protects `/api/cron/tick`; Vercel Cron sends it as a bearer token. `openssl rand -base64 32`. Without it, background jobs are off (D-42). |

After changing a variable, **redeploy**: running deployments keep the values they were built with.

### Stripe webhook

In the Stripe Dashboard (test mode for previews, live mode for production), add an event
destination:

- **Events from:** Your account (not Connected accounts: Sawwi isn't a Connect platform).
- **Payload style:** Snapshot, API version `2026-09-30.endive` (the one `stripe@23.0.1` pins). The
  handler reads the full object from each event; thin payloads don't carry it.
- **Events:** `checkout.session.completed`, `customer.subscription.created`, `.updated`, `.deleted`,
  `.paused`, `.resumed`, `invoice.paid`, `invoice.payment_failed`.
- **Endpoint URL:** `https://sawwiapp.ai/api/stripe/webhook`. Use the primary domain: a redirecting
  domain answers 308, which Stripe treats as a failed delivery.
- Copy the signing secret (`whsec_…`) into `STRIPE_WEBHOOK_SECRET` and redeploy.

## Shipping a change

1. A PR is opened. CI runs test, typecheck, lint and build, and Vercel builds a preview at
   `sawwi-git-<branch>-hypermax-solutions.vercel.app`, behind Vercel login.
2. Check the preview: `/api/health` should say `{"ok":true,"database":"ok","files":"ok","fileStore":"blob"}`.
   For changes to files or the database, try the live demo (Fill with demo data → Run reconciliation)
   and, signed in to a real account, an upload over 4.5 MB.
3. The user merges. `main` deploys to production. Check `https://sawwiapp.ai/api/health`.

**Schema changes** are numbered migrations in `src/lib/db.ts`, applied by the first request after a
deploy (under a lock, so concurrent cold starts don't race). Keep them additive: the previous
deployment keeps serving until the new one is promoted, against the same database.

## When something breaks

- **Roll back:** Vercel → Deployments → the last good production deployment → ⋯ → **Instant Rollback**.
  It doesn't undo database migrations, which is why they stay additive.
- **Logs:** Vercel → Logs, filter by Error. Every server error has a `digest` that matches the
  error page's code.
- **Health failing:** `database` failing → Neon status, `SAWWI_DATABASE_URL`, connection limits.
  `files` failing → the Blob store is connected to this environment, and the project allows OIDC.
- **Restore data:** Neon keeps point-in-time history (window depends on the Neon plan). Restore to a
  new branch first, check it, then point `SAWWI_DATABASE_URL` at it or copy rows back.
- **Lost connector key:** connections sealed under it can't be opened. Their owners re-add them.

## Known limits

- Functions run in `fra1` (Frankfurt, `vercel.json`), next to the Neon database, so each query is
  a same-region round trip. Users in the Gulf see roughly 100 ms more per page than a regional host would.
  Where customer data may live (UAE, KSA PDPL) is an open question in PROGRESS.
- Neon is on its Free plan: fine for previews and a soft launch, but its storage, compute hours and
  restore window are small. Move to a paid plan before real customer data goes in.
- Background jobs (D-42) run every 15 minutes from Vercel Cron, on production deployments only (Vercel
  doesn't run cron on previews). Admin → Background jobs shows the last runs. To run one by hand:
  `curl -H "Authorization: Bearer $CRON_SECRET" https://sawwiapp.ai/api/cron/tick`.
- Cron more often than daily needs Vercel Pro: on Hobby, a deploy with this schedule fails.
