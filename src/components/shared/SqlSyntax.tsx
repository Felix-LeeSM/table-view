import { type SqlTokenKind, tokenizeSql } from "@lib/sql/sqlTokenize";
import { cn } from "@lib/utils";
import { useMemo } from "react";

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
 * parent so the whole block participates in the parent's `truncate`
 * behaviour. Intended for compact previews (history rows, favourite rows);
 * the full editor uses CodeMirror.
 *
 * That parent is a `<code>`, and the element is load-bearing rather than
 * decorative (#2432): text selection is off by default and `src/index.css`
 * turns it back on per element, `code` among them. Every SQL this component
 * prints is machine output the user may need to lift out — an executed
 * statement, a generated DDL preview — so pinning the element here is what
 * keeps all of its call-sites selectable instead of each one arranging its
 * own wrapper. `code` also nests legally inside the `<pre>` blocks that
 * several call-sites already wrap it in, which `pre` would not.
 */
export default function SqlSyntax({ sql, className }: SqlSyntaxProps) {
  const tokens = useMemo(() => tokenizeSql(sql), [sql]);
  return (
    <code className={cn("font-mono", className)}>
      {tokens.map((tok, idx) => (
        <span key={idx} className={TOKEN_CLASS[tok.kind]}>
          {tok.text}
        </span>
      ))}
    </code>
  );
}
