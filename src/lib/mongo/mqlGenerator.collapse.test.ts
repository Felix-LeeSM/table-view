import { describe, it, expect } from "vitest";
import {
  generateMqlPreview,
  type MqlGenerateInput,
  type MqlGridColumn,
} from "./mqlGenerator";

// ---------------------------------------------------------------------------
// Purpose: MongoDB code 40 prefix-overlap conflict 회귀 가드 — user report
// 2026-07-18 (2차 버그, #1699 이후). 한 커밋에서 컨테이너를 추가한 뒤 그 안을
// 채우면 부모 경로와 자식 경로가 같은 update patch 에 함께 방출된다
// (`$set: { "tags.1": {…}, "tags.1.test": 3 }`). MongoDB 는 한 update 문서에서
// 부모+자식 경로 동시 수정을 금지 → WriteError code 40
// ("Updating the path 'tags.1.test' would create a conflict at 'tags.1'").
// 해소: 자식들을 부모의 객체 값 위에 deep-merge 해 부모 경로 하나만 방출.
// 어떤 편집도 조용히 버리지 않는다 (부모 객체의 기존 필드 보존).
// Split out of mqlGenerator.test.ts to stay under the max-lines cap.
// ---------------------------------------------------------------------------

const HEX_A = "507f1f77bcf86cd799439011";

/** Minimal input builder — callers override columns/rows/pendingEdits per case. */
function makeInput(
  overrides: Partial<MqlGenerateInput> = {},
): MqlGenerateInput {
  return {
    database: "app",
    collection: "users",
    columns: [{ name: "_id", data_type: "objectId", is_primary_key: true }],
    rows: [[{ $oid: HEX_A }]],
    page: 1,
    pendingEdits: new Map(),
    pendingDeletedRowKeys: new Set(),
    pendingNewRows: [],
    ...overrides,
  };
}

const COLS_DOC: MqlGridColumn[] = [
  { name: "_id", data_type: "objectId", is_primary_key: true },
  { name: "a", data_type: "document", is_primary_key: false },
];
const COLS_ARR: MqlGridColumn[] = [
  { name: "_id", data_type: "objectId", is_primary_key: true },
  { name: "tags", data_type: "array", is_primary_key: false },
];

/** `commands[0].patch.$set` (narrowed past the `MqlCommand` union). */
function setOf(command: unknown): Record<string, unknown> {
  return (command as { patch: { $set: Record<string, unknown> } }).patch.$set;
}
function patchOf(command: unknown): Record<string, unknown> {
  return (command as { patch: Record<string, unknown> }).patch;
}

