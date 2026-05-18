---
title: /remember skill — 메모리 팔레스에 결정 / 룰 저장
type: skill
updated: 2026-05-18
task: memory-write, remember
trigger:
  signal: 사용자가 /remember 호출 / "기억해" 발언
  layer: agent-prompt (slash command body)
---

# /remember skill

`.claude/commands/remember.md` wrapper 가 가리키는 source. 모든 brain 공통.

인자 (`$ARGUMENTS`) + 최근 대화 맥락을 분석해, 8 type 매트릭스 중 가장 적합한
한 곳에 저장.

## Type 매트릭스

| 신호 | type | 위치 패턴 |
|---|---|---|
| 코드 작성 룰 (Rust/TS/테스트/주석/금지) | `convention` | `memory/conventions/<area>/memory.md` 또는 sub-room |
| 사용자 협업 phase 행동 룰 (grill / bug-fix / commit / cleanup) | `workflow-rule` | `memory/workflow/<phase>/memory.md` 또는 sub-room |
| 제품 UX 머지 기준 (영속 reset 등) | `ux-rule` | `memory/ux/memory.md` 또는 sub-room |
| 실행 절차 (cold-boot 측정 등) | `runbook` | `memory/runbook/<topic>/memory.md` |
| Slash command / skill body (`/remember`, `/split-memory` 등) | `skill` | `memory/skills/<name>/memory.md` (wrapper: `.claude/commands/<name>.md`) |
| 외부 도구 사용법 | `reference` | `memory/reference/<tool>/memory.md` 또는 **미이동** + 사용자 질의 옵션 |
| 트레이드오프 있는 결정 | `ADR` | `memory/decisions/NNNN-<slug>/memory.md` |
| 실패·성공·재발 방지 | `lesson` | `memory/lessons/<domain>/YYYY-MM-DD-<slug>/memory.md` |
| 시스템 구조 변화 | `topic` | `memory/<area>/memory.md` 갱신 |

## 동작 — 6 단계

1. **Type 판정** — 위 매트릭스. 두 type 사이 애매 시 사용자에게 1q.
2. **위치 계산**:
   - ADR `NNNN`: `memory/decisions/` 의 최대 번호 + 1 (4자리 zero-pad).
   - 슬러그: 주제 접두사 + 결정 꼬리 kebab-case (예: `global-state-zustand`).
   - sub-room 임계: 같은 영역 룰 누적되어 본문 200줄 위협 시 sub-room 분기.
3. **정합성 검증** (필수):
   - 기존 문서 / 메모리 (memory/, docs/, .claude/rules/) 와 모순 점검.
   - 모순 발견 시:
     - 1차: 코드베이스 현 상태 보고 판단. 어느 쪽이 현 코드에 맞나?
     - 2차: 코드만으로 결론 안 나면 사용자 질의.
4. **Reframe / 부분 / 미이동 옵션** (사용자가 reframe 가능):
   - 원본 룰을 일반화 / 좁히기 / 흡수 가능한지 점검.
   - 룰의 어떤 부분만 저장 가치 (예: protocol 만, marker 위치는 drift 위험 제외).
   - 시점 의존성 (예: codex 같은 도구) 은 미이동 + 사용자 질의 옵션 적합 가능.
   - 옵션을 사용자에게 짧게 제시 후 결정 받기.
5. **저장**:
   - 디렉토리 + `memory.md` 생성.
   - Frontmatter — type / updated / 필요 시 `trigger:` (signal + layer + hook_script).
   - 본문 — 룰 명세 + Why + How to apply + 관련 cross-link.
   - ADR 이면 `memory/decisions/memory.md` 인덱스 "활성 결정" 표에 한 행 추가.
   - 기존 ADR 뒤집기 시:
     - 새 ADR frontmatter `supersedes: NNNN`
     - 원본 ADR frontmatter `status: Superseded`, `superseded_by: NNNN` (메타만)
     - 인덱스에서 원본을 "역사" 섹션으로 이동
6. **인덱스 자동 갱신** — `bash scripts/regenerate-indexes.sh` 호출.
   `memory/index/by-task.md` + `memory/index/by-surface.md` 재생성.

## Frontmatter 필드

```yaml
---
name: <한 줄 제목>
description: <한 줄 설명 — 미래 재방문 시 trigger 신호>
type: convention | workflow-rule | ux-rule | runbook | skill | reference | ADR | lesson | topic
updated: YYYY-MM-DD
trigger:  # 선택 — 인지 layer 자동화 input
  signal: <어떤 상황에서 룰 발동되는가>
  layer: hook | agent-prompt | index
  hook_script: <hook 가능 시 script path>
surface:  # 선택 — by-surface index input. 코드 영역
task:  # 선택 — by-task index input. 작업 의도 키워드
---
```

## 인지 layer 가이드 (god file 만 우선 적용)

- `trigger.layer: hook` 룰 — `scripts/check-<rule>.sh` 작성 +
  `.claude/settings.json` PostToolUse 등록 (god file 첫 사례).
- `trigger.layer: agent-prompt` 룰 — 해당 agent definition
  (`.claude/agents/*.md`) 의 시스템 prompt 에 인용.
- `trigger.layer: index` 룰 — by-task / by-surface 자동 등록 (단계 6).

R2 (전면 자동 derive) 는 sprint-386 의 deferred work. 본 단계에서는 god file
만 layer enforce, 다른 룰은 frontmatter 만 기록.

## 본문 구조 (3 type 별 권장)

### ADR (3줄 inline)

```
**결정**: 한 문장.
**이유**: 한두 문장.
**트레이드오프**: + 장점 / - 단점.
```

### Lesson (3줄 inline)

```
**상황**: 한 문장.
**원인**: 한 문장.
**재발 방지**: 한 문장.
```

### Convention / Workflow-rule / UX-rule / Runbook

자유 형식. 필수: 룰 본문 + Why + How to apply + 관련 cross-link.

## 제약

- 200줄 초과 예상 시 즉시 분할 금지. 경고 출력 + `/split-memory` 안내.
- `memory/` 트리는 `memory.md` 만 (예외: `memory/index/*.md`). 다른 이름 금지.
- ADR 본문 동결 — 수정 금지. 메타 필드 (`status`, `superseded_by`) 만 갱신.
- `CLAUDE.md` 수정 금지 (자동 — 손 댈 일 거의 없음).
- auto-memory 와 중복 저장 금지 — repo 가 source of truth.

## 관련

- `/split-memory` — 200줄 초과 시 분할
- `memory/memory.md` — 팔레스 입구
- `scripts/regenerate-indexes.sh` — index 자동 갱신
