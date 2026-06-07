// LS-6: a minimal lint gate focused on `no-undef` — it catches the class of bug
// that took the site down once (an undefined `JOY` reference crashed combat). It
// is intentionally NOT the full recommended ruleset (style is out of scope here);
// just undefined-variable detection across the client + server + tools.
//
// Globals are the union of browser + node + serviceworker so `no-undef` never
// false-positives on a legitimate platform global (the rule only flags genuine
// typos / undeclared names). Run: `npm run lint`.
import globals from "globals";

export default [
  { ignores: ["dist/", "node_modules/", ".vite/", ".wiki-clone/", ".screenshots/"] },
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
