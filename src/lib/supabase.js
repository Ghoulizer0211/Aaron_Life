import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// supabase is null when env vars aren't set — app falls back to Express API
export const supabase = (url && key) ? createClient(url, key) : null
