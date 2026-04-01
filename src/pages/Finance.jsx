import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, sb } from '../lib/supabase'
import './Page.css'
import './Finance.css'

// ── Constants ──────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { id: 'food',      label: 'Food',          icon: '🍔', color: '#f0a500' },
  { id: 'care',      label: 'Personal Care', icon: '💆', color: '#e05c5c' },
  { id: 'bills',     label: 'Bills',         icon: '🏠', color: '#4a90d9' },
  { id: 'transport', label: 'Transport',     icon: '🚗', color: '#ff2d78' },
  { id: 'shopping',  label: 'Shopping',      icon: '🛍️', color: '#4ab8d4' },
  { id: 'investing', label: 'Investing',     icon: '📈', color: '#00ff9d' },
  { id: 'income',    label: 'Income',        icon: '💰', color: '#00e5ff' },
  { id: 'other',     label: 'Other',         icon: '💸', color: '#888888' },
  { id: 'transfer',  label: 'Transfer',      icon: '🔄', color: '#555555' },
]
const CATEGORY_MAP    = Object.fromEntries(CATEGORIES.map(c => [c.id, c]))
const CATEGORY_COLORS = Object.fromEntries(CATEGORIES.map(c => [c.id, c.color]))

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtUSD(n) {
  if (n == null || isNaN(n)) return '$0.00'
  return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(d) {
  if (!d) return ''
  const ptDate = (dt) => new Date(dt).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
  const today = ptDate(Date.now())
  const yest  = ptDate(Date.now() - 86400000)
  if (d === today) return 'Today'
  if (d === yest)  return 'Yesterday'
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function monthLabel(m) {
  const [y, mo] = m.split('-')
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function currentMonth() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }).slice(0, 7)
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ message, type = 'success', onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000)
    return () => clearTimeout(t)
  }, [onClose])
  return (
    <div className={`fin-toast fin-toast--${type}`}>
      <span>{message}</span>
      <button onClick={onClose}>×</button>
    </div>
  )
}

// ── Teller Connect ────────────────────────────────────────────────────────────

function useTellerConnect({ onSuccess, onError }) {
  const [ready, setReady] = useState(!!window.TellerConnect)

  useEffect(() => {
    if (window.TellerConnect) { setReady(true); return }
    const existing = document.querySelector('script[src="https://cdn.teller.io/connect/connect.js"]')
    if (existing) { existing.addEventListener('load', () => setReady(true)); return }
    const s = document.createElement('script')
    s.src = 'https://cdn.teller.io/connect/connect.js'
    s.onload = () => setReady(true)
    s.onerror = () => onError('Failed to load Teller Connect script')
    document.head.appendChild(s)
  }, [onError])

  const open = useCallback(() => {
    if (!window.TellerConnect) { onError('Teller Connect not loaded yet'); return }
    const appId = import.meta.env.VITE_TELLER_APP_ID
    if (!appId) { onError('VITE_TELLER_APP_ID not set in .env'); return }

    window.TellerConnect.setup({
      applicationId: appId,
      environment:   'development',
      onSuccess: async (enrollment) => {
        console.log('[teller] enrollment success, accessToken:', enrollment.accessToken?.slice(0,8)+'...')
        try {
          const res = await fetch('/api/teller/enroll', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ accessToken: enrollment.accessToken, enrollment }),
          })
          const data = await res.json()
          if (!res.ok) {
            console.error('[teller] enroll API error:', data)
            onError(data.detail || data.error || 'Failed to link account')
          } else {
            console.log('[teller] enroll success:', data.accounts?.length, 'accounts')
            onSuccess(data)
          }
        } catch (err) {
          console.error('[teller] enroll fetch error:', err)
          onError('Network error — is the server running on port 3001?')
        }
      },
      onExit: () => console.log('[teller] user exited connect'),
    }).open()
  }, [onSuccess, onError])

  return { open, ready }
}

// ── SnapTrade Hook ────────────────────────────────────────────────────────────

function useSnaptradeData() {
  const [snapLinked,  setSnapLinked]  = useState(false)
  const [snapLoading, setSnapLoading] = useState(false)
  const [snapError,   setSnapError]   = useState(null)

  const checkStatus = useCallback(async () => {
    try {
      const res  = await fetch('/api/snaptrade/status')
      const { registered, accountCount } = await res.json()
      const linked = registered && accountCount > 0
      setSnapLinked(linked)
      return linked
    } catch { return false }
  }, [])

  useEffect(() => { checkStatus() }, [checkStatus])

  const connect = async () => {
    setSnapLoading(true)
    setSnapError(null)
    try {
      const res  = await fetch('/api/snaptrade/connect', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ customRedirect: window.location.origin }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to get connection link')
      if (!data.redirectURI) throw new Error('No redirect URL returned from SnapTrade')
      window.open(data.redirectURI, '_blank')
    } catch (err) {
      setSnapError(err.message)
    } finally {
      setSnapLoading(false)
    }
  }

  // Called after user finishes in the portal — syncs accounts to bank_accounts then reloads summary
  const afterConnect = async (onSynced) => {
    setSnapLoading(true)
    setSnapError(null)
    try {
      const syncRes  = await fetch('/api/snaptrade/sync', { method: 'POST' })
      const syncData = await syncRes.json()
      if (!syncRes.ok) throw new Error(syncData.error || 'Sync failed')
      await checkStatus()
      if (onSynced) onSynced()
    } catch (err) {
      setSnapError(err.message)
    } finally {
      setSnapLoading(false)
    }
  }

  const disconnect = async (onDisconnected) => {
    await fetch('/api/snaptrade/disconnect', { method: 'DELETE' })
    setSnapLinked(false)
    if (onDisconnected) onDisconnected()
  }

  return { snapLinked, snapLoading, snapError, snapTotal: 0, connect, afterConnect, disconnect }
}

// ── Finance Data Hook ─────────────────────────────────────────────────────────

