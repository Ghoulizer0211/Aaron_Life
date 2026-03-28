import { getSupabase } from '../../_lib/supabase.js'

export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).end()
  const supabase = getSupabase()
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured' })

  const { id } = req.query
  const { error } = await supabase.from('gym_workouts').delete().eq('id', id)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ success: true })
}
