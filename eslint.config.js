import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

// Flags Tailwind arbitrary pixel values on size-class prefixes — the
// reason they exist is almost always a missing design token. Prefixes
// are limited to spacing/sizing utilities on purpose: shadcn/ui ships
// ring-[3px] / rounded-[2px] / translate-y-[calc(...)] which we don't
// want to break. Non-px units (rem, %, vh, calc) are allowed since the
// user-facing rule is "no raw pixels".
const ARBITRARY_PX =
  /\b(?:text|w|h|max-w|max-h|min-w|min-h|p[xytblrse]?|m[xytblrse]?|gap|top|bottom|left|right|inset)-\[-?\d+(?:\.\d+)?px\]/;

const GENERATED_WASM_ESLINT_IGNORES = [
  "src/lib/sql/wasm/**",
  "src/lib/mongo/wasm/**",
];

const FEATURE_BOUNDARY_ALLOWED_PREFIXES = [
  "@/components/ui/",
  "@components/ui/",
  "@/lib/",
  "@lib/",
  "@/types/",
  "@/test-utils",
  "@/test-utils/",
];

const FEATURE_BOUNDARY_LEGACY_ALIASES = [
  { prefixes: ["@/components/", "@components/"], target: "legacy component" },
  { prefixes: ["@/hooks/", "@hooks/"], target: "legacy hook" },
  { prefixes: ["@/stores/", "@stores/"], target: "store" },
  { prefixes: ["@/pages/"], target: "page" },
  { prefixes: ["@/router/"], target: "router" },
  { prefixes: ["@/App", "@/AppRouter"], target: "app shell" },
];

const FEATURE_BOUNDARY_LEGACY_ROOTS = [
  {
    path: "src/components",
    allowed: ["src/components/ui"],
    target: "legacy component",
  },
  { path: "src/hooks", allowed: [], target: "legacy hook" },
  { path: "src/stores", allowed: [], target: "store" },
  { path: "src/pages", allowed: [], target: "page" },
  { path: "src/router", allowed: [], target: "router" },
];

function normalizePath(path) {
  return path.replace(/\\/g, "/");
}

function startsWithPath(path, prefix) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function startsWithSpecifier(source, prefix) {
  if (!prefix.endsWith("/")) return source === prefix;
  return source === prefix.slice(0, -1) || source.startsWith(prefix);
}

function classifyFeatureLegacyImport(source, filename, cwd) {
  if (typeof source !== "string") return null;
  if (
    FEATURE_BOUNDARY_ALLOWED_PREFIXES.some((prefix) =>
      startsWithSpecifier(source, prefix),
    )
  ) {
    return null;
  }
  for (const { prefixes, target } of FEATURE_BOUNDARY_LEGACY_ALIASES) {
    if (prefixes.some((prefix) => startsWithSpecifier(source, prefix))) {
      return target;
    }
  }
  if (!source.startsWith(".") || filename.startsWith("<")) return null;

  const resolved = normalizePath(resolve(dirname(filename), source));
  for (const root of FEATURE_BOUNDARY_LEGACY_ROOTS) {
    const rootPath = normalizePath(resolve(cwd, root.path));
    if (!startsWithPath(resolved, rootPath)) continue;
    const allowed = root.allowed.some((allowedPath) =>
      startsWithPath(resolved, normalizePath(resolve(cwd, allowedPath))),
    );
    if (!allowed) return root.target;
  }
  return null;
}

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
  const files = [resolve(cwd, "src/themes.css"), resolve(cwd, "src/index.css")];
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
    "no-direct-zustand-setstate": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow production code from writing Zustand stores through direct useXStore.setState calls.",
        },
        schema: [],
        messages: {
          direct:
            "Do not call {{store}}.setState in production component/hook/runtime code. Express the state transition as a store action instead.",
        },
      },
      create(context) {
        function getPropertyName(node) {
          if (node.type === "Identifier") return node.name;
          if (node.type === "Literal" && typeof node.value === "string") {
            return node.value;
          }
          return null;
        }

        return {
          MemberExpression(node) {
            if (getPropertyName(node.property) !== "setState") return;
            const object = node.object;
            if (object.type !== "Identifier") return;
            if (!/^use[A-Z].*Store$/.test(object.name)) return;
            context.report({
              node,
              messageId: "direct",
              data: { store: object.name },
            });
          },
        };
      },
    },
    "no-tailwind-arbitrary-px": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow Tailwind arbitrary px values on size/spacing utilities. Add a token to @theme inline instead.",
        },
        schema: [],
        messages: {
          noPx: "Arbitrary pixel value '{{match}}' is not allowed on size/spacing utilities. Add a design token (e.g. --text-3xs, --spacing-dialog-md) to @theme inline and use the named class.",
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
    "no-feature-legacy-imports": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow new src/features modules from importing legacy app roots during staged frontend migration.",
        },
        schema: [],
        messages: {
          legacy:
            "src/features/** must not import {{target}} boundary '{{source}}'. Keep feature code feature-local, or depend on @lib, @/types, or @components/ui.",
        },
      },
      create(context) {
        function check(source, node) {
          const filename = context.filename ?? context.getFilename?.() ?? "";
          const target = classifyFeatureLegacyImport(
            source,
            filename,
            context.cwd,
          );
          if (!target) return;
          context.report({
            node,
            messageId: "legacy",
            data: { target, source },
          });
        }

        return {
          ImportDeclaration(node) {
            check(node.source?.value, node.source);
          },
          ExportAllDeclaration(node) {
            check(node.source?.value, node.source);
          },
          ExportNamedDeclaration(node) {
            check(node.source?.value, node.source);
          },
          ImportExpression(node) {
            if (node.source?.type !== "Literal") return;
            check(node.source.value, node.source);
          },
        };
      },
    },
  },
};

