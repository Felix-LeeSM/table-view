---
id: 0001
title: Tauri v2 + sqlx 채택
status: Accepted
date: 2026-01-01
---

**결정**: 데스크톱 프레임워크는 Tauri 2.0, Rust DB 드라이버는 sqlx.
**이유**: Electron 대비 번들 크기 ~1/10, 네이티브 성능. sqlx는 Postgres/MySQL/SQLite를 async로 통일 처리 + 컴파일 타임 쿼리 검증.
**트레이드오프**: + 작은 번들, native 성능, 정적 쿼리 체크 / - Tauri 2 생태계 미성숙, 플랫폼별 WebView 렌더링 차이(macOS WebKit vs Windows Edge).
