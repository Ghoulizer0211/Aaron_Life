/*
 * TaskPanel.jsx — Left sidebar: Mini Calendar + Habit Tracker + Task List
 *
 * NEW Supabase tables required (run once in your Supabase SQL editor):
 *
 *   create table if not exists habits (
 *     id          uuid primary key default gen_random_uuid(),
 *     name        text not null,
 *     goal        integer not null default 7,
 *     created_at  timestamptz default now()
 *   );
 *   -- If table already exists: alter table habits add column if not exists goal integer not null default 7;
 *
 *   create table if not exists habit_logs (
 *     id          uuid primary key default gen_random_uuid(),
 *     habit_id    uuid references habits(id) on delete cascade,
 *     log_date    date not null,
 *     done        boolean default true,
 *     unique(habit_id, log_date)
 *   );
 */

import { useState, useEffect, useCallback } from 'react'
import { supabase, sb } from '../lib/supabase'

// ─── Constants ─────────────────────────────────────────────────────────────────

const PRIORITY_COLOR = { high: '#ff3864', medium: '#ffe600', low: '#00ff9d' }
const PRIORITY_LABEL = { high: 'High', medium: 'Med', low: 'Low' }
const MONTH_SHORT    = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const DAY_LETTER     = ['M','T','W','T','F','S','S'] // Mon → Sun

// Color per day column: Mon → Sun
const DAY_COLORS = ['#00e5ff','#00ff9d','#ffe600','#ff6c2f','#ff2d78','#bf5fff','#ff3864']

// ─── Helpers ───────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}

function ds(d) {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}

function genId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// Mon–Sun of the current week as YYYY-MM-DD strings
function currentWeekDates() {
  const now = new Date()
  const dow = now.getDay()
  const toMon = dow === 0 ? -6 : 1 - dow
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now)
    d.setDate(now.getDate() + toMon + i)
    return ds(d)
  })
}

function fmtDur(mins) {
  const h = Math.floor(mins / 60), m = mins % 60
  if (h && m) return `${h}h${m}m`
  return h ? `${h}h` : `${m}m`
}

function formatDue(dateS) {
  if (!dateS) return null
  const today = todayStr()
  if (dateS === today) return { label: 'Today', over: false }
  if (dateS < today)   return { label: new Date(dateS + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), over: true }
  const t = new Date(); t.setDate(t.getDate() + 1)
  if (dateS === ds(t)) return { label: 'Tomorrow', over: false }
  return { label: new Date(dateS + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), over: false }
}

// ─── useHabits ─────────────────────────────────────────────────────────────────

