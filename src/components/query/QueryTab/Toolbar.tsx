import { useTranslation } from "react-i18next";
import { Button } from "@components/ui/button";
import {
  Play,
  Square,
  Loader2,
  Paintbrush,
  Star,
  Save,
  X,
  FlaskConical,
  FileSearch,
  SearchCode,
  Upload,
  Code2,
} from "lucide-react";
import FavoritesPanel from "../FavoritesPanel";
import SnippetsPanel from "../SnippetsPanel";
import TabDbChip from "./TabDbChip";
import { supportsNativeCancel } from "./useQueryContext";
import { useConnectionStore } from "@stores/connectionStore";
import { useSnippetsStore } from "@stores/snippetsStore";
import type { QueryTab } from "@stores/workspaceStore";
import type { QueryFavoritesState } from "./useQueryFavorites";
import {
  classifyMongoStatement,
  statementAllowsMissingDatabase,
} from "@/lib/mongo/runCommandParser";

/**
 * `QueryTab` 의 toolbar 컴포넌트.
 *
 * 책임: Run/Cancel + Format + Save/Favorites buttons + 2 popover
 * (Save 폼 / `<FavoritesPanel>` mount). Save 와 Favorites popover 는
 * 상호 배타 — 한 쪽 열 때 다른 쪽 close.
 *
 * Sprint 309 — Find/Aggregate `ToggleGroup` removed. The mongosh parser
 * (A1) infers the method from the editor text, so the toggle no longer
 * carries information. `onSetQueryMode` is gone from this surface; the
 * store action stays exported for `loadQueryIntoTab` backward-compat.
 *
 * Invariants:
 * - The Save button is disabled iff `tab.sql` is empty. The save form's
 *   own confirm button (inside the popover) gates on `favoriteName`.
 * - The Favorites button is always enabled — even with zero favorites,
 *   the panel must open so the user can add one via drag-and-drop.
 * - Run's `⌘⏎` label is onboarding text; the actual shortcut lives in
 *   the keyboard layer.
 */

export interface QueryTabToolbarProps {
  tab: QueryTab;
  isDocument: boolean;
  canCancelQuery?: boolean;
  onExecute: () => void;
  /**
   * Wraps the editor SQL in a transaction that is unconditionally
   * rolled back, so the user can preview destructive results without
   * committing. Rendered only for the RDB paradigm — the dry-run IPC
   * has no Mongo equivalent.
   */
  onDryRun: () => void;
  onExplain?: () => void;
  canExplain?: boolean;
  onFormat: () => void;
  /**
   * Stage 1 (#1077) import — open a `.sql` file and load it into the editor.
   * The user then runs it through the normal Run path, so destructive
   * statements still hit the Safe Mode confirm gate. RDB paradigm only.
   */
  onImportSqlFile?: () => void;
  showFileAnalytics?: boolean;
  onOpenFileAnalytics?: () => void;
  favorites: QueryFavoritesState;
  /** #1528 — snippet panel visibility + editor-cursor insert callback. */
  showSnippets: boolean;
  setShowSnippets: (open: boolean) => void;
  onInsertSnippet: (text: string) => void;
}

