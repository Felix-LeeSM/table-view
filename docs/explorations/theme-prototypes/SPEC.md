# Theme Prototype SPEC — 모든 프로토타입 페이지가 지키는 공통 규격

table-view (Tauri 2.0 + React) 는 TablePlus 를 닮은 로컬 DB 클라이언트다.
PostgreSQL / MySQL / SQLite / MongoDB / Redis / Oracle / SQL Server 를 붙는다.

이 디렉토리의 프로토타입은 **테마 하나당 독립 HTML 파일 하나**다. 목적은
"이 테마를 입은 table-view 가 어떻게 보이는가" 를 한 화면으로 판단하는 것.

---

## 1. 출력 파일 규격

- **완전 독립 단일 HTML 파일.** 빌드 없이 `open <file>.html` 로 열린다.
- 외부 의존은 Google Fonts `<link>` 만 허용. JS 프레임워크·CSS 프레임워크 금지.
- 인라인 `<style>` 하나 + 인라인 `<script>` 하나 (light/dark 토글용) 까지만.
- 파일 안에 다른 프로토타입 파일을 참조하지 않는다 (index.html 로 돌아가는
  링크 한 줄은 예외로 허용).
- 문자 인코딩 `<meta charset="utf-8">`, `<html lang="ko">`.

## 2. 화면 구성 — 모든 페이지가 이 7 블록을 담는다

위에서 아래로:

### (A) 헤더 바
테마 이름 · 한 줄 설명(vibe) · light/dark 토글 버튼 · `← 전체 목록`
링크(`../index.html`).

### (B) 팔레트 스와치
이 테마가 쓰는 색을 사각형/원 칩으로 나열하고 각 칩 아래 **이름과 hex 를 그대로**
적는다. 배경·전경·primary·border·muted·status 4종은 반드시 포함.

### (C) 앱 셸 목업 — 이 페이지의 주인공
가로로 3분할된 데스크톱 앱 창 하나를 그린다. 최소 높이 620px.

1. **좌측 사이드바 (폭 220~260px)** — 커넥션 트리
   - 커넥션 3개: `prod-analytics` (PostgreSQL, 연결됨 — status-connected 점),
     `staging-cache` (Redis, 연결 중 — status-connecting 점),
     `legacy-orders` (MySQL, 오류 — status-error 점)
   - `prod-analytics` 는 펼쳐진 상태로 스키마 트리를 보여준다:
     `public` > Tables > `users` / `orders` / `order_items` / `payments` /
     `sessions`, Views > `v_revenue_daily`, Functions > `calc_ltv()`
   - 현재 선택 행은 `orders` — 선택 강조를 primary/accent 로 준다.
   - 상단에 검색 인풋 하나.

2. **중앙 (가변 폭)**
   - **탭 바**: `orders`(활성) · `users` · `Query 1` · `+` — 활성 탭 구분이
     명확해야 한다.
   - **툴바**: 필터 인풋, `Refresh` / `Add row` / `Commit` 버튼 3종
     (primary 1개 + secondary 2개), 우측에 행 수 `1,248 rows`.
   - **데이터 그리드**: 컬럼 6개 × 행 12개 이상.
     컬럼: `id` (int8, PK 표시) · `customer_id` (int8, FK 표시) ·
     `status` (text) · `total_amount` (numeric) · `created_at` (timestamptz) ·
     `note` (text)
     - 헤더는 컬럼명 + 타입을 작은 글씨로 같이 보여주고 정렬 화살표 하나.
     - 숫자 컬럼은 우측 정렬 + 등폭 글꼴.
     - `NULL` 은 muted-foreground 이탤릭으로 명확히 구분.
     - 행 하나는 **선택 상태**, 행 하나는 **편집 중(수정된 셀)** 상태로
       그려서 상호작용 상태가 보이게 한다.
     - 얼룩말 줄무늬는 테마 성격에 맞을 때만.
   - **하단 SQL 에디터 패널** (높이 150~200px): 아래 쿼리를 **구문 강조해서**
     보여준다. 강조는 반드시 syntax 토큰 12종을 쓴다.
     ```sql
     -- 최근 30일 고객별 매출
     SELECT c.id, c.name, SUM(o.total_amount) AS revenue
     FROM orders o
       JOIN customers c ON c.id = o.customer_id
     WHERE o.created_at >= NOW() - INTERVAL '30 days'
       AND o.status <> 'cancelled'
     GROUP BY c.id, c.name
     HAVING SUM(o.total_amount) > 1000
     ORDER BY revenue DESC
     LIMIT 50;
     ```
     에디터 좌측에 줄 번호, 우측 하단에 `Run ⌘↵` 버튼.

