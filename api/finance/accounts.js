import { getSupabase } from '../_lib/supabase.js'

export default async function handler(req, res) {
  const supabase = getSupabase()
  if (!supabase) return res.json([])

  try {
    const { data, error } = await supabase
      .from('bank_accounts')
      .select('*')
      .order('institution_name')
    if (error) throw error
    res.json(data || [])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
