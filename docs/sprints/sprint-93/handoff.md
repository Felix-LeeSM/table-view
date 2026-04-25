# Sprint 93 → next Handoff

## Sprint 93 Result
- **PASS** (9.0/10, 1 attempt)
- 5 AC 모두 PASS, 회귀 0 (1660 / 1660 tests).

## 산출물
- `sqlGenerator.ts`: `generateSqlWithKeys` 추가 — `{ sql, key? }[]` 반환. `generateSql` 은 backward-compatible wrapper.
- `useDataGridEdit.ts`:
  - `CommitError` interface + `commitError` state + `sqlPreviewStatements` 키 미러.
  - SQL 브랜치 per-statement try/catch — 실패 statement idx + DB 메시지 + 원문 SQL 기록, sqlPreview 유지, 실패 cell 키를 `pendingEditErrors` 에 추가.
  - 부분 실패 메시지: `executed: N, failed at: K of M — <message>`.
- `SqlPreviewDialog.tsx`: 선택 `commitError` prop, `role="alert"` destructive banner.
- `DataGrid.tsx`: inline preview 모달에 commitError 전달, 실패 statement 강조.
- `useDataGridEdit.commit-error.test.ts` (신규): 단순/부분 실패, happy-path 회귀, commitError 리셋 (fresh commit/modal dismiss), 정적 회귀 가드(`?raw` import + SQL branch slice + empty catch 0).

## 인계
- MQL 브랜치 (`paradigm === "document"`, `useDataGridEdit.ts:660` 부근) 의 빈 catch 는 같은 패턴 latent silent swallow — 별도 sprint 에서 동일하게 fill 필요.
- `SqlPreviewDialog` 는 props 로 `commitError` 받을 수 있게 됐지만 실제 사용은 `DataGrid.tsx` inline modal 이 한다. 향후 SqlPreviewDialog 직접 사용 시 RTL 테스트로 banner 단언 추가 권장.
- `?raw` 정적 회귀 가드 패턴은 다른 sprint 에서 빈 catch 회귀 가드로 재사용 가능.