function useHabits() {
  const [habits, setHabits] = useState([])
  const [logs,   setLogs]   = useState({}) // { [habitId]: Set<YYYY-MM-DD> }

  useEffect(() => {
    if (!supabase) return

    sb(supabase.from('habits').select('*').order('created_at'))
      .then(({ data } = {}) => { if (Array.isArray(data)) setHabits(data) })

    // 90 days back — enough for streak calculation
    const since = new Date()
    since.setDate(since.getDate() - 90)
    sb(supabase.from('habit_logs').select('*').gte('log_date', ds(since)).eq('done', true))
      .then(({ data } = {}) => {
        if (!Array.isArray(data)) return
        const map = {}
        data.forEach(l => {
          if (!map[l.habit_id]) map[l.habit_id] = new Set()
          map[l.habit_id].add(l.log_date)
        })
        setLogs(map)
      })
  }, [])

  const toggleLog = useCallback((habitId, dateS, currentlyDone) => {
    setLogs(prev => {
      const set = new Set(prev[habitId] || [])
      currentlyDone ? set.delete(dateS) : set.add(dateS)
      return { ...prev, [habitId]: set }
    })
    if (!supabase) return
    if (currentlyDone) {
      sb(supabase.from('habit_logs').delete().eq('habit_id', habitId).eq('log_date', dateS))
    } else {
      sb(supabase.from('habit_logs').upsert(
        { habit_id: habitId, log_date: dateS, done: true },
        { onConflict: 'habit_id,log_date' }
      ))
    }
  }, [])

  const addHabit = useCallback((name, goal = 7) => {
    const habit = { id: genId(), name: name.trim(), goal, created_at: new Date().toISOString() }
    setHabits(p => [...p, habit])
    if (supabase) sb(supabase.from('habits').insert(habit))
  }, [])

  const deleteHabit = useCallback((id) => {
    setHabits(p => p.filter(h => h.id !== id))
    if (supabase) sb(supabase.from('habits').delete().eq('id', id))
  }, [])

  const updateHabit = useCallback((id, changes) => {
    setHabits(p => p.map(h => h.id === id ? { ...h, ...changes } : h))
    if (supabase) sb(supabase.from('habits').update(changes).eq('id', id))
  }, [])

  const getStreak = useCallback((habitId) => {
    const done = logs[habitId] || new Set()
    const cursor = new Date(todayStr() + 'T12:00')
    let streak = 0
    while (done.has(ds(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1) }
    return streak
  }, [logs])

  return { habits, logs, toggleLog, addHabit, deleteHabit, updateHabit, getStreak }
}

// ─── Section (collapsible) ─────────────────────────────────────────────────────

function Section({ title, children, defaultOpen = true, onAdd }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`sc-section${open ? ' sc-open' : ''}`}>
      <div className="sc-section-hdr-row">
        <button className="sc-section-hdr" onClick={() => setOpen(o => !o)}>
          <span className="sc-section-title">{title}</span>
          <svg className="sc-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {onAdd && (
          <button className="sc-section-add" onClick={onAdd} aria-label={`Add ${title}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        )}
      </div>
      {open && <div className="sc-section-body">{children}</div>}
    </div>
  )
}

// ─── MiniCalendar ──────────────────────────────────────────────────────────────

function MiniCalendar({ events, tasks, onDateClick, isAtToday, onGoToday }) {
  const [offset, setOffset] = useState(0) // month offset from today's month
  const today = todayStr()

  const now   = new Date()
  const month = new Date(now.getFullYear(), now.getMonth() + offset, 1)
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
  const rows = weeks[5].every(d => d.getMonth() !== month.getMonth()) ? weeks.slice(0, 5) : weeks

  const dotDates = new Set([
    ...events.map(e => e.date).filter(Boolean),
    ...tasks.map(t => t.scheduled_date).filter(Boolean),
  ])

  const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December']
  const currentYear = now.getFullYear()
  const yearRange = Array.from({ length: 8 }, (_, i) => currentYear - 1 + i)

  return (
    <div className="sc-mini-cal">
      <div className="sc-mini-nav">
        <button className="sc-mini-arrow" onClick={() => setOffset(o => o - 1)}>‹</button>
        <div className="sc-mini-pickers">
          <select className="sc-mini-select" value={month.getMonth()} onChange={(e) => {
            const newMonth = parseInt(e.target.value)
            setOffset((month.getFullYear() - now.getFullYear()) * 12 + (newMonth - now.getMonth()))
          }}>
            {MONTH_FULL.map((m, i) => <option key={i} value={i}>{m}</option>)}
          </select>
          <select className="sc-mini-select" value={month.getFullYear()} onChange={(e) => {
            const newYear = parseInt(e.target.value)
            setOffset((newYear - now.getFullYear()) * 12 + (month.getMonth() - now.getMonth()))
          }}>
            {yearRange.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <button className="sc-mini-arrow" onClick={() => setOffset(o => o + 1)}>›</button>
        {(offset !== 0 || !isAtToday) && (
          <button className="sc-mini-today" onClick={() => { setOffset(0); onGoToday?.() }}>Today</button>
        )}
      </div>

      <div className="sc-mini-dow">
        {DAY_LETTER.map((d, i) => <div key={i} className="sc-mini-dh">{d}</div>)}
      </div>

      {rows.map((week, wi) => (
        <div key={wi} className="sc-mini-week">
          {week.map((day, di) => {
            const dateS   = ds(day)
            const inMonth = day.getMonth() === month.getMonth()
            const isToday = dateS === today
            const hasDot  = dotDates.has(dateS)
            return (
              <button
                key={di}
                className={`sc-mini-day${isToday ? ' sc-today' : ''}${!inMonth ? ' sc-other' : ''}`}
                onClick={() => onDateClick(dateS)}
              >
                <span className="sc-day-num">{day.getDate()}</span>
                {hasDot && <span className="sc-dot" />}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ─── HabitTracker ──────────────────────────────────────────────────────────────

function HabitTracker({ showAdd, onShowAddChange }) {
  const { habits, logs, toggleLog, addHabit, deleteHabit, updateHabit, getStreak } = useHabits()
  const [addingName,    setAddingName]    = useState('')
  const [addingGoal,    setAddingGoal]    = useState(7)

  const setShowAdd = (v) => { onShowAddChange(v); if (v) setEditingId(null) }
  const [editingId,     setEditingId]     = useState(null)
  const [editName,      setEditName]      = useState('')
  const [editGoal,      setEditGoal]      = useState(7)
  const weekDates = currentWeekDates()
  const today     = todayStr()

  const handleAdd = () => {
    if (!addingName.trim()) return
    addHabit(addingName, addingGoal)
    setAddingName('')
    setAddingGoal(7)
    setShowAdd(false)
  }

  const startEdit = (habit) => {
    setEditingId(habit.id)
    setEditName(habit.name)
    setEditGoal(habit.goal || 7)
    onShowAddChange(false)
  }

  const saveEdit = () => {
    if (!editName.trim()) return
    updateHabit(editingId, { name: editName.trim(), goal: editGoal })
    setEditingId(null)
  }

  return (
    <div className="ht-wrap">
      {/* Column headers — aligns with ht-row-bottom */}
      <div className="ht-header">
        <div className="ht-goal-hdr">Goal</div>
        {weekDates.map((dateS, i) => (
          <div
            key={i}
            className={`ht-dh${dateS === today ? ' ht-dh-today' : ''}`}
            style={{ color: DAY_COLORS[i] }}
          >
            {DAY_LETTER[i]}
          </div>
        ))}
        <div className="ht-pct-hdr">%</div>
      </div>

      {habits.length === 0 && !showAdd && (
        <div className="ht-empty">No habits yet</div>
      )}

      {habits.map((habit) => {
        const done      = logs[habit.id] || new Set()
        const goal      = habit.goal || 7
        const doneCount = weekDates.filter(d => done.has(d)).length
        const pct       = Math.round((doneCount / goal) * 100)
        const pctColor  = pct >= 100 ? '#00ff9d' : pct >= 50 ? '#ffe600' : '#ff3864'
        const isEditing = editingId === habit.id

        return (
          <div key={habit.id} className={`ht-row${isEditing ? ' ht-row-editing' : ''}`}>
            {/* Row 1: name + edit button */}
            <div className="ht-row-top">
              {isEditing ? (
                <input
                  className="ht-inline-input"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingId(null) }}
                />
              ) : (
                <span className="ht-name">{habit.name}</span>
              )}
              <button
                className="ht-edit-btn"
                onClick={() => isEditing ? saveEdit() : startEdit(habit)}
                aria-label={isEditing ? 'Save habit' : 'Edit habit'}
              >
                {isEditing ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                )}
              </button>
            </div>
            {/* Row 2: goal + checkboxes + % bar */}
            <div className="ht-row-bottom">
              {isEditing ? (
                <button className="ht-goal-cycle" onClick={() => setEditGoal(g => g === 7 ? 1 : g + 1)} title="Tap to change goal">
                  {editGoal}
                </button>
              ) : (
                <span className="ht-goal-val">{goal}</span>
              )}
              {weekDates.map((dateS, i) => {
                const isDone   = done.has(dateS)
                const isFuture = dateS > today
                const isToday  = dateS === today
                return (
                  <button
                    key={i}
                    disabled={isFuture || isEditing}
                    style={{ '--dc': DAY_COLORS[i] }}
                    className={`ht-cb${isDone ? ' ht-done' : ''}${isToday ? ' ht-today' : ''}${isFuture ? ' ht-future' : ''}`}
                    onClick={() => toggleLog(habit.id, dateS, isDone)}
                    aria-label={`${isDone ? 'Unmark' : 'Mark'} ${habit.name} on ${dateS}`}
                  />
                )
              })}
              <span className="ht-pct-bar" title={`${pct}%`}>
                <span className="ht-pct-fill" style={{ width: `${Math.min(pct, 100)}%`, background: pctColor }} />
              </span>
            </div>
          </div>
        )
      })}

      {showAdd && (
        <div className="ht-add-form">
          <div className="ht-add-row">
            <input
              className="ht-add-input"
              value={addingName}
              onChange={e => setAddingName(e.target.value)}
              placeholder="Habit name…"
              onKeyDown={e => {
                if (e.key === 'Enter')  handleAdd()
                if (e.key === 'Escape') { setShowAdd(false); setAddingName('') }
              }}
            />
          </div>
          <div className="ht-add-goal-row">
            <span className="ht-add-goal-label">Goal / week:</span>
            <div className="ht-goal-btns">
              {[1,2,3,4,5,6,7].map(n => (
                <button
                  key={n}
                  className={`ht-goal-btn${addingGoal === n ? ' ht-goal-on' : ''}`}
                  onClick={() => setAddingGoal(n)}
                >{n}</button>
              ))}
            </div>
            <button className="ht-add-save" onClick={handleAdd}>Add</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── TaskList ──────────────────────────────────────────────────────────────────

function tomorrowStr() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}

function fmtDateLabel(dateS) {
  if (!dateS) return ''
  const today = todayStr()
  const tom   = tomorrowStr()
  if (dateS === today) return 'Today'
  if (dateS === tom)   return 'Tomorrow'
  return new Date(dateS + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const PRIO_ORDER = { high: 0, medium: 1, low: 2 }
const sortByPrio = arr => [...arr].sort((a, b) =>
  (PRIO_ORDER[a.priority || 'medium'] ?? 1) - (PRIO_ORDER[b.priority || 'medium'] ?? 1)
)

function TaskRow({ task, onTaskToggle, onUpdateTask, onDeleteTask, onDragStart, onDragEnd, editingId, setEditingId }) {
  const editing = editingId === task.id
  const [editTitle, setEditTitle] = useState('')
  const [editPrio,  setEditPrio]  = useState('medium')
  const [editDate,  setEditDate]  = useState('')
  const [editDur,   setEditDur]   = useState('')
  const [checklist,  setChecklist]  = useState(task.checklist || [])
  const [newItem,    setNewItem]    = useState('')
  const [expanded,   setExpanded]   = useState(false)
  const today = todayStr()

  const startEdit = () => {
    setEditTitle(task.title)
    setEditPrio(task.priority || 'medium')
    setEditDate(task.due_date || '')
    setEditDur(task.duration ? String(task.duration) : '')
    setChecklist(task.checklist || [])
    setEditingId(task.id)
  }
  const saveEdit = () => {
    if (!editTitle.trim()) return
    onUpdateTask(task.id, { title: editTitle.trim(), priority: editPrio, due_date: editDate || null, duration: editDur ? parseInt(editDur) : 0, checklist })
    setEditingId(null)
  }

  const addItem = () => {
    if (!newItem.trim()) return
    setChecklist(cl => [...cl, { id: genId(), text: newItem.trim(), done: false }])
    setNewItem('')
  }
  const toggleItem = (id) => setChecklist(cl => cl.map(c => c.id === id ? { ...c, done: !c.done } : c))
  const removeItem = (id) => setChecklist(cl => cl.filter(c => c.id !== id))

  const prio   = task.priority || 'medium'
  const pColor = PRIORITY_COLOR[prio]

  if (editing) return (
    <div className="tl-edit-form" style={{ borderLeft: `3px solid ${PRIORITY_COLOR[editPrio]}` }}>
      <input className="tl-add-input" value={editTitle}
        onChange={e => setEditTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingId(null) }}
        autoFocus />
      <div className="tl-add-prios" style={{ marginTop: 4 }}>
        {['low','medium','high'].map(p => (
          <button key={p} className={`tl-prio-btn${editPrio === p ? ' tl-prio-on' : ''}`}
            style={{ '--pc': PRIORITY_COLOR[p] }} onClick={() => setEditPrio(p)}>{p}</button>
        ))}
      </div>
      <div className="tl-due-row" style={{ marginTop: 4 }}>
        <span className="tl-due-label">Due:</span>
        <input type="date" className="tl-due-input" value={editDate} onChange={e => setEditDate(e.target.value)} />
        {editDate && <button className="tl-due-clear" onClick={() => setEditDate('')}>✕</button>}
      </div>
      <div className="tl-due-row" style={{ marginTop: 4 }}>
        <span className="tl-due-label">Duration:</span>
        <input className="tl-due-input" type="number" min="0" placeholder="mins" value={editDur} onChange={e => setEditDur(e.target.value)} />
      </div>
      <div className="tl-cl-section">
        <div className="tl-cl-label">Checklist</div>
        {checklist.map(item => (
          <div key={item.id} className="tl-cl-item">
            <button className={`tl-cl-check${item.done ? ' tl-cl-checked' : ''}`} onClick={() => toggleItem(item.id)}>
              {item.done && <svg viewBox="0 0 10 8" fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1,4 4,7 9,1"/></svg>}
            </button>
            <span className={`tl-cl-text${item.done ? ' tl-cl-text-done' : ''}`}>{item.text}</span>
            <button className="tl-cl-del" onClick={() => removeItem(item.id)}>✕</button>
          </div>
        ))}
        <div className="tl-cl-add-row">
          <input
            className="tl-cl-input"
            value={newItem}
            placeholder="Add item…"
            onChange={e => setNewItem(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addItem() }}
          />
          <button className="tl-cl-add-btn" onClick={addItem}>+</button>
        </div>
      </div>
      {task.scheduled_date && (
        <button className="tl-unschedule-btn" onClick={() => {
          onUpdateTask(task.id, { scheduled_date: null, scheduled_start: null, scheduled_end: null })
          setEditingId(null)
        }}>
          Remove from schedule
        </button>
      )}
      <div className="tl-edit-actions">
        <button className="tl-edit-save" onClick={saveEdit}>Save</button>
        <button className="tl-edit-cancel" onClick={() => setEditingId(null)}>Cancel</button>
        <button className="tl-edit-delete" onClick={() => onDeleteTask(task.id)}>Delete</button>
      </div>
    </div>
  )

  return (
    <div className={`tl-task-wrap${task.done ? ' tl-task-done' : ''}`} style={{ borderLeft: `3px solid ${pColor}` }}>
      <div className="tl-task"
        style={{ '--tpc': pColor }}
        draggable={!task.done}
        onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('taskid', task.id); onDragStart(task) }}
        onDragEnd={onDragEnd}
      >
        <span className="tl-drag" />
        {(() => {
          const hasUnfinished = checklist.length > 0 && !checklist.every(c => c.done)
          return (
            <button
              className={`tl-check${task.done ? ' tl-check-done' : ''}${hasUnfinished ? ' tl-check-locked' : ''}`}
              style={{ borderColor: pColor, background: task.done ? pColor : 'transparent' }}
              disabled={hasUnfinished}
              title={hasUnfinished ? 'Complete all sub-items first' : undefined}
              onClick={() => onTaskToggle(task.id, !task.done)}>
              {task.done && <svg viewBox="0 0 10 8" fill="none" stroke="#000" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="1,4 4,7 9,1"/></svg>}
            </button>
          )
        })()}
        <span className="tl-name">{task.title}</span>
        {task.duration > 0 && <span className="tl-dur">{fmtDur(task.duration)}</span>}
        <span className="tl-prio-badge" style={{ '--pc': pColor }}>{PRIORITY_LABEL[prio]}</span>
        {checklist.length > 0 && (
          <button className="tl-cl-toggle" onClick={() => setExpanded(e => !e)} aria-label="Toggle checklist">
            <span className="tl-cl-badge">{checklist.filter(c => c.done).length}/{checklist.length}</span>
            <svg className={`tl-cl-chevron${expanded ? ' tl-cl-chevron-open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
        )}
        {!task.done && (
          <button className="tl-edit-btn" onClick={startEdit} aria-label="Edit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
        )}
      </div>
      {expanded && checklist.length > 0 && (
        <div className="tl-cl-dropdown">
          {checklist.map(item => (
            <div key={item.id} className="tl-cl-item">
              <button className={`tl-cl-check${item.done ? ' tl-cl-checked' : ''}`}
                onClick={() => {
                  const updated = checklist.map(c => c.id === item.id ? { ...c, done: !c.done } : c)
                  setChecklist(updated)
                  onUpdateTask(task.id, { checklist: updated })
                  if (updated.every(c => c.done) && !task.done) {
                    onTaskToggle(task.id, true)
                  } else if (!updated.every(c => c.done) && task.done) {
                    onTaskToggle(task.id, false)
                  }
                }}>
                {item.done && <svg viewBox="0 0 10 8" fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1,4 4,7 9,1"/></svg>}
              </button>
              <span className={`tl-cl-text${item.done ? ' tl-cl-text-done' : ''}`}>{item.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TaskList({ tasks, onAddTask, onUpdateTask, onDeleteTask, onTaskToggle, onDragStart, onDragEnd, selectedDate, onClearDate, showAdd, onShowAddChange }) {
  const [editingId, setEditingId] = useState(null)

  const handleSetEditingId = (id) => { setEditingId(id); if (id) onShowAddChange(false) }
  const handleSetShowAdd = (v) => { onShowAddChange(v); if (v) setEditingId(null) }
  const [newTitle,     setNewTitle]     = useState('')
  const [newPrio,      setNewPrio]      = useState('medium')
  const [newDate,      setNewDate]      = useState('')
  const [newDur,       setNewDur]       = useState('')
  const [newChecklist, setNewChecklist] = useState([])
  const [newItem,      setNewItem]      = useState('')
  const today = todayStr()

  const addNewItem = () => {
    if (!newItem.trim()) return
    setNewChecklist(cl => [...cl, { id: genId(), text: newItem.trim(), done: false }])
    setNewItem('')
  }

  const handleAdd = () => {
    if (!newTitle.trim()) return
    onAddTask({
      title:           newTitle.trim(),
      priority:        newPrio,
      due_date:        newDate || null,
      duration:        newDur ? parseInt(newDur) : 60,
      notes:           null,
      checklist:       newChecklist,
      scheduled_date:  null,
      scheduled_start: null,
      scheduled_end:   null,
    })
    setNewTitle('')
    setNewPrio('medium')
    setNewDate('')
    setNewDur('')
    setNewChecklist([])
    setNewItem('')
    handleSetShowAdd(false)
  }

  // Active date for section 1
  const activeDate = selectedDate || today

  // Section 1: tasks for activeDate (all, including done — shown with strikethrough)
  const dateTasks  = sortByPrio(tasks.filter(t =>
    t.due_date === activeDate || t.scheduled_date === activeDate
  ))
  const doneCount  = dateTasks.filter(t => t.done).length
  const totalCount = dateTasks.length
  const pct        = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : null
  const pctColor   = pct === null ? '#888' : pct >= 100 ? '#00ff9d' : pct >= 50 ? '#ffe600' : '#ff3864'

  // Section 2: upcoming tasks (due_date after activeDate), grouped by date
  const upcomingTasks = tasks.filter(t => t.due_date && t.due_date > activeDate)
  const upcomingDates = [...new Set(upcomingTasks.map(t => t.due_date))].sort()
  const upcomingByDate = upcomingDates.map(d => ({
    date:  d,
    items: sortByPrio(upcomingTasks.filter(t => t.due_date === d)),
  }))

  // Section 3: no due date, not done
  const moreTasks = sortByPrio(tasks.filter(t => !t.done && !t.due_date))

  const rowProps = { onTaskToggle, onUpdateTask, onDeleteTask, onDragStart, onDragEnd, editingId, setEditingId: handleSetEditingId }

  return (
    <div className="tl-wrap">

      {/* ── Section 1: Today / selected date ── */}
      <div className="tl-section-hdr">
        <span>{fmtDateLabel(activeDate)}</span>
        {selectedDate && (
          <button className="tl-date-clear" onClick={onClearDate} aria-label="Clear date filter">✕</button>
        )}
      </div>

      {pct !== null && (
        <div className="tl-progress-wrap">
          <div className="tl-progress-bar">
            <div className="tl-progress-fill" style={{ width: `${pct}%`, background: pctColor }} />
          </div>
          <span className="tl-progress-label" style={{ color: pctColor }}>{doneCount}/{totalCount}</span>
        </div>
      )}

      <div className="tl-list">
        {dateTasks.length === 0 && (
          <div className="tl-empty">No tasks for {fmtDateLabel(activeDate)}</div>
        )}
        {dateTasks.map(task => (
          <TaskRow key={task.id} task={task} {...rowProps} />
        ))}
      </div>

      {/* ── Section 2: Upcoming ── */}
      {upcomingByDate.length > 0 && (
        <div className="tl-section-upcoming">
          <div className="tl-section-hdr">Upcoming</div>
          {upcomingByDate.map(({ date, items }) => (
            <div key={date} className="tl-date-group">
              <div className="tl-date-group-hdr">{fmtDateLabel(date)}</div>
              {items.map(task => (
                <TaskRow key={task.id} task={task} {...rowProps} />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* ── Section 3: More (no due date) ── */}
      {moreTasks.length > 0 && (
        <div className="tl-section-more">
          <div className="tl-section-hdr">More</div>
          <div className="tl-list">
            {moreTasks.map(task => (
              <TaskRow key={task.id} task={task} {...rowProps} />
            ))}
          </div>
        </div>
      )}

      {/* ── Add task ── */}
      {showAdd && (
        <div className="tl-add-form">
          <div className="tl-add-prios">
            {['low', 'medium', 'high'].map(p => (
              <button key={p} className={`tl-prio-btn${newPrio === p ? ' tl-prio-on' : ''}`}
                style={{ '--pc': PRIORITY_COLOR[p] }} onClick={() => setNewPrio(p)}>{p}</button>
            ))}
          </div>
          <div className="tl-add-row">
            <input
              className="tl-add-input"
              placeholder="Task title…"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter')  handleAdd()
                if (e.key === 'Escape') { handleSetShowAdd(false); setNewTitle('') }
              }}
            />
            <button className="tl-add-save" onClick={handleAdd}>Add</button>
          </div>
          <div className="tl-due-row">
            <span className="tl-due-label">Due date:</span>
            <input type="date" className="tl-due-input" value={newDate} min={today}
              onChange={e => setNewDate(e.target.value)} />
            {newDate && <button className="tl-due-clear" onClick={() => setNewDate('')}>✕</button>}
          </div>
          <div className="tl-due-row" style={{ marginTop: 4 }}>
            <span className="tl-due-label">Duration:</span>
            <input className="tl-due-input" type="number" min="0" placeholder="mins"
              value={newDur} onChange={e => setNewDur(e.target.value)} />
          </div>
          <div className="tl-cl-section">
            <div className="tl-cl-label">Checklist</div>
            {newChecklist.map(item => (
              <div key={item.id} className="tl-cl-item">
                <button className={`tl-cl-check${item.done ? ' tl-cl-checked' : ''}`} onClick={() =>
                  setNewChecklist(cl => cl.map(c => c.id === item.id ? { ...c, done: !c.done } : c))}>
                  {item.done && <svg viewBox="0 0 10 8" fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1,4 4,7 9,1"/></svg>}
                </button>
                <span className={`tl-cl-text${item.done ? ' tl-cl-text-done' : ''}`}>{item.text}</span>
                <button className="tl-cl-del" onClick={() => setNewChecklist(cl => cl.filter(c => c.id !== item.id))}>✕</button>
              </div>
            ))}
            <div className="tl-cl-add-row">
              <input
                className="tl-cl-input"
                value={newItem}
                placeholder="Add item…"
                onChange={e => setNewItem(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addNewItem() }}
              />
              <button className="tl-cl-add-btn" onClick={addNewItem}>+</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── TaskPanel (exported) ──────────────────────────────────────────────────────

export default function TaskPanel({
  tasks       = [],
  events      = [],
  onAddTask,
  onUpdateTask,
  onDeleteTask,
  onTaskToggle,
  onDragStart,
  onDragEnd,
  onDateClick,
  isAtToday, onGoToday,
  panelMode, selectedTask, onPanelMode, onSelectTask,
}) {
  const [selectedDate,  setSelectedDate]  = useState(null)
  const [habitShowAdd,  setHabitShowAdd]  = useState(false)
  const [taskShowAdd,   setTaskShowAdd]   = useState(false)

  const handleDateClick = (dateS) => {
    setSelectedDate(dateS)
    if (onDateClick) onDateClick(dateS)
  }

  return (
    <div className="sc-sidebar">
      <Section title="Calendar">
        <MiniCalendar
          events={events}
          tasks={tasks}
          onDateClick={handleDateClick}
          isAtToday={isAtToday}
          onGoToday={onGoToday}
        />
      </Section>

      <Section title="Habit Tracker" onAdd={() => setHabitShowAdd(v => !v)}>
        <HabitTracker showAdd={habitShowAdd} onShowAddChange={setHabitShowAdd} />
      </Section>

      <Section title="Tasks" onAdd={() => setTaskShowAdd(v => !v)}>
        <TaskList
          tasks={tasks}
          onAddTask={onAddTask}
          onUpdateTask={onUpdateTask}
          onDeleteTask={onDeleteTask}
          onTaskToggle={onTaskToggle}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          selectedDate={selectedDate}
          onClearDate={() => setSelectedDate(null)}
          showAdd={taskShowAdd}
          onShowAddChange={setTaskShowAdd}
        />
      </Section>
    </div>
  )
}
