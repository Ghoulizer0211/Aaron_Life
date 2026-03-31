import { getOuraToken, ouraFetch, secToHrs } from './_lib/oura.js'
import { getSupabase } from './_lib/supabase.js'

export default async function handler(req, res) {
  const parts = req.url.split('?')[0].split('/').filter(Boolean)
  const sub   = parts[2]

  // GET /api/oura/status
  if (sub === 'status' && req.method === 'GET') {
    const token = await getOuraToken()
    return res.json({ linked: !!token })
  }

  // POST /api/oura/connect
  if (sub === 'connect' && req.method === 'POST') {
    // Token is managed via VITE_OURA_ACCESS_TOKEN env var in Vercel, not stored here
    return res.status(400).json({ error: 'Set VITE_OURA_ACCESS_TOKEN in Vercel environment variables' })
  }

  // GET /api/oura/today
  if (sub === 'today' && req.method === 'GET') {
    const token = await getOuraToken()
    if (!token) return res.status(404).json({ error: 'Not connected' })

    const today     = req.query.date || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
    const yesterday = new Date(new Date(today + 'T12:00:00').getTime() - 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })

    try {
      const [readinessR, dailySleepR, sleepR, activityR] = await Promise.allSettled([
        ouraFetch(`/v2/usercollection/daily_readiness?start_date=${yesterday}&end_date=${today}`, token),
        ouraFetch(`/v2/usercollection/daily_sleep?start_date=${yesterday}&end_date=${today}`, token),
        ouraFetch(`/v2/usercollection/sleep?start_date=${yesterday}&end_date=${today}`, token),
        ouraFetch(`/v2/usercollection/daily_activity?start_date=${today}&end_date=${today}`, token),
      ])

      const readiness     = readinessR.status  === 'fulfilled' ? readinessR.value.data?.slice(-1)[0]  : null
      const dailySleep    = dailySleepR.status === 'fulfilled' ? dailySleepR.value.data?.slice(-1)[0] : null
      const sleepSessions = sleepR.status      === 'fulfilled' ? sleepR.value.data : []
      const activity      = activityR.status   === 'fulfilled' ? activityR.value.data?.slice(-1)[0]   : null
      const mainSleep     = sleepSessions.find(s => s.type === 'long_sleep') || sleepSessions[sleepSessions.length - 1] || null

      let workout_today = false
      const supabase = getSupabase()
      if (supabase) {
        const { data: gw } = await supabase.from('gym_workouts').select('id').eq('date', today).neq('type', 'Rest').limit(1)
        workout_today = (gw || []).length > 0
      }

      const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : null

      return res.json({
        date: today,
        workout_today,
        readiness: readiness ? { score: readiness.score, temperature_deviation: readiness.temperature_deviation, contributors: readiness.contributors } : null,
        sleep: mainSleep || dailySleep ? {
          score: dailySleep?.score ?? null, contributors: dailySleep?.contributors ?? null,
          total_hours: mainSleep ? secToHrs(mainSleep.total_sleep_duration)  : null,
          deep_hours:  mainSleep ? secToHrs(mainSleep.deep_sleep_duration)   : null,
          rem_hours:   mainSleep ? secToHrs(mainSleep.rem_sleep_duration)    : null,
          light_hours: mainSleep ? secToHrs(mainSleep.light_sleep_duration)  : null,
          awake_hours: mainSleep ? secToHrs(mainSleep.awake_time ?? 0)       : null,
          efficiency:  mainSleep?.efficiency        ?? null,
          resting_hr:  mainSleep?.lowest_heart_rate ?? null,
          avg_hrv:     mainSleep?.average_hrv       ?? null,
          bedtime:     fmtTime(mainSleep?.bedtime_start),
          wake_time:   fmtTime(mainSleep?.bedtime_end),
        } : null,
        activity: activity ? {
          score: activity.score, steps: activity.steps,
          active_calories: activity.active_calories, total_calories: activity.total_calories,
          target_calories: activity.target_calories,
          walking_miles: activity.walking_equivalent_meters
            ? Math.round((activity.walking_equivalent_meters / 1609.34) * 10) / 10 : null,
          high_minutes: activity.high ?? null, medium_minutes: activity.medium ?? null,
          low_minutes:  activity.low  ?? null, non_wear:       activity.non_wear ?? null,
        } : null,
      })
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }

  // GET /api/oura/week
  if (sub === 'week' && req.method === 'GET') {
    const token = await getOuraToken()
    if (!token) return res.status(404).json({ error: 'Not connected' })

    const days  = Math.min(parseInt(req.query.days) || 30, 90)
    const end   = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
    const start = new Date(Date.now() - (days + 1) * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })

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
        for (const a of activityR.value.data || []) { ensure(a.day); byDate[a.day].activity_score = a.score; byDate[a.day].steps = a.steps }
      if (sleepSessionsR.status === 'fulfilled')
        for (const s of (sleepSessionsR.value.data || []).filter(s => s.type === 'long_sleep')) {
          ensure(s.day); byDate[s.day].sleep_hours = secToHrs(s.total_sleep_duration)
        }

      return res.json(Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)))
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }

  res.status(404).json({ error: 'Not found' })
}
