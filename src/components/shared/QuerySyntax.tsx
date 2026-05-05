import type { Paradigm } from "@/types/connection";
import type { QueryMode } from "@stores/tabStore";
import SqlSyntax from "./SqlSyntax";
import MongoSyntax from "./MongoSyntax";

interface QuerySyntaxProps {
  sql: string;
  /**
   * Paradigm the `sql` was executed under. `"document"` routes through
   * `MongoSyntax` (JSON tokens + MQL operator highlighting); any other
   * value, including `undefined` (legacy entries), falls back to
   * `SqlSyntax` so existing SQL previews continue to render unchanged.
   */
  paradigm?: Paradigm;
  /**
   * Execution mode inside the paradigm. Accepted for forward-compat —
   * future sprints may swap in mode-specific renderers (e.g. an
   * aggregate-pipeline specialised viewer) — but it is not consumed
   * inside the current dispatcher. Keeping the prop on the signature
   * today means callers can thread `entry.queryMode` through without
   * another refactor when the mode-aware renderer lands.
   */
  queryMode?: QueryMode;
  className?: string;
}

/**
 * Paradigm-aware syntax preview wrapper. History viewers (in-tab rows and
 * the global log) colour Mongo entries as JSON + MQL operators while
 * keeping RDB entries on the SQL tokeniser. Render-only — does not read
 * from or write to any store.
 */
export default function QuerySyntax({
  sql,
  paradigm,
  className,
}: QuerySyntaxProps) {
  if (paradigm === "document") {
    return <MongoSyntax sql={sql} className={className} />;
  }
  return <SqlSyntax sql={sql} className={className} />;
}
