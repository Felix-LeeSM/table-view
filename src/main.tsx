import React from "react";
import ReactDOM from "react-dom/client";
import AppRouter from "./AppRouter";
import { bootTheme } from "@lib/themeBoot";
import { bootWindowLifecycle } from "@lib/window-lifecycle-boot";
import { initSession } from "@lib/session-storage";
import "./index.css";

// Boot sequence: theme → session → hydrate stores → render.
// Each step depends on the previous one, so we await in order.
async function boot() {
  bootTheme();

  // Session-scoped localStorage: fetch the process UUID from Rust so both
  // windows can tag their localStorage entries with the same session ID.
  await initSession();

  // Hydrate connection state from session-scoped localStorage so the
  // workspace has correct focusedConnId + activeStatuses on first render.
  const { useConnectionStore } = await import("@stores/connectionStore");
  useConnectionStore.getState().hydrateFromSession();

  // Sprint 154 — register the launcher's `tauri://close-requested` listener.
  // Fire-and-forget: if it rejects the app still works via system-tray / Cmd+Q.
  void bootWindowLifecycle().catch((e) => {
    console.warn(
      "[main] bootWindowLifecycle failed:",
      e instanceof Error ? e.message : e,
    );
  });

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <AppRouter />
    </React.StrictMode>,
  );
}

boot().catch((e) => {
  console.error("[main] boot failed:", e);
});
