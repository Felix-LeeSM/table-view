import { KeyRound, SearchCode } from "lucide-react";

export interface UnsupportedShellNoticeProps {
  /**
   * The paradigm whose adapter has not been implemented yet. Sprint 126
   * onboards `kv` and `search` placeholders so new paradigms surface in
   * the sidebar at the same level of polish as the empty / connecting
   * states. Phase 9 (S136 / S137) will replace each with a real shell.
   */
  paradigm: "kv" | "search";
}

const PARADIGM_LABEL: Record<UnsupportedShellNoticeProps["paradigm"], string> =
  {
    kv: "Key-value",
    search: "Search",
  };

const PARADIGM_ARIA: Record<UnsupportedShellNoticeProps["paradigm"], string> = {
  kv: "Key-value workspace placeholder",
  search: "Search workspace placeholder",
};

/**
 * Sprint 126 — placeholder sidebar for paradigms without a dedicated
 * shell yet. Visual structure mirrors the existing `SchemaPanel` empty
 * states (centered icon + heading + body copy on a `select-none` flex
 * column) so the swap between supported and unsupported paradigms is
 * not jarring.
 *
 * Accessibility:
 * - `role="status"` so screen readers announce the message politely
 *   when the user opens an unsupported connection.
 * - `aria-label` is spelled out per-paradigm
 *   (e.g. `"Key-value workspace placeholder"`) so e2e selectors and
 *   assistive tech can address the notice unambiguously.
 */
export default function UnsupportedShellNotice({
  paradigm,
}: UnsupportedShellNoticeProps) {
  const Icon = paradigm === "kv" ? KeyRound : SearchCode;
  const label = PARADIGM_LABEL[paradigm];
  return (
    <div
      role="status"
      aria-label={PARADIGM_ARIA[paradigm]}
      className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center select-none"
    >
      <Icon size={36} className="mb-3 text-muted-foreground" />
      <p className="text-sm font-medium text-secondary-foreground">
        Not available yet
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {label} database support is planned but not yet implemented.
      </p>
    </div>
  );
}
