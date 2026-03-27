import { createClient } from '@supabase/supabase-js'

function nextMonthStart(month) {
  const [y, m] = month.split('-').map(Number)
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

export default async function handler(req, res) {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return res.json([])
  const supabase = createClient(url, key)

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
    res.status(500).json({ error: err.message })
  }
}
