import { AlertTriangle } from "lucide-react";
import { COLLECTION_READONLY_BANNER_TEXT } from "@lib/strings/document";

export interface CollectionReadOnlyBannerProps {
  /**
   * Override copy. Defaults to {@link COLLECTION_READONLY_BANNER_TEXT}.
   * Provided primarily so tests (and future callers) can swap the message
   * without re-mocking the constants module.
   */
  message?: string;
}

/**
 * Sprint 101 — non-dismissible beta/limitation banner shown at the top of
 * MongoDB collection grids.
 *
 * Renders as a sticky `role="status"` strip with `aria-live="polite"` so
 * screen readers announce it once on mount. There is intentionally no close
 * button — the banner is informational and must persist across tab
 * switches (mount/unmount handles re-display, no local state needed).
 *
 * Visual tone matches the rest of the app's warning surface
 * (`bg-warning/10`, `border-warning/30`, `text-warning`) so it sits above
 * the toolbar without competing for attention.
 */
export default function CollectionReadOnlyBanner({
  message = COLLECTION_READONLY_BANNER_TEXT,
}: CollectionReadOnlyBannerProps = {}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-20 flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-3 py-1.5 text-xs text-warning"
    >
      <AlertTriangle size={12} className="shrink-0" aria-hidden="true" />
      <span className="truncate">{message}</span>
    </div>
  );
}
