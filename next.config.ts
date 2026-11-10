import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // pdf.js loads its worker module at runtime from its own folder, tesseract.js runs its WASM in a
  // worker thread and the OCR language packs are read from disk (D-21, D-24): keep them out of the server bundle.
  // PGlite (local Postgres, D-37) loads its WASM and data files from its own folder too; \`pg\` is external by default.
  serverExternalPackages: ["pdfjs-dist", "tesseract.js", "@tesseract.js-data/eng", "@tesseract.js-data/ara", "@electric-sql/pglite"],
  // The OCR worker thread (D-24) loads its code, the tesseract core and the language data from paths
  // the file tracer can't follow, so none of it reached Vercel and every scanned PDF failed (D-79).
  // The cores as .js + .wasm (not the base64 .wasm.js copies; tesseract picks the variant at runtime) and the
  // 4.0.0_best_int language files that ocr.ts reads.
  outputFileTracingIncludes: {
    "/**": [
      // tesseract.js and its dependencies, through pnpm's folder for it so the symlinks it resolves through come too.
      "./node_modules/.pnpm/tesseract.js@*/node_modules/tesseract.js/src/**/*.js",
      "./node_modules/.pnpm/tesseract.js@*/node_modules/tesseract.js-core/{package.json,index.js,tesseract-core{,-lstm,-simd,-simd-lstm,-relaxedsimd,-relaxedsimd-lstm}.{js,wasm}}",
      "./node_modules/.pnpm/tesseract.js@*/node_modules/{wasm-feature-detect,zlibjs,bmp-js,regenerator-runtime}/**/*.{js,cjs,json}",
      "./node_modules/@tesseract.js-data/{eng,ara}/4.0.0_best_int/*.traineddata.gz",
    ],
  },
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
