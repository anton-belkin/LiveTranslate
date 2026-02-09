import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig(({ command }) => ({
  // For Electron packaged builds we load `index.html` via `file://`.
  // Vite's default `base: "/"` emits `/assets/...` which breaks under `file://`.
  // This keeps asset URLs relative in production builds.
  base: command === "build" ? "./" : "/",
  plugins: [react()],
  resolve: {
    alias: {
      // Use TS sources directly; the shared package may not be built yet.
      "@livetranslate/shared": fileURLToPath(
        new URL("../../packages/shared/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
  },
}));

