import type Anthropic from "@anthropic-ai/sdk";
import { codeLine, findInvoice, linkGrn, linkPo, matchAgain, setPostTo } from "@/lib/automation/purchase-invoices/assist";
import * as invoices from "@/lib/automation/purchase-invoices/service";
import type { CaptureView } from "@/lib/automation/purchase-invoices/service";
import { aiReadingsSince } from "@/lib/automation/purchase-invoices/store";
import { propose, type ActionKind, type AgentAction } from "./actions";

// The chat agent's tools (D-96). Three kinds:
// - read: look things up, give links. Run at once.
// - edit: change one invoice's draft (link a GRN or PO, code a line, PO or standalone). Run at once:
//   nothing leaves Sawwi, and the edit withdraws any approval, as an edit on the page does.
// - act: approve, confirm a match, push, AI reading, retry, delete. Never run by the agent: each
//   becomes a proposal the user confirms with a click (actions.ts).
// Every tool works only in the signed-in workspace, and viewers get the read tools only.

export type ToolContext = { orgKey: string; userId: string; canEdit: boolean; aiAvailable: boolean };
export type ToolOutcome = { result: unknown; proposal?: AgentAction; changed?: boolean; summary: string };

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object" as const, properties, required, additionalProperties: false });
const invoiceRef = { type: "string", description: "The invoice number as printed (e.g. 4292, INV/2026/05737), its file name, or its id." };
const invoiceRefs = { type: "array", items: invoiceRef, minItems: 1, maxItems: 50 };
const STATUS = ["all", "to_review", "failed", "approved", "in_erp"];

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "workspace_overview",
    description: "Counts of purchase invoices by status, the ERP they push to, failed reads, and AI reading use today. Start here when asked what needs attention.",
    input_schema: obj({}),
  },
  {
    name: "list_invoices",
    description:
      "Purchase invoices in this workspace with supplier, number, date, total, status, how they post (PO or standalone), matched PO and GRN, and the first thing blocking each. Filter by status and/or a search on supplier, invoice number or file name.",
    input_schema: obj({
      status: { type: "string", enum: STATUS, description: "to_review = read but not approved; failed = couldn't read or couldn't push; in_erp = sent." },
      search: { type: "string", description: "Part of a supplier name, invoice number or file name." },
    }),
  },
  {
    name: "get_invoice",
    description: "One invoice in full: header, totals, checks, every blocker and warning, and its lines with item code, ERP item, quantity, price, PO line and GRN.",
    input_schema: obj({ invoice: invoiceRef }, ["invoice"]),
  },
  {
    name: "download_link",
    description: "A link to download invoices as Excel (Invoices and Lines sheets) or CSV: chosen invoices, or a whole status tab.",
    input_schema: obj({ invoices: invoiceRefs, status: { type: "string", enum: STATUS }, format: { type: "string", enum: ["xlsx", "csv"] } }, ["format"]),
  },
  {
    name: "link_grn",
    description: "Edit: match an invoice against a goods receipt (GRN) number from Business Central, and its purchase order. Withdraws any approval.",
    input_schema: obj({ invoice: invoiceRef, grn: { type: "string" } }, ["invoice", "grn"]),
  },
  {
    name: "link_po",
    description: "Edit: match an invoice against a purchase order number from Business Central. Withdraws any approval.",
    input_schema: obj({ invoice: invoiceRef, po: { type: "string" } }, ["invoice", "po"]),
  },
  {
    name: "match_again",
    description: "Edit: search the vendor's recent GRNs and open purchase orders again for an invoice, replacing its current suggestion. Withdraws any approval.",
    input_schema: obj({ invoice: invoiceRef }, ["invoice"]),
  },
  {
    name: "code_line",
    description: "Edit: set one invoice line's Business Central item or G/L account (by its number). Withdraws any approval.",
    input_schema: obj({ invoice: invoiceRef, line: { type: "integer", minimum: 1 }, type: { type: "string", enum: ["item", "account"] }, number: { type: "string" } }, ["invoice", "line", "type", "number"]),
  },
  {
    name: "set_post_to",
    description: "Edit: post an invoice against its purchase order (order) or as a standalone purchase invoice (invoice). Withdraws any approval.",
    input_schema: obj({ invoice: invoiceRef, post_to: { type: "string", enum: ["order", "invoice"] } }, ["invoice", "post_to"]),
  },
  {
    name: "propose_action",
    description:
      "Ask the user to confirm an action on invoices; you can't run these yourself. approve: sign off invoices with nothing blocking. confirm_match: sign off the suggested PO and GRN lines. push: send approved invoices to Business Central. read_with_ai: have Claude read the PDFs again (costs a few cents each, earlier readings reused free). retry_failed: read failed PDFs again. delete: remove drafts. The user sees a card with every invoice and a Confirm button; say what it will do and wait for them.",
    input_schema: obj({ action: { type: "string", enum: ["approve", "confirm_match", "push", "read_with_ai", "retry_failed", "delete"] }, invoices: invoiceRefs }, ["action", "invoices"]),
  },
];

