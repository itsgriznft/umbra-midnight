import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Standard Vite + React setup. For a real Preprod build you will also want the
// Node polyfills the Midnight SDK expects (Buffer/process) — see src/globals.ts.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // GitHub Pages serves the demo from /umbra-midnight/, so assets need that
  // prefix there; every other build stays at the root. Keyed off the Vite mode
  // rather than an env var so the config stays typeable without @types/node.
  base: mode === "pages" ? "/umbra-midnight/" : "/",
  server: { port: 5173 },
  build: { target: "es2022", outDir: "dist" },
}));
