import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import './Page.css'
import './Health.css'

// â”€â”€ Date helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function todayStr() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }) }

function offsetDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}

function fmtDateLabel(dateStr) {
  const today     = todayStr()
  const yesterday = offsetDate(today, -1)
  if (dateStr === today)     return 'Today'
  if (dateStr === yesterday) return 'Yesterday'
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function fmtShortDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function getWeekStart(refDate) {
  const d = new Date((refDate || todayStr()) + 'T12:00:00')
  const day = d.getDay()
  const diff = day === 0 ? 6 : day - 1
  d.setDate(d.getDate() - diff)
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}

// â”€â”€ Score helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function scoreColor(score) {
  if (score == null) return '#444'
  if (score >= 85) return '#00ff9d'
  if (score >= 70) return '#00e5ff'
  if (score >= 50) return '#ffe600'
  return '#ff3864'
}

function fmtHrs(h) {
  if (h == null) return '—'
  const hrs = Math.floor(h)
  const min = Math.round((h - hrs) * 60)
  return min > 0 ? `${hrs}h ${min}m` : `${hrs}h`
}

function readinessTitle(score) {
  if (score == null) return null
  if (score >= 85) return 'Excellent Recovery'
  if (score >= 70) return 'Good Recovery'
  if (score >= 50) return 'Fair Recovery'
  return 'Low Recovery'
}

function readinessInsight(score) {
  if (score == null) return 'Sync your ring to see today\'s readiness.'
  if (score >= 85) return 'Normal training is fine'
  if (score >= 70) return 'Normal training is fine'
  if (score >= 50) return 'Keep intensity moderate today'
  return 'Rest day recommended'
}

function buildRecoveryInsight(readiness, sleep) {
  if (readiness?.score == null) return null
  const s = readiness.score
  const shortSleep = sleep?.total_hours != null && sleep.total_hours < 7
  if (s >= 85) return { main: 'Excellent recovery. Go all out today.', sub: null }
  if (s >= 70) return { main: 'Recovery is good enough to train,', sub: shortSleep ? 'but sleep duration is the weak point today.' : 'and your metrics look solid.' }
  if (s >= 50) return { main: 'Moderate recovery. Keep intensity low today,', sub: 'and prioritize sleep tonight.' }
  return { main: 'Low recovery. Consider a rest day', sub: 'or very light activity only.' }
}

function sleepInsight(hours, score) {
  if (hours != null && hours < 6)  return 'Short sleep. Prioritize rest tonight.'
  if (hours != null && hours >= 8) return 'Great sleep duration. Well rested.'
  if (score != null && score >= 85) return 'Excellent sleep quality.'
  if (score != null && score < 60)  return 'Low sleep quality. Try an earlier bedtime.'
  return 'Decent sleep. Aim for 7-9 hours consistently.'
}

function calcStreakFromLogs(logs) {
  let streak = 0
  let d = todayStr()
  for (let i = 0; i < 90; i++) {
    const has = (logs || []).some(l => l.date === d)
    if (has) { streak++; d = offsetDate(d, -1) }
    else if (i === 0) { d = offsetDate(d, -1) }
    else break
  }
  return streak
}

function calcWeekFreqFromLogs(logs) {
  const start = getWeekStart()
  return (logs || []).filter(l => l.date >= start && l.date <= todayStr()).length
}

// â”€â”€ Data hooks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function useOuraToday(linked, date) {
  const cacheKey = `aaron_health_${date}`
  const [data, setData]       = useState(() => {
    try { return JSON.parse(localStorage.getItem(cacheKey) || 'null') } catch { return null }
  })
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  const fetch_ = useCallback(async (d, sync = false) => {
    setLoading(true); setError(null)
    try {
      const url  = `/api/oura/today?date=${d}${sync ? '&sync=true' : ''}`
      const res  = await fetch(url)
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setData(json)
      localStorage.setItem(`aaron_health_${d}`, JSON.stringify(json))
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (!linked) return
    // Show localStorage instantly, then load from server (server checks Supabase cache first)
    const cached = localStorage.getItem(`aaron_health_${date}`)
    if (cached) { try { setData(JSON.parse(cached)) } catch { /* ignore */ } }
    fetch_(date, false)
  }, [linked, date, fetch_])

  return { data, loading, error, refetch: () => fetch_(date, true) }
}

function useOuraWeek(linked) {
  const [data, setData] = useState(() => {
    try { return JSON.parse(localStorage.getItem('aaron_health_week') || 'null') } catch { return null }
  })

  useEffect(() => {
    if (!linked) return
    fetch('/api/oura/week?days=30')
      .then(r => r.json())
      .then(j => { if (!j.error) { setData(j); localStorage.setItem('aaron_health_week', JSON.stringify(j)) } })
      .catch(() => {})
  }, [linked])

  return data
}


function usePlans() {
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState(false)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/gym/plans')
      const json = await res.json()
      if (Array.isArray(json)) setPlans(json)
    } catch {}
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])
  return { plans, loading, refetch: load }
}

function useWorkoutLogs() {
  const [logs, setLogs] = useState([])
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/gym/logs?limit=60')
      const json = await res.json()
      if (Array.isArray(json)) setLogs(json)
    } catch {}
  }, [])
  useEffect(() => { load() }, [load])
  return { logs, refetch: load }
}

function useLastPerf(dayId) {
  const [data, setData] = useState(null)
  useEffect(() => {
    if (!dayId) return
    setData(null)
    fetch(`/api/gym/last-performance/${dayId}`)
      .then(r => r.json())
      .then(j => { if (!j.error) setData(j) })
      .catch(() => {})
  }, [dayId])
  return data
}

// â”€â”€ SVG Components â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function ScoreRing({ score, color, size = 88, strokeWidth = 7 }) {
  const r    = (size - strokeWidth * 2) / 2
  const circ = 2 * Math.PI * r
  const dash = score != null ? (score / 100) * circ : 0
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--border)" strokeWidth={strokeWidth} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{ transition: 'stroke-dasharray 0.7s ease', filter: `drop-shadow(0 0 4px ${color}88)` }}
      />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central"
        fill="var(--text-primary)" fontSize={size * 0.27} fontWeight="700" fontFamily="'Exo 2', sans-serif">
        {score ?? '—'}
      </text>
    </svg>
  )
}

function BarChart({ items, height = 56 }) {
  // items: [{label, value, color?}]
  const max = Math.max(...items.map(d => d.value || 0), 1)
  const n   = items.length
  const bw  = 100 / n
  return (
    <div className="bar-chart-wrap">
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
        {items.map((d, i) => {
          const h  = Math.max(((d.value || 0) / max) * (height - 4), d.value ? 3 : 1)
          const c  = d.color || scoreColor(d.value)
          return (
            <rect key={i} x={i * bw + bw * 0.1} y={height - h - 2}
              width={bw * 0.8} height={h} rx="1.5" fill={c} opacity={0.85} />
          )
        })}
      </svg>
      <div className="bar-chart-labels">
        {items.map((d, i) => <span key={i} className="bcl">{d.label}</span>)}
      </div>
    </div>
  )
}

// â”€â”€ Tab bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const TABS = [
  { id: 'today',    label: 'Overview' },
  { id: 'sleep',    label: 'Sleep' },
  { id: 'gym',      label: 'Gym' },
  { id: 'activity', label: 'Activity' },
  { id: 'trends',   label: 'Trends' },
]

