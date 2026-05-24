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
2. macOS arm64 / x86_64 에 맞는 `.dmg` 파일과 checksum 추출
3. tap 저장소에서 `Casks/table-view.rb`를 갱신
4. 변경이 있으면 tap 브랜치와 PR 생성

## 지원하는 아키텍처

- macOS arm64 한정
  - `.dmg` 에서 `aarch64` 또는 `arm64` 패턴을 찾음
- macOS Intel/Universal(이름 규칙이 x86_64/x64/amd64)도 감지 시 `if` 분기 cask를 만듦

## 설치

배포 후 사용자는 tap를 받아 설치하면 됩니다.

```bash
brew tap Felix-LeeSM/table-view
brew install --cask table-view
```

## 운영상 주의

- `HOMEBREW_TAP_REPO`가 비어 있거나, tap 저장소 접근 권한이 없으면 워크플로가 실패합니다.
- 릴리스 `.dmg`의 파일명이 정책이 바뀌면 script 탐색 패턴을 함께 수정해야 합니다.
