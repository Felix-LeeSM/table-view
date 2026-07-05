import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import type {
  ConnectionConfig,
  ConnectionStatus,
  EnvironmentTag,
} from "../model";
import { Button } from "@components/ui/button";
import { ENVIRONMENT_META } from "../model";
import { useConnectionStore } from "../store";
import { useConnectionLifecycle } from "@lib/runtime/connection/useConnectionLifecycle";
import { useConnectionMutations } from "@lib/runtime/connection/useConnectionMutations";
import { toast } from "@lib/runtime/toast";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuSeparator,
} from "@components/ui/context-menu";
import ConnectionDialog from "./ConnectionDialog";
import { classifyDriverError } from "@lib/errors/driverErrorHints";
import { DB_TYPE_META } from "@lib/db-meta";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@components/ui/alert-dialog";
import {
  Database,
  GripVertical,
  Plug,
  Unplug,
  Pencil,
  Trash2,
  Loader2,
  X,
  FolderInput,
  Check,
  Circle,
  CircleCheck,
  CircleAlert,
} from "lucide-react";

/** Module-level drag state shared between ConnectionItem, ConnectionGroup, ConnectionList */
export let draggedConnectionId: string | null = null;

interface ConnectionItemProps {
  connection: ConnectionConfig;
  /** When true, shows a selected ring around the row. */
  selected?: boolean;
  /** Single-click handler — used by the Sidebar to set the focused connection. */
  onSelect?: (id: string) => void;
  /** Fired after a successful double-click connect, so the parent can switch panes. */
  onActivate?: (id: string) => void;
  /** When true, connection is rendered inside a group — adds left indent. */
  inGroup?: boolean;
}

function StatusIndicator({ status }: { status: ConnectionStatus }) {
  const { t } = useTranslation("featuresConnection");
  if (status.type === "connecting") {
    return (
      <span
        className="inline-flex shrink-0 text-muted-foreground"
        role="img"
        aria-label={t("item.statusConnecting")}
      >
        <Loader2 size={10} className="animate-spin" aria-hidden="true" />
      </span>
    );
  }
  // #1139 — distinct SHAPE per state (WCAG 1.4.1), not color alone:
  // connected = filled check circle, error = alert circle, disconnected =
  // hollow ring. Connecting keeps its spinner above. Each wraps the icon in
  // span[role="img"][aria-label] (repo pattern, e.g. DocumentDatabaseTree
  // rows.tsx) — a bare svg has no default role so the accessible name is
  // unreliable across AT/browser combos.
  if (status.type === "connected") {
    return (
      <span
        className="inline-flex shrink-0 text-success"
        role="img"
        aria-label={t("item.statusConnected")}
      >
        <CircleCheck size={10} aria-hidden="true" />
      </span>
    );
  }
  if (status.type === "error") {
    return (
      <span
        className="inline-flex shrink-0 text-destructive"
        role="img"
        title={status.message}
        aria-label={t("item.statusError", { message: status.message })}
      >
        <CircleAlert size={10} aria-hidden="true" />
      </span>
    );
  }
  return (
    <span
      className="inline-flex shrink-0 text-muted-foreground"
      role="img"
      aria-label={t("item.statusDisconnected")}
    >
      <Circle size={10} aria-hidden="true" />
    </span>
  );
}

