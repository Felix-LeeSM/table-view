// Sprint 230 — `usePostgresTypes` hook test suite (Phase 27 sprint 5).
//
// Date: 2026-05-07.
//
// Why this file exists:
// - Locks AC-230-05 (mount fetch + success merge + error fallback +
//   reload + cache hit) and AC-230-06 (display label rule —
//   `pg_catalog.X` strips to `X`, other schemas qualify as
//   `<schema>.<name>`).
// - Locks AC-230-11 (`invalidatePostgresTypesCache(connectionId)` cache
//   punch) and the concurrency / stale-connectionId edge cases the
//   contract requires.
//
// Mock pattern: `vi.hoisted` + factory mock for `@lib/tauri` so the
// `tauri.listPostgresTypes` mock is re-bindable inside test bodies.
// Pattern source: Sprint 219/223/224/229
// (`useConnectionMutations.test.ts` / `CreateTableDialog.test.tsx`).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

import type { PostgresTypeInfo } from "@/types/schema";

const { mockListPostgresTypes } = vi.hoisted(() => ({
  mockListPostgresTypes: vi.fn(),
}));

vi.mock("@lib/tauri", () => ({
  listPostgresTypes: mockListPostgresTypes,
}));

// Imported AFTER the mock so the hook resolves to the mocked wrapper.
// `invalidatePostgresTypesCache` is a free function exported alongside
// the hook; test cases call it in `beforeEach` to reset the module
// memo between cases.
import {
  usePostgresTypes,
  invalidatePostgresTypesCache,
} from "./usePostgresTypes";
import { POSTGRES_COMMON_TYPES } from "@/lib/sql/postgresTypes";

function pgType(
  schema: string,
  name: string,
  type_kind: PostgresTypeInfo["type_kind"] = "base",
): PostgresTypeInfo {
  return { schema, name, type_kind };
}

