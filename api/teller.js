import { getSupabase } from './_lib/supabase.js'
import { getTellerCreds, tellerFetch, mapTellerCategory, defaultCategory } from './_lib/teller.js'

// ── Lightweight incremental sync (used by Vercel) ─────────────────────────────
// Reads accounts already in Supabase, refreshes balances, and fetches only
// new transactions since each account's last_synced_at date.
async function incrementalSync(supabase, creds) {
  const { data: connections } = await supabase
    .from('bank_connections').select('enrollment_id, institution_name, access_token')
  if (!connections?.length) return { enrollments: [], accounts: [], transactions: [] }

  const { data: storedAccounts } = await supabase
    .from('bank_accounts').select('*').not('enrollment_id', 'is', null)
  if (!storedAccounts?.length) return { enrollments: [], accounts: [], transactions: [] }

  const tokenMap = Object.fromEntries(connections.map(c => [c.enrollment_id, c.access_token]))
  const today    = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
  const allAccounts = [], allTransactions = []

  // Batch in groups of 4: each account = 2 requests (balance + transactions)
  const BATCH = 4
  for (let i = 0; i < storedAccounts.length; i += BATCH) {
    const batch = storedAccounts.slice(i, i + BATCH)
    const results = await Promise.allSettled(batch.map(async (acc) => {
      const token = tokenMap[acc.enrollment_id]
      if (!token) return null

      // Fetch balance + transactions since last sync in parallel
      const lastDate = acc.last_synced_at
        ? new Date(acc.last_synced_at).toISOString().slice(0, 10)
        : '2026-01-01'

      const [balResult, txResult] = await Promise.allSettled([
        tellerFetch(`/accounts/${acc.account_id}/balances`, token, creds),
        tellerFetch(`/accounts/${acc.account_id}/transactions?count=100`, token, creds),
      ])

      let currentBalance = parseFloat(acc.current_balance) || 0
      let availableBalance = parseFloat(acc.available_balance) || 0
      if (balResult.status === 'fulfilled') {
        const bal = balResult.value
        currentBalance   = parseFloat(bal.ledger    ?? bal.current  ?? 0)
        availableBalance = parseFloat(bal.available ?? bal.ledger   ?? 0)
      }

      const isCreditCard = acc.type === 'credit' || acc.subtype === 'credit_card'
      let txObjs = []
      if (txResult.status === 'fulfilled') {
        txObjs = txResult.value
          .filter(tx => tx.date >= lastDate)
          .map(tx => ({
            transaction_id: tx.id,
            account_id:     tx.account_id,
            date:           tx.date,
            description:    tx.description,
            amount:         isCreditCard ? -parseFloat(tx.amount) : parseFloat(tx.amount),
            category:       mapTellerCategory(tx.details?.category),
            pending:        tx.status === 'pending',
            is_transfer:    tx.details?.category?.toLowerCase().includes('transfer') || false,
          }))
      }

      return { acc, currentBalance, availableBalance, txObjs }
    }))

    for (const r of results) {
      if (r.status !== 'fulfilled' || !r.value) continue
      const { acc, currentBalance, availableBalance, txObjs } = r.value

      const updated = { ...acc, current_balance: currentBalance, available_balance: availableBalance, last_synced_at: new Date().toISOString() }
      allAccounts.push(updated)
      await supabase.from('bank_accounts').upsert(updated, { onConflict: 'account_id' })
      await supabase.from('balance_snapshots').upsert(
        { account_id: acc.account_id, balance: currentBalance, snapshot_date: today },
        { onConflict: 'account_id,snapshot_date' }
      )

      if (txObjs.length > 0) {
        const { data: existing } = await supabase
          .from('bank_transactions').select('transaction_id')
          .in('transaction_id', txObjs.map(t => t.transaction_id))
        const existingIds = new Set((existing || []).map(r => r.transaction_id))
        const newRows     = txObjs.filter(t => !existingIds.has(t.transaction_id))
        const updatedRows = txObjs.filter(t => existingIds.has(t.transaction_id)).map(({ category: _c, ...t }) => t)
        if (newRows.length > 0)     await supabase.from('bank_transactions').insert(newRows)
        if (updatedRows.length > 0) await supabase.from('bank_transactions').upsert(updatedRows, { onConflict: 'transaction_id' })
        allTransactions.push(...txObjs)
      }
    }
  }

  return {
    enrollments:  connections.map(c => ({ enrollmentId: c.enrollment_id, institutionName: c.institution_name })),
    accounts:     allAccounts,
    transactions: allTransactions,
  }
}

