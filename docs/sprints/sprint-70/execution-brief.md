# Sprint 70 Execution Brief — Phase 6 plan D-1 (BsonTreeViewer component + tests)

## Objective

이미 작성된 `src/components/shared/BsonTreeViewer.tsx`(450줄)를 contract와 일치시키고 테스트를 보강한다. Sprint 71에서 소비될 read-only BSON 트리 뷰어의 품질 확보가 전부.

## Task Why

- 이전 Generator 시도에서 컴포넌트는 썼으나 stream idle timeout으로 테스트·통합 미완.
- Sprint 70에서 **통합까지** 넣었다가 timeout을 재발시키는 리스크 회피 필요. 컴포넌트+테스트만 좁혀 최소 risk로 clean PASS 확보 → Sprint 71이 배선에만 집중.
- plan 상 "Sprint D"는 컴포넌트+통합을 한 덩어리로 두었으나, 로드맵 +3 밀림과 idle timeout 이력을 고려해 **D-1 / D-2**로 재분할. D-2는 Sprint 71.
- generator 책임 check를 파일 범위 vitest + tsc + lint + cargo fmt/clippy로 좁혀 **stream idle** 리스크 최소화. 전체 vitest / cargo test --lib은 orchestrator가 담당.

## Scope Boundary

### In
- `src/components/shared/BsonTreeViewer.tsx` — 기존 450줄을 읽고 contract와 대조, 필요 시 수정.
- `src/components/shared/BsonTreeViewer.test.tsx` — 신규, ≥ 9개 테스트 (AC-01 ~ AC-09 각 1개 이상).

### Out
- `QuickLookPanel.tsx` 수정 일체 (Sprint 71).
- `DocumentDataGrid.tsx` 이동/selection/isDocumentSentinel 교체 (Sprint 71).
- `MongoAdapter::find/aggregate` 실제 구현 (Sprint 72).
- Find/Aggregate 쿼리 탭 (Sprint 72).
- 인라인 편집, 문서 추가/삭제, MQL Preview (Sprint 73).
- 전체 vitest suite 실행 — orchestrator 책임.
- `cargo test --lib` — orchestrator 책임.

## Invariants

- 이번 스프린트가 수정하지 않는 모든 파일 diff 0 (`git status`로 확인).
- 기존 테스트 파일(`src/components/shared/QuickLookPanel.test.tsx`, `src/components/datagrid/*`, `src-tauri/**`) diff 0.
- `src/types/document.ts` shape 불변 (필요하면 이번 스프린트는 소비하지 않음).
- Other agents의 in-flight 변경(`postgres.rs`, `Sidebar.tsx`, `query/**`, `ThemePicker.tsx`, `index.css`, `SqlSyntax.tsx`, `sqlTokenize**`, `memory/lessons/**`) 건드리지 않음.

## Done Criteria

