// 2026-05-15 — Slice E.1: schemaless schema accumulator hook.
//
// Reason: locks regressions in the hook that absorbs column changes across
// pages of a schemaless collection: (a) union accumulation, (b) `_id` first
// + alphabetical order, (c) type first-wins, (d) auto-reset when
// `(connId, db, coll)` changes.

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DocumentColumn } from "@/types/document";
import { useDocumentSchemaAccumulator } from "./useDocumentSchemaAccumulator";

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
