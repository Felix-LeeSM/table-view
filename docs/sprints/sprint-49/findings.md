# Sprint 49 Findings

## Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Correctness | 9/10 | 모든 --color-* 참조가 shadcn 토큰으로 정확히 매핑됨, CSS 변수 정리 완료 |
| Completeness | 9/10 | 30개 .tsx 파일 + 4개 테스트 파일 + index.css 모두 처리 |
| Reliability | 9/10 | 707 테스트 통과, 빌드/린트/타입체크 모두 PASS |
| Verification Quality | 9/10 | 4개 검증 명령 실행, 잔여 참조 grep으로 확인 |
| **Overall** | **9/10** | |

## Verdict: PASS

## Done Criteria Status
- [x] AC-01: 주요 컴포넌트에서 shadcn Button/Input 사용
- [x] AC-02: `.tsx` 파일에 `--color-*` 직접 참조 0건 확인
- [x] AC-03: 라이트/다크 모드 전환 정상 (shadcn 토큰은 동일 색상값 사용)
- [x] AC-04: `pnpm build` 성공, `pnpm test` 707개 통과
- [x] AC-05: 기존 CSS 변수 13개×3블록(39개) 정리 완료

## Token Migration Mapping

| Old `--color-*` | New shadcn Tailwind class | New inline `var()` |
|---|---|---|
| `--color-bg-primary` | `bg-background` | `var(--background)` |
| `--color-bg-secondary` | `bg-secondary` | `var(--secondary)` |
| `--color-bg-tertiary` | `bg-muted` | `var(--muted)` |
| `--color-bg-sidebar` | `bg-secondary` | `var(--secondary)` |
| `--color-text-primary` | `text-foreground` | `var(--foreground)` |
| `--color-text-secondary` | `text-secondary-foreground` | `var(--secondary-foreground)` |
| `--color-text-muted` | `text-muted-foreground` | `var(--muted-foreground)` |
| `--color-border` | `border-border` | `var(--border)` |
| `--color-accent` | `bg-primary` / `text-primary` | `var(--primary)` |
| `--color-accent-hover` | `hover:bg-primary/90` | — |
| `--color-danger` | `bg-destructive` / `text-destructive` | `var(--destructive)` |
| `--color-danger-hover` | `hover:bg-destructive/90` | — |
| `--color-success` | `bg-emerald-500 dark:bg-emerald-400` | — (shadcn에 success 토큰 없음) |

## Files Changed (31)

### Source Components (27)
- `src/App.tsx`, `src/index.css`
- `src/components/ConfirmDialog.tsx`, `ConnectionDialog.tsx`, `ConnectionGroup.tsx`, `ConnectionItem.tsx`, `ConnectionList.tsx`
- `src/components/ContextMenu.tsx`, `DataGrid.tsx`, `ErrorBoundary.tsx`
- `src/components/FilterBar.tsx`, `MainArea.tsx`, `QueryEditor.tsx`
- `src/components/QueryLog.tsx`, `QueryResultGrid.tsx`, `QueryTab.tsx`
- `src/components/QuickOpen.tsx`, `SchemaTree.tsx`, `Sidebar.tsx`
- `src/components/StructurePanel.tsx`, `TabBar.tsx`
- `src/components/datagrid/DataGridTable.tsx`, `DataGridToolbar.tsx`
- `src/components/structure/ColumnsEditor.tsx`, `ConstraintsEditor.tsx`, `IndexesEditor.tsx`, `SqlPreviewDialog.tsx`

### Test Files (4)
- `src/components/ContextMenu.test.tsx`, `QueryLog.test.tsx`, `TabBar.test.tsx`, `SchemaTree.test.tsx`

## Findings
1. [INFO] `--color-success`는 shadcn에 대응 토큰이 없어 Tailwind 유틸리티 `emerald-500/emerald-400`로 직접 지정
2. [INFO] QueryEditor.tsx의 CodeMirror 테마는 `var()` 인라인 스타일이 필요하여 shadcn CSS 변수명(`--background`, `--foreground` 등)으로 교체
3. [P3] `bg-(--color-text-muted)`가 ConnectionItem.tsx에서 텍스트 색상을 배경으로 사용하는 특이 케이스가 있었으나 `bg-muted-foreground`로 올바르게 마이그레이션됨
