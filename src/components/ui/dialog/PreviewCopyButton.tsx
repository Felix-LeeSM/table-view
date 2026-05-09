import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@components/ui/button";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Sprint 252 (2026-05-09) — Reusable Copy button for Preview dialogs.
//
// Why extract: PreviewDialog (`src/components/ui/dialog/PreviewDialog.tsx`)
// and DataGrid's inline SQL preview (`src/components/rdb/DataGrid.tsx`) both
// need the same affordance — testid-stable Copy button + transient
// "Copied" / "Copy failed" feedback + unmount-safe setTimeout cleanup. Two
// separate copies would drift; one component keeps the state machine in a
// single place.
//
// State machine: idle → success (1500 ms) → idle, idle → failure (2000 ms) →
// idle. Pending timer is cleared on unmount and on every new click so a
// second click during the transient window restarts the label correctly.
// ---------------------------------------------------------------------------

export interface PreviewCopyButtonProps {
  /** Text to write to the clipboard. Empty/whitespace → button NOT rendered. */
  text: string;
  /** ARIA label override. Defaults to "Copy". */
  ariaLabel?: string;
  /** Optional className passthrough for the underlying Button. */
  className?: string;
}

type CopyStatus = "idle" | "success" | "failure";

const SUCCESS_TIMEOUT_MS = 1500;
const FAILURE_TIMEOUT_MS = 2000;

const LABEL: Record<CopyStatus, string> = {
  idle: "Copy",
  success: "Copied",
  failure: "Copy failed",
};

export default function PreviewCopyButton({
  text,
  ariaLabel = "Copy",
  className,
}: PreviewCopyButtonProps) {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks mounted state so a late-resolving clipboard promise after
  // unmount doesn't call setStatus on a dead component.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const scheduleRevert = useCallback((ms: number) => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (mountedRef.current) {
        setStatus("idle");
      }
    }, ms);
  }, []);

  const handleClick = useCallback(async () => {
    const carrier = navigator.clipboard?.writeText?.bind(navigator.clipboard);
    if (!carrier) {
      // Carrier unavailable (e.g. insecure context, jsdom without polyfill).
      // Surface the failure path so the user is not left wondering.
      console.error(
        "Clipboard API unavailable: navigator.clipboard.writeText is missing",
      );
      if (mountedRef.current) setStatus("failure");
      scheduleRevert(FAILURE_TIMEOUT_MS);
      return;
    }
    try {
      await carrier(text);
      if (mountedRef.current) setStatus("success");
      scheduleRevert(SUCCESS_TIMEOUT_MS);
    } catch (err) {
      // Carrier rejected. Log + surface transient failure label.
      console.error("Clipboard writeText failed:", err);
      if (mountedRef.current) setStatus("failure");
      scheduleRevert(FAILURE_TIMEOUT_MS);
    }
  }, [text, scheduleRevert]);

  // AC-252-04: empty/whitespace-only text → render nothing. Caller does not
  // need a separate disabled affordance; the button simply absents itself.
  if (text.trim() === "") return null;

  const Icon = status === "success" ? Check : Copy;
  const label = LABEL[status];

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => void handleClick()}
      data-testid="preview-dialog-copy"
      aria-label={ariaLabel}
      className={cn("gap-1.5", className)}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      <span>{label}</span>
    </Button>
  );
}
