---
id: 0036
title: Telemetry — 수집 0 명문화 (privacy contract)
status: Accepted
date: 2026-05-17
supersedes: null
superseded_by: null
---

**결정**: Table View 는 외부 telemetry / 분석 / crash report / 사용량
통계 송신을 **0** 으로 유지한다. 코드 어디에서도 사용자 머신 밖의
endpoint 로 사용 데이터를 전송하지 않는다.

1. **수집 대상 = 0** — 다음 모두 외부 송신 안 함:
   - SQL / Mongo query 본문 (`query_history.sql` / `sql_redacted`)
   - Connection metadata (host, name, paradigm 등)
   - Schema / table / column 이름
   - 에러 메시지 / stack trace
   - 사용량 통계 (앱 실행 횟수, 기능 사용 빈도, session 길이 등)
   - 머신 식별자 (hostname, MAC, machine GUID 등)
2. **유일한 outbound network call** — Auto-update notification (ADR
   0037) 의 GitHub releases GET 만 허용. 그 호출도 사용자 데이터 전송
   0 (단순 GET, request body 없음, User-Agent 도 generic).
3. **Crash report 미도입** — Sentry / Crashlytics / Bugsnag 등 3rd-party
   crash collector 통합 0. 사용자 crash 는 (a) OS 의 native crash log
   (사용자 컨트롤), (b) 사용자 직접 GitHub issue 만.
4. **로컬 dev console / file log 는 별 layer** — 사용자 머신 안 stderr
   / log file 은 허용 (사용자 자기 머신 통제). 그 log 가 어떤 채널로도
   외부로 송신되지 않음.
5. **ADR 으로 lock** — 회귀 시 code review 의 "ADR 0036 위반" 단순
   판정.

**이유**:

1. **데이터베이스 도구의 신뢰 모델** — 사용자가 SQL 입력란에 password
   / API key / PII (이메일 / 주소) 를 literal 로 타이핑하는 게 일상.
   그 query 가 외부로 새면 신뢰 0. "anonymized telemetry" 도 SQL literal
   은 사실상 익명화 불가능 (`WHERE email='alice@example.com'` 의 alice
   는 명시적 식별자).
2. **로컬-only 사용자 자율성** — 데스크톱 앱의 차별점은 데이터가 사용자
   머신을 떠나지 않는다는 약속. Web SaaS 대비 가치 = 사용자 머신 통제.
   Telemetry 도입은 그 약속의 직접적 위반.
3. **Crash report 미도입의 트레이드오프 인지** — 검토된 대안: Sentry
   integration + redaction filter. (a) Redaction 의 완전성 보장 어려움
   (SQL literal 의 다양성), (b) Sentry 의 server 가 데이터 보관 = 사용자
   디스크 밖 노출, (c) 사용자 동의 모달의 burden. 결론 — 외부 collector
   아예 미도입이 가장 단순 & 안전. Crash 정보는 OS log 로 충분.
4. **ADR lock 의 강제력** — 미래 PM 이 "사용량 통계 좀 보고 싶어" 라고
   요청해도 ADR 0036 의 status: Accepted (작성 동결) 가 새 ADR 작성 +
   사용자 명시 opt-in UI 라는 hurdle 부과. 우발적 telemetry 도입을 코드
   review 단계에서 차단 (회귀 panel rule).

**트레이드오프**:

- **+** 사용자 신뢰의 핵심 약속 — "내 데이터는 내 머신 밖으로 안 나간
  다". 데이터베이스 도구의 가장 sensitive 한 영역 보호.
- **+** GDPR / CCPA / 한국 PIPA 등 privacy 규제의 사용자 동의 UX 부담 0.
- **+** SQL literal 의 PII 안전 — `query_history.sql` 이 어떤 redaction
  실패에도 외부로 안 나감.
- **+** Audit/code review 시 "외부 송신 코드" grep 으로 1차 검출 가능
  — fetch/reqwest/curl/HTTP client 의 destination 검사 자동화 쉬움.
- **−** 사용자 행동 데이터 0 — 어떤 기능이 가장 많이 쓰이는지, 어떤
  query 에서 crash 가 잦은지 product team 이 모름. Prioritization 은
  사용자 GitHub issue + 직접 인터뷰에 의존.
- **−** Crash 발생 시 reproducibility 부담 사용자 측 — 사용자가 직접
  repro step + OS crash log 첨부해야 함. 단 데이터베이스 도구는 사용
  자 능숙도가 높아 (개발자 대다수) burden 낮음.
- **−** Performance regression detection — 사용자가 "느려졌어" 라고
  말해야 알 수 있음. 대안: cold-boot instrumentation 의 local-only 측정
  protocol (reference_cold_boot_instrumentation.md) 로 dev 측 측정.

**관련**:

- state-management-strategy-2026-05-15.md §Q10 line 421 (telemetry 수집 0)
- state-management-strategy-2026-05-15.md §F.5 line 1509 (query history 도 외부 송신 0
  — `sql` 과 `sql_redacted` 모두)
- ADR 0021 — Export envelope (사용자가 *자기 의지로* connection 정보를
  export 하는 path 는 별 layer — 외부 송신 아닌 file 출력)
- ADR 0037 — Auto-update notification-only (유일한 outbound — GitHub
  releases GET, 데이터 전송 0)
- ADR 0042 — Query history privacy (`sql_redacted` 도 외부 송신 0 의
  부분)
