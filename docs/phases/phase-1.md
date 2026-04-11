# Phase 1: Foundation (기반)

> Tauri 프로젝트 설정, 기본 UI 레이아웃, 연결 관리 — **완료**

## 구현 항목

| Feature | ID | 우선순위 |
|---------|-----|---------|
| Tauri + React 프로젝트 초기화 | — | P0 |
| 기본 레이아웃 (Sidebar + Main + Tab Bar) | — | P0 |
| 연결 생성 (F1.1) | F1.1 | P0 |
| 연결 목록 (F1.2 기본) | F1.2 | P0 |
| 연결 수정/삭제 (F1.3) | F1.3 | P0 |
| 연결 상태 관리 (F1.5) | F1.5 | P0 |
| DB Driver 추상화 (trait DbAdapter) | — | P0 |
| PostgreSQL Adapter 구현 | — | P0 |

## F1.1: 연결 생성

- [x] "New Connection" 버튼/메뉴로 연결 생성 다이얼로그 열림
- [x] 입력 필드: Name, Host, Port, User, Password, Database
- [x] PostgreSQL 기본값 자동 설정 (Port: 5432)
- [x] "Test Connection" 버튼으로 연결 가능 여부 확인
- [x] 테스트 성공 시 "Connection successful" 녹색 표시
- [x] 테스트 실패 시 에러 메시지 표시 (연결 거부, 인증 실패 등)
- [x] "Save" 시 유효한 연결만 저장됨
- [x] 동일 이름 연결 생성 시 경고
- [x] 비밀번호는 로컬 파일에 암호화(OsRng + AES-256-GCM) 저장
- [x] URL 형태(`postgresql://user:pass@host:port/db`)로 import 가능

## F1.2: 연결 목록 및 그룹핑

- [x] 저장된 모든 연결이 사이드바에 목록으로 표시됨
- [x] 연결을 폴더(그룹)로 정리 가능 (예: "Production", "Development")
- [x] 드래그앤드롭으로 연결을 그룹 간 이동 가능
- [x] 그룹 생성/수정/삭제 가능
- [x] 빈 그룹도 유지 가능

## F1.3: 연결 수정 및 삭제

- [x] 연결 우클릭 → "Edit"으로 수정 다이얼로그 열림
- [x] 기존 값이 폼에 프리필되어 표시됨
- [x] "Test Connection" 후 저장 가능
- [x] 연결 우클릭 → "Delete"로 삭제 (확인 다이얼로그 포함)
- [x] 활성 연결 삭제 시 연결 먼저 종료 후 삭제

## F1.5: 연결 상태 관리

- [x] 연결 더블클릭 또는 "Connect" 버튼으로 활성화
- [x] 활성 연결은 녹색 인디케이터로 표시
- [x] 연결 해제(disconnect) 가능
- [x] 연결 끊김 시 자동 감지 및 재연결 시도
- [x] 연결 타임아웃 설정 가능 (기본 300초)
- [x] Keep-alive ping (기본 30초 간격)으로 유휴 연결 유지

## F5.4: 테마 (선제 구현)

- [x] Light / Dark 테마 지원
- [x] 시스템 설정 따르기 (Auto)
- [x] 테마 변경이 즉시 적용됨

## Phase 완료 기준

- [x] 앱 실행 시 연결 목록 사이드바 표시
- [x] 새 연결 생성 → 테스트 → 저장 → 사이드바에 표시 → 연결/해제 동작
- [x] Rust에서 `trait DbAdapter` 정의되고 PostgreSQL 구현체 존재
- [x] connectionStore/tabStore/연결 URL 파싱 단위·스토어 테스트 통과 (`pnpm test`)
- [x] 로컬 PostgreSQL 테스트 DB가 준비된 환경에서 Rust 단위·통합 테스트 통과 (`cargo test`)

## 검증

`pnpm tauri dev` 실행 → UI 렌더링 → 연결 생성/테스트/저장/연결/해제 동작
