import { defineConfig } from "vitest/config";

/** Production integration suite -- see tests/db/README.md.
 *
 *  Deliberately a separate config from vite.config.ts:
 *   - environment must be `node`, not the app's `jsdom` (under jsdom
 *     import.meta.url is an http: URL and file resolution throws)
 *   - no setupFiles: tests/setup.ts wires jsdom/testing-library, which this
 *     suite neither needs nor can load
 *   - excluded from the default `npm test` so a contributor without database
 *     credentials still gets a green run
 *
 *  Timeouts are generous because every probe is a real round trip to Supabase.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/db/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
