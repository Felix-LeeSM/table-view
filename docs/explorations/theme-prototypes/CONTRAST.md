# 대비 실측 — 72 테마 × 2 모드

프로토타입 81장을 만들다 여러 에이전트가 각각 같은 문제를 보고했다. 추정이 아니라
`src/themes.css` 의 토큰 값을 그대로 읽어 WCAG 2.x 상대휘도 공식으로 전수 계산한 결과다.

**재현**
```bash
node /tmp/extract-themes.mjs   # src/themes.css → 테마별 토큰 JSON
node /tmp/contrast.mjs         # 대비 계산
```
(계산식: `L = 0.2126R + 0.7152G + 0.0722B`, sRGB 감마 역보정 후. 대비 `(L₁+0.05)/(L₂+0.05)`.)

**이 문서는 프로토타입의 결함 목록이 아니다.** 프로토타입은 원본 토큰을 그대로 반영했을 뿐이고,
아래 수치는 전부 `src/themes.css` 자체의 값이다.

---

## 1. primary 버튼 안 글자 — 64/144 조합이 AA(4.5:1) 미달

`--tv-primary-foreground` 는 거의 모든 테마에서 흰색으로 고정인데 `--tv-primary` 가 밝은 색인
테마에서 글자가 사라진다. 특히 아래 30개는 3:1 미만이라 **큰 글자 기준(AA Large)도 통과하지 못한다.**

| 대비 | 테마 | 모드 | 조합 |
|---|---|---|---|
| **1.07:1** | `clickhouse` | light | `#fff` on `#faff69` |
| **1.47:1** | `miro` | light | `#fff` on `#ffd02f` |
| **1.51:1** | `renault` | light | `#fff` on `#ffcc33` |
| **1.53:1** | `voltagent` | light | `#fff` on `#facc15` |
| **1.58:1** | `mongodb` | dark | `#ffffff` on `#00ed64` |
| **1.79:1** | `opencode` | light | `#fff` on `#fab283` |
| **1.80:1** | `binance` | light | `#fff` on `#f0b90b` |
| **1.92:1** | `spotify` | dark | `#ffffff` on `#1ed760` |
| **2.00:1** | `supabase` | light | `#fff` on `#3ecf8e` |
| **2.05:1** | `figma` | light | `#fff` on `#0acf83` |
| **2.28:1** | `mintlify` | dark | `#ffffff` on `#22c55e` |
| **2.41:1** | `nvidia` | light | `#fff` on `#76b900` |
| **2.41:1** | `nvidia` | dark | `#ffffff` on `#76b900` |
| **2.53:1** | `playstation` | dark | `#ffffff` on `#00aeef` |
| **2.59:1** | `spotify` | light | `#fff` on `#1db954` |
| **2.61:1** | `cohere` | light | `#fff` on `#ff7759` |
| **2.68:1** | `arc` | light | `#fff` on `#ff6b9d` |
| **2.79:1** | `sanity` | dark | `#ffffff` on `#f97066` |
| **2.80:1** | `lovable` | light | `#fff` on `#f97316` |
| **2.83:1** | `together` | dark | `#ffffff` on `#4a9bff` |
| **2.84:1** | `zapier` | dark | `#ffffff` on `#ff6b33` |
| **2.90:1** | `meta` | dark | `#ffffff` on `#4599ff` |
| **2.91:1** | `raycast` | light | `#fff` on `#ff6363` |
| **2.91:1** | `raycast` | dark | `#ffffff` on `#ff6363` |
| **2.94:1** | `minimax` | light | `#fff` on `#ff5c8a` |
| **2.98:1** | `slate` | dark | `#ffffff` on `#818cf8` |
| **2.98:1** | `expo` | dark | `#ffffff` on `#818cf8` |
| **2.98:1** | `composio` | dark | `#ffffff` on `#818cf8` |
| **3.00:1** | `framer` | light | `#fff` on `#0099ff` |
| **3.00:1** | `framer` | dark | `#ffffff` on `#0099ff` |

