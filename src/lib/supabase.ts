import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface BrowserSupabaseEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

export function createBrowserSupabaseClient(
  env: BrowserSupabaseEnv = import.meta.env as BrowserSupabaseEnv
): SupabaseClient {
  const url = env.VITE_SUPABASE_URL;
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are required"
    );
  }

  return createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true
    }
  });
}