1. `BsonTreeViewer.tsx`가 contract 항목을 충족 — 재귀 트리, whitelist 뱃지, 경로/값 복사, aria-expanded, null-safe. 기존 450줄 기반으로 **최소 수정**.
2. `BsonTreeViewer.test.tsx`에 ≥ 9개 테스트. 각 AC를 테스트명 규칙(`AC-01_...` 등) 또는 `describe` 블록 이름으로 매핑.
3. Generator scope 체크 5건 모두 통과:
   - `cd src-tauri && cargo fmt --all -- --check`
   - `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
   - `pnpm tsc --noEmit`
   - `pnpm lint`
   - `pnpm vitest run src/components/shared/BsonTreeViewer.test.tsx`
4. `handoff.md` 작성: 변경 파일, 체크 결과, AC → 테스트 매핑, 가정, 잔여 위험.

## Verification Plan

- Profile: `command`
- Required checks (generator 실행):
  1. `cd src-tauri && cargo fmt --all -- --check`
  2. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
  3. `pnpm tsc --noEmit`
  4. `pnpm lint`
  5. `pnpm vitest run src/components/shared/BsonTreeViewer.test.tsx`
- Orchestrator가 별도로 실행:
  - `cd src-tauri && cargo test --lib` (회귀 확인)
  - `pnpm vitest run` (전체 suite)
- Required evidence:
  - 변경 파일 목록, 각 AC → 테스트 매핑, 5개 체크 실행 결과, 뱃지 whitelist 코드 위치 인용.

## Evidence To Return

- Changed files with purpose.
- 5개 check 결과 요약.
- AC-01 ~ AC-09 각각에 대응하는 테스트 이름 + 파일 경로.
- 뱃지 whitelist 판정 로직 위치(라인 범위).
- Assumptions:
  - 뱃지 whitelist 단일/2-키 규칙.
  - 경로 포맷 (식별자/비식별자 키, 배열).
  - 클립보드 API: `navigator.clipboard.writeText` (feature-detect fallback 없음).
- Residual risk:
  - 기존 450줄 BsonTreeViewer.tsx가 contract의 whitelist 규칙과 일부 어긋날 가능성 → 감사 후 수정.
  - 대용량 문서 성능 미검증 (Phase 6 scope 밖).

## Implementation Hints

- **첫 단계는 읽기**: 기존 `BsonTreeViewer.tsx` 450줄을 끝까지 Read. 아래 기준으로 감사:
  1. `detectBsonBadge()` 같은 whitelist 판정 함수 존재 여부.
  2. whitelist가 contract 14종 wrapper를 전부 커버하는가 (`$oid`, `$date`, `$numberLong`, `$numberDouble`, `$numberInt`, `$numberDecimal`, `$binary`, `$timestamp`, `$regularExpression`, `$symbol`, `$code`, `$minKey`, `$maxKey`, `$undefined`).
  3. 객체 키 set이 whitelist에 **완전히** 포함될 때만 뱃지. `$comment` + 기타 키 혼합은 object로.
  4. 경로 포맷: 식별자 키 `.key`, 비식별자 키 `["key"]`, 배열 `[i]`, 루트 빈 문자열.
  5. `navigator.clipboard.writeText` 호출 경로.
  6. `aria-expanded`, `role="tree"/"treeitem"` 존재.
  7. 키보드(Enter/Space) 접힘/펼침 지원.
- 변경이 필요하면 **작은 diff**로. 재작성 금지.
- `BsonTreeViewer.test.tsx`는 다음 구조 권장:
  ```tsx
  import { render, screen } from "@testing-library/react";
  import userEvent from "@testing-library/user-event";
  import { describe, it, expect, vi, beforeEach } from "vitest";
  import BsonTreeViewer from "./BsonTreeViewer";

  describe("BsonTreeViewer", () => {
    let writeText: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("navigator", { clipboard: { writeText } });
    });
    // AC-01 ~ AC-09
  });
  ```
- 뱃지 테스트 예:
  ```tsx
  it("AC-03 renders ObjectId badge for canonical $oid", () => {
    render(<BsonTreeViewer value={{ id: { $oid: "507f191e810c19729de860ea" } }} />);
    expect(screen.getByText(/ObjectId/)).toBeInTheDocument();
  });
  ```
- `$comment` 오인 방지 테스트:
  ```tsx
  it("AC-04 does not misclassify { $comment: '...' } as a badge", () => {
    render(<BsonTreeViewer value={{ meta: { $comment: "note" } }} />);
    expect(screen.queryByText(/ObjectId|Binary|NumberLong/)).toBeNull();
  });
  ```
- 경로 복사 테스트:
  ```tsx
  it("AC-05 copies nested path on key button click", async () => {
    const user = userEvent.setup();
    render(<BsonTreeViewer value={{ user: { profile: { emails: ["a@b.com"] } } }} />);
    // expand first...
    // click 'emails' key button → path "user.profile.emails"
    // then expand emails, click '[0]' key → "user.profile.emails[0]"
  });
  ```
- 경로 포맷이 기존 컴포넌트 구현과 다르면 **contract 쪽 기준을 따른다** — 기존 구현을 수정.

## References

- Contract: `docs/sprints/sprint-70/contract.md`
- Master plan: `/Users/felix/.claude/plans/idempotent-snuggling-brook.md` (Sprint D 섹션, 이번 사이클에서 D-1/D-2로 분할)
- 이전 Sprint 66 handoff: `docs/sprints/sprint-66/handoff.md`
- Relevant files:
  - `src/components/shared/BsonTreeViewer.tsx` (기존 450줄, 감사 대상)
  - `src/components/shared/BsonTreeViewer.test.tsx` (신규)
  - `src/types/document.ts` (read-only 참고용)
  - `.claude/rules/react-conventions.md`, `.claude/rules/testing.md`
