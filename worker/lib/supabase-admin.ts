import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface SupabaseAdminEnv {
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
}

export function createSupabaseAdminClient(env: SupabaseAdminEnv): SupabaseClient {
  const url = env.SUPABASE_URL;
  const secretKey = env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required");
  }

  return createClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  });
}

