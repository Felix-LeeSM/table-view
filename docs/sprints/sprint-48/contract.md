# Sprint Contract: Sprint 48

## Summary

- Goal: StructurePanel(1718줄)을 3개 에디터 서브 컴포넌트로 분해
- Verification Profile: `command`

## In Scope

- Columns 에디터 → `structure/ColumnsEditor.tsx`
- Indexes 에디터 → `structure/IndexesEditor.tsx`
- Constraints 에디터 → `structure/ConstraintsEditor.tsx`
- SqlPreviewDialog → `structure/SqlPreviewDialog.tsx` (공유)
- StructurePanel 본체를 서브탭 전환 + 조립 역할로 경량화

## Out of Scope

- shadcn 프리미티브 적용 (Sprint 49)
- 기능 변경 없음
- SchemaTree 정리 (Sprint 49)

## Invariants

- 707 테스트 모두 통과
- 기존 StructurePanel 기능 동일
- `pnpm build`, `pnpm tsc --noEmit`, `pnpm lint` 통과

## Done Criteria

1. StructurePanel 메인 파일이 서브 컴포넌트 조립 역할 (목표: 500줄 이하)
2. Columns, Indexes, Constraints 에디터가 독립 파일로 분리
3. SqlPreviewDialog가 공유 컴포넌트로 분리
4. 모든 검사 통과
