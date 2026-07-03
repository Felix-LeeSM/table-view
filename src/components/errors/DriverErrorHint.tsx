/**
 * DriverErrorHint — `classifyDriverError` 가 분류한 힌트를 KeyringFallbackToast
 * 톤(요약 + 행동 지침)으로 렌더한다 (issue #1056).
 *
 * 원문(detail)은 각 표면이 별도로 보존한다 — 이 컴포넌트는 요약/행동만 담는다.
 * `hint` 가 null(미분류)이면 아무것도 렌더하지 않아 어느 에러 표면에도 안전하게
 * 끼워 넣을 수 있다 (fail-open).
 *
 * 쿼리(QueryResultGrid)·search(searchUiError 표면들)가 재사용한다. 새 에러 UI
 * 컨테이너를 만들지 않고 기존 alert 안에 삽입한다.
 *
 * NOTE: ConnectionItem 은 feature import 경계 룰로 `@components/**` 를 import 할 수
 * 없어 title+hint 마크업을 inline 복제한다 — 마크업 변경 시
 * `src/features/connection/components/ConnectionItem.tsx` 의 error detail 블록도 맞춰라.
 */

import { useTranslation } from "react-i18next";

import type { DriverErrorHint as DriverErrorHintData } from "@lib/errors/driverErrorHints";
import { cn } from "@/lib/utils";

export interface DriverErrorHintProps {
  hint: DriverErrorHintData | null;
  /**
   * 요약 title 을 렌더할지. 이미 자체 label/summary 를 가진 표면(search 는
   * scope label 을 씀)은 `false` 로 힌트 문장만 보여준다. 기본 `true`.
   */
  showTitle?: boolean;
  className?: string;
}

export function DriverErrorHint({
  hint,
  showTitle = true,
  className,
}: DriverErrorHintProps) {
  const { t } = useTranslation();
  if (!hint) return null;
  return (
    <div className={className} data-slot="driver-error-hint">
      {showTitle && <div className="font-medium">{t(hint.titleKey)}</div>}
      <p className={cn("text-xs opacity-90", showTitle && "mt-1")}>
        {t(hint.hintKey)}
      </p>
    </div>
  );
}
