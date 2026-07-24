import { type ReactNode } from "react";

/**
 * Sprint 293 — Structure sub-tab UI primitives.
 *
 * Columns / Indexes / Constraints / Triggers 4 sub-tab 가 공통으로 쓰는
 * 외곽 (shell + action bar + empty state) 을 한 곳에 모은다. 행/셀 자체는
 * 패턴 다양성 (icon prefix, FK 색, badge, monospace 등) 때문에 컴포넌트화
 * 하지 않고 className constants 로 export — JSX 가 가벼우면서도 동기화 보장.
 *
 * P1 결정에 따라 Triggers 의 card body 는 자체 유지하고 Shell/ActionBar/Empty
 * 만 공유한다.
 */

export interface StructureShellProps {
  children: ReactNode;
}

/**
 * 4 sub-tab 의 outer container. `flex flex-1 flex-col overflow-hidden` 로
 * sub-tab content 가 부모 panel 의 잔여 높이를 채우면서 내부 스크롤만 발생.
 */
export function StructureShell({ children }: StructureShellProps) {
  return <div className="flex flex-1 flex-col overflow-hidden">{children}</div>;
}

export interface StructureActionBarProps {
  /**
   * 좌측에 표시할 count / status label. `null` 이면 우측 정렬로만 동작.
   * Sprint 290 (Q1 결정) 에 따라 모든 sub-tab 이 count 를 노출 (`5 columns`,
   * `3 triggers`).
   */
  count?: ReactNode;
  /** 우측 액션 (보통 + 버튼 + 부속 액션). */
  actions: ReactNode;
}

/**
 * Sub-tab 헤더. count 가 있으면 `justify-between`, 없으면 `justify-end`.
 * 4 sub-tab 동일 시각 — sticky table head 와 색 통일 (`bg-secondary`).
 */
export function StructureActionBar({
  count,
  actions,
}: StructureActionBarProps) {
  return (
    <div
      className={
        count !== undefined && count !== null
          ? "flex items-center justify-between border-b border-border bg-secondary px-2 py-1"
          : "flex items-center justify-end border-b border-border bg-secondary px-2 py-1"
      }
    >
      {count !== undefined && count !== null && (
        <span className="text-2xs uppercase tracking-wider text-muted-foreground">
          {count}
        </span>
      )}
      <div className="flex items-center gap-1">{actions}</div>
    </div>
  );
}

export interface StructureEmptyProps {
  /** "No columns found" 같은 짧은 본문. */
  children: ReactNode;
}

/**
 * Sub-tab body 가 비었을 때 표시하는 italic placeholder. 4 sub-tab 통일.
 * `flex-1 items-center justify-center` 로 잔여 영역 중앙에 위치.
 */
export function StructureEmpty({ children }: StructureEmptyProps) {
  return (
    <div className="flex flex-1 items-center justify-center p-6 text-sm italic text-muted-foreground">
      {children}
    </div>
  );
}

export interface StructureTableProps {
  /**
   * 일부 sub-tab (Columns) 은 fixed layout 으로 열 폭을 안정시킨다.
   * 기본은 auto layout.
   */
  fixed?: boolean;
  children: ReactNode;
}

/**
 * Sub-tab table wrapper. overflow scroll + 동일 baseline 스타일. thead /
 * tbody 는 caller 가 STRUCTURE_TH / STRUCTURE_TD 토큰으로 직접 구성한다.
 */
export function StructureTable({ fixed, children }: StructureTableProps) {
  return (
    <div className="flex-1 overflow-auto">
      <table
        className={
          fixed
            ? "w-full table-fixed border-collapse text-sm"
            : "w-full border-collapse text-sm"
        }
      >
        {children}
      </table>
    </div>
  );
}

// ── className tokens (Sprint 293) ─────────────────────────────────────────
//
// 행/셀 패턴이 다양해서 컴포넌트로 추출하지 않고 토큰만 공유. 같은
// className constant 를 4 editor 가 import 해 inline 으로 사용 — TS / IDE
// 가 단일 source-of-truth 를 보장하면서도 추가 prop 폭주를 막는다.
//
// 통일된 행 높이는 `h-8` (32px). 종전 tr/td 는 `py-1` 만 두고 높이가
// 콘텐츠에 따라 변동했고 (button 셀이 빈 hover 상태일 때 짜부라드는 현상),
// vertical-align 미명시로 cell 들이 baseline 정렬돼 시각적으로 어긋났다.
// 본 토큰은 `h-8` + `align-middle` 로 두 결함을 함께 해결한다.

/** sticky table head wrapper — `<thead>` 에 직접 적용. */
export const STRUCTURE_THEAD = "sticky top-0 z-10 bg-secondary";

/** 일반 column 의 `<th>`. */
export const STRUCTURE_TH =
  "h-8 border-b border-r border-border px-3 py-1.5 text-left align-middle text-xs font-medium text-secondary-foreground";

/** 우측 actions column 의 `<th>` (고정 폭, 중앙 정렬). */
export const STRUCTURE_TH_ACTIONS =
  "h-8 w-20 border-b border-border px-1 py-1.5 text-center align-middle text-xs font-medium text-secondary-foreground";

/** 데이터 행 `<tr>` — group hover 로 actions 버튼 노출. */
export const STRUCTURE_TR = "group h-8 border-b border-border hover:bg-muted";

/**
 * 일반 데이터 `<td>`. caller 가 추가로 text-color / mono / max-w 토큰 합성.
 * `h-8` 은 table-cell 에서 CSS 2.2 §17.5.3 상 최소 높이 시맨틱 — 콘텐츠가 더
 * 크면 (ColumnsEditor 편집 시 `flex-col` 로 USING/경고 input 추가) 셀/행이 그에
 * 맞춰 성장하고, 정적 행은 32px floor 를 유지한다. table-cell 에서 `min-height`
 * 는 undefined (webview 별 무시 가능) 이므로 `h-8` 을 유지한다.
 */
export const STRUCTURE_TD =
  "h-8 border-r border-border px-3 py-1 align-middle text-xs text-foreground";

/** 우측 actions `<td>`. */
export const STRUCTURE_TD_ACTIONS =
  "h-8 w-20 border-l border-border px-1 py-1 text-center align-middle";
