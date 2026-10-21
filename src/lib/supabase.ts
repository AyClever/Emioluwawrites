import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Read Supabase credentials from Vite environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(
  supabaseUrl && 
  supabaseAnonKey && 
  !supabaseUrl.includes('placeholder.supabase.co')
);

// Instantiate client with provided environment variables (or placeholder client)
export const supabase: SupabaseClient = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    }
  }
);

let cachedHealth: boolean | null = null;
let lastHealthCheck = 0;

/**
 * Non-blocking check to verify if the configured Supabase endpoint is reachable.
 * Caches the result for 45 seconds to minimize network overhead.
 */
export async function isSupabaseReachable(): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  const now = Date.now();
  if (cachedHealth !== null && (now - lastHealthCheck < 45000)) {
    return cachedHealth;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${supabaseUrl}/rest/v1/`, {
      method: 'GET',
      headers: { apikey: supabaseAnonKey },
      signal: controller.signal
    });
    clearTimeout(timeout);
    cachedHealth = res.status < 500;
  } catch {
    cachedHealth = false;
  }

  lastHealthCheck = now;
  return cachedHealth;
}
