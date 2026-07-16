/**
 * #1400 — boot-time auto-update.
 *
 * The launcher fires this once on mount. It checks the GitHub `latest.json`
 * updater manifest, and on a newer signed release asks the user to install.
 * On confirmation it downloads + installs the minisign-verified bundle and
 * relaunches into it.
 *
 * Design constraints:
 *  - Never block or delay boot: the caller invokes this fire-and-forget from a
 *    `useEffect`. A failed *check* (offline, no runtime, IPC error) stays
 *    silent — it is a background probe the user never asked for.
 *  - After the user confirms an install, failures are NO LONGER silent (#1437
 *    P2-8): the user is actively waiting, so a mid-download error surfaces a
 *    toast instead of hanging.
 *  - Off the cold-boot critical path: the `@tauri-apps/plugin-updater` /
 *    `plugin-process` / `plugin-dialog` modules are dynamically imported only
 *    after the `isTauri()` guard passes, so a non-Tauri boot (vitest/jsdom)
 *    and the initial launcher bundle never pull the updater IPC glue.
 */

import { isTauri } from "@tauri-apps/api/core";
import type { DownloadEvent } from "@tauri-apps/plugin-updater";
import i18n from "i18next";
import { logger } from "@lib/logger";
import { toast } from "@lib/runtime/toast";

/** Single toast slot reused across the update lifecycle so progress → result
 *  replaces in place (toast store gives caller-supplied ids update semantics)
 *  instead of stacking. */
const UPDATE_TOAST_ID = "auto-update";

/** Ask the user whether to install `version` now. Native OS dialog. */
async function defaultConfirmInstall(version: string): Promise<boolean> {
  const { ask } = await import("@tauri-apps/plugin-dialog");
  return ask(i18n.t("app:update.prompt", { version }), {
    title: i18n.t("app:update.title"),
    kind: "info",
    okLabel: i18n.t("app:update.install"),
    cancelLabel: i18n.t("app:update.later"),
  });
}

/**
 * #1437 P2-4 — whether the running install can actually self-update.
 *
 * The Tauri updater only rewrites the binary in place on macOS / Windows and
 * on Linux AppImage bundles; a `.deb`/`.rpm` install has no writable in-place
 * target, so `downloadAndInstall` there is a silent no-op. The backend
 * `updater_can_self_install` command reports this (macOS/Windows => true,
 * Linux => only when the `APPIMAGE` env var is set). On probe failure we
 * assume `true`: withholding updates from a capable install is worse than one
 * extra prompt.
 */
async function defaultCanSelfInstall(): Promise<boolean> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<boolean>("updater_can_self_install");
  } catch (err) {
    logger.warn("[autoUpdate] can-self-install probe failed", err);
    return true;
  }
}

/** Build a fresh progress handler for one download. Accumulates bytes across
 *  `Progress` events and drives a single reused toast (#1437 P2-8). */
function makeProgressHandler(version: string): (e: DownloadEvent) => void {
  let total = 0;
  let downloaded = 0;
  return (e) => {
    switch (e.event) {
      case "Started":
        total = e.data.contentLength ?? 0;
        toast.info(i18n.t("app:update.downloading", { version, percent: 0 }), {
          id: UPDATE_TOAST_ID,
          durationMs: null,
        });
        break;
      case "Progress": {
        downloaded += e.data.chunkLength;
        const percent =
          total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
        toast.info(i18n.t("app:update.downloading", { version, percent }), {
          id: UPDATE_TOAST_ID,
          durationMs: null,
        });
        break;
      }
      case "Finished":
        toast.success(i18n.t("app:update.restarting"), { id: UPDATE_TOAST_ID });
        break;
    }
  };
}

/**
 * Check for an update and, if the user approves, install + relaunch.
 *
 * `confirmInstall` / `canSelfInstall` are injectable so the flow can be
 * unit-tested without the native dialog or the backend IPC probe. Returns
 * nothing — this is a background side effect.
 */
export async function checkForUpdatesOnLaunch(
  confirmInstall: (version: string) => Promise<boolean> = defaultConfirmInstall,
  canSelfInstall: () => Promise<boolean> = defaultCanSelfInstall,
): Promise<void> {
  // Skip outside the Tauri runtime (dev browser, vitest/jsdom): the updater
  // IPC does not exist there, so there is nothing to check and no glue to load.
  if (!isTauri()) return;

  let update: Awaited<
    ReturnType<typeof import("@tauri-apps/plugin-updater").check>
  >;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    update = await check();
  } catch (err) {
    // Offline / rate-limited / IPC failure on the *check* must never surface
    // to the user or block the launcher — a background probe that fails is a
    // no-op.
    logger.warn("[autoUpdate] update check failed", err);
    return;
  }
  if (!update?.available) return;

  // #1437 P2-4 — a deb/rpm Linux install can't self-update. Don't prompt into
  // a silent no-op every boot; point the user at their package manager once.
  if (!(await canSelfInstall())) {
    toast.info(i18n.t("app:update.manualHint", { version: update.version }), {
      id: UPDATE_TOAST_ID,
    });
    return;
  }

  if (!(await confirmInstall(update.version))) return;

  // #1437 P2-8 — the user confirmed and is now waiting. Show download progress
  // and, critically, make a mid-download failure visible instead of hanging.
  try {
    await update.downloadAndInstall(makeProgressHandler(update.version));
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (err) {
    logger.warn("[autoUpdate] download/install failed", err);
    toast.error(i18n.t("app:update.failed"), { id: UPDATE_TOAST_ID });
  }
}
