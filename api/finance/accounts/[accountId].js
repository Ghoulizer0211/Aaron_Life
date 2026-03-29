import { getSupabase } from '../../_lib/supabase.js'

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' })

  const { accountId } = req.query
  const { category_group } = req.body || {}
  if (!accountId || !category_group) return res.status(400).json({ error: 'accountId and category_group required' })

  const supabase = getSupabase()
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured' })

  try {
    const { error } = await supabase
      .from('bank_accounts')
      .update({ category_group })
      .eq('account_id', accountId)
    if (error) throw new Error(error.message)
    res.json({ success: true })
  } catch (err) {
    console.error('[finance/accounts/patch]', err.message)
    res.status(500).json({ error: err.message })
  }
}
