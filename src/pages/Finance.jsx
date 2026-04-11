import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, sb } from '../lib/supabase'
import { SaveBtn, CancelBtn } from '../components/IconButtons'
import '../components/IconButtons.css'
import './Page.css'
import './Finance.css'

// ── Constants ──────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { id: 'food',          label: 'Food',           icon: '🍔', color: '#f0a500' },
  { id: 'care',          label: 'Personal Care',  icon: '💆', color: '#e05c5c' },
  { id: 'bills',         label: 'Bills',          icon: '🏠', color: '#4a90d9' },
  { id: 'transport',     label: 'Transport',      icon: '🚗', color: '#ff2d78' },
  { id: 'shopping',      label: 'Shopping',       icon: '🛍️', color: '#4ab8d4' },
  { id: 'entertainment', label: 'Entertainment',  icon: '🎬', color: '#a855f7' },
  { id: 'investing',     label: 'Investing',      icon: '📈', color: '#00ff9d' },
  { id: 'income',        label: 'Income',         icon: '💰', color: '#00e5ff' },
  { id: 'other',         label: 'Other',          icon: '💸', color: '#888888' },
  { id: 'transfer',      label: 'Transfer',       icon: '🔄', color: '#555555' },
]
const CATEGORY_MAP    = Object.fromEntries(CATEGORIES.map(c => [c.id, c]))
const CATEGORY_COLORS = Object.fromEntries(CATEGORIES.map(c => [c.id, c.color]))

const MONTH_NAMES = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']

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

function prevMonthStr(m) {
  const [y, mo] = m.split('-').map(Number)
  return mo === 1
    ? `${y - 1}-12`
    : `${y}-${String(mo - 1).padStart(2, '0')}`
}

// ── Spending classification ───────────────────────────────────────────────────

const REAL_SPEND_CATS = new Set(['food', 'care', 'bills', 'transport', 'shopping', 'entertainment', 'other'])

function isRealSpend(tx) {
  if (parseFloat(tx.amount) >= 0) return false   // income / refund / credit
  if (tx.is_transfer) return false
  return REAL_SPEND_CATS.has(tx.category)
}

function isExcluded(tx) {
  if (tx.is_transfer) return true
  if (tx.category === 'transfer') return true
  if (tx.category === 'investing') return true
  // CC payment heuristic: large outgoing + payment keywords
  const amt = Math.abs(parseFloat(tx.amount || 0))
  if (parseFloat(tx.amount) < 0 && amt >= 100) {
    const desc = (tx.description || tx.name || '').toUpperCase()
    if (/PAYMENT|AUTOPAY|APPLE CARD|THANK YOU|ONLINE PMT/.test(desc)) return true
  }
  return false
}

function computeSpendStats(txList) {
  const realTx = (txList || []).filter(isRealSpend)
  const total  = realTx.reduce((s, t) => s + Math.abs(parseFloat(t.amount)), 0)
  const byCategory = {}
  for (const tx of realTx) {
    const c = tx.category || 'other'
    if (!byCategory[c]) byCategory[c] = { total: 0, count: 0 }
    byCategory[c].total += Math.abs(parseFloat(tx.amount))
    byCategory[c].count += 1
  }
  return { total, byCategory, txCount: realTx.length, transactions: realTx }
}

function computeIncomeStats(txList) {
  const incomeTx = (txList || []).filter(t => {
    const amt = parseFloat(t.amount)
    return amt > 0 && !t.is_transfer && t.category !== 'transfer' && t.category !== 'investing'
  })
  const total = incomeTx.reduce((s, t) => s + parseFloat(t.amount), 0)
  return { total, count: incomeTx.length, transactions: incomeTx }
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
  const [lastMonthTransactions, setLastMonthTransactions] = useState(() => {
    const pm = prevMonthStr(currentMonth())
    try { return JSON.parse(localStorage.getItem(`aaron_finance_tx_${pm}`) || '[]') }
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
      localStorage.setItem(`aaron_finance_tx_${m}`, JSON.stringify(data))
    } catch { /* ignore */ }
  }, [])

  const loadLastMonthTransactions = useCallback(async (m) => {
    const pm = prevMonthStr(m)
    try {
      const res  = await fetch(`/api/finance/transactions?month=${pm}&limit=200`)
      if (!res.ok) return
      const data = await res.json()
      setLastMonthTransactions(data)
      localStorage.setItem(`aaron_finance_tx_${pm}`, JSON.stringify(data))
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
        await Promise.all([loadSummary(), loadTransactions(month), loadLastMonthTransactions(month)])
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
    loadLastMonthTransactions(month)
  }, [month, loadTransactions, loadLastMonthTransactions])

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
      await Promise.all([loadSummary(), loadTransactions(month), loadLastMonthTransactions(month)])
    } catch (err) {
      setError(err.message)
    } finally {
      setSyncing(false)
    }
  }

  const onTellerSuccess = async (data) => {
    if (data.enrollments) setEnrollments(data.enrollments)
    await Promise.all([loadSummary(), loadTransactions(month), loadLastMonthTransactions(month)])
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
    setLastMonthTransactions([])
    localStorage.removeItem('aaron_teller_enrollments')
    localStorage.removeItem('aaron_finance_summary')
    const now = new Date()
    for (let i = 0; i < 7; i++) {
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
    summary, transactions, lastMonthTransactions, enrollments, loading, syncing, error, month,
    setMonth, setError, sync, load: loadSummary, onTellerSuccess, disconnect, disconnectAll,
    updateAccountCategory, updateTransactionCategory,
  }
}

// ── Year-level data hook ──────────────────────────────────────────────────────

function useYearData() {
  const year = new Date().getFullYear()
  const [yearData, setYearData] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`aaron_year_data_${year}`) || '{}') }
    catch { return {} }
  })

  useEffect(() => {
    async function load() {
      const now = new Date()
      const currentMonthNum = now.getMonth() + 1
      const months = []
      for (let m = 1; m <= currentMonthNum; m++) {
        months.push(`${year}-${String(m).padStart(2, '0')}`)
      }
      try {
        const results = await Promise.allSettled(
          months.map(m =>
            fetch(`/api/finance/transactions?month=${m}&limit=500`)
              .then(r => r.ok ? r.json() : [])
          )
        )
        const data = {}
        months.forEach((m, i) => {
          const txs = results[i].status === 'fulfilled' ? (results[i].value || []) : []
          data[m] = {
            income:   computeIncomeStats(txs).total,
            expenses: computeSpendStats(txs).total,
          }
        })
        setYearData(data)
        localStorage.setItem(`aaron_year_data_${year}`, JSON.stringify(data))
      } catch { /* ignore */ }
    }
    load()
  }, [year]) // eslint-disable-line

  return yearData
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
                <CancelBtn onClick={cancelNote} />
                <SaveBtn onClick={saveNote} />
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

