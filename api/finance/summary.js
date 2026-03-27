import { getSupabase, nextMonthStart } from '../_lib/supabase.js'

export default async function handler(req, res) {
  const supabase = getSupabase()
  const now = new Date()
  const month = req.query.month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const empty = { cash: { total: 0, accounts: [] }, credit: { total: 0, accounts: [] }, investments: { total: 0, accounts: [] }, spending: { total: 0, income: 0, expenses: 0, surplus: 0, beginning_balance: null, current_balance: 0, month } }

  if (!supabase) return res.json(empty)

  try {
    const [accRes, txRes] = await Promise.all([
      supabase.from('bank_accounts').select('*'),
      supabase.from('bank_transactions').select('*').gte('date', `${month}-01`).lt('date', nextMonthStart(month)),
    ])
    if (accRes.error) throw accRes.error

    const accounts     = accRes.data || []
    const transactions = txRes.data || []

    const cashAccounts   = accounts.filter(a => a.category_group === 'cash')
    const creditAccounts = accounts.filter(a => a.category_group === 'credit')
    const investAccounts = accounts.filter(a => a.category_group === 'investments')

    const cashTotal   = cashAccounts.reduce((s, a)   => s + (parseFloat(a.current_balance) || 0), 0)
    const creditTotal = creditAccounts.reduce((s, a) => s + (parseFloat(a.current_balance) || 0), 0)
    const investTotal = investAccounts.reduce((s, a) => s + (parseFloat(a.current_balance) || 0), 0)

    const cashIds = new Set(cashAccounts.map(a => a.account_id))
    const cashTx  = transactions.filter(tx => cashIds.has(tx.account_id) && !tx.is_transfer)

    const EXCLUDE = new Set(['transfer', 'investing'])
    const income   = cashTx.filter(t => parseFloat(t.amount) > 0 && t.category !== 'transfer').reduce((s, t) => s + parseFloat(t.amount), 0)
    const expenses = cashTx.filter(t => parseFloat(t.amount) < 0 && !EXCLUDE.has(t.category)).reduce((s, t) => s + Math.abs(parseFloat(t.amount)), 0)
    const surplus  = income - expenses

    // Beginning of month balance from snapshots
    let beginningBalance  = null
    let beginningEstimated = false
    const { data: snaps } = await supabase
      .from('balance_snapshots')
      .select('account_id, balance, snapshot_date')
      .gte('snapshot_date', `${month}-01`)
      .lte('snapshot_date', `${month}-07`)
      .order('snapshot_date', { ascending: true })

    if (snaps && snaps.length > 0) {
      const earliest = {}
      for (const s of snaps) {
        if (cashIds.has(s.account_id) && !earliest[s.account_id]) {
          earliest[s.account_id] = parseFloat(s.balance)
        }
      }
      beginningBalance = Object.values(earliest).reduce((s, b) => s + b, 0)
    }
    if (beginningBalance == null) {
      beginningBalance   = cashTotal - income + expenses
      beginningEstimated = true
    }

    res.json({
      cash:        { total: cashTotal,   accounts: cashAccounts },
      credit:      { total: creditTotal, accounts: creditAccounts },
      investments: { total: investTotal, accounts: investAccounts },
      spending: {
        total:               expenses,
        income,
        expenses,
        surplus,
        beginning_balance:   beginningBalance,
        beginning_estimated: beginningEstimated,
        current_balance:     cashTotal,
        month,
      },
    })
  } catch (err) {
    console.error('[vercel/finance/summary]', err.message)
    res.status(500).json({ error: err.message })
  }
}
