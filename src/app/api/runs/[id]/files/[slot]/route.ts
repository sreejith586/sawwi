import { readFileSync } from "node:fs";
import Papa from "papaparse";
import { parseNumber } from "@/lib/files/profile";
import { tableWorkbook, xlsxResponse } from "@/lib/excel/sheet";
import { applyQuery, queryFromParams } from "@/lib/recon/table";
import { getOwnedRun } from "@/lib/runs/access";
import { getRunFiles } from "@/lib/runs/store";
import { previewFilterKeys, type PreviewRow } from "@/lib/tables/rows";

const PREVIEW_ROWS = 2000;

/**
 * An uploaded file's rows, typed by its column profile.
 * JSON (default): the first rows, for the in-app preview table.
 * ?format=xlsx: every row, filtered and sorted with the same query the table uses.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/runs/[id]/files/[slot]">) {
  const { id, slot } = await ctx.params;
  const owned = await getOwnedRun(id);
  if (!owned) return Response.json({ error: "Run not found." }, { status: 404 });
  const file = (await getRunFiles(id)).find((f) => f.slotKey === slot);
  if (!file) return Response.json({ error: "No file uploaded for this slot." }, { status: 404 });

  const parsed = Papa.parse<string[]>(readFileSync(file.storedPath, "utf8"), { skipEmptyLines: "greedy" });
  const [headers = [], ...body] = parsed.data;
  const kinds = headers.map((h) => file.profile.columns.find((c) => c.name === h)?.kind ?? "text");
  const toRow = (r: string[], i: number): PreviewRow => {
    const row: PreviewRow = { id: String(i) };
    headers.forEach((_, c) => {
      const v = r[c] ?? "";
      row[`c${c}`] = kinds[c] === "number" ? (parseNumber(v) ?? v) : v;
    });
    return row;
  };

  const params = new URL(request.url).searchParams;
  if (params.get("format") !== "xlsx") {
    return Response.json({ headers, kinds, rows: body.slice(0, PREVIEW_ROWS).map(toRow), total: body.length });
  }

  const keys = previewFilterKeys(headers);
  const rows = applyQuery(body.map(toRow), queryFromParams(params, keys), keys);
  const decimals = (c: number) => rows.some((r) => typeof r[`c${c}`] === "number" && !Number.isInteger(r[`c${c}`]));
  const bytes = await tableWorkbook({
    sheetName: file.fileName,
    columns: headers.map((h, c) => ({ header: h, key: `c${c}`, type: kinds[c] === "number" ? (decimals(c) ? "money" : "number") : "text" })),
    rows,
  });
  return xlsxResponse(bytes, file.fileName.replace(/\.[^.]+$/, ""));
}
