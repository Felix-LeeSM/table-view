---
title: Write smoke는 preview close가 아니라 persisted outcome을 검증한다
type: lesson
date: 2026-05-20
surface: "e2e/smoke/**/*.ts, src/lib/mongo/mqlToBulk.ts, src-tauri/src/db/mongodb/mutations.rs"
---

# 상황

CI smoke를 연결/조회 중심에서 실제 write path 검증으로 강화하자 Postgres grid edit,
Mongo MQL preview execute에서 순차적으로 실패했다. 최종 CI green 기준은 PR #58
`9fbf11e`: Frontend / Rust / Integration / Runtime Happy Path 모두 pass.

# 원인

두 종류가 섞여 있었다.

1. Harness 한계: Tauri WebDriver에서 multi-window focus, grid cell double-click,
   controlled input `clearValue`/stale element가 불안정했다. 특히 `clearValue`는
   grid editor blur/unmount를 유발해 실제 product 문제가 아니라 smoke 조작
   방식 문제였다.
2. Product/backend 문제: Mongo grid commit은 `bulk_write_documents`를 탔고,
   backend는 MongoDB 8 전용 `Client::bulk_write`를 사용했다. CI는 `mongo:7`이라
   실행이 실패했으며, MQL preview modal이 `commitError`를 렌더하지 않아
   artifact에는 "preview가 닫히지 않음"만 보였다. 또한 ObjectId filter는
   frontend `DocumentId` tag가 아니라 canonical `{ "$oid": ... }`로 IPC를 건너
   backend에서 BSON ObjectId로 복원되어야 한다.

# 재발 방지

- Smoke write 시나리오는 "preview dialog가 닫혔다"에서 끝내지 말고, 실제 grid에
  committed value가 다시 나타나는 persisted outcome까지 검증한다.
- 실패가 WebDriver 조작 문제인지 product 문제인지 분리한다. helper를 세 번 이상
  연속으로 고치기 전에 artifact/DOM/ARIA/log가 어떤 layer를 가리키는지 정리한다.
- Tauri e2e에서 grid editor를 다룰 때는 workspace window를 명시적으로 선택하고,
  row는 DOM text/ARIA 기준으로 찾고, controlled input은 WebDriver `clearValue`
  대신 DOM value setter + `input`/`change`/`Enter` 이벤트로 다룬다.
- Mongo write-path 테스트는 CI의 실제 server major version을 고려한다. MongoDB 7
  smoke에서 통과해야 하는 경로는 `Client::bulk_write` 같은 MongoDB 8-only API에
  의존하지 않는다.
- Preview modal execute 실패는 반드시 `role="alert"` 같은 user-visible surface에
  남긴다. 그렇지 않으면 e2e artifact가 원인 대신 timeout 현상만 기록한다.
- 단위 테스트는 hook/component mock 호출만 보지 말고, 성공 시 preview/pending
  cleanup과 실패 시 modal error 노출을 함께 단언한다.

# Stop / Go

새 smoke failure가 나면 바로 helper를 더 고치지 않는다.
먼저 "interaction flake", "missing diagnostic", "real product/backend bug" 중 하나로
분류하고, product/backend bug일 때만 구현을 바꾼다.
