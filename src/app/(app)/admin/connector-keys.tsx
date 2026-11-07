"use client";

import { useState, useTransition } from "react";
import { rewrapConnectorSecrets } from "@/app/actions/admin";
import { buttonClass } from "@/components/ui";
import type { KeyringStatus } from "@/lib/connectors/keyring";

// Connector master keys (D-40): which key each stored connection secret is sealed under, and
// re-wrapping them under the active key after a rotation. Key material never reaches the browser.
export function ConnectorKeys({ status }: { status: KeyringStatus }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string>();
  const total = status.byKey.reduce((n, k) => n + k.secrets, 0);

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      {!status.activeKeyId ? (
        <p className="text-sm text-muted">
          No connector key is set, so connections are off. Set <code>SAWWI_CONNECTOR_KEYS</code> (see docs/DEPLOY.md).
        </p>
      ) : (
        <>
          <p className="text-sm">
            Active key: <span className="font-medium">{status.activeKeyId}</span> · {total.toLocaleString("en-US")} stored connection
            secret{total === 1 ? "" : "s"}
          </p>
          {status.byKey.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-sm text-muted">
              {status.byKey.map((k) => (
                <li key={k.keyId}>
                  {k.keyId === "v1" ? "Old single-key format" : `Key ${k.keyId}`}: {k.secrets.toLocaleString("en-US")}
                  {k.active ? " (active)" : ""}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={buttonClass("secondary")}
              disabled={pending || status.needRewrap === 0}
              onClick={() =>
                start(async () => {
                  const r = await rewrapConnectorSecrets();
                  setNote(`Re-encrypted ${r.rewrapped}${r.failed ? `; ${r.failed} couldn't be opened with any key on this server` : ""}.`);
                })
              }
            >
              {pending ? "Re-encrypting…" : `Re-encrypt ${status.needRewrap.toLocaleString("en-US")} under ${status.activeKeyId}`}
            </button>
            {note && <p className="text-sm text-muted">{note}</p>}
          </div>
          <p className="mt-3 max-w-xl text-xs text-muted">
            To rotate: put a new key first in <code>SAWWI_CONNECTOR_KEYS</code>, keep the old one after it, redeploy, re-encrypt here, then
            remove the old key once it shows no secrets.
          </p>
        </>
      )}
    </div>
  );
}
