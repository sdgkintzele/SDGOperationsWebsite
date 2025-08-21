// src/lib/supabaseClient.js
import { createClient } from "@supabase/supabase-js";

// Vite exposes only variables that start with VITE_
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
  throw new Error("Missing Supabase environment variables");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// Storage bucket your app uses for evidence uploads
export const EVIDENCE_BUCKET =
  import.meta.env.VITE_PUBLIC_BUCKET_EVIDENCE ?? "evidence";

// Keep evidence paths consistent
export const evidenceKey = (violationId, filename) =>
  `violation_${violationId}/${filename}`;
