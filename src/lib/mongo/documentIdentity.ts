import { documentIdFromRow, type DocumentId } from "@/types/documentMutate";

export function idOnlyFilter(
  filter: Record<string, unknown>,
): DocumentId | null {
  const keys = Object.keys(filter);
  if (keys.length !== 1 || keys[0] !== "_id") return null;
  return documentIdFromRow(filter);
}
