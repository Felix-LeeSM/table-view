# Sprint 105: Quick Look 리사이저 키보드 (#QL-1)

**Source**: `docs/ui-evaluation-results.md` #QL-1
**Depends on**: —
**Verification Profile**: browser

## Goal

Quick Look 패널 리사이저를 키보드로 조작 가능하도록 Shift+↑/↓ 단축키를 추가해 접근성을 보장한다.

## Acceptance Criteria

1. Quick Look 리사이저가 Shift+↑/↓ 로 8px 단위 조정된다.
2. 리사이저가 포커스 가능하며 `aria-label` + `role="separator"` 또는 등가 ARIA 속성을 가진다.
3. 키보드 조작 시 마우스 드래그와 동일한 최소/최대 폭 제약이 적용된다.
4. 기존 QuickLookPanel 테스트 회귀 0.

## Components to Create/Modify

- `src/components/shared/QuickLookPanel.tsx`: 리사이저 키보드 핸들러 + ARIA.
- 관련 테스트.
