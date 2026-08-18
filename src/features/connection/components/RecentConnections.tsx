import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@components/ui/alert-dialog";
import { Button } from "@components/ui/button";
import { DB_TYPE_META } from "@lib/db-meta";
import { useRecentConnections } from "@lib/runtime/connection/useRecentConnections";
import { Clock, Database, Eraser, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Sprint 167 — format a `Date.now()` epoch ms timestamp as a short relative
 * time label (e.g. "just now", "5m ago", "3h ago", "2d ago").
 */
export function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface RecentConnectionsProps {
  onActivate?: (id: string) => void;
}

/**
 * Sprint 167 — Recent Connections UI for the launcher.
 * Sprint 290 — 항목별 X 삭제.
 * Sprint 296 — 내부 chevron header 제거. 외부 라벨 헤더와 중첩되어 사용자가
 * "탭이 하나 더 생긴" 모양으로 인식한 회귀를 막기 위함.
 * #2440 — 마운트 지점이 HomePage 의 footer 에서 `ConnectionBrowser` 의
 * `Recent` rail view 로 옮겨졌다. 이 컴포넌트 자체는 그대로다.
 *
 * #2433 — the row is the connect target, so remove is a hover/focus-only
 * affordance and "clear all" sits at the foot of the list rather than in the
 * launcher action bar.
 *
 * Renders the user's most recently used connections (from `mruStore`) resolved
 * against the full connection list from `connectionStore`. The cap is
 * `MAX_ENTRIES` in `src/stores/mruStore.ts`; the `slice` below is the second,
 * independent copy of that bound and is what holds when a caller seeds the
 * store past the cap.
 *
 * Activation: double-click or Enter triggers `onActivate`.
 */
export default function RecentConnections({
  onActivate,
}: RecentConnectionsProps) {
  const { t } = useTranslation("featuresConnection");
  const { resolved, removeRecent, clearRecent } = useRecentConnections();
  const [confirmClear, setConfirmClear] = useState(false);

  if (resolved.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground italic">
        {t("recent.empty")}
      </div>
    );
  }

  return (
    <>
      <div
        className="space-y-0.5"
        role="list"
        aria-label={t("recent.ariaList")}
      >
        {resolved.slice(0, 5).map(({ connectionId, lastUsed, conn }) => (
          <div
            key={connectionId}
            role="listitem"
            className="group flex items-center gap-2 px-3 py-1 text-sm cursor-pointer hover:bg-muted rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("recent.ariaItem", {
              name: conn.name,
              time: relativeTime(lastUsed),
            })}
            tabIndex={0}
            onClick={() => {}} // single click: nothing special
            onDoubleClick={() => onActivate?.(connectionId)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onActivate?.(connectionId);
            }}
          >
            <Database size={12} className="shrink-0 text-muted-foreground" />
            <span className="truncate text-foreground">{conn.name}</span>
            <span
              className="ml-auto shrink-0 rounded px-1 py-0.5 text-4xs font-semibold leading-none"
              style={{
                backgroundColor: `${DB_TYPE_META[conn.dbType].color}20`,
                color: DB_TYPE_META[conn.dbType].color,
              }}
            >
              {DB_TYPE_META[conn.dbType].short}
            </span>
            {/* Sprint 297 — swap slot: 평소엔 시간, 호버 시 같은 자리에 X.
                grid stack 으로 두 element 가 같은 cell 을 점유해 슬롯 width
                가 시간 텍스트 기준으로 안정 → X 등장 시 시각 점프 없음.
                시간 정보는 row 의 aria-label 에 보존되어 호버 의존 없음.
                #2433 — 두 자리가 `group-focus-within` 을 같이 탄다. 버튼만
                `focus-visible` 로 켜면 키보드로 왔을 때 시간이 안 꺼져 두
                element 가 같은 cell 에서 겹쳐 보인다. 행이 `tabIndex={0}` 라
                Tab 이 행에 닿는 순간 remove 가 드러나고, 한 번 더 Tab 하면
                버튼 자신이 focus 를 받는다. */}
            <div className="grid shrink-0 items-center justify-items-end">
              <div className="col-start-1 row-start-1 flex items-center gap-1 text-3xs text-muted-foreground whitespace-nowrap transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
                <Clock size={10} className="shrink-0" />
                <span>{relativeTime(lastUsed)}</span>
              </div>
              {/* #2433 — 과녁을 16px(p-0.5 + 12px 아이콘)에서 24px 로 키운다.
                  행 자체가 connect 과녁이므로 remove 는 hover·focus 때만
                  보이고, 슬롯 폭은 옆의 시간 텍스트가 잡아 두므로 버튼이
                  커져도 등장 시 시각 점프가 없다. */}
              <button
                type="button"
                aria-label={t("recent.removeAria", { name: conn.name })}
                className="col-start-1 row-start-1 flex h-6 w-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={(e) => {
                  e.stopPropagation();
                  removeRecent(connectionId);
                }}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <X size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* #2433 — 「전체 지우기」는 목록 끝이다. 예전 자리는 launcher action
          bar 의 Eraser 아이콘이었는데, 연결 추가·그룹 추가와 나란히 서 있어
          목록을 겨냥한 파괴적 동작이 목록보다 먼저 눌렸다. 목록이 비면
          위쪽 early return 이 이 자리까지 안 오므로 지울 것이 없을 때는
          버튼도 없다. `role="list"` 밖에 둔다 — 안에 넣으면 listitem 이
          아닌 자식이 목록의 접근성 트리에 섞인다. */}
      <div className="mt-1 border-t border-border pt-1">
        <button
          type="button"
          data-testid="recent-clear-all"
          className="flex w-full items-center gap-1.5 rounded px-3 py-1 text-left text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setConfirmClear(true)}
        >
          <Eraser size={12} className="shrink-0" aria-hidden="true" />
          <span className="truncate">{t("recent.clearAll")}</span>
        </button>
      </div>

      {/* #2433 — `clear_mru` 는 SQLite `mru` 테이블을 잘라내고 되돌리는
          경로가 없다. 게다가 이제 행마다의 remove 버튼 바로 아래에 서므로
          하나를 지우려던 손이 전부를 지우기 쉽다. 파괴적 confirm 규약
          (`memory/engineering/conventions/frontend/memory.md:64-65`)이 허용
          하는 `ConfirmDestructiveDialog` 는 `sqlPreview`/`statements`/
          `paradigm` 을 요구하고 `DryRunPreview` 로 `execute_query_dry_run`
          을 쏘는 SQL 전용이라 여기 맞지 않는다. 그래서 같은 규약이 인정하는
          다른 쪽인 AlertDialog 프리셋(`role="alertdialog"`)을 쓴다 — 같은
          feature 의 `ConnectionItem` 삭제·`ConnectionGroup` 삭제가 쓰는 모양
          그대로다. 150ms arm 은 안 넣었다: 그 규약(`:65-66`)이 arm 을
          `ConfirmDestructiveDialog` 와 RDB `SqlPreviewDialog` 에만 걸어 두어
          이 다이얼로그는 대상 밖이다. */}
      <AlertDialog
        open={confirmClear}
        onOpenChange={(open) => !open && setConfirmClear(false)}
      >
        <AlertDialogContent
          className="w-80 bg-secondary p-4"
          tone="destructive"
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm font-semibold text-foreground">
              {t("recent.clearTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription className="mt-2 text-sm text-secondary-foreground">
              {t("recent.clearDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 flex justify-end gap-2">
            <AlertDialogCancel>{t("recent.clearCancel")}</AlertDialogCancel>
            <Button
              variant="destructive"
              size="sm"
              data-testid="recent-clear-confirm"
              onClick={() => {
                clearRecent();
                setConfirmClear(false);
              }}
            >
              {t("recent.clearConfirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
