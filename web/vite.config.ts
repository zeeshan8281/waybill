import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Build target:
//   - default → ../public, so the EigenCompute Express server serves the SPA.
//   - on Vercel (VERCEL=1) → dist, served by Vercel with API routes proxied to
//     the backend via vercel.json rewrites.
// Dev proxies API routes to the running Express server on :8080.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: process.env.VERCEL ? "dist" : "../public", emptyOutDir: true },
  server: {
    proxy: {
      "/route": "http://localhost:8080",
      "/chain": "http://localhost:8080",
      "/verify": "http://localhost:8080",
      "/healthz": "http://localhost:8080",
    },
  },
});
