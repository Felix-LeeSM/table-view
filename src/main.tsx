// Issue #1307 — install the global BigInt → decimal-string JSON patch BEFORE
// anything (React/react-dom included) can hit a stringify site with a BigInt.
import "@lib/bigintJson";
import { applyPersistedLocale } from "@lib/i18n";
import { logger } from "@lib/logger";
import {
  markBootMilestone,
  markT0,
  scheduleBootSummary,
} from "@lib/perf/bootInstrumentation";
import { registerSchemaStoreDbMismatchRecovery } from "@lib/runtime/recovery/syncMismatchedActiveDb";
import { registerSettingReceiver } from "@lib/runtime/settings/settingsReceiver";
// CRITICAL (AC-367-03): the listener-register call below MUST precede
// `loadAllFromSnapshot()` in the boot flow.
// `src/lib/runtime/snapshot/loadAll.listener-order.test.ts` scans
// `loadAll.ts`, not this file, for the same pattern.
import {
  loadAllFromSnapshot,
  registerSnapshotListener,
} from "@lib/runtime/snapshot/loadAll";
import { initSession } from "@lib/scopedLocalStorage";
import { importLegacyLocalStorage } from "@lib/tauri/legacyImport";
import { bootTheme, reconcileThemeFromBackend } from "@lib/themeBoot";
import { getCurrentWindowLabel } from "@lib/window-label";
import { bootWindowLifecycle } from "@lib/window-lifecycle-boot";
import { isTauri } from "@tauri-apps/api/core";
import React from "react";
import ReactDOM from "react-dom/client";
import AppRouter from "./AppRouter";
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

  // Two-step theme boot:
  // 1) `bootTheme()` reads only LS, synchronously, and applies the DOM
  //    data-theme/-mode for the first paint at once — the fast path that
  //    avoids FOUC.
  // 2) `reconcileThemeFromBackend()` awaits the SQLite truth
  //    (`get_setting("theme")`) and updates DOM + LS when it differs from LS.
  //    Each Tauri 2 webview has its own localStorage, so the LS of a newly
  //    opened workspace is empty and a slate flash occurs. This reconcile
  //    usually finishes within 10–50ms, so the correct value is in place
  //    before the first React render.
  bootTheme();
  const tauriRuntimeAvailable = isTauri();

  // 2026-05-17 — `meta.legacy_imported` stayed Pending forever: the frontend
  // wrapper existed, but nothing on the boot path called it, so
  // `guard_legacy_import_done` silently rejected every persist_* IPC —
  // SQLite stayed empty and the theme/safeMode/favorites/mru the user
  // clicked were not persisted. An empty payload also counts for the
  // Pending → Done transition (idempotent by design). Called before the
  // reconcile to avoid a race with the first click. The legacy LS scan
  // (favorites/mru/connections) is separate work.
  if (tauriRuntimeAvailable) {
    try {
      await importLegacyLocalStorage({});
    } catch (e) {
      logger.warn(
        "[main] importLegacyLocalStorage failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  if (tauriRuntimeAvailable) {
    await reconcileThemeFromBackend();
  }
  markBootMilestone("theme:applied");

  // i18n: apply the locale persisted in SQLite before the first render — the
  // same place and reason as the theme reconcile (avoids a language flash).
  // When it is unset or fails, DEFAULT_LOCALE stays.
  if (tauriRuntimeAvailable) {
    await applyPersistedLocale();
  }

  // Session-scoped localStorage: fetch the process UUID from Rust so both
  // windows can tag their localStorage entries with the same session ID.
  await initSession();
  markBootMilestone("session:initialized");

  // state-management-strategy Phase 4 — listener pre-register MUST happen
  // before the snapshot IPC so race-window `state-changed` events get
  // buffered.
  // Best-effort: in vitest jsdom or a tauri-less env this becomes a no-op
  // (`registerSnapshotListener` swallows the import failure).
  if (tauriRuntimeAvailable) {
    await registerSnapshotListener();
  }
  markBootMilestone("snapshot:listener-registered");

  // state-management-strategy Q12 — wire the singleton `setting.onUpdated`
  // receiver so cross-window theme / safe-mode updates dispatch to their
  // respective store apply paths. Must precede the snapshot drain (the
  // buffered events fire through the same dispatcher) but can come after
  // `registerSnapshotListener` because the receiver only adds handlers
  // — it does not touch the Tauri listener registration.
  registerSettingReceiver();

  // Runtime recovery for background schema introspection. Query/DDL user
  // flows call the same use-case directly so they can attach Retry toasts.
  registerSchemaStoreDbMismatchRecovery();

  // Hydrate connection state from session-scoped localStorage so the
  // workspace has correct focusedConnId + activeStatuses on first render.
  // The dynamic import preserves the boot-graph node ordering so the
  // module-load `attachZustandIpcBridge` attach inside `connectionStore.ts`
  // still runs before any caller observes the store. The runtime
  // `hydrateConnectionSession` entrypoint is a plain function — safe to call
  // here outside the React tree.
  await import("@features/connection");
  markBootMilestone("connectionStore:imported");
  const { hydrateConnectionSession } = await import(
    "@lib/runtime/connection/hydrateConnectionSession"
  );
  hydrateConnectionSession();
  markBootMilestone("connectionStore:hydrated");

  // state-management-strategy Phase 4 — atomic snapshot hydration for the 5
  // boot-critical stores (connections + groups / workspaces / mru / theme /
  // safeMode) + runtime.activeStatuses mirror. Fire-and-forget: failure
  // surfaces a sticky error toast with Retry inside `loadAllFromSnapshot`
  // itself, so we keep the existing session-LS path as the fallback.
  if (tauriRuntimeAvailable) {
    void loadAllFromSnapshot()
      .then(() => markBootMilestone("snapshot:applied"))
      .catch((e) => {
        logger.warn(
          "[main] snapshot hydration failed (LS fallback in effect):",
          e instanceof Error ? e.message : e,
        );
      });
  }

  // state-management-strategy Phase 4 — drop the legacy `column-widths:*` /
  // `hidden-columns:*` localStorage keys with a one-time toast to the user.
  // A no-op once the sentinel in the `meta` table is set. Fire-and-forget —
  // boot goes on even if this fails.
  if (tauriRuntimeAvailable) {
    void import("@lib/runtime/migration/legacyColumnPrefsDrop")
      .then((m) => m.dropLegacyColumnPrefs())
      .catch((e) => {
        logger.warn(
          "[main] legacy column prefs drop failed:",
          e instanceof Error ? e.message : e,
        );
      });
  }

  // 2026-05-17 — eager pre-load of the mongosh WASM parser. The callers of
  // `parseMongoshStatement` (the render-path Run gate in `Toolbar.tsx`, the
  // dispatch in `mongoQueryExecution.ts`) expect a sync signature. This
  // fire-and-forget import starts loading the WASM module in the background
  // before the React render below, so the sync surface is ready by the time
  // the user starts typing mongosh input. If it fails, the facade returns a
  // synthetic "parser initializing" error, so boot goes on.
  void import("@features/query")
    .then((m) => m.initMongoshWasm())
    .catch((e) => {
      logger.warn(
        "[main] mongosh WASM init failed:",
        e instanceof Error ? e.message : e,
      );
    });

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
