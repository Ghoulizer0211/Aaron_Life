import { getSnapClient, getSnapUser } from '../_lib/snaptrade.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const user = await getSnapUser()
    if (!user) return res.json({ registered: false, accountCount: 0 })

    const snap     = getSnapClient()
    const response = await snap.accountInformation.listUserAccounts({
      userId:     user.userId,
      userSecret: user.userSecret,
    })
    const accountCount = (response.data || []).length
    res.json({ registered: true, accountCount })
  } catch (err) {
    console.error('[snaptrade/status]', err.message)
    res.json({ registered: false, accountCount: 0 })
  }
}
