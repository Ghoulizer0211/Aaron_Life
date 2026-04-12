import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { supabase, sb } from '../lib/supabase'
import { ls } from '../lib/storage'
import TaskPanel from './TaskPanel'
import { AddBtn } from '../components/IconButtons'
import '../components/IconButtons.css'
import './Page.css'
import './Schedule.css'

// ─── Constants ────────────────────────────────────────────────────────────────

const SLOT_H     = 36
const GRID_START = 0
const GRID_END   = 24

const COLOR_PRESETS = [
  '#00e5ff', '#ff2d78', '#00ff9d', '#ffe600',
  '#bf5fff', '#ff6c2f', '#00bfff', '#ff3864',
]

const LEGACY_COLORS = {
  work: '#00e5ff', health: '#00ff9d', personal: '#ffe600',
  gym: '#ff3864', dating: '#ff2d78', school: '#00bfff', appointment: '#bf5fff',
}

const DAY_SHORT   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const MONTH_SHORT    = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const PRIORITY_COLOR = { high: '#ff3864', medium: '#ffe600', low: '#00ff9d' }
const PRIORITY_LABEL = { high: 'High', medium: 'Med', low: 'Low' }

const TIME_SLOTS = []
for (let h = GRID_START; h < GRID_END; h++) {
  TIME_SLOTS.push({ h, m: 0 })
  TIME_SLOTS.push({ h, m: 30 })
}
const TOTAL_H = TIME_SLOTS.length * SLOT_H

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
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
  return `${String(h).padStart(2,'0')}:00`
}

function fmt12(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`
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

function genId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

// ─── useEvents hook ───────────────────────────────────────────────────────────

// DB uses snake_case (start_time, end_time); app uses camelCase (startTime, endTime)
function evFromDb(row) {
  return {
    id:        row.id,
    title:     row.title,
    date:      typeof row.date === 'string' ? row.date.slice(0, 10) : row.date,
    startTime: row.start_time || '',
    endTime:   row.end_time   || '',
    color:     row.color      || COLOR_PRESETS[0],
    location:  row.location   || '',
    notes:     row.notes      || '',
  }
}

function evToDb({ id, title, date, color, location, notes, startTime, endTime }) {
  return { id, title, date, color, location, notes, start_time: startTime || null, end_time: endTime || null }
}

function useEvents() {
  const [events, setEvents] = useState(() => {
    if (supabase) return []
    try { return JSON.parse(ls.get('aaron_life_events') || '[]') }
    catch { return [] }
  })

  const save = (list) => {
    ls.set('aaron_life_events', JSON.stringify(list))
    return list
  }

  useEffect(() => {
    if (supabase) {
      ls.remove('aaron_life_events')
      sb(supabase.from('events').select('*').order('date'))
        .then(({ data } = {}) => { if (Array.isArray(data)) setEvents(data.map(evFromDb)) })

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
    if (supabase) sb(supabase.from('events').insert(evToDb(ev)))
    else fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ev) }).catch(() => {})
  }

  const updateEvent = (id, d) => {
    setEvents(p => {
      const next = p.map(e => e.id === id ? { ...e, ...d } : e)
      return supabase ? next : save(next)
    })
    if (supabase) sb(supabase.from('events').update(evToDb(d)).eq('id', id))
    else fetch(`/api/events/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) }).catch(() => {})
  }

  const deleteEvent = (id) => {
    setEvents(p => {
      const next = p.filter(e => e.id !== id)
      return supabase ? next : save(next)
    })
    if (supabase) sb(supabase.from('events').delete().eq('id', id))
    else fetch(`/api/events/${id}`, { method: 'DELETE' }).catch(() => {})
  }

  const refetchEvents = () => {
    if (supabase)
      sb(supabase.from('events').select('*').order('date'))
        .then(({ data } = {}) => { if (Array.isArray(data)) setEvents(data.map(evFromDb)) })
  }

  return { events, addEvent, updateEvent, deleteEvent, refetchEvents }
}

// ─── useTasks hook ────────────────────────────────────────────────────────────

function useTasks() {
  const [tasks, setTasks] = useState(() => {
    if (supabase) return []
    try {
      const raw = ls.get('aaron_tasks')
      if (raw) return JSON.parse(raw)
      // Migrate from old aaron_todos if present
      const old = ls.get('aaron_todos')
      if (old) {
        const todos = JSON.parse(old)
        const migrated = todos.map(t => ({
          id: t.id || genId(),
          title: t.text || t.title || '',
          priority: 'medium',
          due_date: t.date || null,
          duration: 60,
          category: t.category || 'personal',
          notes: null,
          done: t.done || false,
          done_at: t.doneAt || null,
          created_at: t.createdAt || new Date().toISOString(),
          scheduled_date: null,
          scheduled_start: null,
          scheduled_end: null,
        }))
        ls.set('aaron_tasks', JSON.stringify(migrated))
        return migrated
      }
    } catch {}
    return []
  })

  useEffect(() => {
    if (!supabase) return
    fetchTasks()

    function fetchTasks() {
      sb(supabase.from('tasks').select('*').order('created_at', { ascending: false }))
        .then(({ data } = {}) => { if (Array.isArray(data)) setTasks(data) })
    }

  }, [])

  const save = (list) => { ls.set('aaron_tasks', JSON.stringify(list)); return list }

  const addTask = (d) => {
    const task = {
      ...d, id: genId(),
      done: false, done_at: null,
      created_at: new Date().toISOString(),
    }
    setTasks(p => supabase ? [task, ...p] : save([task, ...p]))
    if (supabase) sb(supabase.from('tasks').insert(task))
    return task
  }

  const updateTask = (id, d) => {
    setTasks(p => {
      const next = p.map(t => t.id === id ? { ...t, ...d } : t)
      return supabase ? next : save(next)
    })
    if (supabase) sb(supabase.from('tasks').update(d).eq('id', id))
  }

  const deleteTask = (id) => {
    setTasks(p => {
      const next = p.filter(t => t.id !== id)
      return supabase ? next : save(next)
    })
    if (supabase) sb(supabase.from('tasks').delete().eq('id', id))
  }

  const refetchTasks = () => {
    if (supabase)
      sb(supabase.from('tasks').select('*').order('created_at', { ascending: false }))
        .then(({ data } = {}) => { if (Array.isArray(data)) setTasks(data) })
  }

  return { tasks, addTask, updateTask, deleteTask, refetchTasks }
}

