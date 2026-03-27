import { getSupabase, nextMonthStart } from '../_lib/supabase.js'

export default async function handler(req, res) {
  const supabase = getSupabase()
  if (!supabase) return res.json([])

  try {
    const { month, accountId, limit = 500 } = req.query
    let q = supabase
      .from('bank_transactions')
      .select('*')
      .order('date', { ascending: false })
      .limit(Number(limit))

    if (month)     q = q.gte('date', `${month}-01`).lt('date', nextMonthStart(month))
    if (accountId) q = q.eq('account_id', accountId)

    const { data, error } = await q
    if (error) throw error
    res.json(data || [])
  } catch (err) {
    console.error('[vercel/finance/transactions]', err.message)
    res.status(500).json({ error: err.message })
  }
}
