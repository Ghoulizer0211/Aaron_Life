import { ouraFetch } from '../_lib/oura.js'
import { getSupabase } from '../_lib/supabase.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const { token } = req.body || {}
  if (!token?.trim()) return res.status(400).json({ error: 'Token required' })
  try {
    await ouraFetch('/v2/usercollection/personal_info', token.trim())
    const supabase = getSupabase()
    if (supabase) {
      await supabase.from('settings').upsert({ key: 'oura_token', value: token.trim() })
    }
    res.json({ success: true })
  } catch {
    res.status(401).json({ error: 'Invalid token — double-check your Personal Access Token' })
  }
}
