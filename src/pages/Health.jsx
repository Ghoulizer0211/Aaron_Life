import { useState, useEffect } from 'react'
import './Page.css'
import './Health.css'

// ─── Date helpers ─────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreColor(score) {
  if (score == null) return '#6a6a6a'
  if (score >= 85) return '#00ff9d'
  if (score >= 70) return '#00e5ff'
  if (score >= 60) return '#ffe600'
  return '#ff3864'
}

function scoreLabel(score) {
  if (score == null) return '—'
  if (score >= 85) return 'Optimal'
  if (score >= 70) return 'Good'
  if (score >= 60) return 'Fair'
  return 'Pay Attention'
}

function fmtHrs(h) {
  if (h == null) return '—'
  const hrs = Math.floor(h)
  const min = Math.round((h - hrs) * 60)
  return min > 0 ? `${hrs}h ${min}m` : `${hrs}h`
}

// ─── SVG Score Ring ───────────────────────────────────────────────────────────

function ScoreRing({ score, color, size = 96, strokeWidth = 7 }) {
  const r    = (size - strokeWidth * 2) / 2
  const circ = 2 * Math.PI * r
  const dash = score != null ? (score / 100) * circ : 0

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke="var(--border)" strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{
          transition: 'stroke-dasharray 0.7s ease',
          filter: `drop-shadow(0 0 5px ${color}88)`,
        }}
      />
      <text
        x="50%" y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--text-primary)"
        fontSize={size * 0.26}
        fontWeight="700"
        fontFamily="'Exo 2', sans-serif"
      >
        {score ?? '—'}
      </text>
    </svg>
  )
}

