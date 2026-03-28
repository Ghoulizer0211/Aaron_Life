import { getSupabase } from '../_lib/supabase.js'

export default async function handler(req, res) {
  const supabase = getSupabase()
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured' })

  if (req.method === 'GET') {
    const limit = Math.min(parseInt(req.query.limit) || 60, 200)
    const { data, error } = await supabase
      .from('gym_workouts').select('*').order('date', { ascending: false }).limit(limit)
    if (error) return res.status(500).json({ error: error.message })
    return res.json(data || [])
  }

  if (req.method === 'POST') {
    const { date, type, duration_minutes, intensity, notes, exercises } = req.body || {}
    if (!date || !type) return res.status(400).json({ error: 'date and type required' })
    const { data, error } = await supabase
      .from('gym_workouts')
      .insert({ date, type, duration_minutes: duration_minutes || null, intensity, notes: notes || null, exercises: exercises || [] })
      .select().single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json(data)
  }

  res.status(405).end()
}
