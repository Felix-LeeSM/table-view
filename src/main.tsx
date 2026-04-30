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
import "./index.css";

// Boot sequence: theme → session → hydrate stores → render.
// Each step depends on the previous one, so we await in order.
async function boot() {
  // sprint-173 — set document.title synchronously *before* React mounts.
  // `AppRouter`'s useEffect also sets it, but useEffect runs after first
  // paint, and on Xvfb cold-boot React's first paint can take 10+ seconds.
  // webdriver's `getTitle()` reads `document.title`, so without this the
  // e2e helper `switchToWorkspaceWindow` (which polls getTitle to identify
  // which window it landed on) wastes those 10s matching the stale HTML
  // default "Table View" on the workspace handle.
  const label = getCurrentWindowLabel();
  document.title =
    label === "workspace" ? "Table View — Workspace" : "Table View";

  // sprint-175 — boot-time instrumentation T0 anchor. Recorded *after* the
  // synchronous `document.title` assignment (Sprint 173 invariant) but
  // *before* any other boot work, so every later milestone delta is
  // measured from the same point.
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

  // Sprint 154 — register the launcher's `tauri://close-requested` listener.
  // Fire-and-forget: if it rejects the app still works via system-tray / Cmd+Q.
  void bootWindowLifecycle().catch((e) => {
    console.warn(
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

  // sprint-175 — schedule the structured one-line boot summary. Two paths
  // race; first one wins, the other is a no-op (idempotent in
  // `logBootSummary`):
  //
  //   1. Auto-trigger from `markBootMilestone("app:effects-fired")` — the
  //      terminal milestone fired from `App.tsx` / `LauncherShell` mount-
  //      effect, AFTER React commits and runs `useLayoutEffect` /
  //      `useEffect`. Happy path.
  //   2. 5s fallback timeout from `scheduleBootSummary` — guarantees the
  //      summary still prints if the mount-effect chain breaks (with
  //      `<missing>` markers for whatever didn't fire).
  //
  // Why not log here synchronously? `react:first-paint` (useLayoutEffect)
  // and `app:effects-fired` (useEffect) run AFTER `render()` returns, so
  // a synchronous call would always render those two as `<missing>`.
  scheduleBootSummary();
}

boot().catch((e) => {
  console.error("[main] boot failed:", e);
});
