/**
 * Global toast queue. Callers use the runtime `toast` facade; the React
 * toaster consumes this store directly.
 *
 * The toaster container (`src/components/ui/toaster.tsx`) is mounted once at
 * the App root — outside any modal portal — so a toast surfaced from inside
 * a Radix dialog survives the dialog being closed.
 */
import { create } from "zustand";

export type ToastVariant = "success" | "error" | "info" | "warning";

/**
 * Sprint 269 — optional action button payload. Surfaced as an in-toast
 * button (rendered immediately before the dismiss `X`); clicking invokes
 * `onClick` synchronously then dismisses the toast. The field is omitted
 * (not `null`) on toasts that have no action so existing serialization +
 * the Sprint 94 `Toast` shape stay byte-equivalent.
 */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  /** Stable id used for `toast.dismiss(id)`. Unique per active toast. */
  id: string;
  variant: ToastVariant;
  message: string;
  /**
   * Auto-dismiss duration in milliseconds. `null` keeps the toast until the
   * user dismisses it manually (sticky). Defaults applied per-variant — see
   * `DEFAULT_DURATIONS`.
   */
  durationMs: number | null;
  /**
   * Sprint 269 — optional Retry-style action. Present only when the caller
   * passed `options.action` to `toast.<variant>(...)`.
   */
  action?: ToastAction;
}

export interface ToastOptions {
  /**
   * Override the auto-dismiss timer. Pass `null` for a sticky toast (user must
   * close it). Pass a number (ms) for a custom timeout. When omitted, the
   * variant default applies.
   */
  durationMs?: number | null;
  /**
   * Caller-supplied id. Useful when an action wants to update or dismiss its
   * own toast later (e.g. swap "Connecting…" for "Connected"). When omitted,
   * a fresh id is generated.
   */
  id?: string;
  /**
   * Sprint 269 — optional action button. When supplied, the toaster renders
   * a button labelled `action.label` immediately before the dismiss `X`;
   * clicking it invokes `action.onClick()` and dismisses the toast. Omitted
   * by default so existing Sprint 94 call sites behave unchanged.
   */
  action?: ToastAction;
}

interface ToastStoreState {
  toasts: Toast[];
  push: (
    variant: ToastVariant,
    message: string,
    options?: ToastOptions,
  ) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

/**
 * Per-variant default auto-dismiss durations (ms). `error` and `warning` stay
 * up longer because they typically describe a failure the user has to read +
 * react to. Mirrors the conservative side of common toast libraries (sonner
 * uses 4s default, we go a notch longer for failures).
 */
const DEFAULT_DURATIONS: Record<ToastVariant, number> = {
  success: 3000,
  info: 3500,
  warning: 5000,
  error: 6000,
};

let toastSeq = 0;

/**
 * Generate a unique id for a fresh toast. Uses `crypto.randomUUID` when
 * available (browser + jsdom polyfilled in `test-setup.ts`), falls back to a
 * monotonically-increasing counter so the id stays unique even in environments
 * without crypto.
 */
function generateId(): string {
  toastSeq += 1;
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `toast-${toastSeq}`;
}

export const useToastStore = create<ToastStoreState>((set) => ({
  toasts: [],
  push: (variant, message, options) => {
    const id = options?.id ?? generateId();
    const durationMs =
      options?.durationMs === undefined
        ? DEFAULT_DURATIONS[variant]
        : options.durationMs;
    // Build the persisted Toast. Omit `action` entirely when the caller did
    // not supply one — Sprint 94 callers (success/info/error/warning without
    // options.action) get a Toast whose shape is unchanged from before.
    const toast: Toast =
      options?.action === undefined
        ? { id, variant, message, durationMs }
        : { id, variant, message, durationMs, action: options.action };
    set((state) => {
      // If a caller-supplied id collides with an existing toast, replace in
      // place so the call has "update" semantics (e.g. flipping a pending
      // toast to a final success/error) without queue duplication.
      const filtered = state.toasts.filter((t) => t.id !== id);
      return { toasts: [...filtered, toast] };
    });
    return id;
  },
  dismiss: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
  clear: () => set({ toasts: [] }),
}));

/**
 * Variant → ARIA role mapping. `success` / `info` are non-disruptive
 * announcements (`status` + `aria-live="polite"`). `error` / `warning` are
 * disruptive — they need to interrupt assistive tech (`alert` +
 * `aria-live="assertive"`). Exported so the toaster component and tests share
 * a single source of truth.
 */
export function roleForVariant(variant: ToastVariant): "status" | "alert" {
  return variant === "error" || variant === "warning" ? "alert" : "status";
}

export const TOAST_DEFAULT_DURATIONS = DEFAULT_DURATIONS;
