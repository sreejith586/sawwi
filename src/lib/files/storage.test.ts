import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// An in-memory stand-in for the private Blob store: tests never call Vercel.
const blobs = new Map<string, Uint8Array>();
const calls: { op: string; args: unknown[] }[] = [];
vi.mock("@vercel/blob", () => {
  class BlobNotFoundError extends Error {}
  const bytes = (b: unknown) => (typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b as Buffer));
  return {
    BlobNotFoundError,
    put: async (key: string, body: unknown, opts: unknown) => {
      calls.push({ op: "put", args: [key, opts] });
      blobs.set(key, bytes(body));
      return { pathname: key };
    },
    get: async (key: string, opts: unknown) => {
      calls.push({ op: "get", args: [key, opts] });
      const b = blobs.get(key);
      return b ? { statusCode: 200, stream: new Response(new Uint8Array(b)).body } : null;
    },
    head: async (key: string) => {
      const b = blobs.get(key);
      if (!b) throw new BlobNotFoundError();
      return { size: b.byteLength };
    },
    del: async (keys: string[]) => {
      calls.push({ op: "del", args: [keys] });
      for (const k of keys) blobs.delete(k.replace("https://store.example/", ""));
    },
    list: async ({ prefix }: { prefix: string }) => ({
      blobs: [...blobs.keys()].filter((k) => k.startsWith(prefix)).map((k) => ({ url: `https://store.example/${k}`, pathname: k })),
      hasMore: false,
    }),
  };
});

const { deleteFiles, deletePrefixes, fileKeys, fileSize, putFile, readStoredFile, readText } = await import("./storage");
const { discardIncoming, IncomingError, readIncoming } = await import("./incoming");
const { incomingPath } = await import("./upload-paths");

const env = process.env as Record<string, string | undefined>;
let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sawwi-files-"));
  env.SAWWI_DATA_DIR = dir;
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => {
  delete env.BLOB_READ_WRITE_TOKEN;
  delete env.VERCEL;
  blobs.clear();
  calls.length = 0;
});

describe.each([
  ["local disk", () => undefined],
  ["private Blob store", () => (env.BLOB_READ_WRITE_TOKEN = "test-token")],
])("file store on %s (D-39)", (_, setup) => {
  it("writes, reads, sizes and deletes a run's files", async () => {
    setup();
    const key = fileKeys.table("run-1", "orders");
    await putFile(key, "a,b\n1,2\n");
    expect(await readText(key)).toBe("a,b\n1,2\n");
    expect(await fileSize(key)).toBe(8);
    await putFile(key, "a\n9\n"); // replacing a slot's file overwrites it
    expect(await readText(key)).toBe("a\n9\n");
    await putFile("incoming/run-1/orders/0.csv", new Uint8Array([1, 2]));
    await putFile(fileKeys.table("run-2", "orders"), "x\n");

    await deletePrefixes(fileKeys.runPrefixes("run-1"));
    expect(await readStoredFile(key)).toBeUndefined();
    expect(await fileSize("incoming/run-1/orders/0.csv")).toBeUndefined();
    expect(await readText(fileKeys.table("run-2", "orders"))).toBe("x\n"); // other runs untouched
    await deleteFiles([fileKeys.table("run-2", "orders")]);
    await expect(readText(fileKeys.table("run-2", "orders"))).rejects.toThrow(/missing/);
  });

  it("refuses keys that could leave the store's folder", async () => {
    setup();
    for (const bad of ["../x.csv", "runs/../../etc/passwd", "/abs.csv", "runs//x.csv", "runs/x\u0000.csv"]) {
      await expect(putFile(bad, "x")).rejects.toThrow(/Invalid file key/);
    }
  });
});

describe("Blob specifics", () => {
  it("stores privately and reads uncached", async () => {
    env.BLOB_READ_WRITE_TOKEN = "test-token";
    await putFile("runs/r/s.csv", "a\n");
    await readText("runs/r/s.csv");
    expect(calls.find((c) => c.op === "put")?.args[1]).toMatchObject({ access: "private", addRandomSuffix: false, allowOverwrite: true, token: "test-token" });
    expect(calls.find((c) => c.op === "get")?.args[1]).toMatchObject({ access: "private", useCache: false });
  });

  it("takes the token under the integration's SAWWI prefix too", async () => {
    env.SAWWI_BLOB_READ_WRITE_TOKEN = "prefixed-token";
    try {
      await putFile("runs/r/s.csv", "a\n");
      expect(calls.find((c) => c.op === "put")?.args[1]).toMatchObject({ token: "prefixed-token" });
    } finally {
      delete env.SAWWI_BLOB_READ_WRITE_TOKEN;
    }
  });

  it("won't fall back to a disk that disappears on Vercel", async () => {
    env.VERCEL = "1";
    await expect(putFile("runs/r/s.csv", "a\n")).rejects.toThrow(/BLOB_READ_WRITE_TOKEN/);
    // Deleting nothing needs no store: the demo reset with no runs mustn't fail (seen on a preview).
    await expect(deletePrefixes([])).resolves.toBeUndefined();
    await expect(deleteFiles([])).resolves.toBeUndefined();
  });
});

describe("browser uploads waiting in the store", () => {
  it("reads only this run's slot, within the limits, and discards only those", async () => {
    env.BLOB_READ_WRITE_TOKEN = "test-token";
    const mine = `${incomingPath("run-1", "orders", 0, "Oct.CSV")}`.replace(".csv", "-Ab12.csv");
    expect(mine).toBe("incoming/run-1/orders/0-Ab12.csv");
    await putFile(mine, "a,b\n");
    await putFile("incoming/run-2/orders/0.csv", "secret\n");

    const files = await readIncoming("run-1", "orders", [{ pathname: mine, name: "Oct.CSV" }]);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("Oct.CSV");
    expect(new TextDecoder().decode(files[0].data)).toBe("a,b\n");

    await expect(readIncoming("run-1", "orders", [{ pathname: "incoming/run-2/orders/0.csv", name: "x.csv" }])).rejects.toThrow(IncomingError);
    await expect(readIncoming("run-1", "orders", [{ pathname: "incoming/run-1/refunds/0.csv", name: "x.csv" }])).rejects.toThrow(/doesn't belong/);
    await expect(readIncoming("run-1", "orders", [{ pathname: "incoming/run-1/orders/9.csv", name: "x.csv" }])).rejects.toThrow(/didn't arrive/);
    await expect(readIncoming("run-1", "orders", [])).rejects.toThrow(/Choose a file/);

    await discardIncoming("run-1", "orders", [{ pathname: mine }, { pathname: "incoming/run-2/orders/0.csv" }]);
    expect(await fileSize(mine)).toBeUndefined();
    expect(await fileSize("incoming/run-2/orders/0.csv")).toBe(7); // another run's upload is never touched
  });

  it("refuses uploads over 25 MB in total", async () => {
    env.BLOB_READ_WRITE_TOKEN = "test-token";
    const big = new Uint8Array(13 * 1024 * 1024);
    await putFile("incoming/run-1/orders/0.csv", big);
    await putFile("incoming/run-1/orders/1.csv", big);
    await expect(
      readIncoming("run-1", "orders", [
        { pathname: "incoming/run-1/orders/0.csv", name: "a.csv" },
        { pathname: "incoming/run-1/orders/1.csv", name: "b.csv" },
      ]),
    ).rejects.toThrow(/over 25 MB/);
  });
});
