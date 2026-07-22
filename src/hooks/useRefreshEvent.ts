import { useEffect, useRef } from "react";

/**
 * #1718 (Part of #1717) — subscribe a callback to one of the global
 * soft-refresh window events App broadcasts on Cmd+R:
 *   - `refresh-data`      — records-grid refetch (RDB + document grids)
 *   - `refresh-structure` — structure/detail refetch (RDB/Mongo structure,
 *                           search index detail, KV key detail)
 *
 * App routes `refresh-data` through the #1705 discard-confirm before it fires,
 * so consumers can refetch unconditionally on receipt. The latest `onRefresh`
 * is held in a ref so the listener subscribes once and always calls the
 * freshest closure — callers need not memoise the callback.
 */
export function useRefreshEvent(
  event: "refresh-data" | "refresh-structure",
  onRefresh: () => void,
): void {
  const ref = useRef(onRefresh);
  ref.current = onRefresh;
  useEffect(() => {
    const handler = () => ref.current();
    window.addEventListener(event, handler);
    return () => window.removeEventListener(event, handler);
  }, [event]);
}
