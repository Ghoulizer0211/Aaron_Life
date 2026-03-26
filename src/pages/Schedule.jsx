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

function WeekGrid({ days, events, onCellClick, onEventClick, onEventToggle, onEventUpdate }) {
  const today        = todayStr()
  const bodyRef      = useRef(null)
  const weekInnerRef = useRef(null)
  const dragRef      = useRef(null)
  const justDraggedRef = useRef(false)
  const [nowTop, setNowTop]     = useState(getNowTop)
  const [dragState, setDragState] = useState(null)
  // dragState: { evId, di, top, height, color, title }

  useEffect(() => {
    const t = setInterval(() => setNowTop(getNowTop()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (bodyRef.current)
      bodyRef.current.scrollTop = Math.max(0, nowTop - 120)
  }, []) // eslint-disable-line

  const handleColClick = (e, dateStr) => {
    if (justDraggedRef.current) return
    const rect  = e.currentTarget.getBoundingClientRect()
    const relY  = e.clientY - rect.top
    const idx   = Math.max(0, Math.min(TIME_SLOTS.length - 1, Math.floor(relY / SLOT_H)))
    const { h, m } = TIME_SLOTS[idx]
    const startTime = slotToTime(h, m)
    const endH  = h + 1
    const endTime = endH < 24 ? slotToTime(endH, m) : '23:59'
    onCellClick(dateStr, startTime, endTime)
  }

  const handleDragStart = (e, ev, di) => {
    if (ev.done) return
    const metrics = getEventMetrics(ev)
    if (!metrics) return

    const startX = e.touches ? e.touches[0].clientX : e.clientX
    const startY = e.touches ? e.touches[0].clientY : e.clientY
    let holdTimer = null
    let dragReady = false  // true after hold threshold met

    // Cancel hold if finger moves too much before timer fires
    const onEarlyMove = (moveEv) => {
      const cx = moveEv.touches ? moveEv.touches[0].clientX : moveEv.clientX
      const cy = moveEv.touches ? moveEv.touches[0].clientY : moveEv.clientY
      if (Math.hypot(cx - startX, cy - startY) > 8) cancel()
    }

    const cancel = () => {
      clearTimeout(holdTimer)
      window.removeEventListener('mousemove', onEarlyMove)
      window.removeEventListener('touchmove', onEarlyMove)
      window.removeEventListener('mouseup', cancel)
      window.removeEventListener('touchend', cancel)
    }

    const activateDrag = () => {
      cancel()  // remove early-move listeners
      dragReady = true

      // Haptic feedback on mobile
      if (navigator.vibrate) navigator.vibrate(40)

      const cols = weekInnerRef.current?.querySelectorAll('.day-col')
      if (cols?.[di]) {
        const colRect = cols[di].getBoundingClientRect()
        dragRef.current = {
          ev, origDi: di, currentDi: di,
          offsetY: startY - colRect.top + (bodyRef.current?.scrollTop || 0) - metrics.top,
          height: metrics.height, currentTop: metrics.top, didDrag: false,
        }
      }
      setDragState({ evId: ev.id, di, top: metrics.top, height: metrics.height, color: getEventColor(ev), title: ev.title })

      const onMove = (moveEv) => {
        if (!dragRef.current) return
        moveEv.preventDefault()
        const clientY = moveEv.touches ? moveEv.touches[0].clientY : moveEv.clientY
        const clientX = moveEv.touches ? moveEv.touches[0].clientX : moveEv.clientX
        dragRef.current.didDrag = true

        const cols = weekInnerRef.current?.querySelectorAll('.day-col')
        if (!cols) return
        let targetDi = dragRef.current.currentDi
        cols.forEach((col, i) => {
          const r = col.getBoundingClientRect()
          if (clientX >= r.left && clientX <= r.right) targetDi = i
        })
        const colRect = cols[targetDi].getBoundingClientRect()
        const posInCol = clientY - colRect.top + (bodyRef.current?.scrollTop || 0) - dragRef.current.offsetY
        const snapped  = Math.round(posInCol / SLOT_H) * SLOT_H
        const clamped  = Math.max(0, Math.min(TOTAL_H - dragRef.current.height, snapped))
        dragRef.current.currentTop = clamped
        dragRef.current.currentDi  = targetDi
        setDragState(prev => prev ? { ...prev, top: clamped, di: targetDi } : null)
      }

      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        window.removeEventListener('touchmove', onMove)
        window.removeEventListener('touchend', onUp)

        if (!dragRef.current?.didDrag) { dragRef.current = null; setDragState(null); return }

        justDraggedRef.current = true
        setTimeout(() => { justDraggedRef.current = false }, 100)

        const { ev, currentTop, currentDi } = dragRef.current
        const slotIndex = Math.min(Math.floor(currentTop / SLOT_H), TIME_SLOTS.length - 1)
        const slot = TIME_SLOTS[slotIndex]
        const newStart = slotToTime(slot.h, slot.m)
        const updates  = { startTime: newStart, date: dateToStr(days[currentDi]) }
        if (ev.endTime && (ev.startTime || ev.time)) {
          const [sh, sm] = (ev.startTime || ev.time).split(':').map(Number)
          const [eh, em] = ev.endTime.split(':').map(Number)
          const dur = (eh * 60 + em) - (sh * 60 + sm)
          const newStartMin = slot.h * 60 + slot.m
          const newEndMin   = newStartMin + dur
          updates.endTime   = newEndMin <= 1440
            ? slotToTime(Math.floor(newEndMin / 60), newEndMin % 60)
            : '23:59'
        }
        onEventUpdate(ev.id, updates)
        dragRef.current = null
        setDragState(null)
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
      window.addEventListener('touchmove', onMove, { passive: false })
      window.addEventListener('touchend', onUp)
    }

    // Start hold timer — 600ms hold activates drag
    holdTimer = setTimeout(activateDrag, 600)
    window.addEventListener('mousemove', onEarlyMove)
    window.addEventListener('touchmove', onEarlyMove, { passive: true })
    window.addEventListener('mouseup', cancel)
    window.addEventListener('touchend', cancel)
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
        <div className="week-inner" ref={weekInnerRef}>

          {/* Time-label column */}
          <div className="time-col" style={{ position: 'relative' }}>
            {TIME_SLOTS.map(({ h, m }, i) => (
              <div key={i} className="time-label">{slotLabel(h, m)}</div>
            ))}
            {days.some(d => dateToStr(d) === today) && (
              <div className="now-time-label" style={{ top: nowTop }}>
                {(() => {
                  const n = new Date()
                  const h = n.getHours(), m = n.getMinutes()
                  return `${h % 12 || 12}:${String(m).padStart(2,'0')}`
                })()}
              </div>
            )}
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

                {/* Drag overlay */}
                {dragState && dragState.di === di && (
                  <div
                    className="cal-event ce-drag-overlay"
                    style={{ top: dragState.top, height: dragState.height, background: `${dragState.color}40`, borderLeftColor: dragState.color }}
                  >
                    <div className="ce-body">
                      <span className="ce-title">{dragState.title}</span>
                    </div>
                  </div>
                )}

                {dayEvs.map(ev => {
                  const m = getEventMetrics(ev)
                  if (!m || m.top < 0) return null
                  const color    = getEventColor(ev)
                  const st       = fmt12(ev.startTime || ev.time)
                  const et       = ev.endTime ? fmt12(ev.endTime) : ''
                  const dragging = dragState?.evId === ev.id
                  return (
                    <div
                      key={ev.id}
                      className={`cal-event${ev.done ? ' ce-done' : ''}${dragging ? ' ce-dragging' : ''}`}
                      style={{ top: m.top, height: m.height, background: `${color}25`, borderLeftColor: color, color, cursor: ev.done ? 'default' : 'grab' }}
                      onMouseDown={e => { if (!ev.done) { e.stopPropagation(); handleDragStart(e, ev, di) } }}
                      onTouchStart={e => { if (!ev.done) { e.stopPropagation(); handleDragStart(e, ev, di) } }}
                      onClick={e => { e.stopPropagation(); if (!ev.done && !justDraggedRef.current) onEventClick(ev) }}
                    >
                      <button
                        className={`ce-check${ev.done ? ' ce-check-on' : ''}`}
                        style={{ borderColor: color, background: ev.done ? color : 'transparent' }}
                        onMouseDown={e => e.stopPropagation()}
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
                        {ev.notes && m.height > SLOT_H && (
                          <span className="ce-notes">{ev.notes}</span>
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

// ─── Month Grid ───────────────────────────────────────────────────────────────

function MonthGrid({ monthOffset, events, onDayClick, onEventClick }) {
  const today = todayStr()
  const now   = new Date()
  const month = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)

  // Build grid starting on Monday of first week
  const dow   = month.getDay()
  const start = new Date(month)
  start.setDate(month.getDate() + (dow === 0 ? -6 : 1 - dow))

  const weeks = Array.from({ length: 6 }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const day = new Date(start)
      day.setDate(start.getDate() + w * 7 + d)
      return day
    })
  )
  // Drop 6th row if all days are outside current month
  const rows = weeks[5].every(d => d.getMonth() !== month.getMonth())
    ? weeks.slice(0, 5) : weeks

  return (
    <div className="month-grid">
      <div className="month-dow-row">
        {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (
          <div key={d} className="month-dow">{d}</div>
        ))}
      </div>
      {rows.map((week, wi) => (
        <div key={wi} className="month-week">
          {week.map((day, di) => {
            const ds   = dateToStr(day)
            const isToday   = ds === today
            const inMonth   = day.getMonth() === month.getMonth()
            const dayEvs    = events.filter(e => e.date === ds)
            return (
              <div
                key={di}
                className={`month-day${isToday ? ' month-today' : ''}${!inMonth ? ' month-other' : ''}`}
                onClick={() => onDayClick(ds)}
              >
                <span className="month-day-num">{day.getDate()}</span>
                <div className="month-evs">
                  {dayEvs.slice(0, 3).map(ev => (
                    <div
                      key={ev.id}
                      className={`month-ev${ev.done ? ' month-ev-done' : ''}`}
                      style={{ background: `${getEventColor(ev)}35`, borderLeftColor: getEventColor(ev) }}
                      onClick={e => { e.stopPropagation(); onEventClick(ev) }}
                    >
                      {ev.title}
                    </div>
                  ))}
                  {dayEvs.length > 3 && (
                    <div className="month-ev-more">+{dayEvs.length - 3} more</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Schedule() {
  const { events, addEvent, updateEvent, deleteEvent } = useEvents()
  const [isMobile,    setIsMobile]    = useState(() => window.innerWidth < 768)
  const [view,        setView]        = useState(() => window.innerWidth < 768 ? 'day' : 'week')
  const [weekOffset,  setWeekOffset]  = useState(0)
  const [dayOffset,   setDayOffset]   = useState(0)
  const [monthOffset, setMonthOffset] = useState(0)
  const [modal, setModal] = useState(null)

  useEffect(() => {
    const handler = () => {
      const mobile = window.innerWidth < 768
      setIsMobile(mobile)
      if (mobile) setView(v => v === 'week' ? 'day' : v)
    }
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  const days = view === 'day' ? [getDayFromOffset(dayOffset)] : getWeekDays(weekOffset)

  const navLabel = () => {
    if (view === 'month') {
      const now = new Date()
      const m = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
      return `${MONTH_SHORT[m.getMonth()]} ${m.getFullYear()}`
    }
    return view === 'day' ? dayLabel(days[0]) : weekRangeLabel(days)
  }

  const isAtToday = view === 'month' ? monthOffset === 0
    : view === 'day' ? dayOffset === 0 : weekOffset === 0

  const goPrev = () => {
    if (view === 'day') setDayOffset(o => o - 1)
    else if (view === 'week') setWeekOffset(o => o - 1)
    else setMonthOffset(o => o - 1)
  }
  const goNext = () => {
    if (view === 'day') setDayOffset(o => o + 1)
    else if (view === 'week') setWeekOffset(o => o + 1)
    else setMonthOffset(o => o + 1)
  }
  const goToday = () => { setDayOffset(0); setWeekOffset(0); setMonthOffset(0) }

  const handleDatePick = (e) => {
    const val = e.target.value
    if (!val) return
    const picked = new Date(val + 'T00:00:00')
    const today  = new Date(); today.setHours(0, 0, 0, 0)
    if (view === 'day') {
      setDayOffset(Math.round((picked - today) / 86400000))
    } else if (view === 'month') {
      const now = new Date()
      setMonthOffset((picked.getFullYear() - now.getFullYear()) * 12 + picked.getMonth() - now.getMonth())
    } else {
      const toMon = (d) => d.getDay() === 0 ? -6 : 1 - d.getDay()
      const pickedMon = new Date(picked); pickedMon.setDate(picked.getDate() + toMon(picked))
      const thisMon   = new Date(today);  thisMon.setDate(today.getDate() + toMon(today))
      setWeekOffset(Math.round((pickedMon - thisMon) / (7 * 86400000)))
    }
  }

  const handleMonthDayClick = (ds) => {
    const picked = new Date(ds + 'T00:00:00')
    const today  = new Date(); today.setHours(0, 0, 0, 0)
    setDayOffset(Math.round((picked - today) / 86400000))
    setView('day')
  }

  const pickerValue = view === 'month'
    ? (() => { const now = new Date(); const m = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1); return dateToStr(m) })()
    : dateToStr(days[0])

  const openAdd  = (date, startTime, endTime) =>
    setModal({ initial: { date, startTime: startTime || '', endTime: endTime || '', title: '', color: COLOR_PRESETS[0], notes: '' } })
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
              {navLabel()}
              <svg className="wnav-cal-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </span>
            <input type="date" className="wnav-date-input" value={pickerValue} onChange={handleDatePick} />
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

      <div className="view-toggle">
        {(isMobile ? ['day','month'] : ['day','week','month']).map(v => (
          <button key={v} className={`vt-btn${view === v ? ' vt-active' : ''}`} onClick={() => setView(v)}>
            {v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>

      {view === 'month' ? (
        <MonthGrid
          monthOffset={monthOffset}
          events={events}
          onDayClick={handleMonthDayClick}
          onEventClick={openEdit}
        />
      ) : (
        <WeekGrid
          days={days}
          events={events}
          onCellClick={openAdd}
          onEventClick={openEdit}
          onEventToggle={(id, done) => updateEvent(id, { done })}
          onEventUpdate={updateEvent}
        />
      )}

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
