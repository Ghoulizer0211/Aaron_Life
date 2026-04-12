import { useState, useEffect, useRef } from 'react'
import './Page.css'
import './Todos.css'

// ── Constants ──────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { id: 'personal', label: 'Personal', icon: '👤', color: '#00e5ff' },
  { id: 'work',     label: 'Work',     icon: '💼', color: '#ffe600' },
  { id: 'shopping', label: 'Shopping', icon: '🛒', color: '#ff2d78' },
  { id: 'gym',      label: 'Gym',      icon: '💪', color: '#00ff9d' },
  { id: 'other',    label: 'Other',    icon: '•',  color: '#888888' },
]

const CAT_MAP = Object.fromEntries(CATEGORIES.map(c => [c.id, c]))

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}

function tomorrowStr() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}

function nanoid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function fmt12(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`
}

function formatDate(d) {
  if (!d) return ''
  const today    = todayStr()
  const tomorrow = tomorrowStr()
  if (d === today)    return 'Today'
  if (d === tomorrow) return 'Tomorrow'
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── Storage ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'aaron_todos'

function loadTodos() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') }
  catch { return [] }
}

function saveTodos(todos) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(todos))
}

// ── Gym auto-check ─────────────────────────────────────────────────────────────
// Marks open gym todos as done if a workout was logged today

function hasGymLogToday() {
  try {
    const today = todayStr()
    const logs = JSON.parse(localStorage.getItem('aaron_gym_logs') || '[]')
    return logs.some(l => (l.date || '').startsWith(today) || (l.logged_at || '').startsWith(today))
  } catch { return false }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TodoItem({ todo, onToggle, onRemove }) {
  const cat   = CAT_MAP[todo.category] || CAT_MAP.other
  const today = todayStr()
  const overdue = !todo.done && todo.date && todo.date < today

  return (
    <div className={`todo-item${todo.done ? ' todo-item--done' : ''}`}>
      <button
        className={`todo-check${todo.done ? ' todo-check--done' : ''}`}
        style={{ '--check-color': cat.color }}
        onClick={() => onToggle(todo.id)}
        aria-label={todo.done ? 'Mark undone' : 'Mark done'}
      >
        {todo.done && <span className="todo-check-mark">✓</span>}
      </button>

      <div className="todo-item-body">
        <span className="todo-item-text">{todo.text}</span>
        <div className="todo-item-meta">
          <span className="todo-cat-dot" style={{ background: cat.color }} title={cat.label} />
          {todo.date && (
            <span className={`todo-date-tag${overdue ? ' todo-date-tag--overdue' : ''}`}>
              {formatDate(todo.date)}{todo.time ? ` · ${fmt12(todo.time)}` : ''}
            </span>
          )}
          {!todo.date && todo.time && (
            <span className="todo-date-tag">{fmt12(todo.time)}</span>
          )}
          {!todo.date && !todo.time && (
            <span className="todo-cat-label">{cat.label}</span>
          )}
        </div>
      </div>

      <button className="todo-remove-btn" onClick={() => onRemove(todo.id)} aria-label="Delete">×</button>
    </div>
  )
}

function TodoGroup({ title, items, color, onToggle, onRemove }) {
  return (
    <div className="todo-group">
      <div className="todo-group-header" style={{ color: color || 'var(--text-muted)' }}>
        {title}
      </div>
      {items.map(t => (
        <TodoItem key={t.id} todo={t} onToggle={onToggle} onRemove={onRemove} />
      ))}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function Todos() {
  const [todos,      setTodos]      = useState(loadTodos)
  const [filter,     setFilter]     = useState('all')
  const [showDone,   setShowDone]   = useState(false)

  // Add-form state
  const [showForm,   setShowForm]   = useState(false)
  const [text,       setText]       = useState('')
  const [cat,        setCat]        = useState('personal')
  const [dateMode,   setDateMode]   = useState('none')
  const [customDate, setCustomDate] = useState('')
  const [time,       setTime]       = useState('')
  const inputRef = useRef(null)

  // Persist on every change
  useEffect(() => { saveTodos(todos) }, [todos])

  // Auto-check gym todos when a workout is logged today
  useEffect(() => {
    if (!hasGymLogToday()) return
    const today = todayStr()
    setTodos(prev => prev.map(t => {
      if (t.done || t.category !== 'gym') return t
      if (t.date && t.date !== today) return t   // future gym task — skip
      return { ...t, done: true, doneAt: new Date().toISOString() }
    }))
  }, []) // eslint-disable-line

  // Focus input when form opens
  useEffect(() => {
    if (showForm) setTimeout(() => inputRef.current?.focus(), 50)
  }, [showForm])

  const addTodo = () => {
    const trimmed = text.trim()
    if (!trimmed) return

    const date = dateMode === 'today'    ? todayStr()
               : dateMode === 'tomorrow' ? tomorrowStr()
               : dateMode === 'custom'   ? customDate
               : null

    setTodos(prev => [{
      id:        nanoid(),
      text:      trimmed,
      category:  cat,
      date:      date || null,
      time:      time || null,
      done:      false,
      doneAt:    null,
      createdAt: new Date().toISOString(),
    }, ...prev])

    setText('')
    setTime('')
    setDateMode('none')
    setCustomDate('')
    setShowForm(false)
  }

  const toggle = (id) => {
    setTodos(prev => prev.map(t =>
      t.id === id
        ? { ...t, done: !t.done, doneAt: !t.done ? new Date().toISOString() : null }
        : t
    ))
  }

  const remove = (id) => setTodos(prev => prev.filter(t => t.id !== id))
  const clearDone = () => setTodos(prev => prev.filter(t => !t.done))

  // ── Filtering & grouping ──────────────────────────────────────────────────────

  const today = todayStr()

  const active = todos.filter(t => {
    if (t.done) return false
    if (filter === 'today')    return !t.date || t.date === today
    if (filter === 'work')     return t.category === 'work'
    if (filter === 'personal') return t.category === 'personal'
    if (filter === 'shopping') return t.category === 'shopping'
    if (filter === 'gym')      return t.category === 'gym'
    return true
  })

  const overdue  = active.filter(t => t.date && t.date < today)
  const todayTxs = active.filter(t => t.date === today)
  const upcoming = active.filter(t => t.date && t.date > today)
  const someday  = active.filter(t => !t.date)

  const sortByTime = arr => [...arr].sort((a, b) => {
    if (a.time && b.time) return a.time.localeCompare(b.time)
    if (a.time) return -1
    if (b.time) return 1
    return 0
  })

  const doneItems  = todos.filter(t => t.done)
  const doneCount  = doneItems.length
  const totalActive = active.length

  const isEmpty = overdue.length === 0 && todayTxs.length === 0 && upcoming.length === 0 && someday.length === 0

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="todo-page">

      {/* ── Add bar ── */}
      <div className="todo-add-bar">
        {showForm ? (
          <div className="todo-form">
            <div className="todo-form-row1">
              <input
                ref={inputRef}
                className="todo-input"
                placeholder="What do you need to do?"
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addTodo()}
              />
              <button className="todo-cancel-btn" onClick={() => setShowForm(false)}>✕</button>
            </div>

            {/* Category */}
            <div className="todo-cat-pills">
              {CATEGORIES.map(c => (
                <button
                  key={c.id}
                  className={`todo-cat-pill${cat === c.id ? ' todo-cat-pill--active' : ''}`}
                  style={{ '--cpill-color': c.color }}
                  onClick={() => setCat(c.id)}
                  title={c.label}
                >
                  {c.icon}
                </button>
              ))}
            </div>

            {/* Date chips */}
            <div className="todo-date-chips">
              {[
                { id: 'none',     label: 'No date'   },
                { id: 'today',    label: 'Today'     },
                { id: 'tomorrow', label: 'Tomorrow'  },
                { id: 'custom',   label: 'Pick date' },
              ].map(d => (
                <button
                  key={d.id}
                  className={`todo-date-chip${dateMode === d.id ? ' todo-date-chip--active' : ''}`}
                  onClick={() => setDateMode(d.id)}
                >
                  {d.label}
                </button>
              ))}
            </div>

            {dateMode === 'custom' && (
              <input className="todo-date-input" type="date"
                value={customDate} onChange={e => setCustomDate(e.target.value)} />
            )}

            {/* Time */}
            <div className="todo-time-row">
              <span className="todo-time-label">Time (optional)</span>
              <input className="todo-time-input" type="time"
                value={time} onChange={e => setTime(e.target.value)} />
            </div>

            <button className="todo-submit-btn" onClick={addTodo} disabled={!text.trim()}>
              Add Task
            </button>
          </div>
        ) : (
          <button className="todo-open-form-btn" onClick={() => setShowForm(true)}>
            <span className="todo-plus">+</span>
            Add task…
          </button>
        )}
      </div>

      {/* ── Filter tabs ── */}
      <div className="todo-filters">
        {[
          { id: 'all',      label: 'All'  },
          { id: 'today',    label: 'Today' },
          { id: 'personal', label: '👤 Personal' },
          { id: 'work',     label: '💼 Work' },
          { id: 'shopping', label: '🛒 Shopping' },
          { id: 'gym',      label: '💪 Gym' },
        ].map(f => (
          <button
            key={f.id}
            className={`todo-filter-btn${filter === f.id ? ' todo-filter-btn--active' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
            {f.id === 'all' && totalActive > 0 && (
              <span className="todo-filter-count">{totalActive}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Todo list ── */}
      <div className="todo-list">

        {overdue.length > 0 && (
          <TodoGroup title="Overdue" color="var(--red)"
            items={sortByTime(overdue)} onToggle={toggle} onRemove={remove} />
        )}

        {todayTxs.length > 0 && (
          <TodoGroup title="Today" color="var(--accent)"
            items={sortByTime(todayTxs)} onToggle={toggle} onRemove={remove} />
        )}

        {upcoming.length > 0 && (
          <TodoGroup title="Upcoming" color="var(--text-secondary)"
            items={sortByTime(upcoming)} onToggle={toggle} onRemove={remove} />
        )}

        {someday.length > 0 && (
          <TodoGroup title="Someday" color="var(--text-muted)"
            items={someday} onToggle={toggle} onRemove={remove} />
        )}

        {isEmpty && (
          <div className="todo-empty">
            <div className="todo-empty-icon">✓</div>
            <div className="todo-empty-msg">
              {filter === 'all' ? 'All clear!' : `No ${filter} tasks`}
            </div>
          </div>
        )}

        {/* Completed section */}
        {doneCount > 0 && (
          <div className="todo-done-section">
            <button className="todo-done-toggle" onClick={() => setShowDone(v => !v)}>
              <span>Completed ({doneCount})</span>
              <span>{showDone ? '∨' : '›'}</span>
            </button>
            {showDone && (
              <>
                {doneItems.map(t => (
                  <TodoItem key={t.id} todo={t} onToggle={toggle} onRemove={remove} />
                ))}
                <button className="todo-clear-done" onClick={clearDone}>
                  Clear all completed
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
