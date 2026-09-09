import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Read Supabase credentials strictly from Vite environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  console.error(
    'Supabase Configuration Missing: VITE_SUPABASE_URL and/or VITE_SUPABASE_ANON_KEY are not set in the environment variables. Please check your environment settings.'
  );
}

// Instantiate client with provided environment variables (or placeholder for client creation without fallback credentials)
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
