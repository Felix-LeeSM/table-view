/**
 * Sprint 326 — Slice I.1: `MqlCommand[]` → `BulkWriteOp[]` mapper.
 *
 * commit path 가 N 번의 IPC roundtrip 대신 단일 `bulk_write_documents`
 * 호출로 묶일 수 있도록 변환. `_id` filter shape (`DocumentId` tagged
 * union) 는 backend Rust 의 `BulkWriteOp.filter` 가 그대로 deserialize
 * 한다.
 */

import type { MqlCommand } from "./mqlGenerator";
import type { BulkWriteOp } from "@/types/documentMutate";

export function mqlCommandsToBulkOps(
  commands: ReadonlyArray<MqlCommand>,
): BulkWriteOp[] {
  return commands.map((cmd) => {
    switch (cmd.kind) {
      case "insertOne":
        return { op: "insertOne", document: cmd.document };
      case "updateOne":
        return {
          op: "updateOne",
          filter: { _id: cmd.documentId },
          update: { $set: cmd.patch },
        };
      case "deleteOne":
        return {
          op: "deleteOne",
          filter: { _id: cmd.documentId },
        };
    }
  });
}
