import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Used ONLY for the Google OAuth redirect/callback hop — the rest of the
// app talks to the FastAPI backend, never Supabase directly. The anon key
// is safe to expose in the browser (it's what RLS is designed for).
//
// Lazily created on first use (inside a click handler / useEffect — both
// browser-only) rather than at module load time. createClient() eagerly
// constructs a Realtime WebSocket client, which crashes this app's SSR pass
// on Node 20 (no native WebSocket support) if it runs at import time.
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  if (!supabaseUrl || !supabaseAnonKey) {
    // eslint-disable-next-line no-console
    console.warn(
      "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set — Google sign-in will not work.",
    );
  }

  client = createClient(supabaseUrl ?? "", supabaseAnonKey ?? "", {
    auth: {
      // This client only ever completes the one-time OAuth redirect
      // handshake (signInWithOAuth + a single getSession() read right
      // after). From then on, the app's own backend/store (mirracle.auth,
      // POST /auth/refresh) owns session lifecycle exclusively — if this
      // client were also allowed to persist its own session and
      // auto-refresh in the background, it would silently rotate the same
      // (single-use) refresh token behind the app's back, invalidating
      // whichever copy the app itself tries to use next.
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: true,
    },
  });
  return client;
}
