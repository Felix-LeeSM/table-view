import { useMemo } from "react";
import { autocompletion } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import {
  createMongoCompletionSource,
  createMongoOperatorHighlight,
} from "@/lib/completion/mongo";
import {
  createMongoshDbSource,
  createMongoAdminCommandSource,
} from "@/lib/mongo/mongoAutocomplete";

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
  /**
   * Known collection names for the active database — surfaced after the
   * user types `db.` so the popup proposes the collections that actually
   * exist before the user even picks a method. May be empty when the
   * sidebar has not yet listed the database; the hook still wires the
   * mongosh method whitelist so `db.<anyName>.fi` triggers `find` /
   * `findOne` / etc. either way.
   */
  collectionNames?: readonly string[];
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
  const { fieldNames, collectionNames } = opts;
  return useMemo(
    () => [
      autocompletion({
        // Both sources are registered as `override` so CodeMirror's
        // built-in word completion never shadows them. The mongosh
        // `db.<col>.method` source fires earlier in the lexical pattern
        // (it owns `db.` tokens); `createMongoCompletionSource` owns the
        // JSON-body `$operator` / quoted-key positions. The two patterns
        // don't overlap, so registration order does not matter.
        override: [
          // Sprint 381 (2026-05-17) — admin command source runs *first*
          // because its trigger pattern (`db.runCommand({` + first key)
          // is the narrowest. Falling through to `createMongoshDbSource`
          // on no-match keeps backward-compat with the Phase 28
          // `db.<coll>.method` whitelist; `createMongoCompletionSource`
          // continues to own `$operator` / quoted-key positions inside
          // JSON bodies.
          createMongoAdminCommandSource(),
          createMongoshDbSource({ collectionNames }),
          createMongoCompletionSource({ queryMode: "aggregate", fieldNames }),
        ],
      }),
      createMongoOperatorHighlight(),
    ],
    [fieldNames, collectionNames],
  );
}
