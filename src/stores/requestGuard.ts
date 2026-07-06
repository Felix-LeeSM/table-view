// Shared request-race guard (issue #1362)
//
// Three stores each owned a copy of the "drop a store write whose request was
// superseded across an await" logic with subtly different granularity:
//   - documentCatalogStore / documentQueryStore: a per-request-key counter
//     bumped at request start so a newer fetch supersedes an older in-flight
//     one (last-start-wins). Teardown DELETEs the matching keys.
//   - schemaStore: a per-connection generation bumped only on teardown
//     (`clearForConnection`) so a late resolve after disconnect is dropped.
//     The token is captured WITHOUT bumping, so the teardown must bump (not
//     delete) — deleting would reset the key to 0 and a captured generation of
//     0 would falsely re-match.
//
// Both flavors are the same Map<string, number> + "is my captured token still
// current" check, so one guard exposes both entry points. Each method mirrors
// exactly one of the former per-store helpers to keep semantics identical.

export interface RequestGuard {
  /**
   * Bump `key`'s token and return the new value. Call at request start so a
   * newer request supersedes an older one still in flight (last-start-wins).
   * Mirrors the former `nextRequestId`.
   */
  next(key: string): number;
  /**
   * True while `token` is still `key`'s latest value. Pairs with `next`.
   * Mirrors the former `isLatestRequest`.
   */
  isCurrent(key: string, token: number): boolean;
  /**
   * Bump `key`'s token without returning it, invalidating any in-flight
   * request that captured an earlier value (teardown). Mirrors the former
   * `bumpConnectionGeneration`.
   */
  bump(key: string): void;
  /**
   * Run `fetch`, then apply `commit` only if `key`'s token is unchanged across
   * the await. Captures the token WITHOUT bumping (pairs with `bump` on
   * teardown) and returns the fetched value either way. Mirrors the former
   * `writeIfCurrent`.
   */
  writeIfCurrent<T>(
    key: string,
    fetch: () => Promise<T>,
    commit: (result: T) => void,
  ): Promise<T>;
  /**
   * Drop every key matching `predicate` (per-connection eviction). Safe only
   * for the `next`/`isCurrent` flavor whose tokens are always >= 1. Mirrors the
   * former `clearCatalogCounters` / `clearQueryCounters`.
   */
  clear(predicate: (key: string) => boolean): void;
  /** Drop all tokens (test reset). */
  reset(): void;
}

export function createRequestGuard(): RequestGuard {
  const counters = new Map<string, number>();
  const tokenOf = (key: string): number => counters.get(key) ?? 0;

  return {
    next(key) {
      const token = tokenOf(key) + 1;
      counters.set(key, token);
      return token;
    },
    isCurrent(key, token) {
      return counters.get(key) === token;
    },
    bump(key) {
      counters.set(key, tokenOf(key) + 1);
    },
    async writeIfCurrent(key, fetch, commit) {
      const token = tokenOf(key);
      const result = await fetch();
      if (tokenOf(key) === token) commit(result);
      return result;
    },
    clear(predicate) {
      for (const key of [...counters.keys()]) {
        if (predicate(key)) counters.delete(key);
      }
    },
    reset() {
      counters.clear();
    },
  };
}
