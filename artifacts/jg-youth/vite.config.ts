import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Resolve workspace packages directly from source — no npm workspace needed
      "@workspace/api-client-react": path.resolve(__dirname, "../../lib/api-client-react/src/index.ts"),
      "@workspace/api-zod": path.resolve(__dirname, "../../lib/api-zod/src/index.ts"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    host: "0.0.0.0",
    // Mirror the production vercel.json rewrite so `npm run dev` talks to the
    // real backend. Without this, relative /api/* requests fall through to
    // Vite's SPA fallback, which answers with index.html and crashes the
    // dashboard panels on the unexpected HTML payload.
    proxy: {
      "/api": {
        target: "https://youth-connect-y1zi.onrender.com",
        changeOrigin: true,
      },
    },
  },
});
