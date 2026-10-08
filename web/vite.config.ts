import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 产物路径由 CAPSA_STATIC_DIR 决定：本机默认 ../internal/server/static，Dockerfile 传入容器内路径。
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: process.env.CAPSA_STATIC_DIR ?? "../internal/server/static",
    emptyOutDir: true,
  },
  server: {
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
});
