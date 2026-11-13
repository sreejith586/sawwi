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
| `SAWWI_QUICKBOOKS_CLIENT_ID`, `SAWWI_QUICKBOOKS_CLIENT_SECRET` | Production keys, Sensitive | Development keys + `SAWWI_QUICKBOOKS_ENVIRONMENT=sandbox` | "Connect with QuickBooks" (D-81, D-82). Redirect URI `https://sawwiapp.ai/api/connections/oauth/quickbooks/callback` registered at developer.intuit.com. Without them the button says it isn't set up. |
| `SAWWI_XERO_CLIENT_ID`, `SAWWI_XERO_CLIENT_SECRET` | Sensitive | Optional | "Connect with Xero" (D-81, D-83). Redirect URI `https://sawwiapp.ai/api/connections/oauth/xero/callback`. `SAWWI_XERO_SCOPES` only if the app uses the older broad scopes. |
| `ANTHROPIC_API_KEY` | Sensitive | Optional | AI mapping and writing. Without it, rule-based fallbacks. |
| `ANTHROPIC_WORKSPACE_ID` | Config | Only for an unscoped key | The Claude Console workspace ID (`wrkspc_…`). Needed when the API key isn't scoped to a workspace; Anthropic refuses every call otherwise. |
| `SAWWI_SUPERADMIN_EMAILS` | Your email | Your email | Who gets `/admin`. |
| `APP_URL` | `https://sawwiapp.ai` | unset | Pins links and Stripe return URLs. |
| `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH`, `STRIPE_WEBHOOK_SECRET` | Live keys, Sensitive | Test-mode keys | Card checkout. Only shown while the paywall is on. |
| `SAWWI_DEMO` | unset (demo on) | unset | `off` hides the public demo store. |
| `RESEND_API_KEY` | Sensitive | Sensitive (same key is fine) | Sends email through Resend (D-45). Without it, emails are only logged. |
| `EMAIL_FROM` | optional, default `Sawwi <sawwi@sawwiapp.ai>` | same | The sender. Must be on the domain verified in Resend. |
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

### Email (Resend)

Emails are reminders when a schedule comes due, "ready to review" notices and password resets
(D-45, D-46). Without Resend, "Forgot your password?" answers as usual but no email arrives. The user does these steps; an agent never creates the account or handles the key.

1. **Account:** sign up at resend.com. Check the plan's daily and monthly sending limits against your team's size.
2. **Domain:** Resend → Domains → Add domain → `sawwiapp.ai`, region **eu-west-1 (Ireland)**, the
   closest to Frankfurt. Resend then shows the DNS records to add where `sawwiapp.ai`'s DNS is
   hosted (Vercel → Domains if the nameservers are Vercel's):
   - **DKIM:** a `TXT` record at `resend._domainkey` with the key Resend shows;
   - **SPF:** an `MX` record and a `TXT` record (`v=spf1 include:amazonses.com ~all`) at the `send`
     subdomain, so they don't clash with any mail already on the root domain;
   - **DMARC** (recommended): a `TXT` record at `_dmarc` such as `v=DMARC1; p=none;`. Tighten to
     `p=quarantine` once mail is flowing.
   Copy the values from Resend's page, not from here: they're specific to the account. Then press
   **Verify** and wait for "Verified" (minutes to a few hours).
3. **Key:** Resend → API Keys → Create, permission **Sending access**, domain `sawwiapp.ai`.
4. **Vercel:** set `RESEND_API_KEY` (Sensitive) and `EMAIL_FROM=Sawwi <sawwi@sawwiapp.ai>`
   for Production (and Preview if you want previews to send), then **redeploy**.
5. **Test send** from your own machine, with the key in your shell only (never in a file):
   `RESEND_API_KEY=re_... pnpm dlx tsx scripts/send-test-email.ts you@example.com` sends one
   reminder and one "ready to review" with made-up data. A `403` means the domain isn't verified yet.
6. **Check:** Settings → Email no longer says email is off. Run a reconciliation in a workspace with a
   teammate: they get "Ready to review". Admin → Background jobs shows the `send_email` job as done;
   Resend → Emails shows the delivery.

**Receiving** (optional, turned on by the user on 2026-11-07): Resend's inbound mail adds an `MX`
record and keeps replies to the sender address in Resend. Sawwi doesn't read inbound mail; it's
for a person to look at.

Reminders go out from the hourly `schedule_reminders` job, so they need `CRON_SECRET` too (D-42).

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
- The Neon integration makes a database branch, `preview/<git branch>`, for each new preview git branch,
  and Neon's Free plan holds 10 branches (main included). When it's full, every new preview fails within a
  second with `Resource provisioning failed` and no build log (D-59). The **Delete preview database**
  workflow (`.github/workflows/neon-preview-cleanup.yml`) deletes a PR's branch when the PR is closed. It
  needs the `NEON_API_KEY` secret and the `NEON_PROJECT_ID` variable in the GitHub repository settings.
  Run it by hand (Actions → Delete preview database → Run workflow) for a branch closed before it existed,
  or delete old `preview/…` branches in the Neon console. More than 9 PRs open at once still fills the plan.
- Background jobs (D-42) run every 15 minutes from Vercel Cron, on production deployments only (Vercel
  doesn't run cron on previews). Admin → Background jobs shows the last runs. To run one by hand:
  `curl -H "Authorization: Bearer $CRON_SECRET" https://sawwiapp.ai/api/cron/tick`.
- Cron more often than daily needs Vercel Pro: on Hobby, a deploy with this schedule fails.
