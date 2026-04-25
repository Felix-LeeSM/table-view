/**
 * Sprint 94 — global toast API.
 *
 * Self-implemented (no `sonner` / `react-hot-toast`) so we don't pull a new
 * dependency for what is essentially a Zustand-backed queue. The store lives
 * in `src/lib` (not `src/stores`) because callers reach for `toast.success(...)`
 * the way they reach for `cn(...)` — it's a thin façade, not a domain store.
 *
 * Usage from anywhere in the app shell:
 *   ```ts
 *   import { toast } from "@/lib/toast";
 *   toast.success("Connection saved");
 *   toast.error("Commit failed: relation does not exist");
 *   const id = toast.info("Working...");
 *   toast.dismiss(id);
 *   ```
 *
 * The toast container (see `src/components/ui/toaster.tsx`) subscribes to this
 * store and renders the queue. The container is mounted once at the App root
 * — outside any modal portal — so a toast surfaced from inside a Radix dialog
 * survives the dialog being closed (Acceptance Criterion AC-03).
 */
import { create } from "zustand";

export type ToastVariant = "success" | "error" | "info" | "warning";

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
    const toast: Toast = { id, variant, message, durationMs };
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
 * Public toast façade. The four variant helpers wrap `push` so callers don't
 * have to import the store directly. `dismiss` removes a toast by id (matches
 * the id `push` returned). `clear` wipes the queue — used by tests; not part
 * of the public surface but exposed for completeness.
 */
export const toast = {
  success(message: string, options?: ToastOptions): string {
    return useToastStore.getState().push("success", message, options);
  },
  error(message: string, options?: ToastOptions): string {
    return useToastStore.getState().push("error", message, options);
  },
  info(message: string, options?: ToastOptions): string {
    return useToastStore.getState().push("info", message, options);
  },
  warning(message: string, options?: ToastOptions): string {
    return useToastStore.getState().push("warning", message, options);
  },
  dismiss(id: string): void {
    useToastStore.getState().dismiss(id);
  },
  clear(): void {
    useToastStore.getState().clear();
  },
};

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
