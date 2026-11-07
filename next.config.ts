import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // pdf.js loads its worker module at runtime from its own folder, tesseract.js runs its WASM in a
  // worker thread and the OCR language packs are read from disk (D-21, D-24): keep them out of the server bundle.
  // PGlite (local Postgres, D-37) loads its WASM and data files from its own folder too; \`pg\` is external by default.
  serverExternalPackages: ["pdfjs-dist", "tesseract.js", "@tesseract.js-data/eng", "@tesseract.js-data/ara", "@electric-sql/pglite"],
  partialPrefetching: true,
  // Bottom-left would cover the account menu in the sidebar.
  devIndicators: { position: "bottom-right" },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
