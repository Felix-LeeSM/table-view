import { useMemo } from "react";
import { tokenizeSql, type SqlTokenKind } from "@lib/sql/sqlTokenize";
import { cn } from "@lib/utils";

interface SqlSyntaxProps {
  sql: string;
  className?: string;
}

const TOKEN_CLASS: Record<SqlTokenKind, string> = {
  keyword: "text-syntax-keyword font-semibold",
  string: "text-syntax-string",
  number: "text-syntax-number",
  comment: "text-muted-foreground italic",
  punct: "text-muted-foreground",
  whitespace: "",
  identifier: "text-foreground",
};

/**
 * Inline syntax-highlighted SQL. Tokens render as `<span>`s inside a single
 * parent so the whole block participates in the parent's `truncate` /
 * `select-text` behaviour. Intended for compact previews (history rows,
 * favourite rows); the full editor uses CodeMirror.
 */
export default function SqlSyntax({ sql, className }: SqlSyntaxProps) {
  const tokens = useMemo(() => tokenizeSql(sql), [sql]);
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
