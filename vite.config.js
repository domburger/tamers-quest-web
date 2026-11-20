import { defineConfig } from "vite";

export default defineConfig({
  server: {
    open: false,
    // Dev: API calls go to the game server so local maps match prod.
    proxy: {
      "/api": "http://localhost:8080",
      "/admin": "http://localhost:8080",
    },
  },
  build: { outDir: "dist" },
});
