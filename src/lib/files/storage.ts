import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "@/lib/db";

// Where files live (D-37, D-39): a private Vercel Blob store when one is connected, a folder under
// .data otherwise. A connected store shows up as BLOB_STORE_ID: the SDK then signs in with the
// deployment's short-lived Vercel OIDC token, with no long-lived secret. A read-write token
// (BLOB_READ_WRITE_TOKEN, or SAWWI_-prefixed) works too, e.g. for scripts outside Vercel.
// Keys are built by the server from run ids and template slot keys, never from user input alone.

/** Keys for a run's files. `incoming/` holds raw browser uploads until they're parsed. */
export const fileKeys = {
  table: (runId: string, slotKey: string) => `runs/${runId}/${slotKey}.csv`,
  incomingPrefix: (runId: string) => `incoming/${runId}/`,
  runPrefixes: (runId: string) => [`runs/${runId}/`, `incoming/${runId}/`],
};

const rwToken = () => process.env.BLOB_READ_WRITE_TOKEN || process.env.SAWWI_BLOB_READ_WRITE_TOKEN || undefined;
const storeId = () => process.env.BLOB_STORE_ID || process.env.SAWWI_BLOB_STORE_ID || undefined;

export const blobEnabled = () => Boolean(rwToken() || storeId());

/** Credentials for every Blob call: the read-write token if there is one, else the store (OIDC). */
export const blobAuth = (): { token?: string; storeId?: string } => {
  const token = rwToken();
  if (token) return { token };
  const id = storeId();
  return id ? { storeId: id } : {};
};

function assertKey(key: string) {
  // A prefix ends with "/"; nothing else may be empty, "." or "..".
  const parts = key.replace(/\/$/, "").split("/");
  if (!/^[\w./ -]+$/.test(key) || parts.some((p) => p === ".." || p === "." || p === "")) {
    throw new Error(`Invalid file key: ${key}`);
  }
}

function onDisk(key: string) {
  assertKey(key);
  return path.join(dataDir(), "files", key);
}

function requireStore() {
  // A deploy without Blob would write to a disk that disappears: refuse, like the database does.
  if (process.env.VERCEL && !blobEnabled()) throw new Error("No Blob store is connected (BLOB_STORE_ID or BLOB_READ_WRITE_TOKEN). Connect a private Blob store to this Vercel project (docs/DEPLOY.md).");
}

export async function putFile(key: string, body: string | Uint8Array, contentType = "text/csv") {
  requireStore();
  assertKey(key);
  if (blobEnabled()) {
    const { put } = await import("@vercel/blob");
    await put(key, typeof body === "string" ? body : Buffer.from(body), { access: "private", contentType, addRandomSuffix: false, allowOverwrite: true, ...blobAuth() });
    return;
  }
  const file = onDisk(key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body);
}

/** The file's bytes, or undefined when there is no such file. */
export async function readStoredFile(key: string): Promise<Uint8Array | undefined> {
  requireStore();
  assertKey(key);
  if (blobEnabled()) {
    const { get } = await import("@vercel/blob");
    // useCache: false, so a replaced file is never read stale.
    const r = await get(key, { access: "private", useCache: false, ...blobAuth() });
    if (!r || r.statusCode !== 200) return undefined;
    return new Uint8Array(await new Response(r.stream).arrayBuffer());
  }
  try {
    return new Uint8Array(await readFile(onDisk(key)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function readText(key: string): Promise<string> {
  const bytes = await readStoredFile(key);
  if (!bytes) throw new Error(`Stored file is missing: ${key}`);
  return new TextDecoder().decode(bytes);
}

/** Size in bytes, or undefined when there is no such file. */
export async function fileSize(key: string): Promise<number | undefined> {
  requireStore();
  assertKey(key);
  if (blobEnabled()) {
    const { head, BlobNotFoundError } = await import("@vercel/blob");
    try {
      return (await head(key, blobAuth())).size;
    } catch (error) {
      if (error instanceof BlobNotFoundError) return undefined;
      throw error;
    }
  }
  return (await readStoredFile(key))?.byteLength;
}

export async function deleteFiles(keys: string[]) {
  if (keys.length === 0) return;
  requireStore();
  keys.forEach(assertKey);
  if (blobEnabled()) {
    const { del } = await import("@vercel/blob");
    await del(keys, blobAuth());
    return;
  }
  await Promise.all(keys.map((k) => rm(onDisk(k), { force: true })));
}

/** Deletes everything under these prefixes (a run's tables and any unparsed uploads). */
export async function deletePrefixes(prefixes: string[]) {
  if (prefixes.length === 0) return;
  requireStore();
  prefixes.forEach(assertKey);
  if (blobEnabled()) {
    const { list, del } = await import("@vercel/blob");
    for (const prefix of prefixes) {
      let cursor: string | undefined;
      do {
        const page = await list({ prefix, cursor, limit: 1000, ...blobAuth() });
        if (page.blobs.length) await del(page.blobs.map((b) => b.url), blobAuth());
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
    }
    return;
  }
  await Promise.all(prefixes.map((p) => rm(onDisk(p.replace(/\/$/, "")), { recursive: true, force: true })));
}

/** Keys under a prefix last written before `before` (e.g. abandoned raw uploads). */
export async function listOlderThan(prefix: string, before: Date): Promise<string[]> {
  requireStore();
  assertKey(prefix);
  if (blobEnabled()) {
    const { list } = await import("@vercel/blob");
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: 1000, ...blobAuth() });
      for (const b of page.blobs) if (new Date(b.uploadedAt) < before) keys.push(b.pathname);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return keys;
  }
  const root = onDisk(prefix.replace(/\/$/, ""));
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => []);
  const keys: string[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const full = path.join(e.parentPath, e.name);
    if ((await stat(full)).mtime < before) keys.push(path.relative(path.join(dataDir(), "files"), full).split(path.sep).join("/"));
  }
  return keys;
}
