import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Flags Tailwind arbitrary pixel values on size-class prefixes — the
// reason they exist is almost always a missing design token. Prefixes
// are limited to spacing/sizing utilities on purpose: shadcn/ui ships
// ring-[3px] / rounded-[2px] / translate-y-[calc(...)] which we don't
// want to break. Non-px units (rem, %, vh, calc) are allowed since the
// user-facing rule is "no raw pixels".
const ARBITRARY_PX =
  /\b(?:text|w|h|max-w|max-h|min-w|min-h|p[xytblrse]?|m[xytblrse]?|gap|top|bottom|left|right|inset)-\[-?\d+(?:\.\d+)?px\]/;

// ADR 0031 (2026-05-15) — `var(--xxx)` 참조 토큰이 themes.css / index.css
// 에 정의되어 있는지 검사. 본 사건 (`var(--primary)` raw 변수 invalid CSS
// 도달) 의 재발 방지. stylelint 는 .ts 파일을 안 보고, TypeScript 도
// 문자열 안 CSS 를 못 보는 갭을 메운다.
const TOKEN_REF = /var\((--[a-z][a-z0-9-]+)/g;
const TOKEN_ALLOW_PREFIX = ["--tw-", "--cm-", "--radix-"];
// Cross-file component-local custom properties — parent 가 `style={{ "--X":
// ... }}` 로 inline 정의, descendant 가 `var(--X)` 로 참조. 같은 파일
// 안 패턴은 rule 의 Property visitor 가 자동 인식하지만, cross-file 은
// AST scan 으로 못 잡으므로 명시 등록.
const TOKEN_ALLOW_NAMES = new Set([
  "--cols", // Sprint 258 — DataGrid grid-template-columns sharing.
]);
let DEFINED_TOKENS_CACHE = null;
function loadDefinedTokens(cwd) {
  if (DEFINED_TOKENS_CACHE) return DEFINED_TOKENS_CACHE;
  const set = new Set();
  const files = [
    resolve(cwd, "src/themes.css"),
    resolve(cwd, "src/index.css"),
  ];
  for (const file of files) {
    if (!existsSync(file)) continue;
    const content = readFileSync(file, "utf8");
    for (const m of content.matchAll(/(--[a-z][a-z0-9-]+)\s*:/g)) {
      set.add(m[1]);
    }
  }
  DEFINED_TOKENS_CACHE = set;
  return set;
}

const tvLocal = {
  rules: {
    "no-tailwind-arbitrary-px": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow Tailwind arbitrary px values on size/spacing utilities. Add a token to @theme inline instead.",
        },
        schema: [],
        messages: {
          noPx:
            "Arbitrary pixel value '{{match}}' is not allowed on size/spacing utilities. Add a design token (e.g. --text-3xs, --spacing-dialog-md) to @theme inline and use the named class.",
        },
      },
      create(context) {
        function check(raw, node) {
          if (typeof raw !== "string") return;
          const m = raw.match(ARBITRARY_PX);
          if (m) {
            context.report({
              node,
              messageId: "noPx",
              data: { match: m[0] },
            });
          }
        }
        return {
          Literal(node) {
            check(node.value, node);
          },
          TemplateElement(node) {
            check(node.value?.raw, node);
          },
        };
      },
    },
    "no-undefined-css-token": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow var() references to CSS tokens not defined in src/themes.css or src/index.css. Catches the var(--primary) raw-var sleeper bug pattern.",
        },
        schema: [],
        messages: {
          undefined:
            "Undefined CSS token '{{token}}'. Define it in src/themes.css or src/index.css, or use an existing --tv-* token.",
        },
      },
      create(context) {
        const defined = loadDefinedTokens(context.cwd);
        // File-local custom property collection: `style={{ "--cols": ... }}`
        // 같은 inline 정의는 같은 파일 내 `var(--cols)` 참조와 짝. 두 번째
        // pass 에서 검사하기 위해 정의 + 참조 둘 다 모은다.
        const localTokens = new Set();
        const refs = [];
        function collectRefs(raw, node) {
          if (typeof raw !== "string") return;
          for (const m of raw.matchAll(TOKEN_REF)) {
            refs.push({ token: m[1], node });
          }
        }
        return {
          Property(node) {
            const key = node.key;
            let name = null;
            if (key?.type === "Literal" && typeof key.value === "string") {
              name = key.value;
            } else if (key?.type === "Identifier") {
              name = key.name;
            }
            if (name && /^--[a-z][a-z0-9-]+$/.test(name)) {
              localTokens.add(name);
            }
          },
          Literal(node) {
            collectRefs(node.value, node);
          },
          TemplateElement(node) {
            collectRefs(node.value?.raw, node);
          },
          "Program:exit"() {
            for (const { token, node } of refs) {
              if (TOKEN_ALLOW_PREFIX.some((p) => token.startsWith(p))) continue;
              if (TOKEN_ALLOW_NAMES.has(token)) continue;
              if (defined.has(token)) continue;
              if (localTokens.has(token)) continue;
              context.report({
                node,
                messageId: "undefined",
                data: { token },
              });
            }
          },
        };
      },
    },
  },
};