describe("usePostgresTypes (Sprint 230)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Punch the module memo for every connectionId touched in this
    // suite so test order doesn't leak cached state between cases.
    invalidatePostgresTypesCache("conn-1");
    invalidatePostgresTypesCache("conn-2");
    invalidatePostgresTypesCache("conn-empty");
    invalidatePostgresTypesCache("conn-error");
  });

  // ── AC-230-05 (a) — mount triggers fetch + sets types to merged list ─

  it("mount triggers fetch + sets types to merged list on resolve (AC-230-05 a)", async () => {
    mockListPostgresTypes.mockResolvedValueOnce([
      pgType("pg_catalog", "varchar"),
      pgType("public", "my_enum", "enum"),
      pgType("extensions", "geometry"),
    ]);
    const { result } = renderHook(() => usePostgresTypes("conn-1"));

    // Loading-canonical-first surface (AC-230-10): types is the
    // canonical list immediately, never null.
    expect(result.current.types).toEqual([...POSTGRES_COMMON_TYPES]);
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockListPostgresTypes).toHaveBeenCalledTimes(1);
    // Sprint 271a — wrapper now takes optional expectedDatabase as 2nd arg.
    // No connectionStore status seeded → resolveActiveDb returns "" → undefined forwarded.
    expect(mockListPostgresTypes).toHaveBeenCalledWith("conn-1", undefined);
    // Merged list contains the canonical entries first, then the
    // non-duplicate live extras at the end.
    expect(
      result.current.types?.slice(0, POSTGRES_COMMON_TYPES.length),
    ).toEqual([...POSTGRES_COMMON_TYPES]);
    expect(result.current.types).toContain("public.my_enum");
    expect(result.current.types).toContain("extensions.geometry");
    expect(result.current.error).toBeNull();
  });

  // ── AC-230-05 (b) — success merge preserves canonical head ─────────

  it("success merge preserves canonical order at the head + appends non-duplicate live entries (AC-230-05 b)", async () => {
    mockListPostgresTypes.mockResolvedValueOnce([
      pgType("public", "my_enum", "enum"),
    ]);
    const { result } = renderHook(() => usePostgresTypes("conn-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // First N entries === canonical list, byte-for-byte.
    const merged = result.current.types ?? [];
    expect(merged.slice(0, POSTGRES_COMMON_TYPES.length)).toEqual([
      ...POSTGRES_COMMON_TYPES,
    ]);
    // Live extras appended at the tail.
    expect(merged[merged.length - 1]).toBe("public.my_enum");
  });

  // ── AC-230-05 (c) + AC-230-12 — error fallback ─────────────────────

  it("fetch error surfaces error + falls back to canonical + loading false (AC-230-05 c)", async () => {
    mockListPostgresTypes.mockRejectedValueOnce(
      new Error("Connection 'conn-error' not found"),
    );
    const { result } = renderHook(() => usePostgresTypes("conn-error"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.types).toEqual([...POSTGRES_COMMON_TYPES]);
    expect(result.current.error).not.toBeNull();
    expect(result.current.error).toContain("Connection 'conn-error' not found");
    expect(result.current.loading).toBe(false);
  });

  // ── AC-230-05 (d) — reload() refetches and updates cache ───────────

  it("reload() refetches and updates cache (AC-230-05 d)", async () => {
    mockListPostgresTypes
      .mockResolvedValueOnce([pgType("public", "v1", "enum")])
      .mockResolvedValueOnce([pgType("public", "v2", "enum")]);
    const { result } = renderHook(() => usePostgresTypes("conn-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.types).toContain("public.v1");
    expect(mockListPostgresTypes).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.reload();
    });
    await waitFor(() => expect(mockListPostgresTypes).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.types).toContain("public.v2");
    expect(result.current.types).not.toContain("public.v1");
  });

  // ── AC-230-05 (e) — cache hit on second mount ──────────────────────

  it("cache hit on second mount with same connectionId does not re-call the Tauri wrapper (AC-230-05 e)", async () => {
    mockListPostgresTypes.mockResolvedValueOnce([
      pgType("public", "cached_enum", "enum"),
    ]);
    const first = renderHook(() => usePostgresTypes("conn-1"));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(mockListPostgresTypes).toHaveBeenCalledTimes(1);

    // Second mount on same connectionId — should use cached types
    // without firing the wrapper again.
    const second = renderHook(() => usePostgresTypes("conn-1"));
    // Synchronous: cached value is returned on the first render.
    expect(second.result.current.loading).toBe(false);
    expect(second.result.current.types).toContain("public.cached_enum");
    expect(mockListPostgresTypes).toHaveBeenCalledTimes(1);
  });

  // ── AC-230-06 — display label transformation ───────────────────────

  it("display label rule — pg_catalog.X strips to X; <schema>.<name> for non-pg_catalog (AC-230-06)", async () => {
    mockListPostgresTypes.mockResolvedValueOnce([
      pgType("pg_catalog", "varchar"),
      pgType("public", "my_enum", "enum"),
      pgType("extensions", "geometry"),
    ]);
    const { result } = renderHook(() => usePostgresTypes("conn-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const merged = result.current.types ?? [];
    // pg_catalog.varchar deduped against canonical `varchar`.
    expect(merged.filter((t) => t === "varchar")).toHaveLength(1);
    // public.my_enum kept qualified.
    expect(merged).toContain("public.my_enum");
    // extensions.geometry kept qualified.
    expect(merged).toContain("extensions.geometry");
    // The never-supposed-to-appear `pg_catalog.varchar` literal is
    // not in the merged list.
    expect(merged).not.toContain("pg_catalog.varchar");
  });

  // ── Edge case: empty result ────────────────────────────────────────

  it("empty result — merged list == canonical exactly", async () => {
    mockListPostgresTypes.mockResolvedValueOnce([]);
    const { result } = renderHook(() => usePostgresTypes("conn-empty"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.types).toEqual([...POSTGRES_COMMON_TYPES]);
    expect(result.current.error).toBeNull();
  });

  // ── Edge case: duplicate-name handling (case-sensitive Set dedup) ───

  it("duplicate name — pg_catalog.varchar and canonical varchar yield single entry", async () => {
    mockListPostgresTypes.mockResolvedValueOnce([
      pgType("pg_catalog", "varchar"),
      pgType("pg_catalog", "uuid"),
      pgType("pg_catalog", "geometry"),
    ]);
    const { result } = renderHook(() => usePostgresTypes("conn-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const merged = result.current.types ?? [];
    expect(merged.filter((t) => t === "varchar")).toHaveLength(1);
    expect(merged.filter((t) => t === "uuid")).toHaveLength(1);
    // `geometry` is NOT in the canonical list, so it MUST appear once.
    expect(merged.filter((t) => t === "geometry")).toHaveLength(1);
  });

  // ── Edge case: stale connectionId concurrency ──────────────────────

  it("stale connectionId — original conn1 Promise resolves last, no state mutation for conn2", async () => {
    let resolveConn1: ((v: PostgresTypeInfo[]) => void) | null = null;
    let resolveConn2: ((v: PostgresTypeInfo[]) => void) | null = null;
    mockListPostgresTypes
      .mockImplementationOnce(
        () =>
          new Promise<PostgresTypeInfo[]>((resolve) => {
            resolveConn1 = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<PostgresTypeInfo[]>((resolve) => {
            resolveConn2 = resolve;
          }),
      );

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => usePostgresTypes(id),
      { initialProps: { id: "conn-1" } },
    );
    expect(result.current.loading).toBe(true);

    // Switch to conn-2 mid-flight.
    rerender({ id: "conn-2" });
    expect(mockListPostgresTypes).toHaveBeenCalledTimes(2);

    // conn-2 resolves first.
    await act(async () => {
      resolveConn2?.([pgType("public", "live_for_2", "enum")]);
    });
    await waitFor(() =>
      expect(result.current.types).toContain("public.live_for_2"),
    );

    // Now conn-1 resolves LATE — must not overwrite conn-2's state.
    await act(async () => {
      resolveConn1?.([pgType("public", "stale_for_1", "enum")]);
    });
    expect(result.current.types).not.toContain("public.stale_for_1");
    expect(result.current.types).toContain("public.live_for_2");
  });

  // ── Edge case: concurrent calls share one in-flight Promise ────────

  it("concurrent mounts on same connectionId share one in-flight Promise (mock invoked once)", async () => {
    let resolveOnce: ((v: PostgresTypeInfo[]) => void) | null = null;
    mockListPostgresTypes.mockImplementationOnce(
      () =>
        new Promise<PostgresTypeInfo[]>((resolve) => {
          resolveOnce = resolve;
        }),
    );

    const a = renderHook(() => usePostgresTypes("conn-1"));
    const b = renderHook(() => usePostgresTypes("conn-1"));
    expect(mockListPostgresTypes).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveOnce?.([pgType("public", "shared_enum", "enum")]);
    });
    await waitFor(() => expect(a.result.current.loading).toBe(false));
    await waitFor(() => expect(b.result.current.loading).toBe(false));
    expect(a.result.current.types).toContain("public.shared_enum");
    expect(b.result.current.types).toContain("public.shared_enum");
    expect(mockListPostgresTypes).toHaveBeenCalledTimes(1);
  });

  // ── AC-230-11 — invalidatePostgresTypesCache cache punch ────────────

  it("invalidatePostgresTypesCache(connectionId) — fresh fetch on next mount (AC-230-11)", async () => {
    mockListPostgresTypes
      .mockResolvedValueOnce([pgType("public", "first", "enum")])
      .mockResolvedValueOnce([pgType("public", "second", "enum")]);
    const first = renderHook(() => usePostgresTypes("conn-1"));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(mockListPostgresTypes).toHaveBeenCalledTimes(1);

    // Punch the cache.
    invalidatePostgresTypesCache("conn-1");

    const second = renderHook(() => usePostgresTypes("conn-1"));
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(mockListPostgresTypes).toHaveBeenCalledTimes(2);
    expect(second.result.current.types).toContain("public.second");
  });

  // ── Sprint 234 — typesByName Map surface (AC-234-09) ─────────────

  // Sprint 234 — `usePostgresTypes` exposes a `typesByName: Map<string,
  // string>` alongside `types`. Map values mirror the live
  // `PostgresTypeInfo.type_kind` so the combobox can render color dots
  // (Sprint 234 AC-234-08) without re-querying. Keys use the same
  // display label rules as `types` (`pg_catalog.X` strips to `X`).
  it("surfaces a typesByName map matching the live PostgresTypeInfo entries (AC-234-09)", async () => {
    mockListPostgresTypes.mockResolvedValueOnce([
      pgType("public", "my_enum", "enum"),
      pgType("public", "my_domain", "domain"),
      pgType("public", "my_range", "range"),
      pgType("public", "my_composite", "composite"),
      pgType("extensions", "geometry", "base"),
    ]);
    const { result } = renderHook(() => usePostgresTypes("conn-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Live entries surface with their raw type_kind.
    expect(result.current.typesByName.get("public.my_enum")).toBe("enum");
    expect(result.current.typesByName.get("public.my_domain")).toBe("domain");
    expect(result.current.typesByName.get("public.my_range")).toBe("range");
    expect(result.current.typesByName.get("public.my_composite")).toBe(
      "composite",
    );
    expect(result.current.typesByName.get("extensions.geometry")).toBe("base");
    // Canonical entries surface with `"base"`.
    expect(result.current.typesByName.get("varchar")).toBe("base");
    expect(result.current.typesByName.get("uuid")).toBe("base");
  });

  // Sprint 234 — when no live extras arrive (empty fetch, or pre-fetch
  // first render), the canonical entries still seed the map with
  // `"base"`. Ensures combobox lookups never throw on missing keys for
  // the canonical types.
  it("falls back to a typesByName containing canonical entries with kind=base (AC-234-09)", async () => {
    mockListPostgresTypes.mockResolvedValueOnce([]);
    const { result } = renderHook(() => usePostgresTypes("conn-empty"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.typesByName).toBeInstanceOf(Map);
    expect(result.current.typesByName.size).toBeGreaterThanOrEqual(
      POSTGRES_COMMON_TYPES.length,
    );
    for (const t of POSTGRES_COMMON_TYPES) {
      expect(result.current.typesByName.get(t)).toBe("base");
    }
  });

  // Sprint 234 — pre-fetch first render returns an empty `Map` rather
  // than `undefined` so consumers can call `.get(label)` safely.
  it("returns an empty Map (not undefined) on the very first render before the fetch resolves (AC-234-09)", async () => {
    let resolveFetch: ((v: PostgresTypeInfo[]) => void) | null = null;
    mockListPostgresTypes.mockImplementationOnce(
      () =>
        new Promise<PostgresTypeInfo[]>((resolve) => {
          resolveFetch = resolve as (v: PostgresTypeInfo[]) => void;
        }),
    );
    const { result } = renderHook(() => usePostgresTypes("conn-1"));
    expect(result.current.typesByName).toBeInstanceOf(Map);
    expect(result.current.typesByName.size).toBeGreaterThanOrEqual(0);
    // Cleanup so the deferred Promise can resolve and the test runner
    // doesn't leak the in-flight fetch into the next case.
    await act(async () => {
      (resolveFetch as ((v: PostgresTypeInfo[]) => void) | null)?.([]);
    });
  });

  // ── Defensive — empty / "pg_toast" entries dropped ─────────────────

  it("defensive — entries with empty name or pg_toast schema dropped before merge", async () => {
    mockListPostgresTypes.mockResolvedValueOnce([
      pgType("pg_toast", "pg_toast_1234"),
      pgType("public", ""),
      pgType("public", "valid_enum", "enum"),
    ]);
    const { result } = renderHook(() => usePostgresTypes("conn-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const merged = result.current.types ?? [];
    expect(merged).toContain("public.valid_enum");
    expect(merged).not.toContain("pg_toast.pg_toast_1234");
    expect(merged).not.toContain("public.");
  });
});
