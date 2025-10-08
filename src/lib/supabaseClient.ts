"use client";

import { createBrowserClient } from "@supabase/ssr";

// Public values (safe to expose): fallback if env vars are missing
const DEFAULT_SUPABASE_URL = "https://iiolvvdnzrfcffudwocp.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlpb2x2dmRuenJmY2ZmdWR3b2NwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc1MjE4MDAsImV4cCI6MjA3MzA5NzgwMH0.2-e8Scn26fqsR11h-g4avH8MWybwLTtcf3fCN9qAgVw";

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

export function getBrowserSupabaseClient() {
	if (browserClient) return browserClient;
	const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined) || DEFAULT_SUPABASE_URL;
	const supabaseKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string | undefined) || DEFAULT_SUPABASE_ANON_KEY;
	browserClient = createBrowserClient(supabaseUrl, supabaseKey);
	return browserClient;
}
