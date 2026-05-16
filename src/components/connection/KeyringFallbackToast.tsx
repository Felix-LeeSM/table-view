/**
 * Sprint 356 (Phase 1, Q22) — Linux Secret Service / kwallet 미가용 환경
 * (AC-356-05) 에서 표시되는 1회용 안내 toast.
 *
 * 표시 조건:
 *   - `fallbackActive == true` : backend 의 `KeySource::DiskFallback` 신호.
 *   - `dismissed == false` : 사용자가 이전 boot 에서 dismiss 한 적 없음
 *     (`.keyring-fallback-dismissed` file sidecar 부재).
 *
 * Dismiss:
 *   - 사용자가 "Dismiss" 클릭 → IPC 로 file sidecar set → 즉시 toast 숨김.
 *   - IPC 실패 시에도 UI 는 숨긴다 (best-effort; 다음 boot 가 같은 환경이면
 *     toast 재출현, 사용자가 다시 dismiss 가능).
 *
 * 본 컴포넌트는 toast container 가 아니라 inline alert 다 — `Toaster()`
 * 가 boot 시점에 마운트되지 않을 수 있어 (frontend store hydration 전)
 * boot 후 첫 paint 에 안정적으로 보이도록 ConnectionList / Launcher 안에
 * 마운트한다. Phase 1 의 scope 는 표시 / dismiss / sentinel 쓰기까지.
 *
 * "Why?" link 는 sprint-356 의 out-of-scope (docs/security/keyring-fallback.md
 * 가 아직 없음). Phase 후속 sprint 에서 link 추가 예정.
 */

import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";

import { setKeyringFallbackDismissed } from "@/lib/keyringFallback";
import { cn } from "@/lib/utils";

export interface KeyringFallbackToastProps {
  /** Backend `migrate_or_initialize()` 가 `fallback_to_disk = true` 를 보고하면 set. */
  fallbackActive: boolean;
  /** File sidecar `.keyring-fallback-dismissed` 존재 여부. */
  dismissed: boolean;
}

export function KeyringFallbackToast({
  fallbackActive,
  dismissed,
}: KeyringFallbackToastProps) {
  // Local override so a click hides the toast immediately, without waiting
  // for a parent rerender after the IPC sentinel write resolves.
  const [hidden, setHidden] = useState(false);

  if (!fallbackActive || dismissed || hidden) {
    return null;
  }

  const handleDismiss = async () => {
    setHidden(true);
    try {
      await setKeyringFallbackDismissed();
    } catch (err) {
      // Best-effort sentinel write. If the backend / file write fails, we
      // still hide the UI for this session — the next boot re-evaluates
      // and the user can dismiss again. Log so devs spot persistent
      // failures.
      console.warn("keyring fallback dismiss IPC failed", err);
    }
  };

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-slot="keyring-fallback-toast"
      className={cn(
        "pointer-events-auto m-3 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning shadow-sm",
      )}
    >
      <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">
          Keyring unavailable — disk fallback active
        </div>
        <p className="mt-1 text-xs opacity-90">
          Your encryption key is stored on disk because the OS keyring (Secret
          Service / kwallet) is not reachable. Enable full-disk encryption to
          protect stored passwords against offline disk access.
        </p>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss notification"
        className="ml-1 inline-flex shrink-0 cursor-pointer rounded-sm p-0.5 opacity-70 outline-none hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
