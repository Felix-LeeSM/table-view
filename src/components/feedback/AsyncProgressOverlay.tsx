import { Loader2 } from "lucide-react";
import { Button } from "@components/ui/button";
import { cn } from "@lib/utils";

export interface AsyncProgressOverlayProps {
  /**
   * When `true`, the overlay renders. Threshold-gating is the host's
   * responsibility (typically via `useDelayedFlag`); this component
   * itself is purely declarative.
   */
  visible: boolean;
  /**
   * Invoked when the user clicks Cancel. The overlay does not change
   * its own visibility — the host clears `loading` after the cancel
   * settles, which in turn flips `visible` to false.
   */
  onCancel: () => void;
  /**
   * Optional accessible label for the loading region. Defaults to
   * `"Loading"`. Spec Visual Direction keeps the user-facing string
   * paradigm-neutral; the Cancel button copy is fixed at `"Cancel"`.
   */
  label?: string;
  /**
   * Host-specific positioning override (e.g. structure-panel uses a
   * non-`absolute` placement). Defaults to the canonical full-bleed
   * absolute overlay used by DataGridTable / DocumentDataGrid.
   */
  className?: string;
}

/**
 * Sprint 180 — shared async progress + Cancel overlay.
 *
 * Materialises after the host's threshold gate flips `visible` to
 * `true`. Carries the four pointer-event handlers (mouseDown / click /
 * doubleClick / contextMenu) preserving Sprint 176 hardening so a
 * mid-flight refetch can't be hijacked into selecting a row, opening
 * cell-edit mode, or firing the context menu. The Cancel button's own
 * onClick handler still receives the gesture because React's synthetic
 * stopPropagation only prevents bubbling beyond the overlay, not from
 * children up to the overlay's own listeners.
 *
 * AC anchors:
 *  - AC-180-01: visible-after-threshold rendering controlled by host.
 *  - AC-180-02: `onCancel` invoked exactly once per click.
 *  - AC-180-06: `data-testid="async-cancel"` + accessible name "Cancel"
 *    + tabIndex defaulting to 0 (native `<button>` semantics).
 *  - Sprint 176 invariant: pointer events on the overlay region call
 *    `e.preventDefault()` + `e.stopPropagation()`.
 */
export default function AsyncProgressOverlay({
  visible,
  onCancel,
  label = "Loading",
  className,
}: AsyncProgressOverlayProps) {
  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      data-testid="async-progress-overlay"
      className={cn(
        "absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-background/60",
        className,
      )}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <Loader2
        className="animate-spin text-muted-foreground"
        size={24}
        aria-hidden="true"
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        data-testid="async-cancel"
        onClick={(e) => {
          // The parent `onClick` calls `e.stopPropagation()` to prevent
          // the click from reaching cells underneath. React fires the
          // child handler first, so we re-stop bubbling here as a
          // defence in depth and forward the cancel callback.
          e.stopPropagation();
          onCancel();
        }}
      >
        Cancel
      </Button>
    </div>
  );
}
