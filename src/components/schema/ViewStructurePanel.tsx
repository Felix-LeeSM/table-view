import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy } from "lucide-react";
import { useSchemaStore } from "@stores/schemaStore";
import type { ColumnInfo } from "@/types/schema";
import { DataGridSkeleton } from "@components/datagrid";
import { Tabs, TabsList, TabsTrigger } from "@components/ui/tabs";
import { Button } from "@components/ui/button";
import { useCopyToClipboard } from "@lib/runtime/useCopyToClipboard";

interface ViewStructurePanelProps {
  connectionId: string;
  database: string;
  view: string;
  schema: string;
}

type ViewSubTab = "columns" | "definition";

// ponytail: SUB_TABS moved inside component so t() is available

export default function ViewStructurePanel({
  connectionId,
  database,
  view,
  schema,
}: ViewStructurePanelProps) {
  const { t } = useTranslation("schema");
  const SUB_TABS: { key: ViewSubTab; label: string }[] = [
    { key: "columns", label: t("columnsTab") },
    { key: "definition", label: t("definitionTab") },
  ];
  const [activeSubTab, setActiveSubTab] = useState<ViewSubTab>("columns");
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [definition, setDefinition] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const getViewColumns = useSchemaStore((s) => s.getViewColumns);
  const getViewDefinition = useSchemaStore((s) => s.getViewDefinition);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (activeSubTab === "columns") {
        const cols = await getViewColumns(connectionId, database, schema, view);
        setColumns(cols);
      } else {
        const def = await getViewDefinition(
          connectionId,
          database,
          schema,
          view,
        );
        setDefinition(def);
      }
    } catch (e) {
      setError(String(e));
    }
    setLoading(false);
  }, [
    connectionId,
    database,
    view,
    schema,
    activeSubTab,
    getViewColumns,
    getViewDefinition,
  ]);

  useEffect(() => {
    const handler = () => fetchData();
    window.addEventListener("refresh-structure", handler);
    return () => window.removeEventListener("refresh-structure", handler);
  }, [fetchData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Sub-tab bar */}
      <Tabs
        value={activeSubTab}
        onValueChange={(v) => setActiveSubTab(v as ViewSubTab)}
      >
        <TabsList className="w-full justify-start rounded-none border-b border-border bg-secondary gap-0">
          {SUB_TABS.map((tab) => (
            <TabsTrigger
              key={tab.key}
              value={tab.key}
              className="rounded-none px-4"
            >
              {tab.label}
            </TabsTrigger>
          ))}
          <span className="ml-auto pr-3 text-3xs uppercase tracking-wider text-muted-foreground">
            {t("readOnly")}
          </span>
        </TabsList>
      </Tabs>

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && <DataGridSkeleton />}

      {/* Content */}
      {!loading && !error && activeSubTab === "columns" && (
        <ViewColumnsTable columns={columns} />
      )}
      {!loading && !error && activeSubTab === "definition" && (
        <ViewDefinition sql={definition} />
      )}
    </div>
  );
}

function ViewColumnsTable({ columns }: { columns: ColumnInfo[] }) {
  const { t } = useTranslation("schema");
  if (columns.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-3 py-8 text-sm text-muted-foreground">
        {t("noColumns")}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-secondary">
          <tr className="border-b border-border">
            <th className="border-r border-border px-3 py-1.5 text-left font-medium text-secondary-foreground">
              {t("colName")}
            </th>
            <th className="border-r border-border px-3 py-1.5 text-left font-medium text-secondary-foreground">
              {t("colType")}
            </th>
            <th className="border-r border-border px-3 py-1.5 text-left font-medium text-secondary-foreground">
              {t("colNullable")}
            </th>
            <th className="border-r border-border px-3 py-1.5 text-left font-medium text-secondary-foreground">
              {t("colDefault")}
            </th>
            <th className="px-3 py-1.5 text-left font-medium text-secondary-foreground">
              {t("colComment")}
            </th>
          </tr>
        </thead>
        <tbody>
          {columns.map((col) => (
            <tr
              key={col.name}
              className="border-b border-border hover:bg-muted"
            >
              <td className="border-r border-border px-3 py-1 text-foreground">
                {col.name}
              </td>
              <td className="border-r border-border px-3 py-1 text-secondary-foreground">
                {col.data_type}
              </td>
              <td className="border-r border-border px-3 py-1 text-secondary-foreground">
                {col.nullable ? "YES" : "NO"}
              </td>
              <td className="border-r border-border px-3 py-1 text-secondary-foreground">
                {col.default_value ?? (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-3 py-1 text-secondary-foreground">
                {col.comment ?? (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ViewDefinition({ sql }: { sql: string }) {
  const { t } = useTranslation("schema");
  const { copied, copy } = useCopyToClipboard();

  const stats = useMemo(
    () => ({
      chars: sql.length,
      lines: sql === "" ? 0 : sql.split("\n").length,
    }),
    [sql],
  );

  const handleCopy = () => void copy(sql);

  if (!sql.trim()) {
    return (
      <div className="flex flex-1 items-center justify-center px-3 py-8 text-sm text-muted-foreground">
        {t("definitionNotAvailable")}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-secondary/50 px-3 py-1.5">
        <div className="text-xs text-muted-foreground">
          {stats.chars.toLocaleString()} char{stats.chars !== 1 ? "s" : ""} ·{" "}
          {stats.lines.toLocaleString()} line{stats.lines !== 1 ? "s" : ""}
        </div>
        <Button
          variant="outline"
          size="xs"
          onClick={handleCopy}
          aria-label={t("copyViewDefinitionAria")}
        >
          {copied ? (
            <>
              <Check className="text-success" />
              <span>{t("copied")}</span>
            </>
          ) : (
            <>
              <Copy />
              <span>{t("copy")}</span>
            </>
          )}
        </Button>
      </div>
      <div className="flex-1 overflow-auto p-3">
        <pre className="whitespace-pre-wrap break-words rounded border border-border bg-secondary p-3 font-mono text-xs text-foreground">
          {sql}
        </pre>
      </div>
    </div>
  );
}