// ── Pie chart helper ──────────────────────────────────────────────────────────
function polarToCartesian(cx, cy, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function SpendingPieChart({ segments, size = 140 }) {
  const cx = size / 2, cy = size / 2
  const outer = size / 2 - 3
  const inner = outer * 0.52   // donut hole

  // Single slice: full donut ring
  if (segments.length === 1) return (
    <svg width={size} height={size}>
      <circle cx={cx} cy={cy} r={outer} fill={segments[0].color} />
      <circle cx={cx} cy={cy} r={inner} fill="var(--bg-card)" />
    </svg>
  )

  let angle = 0
  const slices = segments.map(({ pct, color }) => {
    if (pct <= 0) return null
    const sweep = (pct / 100) * 360
    const a1 = polarToCartesian(cx, cy, outer, angle)
    const a2 = polarToCartesian(cx, cy, outer, angle + sweep)
    const b1 = polarToCartesian(cx, cy, inner, angle)
    const b2 = polarToCartesian(cx, cy, inner, angle + sweep)
    const lg = sweep > 180 ? 1 : 0
    const d = `M${a1.x} ${a1.y} A${outer} ${outer} 0 ${lg} 1 ${a2.x} ${a2.y} L${b2.x} ${b2.y} A${inner} ${inner} 0 ${lg} 0 ${b1.x} ${b1.y}Z`
    angle += sweep
    return { d, color }
  }).filter(Boolean)

  return (
    <svg width={size} height={size}>
      {slices.map((s, i) => (
        <path key={i} d={s.d} fill={s.color} stroke="var(--bg-card)" strokeWidth={1.5} />
      ))}
    </svg>
  )
}

// ── Month Bar ─────────────────────────────────────────────────────────────────

function MonthBar({ selectedMonth, onSelect }) {
  const scrollRef = useRef(null)
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonthIdx = now.getMonth()

  const months = []
  for (let m = 0; m <= currentMonthIdx; m++) {
    months.push(`${currentYear}-${String(m + 1).padStart(2, '0')}`)
  }

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const active = el.querySelector('.fin-month-pill--active')
    if (active) active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [selectedMonth])

  return (
    <div className="fin-month-bar" ref={scrollRef}>
      {months.map(m => {
        const mIdx = parseInt(m.split('-')[1]) - 1
        return (
          <button
            key={m}
            className={`fin-month-pill${m === selectedMonth ? ' fin-month-pill--active' : ''}`}
            onClick={() => onSelect(m)}
          >
            {MONTH_NAMES[mIdx]}
          </button>
        )
      })}
    </div>
  )
}

// ── Finance Nav (horizontal tab strip) ───────────────────────────────────────

const FIN_VIEWS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'budgeting', label: 'Budget'    },
  { id: 'expenses',  label: 'Expenses'  },
]

function FinNav({ view, onView }) {
  const scrollRef = useRef(null)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const active = el.querySelector('.fin-nav-btn--active')
    if (active) active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [view])
  return (
    <div className="fin-nav" ref={scrollRef}>
      {FIN_VIEWS.map(v => (
        <button
          key={v.id}
          className={`fin-nav-btn${view === v.id ? ' fin-nav-btn--active' : ''}`}
          onClick={() => onView(v.id)}
        >
          {v.label}
        </button>
      ))}
    </div>
  )
}

// ── Donut Chart ───────────────────────────────────────────────────────────────

function DonutChart({ pct, size = 140, color1 = '#00e5ff', color2 = '#9d65ff', centerLabel }) {
  const cx = size / 2, cy = size / 2
  const r = size / 2 - size * 0.07
  const strokeW = r * 0.36
  const circum = 2 * Math.PI * r
  const safePct = Math.min(Math.max(pct || 0, 0), 100)
  const filled = (safePct / 100) * circum

  // Dot position at end of fill arc
  const endAngle = (safePct / 100) * 360 - 90
  const dotX = cx + r * Math.cos(endAngle * Math.PI / 180)
  const dotY = cy + r * Math.sin(endAngle * Math.PI / 180)

  return (
    <div className="fin-donut-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <defs>
          <linearGradient id={`dg-${size}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={color1} />
            <stop offset="100%" stopColor={color2} />
          </linearGradient>
        </defs>
        <circle cx={cx} cy={cy} r={r} fill="none"
          stroke="rgba(255,255,255,0.06)" strokeWidth={strokeW} />
        {safePct > 0 && (
          <circle cx={cx} cy={cy} r={r} fill="none"
            stroke={`url(#dg-${size})`} strokeWidth={strokeW}
            strokeDasharray={`${filled} ${circum - filled}`}
            strokeLinecap="round" />
        )}
        {safePct > 2 && safePct < 98 && (
          <circle cx={dotX} cy={dotY} r={size * 0.04} fill="#fff"
            style={{ filter: 'drop-shadow(0 0 4px rgba(255,255,255,0.8))' }} />
        )}
      </svg>
      <div className="fin-donut-center">
        <span className="fin-donut-pct">{Math.round(safePct)}%</span>
        {centerLabel && <span className="fin-donut-label">{centerLabel}</span>}
      </div>
    </div>
  )
}

// ── Ratio Donut (Income vs Expenses) ─────────────────────────────────────────

function RatioDonut({ income, expenses, size = 120 }) {
  const total = income + expenses
  const incomePct = total > 0 ? (income / total) * 100 : 50
  const cx = size / 2, cy = size / 2
  const r = size / 2 - size * 0.07
  const strokeW = r * 0.38
  const circum = 2 * Math.PI * r
  const incomeFill = (incomePct / 100) * circum

  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#ff3864" strokeWidth={strokeW} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#00e5ff" strokeWidth={strokeW}
          strokeDasharray={`${incomeFill} ${circum - incomeFill}`} />
        <circle
          cx={cx + r * Math.cos((incomePct / 100 * 360 - 90) * Math.PI / 180)}
          cy={cy + r * Math.sin((incomePct / 100 * 360 - 90) * Math.PI / 180)}
          r={size * 0.04} fill="#fff" />
      </svg>
      <div className="fin-donut-center">
        <span className="fin-donut-pct" style={{ fontSize: size * 0.15 }}>{Math.round(incomePct)}%</span>
      </div>
    </div>
  )
}

