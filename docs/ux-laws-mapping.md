# UX 30 Laws — Table View 적용 매핑

> 출처: [Laws of UX](https://lawsofux.com/) · 작성일 2026-04-30
>
> 형식: **법칙명** — *한 줄 의미* — ✅ 이미 적용/진행 중 / 💡 신규 검토 권장

## 1. 인지·지각

- **[Aesthetic-Usability Effect](https://lawsofux.com/aesthetic-usability-effect/)** — *미적 디자인은 사용성도 좋다고 인식됨* — ✅ Layer1/Layer2 다이얼로그 primitive 정규화
- **[Cognitive Load](https://lawsofux.com/cognitive-load/)** — *인터페이스 이해에 드는 정신 자원* — ✅ Sidebar 가상화·가변 폭 / 💡 schema 노드 한도 + "more…"
- **[Miller's Law](https://lawsofux.com/millers-law/)** — *작업 기억은 7±2개까지* — 💡 우클릭 메뉴 항목 7개 이하로 그룹핑
- **[Working Memory](https://lawsofux.com/working-memory/)** — *작업 중 임시 정보를 보관·조작하는 인지 시스템* — ✅ `GlobalQueryLogPanel`, MRU 연결
- **[Chunking](https://lawsofux.com/chunking/)** — *정보를 의미 단위로 묶어 인식* — ✅ ConnectionDialog의 host/auth/options 섹션화

## 2. 선택과 결정

- **[Choice Overload](https://lawsofux.com/choice-overload/)** — *옵션 과다 → 결정 마비* — ✅ DBMS별 동적 필드 / 💡 Launcher에 자주 쓴 DBMS 상단 고정
- **[Hick's Law](https://lawsofux.com/hicks-law/)** — *선택지↑ → 결정 시간↑* — ✅ 패러다임별 UI 슬롯 / 💡 우클릭 메뉴 패러다임 분기
- **[Occam's Razor](https://lawsofux.com/occams-razor/)** — *가정이 적은 가설을 우선* — 💡 SSL/SSH/Pool은 "Advanced"로 접기

## 3. 게슈탈트 (시각적 그룹핑)

- **[Law of Proximity](https://lawsofux.com/law-of-proximity/)** — *가까운 것은 한 그룹으로 인식* — ✅ 폼 필드 간격 / 💡 PK/FK를 좌측 고정 영역으로 분리
- **[Law of Common Region](https://lawsofux.com/law-of-common-region/)** — *같은 영역(테두리) 안은 한 그룹* — ✅ Sidebar/MainArea 분리 / 💡 Editor+결과를 탭 단위 카드로
- **[Law of Similarity](https://lawsofux.com/law-of-similarity/)** — *비슷한 모양·색은 한 그룹* — 💡 1차 액션·위험 액션 색/형태 통일 / 💡 쿼리가 노출되는 모든 위치에 `QuerySyntax` 일관 적용 (현재 `QueryLog.tsx`만 plain text 격차)
- **[Law of Uniform Connectedness](https://lawsofux.com/law-of-uniform-connectedness/)** — *시각적으로 연결된 것은 더 관련 있게 인식* — 💡 다중 statement 결과를 발급 쿼리와 시각선으로 연결
- **[Law of Prägnanz](https://lawsofux.com/law-of-pr%C3%A4gnanz/)** — *모호한 형태는 가장 단순한 형태로 인식* — ✅ Dialog 헤더 정규화
- **[Von Restorff Effect](https://lawsofux.com/von-restorff-effect/)** — *튀는 것이 기억됨* — ✅ Dirty indicator·활성 탭 강조 / 💡 Mongo read-only 배너

## 4. 성능·효율

- **[Doherty Threshold](https://lawsofux.com/doherty-threshold/)** — *400ms 이하 응답에서 생산성 최대* — ✅ DataGrid 가상화·`fetchIdRef` / 💡 1초 시점부터 progress + 취소
- **[Fitts's Law](https://lawsofux.com/fittss-law/)** — *도달 시간 = 거리·크기 함수* — 💡 탭 X·resize handle hit-area 확대, Run 버튼 고정 위치
- **[Goal-Gradient Effect](https://lawsofux.com/goal-gradient-effect/)** — *목표가 가까울수록 추진력 증가* — ✅ 4-state connection feedback / 💡 마이그레이션 진행률 바
- **[Pareto Principle](https://lawsofux.com/pareto-principle/)** — *80% 효과는 20% 원인에서* — 💡 MRU·최근 쿼리·최근 본 테이블을 1-click 거리에
- **[Flow](https://lawsofux.com/flow/)** — *완전 몰입 상태* — ✅ 단축키 + 빠른 응답 / 💡 모달 열린 상태에서 단축키 동작 점검

## 5. 사용자 행동·기대

- **[Jakob's Law](https://lawsofux.com/jakobs-law/)** — *사용자는 익숙한 패턴을 기대* — ✅ TablePlus·DBeaver 패턴 차용 / 💡 Mongo 화면도 SQL 도구 어휘 보존 / 💡 Compass·Studio 3T처럼 Mongo 쿼리는 MQL/JSON 색으로 표시
- **[Mental Model](https://lawsofux.com/mental-model/)** — *사용자가 가진 시스템 작동 모델* — 💡 Mongo column→field 용어 정합성 (P1) / 💡 Mongo 쿼리에 SQL 토큰 색이 칠해지지 않도록 호출처에서 `paradigm` prop 누락 점검 (legacy entry 폴백 함정)
- **[Paradox of the Active User](https://lawsofux.com/paradox-of-the-active-user/)** — *매뉴얼은 안 읽고 바로 쓴다* — 💡 빈 상태 메시지로 onboarding (P1)
- **[Peak-End Rule](https://lawsofux.com/peak-end-rule/)** — *경험은 절정과 끝으로 평가됨* — ✅ Cmd+S 토스트 / 💡 쿼리 종료 시 행 수+소요시간 한 줄

## 6. 기억과 주의

- **[Zeigarnik Effect](https://lawsofux.com/zeigarnik-effect/)** — *미완료 작업이 더 잘 기억됨* — ✅ Dirty indicator / 💡 종료 시 미저장 일괄 확인
- **[Serial Position Effect](https://lawsofux.com/serial-position-effect/)** — *처음과 끝이 가장 잘 기억됨* — 💡 Query log·MRU의 양 끝(최근/최초) 강조
- **[Selective Attention](https://lawsofux.com/selective-attention/)** — *목표 관련 자극에만 주의* — 💡 RISK-009 — refetch 오버레이 포인터 차단

## 7. 의사결정·복잡도

- **[Cognitive Bias](https://lawsofux.com/cognitive-bias/)** — *판단의 체계적 오류* — 💡 DROP/DELETE에 객체명 타이핑 확인
- **[Tesler's Law](https://lawsofux.com/teslers-law/)** — *환원 불가능한 본질적 복잡도* — 💡 advanced 옵션을 숨기지 말고 명시적으로 분리
- **[Postel's Law](https://lawsofux.com/postels-law/)** — *받을 땐 관대, 보낼 땐 엄격* — 💡 host에 `postgres://` URL 붙여넣기·trim 허용
- **[Parkinson's Law](https://lawsofux.com/parkinsons-law/)** — *일은 주어진 시간을 다 채운다* — 💡 페이지네이션 상한·장기 쿼리 자동 안내

---

## 우선 적용 Top 6

1. **[Peak-End](https://lawsofux.com/peak-end-rule/)**(절정·끝 인상) + **[Zeigarnik](https://lawsofux.com/zeigarnik-effect/)**(미완 작업이 잘 기억됨) + **[Von Restorff](https://lawsofux.com/von-restorff-effect/)**(튀는 것이 기억됨)
   → 진행 중인 P1 5건 (Dirty indicator, Cmd+S 피드백, 빈 상태, 다중 statement 분리, Mongo 배너)
2. **[Selective Attention](https://lawsofux.com/selective-attention/)**(목표 외 자극 차단)
   → RISK-009 — refetch 오버레이 포인터 차단
3. **[Mental Model](https://lawsofux.com/mental-model/)**(사용자가 가진 작동 모델) + **[Jakob's Law](https://lawsofux.com/jakobs-law/)**(익숙한 패턴 기대)
   → Mongo 용어 정합성 (column → field) + Mongo 쿼리는 MQL/JSON 색으로 표시
4. **[Law of Similarity](https://lawsofux.com/law-of-similarity/)**(같은 종류는 같은 시각)
   → 쿼리가 노출되는 모든 위치에 `QuerySyntax` 일관 적용 (`QueryLog.tsx` 격차 보완 — 누락된 호출처 회수 성격, 비용 대비 효과 큼)
5. **[Doherty Threshold](https://lawsofux.com/doherty-threshold/)**(400ms 이하 생산성 최대) + **[Goal-Gradient](https://lawsofux.com/goal-gradient-effect/)**(목표 근접 시 추진력↑)
   → 400ms 초과 작업의 progress·취소 정책 통일
6. **[Postel's Law](https://lawsofux.com/postels-law/)**(받을 땐 관대)
   → ConnectionDialog 입력 정규화 (URL 붙여넣기·trim)
