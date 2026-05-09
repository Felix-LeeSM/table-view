# Production Warning System — 13-Question Grill Decisions

> Reference spec: `Table View Design System/PRODUCTION-WARNING.md` (외부 출처, 사용자와의 grill 을 통해 채택/수정/거부 한 항목별 결정)

| # | 결정 | Why |
|---|---|---|
| Q1 | **Env enum**: 5-tag display 보존 (`local/testing/development/staging/production`), action 만 3-tier collapse: local/testing/development → "dev" action category. | 분류의 의미 보존, 동작은 단순화. spec 의 3-tier 매트릭스 재사용. |
| Q2 | **Severity classifier**: 3-tier `info` / `warn` / `danger(=stop)` 채택, 기존 2-tier `safe \| danger` 에서 incremental. WARN bounded UPDATE/DELETE 의 dry-run row count → 100+ 면 STOP escalate (Sprint 247 IPC 재사용). | INFO/WARN 분리 = read-freedom invariant 명시 + button color matrix 의미. |
| Q3 | **WARN dialog 발동 범위**: 모든 환경 + 모든 write 표면. raw SQL editor 도 INSERT/UPDATE/DELETE 시 신규 dialog mount. | 사용자가 가장 사고 내기 쉬운 raw editor → ad-hoc DML 보호. |
| Q4 | **Chrome H surfaces**: top stripe (#1) + prod-only window border (#5) 만. sidebar dot / tab underline / status bar tint 거부. | top stripe 는 텍스트 carry (의미 있는 시그널), window border 는 다른 윈도우 사이 식별. 나머지는 노이즈. |
| Q5 | **Button F**: color + target ("Execute on prod-primary"), verb 추출 (`<verb> on <conn>`) X. | 버튼 폭 압박, verb 추출은 SQL parsing 비용 큼. |
| Q6 | **STOP/WARN dialog**: ConfirmDestructiveDialog (STOP) 와 SqlPreviewDialog/MqlPreviewModal (WARN) 별개 유지, env token (`--tv-env-prod` etc.) 으로 시각 정렬. | 행위 무게 그라데이션 (drop 더 무거움), Sprint 246-249 자산 보존. |
| Q7 | **Token**: `--tv-destructive` 이름 + 값 (`#ef4444`) 보존. `--tv-warning` 만 `#f59e0b` (amber) → `#ea580c` (deep orange) deepen. env-specific 6 토큰 신규 (`--tv-env-prod` / `-prod-wash` / `-prod-text` / `-staging` / `-staging-wash` / `-staging-text`). | shadcn convention 보존, staging 색은 connecting amber 와 의미 분리. |
| Q8 | **Connection read-only flag**: 도입 안 함. | YAGNI, audit/compliance 사용 사례 미실증. |
| Q9 | **Default env / null migration**: 신규 default = null 유지 (force-pick X), 기존 null 도 backfill X. null = "dev" action category 로 fall-through. | dev 도 보호 안 되니 default 의미 X. |
| Q10 | **STOP-prod webhook**: Tauri event emit 도입 안 함. | YAGNI, audit-log 인프라 부재. |
| Q11 | **TabBar 좌측 connection-색 stripe (item ②)**: 완전 제거. | 다중 connection 사용처 미존재. |
| Q12 | **Syntax palette (item ③)**: 72 × 3 = 216 per-theme 큐레이션 hardcode. | 각 theme 의 brand 와 충돌 없는 정밀한 색. derive 보다 큐레이션 우위. |
| Q13 | **Tab DnD 빈 영역 release (item ④)**: scrollRef onMouseUp 추가, cursor X 로 가장 가까운 탭 결정 → before/after insert. | Chrome/VSCode 표준 동작. |

## Sprint Phasing (5 sprints, 우선순위 순)

1. **Sprint 253** — Token foundation + item ② / ④ polish (가벼운 묶음, 사용자 즉시 win)
2. **Sprint 255** — WARN dialog mount in raw SQL editor (현재의 2-tier 그대로 활용한 보호 도입)
3. **Sprint 254** — Severity classifier 3-tier split + dry-run STOP escalation (정밀화)
4. **Sprint 256** — Chrome H + Button F + ConfirmDestructiveDialog header 정렬 (시각 polish)
5. **Sprint 257** — Per-theme syntax palette curation (item ③, 단독 sprint)

## Open / Residual Risks

- **Window border (Sprint 256)**: macOS Tauri WKWebView 는 1px CSS border 깔끔 가능. Windows 는 native title bar 가 OS 가 그리는 영역이라 CSS border 가 inset 처럼 보임 — Sprint 256 구현 시 platform 별 검증, 필요 시 border 위치 미세 조정 또는 prod 외 추가 보강.
- **Sprint 257 큐레이션 분량**: 72 theme × 3 색 = 216 값 — 디자인 작업량 큼. 큐레이션 rule (예: keyword = brand 의 보색 / string = teal 계열 / number = amber 계열) 을 먼저 합의 후 일괄 생성하는 방식 권장.
- **WARN dialog 의 마찰 (Sprint 255)**: 모든 환경 + 모든 write 표면 dialog 는 ad-hoc dev 작업의 마찰을 늘림. 사용자가 dialog blindness 빠지는 위험 — Sprint 256 의 button F color 가 *환경별 차이* 를 carry 하므로 dev 의 green button 은 자동 통과처럼 느껴지도록 시각 polish 필요.
