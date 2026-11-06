import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // pdf.js loads its worker module at runtime from its own folder; keep it out of the server bundle.
  serverExternalPackages: ["pdfjs-dist"],
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
