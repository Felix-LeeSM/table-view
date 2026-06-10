// Mongo completion module. The CodeMirror MQL completion source
// (operator/stage/accumulator-aware) is re-exported from
// `mongoAutocomplete.ts`. `dbMethodCandidates` +
// `createDbMethodCompletionSource` surface the `db.<method>` candidate set.

import { prefixMatch } from "@lib/completion/shared";
import {
  createMongoCompletionSource,
  createMongoOperatorHighlight,
  MONGOSH_DB_METHODS,
} from "./mongoAutocomplete";

export { createMongoCompletionSource, createMongoOperatorHighlight };

export interface MongoMethodCandidate {
  label: string;
  type: "function";
}

/**
 * Collection-method candidates surfaced after `db.` in a Mongo query buffer.
 * Now an alias of `MONGOSH_DB_METHODS` — the canonical list lives next to
 * the CodeMirror `createMongoshDbSource` consumer so a future edit can
 * keep the popup and the highlight in sync without touching two files.
 */
export const dbMethodCandidates: readonly MongoMethodCandidate[] =
  MONGOSH_DB_METHODS;

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
