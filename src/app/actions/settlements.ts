"use server";

import { refresh } from "next/cache";
import { ConnectorError } from "@/lib/connectors/types";
import { isDemoOrg } from "@/lib/demo/demo";
import { canRun, getCurrentSession, runBlocker } from "@/lib/saas/session";
import * as service from "@/lib/automation/settlements/service";

// Marketplace settlement journals (D-70–D-73). New work (capture, approve, push) goes through
// runBlocker(); edits and settings need edit rights. Viewers look and download only.

type Fail = { error: string };

async function editor(): Promise<{ orgKey: string; userId: string } | Fail> {
  const blocked = await runBlocker();
  if (blocked) return { error: blocked.message };
  const session = (await getCurrentSession())!;
  return { orgKey: session.org.key, userId: session.user.id };
}

async function canEdit(): Promise<string | undefined> {
  const session = await getCurrentSession();
  return session && canRun(session.access) ? session.org.key : undefined;
}

const message = (error: unknown) => (error instanceof service.SettlementError || error instanceof ConnectorError ? error.message : "Something went wrong. Try again.");

export async function captureSettlementSampleAction(sampleId: string): Promise<{ results?: service.CaptureResult[] } & Partial<Fail>> {
  const who = await editor();
  if ("error" in who) return who;
  if (!isDemoOrg(who.orgKey)) return { error: "Samples are for the demo store. Upload your own settlement reports here." };
  try {
    const results = await service.captureSample(who.orgKey, who.userId, sampleId);
    refresh();
    return { results };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function saveSettlementAction(id: string, input: unknown): Promise<Partial<Fail>> {
  const orgKey = await canEdit();
  if (!orgKey) return { error: "Viewers can't change settlements." };
  try {
    await service.saveEdits(orgKey, id, input);
    refresh();
    return {};
  } catch (error) {
    return { error: message(error) };
  }
}

export async function updateSettlementSettingsAction(input: service.SettingsInput): Promise<Partial<Fail>> {
  const orgKey = await canEdit();
  if (!orgKey) return { error: "Viewers can't change this." };
  try {
    await service.updateSettings(orgKey, input);
    refresh();
    return {};
  } catch (error) {
    return { error: message(error) };
  }
}

export async function refreshSettlementErpAction(): Promise<Partial<Fail>> {
  const orgKey = await canEdit();
  if (!orgKey) return { error: "Viewers can't change this." };
  try {
    await service.refreshErp(orgKey);
    refresh();
    return {};
  } catch (error) {
    return { error: message(error) };
  }
}

export async function approveSettlementsAction(ids: string[]): Promise<{ results?: service.BulkResult[] } & Partial<Fail>> {
  const who = await editor();
  if ("error" in who) return who;
  if (!Array.isArray(ids) || ids.some((i) => typeof i !== "string")) return { error: "Pick settlements to approve." };
  const results = await service.approveMany(who.orgKey, ids, who.userId);
  refresh();
  return { results };
}

export async function unapproveSettlementAction(id: string): Promise<Partial<Fail>> {
  const orgKey = await canEdit();
  if (!orgKey) return { error: "Viewers can't change settlements." };
  await service.unapprove(orgKey, id);
  refresh();
  return {};
}

export async function pushSettlementsAction(items: { id: string; hash: string }[]): Promise<{ results?: service.BulkResult[] } & Partial<Fail>> {
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

export async function discardSettlementAction(id: string): Promise<Partial<Fail>> {
  const orgKey = await canEdit();
  if (!orgKey) return { error: "Viewers can't delete settlements." };
  if (!(await service.discard(orgKey, id))) return { error: "That settlement can't be deleted now." };
  refresh();
  return {};
}
