import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { EditorState } from "@codemirror/state";
import { json as jsonLanguage } from "@codemirror/lang-json";
import { useMongoAutocomplete } from "./useMongoAutocomplete";

/**
 * Sprint 309 — Hook signature collapsed to a single dispatch surface.
 * The `queryMode` argument is gone (Find/Aggregate toggle removed from
 * `Toolbar.tsx`); the hook serves the union of find query operators +
 * aggregate stages + accumulators + type tags so the user can type any
 * mongosh expression without flipping a UI mode. Tests below assert the
 * new contract: arrayful return, memoised across stable renders, new
 * memo when `fieldNames` identity flips, and tolerant of `undefined`.
 *
 * The deleted "produces a new memo when queryMode flips" / "find vs
 * aggregate" cases (Sprint 139 era) are intentionally gone — there is
 * no queryMode parameter to flip anymore.
 */
describe("useMongoAutocomplete (Sprint 309 unified surface)", () => {
  it("returns an array containing at least the autocomplete + highlight extensions", () => {
    const { result } = renderHook(() => useMongoAutocomplete());
    expect(Array.isArray(result.current)).toBe(true);
    // autocompletion override + operator highlight = 2 entries.
    expect(result.current.length).toBe(2);
  });

  it("produces extensions that load without throwing alongside JSON", () => {
    const { result } = renderHook(() =>
      useMongoAutocomplete({ fieldNames: ["_id", "name"] }),
    );
    const state = EditorState.create({
      doc: "[]",
      extensions: [jsonLanguage(), ...result.current],
    });
    expect(state.doc.toString()).toBe("[]");
  });

  it("memoises the extension array across renders with stable inputs", () => {
    const { result, rerender } = renderHook(() => useMongoAutocomplete());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("produces a new memo when fieldNames identity changes", () => {
    const { result, rerender } = renderHook(
      ({ fields }: { fields: readonly string[] | undefined }) =>
        useMongoAutocomplete({ fieldNames: fields }),
      {
        initialProps: { fields: ["_id"] as readonly string[] | undefined },
      },
    );
    const first = result.current;
    rerender({ fields: ["_id", "email"] });
    expect(result.current).not.toBe(first);
  });

  it("produces a new memo when indexNames identity changes", () => {
    const { result, rerender } = renderHook(
      ({ indexes }: { indexes: readonly string[] | undefined }) =>
        useMongoAutocomplete({
          activeCollectionName: "users",
          indexNames: indexes,
        }),
      {
        initialProps: {
          indexes: ["email_1"] as readonly string[] | undefined,
        },
      },
    );
    const first = result.current;
    rerender({ indexes: ["email_1", "status_1"] });
    expect(result.current).not.toBe(first);
  });

  it("accepts undefined fieldNames without throwing", () => {
    expect(() =>
      renderHook(() =>
        useMongoAutocomplete({ fieldNames: undefined, indexNames: undefined }),
      ),
    ).not.toThrow();
  });

  it("accepts no arguments at all (default options)", () => {
    expect(() => renderHook(() => useMongoAutocomplete())).not.toThrow();
  });
});
