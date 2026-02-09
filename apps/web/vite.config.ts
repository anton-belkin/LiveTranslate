import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Use TS sources directly; the shared package may not be built yet.
      "@livetranslate/shared": fileURLToPath(
        new URL("../../packages/shared/src/index.ts", import.meta.url),
      ),
    },
  },
  build: {
    // Ensure AudioWorklet module is emitted as a real file (not data URL).
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
  },
});

