import { useState, useEffect, useCallback } from 'react'
import { usePlaidLink } from 'react-plaid-link'
import './Page.css'
import './Finance.css'

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_COLORS = {
  food:          '#f0a500',
  subscriptions: '#7c6fff',
  shopping:      '#4ab8d4',
  health:        '#e05c5c',
  transport:     '#ff2d78',
  utilities:     '#00e5ff',
  entertainment: '#bf5fff',
  income:        '#00ff9d',
  other:         '#6a6a6a',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtUSD(n) {
  return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date()
  const today = d.toISOString().slice(0, 10)
  d.setDate(d.getDate() - 1)
  const yesterday = d.toISOString().slice(0, 10)
  if (dateStr === today) return 'Today'
  if (dateStr === yesterday) return 'Yesterday'
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─── localStorage cache ───────────────────────────────────────────────────────

function usePlaidData() {
  const [items, setItems] = useState(() => {
    try { return JSON.parse(localStorage.getItem('aaron_plaid_items') || '[]') }
    catch { return [] }
  })
  const [accounts, setAccounts] = useState(() => {
    try { return JSON.parse(localStorage.getItem('aaron_plaid_accounts') || '[]') }
    catch { return [] }
  })
  const [transactions, setTransactions] = useState(() => {
    try { return JSON.parse(localStorage.getItem('aaron_plaid_transactions') || '[]') }
    catch { return [] }
  })

  useEffect(() => { localStorage.setItem('aaron_plaid_items',        JSON.stringify(items))        }, [items])
  useEffect(() => { localStorage.setItem('aaron_plaid_accounts',     JSON.stringify(accounts))     }, [accounts])
  useEffect(() => { localStorage.setItem('aaron_plaid_transactions', JSON.stringify(transactions)) }, [transactions])

  const linked = items.length > 0

  // On mount, check server for existing connections (handles cross-device sync)
  useEffect(() => {
    if (items.length > 0) return // already have cached data
    fetch('/api/status')
      .then(r => r.json())
      .then(d => {
        if (d.linked) {
          return fetch('/api/sync').then(r => r.json()).then(data => {
            setItems(data.items || [])
            setAccounts(data.accounts || [])
            setTransactions(data.transactions || [])
          })
        }
      })
      .catch(() => {})
  }, []) // eslint-disable-line

  const onPlaidSuccess = (data) => {
    setItems(data.items || [])
    setAccounts(data.accounts || [])
    setTransactions(data.transactions || [])
  }

  const refresh = async () => {
    const res = await fetch('/api/sync')
    if (!res.ok) throw new Error('Sync failed')
    const data = await res.json()
    setItems(data.items || [])
    setAccounts(data.accounts || [])
    setTransactions(data.transactions || [])
  }

  const disconnectItem = async (itemId) => {
    await fetch(`/api/plaid/item/${itemId}`, { method: 'DELETE' })
    const updatedItems = items.filter(i => i.item_id !== itemId)
    setItems(updatedItems)
    setAccounts(prev => prev.filter(a => a.item_id !== itemId))
    setTransactions(prev => prev.filter(t => t.item_id !== itemId))
  }

  const disconnectAll = async () => {
    await fetch('/api/plaid/disconnect-all', { method: 'DELETE' })
    setItems([])
    setAccounts([])
    setTransactions([])
    localStorage.removeItem('aaron_plaid_items')
    localStorage.removeItem('aaron_plaid_accounts')
    localStorage.removeItem('aaron_plaid_transactions')
  }

  return { linked, items, accounts, transactions, onPlaidSuccess, refresh, disconnectItem, disconnectAll }
}

// ─── Plaid Link hook ──────────────────────────────────────────────────────────

function usePlaidConnector(onSuccess) {
  const [linkToken, setLinkToken] = useState(null)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState(null)

  const fetchLinkToken = useCallback(() => {
    setError(null)
    fetch('/api/create-link-token', { method: 'POST' })
      .then(r => r.json())
      .then(d => d.error ? setError(d.error) : setLinkToken(d.link_token))
      .catch(() => setError('Could not reach server. Make sure the backend is running.'))
  }, [])

  useEffect(() => { fetchLinkToken() }, [fetchLinkToken])

  const handleSuccess = useCallback(async (publicToken) => {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch('/api/exchange-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ public_token: publicToken }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      // Refresh link token for next use
      setLinkToken(null)
      fetchLinkToken()
      onSuccess(data)
    } catch (err) {
      setError(err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }, [onSuccess, fetchLinkToken])

  const { open, ready } = usePlaidLink({ token: linkToken, onSuccess: handleSuccess })

  const openLink = () => {
    if (!linkToken) { setError('Still loading — try again in a second'); return }
    open()
  }

  return { openLink, ready: ready && !!linkToken, loading, error, clearError: () => setError(null) }
}

// ─── Monthly Spending Breakdown ────────────────────────────────────────────────

function SpendingBreakdown({ transactions }) {
  const now = new Date()
  const monthStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`
  const monthExpenses = transactions.filter(tx => tx.date?.startsWith(monthStr) && tx.amount < 0)
  const total = monthExpenses.reduce((s, t) => s - t.amount, 0)
  if (total === 0) return null

  const byCategory = {}
  for (const tx of monthExpenses) {
    const c = tx.category || 'other'
    byCategory[c] = (byCategory[c] || 0) - tx.amount
  }
  const sorted = Object.entries(byCategory).sort((a, b) => b[1] - a[1])

  return (
    <section className="page-section">
      <h2 className="section-title">This Month</h2>
      <div className="card spending-card">
        <div className="spending-header">
          <span className="spending-label">Total Spent</span>
          <span className="spending-total">{fmtUSD(total)}</span>
        </div>
        <div className="spending-bars">
          {sorted.map(([cat, amt]) => (
            <div key={cat} className="spending-row">
              <div className="spending-row-top">
                <div className="spending-cat">
                  <span className="tx-dot" style={{ background: CATEGORY_COLORS[cat] || '#6a6a6a' }} />
                  <span className="spending-cat-name">{cat}</span>
                </div>
                <span className="spending-amt">{fmtUSD(amt)}</span>
              </div>
              <div className="spending-track">
                <div className="spending-fill" style={{ width: `${(amt / total) * 100}%`, background: CATEGORY_COLORS[cat] || '#6a6a6a' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Finance() {
  const { linked, items, accounts, transactions, onPlaidSuccess, refresh, disconnectItem, disconnectAll } = usePlaidData()
  const { openLink, loading: linkLoading, error: linkError, clearError } = usePlaidConnector(onPlaidSuccess)
  const [syncing, setSyncing] = useState(false)

  const handleRefresh = async () => {
    setSyncing(true)
    try { await refresh() } catch { /* ignore */ }
    finally { setSyncing(false) }
  }

  // ── Not linked: show connect screen ──
  if (!linked) {
    return (
      <div className="connect-screen">
        <div className="connect-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="5" width="20" height="14" rx="2"/>
            <line x1="2" y1="10" x2="22" y2="10"/>
          </svg>
        </div>
        <h2 className="connect-title">Link Your Bank</h2>
        <p className="connect-sub">Connect your accounts via Plaid to automatically sync balances and transactions.</p>
        {linkError && <p className="connect-error">{linkError}</p>}
        <button className="connect-btn" onClick={() => { clearError(); openLink() }} disabled={linkLoading}>
          {linkLoading ? 'Loading…' : 'Connect with Plaid'}
        </button>
        <p className="connect-note">Plaid uses bank-level encryption. Your credentials are never stored here.</p>
      </div>
    )
  }

  // ── Linked: show dashboard ──
  const netWorth = accounts.reduce((sum, a) =>
    a.type === 'credit' ? sum - a.balance : sum + a.balance, 0)

  const now = new Date()
  const monthStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`
  const monthlyChange = transactions
    .filter(tx => tx.date?.startsWith(monthStr))
    .reduce((s, t) => s + t.amount, 0)

  const sortedTx = [...transactions].sort((a, b) => (b.date || '').localeCompare(a.date || ''))

  return (
    <div className="page">

      {/* Net Worth */}
      <section className="page-section">
        <div className="card net-worth-card">
          <span className="nw-label">Net Worth</span>
          <span className="nw-value">${netWorth.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
          {monthlyChange !== 0 && (
            <span className={`nw-change ${monthlyChange >= 0 ? 'positive' : 'negative'}`}>
              {monthlyChange >= 0 ? '+' : ''}{fmtUSD(monthlyChange)} this month
            </span>
          )}
        </div>
      </section>

      {/* Connected banks */}
      <section className="page-section">
        <div className="section-header">
          <h2 className="section-title">Connected Banks</h2>
          <div className="header-actions">
            {syncing
              ? <span className="syncing-label">Syncing…</span>
              : <button className="action-btn" onClick={handleRefresh}>Sync</button>
            }
            <button className="action-btn add-bank-btn" onClick={openLink} disabled={linkLoading}>
              + Add Bank
            </button>
          </div>
        </div>
        <div className="card-list">
          {items.map(item => (
            <div key={item.item_id} className="card bank-row">
              <div className="bank-left">
                <span className="bank-dot" />
                <span className="bank-name">{item.institution_name}</span>
                <span className="bank-count">
                  {accounts.filter(a => a.item_id === item.item_id).length} accounts
                </span>
              </div>
              <button className="remove-btn" onClick={() => disconnectItem(item.item_id)}>
                Remove
              </button>
            </div>
          ))}
        </div>
        {linkError && <p className="link-error">{linkError}</p>}
      </section>

      {/* Accounts */}
      <section className="page-section">
        <h2 className="section-title">Accounts</h2>
        <div className="card-list">
          {accounts.map((acc, i) => (
            <div key={acc.id || i} className="card row-card">
              <div className="acc-left">
                <span className={`acc-icon ${acc.type}`} />
                <div className="acc-info">
                  <span className="acc-name">{acc.name}</span>
                  {acc.mask && <span className="acc-mask">•••• {acc.mask}</span>}
                </div>
              </div>
              <span className="acc-balance">
                {acc.type === 'credit' ? '-' : ''}{fmtUSD(acc.balance)}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Monthly spending */}
      <SpendingBreakdown transactions={transactions} />

      {/* Transactions */}
      <section className="page-section">
        <h2 className="section-title">Transactions</h2>
        <div className="card-list">
          {sortedTx.map((tx, i) => (
            <div key={tx.id || i} className="card tx-row">
              <div className="tx-dot" style={{ background: CATEGORY_COLORS[tx.category] || '#6a6a6a' }} />
              <div className="tx-info">
                <span className="tx-name">{tx.name}</span>
                <span className="tx-date">{formatDate(tx.date)}</span>
              </div>
              <span className={`tx-amount ${tx.amount > 0 ? 'positive' : 'negative'}`}>
                {tx.amount > 0 ? '+' : ''}{fmtUSD(tx.amount)}
              </span>
            </div>
          ))}
          {transactions.length === 0 && (
            <div className="empty-state">
              No transactions yet — Plaid may still be loading them.{' '}
              <button className="inline-sync-btn" onClick={handleRefresh}>Try syncing</button>
            </div>
          )}
        </div>
      </section>

    </div>
  )
}