// ── Full sync (used only on enroll) ───────────────────────────────────────────
// Fetches all accounts from Teller and all transactions from 2026-01-01.
async function fullSync(supabase, creds, preFetched = {}) {
  const { data: connections, error } = await supabase
    .from('bank_connections').select('enrollment_id, institution_name, access_token')
  if (error) throw new Error(error.message)
  if (!connections?.length) return { enrollments: [], accounts: [], transactions: [] }

  const existingCategories = {}
  const { data: existingAccs } = await supabase.from('bank_accounts').select('account_id, category_group')
  for (const a of (existingAccs || [])) existingCategories[a.account_id] = a.category_group

  const today = new Date().toISOString().slice(0, 10)
  const allAccounts = [], allTransactions = []

  for (const conn of connections) {
    const { enrollment_id, institution_name, access_token } = conn
    try {
      const rawAccounts = preFetched[enrollment_id]
        || await tellerFetch('/accounts', access_token, creds)

      await supabase.from('bank_connections').upsert(
        { enrollment_id, institution_name, access_token, last_synced_at: new Date().toISOString() },
        { onConflict: 'enrollment_id' }
      )

      const BATCH = 4
      const results = []
      for (let i = 0; i < rawAccounts.length; i += BATCH) {
        const batch = rawAccounts.slice(i, i + BATCH)
        const batchResults = await Promise.allSettled(batch.map(async (acc) => {
          const [balResult, txResult] = await Promise.allSettled([
            tellerFetch(`/accounts/${acc.id}/balances`, access_token, creds),
            tellerFetch(`/accounts/${acc.id}/transactions`, access_token, creds),
          ])

          let currentBalance = 0, availableBalance = 0
          if (balResult.status === 'fulfilled') {
            const bal = balResult.value
            currentBalance   = parseFloat(bal.ledger    ?? bal.current  ?? 0)
            availableBalance = parseFloat(bal.available ?? bal.ledger   ?? 0)
          }

          const stored = existingCategories[acc.id]
          const category_group = (stored && !(stored === 'cash' && acc.type === 'credit'))
            ? stored : defaultCategory(acc.type)

          const accountObj = {
            account_id: acc.id, enrollment_id, account_name: acc.name,
            type: acc.type, subtype: acc.subtype || acc.type, category_group,
            current_balance: currentBalance, available_balance: availableBalance,
            last_four: acc.last_four, institution_name, last_synced_at: new Date().toISOString(),
          }

          let txObjs = []
          if (txResult.status === 'fulfilled') {
            const isCreditCard = acc.type === 'credit' || acc.subtype === 'credit_card'
            txObjs = txResult.value
              .filter(tx => tx.date >= '2026-01-01')
              .map(tx => ({
                transaction_id: tx.id, account_id: tx.account_id, date: tx.date,
                description: tx.description,
                amount: isCreditCard ? -parseFloat(tx.amount) : parseFloat(tx.amount),
                category: mapTellerCategory(tx.details?.category),
                pending: tx.status === 'pending',
                is_transfer: tx.details?.category?.toLowerCase().includes('transfer') || false,
              }))
          }

          return { accountObj, txObjs, accId: acc.id, currentBalance }
        }))
        results.push(...batchResults)
      }

      for (const r of results) {
        if (r.status !== 'fulfilled') continue
        const { accountObj, txObjs, accId, currentBalance } = r.value
        allAccounts.push(accountObj)
        await supabase.from('bank_accounts').upsert(accountObj, { onConflict: 'account_id' })
        await supabase.from('balance_snapshots').upsert(
          { account_id: accId, balance: currentBalance, snapshot_date: today },
          { onConflict: 'account_id,snapshot_date' }
        )
        if (txObjs.length > 0) {
          const { data: existing } = await supabase
            .from('bank_transactions').select('transaction_id')
            .in('transaction_id', txObjs.map(t => t.transaction_id))
          const existingIds = new Set((existing || []).map(r => r.transaction_id))
          const newRows     = txObjs.filter(t => !existingIds.has(t.transaction_id))
          const updatedRows = txObjs.filter(t => existingIds.has(t.transaction_id)).map(({ category: _c, ...t }) => t)
          if (newRows.length > 0)     await supabase.from('bank_transactions').insert(newRows)
          if (updatedRows.length > 0) await supabase.from('bank_transactions').upsert(updatedRows, { onConflict: 'transaction_id' })
          allTransactions.push(...txObjs)
        }
      }
    } catch (e) { console.error(`[teller] enrollment ${enrollment_id} failed:`, e.message) }
  }

  return {
    enrollments: connections.map(c => ({ enrollmentId: c.enrollment_id, institutionName: c.institution_name })),
    accounts:    allAccounts,
    transactions: allTransactions,
  }
}

