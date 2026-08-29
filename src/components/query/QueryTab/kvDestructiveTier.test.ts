import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  analyzeKvMutationSafety,
  buildStreamDeleteMutation,
  buildStreamTrimMutation,
  entryDeletePending,
  type PendingMutation,
} from "@/components/workspace/kvMutationCommands";
import type { EnvironmentTag } from "@/features/connection/model";
import { decideSafeModeAction, type SafeMode } from "@/lib/safeMode";
import type { ConnectionId, TabId } from "@/types/branded";
import type { KvKeyMetadata, KvKeyType, KvValueEnvelope } from "@/types/kv";
import {
  analyzeKvCommandSafety,
  executeKvCommandNow,
  executeKvQuery,
} from "./kvQueryExecution";

// Issue #2513 — the six Redis verbs the backend calls
// `RedisCommandEffect::Destructive` (`command_parser.rs`) were judged by where
// the user raised them: the KV structure editor routed them to the `danger`
// tier (`analyzeKvMutationSafety`) while the command console classified them
// `info`, so `decideSafeModeAction` answered `allow` in every tier and the
// command reached IPC with no dialog — production + `strict` included.
//
// One case per verb, on purpose: the defect is a per-verb omission from a map.
// Each case measures BOTH paths for its verb and asserts the two build the same
// command string, so "the console and the structure editor disagree about this
// command" is what fails rather than a tier constant somewhere.

const executeKvCommandMock = vi.hoisted(() => vi.fn());

vi.mock("@lib/tauri", () => ({
  executeKvCommand: (...args: unknown[]) => executeKvCommandMock(...args),
}));

const tab = {
  id: "query-redis" as TabId,
  connectionId: "conn-redis" as ConnectionId,
};

function createActions() {
  return {
    updateQueryState: vi.fn(),
    completeQuery: vi.fn(),
    failQuery: vi.fn(),
    recordHistory: vi.fn(),
    setPendingKvConfirm: vi.fn(),
  };
}

// Every Safe Mode tier, including the shipped default (non-production + `warn`)
// where `decideSafeModeAction` returns `allow` for `danger` by design
// (ADR 0022). The console has to reach the dialog anyway.
const TIERS: ReadonlyArray<[SafeMode, EnvironmentTag | null]> = [
  ["strict", "production"],
  ["warn", "production"],
  ["off", "production"],
  ["strict", null],
  ["warn", null],
  ["off", null],
];

const meta = (key: string, keyType: KvKeyType): KvKeyMetadata => ({
  key,
  keyType,
  ttl: { state: "persistent" },
});

const envelope = (
  key: string,
  keyType: KvKeyType,
  value: KvValueEnvelope["value"],
): KvValueEnvelope => ({ key, metadata: meta(key, keyType), value });

const hashValue = envelope("user:1", "hash", {
  type: "hash",
  fields: [
    { field: "name", value: "Ada" },
    { field: "city", value: "Seoul" },
  ],
  cursor: "0",
  nextCursor: "0",
  done: true,
  total: 2,
});

const listValue = envelope("user:1", "list", {
  type: "list",
  entries: [
    { index: 0, value: "ready" },
    { index: 1, value: "queued" },
  ],
  total: 2,
});

const setValue = envelope("user:1", "set", {
  type: "set",
  members: ["alpha", "beta"],
  cursor: "0",
  nextCursor: "0",
  done: true,
  total: 2,
});

const zSetValue = envelope("user:1", "zSet", {
  type: "zSet",
  entries: [
    { member: "alpha", score: 1 },
    { member: "beta", score: 2 },
  ],
  total: 2,
});

/** Passthrough translator — the notes it would produce are not asserted here. */
const tr = (key: string): string => key;

interface TierCase {
  verb: string;
  /** The key the structure editor is editing. */
  key: string;
  /** What the user types into the Redis command console. */
  command: string;
  /** What the structure editor builds for the same removal. */
  mutation: PendingMutation;
}

