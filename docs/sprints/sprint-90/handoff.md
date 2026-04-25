# Sprint 90 → next Handoff

## Sprint 90 Result
- **PASS** (9.8/10, 1 attempt)
- 4 AC 모두 PASS, 회귀 0.

## 산출물
- `QuickLookPanel.tsx`: 컬럼명/타입 inline → 2줄 분리 (`flex flex-col` + 두 sibling).
- 시각 위계: 컬럼명 `font-mono text-xs`, 타입 `text-3xs opacity-60`.
- 긴 컬럼명/타입 `whitespace-normal break-words` 로 truncate 차단.

## 인계
- 다른 패널 (CellDetailDialog, BlobViewer 등) 도 동일 정책 채택 시 sprint-90 패턴 재사용 가능.
- 폭은 `w-44` 유지. spec 권고였던 `w-48` 변경은 채택 안 됨 (필요 시 별도 sprint).
