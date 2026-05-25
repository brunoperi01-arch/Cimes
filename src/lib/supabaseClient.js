import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

const hasValidSupabaseConfig =
  Boolean(url) &&
  Boolean(key) &&
  url !== 'https://your-project.supabase.co' &&
  key !== 'your-anon-key'

if (!hasValidSupabaseConfig) {
  console.warn(
    'Supabase non configuré : ajoute VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY dans Vercel.'
  )
}

export const supabase = hasValidSupabaseConfig
  ? createClient(url, key, {
      auth: {
        persistSession: true,
        storageKey: 'benchmark-ete-session',
        autoRefreshToken: true
      }
    })
  : null

export const supabaseReady = hasValidSupabaseConfig
