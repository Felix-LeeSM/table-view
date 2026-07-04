import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import SqlSyntax from "@components/shared/SqlSyntax";

interface ExecutedQueryBarProps {
  sql: string;
}

export function ExecutedQueryBar({ sql }: ExecutedQueryBarProps) {
  const { t } = useTranslation("rdb");
  const regionId = useId();
  const [showQuery, setShowQuery] = useState(true);

  return (
    <div className="border-t border-border">
      <button
        className="flex w-full items-center gap-1 px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
        onClick={() => setShowQuery((visible) => !visible)}
        aria-expanded={showQuery}
        aria-controls={regionId}
        aria-label={
          showQuery
            ? t("executedQueryBar.hideQueryAria")
            : t("executedQueryBar.showQueryAria")
        }
      >
        <ChevronRight
          size={10}
          className={`transition-transform ${showQuery ? "rotate-90" : ""}`}
        />
        <span>{t("executedQueryBar.query")}</span>
      </button>
      {showQuery && (
        <div
          id={regionId}
          className="max-h-32 overflow-auto bg-secondary px-3 py-1.5"
          role="region"
          aria-label={t("executedQueryBar.executedSqlAria")}
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
