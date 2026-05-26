# Handoff: Agentic Harness 문제점 분석 (23 Issues)

## 상태

- **작성**: 2026-05-25
- **출처**: 사용자-대화 기반 분석
- **대상**: 향후 agent 세션이 읽고 활용

## 근본 원인

**쓰기는 하는데 읽히고, 유지되고, 일관성 있는지 확인하는 루프가 없다.**

규칙·memory·시나리오·handoff·문서가 전부 write-only.
Agent가 매 세션 새로 시작하므로 암묵적 합의가 작동하지 않음.
검증·관찰·갱신 메커니즘이 부재.

## 문제 목록 (4계층 23개)

### 기반 Foundation (나머지 모두의 근원)

| # | 문제 | 핵심 | 영향 |
|---|------|------|------|
| 8 | 용어 미정렬 | 사용자/memory/코드베이스 간 용어 불일치. 지시 분기, 의도 왜곡. | High |
| 17 | 코딩 원칙 미정의 | 일반 원칙(SOLID, 에러 처리, 함수 분리 등)이 memory에 없음. Domain 규칙만 있음. | High |
| 18 | Skill/harness 통합 부재 | Import된 skill(grill, tdd, delivery)과 custom harness가 설계 배경이 달라 엉킴. 작업 방식 비정형. | High |
| 22 | 자연어→agent 라우팅 없음 | "리뷰해라" → 적절한 subagent 자동 spawn 안 됨. 사용자가 orchestrator 수동 수행. | Mid |

**해결 순서**: 8 → 17 → 18 → 22. 기반이 잡히면 아래 문제들의 강도가 크게 약화.

### 인지 Cognition (Agent가 세계를 이해하는 방식)

| # | 문제 | 핵심 | 영향 |
|---|------|------|------|
| 1 | 큰 그림 못 봄 | Sprint contract만 받아서 시스템 전체 맥락 이해 불가. 국소 최적/전역 차악. | High |
| 2 | 규칙 준수 보장 없음 | 모든 지시가 prompt의 soft requirement. 준수 검증 수단 없음. | High |
| 12 | Unknown unknowns | 명시되지 않은 정보의 부재를 인식 못 함. Contract에 없으면 고려 안 함. LLM 구조적 한계. | High |
| 16 | Caveman 모드 미유지 | Subagent spawn, compaction 후 caveman 지시 상실. 장황한 출력 → context 잠식 악순환. | Mid |

### 프로세스 Process (작업이 실행되는 방식)

| # | 문제 | 핵심 | 영향 |
|---|------|------|------|
| 3 | 시나리오-테스트 연결 없음 | testing-scenarios에 정의된 시나리오와 실제 테스트 코드의 대응 관계 불명. | High |
| 4 | 작업 후 문서화 누락 | Handoff, memory update가 제대로 안 됨. 템플릿 있어도 대충 채워짐. | Mid |
| 7 | Harness 실행 검증 불가 | Phase 순차 실행, Planner 코드베이스 읽기, Contract 정확도 — 외부 검증 불가. 결과만 보이고 과정 불투명. | High |
| 13 | Worktree 패턴 미보장 | Main orchestrator + worktree 작업 구조가 지켜지는지 모름. 편집 정책 hook은 있으나 workflow compliance 아님. | Mid |
| 15 | 경직된 구조가 흐름 끊음 | 미리 만든 sprint 문서가 상황 변화 시 어긋남. 구조화 vs 유연성 딜레마. | Mid |
| 20 | 작업 추적 repo 내부 한정 | docs/sprints/ 파일로만 추적. GitHub Issue/Milestone과 연결 없음. 외부 가시성 제로. | Mid |
| 23 | Worktree ref hook 미검증 | FETCH_HEAD 등 ref 관리 hook이 대응식 패치. 근본 설계 재검토 필요. | Mid |

### 결과 Outcome (최종 증상)

| # | 문제 | 핵심 | 영향 |
|---|------|------|------|
| 5 | Memory 관리 체계 없음 | 쌓이기만 함. 유효성/구식/중요도/잡음 판단 불가. 200줄 cap은 파일 단위 제한일 뿐. | High |
| 6 | Context 오염 | Hook 검증 메시지가 agent context 잠식. 해결 방향: push 대신 pull (Evaluator side-channel). | High |
| 9 | 코드 패턴 불일치 | 같은 유형의 컴포넌트가 sprint마다 다른 패턴. Formatting은 잡지만 구조적 패턴은 못 잡음. | Mid |
| 10 | Cross-sprint 회귀 | Sprint N+1이 Sprint N 결과를 망가뜨려도 감지 안 됨. 누적 위험 단조증가. | High |
| 11 | 피드백 루프 미폐쇄 | 실수 교정은 되지만 원인이 다음 sprint/feature에서 반복 방지 안 됨. 교훈 write-only. | High |
| 14 | 사용자 관찰 불가 | Worktree 안에서 무슨 일이 일어나는지 블랙박스. PR 올라와야 첫 결과 확인. | High |
| 19 | Human-readable 문서 방치 | README/roadmap/features가 코드 변경에 맞춰 갱신 안 됨. Sprint contract/hook/rubric 어디에도 포함 안 됨. | Mid |
| 21 | Smoke test/fixture 관리 부재 | 테스트 코드는 있지만 fixture/mock/smoke 인프라 방치. 테스트 깨지면 수리 비용 > 작성 비용. | Mid |

## 연결 관계

```
기반이 인지에 영향:
  ⑧용어 ──→ ⑨코드패턴, ⑫unknown unknowns
  ⑰원칙 ──→ ②준수보장, ⑨코드패턴
  ⑱통합 ──→ ⑮경직, ②②라우팅

인지가 프로세스에 영향:
  ①큰그림 ──→ ⑩cross-sprint 회귀
  ②준수 ──→ ⑦실행검증, ③시나리오
  ⑯caveman ──→ ⑥context 오염 (악순환)

프로세스가 결과에 영향:
  ③시나리오 ──→ ⑪피드백, ②①fixture
  ④문서화 ──→ ⑤memory, ⑪피드백, ⑲문서
  ⑬worktree ──→ ⑭관찰불가
  ⑳추적 ──→ ⑭관찰불가, ⑲문서
```

## 해결 방향 (원칙)

1. **Soft requirement → Hard gate**: prompt 지시를 기계적 검증으로 승격
2. **Push → Pull**: Agent에게 경고하지 말고 Evaluator side-channel에 기록
3. **Write-only → Read-verified**: 쓴 내용이 읽혔는지, 따랐는지 검증 루프 추가
4. **Sprint 단위 → 전체 가시성**: Cross-sprint 회귀 감지, architecture context 주입
5. **작업 방식 통합**: Skill/harness/grill/tdd를 하나의 workflow로 정형화

## 우선순위

1. **⑧ 용어 정렬** — Domain language 사전 정의
2. **⑰ 코딩 원칙 정의** — memory/conventions에 일반 원칙 추가
3. **⑱ 작업 방식 통합** — Skill/harness를 하나의 workflow로 통합
4. **② 규칙 준수 hard gate** — Evaluator side-channel compliance 검사
5. **⑦ Harness 실행 state machine** — 외부 phase 추적

## 참조

- HTML 보고서: `docs/archives/audits/harness-issues-report-2026-05-25.html`
- Harness 구성: `.claude/skills/harness/`, `.codex/skills/harness/`
- Hook 소스: `scripts/hooks/`
- 지식 소스: `memory/`
- Sprint 산출물: `docs/sprints/`
