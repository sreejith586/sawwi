import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.test.ts"],
    // The first database call in a file starts PGlite (Postgres in WASM, D-38) and migrates it,
    // which takes seconds on a busy machine or CI runner.
    testTimeout: 30_000,
  },
});
