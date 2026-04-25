# Sprint 96: Dialog 2-Layer Preset Wrappers (§6.6 part 2)

**Source**: `docs/ui-evaluation-results.md` §6.6 part 2
**Depends on**: sprint-95
**Verification Profile**: command

## Goal

Layer 2 preset wrapper 4종 — `ConfirmDialog`(기존을 일반화), `FormDialog`, `PreviewDialog`, `TabsDialog` — 을 도입해 9개 모달을 preset 으로 감싼다. `ConnectionDialog` 만 escape hatch 로 Layer 1 단독 사용을 명시.

## Acceptance Criteria

1. 4개 preset wrapper 가 `src/components/ui/dialog/` 또는 `src/components/shared/` 하위에 존재한다. 각 preset 은 Layer 1 primitive 만 사용한다.
2. 9개 dialog (`GroupDialog`, `ImportExportDialog`, `BlobViewerDialog`, `CellDetailDialog`, `SqlPreviewDialog`, `MqlPreviewModal`, `AddDocumentModal`, 기존 `ConfirmDialog` 호출처, `StructurePanel` 의 확인 모달 등) 가 각각 적절한 preset 으로 마이그레이션된다.
3. `ConnectionDialog` 는 Layer 1 base primitive 만 사용하고, 코드 상단 주석으로 "escape hatch — preset 사용 안 함" 사유가 명시된다 (디자인 결정 보존).
4. preset 사용 규칙이 `docs/dialog-conventions.md` (신규) 에 문서화된다 — 어떤 preset 을 언제 쓸지, escape hatch 허용 조건.
5. 시각/동작 회귀 0: 모든 dialog 테스트 통과, 추가로 preset 자체 단위 테스트 ≥ 4 (preset 당 1개).

## Components to Create/Modify

- `src/components/ui/dialog/ConfirmDialog.tsx`: 기존을 일반화해 preset 으로 등록.
- `src/components/ui/dialog/FormDialog.tsx` (신규): Form 패턴 preset (header/body/footer + submit/cancel).
- `src/components/ui/dialog/PreviewDialog.tsx` (신규): SQL/MQL/Cell/Blob 미리보기 패턴.
- `src/components/ui/dialog/TabsDialog.tsx` (신규): Tabs 기반 다이얼로그 (ImportExport, Blob hex/text).
- `docs/dialog-conventions.md` (신규): preset 사용 규칙 + escape hatch 정책.
- 9개 dialog 파일: preset 사용으로 마이그레이션.
