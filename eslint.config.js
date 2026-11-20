// Only no-undef: catches undefined references that would crash the live game.
import globals from "globals";

export default [
  { ignores: ["dist/", "node_modules/", ".vite/",".screenshots/", ".claude/"] },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node, ...globals.serviceworker },
    },
    rules: { "no-undef": "error" },
  },
];
