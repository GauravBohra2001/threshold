import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";

// eslint-config-next already registers the jsx-a11y plugin, so we enable its
// recommended ruleset by name (without re-registering the plugin, which would
// error). This makes the WCAG 2.2 AA JSX baseline explicit in our config
// (Req 23).
const jsxA11yRecommendedRules = jsxA11y.flatConfigs.recommended.rules;

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    name: "threshold/jsx-a11y",
    files: ["**/*.{js,jsx,ts,tsx,mjs,cjs}"],
    rules: jsxA11yRecommendedRules,
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