// ─── Connect screen ───────────────────────────────────────────────────────────

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
      <p className="connect-sub">
        Paste your Personal Access Token to sync your readiness, sleep, and activity data.
      </p>
      <div className="token-steps">
        <span className="token-step">1. Go to <strong>cloud.ouraring.com/personal-access-tokens</strong></span>
        <span className="token-step">2. Create a new token and paste it below</span>
      </div>
      <input
        className="token-input"
        type="password"
        value={token}
        onChange={e => setToken(e.target.value)}
        placeholder="Paste your token here…"
        autoCapitalize="none"
        autoCorrect="off"
      />
      {error && <p className="connect-error">{error}</p>}
      <button
        className="connect-btn health-connect-btn"
        onClick={() => onConnect(token)}
        disabled={loading || !token.trim()}
      >
        {loading ? 'Connecting…' : 'Connect'}
      </button>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Health() {
  const [linked,   setLinked]   = useState(() => !!localStorage.getItem('aaron_oura_linked'))
  const [date,     setDate]     = useState(todayStr)
  const [data,     setData]     = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)
  const [syncing,  setSyncing]  = useState(false)

  // On mount, verify connection status with server (cross-device sync)
  useEffect(() => {
    if (linked) return // already know we're linked from localStorage
    fetch('/api/oura/status')
      .then(r => r.json())
      .then(d => {
        if (d.linked) {
          localStorage.setItem('aaron_oura_linked', '1')
          setLinked(true)
        }
      })
      .catch(() => {})
  }, []) // eslint-disable-line

  useEffect(() => {
    if (!linked) return
    fetchForDate(date)
  }, [linked, date]) // eslint-disable-line

  async function fetchForDate(d) {
    setSyncing(true)
    setError(null)
    try {
      const res = await fetch(`/api/oura/today?date=${d}`)
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setData(json)
    } catch (err) {
      setError(err.message)
    } finally {
      setSyncing(false)
    }
  }

  const goPrev  = () => setDate(d => offsetDate(d, -1))
  const goNext  = () => setDate(d => offsetDate(d, +1))
  const goToday = () => setDate(todayStr())

  async function handleConnect(token) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/oura/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      localStorage.setItem('aaron_oura_linked', '1')
      setLinked(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleDisconnect() {
    await fetch('/api/oura/disconnect', { method: 'DELETE' })
    localStorage.removeItem('aaron_oura_linked')
    setLinked(false)
    setData(null)
  }

  if (!linked) {
    return <ConnectScreen onConnect={handleConnect} loading={loading} error={error} />
  }

  const { readiness, sleep, activity } = data || {}

  // ── Three score rings ──
  const rings = [
    { label: 'Readiness', score: readiness?.score ?? null },
    { label: 'Sleep',     score: sleep?.score     ?? null },
    { label: 'Activity',  score: activity?.score  ?? null },
  ]

  // ── Sleep duration breakdown ──
  const sleepTotal = (sleep?.deep_hours || 0) + (sleep?.rem_hours || 0) + (sleep?.light_hours || 0)

  return (
    <div className="page">

      {/* Date nav */}
      <div className="health-nav">
        <button className="hnav-btn" onClick={goPrev}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div className="hnav-center">
          <span className="hnav-label">{fmtDateLabel(date)}</span>
          {date !== todayStr() && (
            <button className="hnav-today" onClick={goToday}>Today</button>
          )}
        </div>
        <button className="hnav-btn" onClick={goNext} disabled={date >= todayStr()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
      </div>

      {/* Score rings */}
      <section className="page-section">
        <div className="section-header">
          <h2 className="section-title">Scores</h2>
          <div className="header-actions">
            {syncing
              ? <span className="sync-label">Syncing…</span>
              : <button className="action-btn" onClick={() => fetchForDate(date)}>Sync</button>
            }
            <button className="disconnect-btn" onClick={handleDisconnect}>Disconnect</button>
          </div>
        </div>
        <div className="rings-row">
          {rings.map(({ label, score }) => {
            const color = scoreColor(score)
            return (
              <div key={label} className="ring-card card">
                <ScoreRing score={score} color={color} />
                <span className="ring-label">{label}</span>
                <span className="ring-status" style={{ color }}>{scoreLabel(score)}</span>
              </div>
            )
          })}
        </div>
      </section>

      {/* Sleep detail */}
      {sleep && (
        <section className="page-section">
          <h2 className="section-title">Sleep</h2>
          <div className="card detail-card">
            <div className="detail-row">
              <span className="detail-label">Total</span>
              <span className="detail-value">{fmtHrs(sleep.total_hours)}</span>
            </div>
            {sleep.efficiency != null && (
              <div className="detail-row">
                <span className="detail-label">Efficiency</span>
                <span className="detail-value">{sleep.efficiency}%</span>
              </div>
            )}
            {sleep.avg_hrv != null && (
              <div className="detail-row">
                <span className="detail-label">Avg HRV</span>
                <span className="detail-value">{sleep.avg_hrv} ms</span>
              </div>
            )}
            {sleep.resting_hr != null && (
              <div className="detail-row">
                <span className="detail-label">Lowest HR</span>
                <span className="detail-value">{sleep.resting_hr} bpm</span>
              </div>
            )}

            {/* Duration breakdown bar */}
            {sleepTotal > 0 && (
              <div className="sleep-breakdown">
                <div className="sleep-bar">
                  {sleep.deep_hours  > 0 && <div className="sleep-seg deep"  style={{ flex: sleep.deep_hours }} />}
                  {sleep.rem_hours   > 0 && <div className="sleep-seg rem"   style={{ flex: sleep.rem_hours }} />}
                  {sleep.light_hours > 0 && <div className="sleep-seg light" style={{ flex: sleep.light_hours }} />}
                </div>
                <div className="sleep-legend">
                  <span className="legend-item"><span className="legend-dot deep-dot" />Deep {fmtHrs(sleep.deep_hours)}</span>
                  <span className="legend-item"><span className="legend-dot rem-dot" />REM {fmtHrs(sleep.rem_hours)}</span>
                  <span className="legend-item"><span className="legend-dot light-dot" />Light {fmtHrs(sleep.light_hours)}</span>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Activity detail */}
      {activity && (
        <section className="page-section">
          <h2 className="section-title">Activity</h2>
          <div className="card detail-card">
            {activity.steps != null && (
              <div className="activity-steps">
                <div className="detail-row">
                  <span className="detail-label">Steps</span>
                  <span className="detail-value">{activity.steps.toLocaleString()}</span>
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${Math.min(100, (activity.steps / 10000) * 100)}%`,
                      background: scoreColor(activity.score),
                    }}
                  />
                </div>
                <span className="steps-goal">Goal: 10,000</span>
              </div>
            )}
            {activity.active_calories != null && (
              <div className="detail-row">
                <span className="detail-label">Active Cal</span>
                <span className="detail-value">{activity.active_calories} kcal</span>
              </div>
            )}
            {activity.total_calories != null && (
              <div className="detail-row">
                <span className="detail-label">Total Cal</span>
                <span className="detail-value">{activity.total_calories} kcal</span>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Readiness contributors */}
      {readiness?.contributors && (
        <section className="page-section">
          <h2 className="section-title">Readiness Factors</h2>
          <div className="card detail-card">
            {Object.entries(readiness.contributors)
              .filter(([, v]) => v != null)
              .sort((a, b) => a[1] - b[1])
              .map(([key, val]) => (
                <div key={key} className="contributor-row">
                  <span className="contributor-label">
                    {key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                  </span>
                  <div className="contributor-bar-wrap">
                    <div className="contributor-bar">
                      <div
                        className="contributor-fill"
                        style={{ width: `${val}%`, background: scoreColor(val) }}
                      />
                    </div>
                    <span className="contributor-val">{val}</span>
                  </div>
                </div>
              ))}
          </div>
        </section>
      )}

      {!syncing && data && !readiness && !sleep?.score && !activity && (
        <section className="page-section">
          <div className="health-empty">No data for this day — try wearing your ring or pick a different date.</div>
        </section>
      )}

      {error && (
        <section className="page-section">
          <div className="health-error">{error}</div>
        </section>
      )}

    </div>
  )
}
