"use server";

import { refresh } from "next/cache";
import { connectorsEnabled } from "@/lib/connectors/crypto";
import { connectorById } from "@/lib/connectors/registry";
import { addConnection } from "@/lib/connectors/service";
import { deleteConnection } from "@/lib/connectors/store";
import { ConnectorError } from "@/lib/connectors/types";
import { canManageTeam, getCurrentSession } from "@/lib/saas/session";

// Connections hold credentials to other systems, so only owners and admins add or
// remove them (D-28). The token is tested, encrypted and never sent back to the browser.

export type ConnectionActionState = { error?: string; added?: string };

export async function addConnectionAction(_prev: ConnectionActionState, form: FormData): Promise<ConnectionActionState> {
  const session = await getCurrentSession();
  if (!session || !canManageTeam(session.access)) return { error: "Only workspace owners and admins can add connections." };
  if (session.org.status === "suspended") return { error: "This workspace is suspended." };
  if (!connectorsEnabled()) return { error: "Connections aren't switched on for this server yet (SAWWI_CONNECTOR_KEY)." };
  const provider = String(form.get("provider") ?? "");
  const connector = connectorById(provider);
  if (!connector) return { error: "Pick a source." };
  const input = Object.fromEntries(connector.fields.map((f) => [f.key, String(form.get(f.key) ?? "")]));
  try {
    const c = await addConnection(session.org.key, provider, input, session.user.id);
    refresh();
    return { added: c.accountLabel };
  } catch (error) {
    if (error instanceof ConnectorError) return { error: error.message };
    return { error: `Couldn't reach ${connector.label}. Check the address and try again.` };
  }
}

export async function removeConnectionAction(id: string) {
  const session = await getCurrentSession();
  if (!session || !canManageTeam(session.access)) return;
  deleteConnection(session.org.key, id);
  refresh();
}