function useFinanceData() {
  // Seed state from localStorage so data is visible instantly on re-open,
  // before the background fetch completes.
  const [summary, setSummary] = useState(() => {
    try { return JSON.parse(localStorage.getItem('aaron_finance_summary') || 'null') }
    catch { return null }
  })
  const [transactions, setTransactions] = useState(() => {
    const m = currentMonth()
    try { return JSON.parse(localStorage.getItem(`aaron_finance_tx_${m}`) || '[]') }
    catch { return [] }
  })
  const [enrollments,  setEnrollments]  = useState(() => {
    try { return JSON.parse(localStorage.getItem('aaron_teller_enrollments') || '[]') }
    catch { return [] }
  })
  const [loading,  setLoading]  = useState(false)
  const [syncing,  setSyncing]  = useState(false)
  const [error,    setError]    = useState(null)
  const [month,    setMonth]    = useState(currentMonth)

  // Prevents the month-change effect from double-firing on initial mount
  const didInit    = useRef(false)
  // Tracks last sync time to enforce a cooldown and prevent button spam
  const lastSyncAt = useRef(0)

  // Persist enrollments cache
  useEffect(() => {
    localStorage.setItem('aaron_teller_enrollments', JSON.stringify(enrollments))
  }, [enrollments])

  const loadSummary = useCallback(async () => {
    try {
      const res  = await fetch('/api/finance/summary')
      if (!res.ok) return
      const data = await res.json()
      setSummary(data)
      localStorage.setItem('aaron_finance_summary', JSON.stringify(data))
    } catch { /* server might not be running */ }
  }, [])

  const loadTransactions = useCallback(async (m) => {
    try {
      const res  = await fetch(`/api/finance/transactions?month=${m}&limit=200`)
      if (!res.ok) return
      const data = await res.json()
      setTransactions(data)
      // Store per-month so switching months doesn't overwrite each other
      localStorage.setItem(`aaron_finance_tx_${m}`, JSON.stringify(data))
    } catch { /* ignore */ }
  }, [])

  // Initial load — runs once on mount
  useEffect(() => {
    const init = async () => {
      setLoading(true)
      try {
        // Always attempt to load data — if Supabase has rows the summary will
        // come back populated and the dashboard shows. The teller/status check
        // was gating this unnecessarily when the Express server isn't running
        // (e.g. Vercel deployment).
        await Promise.all([loadSummary(), loadTransactions(month)])
      } catch { /* ignore */ }
      finally {
        setLoading(false)
        didInit.current = true
      }
    }
    init()
  }, []) // eslint-disable-line

  // FIX: skip on initial mount — without this guard, React fires this effect on mount
  // AND the init above both call loadTransactions, causing 2 fetches on every page visit.
  useEffect(() => {
    if (!didInit.current) return
    loadTransactions(month)
  }, [month, loadTransactions])

  const sync = async () => {
    // FIX: 30-second cooldown prevents rapid-fire Teller API calls from button spam
    const COOLDOWN_MS = 30_000
    const now = Date.now()
    if (now - lastSyncAt.current < COOLDOWN_MS) {
      const wait = Math.ceil((COOLDOWN_MS - (now - lastSyncAt.current)) / 1000)
      setError(`Please wait ${wait}s before syncing again`)
      return
    }
    lastSyncAt.current = now
    setSyncing(true)
    setError(null)
    try {
      const res  = await fetch('/api/teller/sync')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Sync failed')
      if (data.enrollments) setEnrollments(data.enrollments)
      await Promise.all([loadSummary(), loadTransactions(month)])
    } catch (err) {
      setError(err.message)
    } finally {
      setSyncing(false)
    }
  }

  const onTellerSuccess = async (data) => {
    if (data.enrollments) setEnrollments(data.enrollments)
    await Promise.all([loadSummary(), loadTransactions(month)])
  }

  const disconnect = async (enrollmentId) => {
    await fetch(`/api/teller/disconnect/${enrollmentId}`, { method: 'DELETE' })
    setEnrollments(prev => prev.filter(e => e.enrollmentId !== enrollmentId))
    await Promise.all([loadSummary(), loadTransactions(month)])
  }

  const disconnectAll = async () => {
    await fetch('/api/teller/disconnect-all', { method: 'DELETE' })
    setEnrollments([])
    setSummary(null)
    setTransactions([])
    // Clear all cached finance data so the "Link Your Bank" screen shows correctly
    localStorage.removeItem('aaron_teller_enrollments')
    localStorage.removeItem('aaron_finance_summary')
    const now = new Date()
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const m = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
      localStorage.removeItem(`aaron_finance_tx_${m}`)
    }
  }

  const updateTransactionCategory = useCallback(async (txId, category, note) => {
    // Optimistic update — update state and localStorage immediately
    setTransactions(prev => {
      const updated = prev.map(t =>
        (t.transaction_id === txId || t.id === txId)
          ? { ...t, category, ...(typeof note === 'string' ? { note } : {}) }
          : t
      )
      localStorage.setItem(`aaron_finance_tx_${month}`, JSON.stringify(updated))
      return updated
    })
    try {
      const body = { category }
      if (typeof note === 'string') body.note = note
      console.log('[finance] PATCH', { txId, body })
      const res = await fetch(`/api/finance/transactions/${encodeURIComponent(txId)}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = json.error || `HTTP ${res.status}`
        console.error('[finance] save failed:', msg)
        return { ok: false, error: msg }
      }
      return { ok: true }
    } catch (e) {
      console.error('[finance] save network error:', e.message)
      return { ok: false, error: e.message }
    }
  }, [month])

  const updateAccountCategory = async (accountId, category_group) => {
    await fetch(`/api/finance/accounts/${accountId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ category_group }),
    })
    await loadSummary()
  }

  return {
    summary, transactions, enrollments, loading, syncing, error, month,
    setMonth, setError, sync, load: loadSummary, onTellerSuccess, disconnect, disconnectAll,
    updateAccountCategory, updateTransactionCategory,
  }
}

// ── Subscription detection ────────────────────────────────────────────────────

