import { getSnapClient, getSnapUser, saveSnapUser } from './_lib/snaptrade.js'
import { getSupabase } from './_lib/supabase.js'
import crypto from 'node:crypto'

export default async function handler(req, res) {
  const parts = req.url.split('?')[0].split('/').filter(Boolean)
  const sub   = parts[2]

  // GET /api/snaptrade/status
  if (sub === 'status' && req.method === 'GET') {
    try {
      const user = await getSnapUser()
      if (!user) return res.json({ registered: false, accountCount: 0 })
      const snap     = getSnapClient()
      const response = await snap.accountInformation.listUserAccounts({ userId: user.userId, userSecret: user.userSecret })
      return res.json({ registered: true, accountCount: (response.data || []).length })
    } catch {
      return res.json({ registered: false, accountCount: 0 })
    }
  }

  // POST /api/snaptrade/connect
  if (sub === 'connect' && req.method === 'POST') {
    const { customRedirect } = req.body || {}
    try {
      let user = await getSnapUser()
      const snap = getSnapClient()
      if (!user) {
        const userId     = `aaron_${crypto.randomBytes(8).toString('hex')}`
        const reg        = await snap.authentication.registerSnapTradeUser({ userId })
        const userSecret = reg.data?.userSecret
        if (!userSecret) throw new Error('Failed to register SnapTrade user')
        await saveSnapUser(userId, userSecret)
        user = { userId, userSecret }
      }
      const response = await snap.authentication.loginSnapTradeUser({
        userId: user.userId, userSecret: user.userSecret,
        snapTradeLoginUserRequestBody: { ...(customRedirect ? { customRedirect } : {}) },
      })
      return res.json({ redirectURI: response.data?.redirectURI ?? response.data })
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }

  // POST /api/snaptrade/sync
  if (sub === 'sync' && req.method === 'POST') {
    const user = await getSnapUser()
    if (!user) return res.status(400).json({ error: 'SnapTrade not connected' })
    const supabase = getSupabase()
    try {
      const snap     = getSnapClient()
      const response = await snap.accountInformation.getAllUserHoldings({ userId: user.userId, userSecret: user.userSecret })
      const holdings = response.data || []
      if (supabase && holdings.length > 0) {
        for (const item of holdings) {
          const acc = item.account
          if (!acc) continue
          await supabase.from('bank_accounts').upsert({
            account_id:        `snap_${acc.id}`,
            enrollment_id:     null,
            account_name:      acc.name,
            type:              'investment',
            subtype:           'investment',
            category_group:    'investments',
            current_balance:   parseFloat(item.totalValue?.amount ?? 0),
            available_balance: parseFloat(item.totalValue?.amount ?? 0),
            institution_name:  acc.institution_name || 'SnapTrade',
            last_synced_at:    new Date().toISOString(),
          }, { onConflict: 'account_id' })
        }
      }
      return res.json({ success: true, accounts: holdings.length })
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }

  // DELETE /api/snaptrade/disconnect
  if (sub === 'disconnect' && req.method === 'DELETE') {
    const supabase = getSupabase()
    if (supabase) {
      await supabase.from('settings').delete().in('key', ['snaptrade_user_id', 'snaptrade_user_secret'])
      await supabase.from('bank_accounts').delete().like('account_id', 'snap_%')
    }
    return res.json({ success: true })
  }

  res.status(404).json({ error: 'Not found' })
}