function HealthTabs({ tab, setTab }) {
  return (
    <div className="htabs">
      {TABS.map(t => (
        <button key={t.id} className={`htab ${tab === t.id ? 'htab--active' : ''}`} onClick={() => setTab(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

// â”€â”€ Date nav â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function DateNav({ date, setDate, onSync, syncing }) {
  return (
    <div className="health-nav">
      <button className="hnav-btn" onClick={() => setDate(d => offsetDate(d, -1))}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <div className="hnav-center">
        <span className="hnav-label">{fmtDateLabel(date)}</span>
        {date !== todayStr() && <button className="hnav-today" onClick={() => setDate(todayStr())}>Today</button>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {onSync && (
          syncing
            ? <span className="sync-label">Syncing…</span>
            : <button className="action-btn" onClick={onSync}>↻</button>
        )}
        <button className="hnav-btn" onClick={() => setDate(d => offsetDate(d, +1))} disabled={date >= todayStr()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>
    </div>
  )
}

// â”€â”€ TODAY TAB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function VerseCard() {
  const cacheKey = `verse_${todayStr()}`
  const [verse, setVerse] = useState(() => {
    try { return JSON.parse(localStorage.getItem(cacheKey) || 'null') } catch { return null }
  })
  useEffect(() => {
    if (verse) return
    fetch('/api/verse').then(r => r.json()).then(j => {
      if (j.text) { setVerse(j); localStorage.setItem(cacheKey, JSON.stringify(j)) }
    }).catch(() => {})
  }, []) // eslint-disable-line
  if (!verse) return null
  return (
    <section className="page-section">
      <div className="card verse-card">
        <div className="verse-label">✝ Verse of the Day</div>
        <div className="verse-text">"{verse.text}"</div>
        <div className="verse-ref">— {verse.reference}</div>
      </div>
    </section>
  )
}

function CatholicCard() {
  const cacheKey = `catholic_${todayStr()}`
  const [data, setData]       = useState(() => { try { return JSON.parse(localStorage.getItem(cacheKey) || 'null') } catch { return null } })
  const [loading, setLoading] = useState(!data)
  const [err, setErr]         = useState(null)

  useEffect(() => {
    // Clear cache if old format (has no gospel.excerpt at top level)
    if (data && data.dayTitle === 'Daily Scripture') { setData(null); localStorage.removeItem(cacheKey); return }
    if (data) return
    fetch('/api/catholic')
      .then(r => r.json())
      .then(j => {
        if (j.error) { setErr(j.error); return }
        setData(j)
        localStorage.setItem(cacheKey, JSON.stringify(j))
      })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line

  if (loading) return <div className="cc-loading">Loading scripture…</div>
  if (err)     return <div className="cc-loading cc-loading--err">Could not load scripture</div>
  if (!data)   return null

  const text = data.gospel?.excerpt || data.firstReading?.excerpt || null
  const ref  = data.gospel?.source  || data.firstReading?.source  || null

  return (
    <div className="catholic-card">
      <div className="cc-day-title">{data.dayTitle || 'Verse of the Day'}</div>
      {text && <div className="cc-reading-text">"{text}"</div>}
      {ref  && <div className="cc-ref">{ref}</div>}
    </div>
  )
}

function TodayTab({ oura, logs, date, onOpenGym }) {
  const { data, loading, error } = oura
  const { readiness, sleep, activity } = data || {}
  const streak = calcStreakFromLogs(logs)
  const rColor = scoreColor(readiness?.score)
  const todayLog = logs.find(l => l.date === date)
  const workoutDone = !!todayLog
  const insight = buildRecoveryInsight(readiness, sleep)

  const chips = []
  if (sleep?.score != null)   chips.push({ icon: '🌙', label: `Sleep ${sleep.score}` })
  if (sleep?.avg_hrv != null) chips.push({ icon: '〰️', label: `HRV ${Math.round(sleep.avg_hrv)} ms`, accent: true })

  const sleepDebt = sleep?.total_hours != null ? Math.max(0, 8 - sleep.total_hours) : null

  return (
    <div className="health-scroll">
      {error && <div className="health-error" style={{margin:'12px 16px'}}>{error}</div>}
      <div className="overview-grid">

        {/* ── Left column ── */}
        <div className="overview-col">
          <section className="page-section">
            <div className="card readiness-hero">
              <div className="rh-ring">
                <ScoreRing score={readiness?.score ?? null} color={rColor} size={90} />
              </div>
              <div className="rh-info">
                <span className="rh-label">Readiness</span>
                {readinessTitle(readiness?.score) && <span className="rh-title" style={{ color: rColor }}>{readinessTitle(readiness?.score)}</span>}
                <span className="rh-insight">{readinessInsight(readiness?.score)}</span>
                {chips.length > 0 && (
                  <div className="rh-chips">
                    {chips.map((c, i) => (
                      <span key={i} className={`rh-chip${c.accent ? ' rh-chip--accent' : ''}`}>
                        {c.icon} {c.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="page-section">
            <div className="ov-metrics ov-metrics--2x2">
              <div className="card ov-metric">
                <span className="ovm-icon" style={{color:'#f472b6'}}>❤️</span>
                <span className="ovm-value">{sleep?.resting_hr != null ? sleep.resting_hr : '—'}</span>
                <span className="ovm-label">Resting HR</span>
                {sleep?.resting_hr != null && <span className="ovm-sub">bpm</span>}
              </div>
              <div className="card ov-metric">
                <span className="ovm-icon" style={{color:'var(--accent)'}}>🏃</span>
                <span className="ovm-value">{activity?.steps != null ? activity.steps.toLocaleString() : '—'}</span>
                <span className="ovm-label">Steps</span>
              </div>
              <div className="card ov-metric">
                <span className="ovm-icon" style={{color:'#fb923c'}}>🔥</span>
                <span className="ovm-value">{activity?.active_calories != null ? activity.active_calories : '—'}</span>
                <span className="ovm-label">Calories</span>
                {activity?.active_calories != null && <span className="ovm-sub">kcal</span>}
              </div>
              <div className="card ov-metric">
                <span className="ovm-icon" style={{color:'#818cf8'}}>💤</span>
                <span className="ovm-value">{sleepDebt != null ? (sleepDebt === 0 ? '0h' : fmtHrs(sleepDebt)) : '—'}</span>
                <span className="ovm-label">Sleep Debt</span>
              </div>
            </div>
          </section>

          {insight && (
            <section className="page-section">
              <div className="card recovery-insight">
                <span className="ri-icon">💡</span>
                <div className="ri-text">
                  <span className="ri-main">{insight.main}</span>
                  {insight.sub && <span className="ri-sub">{insight.sub}</span>}
                </div>
              </div>
            </section>
          )}
        </div>

        {/* ── Right column ── */}
        <div className="overview-col">
          <section className="page-section">
            <div className="card gym-today-right">
              <span className="gtr-header">🏋️ Gym</span>
              {workoutDone ? (
                <>
                  <span className="gtr-day-name">{todayLog.day_name}</span>
                  <span className="gtr-done-badge">Done ✓</span>
                  <button className="gtr-edit-btn" onClick={onOpenGym}>Edit →</button>
                </>
              ) : (
                <>
                  <span className="gtr-empty">No workout logged yet</span>
                  <button className="gtr-start-btn" onClick={onOpenGym}>+ Log Workout</button>
                </>
              )}
              <div className="gtr-streak">
                🔔 {streak > 0 ? `${streak} day streak` : 'No streak yet'}
              </div>
            </div>
          </section>

          <section className="page-section">
            <div className="card streak-verse-card">
              <CatholicCard />
            </div>
          </section>
        </div>

      </div>
      {!loading && !data && (
        <div className="health-empty" style={{margin:'0 16px'}}>No data for this day. Try a different date.</div>
      )}
    </div>
  )
}

function MetricTile({ label, value, sub, color }) {
  return (
    <div className="metric-tile card">
      <span className="mt-value" style={color ? { color } : {}}>{value}</span>
      <span className="mt-label">{label}</span>
      {sub && <span className="mt-sub">{sub}</span>}
    </div>
  )
}

// â”€â”€ SLEEP TAB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function sleepScoreColor(s) {
  if (s == null) return 'var(--text-muted)'
  if (s >= 85) return '#1ed760'   // Oura green  (Great)
  if (s >= 70) return '#4ade80'   // soft green  (Good)
  if (s >= 60) return '#facc15'   // yellow      (Fair)
  return '#f87171'                // soft red    (Poor)
}

function SleepTab({ oura, weekData, date }) {
  const { data, loading } = oura
  const sleep        = data?.sleep
  const contributors = sleep?.contributors || {}

  const scoreLabel = (s) => {
    if (s == null) return null
    if (s >= 85) return 'Great'
    if (s >= 70) return 'Good'
    if (s >= 60) return 'Fair'
    return 'Poor'
  }

  const contribLabel = (val) => {
    if (val == null) return '—'
    if (val >= 85) return 'Optimal'
    if (val >= 70) return 'Good'
    if (val >= 50) return 'Fair'
    return 'Poor'
  }

  const latencyLabel = (min) => min != null ? `${min} min` : '—'

  // Uses Oura's timing contributor (circadian alignment score)
  const timingStatus = (timingScore) => {
    if (timingScore == null) return null
    if (timingScore >= 80) return 'On schedule'
    if (timingScore >= 60) return 'Slightly off'
    return 'Late sleep'
  }

  const dateLabel = (d) => {
    const today = todayStr()
    const yesterday = offsetDate(today, -1)
    if (d === today)     return 'Last Night'
    if (d === yesterday) return '2 Nights Ago'
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const sleepTotal = (sleep?.rem_hours || 0) + (sleep?.deep_hours || 0) + (sleep?.light_hours || 0) + (sleep?.awake_hours || 0)
  const sc = sleep?.score

  return (
    <div className="health-scroll">
      <section className="page-section">
        <div className="slp-card">

          {/* Eyebrow */}
          <div className="slp-eyebrow">{dateLabel(date)}</div>

          {/* Score hero */}
          <div className="slp-hero">
            <div className="slp-hero-left">
              <div className="slp-hero-title">Sleep Score</div>
              {sc != null && <div className="slp-hero-label" style={{ color: sleepScoreColor(sc) }}>{scoreLabel(sc)}</div>}
            </div>
            <div className="slp-hero-score" style={{ color: sleepScoreColor(sc) }}>
              {sc ?? '—'}
            </div>
          </div>

          <div className="slp-divider" />

          {/* Primary row: total sleep + bedtime */}
          <div className="slp-primary">
            <div className="slp-primary-left">
              <div className="slp-total-row">
                <span className="slp-moon">🌙</span>
                <span className="slp-total-val">{fmtHrs(sleep?.total_hours)}</span>
              </div>
              <div className="slp-sub-label">Total Sleep</div>
            </div>
            <div className="slp-vline" />
            <div className="slp-primary-right">
              <div className="slp-bedtime-str">{sleep?.bedtime ?? '—'} → {sleep?.wake_time ?? '—'}</div>
              {contributors.timing != null && (
                <div className="slp-sched-tag">⏱ {timingStatus(contributors.timing)}</div>
              )}
            </div>
          </div>

          <div className="slp-divider" />

          {/* Secondary metrics */}
          <div className="slp-metrics">
            <div className="slp-met">
              <span className="slp-met-icon">🎯</span>
              <span className="slp-met-val">{sleep?.efficiency != null ? `${sleep.efficiency}%` : '—'}</span>
              <span className="slp-met-name">Efficiency</span>
            </div>
            <div className="slp-met">
              <span className="slp-met-icon">⏱</span>
              <span className="slp-met-val">{latencyLabel(sleep?.latency_min)}</span>
              <span className="slp-met-name">Latency</span>
            </div>
            <div className="slp-met">
              <span className="slp-met-icon">✨</span>
              <span className="slp-met-val">{contribLabel(contributors.restfulness)}</span>
              <span className="slp-met-name">Restfulness</span>
            </div>
          </div>

          {/* Sleep stages */}
          {sleepTotal > 0 && (
            <>
              <div className="slp-divider" />
              <div className="slp-stages">
                <div className="slp-stage-bar">
                  {sleep.deep_hours  > 0 && <div className="slp-seg slp-seg--deep"  style={{ flex: sleep.deep_hours  }} />}
                  {sleep.light_hours > 0 && <div className="slp-seg slp-seg--light" style={{ flex: sleep.light_hours }} />}
                  {sleep.rem_hours   > 0 && <div className="slp-seg slp-seg--rem"   style={{ flex: sleep.rem_hours   }} />}
                  {sleep.awake_hours > 0 && <div className="slp-seg slp-seg--awake" style={{ flex: sleep.awake_hours }} />}
                </div>
                <div className="slp-stage-list">
                  <div className="slp-stage-item">
                    <span className="slp-dot slp-dot--deep" />
                    <span className="slp-stage-lbl">Deep</span>
                    <span className="slp-stage-time">{fmtHrs(sleep.deep_hours)}</span>
                  </div>
                  <div className="slp-stage-item">
                    <span className="slp-dot slp-dot--light" />
                    <span className="slp-stage-lbl">Light</span>
                    <span className="slp-stage-time">{fmtHrs(sleep.light_hours)}</span>
                  </div>
                  <div className="slp-stage-item">
                    <span className="slp-dot slp-dot--rem" />
                    <span className="slp-stage-lbl">REM</span>
                    <span className="slp-stage-time">{fmtHrs(sleep.rem_hours)}</span>
                  </div>
                  {sleep.awake_hours > 0 && (
                    <div className="slp-stage-item">
                      <span className="slp-dot slp-dot--awake" />
                      <span className="slp-stage-lbl">Awake</span>
                      <span className="slp-stage-time">{fmtHrs(sleep.awake_hours)}</span>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Recovery signals */}
          {(sleep?.resting_hr != null || sleep?.avg_hrv != null) && (
            <>
              <div className="slp-divider" />
              <div className="slp-recovery">
                {sleep.resting_hr != null && (
                  <div className="slp-rec">
                    <span className="slp-rec-icon">🫀</span>
                    <div className="slp-rec-info">
                      <span className="slp-rec-val">{sleep.resting_hr}<span className="slp-rec-unit"> bpm</span></span>
                      <span className="slp-rec-lbl">Lowest HR</span>
                    </div>
                  </div>
                )}
                {sleep.avg_hrv != null && (
                  <div className="slp-rec">
                    <span className="slp-rec-icon">〰️</span>
                    <div className="slp-rec-info">
                      <span className="slp-rec-val">{Math.round(sleep.avg_hrv)}<span className="slp-rec-unit"> ms</span></span>
                      <span className="slp-rec-lbl">Avg HRV</span>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

        </div>
      </section>
    </div>
  )
}

// â”€â”€ GYM TAB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€



// Custom dark-themed dropdown for mini calendar
function CalPicker({ value, options, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const selected = options.find(o => o.value === value)

  useEffect(() => {
    if (!open) return
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  return (
    <div ref={ref} className="calpick">
      <button className="calpick-btn" onClick={() => setOpen(o => !o)}>
        <span>{selected?.label}</span>
        <span className="calpick-caret">▾</span>
      </button>
      {open && (
        <div className="calpick-list">
          {options.map(o => (
            <button key={o.value}
              className={`calpick-item${o.value === value ? ' calpick-item--on' : ''}${o.disabled ? ' calpick-item--off' : ''}`}
              disabled={o.disabled}
              onClick={() => { onChange(o.value); setOpen(false) }}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// WeekStrip — navigable week strip with optional month calendar dropdown
function WeekStrip({ logs, date, onDateChange }) {
  const today      = todayStr()
  const [expanded,       setExpanded]       = useState(false)
  const [calMonthOffset, setCalMonthOffset] = useState(0)

  // Derive weekOffset from the selected date
  const baseStart    = getWeekStart(today)
  const selWeekStart = getWeekStart(date)
  const weekOffset   = Math.round((new Date(selWeekStart + 'T12:00:00') - new Date(baseStart + 'T12:00:00')) / (7 * 86400000))

  const weekStart = selWeekStart
  const weekDates = Array.from({ length: 7 }, (_, i) => offsetDate(weekStart, i))
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  // Week strip header label — always show month of selected date
  const monthLabel = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'long', year: 'numeric' })

  // Mini calendar: month derived from selected date + calMonthOffset
  const calBase  = new Date(date + 'T12:00:00')
  calBase.setDate(1)
  calBase.setMonth(calBase.getMonth() + calMonthOffset)
  const calYear  = calBase.getFullYear()
  const calMonth = calBase.getMonth()
  const calMonthLabel = calBase.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const firstOfMonth = new Date(calYear, calMonth, 1)
  const startDow     = firstOfMonth.getDay()
  const gridStart    = new Date(firstOfMonth)
  gridStart.setDate(firstOfMonth.getDate() - (startDow === 0 ? 6 : startDow - 1))
  const calDays = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    return d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
  }).filter((d, i) => {
    // Drop trailing rows that are entirely outside the current month
    if (i < 35) return true
    return new Date(d + 'T12:00:00').getMonth() === calMonth
  })

  const todayDate = new Date(today + 'T12:00:00')
  const maxYear   = todayDate.getFullYear()
  const minYear   = maxYear - 5

  const jumpToDate = (dateStr) => {
    if (dateStr > today) return
    onDateChange(dateStr)
    setCalMonthOffset(0)
    setExpanded(false)
  }

  const setCalMonthYear = (y, m) => {
    const baseDateObj = new Date(date + 'T12:00:00')
    baseDateObj.setDate(1)
    setCalMonthOffset((y - baseDateObj.getFullYear()) * 12 + (m - baseDateObj.getMonth()))
  }

  return (
    <div className="gym-cal-wrap">
      {/* Header row: prev / month label (tap to expand) / next / today */}
      <div className="gym-cal-header">
        <button className="hnav-btn" onClick={() => onDateChange(offsetDate(date, -7))}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <button className="gym-cal-month" onClick={() => setExpanded(e => !e)}>
          {monthLabel} {expanded ? '▲' : '▼'}
        </button>
        <button className="hnav-btn" onClick={() => onDateChange(offsetDate(date, +7))} disabled={weekOffset >= 0 || offsetDate(date, +7) > today}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        {date !== today && (
          <button className="hnav-today" onClick={() => onDateChange(today)}>Today</button>
        )}
      </div>

      {/* Week dots */}
      <div className="card week-grid-card">
        {weekDates.map((d, i) => {
          const log     = logs.find(l => l.date === d)
          const isToday = d === today
          const isPast  = d < today
          const isRest     = log?.day_name === 'Rest'
          const isSelected = d === date
          const dotCls     = log ? (isRest ? 'wgd-rest' : 'wgd-done') : (isPast ? 'wgd-miss' : 'wgd-future')
          return (
            <div key={d} className={`wg-day${isToday ? ' wg-today' : ''}${isSelected ? ' wg-selected' : ''}`}
              onClick={() => d <= today && onDateChange(d)}
              style={{ cursor: d <= today ? 'pointer' : 'default', opacity: d > today ? 0.35 : 1 }}>
              <span className="wgd-label">{dayLabels[i]}</span>
              <div className={`wgd-dot ${dotCls}`}>
                {log ? (isRest ? '😴' : '✓') : ''}
              </div>
              <span className="wgd-date">{parseInt(d.slice(8))}</span>
            </div>
          )
        })}
      </div>

      {/* Expanded month calendar */}
      {expanded && (
        <div className="gym-mini-cal">
          <div className="gmc-pickers">
            <CalPicker value={calMonth}
              options={['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, i) => ({
                value: i, label: m, disabled: calYear === maxYear && i > todayDate.getMonth()
              }))}
              onChange={m => setCalMonthYear(calYear, m)} />
            <CalPicker value={calYear}
              options={Array.from({ length: maxYear - minYear + 1 }, (_, i) => ({ value: minYear + i, label: String(minYear + i) }))}
              onChange={y => setCalMonthYear(y, calMonth)} />
          </div>
          <div className="gmc-dow-row">
            {['M','T','W','T','F','S','S'].map((l, i) => <span key={i} className="gmc-dow">{l}</span>)}
          </div>
          <div className="gmc-grid">
            {calDays.map(d => {
              const isCurMon = new Date(d + 'T12:00:00').getMonth() === calMonth
              if (!isCurMon) return <span key={d} className="gmc-day gmc-empty" />
              const log      = logs.find(l => l.date === d)
              const isToday  = d === today
              const inWeek   = weekDates.includes(d)
              const isRest   = log?.day_name === 'Rest'
              const isFuture = d > today
              return (
                <button key={d}
                  className={`gmc-day${isToday ? ' gmc-today' : ''}${inWeek ? ' gmc-in-week' : ''}${isFuture ? ' gmc-future' : ''}`}
                  onClick={() => jumpToDate(d)} disabled={isFuture}>
                  <span className="gmc-num">{new Date(d + 'T12:00:00').getDate()}</span>
                  {log && <span className={`gmc-dot${isRest ? ' gmc-dot--rest' : ''}`} />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// LoggedWorkout — shows an existing log for a date
function LoggedWorkout({ log, onDelete, onEdit }) {
  const [open, setOpen] = useState(false)
  const logged  = (log.exercises || []).filter(e => !e.skipped)
  const skipped = (log.exercises || []).filter(e => e.skipped)
  const isRest  = log.day_name === 'Rest' && logged.length === 0
  return (
    <div className="card gym-logged">
      <button className="gym-logged-header" onClick={() => setOpen(o => !o)}>
        <div>
          <span className="gym-logged-title">{isRest ? '😴 Rest Day' : (log.day_name || 'Workout')}</span>
          {log.plan_name && <span className="gym-logged-sub"> · {log.plan_name}</span>}
        </div>
        <span className="wc-chevron">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="gym-logged-body">
          <div className="wc-divider" />
          {isRest && <p className="health-empty" style={{ margin: 0 }}>Rest day logged.</p>}
          {logged.map((ex, i) => (
            <div key={i} className="wc-exercise">
              <span className="wce-name">{ex.exercise_name}</span>
              <span className="wce-sets">
                {(ex.sets_data || []).map((s, j) => (
                  <span key={j} className="wce-set">{s.weight}×{s.reps}</span>
                ))}
              </span>
            </div>
          ))}
          {skipped.length > 0 && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '6px 0 0' }}>
              Skipped: {skipped.map(e => e.exercise_name).join(', ')}
            </p>
          )}
          {log.notes && <p className="wc-notes">{log.notes}</p>}
          <div className="wc-actions">
            <button className="wc-edit" onClick={onEdit}>Edit</button>
            <button className="wc-delete" onClick={() => onDelete(log.id)}>Delete</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ExerciseCard — collapsible 4-column grid (prev lbs | prev reps | new lbs | new reps)
function ExerciseCard({ exercise, lastPerf, state, onChange }) {
  const [open, setOpen] = useState(false)
  const lastSets = (lastPerf || []).filter(s => s.weight || s.reps)

  // Auto-init sets when opening
  useEffect(() => {
    if (!open || state !== null) return
    const initSets = lastSets.length > 0
      ? lastSets.map(() => ({ weight: '', reps: '' }))
      : [{ weight: '', reps: '' }]
    onChange({ action: 'edit', sets: initSets })
  }, [open])

  const sets      = state?.sets || []
  const isSkipped = state?.action === 'skip'
  const hasData   = sets.some(s => s.weight || s.reps)

  const updateSet = (i, field, val) => {
    const next = [...sets]; next[i] = { ...next[i], [field]: val }
    onChange({ action: 'edit', sets: next })
  }
  const addSet    = () => onChange({ action: 'edit', sets: [...sets, { weight: '', reps: '' }] })
  const removeSet = (i) => onChange({ action: 'edit', sets: sets.filter((_, j) => j !== i) })

  const statusBadge = isSkipped ? <span className="ec-badge ec-badge--skip">Skipped</span>
                    : hasData   ? <span className="ec-badge ec-badge--done">✓</span>
                    : null

  return (
    <div className={`ex-card card${hasData ? ' ex-card--done' : ''}`}>
      <button className="ec-header" onClick={() => setOpen(o => !o)}>
        <span className="ec-name">{exercise.exercise_name}</span>
        <div className="ec-header-right">
          {!open && statusBadge}
          <span className="ec-chevron">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="ec-body">
          {isSkipped ? (
            <div className="ec-result ec-result--skip">
              <span>Skipped</span>
              <button className="ec-reset-sm" onClick={() => onChange(null)}>×</button>
            </div>
          ) : (
            <>
              <div className="ec-grid">
                <div className="ec-grid-head">
                  <span>Prev lbs</span><span>Prev reps</span>
                  <span>lbs</span><span>reps</span><span/>
                </div>
                {sets.map((s, i) => (
                  <div key={i} className="ec-grid-row">
                    <span className="ec-prev">{lastSets[i]?.weight || '—'}</span>
                    <span className="ec-prev">{lastSets[i]?.reps   || '—'}</span>
                    <input className="ec-grid-input" type="number" inputMode="decimal"
                      placeholder="0" value={s.weight} onChange={e => updateSet(i, 'weight', e.target.value)} />
                    <input className="ec-grid-input" type="number" inputMode="numeric"
                      placeholder="0" value={s.reps}   onChange={e => updateSet(i, 'reps',   e.target.value)} />
                    <button className="ec-rm" onClick={() => removeSet(i)}
                      style={{ visibility: sets.length > 1 ? 'visible' : 'hidden' }}>✕</button>
                  </div>
                ))}
              </div>
              <div className="ec-log-footer">
                <button className="ec-add-set" onClick={addSet}>+ Set</button>
                <button className="ec-skip-btn" onClick={() => onChange({ action: 'skip', sets: [] })}>Skip</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// PlanDayLogger — pick plan then day, log exercises, save
function PlanDayLogger({ plans, date, onSave, onAutoSave, onDone, saving, onCancel }) {
  const [planId, setPlanId] = useState(() => (plans.find(p => p.is_active) || plans[0])?.id || '')
  const plan                 = plans.find(p => p.id === planId) || null
  const [dayId, setDayId]   = useState(null)
  const day                  = plan?.days?.find(d => d.id === dayId) || null
  const lastPerf             = useLastPerf(dayId)
  const [states, setStates]  = useState({})
  const [notes, setNotes]    = useState('')
  const [err, setErr]        = useState(null)
  const autoSavedIdRef       = useRef(null)
  const [autoSaveStatus, setAutoSaveStatus] = useState(null)
  const isMounted            = useRef(true)
  useEffect(() => () => { isMounted.current = false }, [])

  const handlePlanChange = (id) => { setPlanId(id); setDayId(null); setStates({}) }

  useEffect(() => {
    if (!day || !onAutoSave) return
    const timer = setTimeout(async () => {
      if (!isMounted.current) return
      setAutoSaveStatus('saving')
      const exercises = day.exercises.map(ex => ({
        exercise_name: ex.exercise_name,
        sets_data:     states[ex.exercise_name]?.sets || [],
        skipped:       states[ex.exercise_name]?.action === 'skip',
      }))
      const newId = await onAutoSave(
        { date, plan_id: plan.id, plan_name: plan.name, day_id: day.id, day_name: day.day_name, notes: notes.trim() || null, exercises },
        autoSavedIdRef.current
      )
      if (!isMounted.current) return
      if (newId) { autoSavedIdRef.current = newId; setAutoSaveStatus('saved') }
      else setAutoSaveStatus(null)
    }, 1500)
    return () => clearTimeout(timer)
  }, [states, notes, dayId])

  const handleSave = async () => {
    if (autoSavedIdRef.current) { onDone(); return }
    if (!day) { setErr('Pick a day first'); return }
    setErr(null)
    const exercises = day.exercises.map(ex => ({
      exercise_name: ex.exercise_name,
      sets_data:     states[ex.exercise_name]?.sets || [],
      skipped:       states[ex.exercise_name]?.action === 'skip',
    }))
    const e = await onSave({ date, plan_id: plan.id, plan_name: plan.name, day_id: day.id, day_name: day.day_name, notes: notes.trim() || null, exercises })
    if (e) setErr(e)
  }

  return (
    <div>
      <div className="gym-log-section">
        <span className="gym-log-label">Plan</span>
        <div className="gym-chips">
          {plans.map(p => (
            <button key={p.id} className={`gym-chip${planId === p.id ? ' gym-chip--active' : ''}`}
              onClick={() => handlePlanChange(p.id)}>{p.name}</button>
          ))}
        </div>
      </div>

      {plan && (
        <div className="gym-log-section">
          <span className="gym-log-label">Day</span>
          <div className="gym-chips">
            {(plan.days || []).map(d => (
              <button key={d.id} className={`gym-chip${dayId === d.id ? ' gym-chip--active' : ''}`}
                onClick={() => { setDayId(d.id); setStates({}); autoSavedIdRef.current = null; setAutoSaveStatus(null) }}>
                {d.day_name}
                <span className="gym-chip-count">{d.exercises.length} ex</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {day && (
        <div className="gym-log-section">
          {day.exercises.map(ex => (
            <ExerciseCard key={ex.id} exercise={ex}
              lastPerf={lastPerf?.[ex.exercise_name] || null}
              state={states[ex.exercise_name] || null}
              onChange={val => setStates(s => ({ ...s, [ex.exercise_name]: val }))} />
          ))}
          <textarea className="form-input form-textarea" placeholder="Session notes (optional)…"
            value={notes} onChange={e => setNotes(e.target.value)} style={{ marginTop: 8 }} />
          {err && <p className="form-error">{err}</p>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <button className="connect-btn health-connect-btn" onClick={handleSave} disabled={saving} style={{ margin: 0 }}>
              {saving ? 'Saving…' : autoSavedIdRef.current ? 'Done' : 'Save Session'}
            </button>
            {autoSaveStatus === 'saving' && <span className="autosave-status">Saving…</span>}
            {autoSaveStatus === 'saved'  && <span className="autosave-status autosave-status--saved">Saved ✓</span>}
          </div>
        </div>
      )}

      <button className="gym-cancel-link" onClick={onCancel}>Cancel</button>
    </div>
  )
}

// CustomLogger — draggable, collapsible exercises with set logging
function CustomLogger({ date, onSave, onAutoSave, onDone, saving, onCancel, initialData }) {
  const [dayName,   setDayName]   = useState(initialData?.day_name || '')
  const [exercises, setExercises] = useState(() => {
    if (initialData?.exercises?.length) {
      const exs = initialData.exercises.filter(e => !e.skipped)
      if (exs.length) return exs.map((e, i) => ({
        key: i,
        name: e.exercise_name || '',
        sets: e.sets_data?.length
          ? e.sets_data.map(s => ({ weight: String(s.weight ?? ''), reps: String(s.reps ?? '') }))
          : [{ weight: '', reps: '' }],
      }))
    }
    return [{ key: 0, name: '', sets: [{ weight: '', reps: '' }] }]
  })
  const [openExs,   setOpenExs]   = useState(() => {
    if (initialData?.exercises?.length) {
      const exs = initialData.exercises.filter(e => !e.skipped)
      return new Set(exs.map((_, i) => i))
    }
    return new Set([0])
  })
  const [notes,     setNotes]     = useState(initialData?.notes || '')
  const [err,       setErr]       = useState(null)
  const nextKey        = useRef(initialData?.exercises?.filter(e => !e.skipped).length || 1)
  const autoSavedIdRef = useRef(initialData?.id || null)
  const [autoSaveStatus, setAutoSaveStatus] = useState(null)
  const isMounted      = useRef(true)
  useEffect(() => () => { isMounted.current = false }, [])
  const ghostElRef = useRef(null)
  const exRowRefs  = useRef({})
  const dragRef    = useRef(null)
  const [dragState, setDragState] = useState(null)

  useEffect(() => {
    if (!dragState) return
    const onMove = (e) => {
      const clientY = e.touches?.[0]?.clientY ?? e.clientY
      if (e.cancelable) e.preventDefault()
      const dr = dragRef.current; if (!dr) return
      if (ghostElRef.current) ghostElRef.current.style.top = `${clientY - dr.offsetY}px`
      const ghostCenterY = clientY - dr.offsetY + dr.rowH / 2
      const n = Object.keys(dr.origCenters).length
      let t = n - 1
      for (let i = 0; i < n; i++) { if (ghostCenterY < dr.origCenters[i]) { t = i; break } }
      t = Math.max(0, Math.min(n - 1, t))
      if (t !== dr.targetEi) { dr.targetEi = t; setDragState(s => s ? { ...s, targetEi: t } : null) }
    }
    const onUp = () => {
      const dr = dragRef.current
      if (dr && dr.fromEi !== dr.targetEi) {
        setExercises(exs => {
          const arr = [...exs]; const [moved] = arr.splice(dr.fromEi, 1); arr.splice(dr.targetEi, 0, moved); return arr
        })
      }
      setDragState(null); dragRef.current = null
    }
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
  }, [dragState !== null])

  const addEx    = () => { const k = nextKey.current++; setExercises(e => [...e, { key: k, name: '', sets: [{ weight: '', reps: '' }] }]); setOpenExs(s => new Set([...s, exercises.length])) }
  const remEx    = (i) => setExercises(e => e.filter((_, j) => j !== i))
  const updName  = (i, v) => setExercises(e => e.map((ex, j) => j === i ? { ...ex, name: v } : ex))
  const addSet   = (i) => setExercises(e => e.map((ex, j) => j === i ? { ...ex, sets: [...ex.sets, { weight: '', reps: '' }] } : ex))
  const remSet   = (i, si) => setExercises(e => e.map((ex, j) => j === i ? { ...ex, sets: ex.sets.filter((_, k) => k !== si) } : ex))
  const updSet   = (i, si, f, v) => setExercises(e => e.map((ex, j) => j === i ? { ...ex, sets: ex.sets.map((s, k) => k === si ? { ...s, [f]: v } : s) } : ex))
  const toggleEx = (i) => setOpenExs(s => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n })

  useEffect(() => {
    const valid = exercises.filter(e => e.name.trim())
    if (!valid.length || !onAutoSave) return
    const timer = setTimeout(async () => {
      if (!isMounted.current) return
      setAutoSaveStatus('saving')
      const exData = valid.map(ex => ({ exercise_name: ex.name.trim(), sets_data: ex.sets.filter(s => s.weight || s.reps), skipped: false }))
      const newId = await onAutoSave(
        { date, day_name: dayName.trim() || 'Custom', notes: notes.trim() || null, exercises: exData },
        autoSavedIdRef.current
      )
      if (!isMounted.current) return
      if (newId) { autoSavedIdRef.current = newId; setAutoSaveStatus('saved') }
      else setAutoSaveStatus(null)
    }, 1500)
    return () => clearTimeout(timer)
  }, [exercises, dayName, notes])

  const handleSave = async () => {
    if (autoSavedIdRef.current) { onDone(); return }
    const valid = exercises.filter(e => e.name.trim())
    if (!valid.length) { setErr('Add at least one exercise'); return }
    setErr(null)
    const exData = valid.map(ex => ({ exercise_name: ex.name.trim(), sets_data: ex.sets.filter(s => s.weight || s.reps), skipped: false }))
    const e = await onSave({ date, day_name: dayName.trim() || 'Custom', notes: notes.trim() || null, exercises: exData })
    if (e) setErr(e)
  }

  return (
    <div>
      <input className="form-input cl-title" placeholder="Workout title (e.g. Push Day)"
        value={dayName} onChange={e => setDayName(e.target.value)} />

      {exercises.map((ex, i) => {
        const isOpen = openExs.has(i)
        const hasData = ex.sets.some(s => s.weight || s.reps)
        let rowTransform = 'none', rowOpacity = 1
        if (dragState) {
          const { fromEi, targetEi, rowH } = dragState
          if (i === fromEi) { rowOpacity = 0.25 }
          else if (fromEi < targetEi && i > fromEi && i <= targetEi) { rowTransform = `translateY(-${rowH}px)` }
          else if (fromEi > targetEi && i >= targetEi && i < fromEi) { rowTransform = `translateY(${rowH}px)` }
        }
        return (
          <div key={ex.key} ref={el => exRowRefs.current[i] = el}
            className={`ex-card card${hasData ? ' ex-card--done' : ''}`}
            style={{ transform: rowTransform, opacity: rowOpacity, transition: dragState ? 'transform 150ms ease, opacity 150ms ease' : 'none', marginBottom: 8 }}>
            <div className="cl-ex-header">
              <span className="pdb-handle" onPointerDown={(e) => {
                e.preventDefault()
                const row = exRowRefs.current[i]; const rect = row.getBoundingClientRect()
                const origCenters = {}
                exercises.forEach((_, idx) => { const el = exRowRefs.current[idx]; if (el) { const r = el.getBoundingClientRect(); origCenters[idx] = r.top + r.height / 2 } })
                dragRef.current = { fromEi: i, targetEi: i, offsetY: e.clientY - rect.top, rowH: rect.height, origCenters }
                setDragState({ fromEi: i, targetEi: i, rowH: rect.height, label: ex.name, ghostLeft: rect.left, ghostWidth: rect.width, ghostY: rect.top })
              }}>⠿</span>
              <input className="cl-ex-name-input" placeholder="Exercise name"
                value={ex.name} onChange={e => updName(i, e.target.value)} />
              {!isOpen && hasData && <span className="ec-badge ec-badge--done">✓</span>}
              <button className="cl-chevron-btn" onClick={() => toggleEx(i)}>
                <span className="ec-chevron">{isOpen ? '▲' : '▼'}</span>
              </button>
              <button className="ex-remove" onClick={() => remEx(i)}>✕</button>
            </div>
            {isOpen && (
              <div className="ec-body">
                <div className="ec-grid">
                  <div className="ec-grid-head" style={{ gridTemplateColumns: '1fr 1fr 18px' }}>
                    <span>LBS</span><span>REPS</span><span/>
                  </div>
                  {ex.sets.map((s, si) => (
                    <div key={si} className="ec-grid-row" style={{ gridTemplateColumns: '1fr 1fr 18px' }}>
                      <input className="ec-grid-input" type="number" inputMode="decimal"
                        placeholder="0" value={s.weight} onChange={e => updSet(i, si, 'weight', e.target.value)} />
                      <input className="ec-grid-input" type="number" inputMode="numeric"
                        placeholder="0" value={s.reps} onChange={e => updSet(i, si, 'reps', e.target.value)} />
                      <button className="ec-rm" onClick={() => remSet(i, si)}
                        style={{ visibility: ex.sets.length > 1 ? 'visible' : 'hidden' }}>✕</button>
                    </div>
                  ))}
                </div>
                <div className="ec-log-footer">
                  <button className="ec-add-set" onClick={() => addSet(i)}>+ Set</button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      <button className="pf-add-day" onClick={addEx}>+ Exercise</button>
      <textarea className="form-input form-textarea" placeholder="Session notes (optional)…"
        value={notes} onChange={e => setNotes(e.target.value)} style={{ marginTop: 8 }} />
      {err && <p className="form-error">{err}</p>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <button className="connect-btn health-connect-btn" onClick={handleSave} disabled={saving} style={{ margin: 0 }}>
          {saving ? 'Saving…' : autoSavedIdRef.current ? 'Done' : 'Save Session'}
        </button>
        {autoSaveStatus === 'saving' && <span className="autosave-status">Saving…</span>}
        {autoSaveStatus === 'saved'  && <span className="autosave-status autosave-status--saved">Saved ✓</span>}
      </div>
      <button className="gym-cancel-link" onClick={onCancel}>Cancel</button>

      {dragState && createPortal(
        <div ref={ghostElRef} className="pdb-ghost"
          style={{ top: dragState.ghostY, left: dragState.ghostLeft, width: dragState.ghostWidth }}>
          <span className="pdb-handle">⠿</span>
          <span className="pdb-ghost-label">{dragState.label || 'Exercise'}</span>
        </div>, document.body
      )}
    </div>
  )
}

// PlanForm — create or edit a plan with days + exercises
function PlanForm({ plan, onBack, onSaved }) {
  const [name, setName] = useState(plan?.name || '')
  const [days, setDays] = useState(() =>
    (plan?.days || []).map(d => ({
      id: d.id, day_name: d.day_name,
      exercises: (d.exercises || []).map(e => ({
        id: e.id, exercise_name: e.exercise_name,
        target_sets: String(e.target_sets || ''), target_reps: e.target_reps || '',
      })),
    }))
  )
  const deletedDayIds  = useRef([])
  const deletedExIds   = useRef([])
  const [saving, setSaving]         = useState(false)
  const [err, setErr]               = useState(null)
  const [collapsedDays, setCollapsedDays] = useState(() => new Set((plan?.days || []).map((_, i) => i)))
  const toggleDay = (di) => setCollapsedDays(s => { const n = new Set(s); n.has(di) ? n.delete(di) : n.add(di); return n })

  const ghostElRef  = useRef(null)
  const exRowRefs   = useRef({})
  const dragRef     = useRef(null) // { di, fromEi, targetEi, offsetY, rowH, origCenters }
  const [dragState, setDragState] = useState(null)
  // dragState: { di, fromEi, targetEi, rowH, label, ghostLeft, ghostWidth, ghostY }

  const isDragging = dragState !== null
  useEffect(() => {
    if (!isDragging) return
    const onMove = (e) => {
      const clientY = e.touches?.[0]?.clientY ?? e.clientY
      if (e.cancelable) e.preventDefault()
      const dr = dragRef.current
      if (!dr) return
      // Smooth ghost follow via direct DOM
      if (ghostElRef.current) ghostElRef.current.style.top = `${clientY - dr.offsetY}px`
      // Compute new targetEi from original centers
      const ghostCenterY = clientY - dr.offsetY + dr.rowH / 2
      const n = Object.keys(dr.origCenters).length
      let newTarget = n - 1
      for (let i = 0; i < n; i++) {
        if (ghostCenterY < dr.origCenters[i]) { newTarget = i; break }
      }
      newTarget = Math.max(0, Math.min(n - 1, newTarget))
      if (newTarget !== dr.targetEi) {
        dr.targetEi = newTarget
        setDragState(s => s ? { ...s, targetEi: newTarget } : null)
      }
    }
    const onUp = () => {
      const dr = dragRef.current
      if (dr && dr.fromEi !== dr.targetEi) reorderExercise(dr.di, dr.fromEi, dr.targetEi)
      setDragState(null)
      dragRef.current = null
    }
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup',   onUp)
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
  }, [isDragging])

  const addDay         = () => setDays(d => [...d, { day_name: '', exercises: [] }])
  const removeDay      = (i) => { const id = days[i].id; if (id) deletedDayIds.current.push(id); setDays(d => d.filter((_, j) => j !== i)) }
  const updateDay      = (i, val) => setDays(d => d.map((day, j) => j === i ? { ...day, day_name: val } : day))
  const addExercise    = (di) => setDays(d => d.map((day, j) => j === di ? { ...day, exercises: [...day.exercises, { exercise_name: '', target_sets: '', target_reps: '' }] } : day))
  const removeExercise = (di, ei) => { const id = days[di].exercises[ei].id; if (id) deletedExIds.current.push(id); setDays(d => d.map((day, j) => j === di ? { ...day, exercises: day.exercises.filter((_, k) => k !== ei) } : day)) }
  const updateExercise = (di, ei, field, val) => setDays(d => d.map((day, j) => j === di ? { ...day, exercises: day.exercises.map((ex, k) => k === ei ? { ...ex, [field]: val } : ex) } : day))
  const reorderExercise = (di, fromEi, toEi) => {
    if (fromEi === toEi) return
    setDays(d => d.map((day, j) => {
      if (j !== di) return day
      const exs = [...day.exercises]
      const [moved] = exs.splice(fromEi, 1)
      exs.splice(toEi, 0, moved)
      return { ...day, exercises: exs }
    }))
  }

  const post  = (url, body) => fetch(url, { method: 'POST',  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json())
  const patch = (url, body) => fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const del   = (url)       => fetch(url, { method: 'DELETE' })

  const handleSave = async () => {
    setErr(null)
    if (!name.trim()) { setErr('Plan name is required'); return }
    setSaving(true)
    try {
      let planId = plan?.id
      if (plan) { await patch(`/api/gym/plans/${planId}`, { name: name.trim() }) }
      else       { const res = await post('/api/gym/plans', { name: name.trim() }); if (res.error) throw new Error(res.error); planId = res.id }
      for (const id of deletedDayIds.current) await del(`/api/gym/days/${id}`)
      for (const id of deletedExIds.current)  await del(`/api/gym/exercises/${id}`)
      for (let di = 0; di < days.length; di++) {
        const day = days[di]
        if (!day.day_name.trim()) continue
        let dayId = day.id
        if (dayId) { await patch(`/api/gym/days/${dayId}`, { day_name: day.day_name, day_order: di }) }
        else        { const res = await post(`/api/gym/plans/${planId}/days`, { day_name: day.day_name, day_order: di }); if (res.error) throw new Error(res.error); dayId = res.id }
        for (let ei = 0; ei < day.exercises.length; ei++) {
          const ex = day.exercises[ei]
          if (!ex.exercise_name.trim()) continue
          const exData = { exercise_name: ex.exercise_name.trim(), target_sets: parseInt(ex.target_sets) || null, target_reps: ex.target_reps.trim() || null, order: ei }
          if (ex.id) await patch(`/api/gym/exercises/${ex.id}`, exData)
          else       await post(`/api/gym/days/${dayId}/exercises`, exData)
        }
      }
      onSaved()
    } catch (e) { setErr(e.message || 'Save failed') }
    finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!plan) return
    // eslint-disable-next-line no-restricted-globals
    if (!confirm(`Delete "${plan.name}"? This cannot be undone.`)) return
    await del(`/api/gym/plans/${plan.id}`)
    onSaved()
  }

  return (
    <div>
      {/* Header: Back | Title | Save */}
      <div className="pf-header">
        <button className="pf-back" onClick={onBack}>{'<'} Back</button>
        <span className="pf-title">{plan ? 'Editing' : 'New Plan'}</span>
        <button className="pf-save" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <input className="form-input pf-plan-name" placeholder="Plan name (e.g. Push Pull Legs)"
        value={name} onChange={e => setName(e.target.value)} />

      {days.map((day, di) => {
        const isCollapsed = collapsedDays.has(di)
        return (
        <div key={di} className="plan-day-block">
          <div className="pdb-header">
            <button className="pdb-toggle" onClick={() => toggleDay(di)}>
              <span className="pdb-chevron">{isCollapsed ? '▶' : '▼'}</span>
            </button>
            <div className="pdb-name-wrap">
              <input className="pdb-name-input" placeholder="Day name (e.g. Push)"
                value={day.day_name} onChange={e => updateDay(di, e.target.value)} />
              {day.exercises.length > 0 && (
                <span className="pdb-ex-count">{day.exercises.length} {day.exercises.length === 1 ? 'exercise' : 'exercises'}</span>
              )}
            </div>
            <button className="ex-remove" onClick={() => removeDay(di)}>✕</button>
          </div>
          {!isCollapsed && day.exercises.map((ex, ei) => {
            let rowTransform = 'none', rowOpacity = 1
            if (dragState && dragState.di === di) {
              const { fromEi, targetEi, rowH } = dragState
              if (ei === fromEi) { rowOpacity = 0.25 }
              else if (fromEi < targetEi && ei > fromEi && ei <= targetEi) { rowTransform = `translateY(-${rowH}px)` }
              else if (fromEi > targetEi && ei >= targetEi && ei < fromEi) { rowTransform = `translateY(${rowH}px)` }
            }
            return (
              <div key={ex.id ?? `new-${ei}`}
                ref={el => exRowRefs.current[`${di}-${ei}`] = el}
                className="pdb-ex-row"
                style={{ transform: rowTransform, opacity: rowOpacity, transition: dragState ? 'transform 150ms ease, opacity 150ms ease' : 'none' }}>
                <span className="pdb-handle"
                  onPointerDown={(e) => {
                    e.preventDefault()
                    const row = e.currentTarget.closest('.pdb-ex-row')
                    const rect = row.getBoundingClientRect()
                    const dayLen = days[di].exercises.length
                    const origCenters = {}
                    for (let i = 0; i < dayLen; i++) {
                      const el = exRowRefs.current[`${di}-${i}`]
                      if (el) { const r = el.getBoundingClientRect(); origCenters[i] = r.top + r.height / 2 }
                    }
                    dragRef.current = { di, fromEi: ei, targetEi: ei, offsetY: e.clientY - rect.top, rowH: rect.height, origCenters }
                    setDragState({ di, fromEi: ei, targetEi: ei, rowH: rect.height, label: ex.exercise_name, ghostLeft: rect.left, ghostWidth: rect.width, ghostY: rect.top })
                  }}>⠿</span>
                <input className="form-input pdb-ex-name" placeholder="Exercise name"
                  value={ex.exercise_name} onChange={e => updateExercise(di, ei, 'exercise_name', e.target.value)} />
                <button className="ex-remove" onClick={() => removeExercise(di, ei)}>✕</button>
              </div>
            )
          })}
          {!isCollapsed && <button className="add-ex-btn" onClick={() => addExercise(di)}>+ Exercise</button>}
        </div>
        )
      })}

      <button className="pf-add-day" onClick={addDay}>+ Add Day</button>

      {err && <p className="form-error" style={{ marginTop: 8 }}>{err}</p>}

      {plan && (
        <button className="pf-delete" onClick={handleDelete}>Delete Plan</button>
      )}

      {dragState && createPortal(
        <div ref={ghostElRef} className="pdb-ghost"
          style={{ top: dragState.ghostY, left: dragState.ghostLeft, width: dragState.ghostWidth }}>
          <span className="pdb-handle">⠿</span>
          <span className="pdb-ghost-label">{dragState.label || 'Exercise'}</span>
        </div>,
        document.body
      )}
    </div>
  )
}

// GymLogView — date-centric logging tab
function GymLogView({ plansHook, logsHook, saving, onSave, onDelete, date, onDateChange }) {
  const [mode, setMode] = useState(null)
  const existingLog     = logsHook.logs.find(l => l.date === date)

  const handleDateChange = (d) => { onDateChange(d); setMode(null) }
  const handleSave       = async (data, replaceId) => { const err = await onSave(data, replaceId); if (!err) setMode(null); return err }
  const handleDone       = () => { logsHook.refetch(); setMode(null) }
  const handleAutoSave   = async (data, prevId) => {
    try {
      if (prevId) await fetch(`/api/gym/logs/${prevId}`, { method: 'DELETE' })
      const res  = await fetch('/api/gym/logs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      const json = await res.json()
      if (json.error || !json.id) return null
      return json.id
    } catch { return null }
  }

  return (
    <div>
      <div className="gym-date-nav">
        <button className="hnav-btn" onClick={() => handleDateChange(offsetDate(date, -1))}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span className="gym-date-label">{fmtDateLabel(date)}</span>
        <button className="hnav-btn" onClick={() => handleDateChange(offsetDate(date, +1))} disabled={date >= todayStr()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>

      {existingLog && mode !== 'edit' ? (
        <LoggedWorkout log={existingLog} onDelete={onDelete} onEdit={() => setMode('edit')} />
      ) : existingLog && mode === 'edit' ? (
        <CustomLogger date={date} onSave={(data) => handleSave(data, existingLog.id)} onAutoSave={handleAutoSave} onDone={handleDone} saving={saving} onCancel={() => setMode(null)} initialData={existingLog} />
      ) : mode === 'plan' ? (
        plansHook.plans.length === 0
          ? <p className="health-empty">No plans yet — create one in the Plans tab.</p>
          : <PlanDayLogger plans={plansHook.plans} date={date} onSave={handleSave} onAutoSave={handleAutoSave} onDone={handleDone} saving={saving} onCancel={() => setMode(null)} />
      ) : mode === 'custom' ? (
        <CustomLogger date={date} onSave={handleSave} onAutoSave={handleAutoSave} onDone={handleDone} saving={saving} onCancel={() => setMode(null)} />
      ) : (
        <div className="gym-log-options">
          <button className="gym-log-opt" onClick={() => setMode('plan')}>
            <span className="glo-icon">📋</span>
            <div className="glo-text">
              <span className="glo-label">Use a Plan</span>
              <span className="glo-sub">Pick a plan + day</span>
            </div>
          </button>
          <button className="gym-log-opt" onClick={() => setMode('custom')}>
            <span className="glo-icon">✏️</span>
            <div className="glo-text">
              <span className="glo-label">Custom Workout</span>
              <span className="glo-sub">Add exercises freely</span>
            </div>
          </button>
          <button className="gym-log-opt gym-log-opt--rest" disabled={saving}
            onClick={() => onSave({ date, day_name: 'Rest', notes: null, exercises: [] })}>
            <span className="glo-icon">😴</span>
            <div className="glo-text">
              <span className="glo-label">Rest Day</span>
              <span className="glo-sub">Mark as rest</span>
            </div>
          </button>
        </div>
      )}
    </div>
  )
}

// GymPlansView — manage plans
function GymPlansView({ plansHook }) {
  const [editing, setEditing] = useState(undefined)
  const { plans, loading }    = plansHook

  const setActive = async (planId) => {
    await fetch(`/api/gym/plans/${planId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: true }) })
    plansHook.refetch()
  }

  if (editing !== undefined) {
    return <PlanForm plan={editing || null} onBack={() => setEditing(undefined)} onSaved={() => { plansHook.refetch(); setEditing(undefined) }} />
  }

  return (
    <div>
      <button className="plans-fab" onClick={() => setEditing(null)}>+</button>
      {loading && <div className="health-empty">Loading…</div>}
      {!loading && plans.length === 0 && (
        <div className="health-empty">No plans yet — tap + to get started.</div>
      )}
      {plans.map(p => (
        <div key={p.id} className="card plan-row">
          <div className="plan-row-left">
            <span className="plan-row-name">{p.name}</span>
            <span className="plan-row-meta">
              {(p.days || []).length} days · {(p.days || []).reduce((s, d) => s + d.exercises.length, 0)} ex
            </span>
          </div>
          <div className="plan-row-right">
            {p.is_active
              ? <span className="plan-active-badge">Active</span>
              : <button className="plan-activate-btn" onClick={() => setActive(p.id)}>Set Active</button>
            }
            <button className="action-btn" onClick={() => setEditing(p)}>Edit</button>
          </div>
        </div>
      ))}
    </div>
  )
}

// GymTab — week strip + LOG | PLANS tabs
function GymTab() {
  const plansHook = usePlans()
  const logsHook  = useWorkoutLogs()
  const [tab,    setTab]    = useState('log')
  const [saving, setSaving] = useState(false)
  const [date,   setDate]   = useState(todayStr())

  const saveSession = async (data, replaceId = null) => {
    setSaving(true)
    try {
      if (replaceId) await fetch(`/api/gym/logs/${replaceId}`, { method: 'DELETE' })
      const res  = await fetch('/api/gym/logs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      await logsHook.refetch()
      return null
    } catch (e) { return e.message || 'Save failed' }
    finally { setSaving(false) }
  }

  const deleteLog = async (id) => {
    await fetch(`/api/gym/logs/${id}`, { method: 'DELETE' })
    logsHook.refetch()
  }

  return (
    <div className="health-scroll">
      <div className="page-section">
        <WeekStrip logs={logsHook.logs} date={date} onDateChange={setDate} />
      </div>

      <div className="gym-subtabs">
        <button className={`gym-subtab${tab === 'log' ? ' active' : ''}`} onClick={() => setTab('log')}>Log</button>
        <button className={`gym-subtab${tab === 'plans' ? ' active' : ''}`} onClick={() => setTab('plans')}>Plans</button>
      </div>

      <div className="page-section">
        {tab === 'log'
          ? <GymLogView plansHook={plansHook} logsHook={logsHook} saving={saving} onSave={saveSession} onDelete={deleteLog} date={date} onDateChange={setDate} />
          : <GymPlansView plansHook={plansHook} />
        }
      </div>
    </div>
  )
}


// â”€â”€ ACTIVITY TAB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function ActivityTab({ oura, date }) {
  const { data } = oura
  const activity = data?.activity
  const stepsGoal = 10000
  const stepsPct  = activity?.steps ? Math.min(100, Math.round((activity.steps / stepsGoal) * 100)) : 0

  return (
    <div className="health-scroll">

      <section className="page-section">
        <div className="card detail-card">
          {/* Steps */}
          <div style={{ padding: '12px 16px 14px', borderBottom: '1px solid var(--border)' }}>
            <div className="detail-row" style={{ padding: 0, borderBottom: 'none' }}>
              <span className="detail-label">Steps</span>
              <span className="detail-value" style={{ color: scoreColor(activity?.score) }}>
                {activity?.steps != null ? activity.steps.toLocaleString() : '—'}
              </span>
            </div>
            <div className="progress-bar" style={{ marginTop: 8 }}>
              <div className="progress-fill" style={{ width: `${stepsPct}%`, background: scoreColor(activity?.score) }} />
            </div>
            <span className="steps-goal">{stepsPct}% of {stepsGoal.toLocaleString()} goal</span>
          </div>

          {activity?.walking_miles != null && (
            <div className="detail-row">
              <span className="detail-label">Distance</span>
              <span className="detail-value">{activity.walking_miles} mi</span>
            </div>
          )}
          {activity?.active_calories != null && (
            <div className="detail-row">
              <span className="detail-label">Active Calories</span>
              <span className="detail-value">{activity.active_calories} kcal</span>
            </div>
          )}
          {activity?.total_calories != null && (
            <div className="detail-row">
              <span className="detail-label">Total Calories</span>
              <span className="detail-value">{activity.total_calories} kcal</span>
            </div>
          )}
        </div>
      </section>

      {/* Activity breakdown */}
      {(activity?.high_minutes != null || activity?.medium_minutes != null) && (
        <section className="page-section">
          <h2 className="section-title">Activity Breakdown</h2>
          <div className="card detail-card">
            {activity.high_minutes != null && (
              <div className="detail-row">
                <span className="detail-label">High Activity</span>
                <span className="detail-value" style={{ color: '#ff3864' }}>{activity.high_minutes} min</span>
              </div>
            )}
            {activity.medium_minutes != null && (
              <div className="detail-row">
                <span className="detail-label">Medium Activity</span>
                <span className="detail-value" style={{ color: '#ffe600' }}>{activity.medium_minutes} min</span>
              </div>
            )}
            {activity.low_minutes != null && (
              <div className="detail-row">
                <span className="detail-label">Low Activity</span>
                <span className="detail-value">{activity.low_minutes} min</span>
              </div>
            )}
            {activity.non_wear != null && (
              <div className="detail-row">
                <span className="detail-label">Non-Wear</span>
                <span className="detail-value" style={{ color: 'var(--text-muted)' }}>{activity.non_wear} min</span>
              </div>
            )}
          </div>
        </section>
      )}

      {!data && !loading && (
        <div className="health-empty" style={{ margin: '0 16px' }}>No activity data for this day.</div>
      )}
    </div>
  )
}

// â”€â”€ TRENDS TAB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function TrendsTab({ weekData, logs }) {
  const last30 = (weekData || []).slice(-30)
  const last7  = last30.slice(-7)

  // Charts
  const readinessItems = last7.map(d => ({ label: new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'narrow' }), value: d.readiness_score, color: scoreColor(d.readiness_score) }))
  const sleepItems     = last7.map(d => ({ label: new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'narrow' }), value: d.sleep_score, color: scoreColor(d.sleep_score) }))
  const activityItems  = last7.map(d => ({ label: new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'narrow' }), value: d.activity_score, color: scoreColor(d.activity_score) }))

  // 30-day avgs
  const avg = (arr, key) => {
    const vals = arr.map(d => d[key]).filter(v => v != null)
    return vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null
  }
  const avgReadiness = avg(last30, 'readiness_score')
  const avgSleep     = avg(last30, 'sleep_score')
  const avgActivity  = avg(last30, 'activity_score')

  // Best day of week (by readiness)
  const byDow = {}
  for (const d of last30) {
    if (d.readiness_score == null) continue
    const dow = new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' })
    if (!byDow[dow]) byDow[dow] = []
    byDow[dow].push(d.readiness_score)
  }
  const dowAvgs = Object.entries(byDow).map(([day, scores]) => ({ day, avg: Math.round(scores.reduce((s,v) => s+v, 0) / scores.length) }))
  const bestDay  = dowAvgs.sort((a, b) => b.avg - a.avg)[0]
  const worstDay = dowAvgs.sort((a, b) => a.avg - b.avg)[0]

  // Gym correlation: readiness on workout days vs rest days (using new workout_logs)
  const workoutDates = new Set((logs || []).map(l => l.date))
  const rdOnWorkout  = last30.filter(d => workoutDates.has(d.date) && d.readiness_score != null).map(d => d.readiness_score)
  const rdOnRest     = last30.filter(d => !workoutDates.has(d.date) && d.readiness_score != null).map(d => d.readiness_score)
  const avgRdWorkout = rdOnWorkout.length ? Math.round(rdOnWorkout.reduce((s,v) => s+v, 0) / rdOnWorkout.length) : null
  const avgRdRest    = rdOnRest.length    ? Math.round(rdOnRest.reduce((s,v) => s+v, 0) / rdOnRest.length) : null

  return (
    <div className="health-scroll">

      {/* 30-day averages */}
      <section className="page-section">
        <h2 className="section-title">30-Day Averages</h2>
        <div className="card detail-card">
          <div className="detail-row">
            <span className="detail-label">Readiness</span>
            <span className="detail-value" style={{ color: scoreColor(avgReadiness) }}>{avgReadiness ?? '—'}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Sleep Score</span>
            <span className="detail-value" style={{ color: scoreColor(avgSleep) }}>{avgSleep ?? '—'}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Activity</span>
            <span className="detail-value" style={{ color: scoreColor(avgActivity) }}>{avgActivity ?? '—'}</span>
          </div>
        </div>
      </section>

      {/* 7-day charts */}
      {readinessItems.length > 0 && (
        <section className="page-section">
          <h2 className="section-title">7-Day Readiness</h2>
          <div className="card" style={{ padding: '16px' }}><BarChart items={readinessItems} /></div>
        </section>
      )}
      {sleepItems.length > 0 && (
        <section className="page-section">
          <h2 className="section-title">7-Day Sleep Score</h2>
          <div className="card" style={{ padding: '16px' }}><BarChart items={sleepItems} /></div>
        </section>
      )}
      {activityItems.length > 0 && (
        <section className="page-section">
          <h2 className="section-title">7-Day Activity</h2>
          <div className="card" style={{ padding: '16px' }}><BarChart items={activityItems} /></div>
        </section>
      )}

      {/* Day of week insights */}
      {bestDay && worstDay && bestDay.day !== worstDay.day && (
        <section className="page-section">
          <h2 className="section-title">Patterns</h2>
          <div className="card insight-card" style={{ marginBottom: 8 }}>
            <span className="insight-icon">📈</span>
            <span className="insight-text">Your best recovery day is <strong>{bestDay.day}</strong> (avg {bestDay.avg})</span>
          </div>
          <div className="card insight-card" style={{ marginBottom: 8 }}>
            <span className="insight-icon">📉</span>
            <span className="insight-text">Watch out on <strong>{worstDay.day}</strong> — lowest avg readiness ({worstDay.avg})</span>
          </div>
          {avgRdWorkout != null && avgRdRest != null && (
            <div className="card insight-card">
              <span className="insight-icon">🏋️</span>
              <span className="insight-text">
                Readiness on gym days: <strong style={{color: scoreColor(avgRdWorkout)}}>{avgRdWorkout}</strong> vs rest days: <strong style={{color: scoreColor(avgRdRest)}}>{avgRdRest}</strong>
              </span>
            </div>
          )}
        </section>
      )}

      {!weekData && (
        <div className="health-empty" style={{ margin: '0 16px' }}>Loading trend data…</div>
      )}
    </div>
  )
}

// â”€â”€ Connect screen â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function ConnectScreen({ onConnect, loading, error }) {
  const [token, setToken] = useState('')
  return (
    <div className="connect-screen">
      <div className="connect-icon health-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 21C12 21 3 14 3 8a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6-9 13-9 13z"/>
        </svg>
      </div>
      <h2 className="connect-title">Connect Oura Ring</h2>
      <p className="connect-sub">Paste your Personal Access Token to sync readiness, sleep, and activity data.</p>
      <div className="token-steps">
        <span className="token-step">1. Go to <strong>cloud.ouraring.com/personal-access-tokens</strong></span>
        <span className="token-step">2. Create a token and paste it below</span>
      </div>
      <input className="token-input" type="password" value={token} onChange={e => setToken(e.target.value)}
        placeholder="Paste your token here…" autoCapitalize="none" autoCorrect="off" />
      {error && <p className="connect-error">{error}</p>}
      <button className="connect-btn health-connect-btn" onClick={() => onConnect(token)}
        disabled={loading || !token.trim()}>
        {loading ? 'Connecting…' : 'Connect'}
      </button>
    </div>
  )
}

// â”€â”€ Main â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function Health() {
  const [tab,            setTab]           = useState('today')
  const [linked,         setLinked]        = useState(() => !!localStorage.getItem('aaron_oura_linked'))
  const [connectLoading, setConnectLoading] = useState(false)
  const [connectError,   setConnectError]   = useState(null)
  const [date,           setDate]           = useState(todayStr())

  const oura     = useOuraToday(linked, date)
  const weekData = useOuraWeek(linked)
  const logsHook = useWorkoutLogs()

  // Always verify connection on mount so all devices stay in sync
  useEffect(() => {
    fetch('/api/oura/status').then(r => r.json()).then(d => {
      if (d.linked) { localStorage.setItem('aaron_oura_linked', '1'); setLinked(true) }
      else { localStorage.removeItem('aaron_oura_linked'); setLinked(false) }
    }).catch(() => {})
  }, []) // eslint-disable-line

  async function handleConnect(token) {
    setConnectLoading(true); setConnectError(null)
    try {
      const res  = await fetch('/api/oura/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      localStorage.setItem('aaron_oura_linked', '1')
      setLinked(true)
    } catch (e) { setConnectError(e.message) }
    finally { setConnectLoading(false) }
  }

  if (!linked) return <ConnectScreen onConnect={handleConnect} loading={connectLoading} error={connectError} />

  const showDateNav = tab === 'today' || tab === 'sleep' || tab === 'activity'

  return (
    <div className="page health-page">
      <div className="health-topbar">
        <HealthTabs tab={tab} setTab={setTab} />
      </div>

      {showDateNav && (
        <DateNav date={date} setDate={setDate} onSync={oura.refetch} syncing={oura.loading} />
      )}

      {tab === 'today'    && <TodayTab    oura={oura}    logs={logsHook.logs} date={date} onOpenGym={() => setTab('gym')} />}
      {tab === 'sleep'    && <SleepTab    oura={oura}    weekData={weekData}  date={date} />}
      {tab === 'gym'      && <GymTab />}
      {tab === 'activity' && <ActivityTab oura={oura}    date={date} />}
      {tab === 'trends'   && <TrendsTab   weekData={weekData} logs={logsHook.logs} />}
    </div>
  )
}
