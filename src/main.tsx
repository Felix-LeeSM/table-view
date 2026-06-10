import React from "react";
import ReactDOM from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import AppRouter from "./AppRouter";
import { bootTheme, reconcileThemeFromBackend } from "@lib/themeBoot";
import { bootWindowLifecycle } from "@lib/window-lifecycle-boot";
import { initSession } from "@lib/scopedLocalStorage";
import { importLegacyLocalStorage } from "@lib/tauri/legacyImport";
import { getCurrentWindowLabel } from "@lib/window-label";
import {
  markBootMilestone,
  markT0,
  scheduleBootSummary,
} from "@lib/perf/bootInstrumentation";
import { logger } from "@lib/logger";
// CRITICAL (sprint-367 AC-367-03): the listener-register call below MUST
// precede `loadAllFromSnapshot()` in the boot flow. That ordering is also
// regression-locked by `src/lib/runtime/snapshot/loadAll.listener-order.test.ts`,
// which scans `loadAll.ts` for the same pattern.
import {
  loadAllFromSnapshot,
  registerSnapshotListener,
} from "@lib/runtime/snapshot/loadAll";
import { registerSettingReceiver } from "@lib/runtime/settings/settingsReceiver";
import { registerSchemaStoreDbMismatchRecovery } from "@lib/runtime/recovery/syncMismatchedActiveDb";
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
  // 1) `bootTheme()` 는 LS 만 sync 하게 읽어 첫 paint 의 DOM data-theme/-mode 를
  //    즉시 적용 — FOUC 회피 fast path.
  // 2) `reconcileThemeFromBackend()` 는 SQLite truth (`get_setting("theme")`) 을
  //    await 한 뒤 LS 와 다르면 DOM + LS 를 갱신. Tauri 2 webview 들은 각자
  //    별도 localStorage 를 가져서, 새로 열린 workspace 의 LS 는 비어있어 slate
  //    flash 가 발생. 본 reconcile 이 보통 10–50ms 안에 완료되어 첫 React render
  //    전에 정답값이 들어간다 (Wave 9.5 회귀 7 user 가설 적용).
  bootTheme();
  const tauriRuntimeAvailable = isTauri();

  // Wave 9.5 회귀 7 (2026-05-17) — `meta.legacy_imported` 가 영원히 Pending
  // 상태였다. sprint-355 의 frontend wrapper 는 만들어졌으나 boot path 어디서도
  // 호출 안 되어 `guard_legacy_import_done` 이 모든 persist_* IPC 를 silent
  // reject — SQLite 영원히 empty + 사용자가 클릭한 theme/safeMode/favorites/mru
  // 가 영속 안 됨. 빈 payload 도 Pending → Done 전이 인정 (sprint-355 design
  // idempotent). reconcile 보다 먼저 호출해 첫 클릭 race 회피. dev 단계 + 사용자
  // 명시로 legacy LS scan (favorites/mru/connections) 은 별도 작업.
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

  // Session-scoped localStorage: fetch the process UUID from Rust so both
  // windows can tag their localStorage entries with the same session ID.
  await initSession();
  markBootMilestone("session:initialized");

  // Sprint 367 (Phase 4) — listener pre-register MUST happen before the
  // snapshot IPC so race-window `state-changed` events get buffered.
  // Best-effort: in vitest jsdom or a tauri-less env this becomes a no-op
  // (`registerSnapshotListener` swallows the import failure).
  if (tauriRuntimeAvailable) {
    await registerSnapshotListener();
  }
  markBootMilestone("snapshot:listener-registered");

  // Sprint 368 (Phase 4 Q12) — wire the singleton `setting.onUpdated`
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
  const { hydrateConnectionSession } =
    await import("@lib/runtime/connection/hydrateConnectionSession");
  hydrateConnectionSession();
  markBootMilestone("connectionStore:hydrated");

  // Sprint 367 (Phase 4) — atomic snapshot hydration for the 5 boot-critical
  // stores (connections + groups / workspaces / mru / theme / safeMode) +
  // runtime.activeStatuses mirror. Fire-and-forget: failure surfaces a sticky
  // error toast with Retry inside `loadAllFromSnapshot` itself, so we keep
  // the existing session-LS path as the fallback for this sprint. Sprint 368
  // / 369 retire the LS dependencies; Sprint 370 owns workspaces.
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

  // Sprint 369 (Phase 4) — drop legacy `column-widths:*` / `hidden-columns:*`
  // localStorage 키 + 사용자 1회 toast. sentinel 이 `meta` 테이블에 set 되어
  // 이미 보여줬으면 noop. Fire-and-forget — 본 작업이 실패해도 boot 은 계속.
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

  // Sprint 401 (2026-05-17) — eager pre-load of the mongosh WASM parser.
  // `parseMongoshStatement` 의 호출부 (`Toolbar.tsx` 의 render-path Run
  // gate, `useQueryExecution` 의 dispatch) 는 sync 시그니처를 기대한다 —
  // contract 의 `Decision Lock` 참조. 본 fire-and-forget 가 React mount
  // 직후 background 에서 WASM 모듈을 로드해서, 사용자가 mongosh 입력을
  // 시작할 때쯤이면 sync surface 가 이미 ready. 실패해도 facade 가
  // synthetic "parser initializing" 에러를 반환하므로 boot 은 계속.
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