const EDITS = new Set(["link_grn", "link_po", "match_again", "code_line", "set_post_to", "propose_action"]);
const TAB: Record<string, invoices.ExportScope> = { all: "all", to_review: "open", failed: "failed", approved: "approved", in_erp: "pushed" };

const statusOf = (v: CaptureView) =>
  v.status === "failed" ? "failed (not read)" : v.status === "approved" && v.failure?.stage === "push" ? "approved, last push failed" : v.status === "pushed" ? "in ERP" : v.status.replace("_", " ");

const row = (v: CaptureView) => {
  const d = v.draft;
  const pos = [...new Set(d.lines.flatMap((l) => (l.po ? [l.po.orderNumber] : [])))];
  const grns = [...new Set(d.lines.flatMap((l) => (l.grn ? [l.grn.number] : [])))];
  return {
    id: v.id,
    number: d.invoiceNumber || v.fileName,
    supplier: d.vendorName || d.supplierName,
    vendor_no: d.vendorNo || null,
    date: d.invoiceDate,
    total: d.total,
    currency: d.currency,
    lines: d.lines.length,
    status: statusOf(v),
    post_to: d.postTo === "order" ? "purchase order" : "standalone invoice",
    po: pos,
    grn: grns,
    match_confirmed: d.postTo === "order" ? Boolean(d.poConfirmed) : null,
    blocked_by: v.status === "pushed" ? null : (v.review.blockers[0] ?? null),
    blockers: v.status === "pushed" ? 0 : v.review.blockers.length,
    warnings: v.review.warnings.length,
    read_by: v.status === "failed" ? null : v.source.ai?.used === "ai" ? "AI" : v.source.method,
    page: `/automation/purchase-invoices/${v.id}`,
  };
};

const detail = (v: CaptureView) => ({
  ...row(v),
  file: v.fileName,
  supplier_trn: v.draft.supplierTrn,
  due_date: v.draft.dueDate,
  net: v.draft.subtotal,
  vat: v.draft.vat,
  checks: v.review.checks.map((c) => `${c.ok ? "OK" : "FAILS"}: ${c.detail}`),
  all_blockers: v.review.blockers,
  all_warnings: v.review.warnings.slice(0, 30),
  failure: v.failure?.message ?? null,
  erp_document: v.erp?.number ?? null,
  lines: v.draft.lines.slice(0, 150).map((l, i) => ({
    line: i + 1,
    code: l.sku,
    description: l.description.slice(0, 80),
    erp: l.erpNo ? `${l.erpType === "account" ? "G/L " : ""}${l.erpNo}` : null,
    qty: l.qty,
    price: l.unitPrice,
    net: l.net,
    po: l.po ? `${l.po.orderNumber} (${l.po.open} open at ${l.po.poPrice})` : null,
    grn: l.grn ? `${l.grn.number} (${l.grn.quantity} received)` : null,
  })),
});

