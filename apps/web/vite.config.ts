import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const devPort = Number(env.VITE_DEV_PORT) || 5173;

  return {
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
      port: devPort,
    },
  };
});

