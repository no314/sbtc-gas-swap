import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static build (architecture ladder rung 1). No backend of its own, no runtime CDN:
// React, the vendored known-good @stacks/connect and @stacks/transactions bundles in
// src/vendor/, the SDK (file:../sdk), Phosphor icons and the self-hosted fonts are
// all pinned and bundled into dist/ at build time. Two entries: the app and the
// disclaimer page, which shares the design tokens.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    target: "es2020",
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: {
        main: "index.html",
        disclaimer: "disclaimer.html",
        deploy: "deploy.html"
      }
    }
  }
});
