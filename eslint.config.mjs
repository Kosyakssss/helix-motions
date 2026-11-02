import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  {
    ignores: [
      "!node_modules/",
      "node_modules/*",
      "!node_modules/helix-cm6/",
      "node_modules/helix-cm6/*",
      "!node_modules/helix-cm6/src/",
      "test/**",
      "test-vault/**",
      "dist/**",
      "build.ts",
      "eslint.config.mjs",
    ],
  },
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
  {
    files: ["node_modules/helix-cm6/src/**"],
    rules: {
      "obsidianmd/prefer-create-el": "off",
    },
  },
]);
