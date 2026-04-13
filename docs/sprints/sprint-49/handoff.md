# Sprint 49 Handoff

## Outcome
Sprint 44-49 shadcn/ui 도입 및 컴포넌트 리팩토링 최종 완료. 30개 컴포넌트 파일의 `--color-*` CSS 변수 참조를 shadcn 시맨틱 토큰으로 마이그레이션. 기존 CSS 변수 정의 39개(13개×3블록)를 제거하고 shadcn 토큰만 유지.

## Changed Files
| File | Purpose |
|------|---------|
| `src/index.css` | 기존 `--color-*` 변수 제거, `body` 스타일을 shadcn 토큰 사용 |
| `src/App.tsx` | `bg-background` 적용 |
| `src/components/ErrorBoundary.tsx` | `bg-background`, `text-foreground`, `bg-primary` 적용 |
| `src/components/TabBar.tsx` | shadcn 토큰 적용, `var(--primary)` 인라인 스타일 |
| `src/components/QueryEditor.tsx` | CodeMirror 테마 변수를 shadcn 토큰으로 마이그레이션 |
| `src/components/MainArea.tsx` | `border-border`, `bg-secondary`, `text-foreground` 등 |
| `src/components/ConnectionList.tsx` | `bg-primary/5`, `text-muted-foreground` |
| `src/components/StructurePanel.tsx` | `border-border`, `bg-secondary`, `text-foreground` 등 |
| `src/components/QueryTab.tsx` | `border-border`, `bg-secondary`, `text-destructive`, `text-emerald-500` 등 |
| `src/components/Sidebar.tsx` | `border-border`, `bg-secondary`, `hover:bg-muted`, `hover:bg-primary/90` 등 |
| `src/components/SchemaTree.tsx` | `bg-muted`, `bg-primary/10`, `text-primary`, `focus:border-primary` 등 |
| `src/components/QuickOpen.tsx` | `bg-background`, `border-border`, `text-foreground` |
| `src/components/QueryResultGrid.tsx` | `bg-secondary`, `text-secondary-foreground`, `text-destructive` 등 |
| `src/components/QueryLog.tsx` | `bg-emerald-500 dark:bg-emerald-400`, `bg-destructive` 등 |
| `src/components/FilterBar.tsx` | `bg-primary`, `text-primary`, `text-destructive` 등 |
| `src/components/DataGrid.tsx` | `border-border`, `bg-secondary`, `text-foreground` 등 |
| `src/components/ContextMenu.tsx` | `bg-muted`, `text-destructive` |
| `src/components/ConnectionItem.tsx` | `bg-muted-foreground`, `bg-destructive`, `hover:bg-destructive/90` |
| `src/components/ConnectionGroup.tsx` | `bg-primary/10`, `border-primary`, `bg-background` |
| `src/components/ConnectionDialog.tsx` | `border-border`, `bg-background`, `text-foreground` 등 |
| `src/components/ConfirmDialog.tsx` | `bg-secondary`, `bg-destructive`, `bg-primary` |
| `src/components/datagrid/DataGridTable.tsx` | `text-primary`, `border-border` |
| `src/components/datagrid/DataGridToolbar.tsx` | `text-primary`, `border-border` |
| `src/components/structure/ColumnsEditor.tsx` | `border-border`, `text-muted-foreground`, `text-primary` 등 |
| `src/components/structure/IndexesEditor.tsx` | `border-border`, `text-secondary-foreground`, `text-destructive` 등 |
| `src/components/structure/ConstraintsEditor.tsx` | `border-border`, `text-muted-foreground` 등 |
| `src/components/structure/SqlPreviewDialog.tsx` | `border-border`, `text-muted-foreground`, `text-destructive` |

### Test Files Updated
| File | Changes |
|------|---------|
| `TabBar.test.tsx` | `var(--color-accent)` → `var(--primary)` |
| `SchemaTree.test.tsx` | `bg-(--color-bg-tertiary)` → `bg-muted`, `bg-(--color-accent)/10` → `bg-primary/10`, `border-(--color-border)` → `border-border` |
| `QueryLog.test.tsx` | `color-success` → `emerald-500`, `color-danger` → `destructive` |
| `ContextMenu.test.tsx` | `color-danger` → `destructive` |

## Evidence
- `pnpm tsc --noEmit`: PASS
- `pnpm vitest run`: 32 files, 707 tests PASS
- `pnpm build`: PASS (CSS 41.76 KB, JS 752.77 KB)
- `pnpm lint`: PASS

## Assumptions
- `--color-success`는 shadcn에 대응 토큰이 없어 Tailwind 유틸리티(`emerald-500/emerald-400`)로 직접 지정
- QueryEditor.tsx의 CodeMirror 테마는 `var()` 인라인 스타일 필요 → shadcn CSS 변수명 사용
- CSS 크기 감소: 43.79 KB → 41.76 KB (-2.03 KB, 변수 정리 효과)

## Residual Risk
- 없음: 모든 스프린트 완료

## Next Sprint Candidates
- Phase 5 (Extended Features) 시작
