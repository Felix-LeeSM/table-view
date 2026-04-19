# Phase 5: Extended Features

> Phase 1-4 완료 후 점진적 추가 — **진행 중** (Sprint 55-59 완료)

## F1.4: 연결 태그 및 색상 *(Sprint 59 부분 구현)*

- [ ] 연결에 색상 라벨 지정 가능 (Red, Orange, Yellow, Green, Blue, Purple) *(ConnectionConfig에 color 필드만 정의, ColorPicker UI 미구현)*
- [ ] 사이드바에서 색상이 시각적으로 표시됨 *(연결 색상 라벨 미구현)*
- [x] 환경 태그 지정 가능: Local, Testing, Development, Staging, Production
- [x] 환경 태그 색상 배지로 시각적 표시 (ConnectionItem)
- [ ] 태그로 필터링 가능

## F2.6: 뷰(Views) 탐색 *(Sprint 55 부분 구현)*

- [x] Views 카테고리에 모든 뷰 목록 표시
- [ ] 뷰 선택 시 Structure 탭에서 컬럼 정보 표시 *(테이블 전용 Structure 탭만 지원)*
- [x] 뷰의 정의 SQL 확인 가능 (`get_view_definition` command)
- [ ] 뷰 데이터 탐색 가능 (테이블 브라우저와 동일 UX) *(SELECT 쿼리로 조회 가능하나 dedicated UI 없음)*

## F2.7: Functions & Procedures *(Sprint 55 부분 구현)*

- [x] Functions 목록: Name, Return Type, Argument Types
- [x] 함수 정의(source code) 확인 가능 (`get_function_source` command)
- [ ] 함수 생성/수정/삭제 가능 (SQL 에디터로) *(SQL 에디터 통합 미구현)*

## F3.6: 데이터 상세 보기 (Quick Look) *(Sprint 56 완료)*

- [x] 행 선택 시 하단 또는 사이드 패널에 전체 필드 표시 (QuickLookPanel)
- [x] JSON 데이터 포맷팅되어 표시
- [x] 큰 텍스트 필드 스크롤 가능한 텍스트 영역으로 표시
- [x] BLOB 데이터 hex viewer 또는 이미지로 표시 (BlobViewerDialog)

## F4.7: 쿼리 즐겨찾기 *(Sprint 57 부분 구현)*

- [x] 쿼리를 "Favorites"에 저장 가능 (이름 지정)
- [x] 저장된 즐겨찾기 목록에서 쿼리 재사용 (FavoritesPanel)
- [ ] 키워드 바인딩으로 빠른 호출 (예: /daily → 저장된 쿼리)
- [x] 연결별 또는 전역 즐겨찾기 구분 (FavoriteScope: all/global/connection)

## F4.8: 결과 분할

- [ ] 에디터와 결과 패널을 수평/수직 분할 가능
- [ ] 여러 쿼리 실행 시 결과를 개별 탭으로 표시
- [ ] 결과 탭을 닫지 않고 유지 가능 (최대 10개)

## F5.3: 쿼리 로그 패널 *(Sprint 58 완료)*

- [x] 모든 실행된 쿼리가 누적 기록됨 (탭 전환에도 유지)
- [x] 각 로그 항목: SQL, 실행 시간, 타임스탬프, 상태(success/error) 표시
- [x] 실패한 쿼리는 다른 스타일로 하이라이트
- [x] 로그 항목 복사 가능
- [x] Cmd+Shift+C로 쿼리 로그 패널 열기/닫기
- [x] 과거 쿼리 클릭 시 에디터에 삽입
- [x] 연결별 로그 분리 (connection filter dropdown)
- [x] 로그에서 키워드 검색 가능

## F5.6: 패널 관리 시스템

- [ ] 좌측 패널: 연결 및 스키마 트리 (현재 사이드바)
- [ ] 하단 패널: 쿼리 로그 및 쿼리 결과
- [ ] 우측 패널: 선택된 레코드/컬럼 상세 정보
- [ ] 각 패널 개별적으로 접기/펼치기 가능
- [ ] 툴바에서 패널 토글 버튼 제공 (VSCode 스타일)
- [ ] 패널 크기 조절 가능 (드래그)

## 기타

- [ ] Import/Export (CSV, JSON, SQL)
- [ ] SSH 터널링
- [ ] MySQL 지원 (DbAdapter 구현체 추가)
- [ ] SQLite 지원 (DbAdapter 구현체 추가)
- [ ] 모바일 (Tauri 2.0, 반응형 UI 조정)
