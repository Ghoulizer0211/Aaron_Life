import { getSnapClient, getSnapUser } from '../_lib/snaptrade.js'
import { getSupabase } from '../_lib/supabase.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await getSnapUser()
  if (!user) return res.status(400).json({ error: 'SnapTrade not connected' })

  const supabase = getSupabase()

  try {
    const snap     = getSnapClient()
    const response = await snap.accountInformation.getAllUserHoldings({
      userId:     user.userId,
      userSecret: user.userSecret,
    })

    const holdings = response.data || []
    if (supabase && holdings.length > 0) {
      for (const item of holdings) {
        const acc = item.account
        if (!acc) continue
        await supabase.from('bank_accounts').upsert({
          account_id:      `snap_${acc.id}`,
          enrollment_id:   null,
          account_name:    acc.name,
          type:            'investment',
          subtype:         'investment',
          category_group:  'investments',
          current_balance: parseFloat(item.totalValue?.amount ?? 0),
          available_balance: parseFloat(item.totalValue?.amount ?? 0),
          institution_name: acc.institution_name || 'SnapTrade',
          last_synced_at:  new Date().toISOString(),
        }, { onConflict: 'account_id' })
      }
    }

    res.json({ success: true, accounts: holdings.length })
  } catch (err) {
    console.error('[snaptrade/sync]', err.message)
    res.status(500).json({ error: err.message })
  }
}
