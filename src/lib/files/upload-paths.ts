// Upload rules shared by the browser and the server (no Node imports here).

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_FILES_PER_SLOT = 50;
export const SUPPORTED_EXTENSIONS = [".csv", ".tsv", ".txt", ".xlsx", ".pdf"];

const CONTENT_TYPES: Record<string, string> = {
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".txt": "text/plain",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pdf": "application/pdf",
};
export const UPLOAD_CONTENT_TYPES = Object.values(CONTENT_TYPES);

/** The supported extension of a file name, or undefined. */
export function uploadExtension(fileName: string): string | undefined {
  const lower = fileName.toLowerCase();
  return SUPPORTED_EXTENSIONS.find((ext) => lower.endsWith(ext));
}

export const uploadContentType = (fileName: string) => CONTENT_TYPES[uploadExtension(fileName) ?? ""] ?? "application/octet-stream";

/**
 * Where a browser upload goes in the private Blob store before it's parsed (D-39). The original
 * file name travels separately: it can hold any characters, the path can't.
 */
export const incomingPath = (runId: string, slotKey: string, index: number, fileName: string) =>
  `incoming/${runId}/${slotKey}/${index}${uploadExtension(fileName) ?? ".bin"}`;
