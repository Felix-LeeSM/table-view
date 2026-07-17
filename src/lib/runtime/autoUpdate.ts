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

/**
 * #1439 P3-10 — re-prompt throttle. ADR 0049 shipped the boot-time check
 * without a throttle, so declining "Later" re-opened the same modal on every
 * launch. Persist the last-declined version + time in plain `localStorage`
 * (not the session-scoped store, which clears each process — the throttle must
 * outlive a restart) and stay silent for that same version within the window.
 * A *newer* version always re-prompts immediately, so a security patch is
 * never throttled behind an older decline.
 */
const UPDATE_DECLINE_KEY = "table-view:update-declined";
const RE_PROMPT_THROTTLE_MS = 24 * 60 * 60 * 1000; // 24h (ADR 0049 §2)

type DeclineRecord = { version: string; declinedAt: number };

function readDecline(): DeclineRecord | null {
  try {
    const raw = window.localStorage.getItem(UPDATE_DECLINE_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw) as DeclineRecord;
    if (
      typeof rec?.version === "string" &&
      typeof rec?.declinedAt === "number"
    ) {
      return rec;
    }
    return null;
  } catch {
    // Malformed JSON or localStorage unavailable — degrade to prompting.
    return null;
  }
}

function recordDecline(version: string): void {
  try {
    window.localStorage.setItem(
      UPDATE_DECLINE_KEY,
      JSON.stringify({
        version,
        declinedAt: Date.now(),
      } satisfies DeclineRecord),
    );
  } catch {
    // localStorage unavailable — degrade to prompting every boot.
  }
}

/**
 * #1617 C2 — the deb/rpm manual-update hint is version-scoped (not a
 * throttle): once shown for a version it never repeats, but a *newer* version
 * surfaces again. Same plain `localStorage` storage as the decline throttle so
 * the notice outlives a restart. Stores just the last-hinted version string.
 */
const UPDATE_HINTED_KEY = "table-view:update-hinted";

function readHintedVersion(): string | null {
  try {
    return window.localStorage.getItem(UPDATE_HINTED_KEY);
  } catch {
    // localStorage unavailable — degrade to hinting every boot.
    return null;
  }
}

function recordHintedVersion(version: string): void {
  try {
    window.localStorage.setItem(UPDATE_HINTED_KEY, version);
  } catch {
    // localStorage unavailable — degrade to hinting every boot.
  }
}

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
  // #1617 C3 — when total is unknown (updater emitted Progress without a
  // Started event, or Started carried no contentLength) a computed percent is
  // always 0, which reads as a stalled download. Show an indeterminate message
  // instead of a stuck "0%".
  const showProgress = () => {
    const message =
      total > 0
        ? i18n.t("app:update.downloading", {
            version,
            percent: Math.min(100, Math.round((downloaded / total) * 100)),
          })
        : i18n.t("app:update.downloadingUnknown", { version });
    toast.info(message, { id: UPDATE_TOAST_ID, durationMs: null });
  };
  return (e) => {
    switch (e.event) {
      case "Started":
        total = e.data.contentLength ?? 0;
        showProgress();
        break;
      case "Progress":
        downloaded += e.data.chunkLength;
        showProgress();
        break;
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
  // #1400 / #1403 — `check()` returns `null` when there is no newer release.
  // Gate on that null return rather than the `Update.available` field (which
  // the updater plugin marks always-`true`); behaviour is identical.
  if (!update) return;

  // #1437 P2-4 — a deb/rpm Linux install can't self-update. Don't prompt into
  // a silent no-op every boot; point the user at their package manager once.
  // #1617 C2 — show that hint only once per version so the same release doesn't
  // re-toast on every boot; a newer version still surfaces a fresh hint.
  if (!(await canSelfInstall())) {
    if (readHintedVersion() !== update.version) {
      toast.info(i18n.t("app:update.manualHint", { version: update.version }), {
        id: UPDATE_TOAST_ID,
      });
      recordHintedVersion(update.version);
    }
    return;
  }

  // #1439 P3-10 — skip the prompt if the user declined this exact version
  // within the throttle window. Runs after the self-install gate so a deb/rpm
  // install still gets its manual hint, and before the prompt so we never
  // re-nag for an already-declined version.
  const decline = readDecline();
  if (
    decline &&
    decline.version === update.version &&
    Date.now() - decline.declinedAt < RE_PROMPT_THROTTLE_MS
  ) {
    return;
  }

  // #1617 C1 — this runs fire-and-forget from boot. A prompt rejection (dialog
  // IPC error) was previously uncaught. The user hasn't confirmed yet, so treat
  // a failed prompt like a failed check: stay silent, don't toast, don't throw.
  let confirmed: boolean;
  try {
    confirmed = await confirmInstall(update.version);
  } catch (err) {
    logger.warn("[autoUpdate] update prompt failed", err);
    return;
  }
  if (!confirmed) {
    recordDecline(update.version);
    return;
  }

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