export default function QueryTabToolbar({
  tab,
  isDocument,
  canCancelQuery = true,
  onExecute,
  onDryRun,
  onExplain,
  canExplain = false,
  onFormat,
  onImportSqlFile,
  showFileAnalytics = false,
  onOpenFileAnalytics,
  favorites,
  showSnippets,
  setShowSnippets,
  onInsertSnippet,
}: QueryTabToolbarProps) {
  const { t } = useTranslation("query");
  const {
    showSaveForm,
    setShowSaveForm,
    favoriteName,
    setFavoriteName,
    showFavorites,
    setShowFavorites,
    favorites: favoritesList,
    handleSaveFavorite,
    handleLoadFavoriteSql,
  } = favorites;
  const snippetCount = useSnippetsStore((s) => s.snippets.length);

  // Sprint 381 (2026-05-17) — Mongo db-contract α. The Run button used
  // to be disabled whenever Mongo's `tab.database` was empty, which
  // blocked admin commands (`db.runCommand({ping: 1})`) that don't need
  // a bound database. The new gate splits two axes:
  //   - statement is *non-empty* (`tab.sql.trim()` — unchanged check)
  //   - statement is *runnable* — for document paradigm, classify into
  //     admin-command (DB-less OK) vs collection-command (DB required)
  //     vs unknown (treat like collection: require DB to avoid silently
  //     allowing typos through the AST parser).
  // The actual dispatch gate stays in `useQueryExecution` — Toolbar only
  // controls the disabled state + tooltip.
  // Issue #1230 — reflect the native (server-side) cancel capability in the
  // Stop button tooltip. Derived from the tab's connection so no new prop
  // threads through the parent; `supportsNativeCancel(undefined)` is a safe
  // `false` when the connection isn't resolvable.
  const cancelDbType = useConnectionStore(
    (s) => s.connections.find((c) => c.id === tab.connectionId)?.dbType,
  );
  const cancelTitle = supportsNativeCancel(cancelDbType)
    ? t("toolbar.stopQueryNativeTitle")
    : t("toolbar.stopQueryTitle");
  const isDocumentTab = isDocument;
  const mongoStatementKind = isDocumentTab
    ? classifyMongoStatement(tab.sql)
    : "unknown";
  const documentNeedsDb =
    isDocumentTab &&
    !tab.database &&
    !statementAllowsMissingDatabase(mongoStatementKind);
  const runDisabled = !tab.sql.trim() || documentNeedsDb;
  const runDisabledTooltip = documentNeedsDb
    ? t("toolbar.runDisabledDbHint")
    : undefined;
  const isRdbTab = tab.paradigm === "rdb";

  return (
    <div className="flex items-center gap-2 border-b border-border bg-secondary px-2 py-1">
      {/* 2026-05-15 — Sprint 329 의 display-only chip 을 interactive
          selector 로 교체. tab-local 시맨틱은 유지 (`tab.database` 만
          갱신; connection.activeDb 는 그대로). */}
      {isDocument && (
        <TabDbChip
          tabId={tab.id}
          database={tab.database ?? ""}
          connectionId={tab.connectionId}
        />
      )}
      {tab.queryState.status === "running" && canCancelQuery ? (
        <Button
          variant="ghost"
          size="xs"
          onClick={onExecute}
          aria-label={t("toolbar.cancelQueryAria")}
          title={cancelTitle}
        >
          <Square className="text-destructive" />
          <Loader2 className="animate-spin" />
          <span>{t("toolbar.cancel")}</span>
        </Button>
      ) : tab.queryState.status === "running" ? (
        <Button
          variant="ghost"
          size="xs"
          disabled
          aria-label={t("toolbar.queryRunningAria")}
          title={t("toolbar.cancellationUnsupportedTitle")}
        >
          <Loader2 className="animate-spin" />
          <span>{t("toolbar.running")}</span>
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="xs"
          onClick={onExecute}
          disabled={runDisabled}
          aria-label={t("toolbar.runQueryAria")}
          title={runDisabledTooltip}
        >
          <Play className="text-success" />
          <span>{t("toolbar.run")}</span>
          <span className="text-3xs text-muted-foreground">{"⌘⏎"}</span>
        </Button>
      )}
      {isRdbTab && (
        <Button
          variant="ghost"
          size="xs"
          onClick={onDryRun}
          disabled={tab.queryState.status === "running" || !tab.sql.trim()}
          aria-label={t("toolbar.dryRunAria")}
          title={t("toolbar.dryRunTitle")}
        >
          <FlaskConical />
          <span>{t("toolbar.dryRun")}</span>
          <span className="text-3xs text-muted-foreground">{"⌘⇧⏎"}</span>
        </Button>
      )}
      {/* #1041 — Explain visibility is driven by `canExplain` (the
          capability contract), not the paradigm. `canExplain` is only true
          for sources whose `query.explain` flag is set (PG + Mongo today). */}
      {canExplain && (
        <Button
          variant="ghost"
          size="xs"
          onClick={onExplain}
          disabled={tab.queryState.status === "running" || !tab.sql.trim()}
          aria-label={t("toolbar.explainAria")}
          title={t("toolbar.explainTitle")}
        >
          <SearchCode />
          <span>{t("toolbar.explain")}</span>
        </Button>
      )}
      {isRdbTab && (
        <Button
          variant="ghost"
          size="xs"
          onClick={onFormat}
          disabled={!tab.sql.trim()}
          aria-label={t("toolbar.formatAria")}
          title={t("toolbar.formatTitle")}
        >
          <Paintbrush />
          <span>{t("toolbar.format")}</span>
        </Button>
      )}
      {isRdbTab && onImportSqlFile && (
        <Button
          variant="ghost"
          size="xs"
          onClick={onImportSqlFile}
          disabled={tab.queryState.status === "running"}
          aria-label={t("toolbar.importSqlFileAria")}
          title={t("toolbar.importSqlFileAria")}
        >
          <Upload />
          <span>{t("toolbar.importSqlFile")}</span>
        </Button>
      )}
      {showFileAnalytics && (
        <Button
          variant="ghost"
          size="xs"
          onClick={onOpenFileAnalytics}
          disabled={tab.queryState.status === "running"}
          aria-label={t("toolbar.localFileAria")}
          title={t("toolbar.localFileAria")}
        >
          <FileSearch />
          <span>{t("toolbar.localFile")}</span>
        </Button>
      )}
      <div className="ml-auto flex items-center gap-1 relative">
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            setShowSaveForm(!showSaveForm);
            setShowFavorites(false);
            setShowSnippets(false);
          }}
          disabled={!tab.sql.trim()}
          aria-label={t("toolbar.saveToFavoritesAria")}
          title={t("toolbar.saveToFavoritesAria")}
        >
          <Star />
          <span>{t("toolbar.save")}</span>
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            setShowFavorites(!showFavorites);
            setShowSaveForm(false);
            setShowSnippets(false);
          }}
          aria-label={t("toolbar.openFavoritesAria")}
          title={t("toolbar.openFavoritesTitle")}
        >
          <Star className="text-primary" />
          <span>
            {favoritesList.length > 0
              ? t("toolbar.favoritesCount", { count: favoritesList.length })
              : t("toolbar.favorites")}
          </span>
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            setShowSnippets(!showSnippets);
            setShowSaveForm(false);
            setShowFavorites(false);
          }}
          aria-label={t("toolbar.openSnippetsAria")}
          title={t("toolbar.snippets")}
        >
          <Code2 className="text-primary" />
          <span>
            {snippetCount > 0
              ? t("toolbar.snippetsCount", { count: snippetCount })
              : t("toolbar.snippets")}
          </span>
        </Button>
        {showSaveForm && (
          <div className="absolute right-0 top-full mt-1 z-50 flex items-center gap-1 rounded border border-border bg-background p-2 shadow-lg">
            <input
              type="text"
              value={favoriteName}
              onChange={(e) => setFavoriteName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveFavorite();
                if (e.key === "Escape") setShowSaveForm(false);
              }}
              placeholder={t("toolbar.favoritePlaceholder")}
              className="h-6 w-40 rounded border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring"
              autoFocus
            />
            <Button
              size="xs"
              onClick={handleSaveFavorite}
              disabled={!favoriteName.trim()}
              aria-label={t("toolbar.confirmSaveAria")}
            >
              <Save />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => {
                setShowSaveForm(false);
                setFavoriteName("");
              }}
              aria-label={t("toolbar.cancelSaveAria")}
            >
              <X />
            </Button>
          </div>
        )}
        {showFavorites && (
          <div className="absolute right-0 top-full mt-1 z-50">
            <FavoritesPanel
              connectionId={tab.connectionId}
              onLoadSql={handleLoadFavoriteSql}
              onClose={() => setShowFavorites(false)}
            />
          </div>
        )}
        {showSnippets && (
          <div className="absolute right-0 top-full mt-1 z-50">
            <SnippetsPanel
              currentSql={tab.sql}
              onInsert={onInsertSnippet}
              onClose={() => setShowSnippets(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
