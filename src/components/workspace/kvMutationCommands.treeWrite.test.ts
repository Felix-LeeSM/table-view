import { describe, expect, it } from "vitest";
import {
  buildTreeWriteMutation,
  type KvEntryPayload,
  type KvTreeWriteTarget,
  treeWriteTargetForEntry,
} from "./kvMutationCommands";

// Purpose: KV JSON tree write command mapping (PR4, 2026-07-18) — the pure
// boundary that turns a re-serialized tree value + a write target into the
// exact overwrite command. This is the lowest layer where the four-way mapping
// (SET / JSON.SET / HSET / LSET) and the preview==execution invariant live, so
// the UI tests above can trust the string without re-deriving it.

describe("buildTreeWriteMutation", () => {
  // Reason: a `string` key routes through the typed set_kv_string_value command
  // (kind "string" + value payload), not the raw command bridge (2026-07-18).
  it("maps a string target to a SET-tier mutation carrying the raw JSON value", () => {
    const mutation = buildTreeWriteMutation(
      { kind: "string", key: "doc:1" },
      '{"n":2}',
    );
    expect(mutation.kind).toBe("string");
    expect(mutation.value).toBe('{"n":2}');
    expect(mutation.summary).toBe('SET doc:1 "{\\"n\\":2}"');
  });

  // Reason: a `json` key overwrites the whole ReJSON slot via JSON.SET at the
  // bounded root path `$`, executed through execute_kv_command (2026-07-18).
  it("maps a json target to a JSON.SET root-path command", () => {
    const mutation = buildTreeWriteMutation(
      { kind: "json", key: "doc:1" },
      '{"n":2}',
    );
    expect(mutation.kind).toBe("command");
    expect(mutation.command).toBe('JSON.SET doc:1 $ "{\\"n\\":2}"');
    // preview == execution: the previewed summary is exactly the run command.
    expect(mutation.summary).toBe(mutation.command);
  });

  // Reason: PR4 — a hash field JSON value writes the whole re-serialized value
  // via HSET, with the field key as a distinct quoted operand (2026-07-18).
  it("maps a hash target to HSET key field <json>", () => {
    const mutation = buildTreeWriteMutation(
      { kind: "hash", key: "user:1", field: "profile" },
      '{"plan":"pro"}',
    );
    expect(mutation.command).toBe(
      'HSET user:1 profile "{\\"plan\\":\\"pro\\"}"',
    );
    expect(mutation.summary).toBe(mutation.command);
  });

  // Reason: PR4 — a list element writes via LSET; the numeric index is emitted
  // raw (unquoted) so the bounded parser reads it as an integer (2026-07-18).
  it("maps a list target to LSET key index <json>, index unquoted", () => {
    const mutation = buildTreeWriteMutation(
      { kind: "list", key: "queue", index: 2 },
      '{"done":true}',
    );
    expect(mutation.command).toBe('LSET queue 2 "{\\"done\\":true}"');
  });

  // Reason: injection guard — a key/field with shell-significant characters is
  // quoted+escaped by redisToken so it can never break out into extra command
  // tokens (2026-07-18).
  it("quotes a field name containing whitespace so it stays one operand", () => {
    const mutation = buildTreeWriteMutation(
      { kind: "hash", key: "user:1", field: "full name" },
      "[]",
    );
    expect(mutation.command).toBe('HSET user:1 "full name" []');
  });
});

describe("treeWriteTargetForEntry", () => {
  // Reason: only hash fields and list elements are tree-editable in PR4; set
  // members and zSet entries are out of scope (PR5) and yield no target so the
  // cell stays read-only (2026-07-18).
  const cases: Array<[KvEntryPayload, KvTreeWriteTarget | null]> = [
    [
      { kind: "hash", field: "profile", value: "{}" },
      { kind: "hash", key: "k", field: "profile" },
    ],
    [
      { kind: "list", index: 3, value: "[]" },
      { kind: "list", key: "k", index: 3 },
    ],
    [{ kind: "set", member: "m" }, null],
    [{ kind: "zSet", member: "m", score: 1 }, null],
  ];

  it.each(cases)("maps %j to its write target", (payload, expected) => {
    expect(treeWriteTargetForEntry("k", payload)).toEqual(expected);
  });
});
