import { getSupabase } from './_lib/supabase.js'

export default async function handler(req, res) {
  const parts = req.url.split('?')[0].split('/').filter(Boolean)
  // ['api', 'gym', sub, p1?, p2?]
  const sub = parts[2]
  const p1  = parts[3]
  const p2  = parts[4]

  const supabase = getSupabase()
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured' })

  // ── PLANS ──────────────────────────────────────────────────────────────────

  // GET /api/gym/plans
  if (sub === 'plans' && !p1 && req.method === 'GET') {
    const { data: plans, error } = await supabase
      .from('workout_plans').select('*').order('created_at', { ascending: true })
    if (error) return res.status(500).json({ error: error.message })
    const planIds = (plans || []).map(p => p.id)
    if (!planIds.length) return res.json([])
    const { data: days } = await supabase
      .from('workout_days').select('*').in('plan_id', planIds).order('day_order')
    const dayIds = (days || []).map(d => d.id)
    const { data: exercises } = dayIds.length
      ? await supabase.from('workout_exercises').select('*').in('day_id', dayIds).order('"order"')
      : { data: [] }
    const exByDay = {}
    for (const ex of (exercises || [])) {
      if (!exByDay[ex.day_id]) exByDay[ex.day_id] = []
      exByDay[ex.day_id].push(ex)
    }
    const daysByPlan = {}
    for (const d of (days || [])) {
      if (!daysByPlan[d.plan_id]) daysByPlan[d.plan_id] = []
      daysByPlan[d.plan_id].push({ ...d, exercises: exByDay[d.id] || [] })
    }
    return res.json(plans.map(p => ({ ...p, days: daysByPlan[p.id] || [] })))
  }

  // POST /api/gym/plans
  if (sub === 'plans' && !p1 && req.method === 'POST') {
    const { name } = req.body || {}
    if (!name) return res.status(400).json({ error: 'name required' })
    const { data, error } = await supabase.from('workout_plans').insert({ name }).select().single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ...data, days: [] })
  }

  // PATCH /api/gym/plans/:id
  if (sub === 'plans' && p1 && !p2 && req.method === 'PATCH') {
    const { name, is_active } = req.body || {}
    const update = {}
    if (name !== undefined) update.name = name
    if (is_active !== undefined) {
      if (is_active) await supabase.from('workout_plans').update({ is_active: false }).neq('id', p1)
      update.is_active = is_active
    }
    const { error } = await supabase.from('workout_plans').update(update).eq('id', p1)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ success: true })
  }

  // DELETE /api/gym/plans/:id
  if (sub === 'plans' && p1 && !p2 && req.method === 'DELETE') {
    const { error } = await supabase.from('workout_plans').delete().eq('id', p1)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ success: true })
  }

  // POST /api/gym/plans/:planId/days
  if (sub === 'plans' && p1 && p2 === 'days' && req.method === 'POST') {
    const { day_name, day_order } = req.body || {}
    if (!day_name) return res.status(400).json({ error: 'day_name required' })
    const { data, error } = await supabase.from('workout_days')
      .insert({ plan_id: p1, day_name, day_order: day_order || 0 }).select().single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ...data, exercises: [] })
  }

  // ── DAYS ────────────────────────────────────────────────────────────────────

  // PATCH /api/gym/days/:id
  if (sub === 'days' && p1 && !p2 && req.method === 'PATCH') {
    const { day_name, day_order } = req.body || {}
    const update = {}
    if (day_name !== undefined) update.day_name = day_name
    if (day_order !== undefined) update.day_order = day_order
    const { error } = await supabase.from('workout_days').update(update).eq('id', p1)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ success: true })
  }

  // DELETE /api/gym/days/:id
  if (sub === 'days' && p1 && !p2 && req.method === 'DELETE') {
    const { error } = await supabase.from('workout_days').delete().eq('id', p1)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ success: true })
  }

  // POST /api/gym/days/:dayId/exercises
  if (sub === 'days' && p1 && p2 === 'exercises' && req.method === 'POST') {
    const { exercise_name, target_sets, target_reps, notes, order } = req.body || {}
    if (!exercise_name) return res.status(400).json({ error: 'exercise_name required' })
    const { data, error } = await supabase.from('workout_exercises')
      .insert({ day_id: p1, exercise_name, target_sets: target_sets || null, target_reps: target_reps || null, notes: notes || null, order: order || 0 })
      .select().single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json(data)
  }

  // ── EXERCISES ───────────────────────────────────────────────────────────────

  // PATCH /api/gym/exercises/:id
  if (sub === 'exercises' && p1 && req.method === 'PATCH') {
    const { exercise_name, target_sets, target_reps, notes, order } = req.body || {}
    const update = {}
    if (exercise_name !== undefined) update.exercise_name = exercise_name
    if (target_sets !== undefined) update.target_sets = target_sets
    if (target_reps !== undefined) update.target_reps = target_reps
    if (notes !== undefined) update.notes = notes
    if (order !== undefined) update.order = order
    const { error } = await supabase.from('workout_exercises').update(update).eq('id', p1)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ success: true })
  }

  // DELETE /api/gym/exercises/:id
  if (sub === 'exercises' && p1 && req.method === 'DELETE') {
    const { error } = await supabase.from('workout_exercises').delete().eq('id', p1)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ success: true })
  }

  // ── LOGS ────────────────────────────────────────────────────────────────────

  // GET /api/gym/logs
  if (sub === 'logs' && !p1 && req.method === 'GET') {
    const limit = Math.min(parseInt(req.query.limit) || 30, 100)
    const { data: logs, error } = await supabase
      .from('workout_logs').select('*')
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) return res.status(500).json({ error: error.message })
    const logIds = (logs || []).map(l => l.id)
    if (!logIds.length) return res.json([])
    const { data: exLogs } = await supabase.from('exercise_logs').select('*').in('log_id', logIds)
    const exByLog = {}
    for (const el of (exLogs || [])) {
      if (!exByLog[el.log_id]) exByLog[el.log_id] = []
      exByLog[el.log_id].push(el)
    }
    return res.json(logs.map(l => ({ ...l, exercises: exByLog[l.id] || [] })))
  }

  // POST /api/gym/logs
  if (sub === 'logs' && !p1 && req.method === 'POST') {
    const { date, plan_id, plan_name, day_id, day_name, notes, exercises } = req.body || {}
    if (!date) return res.status(400).json({ error: 'date required' })
    const { data: log, error } = await supabase.from('workout_logs')
      .insert({ date, plan_id: plan_id || null, plan_name: plan_name || null, day_id: day_id || null, day_name: day_name || null, notes: notes || null })
      .select().single()
    if (error) return res.status(500).json({ error: error.message })
    if (exercises && exercises.length > 0) {
      const rows = exercises.map(ex => ({
        log_id: log.id,
        exercise_name: ex.exercise_name,
        sets_data: ex.sets_data || [],
        skipped: ex.skipped || false,
        notes: ex.notes || null,
      }))
      const { error: exErr } = await supabase.from('exercise_logs').insert(rows)
      if (exErr) return res.status(500).json({ error: exErr.message })
    }
    return res.json({ success: true, id: log.id })
  }

  // DELETE /api/gym/logs/:id
  if (sub === 'logs' && p1 && req.method === 'DELETE') {
    const { error } = await supabase.from('workout_logs').delete().eq('id', p1)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ success: true })
  }

  // ── LAST PERFORMANCE ────────────────────────────────────────────────────────

  // GET /api/gym/last-performance/:dayId
  if (sub === 'last-performance' && p1 && req.method === 'GET') {
    const { data: lastLog } = await supabase
      .from('workout_logs').select('id').eq('day_id', p1)
      .order('date', { ascending: false }).limit(1).maybeSingle()
    if (!lastLog) return res.json({})
    const { data: exLogs } = await supabase
      .from('exercise_logs').select('*').eq('log_id', lastLog.id).eq('skipped', false)
    const result = {}
    for (const el of (exLogs || [])) result[el.exercise_name] = el.sets_data || []
    return res.json(result)
  }

  res.status(405).end()
}
