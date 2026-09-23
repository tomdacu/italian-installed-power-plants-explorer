import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import pkg from "./package.json" with { type: "json" };

// __APP_VERSION__ is inlined from package.json. VITE_* variables are handled
// natively by Vite (.env files). The interface is served by the local server
// itself, so no API URL needs to be baked in (see src/api/client.ts).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    // In sviluppo il server locale (`bun run serve`) espone API e dati: il dev
    // server gli gira davanti, così il frontend usa percorsi relativi in ogni
    // modalità e non serve nessuna variabile d'ambiente per la base URL.
    //
    // `changeOrigin` rewrites the `Host` header to the target, so the local
    // server's host guard sees its own address instead of `localhost:1420`.
    // Mutating requests still carry `Origin: http://localhost:1420` from the
    // browser: run the API with `ICE_DEV_ORIGIN=http://localhost:1420` to have
    // that single loopback origin accepted (see `server/http.ts`).
    proxy: Object.fromEntries(
      ["/health", "/records", "/analytics", "/metadata", "/settings", "/sync", "/export"].map((path) => [
        path,
        { target: process.env.VITE_API_PROXY ?? "http://127.0.0.1:8799", changeOrigin: true },
      ]),
    ),
  },
  build: {
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-charts": ["recharts"],
          "vendor-query": ["@tanstack/react-query"],
        },
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  clearScreen: false,
});
