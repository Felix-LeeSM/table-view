import React from "react";
import ReactDOM from "react-dom/client";
import AppRouter from "./AppRouter";
import { bootTheme } from "@lib/themeBoot";
import { bootWindowLifecycle } from "@lib/window-lifecycle-boot";
import "./index.css";

bootTheme();

// Sprint 154 — register the launcher's `tauri://close-requested` listener so
// closing the launcher window tears down the entire app (workspace process
// included). The helper is a no-op when the current window is the workspace.
// We intentionally don't `await` it so the React render isn't blocked by a
// Tauri IPC call; if the registration ever rejects, the user's existing
// system-tray / Cmd+Q paths still work.
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