const CASES: TierCase[] = [
  {
    verb: "HDEL",
    key: "user:1",
    command: "HDEL user:1 name",
    mutation: entryDeletePending(
      { kind: "hash", field: "name", value: "Ada" },
      hashValue,
      tr,
    ),
  },
  {
    verb: "LREM",
    key: "user:1",
    command: "LREM user:1 1 ready",
    mutation: entryDeletePending(
      { kind: "list", index: 0, value: "ready" },
      listValue,
      tr,
    ),
  },
  {
    verb: "SREM",
    key: "user:1",
    command: "SREM user:1 alpha",
    mutation: entryDeletePending(
      { kind: "set", member: "alpha" },
      setValue,
      tr,
    ),
  },
  {
    verb: "ZREM",
    key: "user:1",
    command: "ZREM user:1 alpha",
    mutation: entryDeletePending(
      { kind: "zSet", member: "alpha", score: 1 },
      zSetValue,
      tr,
    ),
  },
  {
    verb: "XDEL",
    key: "events",
    command: "XDEL events 1-0",
    mutation: buildStreamDeleteMutation("events", "1-0"),
  },
  {
    verb: "XTRIM",
    key: "events",
    command: "XTRIM events MAXLEN 100",
    mutation: buildStreamTrimMutation("events", 100),
  },
];

describe("KV destructive verbs — console tier matches the structure editor", () => {
  beforeEach(() => {
    executeKvCommandMock.mockReset();
  });

  it.each(CASES)(
    "[kv-destructive-tier] $verb confirms before IPC in every Safe Mode tier and is danger on both paths",
    async ({ key, command, mutation }) => {
      // The two surfaces are talking about the same command.
      expect(mutation.command).toBe(command);

      // Console classifier — `info` here is what let the matrix answer `allow`.
      expect(analyzeKvCommandSafety(command).severity).toBe("danger");

      // Console router, every tier: staged for the dialog, nothing at IPC.
      for (const [mode, environment] of TIERS) {
        executeKvCommandMock.mockReset();
        const actions = createActions();
        await executeKvQuery({
          tab,
          sql: command,
          workspaceDb: "0",
          canExecuteQuery: true,
          queryProductLabel: "Redis",
          decideSafeMode: (analysis) =>
            decideSafeModeAction(mode, environment, analysis),
          ...actions,
        });

        expect(executeKvCommandMock).not.toHaveBeenCalled();
        expect(actions.setPendingKvConfirm).toHaveBeenCalledWith(
          expect.objectContaining({ command, database: 0 }),
        );
      }

      // Console dispatch seam — a run that never went through the dialog is
      // refused rather than sent, so a branch added later fails closed.
      executeKvCommandMock.mockReset();
      const actions = createActions();
      await executeKvCommandNow({
        tab,
        command,
        database: 0,
        updateQueryState: actions.updateQueryState,
        completeQuery: actions.completeQuery,
        failQuery: actions.failQuery,
        recordHistory: actions.recordHistory,
      });

      expect(executeKvCommandMock).not.toHaveBeenCalled();
      expect(actions.updateQueryState).toHaveBeenCalledWith("query-redis", {
        status: "error",
        error: expect.stringContaining(
          "Confirm it in the destructive-action dialog before running it.",
        ),
      });

      // Structure editor — same tier reached from a different input: the
      // mutation's `destructive` flag rather than the typed verb.
      // `useSafeModeGate` hands `decideSafeModeAction` the panel's mode and the
      // connection environment, so this is the decision the panel acts on.
      const analysis = analyzeKvMutationSafety(mutation, key);
      expect(analysis.severity).toBe("danger");

      // Which tiers open the dialog on that path. Production in every mode plus
      // non-production `strict` confirm; `KvKeyDetailPanel.elementCrud.test.tsx`
      // pins strict + non-production through the rendered panel, and the
      // production axis it leaves uncovered is asserted here.
      for (const [mode, environment] of TIERS) {
        const expected =
          environment === "production" || mode === "strict"
            ? "confirm"
            : // Non-production warn / off stay `allow` by ADR 0022, so the
              // panel's own preview -> confirm step is the whole gate there.
              // The console does NOT match on this axis: `kvDataLossReason`
              // overrides the matrix, so it dialogs in all six tiers above.
              "allow";
        expect(decideSafeModeAction(mode, environment, analysis).action).toBe(
          expected,
        );
      }
    },
  );
});
