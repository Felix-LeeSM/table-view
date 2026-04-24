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
  { ignores: ["dist", "src-tauri", "coverage"] },
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
);
