import { useCallback, useEffect, useMemo, useState } from "react";

import {
  type ColumnPrefsPk,
  getDatagridPrefs,
  setDatagridPrefs,
} from "@/lib/tauri/datagrid_prefs";

/**
 * Sprint 317 — DataGrid column hide / show 상태 관리 훅.
 * Sprint 369 (Phase 4) — 영속 매체 localStorage → SQLite SOT 전환.
 *
 * - `pk` 가 주어지면 mount 시 `get_datagrid_prefs` IPC 1회로 hydrate,
 *   hide/show/toggle/clear 호출 시 `set_datagrid_prefs` 의 hiddenColumns
 *   patch 전송 (widths 는 미포함 → backend 가 보존).
 * - `pk` 미제공 (ad-hoc / 임시 grid) 은 in-memory only — IPC / LS 접근 모두 0.
 *
 * codex 7차 #1 — hidden 변경이 widths 를 건드리지 않는 invariant 는 backend 가
 * partial patch 로 보장. 본 hook 은 `widths` 필드를 patch 에 미포함시킴으로써
 * 그 보장을 호출 시점에 갖춘다.
 */

export interface UseHiddenColumnsResult {
  hidden: ReadonlySet<string>;
  hide: (name: string) => void;
  show: (name: string) => void;
  toggle: (name: string) => void;
  clear: () => void;
  isHidden: (name: string) => boolean;
}

export function useHiddenColumns(pk?: ColumnPrefsPk): UseHiddenColumnsResult {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  // Stable signature for the IPC effect — JSON identity over the 5-tuple.
  const pkKey = pk ? JSON.stringify(pk) : null;

  // Mount + pk swap: hydrate from SQLite.
  useEffect(() => {
    if (!pk) {
      // pk 가 사라지면 (in-memory mode 로 전환) hidden 도 초기화.
      setHidden(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const resp = await getDatagridPrefs(pk);
        if (cancelled) return;
        setHidden(new Set(resp.hiddenColumns));
      } catch {
        // best-effort hydrate. 실패 시 빈 set 유지.
      }
    })();
    return () => {
      cancelled = true;
    };
    // Key off the stable `pkKey` string, not the `pk` object — `pk` is a fresh
    // reference each render, so depending on it would re-hydrate every render.
    // `setHidden` is a stable setter (cf. useColumnWidths).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkKey]);

  // hidden 변경을 backend 로 전송. 인자는 *다음* set — react state 의 stale
  // closure 위험을 피하기 위해 호출자가 직접 넘긴다.
  const persist = useCallback(
    (next: Set<string>) => {
      if (!pk) return;
      void setDatagridPrefs({
        ...pk,
        hiddenColumns: Array.from(next),
      }).catch(() => {
        /* best-effort — next mutate will retry */
      });
    },
    [pk],
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