export async function runTool(ctx: ToolContext, name: string, input: Record<string, unknown>): Promise<ToolOutcome> {
  if (EDITS.has(name) && !ctx.canEdit) return { result: { error: "This user can view but not change invoices (viewer role)." }, summary: "Not allowed for viewers" };
  const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  const refs = Array.isArray(input.invoices) ? (input.invoices as unknown[]).filter((x): x is string => typeof x === "string") : [];
  switch (name) {
    case "workspace_overview": {
      const views = await invoices.listViews(ctx.orgKey);
      const by = (f: (v: CaptureView) => boolean) => views.filter(f).length;
      const target = await invoices.currentTarget(ctx.orgKey);
      return {
        summary: "Looked at the workspace",
        result: {
          invoices: views.length,
          to_review: by((v) => v.status === "needs_review" || v.status === "ready"),
          blocked: by((v) => v.status === "needs_review"),
          ready_to_approve: by((v) => v.status === "ready"),
          approved: by((v) => v.status === "approved"),
          in_erp: by((v) => v.status === "pushed"),
          failed_reads: by((v) => v.status === "failed"),
          failed_pushes: by((v) => v.status === "approved" && v.failure?.stage === "push"),
          suggested_matches_to_confirm: by((v) => v.draft.postTo === "order" && !v.draft.poConfirmed && v.status !== "pushed"),
          push_target: target?.label ?? "none (Excel/CSV only)",
          ai_reading: ctx.aiAvailable ? { used_last_24h: await aiReadingsSince(ctx.orgKey, new Date(Date.now() - 86_400_000).toISOString()), daily_cap: invoices.aiDailyLimit() } : "off",
        },
      };
    }
    case "list_invoices": {
      const scope = TAB[s("status") || "all"] ?? "all";
      const q = s("search").toLowerCase();
      const rows = (await invoices.listViews(ctx.orgKey))
        .filter((v) => invoices.inScope(v, scope))
        .filter((v) => !q || [v.draft.invoiceNumber, v.draft.supplierName, v.draft.vendorName, v.fileName].some((x) => x?.toLowerCase().includes(q)))
        .map(row);
      return { summary: `Listed ${rows.length} invoice${rows.length === 1 ? "" : "s"}`, result: { count: rows.length, invoices: rows.slice(0, 100), truncated: rows.length > 100 } };
    }
    case "get_invoice": {
      const c = await findInvoice(ctx.orgKey, s("invoice"));
      const v = (await invoices.getView(ctx.orgKey, c.id))!;
      return { summary: `Opened ${v.draft.invoiceNumber || v.fileName}`, result: detail(v) };
    }
    case "download_link": {
      const format = s("format") === "csv" ? "" : "&format=xlsx";
      if (refs.length) {
        const ids = await Promise.all(refs.map(async (r) => (await findInvoice(ctx.orgKey, r)).id));
        return { summary: "Made a download link", result: { url: `/api/automation/purchase-invoices/export?ids=${ids.join(",")}${format}` } };
      }
      return { summary: "Made a download link", result: { url: `/api/automation/purchase-invoices/export?scope=${TAB[s("status") || "all"] ?? "all"}${format}` } };
    }
    case "link_grn": {
      const v = await linkGrn(ctx.orgKey, s("invoice"), s("grn"));
      return { changed: true, summary: `Linked GRN ${s("grn")} to ${v.draft.invoiceNumber}`, result: row(v) };
    }
    case "link_po": {
      const v = await linkPo(ctx.orgKey, s("invoice"), s("po"));
      return { changed: true, summary: `Linked ${s("po")} to ${v.draft.invoiceNumber}`, result: row(v) };
    }
    case "match_again": {
      const v = await matchAgain(ctx.orgKey, s("invoice"));
      return { changed: true, summary: `Matched ${v.draft.invoiceNumber} again`, result: row(v) };
    }
    case "code_line": {
      const type = s("type") === "account" ? "account" : "item";
      const v = await codeLine(ctx.orgKey, s("invoice"), Number(input.line), type, s("number"));
      return { changed: true, summary: `Set line ${input.line} of ${v.draft.invoiceNumber} to ${s("number")}`, result: row(v) };
    }
    case "set_post_to": {
      const v = await setPostTo(ctx.orgKey, s("invoice"), s("post_to") === "order" ? "order" : "invoice");
      return { changed: true, summary: `${v.draft.invoiceNumber} posts ${s("post_to") === "order" ? "against its PO" : "as a standalone invoice"}`, result: row(v) };
    }
    case "propose_action": {
      const kind = s("action") as ActionKind;
      if (kind === "read_with_ai" && !ctx.aiAvailable) return { summary: "AI reading is off", result: { error: "AI reading isn't on for this workspace." } };
      const proposal = await propose(ctx.orgKey, ctx.userId, kind, refs);
      return {
        proposal,
        summary: `Asked you to confirm: ${proposal.title}`,
        result: { status: "waiting for the user to click Confirm on the card", action: proposal.title, invoices: proposal.invoices.map((i) => i.label) },
      };
    }
    default:
      return { summary: `Unknown tool ${name}`, result: { error: `There's no tool called ${name}.` } };
  }
}
