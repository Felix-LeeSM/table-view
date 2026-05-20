// Sprint 319 (2026-05-15) — Slice E.1: schemaless schema accumulator hook.
//
// 작성 이유: schemaless collection 의 페이지 간 column 변동을
// 흡수하는 hook 의 (a) union 누적, (b) `_id` first + 알파벳 정렬,
// (c) type first-wins, (d) `(connId, db, coll)` 변경시 auto-reset
// 회귀를 lock.

import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDocumentSchemaAccumulator } from "./useDocumentSchemaAccumulator";
import type { DocumentColumn } from "@/types/document";

function col(name: string, dataType = "string"): DocumentColumn {
  return { name, dataType, category: "unknown" };
}

describe("useDocumentSchemaAccumulator (Sprint 319 E.1)", () => {
  it("starts empty", () => {
    const { result } = renderHook(() => useDocumentSchemaAccumulator());
    expect(result.current.columns).toEqual([]);
  });

  it("merges incoming columns into the accumulator", () => {
    const { result } = renderHook(() => useDocumentSchemaAccumulator());
    act(() => {
      result.current.merge([col("_id", "ObjectId"), col("name")]);
    });
    expect(result.current.columns.map((c) => c.name)).toEqual(["_id", "name"]);
  });

  it("preserves existing fields when subsequent merges introduce new ones", () => {
    const { result } = renderHook(() => useDocumentSchemaAccumulator());
    act(() => {
      result.current.merge([col("_id", "ObjectId"), col("name")]);
    });
    act(() => {
      result.current.merge([col("email"), col("age", "int")]);
    });
    // `_id` pinned first, the rest alphabetical (case-insensitive).
    expect(result.current.columns.map((c) => c.name)).toEqual([
      "_id",
      "age",
      "email",
      "name",
    ]);
  });

  it("orders `_id` first, then case-insensitive alphabetical", () => {
    const { result } = renderHook(() => useDocumentSchemaAccumulator());
    act(() => {
      result.current.merge([
        col("ZipCode"),
        col("apple"),
        col("_id", "ObjectId"),
        col("Banana"),
      ]);
    });
    expect(result.current.columns.map((c) => c.name)).toEqual([
      "_id",
      "apple",
      "Banana",
      "ZipCode",
    ]);
  });

  it("keeps the first-seen type for a given field (first-wins)", () => {
    const { result } = renderHook(() => useDocumentSchemaAccumulator());
    act(() => {
      result.current.merge([col("score", "int")]);
    });
    act(() => {
      // a later page surfaces the same field with a different inferred
      // type — accumulator must NOT overwrite the original.
      result.current.merge([col("score", "string")]);
    });
    expect(
      result.current.columns.find((c) => c.name === "score")?.dataType,
    ).toBe("int");
  });

  it("reset() wipes the accumulator back to empty", () => {
    const { result } = renderHook(() => useDocumentSchemaAccumulator());
    act(() => {
      result.current.merge([col("_id", "ObjectId"), col("name")]);
    });
    act(() => {
      result.current.reset();
    });
    expect(result.current.columns).toEqual([]);
  });

  it("auto-resets when the (connId, db, collection) triple changes", () => {
    const { result, rerender } = renderHook(
      ({ key }: { key: { connId: string; db: string; collection: string } }) =>
        useDocumentSchemaAccumulator(key),
      {
        initialProps: {
          key: { connId: "c1", db: "d1", collection: "users" },
        },
      },
    );
    act(() => {
      result.current.merge([col("_id"), col("name")]);
    });
    expect(result.current.columns.map((c) => c.name)).toEqual(["_id", "name"]);

    // Switch collections — accumulator must clear so the next merge
    // doesn't leak fields from `users`.
    rerender({ key: { connId: "c1", db: "d1", collection: "orders" } });
    expect(result.current.columns).toEqual([]);

    act(() => {
      result.current.merge([col("_id"), col("total", "decimal")]);
    });
    expect(result.current.columns.map((c) => c.name)).toEqual(["_id", "total"]);
  });
});
