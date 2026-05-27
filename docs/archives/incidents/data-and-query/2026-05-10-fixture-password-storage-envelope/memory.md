---
title: 외부 도구가 Tauri storage 파일을 직접 만질 때 envelope (특히 password 암호화) 를 받는 쪽과 1:1 재현하지 않으면 contract drift 로 즉시 fail
type: lesson
date: 2026-05-10
---

**상황**: Sprint 237 fixture CLI (`scripts/fixtures/connections.ts`) 가 `connections.json` 을 Tauri runtime 우회해 직접 write 했고 password 를 plaintext `testpass` 로 박아, 사용자가 앱에서 Connect 클릭하자마자 "Encryption Error: Ciphertext too short" 로 즉시 실패.

**원인**: Rust storage layer (`src-tauri/src/storage/crypto.rs::decrypt`) 는 모든 디스크상 password 가 AES-256-GCM ciphertext (12B nonce ‖ ciphertext ‖ 16B GCM tag, base64) 라 가정하는데, fixture 가 그 envelope 을 재현하지 않음 — Node `createCipheriv("aes-256-gcm")` 의 tag 위치 (Node 별도 반환 vs Rust `aes_gcm` crate 자동 append) 같은 cross-language 함정도 같은 부류.

**재발 방지**: 외부 도구가 Tauri 백엔드 storage 파일을 직접 만질 때는 (a) 받는 쪽 모듈의 모든 invariant (특히 envelope/암호화) 를 1:1 재현, (b) 받는 쪽과 동일 알고리즘으로 round-trip 단위 테스트 작성 (`connections.test.ts` 참조), (c) 새 외부 storage writer 추가 PR 의 evaluator 통과 기준에 "앱 sanity smoke 1회" 를 명시 — `pnpm tsc + lint + vitest` 만으로는 contract drift 를 잡을 수 없다.
