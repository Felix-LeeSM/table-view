# Sprint 324 Handoff — Slice G.2 (BSON editor wire-up + mongosh literal)

날짜: 2026-05-15
스코프 origin: `docs/sprints/sprint-324/contract.md`

## 결과

- 신규 unit: 6 (mqlGenerator BSON literal — ObjectId / ISODate /
  NumberDecimal / BinData + dot-nested 동거 + multi-key fallback)
- 신규 RTL: 3 (NestedExpandPopover BSON wire-up)
- 회귀: 0 — `pnpm vitest run --no-coverage` 3741 통과 / 10 skipped
  (sprint-323 기준 3732 → +9).
- 정적 체크: `pnpm tsc --noEmit` exit 0, `pnpm lint` exit 0.

## 변경 파일

- `src/lib/mongo/mqlGenerator.ts` — `tryFormatBsonLiteral()` 추가 + `__bson__:`
  tag 직렬화 string 의 wrapper 복원 단계 추가.
- `src/lib/mongo/mqlGenerator.test.ts` — 6 신규 케이스 (31 총).
- `src/components/document/NestedExpandPopover.tsx`:
  - `onCommitEdit` signature: `(path, value: string | Record<string, unknown>)`
  - `pendingByPath` signature: 동일 union.
  - entry rendering 가 `detectBsonType(entry.value) || detectBsonType(pendingValue)`
    로 BSON 인지 분기 — wrapper 면 `BsonTypeEditor`, 아니면 plain input.
  - `pendingDisplayText` helper — wrapper 면 mongosh literal 표기로 표시.
- `src/components/document/NestedExpandPopover.test.tsx` — 3 신규 RTL (Pencil
  → BsonTypeEditor mount / commit wrapper / invalid input hint).
- `src/components/document/DocumentDataGrid.tsx`:
  - `BSON_TAG = "__bson__:"` + `tagBsonWrapper()` helper.
  - `buildNestedPendingByPath` 가 tag prefix 인식 → wrapper 객체 복원.
  - `onCommitEdit` wrap layer 에서 wrapper → tag 직렬화 후 pendingEdits 에
    string 으로 보관 (Map<string,string|null> type signature 유지).

## 의사결정 (D-62..D-64)

- **D-62**: pendingEdits Map type widening 거부 — Map<string, string|null>
  은 RDB/store/sqlGenerator 등 다수 곳에서 사용 중. wrapper 보관을 위한
  type widening 은 광범위 회귀 위험 → tag-prefix 직렬화로 우회. mqlGenerator
  가 prefix 인지 시 parse 해 wrapper 복원.
- **D-63**: `__bson__:` prefix 는 unique sentinel — 사용자 입력은 절대
  `__bson__:` 으로 시작하는 raw string 을 input 으로 치지 않는다는 가정
  (input validation 으로 차단 가능하나 현 v0 에서는 사용자가 직접
  타이핑할 수단도 없음). 추후 raw-string 모드 추가 시 escape 정책 검토.
- **D-64**: BinData subType picker 미도입 — G.1 의 D-61 그대로. v0 generic
  (00) 고정. literal `BinData(0, "...")` 의 0 은 hex "00" parsing 결과.

## 다음

Slice H (Sprint 325) — Field projection dialog (include/exclude). 사용자가
columns 의 visibility 와 별도로 server-side projection 을 wire — 큰
document 의 read 비용 절감.
