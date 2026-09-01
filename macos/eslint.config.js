import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default [
  {
    ignores: [
      "backend/build/**",
      "backend/dist/**",
      "backend/.venv/**",
      "dist/**",
      "node_modules/**",
      "public/resume-editor/**",
      "release/**",
      "source-references/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: globals.browser,
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^[A-Z_]+$" }],
      "react/jsx-uses-vars": "error",
      "react-hooks/set-state-in-effect": "off",
      "react-refresh/only-export-components": "off",
    },
    settings: { react: { version: "detect" } },
  },
  {
    files: ["electron/**/*.{js,mjs,cjs}", "scripts/**/*.{js,mjs,cjs}", "tests/**/*.{js,mjs,cjs}", "*.config.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^[A-Z_]+$" }],
    },
  },
];