// ─── WeekGrid ─────────────────────────────────────────────────────────────────

function WeekGrid({
  days, events, tasks, draggingTask,
  onCellClick, onEventClick, onEventToggle, onEventUpdate,
  onTaskClick, onTaskSchedule, onTaskToggle,
}) {
  const today          = todayStr()
  const bodyRef        = useRef(null)
  const weekInnerRef   = useRef(null)
  const dragRef        = useRef(null)
  const justDraggedRef = useRef(false)

  const [nowTop,     setNowTop]     = useState(getNowTop)
  const [dragState,  setDragState]  = useState(null)
  const [dropSlot,   setDropSlot]   = useState(null) // { di, top, height } — task DnD ghost

  useEffect(() => {
    const t = setInterval(() => setNowTop(getNowTop()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = Math.max(0, nowTop - 120)
  }, []) // eslint-disable-line

  // Clear drop ghost when drag ends (user cancels or drops)
  useEffect(() => {
    if (draggingTask) return
    setDropSlot(null)
  }, [draggingTask])

  // ── Event drag (reschedule) ──────────────────────────────────────────────────

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

    const isTouch = !!e.touches
    const startX  = isTouch ? e.touches[0].clientX : e.clientX
    const startY  = isTouch ? e.touches[0].clientY : e.clientY
    let holdTimer = null
    let earlyMoveListener = null

    const cancelEarly = () => {
      clearTimeout(holdTimer)
      if (earlyMoveListener) {
        window.removeEventListener('mousemove',  earlyMoveListener)
        window.removeEventListener('touchmove',  earlyMoveListener)
      }
      window.removeEventListener('mouseup',  cancelEarly)
      window.removeEventListener('touchend', cancelEarly)
    }

    const activateDrag = (activateX = startX, activateY = startY) => {
      cancelEarly()
      if (isTouch && navigator.vibrate) navigator.vibrate(40)

      const cols = weekInnerRef.current?.querySelectorAll('.day-col')
      if (cols?.[di]) {
        const colRect = cols[di].getBoundingClientRect()
        dragRef.current = {
          ev, origDi: di, currentDi: di,
          offsetY: activateY - colRect.top + (bodyRef.current?.scrollTop || 0) - metrics.top,
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

    if (isTouch) {
      // Touch: require 600ms hold to distinguish drag from scroll
      earlyMoveListener = (moveEv) => {
        const cx = moveEv.touches[0].clientX
        const cy = moveEv.touches[0].clientY
        if (Math.hypot(cx - startX, cy - startY) > 8) cancelEarly()
      }
      holdTimer = setTimeout(activateDrag, 600)
      window.addEventListener('touchmove', earlyMoveListener, { passive: true })
      window.addEventListener('touchend', cancelEarly)
    } else {
      // Mouse: activate drag immediately on first movement > threshold
      earlyMoveListener = (moveEv) => {
        if (Math.hypot(moveEv.clientX - startX, moveEv.clientY - startY) > 5) {
          window.removeEventListener('mousemove', earlyMoveListener)
          activateDrag(moveEv.clientX, moveEv.clientY)
        }
      }
      window.addEventListener('mousemove', earlyMoveListener)
      window.addEventListener('mouseup', cancelEarly)
    }
  }

  // ── Task calendar drag (reschedule scheduled tasks) ──────────────────────

  const handleTaskCalDragStart = (e, task, di) => {
    if (task.done) return
    const metrics = getEventMetrics({ startTime: task.scheduled_start, endTime: task.scheduled_end })
    if (!metrics) return

    const isTouch = !!e.touches
    const startX  = isTouch ? e.touches[0].clientX : e.clientX
    const startY  = isTouch ? e.touches[0].clientY : e.clientY
    let holdTimer = null
    let earlyMoveListener = null

    const cancelEarly = () => {
      clearTimeout(holdTimer)
      if (earlyMoveListener) {
        window.removeEventListener('mousemove', earlyMoveListener)
        window.removeEventListener('touchmove', earlyMoveListener)
      }
      window.removeEventListener('mouseup',  cancelEarly)
      window.removeEventListener('touchend', cancelEarly)
    }

    const activateDrag = (activateX = startX, activateY = startY) => {
      cancelEarly()
      if (isTouch && navigator.vibrate) navigator.vibrate(40)

      const cols = weekInnerRef.current?.querySelectorAll('.day-col')
      if (cols?.[di]) {
        const colRect = cols[di].getBoundingClientRect()
        dragRef.current = {
          task, isTask: true, origDi: di, currentDi: di,
          offsetY: activateY - colRect.top + (bodyRef.current?.scrollTop || 0) - metrics.top,
          height: metrics.height, currentTop: metrics.top, didDrag: false,
        }
      }
      setDragState({ taskId: task.id, isTask: true, di, top: metrics.top, height: metrics.height, title: task.title })

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
        window.removeEventListener('mouseup',   onUp)
        window.removeEventListener('touchmove', onMove)
        window.removeEventListener('touchend',  onUp)

        if (!dragRef.current?.didDrag) { dragRef.current = null; setDragState(null); return }

        justDraggedRef.current = true
        setTimeout(() => { justDraggedRef.current = false }, 100)

        const { task, currentTop, currentDi } = dragRef.current
        const slotIndex  = Math.min(Math.floor(currentTop / SLOT_H), TIME_SLOTS.length - 1)
        const slot       = TIME_SLOTS[slotIndex]
        const newStart   = slotToTime(slot.h, slot.m)
        const dur        = task.duration || 60
        const newEndMin  = slot.h * 60 + slot.m + dur
        const newEnd     = newEndMin <= 1440
          ? slotToTime(Math.floor(newEndMin / 60), newEndMin % 60)
          : '23:59'
        onTaskSchedule(task.id, dateToStr(days[currentDi]), newStart, newEnd)
        dragRef.current = null
        setDragState(null)
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup',   onUp)
      window.addEventListener('touchmove', onMove, { passive: false })
      window.addEventListener('touchend',  onUp)
    }

    if (isTouch) {
      earlyMoveListener = (moveEv) => {
        const cx = moveEv.touches[0].clientX
        const cy = moveEv.touches[0].clientY
        if (Math.hypot(cx - startX, cy - startY) > 8) cancelEarly()
      }
      holdTimer = setTimeout(activateDrag, 600)
      window.addEventListener('touchmove', earlyMoveListener, { passive: true })
      window.addEventListener('touchend',  cancelEarly)
    } else {
      earlyMoveListener = (moveEv) => {
        if (Math.hypot(moveEv.clientX - startX, moveEv.clientY - startY) > 5) {
          window.removeEventListener('mousemove', earlyMoveListener)
          activateDrag(moveEv.clientX, moveEv.clientY)
        }
      }
      window.addEventListener('mousemove', earlyMoveListener)
      window.addEventListener('mouseup',   cancelEarly)
    }
  }

  // ── Task DnD (panel → calendar) ───────────────────────────────────────────

  const handleTaskDragOver = (e, di) => {
    // Check dataTransfer types synchronously — React state may not have updated yet
    // when the first dragover fires right after dragstart.
    if (!e.dataTransfer.types.includes('taskid')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    // getBoundingClientRect() already accounts for scroll, so do NOT add scrollTop.
    const rect    = e.currentTarget.getBoundingClientRect()
    const relY    = e.clientY - rect.top
    const slotIdx = Math.max(0, Math.min(TIME_SLOTS.length - 1, Math.floor(relY / SLOT_H)))
    const dur     = draggingTask?.duration || 60
    const height  = Math.max(SLOT_H, (dur / 30) * SLOT_H)
    setDropSlot({ di, top: slotIdx * SLOT_H, height })
  }

  const handleTaskDragLeave = (e, di) => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDropSlot(ds => (ds?.di === di ? null : ds))
    }
  }

  const handleTaskDrop = (e, di, dateStr) => {
    if (!draggingTask) return
    e.preventDefault()
    // Use the ghost slot if available; fall back to drop-event position.
    let slot = dropSlot?.di === di ? dropSlot : null
    if (!slot) {
      const rect    = e.currentTarget.getBoundingClientRect()
      const relY    = e.clientY - rect.top
      const slotIdx = Math.max(0, Math.min(TIME_SLOTS.length - 1, Math.floor(relY / SLOT_H)))
      const dur     = draggingTask.duration || 60
      slot = { di, top: slotIdx * SLOT_H, height: Math.max(SLOT_H, (dur / 30) * SLOT_H) }
    }
    const slotIdx = Math.floor(slot.top / SLOT_H)
    const { h, m } = TIME_SLOTS[slotIdx]
    const start   = slotToTime(h, m)
    const dur     = draggingTask.duration || 60
    const endMin  = h * 60 + m + dur
    const end     = endMin <= 1440 ? slotToTime(Math.floor(endMin / 60), endMin % 60) : '23:59'
    onTaskSchedule(draggingTask.id, dateStr, start, end)
    setDropSlot(null)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="week-grid-wrap">
      {/* Sticky day-header row */}
      <div className={`week-header${days.length === 1 ? ' day-view' : ''}`}>
        <div className="wh-corner" />
        {days.map((day, i) => {
          const isToday = dateToStr(day) === today
          const dayTasks = tasks.filter(t => t.scheduled_date === dateToStr(day) && !t.done)
          return (
            <div key={i} className={`wh-day${isToday ? ' wh-today' : ''}`}>
              <span className="wh-dow">{DAY_SHORT[day.getDay()]}</span>
              <span className="wh-num">{day.getDate()}</span>
              {dayTasks.length > 0 && (
                <span className="wh-task-dot" title={`${dayTasks.length} task${dayTasks.length > 1 ? 's' : ''}`}>
                  {dayTasks.length}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* Scrollable body */}
      <div className="week-body" ref={bodyRef}>
        <div className="week-inner" ref={weekInnerRef}>

          {/* Time label column */}
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
            const dateStr  = dateToStr(day)
            const isToday  = dateStr === today
            const dayEvs   = events.filter(e => e.date === dateStr)
            const dayTasks = tasks.filter(t => t.scheduled_date === dateStr && t.scheduled_start)

            return (
              <div
                key={di}
                className={`day-col${isToday ? ' day-today' : ''}${draggingTask ? ' day-col-droppable' : ''}`}
                style={{ height: TOTAL_H }}
                onClick={e => handleColClick(e, dateStr)}
                onDragOver={e => handleTaskDragOver(e, di)}
                onDragLeave={e => handleTaskDragLeave(e, di)}
                onDrop={e => handleTaskDrop(e, di, dateStr)}
              >
                {TIME_SLOTS.map(({ m }, i) => (
                  <div key={i} className={m === 0 ? 'g-hour' : 'g-half'} style={{ top: i * SLOT_H }} />
                ))}

                {isToday && (
                  <div className="now-line" style={{ top: nowTop }}>
                    <span className="now-dot" />
                  </div>
                )}

                {/* Drag overlay (event or calendar task) */}
                {dragState && dragState.di === di && (
                  dragState.isTask ? (
                    <div className="cal-task ce-drag-overlay" style={{ top: dragState.top, height: dragState.height }}>
                      <div className="ct-body"><span className="ct-title">{dragState.title}</span></div>
                    </div>
                  ) : (
                    <div
                      className="cal-event ce-drag-overlay"
                      style={{ top: dragState.top, height: dragState.height, background: `${dragState.color}40`, borderLeftColor: dragState.color }}
                    >
                      <div className="ce-body"><span className="ce-title">{dragState.title}</span></div>
                    </div>
                  )
                )}

                {/* Event blocks */}
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
                        {m.height >= SLOT_H && st && (
                          <span className="ce-time">
                            <span className="ce-time-row"><svg className="ce-pin ce-pin-start" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>{st}</span>
                            {et && m.height >= SLOT_H * 1.5 && <span className="ce-time-row"><svg className="ce-pin ce-pin-end" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>{et}</span>}
                          </span>
                        )}
                        {ev.notes && m.height > SLOT_H && (
                          <span className="ce-notes">{ev.notes}</span>
                        )}
                      </div>
                    </div>
                  )
                })}

                {/* Scheduled task blocks */}
                {dayTasks.map(task => {
                  const m = getEventMetrics({ startTime: task.scheduled_start, endTime: task.scheduled_end })
                  if (!m || m.top < 0) return null
                  const taskDragging = dragState?.taskId === task.id
                  const tColor = PRIORITY_COLOR[task.priority || 'medium']
                  return (
                    <div
                      key={task.id}
                      className={`cal-task${task.done ? ' ct-done' : ''}${taskDragging ? ' ce-dragging' : ''}`}
                      style={{ top: m.top, height: m.height, cursor: task.done ? 'default' : 'grab', borderLeftColor: tColor, background: `${tColor}18` }}
                      onMouseDown={e => { if (!task.done) { e.stopPropagation(); handleTaskCalDragStart(e, task, di) } }}
                      onTouchStart={e => { if (!task.done) { e.stopPropagation(); handleTaskCalDragStart(e, task, di) } }}
                      onClick={e => { e.stopPropagation(); if (!justDraggedRef.current) onTaskClick(task) }}
                    >
                      <button
                        className={`ct-check${task.done ? ' ct-check-on' : ''}`}
                        style={{ borderColor: tColor, background: task.done ? tColor : 'transparent' }}
                        onMouseDown={e => e.stopPropagation()}
                        onClick={e => {
                          e.stopPropagation()
                          onTaskToggle(task.id, !task.done)
                        }}
                        aria-label={task.done ? 'Mark undone' : 'Mark done'}
                      >
                        {task.done && (
                          <svg viewBox="0 0 10 10" fill="none" stroke="#000" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="1.5 5 4 7.5 8.5 2.5"/>
                          </svg>
                        )}
                      </button>
                      <div className="ce-body">
                        {m.height >= SLOT_H ? (
                          <>
                            <span className="ce-title">
                              <span className="ct-task-prefix" style={{ color: tColor }}>Task</span>
                              <span className="ct-task-name">{task.title}</span>
                            </span>
                            {task.scheduled_start && (
                              <span className="ce-time">
                                <span className="ce-time-row"><svg className="ce-pin ce-pin-start" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>{fmt12(task.scheduled_start)}</span>
                                {task.scheduled_end && m.height >= SLOT_H * 1.5 && <span className="ce-time-row"><svg className="ce-pin ce-pin-end" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>{fmt12(task.scheduled_end)}</span>}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="ce-title ce-title-compact">
                            <span className="ct-task-prefix" style={{ color: tColor, display: 'inline' }}>Task </span>
                            <span style={{ display: 'inline' }}>{task.title}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}

                {/* Task drag-drop ghost */}
                {draggingTask && dropSlot && dropSlot.di === di && (
                  <div className="cal-task-ghost" style={{ top: dropSlot.top, height: dropSlot.height }}>
                    <span className="ct-ghost-label">{draggingTask.title}</span>
                  </div>
                )}
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

  const handleEndChange = (val) => {
    if (val && form.startTime && val <= form.startTime) return
    set('endTime', val)
  }

  const handleSave = () => {
    if (!form.title.trim()) { setError('Title is required'); return }
    if (form.startTime && form.endTime && form.endTime <= form.startTime) {
      setError('End time must be after start time'); return
    }
    const { time: _dropped, ...rest } = form
    onSave(rest)
  }

  return createPortal(
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet">
        <div className="modal-handle" />
        <div className="modal-header">
          <span className="modal-title">{isEdit ? 'Edit Event' : 'New Event'}</span>
          <div className="modal-header-actions">
            {isEdit ? (
              <>
                <button className="ib-btn ib-delete" onClick={() => onDelete(initial.id)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
                  </svg>
                </button>
                <button className="ib-btn ib-save" onClick={handleSave}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </button>
              </>
            ) : (
              <>
                <button className="ib-btn ib-cancel" onClick={onClose}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
                <button className="ib-btn ib-save" onClick={handleSave}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </button>
              </>
            )}
          </div>
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
              <input className="form-input" type="time" value={form.startTime} onChange={e => handleStartChange(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">End</label>
              <input className="form-input" type="time" value={form.endTime} min={form.startTime || undefined} onChange={e => handleEndChange(e.target.value)} />
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
            <label className="form-label">Location <span className="form-optional">(optional)</span></label>
            <input className="form-input" value={form.location || ''} onChange={e => set('location', e.target.value)} placeholder="Where?" />
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

      </div>
    </div>,
    document.body
  )
}

// ─── TaskModal ────────────────────────────────────────────────────────────────


function TaskModal({ task, onSave, onDelete, onClose }) {
  const [title,     setTitle]     = useState(task.title || '')
  const [prio,      setPrio]      = useState(task.priority || 'medium')
  const [due,       setDue]       = useState(task.due_date || '')
  const [sDate,     setSDate]     = useState(task.scheduled_date || '')
  const [start,     setStart]     = useState(task.scheduled_start || '')
  const [end,       setEnd]       = useState(task.scheduled_end || '')
  const [dur,       setDur]       = useState(task.duration ? String(task.duration) : '')
  const [notes,     setNotes]     = useState(task.notes || '')
  const [checklist, setChecklist] = useState(task.checklist || [])
  const [newItem,   setNewItem]   = useState('')
  const [error,     setError]     = useState('')

  const [editItemId, setEditItemId] = useState(null)
  const [editItemText, setEditItemText] = useState('')

  const addItem = () => {
    if (!newItem.trim()) return
    const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)
    setChecklist(cl => [...cl, { id, text: newItem.trim(), done: false }])
    setNewItem('')
  }
  const toggleItem = (id) => setChecklist(cl => cl.map(c => c.id === id ? { ...c, done: !c.done } : c))
  const removeItem = (id) => setChecklist(cl => cl.filter(c => c.id !== id))
  const startEditItem = (item) => { setEditItemId(item.id); setEditItemText(item.text) }
  const saveEditItem = () => {
    if (editItemText.trim()) setChecklist(cl => cl.map(c => c.id === editItemId ? { ...c, text: editItemText.trim() } : c))
    setEditItemId(null)
  }

  const handleStartChange = (val) => {
    setStart(val)
    if (val && (!end || end <= val)) {
      const [h, m] = val.split(':').map(Number)
      const eh = h + 1
      setEnd(eh < 24 ? slotToTime(eh, m) : '23:59')
    }
    // Auto-compute duration
    if (val && end && end > val) {
      const [sh, sm] = val.split(':').map(Number)
      const [eh, em] = end.split(':').map(Number)
      setDur(String((eh * 60 + em) - (sh * 60 + sm)))
    }
  }

  const handleEndChange = (val) => {
    setEnd(val)
    if (start && val && val > start) {
      const [sh, sm] = start.split(':').map(Number)
      const [eh, em] = val.split(':').map(Number)
      setDur(String((eh * 60 + em) - (sh * 60 + sm)))
    }
  }

  const handleDurChange = (val) => {
    setDur(val)
    const mins = parseInt(val)
    if (start && mins > 0) {
      const [sh, sm] = start.split(':').map(Number)
      const total = sh * 60 + sm + mins
      const eh = Math.floor(total / 60) % 24
      const em = total % 60
      setEnd(`${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`)
    }
  }

  const handleSave = () => {
    if (!title.trim()) { setError('Title is required'); return }
    onSave(task.id, {
      title:           title.trim(),
      priority:        prio,
      due_date:        due || null,
      scheduled_date:  sDate || null,
      scheduled_start: start || null,
      scheduled_end:   end || null,
      duration:        dur ? parseInt(dur) : 0,
      notes:           notes || null,
      checklist,
    })
    onClose()
  }

  const pColor = PRIORITY_COLOR[prio]

  return createPortal(
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet">
        <div className="modal-handle" />
        <div className="modal-header">
          <span className="modal-title">Edit Task</span>
          <div className="modal-header-actions">
            <button className="ib-btn ib-delete" onClick={() => {
              onSave(task.id, {
                title, priority: prio, due_date: due || null,
                scheduled_date: null, scheduled_start: null, scheduled_end: null,
                duration: dur ? parseInt(dur) : 0, notes: notes || null, checklist,
              })
              onClose()
            }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
              </svg>
            </button>
            <button className="ib-btn ib-save" onClick={handleSave}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </button>
          </div>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Title</label>
            <input
              className={`form-input${error ? ' input-error' : ''}`}
              value={title}
              onChange={e => { setTitle(e.target.value); setError('') }}
              placeholder="Task name…"
            />
            {error && <span className="form-error">{error}</span>}
          </div>

          <div className="form-group">
            <label className="form-label">Priority</label>
            <div className="tm-prio-row">
              {['low','medium','high'].map(p => (
                <button
                  key={p}
                  className={`tm-prio-btn${prio === p ? ' tm-prio-on' : ''}`}
                  style={{ '--tmc': PRIORITY_COLOR[p] }}
                  onClick={() => setPrio(p)}
                >
                  {PRIORITY_LABEL[p]}
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Due Date <span className="form-optional">(optional)</span></label>
            <input className="form-input" type="date" value={due} onChange={e => setDue(e.target.value)} />
          </div>

          <div className="form-group">
            <label className="form-label">Scheduled Date <span className="form-optional">(optional)</span></label>
            <input className="form-input" type="date" value={sDate} onChange={e => setSDate(e.target.value)} />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Start</label>
              <input className="form-input" type="time" value={start} onChange={e => handleStartChange(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">End</label>
              <input className="form-input" type="time" value={end} onChange={e => handleEndChange(e.target.value)} />
            </div>
          </div>

          {start && end && end > start && (
            <div className="duration-hint">
              {(() => {
                const [sh, sm] = start.split(':').map(Number)
                const [eh, em] = end.split(':').map(Number)
                const mins = (eh * 60 + em) - (sh * 60 + sm)
                const h = Math.floor(mins / 60), m = mins % 60
                return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`
              })()}
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Duration (mins) <span className="form-optional">(optional)</span></label>
            <input className="form-input" type="number" min="0" value={dur}
              onChange={e => handleDurChange(e.target.value)} placeholder="e.g. 60" />
          </div>

          <div className="form-group">
            <label className="form-label">Notes <span className="form-optional">(optional)</span></label>
            <textarea
              className="form-input form-textarea"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Add notes…"
              rows={3}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Checklist</label>
            <div className="tm-checklist">
              {checklist.map(item => (
                <div key={item.id} className="tm-cl-item">
                  <button className={`tm-cl-check${item.done ? ' tm-cl-checked' : ''}`} onClick={() => toggleItem(item.id)}>
                    {item.done && <svg viewBox="0 0 10 8" fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1,4 4,7 9,1"/></svg>}
                  </button>
                  {editItemId === item.id ? (
                    <input
                      className="tm-cl-edit-input"
                      value={editItemText}
                      onChange={e => setEditItemText(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') saveEditItem() }}
                      onBlur={saveEditItem}
                      autoFocus
                    />
                  ) : (
                    <span
                      className={`tm-cl-text${item.done ? ' tm-cl-text-done' : ''}`}
                      onClick={() => startEditItem(item)}
                      style={{ cursor: 'text', flex: 1 }}
                    >{item.text}</span>
                  )}
                  <button className="tm-cl-del" onClick={() => removeItem(item.id)}>✕</button>
                </div>
              ))}
              <div className="tm-cl-add-row">
                <input
                  className="tm-cl-input"
                  value={newItem}
                  placeholder="Add item…"
                  onChange={e => setNewItem(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addItem() }}
                />
                <button className="ib-btn ib-add" onClick={addItem} style={{ width: 32, height: 32, borderRadius: 8 }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>,
    document.body
  )
}

// ─── Month Grid ───────────────────────────────────────────────────────────────

function MonthGrid({ monthOffset, events, tasks, onDayClick, onEventClick }) {
  const today = todayStr()
  const now   = new Date()
  const month = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)

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
            const ds      = dateToStr(day)
            const isToday = ds === today
            const inMonth = day.getMonth() === month.getMonth()
            const dayEvs  = events.filter(e => e.date === ds)
            const dayTasks = tasks.filter(t => t.scheduled_date === ds && !t.done)
            return (
              <div
                key={di}
                className={`month-day${isToday ? ' month-today' : ''}${!inMonth ? ' month-other' : ''}`}
                onClick={() => onDayClick(ds)}
              >
                <span className="month-day-num">{day.getDate()}</span>
                <div className="month-evs">
                  {dayEvs.slice(0, 2).map(ev => (
                    <div
                      key={ev.id}
                      className={`month-ev${ev.done ? ' month-ev-done' : ''}`}
                      style={{ background: `${getEventColor(ev)}35`, borderLeftColor: getEventColor(ev) }}
                      onClick={e => { e.stopPropagation(); onEventClick(ev) }}
                    >
                      {ev.title}
                    </div>
                  ))}
                  {dayTasks.slice(0, 1).map(task => (
                    <div
                      key={task.id}
                      className="month-ev month-task-ev"
                      onClick={e => { e.stopPropagation(); onEventClick(task) }}
                    >
                      {task.title}
                    </div>
                  ))}
                  {(dayEvs.length + dayTasks.length) > 3 && (
                    <div className="month-ev-more">+{dayEvs.length + dayTasks.length - 3} more</div>
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

// ─── Mini calendar dropdown (mobile date picker) ──────────────────────────────

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DOW_LABELS  = ['Su','Mo','Tu','We','Th','Fr','Sa']
const YEAR_RANGE  = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - 2 + i)

function MiniCalPicker({ anchorRect, anchorRef, value, onSelect, onClose }) {
  const [viewDate, setViewDate] = useState(() => {
    const d = value ? new Date(value + 'T00:00:00') : new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const ref = useRef(null)

  // Close on outside tap — but NOT when tapping the anchor button (let the toggle handle that)
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target) &&
          !(anchorRef?.current && anchorRef.current.contains(e.target))) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler, true)
    document.addEventListener('touchstart', handler, true)
    return () => {
      document.removeEventListener('mousedown', handler, true)
      document.removeEventListener('touchstart', handler, true)
    }
  }, [onClose, anchorRef])

  const today = todayStr()
  const year  = viewDate.getFullYear()
  const month = viewDate.getMonth()

  const firstDow  = new Date(year, month, 1).getDay()
  const daysInMon = new Date(year, month + 1, 0).getDate()

  const cells = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMon; d++) cells.push(d)

  const mkDs = (day) => `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`

  // Position: just below the anchor button, horizontally centred under it
  const left = Math.max(6, Math.min(
    (anchorRect.left + anchorRect.right) / 2 - 140,
    window.innerWidth - 286
  ))
  const top = anchorRect.bottom + 6

  return createPortal(
    <div
      ref={ref}
      className="mini-cal-picker"
      style={{ top, left }}
      onMouseDown={e => e.stopPropagation()}
    >
      <div className="mcp-header">
        <button className="mcp-nav" onClick={() => setViewDate(new Date(year, month - 1, 1))}>‹</button>
        <div className="mcp-selects">
          <select
            className="mcp-select"
            value={month}
            onChange={e => setViewDate(new Date(year, +e.target.value, 1))}
          >
            {MONTH_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
          </select>
          <select
            className="mcp-select"
            value={year}
            onChange={e => setViewDate(new Date(+e.target.value, month, 1))}
          >
            {YEAR_RANGE.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <button className="mcp-nav" onClick={() => setViewDate(new Date(year, month + 1, 1))}>›</button>
      </div>
      <div className="mcp-dow-row">
        {DOW_LABELS.map(d => <span key={d}>{d}</span>)}
      </div>
      <div className="mcp-grid">
        {cells.map((day, i) => {
          if (!day) return <span key={`b${i}`} />
          const dateStr = mkDs(day)
          const isToday    = dateStr === today
          const isSelected = dateStr === value
          return (
            <button
              key={dateStr}
              className={`mcp-day${isToday ? ' mcp-today' : ''}${isSelected ? ' mcp-selected' : ''}`}
              onClick={() => { onSelect(dateStr); onClose() }}
            >{day}</button>
          )
        })}
      </div>
    </div>,
    document.body
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Schedule() {
  const { events, addEvent, updateEvent, deleteEvent } = useEvents()
  const { tasks, addTask, updateTask, deleteTask }     = useTasks()

  const [isMobile,    setIsMobile]    = useState(() => screen.width < 768)
  const [view,        setView]        = useState(() => screen.width < 768 ? 'day' : 'week')
  const [weekOffset,  setWeekOffset]  = useState(0)
  const [dayOffset,   setDayOffset]   = useState(0)
  const [monthOffset, setMonthOffset] = useState(0)

  // Event modal (create / edit events)
  const [modal, setModal] = useState(null)
  // Task modal (edit tasks clicked from calendar)
  const [taskModal, setTaskModal] = useState(null)

  // Panel state
  const [panelMode,    setPanelMode]    = useState('default') // 'default' | 'task-detail' | 'create-task'
  const [selectedTask, setSelectedTask] = useState(null)

  // Task being dragged from panel to calendar
  const [draggingTask, setDraggingTask] = useState(null)

  // Mobile task-to-schedule mode
  const [schedulingTask, setSchedulingTask] = useState(null)

  // Collapse panel and enter scheduling mode on long-press
  const handleMobileLongPress = (task) => {
    setSchedulingTask(task)
    setPanelExpanded(false)
  }

  // When scheduling mode is active, tapping a calendar slot schedules the task
  const handleMobileCellClick = (dateStr, startTime, endTime) => {
    if (schedulingTask) {
      const dur = schedulingTask.duration || 60
      const [sh, sm] = startTime.split(':').map(Number)
      const endMin = sh * 60 + sm + dur
      const et = endMin <= 1440
        ? `${String(Math.floor(endMin / 60)).padStart(2,'0')}:${String(endMin % 60).padStart(2,'0')}`
        : '23:59'
      handleTaskSchedule(schedulingTask.id, dateStr, startTime, et)
      setSchedulingTask(null)
    } else {
      openAdd(dateStr, startTime, endTime)
    }
  }

  // Mobile calendar date picker dropdown
  const [mobileCalOpen,  setMobileCalOpen]  = useState(false)
  const [mobileCalRect,  setMobileCalRect]  = useState(null)
  const calAnchorRef = useRef(null)

  const openMobileCal = () => {
    if (mobileCalOpen) { setMobileCalOpen(false); return }
    const rect = calAnchorRef.current?.getBoundingClientRect()
    if (rect) { setMobileCalRect(rect); setMobileCalOpen(true) }
  }

  // Mobile bottom panel (habits & tasks)
  const [panelExpanded, setPanelExpanded] = useState(false)
  const panelRef        = useRef(null)
  const panelDragY     = useRef(null)
  const panelDragH     = useRef(null)

  const onPanelTouchStart = useCallback((e) => {
    const el = panelRef.current
    if (!el) return
    panelDragY.current = e.touches[0].clientY
    panelDragH.current = el.getBoundingClientRect().height
    el.style.transition = 'none'
  }, [])

  const onPanelTouchMove = useCallback((e) => {
    if (panelDragY.current === null) return
    const el = panelRef.current
    if (!el) return
    const dy = e.touches[0].clientY - panelDragY.current
    const navH   = 42
    const minH   = 50
    const maxH   = window.innerHeight - navH - 140
    const newH   = Math.max(minH, Math.min(maxH, panelDragH.current - dy))
    el.style.height = newH + 'px'
  }, [])

  const onPanelTouchEnd = useCallback(() => {
    const el = panelRef.current
    if (!el || panelDragY.current === null) return
    el.style.transition = ''
    el.style.height = ''
    const h = el.getBoundingClientRect().height
    const navH = 42
    const maxH = window.innerHeight - navH - 140
    setPanelExpanded(h > (maxH * 0.4))
    panelDragY.current = null
    panelDragH.current = null
  }, [])

  useEffect(() => {
    const handler = () => {
      const mobile = screen.width < 768
      setIsMobile(mobile)
      if (mobile) setView(v => v === 'week' ? 'day' : v)
    }
    window.addEventListener('orientationchange', handler)
    return () => window.removeEventListener('orientationchange', handler)
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

  // Shorter label for mobile nav (no year in day view)
  const navLabelMobile = () => {
    if (view === 'month') {
      const now = new Date()
      const m = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
      return `${MONTH_SHORT[m.getMonth()]} ${m.getFullYear()}`
    }
    if (view === 'day') {
      const d = days[0]
      return `${DAY_SHORT[d.getDay()]}, ${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`
    }
    return weekRangeLabel(days)
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

  const navigateToDate = (val) => {
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

  const handleDatePick = (e) => navigateToDate(e.target.value)

  const handleMonthDayClick = (ds) => {
    const picked = new Date(ds + 'T00:00:00')
    const today  = new Date(); today.setHours(0, 0, 0, 0)
    setDayOffset(Math.round((picked - today) / 86400000))
    setView('day')
  }

  const pickerValue = view === 'month'
    ? (() => { const now = new Date(); const m = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1); return dateToStr(m) })()
    : dateToStr(days[0])

  const openAdd    = (date, startTime, endTime) =>
    setModal({ initial: { date, startTime: startTime || '', endTime: endTime || '', title: '', color: COLOR_PRESETS[0], notes: '', location: '' } })
  const openEdit   = (ev) => setModal({ initial: ev })
  const closeModal = ()   => setModal(null)

  const handleSave = (form) => {
    if (modal.initial?.id) updateEvent(modal.initial.id, form)
    else addEvent(form)
    closeModal()
  }

  const handleTaskClick = (task) => {
    // Open the task edit modal (same UX as event click)
    const fresh = tasks.find(t => t.id === task.id) || task
    setTaskModal(fresh)
  }

  const handleTaskSchedule = (taskId, date, start, end) => {
    updateTask(taskId, { scheduled_date: date, scheduled_start: start, scheduled_end: end })
    // Reflect in selectedTask if open
    if (selectedTask?.id === taskId) {
      setSelectedTask(t => ({ ...t, scheduled_date: date, scheduled_start: start, scheduled_end: end }))
    }
  }

  const handleTaskToggle = (taskId, done) => {
    updateTask(taskId, { done, done_at: done ? new Date().toISOString() : null })
    if (selectedTask?.id === taskId) setSelectedTask(t => ({ ...t, done }))
  }

  const handleTaskUpdate = (id, d) => {
    updateTask(id, d)
    if (selectedTask?.id === id) setSelectedTask(t => ({ ...t, ...d }))
  }

  const handleTaskDelete = (id) => {
    deleteTask(id)
    if (selectedTask?.id === id) { setSelectedTask(null); setPanelMode('default') }
  }

  const handleDateClick = (dateStr) => {
    const picked = new Date(dateStr + 'T00:00:00')
    const today  = new Date(); today.setHours(0, 0, 0, 0)
    if (view === 'week') {
      const toMon = (d) => d.getDay() === 0 ? -6 : 1 - d.getDay()
      const pickedMon = new Date(picked); pickedMon.setDate(picked.getDate() + toMon(picked))
      const thisMon   = new Date(today);  thisMon.setDate(today.getDate() + toMon(today))
      setWeekOffset(Math.round((pickedMon - thisMon) / (7 * 86400000)))
    } else if (view === 'day') {
      setDayOffset(Math.round((picked - today) / 86400000))
    } else {
      const now = new Date()
      setMonthOffset((picked.getFullYear() - now.getFullYear()) * 12 + picked.getMonth() - now.getMonth())
    }
  }

  // ── Mobile layout ─────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div className="schedule-page">

        {/* Date nav + view toggles — all one row on mobile */}
        <div className="week-nav week-nav-mobile">
          <button className="wnav-btn" onClick={goPrev}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <div className="wnav-date-wrap" ref={calAnchorRef}>
            <span className="wnav-range wnav-date-btn" onClick={openMobileCal}>
              {navLabelMobile()}
              <svg className="wnav-cal-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </span>
          </div>
          {mobileCalOpen && mobileCalRect && (
            <MiniCalPicker
              anchorRect={mobileCalRect}
              anchorRef={calAnchorRef}
              value={pickerValue}
              onSelect={navigateToDate}
              onClose={() => setMobileCalOpen(false)}
            />
          )}
          {!isAtToday && (
            <button className="wnav-today" onClick={goToday}>Today</button>
          )}
          <div className="wnav-view-group">
            {['day', 'month'].map(v => (
              <button key={v} className={`vt-btn${view === v ? ' vt-active' : ''}`} onClick={() => setView(v)}>
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
            <AddBtn onClick={() => openAdd(todayStr(), '', '')} />
          </div>
          <button className="wnav-btn" onClick={goNext}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        </div>

        {/* Scheduling mode banner */}
        {schedulingTask && (
          <div className="ms-scheduling-banner">
            <span>Tap a time slot to schedule <strong>{schedulingTask.title}</strong></span>
            <button className="ms-sched-cancel" onClick={() => setSchedulingTask(null)}>✕ Cancel</button>
          </div>
        )}

        {/* Calendar — fills remaining space; fixed panel sits on top */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', paddingBottom: '50px' }}>
          {view === 'month' ? (
            <MonthGrid
              monthOffset={monthOffset}
              events={events}
              tasks={tasks}
              onDayClick={handleMonthDayClick}
              onEventClick={openEdit}
            />
          ) : (
            <WeekGrid
              days={days}
              events={events}
              tasks={tasks}
              draggingTask={draggingTask}
              onCellClick={handleMobileCellClick}
              onEventClick={openEdit}
              onEventToggle={(id, done) => updateEvent(id, { done })}
              onEventUpdate={updateEvent}
              onTaskClick={handleTaskClick}
              onTaskSchedule={handleTaskSchedule}
              onTaskToggle={handleTaskToggle}
            />
          )}
        </div>

        {/* Expandable bottom panel — Habits & Tasks */}
        <div ref={panelRef} className={`ms-bottom-panel${panelExpanded ? ' ms-panel-open' : ''}`}>
          <div
            className={`ms-panel-handle ${panelExpanded ? 'ms-handle-open' : 'ms-handle-closed'}`}
            onTouchStart={onPanelTouchStart}
            onTouchMove={onPanelTouchMove}
            onTouchEnd={onPanelTouchEnd}
          >
            {panelExpanded ? (
              <>
                <span className="ms-panel-pip" />
                <svg className="ms-panel-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </>
            ) : (
              <>
                <span className="ms-panel-label">Habits &amp; Tasks</span>
                <span className="ms-panel-hint">↑ slide up</span>
              </>
            )}
          </div>
          <TaskPanel
            mobileMode={true}
            tasks={tasks}
            events={events}
            onAddTask={addTask}
            onUpdateTask={handleTaskUpdate}
            onDeleteTask={handleTaskDelete}
            onTaskToggle={handleTaskToggle}
            onDragStart={setDraggingTask}
            onDragEnd={() => setDraggingTask(null)}
            onMobileLongPress={handleMobileLongPress}
            onDateClick={handleDateClick}
            onPanelTouchStart={onPanelTouchStart}
            onPanelTouchMove={onPanelTouchMove}
            onPanelTouchEnd={onPanelTouchEnd}
          />
        </div>

        {modal && (
          <EventModal
            initial={modal.initial}
            onSave={handleSave}
            onDelete={(id) => { deleteEvent(id); closeModal() }}
            onClose={closeModal}
          />
        )}
        {taskModal && (
          <TaskModal
            task={taskModal}
            onSave={handleTaskUpdate}
            onDelete={handleTaskDelete}
            onClose={() => setTaskModal(null)}
          />
        )}
      </div>
    )
  }

  // ── Desktop layout ─────────────────────────────────────────────────────────
  return (
    <div className="schedule-page">
      <div className="sched-layout">

        {/* ── Task panel (desktop only) ── */}
        {!isMobile && (
          <div className="sched-tasks-panel">
            <TaskPanel
              tasks={tasks}
              events={events}
              panelMode={panelMode}
              selectedTask={selectedTask}
              onPanelMode={setPanelMode}
              onSelectTask={handleTaskClick}
              onAddTask={addTask}
              onUpdateTask={handleTaskUpdate}
              onDeleteTask={handleTaskDelete}
              onTaskToggle={handleTaskToggle}
              onDragStart={setDraggingTask}
              onDragEnd={() => setDraggingTask(null)}
              onDateClick={handleDateClick}
              isAtToday={isAtToday}
              onGoToday={goToday}
            />
          </div>
        )}

        {/* ── Calendar panel ── */}
        <div className="sched-cal-panel">
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
            {isMobile && (
              <button className="vt-btn vt-planner-btn" onClick={() => setShowPlanner(true)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
                  <circle cx="3" cy="6" r="1" fill="currentColor"/><circle cx="3" cy="12" r="1" fill="currentColor"/><circle cx="3" cy="18" r="1" fill="currentColor"/>
                </svg>
                Planner
              </button>
            )}
          </div>

          {view === 'month' ? (
            <MonthGrid
              monthOffset={monthOffset}
              events={events}
              tasks={tasks}
              onDayClick={handleMonthDayClick}
              onEventClick={openEdit}
            />
          ) : (
            <WeekGrid
              days={days}
              events={events}
              tasks={tasks}
              draggingTask={draggingTask}
              onCellClick={openAdd}
              onEventClick={openEdit}
              onEventToggle={(id, done) => updateEvent(id, { done })}
              onEventUpdate={updateEvent}
              onTaskClick={handleTaskClick}
              onTaskSchedule={handleTaskSchedule}
              onTaskToggle={handleTaskToggle}
            />
          )}
        </div>

      </div>

      {/* FAB — add event (desktop) */}
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

      {taskModal && (
        <TaskModal
          task={taskModal}
          onSave={handleTaskUpdate}
          onDelete={handleTaskDelete}
          onClose={() => setTaskModal(null)}
        />
      )}
    </div>
  )
}
