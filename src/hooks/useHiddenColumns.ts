import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Sprint 317 — DataGrid column hide / show 상태 관리 훅.
 *
 * `useColumnWidths` 의 패턴 (per-key localStorage persist + silent
 * fall-back on quota/disabled) 을 복제. 값은 `Set<string>` 으로 노출,
 * 저장은 JSON serializable `string[]`.
 *
 * - `persistenceKey` 가 주어지면 `hidden-columns:<key>` 로 mount 시
 *   load, hide/show/toggle/clear 시 save/clear.
 * - 미제공 시 in-memory only (ad-hoc query grid).
 */

export interface UseHiddenColumnsResult {
  hidden: ReadonlySet<string>;
  hide: (name: string) => void;
  show: (name: string) => void;
  toggle: (name: string) => void;
  clear: () => void;
  isHidden: (name: string) => boolean;
}

const STORAGE_PREFIX = "hidden-columns:";

function loadPersisted(key: string): Set<string> {
  if (typeof window === "undefined" || !window.localStorage) return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();
  }
}

function savePersisted(key: string, hidden: ReadonlySet<string>): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(
      STORAGE_PREFIX + key,
      JSON.stringify(Array.from(hidden)),
    );
  } catch {
    // quota / disabled → silent no-op. hide UX 우선.
  }
}

function clearPersisted(key: string): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.removeItem(STORAGE_PREFIX + key);
  } catch {
    // no-op.
  }
}

export function useHiddenColumns(
  persistenceKey?: string,
): UseHiddenColumnsResult {
  const [hidden, setHidden] = useState<Set<string>>(() =>
    persistenceKey ? loadPersisted(persistenceKey) : new Set(),
  );

  // persistenceKey 가 바뀌면 (다른 namespace 진입) 새 key 의 persisted
  // 값으로 swap.
  useEffect(() => {
    setHidden(persistenceKey ? loadPersisted(persistenceKey) : new Set());
  }, [persistenceKey]);

  const persist = useCallback(
    (next: Set<string>) => {
      if (!persistenceKey) return;
      if (next.size === 0) {
        clearPersisted(persistenceKey);
      } else {
        savePersisted(persistenceKey, next);
      }
    },
    [persistenceKey],
  );

  const hide = useCallback(
    (name: string) => {
      setHidden((prev) => {
        if (prev.has(name)) return prev;
        const next = new Set(prev);
        next.add(name);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const show = useCallback(
    (name: string) => {
      setHidden((prev) => {
        if (!prev.has(name)) return prev;
        const next = new Set(prev);
        next.delete(name);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const toggle = useCallback(
    (name: string) => {
      setHidden((prev) => {
        const next = new Set(prev);
        if (next.has(name)) {
          next.delete(name);
        } else {
          next.add(name);
        }
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const clear = useCallback(() => {
    setHidden(new Set());
    persist(new Set());
  }, [persist]);

  // Stable reference for callers that depend on `isHidden` identity in
  // memo/dep arrays.
  const isHidden = useMemo(() => (name: string) => hidden.has(name), [hidden]);

  return { hidden, hide, show, toggle, clear, isHidden };
}
