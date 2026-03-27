import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return res.json([])
  const supabase = createClient(url, key)

  try {
    const { data, error } = await supabase.from('bank_accounts').select('*').order('institution_name')
    if (error) throw error
    res.json(data || [])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
