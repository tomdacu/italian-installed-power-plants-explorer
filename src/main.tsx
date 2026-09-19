import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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

// Service worker: rende l'app installabile come PWA e accelera l'avvio.
// Solo in produzione (in sviluppo romperebbe l'hot reload).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}

// La SPA è servita dal server locale che espone anche l'API: nessun bootstrap
// necessario, le richieste sono relative alla stessa origine (vedi apiBase()).
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
