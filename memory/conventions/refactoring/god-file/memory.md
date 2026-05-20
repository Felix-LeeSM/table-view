---
title: God file 시퀀스 (500줄 임계)
type: convention
updated: 2026-05-17
task: refactor, god-file, comment-cleanup, decomposition
surface: '**/*.ts, **/*.tsx, **/*.rs'
trigger:
  signal: file >= 500 lines
  layer: hook (scripts/hooks/check-god-file.sh) + ESLint max-lines + agent-prompt
  hook_script: scripts/hooks/check-god-file.sh
---

# God file 시퀀스

## 임계 — 500줄

파일 line count ≥ 500 → "god file" 지정. 자동 감지:
- PostToolUse hook (`scripts/hooks/check-god-file.sh`) — Edit/Write 시 stderr 경고 + 본 문서 path 출력.
- ESLint `max-lines: 500` (warn).
- Clippy `too_many_lines` (활성 검토).

## 시퀀스

```
[탐지] file ≥ 500 줄
   ↓
[1단계] 주석 단순화
   - sprint history 메타 (Sprint NNN / AC-NNN / category B/D/C/A / N call sites) 제거
   - load-bearing WHY (race guard / OS quirk / 라이브러리 hack / 의도된 정렬 의존성) 는 보존 또는 memory 로 이관
   ↓
[정합성 검증] 매 이관 시점
   - 옮기는 주석 vs 현 문서 (docs/, memory/) 모순?
   - 1차: 코드베이스 현 상태 보고 판단
   - 2차: 모순 여전 → 사용자 질의
   ↓
[2단계] 그래도 ≥ 500줄 → 리팩토링 (decomposition sub-room 의 5+ commit 시퀀스)
```

## 주석 분류

### 제거 — rot 빠른 메타

- "Sprint NNN — ..." prefix 의 history 서술 (어느 sprint에서 도입/이동/리네임)
- "extracted from N-line god file" 식 refactoring 출처
- "AC-NNN-NN" / "Sprint contract" 사양 인용
- 라인 수, 카테고리 (B/D/C/A), 테스트 카운트 같은 메타 트리비아
- caller list ("11 sites", "8 call sites") — grep으로 검증되므로 rot

### 보존 — load-bearing WHY

- **Invariants** — race condition guard, stale-response drop, idempotent set membership
- **Hidden constraints** — macOS Cmd+W fallthrough, Radix portal mount race, jsdom focus quirks
- **Subtle rationale** — type-aware editor seed, drag-vs-click 4px threshold, exhaustive-deps 의도적 suppression 이유
- **사양 외 정렬 의존성** — `tokio::select!` 의 cancel token 옵저버블

## 작업 단위

- 디렉토리 tree (예: `datagrid/`, `stores/`, `hooks/+lib/`) — 한 라운드 ≒ 한 commit.
- 테스트 파일 건드리지 않음 (별 룰 — test-documentation: Reason/Date/Purpose 보존).
- WIP 영역 (uncommitted untracked) 건너뜀.

## 검증

매 commit 전:
```bash
pnpm tsc --noEmit && pnpm lint && pnpm vitest run <touched-tree>
```

## Commit 메시지

`docs(comments): trim sprint-history narrative in <area>` 형식. body 에 보존한 load-bearing WHY 항목 나열.

## Memory 이관 패턴

주석 본문이 cross-component invariant 이거나 lessons/decisions 가치 있으면:
- 별도로 `memory/lessons/YYYY-MM-DD-<slug>/memory.md` 추가
- 또는 ADR 가치 있으면 `/remember` skill 으로 `memory/decisions/NNNN-<slug>/`
- 코드 주석은 그 메모리에 cross-link (단 link rot 위험 — 메모리 path 변경 가능성 고려)

## Why

- Sprint history 는 git log/blame 이 더 정확하고 갱신 안 됨 → rot.
- CLAUDE.md comment policy ("only WHY when non-obvious; no WHAT/sprint-history") 정합.
- 사용자 지시 (2026-05-05): "memory 로 필요한 건 옮기고, 간단하게 병합할만하거나 요약할만한 건 요약."
- 500줄 임계 (2026-05-17): 사용자 reframe — 단순 주석 정리 룰이 god file 시퀀스 트리거로 격상.

## 관련

- [refactoring](../memory.md) — 4 카테고리 (B/D/C/A) 룰셋
- [decomposition](../decomposition/memory.md) — god file commit 시퀀스 (5+ commit)
- `scripts/hooks/check-god-file.sh` — hook script
- CLAUDE.md — comment policy (WHY only)
