import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  KvDeleteRequest,
  KvSetStringRequest,
  KvStreamReadRequest,
  KvTtlUpdateRequest,
  KvValueReadRequest,
} from "@/types/kv";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import * as kv from "./kv";

const kvExports = kv as unknown as Record<string, unknown>;

describe("KV Tauri wrappers", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("forwards Redis value, string, delete, TTL, and stream requests", async () => {
    const valueRequest: KvValueReadRequest = {
      database: 0,
      key: "profile:1",
      limit: 100,
    };
    const setRequest: KvSetStringRequest = {
      database: 0,
      key: "profile:1",
      value: "Ada",
      ttlSeconds: 30,
      safety: "rejectOverwrite",
    };
    const deleteRequest: KvDeleteRequest = {
      database: 0,
      key: "profile:1",
      confirmKey: "profile:1",
    };
    const ttlRequest: KvTtlUpdateRequest = {
      database: 0,
      key: "profile:1",
      update: { mode: "expire", seconds: 60 },
    };
    const streamRequest: KvStreamReadRequest = {
      database: 0,
      key: "events",
      start: "-",
      end: "+",
      limit: 25,
    };

    invokeMock
      .mockResolvedValueOnce({
        key: "profile:1",
        metadata: {
          key: "profile:1",
          keyType: "string",
          ttl: { state: "persistent" },
        },
        value: {
          type: "string",
          encoding: "utf8",
          text: "Ada",
          byteLength: 3,
        },
      })
      .mockResolvedValueOnce({
        key: "profile:1",
        changed: true,
        ttl: { state: "expires", seconds: 30 },
      })
      .mockResolvedValueOnce({ key: "profile:1", changed: true })
      .mockResolvedValueOnce({
        key: "profile:1",
        changed: true,
        ttl: { state: "expires", seconds: 60 },
      })
      .mockResolvedValueOnce({
        key: "events",
        entries: [{ id: "1-0", fields: [{ field: "type", value: "login" }] }],
        start: "-",
        end: "+",
        limit: 25,
      });

    await callKvWrapper("getKvValue", "redis-1", valueRequest, "read-1");
    expect(invokeMock).toHaveBeenLastCalledWith("get_kv_value", {
      connectionId: "redis-1",
      request: valueRequest,
      queryId: "read-1",
    });

    await callKvWrapper("setKvStringValue", "redis-1", setRequest);
    expect(invokeMock).toHaveBeenLastCalledWith("set_kv_string_value", {
      connectionId: "redis-1",
      request: setRequest,
    });

    await callKvWrapper("deleteKvKey", "redis-1", deleteRequest);
    expect(invokeMock).toHaveBeenLastCalledWith("delete_kv_key", {
      connectionId: "redis-1",
      request: deleteRequest,
    });

    await callKvWrapper("updateKvTtl", "redis-1", ttlRequest);
    expect(invokeMock).toHaveBeenLastCalledWith("update_kv_ttl", {
      connectionId: "redis-1",
      request: ttlRequest,
    });

    await callKvWrapper("readKvStream", "redis-1", streamRequest, "stream-1");
    expect(invokeMock).toHaveBeenLastCalledWith("read_kv_stream", {
      connectionId: "redis-1",
      request: streamRequest,
      queryId: "stream-1",
    });
  });
});

async function callKvWrapper(name: string, ...args: unknown[]) {
  const wrapper = kvExports[name];
  expect(wrapper).toBeTypeOf("function");
  if (typeof wrapper !== "function") {
    throw new Error(`Missing KV wrapper: ${name}`);
  }
  return wrapper(...args);
}
