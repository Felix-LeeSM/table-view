import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

// Flags Tailwind arbitrary pixel values on size-class prefixes — the
// reason they exist is almost always a missing design token. Prefixes
// are limited to spacing/sizing utilities on purpose: shadcn/ui ships
// ring-[3px] / rounded-[2px] / translate-y-[calc(...)] which we don't
// want to break. Non-px units (rem, %, vh, calc) are allowed since the
// user-facing rule is "no raw pixels".
const ARBITRARY_PX =
  /\b(?:text|w|h|max-w|max-h|min-w|min-h|p[xytblrse]?|m[xytblrse]?|gap|top|bottom|left|right|inset)-\[-?\d+(?:\.\d+)?px\]/;

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
  },
};

export default tseslint.config(
  { ignores: ["dist", "src-tauri", "coverage", "cargo-target"] },
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
  // 2026-05-05: 결 2 — store 파일끼리 직접 import 금지. 한 store action에서
  // 다른 store를 만지면 의존 그래프가 양방향이 되고 React 외부에서 cross-store
  // coupling이 생긴다. 두 store를 묶는 책임은 React layer (src/hooks/*) 또는
  // 호출자 컴포넌트에 둔다. type-only import는 빌드 시 사라져 런타임 cross-
  // coupling을 만들지 않으므로 `allowTypeImports`로 허용.
  {
    files: ["src/stores/**/*.ts"],
    ignores: ["**/*.test.ts"],
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
