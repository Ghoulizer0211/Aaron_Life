import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { supabase, sb } from '../lib/supabase'
import './Page.css'
import './Schedule.css'

// ─── Constants ───────────────────────────────────────────────────────────────

const SLOT_H     = 36   // px per 30-min slot (keep in sync with CSS .time-label height)
const GRID_START = 0    // 12 AM
const GRID_END   = 24   // midnight (full day)

const COLOR_PRESETS = [
  '#00e5ff', // neon cyan
  '#ff2d78', // neon pink
  '#00ff9d', // neon green
  '#ffe600', // neon yellow
  '#bf5fff', // neon purple
  '#ff6c2f', // neon orange
  '#00bfff', // electric blue
  '#ff3864', // hot red
]

const LEGACY_COLORS = {
  work: '#00e5ff', health: '#00ff9d', personal: '#ffe600',
  gym: '#ff3864', dating: '#ff2d78', school: '#00bfff', appointment: '#bf5fff',
}

const DAY_SHORT   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const TIME_SLOTS = []
for (let h = GRID_START; h < GRID_END; h++) {
  TIME_SLOTS.push({ h, m: 0 })
  TIME_SLOTS.push({ h, m: 30 })
}
const TOTAL_H = TIME_SLOTS.length * SLOT_H   // full column height in px

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function dateToStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function getWeekDays(offset) {
  const now = new Date()
  const dow = now.getDay()
  const toMon = dow === 0 ? -6 : 1 - dow
  const monday = new Date(now)
  monday.setDate(now.getDate() + toMon + offset * 7)
  monday.setHours(0, 0, 0, 0)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday); d.setDate(monday.getDate() + i); return d
  })
}

function getDayFromOffset(offset) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  d.setHours(0, 0, 0, 0)
  return d
}

function slotToTime(h, m) {
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`
}

function slotLabel(h, m) {
  if (m !== 0) return ''
  return `${h % 12 || 12} ${h >= 12 ? 'PM' : 'AM'}`
}

function fmt12(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`
}

function getEventColor(ev) {
  return ev.color || LEGACY_COLORS[ev.category] || COLOR_PRESETS[0]
}

function weekRangeLabel(days) {
  const f = days[0], l = days[6]
  if (f.getMonth() === l.getMonth())
    return `${MONTH_SHORT[f.getMonth()]} ${f.getDate()} – ${l.getDate()}, ${f.getFullYear()}`
  return `${MONTH_SHORT[f.getMonth()]} ${f.getDate()} – ${MONTH_SHORT[l.getMonth()]} ${l.getDate()}`
}

function dayLabel(day) {
  return `${DAY_SHORT[day.getDay()]}, ${MONTH_SHORT[day.getMonth()]} ${day.getDate()}, ${day.getFullYear()}`
}

// Returns { top, height } in px for absolute positioning in the day column
function getEventMetrics(ev) {
  const st = ev.startTime || ev.time || ''
  if (!st) return null

  const [sh, sm] = st.split(':').map(Number)
  const startMin  = sh * 60 + sm
  const gridStart = GRID_START * 60
  const gridEnd   = GRID_END * 60

  if (startMin >= gridEnd) return null

  const top = ((startMin - gridStart) / 30) * SLOT_H

  let height = SLOT_H
  if (ev.endTime) {
    const [eh, em] = ev.endTime.split(':').map(Number)
    const endMin = Math.min(eh * 60 + em, gridEnd)
    const dur    = endMin - startMin
    if (dur > 0) height = (dur / 30) * SLOT_H
  }
  height = Math.max(SLOT_H * 0.5, height)

  return { top, height }
}

function getNowTop() {
  const now = new Date()
  const h = now.getHours(), m = now.getMinutes()
  return ((h * 60 + m - GRID_START * 60) / 30) * SLOT_H
}

// ─── UUID helper (crypto.randomUUID requires HTTPS; fallback for HTTP dev) ────

function genId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

// ─── Events hook (Supabase when configured, Express API as fallback) ──────────

