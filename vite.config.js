import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Electron loads the production build through file://, so every emitted
  // asset must stay relative to dist/index.html instead of resolving from /.
  base: "./",
  plugins: [react()],
  // Only the desktop shell is a Vite entry; saved pages and audit HTML are not.
  optimizeDeps: {
    entries: ["index.html"],
    // The alias resolves to our compatibility module outside node_modules.
    // Bundle its full icon barrel once instead of requesting every icon in dev.
    include: ["lucide-react"],
  },
  server: {
    watch: {
      // Generated runtimes, Python environments and evidence can contain tens
      // of thousands of files. Watching them delays the first source response.
      ignored: [
        "**/backend/**", "**/.m1-*/**", "**/.codex-ui-study/**",
        "**/codex-ui-replica/**", "**/artifacts/**", "**/tmp/**",
        "**/test use/**", "**/source-references/**", "**/release/**",
        "**/build/**", "**/pytest-of-hesan/**",
      ],
    },
  },
  resolve: { alias: [{ find: /^lucide-react$/, replacement: fileURLToPath(new URL("./src/ui/lucide-compat.js", import.meta.url)) }] },
});
