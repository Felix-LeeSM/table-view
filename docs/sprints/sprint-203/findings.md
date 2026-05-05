# Sprint 203 — Findings

`any` (7) + `as unknown as` (2) 정리. type narrowing only. 행동 변경 0.

## §1 — `useSqlAutocomplete.ts` 의 SQLNamespace narrowing

`@codemirror/lang-sql` 의 `SQLNamespace` 정의:

```typescript
type SQLNamespace = {
    [name: string]: SQLNamespace;                    // form 1: recursive map
} | {
    self: Completion;
    children: SQLNamespace;                          // form 2: leaf with self
} | readonly (Completion | string)[];                // form 3: array
```

빌드 패턴 분석:
- top-level `ns` = form 1. value 에 form 1 (column namespace) 또는 form 2
  (reserved token / quoted alias) 가 mixed.
- `colNs` (column namespace) = form 1, leaf 의 column 들이 empty `{}` (form 1
  empty Record)
- `reservedToken` return = form 2 (`{ self, children }`)

따라서 모든 `Record<string, any>` 를 `Record<string, SQLNamespace>` 으로,
return type `any` → `{ self: Completion; children: SQLNamespace }` 으로
narrowing 가능. `Completion` 은 `@codemirror/autocomplete` 에서 import.

eslint-disable 주석 6 줄 모두 제거.

## §2 — `mongoAutocomplete.ts` 의 cast 단순화

`tree.resolveInner(pos, -1)` 의 return type 은 `@lezer/common` 의 `SyntaxNode`.
자체 정의 `MinimalSyntaxNode` interface (line 17-26):

```typescript
interface MinimalSyntaxNode {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly parent: MinimalSyntaxNode | null;
  readonly firstChild: MinimalSyntaxNode | null;
}
```

`SyntaxNode` 는 위 5 field 모두 가지므로 structurally `MinimalSyntaxNode` 의
supertype. TS structural typing 으로 SyntaxNode → MinimalSyntaxNode assign
가능. `as unknown as MinimalSyntaxNode` 우회 cast 가 불필요.

```diff
- const node = tree.resolveInner(pos, -1) as unknown as MinimalSyntaxNode;
+ const node: MinimalSyntaxNode = tree.resolveInner(pos, -1);
```

`MinimalSyntaxNode` interface 보존 — 의도적 abstraction (lezer 의 사용 surface
만 명시화) 라 그대로. cast wrapper 만 단순화.

## §3 — 검증 결과

| 항목 | 결과 |
|------|------|
| `pnpm tsc --noEmit` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm vitest run useSqlAutocomplete + mongoAutocomplete` | 36 passed |
| `pnpm vitest run` (전체) | 188 files / 2725 tests pass |

`grep -nE "(:|=) *any\b|<any>|as unknown as|@typescript-eslint/no-explicit-any"
useSqlAutocomplete.ts mongoAutocomplete.ts` → 0 match.

## §4 — 라인 수 변화

- `useSqlAutocomplete.ts`: 289 → 286 (eslint-disable 6줄 - 신규 use 1줄)
- `mongoAutocomplete.ts`: 447 → 447 (cast 두 줄 만 텍스트 변경, 길이 동일)

## §5 — Out-of-scope

- 다른 파일 (`@hooks` / `@components` / `@lib` 의 잔여 `any`) — 본 sprint 의
  CODE_SMELLS §3 enumerate 외. 향후 wide-net 재스캔 시 후속 sprint.
- `MinimalSyntaxNode` 제거 → `@lezer/common` 직접 dependency — abstraction
  보존 결정.
