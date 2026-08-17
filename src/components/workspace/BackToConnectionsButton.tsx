import { Button } from "@components/ui/button";
import { logger } from "@lib/logger";
import { destroyCurrentWindow, focusWindow } from "@lib/window-controls";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * `[←]` — the workspace window's route back to the launcher.
 *
 * #2431 moved it here from the sidebar column's header strip. That strip
 * survived a collapse as a narrow vertical rail *because* it held this button
 * and the appearance popover; with both in the toolbar the collapsed workspace
 * drops the sidebar column whole.
 *
 * Icon only, no caption: the toolbar's convention for its controls (frontend
 * guidance "버튼은 가능한 lucide icon + tooltip", as `LayoutCluster` already
 * follows). The old rail already dropped the caption when collapsed, so the
 * accessible name — not the visible text — is what anything ever bound to.
 *
 * Back ≠ Disconnect. This focuses the launcher and destroys *this* window; the
 * connection pool outlives it, and `DisconnectButton` is the only control that
 * tears the pool down. `destroyCurrentWindow` is `win.destroy()` rather than
 * `win.close()` so the `tauri://close-requested` lifecycle is bypassed
 * entirely — the reasoning lives in `src/lib/window-controls.ts` and in the
 * Wave 9.5 회귀 4 note on `WorkspacePage`.
 *
 * i18n: the `pages` namespace, not `workspace`. `pages.backToConnections` is
 * the exact string the e2e smoke helpers pin as the marker for "this window is
 * a workspace" (`WORKSPACE_MARKER_SELECTOR` in `e2e/smoke/_helpers.ts`), so the
 * button keeps reading the one key instead of gaining a second copy that can
 * drift away from it.
 */
export default function BackToConnectionsButton() {
  const { t } = useTranslation("pages");

  const handleBackToConnections = async () => {
    try {
      await focusWindow("launcher");
      await destroyCurrentWindow();
    } catch (e) {
      logger.warn(
        "[workspace-back] window transition failed:",
        e instanceof Error ? e.message : e,
      );
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      type="button"
      className="text-muted-foreground hover:text-secondary-foreground"
      aria-label={t("backToConnections")}
      title={t("backToConnections")}
      onClick={handleBackToConnections}
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
    </Button>
  );
}
