import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

// The Midnight SDK ships wasm and expects a Node-ish global environment, so the
// browser build needs the wasm plugin, top-level await, and a Buffer/process
// shim. Without these the bundle either fails to build or dies at runtime with
// "Buffer is not defined".
export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
  define: {
    // NB: process.env is deliberately NOT defined here. `define` does not reach
    // inside pre-bundled dependencies, so the shim in src/env-shim.js sets it on
    // the real global instead — and a define here would shadow that.
    global: "globalThis",
  },
  resolve: {
    alias: { buffer: "buffer/" },
  },
  optimizeDeps: {
    // Pre-bundling mangles the wasm imports; let Vite serve these as-is.
    exclude: [
      "@midnight-ntwrk/onchain-runtime-v3",
      "@midnight-ntwrk/ledger-v8",
      "@midnight-ntwrk/compact-runtime",
      "@midnight-ntwrk/midnight-js-protocol",
    ],
    // Excluding the packages above also skips their CommonJS dependencies, which
    // then reach the browser un-converted ("does not provide an export named
    // 'default'"). Naming them here makes Vite pre-bundle them into ESM.
    include: ["buffer", "semver", "object-inspect"],
  },
  server: { port: 5180 },
  build: { target: "esnext" },
});
