# Homebrew Cask 배포

이 저장소의 릴리스는 기본적으로 `draft`로 생성됩니다. `release` 탭에서 `Publish`
버튼을 눌러 공개(published) 릴리스로 바꾼 뒤, Homebrew cask tap 저장소의
`Casks/table-view.rb`를 손으로 갱신합니다. 이 저장소에는 cask를 갱신하는
워크플로가 없습니다.

## tap 준비

- 별도 Homebrew tap 저장소: `Felix-LeeSM/homebrew-table-view`
- 기본 브랜치는 `main`
- tap에 push 할 수 있는 계정 또는 PAT (private tap이면 `repo` 권한, 공개 tap이면
  `public_repo`)

## 갱신 절차

릴리스를 퍼블리시한 뒤 직접 수행합니다.

1. 현재 릴리스의 자산 목록 확인 (`.dmg`, `.sha256`)
2. macOS arm64 `.dmg` 파일과 checksum 추출
3. tap 저장소에서 `Casks/table-view.rb`의 버전, URL, checksum 갱신
4. tap 브랜치를 만들고 PR 올리기

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
  checksum은 packaging evidence일 뿐, CI 결과나 live support claim evidence를
  대체하지 않습니다. `Runtime Happy Path` 는 spec 을 하나도 실행하지 않으므로
  runtime 근거가 아닙니다.
- 릴리스 노트의 support claim은
  [`release-notes-support-matrix.md`](release-notes-support-matrix.md)를 기준으로
  작성하고, product docs와 known limitations 링크를 함께 둡니다.
- 버전/tag와 artifact 검증은
  [`versioning-and-artifacts.md`](versioning-and-artifacts.md)를 기준으로 확인합니다.
- tap 저장소 push 권한이 없으면 4번에서 막힙니다.
- 릴리스 `.dmg` 파일명 정책이 바뀌면 cask의 URL 패턴도 함께 고쳐야 합니다.
