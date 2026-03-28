import { getSupabase } from './supabase.js'

const OURA_BASE = 'https://api.ouraring.com'

export async function getOuraToken() {
  // 1. Env var (set in Vercel dashboard)
  if (process.env.VITE_OURA_ACCESS_TOKEN) return process.env.VITE_OURA_ACCESS_TOKEN
  // 2. Supabase settings table (saved when user connected via UI)
  const supabase = getSupabase()
  if (supabase) {
    try {
      const { data } = await supabase.from('settings').select('value').eq('key', 'oura_token').single()
      if (data?.value) return data.value
    } catch { /* ignore */ }
  }
  return null
}

export async function ouraFetch(path, token) {
  const res = await fetch(`${OURA_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Oura API ${res.status}`)
  }
  return res.json()
}

export const secToHrs = (s) => Math.round((s || 0) / 360) / 10
