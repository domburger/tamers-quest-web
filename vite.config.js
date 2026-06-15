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
    // TQ-298: Phaser (the old render engine) was removed, so the manual phaser vendor-chunk split is
    // gone too — the app is now a single lean bundle (the raw-canvas2D backend is all hand-rolled, no
    // heavy render-engine dep). The default warning limit is fine without the Phaser bulk.
  },
});