export default function ConnectionItem({
  connection,
  selected = false,
  onSelect,
  onActivate,
  inGroup = false,
}: ConnectionItemProps) {
  const { t } = useTranslation("featuresConnection");
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<HTMLDivElement>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const activeStatuses = useConnectionStore((s) => s.activeStatuses);
  const { connect: connectToDatabase, disconnect: disconnectFromDatabase } =
    useConnectionLifecycle();
  const { removeConnection } = useConnectionMutations();
  const groups = useConnectionStore((s) => s.groups);
  const moveConnectionToGroup = useConnectionStore(
    (s) => s.moveConnectionToGroup,
  );

  const status = activeStatuses[connection.id] ?? { type: "disconnected" };
  const isConnected = status.type === "connected";
  const isConnecting = status.type === "connecting";
  const errorMessage = status.type === "error" ? status.message : null;
  // #1056 — 드라이버 원문을 사람 문장 + 행동 힌트로 분류. 미분류면 null 이라
  // 기존처럼 원문만 보여준다 (fail-open).
  const errorHint = errorMessage ? classifyDriverError(errorMessage) : null;
  const errorSummary = errorHint ? t(errorHint.titleKey) : errorMessage;
  const [showErrorDetail, setShowErrorDetail] = useState(false);

  // Row aria-label 의 상태어는 standalone status-dot(대문자 "Connecting" 등)
  // 과 달리 소문자다. 기존 `${name} — ${status.type}` 동작을 보존하기 위해
  // 별도 rowStatus 키를 쓴다.
  const statusLabel =
    status.type === "connected"
      ? t("item.rowStatus.connected")
      : status.type === "connecting"
        ? t("item.rowStatus.connecting")
        : status.type === "error"
          ? t("item.rowStatus.error")
          : t("item.rowStatus.disconnected");

  const handleSingleClick = () => {
    onSelect?.(connection.id);
  };

  const handleDoubleClick = async () => {
    if (!isConnected && !isConnecting) {
      const ok = await connectToDatabase(connection.id);
      if (ok) {
        onActivate?.(connection.id);
      }
    } else if (isConnected) {
      // Already connected — treat double-click as "activate" so the sidebar
      // jumps straight to the schema view.
      onActivate?.(connection.id);
    }
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={dragRef}
            className={`flex cursor-pointer items-center gap-2 ${inGroup ? "pl-6 pr-3" : "px-3"} py-1.5 hover:bg-muted select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
              dragging ? "opacity-40" : ""
            } ${selected ? "bg-primary/10 ring-1 ring-inset ring-primary/40" : ""}`}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            draggable
            aria-label={t("item.ariaLabel", {
              name: connection.name,
              status: statusLabel,
            })}
            onClick={handleSingleClick}
            onDoubleClick={handleDoubleClick}
            onKeyDown={(e) => {
              // #1142 — WAI-ARIA button pattern: activate on Enter AND Space.
              // preventDefault stops Space from page-scrolling this div.
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleDoubleClick();
              }
            }}
            onDragStart={(e) => {
              draggedConnectionId = connection.id;
              setDragging(true);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", connection.id);
            }}
            onDragEnd={() => {
              draggedConnectionId = null;
              setDragging(false);
            }}
          >
            <GripVertical
              size={12}
              className="shrink-0 cursor-grab text-muted-foreground/50"
              aria-hidden="true"
            />
            <StatusIndicator status={status} />
            <Database size={14} className="shrink-0 text-muted-foreground" />
            <span className="truncate text-sm text-foreground">
              {connection.name}
            </span>
            {connection.environment &&
              (connection.environment in ENVIRONMENT_META ? (
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 text-3xs font-medium leading-none"
                  style={{
                    backgroundColor: `${ENVIRONMENT_META[connection.environment as EnvironmentTag].color}20`,
                    color:
                      ENVIRONMENT_META[connection.environment as EnvironmentTag]
                        .color,
                  }}
                  title={
                    ENVIRONMENT_META[connection.environment as EnvironmentTag]
                      .label
                  }
                >
                  {
                    ENVIRONMENT_META[connection.environment as EnvironmentTag]
                      .label
                  }
                </span>
              ) : (
                // #1125 — a non-canonical tag was silent before (no badge at
                // all). Surface it as an info-level "Unknown" signal so the
                // user sees Safe Mode isn't keying off it; raw value in title.
                <span
                  className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-3xs font-medium leading-none text-muted-foreground"
                  title={t("item.unknownEnvironment", {
                    value: connection.environment,
                  })}
                >
                  {t("item.unknownEnvironmentBadge")}
                </span>
              ))}
            <span
              className="ml-auto shrink-0 rounded px-1 py-0.5 text-4xs font-semibold leading-none"
              style={{
                backgroundColor: `${DB_TYPE_META[connection.dbType].color}20`,
                color: DB_TYPE_META[connection.dbType].color,
              }}
              title={connection.dbType}
            >
              {DB_TYPE_META[connection.dbType].short}
            </span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            disabled={isConnecting}
            onClick={async () => {
              if (isConnected) {
                try {
                  await disconnectFromDatabase(connection.id);
                } catch {
                  toast.error(t("errors.disconnectFailed"));
                }
              } else {
                await connectToDatabase(connection.id);
              }
            }}
          >
            {isConnected ? <Unplug size={14} /> : <Plug size={14} />}
            {isConnected ? t("item.disconnect") : t("item.connect")}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => setShowEditDialog(true)}>
            <Pencil size={14} /> {t("item.edit")}
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger aria-label={t("item.moveToGroup")}>
              <FolderInput size={14} /> {t("item.moveToGroup")}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem
                disabled={connection.groupId === null}
                onClick={async () => {
                  if (connection.groupId !== null) {
                    try {
                      await moveConnectionToGroup(connection.id, null);
                    } catch {
                      toast.error(t("errors.moveFailed"));
                    }
                  }
                }}
              >
                {connection.groupId === null ? (
                  <Check size={14} />
                ) : (
                  <span className="inline-block w-3.5" aria-hidden="true" />
                )}
                {t("item.noGroup")}
              </ContextMenuItem>
              {groups.length > 0 && <ContextMenuSeparator />}
              {groups.map((g) => {
                const isCurrent = connection.groupId === g.id;
                return (
                  <ContextMenuItem
                    key={g.id}
                    disabled={isCurrent}
                    onClick={async () => {
                      if (!isCurrent) {
                        try {
                          await moveConnectionToGroup(connection.id, g.id);
                        } catch {
                          toast.error(t("errors.moveFailed"));
                        }
                      }
                    }}
                  >
                    {isCurrent ? (
                      <Check size={14} />
                    ) : (
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-full border border-border"
                        style={
                          g.color ? { backgroundColor: g.color } : undefined
                        }
                        aria-hidden="true"
                      />
                    )}
                    <span className="truncate">{g.name}</span>
                  </ContextMenuItem>
                );
              })}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuItem danger onClick={() => setShowDeleteConfirm(true)}>
            <Trash2 size={14} /> {t("item.deleteItem")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {errorMessage && !showErrorDetail && (
        <Button
          variant="ghost"
          size="xs"
          className="h-auto w-full justify-start px-3 py-0 text-left"
          onClick={() => setShowErrorDetail(true)}
          aria-label={t("item.showErrorDetails")}
        >
          <span className="shrink-0 w-2" />
          <span
            className="truncate text-xs text-destructive"
            title={errorMessage}
          >
            {errorSummary}
          </span>
        </Button>
      )}
      {errorMessage && showErrorDetail && (
        <div className="flex w-full items-start gap-2 px-3 py-0">
          <span className="shrink-0 w-2" />
          <div className="min-w-0 flex-1 text-destructive">
            {/* NOTE: title+hint 마크업은 @components/errors/DriverErrorHint 와
                의도적으로 동일 형태다. feature import 경계 룰로 `@components/**` 를
                import 할 수 없어 inline 복제한다 — 한쪽 변경 시 다른 쪽도 맞춰라. */}
            {errorHint && (
              <>
                <div className="text-xs font-medium">
                  {t(errorHint.titleKey)}
                </div>
                <p className="mt-1 text-xs opacity-90">
                  {t(errorHint.hintKey)}
                </p>
              </>
            )}
            <span
              className={`block break-all text-xs text-destructive${errorHint ? " mt-1 opacity-80" : ""}`}
            >
              {errorMessage}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => setShowErrorDetail(false)}
            aria-label={t("item.hideErrorDetails")}
          >
            <X />
          </Button>
        </div>
      )}

      {showEditDialog && (
        <ConnectionDialog
          connection={connection}
          onClose={() => setShowEditDialog(false)}
        />
      )}

      {showDeleteConfirm && (
        // Destructive confirm shares the role="alertdialog" surface + Cancel
        // focus with the other destructive dialogs (#1141 consistency).
        <AlertDialog
          open={showDeleteConfirm}
          onOpenChange={(open) => !open && setShowDeleteConfirm(false)}
        >
          <AlertDialogContent
            className="w-80 bg-secondary p-4"
            tone="destructive"
          >
            <AlertDialogHeader>
              <AlertDialogTitle className="text-sm font-semibold text-foreground">
                {t("item.deleteTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription className="mt-2 text-sm text-secondary-foreground">
                {t("item.deleteDescription", { name: connection.name })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="mt-4 flex justify-end gap-2">
              <AlertDialogCancel>{t("item.cancel")}</AlertDialogCancel>
              <Button
                variant="destructive"
                size="sm"
                onClick={async () => {
                  try {
                    await removeConnection(connection.id);
                    setShowDeleteConfirm(false);
                  } catch {
                    toast.error(t("errors.removeFailed"));
                  }
                }}
              >
                {t("item.delete")}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
