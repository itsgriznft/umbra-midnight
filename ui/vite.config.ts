import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Standard Vite + React setup. For a real Preprod build you will also want the
// Node polyfills the Midnight SDK expects (Buffer/process) — see src/globals.ts.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: { target: "es2022", outDir: "dist" },
});
