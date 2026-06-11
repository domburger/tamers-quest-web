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
    // Keep the size warning just above the legitimate Phaser baseline so it only fires on a REAL
    // regression (e.g. a heavy new dependency), not on the expected Phaser bulk every build.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Vendor code-split: Phaser (the render engine — the bulk of the bundle) gets its own
        // content-hashed chunk. Its version is stable, so returning players keep it CACHED across
        // our frequent deploys; only the much smaller app chunk re-downloads when game code changes
        // (previously every deploy re-shipped the whole ~426 kB-gzip bundle). Pure build-time split,
        // no source/behaviour change — Phaser is a leaf dep (the app imports it, never the reverse).
        // Rolldown (Vite 8) needs the function form; match Phaser by its node_modules path.
        manualChunks(id) {
          if (id.includes("node_modules/phaser")) return "phaser";
        },
      },
    },
  },
});
