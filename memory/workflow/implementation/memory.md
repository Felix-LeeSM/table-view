---
title: Implementation — agent 자율성 + noise 차단
type: workflow-rule
updated: 2026-07-27
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

| 도구            | 권장                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------- |
| 테스트          | `--reporter=dot` / `--quiet` / `2>&1 \| grep -E "FAIL\|error\|panic"` / `... \| tail -50` |
| 빌드            | `--quiet` / 성공 시 nothing, 실패 시 stderr 만                                            |
| Lint            | eslint `--quiet` / `--format compact`                                                     |
| Grep / find     | 정확한 패턴 + `\| head -N` cap. 전체 stdout 받기 금지                                     |
| 로그 파일       | `tail -N` / `grep` 필터. `cat <large.log>` 금지                                           |
| 다중 명령 chain | `&&` fail-fast. 성공 중간 step output 안 보임                                             |

## 3. Noise 판정

**Noise 의 의미**: 사용자 결정 / agent 후속 동작에 _영향 없는_ 정보. 영향 있는 정보 (실패, 변경 파일 목록, 단언 결과) 는 noise 아님.

**판정 기준**: "이 출력 빼면 다음 동작 바뀌나?" 안 바뀌면 noise. 빼.

## 4. 적용 phase

- **적용** — implementation 작업 전반 (코드 작성, 테스트 실행, 빌드, 검증)
- **미적용 (사용자 인풋 매 step 필요)** — planning / decision-making / grill-with-memory skill

## 5. 착수 전 체크리스트 — 반복 재발한 결함 유형

리뷰가 반복해서 잡던 것들이다. **리뷰어가 요구하기 전에 저자가 한다.** 리뷰
쪽으로 옮기면 기준이 단조 증가하고 저자는 무장 없이 맞는다 — 무장을 대칭으로 둔다.

| 유형 | 착수 전에 할 것 |
| ---- | ---------------- |
| 테스트가 있는데 못 잡음 | 새 assertion 은 지키려는 속성을 깨뜨렸을 때 RED 가 나는지 확인한다. green 만으로는 증명이 아니다 |
| 수치가 추론으로 생산됨 | PR body·주석의 정량 주장에 그것을 만든 명령을 붙이거나 수치를 뺀다 |
| 가드가 자기 청소분을 못 덮음 | 유형 청소 + 재발 가드를 같이 넣는 PR 은 "이 가드를 base 에 걸었으면 내가 고친 N 건 중 몇 건이 걸렸겠나" 를 실행해 숫자로 낸다 |
| 인용된 줄만 고침 | finding 은 유형으로 일반화해 전부 훑는다. 범위는 전수 명령의 출력으로 정의한다 |
| 같은 사실이 N 벌 손복제 | 하나를 고치면 나머지가 자기모순이 된다. 착수 시 `git grep` 으로 복제본을 먼저 센다 |
| 표를 heading 으로 해체 | 표가 인코딩하던 grouping 을 heading 계층이 떠안아야 한다. 순서 비교는 구조 보존을 증명하지 못한다 |

**Why**: 이 여섯이 2026-07 리뷰 라운드 폭증의 finding 공급원이었다. 리뷰어
컨텍스트에 두면 blocking 사유가 계속 늘고, 저자 컨텍스트에 두면 라운드가 줄어든다.
blocking 판정은 `.agents/skills/pr-review/SKILL.md` Verdict 원칙 1 의 세 사유로
고정이고 이 표는 거기에 추가되지 않는다.

## 관련

- `grill-with-memory` skill — narration 권장 phase (반대)
- [bug-fix](../bug-fix/memory.md) — Red→Green 진행 시 본 룰 적용
- [delivery](../delivery/memory.md) — 완료 phase. 본 룰의 연속
- caveman — 출력 압축 모드 (직교 — caveman = 매 출력 어휘, 본 룰 = 작업 phase 구조)
