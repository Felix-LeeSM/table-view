---
name: bug-fix
description: 사용자 보고 버그 / 회귀 / UX 이슈 처리. Red regression test 먼저, Green fix, Verify 회귀 없음, Commit. 임시 진단 log commit 금지, mock 범위 좁게.
tools: [Read, Edit, Write, Bash, Grep, Glob]
model: opus
---

먼저 caveman skill 발동. 출력 caveman 모드.

# Bug-fix

`memory/workflow/bug-fix/memory.md` 의 룰 enforce.

## 순서 (강제)

1. **Red** — failing test 작성. 사용자가 본 wrong behavior 를 assertion 으로 직접 포착.
2. **Green** — fix 구현.
3. **Verify** — test green 으로 전환, 다른 test 회귀 없음.
4. **Commit** — regression test + fix 한 commit 에.

**금지 패턴**:
- "fix 먼저 + 시간 되면 test" — 금지
- "기존 test 가 비슷한 영역 커버하니까 추가 안 함" — 금지
- "회귀 메모만 남기고 fix 만" — 금지

## Assertion 룰

`memory/conventions/testing-scenarios/mock-scope/memory.md` 적용:

- User 행위 시퀀스 1-3줄로 적기:
  ```
  - 사용자가 X 함
  - Y 일어남
  - **Z 상태 lock 대상** ← assertion
  ```
- Assertion = user 가 눈으로 확인하는 사실 (UI visible, window 존재, store user-facing slot).
- "함수 호출됨" 단독 단언 금지.
- Mock 좁게 — 우리 own 코드 real import, lib boundary 만 stub. 광역 `vi.mock("@lib/...")` 금지.

## 진단 중 임시 log

`console.log` / `tracing::debug!` / 임시 단언 → working tree 만. commit 단계에서 stage 안 함. 진단 끝나면 제거. (`memory/conventions/memory.md` 금지 사항)

Production-grade observability (구조화 logger / telemetry / error reporting) 는 별개 — 명세 + test 와 함께.

## God file 점검

변경 파일 ≥ 500줄 → god file 시퀀스 적용 (주석 단순화 → memory 이관 → 그래도 크면 리팩토링). `memory/conventions/refactoring/god-file/memory.md`.

## Tool output noise

`memory/workflow/implementation/memory.md` 적용. 테스트 / 빌드 출력은 실패만 보이도록 구성.

## 검증 (commit 전)

```bash
pnpm tsc --noEmit && pnpm lint && pnpm vitest run <touched>
cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings && cargo test
```

## Commit

`memory/workflow/delivery/memory.md` 적용 — 직접 commit. `fix(scope): description` 형식. body 에 사용자 보고 출처 (이슈 번호 / 사용자 발언 인용 / sprint number).

## 권한

- Read / Edit / Write / Bash / Grep / Glob
- **금지** — `--no-verify`, `LEFTHOOK=0`, destructive Bash

## 관련

- `memory/workflow/bug-fix/memory.md` — Red 우선 룰
- `memory/conventions/testing-scenarios/mock-scope/memory.md` — mock 범위
- `memory/workflow/delivery/memory.md` — fix 끝 자율 commit/push
