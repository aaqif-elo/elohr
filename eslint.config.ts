import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import solid from "eslint-plugin-solid";
import tseslint from "typescript-eslint";
import solidTypescriptConfig from "eslint-plugin-solid/configs/typescript";

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.strict,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      // @ts-expect-error eslint-plugin-solid's plugin typing lags the current ESLint plugin type surface.
      solid,
    },
    rules: {
      ...solidTypescriptConfig.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "no-console": "off",
    },
  },
  {
    ignores: [
      "node_modules/",
      ".output/",
      ".vinxi/",
      "dist/",
      "app.config.timestamp_*.js",
    ],
  }
);
