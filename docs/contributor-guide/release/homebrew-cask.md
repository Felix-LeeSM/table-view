# Homebrew Cask 자동 배포

이 저장소의 릴리스는 기본적으로 `draft`로 생성됩니다. `release` 탭에서 `Publish`
버튼을 눌러 공개(published) 릴리스로 바꾸면, 배포용 워크플로가 실행되어
Homebrew cask tap 저장소의 `Casks/table-view.rb`를 갱신하고 PR을 만듭니다.

## 필요 조건

- 별도 Homebrew tap 저장소 준비: `Felix-LeeSM/homebrew-table-view`
- 워크플로에서 `vars.HOMEBREW_TAP_REPO` 변수 지정: `Felix-LeeSM/homebrew-table-view`
- `vars.HOMEBREW_TAP_BASE_BRANCH` 지정 (옵션, 기본값 `main`)
- `secrets.HOMEBREW_TAP_TOKEN` 등록
  - 권한: `public_repo` 또는 private tap 이면 `repo`
  - 값: Homebrew tap에 push 가능한 PAT

## 동작

릴리스 퍼블리시 시 `.github/workflows/homebrew-cask.yml`가 실행되어 다음을 처리합니다.

1. 현재 릴리스의 자산 목록 조회 (`.dmg`, `.sha256`)
2. macOS arm64 `.dmg` 파일과 checksum 추출
3. tap 저장소에서 `Casks/table-view.rb`를 갱신
4. 변경이 있으면 tap 브랜치와 PR 생성

## 지원하는 아키텍처

- macOS arm64 한정
  - `.dmg` 에서 `aarch64` 또는 `arm64` 패턴을 찾음

## 설치

배포 후 사용자는 tap를 받아 설치하면 됩니다.

```bash
brew tap Felix-LeeSM/table-view
brew install --cask table-view
```

이미 설치한 사용자는 새 릴리스가 tap에 반영된 뒤 다음으로 갱신합니다.

```bash
brew upgrade --cask table-view
```

## 운영상 주의

- GitHub Release를 `Publish`하기 전에는
  [`../testing-and-quality.md`](../testing-and-quality.md)의 Pre-Release
  Verification Gate가 같은 release SHA에서 통과해야 합니다. Draft bundle과
  checksum은 packaging evidence일 뿐, CI/Runtime Happy Path나 live support claim
  evidence를 대체하지 않습니다.
- 릴리스 노트의 support claim은
  [`release-notes-support-matrix.md`](release-notes-support-matrix.md)를 기준으로
  작성하고, product docs와 known limitations 링크를 함께 둡니다.
- 버전/tag와 artifact 검증은
  [`versioning-and-artifacts.md`](versioning-and-artifacts.md)를 기준으로 확인합니다.
- `HOMEBREW_TAP_REPO`가 비어 있거나, tap 저장소 접근 권한이 없으면 워크플로가 실패합니다.
- 릴리스 `.dmg`의 파일명이 정책이 바뀌면 script 탐색 패턴을 함께 수정해야 합니다.
