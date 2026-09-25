/**
 * `MqlCommand[]` → `BulkWriteOp[]` mapper.
 *
 * Converts the commands so the commit path can batch them into a single
 * `bulk_write_documents` call instead of N IPC round-trips. The `_id` filter
 * is sent in canonical extended JSON form so the backend can restore a real
 * BSON ObjectId.
 */

import type { BulkWriteOp, DocumentId } from "@/types/documentMutate";
import type { MqlCommand } from "./mqlGenerator";

function documentIdToFilterValue(id: DocumentId): unknown {
  if ("objectId" in id) return { $oid: id.objectId };
  if ("string" in id) return id.string;
  if ("number" in id) return id.number;
  return id.raw;
}

export function mqlCommandsToBulkOps(
  commands: ReadonlyArray<MqlCommand>,
): BulkWriteOp[] {
  // biome-ignore lint/suspicious/useIterableCallbackReturn: the switch is exhaustive over MqlCommand["kind"], so no path falls through without returning. tsc enforces that — adding a fourth kind to the union makes the callback infer `... | undefined` and fails this function's BulkWriteOp[] return type.
  return commands.map((cmd) => {
    switch (cmd.kind) {
      case "insertOne":
        return { op: "insertOne", document: cmd.document };
      case "updateOne":
        // `cmd.patch` is already the full update operator
        // (`{ $set: {...}, $unset: {...} }`) so that mqlGenerator can mix
        // overwrite + structural delete in a single round-trip. Structural
        // edits join the same per-row patch, so the operator wrapping lives
        // in the generator rather than here.
        return {
          op: "updateOne",
          filter: { _id: documentIdToFilterValue(cmd.documentId) },
          update: cmd.patch,
        };
      case "deleteOne":
        return {
          op: "deleteOne",
          filter: { _id: documentIdToFilterValue(cmd.documentId) },
        };
    }
  });
}
