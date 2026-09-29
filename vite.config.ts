import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths so the site works under https://<user>.github.io/<repo>/.
  base: "./",
  // data/ holds vacancies.json written by the sync; it is served and copied into dist/ as-is.
  publicDir: "data",
  build: { outDir: "dist", emptyOutDir: true },
});
