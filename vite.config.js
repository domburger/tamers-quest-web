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
    // The bundle is ~1.4 MB — Phaser (the render engine) is the bulk and is expected, so the
    // default 500 kB warning fired on EVERY build: constant noise that would mask a REAL future
    // size regression. Raise the threshold just above the legitimate Phaser baseline so the warning
    // only fires when the bundle genuinely grows beyond it (e.g. a heavy new dependency creeps in).
    // This is build-time-only — it does NOT change the output. A vendor code-split (Phaser → its own
    // content-hashed, cacheable chunk) is the real load-perf fix if/when that's prioritized.
    chunkSizeWarningLimit: 1500,
  },
});
