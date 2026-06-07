import { defineConfig } from "vite";

export default defineConfig({
  server: {
    // Do NOT auto-open a browser tab. Multiple QA/agent `/loop` sessions start the
    // dev server headlessly (Playwright `tools/*.mjs`); `open: true` was popping a
    // localhost tab in the user's desktop browser on every start. Open it manually
    // (http://localhost:5173) when you actually want the preview.
    open: false,
  },
  build: {
    outDir: "dist",
  },
});
