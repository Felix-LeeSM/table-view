import { useEffect, useRef } from "react";
import {
  CheckCircle2,
  AlertCircle,
  Info,
  AlertTriangle,
  X,
} from "lucide-react";
import {
  useToastStore,
  roleForVariant,
  type Toast,
  type ToastVariant,
} from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * Sprint 94 — global toast container.
 *
 * Mounted once at the App root (see `src/App.tsx`). The container is
 * intentionally **outside** any modal portal so a toast surfaced from inside a
 * Radix dialog (e.g. the SQL Preview modal's commit-failed banner) survives
 * the dialog being closed (Acceptance Criterion AC-03).
 *
 * Each toast renders with:
 *   - `role="status"` (success/info, polite) or `role="alert"` (error/warning,
 *     assertive). See `roleForVariant` in `src/lib/toast.ts`.
 *   - A dismiss button with an explicit `aria-label="Dismiss notification"`.
 *   - Esc key handler that dismisses the most-recently-pushed toast (LIFO),
 *     matching common toast-library affordances.
 *
 * Auto-dismiss timers live inside `<ToastItem>` so each toast carries its own
 * lifecycle — pushing a new toast does not reset existing timers.
 */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  // Esc dismisses the most recent toast. We listen on `window` so the handler
  // fires regardless of focus location (toasts don't take focus by default).
  // Ref is used to read the latest toast list inside the handler without
  // re-binding the listener on every queue change.
  const toastsRef = useRef(toasts);
  toastsRef.current = toasts;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const current = toastsRef.current;
      if (current.length === 0) return;
      const last = current[current.length - 1];
      if (!last) return;
      // Only swallow the Escape when there's a toast to dismiss — otherwise we
      // could accidentally suppress dialog/menu close-on-Esc behaviour.
      e.preventDefault();
      dismiss(last.id);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dismiss]);

  return (
    <div
      data-slot="toaster"
      aria-label="Notifications"
      // z-100 sits above dialog overlays (z-50) so a toast surfaced from inside
      // a modal stays visible after the modal closes. Fixed top-right, stacked
      // top-down. `pointer-events-none` on the container so the empty stack
      // doesn't block clicks; `pointer-events-auto` is re-enabled on each
      // toast item so its dismiss button is interactive.
      className="pointer-events-none fixed top-4 right-4 z-100 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

interface ToastItemProps {
  toast: Toast;
  onDismiss: () => void;
}

/**
 * Single toast row. Owns its auto-dismiss timer so each toast lives or dies
 * independently. The timer is cleared on unmount (manual dismiss or queue
 * replacement) and on duration changes — pass `durationMs: null` to keep a
 * toast until the user dismisses it (sticky).
 */
function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const role = roleForVariant(toast.variant);

  useEffect(() => {
    if (toast.durationMs === null) return;
    const timer = setTimeout(() => {
      onDismiss();
    }, toast.durationMs);
    return () => clearTimeout(timer);
  }, [toast.durationMs, onDismiss]);

  return (
    <div
      role={role}
      // `assertive` for error/warning so screen readers interrupt the user;
      // `polite` for success/info so the announcement waits for a pause.
      aria-live={role === "alert" ? "assertive" : "polite"}
      className={cn(
        "pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-md duration-200 animate-in fade-in slide-in-from-top-2",
        VARIANT_CLASSES[toast.variant],
      )}
      data-toast-id={toast.id}
      data-toast-variant={toast.variant}
    >
      <span aria-hidden="true" className="mt-0.5 shrink-0">
        <VariantIcon variant={toast.variant} />
      </span>
      <span className="min-w-0 flex-1 break-words">{toast.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="ml-1 inline-flex shrink-0 cursor-pointer rounded-sm p-0.5 opacity-70 outline-none hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

/**
 * Per-variant container styling. Uses the existing design-token colors from
 * `src/index.css` (`bg-success`, `bg-destructive`, `bg-warning`, `bg-muted`).
 * Each block sets a soft tinted background + matching text color so the
 * variant is identifiable at a glance, mirroring the alert pattern already
 * used in `ConnectionDialog.tsx`.
 */
const VARIANT_CLASSES: Record<ToastVariant, string> = {
  success: "bg-success/10 text-success border-success/30",
  error: "bg-destructive/10 text-destructive border-destructive/30",
  info: "bg-muted text-foreground border-border",
  warning: "bg-warning/10 text-warning border-warning/30",
};

function VariantIcon({ variant }: { variant: ToastVariant }) {
  switch (variant) {
    case "success":
      return <CheckCircle2 className="size-4" />;
    case "error":
      return <AlertCircle className="size-4" />;
    case "warning":
      return <AlertTriangle className="size-4" />;
    case "info":
    default:
      return <Info className="size-4" />;
  }
}
