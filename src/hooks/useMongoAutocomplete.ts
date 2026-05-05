import { useMemo } from "react";
import { autocompletion } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import {
  createMongoCompletionSource,
  createMongoOperatorHighlight,
} from "@/lib/completion/mongo";
import type { MongoQueryMode } from "@lib/mongo/mongoAutocomplete";

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
 * Assembles the MQL-aware autocomplete + operator highlight extensions
 * for a document-paradigm query tab. The returned array is stable across
 * renders with matching `(queryMode, fieldNames)` identity, so callers
 * can pass it straight into a CodeMirror Compartment without extra
 * memoisation.
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
