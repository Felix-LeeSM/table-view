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
 *    `useEffect`, and every failure (offline, no runtime, IPC error) is
 *    swallowed to a single DEV-only `logger.warn`.
 *  - Off the cold-boot critical path: the `@tauri-apps/plugin-updater` /
 *    `plugin-process` / `plugin-dialog` modules are dynamically imported only
 *    after the `isTauri()` guard passes, so a non-Tauri boot (vitest/jsdom)
 *    and the initial launcher bundle never pull the updater IPC glue.
 */

import { isTauri } from "@tauri-apps/api/core";
import i18n from "i18next";
import { logger } from "@lib/logger";

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
 * Check for an update and, if the user approves, install + relaunch.
 *
 * `confirmInstall` is injectable so the flow can be unit-tested without the
 * native dialog. Returns nothing — this is a background side effect.
 */
export async function checkForUpdatesOnLaunch(
  confirmInstall: (version: string) => Promise<boolean> = defaultConfirmInstall,
): Promise<void> {
  // Skip outside the Tauri runtime (dev browser, vitest/jsdom): the updater
  // IPC does not exist there, so there is nothing to check and no glue to load.
  if (!isTauri()) return;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update?.available) return;

    if (!(await confirmInstall(update.version))) return;

    await update.downloadAndInstall();
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (err) {
    // Offline / rate-limited / IPC failure must never surface to the user or
    // block the launcher — a background check that fails is a no-op.
    logger.warn("[autoUpdate] update check failed", err);
  }
}
