import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Build into ../public so the Express server serves the SPA as static files.
// Dev proxies API routes to the running Express server on :8080.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: "../public", emptyOutDir: true },
  server: {
    proxy: {
      "/route": "http://localhost:8080",
      "/chain": "http://localhost:8080",
      "/verify": "http://localhost:8080",
      "/healthz": "http://localhost:8080",
    },
  },
});
