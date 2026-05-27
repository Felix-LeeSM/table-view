---
title: Implementation — agent 자율성 + noise 차단
type: workflow-rule
updated: 2026-05-17
task: implementation, code-writing, refactor, agent-autonomy
trigger:
  signal: 사용자가 코드 작성/구현/refactor 지시
  layer: agent-prompt (tdd-generator / bug-fix / refactor agent)
---

# Implementation — agent 자율성 + noise 차단

## 1. Agent 자율성

사용자가 매 step narration 받을 필요 X. agent 가 자기 판단으로 작업 구성 / 순서 / 도구 선택. narration 으로 사용자 sync 강제 금지.

**사용자에게 보고는 다음 3 시점만**:
- sprint 시작 시 작업 단위 1줄 ("spec/generator/postgres/mongo/CLI 작성")
- 묶음 끝 짧은 상태 ("spec + generator 통과, postgres+mongo 작성 중")
- 마지막 결과 요약 1-3 문장

**Why**: 사용자 2026-05-10 "쓰잘데기 없는 로그 많이 보면서 context 및 토큰 낭비 마라". narration 부산물이 context window + 토큰 빠르게 소모. 사용자가 확인 원하는 건 도구 결과지 자연어 보고 아님.

## 2. Tool output noise 차단

명령 자체를 noise 최소화로 구성. 성공한 항목 리스트 = noise. **실패만 보면 됨**.

| 도구 | 권장 |
|---|---|
| 테스트 | `--reporter=dot` / `--quiet` / `2>&1 \| grep -E "FAIL\|error\|panic"` / `... \| tail -50` |
| 빌드 | `--quiet` / 성공 시 nothing, 실패 시 stderr 만 |
| Lint | eslint `--quiet` / `--format compact` |
| Grep / find | 정확한 패턴 + `\| head -N` cap. 전체 stdout 받기 금지 |
| 로그 파일 | `tail -N` / `grep` 필터. `cat <large.log>` 금지 |
| 다중 명령 chain | `&&` fail-fast. 성공 중간 step output 안 보임 |

## 3. Noise 판정

**Noise 의 의미**: 사용자 결정 / agent 후속 동작에 *영향 없는* 정보. 영향 있는 정보 (실패, 변경 파일 목록, 단언 결과) 는 noise 아님.

**판정 기준**: "이 출력 빼면 다음 동작 바뀌나?" 안 바뀌면 noise. 빼.

## 4. 적용 phase

- **적용** — implementation 작업 전반 (코드 작성, 테스트 실행, 빌드, 검증)
- **미적용 (사용자 인풋 매 step 필요)** — planning / decision-making / grill-me skill

## 관련

- `grill-me` skill — narration 권장 phase (반대)
- [bug-fix](../bug-fix/memory.md) — Red→Green 진행 시 본 룰 적용
- [delivery](../delivery/memory.md) — 완료 phase. 본 룰의 연속
- caveman — 출력 압축 모드 (직교 — caveman = 매 출력 어휘, 본 룰 = 작업 phase 구조)
