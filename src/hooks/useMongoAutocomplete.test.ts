import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { EditorState } from "@codemirror/state";
import { json as jsonLanguage } from "@codemirror/lang-json";
import { useMongoAutocomplete } from "./useMongoAutocomplete";

describe("useMongoAutocomplete", () => {
  it("returns an array containing at least the autocomplete + highlight extensions", () => {
    const { result } = renderHook(() =>
      useMongoAutocomplete({ queryMode: "find" }),
    );
    expect(Array.isArray(result.current)).toBe(true);
    // autocompletion override + operator highlight = 2 entries.
    expect(result.current.length).toBe(2);
  });

  it("produces extensions that load without throwing alongside JSON", () => {
    const { result } = renderHook(() =>
      useMongoAutocomplete({
        queryMode: "aggregate",
        fieldNames: ["_id", "name"],
      }),
    );
    const state = EditorState.create({
      doc: "[]",
      extensions: [jsonLanguage(), ...result.current],
    });
    expect(state.doc.toString()).toBe("[]");
  });

  it("memoises the extension array across renders with stable inputs", () => {
    const { result, rerender } = renderHook(
      ({ mode }) => useMongoAutocomplete({ queryMode: mode }),
      { initialProps: { mode: "find" as const } },
    );
    const first = result.current;
    rerender({ mode: "find" });
    expect(result.current).toBe(first);
  });

  it("produces a new memo when queryMode flips", () => {
    const { result, rerender } = renderHook(
      ({ mode }: { mode: "find" | "aggregate" }) =>
        useMongoAutocomplete({ queryMode: mode }),
      { initialProps: { mode: "find" as "find" | "aggregate" } },
    );
    const first = result.current;
    rerender({ mode: "aggregate" });
    expect(result.current).not.toBe(first);
  });

  it("produces a new memo when fieldNames identity changes", () => {
    const { result, rerender } = renderHook(
      ({ fields }: { fields: readonly string[] | undefined }) =>
        useMongoAutocomplete({ queryMode: "find", fieldNames: fields }),
      {
        initialProps: { fields: ["_id"] as readonly string[] | undefined },
      },
    );
    const first = result.current;
    rerender({ fields: ["_id", "email"] });
    expect(result.current).not.toBe(first);
  });

  it("accepts undefined fieldNames without throwing", () => {
    expect(() =>
      renderHook(() =>
        useMongoAutocomplete({ queryMode: "find", fieldNames: undefined }),
      ),
    ).not.toThrow();
  });
});
