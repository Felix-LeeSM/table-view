/**
 * Sprint 326 — Slice I.1: `MqlCommand[]` → `BulkWriteOp[]` mapper.
 *
 * commit path 가 N 번의 IPC roundtrip 대신 단일 `bulk_write_documents`
 * 호출로 묶일 수 있도록 변환. `_id` filter 는 canonical extended JSON
 * 형태로 보내 backend 가 실제 BSON ObjectId 로 복원할 수 있게 한다.
 */

import type { MqlCommand } from "./mqlGenerator";
import type { BulkWriteOp, DocumentId } from "@/types/documentMutate";

function documentIdToFilterValue(id: DocumentId): unknown {
  if ("ObjectId" in id) return { $oid: id.ObjectId };
  if ("String" in id) return id.String;
  if ("Number" in id) return id.Number;
  return id.Raw;
}

export function mqlCommandsToBulkOps(
  commands: ReadonlyArray<MqlCommand>,
): BulkWriteOp[] {
  return commands.map((cmd) => {
    switch (cmd.kind) {
      case "insertOne":
        return { op: "insertOne", document: cmd.document };
      case "updateOne":
        // Sprint 342 V2 — `cmd.patch` is already the full update operator
        // (`{ $set: {...}, $unset: {...} }`) so that mqlGenerator can mix
        // overwrite + structural delete in a single round-trip. Earlier
        // sprints emitted the raw `$set` body here, but with structural
        // edits joining the same per-row patch we move the operator
        // wrapping up into the generator.
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
