import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import './Page.css'
import './Health.css'

// ── Date helpers ──────────────────────────────────────────────────────────────

function todayStr() { return new Date().toISOString().slice(0, 10) }

function offsetDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
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
  return d.toISOString().slice(0, 10)
}

// ── Score helpers ─────────────────────────────────────────────────────────────

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

function readinessInsight(score) {
  if (score == null) return 'Sync your ring to see today\'s readiness.'
  if (score >= 85) return 'Fully recovered. Great day to train hard 💪'
  if (score >= 70) return 'Good recovery. Normal training is fine'
  if (score >= 50) return 'Moderate recovery. Keep it light today'
  return 'Low recovery. Rest day recommended 😴'
}

function sleepInsight(hours, score) {
  if (hours != null && hours < 6)  return 'Short sleep. Prioritize rest tonight.'
  if (hours != null && hours >= 8) return 'Great sleep duration. Well rested.'
  if (score != null && score >= 85) return 'Excellent sleep quality.'
  if (score != null && score < 60)  return 'Low sleep quality. Try an earlier bedtime.'
  return 'Decent sleep. Aim for 7-9 hours consistently.'
}

// ── Gym helpers ───────────────────────────────────────────────────────────────

const WORKOUT_TYPES = ['Push', 'Pull', 'Legs', 'Full Body', 'Cardio', 'Rest']
const INTENSITY_OPTS = ['Light', 'Moderate', 'Heavy']

function calcStreak(workouts) {
  let streak = 0
  let d = todayStr()
  for (let i = 0; i < 90; i++) {
    const has = workouts.some(w => w.date === d && w.type !== 'Rest')
    if (has) { streak++; d = offsetDate(d, -1) }
    else if (i === 0) { d = offsetDate(d, -1) }  // today not yet logged, check yesterday
    else break
  }
  return streak
}

function calcWeekFreq(workouts) {
  const start = getWeekStart()
  return workouts.filter(w => w.date >= start && w.date <= todayStr() && w.type !== 'Rest').length
}

function calcPRs(workouts) {
  const prs = {}
  for (const w of workouts) {
    for (const ex of (w.exercises || [])) {
      const name = (ex.name || '').trim()
      if (!name) continue
      for (const set of (ex.sets || [])) {
        const wt = parseFloat(set.weight) || 0
        if (wt > 0 && (!prs[name] || wt > prs[name])) prs[name] = wt
      }
    }
  }
  return Object.entries(prs).sort((a, b) => a[0].localeCompare(b[0]))
}

// ── Data hooks ────────────────────────────────────────────────────────────────

function useOuraToday(linked, date) {
  const cacheKey = `aaron_health_${date}`
  const [data, setData]       = useState(() => {
    try { return JSON.parse(localStorage.getItem(cacheKey) || 'null') } catch { return null }
  })
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  const fetch_ = useCallback(async (d) => {
    setLoading(true); setError(null)
    try {
      const res  = await fetch(`/api/oura/today?date=${d}`)
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setData(json)
      localStorage.setItem(`aaron_health_${d}`, JSON.stringify(json))
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (!linked) return
    // Use cached data instantly, then refresh in background
    const cached = localStorage.getItem(`aaron_health_${date}`)
    if (cached) { try { setData(JSON.parse(cached)) } catch { /* ignore */ } }
    fetch_(date)
  }, [linked, date, fetch_])

  return { data, loading, error, refetch: () => fetch_(date) }
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

function useGymData() {
  const [workouts, setWorkouts] = useState(() => {
    try { return JSON.parse(localStorage.getItem('aaron_gym_workouts') || '[]') } catch { return [] }
  })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res  = await fetch('/api/gym/workouts?limit=90')
      const json = await res.json()
      if (!json.error && Array.isArray(json)) {
        setWorkouts(json)
        localStorage.setItem('aaron_gym_workouts', JSON.stringify(json))
      }
    } catch { /* server offline */ }
  }, [])

  useEffect(() => { load() }, [load])

  const addWorkout = async (workout) => {
    setSaving(true)
    try {
      const res  = await fetch('/api/gym/workouts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workout),
      })
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      await load()
      return true
    } catch (e) { return e.message || 'Save failed' }
    finally { setSaving(false) }
  }

  const deleteWorkout = async (id) => {
    try {
      await fetch(`/api/gym/workouts/${id}`, { method: 'DELETE' })
      await load()
    } catch { /* ignore */ }
  }

  return { workouts, saving, addWorkout, deleteWorkout, refetch: load }
}

