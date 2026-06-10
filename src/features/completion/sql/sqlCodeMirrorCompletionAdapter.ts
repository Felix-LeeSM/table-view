import type { CompletionContext } from "@codemirror/autocomplete";
import type { SqlCompletionContext } from "./sqlCompletionContext";
import {
  buildSqlCompletionRequest,
  type SqlCompletionRequest,
} from "./sqlCompletionRequest";

export function buildSqlCompletionRequestFromCodeMirror(
  context: CompletionContext,
  completionContext: SqlCompletionContext,
): SqlCompletionRequest {
  return buildSqlCompletionRequest(
    context.state.doc.toString(),
    context.pos,
    completionContext,
  );
}
