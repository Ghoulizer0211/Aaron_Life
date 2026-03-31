import { getSupabase, nextMonthStart } from './_lib/supabase.js'

export default async function handler(req, res) {
  const [path, query] = req.url.split('?')
  const parts = path.split('/').filter(Boolean)
  // parts: ['api', 'finance', sub, id?]
  const sub = parts[2]
  const id  = parts[3]

  const supabase = getSupabase()
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured' })

  // GET /api/finance/summary
  if (sub === 'summary' && req.method === 'GET') {
    const month = req.query.month || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }).slice(0, 7)
    const empty = { cash: { total: 0, accounts: [] }, credit: { total: 0, accounts: [] }, investments: { total: 0, accounts: [] }, spending: { total: 0, income: 0, expenses: 0, surplus: 0, beginning_balance: null, current_balance: 0, month } }
    try {
      const [accRes, txRes] = await Promise.all([
        supabase.from('bank_accounts').select('*'),
        supabase.from('bank_transactions').select('*').gte('date', `${month}-01`).lt('date', nextMonthStart(month)),
      ])
      if (accRes.error) throw accRes.error

      const accounts     = accRes.data || []
      const transactions = txRes.data  || []
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

      let beginningBalance = null, beginningEstimated = false
      const { data: snaps } = await supabase.from('balance_snapshots')
        .select('account_id, balance, snapshot_date')
        .gte('snapshot_date', `${month}-01`).lte('snapshot_date', `${month}-07`)
        .order('snapshot_date', { ascending: true })
      if (snaps && snaps.length > 0) {
        const earliest = {}
        for (const s of snaps) {
          if (cashIds.has(s.account_id) && !earliest[s.account_id]) earliest[s.account_id] = parseFloat(s.balance)
        }
        beginningBalance = Object.values(earliest).reduce((s, b) => s + b, 0)
      }
      if (beginningBalance == null) { beginningBalance = cashTotal - income + expenses; beginningEstimated = true }

      return res.json({
        cash:        { total: cashTotal,   accounts: cashAccounts },
        credit:      { total: creditTotal, accounts: creditAccounts },
        investments: { total: investTotal, accounts: investAccounts },
        spending:    { total: expenses, income, expenses, surplus, beginning_balance: beginningBalance, beginning_estimated: beginningEstimated, current_balance: cashTotal, month },
      })
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }

  // GET /api/finance/transactions
  if (sub === 'transactions' && !id && req.method === 'GET') {
    try {
      const { month, accountId, limit = 500 } = req.query
      let q = supabase.from('bank_transactions').select('*').order('date', { ascending: false }).limit(Number(limit))
      if (month)     q = q.gte('date', `${month}-01`).lt('date', nextMonthStart(month))
      if (accountId) q = q.eq('account_id', accountId)
      const { data, error } = await q
      if (error) throw error
      return res.json(data || [])
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }

  // PATCH /api/finance/transactions/:id
  if (sub === 'transactions' && id && req.method === 'PATCH') {
    const { category, note } = req.body || {}
    if (!category || typeof category !== 'string') return res.status(400).json({ error: 'category is required' })
    const update = { category }
    if (typeof note === 'string') update.note = note
    const { data, error } = await supabase.from('bank_transactions').update(update)
      .eq('transaction_id', id).select('transaction_id, category')
    if (error) return res.status(500).json({ error: error.message })
    if (!data || data.length === 0) return res.status(404).json({ error: `No transaction found: ${id}` })
    return res.json({ success: true, updated: data[0] })
  }

  // GET /api/finance/accounts
  if (sub === 'accounts' && !id && req.method === 'GET') {
    const { data, error } = await supabase.from('bank_accounts').select('*').order('institution_name')
    if (error) return res.status(500).json({ error: error.message })
    return res.json(data || [])
  }

  // PATCH /api/finance/accounts/:id
  if (sub === 'accounts' && id && req.method === 'PATCH') {
    const { category_group } = req.body || {}
    if (!category_group) return res.status(400).json({ error: 'category_group required' })
    const { error } = await supabase.from('bank_accounts').update({ category_group }).eq('account_id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ success: true })
  }

  res.status(404).json({ error: 'Not found' })
}
