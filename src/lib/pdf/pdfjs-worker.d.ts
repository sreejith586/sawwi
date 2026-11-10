// pdfjs-dist ships no types for its worker module; read.ts only hands it back to pdf.js (globalThis.pdfjsWorker).
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
