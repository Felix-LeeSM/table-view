/**
 * Issue #1821 — proof that the backend-resolved runtime capability actually
 * reaches the frontend through the `src/types/dataSource.ts` types, and that
 * every failure on the way lands fail-closed.
 *
 * The payloads below are the literal JSON the Rust `MongoRuntimeCapabilities`
 * serializes (see the wire assertions in
 * `src-tauri/table-view-core/src/models/mongo_runtime.rs`), so a rename on
 * either side breaks this test rather than silently degrading every gate to
 * "unknown" at runtime.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  type MongoRuntimeCapabilities,
  meetsMongoRuntimeRequirement,
} from "@/types/dataSource";
import { mongoRuntimeCapabilities } from "./mongoRuntimeCapabilities";

describe("mongoRuntimeCapabilities (#1821 wire)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("invokes `mongo_runtime_capabilities` with the connection id", async () => {
    invokeMock.mockResolvedValueOnce({ topology: "unknown" });

    await mongoRuntimeCapabilities("conn-1");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("mongo_runtime_capabilities", {
      connectionId: "conn-1",
    });
  });

  it("carries the backend's topology and parsed version into the typed value", async () => {
    invokeMock.mockResolvedValueOnce({
      topology: "sharded",
      version: { major: 4, minor: 9, patch: 0, raw: "4.9.0-rc0" },
    });

    const capabilities: MongoRuntimeCapabilities =
      await mongoRuntimeCapabilities("conn-1");

    expect(capabilities.topology).toBe("sharded");
    expect(capabilities.version).toEqual({
      major: 4,
      minor: 9,
      patch: 0,
      raw: "4.9.0-rc0",
    });
  });

  it("feeds a gate that opens for a server meeting the requirement", async () => {
    invokeMock.mockResolvedValueOnce({
      topology: "replicaSet",
      version: { major: 7, minor: 0, patch: 5, raw: "7.0.5" },
    });

    const capabilities = await mongoRuntimeCapabilities("conn-1");

    expect(
      meetsMongoRuntimeRequirement(capabilities, {
        minVersion: [4, 0, 0],
        topologies: ["replicaSet", "sharded"],
      }),
    ).toBe(true);
  });

  it("omits `version` when the server refused buildInfo, closing version gates", async () => {
    // Rust omits the field entirely rather than sending null — the same
    // `skip_serializing_if` convention `ConnectionStatus.activeDb` uses.
    invokeMock.mockResolvedValueOnce({ topology: "replicaSet" });

    const capabilities = await mongoRuntimeCapabilities("conn-1");

    expect(capabilities.version).toBeUndefined();
    expect(
      meetsMongoRuntimeRequirement(capabilities, { minVersion: [4, 0, 0] }),
    ).toBe(false);
    // The topology it *did* establish still works — the probes degrade
    // independently.
    expect(
      meetsMongoRuntimeRequirement(capabilities, {
        topologies: ["replicaSet"],
      }),
    ).toBe(true);
  });

  it.each([
    ["a non-object payload", "sharded"],
    ["null", null],
    ["a topology outside the wire enum", { topology: "mongos" }],
    [
      "a missing topology",
      { version: { major: 7, minor: 0, patch: 5, raw: "7.0.5" } },
    ],
    ["a prototype method name", { topology: "toString" }],
    ["a prototype accessor name", { topology: "__proto__" }],
  ])("degrades %s to the fail-closed value", async (_label, payload) => {
    invokeMock.mockResolvedValueOnce(payload);

    const capabilities = await mongoRuntimeCapabilities("conn-1");

    expect(capabilities.topology).toBe("unknown");
    expect(capabilities.version).toBeUndefined();
  });

  it.each(["standalone", "replicaSet", "sharded", "unknown"])(
    "keeps `%s` — the whole wire enum passes narrowing",
    async (topology) => {
      invokeMock.mockResolvedValueOnce({ topology });

      const capabilities = await mongoRuntimeCapabilities("conn-1");

      expect(capabilities.topology).toBe(topology);
    },
  );

  it.each([
    ["a partial triplet", { major: 7, patch: 5, raw: "7.0.5" }],
    [
      "a non-integer component",
      { major: 7, minor: 0.5, patch: 5, raw: "7.0.5" },
    ],
    [
      "a component past Rust's u32 range",
      { major: 1e21, minor: 0, patch: 5, raw: "7.0.5" },
    ],
    ["a negative component", { major: 7, minor: -1, patch: 5, raw: "7.0.5" }],
    [
      "a numeric string component",
      { major: "7", minor: 0, patch: 5, raw: "7.0.5" },
    ],
    ["a missing raw string", { major: 7, minor: 0, patch: 5 }],
  ])(
    "drops %s while keeping the topology it did establish",
    async (_label, version) => {
      invokeMock.mockResolvedValueOnce({ topology: "replicaSet", version });

      const capabilities = await mongoRuntimeCapabilities("conn-1");

      expect(capabilities.topology).toBe("replicaSet");
      expect(capabilities.version).toBeUndefined();
      expect(
        meetsMongoRuntimeRequirement(capabilities, { minVersion: [4, 0, 0] }),
      ).toBe(false);
      expect(
        meetsMongoRuntimeRequirement(capabilities, {
          topologies: ["replicaSet"],
        }),
      ).toBe(true);
    },
  );

  it("resolves fail-closed when the backend rejects", async () => {
    // `Unsupported` (connection is not MongoDB) and `NotFound` (connection is
    // gone) are routine, not exceptional. The wrapper must convert them into
    // "nothing known" here so no caller can mistake a rejection for support.
    invokeMock.mockRejectedValueOnce(
      new Error(
        "Unsupported: Operation requires a document (MongoDB) connection",
      ),
    );

    const capabilities = await mongoRuntimeCapabilities("redis-conn");

    expect(capabilities.topology).toBe("unknown");
    expect(capabilities.version).toBeUndefined();
    expect(
      meetsMongoRuntimeRequirement(capabilities, {
        minVersion: [4, 0, 0],
        topologies: ["replicaSet", "sharded"],
      }),
    ).toBe(false);
  });
});
