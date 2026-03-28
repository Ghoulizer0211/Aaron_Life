import { getOuraToken, ouraFetch, secToHrs } from '../_lib/oura.js'
import { getSupabase } from '../_lib/supabase.js'

export default async function handler(req, res) {
  const token = await getOuraToken()
  if (!token) return res.status(404).json({ error: 'Not connected' })

  const today     = req.query.date || new Date().toISOString().slice(0, 10)
  const yesterday = new Date(new Date(today + 'T12:00:00').getTime() - 86400000).toISOString().slice(0, 10)

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

    const fmtTime = (iso) => {
      if (!iso) return null
      return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    }

    res.json({
      date: today,
      workout_today,
      readiness: readiness ? {
        score:                 readiness.score,
        temperature_deviation: readiness.temperature_deviation,
        contributors:          readiness.contributors,
      } : null,
      sleep: mainSleep || dailySleep ? {
        score:        dailySleep?.score        ?? null,
        contributors: dailySleep?.contributors ?? null,
        total_hours:  mainSleep ? secToHrs(mainSleep.total_sleep_duration)  : null,
        deep_hours:   mainSleep ? secToHrs(mainSleep.deep_sleep_duration)   : null,
        rem_hours:    mainSleep ? secToHrs(mainSleep.rem_sleep_duration)    : null,
        light_hours:  mainSleep ? secToHrs(mainSleep.light_sleep_duration)  : null,
        awake_hours:  mainSleep ? secToHrs(mainSleep.awake_time ?? 0)       : null,
        efficiency:   mainSleep?.efficiency        ?? null,
        resting_hr:   mainSleep?.lowest_heart_rate ?? null,
        avg_hrv:      mainSleep?.average_hrv       ?? null,
        bedtime:      fmtTime(mainSleep?.bedtime_start),
        wake_time:    fmtTime(mainSleep?.bedtime_end),
      } : null,
      activity: activity ? {
        score:           activity.score,
        steps:           activity.steps,
        active_calories: activity.active_calories,
        total_calories:  activity.total_calories,
        target_calories: activity.target_calories,
        walking_miles:   activity.walking_equivalent_meters
                           ? Math.round((activity.walking_equivalent_meters / 1609.34) * 10) / 10
                           : null,
        high_minutes:   activity.high     ?? null,
        medium_minutes: activity.medium   ?? null,
        low_minutes:    activity.low      ?? null,
        non_wear:       activity.non_wear ?? null,
      } : null,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
