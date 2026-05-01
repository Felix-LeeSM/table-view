// AC-144-1, AC-144-2, AC-144-5 — Mongo completion module.
//
// Imports ONLY `prefixMatch` from `./shared` per contract. The CodeMirror
// MQL completion source (operator/stage/accumulator-aware) is re-exported
// from the existing `mongoAutocomplete.ts` so the editor's wiring is
// unchanged. The new `dbMethodCandidates` + `createDbMethodCompletionSource`
// surface the `db.<method>` candidate set required by AC-144-5.

import { prefixMatch } from "./shared";
import {
  createMongoCompletionSource,
  createMongoOperatorHighlight,
} from "@lib/mongo/mongoAutocomplete";

export { createMongoCompletionSource, createMongoOperatorHighlight };

export interface MongoMethodCandidate {
  label: string;
  type: "function";
}

/**
 * Collection-method candidates surfaced after `db.` in a Mongo query buffer.
 * The list is intentionally a small, well-known subset — Sprint 145 only
 * requires `find`, `aggregate`, `insertOne` per AC-144-5; others are
 * included so the popup is useful without bloating the candidate set.
 */
export const dbMethodCandidates: readonly MongoMethodCandidate[] = [
  { label: "find", type: "function" },
  { label: "findOne", type: "function" },
  { label: "aggregate", type: "function" },
  { label: "countDocuments", type: "function" },
  { label: "estimatedDocumentCount", type: "function" },
  { label: "distinct", type: "function" },
  { label: "insertOne", type: "function" },
  { label: "insertMany", type: "function" },
  { label: "updateOne", type: "function" },
  { label: "updateMany", type: "function" },
  { label: "replaceOne", type: "function" },
  { label: "deleteOne", type: "function" },
  { label: "deleteMany", type: "function" },
  { label: "createIndex", type: "function" },
  { label: "dropIndex", type: "function" },
];

export interface MongoCompletionCursor {
  text: string;
  cursor: number;
  prefix: string;
}

export interface MongoCompletionResult {
  candidates: MongoMethodCandidate[];
}

export interface MongoDbMethodSource {
  (cursor: MongoCompletionCursor): MongoCompletionResult;
  readonly dbType: "mongodb";
}

/**
 * Build a `db.<method>` candidate generator for the Mongo paradigm. Returns
 * an empty candidate list when the cursor is not positioned right after a
 * `db.` collection-method token. The dbType discriminator is locked to
 * `"mongodb"` so it cannot be wired to a SQL paradigm.
 */
export function createDbMethodCompletionSource(): MongoDbMethodSource {
  const fn = (cursor: MongoCompletionCursor): MongoCompletionResult => {
    const upTo = cursor.text.slice(0, cursor.cursor);
    // Match `db.` immediately followed by an optional alphanumeric prefix
    // anchored to the end of the buffer.
    const match = /\bdb\.([A-Za-z_][A-Za-z0-9_]*)?$/.exec(upTo);
    if (!match) return { candidates: [] };

    const candidates: MongoMethodCandidate[] = [];
    for (const cand of dbMethodCandidates) {
      if (prefixMatch(cursor.prefix, cand.label)) {
        candidates.push(cand);
      }
    }
    return { candidates };
  };
  Object.defineProperty(fn, "dbType", { value: "mongodb", enumerable: true });
  return fn as MongoDbMethodSource;
}