function usePlans() {
  const [plans, setPlans] = useState(() => {
    try { return JSON.parse(localStorage.getItem('aaron_gym_plans') || '[]') } catch { return [] }
  })
  const save        = (list) => { setPlans(list); localStorage.setItem('aaron_gym_plans', JSON.stringify(list)) }
  const addPlan    = (plan) => save([...plans, { ...plan, id: Date.now().toString() }])
  const updatePlan = (id, plan) => save(plans.map(p => p.id === id ? { ...plan, id } : p))
  const deletePlan = (id) => save(plans.filter(p => p.id !== id))
  return { plans, addPlan, updatePlan, deletePlan }
}

// ── SVG Components ────────────────────────────────────────────────────────────

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

// ── Tab bar ───────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'today',    label: 'Today' },
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

// ── Date nav ──────────────────────────────────────────────────────────────────

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

// ── TODAY TAB ─────────────────────────────────────────────────────────────────

function TodayTab({ oura, gymData, date, setDate }) {
  const { data, loading, error, refetch } = oura
  const { workouts } = gymData
  const { readiness, sleep, activity, workout_today } = data || {}
  const streak = calcStreak(workouts)
  const rColor = scoreColor(readiness?.score)

  return (
    <div className="health-scroll">
      <DateNav date={date} setDate={setDate} onSync={refetch} syncing={loading} />

      {error && <div className="health-error" style={{margin:'12px 16px'}}>{error}</div>}

      {/* Readiness hero */}
      <section className="page-section">
        <div className="card readiness-hero">
          <div className="rh-ring">
            <ScoreRing score={readiness?.score ?? null} color={rColor} size={100} />
          </div>
          <div className="rh-info">
            <span className="rh-label">Readiness</span>
            <span className="rh-insight">{readinessInsight(readiness?.score)}</span>
          </div>
        </div>
      </section>

      {/* Metrics grid */}
      <section className="page-section">
        <div className="metrics-grid">
          <MetricTile label="Sleep" value={fmtHrs(sleep?.total_hours)} sub={sleep?.score != null ? `Score ${sleep.score}` : null} color={scoreColor(sleep?.score)} />
          <MetricTile label="Steps" value={activity?.steps != null ? activity.steps.toLocaleString() : '—'} sub={activity?.steps != null ? `${Math.round((activity.steps/10000)*100)}% of goal` : null} color={scoreColor(activity?.score)} />
          <MetricTile label="Active Cal" value={activity?.active_calories != null ? `${activity.active_calories}` : '—'} sub="kcal" />
          <MetricTile label="Total Cal" value={activity?.total_calories != null ? `${activity.total_calories}` : '—'} sub="kcal" />
          <MetricTile label="Resting HR" value={sleep?.resting_hr != null ? `${sleep.resting_hr}` : '—'} sub="bpm" />
          <MetricTile label="HRV" value={sleep?.avg_hrv != null ? `${Math.round(sleep.avg_hrv)}` : '—'} sub="ms" />
        </div>
      </section>

      {/* Gym today */}
      <section className="page-section">
        <div className="card gym-today-card">
          <div className="gtc-left">
            <span className="gtc-title">Gym Today</span>
            <span className="gtc-streak">{streak > 0 ? `🔥 ${streak} day streak` : 'No streak yet'}</span>
          </div>
          <div className="gtc-right">
            <span className={`gtc-status ${workout_today ? 'done' : 'pending'}`}>
              {workout_today ? '✓ Done' : '— Not logged'}
            </span>
          </div>
        </div>
      </section>

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

// ── SLEEP TAB ─────────────────────────────────────────────────────────────────

function SleepTab({ oura, weekData, date, setDate }) {
  const { data, loading, refetch } = oura
  const sleep = data?.sleep

  // 7-day trend from weekData
  const last7 = (weekData || []).slice(-7)
  const chartItems = last7.map(d => ({
    label: new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'narrow' }),
    value: d.sleep_score,
    color: scoreColor(d.sleep_score),
  }))

  const avgHours = last7.filter(d => d.sleep_hours).reduce((s, d, _, a) => s + d.sleep_hours / a.length, 0)
  const sleepDebt = Math.max(0, 8 - avgHours)

  const sleepTotal = (sleep?.deep_hours || 0) + (sleep?.rem_hours || 0) + (sleep?.light_hours || 0)

  return (
    <div className="health-scroll">
      <DateNav date={date} setDate={setDate} onSync={refetch} syncing={loading} />

      {/* Sleep card */}
      <section className="page-section">
        <div className="card detail-card">
          <div className="detail-row">
            <span className="detail-label">Total Sleep</span>
            <span className="detail-value" style={{ color: scoreColor(sleep?.score) }}>{fmtHrs(sleep?.total_hours)}</span>
          </div>
          {(sleep?.bedtime || sleep?.wake_time) && (
            <div className="detail-row">
              <span className="detail-label">Bedtime → Wake</span>
              <span className="detail-value">{sleep?.bedtime ?? '—'} → {sleep?.wake_time ?? '—'}</span>
            </div>
          )}
          <div className="detail-row">
            <span className="detail-label">Sleep Score</span>
            <span className="detail-value" style={{ color: scoreColor(sleep?.score) }}>{sleep?.score ?? '—'}</span>
          </div>
          {sleep?.efficiency != null && (
            <div className="detail-row">
              <span className="detail-label">Efficiency</span>
              <span className="detail-value">{sleep.efficiency}%</span>
            </div>
          )}
          {sleep?.avg_hrv != null && (
            <div className="detail-row">
              <span className="detail-label">Avg HRV</span>
              <span className="detail-value">{Math.round(sleep.avg_hrv)} ms</span>
            </div>
          )}
          {sleep?.resting_hr != null && (
            <div className="detail-row">
              <span className="detail-label">Lowest HR</span>
              <span className="detail-value">{sleep.resting_hr} bpm</span>
            </div>
          )}

          {sleepTotal > 0 && (
            <div className="sleep-breakdown">
              <div className="sleep-bar">
                {sleep.deep_hours  > 0 && <div className="sleep-seg deep"  style={{ flex: sleep.deep_hours }} />}
                {sleep.rem_hours   > 0 && <div className="sleep-seg rem"   style={{ flex: sleep.rem_hours }} />}
                {sleep.light_hours > 0 && <div className="sleep-seg light" style={{ flex: sleep.light_hours }} />}
                {sleep.awake_hours > 0 && <div className="sleep-seg awake" style={{ flex: sleep.awake_hours }} />}
              </div>
              <div className="sleep-legend">
                <span className="legend-item"><span className="legend-dot deep-dot" />Deep {fmtHrs(sleep.deep_hours)}</span>
                <span className="legend-item"><span className="legend-dot rem-dot" />REM {fmtHrs(sleep.rem_hours)}</span>
                <span className="legend-item"><span className="legend-dot light-dot" />Light {fmtHrs(sleep.light_hours)}</span>
                {sleep.awake_hours > 0 && <span className="legend-item"><span className="legend-dot awake-dot" />Awake {fmtHrs(sleep.awake_hours)}</span>}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Insight */}
      <section className="page-section">
        <div className="card insight-card">
          <span className="insight-icon">💤</span>
          <span className="insight-text">{sleepInsight(sleep?.total_hours, sleep?.score)}</span>
        </div>
      </section>

      {/* 7-day chart */}
      {chartItems.length > 0 && (
        <section className="page-section">
          <h2 className="section-title">7-Day Sleep Score</h2>
          <div className="card" style={{ padding: '16px' }}>
            <BarChart items={chartItems} height={60} />
          </div>
        </section>
      )}

      {/* Weekly stats */}
      {last7.length > 0 && (
        <section className="page-section">
          <div className="card detail-card">
            <div className="detail-row">
              <span className="detail-label">Weekly Avg</span>
              <span className="detail-value">{fmtHrs(avgHours || null)}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Sleep Debt</span>
              <span className="detail-value" style={{ color: sleepDebt > 1 ? '#ff3864' : 'var(--text-primary)' }}>
                {sleepDebt > 0.1 ? `${fmtHrs(sleepDebt)} behind` : 'On track'}
              </span>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

// ── GYM TAB ───────────────────────────────────────────────────────────────────

function AddWorkoutModal({ onSave, onClose, saving, initialData, title = 'Log Workout' }) {
  const [type,      setType]      = useState(initialData?.type      || 'Push')
  const [duration,  setDuration]  = useState(initialData?.duration  ? String(initialData.duration) : '')
  const [intensity, setIntensity] = useState(initialData?.intensity || 'Moderate')
  const [notes,     setNotes]     = useState('')
  const [exercises, setExercises] = useState(() => JSON.parse(JSON.stringify(initialData?.exercises || [])))
  const [saveErr,   setSaveErr]   = useState(null)

  useEffect(() => {
    const y = window.scrollY
    document.body.style.position = 'fixed'
    document.body.style.top = `-${y}px`
    document.body.style.width = '100%'
    return () => {
      document.body.style.position = ''
      document.body.style.top = ''
      document.body.style.width = ''
      window.scrollTo(0, y)
    }
  }, [])

  const addExercise = () => setExercises(e => [...e, { name: '', sets: [{ reps: '', weight: '' }] }])
  const removeEx    = i  => setExercises(e => e.filter((_, j) => j !== i))
  const updateEx    = (i, val) => setExercises(e => e.map((ex, j) => j === i ? { ...ex, name: val } : ex))
  const addSet      = i  => setExercises(e => e.map((ex, j) => j === i ? { ...ex, sets: [...ex.sets, { reps: '', weight: '' }] } : ex))
  const removeSet   = (ei, si) => setExercises(e => e.map((ex, j) => j === ei ? { ...ex, sets: ex.sets.filter((_, k) => k !== si) } : ex))
  const updateSet   = (ei, si, field, val) => setExercises(e => e.map((ex, j) =>
    j === ei ? { ...ex, sets: ex.sets.map((s, k) => k === si ? { ...s, [field]: val } : s) } : ex
  ))

  const handleSave = async () => {
    setSaveErr(null)
    const result = await onSave({
      date:             todayStr(),
      type,
      duration_minutes: parseInt(duration) || null,
      intensity,
      notes:            notes.trim() || null,
      exercises:        exercises.filter(e => e.name.trim()),
    })
    if (result !== true) setSaveErr(result || 'Save failed')
  }

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-handle" />
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">

          {/* Type */}
          <div className="form-group">
            <label className="form-label">Type</label>
            <div className="pill-row">
              {WORKOUT_TYPES.map(t => (
                <button key={t} className={`pill ${type === t ? 'pill--active' : ''}`} onClick={() => setType(t)}>{t}</button>
              ))}
            </div>
          </div>

          {type !== 'Rest' && (
            <>
              {/* Intensity */}
              <div className="form-group">
                <label className="form-label">Intensity</label>
                <div className="pill-row">
                  {INTENSITY_OPTS.map(opt => (
                    <button key={opt} className={`pill ${intensity === opt ? 'pill--active' : ''}`} onClick={() => setIntensity(opt)}>{opt}</button>
                  ))}
                </div>
              </div>

              {/* Duration */}
              <div className="form-group">
                <label className="form-label">Duration (min)</label>
                <input className="form-input" type="number" placeholder="60" value={duration} onChange={e => setDuration(e.target.value)} />
              </div>

              {/* Exercises */}
              <div className="form-group">
                <label className="form-label">Exercises</label>
                {exercises.map((ex, ei) => (
                  <div key={ei} className="exercise-block">
                    <div className="ex-header">
                      <input className="form-input ex-name" placeholder="Exercise name" value={ex.name}
                        onChange={e => updateEx(ei, e.target.value)} />
                      <button className="ex-remove" onClick={() => removeEx(ei)}>✕</button>
                    </div>
                    {ex.sets.map((s, si) => (
                      <div key={si} className="set-row">
                        <input className="form-input set-input" type="number" placeholder="Reps" value={s.reps}
                          onChange={e => updateSet(ei, si, 'reps', e.target.value)} />
                        <input className="form-input set-input" type="number" placeholder="lbs" value={s.weight}
                          onChange={e => updateSet(ei, si, 'weight', e.target.value)} />
                        {ex.sets.length > 1 && (
                          <button className="ex-remove" onClick={() => removeSet(ei, si)}>✕</button>
                        )}
                      </div>
                    ))}
                    <button className="add-set-btn" onClick={() => addSet(ei)}>+ Add Set</button>
                  </div>
                ))}
                <button className="add-ex-btn" onClick={addExercise}>+ Add Exercise</button>
              </div>
            </>
          )}

          {/* Notes */}
          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-input form-textarea" placeholder="Optional notes…" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          {saveErr && <p className="form-error">{saveErr}</p>}

          <button className="connect-btn health-connect-btn" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Workout'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

function WorkoutCard({ w, onDelete }) {
  const [open, setOpen] = useState(false)
  const typeColor = w.type === 'Rest' ? '#555' : w.intensity === 'Heavy' ? '#ff3864' : w.intensity === 'Light' ? '#00ff9d' : '#00e5ff'

  return (
    <div className="workout-card card">
      <button className="wc-header" onClick={() => setOpen(o => !o)}>
        <div className="wc-left">
          <span className="wc-type" style={{ color: typeColor }}>{w.type}</span>
          <span className="wc-date">{fmtShortDate(w.date)}{w.duration_minutes ? ` · ${w.duration_minutes}min` : ''}</span>
        </div>
        <div className="wc-right">
          {w.intensity && w.type !== 'Rest' && <span className="wc-intensity">{w.intensity}</span>}
          <span className="wc-chevron">{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && (
        <div className="wc-body">
          {(w.exercises || []).map((ex, i) => (
            <div key={i} className="wc-exercise">
              <span className="wce-name">{ex.name}</span>
              <span className="wce-sets">
                {(ex.sets || []).map((s, j) => (
                  <span key={j} className="wce-set">{s.reps}×{s.weight}lbs</span>
                ))}
              </span>
            </div>
          ))}
          {w.notes && <p className="wc-notes">{w.notes}</p>}
          <button className="wc-delete" onClick={() => onDelete(w.id)}>Delete</button>
        </div>
      )}
    </div>
  )
}

function PlanChip({ plan, onLog, onEdit }) {
  return (
    <div className="plan-chip">
      <button className="pc-log" onClick={onLog}>
        <div className="pc-left">
          <span className="pc-name">{plan.name}</span>
          <span className="pc-meta">{plan.type}{plan.duration ? ` · ${plan.duration}min` : ''}{plan.intensity ? ` · ${plan.intensity}` : ''}</span>
        </div>
        <span className="pc-arrow">▶</span>
      </button>
      <button className="pc-edit" onClick={onEdit} title="Edit plan">✎</button>
    </div>
  )
}

function CreatePlanModal({ onClose, onSave, onDelete, initialPlan }) {
  const [name,      setName]      = useState(initialPlan?.name      || '')
  const [type,      setType]      = useState(initialPlan?.type      || 'Push')
  const [duration,  setDuration]  = useState(initialPlan?.duration  ? String(initialPlan.duration) : '')
  const [intensity, setIntensity] = useState(initialPlan?.intensity || 'Moderate')
  const [exercises, setExercises] = useState(() => JSON.parse(JSON.stringify(initialPlan?.exercises || [])))
  const [saveErr,   setSaveErr]   = useState(null)

  useEffect(() => {
    const y = window.scrollY
    document.body.style.position = 'fixed'
    document.body.style.top = `-${y}px`
    document.body.style.width = '100%'
    return () => {
      document.body.style.position = ''
      document.body.style.top = ''
      document.body.style.width = ''
      window.scrollTo(0, y)
    }
  }, [])

  const addExercise = () => setExercises(e => [...e, { name: '', sets: [{ reps: '', weight: '' }] }])
  const removeEx    = i  => setExercises(e => e.filter((_, j) => j !== i))
  const updateEx    = (i, val) => setExercises(e => e.map((ex, j) => j === i ? { ...ex, name: val } : ex))
  const addSet      = i  => setExercises(e => e.map((ex, j) => j === i ? { ...ex, sets: [...ex.sets, { reps: '', weight: '' }] } : ex))
  const removeSet   = (ei, si) => setExercises(e => e.map((ex, j) => j === ei ? { ...ex, sets: ex.sets.filter((_, k) => k !== si) } : ex))
  const updateSet   = (ei, si, field, val) => setExercises(e => e.map((ex, j) =>
    j === ei ? { ...ex, sets: ex.sets.map((s, k) => k === si ? { ...s, [field]: val } : s) } : ex
  ))

  const handleSave = () => {
    setSaveErr(null)
    if (!name.trim()) { setSaveErr('Plan name is required'); return }
    onSave({
      name:      name.trim(),
      type,
      duration:  parseInt(duration) || null,
      intensity,
      exercises: exercises.filter(e => e.name.trim()),
    })
  }

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-handle" />
        <div className="modal-header">
          <span className="modal-title">{initialPlan ? 'Edit Plan' : 'Create Plan'}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Plan Name</label>
            <input className="form-input" placeholder="e.g. Push Day A" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Type</label>
            <div className="pill-row">
              {WORKOUT_TYPES.filter(t => t !== 'Rest').map(t => (
                <button key={t} className={`pill ${type === t ? 'pill--active' : ''}`} onClick={() => setType(t)}>{t}</button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Intensity</label>
            <div className="pill-row">
              {INTENSITY_OPTS.map(opt => (
                <button key={opt} className={`pill ${intensity === opt ? 'pill--active' : ''}`} onClick={() => setIntensity(opt)}>{opt}</button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Duration (min)</label>
            <input className="form-input" type="number" placeholder="60" value={duration} onChange={e => setDuration(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Exercises</label>
            {exercises.map((ex, ei) => (
              <div key={ei} className="exercise-block">
                <div className="ex-header">
                  <input className="form-input ex-name" placeholder="Exercise name" value={ex.name}
                    onChange={e => updateEx(ei, e.target.value)} />
                  <button className="ex-remove" onClick={() => removeEx(ei)}>✕</button>
                </div>
                {ex.sets.map((s, si) => (
                  <div key={si} className="set-row">
                    <input className="form-input set-input" type="number" placeholder="Reps" value={s.reps}
                      onChange={e => updateSet(ei, si, 'reps', e.target.value)} />
                    <input className="form-input set-input" type="number" placeholder="lbs" value={s.weight}
                      onChange={e => updateSet(ei, si, 'weight', e.target.value)} />
                    {ex.sets.length > 1 && (
                      <button className="ex-remove" onClick={() => removeSet(ei, si)}>✕</button>
                    )}
                  </div>
                ))}
                <button className="add-set-btn" onClick={() => addSet(ei)}>+ Add Set</button>
              </div>
            ))}
            <button className="add-ex-btn" onClick={addExercise}>+ Add Exercise</button>
          </div>
          {saveErr && <p className="form-error">{saveErr}</p>}
          <button className="connect-btn health-connect-btn" onClick={handleSave}>
            {initialPlan ? 'Save Changes' : 'Create Plan'}
          </button>
          {initialPlan && (
            <button className="wc-delete" style={{ textAlign: 'center', width: '100%', padding: '10px 0' }} onClick={onDelete}>
              Delete Plan
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

function GymTab({ gymData }) {
  const { workouts, saving, addWorkout, deleteWorkout } = gymData
  const planHook = usePlans()
  const [showModal,      setShowModal]      = useState(false)
  const [showCreatePlan, setShowCreatePlan] = useState(false)
  const [currentPlan,    setCurrentPlan]    = useState(null)
  const [editingPlan,    setEditingPlan]    = useState(null)
  const streak    = calcStreak(workouts)
  const weekFreq  = calcWeekFreq(workouts)
  const prs       = calcPRs(workouts)

  // This week grid
  const weekStart = getWeekStart()
  const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  const weekDates = Array.from({ length: 7 }, (_, i) => offsetDate(weekStart, i))

  const handleSave = async (workout) => {
    const result = await addWorkout(workout)
    if (result === true) { setShowModal(false); setCurrentPlan(null) }
    return result
  }

  return (
    <>
      {showModal && (
        <AddWorkoutModal
          onSave={handleSave}
          onClose={() => { setShowModal(false); setCurrentPlan(null) }}
          saving={saving}
          initialData={currentPlan}
          title={currentPlan ? `Log: ${currentPlan.name}` : 'Log Workout'}
        />
      )}
      {showCreatePlan && (
        <CreatePlanModal
          initialPlan={editingPlan}
          onClose={() => { setShowCreatePlan(false); setEditingPlan(null) }}
          onSave={(plan) => {
            if (editingPlan) planHook.updatePlan(editingPlan.id, plan)
            else planHook.addPlan(plan)
            setShowCreatePlan(false); setEditingPlan(null)
          }}
          onDelete={() => { planHook.deletePlan(editingPlan.id); setShowCreatePlan(false); setEditingPlan(null) }}
        />
      )}
    <div className="health-scroll">

      {/* Stats */}
      <div className="gym-header page-section">
        <div className="gym-stats-row">
          <div className="gym-stat">
            <span className="gs-val">{streak}</span>
            <span className="gs-label">Day Streak 🔥</span>
          </div>
          <div className="gym-stat">
            <span className="gs-val">{weekFreq}</span>
            <span className="gs-label">This Week</span>
          </div>
        </div>
      </div>

      {/* Plans */}
      <section className="page-section">
        <div className="section-header">
          <h2 className="section-title">My Plans</h2>
          <button className="action-btn" onClick={() => { setEditingPlan(null); setShowCreatePlan(true) }}>+ New</button>
        </div>
        {planHook.plans.length === 0 ? (
          <div className="health-empty">No plans yet — create one to log workouts faster.</div>
        ) : (
          <div className="plans-row">
            {planHook.plans.map(p => (
              <PlanChip key={p.id} plan={p}
                onLog={() => { setCurrentPlan(p); setShowModal(true) }}
                onEdit={() => { setEditingPlan(p); setShowCreatePlan(true) }}
              />
            ))}
          </div>
        )}
      </section>

      {/* Custom log */}
      <section className="page-section" style={{ paddingTop: 0 }}>
        <button className="connect-btn health-connect-btn" onClick={() => { setCurrentPlan(null); setShowModal(true) }}>
          + Log Custom Workout
        </button>
      </section>

      {/* This week grid */}
      <section className="page-section">
        <h2 className="section-title">This Week</h2>
        <div className="card week-grid-card">
          {weekDates.map((d, i) => {
            const w       = workouts.find(x => x.date === d)
            const isToday = d === todayStr()
            const isPast  = d < todayStr()
            const dotCls  = w ? (w.type === 'Rest' ? 'wgd-rest' : 'wgd-done') : (isPast ? 'wgd-miss' : 'wgd-future')
            return (
              <div key={d} className={`wg-day ${isToday ? 'wg-today' : ''}`}>
                <span className="wgd-label">{dayLabels[i]}</span>
                <div className={`wgd-dot ${dotCls}`}>
                  {w ? w.type.slice(0, 2) : (isToday ? '?' : '')}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Personal records */}
      {prs.length > 0 && (
        <section className="page-section">
          <h2 className="section-title">Personal Records</h2>
          <div className="card detail-card">
            {prs.map(([name, weight]) => (
              <div key={name} className="detail-row">
                <span className="detail-label">{name}</span>
                <span className="detail-value" style={{ color: 'var(--accent)' }}>{weight} lbs</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent workouts */}
      <section className="page-section">
        <h2 className="section-title">Recent Workouts</h2>
        {workouts.length === 0
          ? <div className="health-empty">No workouts logged yet. Tap Log Workout to start.</div>
          : workouts.slice(0, 20).map(w => (
              <WorkoutCard key={w.id} w={w} onDelete={deleteWorkout} />
            ))
        }
      </section>
    </div>
    </>
  )
}

// ── ACTIVITY TAB ──────────────────────────────────────────────────────────────

function ActivityTab({ oura, date, setDate }) {
  const { data, loading, refetch } = oura
  const activity = data?.activity
  const stepsGoal = 10000
  const stepsPct  = activity?.steps ? Math.min(100, Math.round((activity.steps / stepsGoal) * 100)) : 0

  return (
    <div className="health-scroll">
      <DateNav date={date} setDate={setDate} onSync={refetch} syncing={loading} />

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

// ── TRENDS TAB ────────────────────────────────────────────────────────────────

function TrendsTab({ weekData, gymData }) {
  const { workouts } = gymData
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

  // Gym correlation: readiness on workout days vs rest days
  const workoutDates = new Set(workouts.filter(w => w.type !== 'Rest').map(w => w.date))
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

// ── Connect screen ────────────────────────────────────────────────────────────

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

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Health() {
  const [tab,            setTab]           = useState('today')
  const [linked,         setLinked]        = useState(() => !!localStorage.getItem('aaron_oura_linked'))
  const [connectLoading, setConnectLoading] = useState(false)
  const [connectError,   setConnectError]   = useState(null)
  const [date,           setDate]           = useState(todayStr())

  const oura    = useOuraToday(linked, date)
  const weekData = useOuraWeek(linked)
  const gymData  = useGymData()

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

  return (
    <div className="page health-page">
      <div className="health-topbar">
        <HealthTabs tab={tab} setTab={setTab} />
      </div>

      {tab === 'today'    && <TodayTab    oura={oura}    gymData={gymData} date={date} setDate={setDate} />}
      {tab === 'sleep'    && <SleepTab    oura={oura}    weekData={weekData} date={date} setDate={setDate} />}
      {tab === 'gym'      && <GymTab      gymData={gymData} />}
      {tab === 'activity' && <ActivityTab oura={oura}    date={date} setDate={setDate} />}
      {tab === 'trends'   && <TrendsTab   weekData={weekData} gymData={gymData} />}
    </div>
  )
}
