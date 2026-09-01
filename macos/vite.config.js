import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Electron loads the production build through file://, so every emitted
  // asset must stay relative to dist/index.html instead of resolving from /.
  base: "./",
  plugins: [react()],
});
