import { getSupabase } from '../_lib/supabase.js'

export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' })

  const supabase = getSupabase()
  if (supabase) {
    await supabase.from('settings').delete().in('key', ['snaptrade_user_id', 'snaptrade_user_secret'])
    await supabase.from('bank_accounts').delete().like('account_id', 'snap_%')
  }

  res.json({ success: true })
}
