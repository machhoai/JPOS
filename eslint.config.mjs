import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.tsx"],
    ignores: ["src/components/ui/DateInput.tsx"],
    rules: {
      "no-restricted-syntax": ["error", {
        selector: 'JSXOpeningElement[name.name="input"] > JSXAttribute[name.name="type"][value.value=/^(date|datetime-local)$/]',
        message: "Use the shared DateInput component so dates always display as dd/mm/yyyy.",
      }, {
        selector: 'CallExpression[callee.property.name="toLocaleDateString"]',
        message: "Use formatDate from @/lib/utils/dateFormat for dd/mm/yyyy display.",
      }, {
        selector: 'CallExpression[callee.property.name="toLocaleString"][callee.object.type="NewExpression"][callee.object.callee.name="Date"]',
        message: "Use formatDateTime from @/lib/utils/dateFormat for consistent date display.",
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "functions/lib/**",
    "src-tauri/target/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