// ── Monthly Bar + Line Chart ──────────────────────────────────────────────────

function MonthlyBarChart({ yearData, selectedMonth }) {
  const now = new Date()
  const months = []
  for (let m = 0; m <= now.getMonth(); m++) {
    months.push(`${now.getFullYear()}-${String(m + 1).padStart(2, '0')}`)
  }

  const incomes  = months.map(m => yearData[m]?.income   || 0)
  const expenses = months.map(m => yearData[m]?.expenses || 0)
  const maxVal   = Math.max(...incomes, ...expenses, 1)

  const W = 300, H = 120
  const gap = W / months.length
  const bW  = Math.max(5, gap * 0.32)

  const expPoints = months.map((m, i) => {
    const x = gap * i + gap / 2
    const y = H - (expenses[i] / maxVal) * (H - 12)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  return (
    <div className="fin-monthly-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
        style={{ width: '100%', height: '110px', display: 'block' }}>
        {months.map((m, i) => {
          const x    = gap * i + gap / 2
          const iH   = (incomes[i]  / maxVal) * (H - 12)
          const eH   = (expenses[i] / maxVal) * (H - 12)
          const isSel = m === selectedMonth
          return (
            <g key={m}>
              <rect x={x - bW - 1} y={H - iH} width={bW} height={Math.max(iH, 1)}
                fill={isSel ? '#00e5ff' : 'rgba(0,229,255,0.35)'} rx={2} />
              <rect x={x + 1} y={H - eH} width={bW} height={Math.max(eH, 1)}
                fill={isSel ? '#9d65ff' : 'rgba(157,101,255,0.3)'} rx={2} />
            </g>
          )
        })}
        {/* Trend line (expenses) */}
        <polyline points={expPoints} fill="none" stroke="#e054a4"
          strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        {months.map((m, i) => {
          if (!expenses[i]) return null
          const x = gap * i + gap / 2
          const y = H - (expenses[i] / maxVal) * (H - 12)
          return <circle key={m} cx={x} cy={y} r={2.5} fill="#e054a4" />
        })}
      </svg>
      <div className="fin-monthly-chart-axis">
        {months.map((m, i) => (
          <span key={m} style={{ color: m === selectedMonth ? 'var(--accent)' : undefined }}>
            {MONTH_NAMES[parseInt(m.split('-')[1]) - 1]}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Horizontal Bar Chart ──────────────────────────────────────────────────────

function HorizBarChart({ items, colorFn }) {
  const max = Math.max(...items.map(i => i.value), 1)
  const GRAD = ['#9d65ff','#7c5cbf','#5c9be0','#4a9ef5','#00d4aa','#e054a4','#ff6b6b','#f0a500','#00e5ff','#00ff9d']
  return (
    <div className="fin-horiz-chart">
      {items.map((item, i) => (
        <div key={item.label} className="fin-horiz-row">
          <span className="fin-horiz-label">{item.label}</span>
          <div className="fin-horiz-track">
            <div className="fin-horiz-fill"
              style={{
                width: `${(item.value / max) * 100}%`,
                background: colorFn ? colorFn(i) : (item.color || GRAD[i % GRAD.length]),
              }} />
          </div>
          <span className="fin-horiz-amt">{Math.round(item.value).toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

// ── Credit Card Widget ────────────────────────────────────────────────────────

function CreditCardWidget({ cashTotal }) {
  return (
    <div className="fin-cc-widget">
      <div className="fin-cc-visual">
        <div className="fin-cc-visual-top">
          <span className="fin-cc-chip-icon">▣</span>
          <span className="fin-cc-icons">☾ ☀ )))</span>
        </div>
        <div className="fin-cc-num">•••• •••• •••• ••••</div>
      </div>
      <div className="fin-cc-bal-row">
        <span className="fin-cc-bal-label">Balance:</span>
        <span className="fin-cc-bal-val">{fmtUSD(cashTotal || 0)}</span>
      </div>
    </div>
  )
}

// ── Summary List ──────────────────────────────────────────────────────────────

function SummaryList({ summary, onView }) {
  const items = [
    { id: 'cash',        icon: '🏦', label: 'Cash',        val: summary?.cash?.total        || 0, color: '#00e5ff', positive: true },
    { id: 'credit',      icon: '💳', label: 'Credit Owed', val: summary?.credit?.total       || 0, color: '#ff3864', positive: false },
    { id: 'investments', icon: '📈', label: 'Investments', val: summary?.investments?.total  || 0, color: '#00ff9d', positive: true },
    { id: 'budgeting',   icon: '💸', label: 'Spending',    val: summary?.spending?.expenses  || 0, color: '#ff2d78', positive: false },
  ]
  return (
    <div className="fin-sum-list">
      {items.map(item => (
        <button key={item.id} className="fin-sum-item" onClick={() => onView(item.id)}>
          <div className="fin-si-icon" style={{ background: `${item.color}1a`, borderColor: `${item.color}40` }}>
            <span>{item.icon}</span>
          </div>
          <div className="fin-si-info">
            <span className="fin-si-label">{item.label}</span>
            <span className="fin-si-value" style={{ color: item.positive ? '#fff' : '#e054a4' }}>
              {fmtUSD(item.val)}
            </span>
          </div>
          <span className="fin-si-arrow">›</span>
        </button>
      ))}
    </div>
  )
}

// ── Dashboard View (Image 1) ──────────────────────────────────────────────────

function FinDashboardView({ summary, transactions, yearData, month, onView }) {
  const income   = computeIncomeStats(transactions).total
  const expenses = computeSpendStats(transactions).total
  const budget   = parseFloat(localStorage.getItem('aaron_spending_budget') || '0')
  const pctUsed  = budget > 0 ? Math.min((expenses / budget) * 100, 100) : 0

  const totalFlow  = income + expenses
  const incomePct  = totalFlow > 0 ? Math.round((income  / totalFlow) * 100) : 50

  return (
    <div className="fin-dashboard">

      {/* Income / Expense bar chart card */}
      <div className="fin-dash-card">
        <div className="fin-dash-ie-header">
          <span className="fin-dash-income-lbl">
            Income <span className="fin-dash-income-val">{fmtUSD(income)}</span>
          </span>
          <span className="fin-dash-expense-lbl">
            Expenses <span className="fin-dash-expense-val">{fmtUSD(expenses)}</span>
          </span>
        </div>
        <MonthlyBarChart yearData={yearData} selectedMonth={month} />
      </div>

      {/* Ratio donut + Credit card */}
      <div className="fin-dash-row2">
        <div className="fin-dash-card fin-dash-ratio">
          <div className="fin-dash-card-title">Ratio Income</div>
          <div style={{ display:'flex', justifyContent:'center', margin:'8px 0' }}>
            <RatioDonut income={income} expenses={expenses} size={110} />
          </div>
          <div className="fin-ratio-legend">
            <span className="fin-ratio-dot" style={{ background:'var(--accent)' }} />
            <span>Income</span>
            <span className="fin-ratio-dot" style={{ background:'var(--red)', marginLeft:10 }} />
            <span>Expenses</span>
          </div>
        </div>

        <div className="fin-dash-card fin-dash-cc">
          <CreditCardWidget cashTotal={summary?.cash?.total} />
        </div>
      </div>

      {/* Budget donut + Investments mini */}
      <div className="fin-dash-row2">
        <div className="fin-dash-card fin-dash-budget" onClick={() => onView('budgeting')} style={{ cursor:'pointer' }}>
          <div className="fin-dash-card-title">Budget</div>
          <div style={{ display:'flex', justifyContent:'center', margin:'6px 0' }}>
            {budget > 0
              ? <DonutChart pct={pctUsed} size={90} centerLabel="Used" />
              : <div className="fin-dash-no-budget">Tap to set budget</div>
            }
          </div>
          {budget > 0 && (
            <div style={{ textAlign:'center', fontSize:11, color:'var(--text-muted)' }}>
              {fmtUSD(expenses)} / {fmtUSD(budget)}
            </div>
          )}
        </div>

        <div className="fin-dash-card fin-dash-invest" onClick={() => onView('investments')} style={{ cursor:'pointer' }}>
          <div className="fin-dash-card-title">Investments</div>
          <div className="fin-dash-invest-val">{fmtUSD(summary?.investments?.total || 0)}</div>
          <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:4 }}>
            {summary?.investments?.accounts?.length || 0} accounts
          </div>
        </div>
      </div>

      {/* Summary list */}
      <div className="fin-dash-card">
        <SummaryList summary={summary} onView={onView} />
      </div>
    </div>
  )
}

// ── Budgeting View (new design, cyberpunk theme) ──────────────────────────────

function FinBudgetingView({ transactions, lastMonthTransactions = [], month, yearData, onTxCategoryChange }) {
  const [budget, setBudget]         = useState(() => parseFloat(localStorage.getItem('aaron_spending_budget') || '0'))
  const [editMode, setEditMode]     = useState(false)
  const [budgetInput, setBudgetInput] = useState('')
  const [showTx, setShowTx]         = useState(false)

  const saveBudget = (v) => {
    const n = parseFloat(v)
    const val = (!isNaN(n) && n > 0) ? n : 0
    setBudget(val)
    localStorage.setItem('aaron_spending_budget', String(val))
    setEditMode(false)
  }

  const stats   = computeSpendStats(transactions)
  const incStat = computeIncomeStats(transactions)
  const expenses = stats.total
  const income   = incStat.total

  const totalFlow  = income + expenses
  const incomePct  = totalFlow > 0 ? Math.round((income  / totalFlow) * 100) : 0
  const expensePct = totalFlow > 0 ? Math.round((expenses / totalFlow) * 100) : 0
  const pctBudget  = budget > 0 ? Math.min((expenses / budget) * 100, 100) : expensePct

  const FIXED_EXP = new Set(['bills', 'transport'])
  const VAR_EXP   = new Set(['food', 'shopping', 'entertainment', 'care'])
  let fixedAmt = 0, varAmt = 0, otherAmt = 0
  for (const tx of stats.transactions) {
    const a = Math.abs(parseFloat(tx.amount))
    if (FIXED_EXP.has(tx.category)) fixedAmt += a
    else if (VAR_EXP.has(tx.category)) varAmt += a
    else otherAmt += a
  }

  const catSorted  = Object.entries(stats.byCategory).sort((a, b) => b[1].total - a[1].total)
  const excludedTx = transactions.filter(isExcluded).sort((a, b) => (b.date || '').localeCompare(a.date || ''))

  return (
    <div className="fin-budget-view">

      {/* Donut + breakdown table */}
      <div className="fin-dash-card fin-budget-top">
        <div className="fin-budget-donut-col">
          <DonutChart pct={pctBudget} size={150} centerLabel={budget > 0 ? 'Used Budget' : 'Expenses'} />
          <div style={{ textAlign:'center', fontSize:11, color:'var(--text-muted)', marginTop:6 }}>
            {fmtUSD(expenses)} spent
          </div>
        </div>

        <div className="fin-budget-table">
          <div className="fin-bb-head fin-bb-income">
            <span>Income</span>
            <span>{fmtUSD(income)}</span>
            <span>{incomePct}%</span>
          </div>
          <div className="fin-bb-row">
            <span>Fixed Income</span>
            <span>{fmtUSD(income)}</span>
            <span>{incomePct}%</span>
          </div>

          <div style={{ height:10 }} />

          <div className="fin-bb-head fin-bb-expense">
            <span>Expenses</span>
            <span>{fmtUSD(expenses)}</span>
            <span>{expensePct}%</span>
          </div>
          <div className="fin-bb-row">
            <span>Non-Fixed</span>
            <span>{fmtUSD(varAmt)}</span>
            <span>{expenses > 0 ? Math.round((varAmt / expenses) * 100) : 0}%</span>
          </div>
          <div className="fin-bb-row">
            <span>Fixed Costs</span>
            <span>{fmtUSD(fixedAmt)}</span>
            <span>{expenses > 0 ? Math.round((fixedAmt / expenses) * 100) : 0}%</span>
          </div>
          <div className="fin-bb-row">
            <span>Other</span>
            <span>{fmtUSD(otherAmt)}</span>
            <span>{expenses > 0 ? Math.round((otherAmt / expenses) * 100) : 0}%</span>
          </div>

          {editMode ? (
            <div className="fin-sa-budget-edit-row" style={{ marginTop:10 }}>
              <input className="fin-budget-input" type="number" placeholder="e.g. 3000"
                value={budgetInput} autoFocus
                onChange={e => setBudgetInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveBudget(budgetInput)} />
              <SaveBtn onClick={() => saveBudget(budgetInput)} />
              <CancelBtn onClick={() => setEditMode(false)} />
            </div>
          ) : (
            <button className="fin-sa-set-budget-btn" style={{ marginTop:10, width:'100%', fontSize:11 }}
              onClick={() => { setBudgetInput(budget ? String(budget) : ''); setEditMode(true) }}>
              {budget > 0 ? `Budget: ${fmtUSD(budget)} · Edit` : '+ Set Monthly Budget'}
            </button>
          )}
        </div>
      </div>

      {/* Monthly trend */}
      <div className="fin-dash-card">
        <div className="fin-dash-card-title">Monthly Trend</div>
        <MonthlyBarChart yearData={yearData} selectedMonth={month} />
        <div className="fin-chart-legend">
          <span className="fin-legend-dot" style={{ background:'var(--accent)' }} /> Income
          <span className="fin-legend-dot" style={{ background:'#9d65ff', marginLeft:12 }} /> Expenses
          <span className="fin-legend-line" /> Trend
        </div>
      </div>

      {/* Category breakdown */}
      {catSorted.length > 0 && (
        <div className="fin-dash-card">
          <div className="fin-dash-card-title">Category Breakdown</div>
          <div className="fin-pie-layout">
            <SpendingPieChart size={80}
              segments={catSorted.map(([cat, { total }]) => ({
                pct: expenses > 0 ? (total / expenses) * 100 : 0,
                color: CATEGORY_MAP[cat]?.color || '#888',
              }))}
            />
            <div className="fin-pie-legend">
              {catSorted.map(([cat, { total }]) => {
                const info = CATEGORY_MAP[cat]
                const pct  = expenses > 0 ? (total / expenses) * 100 : 0
                return (
                  <div key={cat} className="fin-pie-legend-row">
                    <div className="fin-pie-dot" style={{ background: info?.color || '#888' }} />
                    <span className="fin-pie-cat">{info?.label || cat}</span>
                    <span className="fin-pie-pct">{pct.toFixed(0)}%</span>
                    <span className="fin-pie-amt">{fmtUSD(total)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Transfers (collapsible) */}
      {excludedTx.length > 0 && (
        <div className="fin-dash-card">
          <button className="fin-transfers-toggle section-title"
            style={{ background:'none', border:'none', width:'100%', textAlign:'left', cursor:'pointer', display:'flex', gap:8 }}
            onClick={() => setShowTx(t => !t)}>
            Transfers &amp; Excluded
            <span className="fin-transfers-count">{excludedTx.length}</span>
            <span className="fin-transfers-chevron">{showTx ? '∨' : '›'}</span>
          </button>
          {showTx && (
            <div className="card-list" style={{ marginTop:8 }}>
              {excludedTx.slice(0, 25).map((tx, i) => (
                <TxRow key={tx.transaction_id || tx.id || i} tx={tx} onCategoryChange={onTxCategoryChange} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Expenses View (Image 3) ───────────────────────────────────────────────────

function FinExpensesView({ transactions }) {
  const stats = computeSpendStats(transactions)
  const expenses = stats.total

  const catItems = Object.entries(stats.byCategory)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([cat, { total }]) => ({
      label: CATEGORY_MAP[cat]?.label || cat,
      value: total,
      color: CATEGORY_MAP[cat]?.color || '#888',
    }))

  // Fixed vs variable split
  const FIXED = new Set(['bills', 'transport'])
  const VAR   = new Set(['food', 'shopping', 'entertainment', 'care'])

  const fixedItems = Object.entries(stats.byCategory)
    .filter(([cat]) => FIXED.has(cat))
    .sort((a, b) => b[1].total - a[1].total)
    .map(([cat, { total }]) => ({ label: CATEGORY_MAP[cat]?.label || cat, value: total, color: CATEGORY_MAP[cat]?.color }))

  const varItems = Object.entries(stats.byCategory)
    .filter(([cat]) => VAR.has(cat))
    .sort((a, b) => b[1].total - a[1].total)
    .map(([cat, { total }]) => ({ label: CATEGORY_MAP[cat]?.label || cat, value: total, color: CATEGORY_MAP[cat]?.color }))

  // Top merchants
  const byMerchant = {}
  for (const tx of stats.transactions) {
    const key = normalizeMerchant(tx.description || tx.name)
    if (!byMerchant[key]) byMerchant[key] = { total: 0, cat: tx.category }
    byMerchant[key].total += Math.abs(parseFloat(tx.amount))
  }
  const merchantItems = Object.entries(byMerchant)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 12)
    .map(([label, { total }]) => ({ label, value: total }))

  const GRAD = ['#9d65ff','#7c5cbf','#5c9be0','#4a9ef5','#00d4aa','#e054a4','#ff6b6b','#f0a500','#00e5ff','#00ff9d','#a855f7','#10b981']
  const gradFn = i => GRAD[i % GRAD.length]

  if (catItems.length === 0) {
    return <div className="empty-state">No spending data for this month.</div>
  }

  return (
    <div className="fin-expenses-view">

      {/* All categories */}
      <div className="fin-dash-card">
        <div className="fin-dash-card-title">Spending by Category</div>
        <HorizBarChart items={catItems} colorFn={gradFn} />
      </div>

      {/* Fixed vs Variable split */}
      <div className="fin-dash-row2">
        {fixedItems.length > 0 && (
          <div className="fin-dash-card">
            <div className="fin-dash-card-title">Fixed Costs</div>
            <HorizBarChart items={fixedItems} colorFn={gradFn} />
          </div>
        )}
        {varItems.length > 0 && (
          <div className="fin-dash-card">
            <div className="fin-dash-card-title">Variable</div>
            <HorizBarChart items={varItems} colorFn={gradFn} />
          </div>
        )}
      </div>

      {/* Top merchants */}
      {merchantItems.length > 0 && (
        <div className="fin-dash-card">
          <div className="fin-dash-card-title">Top Merchants</div>
          <HorizBarChart items={merchantItems} colorFn={gradFn} />
        </div>
      )}
    </div>
  )
}

// ── Legacy SpendingDetail (kept for back-compat route) ────────────────────────

function SpendingDetail({ summary, transactions, lastMonthTransactions = [], month, setMonth, onTxCategoryChange, onBack }) {
  const [budget, setBudget]             = useState(() => parseFloat(localStorage.getItem('aaron_spending_budget') || '0'))
  const [budgetEditMode, setBudgetEditMode] = useState(false)
  const [budgetInput, setBudgetInput]   = useState('')
  const [showTransfers, setShowTransfers] = useState(false)

  const saveBudget = (v) => {
    const n = parseFloat(v)
    const val = !isNaN(n) && n > 0 ? n : 0
    setBudget(val)
    localStorage.setItem('aaron_spending_budget', String(val))
    setBudgetEditMode(false)
  }

  // ── Date math ──────────────────────────────────────────────────────────────
  const now = new Date()
  const [yr, mo] = month.split('-').map(Number)
  const isCurrentMonth = yr === now.getFullYear() && mo === (now.getMonth() + 1)
  const daysInMonth = new Date(yr, mo, 0).getDate()
  const daysElapsed = isCurrentMonth ? now.getDate() : daysInMonth
  const daysLeft    = isCurrentMonth ? daysInMonth - now.getDate() : 0

  // ── Core stats ─────────────────────────────────────────────────────────────
  const stats      = computeSpendStats(transactions)
  const spentSoFar = stats.total
  const txCount    = stats.txCount
  const avgTx      = txCount > 0 ? spentSoFar / txCount : 0
  const dailyRate  = daysElapsed > 0 ? spentSoFar / daysElapsed : 0
  const projected  = isCurrentMonth ? dailyRate * daysInMonth : spentSoFar

  // ── Budget ─────────────────────────────────────────────────────────────────
  const remaining   = budget > 0 ? budget - spentSoFar : null
  const overBudget  = remaining !== null && remaining < 0
  const pctOfBudget = budget > 0 ? Math.min((spentSoFar / budget) * 100, 120) : 0

  // ── Category breakdown ─────────────────────────────────────────────────────
  const catSorted = Object.entries(stats.byCategory).sort((a, b) => b[1].total - a[1].total)

  // ── Daily spend chart ──────────────────────────────────────────────────────
  const dailyTotals = {}
  for (const tx of stats.transactions) {
    const day = tx.date ? parseInt(tx.date.split('-')[2], 10) : null
    if (!day) continue
    dailyTotals[day] = (dailyTotals[day] || 0) + Math.abs(parseFloat(tx.amount))
  }
  const maxDay   = Math.max(...Object.values(dailyTotals), 1)
  // Always show full month so bars stay thin — future days just have no fill
  const chartDays = Array.from({ length: daysInMonth }, (_, i) => i + 1)

  // ── Large transactions ─────────────────────────────────────────────────────
  const threshold = Math.max(avgTx * 2, 50)
  const largeTx   = stats.transactions
    .filter(tx => Math.abs(parseFloat(tx.amount)) > threshold)
    .sort((a, b) => Math.abs(parseFloat(b.amount)) - Math.abs(parseFloat(a.amount)))
    .slice(0, 5)

  // ── Monthly comparison ─────────────────────────────────────────────────────
  const lastStats  = computeSpendStats(lastMonthTransactions)
  const monthDelta = spentSoFar - lastStats.total
  const hasCompare = lastMonthTransactions.length > 0

  // ── Top merchants ──────────────────────────────────────────────────────────
  const byMerchant = {}
  for (const tx of stats.transactions) {
    const key = normalizeMerchant(tx.description || tx.name)
    if (!byMerchant[key]) byMerchant[key] = { total: 0, count: 0, cat: tx.category }
    byMerchant[key].total += Math.abs(parseFloat(tx.amount))
    byMerchant[key].count += 1
  }
  const topMerchants = Object.entries(byMerchant).sort((a, b) => b[1].total - a[1].total).slice(0, 6)

  // ── Transfers ─────────────────────────────────────────────────────────────
  const excludedTx = transactions.filter(isExcluded).sort((a, b) => (b.date || '').localeCompare(a.date || ''))

  return (
    <div className="page">
      <div className="fin-detail-header">
        <button className="fin-back-btn" onClick={onBack}>‹ Back</button>
        <h2 className="section-title">Spending</h2>
        <MonthSelector month={month} onChange={setMonth} />
      </div>

      {/* ── 1. Hero summary card ── */}
      <section className="page-section">
        <div className="card fin-sa-hero">
          <div className="fin-sa-hero-top">
            <div>
              <div className="fin-sa-eyebrow">Spent This Month</div>
              <div className="fin-sa-hero-num">{fmtUSD(spentSoFar)}</div>
            </div>
            {budget > 0 && !budgetEditMode && (
              <button className="fin-sa-link-btn" onClick={() => { setBudgetInput(String(budget)); setBudgetEditMode(true) }}>
                Edit Budget
              </button>
            )}
          </div>

          {budgetEditMode ? (
            <div className="fin-sa-budget-edit-row">
              <input className="fin-budget-input" type="number" placeholder="e.g. 3000" value={budgetInput}
                onChange={e => setBudgetInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveBudget(budgetInput)} autoFocus />
              <SaveBtn onClick={() => saveBudget(budgetInput)} />
              <CancelBtn onClick={() => setBudgetEditMode(false)} />
            </div>
          ) : budget > 0 ? (
            <>
              <div className="fin-sa-budget-bar-track">
                <div className="fin-sa-budget-bar-fill" style={{ width: `${Math.min(pctOfBudget, 100)}%`, background: overBudget ? 'var(--red)' : 'var(--accent)' }} />
              </div>
              <div className="fin-sa-hero-budget-row">
                <span className="fin-sa-muted">Budget {fmtUSD(budget)}</span>
                <span className={overBudget ? 'negative' : 'positive'}>
                  {overBudget ? `${fmtUSD(Math.abs(remaining))} over` : `${fmtUSD(remaining)} left`}
                </span>
              </div>
            </>
          ) : (
            <button className="fin-sa-set-budget-btn" onClick={() => { setBudgetInput(''); setBudgetEditMode(true) }}>+ Set Monthly Budget</button>
          )}

          <div className="fin-sa-hero-stats">
            <div className="fin-sa-hero-stat">
              <span className="fin-sa-hero-stat-label">Burn Rate</span>
              <span className="fin-sa-hero-stat-val">{fmtUSD(dailyRate)}/day</span>
            </div>
            <div className="fin-sa-hero-stat">
              <span className="fin-sa-hero-stat-label">Projected</span>
              <span className="fin-sa-hero-stat-val">{fmtUSD(projected)}</span>
            </div>
            <div className="fin-sa-hero-stat">
              <span className="fin-sa-hero-stat-label">Transactions</span>
              <span className="fin-sa-hero-stat-val">{txCount}</span>
            </div>
            <div className="fin-sa-hero-stat">
              <span className="fin-sa-hero-stat-label">Days Left</span>
              <span className="fin-sa-hero-stat-val">{isCurrentMonth ? daysLeft : '—'}</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── 2. Category Breakdown (pie + legend) ── */}
      {catSorted.length > 0 && (
        <section className="page-section">
          <h2 className="section-title">Category Breakdown</h2>
          <div className="card fin-pie-card">
            <SpendingPieChart
              size={96}
              segments={catSorted.map(([cat, { total }]) => ({
                pct:   spentSoFar > 0 ? (total / spentSoFar) * 100 : 0,
                color: CATEGORY_MAP[cat]?.color || '#888',
              }))}
            />
            <div className="fin-pie-legend">
              {catSorted.map(([cat, { total }]) => {
                const info = CATEGORY_MAP[cat]
                const pct  = spentSoFar > 0 ? (total / spentSoFar) * 100 : 0
                return (
                  <div key={cat} className="fin-pie-legend-row">
                    <div className="fin-pie-dot" style={{ background: info?.color || '#888' }} />
                    <span className="fin-pie-cat">{info?.label || cat}</span>
                    <span className="fin-pie-pct">{pct.toFixed(0)}%</span>
                    <span className="fin-pie-amt">{fmtUSD(total)}</span>
                  </div>
                )
              })}
              <div className="fin-pie-total-row">
                <span>Total</span>
                <span>{fmtUSD(spentSoFar)}</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── 3. Daily Spend chart ── */}
      {chartDays.length > 1 && spentSoFar > 0 && (
        <section className="page-section">
          <h2 className="section-title">Daily Spend</h2>
          <div className="card fin-daily-chart-card">
            <div className="fin-daily-chart">
              {chartDays.map(day => {
                const amt = dailyTotals[day] || 0
                const h   = amt > 0 ? Math.max((amt / maxDay) * 100, 4) : 0
                return (
                  <div key={day} className="fin-daily-bar-wrap" title={`${mo}/${day}: ${fmtUSD(amt)}`}>
                    <div className="fin-daily-bar">
                      <div className="fin-daily-bar-fill" style={{ height: `${h}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="fin-daily-axis">
              <span>{mo}/1</span>
              <span className="fin-sa-muted">Avg {fmtUSD(dailyRate)}/day</span>
              <span>{mo}/{daysInMonth}</span>
            </div>
          </div>
        </section>
      )}

      {/* ── 4. Large Transactions ── */}
      {largeTx.length > 0 && (
        <section className="page-section">
          <h2 className="section-title">Large Transactions</h2>
          <p className="fin-section-note">Above 2× your avg spend ({fmtUSD(avgTx)})</p>
          <div className="card-list">
            {largeTx.map((tx, i) => (
              <TxRow key={tx.transaction_id || tx.id || i} tx={tx} onCategoryChange={onTxCategoryChange} />
            ))}
          </div>
        </section>
      )}

      {/* ── 5. Monthly Comparison ── */}
      {hasCompare && (
        <section className="page-section">
          <h2 className="section-title">vs Last Month</h2>
          <div className="card fin-sa-compare-card">
            <div className="fin-sa-cmp-row">
              <div className="fin-sa-cmp-month">
                <span className="fin-sa-eyebrow">{monthLabel(prevMonthStr(month))}</span>
                <span className="fin-sa-cmp-num">{fmtUSD(lastStats.total)}</span>
              </div>
              <div className="fin-sa-cmp-bars-v">
                {[
                  { val: lastStats.total, dim: true },
                  { val: spentSoFar, dim: false },
                ].map(({ val, dim }, i) => {
                  const maxV = Math.max(lastStats.total, spentSoFar, 1)
                  return (
                    <div key={i} className="fin-sa-cmp-bar-v-wrap">
                      <div className="fin-sa-cmp-bar-v-track">
                        <div className="fin-sa-cmp-bar-v-fill" style={{ height: `${(val / maxV) * 100}%`, background: dim ? 'rgba(255,255,255,0.15)' : 'var(--accent)' }} />
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="fin-sa-cmp-month fin-sa-cmp-month--right">
                <span className="fin-sa-eyebrow">{monthLabel(month)}</span>
                <span className="fin-sa-cmp-num">{fmtUSD(spentSoFar)}</span>
              </div>
            </div>
            <div className={`fin-sa-cmp-delta-row ${monthDelta >= 0 ? 'negative' : 'positive'}`}>
              {monthDelta >= 0 ? '▲ ' : '▼ '}{fmtUSD(Math.abs(monthDelta))} {monthDelta >= 0 ? 'more than last month' : 'less than last month'}
            </div>
          </div>
        </section>
      )}

      {/* ── 5. Top Merchants ── */}
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
                      <span className="fin-merchant-meta">{info?.icon} {info?.label || cat}{count > 1 && ` · ${count}×`}</span>
                    </div>
                  </div>
                  <span className="fin-merchant-amt">{fmtUSD(total)}</span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── 6. Transfers (collapsible) ── */}
      {excludedTx.length > 0 && (
        <section className="page-section">
          <h2 className="section-title fin-transfers-toggle" onClick={() => setShowTransfers(t => !t)}>
            Transfers & Excluded
            <span className="fin-transfers-count">{excludedTx.length}</span>
            <span className="fin-transfers-chevron">{showTransfers ? '∨' : '›'}</span>
          </h2>
          {showTransfers && (
            <>
              <p className="fin-section-note">Not counted in spending totals</p>
              <div className="card-list">
                {excludedTx.slice(0, 25).map((tx, i) => (
                  <TxRow key={tx.transaction_id || tx.id || i} tx={tx} onCategoryChange={onTxCategoryChange} />
                ))}
              </div>
            </>
          )}
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

// ── Spending Shell (chart views inside the Spent row) ────────────────────────

function FinSpendingShell({ summary, transactions, lastMonthTransactions, month, setMonth, yearData, onTxCategoryChange, onBack }) {
  const [spendView, setSpendView] = useState('dashboard')

  return (
    <div className="fin-shell">
      <div className="fin-top-bar">
        <button className="fin-back-btn" onClick={onBack}>‹ Back</button>
        <MonthBar selectedMonth={month} onSelect={setMonth} />
      </div>
      <FinNav view={spendView} onView={setSpendView} />
      <div className="fin-content">
        {spendView === 'dashboard' && (
          <FinDashboardView
            summary={summary}
            transactions={transactions}
            yearData={yearData}
            month={month}
            onView={setSpendView}
          />
        )}
        {spendView === 'budgeting' && (
          <FinBudgetingView
            transactions={transactions}
            lastMonthTransactions={lastMonthTransactions}
            month={month}
            yearData={yearData}
            onTxCategoryChange={onTxCategoryChange}
          />
        )}
        {spendView === 'expenses' && (
          <FinExpensesView transactions={transactions} />
        )}
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function Finance() {
  const data    = useFinanceData()
  const snap    = useSnaptradeData()
  useSubscriptions() // keep detection running
  const yearData = useYearData()

  const [view,     setView]     = useState('home')
  const [toast,    setToast]    = useState(null)
  const [addMenu,  setAddMenu]  = useState(false)
  const addMenuRef = useRef(null)

  useEffect(() => {
    if (!addMenu) return
    const handler = (e) => { if (addMenuRef.current && !addMenuRef.current.contains(e.target)) setAddMenu(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [addMenu])

  const showToast = useCallback((msg, type = 'success') => setToast({ message: msg, type }), [])

  const { open: openTeller, ready: tellerReady } = useTellerConnect({
    onSuccess: async (result) => { await data.onTellerSuccess(result); showToast('Account linked!') },
    onError:   (msg) => showToast(msg, 'error'),
  })

  const handleSync = async () => {
    try {
      await Promise.allSettled([data.sync(), snap.afterConnect(data.load)])
      showToast('Synced successfully!')
    } catch (err) { showToast(err.message, 'error') }
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

  if (data.loading && !data.summary) {
    return <div className="page"><div className="fin-loading">Loading…</div></div>
  }

  // ── Full-screen breakouts ──
  if (view === 'manage') return (
    <ManageAccounts enrollments={data.enrollments}
      onDisconnect={data.disconnect} onDisconnectAll={data.disconnectAll}
      investmentAccounts={data.summary?.investments?.accounts || []}
      onDisconnectSnap={() => snap.disconnect(data.load)}
      onBack={() => setView('home')} />
  )
  if (view === 'cash') return (
    <CashDetail summary={data.summary} transactions={data.transactions}
      month={data.month} setMonth={data.setMonth}
      onCategoryChange={data.updateAccountCategory}
      onTxCategoryChange={data.updateTransactionCategory}
      onBack={() => setView('home')} />
  )
  if (view === 'credit') return (
    <CreditDetail summary={data.summary} transactions={data.transactions}
      month={data.month} setMonth={data.setMonth}
      onCategoryChange={data.updateAccountCategory}
      onTxCategoryChange={data.updateTransactionCategory}
      onBack={() => setView('home')} />
  )
  if (view === 'investments') return (
    <InvestmentsDetail
      summary={data.summary}
      snap={snap}
      onReload={data.load}
      onBack={() => setView('home')} />
  )
  if (view === 'transactions') return (
    <AllTransactions
      transactions={data.transactions}
      summary={data.summary}
      month={data.month}
      setMonth={data.setMonth}
      onTxCategoryChange={data.updateTransactionCategory}
      onBack={() => setView('home')} />
  )
  if (view === 'spending') return (
    <FinSpendingShell
      summary={data.summary}
      transactions={data.transactions}
      lastMonthTransactions={data.lastMonthTransactions}
      month={data.month}
      setMonth={data.setMonth}
      yearData={yearData}
      onTxCategoryChange={data.updateTransactionCategory}
      onBack={() => setView('home')} />
  )

  // ── Home dashboard ──
  const netWorth = (data.summary?.cash?.total || 0)
    - (data.summary?.credit?.total || 0)
    + (data.summary?.investments?.total || 0)
  const spendStats = computeSpendStats(data.transactions)
  const txCount    = data.transactions.length

  return (
    <div className="fin-home">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Toolbar */}
      <div className="fin-toolbar">
        <span className="fin-toolbar-title">Finance</span>
        <div className="fin-toolbar-actions">
          <button className="fin-icon-btn" onClick={handleSync}
            disabled={data.syncing || snap.snapLoading} title="Sync">
            {data.syncing || snap.snapLoading ? '⟳' : '↻'}
          </button>
          <div style={{ position: 'relative' }} ref={addMenuRef}>
            <button className="fin-icon-btn" onClick={() => setAddMenu(m => !m)}
              disabled={!tellerReady} title="Add account">+</button>
            {addMenu && (
              <div className="fin-add-menu">
                <button onClick={() => { setAddMenu(false); openTeller() }}>🏦 Bank / Credit Card</button>
                <button onClick={() => { setAddMenu(false); snap.connect(); showToast('After connecting, tap Sync.') }}>
                  📈 Investment Account
                </button>
              </div>
            )}
          </div>
          <button className="fin-icon-btn" onClick={() => setView('manage')} title="Manage accounts">⚙</button>
        </div>
      </div>

      {data.error && (
        <div className="fin-error-banner">
          {data.error}
          <button onClick={() => data.setError(null)}>×</button>
        </div>
      )}

      <div className="fin-home-body">
        {/* Net Worth Hero */}
        <div className="fin-nw-hero">
          <div className="fin-nw-hero-label">Net Worth</div>
          <div className="fin-nw-hero-value">{fmtUSD(netWorth)}</div>
          <div className="fin-nw-hero-sub">
            {(data.summary?.cash?.accounts?.length || 0) + (data.summary?.credit?.accounts?.length || 0)} accounts connected
          </div>
        </div>

        {/* Summary rows */}
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
              <span className="fin-sr-value">{fmtUSD(data.summary?.cash?.total || 0)}</span>
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
              <span className="fin-sr-value fin-sr-value--red">{fmtUSD(data.summary?.credit?.total || 0)}</span>
              <span className="fin-sr-arrow">›</span>
            </div>
          </button>

          <button className="fin-summary-row fin-summary-row--green" onClick={() => setView('investments')}>
            <div className="fin-sr-left">
              <span className="fin-sr-icon">📈</span>
              <div className="fin-sr-info">
                <span className="fin-sr-label">Investments</span>
                <span className="fin-sr-sub">{data.summary?.investments?.accounts?.length || 0} accounts</span>
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
                <span className="fin-sr-sub">{spendStats.txCount} transactions this month</span>
              </div>
            </div>
            <div className="fin-sr-right">
              <span className="fin-sr-value fin-sr-value--red">{fmtUSD(spendStats.total)}</span>
              <span className="fin-sr-arrow">›</span>
            </div>
          </button>

          <button className="fin-summary-row" onClick={() => setView('transactions')}>
            <div className="fin-sr-left">
              <span className="fin-sr-icon">📋</span>
              <div className="fin-sr-info">
                <span className="fin-sr-label">Transactions</span>
                <span className="fin-sr-sub">{txCount} this month</span>
              </div>
            </div>
            <div className="fin-sr-right">
              <span className="fin-sr-arrow">›</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}
