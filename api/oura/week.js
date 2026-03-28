import { getOuraToken, ouraFetch, secToHrs } from '../_lib/oura.js'

export default async function handler(req, res) {
  const token = await getOuraToken()
  if (!token) return res.status(404).json({ error: 'Not connected' })

  const days  = Math.min(parseInt(req.query.days) || 30, 90)
  const end   = new Date().toISOString().slice(0, 10)
  const start = new Date(Date.now() - (days + 1) * 86400000).toISOString().slice(0, 10)

  try {
    const [readinessR, sleepR, activityR, sleepSessionsR] = await Promise.allSettled([
      ouraFetch(`/v2/usercollection/daily_readiness?start_date=${start}&end_date=${end}`, token),
      ouraFetch(`/v2/usercollection/daily_sleep?start_date=${start}&end_date=${end}`, token),
      ouraFetch(`/v2/usercollection/daily_activity?start_date=${start}&end_date=${end}`, token),
      ouraFetch(`/v2/usercollection/sleep?start_date=${start}&end_date=${end}`, token),
    ])

    const byDate = {}
    const ensure = d => { if (!byDate[d]) byDate[d] = { date: d } }

    if (readinessR.status === 'fulfilled')
      for (const r of readinessR.value.data || []) { ensure(r.day); byDate[r.day].readiness_score = r.score }

    if (sleepR.status === 'fulfilled')
      for (const s of sleepR.value.data || []) { ensure(s.day); byDate[s.day].sleep_score = s.score }

    if (activityR.status === 'fulfilled')
      for (const a of activityR.value.data || []) {
        ensure(a.day); byDate[a.day].activity_score = a.score; byDate[a.day].steps = a.steps
      }

    if (sleepSessionsR.status === 'fulfilled')
      for (const s of (sleepSessionsR.value.data || []).filter(s => s.type === 'long_sleep')) {
        ensure(s.day); byDate[s.day].sleep_hours = secToHrs(s.total_sleep_duration)
      }

    res.json(Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
