import type {
  CompletionContext,
  CompletionSource,
} from "@codemirror/autocomplete";
import type { SqlCompletionContext } from "./sqlCompletionContext";
import {
  buildSqlCompletionRequest,
  type SqlCompletionRequest,
} from "./sqlCompletionRequest";

export interface SqlCompletionShadowSourceOptions {
  getCompletionContext: () => SqlCompletionContext | null | undefined;
  onRequest?: (request: SqlCompletionRequest) => void;
}

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

export function sqlCompletionShadowSource({
  getCompletionContext,
  onRequest,
}: SqlCompletionShadowSourceOptions): CompletionSource {
  return (context) => {
    const completionContext = getCompletionContext();
    if (!completionContext) return null;

    onRequest?.(
      buildSqlCompletionRequestFromCodeMirror(context, completionContext),
    );

    return null;
  };
}
