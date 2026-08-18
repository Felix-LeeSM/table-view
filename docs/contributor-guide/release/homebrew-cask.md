# Homebrew Cask 배포

이 저장소의 릴리스는 기본적으로 `draft`로 생성됩니다. `release` 탭에서 `Publish`
버튼을 누르면 그 순간 `release: published` 이벤트가 발생하고,
`.github/workflows/release.yml`의 `Update Homebrew tap cask` job이 tap 저장소
`Felix-LeeSM/homebrew-table-view`의 `Casks/table-view.rb`를 갱신합니다. 손으로
할 일은 `Publish` 버튼까지입니다.

## 자동 갱신이 하는 일

1. 태그(`vX.Y.Z`)에서 `v`를 뗀 값을 버전으로 삼습니다.
2. 그 릴리스의 asset `Table.View_<버전>_aarch64.dmg`에 GitHub이 붙인 digest를
   읽습니다. `.dmg`를 다시 받아 해시하지 않습니다 — 같은 워크플로의
   `Upload SHA256 checksums` 스텝이 사이드카를 붙일 때 쓰는 필드와 같은 값이라,
   cask와 `.sha256` 사이드카가 서로 다른 바이트를 가리킬 수 없습니다.
3. tap을 clone하고 `scripts/release/update-homebrew-cask.sh`로
   `Casks/table-view.rb`의 `version`과 `sha256` **두 줄만** 갈아 끼웁니다.
   `livecheck` 블록과 `caveats`는 그대로 둡니다 — 파일을 새로 생성하면 그것들이
   조용히 사라지고, `livecheck`가 없으면 `brew outdated`가 새 버전의 존재조차
   알리지 못합니다.
4. 바뀐 것이 있으면 tap의 `main`에 커밋을 하나 push합니다. 이미 같은 버전과
   checksum이면 아무것도 push하지 않고 끝납니다.

치환할 줄이 하나가 아니거나 값의 형태가 어긋나면 스크립트는 파일을 건드리지 않고
멈춥니다. 못 바꾼 채 green으로 끝나면 job은 성공으로 보이는데 tap은 옛 버전으로
남기 때문입니다.

## 자동 갱신이 안 도는 경우

이때는 아래 **수동 갱신**으로 처리합니다.

- 릴리스가 `prerelease`로 표시된 경우. Actions UI에서 `workflow_dispatch`로 돌린
  dry-run이 남긴 draft가 여기 해당합니다. 그 draft를 실수로 publish해도 tap은
  움직이지 않습니다.
- 태그가 `vX.Y.Z` 형태가 아닌 경우. dry-run draft의 태그는 `manual-<sha>`라
  버전을 가리키지 않으므로 job이 red로 멈춥니다.
- 그 릴리스에 `Table.View_<버전>_aarch64.dmg`가 없는 경우. macOS 레그가 죽은
  채로 publish된 상태이므로 cask에 넣을 바이트 자체가 없습니다.
- `HOMEBREW_TAP_TOKEN`이 만료·회수된 경우.
- tap job이 pending 상태로 취소된 경우. `release` 이벤트 run은 같은 태그의 빌드
  run과 `concurrency` 그룹을 공유하므로, 빌드가 아직 돌고 있으면 그 뒤에서
  기다립니다. 기다리는 것 자체는 정상입니다.

tap이 갱신됐는지는 tap 저장소의 커밋 목록이나 다음으로 확인합니다.

```bash
brew update && brew info --cask felix-leesm/table-view/table-view
```

## tap 준비

- 별도 Homebrew tap 저장소: `Felix-LeeSM/homebrew-table-view`
- 기본 브랜치는 `main`
- 이 저장소의 Actions secret `HOMEBREW_TAP_TOKEN` — tap에 push할 수 있는 PAT
  (private tap이면 `repo` 권한, 공개 tap이면 `public_repo`). tap 전용이라
  `RELEASE_PAT`과 분리돼 있습니다. `RELEASE_PAT`은 이 저장소에 태그를 미는
  토큰이고, tap job에 그것을 주면 유출 시 피해 범위가 넓어집니다.

## 수동 갱신

자동 갱신이 안 돌았거나 실패했을 때의 대체 경로입니다. 워크플로가 부르는 것과
같은 스크립트를 쓰므로 결과 파일이 자동 갱신과 같습니다.

```bash
# 1. 값 뽑기 — 태그와 asset digest
TAG=v0.7.1
VERSION="${TAG#v}"
SHA="$(gh release view "$TAG" --repo Felix-LeeSM/table-view --json assets |
  jq -r --arg n "Table.View_${VERSION}_aarch64.dmg" \
    '[.assets[] | select(.name == $n) | .digest] | if length == 1 then .[0] else "" end')"
SHA="${SHA#sha256:}"

# 2. tap을 받아 두 줄만 갈아 끼우기
git clone https://github.com/Felix-LeeSM/homebrew-table-view.git
bash scripts/release/update-homebrew-cask.sh \
  homebrew-table-view/Casks/table-view.rb "$VERSION" "$SHA"

# 3. tap 브랜치를 만들고 PR 올리기 (또는 push 권한이 있으면 main에 직접)
```

스크립트 없이 손으로 고칠 때도 `version`과 `sha256` 값만 바꿉니다. `url`은
`#{version}` 보간이라 버전을 따라가고, `livecheck` 블록은 지우면 안 됩니다.

## 지원하는 아키텍처

- macOS arm64 한정 (cask의 `depends_on arch: :arm64`)
  - asset 이름 `Table.View_<버전>_aarch64.dmg` 하나만 봅니다

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

앱은 Developer ID 인증서가 아니라 ad-hoc으로 서명돼 있어 첫 실행이 Gatekeeper에
막힙니다. cask의 `caveats`가 사용자에게 우회 방법(`--no-quarantine` 플래그 또는
설치 후 `xattr -cr`)을 안내합니다. 서명과 공증은 별도 사안입니다.

## 운영상 주의

- GitHub Release를 `Publish`하기 전에는
  [`../testing-and-quality.md`](../testing-and-quality.md)의 Pre-Release
  Verification Gate가 같은 release SHA에서 통과해야 합니다. Draft bundle과
  checksum은 packaging evidence일 뿐, CI 결과나 live support claim evidence를
  대체하지 않습니다. `Runtime Happy Path` 는 변경 경로가 고른 spec 만 돌리므로,
  release SHA 의 runtime 근거로는 전체를 돌리는 `main` push run 이나 야간 run
  을 보거나 직접 수동 실행하십시오.
- **`Publish`를 누른 뒤에는 되돌릴 수 없습니다.** 그 클릭이 tap 갱신의 트리거라,
  검토는 draft 상태에서 끝내야 합니다.
- 릴리스 노트의 support claim은
  [`release-notes-support-matrix.md`](release-notes-support-matrix.md)를 기준으로
  작성하고, product docs와 known limitations 링크를 함께 둡니다.
- 버전/tag와 artifact 검증은
  [`versioning-and-artifacts.md`](versioning-and-artifacts.md)를 기준으로 확인합니다.
- 릴리스 `.dmg` 파일명 정책이 바뀌면 자동 갱신 job이 asset을 못 찾아 멈춥니다.
  `.github/workflows/release.yml`의 asset 이름과 cask의 URL 패턴을 함께 고쳐야
  합니다.
