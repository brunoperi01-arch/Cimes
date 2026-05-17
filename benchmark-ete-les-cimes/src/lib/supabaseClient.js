import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key || url === 'https://your-project.supabase.co') {
  throw new Error('Variables manquantes : VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY\nCopiez .env.example → .env.local et remplissez vos clés Supabase.')
}

export const supabase = createClient(url, key, {
  auth: { persistSession: true, storageKey: 'benchmark-ete-session', autoRefreshToken: true },
})