import { useEffect, useRef } from "react";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-80 rounded-lg bg-(--color-bg-secondary) p-4 shadow-xl outline-none"
      >
        <h3 className="text-sm font-semibold text-(--color-text-primary)">
          {title}
        </h3>
        <p className="mt-2 text-sm text-(--color-text-secondary)">{message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            className="rounded px-3 py-1.5 text-sm text-(--color-text-secondary) hover:bg-(--color-bg-tertiary)"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            className={`rounded px-3 py-1.5 text-sm font-medium text-white ${
              danger
                ? "bg-(--color-danger) hover:opacity-90"
                : "bg-(--color-accent) hover:opacity-90"
            } ${loading ? "cursor-not-allowed opacity-50" : ""}`}
            onClick={onConfirm}
            disabled={loading}
            aria-label={confirmLabel}
          >
            {loading ? "Processing..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
