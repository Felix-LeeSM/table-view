import { useState } from "react";
import { ChevronRight } from "lucide-react";
import SqlSyntax from "@components/shared/SqlSyntax";

interface ExecutedQueryBarProps {
  sql: string;
}

export function ExecutedQueryBar({ sql }: ExecutedQueryBarProps) {
  const [showQuery, setShowQuery] = useState(true);

  return (
    <div className="border-t border-border">
      <button
        className="flex w-full items-center gap-1 px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
        onClick={() => setShowQuery((visible) => !visible)}
        aria-expanded={showQuery}
        aria-label={showQuery ? "Hide query" : "Show query"}
      >
        <ChevronRight
          size={10}
          className={`transition-transform ${showQuery ? "rotate-90" : ""}`}
        />
        <span>Query</span>
      </button>
      {showQuery && (
        <div
          className="max-h-32 overflow-auto bg-secondary px-3 py-1.5"
          role="region"
          aria-label="Executed SQL query"
        >
          <SqlSyntax
            sql={sql}
            className="whitespace-pre-wrap break-all text-xs text-secondary-foreground"
          />
        </div>
      )}
    </div>
  );
}
