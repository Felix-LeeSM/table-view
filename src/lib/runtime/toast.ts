import { useToastStore, type ToastOptions } from "@stores/toastStore";

export type {
  Toast,
  ToastAction,
  ToastOptions,
  ToastVariant,
} from "@stores/toastStore";

/**
 * Public toast facade. Runtime/UI code can enqueue notifications without
 * importing the React-facing store hook directly.
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
