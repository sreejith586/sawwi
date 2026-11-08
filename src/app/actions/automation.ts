"use server";

import { refresh } from "next/cache";
import { ConnectorError } from "@/lib/connectors/types";
import { isDemoOrg } from "@/lib/demo/demo";
import { getProfile } from "@/lib/profile/session";
import { canRun, getCurrentSession, runBlocker } from "@/lib/saas/session";
import { sanitizeDraft } from "@/lib/automation/purchase-invoices/draft";
import * as service from "@/lib/automation/purchase-invoices/service";

// Purchase invoice capture (D-60–D-66). New work (capture, approve, push) goes through
// runBlocker() like a reconciliation (role, plan, trial). Viewers can look but change nothing.

type Fail = { error: string };

async function editor(): Promise<{ orgKey: string; userId: string } | Fail> {
  const blocked = await runBlocker();
  if (blocked) return { error: blocked.message };
  const session = (await getCurrentSession())!;
  return { orgKey: session.org.key, userId: session.user.id };
}

const message = (error: unknown) => (error instanceof service.CaptureError || error instanceof ConnectorError ? error.message : "Something went wrong. Try again.");

/** The demo store's sample invoices, in place of uploads (the live demo takes none). */
export async function captureSampleAction(sampleId: string): Promise<{ id?: string; existing?: boolean } & Partial<Fail>> {
  const who = await editor();
  if ("error" in who) return who;
  if (!isDemoOrg(who.orgKey)) return { error: "Samples are for the demo store. Upload your own invoices here." };
  try {
    const { capture, existing } = await service.captureSample(who.orgKey, who.userId, sampleId, { countries: (await getProfile())?.countries });
    refresh();
    return { id: capture.id, existing };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function saveDraftAction(id: string, input: unknown): Promise<{ view?: service.CaptureView } & Partial<Fail>> {
  const session = await getCurrentSession();
  if (!session || !canRun(session.access)) return { error: "Viewers can't change invoices." };
  const draft = sanitizeDraft(input);
  if (!draft) return { error: "That draft couldn't be read." };
  try {
    return { view: await service.saveEdits(session.org.key, id, draft) };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function approveAction(ids: string[]): Promise<{ results?: service.BulkResult[] } & Partial<Fail>> {
  const who = await editor();
  if ("error" in who) return who;
  if (!Array.isArray(ids) || ids.some((i) => typeof i !== "string")) return { error: "Pick invoices to approve." };
  const results = await service.approveMany(who.orgKey, ids, who.userId);
  refresh();
  return { results };
}

export async function unapproveAction(id: string): Promise<Partial<Fail>> {
  const session = await getCurrentSession();
  if (!session || !canRun(session.access)) return { error: "Viewers can't change invoices." };
  await service.unapprove(session.org.key, id);
  refresh();
  return {};
}

/** Pushes the drafts the user confirmed; each hash is the content the confirmation showed (D-64). */
export async function pushAction(items: { id: string; hash: string }[]): Promise<{ results?: service.BulkResult[] } & Partial<Fail>> {
  const who = await editor();
  if ("error" in who) return who;
  if (!Array.isArray(items) || items.some((i) => typeof i?.id !== "string" || typeof i?.hash !== "string")) return { error: "Nothing to push." };
  try {
    const results = await service.pushMany(who.orgKey, items, who.userId);
    refresh();
    return { results };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function setTargetAction(connectionId: string | null): Promise<Partial<Fail>> {
  const session = await getCurrentSession();
  if (!session || !canRun(session.access)) return { error: "Viewers can't change this." };
  try {
    await service.chooseTarget(session.org.key, connectionId);
    if (connectionId) await service.rematch(session.org.key).catch(() => 0);
    refresh();
    return {};
  } catch (error) {
    return { error: message(error) };
  }
}

/** Reads vendors, items and accounts again and re-matches drafts not approved yet (D-62). */
export async function refreshErpAction(): Promise<{ changed?: number } & Partial<Fail>> {
  const session = await getCurrentSession();
  if (!session || !canRun(session.access)) return { error: "Viewers can't change this." };
  try {
    const changed = await service.rematch(session.org.key);
    refresh();
    return { changed };
  } catch (error) {
    return { error: message(error) };
  }
}

/** Purchase invoices already in the ERP for this vendor and number (D-63), shown when a draft opens. */
export async function erpDuplicatesAction(id: string): Promise<{ refs?: { number: string; status: string }[] } & Partial<Fail>> {
  const session = await getCurrentSession();
  if (!session) return { error: "Log in again." };
  const view = await service.getView(session.org.key, id);
  if (!view || view.status === "pushed") return { refs: [] };
  try {
    return { refs: (await service.erpDuplicates(session.org.key, view.draft)).map(({ number, status }) => ({ number, status })) };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function discardAction(id: string): Promise<Partial<Fail>> {
  const session = await getCurrentSession();
  if (!session || !canRun(session.access)) return { error: "Viewers can't delete invoices." };
  if (!(await service.discard(session.org.key, id))) return { error: "That invoice can't be deleted now." };
  refresh();
  return {};
}
