import { describe, expect, it } from "vitest";

import { createBrowserSupabaseClient } from "../../src/lib/supabase";
import { createSupabaseAdminClient } from "../../worker/lib/supabase-admin";

describe("Supabase clients", () => {
  it("rejects an incomplete browser configuration", () => {
    expect(() => createBrowserSupabaseClient({})).toThrow(
      "VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are required"
    );
  });

  it("creates a browser client from publishable configuration", () => {
    const client = createBrowserSupabaseClient({
      VITE_SUPABASE_URL: "https://example.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "publishable-test-key"
    });

    expect(client).toBeDefined();
  });

  it("rejects an incomplete server-only admin configuration", () => {
    expect(() => createSupabaseAdminClient({})).toThrow(
      "SUPABASE_URL and SUPABASE_SECRET_KEY are required"
    );
  });
});
