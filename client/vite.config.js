import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

/** Dev local: /api → producción (override: VITE_DEV_API_PROXY=https://tu-dominio.com) */
const devApiProxyTarget =
  process.env.VITE_DEV_API_PROXY || "http://localhost:4000";

export default defineConfig({
  plugins: [svelte()],
  server: {
    proxy: {
      "/api": { target: devApiProxyTarget, changeOrigin: true }
    }
  }
});
