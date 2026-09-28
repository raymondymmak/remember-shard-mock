import { defineConfig } from "vite";

// Project page: https://<user>.github.io/remember-shard-mock/
// Local `npm run dev` stays at /. The Pages workflow sets GITHUB_PAGES=true.
const repo = process.env.GITHUB_REPOSITORY?.split("/")[1] || "remember-shard-mock";
const base = process.env.GITHUB_PAGES === "true" ? `/${repo}/` : "/";

export default defineConfig({
  base,
  // Sentence and photograph models are fetched after first paint. Keep the
  // library out of the eager dep scan so the letter bundle does not wait.
  optimizeDeps: {
    exclude: ["@xenova/transformers"],
  },
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
});
