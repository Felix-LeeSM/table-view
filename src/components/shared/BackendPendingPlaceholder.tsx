// Sprint 327 (2026-05-15) — Shared placeholder for surfaces whose backend
// wrapper is intentionally deferred to a follow-up sprint. Renders a stable
// `role="status"` block with a sprint pointer so the user knows the feature
// is scaffolded, not abandoned. Sprint 327 decision log: D-71 ~ D-75.

interface BackendPendingPlaceholderProps {
  title: string;
  pendingSprint: string;
  description?: string;
  testId: string;
}

export function BackendPendingPlaceholder({
  title,
  pendingSprint,
  description,
  testId,
}: BackendPendingPlaceholderProps) {
  return (
    <div
      role="status"
      data-testid={testId}
      className="flex flex-col items-start gap-2 rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-4 py-6 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
    >
      <span className="font-medium text-zinc-800 dark:text-zinc-100">
        {title}
      </span>
      <span>
        Backend support pending — tracked in <strong>{pendingSprint}</strong>.
      </span>
      {description ? (
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {description}
        </span>
      ) : null}
    </div>
  );
}