3:1~4.5:1 구간 34개 (본문 크기 미달, 큰 글자면 통과):

`mastercard`/dark 3.05 · `stripe`/dark 3.05 · `webflow`/dark 3.08 · `github`/dark 3.10 · `kraken`/dark 3.10 · `claude`/dark 3.11 · `linear`/dark 3.17 · `intercom`/dark 3.21 · `shopify`/dark 3.22 · `mintlify`/light 3.30 · `darcula`/light 3.33 · `mistral`/light 3.34 · `ibm`/dark 3.35 · `warp`/light 3.37 · `warp`/dark 3.37 · `theverge`/light 3.37 · `theverge`/dark 3.37 · `zapier`/light 3.37 · `vodafone`/dark 3.47 · `posthog`/light 3.52 · `posthog`/dark 3.52 · `coinbase`/dark 3.53 · `ferrari`/dark 3.55 · `apple`/dark 3.65 · `pinterest`/dark 3.83 · `sanity`/light 3.86 · `figma`/dark 3.88 · `apple`/light 4.02 · `claude`/light 4.23 · `revolut`/light 4.43 · `revolut`/dark 4.43 · `together`/light 4.43 · `composio`/light 4.47 · `intercom`/light 4.47

## 2. `--tv-muted-foreground` — 71/144 조합이 3:1 미달

light 모드 72개 중 71개가 걸린다. 원인은 하나다 — `#94a3b8` (slate-400) 이
72개 테마의 light 블록에 거의 그대로 복제돼 있고, 밝은 배경 위에서 2.2~2.6:1 밖에 안 나온다.
보조 텍스트(컬럼 타입, 메타데이터, NULL 표시, 상태바)가 전부 이 토큰을 쓴다.

| 배경 | 대비 | 해당 테마 수 |
|---|---|---|
| `#ffffff` | 2.56:1 | 58 |
| `#fafafa` | 2.46:1 | 3 |
| `#fafbfc` | 2.47:1 | 1 |
| `#f7f7f7` | 2.39:1 | 1 |
| `#eeefe9` | 2.22:1 | 1 |
| `#f4f4f4` | 2.33:1 | 1 |
| `#faf9f5` | 2.43:1 | 1 |
| `#f9f9f9` | 2.44:1 | 1 |
| `#f5f5f5` | 2.35:1 | 1 |
| `#f6f5f4` | 2.35:1 | 1 |
| `#faf7f0` | 2.40:1 | 1 |
| `#fafaf7` | 2.45:1 | 1 |

dark 모드는 같은 `#94a3b8` 이 어두운 배경 위라 대부분 통과한다 — 문제는 light 쪽에만 있다.

## 3. 본문 `--tv-foreground` — 144/144 조합 전부 AA 통과

기본 텍스트 대비는 문제없다. 깨지는 것은 **보조 텍스트와 채운 버튼 위 글자** 두 곳이다.

---

## 고칠 때의 선택지

1. **`--tv-primary-foreground` 를 테마별로 정하기.** 밝은 primary 테마(`clickhouse` `miro`
   `renault` `voltagent` `binance` `opencode`)는 어두운 글자여야 한다. 현재 dark 모드 일부
   테마는 이미 `#000000` 을 쓰고 있어 light 쪽만 비대칭으로 남은 상태다.
2. **`--tv-muted-foreground` 를 배경 밝기에 맞춰 한 단계 낮추기** — `#94a3b8`(slate-400) →
   `#64748b`(slate-500, 흰 배경 위 4.76:1) 이면 72개 light 블록이 한 번에 3:1 을 넘는다.
3. **자동 가드.** 위 두 계산은 순수 함수라 테스트로 고정할 수 있다. 새 테마가 들어올 때
   AA 미달을 CI 에서 잡으면 이 목록이 다시 자라지 않는다.

어느 쪽도 이 프로토타입 작업의 범위 밖이라 **값은 하나도 건드리지 않았다.**