function useEvents() {
  const [events, setEvents] = useState(() => {
    // If Supabase is configured, don't pre-load stale localStorage data
    if (supabase) return []
    try { return JSON.parse(localStorage.getItem('aaron_life_events') || '[]') }
    catch { return [] }
  })

  const save = (list) => {
    localStorage.setItem('aaron_life_events', JSON.stringify(list))
    return list
  }

  // Load canonical data on mount
  useEffect(() => {
    if (supabase) {
      // Clear any stale local data and load fresh from Supabase
      localStorage.removeItem('aaron_life_events')
      sb(supabase.from('events').select('*').order('date'))
        .then(({ data } = {}) => {
          if (Array.isArray(data)) setEvents(data)
        })
    } else {
      fetch('/api/events')
        .then(r => r.json())
        .then(data => { if (Array.isArray(data)) setEvents(save(data)) })
        .catch(() => {})
    }
  }, [])

  const addEvent = (d) => {
    const ev = { ...d, id: genId() }
    setEvents(p => supabase ? [...p, ev] : save([...p, ev]))
    if (supabase) {
      sb(supabase.from('events').insert(ev))
    } else {
      fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ev),
      }).catch(() => {})
    }
  }

  const updateEvent = (id, d) => {
    setEvents(p => {
      const next = p.map(e => e.id === id ? { ...e, ...d } : e)
      return supabase ? next : save(next)
    })
    if (supabase) {
      sb(supabase.from('events').update(d).eq('id', id))
    } else {
      fetch(`/api/events/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(d),
      }).catch(() => {})
    }
  }

  const deleteEvent = (id) => {
    setEvents(p => {
      const next = p.filter(e => e.id !== id)
      return supabase ? next : save(next)
    })
    if (supabase) {
      sb(supabase.from('events').delete().eq('id', id))
    } else {
      fetch(`/api/events/${id}`, { method: 'DELETE' }).catch(() => {})
    }
  }

  return { events, addEvent, updateEvent, deleteEvent }
}

// ─── Week/Day Grid ────────────────────────────────────────────────────────────

function WeekGrid({ days, events, onCellClick, onEventClick, onEventToggle }) {
  const today   = todayStr()
  const bodyRef = useRef(null)
  const [nowTop, setNowTop] = useState(getNowTop)

  useEffect(() => {
    const t = setInterval(() => setNowTop(getNowTop()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (bodyRef.current)
      bodyRef.current.scrollTop = Math.max(0, nowTop - 120)
  }, []) // eslint-disable-line

  const handleColClick = (e, dateStr) => {
    const rect  = e.currentTarget.getBoundingClientRect()
    const relY  = e.clientY - rect.top
    const idx   = Math.max(0, Math.min(TIME_SLOTS.length - 1, Math.floor(relY / SLOT_H)))
    const { h, m } = TIME_SLOTS[idx]
    const startTime = slotToTime(h, m)
    const endH  = h + 1
    const endTime = endH < 24 ? slotToTime(endH, m) : '23:59'
    onCellClick(dateStr, startTime, endTime)
  }

  return (
    <div className="week-grid-wrap">
      {/* Sticky day-header row */}
      <div className={`week-header${days.length === 1 ? ' day-view' : ''}`}>
        <div className="wh-corner" />
        {days.map((day, i) => {
          const isToday = dateToStr(day) === today
          return (
            <div key={i} className={`wh-day${isToday ? ' wh-today' : ''}`}>
              <span className="wh-dow">{DAY_SHORT[day.getDay()]}</span>
              <span className="wh-num">{day.getDate()}</span>
            </div>
          )
        })}
      </div>

      {/* Scrollable body */}
      <div className="week-body" ref={bodyRef}>
        <div className="week-inner">

          {/* Time-label column */}
          <div className="time-col">
            {TIME_SLOTS.map(({ h, m }, i) => (
              <div key={i} className="time-label">{slotLabel(h, m)}</div>
            ))}
          </div>

          {/* One column per day */}
          {days.map((day, di) => {
            const dateStr = dateToStr(day)
            const isToday = dateStr === today
            const dayEvs  = events.filter(e => e.date === dateStr)

            return (
              <div
                key={di}
                className={`day-col${isToday ? ' day-today' : ''}`}
                style={{ height: TOTAL_H }}
                onClick={e => handleColClick(e, dateStr)}
              >
                {TIME_SLOTS.map(({ m }, i) => (
                  <div key={i} className={m === 0 ? 'g-hour' : 'g-half'} style={{ top: i * SLOT_H }} />
                ))}

                {isToday && (
                  <div className="now-line" style={{ top: nowTop }}>
                    <span className="now-dot" />
                  </div>
                )}

                {dayEvs.map(ev => {
                  const m = getEventMetrics(ev)
                  if (!m || m.top < 0) return null
                  const color = getEventColor(ev)
                  const st = fmt12(ev.startTime || ev.time)
                  const et = ev.endTime ? fmt12(ev.endTime) : ''
                  return (
                    <div
                      key={ev.id}
                      className={`cal-event${ev.done ? ' ce-done' : ''}`}
                      style={{ top: m.top, height: m.height, background: `${color}25`, borderLeftColor: color, color }}
                      onClick={e => { e.stopPropagation(); onEventClick(ev) }}
                    >
                      <button
                        className={`ce-check${ev.done ? ' ce-check-on' : ''}`}
                        style={{ borderColor: color, background: ev.done ? color : 'transparent' }}
                        onClick={e => { e.stopPropagation(); onEventToggle(ev.id, !ev.done) }}
                        aria-label={ev.done ? 'Mark undone' : 'Mark done'}
                      >
                        {ev.done && (
                          <svg viewBox="0 0 10 10" fill="none" stroke="#000" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="1.5 5 4 7.5 8.5 2.5"/>
                          </svg>
                        )}
                      </button>
                      <div className="ce-body">
                        <span className="ce-title">{ev.title}</span>
                        {m.height > SLOT_H * 0.75 && st && (
                          <span className="ce-time">{st}{et ? ` – ${et}` : ''}</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Event Modal ──────────────────────────────────────────────────────────────

const EMPTY = { title: '', date: '', startTime: '', endTime: '', category: '', color: COLOR_PRESETS[0], notes: '' }

function EventModal({ initial, onSave, onDelete, onClose }) {
  const isEdit = !!initial?.id
  const [form, setForm] = useState({
    ...EMPTY,
    ...initial,
    startTime: initial?.startTime || initial?.time || '',
  })
  const [error, setError] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleStartChange = (val) => {
    set('startTime', val)
    if (val && (!form.endTime || form.endTime <= val)) {
      const [h, m] = val.split(':').map(Number)
      const eh = h + 1
      if (eh < 24) set('endTime', slotToTime(eh, m))
      else set('endTime', '23:59')
    }
  }

  const handleSave = () => {
    if (!form.title.trim()) { setError('Title is required'); return }
    const { time: _dropped, ...rest } = form
    onSave(rest)
  }

  return createPortal(
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet">
        <div className="modal-handle" />

        <div className="modal-header">
          <span className="modal-title">{isEdit ? 'Edit Event' : 'New Event'}</span>
          <button className="modal-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Title</label>
            <input
              className={`form-input${error ? ' input-error' : ''}`}
              value={form.title}
              onChange={e => { set('title', e.target.value); setError('') }}
              placeholder="What's happening?"
            />
            {error && <span className="form-error">{error}</span>}
          </div>

          <div className="form-group">
            <label className="form-label">Date</label>
            <input className="form-input" type="date" value={form.date} onChange={e => set('date', e.target.value)} />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Start</label>
              <input
                className="form-input"
                type="time"
                value={form.startTime}
                onChange={e => handleStartChange(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">End</label>
              <input
                className="form-input"
                type="time"
                value={form.endTime}
                onChange={e => set('endTime', e.target.value)}
              />
            </div>
          </div>

          {form.startTime && form.endTime && form.endTime > form.startTime && (
            <div className="duration-hint">
              {(() => {
                const [sh, sm] = form.startTime.split(':').map(Number)
                const [eh, em] = form.endTime.split(':').map(Number)
                const mins = (eh * 60 + em) - (sh * 60 + sm)
                const h = Math.floor(mins / 60), m = mins % 60
                return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`
              })()}
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Category <span className="form-optional">(optional)</span></label>
            <input
              className="form-input"
              value={form.category}
              onChange={e => set('category', e.target.value)}
              placeholder="e.g. Work, Gym, School…"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Color</label>
            <div className="color-row">
              {COLOR_PRESETS.map(c => (
                <button
                  key={c}
                  className={`swatch${form.color === c ? ' swatch-active' : ''}`}
                  style={{ background: c }}
                  onClick={() => set('color', c)}
                />
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Notes <span className="form-optional">(optional)</span></label>
            <textarea
              className="form-input form-textarea"
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Add notes…"
              rows={3}
            />
          </div>
        </div>

        <div className="modal-footer">
          {isEdit && <button className="btn-delete" onClick={() => onDelete(initial.id)}>Delete</button>}
          <button className="btn-save" onClick={handleSave}>{isEdit ? 'Save Changes' : 'Add Event'}</button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Schedule() {
  const { events, addEvent, updateEvent, deleteEvent } = useEvents()
  const [weekOffset, setWeekOffset] = useState(0)
  const [dayOffset,  setDayOffset]  = useState(0)
  const [isMobile,   setIsMobile]   = useState(() => window.innerWidth < 768)
  const [modal, setModal] = useState(null)

  // Track screen width
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  // days array: 1 day on mobile, 7 days on desktop
  const days = isMobile
    ? [getDayFromOffset(dayOffset)]
    : getWeekDays(weekOffset)

  const navLabel   = isMobile ? dayLabel(days[0]) : weekRangeLabel(days)
  const isAtToday  = isMobile ? dayOffset === 0 : weekOffset === 0

  const goPrev  = () => isMobile ? setDayOffset(o => o - 1)  : setWeekOffset(o => o - 1)
  const goNext  = () => isMobile ? setDayOffset(o => o + 1)  : setWeekOffset(o => o + 1)
  const goToday = () => { setDayOffset(0); setWeekOffset(0) }

  // Jump to a specific date
  const handleDatePick = (e) => {
    const val = e.target.value  // "YYYY-MM-DD"
    if (!val) return
    const picked = new Date(val + 'T00:00:00')
    const today  = new Date(); today.setHours(0, 0, 0, 0)
    if (isMobile) {
      const diff = Math.round((picked - today) / (1000 * 60 * 60 * 24))
      setDayOffset(diff)
    } else {
      // Navigate to the week containing the picked date
      const pickedDow = picked.getDay()
      const toMon = pickedDow === 0 ? -6 : 1 - pickedDow
      const pickedMonday = new Date(picked); pickedMonday.setDate(picked.getDate() + toMon)
      const todayDow = today.getDay()
      const todayToMon = todayDow === 0 ? -6 : 1 - todayDow
      const thisMonday = new Date(today); thisMonday.setDate(today.getDate() + todayToMon)
      const weekDiff = Math.round((pickedMonday - thisMonday) / (7 * 24 * 60 * 60 * 1000))
      setWeekOffset(weekDiff)
    }
  }

  const openAdd  = (date, startTime, endTime) =>
    setModal({ initial: { date, startTime: startTime || '', endTime: endTime || '', title: '', category: '', color: COLOR_PRESETS[0], notes: '' } })
  const openEdit   = (ev) => setModal({ initial: ev })
  const closeModal = ()   => setModal(null)

  const handleSave = (form) => {
    if (modal.initial?.id) updateEvent(modal.initial.id, form)
    else addEvent(form)
    closeModal()
  }

  return (
    <div className="schedule-page">
      <div className="week-nav">
        <button className="wnav-btn" onClick={goPrev}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div className="wnav-center">
          <div className="wnav-date-wrap">
            <span className="wnav-range wnav-date-btn">
              {navLabel}
              <svg className="wnav-cal-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </span>
            <input
              type="date"
              className="wnav-date-input"
              value={dateToStr(isMobile ? days[0] : days[0])}
              onChange={handleDatePick}
            />
          </div>
          {!isAtToday && (
            <button className="wnav-today" onClick={goToday}>Today</button>
          )}
        </div>
        <button className="wnav-btn" onClick={goNext}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
      </div>


      <WeekGrid
        days={days}
        events={events}
        onCellClick={openAdd}
        onEventClick={openEdit}
        onEventToggle={(id, done) => updateEvent(id, { done })}
      />

      <button className="fab" onClick={() => openAdd(todayStr(), '', '')} aria-label="Add event">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </button>

      {modal && (
        <EventModal
          initial={modal.initial}
          onSave={handleSave}
          onDelete={(id) => { deleteEvent(id); closeModal() }}
          onClose={closeModal}
        />
      )}
    </div>
  )
}