describe("generateMqlPreview — code 40 prefix-overlap collapse (user report 2026-07-18)", () => {
  // 1. 빈 객체 추가 후 그 안을 채우는 흐름: `a` = {} 그리고 `a.b` = 3.
  it("merges a child into a freshly-added empty-object parent (a={} + a.b=3)", () => {
    const { commands, errors } = generateMqlPreview(
      makeInput({
        columns: COLS_DOC,
        rows: [[{ $oid: HEX_A }, "{...}"]],
        pendingEdits: new Map<string, unknown>([
          ["0-1", {}],
          ["0-1:b", 3],
        ]),
      }),
    );
    expect(errors).toEqual([]);
    // No conflict: only the parent path is emitted, child folded into it.
    expect(commands[0]).toMatchObject({ patch: { $set: { a: { b: 3 } } } });
    expect(Object.keys(setOf(commands[0]))).toEqual(["a"]);
  });

  // 2. 부모 객체의 기존 필드는 병합 시 보존되어야 한다.
  it("preserves existing parent fields when folding a child (a={x:1} + a.b=3)", () => {
    const { commands, errors } = generateMqlPreview(
      makeInput({
        columns: COLS_DOC,
        rows: [[{ $oid: HEX_A }, "{...}"]],
        pendingEdits: new Map<string, unknown>([
          ["0-1", { x: 1 }],
          ["0-1:b", 3],
        ]),
      }),
    );
    expect(errors).toEqual([]);
    expect(commands[0]).toMatchObject({
      patch: { $set: { a: { x: 1, b: 3 } } },
    });
  });

  // 3. 배열 원소 케이스 (user 실제 증상): `tags.1` = {…} + `tags.1.test` = 3.
  //    grid 는 non-string 커밋 값을 `__bson__:` 로 태그하므로 언랩 후 병합.
  it("merges a nested-array-element parent and its new key (tags.1 + tags.1.test)", () => {
    const { commands, errors } = generateMqlPreview(
      makeInput({
        columns: COLS_ARR,
        rows: [[{ $oid: HEX_A }, "[2 items]"]],
        pendingEdits: new Map<string, unknown>([
          ["0-1:[1]", `__bson__:${JSON.stringify({ name: "x" })}`],
          ["0-1:[1].test", "__bson__:3"],
        ]),
      }),
    );
    expect(errors).toEqual([]);
    expect(commands[0]).toMatchObject({
      patch: { $set: { "tags.1": { name: "x", test: 3 } } },
    });
    expect(Object.keys(setOf(commands[0]))).toEqual(["tags.1"]);
  });

  // 4. 여러 레벨 병합: `a`={} + `a.b`={} + `a.b.c`=3.
  it("merges across two nesting levels (a={} + a.b={} + a.b.c=3)", () => {
    const { commands, errors } = generateMqlPreview(
      makeInput({
        columns: COLS_DOC,
        rows: [[{ $oid: HEX_A }, "{...}"]],
        pendingEdits: new Map<string, unknown>([
          ["0-1", {}],
          ["0-1:b", {}],
          ["0-1:b.c", 3],
        ]),
      }),
    );
    expect(errors).toEqual([]);
    expect(commands[0]).toMatchObject({
      patch: { $set: { a: { b: { c: 3 } } } },
    });
  });

  // 5. $unset 자식 병합: 부모 $set 객체에서 자식 필드를 deep-delete (code 40 회피).
  it("applies an $unset child by deep-deleting from the parent $set object", () => {
    const { commands, errors } = generateMqlPreview(
      makeInput({
        columns: COLS_DOC,
        rows: [[{ $oid: HEX_A }, "{...}"]],
        pendingEdits: new Map<string, unknown>([
          ["0-1", { x: 1, drop: 9 }],
          ["0-1:drop", "__op__:unset"],
        ]),
      }),
    );
    expect(errors).toEqual([]);
    expect(commands[0]).toMatchObject({ patch: { $set: { a: { x: 1 } } } });
    // The overlap is collapsed into $set only — no conflicting $unset key.
    expect(patchOf(commands[0])).not.toHaveProperty("$unset");
  });

  // 6. 부모 $unset 이 자식을 subsume: 부모 전체 삭제가 자식 편집을 흡수.
  it("drops a child edit subsumed by an $unset of its parent", () => {
    const { commands, errors } = generateMqlPreview(
      makeInput({
        columns: COLS_DOC,
        rows: [[{ $oid: HEX_A }, "{...}"]],
        pendingEdits: new Map<string, unknown>([
          ["0-1", "__op__:unset"],
          ["0-1:b", 3],
        ]),
      }),
    );
    expect(errors).toEqual([]);
    expect(commands[0]).toMatchObject({ patch: { $unset: { a: "" } } });
    expect(patchOf(commands[0])).not.toHaveProperty("$set");
  });

  // 7. 회귀 가드: 자식만·부모만·서로 다른 원소는 병합/충돌 없이 그대로.
  it("leaves non-overlapping paths untouched (child-only, parent-only, sibling elements)", () => {
    const childOnly = generateMqlPreview(
      makeInput({
        columns: COLS_DOC,
        rows: [[{ $oid: HEX_A }, "{...}"]],
        pendingEdits: new Map<string, unknown>([["0-1:b", 3]]),
      }),
    );
    expect(childOnly.errors).toEqual([]);
    expect(childOnly.commands[0]).toMatchObject({
      patch: { $set: { "a.b": 3 } },
    });

    const parentOnly = generateMqlPreview(
      makeInput({
        columns: COLS_DOC,
        rows: [[{ $oid: HEX_A }, "{...}"]],
        pendingEdits: new Map<string, unknown>([["0-1", { y: 1 }]]),
      }),
    );
    expect(parentOnly.errors).toEqual([]);
    expect(parentOnly.commands[0]).toMatchObject({
      patch: { $set: { a: { y: 1 } } },
    });

    const siblings = generateMqlPreview(
      makeInput({
        columns: COLS_ARR,
        rows: [[{ $oid: HEX_A }, "[2 items]"]],
        pendingEdits: new Map<string, unknown>([
          ["0-1:[0].x", 1],
          ["0-1:[1].y", 2],
        ]),
      }),
    );
    expect(siblings.errors).toEqual([]);
    expect(siblings.commands[0]).toMatchObject({
      patch: { $set: { "tags.0.x": 1, "tags.1.y": 2 } },
    });
  });
});
