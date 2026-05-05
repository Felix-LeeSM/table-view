import React from "react";
import ReactDOM from "react-dom/client";
import AppRouter from "./AppRouter";
import { bootTheme } from "@lib/themeBoot";
import { bootWindowLifecycle } from "@lib/window-lifecycle-boot";
import { initSession } from "@lib/session-storage";
import { getCurrentWindowLabel } from "@lib/window-label";
import {
  markBootMilestone,
  markT0,
  scheduleBootSummary,
} from "@lib/perf/bootInstrumentation";
import { logger } from "@lib/logger";
import "./index.css";

// Boot sequence: theme → session → hydrate stores → render.
// Each step depends on the previous one, so we await in order.
async function boot() {
  // Set `document.title` synchronously *before* React mounts. `AppRouter`'s
  // useEffect also sets it, but useEffect runs after first paint, and on
  // Xvfb cold-boot React's first paint can take 10+ seconds. webdriver's
  // `getTitle()` reads `document.title`, so without this the e2e helper
  // `switchToWorkspaceWindow` (which polls getTitle to identify which
  // window it landed on) wastes those 10s matching the stale default
  // "Table View" on the workspace handle.
  const label = getCurrentWindowLabel();
  document.title =
    label === "workspace" ? "Table View — Workspace" : "Table View";

  // Boot-time instrumentation T0 anchor. Recorded *after* the
  // synchronous `document.title` assignment but *before* any other boot
  // work, so every later milestone delta is measured from the same point.
  markT0();

  bootTheme();
  markBootMilestone("theme:applied");

  // Session-scoped localStorage: fetch the process UUID from Rust so both
  // windows can tag their localStorage entries with the same session ID.
  await initSession();
  markBootMilestone("session:initialized");

  // Hydrate connection state from session-scoped localStorage so the
  // workspace has correct focusedConnId + activeStatuses on first render.
  const { useConnectionStore } = await import("@stores/connectionStore");
  markBootMilestone("connectionStore:imported");
  useConnectionStore.getState().hydrateFromSession();
  markBootMilestone("connectionStore:hydrated");

  // Register the launcher's `tauri://close-requested` listener.
  // Fire-and-forget: if it rejects the app still works via system-tray / Cmd+Q.
  void bootWindowLifecycle().catch((e) => {
    logger.warn(
      "[main] bootWindowLifecycle failed:",
      e instanceof Error ? e.message : e,
    );
  });

  markBootMilestone("react:render-called");
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <AppRouter />
    </React.StrictMode>,
  );

  // Schedule the structured one-line boot summary. Two paths race; first
  // wins, the other is a no-op (idempotent in `logBootSummary`):
  //
  //   1. Auto-trigger from `markBootMilestone("app:effects-fired")` — the
  //      terminal milestone fired from `App.tsx` / `LauncherShell`
  //      mount-effect, AFTER React commits and runs `useLayoutEffect` /
  //      `useEffect`. Happy path.
  //   2. 5s fallback timeout from `scheduleBootSummary` — guarantees the
  //      summary still prints if the mount-effect chain breaks (with
  //      `<missing>` markers for whatever didn't fire).
  //
  // Synchronous logging here would always mark `react:first-paint` and
  // `app:effects-fired` as `<missing>` because they run AFTER `render()`
  // returns.
  scheduleBootSummary();
}

boot().catch((e) => {
  logger.error("[main] boot failed:", e);
});