// no-restricted-syntax selector 상수. flat config 에서 no-restricted-syntax 는
// 파일당 마지막으로 매칭되는 블록의 배열이 전체를 override 한다 (병합 아님).
// 이 규칙을 재정의하는 모든 블록이 그 file-scope 에 필요한 selector 를 additive
// 하게 재나열해야 하므로, selector 를 상수로 뽑아 블록 간 drift 를 막는다.
// (과거: cell-domain 블록이 JSON.stringify 하나로 덮어 datagrid/document 등에서
//  i18n·native-select·getState 가드가 조용히 사라졌던 회귀 — #1074 리뷰 B1.)
const NATIVE_SELECT_GUARD = {
  selector: "JSXOpeningElement[name.name='select']",
  message:
    "Use <Select> from @components/ui/select instead of native <select>.",
};
const STORE_GETSTATE_GUARD = {
  selector:
    "CallExpression[callee.type='MemberExpression'][callee.property.name='getState']",
  message:
    "컴포넌트/페이지 .tsx에서 store.getState() 직접 호출 금지. selector hook (useStore(s => s.x)) 또는 src/hooks/* 의 lifecycle hook으로 분리.",
};
// #1074 i18n — 하드코딩 UI 문자열 가드. JSXText 자식 텍스트 + user-facing 속성만
// 대상이고 className / data-* / 기술 토큰은 selector 밖이라 자동 exempt. 이미
// 번역된 surface (t() 사용) 는 리터럴이 없어 통과한다.
const I18N_HARDCODED_STRING_GUARDS = [
  {
    // 자식 텍스트에 알파벳 2자 이상 = 번역 후보. 순수 공백/숫자/기호 JSXText
    // (`{value} ms` 의 공백 등) 는 매칭되지 않는다.
    selector: "JSXText[value=/[A-Za-z]{2,}/]",
    message:
      "하드코딩 UI 문자열 금지 (#1074 i18n). useTranslation 의 t() 로 번역 키를 쓰세요. 코드/식별자/기술 토큰 등 번역 불가면 사유 코멘트와 함께 `eslint-disable-next-line no-restricted-syntax`.",
  },
  {
    selector:
      "JSXAttribute[name.name=/^(title|placeholder|alt|label|aria-label)$/] > Literal[value=/[A-Za-z]{2,}/]",
    message:
      "하드코딩 UI 속성 문자열 금지 (#1074 i18n). title/placeholder/alt/label/aria-label 은 t() 로 번역하세요. 기술 예시값이면 사유 코멘트와 함께 `eslint-disable-next-line no-restricted-syntax`.",
  },
];
const CELL_JSON_STRINGIFY_GUARD = {
  selector:
    "CallExpression[callee.type='MemberExpression'][callee.object.name='JSON'][callee.property.name='stringify']",
  message:
    "Cell-domain code 에서는 `JSON.stringify` 대신 `@lib/jsonCell` 의 `safeStringifyCell` 사용. raw `JSON.stringify` 는 BigInt 만나면 throw, Decimal 만나면 `{}` 로 떨어져 DataGrid mount-time freeze 발생 (Sprint 305).",
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
      "worktrees/**",
      // wasm-pack generated JS glue + d.ts. Nothing asserts that these ignores
      // do not hide source max-lines debt — keep the list narrow.
      ...GENERATED_WASM_ESLINT_IGNORES,
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
      // 2026-05-17 — `console.*` 직접 호출 금지. 진단/임시 log 가 working
      // tree 에 남거나 commit 으로 새는 path 차단. `@lib/logger` 경유 —
      // logger 는 `import.meta.env.DEV` gate 라 production silent.
      // 예외: logger 본체 + bootInstrumentation 의 구조화 boot summary.
      "no-console": "error",
      // God file 700 lines 임계. warn 으로 시작 —
      // 기존 god file (≥700줄) 이 lint 실패 폭증하지 않도록. 향후 사이트별
      // 정리 끝나면 error 승격 검토. 룰 본문 + 시퀀스:
      // memory/engineering/conventions/refactoring/god-file/memory.md
      "max-lines": [
        "warn",
        { max: 700, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "**/*.test.{ts,tsx}",
      "**/__tests__/**",
      "src/stores/**",
      "src/test-setup.ts",
      "src/test-utils.{ts,tsx}",
      "src/test-utils/**",
      "src/lib/zustand-ipc-bridge.ts",
    ],
    rules: {
      "tv-local/no-direct-zustand-setstate": "error",
    },
  },
  {
    files: ["src/features/**/*.{ts,tsx}"],
    ignores: [
      "**/*.test.{ts,tsx}",
      "**/__tests__/**",
      "src/features/catalog/index.ts",
      "src/features/workspace/index.ts",
    ],
    rules: {
      "tv-local/no-feature-legacy-imports": "error",
    },
  },
  {
    files: [
      "src/lib/logger.ts",
      "src/lib/perf/bootInstrumentation.ts",
      // Test files — `console.*` 은 mock spy 대상 또는 stderr 검증.
      "**/*.test.{ts,tsx}",
      // e2e / wdio — 러너 출력은 console 이 정상.
      "e2e/**/*.{ts,tsx}",
      "wdio*.ts",
    ],
    rules: {
      "no-console": "off",
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
      // 하드코딩 UI 문자열 가드(#1074) 는 위 selector 상수로 additive 조합.
      // 잔여 하드코딩이 밀집한 surface (query/schema/search/structure/
      // connection-forms) 는 아래 phased-exempt 블록에서 i18n selector 만 뺀다
      // — Slice 2 (#1074) 잔여 번역 backlog.
      "no-restricted-syntax": [
        "error",
        NATIVE_SELECT_GUARD,
        STORE_GETSTATE_GUARD,
        ...I18N_HARDCODED_STRING_GUARDS,
      ],
    },
  },
  // #1074 i18n phased rollout — 잔여 하드코딩이 밀집한 surface 는 위 JSXText/
  // 속성 가드를 아직 끈다 (기존 select / getState 규칙은 유지). 이 목록은 Slice 2
  // (#1074) 전량 번역 시 하나씩 제거되며, 제거 = 해당 surface 가드 편입.
  // no-restricted-syntax 는 flat config 에서 배열 전체가 override 되므로
  // NATIVE_SELECT_GUARD / STORE_GETSTATE_GUARD 를 재나열해 두 규칙을 보존하되
  // i18n selector 만 의도적으로 뺀다.
  {
    files: [
      "src/components/query/**/*.tsx",
      "src/components/schema/**/*.tsx",
      "src/components/search/**/*.tsx",
      "src/components/structure/**/*.tsx",
      "src/features/connection/components/forms/**/*.tsx",
    ],
    ignores: ["**/*.test.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        NATIVE_SELECT_GUARD,
        STORE_GETSTATE_GUARD,
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
  // cell-domain .tsx (컴포넌트) — 과거 이 surface 는 JSON.stringify selector
  // 하나만 담은 블록이 override 해 native-select / getState / i18n 가드를 조용히
  // 무력화했다 (#1074 리뷰 B1). native-select / getState 는 상수로 additive
  // 재나열해 복구하고 JSON.stringify 는 유지한다.
  //
  // i18n JSXText/속성 가드는 이 surface 에서 의도적으로 뺀다: datagrid/document/
  // shared cell-domain 은 잔여 하드코딩(헤더 `... — {db}.{coll}`, 라벨 Level/
  // Action/Index, plural item{s}, placeholder 힌트)이 밀집해 query/schema/search/
  // structure/connection-forms 와 같은 Slice 2 (#1074) 전량 번역 backlog 다.
  // 우연한 무력화가 아니라 명시적 phased-exempt.
  {
    files: [
      "src/components/datagrid/**/*.tsx",
      "src/components/document/**/*.tsx",
      "src/components/shared/QuickLookPanel/**/*.tsx",
      "src/components/shared/BsonTreeViewer.tsx",
    ],
    ignores: ["**/*.test.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        NATIVE_SELECT_GUARD,
        STORE_GETSTATE_GUARD,
        CELL_JSON_STRINGIFY_GUARD,
      ],
    },
  },
  // cell-domain .ts (컴포넌트 아닌 로직/hook/유틸) — JSON.stringify 만 대상.
  // native-select / i18n 은 JSX selector 라 .ts 에 매칭되지 않고, getState 금지는
  // 컴포넌트 .tsx 전용 규칙이라 .ts hook(예: useDataGridEditPendingState.ts)의
  // 정당한 store.getState() 호출을 잡으면 안 되므로 여기서는 뺀다.
  {
    files: [
      "src/components/datagrid/**/*.ts",
      "src/components/document/**/*.ts",
      "src/components/shared/QuickLookPanel/**/*.ts",
      "src/lib/format.ts",
      "src/lib/mongo/mqlGenerator.ts",
      "src/lib/sql/rawQuerySqlBuilder.ts",
    ],
    ignores: ["**/*.test.ts", "src/lib/jsonCell.ts"],
    rules: {
      "no-restricted-syntax": ["error", CELL_JSON_STRINGIFY_GUARD],
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
  // #1365 (2026-07-06) — 컴포넌트/pages/hooks 에서 @tauri-apps/api 직접 import
  // 금지. IPC 경계 규율(src/lib/tauri·src/lib/api·src/lib/events 계약 레이어
  // 경유)을 관례가 아닌 lint 로 고정한다. 계약 레이어는 이 scope 밖이므로 자동
  // 허용. type-only import(예: UnlistenFn)는 빌드 시 사라져 런타임 IPC 우회를
  // 만들지 않으므로 allowTypeImports 로 허용.
  {
    files: [
      "src/components/**/*.{ts,tsx}",
      "src/pages/**/*.{ts,tsx}",
      "src/hooks/**/*.{ts,tsx}",
    ],
    ignores: ["**/*.test.{ts,tsx}", "**/__tests__/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@tauri-apps/api", "@tauri-apps/api/*"],
              message:
                "컴포넌트/pages/hooks 에서 @tauri-apps/api 직접 import 금지. IPC 호출은 src/lib/tauri/* (또는 src/lib/api, src/lib/events) 계약 레이어 경유.",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
  // #1403 (2026-07-16) — `@deprecated` JSDoc 심볼 사용을 pre-push + CI 에서
  // 자동 차단. deprecated API 는 에디터 취소선으로만 보이고 tsc/CI 어디서도
  // 안 잡히다가, upstream 이 심볼을 실제 제거하는 순간 한꺼번에 tsc 에러로
  // 터진다. type-aware 룰이므로 projectService(typed lint) 를 켠다. scope 는
  // tsconfig.json 의 include: ["src"] 에 맞춰 src 로 한정 — e2e/wdio 등
  // tsconfig 밖 파일에 projectService 를 걸면 "not found by the project
  // service" 로 실패한다.
  {
    files: ["src/**/*.{ts,tsx}"],
    // projectService turns a path that is not on disk but matches tsconfig's
    // `include: ["src"]` into a fatal parse error, so `src/features/demo/**`
    // stays usable as a scratch path. Drop this if a real `src/features/demo`
    // feature is ever added.
    ignores: ["src/features/demo/**"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-deprecated": "error",
    },
  },
);
