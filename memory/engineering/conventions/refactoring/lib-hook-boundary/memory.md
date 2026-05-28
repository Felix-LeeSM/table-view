---
title: D. lib vs hook 경계
type: memory
updated: 2026-05-28
---

# D. lib vs hook 경계

상위: [refactoring](../memory.md). 카테고리 D — pure/domain `lib`,
runtime orchestration, `hooks` (React state), `components` (JSX) 분리 룰.

## D-1. 3 layer 분리 기준

- **pure lib target** (`src/lib/**`, `src/lib/runtime/**` 와 아래 legacy
  debt 제외): 새 pure/domain 파일은 React 의존 0 (no `useState` /
  `useEffect` / JSX / hooks), store 의존 0. 순수 `(input) → output` 함수 +
  작은 자료형. 모범: `analyzeStatement`, `analyzeMongoPipeline`, `format`,
  `sqlTokenize`.
- **runtime lib** (`src/lib/runtime/**`): pure lib 의 명시적 예외. React 밖에서
  boot/event/history/recovery/use-case orchestration 을 맡는다. store 는 public
  action 으로만 다루고 `useXStore.setState` 직접 write 는 하지 않는다.
- **hooks** (`src/hooks/`): React state/effect 가 있고 JSX 반환 안 함.
  `use` prefix.
- **components** (`src/components/`): JSX 반환.
- **검증**: pure lib 파일 import 에 `react` / `@stores/` / `@hooks/` 등장 0.
  runtime lib 도 `react` / JSX / hook import 는 금지다.

## D-2. Import direction

- **허용**: `components → hooks → pure lib`, 또는
  `components/hooks/main → src/lib/runtime → store actions + tauri wrappers + pure lib`.
  같은 layer 안 import OK.
- **금지**: 역방향 (pure lib → runtime/hook/component/store,
  hook → component). runtime lib → component/hook 도 금지.

## D-3. Pure 추출 강도 — 강한 룰

- hook 안에서 식별 가능한 pure 부분 (input → output, side-effect 0) 이
  있으면 **lib 으로 추출**. hook 은 wiring (store read + 호출 + state
  setter) 만 남긴다.
- **예외**: trivial (1~2 라인, 삼항/조건 1개) 은 hook 안에 둬도 OK.
- **이득**: pure 단위 테스트 가벼움 (`renderHook` 불필요), hook 외부 재사용
  가능.

## D-4. Runtime 추출 기준

- store 2개 이상 + Tauri wrapper/event/listener/history/recovery 를 묶는 흐름은
  hook/component 에 흩뿌리지 않고 `src/lib/runtime/**` use-case 로 모은다.
- runtime 은 UI 를 렌더하지 않고 React lifecycle 에 기대지 않는다. component/hook
  은 runtime use-case 호출과 UI state bridging 만 맡는다.
- pure 계산이 보이면 runtime 안에 두지 말고 pure lib 로 분리한다.

## D-5. 명명 규칙

- **lib 함수**: 명령형 동사 — `analyze*`, `decide*`, `parse*`, `format*`,
  `sanitize*`, `tokenize*`.
- **hook**: `use*` prefix.
- **lib 파일명**: 도메인 또는 동사 — `sqlSafety.ts`, `format.ts`. 명사
  단수 권장.

## D-6. lib sub-grouping

- 도메인 pure helper 는 `src/lib/sql/**`, `src/lib/mongo/**`, data-source 별
  folder 처럼 capability 기준으로 묶는다.
- runtime-only 흐름은 `src/lib/runtime/**` 로 묶는다. 이 예외 구역을 만들었다고
  pure helper 에 store import 를 허용하지 않는다.
- 현재 legacy runtime 성격 파일(`src/lib/snapshot/loadAll.ts`,
  `src/lib/toast.ts` 등)은 touched scope 에서
  `src/lib/runtime/**` 로 이동하거나 store action 호출로 낮춘다. 행동 변경이
  섞이면 별도 refactor contract 로 분리한다.
