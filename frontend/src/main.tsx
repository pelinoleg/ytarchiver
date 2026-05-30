import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ConfirmProvider } from "./components/ConfirmProvider";
import { SelectionProvider } from "./components/SelectionProvider";
import { MiniPlayerProvider } from "./components/MiniPlayerProvider";
import "@fontsource-variable/plus-jakarta-sans";
import "./index.css";
import { applyStoredAccent } from "./lib/accents";
import { applyStoredBackground } from "./lib/backgrounds";

// Apply saved accent + background before first paint so there's no flash.
applyStoredAccent();
applyStoredBackground();

const qc = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <ConfirmProvider>
          <SelectionProvider>
            <MiniPlayerProvider>
              <App />
            </MiniPlayerProvider>
          </SelectionProvider>
        </ConfirmProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);

// Service worker — registered in production builds only. In dev we use
// Vite's HMR which doesn't play well with a cache-first SW (you'd get
// stale modules across refreshes). Skipped on hostnames where SW can't
// run (e.g. file://).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch((err) => console.warn("SW registration failed:", err));
  });
}