export default async function handler(req, res) {
  const parts = req.url.split('?')[0].split('/').filter(Boolean)
  // parts: ['api', 'teller', sub, id?]
  const sub = parts[2]
  const id  = parts[3]

  const supabase = getSupabase()

  // GET /api/teller/status
  if (sub === 'status' && req.method === 'GET') {
    if (!supabase) return res.json({ linked: false, count: 0 })
    const { count } = await supabase.from('bank_connections').select('*', { count: 'exact', head: true })
    return res.json({ linked: (count || 0) > 0, count: count || 0 })
  }

  // GET /api/teller/sync — incremental: refresh balances + new transactions only
  if (sub === 'sync' && req.method === 'GET') {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' })
    let creds
    try { creds = getTellerCreds() } catch (e) { return res.status(500).json({ error: e.message }) }
    try {
      const data = await incrementalSync(supabase, creds)
      if (data.enrollments.length === 0) return res.status(404).json({ error: 'No enrollments linked' })
      return res.json(data)
    } catch (e) { return res.status(500).json({ error: e.message }) }
  }

  // POST /api/teller/enroll — full sync for new enrollment
  if (sub === 'enroll' && req.method === 'POST') {
    const { accessToken, enrollment } = req.body || {}
    if (!accessToken) return res.status(400).json({ error: 'accessToken required' })
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' })
    let creds
    try { creds = getTellerCreds() } catch (e) { return res.status(500).json({ error: e.message }) }
    try {
      const accounts        = await tellerFetch('/accounts', accessToken, creds)
      const institutionName = accounts[0]?.institution?.name || 'Connected Bank'
      const enrollmentId    = enrollment?.id || accessToken.slice(0, 16)
      await supabase.from('bank_connections').upsert({
        enrollment_id: enrollmentId, institution_name: institutionName,
        access_token: accessToken, last_synced_at: new Date().toISOString(),
      }, { onConflict: 'enrollment_id' })
      const data = await fullSync(supabase, creds, { [enrollmentId]: accounts })
      return res.json({ ...data, success: true })
    } catch (e) { return res.status(500).json({ error: e.message }) }
  }

  // DELETE /api/teller/disconnect-all
  if (sub === 'disconnect-all' && req.method === 'DELETE') {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' })
    const { error } = await supabase.from('bank_connections').delete().neq('enrollment_id', '')
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ success: true })
  }

  // DELETE /api/teller/disconnect/:enrollmentId
  if (sub === 'disconnect' && id && req.method === 'DELETE') {
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' })
    const { error } = await supabase.from('bank_connections').delete().eq('enrollment_id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ success: true })
  }

  res.status(404).json({ error: 'Not found' })
}
