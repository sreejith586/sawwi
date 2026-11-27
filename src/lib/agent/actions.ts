import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { AssistError, confirmMatch, findInvoice } from "@/lib/automation/purchase-invoices/assist";
import { reviewDraft } from "@/lib/automation/purchase-invoices/draft";
import * as invoices from "@/lib/automation/purchase-invoices/service";

// Actions the chat agent proposes and the user confirms with a click (D-96). The agent never runs
// these itself: approving, confirming a PO/GRN match, pushing to the ERP, spending on AI reading
// and deleting each need a person to sign off. A proposal is stored with the exact invoices (and,
// for a push, the content hash each was shown with), and only its proposer can confirm it, once,
// within 30 minutes. The table is also the audit trail of what the agent asked for and what ran.

export type ActionKind = "approve" | "confirm_match" | "push" | "read_with_ai" | "retry_failed" | "delete";
export type ActionInvoice = { id: string; label: string; total: string; hash: string; note?: string };
export type AgentAction = {
  id: string;
  kind: ActionKind;
  title: string;
  /** What happens, in one sentence the card shows above the list. */
  effect: string;
  invoices: ActionInvoice[];
  status: "pending" | "done" | "cancelled";
  results?: { label: string; ok: boolean; message: string }[];
  createdAt: string;
};

export const ACTION_TTL_MS = 30 * 60_000;

const TITLES: Record<ActionKind, [string, string]> = {
  approve: ["Approve", "Each is approved as it stands, including the purchase order and GRN lines shown on its page where they're still to be confirmed. Any later edit withdraws the approval."],
  confirm_match: ["Confirm the PO and GRN match", "You confirm the purchase order and GRN lines shown on each invoice's page."],
  push: ["Push to Business Central", "Each is sent to Business Central: against its purchase order where matched, otherwise as an unposted draft invoice. Nothing is posted."],
  read_with_ai: ["Read with AI", "Each PDF not read by AI before is read by Claude (a few cents each); earlier readings are reused at no cost."],
  retry_failed: ["Retry reading", "Each failed PDF is read again (with AI where it's on: a few cents each)."],
  delete: ["Delete", "Each draft and its PDF are deleted. This can't be undone."],
};