export default tseslint.config(
  {
    ignores: [
      "dist",
      "src-tauri",
      "coverage",
      "cargo-target",
      // sub-agent worktree 디렉토리. main repo 의 lint 가 안의 partial
      // 변경을 collect 하지 않도록 차단.
      ".claude/**",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2021,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "tv-local": tvLocal,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "tv-local/no-tailwind-arbitrary-px": "error",
      "tv-local/no-undefined-css-token": "error",
    },
  },
  // Sprint-112: forbid new native <select> JSX. All dropdowns must use the
  // Radix-based <Select> primitive from @components/ui/select to keep the
  // design system / accessibility behaviour consistent.
  //
  // 2026-05-05: 결 1 — 컴포넌트/페이지 .tsx에서 zustand store의 .getState()
  // 직접 호출 금지. 본문 top-level은 stale read로 re-render 끊김. 안의
  // event handler/callback에서도 컴포넌트 layer 일관성을 위해 전부 금지하고
  // 외부 호출이 필요하면 src/hooks/* 의 lifecycle hook으로 옮긴다.
  {
    files: ["src/**/*.tsx"],
    ignores: [
      "**/*.test.tsx",
      "src/main.tsx", // app entry — boot 시 1회 hydration. React 컴포넌트 외부 layer.
      "src/test-utils.tsx", // test helper — generic store API 사용 위한 의도적 직접 접근.
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXOpeningElement[name.name='select']",
          message:
            "Use <Select> from @components/ui/select instead of native <select>.",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name='getState']",
          message:
            "컴포넌트/페이지 .tsx에서 store.getState() 직접 호출 금지. selector hook (useStore(s => s.x)) 또는 src/hooks/* 의 lifecycle hook으로 분리.",
        },
      ],
    },
  },
  // Sprint 306 (2026-05-14) — DataGrid / QuickLook / cell-format / 문서
  // tree / SQL·MQL literal builder 등 *cell 값을 직접 만지는* 코드 layer 에
  // 서 raw `JSON.stringify` 금지. ADR 0026 numeric wire-format (BigInt /
  // Decimal) 이 cell 에 들어오므로 raw stringify 는 throw 또는 `{}` 로
  // 떨어진다 (sprint-305 freeze 가 정확히 이 사례). 대신 `@lib/jsonCell`
  // 의 `safeStringifyCell` 사용 — BigInt/Decimal 을 string 으로 emit.
  //
  // exempt 사이트 (localStorage persist / session storage / IPC bridge /
  // 에러 로깅 / 내부 wrapper) 는 본 패턴이 닿지 않는 다른 디렉토리이므로
  // 자동 제외. 본 scope 안에서도 cell-domain 이 아닌 callsite (예: mongo
  // filter / pipeline 객체 = schema-defined query AST) 가 필요하면 한 줄
  // `eslint-disable-next-line no-restricted-syntax` + 사유 코멘트.
  {
    files: [
      "src/components/datagrid/**/*.{ts,tsx}",
      "src/components/document/**/*.{ts,tsx}",
      "src/components/shared/QuickLookPanel/**/*.{ts,tsx}",
      "src/components/shared/BsonTreeViewer.tsx",
      "src/lib/format.ts",
      "src/lib/mongo/mqlGenerator.ts",
      "src/lib/sql/rawQuerySqlBuilder.ts",
    ],
    ignores: ["**/*.test.{ts,tsx}", "src/lib/jsonCell.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.object.name='JSON'][callee.property.name='stringify']",
          message:
            "Cell-domain code 에서는 `JSON.stringify` 대신 `@lib/jsonCell` 의 `safeStringifyCell` 사용. raw `JSON.stringify` 는 BigInt 만나면 throw, Decimal 만나면 `{}` 로 떨어져 DataGrid mount-time freeze 발생 (Sprint 305).",
        },
      ],
    },
  },
  // 2026-05-05: 결 2 — store 파일끼리 직접 import 금지. 한 store action에서
  // 다른 store를 만지면 의존 그래프가 양방향이 되고 React 외부에서 cross-store
  // coupling이 생긴다. 두 store를 묶는 책임은 React layer (src/hooks/*) 또는
  // 호출자 컴포넌트에 둔다. type-only import는 빌드 시 사라져 런타임 cross-
  // coupling을 만들지 않으므로 `allowTypeImports`로 허용.
  {
    files: ["src/stores/**/*.ts"],
    ignores: ["**/*.test.ts", "src/stores/**/__tests__/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@stores/*", "./*Store", "../**/*Store"],
              message:
                "store 파일끼리 import 금지. cross-store 호출은 src/hooks/* 의 hook으로 수렴.",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
);
