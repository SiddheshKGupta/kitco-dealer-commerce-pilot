import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === "test" ? [] : [cloudflare()])],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./tests/setup.ts",
    // tests/db/** runs against the REAL Supabase database: it needs node (not
    // jsdom, where import.meta.url is an http: URL) and live credentials. It is
    // opt-in via `npm run test:db` -- see vitest.db.config.ts.
    exclude: ["**/node_modules/**", "**/dist/**", "tests/db/**"]
  }
}));
