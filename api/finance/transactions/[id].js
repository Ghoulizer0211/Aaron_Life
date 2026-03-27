import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' })

  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return res.status(500).json({ error: 'Supabase not configured' })
  const supabase = createClient(url, key)

  const txId = req.query.id
  const { category, note } = req.body
  if (!category || typeof category !== 'string') return res.status(400).json({ error: 'category is required' })

  const update = { category }
  if (typeof note === 'string') update.note = note

  const { data, error } = await supabase
    .from('bank_transactions')
    .update(update)
    .eq('transaction_id', txId)
    .select('transaction_id, category')

  if (error) return res.status(500).json({ error: error.message })
  if (!data || data.length === 0) return res.status(404).json({ error: `No transaction found: ${txId}` })
  res.json({ success: true, updated: data[0] })
}