function useSubscriptions() {
  const [subs, setSubs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('aaron_finance_subs') || '[]') }
    catch { return [] }
  })

  useEffect(() => {
    async function load() {
      try {
        // Fetch last 4 months of transactions
        const months = []
        for (let i = 0; i < 4; i++) {
          const d = new Date()
          d.setMonth(d.getMonth() - i)
          months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`)
        }
        const results = await Promise.all(
          months.map(m => fetch(`/api/finance/transactions?month=${m}&limit=500`).then(r => r.ok ? r.json() : []))
        )
        const allTx = results.flat()
        const detected = detectSubscriptions(allTx)
        setSubs(detected)
        localStorage.setItem('aaron_finance_subs', JSON.stringify(detected))
      } catch { /* ignore */ }
    }
    load()
  }, [])

  return subs
}

function detectSubscriptions(allTx) {
  const EXCLUDE = new Set(['transfer', 'investing', 'income'])
  const charges = allTx.filter(t =>
    parseFloat(t.amount) < 0 && !EXCLUDE.has(t.category) && !t.is_transfer
  )

  const byMerchant = {}
  for (const tx of charges) {
    const key = normalizeMerchant(tx.description || tx.name)
    if (!key || key === 'Unknown') continue
    if (!byMerchant[key]) byMerchant[key] = []
    byMerchant[key].push(tx)
  }

  const subs = []
  for (const [merchant, txs] of Object.entries(byMerchant)) {
    const months = new Set(txs.map(t => t.date?.slice(0, 7)))
    if (months.size < 2) continue

    const amounts = txs.map(t => Math.abs(parseFloat(t.amount)))
    const avgAmt  = amounts.reduce((s, a) => s + a, 0) / amounts.length
    // Amounts must be within 25% of each other
    const consistent = amounts.every(a => avgAmt === 0 || Math.abs(a - avgAmt) / avgAmt < 0.25)
    if (!consistent) continue

    const sorted     = [...txs].sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    const lastCharged = sorted[0].date
    const category   = sorted[0].category || 'other'
    const monthsArr  = [...months].sort()
    // Detect frequency
    let frequency = 'monthly'
    if (months.size >= 3 && txs.length / months.size >= 3.5) frequency = 'weekly'

    // Flag if not charged this month (potentially cancelled or skipped)
    const thisMonth = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }).slice(0, 7)
    const chargedThisMonth = months.has(thisMonth)

    subs.push({ merchant, amount: avgAmt, count: txs.length, months: months.size, lastCharged, category, frequency, chargedThisMonth, monthsArr })
  }

  return subs.sort((a, b) => b.amount - a.amount)
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, accent, onClick, icon }) {
  return (
    <button className="fin-summary-card" onClick={onClick} style={{ '--card-accent': accent }}>
      <div className="fin-card-icon">{icon}</div>
      <div className="fin-card-body">
        <span className="fin-card-label">{label}</span>
        <span className="fin-card-value">{fmtUSD(value)}</span>
        {sub && <span className="fin-card-sub">{sub}</span>}
      </div>
      <span className="fin-card-arrow">›</span>
    </button>
  )
}

function AccountRow({ account, onCategoryChange }) {
  const [editing, setEditing] = useState(false)
  const bal = account.current_balance ?? account.balance ?? 0
  return (
    <div className="card row-card">
      <div className="acc-left">
        <span className={`acc-icon ${account.type || 'bank'}`} />
        <div className="acc-info">
          <span className="acc-name">{account.account_name || account.name}</span>
          <div className="acc-meta">
            {account.last_four && <span className="acc-mask">•••• {account.last_four}</span>}
            {editing ? (
              <select
                className="acc-cat-select"
                value={account.category_group || 'cash'}
                onChange={e => { onCategoryChange(account.account_id || account.id, e.target.value); setEditing(false) }}
                onBlur={() => setEditing(false)}
                autoFocus
              >
                <option value="cash">Cash</option>
                <option value="credit">Credit Card</option>
                <option value="investments">Investments</option>
                <option value="other">Other</option>
              </select>
            ) : (
              <button className="acc-cat-badge" onClick={() => setEditing(true)}>
                {account.category_group || 'cash'}
              </button>
            )}
          </div>
        </div>
      </div>
      <span className="acc-balance">{fmtUSD(bal)}</span>
    </div>
  )
}

function TxRow({ tx, onCategoryChange, accountLabel }) {
  const [expanded,  setExpanded]  = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [saveState, setSaveState] = useState(null)   // null | 'ok' | 'err'
  const [noteMode,  setNoteMode]  = useState(false)
  const [noteText,  setNoteText]  = useState('')
  const amt = typeof tx.amount === 'number' ? tx.amount : parseFloat(tx.amount || 0)
  const cat = CATEGORY_MAP[tx.category] || CATEGORY_MAP['other']

  const finishSave = (result) => {
    setSaving(false)
    const ok = result?.ok ?? result ?? false
    setSaveState(ok ? 'ok' : { err: result?.error || 'Unknown error' })
    setTimeout(() => {
      setSaveState(null)
      if (ok) setExpanded(false)
    }, ok ? 900 : 3500)
  }

  const handlePick = async (catId) => {
    if (catId === 'other') {
      setNoteText(tx.note || '')
      setNoteMode(true)
      return
    }
    if (catId === tx.category && !tx.note) { setExpanded(false); return }
    setSaving(true)
    setSaveState(null)
    const result = onCategoryChange
      ? await onCategoryChange(tx.transaction_id || tx.id, catId)
      : { ok: true }
    finishSave(result)
  }

  const saveNote = async () => {
    setSaving(true)
    setSaveState(null)
    const result = onCategoryChange
      ? await onCategoryChange(tx.transaction_id || tx.id, 'other', noteText.trim())
      : { ok: true }
    setNoteMode(false)
    finishSave(result)
  }

  const cancelNote = () => { setNoteMode(false) }

  return (
    <div className={`card tx-row${expanded ? ' tx-row--open' : ''}`}>
      <div className="tx-row-main" onClick={() => { setExpanded(e => !e); setNoteMode(false) }}>
        <div className="tx-dot" style={{ background: cat.color }} />
        <div className="tx-info">
          <span className="tx-name">{tx.description || tx.name}</span>
          {tx.note && <span className="tx-note-display">{tx.note}</span>}
          <span className="tx-date">
            {accountLabel && <span className="tx-account-label">{accountLabel} · </span>}
            {formatDate(tx.date)}
            <span className="tx-cat-tag" style={{ color: cat.color }}> · {cat.icon} {cat.label}</span>
          </span>
        </div>
        <span className={`tx-amount ${amt >= 0 ? 'positive' : 'negative'}`}>
          {amt >= 0 ? '+' : ''}{fmtUSD(amt)}
        </span>
      </div>

      {expanded && (
        <div className="tx-cat-picker">
          {saveState === 'ok' ? (
            <div className="tx-cat-saving tx-cat-saved">✓ Saved</div>
          ) : saveState?.err ? (
            <div className="tx-cat-saving tx-cat-error">✗ {saveState.err}</div>
          ) : saving ? (
            <div className="tx-cat-saving">Saving…</div>
          ) : noteMode ? (
            <div className="tx-note-wrap">
              <input
                className="tx-note-input"
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveNote() }}
                placeholder="What was this for? e.g. haircut, car repair"
                autoFocus
              />
              <div className="tx-note-actions">
                <button className="tx-note-cancel" onClick={cancelNote}>Cancel</button>
                <button className="tx-note-save" onClick={saveNote}>Save</button>
              </div>
            </div>
          ) : (
            CATEGORIES.map(c => (
              <button
                key={c.id}
                className={`tx-cat-chip${tx.category === c.id ? ' active' : ''}`}
                style={{ '--chip-col': c.color }}
                onClick={() => handlePick(c.id)}
              >
                <span className="tx-cat-chip-icon">{c.icon}</span>
                <span className="tx-cat-chip-label">{c.label}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function MonthSelector({ month, onChange }) {
  const months = []
  const now = new Date()
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const m = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
    months.push(m)
  }
  return (
    <select className="fin-month-select" value={month} onChange={e => onChange(e.target.value)}>
      {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
    </select>
  )
}

// ── Detail Views ──────────────────────────────────────────────────────────────

function AccordionAccount({ account, transactions, onCategoryChange, onTxCategoryChange }) {
  const [open, setOpen] = useState(false)
  const isCredit = account.category_group === 'credit' || account.subtype === 'credit_card' || account.type === 'credit'
  const bal = account.current_balance ?? account.balance ?? 0
  const acctTx = [...transactions]
    .filter(t => t.account_id === (account.account_id || account.id))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))

  return (
    <div className="fin-accordion">
      <button className="fin-accordion-header" onClick={() => setOpen(o => !o)}>
        <div className="acc-left">
          <span className={`acc-icon ${account.type || 'bank'}`} />
          <div className="acc-info">
            <span className="acc-name">{account.account_name || account.name}</span>
            <div className="acc-meta">
              {account.last_four && <span className="acc-mask">•••• {account.last_four}</span>}
            </div>
          </div>
        </div>
        <div className="fin-accordion-right">
          <span className="acc-balance" style={{ color: isCredit ? (bal < 0 ? 'var(--green)' : '#ff2d78') : 'var(--green)' }}>
            {fmtUSD(bal)}
          </span>
          <span className="fin-accordion-chevron">{open ? '∨' : '›'}</span>
        </div>
      </button>
      {open && (
        <div className="fin-accordion-body">
          {acctTx.length === 0
            ? <div className="empty-state" style={{ padding: '12px 16px', fontSize: '13px' }}>No transactions this month</div>
            : acctTx.map((tx, i) => (
                <TxRow key={tx.transaction_id || tx.id || i} tx={tx} onCategoryChange={onTxCategoryChange} />
              ))
          }
        </div>
      )}
    </div>
  )
}

function CashDetail({ summary, transactions, month, setMonth, onCategoryChange, onTxCategoryChange, onBack }) {
  const accounts = summary?.cash?.accounts || []

  return (
    <div className="page">
      <div className="fin-detail-header">
        <button className="fin-back-btn" onClick={onBack}>‹ Back</button>
        <h2 className="section-title">Cash Accounts</h2>
        <MonthSelector month={month} onChange={setMonth} />
      </div>

      <section className="page-section">
        <div className="card net-worth-card">
          <span className="nw-label">Total Cash</span>
          <span className="nw-value">{fmtUSD(summary?.cash?.total)}</span>
        </div>
      </section>

      <section className="page-section">
        <div className="fin-accordion-list">
          {accounts.map((a, i) => (
            <AccordionAccount
              key={a.account_id || i}
              account={a}
              transactions={transactions}
              onCategoryChange={onCategoryChange}
              onTxCategoryChange={onTxCategoryChange}
            />
          ))}
        </div>
      </section>
    </div>
  )
}

function CreditDetail({ summary, transactions, month, setMonth, onCategoryChange, onTxCategoryChange, onBack }) {
  const accounts = summary?.credit?.accounts || []

  return (
    <div className="page">
      <div className="fin-detail-header">
        <button className="fin-back-btn" onClick={onBack}>‹ Back</button>
        <h2 className="section-title">Credit Cards</h2>
        <MonthSelector month={month} onChange={setMonth} />
      </div>

      <section className="page-section">
        <div className="card net-worth-card">
          <span className="nw-label">Total Owed</span>
          <span className="nw-value" style={{ color: '#ff2d78' }}>{fmtUSD(summary?.credit?.total)}</span>
        </div>
      </section>

      <section className="page-section">
        <div className="fin-accordion-list">
          {accounts.map((a, i) => (
            <AccordionAccount
              key={a.account_id || i}
              account={a}
              transactions={transactions}
              onCategoryChange={onCategoryChange}
              onTxCategoryChange={onTxCategoryChange}
            />
          ))}
        </div>
      </section>
    </div>
  )
}

// ── Brokerage Accordion ───────────────────────────────────────────────────────

function BrokerageAccordion({ brokerageName, accounts }) {
  const [open, setOpen] = useState(false)
  const total = accounts.reduce((s, a) => s + parseFloat(a.current_balance || 0), 0)

  return (
    <div className="fin-accordion">
      <button className="fin-accordion-header" onClick={() => setOpen(o => !o)}>
        <div className="acc-left">
          <span className="acc-icon investment" />
          <div className="acc-info">
            <span className="acc-name">{brokerageName}</span>
            <span className="acc-meta" style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {accounts.length} account{accounts.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
        <div className="fin-accordion-right">
          <span className="acc-balance" style={{ color: 'var(--green)' }}>{fmtUSD(total)}</span>
          <span className="fin-accordion-chevron">{open ? '∨' : '›'}</span>
        </div>
      </button>
      {open && (
        <div>
          {accounts.map((a, i) => {
            // Raw name format: "First Last — Account Type — Number"
            // Extract just the account type (second-to-last segment)
            const parts = (a.account_name || '').split(' — ')
            const label = parts.length >= 3 ? parts[parts.length - 2] : (a.account_name || a.subtype || 'Investment')
            const bal   = parseFloat(a.current_balance || 0)
            return (
              <div key={a.account_id || i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '12px 16px 12px 36px', borderBottom: '1px solid var(--border)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--green)', flexShrink: 0, display: 'inline-block' }} />
                  <span style={{ fontSize: '15px', fontWeight: 500, color: 'var(--text)' }}>{label}</span>
                </div>
                <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--green)' }}>{fmtUSD(bal)}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function InvestmentsDetail({ summary, snap, onReload, onBack }) {
  const accounts = summary?.investments?.accounts || []
  const total    = summary?.investments?.total    || 0

  // Group by institution_name (brokerage) — e.g. "Vanguard"
  const groups = {}
  for (const a of accounts) {
    const key = a.institution_name || 'Other'
    if (!groups[key]) groups[key] = []
    groups[key].push(a)
  }

  return (
    <div className="page">
      <div className="fin-detail-header">
        <button className="fin-back-btn" onClick={onBack}>‹ Back</button>
        <h2 className="section-title">Investments</h2>
      </div>

      <section className="page-section">
        <div className="card net-worth-card">
          <span className="nw-label">Total Investments</span>
          <span className="nw-value">{fmtUSD(total)}</span>
        </div>
      </section>

      {Object.keys(groups).length > 0 && (
        <section className="page-section">
          <div className="fin-accordion-list">
            {Object.entries(groups).map(([brokerage, accts]) => (
              <BrokerageAccordion key={brokerage} brokerageName={brokerage} accounts={accts} />
            ))}
          </div>
        </section>
      )}

    </div>
  )
}

function normalizeMerchant(raw) {
  if (!raw) return 'Unknown'
  let s = raw.trim()

  // Extract merchant from ACH wire noise: "ORIG CO NAME:ACME CO ENTRY DESCR:..."
  const ach = s.match(/ORIG CO NAME:\s*(.+?)(?:\s+CO\s+ENTRY|\s+SEC:|$)/i)
  if (ach) s = ach[1].trim()

  // Known merchant table — checked before any stripping
  const up = s.toUpperCase()
  const KNOWN = [
    ['APPLECARD',          'Apple Card Payment'],
    ['APPLE CARD',         'Apple Card Payment'],
    ['CLAUDE.AI',          'Claude.ai'],
    ['TESLA SUPERCHARGER', 'Tesla Supercharger'],
    ['HLU*HULUPLUS',       'Hulu'],
    ['HULUPLUS',           'Hulu'],
    ['NETFLIX',            'Netflix'],
    ['SPOTIFY',            'Spotify'],
    ['AMZN MKTP',          'Amazon'],
    ['AMAZON.COM',         'Amazon'],
    ['AMAZON',             'Amazon'],
    ['PAYPAL',             'PayPal'],
    ['VENMO',              'Venmo'],
    ['ZELLE',              'Zelle'],
    ['TARGET',             'Target'],
    ['WALMART',            'Walmart'],
    ['COSTCO',             'Costco'],
    ['STARBUCKS',          'Starbucks'],
    ['CHEVRON',            'Chevron'],
    ['GOOGLE',             'Google'],
    ['TCR*MTA',            'Caltrain / MTA'],
    ['APPLE.COM/BILL',     'Apple Subscriptions'],
    ['DISCORD',            'Discord'],
    ['CHATGPT',            'ChatGPT'],
    ['OPENAI',             'OpenAI'],
    ['YOUTUBE',            'YouTube'],
    ['UBER EATS',          'Uber Eats'],
    ['DOORDASH',           'DoorDash'],
  ]
  for (const [k, v] of KNOWN) {
    if (up.includes(k.toUpperCase())) return v
  }

  // Strip card last-four suffix: " - 9849"
  s = s.replace(/\s+-\s+\d{4}$/, '')
  // Strip phone numbers: "877-7983752"
  s = s.replace(/\s+\d{3}[-]\d{7,}/g, '')
  // Strip state abbreviation at end: "SAN JOSE CA" → "SAN JOSE"
  s = s.replace(/\s+[A-Z]{2}$/, '')
  // Strip long trailing number sequences (store IDs)
  s = s.replace(/\s+\d{5,}$/g, '')
  // Strip common prefixes: "TST* ", "SQ *", "HLU*"
  s = s.replace(/^[A-Z]{2,4}\*\s*/i, '')
  // Strip asterisk garbage: "AMZN*A1B2C3" trailing ref
  s = s.replace(/\*[A-Z0-9]+$/, '')

  // Title-case only if string is fully uppercase
  if (s === s.toUpperCase()) {
    s = s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
  }

  return s.trim().slice(0, 40) || 'Unknown'
}

function SpendingDetail({ summary, transactions, month, setMonth, onTxCategoryChange, subscriptions = [], onBack }) {
  // ── Subscription review state ──────────────────────────────────────────────
  const [subChoices, setSubChoices] = useState(() => {
    try { return JSON.parse(localStorage.getItem('aaron_sub_choices') || '{}') }
    catch { return {} }
  })

  // Sync choices with Supabase on mount:
  // - Pull remote rows and merge (remote wins for conflicts)
  // - Upload any local choices that aren't in Supabase yet (migration)
  useEffect(() => {
    if (!supabase) return
    sb(supabase.from('subscription_choices').select('merchant, choice'))
      .then(({ data } = {}) => {
        const remote = Object.fromEntries((data || []).map(r => [r.merchant, r.choice]))
        setSubChoices(prev => {
          // Push local choices that Supabase doesn't have yet
          const toUpload = Object.entries(prev)
            .filter(([merchant]) => !remote[merchant])
            .map(([merchant, choice]) => ({ merchant, choice }))
          if (toUpload.length) {
            sb(supabase.from('subscription_choices').upsert(toUpload))
          }
          // Merge: remote wins for any conflicts
          const merged = { ...prev, ...remote }
          localStorage.setItem('aaron_sub_choices', JSON.stringify(merged))
          return merged
        })
      })
  }, []) // eslint-disable-line

  const saveChoice = (merchant, choice) => {
    const next = { ...subChoices, [merchant]: choice }
    setSubChoices(next)
    localStorage.setItem('aaron_sub_choices', JSON.stringify(next))
    if (supabase) {
      sb(supabase.from('subscription_choices').upsert({ merchant, choice }))
    }
  }
  const confirmedSubs = subscriptions.filter(s => subChoices[s.merchant] === 'yes')
  const pendingSubs   = subscriptions.filter(s => !subChoices[s.merchant])
  const sp = summary?.spending

  // ── Date math ──────────────────────────────────────────────────────────────
  const now = new Date()
  const [yr, mo] = month.split('-').map(Number)
  const isCurrentMonth = yr === now.getFullYear() && mo === (now.getMonth() + 1)
  const daysInMonth = new Date(yr, mo, 0).getDate()
  const daysElapsed = isCurrentMonth ? now.getDate() : daysInMonth
  const daysLeft    = isCurrentMonth ? daysInMonth - now.getDate() : 0

  // ── Core numbers ───────────────────────────────────────────────────────────
  const income    = sp?.income   || 0
  const expenses  = sp?.expenses || 0
  const surplus   = sp?.surplus  || 0
  const isDeficit = surplus < 0
  const savingsRate = income > 0 ? Math.round((surplus / income) * 100) : null
  const dailyRate   = daysElapsed > 0 ? expenses / daysElapsed : 0
  const projected   = dailyRate * daysInMonth
  const spendPct    = income > 0 ? Math.min((expenses / income) * 100, 100) : (expenses > 0 ? 100 : 0)

  // ── All expense transactions (cash + credit, no transfers/income/investing) ─
  const EXCLUDE   = new Set(['transfer', 'investing', 'income'])
  const expenseTx = transactions.filter(t =>
    !EXCLUDE.has(t.category) && parseFloat(t.amount) < 0 && !t.is_transfer
  )
  const txCount = expenseTx.length
  const avgTx   = txCount > 0 ? expenses / txCount : 0

  // ── Category breakdown ─────────────────────────────────────────────────────
  const byCategory = {}
  for (const tx of expenseTx) {
    const c   = tx.category || 'other'
    const amt = Math.abs(parseFloat(tx.amount))
    if (!byCategory[c]) byCategory[c] = { total: 0, count: 0 }
    byCategory[c].total += amt
    byCategory[c].count += 1
  }
  const catSorted = Object.entries(byCategory).sort((a, b) => b[1].total - a[1].total)
  const catTotal  = catSorted.reduce((s, [, v]) => s + v.total, 0)

  // ── Merchant grouping ──────────────────────────────────────────────────────
  const byMerchant = {}
  for (const tx of expenseTx) {
    const key = normalizeMerchant(tx.description || tx.name)
    if (!byMerchant[key]) byMerchant[key] = { total: 0, count: 0, cat: tx.category }
    byMerchant[key].total += Math.abs(parseFloat(tx.amount))
    byMerchant[key].count += 1
  }
  const topMerchants = Object.entries(byMerchant)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 8)

  // ── Spending by week ───────────────────────────────────────────────────────
  const weekBuckets = [0, 0, 0, 0, 0]
  for (const tx of expenseTx) {
    const day  = tx.date ? parseInt(tx.date.split('-')[2], 10) : 1
    const w    = Math.min(Math.floor((day - 1) / 7), 4)
    weekBuckets[w] += Math.abs(parseFloat(tx.amount))
  }
  const weeks = []
  for (let start = 1; start <= daysInMonth; start += 7) {
    const end = Math.min(start + 6, daysInMonth)
    const w   = Math.floor((start - 1) / 7)
    if (weekBuckets[w] > 0 || !isCurrentMonth || start <= daysElapsed)
      weeks.push({ label: `${mo}/${start}–${mo}/${end}`, total: weekBuckets[w] })
  }
  const maxWeek = Math.max(...weeks.map(w => w.total), 1)

  return (
    <div className="page">
      <div className="fin-detail-header">
        <button className="fin-back-btn" onClick={onBack}>‹ Back</button>
        <h2 className="section-title">Spending Analysis</h2>
        <MonthSelector month={month} onChange={setMonth} />
      </div>

      {/* ── Savings Rate hero ── */}
      <section className="page-section">
        <div className="card fin-savings-hero">
          <div className="fin-savings-top">
            <div>
              <div className="fin-savings-rate-label">Savings Rate</div>
              <div className={`fin-savings-rate-value ${isDeficit ? 'negative' : 'positive'}`}>
                {savingsRate !== null ? `${isDeficit ? '' : '+'}${savingsRate}%` : '—'}
              </div>
              <div className="fin-savings-sub">
                {isDeficit
                  ? `Overspending ${fmtUSD(Math.abs(surplus))} this month`
                  : income > 0
                    ? `Saving ${fmtUSD(surplus)} of ${fmtUSD(income)}`
                    : 'No income recorded yet'}
              </div>
            </div>
            <div className="fin-savings-pills">
              <div className="fin-savings-pill">
                <span className="positive">+{fmtUSD(income)}</span>
                <span>Income</span>
              </div>
              <div className="fin-savings-pill">
                <span className="negative">-{fmtUSD(expenses)}</span>
                <span>Spent</span>
              </div>
            </div>
          </div>
          <div className="fin-spend-bar-track">
            <div className={`fin-spend-bar-fill ${isDeficit ? 'deficit' : ''}`} style={{ width: `${spendPct}%` }} />
          </div>
          <div className="fin-spend-bar-labels">
            <span>{Math.round(spendPct)}% of income spent</span>
            {isCurrentMonth && daysLeft > 0 && <span>{daysLeft} days left</span>}
          </div>
        </div>
      </section>

      {/* ── 3 quick stats ── */}
      <section className="page-section">
        <div className="card fin-metrics-grid">
          <div className="fin-metric">
            <span className="fin-metric-value">{fmtUSD(dailyRate)}</span>
            <span className="fin-metric-label">Daily Spend</span>
          </div>
          <div className="fin-metric-divider" />
          <div className="fin-metric">
            <span className="fin-metric-value">{txCount}</span>
            <span className="fin-metric-label">Transactions</span>
          </div>
          <div className="fin-metric-divider" />
          <div className="fin-metric">
            <span className="fin-metric-value">{fmtUSD(avgTx)}</span>
            <span className="fin-metric-label">Avg per Tx</span>
          </div>
        </div>
      </section>

      {/* ── Cash Flow ── */}
      <section className="page-section">
        <div className="card fin-cashflow-card">
          <div className="fin-cf-title">Cash Flow</div>
          <div className="fin-cf-row">
            <span className="fin-cf-label">
              {sp?.beginning_estimated ? 'Start Balance (est.)' : 'Start of Month'}
            </span>
            <span className="fin-cf-value">{fmtUSD(sp?.beginning_balance)}</span>
          </div>
          <div className="fin-cf-row">
            <span className="fin-cf-label">+ Income</span>
            <span className="fin-cf-value positive">+{fmtUSD(income)}</span>
          </div>
          <div className="fin-cf-row">
            <span className="fin-cf-label">− Expenses</span>
            <span className="fin-cf-value negative">-{fmtUSD(expenses)}</span>
          </div>
          {isCurrentMonth && dailyRate > 0 && (
            <div className="fin-cf-row" style={{ opacity: 0.55 }}>
              <span className="fin-cf-label">Projected total spend</span>
              <span className={`fin-cf-value ${projected > income ? 'negative' : ''}`}>
                -{fmtUSD(projected)}
              </span>
            </div>
          )}
          <div className="fin-cf-divider" />
          <div className="fin-cf-row fin-cf-total">
            <span className="fin-cf-label">Current Balance</span>
            <span className="fin-cf-value">{fmtUSD(sp?.current_balance)}</span>
          </div>
        </div>
      </section>

      {/* ── Where Money Went ── */}
      {catSorted.length > 0 && (
        <section className="page-section">
          <h2 className="section-title">Where Money Went</h2>
          <div className="card spending-card">
            <div className="spending-bars">
              {catSorted.map(([cat, { total, count }]) => {
                const info = CATEGORY_MAP[cat]
                const pct  = catTotal > 0 ? (total / catTotal) * 100 : 0
                return (
                  <div key={cat} className="spending-row">
                    <div className="spending-row-top">
                      <div className="spending-cat">
                        <span style={{ fontSize: 14 }}>{info?.icon || '💸'}</span>
                        <span className="spending-cat-name">{info?.label || cat}</span>
                        <span className="fin-tx-count">{count}×</span>
                      </div>
                      <div className="spending-cat-right">
                        <span className="spending-pct">{Math.round(pct)}%</span>
                        <span className="spending-amt">{fmtUSD(total)}</span>
                      </div>
                    </div>
                    <div className="spending-track">
                      <div className="spending-fill" style={{ width: `${pct}%`, background: info?.color || '#6a6a6a' }} />
                    </div>
                  </div>
                )
              })}
              <div className="fin-cat-total-row">
                <span>Total</span>
                <span>{fmtUSD(catTotal)}</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── Spending by Week ── */}
      {weeks.length > 0 && (
        <section className="page-section">
          <h2 className="section-title">Spending by Week</h2>
          <div className="card" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {weeks.map((w, i) => (
              <div key={i} className="fin-week-row">
                <span className="fin-week-label">{w.label}</span>
                <div className="fin-week-track">
                  <div className="fin-week-fill" style={{ width: `${(w.total / maxWeek) * 100}%` }} />
                </div>
                <span className="fin-week-amt">{fmtUSD(w.total)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Confirmed Subscriptions ── */}
      {confirmedSubs.length > 0 && (
        <section className="page-section">
          <h2 className="section-title">Subscriptions</h2>
          <div className="card" style={{ padding: '4px 0' }}>
            {confirmedSubs.map((sub) => {
              const cat   = CATEGORY_MAP[sub.category] || CATEGORY_MAP['other']
              const isOld = !sub.chargedThisMonth
              return (
                <div key={sub.merchant} className="fin-sub-row">
                  <div className="fin-sub-left">
                    <span className="fin-sub-icon">{cat.icon}</span>
                    <div className="fin-sub-info">
                      <span className="fin-sub-name">{sub.merchant}</span>
                      <span className="fin-sub-meta">
                        {sub.frequency} · {sub.months} months
                        {isOld && <span className="fin-sub-badge-inactive"> · not this month ⚠</span>}
                      </span>
                    </div>
                  </div>
                  <div className="fin-sub-right">
                    <span className={`fin-sub-amt${isOld ? ' fin-sub-amt--inactive' : ''}`}>{fmtUSD(sub.amount)}</span>
                    <span className="fin-sub-freq">/mo</span>
                    <button className="fin-sub-remove" onClick={() => saveChoice(sub.merchant, 'no')} title="Remove">×</button>
                  </div>
                </div>
              )
            })}
            <div className="fin-sub-total-row">
              <span>Total per month</span>
              <span>{fmtUSD(confirmedSubs.reduce((s, sub) => s + sub.amount, 0))}</span>
            </div>
          </div>
        </section>
      )}

      {/* ── Pending review ── */}
      {pendingSubs.length > 0 && (
        <section className="page-section">
          <h2 className="section-title">Recurring — Is This A Subscription?</h2>
          <div className="card" style={{ padding: '4px 0' }}>
            {pendingSubs.map((sub) => {
              const cat = CATEGORY_MAP[sub.category] || CATEGORY_MAP['other']
              return (
                <div key={sub.merchant} className="fin-sub-review-row">
                  <div className="fin-sub-left">
                    <span className="fin-sub-icon">{cat.icon}</span>
                    <div className="fin-sub-info">
                      <span className="fin-sub-name">{sub.merchant}</span>
                      <span className="fin-sub-meta">Charged {sub.count}× over {sub.months} months · {fmtUSD(sub.amount)}</span>
                    </div>
                  </div>
                  <div className="fin-sub-review-btns">
                    <button className="fin-sub-btn-yes" onClick={() => saveChoice(sub.merchant, 'yes')}>Yes</button>
                    <button className="fin-sub-btn-no"  onClick={() => saveChoice(sub.merchant, 'no')}>No</button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── Top Merchants ── */}
      {topMerchants.length > 0 && (
        <section className="page-section">
          <h2 className="section-title">Top Merchants</h2>
          <div className="card" style={{ padding: '4px 0' }}>
            {topMerchants.map(([merchant, { total, count, cat }], i) => {
              const info = CATEGORY_MAP[cat]
              return (
                <div key={merchant} className="fin-merchant-row">
                  <div className="fin-merchant-left">
                    <span className="fin-merchant-rank">{i + 1}</span>
                    <div className="fin-merchant-info">
                      <span className="fin-merchant-name">{merchant}</span>
                      <span className="fin-merchant-meta">
                        {info?.icon} {info?.label || cat}
                        {count > 1 && ` · ${count}×`}
                      </span>
                    </div>
                  </div>
                  <span className="fin-merchant-amt">{fmtUSD(total)}</span>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

function AllTransactions({ transactions, summary, month, setMonth, onTxCategoryChange, onBack }) {
  const [activeAccount, setActiveAccount] = useState('all')

  // Build a map of account_id → account info from summary
  const allAccounts = [
    ...(summary?.cash?.accounts     || []),
    ...(summary?.credit?.accounts   || []),
    ...(summary?.investments?.accounts || []),
  ]
  const accountMap = Object.fromEntries(allAccounts.map(a => [a.account_id, a]))

  // Only show tabs for accounts that actually have transactions this month
  const accountsWithTx = allAccounts.filter(a =>
    transactions.some(t => t.account_id === a.account_id)
  )

  // Short label for tab: institution + last 4
  const tabLabel = (a) => {
    const base = (a.institution_name || a.account_name || 'Account').split(' ')[0]
    return a.last_four ? `${base} ···${a.last_four}` : base
  }

  // Filter + sort
  const filtered = (activeAccount === 'all'
    ? [...transactions]
    : transactions.filter(t => t.account_id === activeAccount)
  ).sort((a, b) => (b.date || '').localeCompare(a.date || ''))

  // Group by date
  const byDate = []
  let lastDate = null
  for (const tx of filtered) {
    const d = tx.date || ''
    if (d !== lastDate) { byDate.push({ date: d, txs: [] }); lastDate = d }
    byDate[byDate.length - 1].txs.push(tx)
  }

  // Running total for the filtered set
  const EXCLUDE = new Set(['transfer', 'investing'])
  const netAmt = filtered.reduce((s, t) => {
    const amt = parseFloat(t.amount)
    if (t.is_transfer || EXCLUDE.has(t.category)) return s
    return s + amt
  }, 0)

  return (
    <div className="page">
      <div className="fin-detail-header">
        <button className="fin-back-btn" onClick={onBack}>‹ Back</button>
        <h2 className="section-title">Transactions</h2>
        <MonthSelector month={month} onChange={setMonth} />
      </div>

      {/* Account filter tabs */}
      {accountsWithTx.length > 1 && (
        <section className="page-section" style={{ paddingBottom: 0 }}>
          <div className="fin-tx-tabs">
            <button
              className={`fin-tx-tab ${activeAccount === 'all' ? 'active' : ''}`}
              onClick={() => setActiveAccount('all')}
            >
              All
            </button>
            {accountsWithTx.map(a => (
              <button
                key={a.account_id}
                className={`fin-tx-tab ${activeAccount === a.account_id ? 'active' : ''}`}
                onClick={() => setActiveAccount(a.account_id)}
              >
                {tabLabel(a)}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Summary row */}
      <section className="page-section" style={{ paddingTop: 8, paddingBottom: 4 }}>
        <div className="fin-tx-summary-row">
          <span className="fin-tx-summary-count">{filtered.length} transactions</span>
          <span className={`fin-tx-summary-net ${netAmt >= 0 ? 'positive' : 'negative'}`}>
            Net {netAmt >= 0 ? '+' : ''}{fmtUSD(netAmt)}
          </span>
        </div>
      </section>

      {/* Grouped by date */}
      <section className="page-section">
        {filtered.length === 0 ? (
          <div className="empty-state">No transactions for {monthLabel(month)}</div>
        ) : (
          byDate.map(({ date, txs }) => (
            <div key={date} className="fin-tx-date-group">
              <div className="fin-tx-date-header">{formatDate(date)}</div>
              <div className="card-list">
                {txs.map((tx, i) => {
                  const acc = accountMap[tx.account_id]
                  const inst = acc ? (acc.institution_name || acc.account_name || 'Account').split(' ')[0] : null
                  const label = acc
                    ? (acc.last_four ? `${inst} ···${acc.last_four}` : inst)
                    : null
                  return (
                    <TxRow
                      key={tx.transaction_id || tx.id || i}
                      tx={tx}
                      accountLabel={label}
                      onCategoryChange={onTxCategoryChange}
                    />
                  )
                })}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  )
}

function ManageAccounts({ enrollments, onDisconnect, onDisconnectAll, investmentAccounts, onDisconnectSnap, onBack }) {
  // Group investment accounts by brokerage
  const snapGroups = {}
  for (const a of (investmentAccounts || [])) {
    const key = a.institution_name || 'Investment'
    if (!snapGroups[key]) snapGroups[key] = []
    snapGroups[key].push(a)
  }
  const snapBrokerages = Object.keys(snapGroups)

  return (
    <div className="page">
      <div className="fin-detail-header">
        <button className="fin-back-btn" onClick={onBack}>‹ Back</button>
        <h2 className="section-title">Manage Accounts</h2>
      </div>

      {/* Teller — bank & credit accounts */}
      {enrollments.length > 0 && (
        <section className="page-section">
          <h3 className="section-title" style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: 8 }}>BANK &amp; CREDIT</h3>
          <div className="card-list">
            {enrollments.map(e => (
              <div key={e.enrollmentId} className="card bank-row">
                <div className="bank-left">
                  <span className="bank-dot" />
                  <span className="bank-name">{e.institutionName}</span>
                </div>
                <button className="remove-btn" onClick={() => onDisconnect(e.enrollmentId)}>Remove</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* SnapTrade — investment accounts */}
      {snapBrokerages.length > 0 && (
        <section className="page-section">
          <h3 className="section-title" style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: 8 }}>INVESTMENTS</h3>
          <div className="card-list">
            {snapBrokerages.map(broker => (
              <div key={broker} className="card bank-row">
                <div className="bank-left">
                  <span className="bank-dot" style={{ background: 'var(--green)' }} />
                  <div>
                    <span className="bank-name">{broker}</span>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: 8 }}>
                      {snapGroups[broker].length} account{snapGroups[broker].length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
                <button className="remove-btn" onClick={onDisconnectSnap}>Remove</button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function Finance() {
  const data = useFinanceData()
  const snap = useSnaptradeData()
  const subs = useSubscriptions()
  const [view,       setView]       = useState('dashboard') // dashboard | cash | credit | investments | spending | transactions | manage
  const [toast,      setToast]      = useState(null)
  const [addMenu, setAddMenu] = useState(false)  // + Add dropdown open
  const addMenuRef = useRef(null)

  useEffect(() => {
    if (!addMenu) return
    const handler = (e) => { if (addMenuRef.current && !addMenuRef.current.contains(e.target)) setAddMenu(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [addMenu])

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type })
  }, [])

  const { open: openTeller, ready: tellerReady } = useTellerConnect({
    onSuccess: async (result) => {
      await data.onTellerSuccess(result)
      showToast('Account linked successfully!')
    },
    onError: (msg) => showToast(msg, 'error'),
  })

  const handleSync = async () => {
    try {
      await Promise.allSettled([
        data.sync(),
        snap.afterConnect(data.load),
      ])
      showToast('Synced successfully!')
    } catch (err) {
      showToast(err.message, 'error')
    }
  }

  const handleAddTeller = () => {
    setAddMenu(false)
    openTeller()
  }

  const handleAddInvestment = async () => {
    setAddMenu(false)
    await snap.connect()
    showToast('After connecting, tap Sync to update your accounts.')
  }

  const linked = data.enrollments.length > 0 || data.summary != null

  // ── Not linked yet ──
  if (!linked && !data.loading) {
    return (
      <div className="connect-screen">
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
        <div className="connect-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="5" width="20" height="14" rx="2"/>
            <line x1="2" y1="10" x2="22" y2="10"/>
          </svg>
        </div>
        <h2 className="connect-title">Link Your Bank</h2>
        <p className="connect-sub">Connect your accounts via Teller to sync balances and transactions.</p>
        {data.error && <p className="connect-error">{data.error}</p>}
        <button className="connect-btn" onClick={openTeller} disabled={!tellerReady}>
          {tellerReady ? 'Connect with Teller' : 'Loading Teller…'}
        </button>
        <p className="connect-note">Bank-level security. Your credentials are never stored here.</p>
      </div>
    )
  }

  // ── Loading ──
  // Only block the UI if we have no cached data. If we do, the background
  // fetch will silently update the displayed values without a spinner.
  if (data.loading && !data.summary) {
    return <div className="page"><div className="fin-loading">Loading…</div></div>
  }

  // ── Detail views ──
  if (view === 'cash') return (
    <CashDetail
      summary={data.summary}
      transactions={data.transactions}
      month={data.month}
      setMonth={data.setMonth}
      onCategoryChange={data.updateAccountCategory}
      onTxCategoryChange={data.updateTransactionCategory}
      onBack={() => setView('dashboard')}
    />
  )
  if (view === 'credit') return (
    <CreditDetail
      summary={data.summary}
      transactions={data.transactions}
      month={data.month}
      setMonth={data.setMonth}
      onCategoryChange={data.updateAccountCategory}
      onTxCategoryChange={data.updateTransactionCategory}
      onBack={() => setView('dashboard')}
    />
  )
  if (view === 'investments') return (
    <InvestmentsDetail
      summary={data.summary}
      snap={snap}
      onReload={data.load}
      onBack={() => setView('dashboard')}
    />
  )
  if (view === 'spending') return (
    <SpendingDetail
      summary={data.summary}
      transactions={data.transactions}
      month={data.month}
      setMonth={data.setMonth}
      onTxCategoryChange={data.updateTransactionCategory}
      subscriptions={subs}
      onBack={() => setView('dashboard')}
    />
  )
  if (view === 'transactions') return (
    <AllTransactions
      transactions={data.transactions}
      summary={data.summary}
      month={data.month}
      setMonth={data.setMonth}
      onTxCategoryChange={data.updateTransactionCategory}
      onBack={() => setView('dashboard')}
    />
  )
  if (view === 'manage') return (
    <ManageAccounts
      enrollments={data.enrollments}
      onDisconnect={data.disconnect}
      onDisconnectAll={data.disconnectAll}
      investmentAccounts={data.summary?.investments?.accounts || []}
      onDisconnectSnap={() => snap.disconnect(data.load)}
      onBack={() => setView('dashboard')}
    />
  )

  // ── Dashboard ──
  const sp = data.summary?.spending
  const netWorth = (data.summary?.cash?.total || 0) +
    (data.summary?.investments?.total || 0) -
    (data.summary?.credit?.total || 0)

  return (
    <div className="page">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Toolbar */}
      <div className="fin-toolbar">
        <div className="fin-toolbar-actions">
          <button className="action-btn" onClick={handleSync} disabled={data.syncing || snap.snapLoading}>
            {data.syncing || snap.snapLoading ? 'Syncing…' : '↻ Sync'}
          </button>
          <div style={{ position: 'relative' }} ref={addMenuRef}>
            <button className="action-btn" onClick={() => setAddMenu(m => !m)} disabled={!tellerReady}>+ Add</button>
            {addMenu && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, zIndex: 100, marginTop: 4,
                background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
                minWidth: 180, boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              }}>
                <button onClick={handleAddTeller} style={{
                  display: 'block', width: '100%', padding: '10px 16px', textAlign: 'left',
                  background: 'none', border: 'none', color: 'var(--text)', fontSize: '14px', cursor: 'pointer',
                }}>
                  🏦 Bank / Credit Card
                </button>
                <button onClick={handleAddInvestment} style={{
                  display: 'block', width: '100%', padding: '10px 16px', textAlign: 'left',
                  background: 'none', border: 'none', color: 'var(--text)', fontSize: '14px', cursor: 'pointer',
                  borderTop: '1px solid var(--border)',
                }}>
                  📈 Investment Account
                </button>
              </div>
            )}
          </div>
          <button className="action-btn" onClick={() => setView('manage')}>Manage</button>
        </div>
      </div>

      {data.error && (
        <div className="fin-error-banner">
          {data.error}
          <button onClick={() => data.setError(null)}>×</button>
        </div>
      )}

      {/* Net Worth hero */}
      <section className="page-section">
        <div className="fin-nw-hero">
          <span className="fin-nw-hero-label">Net Worth</span>
          <span className="fin-nw-hero-value">{fmtUSD(netWorth)}</span>
        </div>
      </section>

      {/* Summary rows */}
      <section className="page-section">
        <div className="fin-summary-list">
          <button className="fin-summary-row fin-summary-row--blue" onClick={() => setView('cash')}>
            <div className="fin-sr-left">
              <span className="fin-sr-icon">🏦</span>
              <div className="fin-sr-info">
                <span className="fin-sr-label">Cash</span>
                <span className="fin-sr-sub">{data.summary?.cash?.accounts?.length || 0} accounts</span>
              </div>
            </div>
            <div className="fin-sr-right">
              <span className="fin-sr-value">{fmtUSD(data.summary?.cash?.total)}</span>
              <span className="fin-sr-arrow">›</span>
            </div>
          </button>

          <button className="fin-summary-row fin-summary-row--red" onClick={() => setView('credit')}>
            <div className="fin-sr-left">
              <span className="fin-sr-icon">💳</span>
              <div className="fin-sr-info">
                <span className="fin-sr-label">Credit Cards</span>
                <span className="fin-sr-sub">{data.summary?.credit?.accounts?.length || 0} cards</span>
              </div>
            </div>
            <div className="fin-sr-right">
              <span className="fin-sr-value fin-sr-value--red">{fmtUSD(data.summary?.credit?.total)}</span>
              <span className="fin-sr-arrow">›</span>
            </div>
          </button>

          <button className="fin-summary-row fin-summary-row--green" onClick={() => setView('investments')}>
            <div className="fin-sr-left">
              <span className="fin-sr-icon">📈</span>
              <div className="fin-sr-info">
                <span className="fin-sr-label">Investments</span>
                <span className="fin-sr-sub">{`${data.summary?.investments?.accounts?.length || 0} accounts`}</span>
              </div>
            </div>
            <div className="fin-sr-right">
              <span className="fin-sr-value fin-sr-value--green">{fmtUSD(data.summary?.investments?.total || 0)}</span>
              <span className="fin-sr-arrow">›</span>
            </div>
          </button>

          <button className="fin-summary-row fin-summary-row--pink" onClick={() => setView('spending')}>
            <div className="fin-sr-left">
              <span className="fin-sr-icon">💸</span>
              <div className="fin-sr-info">
                <span className="fin-sr-label">Spent</span>
                <span className="fin-sr-sub">{sp?.income ? `Income ${fmtUSD(sp.income)}` : 'This month'}</span>
              </div>
            </div>
            <div className="fin-sr-right">
              <span className="fin-sr-value fin-sr-value--red">{fmtUSD(sp?.expenses)}</span>
              <span className="fin-sr-arrow">›</span>
            </div>
          </button>

          <button className="fin-summary-row" onClick={() => setView('transactions')}>
            <div className="fin-sr-left">
              <span className="fin-sr-icon">🧾</span>
              <div className="fin-sr-info">
                <span className="fin-sr-label">Transactions</span>
                <span className="fin-sr-sub">{data.transactions.length} this month</span>
              </div>
            </div>
            <div className="fin-sr-right">
              <span className="fin-sr-arrow">›</span>
            </div>
          </button>
        </div>
      </section>
    </div>
  )
}
