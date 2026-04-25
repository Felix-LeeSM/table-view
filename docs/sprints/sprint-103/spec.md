# Sprint 103: 단축키 cheatsheet 모달 (P1 #8)

**Source**: `docs/ui-evaluation-results.md` P1 #8
**Depends on**: sprint-96
**Verification Profile**: browser

## Goal

`?` 또는 Cmd+/ 키 입력 시 단축키 cheatsheet 모달을 띄워 모든 단축키를 그룹별로 보여준다.

## Acceptance Criteria

1. `?` 또는 Cmd+/ 키 입력 시 단축키 cheatsheet 모달(sprint 96 `PreviewDialog` 또는 `TabsDialog` preset) 이 열린다.
2. 글로벌/컴포넌트별 모든 단축키가 그룹별로 표시된다.
3. cheatsheet 가 텍스트 검색 가능하다 (간단한 input 필터).
4. INPUT/TEXTAREA 포커스 중에는 `?` 키가 발화하지 않는다 (sprint 104 KEY-1 가드와 일관).

## Components to Create/Modify

- `src/components/shared/ShortcutCheatsheet.tsx` (신규): 모달.
- `src/App.tsx` 또는 단축키 라우터: `?` / Cmd+/ 핸들러.
