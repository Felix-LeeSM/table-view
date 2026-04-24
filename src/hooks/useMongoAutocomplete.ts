import { useMemo } from "react";
import { autocompletion } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import {
  createMongoCompletionSource,
  createMongoOperatorHighlight,
  type MongoQueryMode,
} from "@lib/mongoAutocomplete";

export interface UseMongoAutocompleteOptions {
  queryMode: MongoQueryMode;
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
 * React hook that assembles the MQL-aware autocomplete + operator highlight
 * extensions for a document paradigm query tab. Sprint 83 wires this into
 * `QueryEditor` so document tabs receive the same quality-of-life boost
 * Sprint 82 delivered to SQL tabs.
 *
 * The returned array is stable across renders with matching
 * `(queryMode, fieldNames)` identity — consumers can pass it directly to
 * CodeMirror's Compartment without additional memoisation.
 */
export function useMongoAutocomplete(
  opts: UseMongoAutocompleteOptions,
): Extension[] {
  const { queryMode, fieldNames } = opts;
  return useMemo(
    () => [
      autocompletion({
        override: [createMongoCompletionSource({ queryMode, fieldNames })],
      }),
      createMongoOperatorHighlight(),
    ],
    [queryMode, fieldNames],
  );
}
