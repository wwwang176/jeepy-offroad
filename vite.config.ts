import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  // GitHub Pages project site: https://wwwang176.github.io/jeepy-offroad/
  base: "/jeepy-offroad/",
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: { port: 5173 },
});