const money = (n: number | null, ccy: string) => (n === null ? "—" : `${ccy} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim());

/** Stores a proposal for the user to confirm; checks every invoice exists and can take the action. */
export async function propose(orgKey: string, userId: string, kind: ActionKind, refs: string[]): Promise<AgentAction> {
  if (!refs.length) throw new AssistError("Name at least one invoice.");
  if (refs.length > 50) throw new AssistError("At most 50 invoices in one action.");
  const views = await invoices.listViews(orgKey);
  const erp = Boolean(await invoices.currentTarget(orgKey));
  const list: ActionInvoice[] = [];
  for (const ref of [...new Set(refs)]) {
    const c = await findInvoice(orgKey, ref);
    const v = views.find((x) => x.id === c.id)!;
    const label = `${c.draft.invoiceNumber || c.fileName} · ${c.draft.vendorName || c.draft.supplierName || "unknown supplier"}`;
    const why = refusal(kind, v, erp);
    if (why) throw new AssistError(`${label}: ${why}`);
    const note = kind === "approve" && needsMatchConfirmed(v) ? `Also confirms the match to ${orders(v)}` : undefined;
    list.push({ id: c.id, label, total: money(c.draft.total, c.draft.currency), hash: v.hash, note });
  }
  const [title, effect] = TITLES[kind];
  const action: AgentAction = { id: randomUUID(), kind, title: `${title} ${list.length} invoice${list.length === 1 ? "" : "s"}`, effect, invoices: list, status: "pending", createdAt: new Date().toISOString() };
  await getDb().run(
    "INSERT INTO agent_actions (id, org_key, user_id, kind, args_json, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
    action.id, orgKey, userId, kind, JSON.stringify({ title: action.title, effect, invoices: list }), action.createdAt,
  );
  return action;
}

const needsMatchConfirmed = (v: invoices.CaptureView) => v.draft.postTo === "order" && !v.draft.poConfirmed && v.draft.lines.some((l) => l.po);
const orders = (v: invoices.CaptureView) => [...new Set(v.draft.lines.flatMap((l) => (l.po ? [l.po.orderNumber] : [])))].join(", ");

/** What would still block approval once a suggested match is confirmed, as the approve card does. */
function blockersAfterConfirming(v: invoices.CaptureView, erp: boolean): string[] {
  if (!needsMatchConfirmed(v)) return v.review.blockers;
  const confirmed = reviewDraft({ ...v.draft, poConfirmed: true }, { erp }).blockers;
  // Keep what the server adds on top of the draft's own checks (e.g. a twin already pushed).
  const own = new Set(reviewDraft(v.draft, { erp }).blockers);
  return [...v.review.blockers.filter((b) => !own.has(b)), ...confirmed];
}

/** Why an invoice can't take this action now, said up front so the card never offers what would fail. */
function refusal(kind: ActionKind, v: invoices.CaptureView, erp: boolean): string | undefined {
  const sent = v.status === "pushed" || v.status === "pushing";
  switch (kind) {
    case "approve":
      if (v.status === "approved") return "it's already approved.";
      if (sent) return "it was already sent to the ERP.";
      if (v.status === "failed") return "it hasn't been read yet.";
      {
        const left = blockersAfterConfirming(v, erp);
        return left[0] ? `not yet: ${left[0]}` : undefined;
      }
    case "confirm_match":
      if (sent) return "it was already sent to the ERP.";
      return v.draft.postTo === "order" && v.draft.lines.some((l) => l.po) ? undefined : "it isn't matched to a purchase order.";
    case "push":
      if (v.status !== "approved") return "only approved invoices can be pushed; approve it first.";
      return v.review.blockers[0];
    case "read_with_ai":
      if (sent) return "it was already sent to the ERP.";
      return v.status === "failed" ? "it failed to read; retry it instead." : undefined;
    case "retry_failed":
      return v.status === "failed" ? undefined : "it was read already.";
    case "delete":
      return sent ? "it was sent to the ERP and stays as the record." : undefined;
  }
}

type Row = { id: string; org_key: string; user_id: string; kind: ActionKind; args_json: string; status: string; result_json: string | null; created_at: string };

const toAction = (r: Row): AgentAction => {
  const a = JSON.parse(r.args_json) as Pick<AgentAction, "title" | "effect" | "invoices">;
  return { id: r.id, kind: r.kind, ...a, status: r.status as AgentAction["status"], results: r.result_json ? JSON.parse(r.result_json) : undefined, createdAt: r.created_at };
};

export async function getAction(orgKey: string, id: string): Promise<AgentAction | undefined> {
  const r = await getDb().get<Row>("SELECT * FROM agent_actions WHERE org_key = ? AND id = ?", orgKey, id);
  return r && toAction(r);
}

/**
 * Runs or cancels a proposal: only its proposer, once, while it's fresh. Claimed first, so a double
 * click runs it once. Each invoice is checked again by the service (approval, hash, blockers).
 */
export async function decide(orgKey: string, userId: string, id: string, decision: "confirm" | "cancel", opts: { countries?: string[] } = {}): Promise<AgentAction> {
  const r = await getDb().get<Row>("SELECT * FROM agent_actions WHERE org_key = ? AND id = ?", orgKey, id);
  if (!r) throw new Error("That action no longer exists.");
  if (r.user_id !== userId) throw new Error("Only the person who asked for this action can confirm it.");
  if (r.status !== "pending") return toAction(r);
  const fresh = Date.now() - Date.parse(r.created_at) < ACTION_TTL_MS;
  const next = decision === "cancel" || !fresh ? "cancelled" : "running";
  const claimed = await getDb().run("UPDATE agent_actions SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'", next, new Date().toISOString(), id);
  if (claimed.changes !== 1) return (await getAction(orgKey, id))!;
  if (next === "cancelled") {
    if (!fresh && decision === "confirm") {
      await getDb().run("UPDATE agent_actions SET result_json = ? WHERE id = ?", JSON.stringify([{ label: "Expired", ok: false, message: "This was proposed more than 30 minutes ago. Ask again." }]), id);
    }
    return (await getAction(orgKey, id))!;
  }
  const action = toAction(r);
  const label = new Map(action.invoices.map((i) => [i.id, i.label]));
  let results: { label: string; ok: boolean; message: string }[];
  try {
    results = await run(orgKey, userId, action, opts);
  } catch (error) {
    results = [{ label: action.title, ok: false, message: error instanceof Error ? error.message : "It didn't run. Try again." }];
  }
  results = results.map((x) => ({ ...x, label: label.get(x.label) ?? x.label }));
  await getDb().run("UPDATE agent_actions SET status = 'done', result_json = ? WHERE id = ?", JSON.stringify(results), id);
  return (await getAction(orgKey, id))!;
}

async function run(orgKey: string, userId: string, a: AgentAction, opts: { countries?: string[] }) {
  const ids = a.invoices.map((i) => i.id);
  const bulk = (rs: invoices.BulkResult[], ok: string) => rs.map((x) => ({ label: x.id, ok: x.ok, message: x.message ?? (x.ok ? ok : "Not done.") }));
  switch (a.kind) {
    case "approve": {
      // A suggested PO/GRN match the card showed is confirmed first, then the invoice is approved.
      const notes = new Map<string, string>();
      for (const i of a.invoices.filter((x) => x.note)) {
        try {
          await confirmMatch(orgKey, i.id);
        } catch (error) {
          notes.set(i.id, error instanceof Error ? error.message : "The match couldn't be confirmed.");
        }
      }
      const done = await invoices.approveMany(orgKey, ids.filter((id) => !notes.has(id)), userId);
      return [...bulk(done, "Approved."), ...[...notes].map(([id, message]) => ({ label: id, ok: false, message }))];
    }
    case "push":
      // Each with the hash it was shown with: anything changed since is refused, not pushed.
      return bulk(await invoices.pushMany(orgKey, a.invoices.map((i) => ({ id: i.id, hash: i.hash })), userId), "Pushed.");
    case "read_with_ai":
      return bulk(await invoices.rereadMany(orgKey, ids, opts), "Read.");
    case "retry_failed":
      return bulk(await invoices.retryMany(orgKey, ids, opts), "Read.");
    case "confirm_match":
      return Promise.all(
        ids.map(async (id) => {
          try {
            const v = await confirmMatch(orgKey, id);
            return { label: id, ok: true, message: v.review.blockers.length ? `Confirmed. Still to fix: ${v.review.blockers[0]}` : "Confirmed; ready to approve." };
          } catch (error) {
            return { label: id, ok: false, message: error instanceof Error ? error.message : "Not confirmed." };
          }
        }),
      );
    case "delete":
      return Promise.all(
        ids.map(async (id) => {
          const ok = await invoices.discard(orgKey, id);
          return { label: id, ok, message: ok ? "Deleted." : "It can't be deleted now." };
        }),
      );
  }
}
