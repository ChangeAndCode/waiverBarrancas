import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

/** Dev local: /api → producción (override: VITE_DEV_API_PROXY=https://tu-dominio.com) */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL(".", import.meta.url)), "VITE_");
  const devApiProxyTarget =
    env.VITE_DEV_API_PROXY || "https://waiverbarrancas.com";

  return {
    plugins: [svelte()],
    server: {
      proxy: {
        "/api": { target: devApiProxyTarget, changeOrigin: true }
      }
    }
  };
});
