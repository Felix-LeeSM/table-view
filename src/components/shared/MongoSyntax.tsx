import { useMemo } from "react";
import { tokenizeMongo, type MongoTokenKind } from "@lib/mongoTokenize";
import { cn } from "@lib/utils";

interface MongoSyntaxProps {
  sql: string;
  className?: string;
}

/**
 * Token-kind → Tailwind class map. Operator tokens include the literal
 * `cm-mql-operator` class so the Sprint 83 CodeMirror decoration and the
 * Sprint 85 history preview share a single CSS target — theming the
 * operator colour in one place updates both surfaces.
 */
const TOKEN_CLASS: Record<MongoTokenKind, string> = {
  string: "text-syntax-string",
  number: "text-syntax-number",
  boolean: "text-syntax-keyword font-semibold",
  null: "text-syntax-keyword font-semibold",
  punct: "text-muted-foreground",
  whitespace: "",
  operator: "text-syntax-keyword font-semibold cm-mql-operator",
  identifier: "text-foreground",
};

/**
 * Inline syntax-highlighted MongoDB / MQL preview. Props mirror
 * `SqlSyntax` so the paradigm-aware `QuerySyntax` wrapper can swap
 * between the two renderers without adjusting call sites. Operator
 * tokens (`$match`, `$sum`, …) surface with the shared
 * `cm-mql-operator` class so history rows visually match the editor's
 * live highlighting. Malformed JSON is tolerated by the underlying
 * `tokenizeMongo` — the component never throws for unterminated
 * strings or truncated payloads.
 */
export default function MongoSyntax({ sql, className }: MongoSyntaxProps) {
  const tokens = useMemo(() => tokenizeMongo(sql), [sql]);
  return (
    <span className={cn("font-mono", className)}>
      {tokens.map((tok, idx) => (
        <span key={idx} className={TOKEN_CLASS[tok.kind]}>
          {tok.text}
        </span>
      ))}
    </span>
  );
}
