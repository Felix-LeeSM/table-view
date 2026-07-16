import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Code2, Trash2, Save, X, ArrowLeft } from "lucide-react";
import { useSnippetsStore, type Snippet } from "@stores/snippetsStore";
import {
  extractPlaceholders,
  substitutePlaceholders,
} from "@lib/sql/snippetTemplate";
import { Button } from "@components/ui/button";

interface SnippetsPanelProps {
  /** Current editor SQL — saved verbatim as a new snippet body. */
  currentSql: string;
  /** Insert the (placeholder-substituted) snippet text at the editor cursor. */
  onInsert: (text: string) => void;
  onClose: () => void;
}

export default function SnippetsPanel({
  currentSql,
  onInsert,
  onClose,
}: SnippetsPanelProps) {
  const { t } = useTranslation("query");
  const snippets = useSnippetsStore((s) => s.snippets);
  const addSnippet = useSnippetsStore((s) => s.addSnippet);
  const removeSnippet = useSnippetsStore((s) => s.removeSnippet);

  const [name, setName] = useState("");
  // When set, the panel shows the variable-entry form for this snippet.
  const [filling, setFilling] = useState<Snippet | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  const handleSave = () => {
    const trimmed = name.trim();
    const body = currentSql.trim();
    if (!trimmed || !body) return;
    addSnippet(trimmed, body);
    setName("");
  };

  const handleSelect = (snippet: Snippet) => {
    const placeholders = extractPlaceholders(snippet.body);
    if (placeholders.length === 0) {
      onInsert(snippet.body);
      onClose();
      return;
    }
    setValues(Object.fromEntries(placeholders.map((p) => [p, ""])));
    setFilling(snippet);
  };

  const handleInsertFilled = () => {
    if (!filling) return;
    // Drop blank fields so an unfilled placeholder stays visible as `{{name}}`
    // in the inserted SQL (a "you skipped this" marker) rather than silently
    // collapsing to an empty string.
    const filled = Object.fromEntries(
      Object.entries(values).filter(([, v]) => v !== ""),
    );
    onInsert(substitutePlaceholders(filling.body, filled));
    onClose();
  };

  return (
    <div className="flex flex-col border border-border bg-background shadow-lg rounded-md w-[clamp(20rem,32vw,32rem)] max-h-[min(60vh,40rem)]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-secondary rounded-t-md">
        <div className="flex items-center gap-1.5 text-sm font-medium text-secondary-foreground">
          {filling ? (
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setFilling(null)}
              aria-label={t("snippets.backAria")}
            >
              <ArrowLeft />
            </Button>
          ) : (
            <Code2 size={14} className="text-primary" />
          )}
          <span>
            {filling
              ? t("snippets.fillTitle", { name: filling.name })
              : t("snippets.title")}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          onClick={onClose}
          aria-label={t("snippets.closeAria")}
        >
          <X />
        </Button>
      </div>

      {filling ? (
        /* Variable-entry form — one input per unique {{placeholder}}. */
        <div className="flex flex-col gap-2 p-3">
          {Object.keys(values).map((key) => (
            <label key={key} className="flex flex-col gap-1">
              <span className="text-3xs font-mono text-muted-foreground">
                {`{{${key}}}`}
              </span>
              <input
                type="text"
                value={values[key]}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [key]: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleInsertFilled();
                  if (e.key === "Escape") setFilling(null);
                }}
                className="h-6 rounded border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring"
                aria-label={t("snippets.variableAria", { name: key })}
                autoFocus={key === Object.keys(values)[0]}
              />
            </label>
          ))}
          <Button
            size="xs"
            onClick={handleInsertFilled}
            aria-label={t("snippets.insertAria", { name: filling.name })}
          >
            {t("snippets.insert")}
          </Button>
        </div>
      ) : (
        <>
          {/* Save current query */}
          <div className="flex items-center gap-1 border-b border-border p-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") onClose();
              }}
              placeholder={t("snippets.namePlaceholder")}
              className="h-6 flex-1 rounded border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring"
            />
            <Button
              size="xs"
              onClick={handleSave}
              disabled={!name.trim() || !currentSql.trim()}
              aria-label={t("snippets.saveAria")}
            >
              <Save />
            </Button>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {snippets.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                {t("snippets.empty")}
              </div>
            ) : (
              snippets.map((snippet) => (
                <Button
                  key={snippet.id}
                  variant="ghost"
                  size="xs"
                  className="w-full justify-start items-start gap-2 border-b border-border px-3 py-2 text-left h-auto rounded-none"
                  onClick={() => handleSelect(snippet)}
                  aria-label={t("snippets.insertAria", { name: snippet.name })}
                >
                  <div className="flex-1 min-w-0">
                    <span
                      className="block text-xs font-medium text-foreground truncate"
                      title={snippet.name}
                    >
                      {snippet.name}
                    </span>
                    <span
                      className="mt-0.5 block text-3xs font-mono text-muted-foreground truncate"
                      title={snippet.body}
                    >
                      {snippet.body}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSnippet(snippet.id);
                    }}
                    aria-label={t("snippets.deleteAria", {
                      name: snippet.name,
                    })}
                  >
                    <Trash2 />
                  </Button>
                </Button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
