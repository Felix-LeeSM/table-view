import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KvKeyScanPage } from "@/types/kv";
import {
  REDIS_KEY_SUGGESTION_SCAN_LIMIT,
  useRedisKeySuggestions,
} from "./useRedisKeySuggestions";

const scanKvKeysMock = vi.hoisted(() => vi.fn());

vi.mock("@lib/tauri/kv", () => ({
  scanKvKeys: (...args: unknown[]) => scanKvKeysMock(...args),
}));

function page(
  database: number,
  keys: readonly KvKeyScanPage["keys"][number][],
): KvKeyScanPage {
  return {
    database,
    cursor: "0",
    nextCursor: "0",
    done: true,
    limit: REDIS_KEY_SUGGESTION_SCAN_LIMIT,
    keys: [...keys],
  };
}

describe("useRedisKeySuggestions", () => {
  beforeEach(() => {
    scanKvKeysMock.mockReset();
  });

  it("scans the query tab Redis database with a bounded first page", async () => {
    const keys = [
      {
        key: "profile:1",
        keyType: "string",
        ttl: { state: "persistent" },
      },
    ] as const;
    scanKvKeysMock.mockResolvedValueOnce(page(2, keys));

    const { result } = renderHook(() =>
      useRedisKeySuggestions({
        connectionId: "conn-redis",
        database: "2",
        enabled: true,
      }),
    );

    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(scanKvKeysMock).toHaveBeenCalledWith("conn-redis", {
      database: 2,
      cursor: "0",
      pattern: "*",
      limit: REDIS_KEY_SUGGESTION_SCAN_LIMIT,
    });
    expect(result.current.keySuggestions).toEqual(keys);
  });

  it("does not scan invalid Redis database labels", () => {
    const { result } = renderHook(() =>
      useRedisKeySuggestions({
        connectionId: "conn-redis",
        database: "not-a-db",
        enabled: true,
      }),
    );

    expect(scanKvKeysMock).not.toHaveBeenCalled();
    expect(result.current.keySuggestions).toEqual([]);
    expect(result.current.status).toBe("error");
  });

  it("falls back to no suggestions when scan fails", async () => {
    scanKvKeysMock.mockRejectedValueOnce(new Error("scan denied"));

    const { result } = renderHook(() =>
      useRedisKeySuggestions({
        connectionId: "conn-redis",
        database: "0",
        enabled: true,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.keySuggestions).toEqual([]);
    expect(result.current.error).toBe("scan denied");
  });

  it("clears stale keys while loading a different database", async () => {
    scanKvKeysMock
      .mockResolvedValueOnce(
        page(0, [
          {
            key: "db0:key",
            keyType: "string",
            ttl: { state: "persistent" },
          },
        ]),
      )
      .mockImplementationOnce(() => new Promise(() => {}));

    const { result, rerender } = renderHook(
      ({ database }) =>
        useRedisKeySuggestions({
          connectionId: "conn-redis",
          database,
          enabled: true,
        }),
      { initialProps: { database: "0" } },
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.keySuggestions.map((item) => item.key)).toEqual([
      "db0:key",
    ]);

    await act(async () => {
      rerender({ database: "2" });
    });

    await waitFor(() => expect(result.current.status).toBe("loading"));
    expect(result.current.keySuggestions).toEqual([]);
    expect(scanKvKeysMock).toHaveBeenLastCalledWith("conn-redis", {
      database: 2,
      cursor: "0",
      pattern: "*",
      limit: REDIS_KEY_SUGGESTION_SCAN_LIMIT,
    });
  });
});