3. **우측 인스펙터 (폭 240~280px)** — 선택 행의 컬럼별 값을 세로로 나열
   (key: value). JSON 값 하나는 트리로 펼쳐서 key/leaf 색 구분을 보여준다.

### (D) 상태 바
앱 셸 맨 아래 한 줄: 연결 상태 점 + `prod-analytics · public` · `1,248 rows`
· `실행 42ms` · 우측에 `PostgreSQL 16.2`.

### (E) 컴포넌트 표본
버튼(primary/secondary/ghost/destructive), 인풋(기본/포커스/에러),
배지(성공/경고/오류/중립), 토글 스위치, 체크박스, 셀렉트를 한 줄씩 나열.

### (F) 모달 한 장
`테이블 삭제` 확인 다이얼로그 — destructive 강조와 팝오버 표면(popover) 이
어떻게 보이는지 판단할 수 있게. 실제 오버레이로 띄우지 말고 페이지에 박아서
그린다.

### (G) 푸터
이 테마의 디자인 결정 3~5줄 (무엇을 강조했고 무엇을 의도적으로 뺐는지).

## 3. light / dark 토글

`<html>` 에 `data-theme="<id>" data-mode="light|dark"` 를 걸고, 버튼이
`data-mode` 만 바꾸도록 한다. 두 모드 다 실제로 보기 좋아야 한다.
**dark 를 정의하지 않는 dark-first / light-only 디자인 시스템이면** 토글을
그대로 두되 반대 모드는 그 시스템의 규칙 안에서 가장 가까운 해석으로 만든다
(예: 반전 대신 표면 한 단계 조정). 무엇을 했는지 (G) 에 적는다.

## 4. 토큰 이름 — 프로토타입도 이 이름을 그대로 쓴다

실제 앱이 쓰는 CSS 변수다. 프로토타입에서도 같은 이름으로 정의해야 나중에
`src/themes.css` 로 그대로 옮길 수 있다.

**표면/텍스트 (light·dark 각각 정의)**
```
--tv-background --tv-foreground
--tv-card --tv-card-foreground
--tv-popover --tv-popover-foreground
--tv-primary --tv-primary-foreground
--tv-secondary --tv-secondary-foreground
--tv-muted --tv-muted-foreground
--tv-accent --tv-accent-foreground
--tv-border --tv-input --tv-ring
--tv-primary-tint            /* "R G B" 형식 (rgb() 알파 합성용) */
--tv-status-connected --tv-status-connecting --tv-status-error --tv-status-idle
```

**구문 강조 12종 (light·dark 각각 정의)**
```
--tv-syntax-keyword --tv-syntax-operator --tv-syntax-punct --tv-syntax-type
--tv-syntax-builtin --tv-syntax-function --tv-syntax-property --tv-syntax-string
--tv-syntax-number --tv-syntax-atom --tv-syntax-comment --tv-syntax-error
```

**공통 (테마 무관, 값 고정)**
```
--tv-destructive: #ef4444        (dark: #f87171)
--tv-success: #16a34a            (dark: #22c55e)
--tv-warning: #ea580c            (dark: #fb923c)
--tv-highlight: #eab308          (dark: #facc15)
--tv-radius: 0.5rem              /* 테마가 다른 radius 를 요구하면 바꿔도 된다 */
--tv-font-sans, --tv-font-mono
```

**정체성 색 (테마 무변, 그대로 복사)**
```
light: --tv-value-key #0369a1  --tv-value-leaf #047857  --tv-value-delete #f43f5e
dark:  --tv-value-key #7dd3fc  --tv-value-leaf #6ee7b7  --tv-value-delete #f43f5e
```

## 5. 품질 기준

- **대비.** 본문 텍스트 대 배경은 WCAG AA (4.5:1) 를 넘긴다. muted-foreground
  같은 보조 텍스트도 3:1 아래로 내려가지 않는다.
- **셀 밀도.** 데이터 그리드 행 높이 28~34px. DB 툴은 밀도가 생명이다.
- **등폭.** 숫자·타임스탬프·SQL 은 반드시 mono.
- **`--tv-*` 변수를 실제로 쓴다.** hex 를 마크업에 직접 박지 않는다 (스와치
  라벨 텍스트는 예외).
- **한글이 깨지지 않게** 폰트 스택 끝에 시스템 한글 폰트를 둔다:
  `"Apple SD Gothic Neo", "Malgun Gothic", sans-serif`.
- 페이지 전체 폭은 1280px 컨테이너 중앙 정렬, 좌우 여백 24px 이상.
