import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

import App from "./App";
import { ThemeProvider } from "@/context/ThemeContext";
import { ToastProvider } from "@/components/ui/Toast";
import "@fontsource-variable/inter";
import "@fontsource-variable/sora";
import "@fontsource-variable/jetbrains-mono";
import "./styles/globals.css";

declare global {
  interface Window {
    __TERNA_API_BASE__?: string;
    __TAURI_INTERNALS__?: unknown;
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

const isTauri = () => "__TAURI_INTERNALS__" in window;

async function bootstrap() {
  // Inside the packaged app the Rust shell picks a free port for the local
  // backend; resolve it before the SPA issues any requests. In the browser
  // (plain `npm run dev`) we fall back to VITE_API_BASE_URL.
  if (isTauri()) {
    try {
      const port = await invoke<number | null>("backend_port");
      if (port) {
        window.__TERNA_API_BASE__ = `http://127.0.0.1:${port}`;
      }
    } catch (e) {
      console.warn("Could not resolve backend port, using the default.", e);
    }
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <ToastProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </ToastProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

void bootstrap();
