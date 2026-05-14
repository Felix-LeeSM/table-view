import { useMemo } from "react";
import { autocompletion } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import {
  createMongoCompletionSource,
  createMongoOperatorHighlight,
} from "@/lib/completion/mongo";

export interface UseMongoAutocompleteOptions {
  /**
   * Cached collection field names to surface at JSON key positions. May be
   * `undefined` or empty — the hook treats both identically and never
   * throws. Identity of this array drives memoisation: callers that
   * allocate a new array on every render will force a new extension set
   * (but the host editor reconfigures through a Compartment, not a
   * rebuild, so the impact is limited to a cheap reconfigure dispatch).
   */
  fieldNames?: readonly string[];
}

/**
 * Assembles the MQL-aware autocomplete + operator highlight extensions
 * for a document-paradigm query tab. The returned array is stable across
 * renders with matching `fieldNames` identity, so callers can pass it
 * straight into a CodeMirror Compartment without extra memoisation.
 *
 * Sprint 309 — `queryMode` argument removed. The Find/Aggregate toggle
 * surfaced in `Toolbar.tsx` is gone, so the editor no longer has a mode
 * to dispatch on. The hook now passes `"aggregate"` to the underlying
 * `createMongoCompletionSource` because that branch surfaces the
 * **union** of find query operators + aggregate stages + accumulators
 * + type tags — the maximum candidate set a user typing a free-form
 * mongosh expression can consume. Sprint 311 (A5) is the next consumer
 * of this surface; A4 (sprint-310) layers a snippet menu on top of it.
 *
 * D-04 (phase-28-decisions.md) — the parameter is dropped (not kept as
 * a `"unified"` sentinel) because zero callers still pass it after
 * `QueryTab.tsx` updates; keeping a sentinel would be dead optionality
 * with a fake degree of freedom in the type signature.
 */
export function useMongoAutocomplete(
  opts: UseMongoAutocompleteOptions = {},
): Extension[] {
  const { fieldNames } = opts;
  return useMemo(
    () => [
      autocompletion({
        override: [
          createMongoCompletionSource({ queryMode: "aggregate", fieldNames }),
        ],
      }),
      createMongoOperatorHighlight(),
    ],
    [fieldNames],
  );
}
